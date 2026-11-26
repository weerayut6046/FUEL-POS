/**
 * เทียบยอดน้ำมันตามบัญชีกับยอดวัดจริง (ฟังก์ชันล้วน)
 *
 * วัดถังวันละครั้งหลังปิดกะสุดท้ายของวัน ระหว่างการวัดสองครั้ง:
 *   ยอดตามบัญชี = วัดครั้งก่อน + รับน้ำมัน − ขาย (จากมิเตอร์หัวจ่ายที่ดูดจากถังนี้)
 *   ขาด/เกิน    = วัดจริง − ยอดตามบัญชี   (ติดลบ = น้ำมันหาย)
 */

import { divRoundHalfUp } from '../common/units.js';

export interface DipPoint {
  date: string;
  milli: number;
}

export interface DayFlow {
  deliveriesMilli: number;
  salesMilli: number;
}

export interface ReconRow {
  date: string;
  prevDate: string;
  openingMilli: number;
  deliveriesMilli: number;
  salesMilli: number;
  bookMilli: number;
  actualMilli: number;
  varianceMilli: number;
  /** ขาด/เกินเทียบยอดขาย (%) ทศนิยม 2 ตำแหน่ง — null ถ้าไม่มียอดขาย */
  variancePercent: string | null;
}

/** ร้อยละแบบจำนวนเต็ม → สตริงทศนิยม 2 ตำแหน่ง */
export function percentString(part: number, whole: number): string | null {
  if (whole === 0) return null;
  const hundredths = divRoundHalfUp(part * 10000, Math.abs(whole));
  const sign = hundredths < 0 ? '-' : '';
  const abs = Math.abs(hundredths);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function reconcile(dips: DipPoint[], flows: Map<string, DayFlow>, from: string, to: string): ReconRow[] {
  const sorted = [...dips].sort((a, b) => a.date.localeCompare(b.date));
  const rows: ReconRow[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.date < from || cur.date > to) continue;
    let deliveries = 0;
    let sales = 0;
    for (const [date, f] of flows) {
      if (date > prev.date && date <= cur.date) {
        deliveries += f.deliveriesMilli;
        sales += f.salesMilli;
      }
    }
    const book = prev.milli + deliveries - sales;
    const variance = cur.milli - book;
    rows.push({
      date: cur.date,
      prevDate: prev.date,
      openingMilli: prev.milli,
      deliveriesMilli: deliveries,
      salesMilli: sales,
      bookMilli: book,
      actualMilli: cur.milli,
      varianceMilli: variance,
      variancePercent: percentString(variance, sales),
    });
  }
  return rows;
}

/** ยอดคงเหลือตามบัญชี ณ ปัจจุบัน = วัดล่าสุด + รับหลังจากนั้น − ขายหลังจากนั้น */
export function bookStock(lastDip: DipPoint | null, flows: Map<string, DayFlow>): number | null {
  if (!lastDip) return null;
  let milli = lastDip.milli;
  for (const [date, f] of flows) {
    if (date > lastDip.date) milli += f.deliveriesMilli - f.salesMilli;
  }
  return milli;
}
