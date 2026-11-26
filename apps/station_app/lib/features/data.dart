/// ตัวดึงข้อมูลของแต่ละหน้าจอ (Riverpod) — ดึงจาก API แล้วเก็บแคชไว้ใช้ตอนออฟไลน์
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/session.dart';
import '../core/sync.dart';

typedef Json = Map<String, dynamic>;

/// ตั้งค่าสาขาทั้งชุด (หัวจ่าย ถัง ตารางแปลง ราคา พนักงาน ปลายกะล่าสุด)
final setupProvider = FutureProvider.family<Fetched<Json>, String>((ref, branchId) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<Json>(ref, 'setup:$branchId', '/branches/$branchId/setup');
});

class RangeArgs {
  const RangeArgs(this.branchId, this.from, this.to);
  final String? branchId;
  final String from;
  final String to;

  @override
  bool operator ==(Object other) => other is RangeArgs && other.branchId == branchId && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(branchId, from, to);
}

final shiftListProvider = FutureProvider.family<Fetched<List<dynamic>>, RangeArgs>((ref, a) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<List<dynamic>>(ref, 'shifts:${a.branchId}:${a.from}:${a.to}', '/branches/${a.branchId}/shifts',
      query: {'from': a.from, 'to': a.to});
});

/// รายละเอียดกะจากเซิร์ฟเวอร์ (null = ยังไม่มีบนเซิร์ฟเวอร์ เช่น เปิดกะตอนออฟไลน์และยังไม่ได้ส่ง)
final shiftDetailProvider = FutureProvider.family<Fetched<Json>?, String>((ref, shiftId) async {
  ref.watch(syncProvider.select((s) => s.version));
  try {
    return await fetchCached<Json>(ref, 'shift:$shiftId', '/shifts/$shiftId');
  } on ApiException catch (e) {
    if (e.status == 404 || e.isNetwork) return null;
    rethrow;
  }
});

final tankStatusProvider = FutureProvider.family<Fetched<List<dynamic>>, String>((ref, branchId) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<List<dynamic>>(ref, 'tank-status:$branchId', '/branches/$branchId/tank-status');
});

final deliveriesProvider = FutureProvider.family<Fetched<List<dynamic>>, RangeArgs>((ref, a) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<List<dynamic>>(ref, 'deliveries:${a.branchId}:${a.from}:${a.to}', '/branches/${a.branchId}/deliveries',
      query: {'from': a.from, 'to': a.to});
});

final reconciliationProvider = FutureProvider.family<Fetched<Json>, RangeArgs>((ref, a) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<Json>(ref, 'recon:${a.branchId}:${a.from}:${a.to}', '/branches/${a.branchId}/tank-reconciliation',
      query: {'from': a.from, 'to': a.to});
});

final dashboardProvider = FutureProvider.family<Fetched<Json>, RangeArgs>((ref, a) {
  ref.watch(syncProvider.select((s) => s.version));
  return fetchCached<Json>(ref, 'dashboard:${a.branchId}:${a.from}:${a.to}', '/dashboard',
      query: {'from': a.from, 'to': a.to, if (a.branchId != null) 'branchId': a.branchId});
});

/// ข้อมูลตั้งค่า (ออนไลน์เท่านั้น — แก้ไขตั้งค่าต้องต่อเน็ต)
final settingsGetProvider = FutureProvider.family<dynamic, String>((ref, path) {
  ref.watch(syncProvider.select((s) => s.version));
  return ref.watch(apiProvider).get<dynamic>(path);
});
