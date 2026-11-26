// โมเดลกะ: รวมข้อมูลจากเซิร์ฟเวอร์ + รายการที่บันทึกในเครื่องแต่ยังไม่ได้ส่ง (ออฟไลน์)
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:station_app/core/local_db.dart';
import 'package:station_app/features/shifts/shift_model.dart';

import 'fixtures.dart';

OutboxOp op(int seq, String kind, String path, Map<String, dynamic> body) => OutboxOp(
      seq: seq,
      opId: 'op$seq',
      kind: kind,
      method: 'POST',
      path: path,
      body: jsonEncode(body),
      bytes: null,
      contentType: null,
      scope: 'shift:s1',
      label: kind,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: DateTime(2026, 11, 26),
    );

void main() {
  test('เปิดกะตอนออฟไลน์: สร้างจากตั้งค่าสาขาในเครื่อง เติมปลายกะก่อนหน้าให้', () {
    final model = ShiftModel.build(
      shiftId: 's1',
      detail: null,
      setup: setupFixture,
      ops: [
        op(1, 'openShift', '/branches/b1/shifts', {'id': 's1', 'businessDate': '2026-11-26', 'shiftNo': 1, 'attendantId': 'u1', 'branchId': 'b1'}),
        op(2, 'reading', '/shifts/s1/readings', {'id': 'r1', 'nozzleId': 'n1', 'kind': 'open', 'reading': '1000.000'}),
        op(3, 'reading', '/shifts/s1/readings', {'id': 'r2', 'nozzleId': 'n1', 'kind': 'close', 'reading': '1100.000'}),
        op(4, 'collection', '/shifts/s1/collections', {'id': 'c1', 'attendantId': 'u1', 'method': 'cash', 'amountSatang': 324400}),
      ],
    )!;
    expect(model.pendingOpen, isTrue);
    expect(model.nozzles.length, 2);
    final n1 = model.nozzles.first;
    expect(n1.prevCloseMilli, 1000000);
    expect(n1.open!.pending, isTrue);
    expect(model.calc.line('n1')!.soldMilli, 100000);
    expect(model.calc.attendant('u1')!.expectedSatang, 324400);
    expect(model.calc.attendant('u1')!.diffSatang, 0);
    // หัวที่ 2 ยังไม่จด → ส่งปิดกะไม่ได้
    expect(model.calc.hasErrors, isTrue);
  });

  test('ข้อมูลจากเซิร์ฟเวอร์ + แก้ไขที่ยังไม่ได้ส่ง: แสดงค่าล่าสุดในเครื่อง', () {
    final model = ShiftModel.build(
      shiftId: 's1',
      detail: detailFixture,
      setup: setupFixture,
      ops: [
        op(1, 'reading', '/shifts/s1/readings', {'id': 'r9', 'nozzleId': 'n2', 'kind': 'close', 'reading': '2050.000', 'supersedesId': 'srv2'}),
        op(2, 'submit', '/shifts/s1/submit', {}),
      ],
    )!;
    final n2 = model.nozzles.firstWhere((n) => n.nozzleId == 'n2');
    expect(n2.close!.milli, 2050000);
    expect(n2.close!.pending, isTrue);
    expect(model.pendingSubmit, isTrue);
    expect(model.isOpen, isFalse);
  });

  test('ไม่มีข้อมูลบนเซิร์ฟเวอร์และไม่มีรายการเปิดกะในเครื่อง → ไม่พบ', () {
    expect(ShiftModel.build(shiftId: 'x', detail: null, setup: setupFixture, ops: const []), isNull);
  });
}
