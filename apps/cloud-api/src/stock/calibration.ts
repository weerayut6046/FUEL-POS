import { unprocessable } from '../common/errors.js';
import { deciToMm, divRoundHalfUp, litresToMilli, milliToLitres, mmToDeci } from '../common/units.js';

/** จุดในตารางแปลงระดับ: ระดับเป็น 0.1 มม. ลิตรเป็นมิลลิลิตร */
export interface CalPoint {
  deciMm: number;
  milli: number;
}

export interface CalPointJson {
  mm: string;
  litres: string;
}

/** ตรวจและแปลงตารางที่ผู้ใช้ส่งมา — ระดับต้องเพิ่มขึ้นเรื่อย ๆ และลิตรต้องไม่ลดลง */
export function parseCalibration(points: { mm: string | number; litres: string }[]): CalPoint[] {
  if (points.length < 2) throw unprocessable('CALIBRATION_TOO_SHORT', 'ตารางแปลงต้องมีอย่างน้อย 2 แถว');
  const parsed = points.map((p) => ({ deciMm: mmToDeci(p.mm), milli: litresToMilli(p.litres) }));
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1]!;
    const cur = parsed[i]!;
    if (cur.deciMm <= prev.deciMm) {
      throw unprocessable('CALIBRATION_ORDER', `ระดับแถวที่ ${i + 1} ต้องมากกว่าแถวก่อนหน้า`, { row: i + 1 });
    }
    if (cur.milli < prev.milli) {
      throw unprocessable('CALIBRATION_ORDER', `ลิตรแถวที่ ${i + 1} ต้องไม่น้อยกว่าแถวก่อนหน้า`, { row: i + 1 });
    }
  }
  return parsed;
}

export function calibrationToJson(points: CalPoint[]): CalPointJson[] {
  return points.map((p) => ({ mm: deciToMm(p.deciMm), litres: milliToLitres(p.milli) }));
}

export function calibrationFromJson(points: CalPointJson[]): CalPoint[] {
  return points.map((p) => ({ deciMm: mmToDeci(p.mm), milli: litresToMilli(p.litres) }));
}

/**
 * แปลงระดับเป็นลิตรด้วยการเทียบบัญญัติไตรยางศ์ระหว่างสองจุดที่ใกล้ที่สุด (linear interpolation)
 * ระดับต่ำกว่าแถวแรกถือว่าเริ่มจาก (0 มม., 0 ลิตร) · สูงกว่าแถวสุดท้ายถือว่าผิด
 */
export function litresAtLevel(points: CalPoint[], deciMm: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw unprocessable('NO_CALIBRATION', 'ยังไม่มีตารางแปลงระดับเป็นลิตร');
  if (deciMm > last.deciMm) {
    throw unprocessable('LEVEL_ABOVE_TABLE', `ระดับ ${deciToMm(deciMm)} มม. สูงกว่าตารางแปลง (สูงสุด ${deciToMm(last.deciMm)} มม.)`);
  }
  const lower: CalPoint = deciMm < first.deciMm ? { deciMm: 0, milli: 0 } : first;
  let lo = lower;
  let hi = first;
  if (deciMm >= first.deciMm) {
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      if (p.deciMm >= deciMm) {
        lo = points[i - 1]!;
        hi = p;
        break;
      }
    }
    if (deciMm === first.deciMm) return first.milli;
  }
  if (hi.deciMm === lo.deciMm) return hi.milli;
  return lo.milli + divRoundHalfUp((hi.milli - lo.milli) * (deciMm - lo.deciMm), hi.deciMm - lo.deciMm);
}
