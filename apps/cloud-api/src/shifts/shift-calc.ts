/**
 * คำนวณกะ — ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล) ทดสอบง่าย และแอปมือถือใช้สูตรเดียวกันตอนออฟไลน์
 *
 *   ลิตรจากมิเตอร์ = ปลายกะ − ต้นกะ (ถ้ามิเตอร์วนรอบ: ค่ารอบ − ต้นกะ + ปลายกะ)
 *   ลิตรขาย       = ลิตรจากมิเตอร์ − น้ำมันทดสอบที่เทกลับถัง
 *   ยอดที่ควรได้   = ลิตรขาย × ราคาที่ตรึงไว้ตอนเปิดกะ (ปัดเป็นสตางค์ครึ่งขึ้น ต่อหัวจ่าย)
 *   เงินขาด/เกิน   = เงินที่ส่งจริงทุกช่องทาง − ยอดที่ควรได้ (คิดรายพนักงานตามหัวจ่ายที่รับผิดชอบ)
 */

import { amountSatang, formatBaht, formatLitresShort, milliToLitres } from '../common/units.js';

export const PAYMENT_METHODS = ['cash', 'qr', 'card', 'coupon', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  qr: 'QR',
  card: 'บัตร',
  coupon: 'คูปอง',
  credit: 'เงินเชื่อ',
};

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  nozzleId?: string;
  attendantId?: string | null;
}

export interface LineInput {
  nozzleId: string;
  nozzleCode: string;
  fuelTypeId: string;
  tankId: string;
  priceSatang: number;
  attendantId: string | null;
  modulusMilli: number;
  openMilli: number | null;
  closeMilli: number | null;
  rollover: boolean;
  testMilli: number;
  openHasPhoto: boolean;
  closeHasPhoto: boolean;
  /** ปลายกะของกะก่อนหน้า (หัวจ่ายเดียวกัน) */
  prevCloseMilli: number | null;
  /** ต้นกะของกะถัดไป (ถ้ามีแล้ว) */
  nextOpenMilli: number | null;
}

export interface CollectionInput {
  attendantId: string;
  method: PaymentMethod;
  amountSatang: number;
}

export interface CalcOptions {
  cashAlertSatang: number;
  attendantNames: Map<string, string>;
  fuelNames: Map<string, string>;
  /** ราคาที่ประกาศใหม่ระหว่างกะ */
  priceChanges: { fuelTypeId: string; priceSatang: number }[];
}

export interface LineResult {
  nozzleId: string;
  meterMilli: number | null;
  testMilli: number;
  soldMilli: number | null;
  amountSatang: number;
}

export interface AttendantResult {
  attendantId: string | null;
  expectedSatang: number;
  collected: Record<PaymentMethod, number>;
  collectedSatang: number;
  diffSatang: number;
  soldMilli: number;
}

export interface FuelResult {
  fuelTypeId: string;
  soldMilli: number;
  amountSatang: number;
}

export interface ShiftCalc {
  lines: LineResult[];
  byFuel: FuelResult[];
  byAttendant: AttendantResult[];
  totals: { soldMilli: number; expectedSatang: number; collectedSatang: number; diffSatang: number };
  issues: Issue[];
}

export function meterLitres(line: Pick<LineInput, 'openMilli' | 'closeMilli' | 'rollover' | 'modulusMilli'>): number | null {
  if (line.openMilli === null || line.closeMilli === null) return null;
  if (line.rollover) return line.modulusMilli - line.openMilli + line.closeMilli;
  return line.closeMilli - line.openMilli;
}

const emptyMethods = (): Record<PaymentMethod, number> => ({ cash: 0, qr: 0, card: 0, coupon: 0, credit: 0 });

export function computeShift(lines: LineInput[], collections: CollectionInput[], opts: CalcOptions): ShiftCalc {
  const issues: Issue[] = [];
  const results: LineResult[] = [];
  const byFuel = new Map<string, FuelResult>();
  const byAtt = new Map<string | null, AttendantResult>();
  const att = (id: string | null): AttendantResult => {
    let r = byAtt.get(id);
    if (!r) {
      r = { attendantId: id, expectedSatang: 0, collected: emptyMethods(), collectedSatang: 0, diffSatang: 0, soldMilli: 0 };
      byAtt.set(id, r);
    }
    return r;
  };
  const name = (id: string | null) => (id ? opts.attendantNames.get(id) ?? 'ไม่ทราบชื่อ' : 'ไม่ระบุพนักงาน');

  for (const line of lines) {
    const n = line.nozzleCode;
    const meter = meterLitres(line);
    if (line.openMilli === null) {
      issues.push({ code: 'MISSING_OPEN', severity: 'error', message: `หัวจ่าย ${n}: ยังไม่ได้จดมิเตอร์ต้นกะ`, nozzleId: line.nozzleId });
    }
    if (line.closeMilli === null) {
      issues.push({ code: 'MISSING_CLOSE', severity: 'error', message: `หัวจ่าย ${n}: ยังไม่ได้จดมิเตอร์ปลายกะ`, nozzleId: line.nozzleId });
    }
    if (line.openMilli !== null && line.prevCloseMilli !== null && line.openMilli !== line.prevCloseMilli) {
      issues.push({
        code: 'OPEN_MISMATCH_PREV',
        severity: 'warning',
        message: `หัวจ่าย ${n}: มิเตอร์ต้นกะ ${milliToLitres(line.openMilli)} ไม่ตรงกับปลายกะก่อนหน้า ${milliToLitres(line.prevCloseMilli)} (ต่างกัน ${formatLitresShort(line.openMilli - line.prevCloseMilli)} ลิตร)`,
        nozzleId: line.nozzleId,
      });
    }
    if (line.closeMilli !== null && line.nextOpenMilli !== null && line.closeMilli !== line.nextOpenMilli) {
      issues.push({
        code: 'CLOSE_MISMATCH_NEXT',
        severity: 'warning',
        message: `หัวจ่าย ${n}: มิเตอร์ปลายกะ ${milliToLitres(line.closeMilli)} ไม่ตรงกับต้นกะถัดไป ${milliToLitres(line.nextOpenMilli)}`,
        nozzleId: line.nozzleId,
      });
    }
    if (line.openMilli !== null && line.closeMilli !== null) {
      if (!line.rollover && line.closeMilli < line.openMilli) {
        issues.push({
          code: 'CLOSE_LT_OPEN',
          severity: 'error',
          message: `หัวจ่าย ${n}: มิเตอร์ปลายกะน้อยกว่าต้นกะ — ตรวจตัวเลขอีกครั้ง หรือติ๊ก "มิเตอร์วนรอบ" ถ้ามิเตอร์ครบรอบกลับไปเริ่มที่ 0`,
          nozzleId: line.nozzleId,
        });
      }
      if (line.rollover && meter !== null && meter > line.modulusMilli / 2) {
        issues.push({
          code: 'ROLLOVER_SUSPICIOUS',
          severity: 'warning',
          message: `หัวจ่าย ${n}: ติ๊กมิเตอร์วนรอบแต่ได้ยอด ${formatLitresShort(meter)} ลิตร ซึ่งสูงผิดปกติ`,
          nozzleId: line.nozzleId,
        });
      }
      if (line.rollover && line.closeMilli >= line.openMilli) {
        issues.push({
          code: 'ROLLOVER_NOT_NEEDED',
          severity: 'error',
          message: `หัวจ่าย ${n}: ติ๊กมิเตอร์วนรอบ แต่ปลายกะไม่ได้น้อยกว่าต้นกะ`,
          nozzleId: line.nozzleId,
        });
      }
    }
    if (line.openMilli !== null && !line.openHasPhoto) {
      issues.push({ code: 'MISSING_PHOTO', severity: 'warning', message: `หัวจ่าย ${n}: ไม่มีรูปมิเตอร์ต้นกะ`, nozzleId: line.nozzleId });
    }
    if (line.closeMilli !== null && !line.closeHasPhoto) {
      issues.push({ code: 'MISSING_PHOTO', severity: 'warning', message: `หัวจ่าย ${n}: ไม่มีรูปมิเตอร์ปลายกะ`, nozzleId: line.nozzleId });
    }
    if (meter !== null && line.testMilli > Math.max(meter, 0)) {
      issues.push({
        code: 'TEST_EXCEEDS_METER',
        severity: 'error',
        message: `หัวจ่าย ${n}: น้ำมันทดสอบ ${formatLitresShort(line.testMilli)} ลิตร มากกว่ายอดมิเตอร์`,
        nozzleId: line.nozzleId,
      });
    }

    const sold = meter === null ? null : meter - line.testMilli;
    const amount = sold === null ? 0 : amountSatang(sold, line.priceSatang);
    results.push({ nozzleId: line.nozzleId, meterMilli: meter, testMilli: line.testMilli, soldMilli: sold, amountSatang: amount });

    if (sold !== null) {
      const f = byFuel.get(line.fuelTypeId) ?? { fuelTypeId: line.fuelTypeId, soldMilli: 0, amountSatang: 0 };
      f.soldMilli += sold;
      f.amountSatang += amount;
      byFuel.set(line.fuelTypeId, f);
      const a = att(line.attendantId);
      a.expectedSatang += amount;
      a.soldMilli += sold;
    }
  }

  for (const c of collections) {
    const a = att(c.attendantId);
    a.collected[c.method] += c.amountSatang;
    a.collectedSatang += c.amountSatang;
  }

  const totals = { soldMilli: 0, expectedSatang: 0, collectedSatang: 0, diffSatang: 0 };
  for (const a of byAtt.values()) {
    a.diffSatang = a.collectedSatang - a.expectedSatang;
    totals.soldMilli += a.soldMilli;
    totals.expectedSatang += a.expectedSatang;
    totals.collectedSatang += a.collectedSatang;
    if (a.expectedSatang > 0 && a.collectedSatang === 0) {
      issues.push({
        code: 'NO_COLLECTIONS',
        severity: 'warning',
        message: `${name(a.attendantId)}: ยังไม่ได้บันทึกเงินที่ส่ง (ยอดที่ควรได้ ${formatBaht(a.expectedSatang)} บาท)`,
        attendantId: a.attendantId,
      });
    } else if (a.diffSatang !== 0) {
      const big = Math.abs(a.diffSatang) >= opts.cashAlertSatang;
      issues.push({
        code: a.diffSatang < 0 ? 'CASH_SHORT' : 'CASH_OVER',
        severity: big ? 'warning' : 'info',
        message: `${name(a.attendantId)}: เงิน${a.diffSatang < 0 ? 'ขาด' : 'เกิน'} ${formatBaht(Math.abs(a.diffSatang))} บาท`,
        attendantId: a.attendantId,
      });
    }
  }
  totals.diffSatang = totals.collectedSatang - totals.expectedSatang;

  for (const pc of opts.priceChanges) {
    issues.push({
      code: 'PRICE_CHANGED',
      severity: 'warning',
      message: `${opts.fuelNames.get(pc.fuelTypeId) ?? 'น้ำมัน'}: มีการเปลี่ยนราคาเป็น ${formatBaht(pc.priceSatang)} บาท/ลิตร ระหว่างกะ — กะนี้ยังคิดราคาเดิม ควรปิดกะ ณ เวลาเปลี่ยนราคา`,
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    lines: results,
    byFuel: [...byFuel.values()],
    byAttendant: [...byAtt.values()],
    totals,
    issues,
  };
}
