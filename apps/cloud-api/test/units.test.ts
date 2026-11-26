import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { amountSatang, divRoundHalfUp, formatBaht, litresToMilli, milliToLitres, mmToDeci } from '../src/common/units.js';
import { litresAtLevel, parseCalibration } from '../src/stock/calibration.js';
import { bookStock, percentString, reconcile } from '../src/stock/reconciliation.js';
import { computeShift, LineInput } from '../src/shifts/shift-calc.js';

describe('หน่วยตัวเลข', () => {
  test('ลิตร: สตริง ↔ มิลลิลิตร ไม่ผ่าน float', () => {
    assert.equal(litresToMilli('1234.567'), 1234567);
    assert.equal(litresToMilli('0.1'), 100);
    assert.equal(litresToMilli('12'), 12000);
    assert.equal(litresToMilli('-1.5'), -1500);
    assert.equal(milliToLitres(1234567), '1234.567');
    assert.equal(milliToLitres(5), '0.005');
    assert.equal(milliToLitres(-1500), '-1.500');
    assert.throws(() => litresToMilli('1.2345'));
    assert.throws(() => litresToMilli('abc'));
  });

  test('0.1 + 0.2 ลิตร = 0.3 พอดี', () => {
    assert.equal(milliToLitres(litresToMilli('0.1') + litresToMilli('0.2')), '0.300');
  });

  test('ยอดเงินปัดครึ่งขึ้นเป็นสตางค์', () => {
    // 123.456 ลิตร × 32.45 บาท = 4,006.14720 บาท → 400615 สตางค์
    assert.equal(amountSatang(123456, 3245), 400615);
    // 1.5 สตางค์ปัดขึ้น
    assert.equal(divRoundHalfUp(15, 10), 2);
    assert.equal(divRoundHalfUp(14, 10), 1);
    assert.equal(divRoundHalfUp(-15, 10), -2);
    assert.equal(formatBaht(123456), '1,234.56');
    assert.equal(formatBaht(-5), '-0.05');
  });

  test('ระดับ มม. ทศนิยม 1 ตำแหน่ง', () => {
    assert.equal(mmToDeci('125.5'), 1255);
    assert.equal(mmToDeci(80), 800);
    assert.throws(() => mmToDeci('1.25'));
  });
});

describe('ตารางแปลงระดับเป็นลิตร', () => {
  const points = parseCalibration([
    { mm: '0', litres: '0' },
    { mm: '100', litres: '500' },
    { mm: '200', litres: '1200' },
  ]);

  test('ตรงจุดในตาราง', () => {
    assert.equal(litresAtLevel(points, mmToDeci('100')), 500_000);
    assert.equal(litresAtLevel(points, mmToDeci('200')), 1_200_000);
  });

  test('เทียบระหว่างจุด (linear)', () => {
    assert.equal(litresAtLevel(points, mmToDeci('150')), 850_000);
    assert.equal(litresAtLevel(points, mmToDeci('100.5')), 503_500);
  });

  test('สูงกว่าตารางถือว่าผิด', () => {
    assert.throws(() => litresAtLevel(points, mmToDeci('200.1')), /สูงกว่าตารางแปลง/);
  });

  test('ตารางต้องเรียงจากน้อยไปมาก', () => {
    assert.throws(() =>
      parseCalibration([
        { mm: '100', litres: '500' },
        { mm: '50', litres: '600' },
      ]),
    );
  });
});

const line = (over: Partial<LineInput>): LineInput => ({
  nozzleId: 'n1',
  nozzleCode: '1A',
  fuelTypeId: 'f1',
  tankId: 't1',
  priceSatang: 3000,
  attendantId: 'a1',
  modulusMilli: 1_000_000_000,
  openMilli: 1_000_000,
  closeMilli: 1_100_000,
  rollover: false,
  testMilli: 0,
  openHasPhoto: true,
  closeHasPhoto: true,
  prevCloseMilli: null,
  nextOpenMilli: null,
  ...over,
});

const opts = { cashAlertSatang: 10_000, attendantNames: new Map([['a1', 'สมชาย']]), fuelNames: new Map(), priceChanges: [] };

describe('คำนวณกะ', () => {
  test('ลิตร ยอดเงิน และเงินขาด', () => {
    const calc = computeShift([line({})], [{ attendantId: 'a1', method: 'cash', amountSatang: 299_000 }], opts);
    assert.equal(calc.lines[0]!.soldMilli, 100_000);
    assert.equal(calc.totals.expectedSatang, 300_000);
    assert.equal(calc.totals.diffSatang, -1_000);
    const short = calc.issues.find((i) => i.code === 'CASH_SHORT');
    assert.equal(short?.severity, 'info', 'ขาด 10 บาท ต่ำกว่าเกณฑ์ 100 บาท');
  });

  test('มิเตอร์ปลายกะน้อยกว่าต้นกะ = ข้อผิดพลาด', () => {
    const calc = computeShift([line({ closeMilli: 900_000 })], [], opts);
    assert.ok(calc.issues.some((i) => i.code === 'CLOSE_LT_OPEN' && i.severity === 'error'));
  });

  test('มิเตอร์วนรอบ', () => {
    const calc = computeShift(
      [line({ modulusMilli: 1_000_000_000, openMilli: 999_950_000, closeMilli: 50_000, rollover: true })],
      [],
      opts,
    );
    assert.equal(calc.lines[0]!.meterMilli, 100_000);
    assert.ok(!calc.issues.some((i) => i.severity === 'error'));
  });

  test('ต้นกะไม่ตรงกับปลายกะก่อนหน้า = เตือน', () => {
    const calc = computeShift([line({ prevCloseMilli: 999_000 })], [], opts);
    assert.ok(calc.issues.some((i) => i.code === 'OPEN_MISMATCH_PREV' && i.severity === 'warning'));
  });

  test('หักน้ำมันทดสอบออกจากยอดขาย', () => {
    const calc = computeShift([line({ testMilli: 5_000 })], [], opts);
    assert.equal(calc.lines[0]!.soldMilli, 95_000);
    assert.equal(calc.totals.expectedSatang, 285_000);
  });
});

describe('เทียบยอดถัง', () => {
  test('ยอดตามบัญชี vs วัดจริง', () => {
    const dips = [
      { date: '2026-11-01', milli: 10_000_000 },
      { date: '2026-11-02', milli: 14_950_000 },
    ];
    const flows = new Map([['2026-11-02', { deliveriesMilli: 8_000_000, salesMilli: 3_000_000 }]]);
    const [row] = reconcile(dips, flows, '2026-11-01', '2026-11-30');
    assert.equal(row!.bookMilli, 15_000_000);
    assert.equal(row!.varianceMilli, -50_000);
    assert.equal(row!.variancePercent, '-1.67');
    assert.equal(bookStock(dips[1]!, new Map([['2026-11-03', { deliveriesMilli: 0, salesMilli: 1_000_000 }]])), 13_950_000);
    assert.equal(percentString(1, 3), '33.33');
  });
});
