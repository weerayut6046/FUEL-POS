/**
 * หน่วยตัวเลขของระบบ
 *
 *   เงิน   → สตางค์ เป็นจำนวนเต็ม (39.75 บาท = 3975)
 *   ลิตร   → ทศนิยม 3 ตำแหน่ง รับ-ส่งเป็นสตริง "1234.567" (ไม่ผ่าน float)
 *            คำนวณภายในเป็นจำนวนเต็มหน่วยมิลลิลิตร (1234.567 ลิตร = 1234567)
 *   ระดับถัง → มม. ทศนิยม 1 ตำแหน่ง คำนวณภายในเป็นหน่วย 0.1 มม. (125.5 มม. = 1255)
 *
 * เหตุผล: 0.1 + 0.2 !== 0.3 ในเลขทศนิยมลอยตัว ยอดจะคลาดเมื่อรวมกันทั้งเดือน
 */

const LITRES_RE = /^(-)?(\d{1,11})(?:\.(\d{1,3}))?$/;
const MM_RE = /^(\d{1,6})(?:\.(\d))?$/;

/** สตริงลิตร (หรือ NUMERIC จาก Postgres) → มิลลิลิตรจำนวนเต็ม */
export function litresToMilli(value: string): number {
  const m = LITRES_RE.exec(value.trim());
  if (!m) throw new RangeError(`รูปแบบลิตรไม่ถูกต้อง: ${value}`);
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(3, '0'));
  const milli = whole * 1000 + frac;
  return m[1] ? -milli : milli;
}

/** มิลลิลิตรจำนวนเต็ม → สตริงลิตร 3 ตำแหน่ง */
export function milliToLitres(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError(`ค่าไม่ใช่จำนวนเต็ม: ${milli}`);
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0');
  return `${sign}${whole}.${frac}`;
}

/** ค่า NUMERIC จาก Postgres (สตริงหรือ null) → มิลลิลิตร */
export function dbLitres(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return litresToMilli(value);
}

/** ปัดครึ่งขึ้น (ห่างจากศูนย์) สำหรับการหารจำนวนเต็ม */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('ตัวหารต้องมากกว่าศูนย์');
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs * 2 + denominator) / (denominator * 2));
}

/**
 * ยอดเงิน (สตางค์) = ลิตร × ราคา (สตางค์/ลิตร) ปัดเป็นสตางค์ครึ่งขึ้น
 * ตรงกับ round(litres * price) ของ Postgres ที่ใช้ในรายงาน
 */
export function amountSatang(litresMilli: number, priceSatang: number): number {
  return divRoundHalfUp(litresMilli * priceSatang, 1000);
}

/** สตริง มม. → หน่วย 0.1 มม. */
export function mmToDeci(value: string | number): number {
  const s = typeof value === 'number' ? String(value) : value.trim();
  const m = MM_RE.exec(s);
  if (!m) throw new RangeError(`รูปแบบระดับ (มม.) ไม่ถูกต้อง: ${value}`);
  return Number(m[1]) * 10 + Number(m[2] ?? '0');
}

/** หน่วย 0.1 มม. → สตริง มม. 1 ตำแหน่ง */
export function deciToMm(deci: number): string {
  return `${Math.floor(deci / 10)}.${deci % 10}`;
}

/** แสดงเงินแบบไทย เช่น 1,234.50 บาท (ใช้ในข้อความแจ้งเตือน) */
export function formatBaht(satang: number): string {
  const sign = satang < 0 ? '-' : '';
  const abs = Math.abs(satang);
  const baht = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${baht}.${String(abs % 100).padStart(2, '0')}`;
}

/** แสดงลิตรแบบมีคอมมา 2 ตำแหน่ง (ใช้ในข้อความแจ้งเตือน) */
export function formatLitresShort(milli: number): string {
  const tenths = divRoundHalfUp(milli, 10);
  const sign = tenths < 0 ? '-' : '';
  const abs = Math.abs(tenths);
  return `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

/** สตริงลิตรที่ API รับ (บวกเท่านั้น) */
export const LITRES_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;
/** สตริง มม. ที่ API รับ */
export const MM_PATTERN = /^\d{1,6}(\.\d)?$/;
