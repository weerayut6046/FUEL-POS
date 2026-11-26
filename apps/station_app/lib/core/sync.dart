/// คิวซิงก์ออฟไลน์
///
/// ทุกการบันทึก (เลขมิเตอร์ รูป เงิน วัดถัง ...) ลงคิวในเครื่องก่อน แล้วส่งขึ้นระบบทีละรายการตามลำดับ
/// - เน็ตหลุด → หยุดรอ แล้วลองใหม่ทุก 15 วินาที ข้อมูลไม่หาย
/// - เซิร์ฟเวอร์ปฏิเสธ (เช่น กะถูกยืนยันไปแล้ว) → ทำเครื่องหมายให้ผู้ใช้ตรวจ แล้วส่งรายการถัดไปต่อ
/// - id ของทุกรายการสร้างในเครื่อง ส่งซ้ำได้ ไม่เกิดรายการซ้ำ
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import 'api.dart';
import 'local_db.dart';
import 'session.dart';

const uuid = Uuid();
String newId() => uuid.v4();

class SyncState {
  const SyncState({
    this.pending = 0,
    this.failed = 0,
    this.syncing = false,
    this.online = true,
    this.version = 0,
    this.lastError,
    this.lastSyncAt,
  });

  final int pending;
  final int failed;
  final bool syncing;
  final bool online;

  /// เพิ่มทุกครั้งที่ส่งสำเร็จ — หน้าจอใช้ตัวนี้รีเฟรชข้อมูลจากเซิร์ฟเวอร์
  final int version;
  final String? lastError;
  final DateTime? lastSyncAt;

  SyncState copyWith({int? pending, int? failed, bool? syncing, bool? online, int? version, String? lastError, DateTime? lastSyncAt}) =>
      SyncState(
        pending: pending ?? this.pending,
        failed: failed ?? this.failed,
        syncing: syncing ?? this.syncing,
        online: online ?? this.online,
        version: version ?? this.version,
        lastError: lastError,
        lastSyncAt: lastSyncAt ?? this.lastSyncAt,
      );
}

class SyncNotifier extends Notifier<SyncState> {
  Timer? _timer;
  bool _flushing = false;
  StreamSubscription<List<OutboxOp>>? _watch;

  @override
  SyncState build() {
    final db = ref.watch(localDbProvider);
    _watch = db.watchOps().listen((ops) {
      state = state.copyWith(
        pending: ops.where((o) => o.status == 'pending').length,
        failed: ops.where((o) => o.status == 'failed').length,
        lastError: state.lastError,
      );
    });
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => flush());
    ref.onDispose(() {
      _timer?.cancel();
      _watch?.cancel();
    });
    Future.microtask(flush);
    return const SyncState();
  }

  LocalDb get _db => ref.read(localDbProvider);

  /// ใส่รายการลงคิวแล้วพยายามส่งทันที
  Future<void> enqueue({
    required String opId,
    required String kind,
    required String method,
    required String path,
    Map<String, dynamic>? body,
    Uint8List? bytes,
    String? contentType,
    String? scope,
    required String label,
  }) async {
    await _db.enqueue(OutboxOpsCompanion.insert(
      opId: opId,
      kind: kind,
      method: method,
      path: path,
      body: Value(body == null ? null : jsonEncode(body)),
      bytes: Value(bytes),
      contentType: Value(contentType),
      scope: Value(scope),
      label: label,
      createdAt: DateTime.now(),
    ));
    unawaited(flush());
  }

  Future<void> retryFailed() async {
    await _db.retryFailed();
    await flush();
  }

  Future<void> discard(int seq) => _db.removeOp(seq);

  Future<void> flush() async {
    if (_flushing) return;
    final session = ref.read(sessionProvider);
    if (session == null) return;
    _flushing = true;
    state = state.copyWith(syncing: true, lastError: state.lastError);
    var sent = 0;
    try {
      final api = ApiClient(baseUrl: session.baseUrl, token: session.token);
      while (true) {
        final op = await _db.nextPending();
        if (op == null) break;
        try {
          if (op.bytes != null) {
            await api.putBytes(op.path, op.bytes!, op.contentType ?? 'image/jpeg');
          } else {
            await api.send<dynamic>(op.method, op.path, op.body == null ? null : jsonDecode(op.body!));
          }
          await _db.removeOp(op.seq);
          sent++;
          state = state.copyWith(online: true, lastError: null);
        } on ApiException catch (e) {
          if (e.isNetwork) {
            state = state.copyWith(online: false, lastError: e.message);
            break;
          }
          if (e.isUnauthorized) {
            state = state.copyWith(lastError: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
            break;
          }
          if (e.isRejected) {
            final detail = e.detailMessages.isEmpty ? '' : '\n${e.detailMessages.join('\n')}';
            await _db.markFailed(op.seq, '${e.message}$detail');
            continue;
          }
          // 5xx หรือ 429 → รอรอบหน้า
          await _db.markAttempt(op.seq, e.message);
          state = state.copyWith(lastError: e.message);
          break;
        }
      }
    } finally {
      _flushing = false;
      state = state.copyWith(
        syncing: false,
        version: sent > 0 ? state.version + 1 : state.version,
        lastSyncAt: sent > 0 ? DateTime.now() : null,
        lastError: state.lastError,
      );
    }
  }
}

final syncProvider = NotifierProvider<SyncNotifier, SyncState>(SyncNotifier.new);

/// รายการในคิวทั้งหมด (อัปเดตสด)
final outboxProvider = StreamProvider<List<OutboxOp>>((ref) => ref.watch(localDbProvider).watchOps());

/// ผลการดึงข้อมูล: มาจากเซิร์ฟเวอร์ หรือจากแคชในเครื่อง (ออฟไลน์)
class Fetched<T> {
  const Fetched(this.data, {this.fromCache = false, this.cachedAt});
  final T data;
  final bool fromCache;
  final DateTime? cachedAt;
}

/// ดึงจาก API แล้วเก็บแคช · ถ้าเน็ตหลุดใช้แคชล่าสุด
Future<Fetched<T>> fetchCached<T>(Ref ref, String cacheKey, String path, {Map<String, dynamic>? query}) async {
  final api = ref.read(apiProvider);
  final db = ref.read(localDbProvider);
  try {
    final data = await api.get<T>(path, query: query);
    await db.putJson(cacheKey, data);
    return Fetched(data);
  } on ApiException catch (e) {
    if (!e.isNetwork) rethrow;
    final cached = await db.getJson<T>(cacheKey);
    if (cached == null) rethrow;
    return Fetched(cached, fromCache: true, cachedAt: await db.cachedAt(cacheKey));
  }
}
