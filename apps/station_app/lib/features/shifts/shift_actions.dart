/// การบันทึกข้อมูลกะ — ลงคิวในเครื่องก่อนเสมอ (ทำงานได้แม้ออฟไลน์) แล้วซิงก์ขึ้นระบบ
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/session.dart';
import '../../core/sync.dart';
import '../../core/units.dart';
import 'shift_model.dart';

class ShiftActions {
  ShiftActions(this.ref);
  final Ref ref;

  SyncNotifier get _sync => ref.read(syncProvider.notifier);

  /// เปิดกะใหม่ (id สร้างในเครื่อง)
  Future<String> openShift({required String branchId, required String businessDate, required int shiftNo}) async {
    final id = newId();
    final userId = ref.read(sessionProvider)!.userId;
    await _sync.enqueue(
      opId: id,
      kind: 'openShift',
      method: 'POST',
      path: '/branches/$branchId/shifts',
      body: {'id': id, 'businessDate': businessDate, 'shiftNo': shiftNo, 'attendantId': userId, 'branchId': branchId},
      scope: 'shift:$id',
      label: 'เปิดกะ $shiftNo วันที่ $businessDate',
    );
    return id;
  }

  /// เก็บรูปลงคิว คืน id ของรูป
  Future<String> _photo(String shiftId, Uint8List bytes, String label) async {
    final photoId = newId();
    await _sync.enqueue(
      opId: photoId,
      kind: 'photo',
      method: 'PUT',
      path: '/photos/$photoId',
      bytes: bytes,
      contentType: 'image/jpeg',
      scope: 'shift:$shiftId',
      label: 'รูป: $label',
    );
    return photoId;
  }

  /// บันทึกเลขมิเตอร์
  /// - ยังไม่เคยบันทึก → รายการแรก
  /// - ค่าเดิมยังไม่ได้ส่งขึ้นระบบ → แทนที่ในคิว (ยังไม่มีใครเห็นค่าเดิม)
  /// - ค่าเดิมอยู่บนระบบแล้ว → เพิ่มรายการแก้ไขพร้อมเหตุผล (เก็บประวัติครบ)
  Future<void> recordReading({
    required ShiftModel shift,
    required NozzleModel nozzle,
    required String kind,
    required int milli,
    bool rollover = false,
    Uint8List? photo,
    String? reason,
  }) async {
    final existing = kind == 'open' ? nozzle.open : nozzle.close;
    final label = '${kind == 'open' ? 'ต้นกะ' : 'ปลายกะ'} หัว ${nozzle.code}';
    final photoId = photo != null ? await _photo(shift.id, photo, label) : existing?.photoId;
    final body = <String, dynamic>{
      'nozzleId': nozzle.nozzleId,
      'kind': kind,
      'reading': litresToApi(milli),
      'rollover': rollover,
      'photoId': photoId,
      'deviceAt': DateTime.now().toUtc().toIso8601String(),
    };
    if (existing != null && existing.pending && await _replace(existing.id, {...body, 'id': existing.id})) return;
    final id = newId();
    await _sync.enqueue(
      opId: id,
      kind: 'reading',
      method: 'POST',
      path: '/shifts/${shift.id}/readings',
      body: {
        ...body,
        'id': id,
        if (existing != null) 'supersedesId': existing.id,
        if (existing != null) 'reason': reason ?? 'แก้ไขเลขมิเตอร์',
      },
      scope: 'shift:${shift.id}',
      label: '$label: ${litresToApi(milli)}',
    );
  }

  Future<void> recordPumpTest({required ShiftModel shift, required NozzleModel nozzle, required int milli, String? reason}) async {
    final body = {'nozzleId': nozzle.nozzleId, 'litres': litresToApi(milli), 'deviceAt': DateTime.now().toUtc().toIso8601String()};
    if (nozzle.testId != null && nozzle.testPending && await _replace(nozzle.testId!, {...body, 'id': nozzle.testId})) return;
    final id = newId();
    await _sync.enqueue(
      opId: id,
      kind: 'pumpTest',
      method: 'POST',
      path: '/shifts/${shift.id}/pump-tests',
      body: {
        ...body,
        'id': id,
        if (nozzle.testId != null) 'supersedesId': nozzle.testId,
        if (nozzle.testId != null) 'reason': reason ?? 'แก้ไขน้ำมันทดสอบ',
      },
      scope: 'shift:${shift.id}',
      label: 'น้ำมันทดสอบ หัว ${nozzle.code}: ${litresToApi(milli)}',
    );
  }

  Future<void> recordCollection({
    required ShiftModel shift,
    required String attendantId,
    required String method,
    required int amountSatang,
    String? reason,
  }) async {
    final existing = shift.collection(attendantId, method);
    if (existing != null && existing.amountSatang == amountSatang) return;
    final body = {
      'attendantId': attendantId,
      'method': method,
      'amountSatang': amountSatang,
      'deviceAt': DateTime.now().toUtc().toIso8601String(),
    };
    if (existing != null && existing.pending && await _replace(existing.id, {...body, 'id': existing.id})) return;
    final id = newId();
    await _sync.enqueue(
      opId: id,
      kind: 'collection',
      method: 'POST',
      path: '/shifts/${shift.id}/collections',
      body: {
        ...body,
        'id': id,
        if (existing != null) 'supersedesId': existing.id,
        if (existing != null) 'reason': reason ?? 'แก้ไขยอดเงินส่ง',
      },
      scope: 'shift:${shift.id}',
      label: 'เงินส่ง ${shift.nameOf(attendantId)} (${fmtBaht(amountSatang)})',
    );
  }

  Future<void> setAttendant({required ShiftModel shift, required NozzleModel nozzle, required String? attendantId}) async {
    await _sync.enqueue(
      opId: newId(),
      kind: 'attendant',
      method: 'PUT',
      path: '/shifts/${shift.id}/nozzles/${nozzle.nozzleId}/attendant',
      body: {'attendantId': attendantId},
      scope: 'shift:${shift.id}',
      label: 'หัว ${nozzle.code} รับผิดชอบโดย ${shift.nameOf(attendantId)}',
    );
  }

  Future<void> submit({required ShiftModel shift, String? note}) async {
    await _sync.enqueue(
      opId: newId(),
      kind: 'submit',
      method: 'POST',
      path: '/shifts/${shift.id}/submit',
      body: {'note': note},
      scope: 'shift:${shift.id}',
      label: 'ส่งปิดกะ ${shift.shiftNo} วันที่ ${shift.businessDate}',
    );
  }

  /// ผู้จัดการยืนยันกะ (ต้องออนไลน์ — ต้องเห็นตัวเลขล่าสุดบนระบบ)
  Future<void> approve(String shiftId, {required String? note, required bool acknowledge}) async {
    await ref.read(apiProvider).post<dynamic>('/shifts/$shiftId/approve', {'note': note, 'acknowledgeWarnings': acknowledge});
  }

  Future<void> reopen(String shiftId, String reason) async {
    await ref.read(apiProvider).post<dynamic>('/shifts/$shiftId/reopen', {'reason': reason});
  }

  Future<bool> _replace(String opId, Map<String, dynamic> body) async {
    final db = ref.read(localDbProvider);
    final before = (await db.allOps()).where((o) => o.opId == opId && o.status == 'pending').firstOrNull;
    if (before == null) return false;
    await db.replacePending(opId, jsonEncode(body));
    return true;
  }
}

final shiftActionsProvider = Provider<ShiftActions>(ShiftActions.new);

/// ข้อผิดพลาดของการกระทำที่ต้องออนไลน์
bool isOffline(Object e) => e is ApiException && e.isNetwork;
