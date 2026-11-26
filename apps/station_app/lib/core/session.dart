/// สถานะการเข้าสู่ระบบ + สาขาที่เลือก (เก็บในเครื่อง เปิดแอปใหม่ไม่ต้องล็อกอินซ้ำ แม้ออฟไลน์)
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';
import 'local_db.dart';

final localDbProvider = Provider<LocalDb>((ref) => throw UnimplementedError('override ใน main()'));

class Branch {
  const Branch(this.id, this.code, this.name);
  final String id;
  final String code;
  final String name;

  factory Branch.fromJson(Map<String, dynamic> j) => Branch(j['id'] as String, j['code'] as String, j['name'] as String);
  Map<String, dynamic> toJson() => {'id': id, 'code': code, 'name': name};
}

class Session {
  const Session({
    required this.baseUrl,
    required this.token,
    required this.userId,
    required this.username,
    required this.displayName,
    required this.role,
    required this.tenantName,
    required this.tenantSlug,
    required this.branches,
    required this.branchId,
  });

  final String baseUrl;
  final String token;
  final String userId;
  final String username;
  final String displayName;

  /// owner · manager · staff
  final String role;
  final String tenantName;
  final String tenantSlug;
  final List<Branch> branches;
  final String? branchId;

  bool get isOwner => role == 'owner';
  bool get isManager => role == 'owner' || role == 'manager';
  Branch? get branch => branches.where((b) => b.id == branchId).firstOrNull;

  String get roleLabel => switch (role) { 'owner' => 'เจ้าของ', 'manager' => 'ผู้จัดการ', _ => 'พนักงานหน้าลาน' };

  Session copyWith({List<Branch>? branches, String? branchId}) => Session(
        baseUrl: baseUrl,
        token: token,
        userId: userId,
        username: username,
        displayName: displayName,
        role: role,
        tenantName: tenantName,
        tenantSlug: tenantSlug,
        branches: branches ?? this.branches,
        branchId: branchId ?? this.branchId,
      );

  Map<String, dynamic> toJson() => {
        'baseUrl': baseUrl,
        'token': token,
        'userId': userId,
        'username': username,
        'displayName': displayName,
        'role': role,
        'tenantName': tenantName,
        'tenantSlug': tenantSlug,
        'branches': branches.map((b) => b.toJson()).toList(),
        'branchId': branchId,
      };

  factory Session.fromJson(Map<String, dynamic> j) => Session(
        baseUrl: j['baseUrl'] as String,
        token: j['token'] as String,
        userId: j['userId'] as String,
        username: j['username'] as String,
        displayName: j['displayName'] as String,
        role: j['role'] as String,
        tenantName: j['tenantName'] as String,
        tenantSlug: j['tenantSlug'] as String,
        branches: [for (final b in j['branches'] as List) Branch.fromJson(b as Map<String, dynamic>)],
        branchId: j['branchId'] as String?,
      );

  /// จากคำตอบของ POST /auth/login
  factory Session.fromLogin(String baseUrl, Map<String, dynamic> j) {
    final user = j['user'] as Map<String, dynamic>;
    final tenant = j['tenant'] as Map<String, dynamic>;
    final branches = [for (final b in j['branches'] as List) Branch.fromJson(b as Map<String, dynamic>)];
    return Session(
      baseUrl: baseUrl,
      token: j['token'] as String,
      userId: user['id'] as String,
      username: user['username'] as String,
      displayName: user['displayName'] as String,
      role: user['role'] as String,
      tenantName: tenant['name'] as String,
      tenantSlug: tenant['slug'] as String,
      branches: branches,
      branchId: branches.length == 1 ? branches.first.id : null,
    );
  }
}

const _sessionKey = 'session';
const _lastLoginKey = 'last_login';

class SessionNotifier extends Notifier<Session?> {
  @override
  Session? build() => null;

  LocalDb get _db => ref.read(localDbProvider);

  /// โหลด session ที่เก็บไว้ตอนเปิดแอป
  Future<void> restore() async {
    final j = await _db.getJson<Map<String, dynamic>>(_sessionKey);
    if (j != null) state = Session.fromJson(j);
  }

  Future<Map<String, dynamic>?> lastLogin() => _db.getJson<Map<String, dynamic>>(_lastLoginKey);

  Future<void> login({required String baseUrl, required String tenant, required String username, required String password}) async {
    final api = ApiClient(baseUrl: baseUrl);
    final res = await api.post<Map<String, dynamic>>('/auth/login', {
      'tenant': tenant.trim().toLowerCase(),
      'username': username.trim().toLowerCase(),
      'password': password,
    });
    final s = Session.fromLogin(baseUrl, res);
    // เปลี่ยนผู้ใช้/ลูกค้า → ล้างข้อมูลในเครื่องของคนก่อน (แต่ไม่ทิ้งรายการที่ยังไม่ได้ส่งของผู้ใช้เดิม)
    final prev = state ?? (await _db.getJson<Map<String, dynamic>>(_sessionKey)).let(Session.fromJson);
    if (prev != null && (prev.tenantSlug != s.tenantSlug || prev.userId != s.userId)) {
      final pending = await _db.allOps();
      if (pending.isNotEmpty) {
        throw ApiException(409, 'PENDING_OPS',
            'เครื่องนี้ยังมี ${pending.length} รายการของ ${prev.displayName} ที่ยังไม่ได้ส่งขึ้นระบบ ให้ ${prev.displayName} เข้าสู่ระบบเพื่อส่งให้ครบก่อน');
      }
      await _db.clearAll();
    }
    await _db.putJson(_sessionKey, s.toJson());
    await _db.putJson(_lastLoginKey, {'baseUrl': baseUrl, 'tenant': s.tenantSlug, 'username': s.username});
    state = s;
  }

  Future<void> selectBranch(String branchId) async {
    final s = state;
    if (s == null) return;
    state = s.copyWith(branchId: branchId);
    await _db.putJson(_sessionKey, state!.toJson());
  }

  Future<void> updateBranches(List<Branch> branches) async {
    final s = state;
    if (s == null) return;
    final keep = branches.any((b) => b.id == s.branchId) ? s.branchId : (branches.length == 1 ? branches.first.id : null);
    state = Session.fromJson({...s.copyWith(branches: branches).toJson(), 'branchId': keep});
    await _db.putJson(_sessionKey, state!.toJson());
  }

  Future<void> logout({bool callServer = true}) async {
    final s = state;
    if (s != null && callServer) {
      try {
        await ApiClient(baseUrl: s.baseUrl, token: s.token).post<dynamic>('/auth/logout');
      } catch (_) {}
    }
    await _db.deleteKey(_sessionKey);
    state = null;
  }
}

final sessionProvider = NotifierProvider<SessionNotifier, Session?>(SessionNotifier.new);

/// ApiClient ของผู้ใช้ปัจจุบัน
final apiProvider = Provider<ApiClient>((ref) {
  final s = ref.watch(sessionProvider);
  return ApiClient(baseUrl: s?.baseUrl ?? defaultApiUrl, token: s?.token);
});

extension _Let<T extends Object> on T? {
  R? let<R>(R Function(T) f) {
    final v = this;
    return v == null ? null : f(v);
  }
}
