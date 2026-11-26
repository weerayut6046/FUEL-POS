// สูตรคำนวณในแอปต้องได้ผลตรงกับเซิร์ฟเวอร์ทุกสตางค์
// (ตัวเลขชุดเดียวกับ apps/cloud-api/test/shifts.test.ts)
import 'package:flutter_test/flutter_test.dart';
import 'package:station_app/core/shift_calc.dart';
import 'package:station_app/core/units.dart';

LineInput line(String id, String code, int open, int close, int price, String? att, {int test = 0, bool rollover = false, int? prev}) => LineInput(
      nozzleId: id,
      nozzleCode: code,
      fuelTypeId: 'f',
      priceSatang: price,
      attendantId: att,
      modulusMilli: 1000000000,
      openMilli: open,
      closeMilli: close,
      rollover: rollover,
      testMilli: test,
      openHasPhoto: true,
      closeHasPhoto: true,
      prevCloseMilli: prev,
      nextOpenMilli: null,
    );

void main() {
  group('หน่วยตัวเลข', () {
    test('ลิตร สตริง ↔ มิลลิลิตร', () {
      expect(tryParseLitres('1234.567'), 1234567);
      expect(tryParseLitres('0.1')! + tryParseLitres('0.2')!, tryParseLitres('0.3'));
      expect(tryParseLitres('1.2345'), isNull);
      expect(litresToApi(5), '0.005');
      expect(litresToApi(-1500), '-1.500');
    });

    test('ยอดเงินปัดครึ่งขึ้น (ตรงกับเซิร์ฟเวอร์)', () {
      expect(amountSatang(123456, 3245), 400615);
      expect(amountSatang(200500, 3785), 758893); // 7,588.925 → 7,588.93
      expect(divRoundHalfUp(-15, 10), -2);
      expect(fmtBaht(123456), '1,234.56');
      expect(tryParseBaht('3,446.73'), 344673);
    });

    test('ตารางแปลงระดับ', () {
      final pts = [(deciMm: 0, milli: 0), (deciMm: 1000, milli: 500000), (deciMm: 2000, milli: 1200000)];
      expect(litresAtLevel(pts, 1500), 850000);
      expect(litresAtLevel(pts, 1005), 503500);
      expect(litresAtLevel(pts, 2001), isNull);
      expect(tryParseMm('125.5'), 1255);
    });
  });

  group('คำนวณกะ', () {
    test('ตัวอย่างเดียวกับชุดทดสอบ API: เงินขาด 200 บาท รายคน', () {
      final calc = computeShift(
        [
          line('n1', '1A', 10000000, 10500000, 3244, 'somchai', test: 5000),
          line('n2', '1B', 20000000, 20200500, 3785, 'somchai'),
          line('n3', '2A', 30000000, 30100000, 3244, 'somsri'),
        ],
        [
          (attendantId: 'somchai', method: 'cash', amountSatang: 1500000),
          (attendantId: 'somchai', method: 'qr', amountSatang: 500000),
          (attendantId: 'somchai', method: 'credit', amountSatang: 344673),
          (attendantId: 'somsri', method: 'cash', amountSatang: 324400),
        ],
        cashAlertSatang: 10000,
        names: {'somchai': 'สมชาย', 'somsri': 'สมศรี'},
      );
      expect(calc.expectedSatang, 2689073);
      expect(calc.soldMilli, 795500);
      expect(calc.attendant('somchai')!.diffSatang, -20000);
      expect(calc.attendant('somsri')!.diffSatang, 0);
      final short = calc.issues.firstWhere((i) => i.code == 'CASH_SHORT');
      expect(short.severity, Severity.warning);
      expect(short.message, 'สมชาย: เงินขาด 200.00 บาท');
    });

    test('ปลายกะน้อยกว่าต้นกะ → ข้อผิดพลาด, ติ๊กวนรอบ → คำนวณได้', () {
      final bad = computeShift([line('n', '1A', 999950000, 50000, 3000, 'a')], const [], cashAlertSatang: 10000, names: const {});
      expect(bad.hasErrors, isTrue);
      expect(bad.issues.first.code, 'CLOSE_LT_OPEN');
      final ok = computeShift([line('n', '1A', 999950000, 50000, 3000, 'a', rollover: true)], const [], cashAlertSatang: 10000, names: const {});
      expect(ok.line('n')!.meterMilli, 100000);
      expect(ok.issues.where((i) => i.severity == Severity.error), isEmpty);
    });

    test('ต้นกะไม่ตรงปลายกะก่อนหน้า → เตือน', () {
      final calc = computeShift([line('n', '1A', 1000000, 1100000, 3000, 'a', prev: 999000)], const [], cashAlertSatang: 10000, names: const {});
      expect(calc.issues.any((i) => i.code == 'OPEN_MISMATCH_PREV' && i.severity == Severity.warning), isTrue);
    });
  });
}
