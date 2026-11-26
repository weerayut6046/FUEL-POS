/// คำนวณกะในเครื่อง — สูตรเดียวกับเซิร์ฟเวอร์ (apps/cloud-api/src/shifts/shift-calc.ts)
/// ทำให้แอปเตือนได้ทันทีที่กรอกเลขมิเตอร์ แม้ไม่มีเน็ต
library;

import 'units.dart';

const paymentMethods = ['cash', 'qr', 'card', 'coupon', 'credit'];

const methodLabel = {
  'cash': 'เงินสด',
  'qr': 'QR พร้อมเพย์',
  'card': 'บัตร',
  'coupon': 'คูปอง',
  'credit': 'เงินเชื่อ',
};

enum Severity { error, warning, info }

class Issue {
  const Issue(this.code, this.severity, this.message, {this.nozzleId, this.attendantId});

  final String code;
  final Severity severity;
  final String message;
  final String? nozzleId;
  final String? attendantId;

  factory Issue.fromJson(Map<String, dynamic> j) => Issue(
        j['code'] as String,
        Severity.values.byName(j['severity'] as String),
        j['message'] as String,
        nozzleId: j['nozzleId'] as String?,
        attendantId: j['attendantId'] as String?,
      );
}

class LineInput {
  const LineInput({
    required this.nozzleId,
    required this.nozzleCode,
    required this.fuelTypeId,
    required this.priceSatang,
    required this.attendantId,
    required this.modulusMilli,
    required this.openMilli,
    required this.closeMilli,
    required this.rollover,
    required this.testMilli,
    required this.openHasPhoto,
    required this.closeHasPhoto,
    required this.prevCloseMilli,
    required this.nextOpenMilli,
  });

  final String nozzleId;
  final String nozzleCode;
  final String fuelTypeId;
  final int priceSatang;
  final String? attendantId;
  final int modulusMilli;
  final int? openMilli;
  final int? closeMilli;
  final bool rollover;
  final int testMilli;
  final bool openHasPhoto;
  final bool closeHasPhoto;
  final int? prevCloseMilli;
  final int? nextOpenMilli;
}

class LineResult {
  const LineResult(this.nozzleId, this.meterMilli, this.soldMilli, this.amountSatang);
  final String nozzleId;
  final int? meterMilli;
  final int? soldMilli;
  final int amountSatang;
}

class AttendantResult {
  AttendantResult(this.attendantId);
  final String? attendantId;
  int expectedSatang = 0;
  int collectedSatang = 0;
  int soldMilli = 0;
  final Map<String, int> collected = {for (final m in paymentMethods) m: 0};
  int get diffSatang => collectedSatang - expectedSatang;
}

class ShiftCalc {
  ShiftCalc(this.lines, this.byAttendant, this.issues);
  final List<LineResult> lines;
  final List<AttendantResult> byAttendant;
  final List<Issue> issues;

  int get soldMilli => byAttendant.fold(0, (s, a) => s + a.soldMilli);
  int get expectedSatang => byAttendant.fold(0, (s, a) => s + a.expectedSatang);
  int get collectedSatang => byAttendant.fold(0, (s, a) => s + a.collectedSatang);
  int get diffSatang => collectedSatang - expectedSatang;
  bool get hasErrors => issues.any((i) => i.severity == Severity.error);
  LineResult? line(String nozzleId) => lines.where((l) => l.nozzleId == nozzleId).firstOrNull;
  AttendantResult? attendant(String? id) => byAttendant.where((a) => a.attendantId == id).firstOrNull;
}

int? meterLitres(int? open, int? close, bool rollover, int modulus) {
  if (open == null || close == null) return null;
  return rollover ? modulus - open + close : close - open;
}

ShiftCalc computeShift(
  List<LineInput> lines,
  List<({String attendantId, String method, int amountSatang})> collections, {
  required int cashAlertSatang,
  required Map<String, String> names,
}) {
  final issues = <Issue>[];
  final results = <LineResult>[];
  final byAtt = <String?, AttendantResult>{};
  AttendantResult att(String? id) => byAtt.putIfAbsent(id, () => AttendantResult(id));
  String name(String? id) => id == null ? 'ไม่ระบุพนักงาน' : (names[id] ?? 'ไม่ทราบชื่อ');

  for (final l in lines) {
    final n = l.nozzleCode;
    final meter = meterLitres(l.openMilli, l.closeMilli, l.rollover, l.modulusMilli);
    if (l.openMilli == null) {
      issues.add(Issue('MISSING_OPEN', Severity.error, 'หัวจ่าย $n: ยังไม่ได้จดมิเตอร์ต้นกะ', nozzleId: l.nozzleId));
    }
    if (l.closeMilli == null) {
      issues.add(Issue('MISSING_CLOSE', Severity.error, 'หัวจ่าย $n: ยังไม่ได้จดมิเตอร์ปลายกะ', nozzleId: l.nozzleId));
    }
    if (l.openMilli != null && l.prevCloseMilli != null && l.openMilli != l.prevCloseMilli) {
      issues.add(Issue(
        'OPEN_MISMATCH_PREV',
        Severity.warning,
        'หัวจ่าย $n: มิเตอร์ต้นกะ ${litresToApi(l.openMilli!)} ไม่ตรงกับปลายกะก่อนหน้า ${litresToApi(l.prevCloseMilli!)} '
        '(ต่างกัน ${fmtLitres(l.openMilli! - l.prevCloseMilli!)} ลิตร)',
        nozzleId: l.nozzleId,
      ));
    }
    if (l.closeMilli != null && l.nextOpenMilli != null && l.closeMilli != l.nextOpenMilli) {
      issues.add(Issue(
        'CLOSE_MISMATCH_NEXT',
        Severity.warning,
        'หัวจ่าย $n: มิเตอร์ปลายกะ ${litresToApi(l.closeMilli!)} ไม่ตรงกับต้นกะถัดไป ${litresToApi(l.nextOpenMilli!)}',
        nozzleId: l.nozzleId,
      ));
    }
    if (l.openMilli != null && l.closeMilli != null) {
      if (!l.rollover && l.closeMilli! < l.openMilli!) {
        issues.add(Issue(
          'CLOSE_LT_OPEN',
          Severity.error,
          'หัวจ่าย $n: มิเตอร์ปลายกะน้อยกว่าต้นกะ — ตรวจตัวเลขอีกครั้ง หรือติ๊ก "มิเตอร์วนรอบ" ถ้ามิเตอร์ครบรอบกลับไปเริ่มที่ 0',
          nozzleId: l.nozzleId,
        ));
      }
      if (l.rollover && meter != null && meter > l.modulusMilli ~/ 2) {
        issues.add(Issue('ROLLOVER_SUSPICIOUS', Severity.warning,
            'หัวจ่าย $n: ติ๊กมิเตอร์วนรอบแต่ได้ยอด ${fmtLitres(meter)} ลิตร ซึ่งสูงผิดปกติ',
            nozzleId: l.nozzleId));
      }
      if (l.rollover && l.closeMilli! >= l.openMilli!) {
        issues.add(Issue('ROLLOVER_NOT_NEEDED', Severity.error, 'หัวจ่าย $n: ติ๊กมิเตอร์วนรอบ แต่ปลายกะไม่ได้น้อยกว่าต้นกะ',
            nozzleId: l.nozzleId));
      }
    }
    if (l.openMilli != null && !l.openHasPhoto) {
      issues.add(Issue('MISSING_PHOTO', Severity.warning, 'หัวจ่าย $n: ไม่มีรูปมิเตอร์ต้นกะ', nozzleId: l.nozzleId));
    }
    if (l.closeMilli != null && !l.closeHasPhoto) {
      issues.add(Issue('MISSING_PHOTO', Severity.warning, 'หัวจ่าย $n: ไม่มีรูปมิเตอร์ปลายกะ', nozzleId: l.nozzleId));
    }
    if (meter != null && l.testMilli > (meter < 0 ? 0 : meter)) {
      issues.add(Issue('TEST_EXCEEDS_METER', Severity.error,
          'หัวจ่าย $n: น้ำมันทดสอบ ${fmtLitres(l.testMilli)} ลิตร มากกว่ายอดมิเตอร์',
          nozzleId: l.nozzleId));
    }
    final sold = meter == null ? null : meter - l.testMilli;
    final amount = sold == null ? 0 : amountSatang(sold, l.priceSatang);
    results.add(LineResult(l.nozzleId, meter, sold, amount));
    if (sold != null) {
      final a = att(l.attendantId);
      a.expectedSatang += amount;
      a.soldMilli += sold;
    }
  }

  for (final c in collections) {
    final a = att(c.attendantId);
    a.collected[c.method] = (a.collected[c.method] ?? 0) + c.amountSatang;
    a.collectedSatang += c.amountSatang;
  }

  for (final a in byAtt.values) {
    if (a.expectedSatang > 0 && a.collectedSatang == 0) {
      issues.add(Issue('NO_COLLECTIONS', Severity.warning,
          '${name(a.attendantId)}: ยังไม่ได้บันทึกเงินที่ส่ง (ยอดที่ควรได้ ${fmtBaht(a.expectedSatang)} บาท)',
          attendantId: a.attendantId));
    } else if (a.diffSatang != 0) {
      final big = a.diffSatang.abs() >= cashAlertSatang;
      issues.add(Issue(
        a.diffSatang < 0 ? 'CASH_SHORT' : 'CASH_OVER',
        big ? Severity.warning : Severity.info,
        '${name(a.attendantId)}: เงิน${a.diffSatang < 0 ? 'ขาด' : 'เกิน'} ${fmtBaht(a.diffSatang.abs())} บาท',
        attendantId: a.attendantId,
      ));
    }
  }
  issues.sort((a, b) => a.severity.index.compareTo(b.severity.index));
  return ShiftCalc(results, byAtt.values.toList(), issues);
}
