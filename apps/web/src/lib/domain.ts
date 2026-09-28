/**
 * กฎทางธุรกิจทั้งหมดเป็นฟังก์ชันบริสุทธิ์ (pure) — ไม่แตะ state/UI
 * ทำให้ทดสอบได้ง่าย และย้ายไปรันฝั่งเซิร์ฟเวอร์ได้ทันทีเมื่อต่อฐานข้อมูลจริง
 */
import type {
  Delivery,
  MeterReading,
  Nozzle,
  PaymentMethod,
  Product,
  Promotion,
  Role,
  Sale,
  Shift,
  ShiftSummary,
  TankDip,
  TankRecon,
  NozzleRecon,
} from './types';
import { calcAmount, calcVolume } from './units';

// ---------------------------------------------------------------------------
// มิเตอร์หน้าตู้
// ---------------------------------------------------------------------------

/**
 * มิเตอร์สะสมหน้าตู้วนกลับเป็นศูนย์เมื่อเต็มหลัก
 *  - จอ L แสดง 8 หลัก ทศนิยม 2 ตำแหน่ง → สูงสุด 999,999.99 ลิตร  = 1e9 ml
 *  - จอ P แสดง 8 หลัก ทศนิยม 1 ตำแหน่ง → สูงสุด 9,999,999.9 บาท = 1e9 สตางค์
 * ทั้งสองจอจึงวนที่ 1e9 ในหน่วยจำนวนเต็มของระบบพอดี
 */
export const METER_MODULUS = 1_000_000_000;

export function meterDiff(open: number, close: number, modulus = METER_MODULUS): number {
  const d = close - open;
  return d >= 0 ? d : d + modulus;
}

/** จอหน้าตู้แสดงเป็น 2 บรรทัด: บรรทัดบน 2 หลักสูง + บรรทัดล่าง 6 หลัก (ตามรูปจอจริง) */
export function splitMeterDisplay(value: number, decimals: number): { top: string; bottom: string } {
  const scaled = decimals === 2 ? value / 1000 : value / 100; // ml→ลิตร หรือ สตางค์→บาท
  const text = scaled.toFixed(decimals);
  const [intPart, dec] = text.split('.');
  const padded = intPart.padStart(decimals === 2 ? 6 : 7, '0');
  const topLen = padded.length - (decimals === 2 ? 4 : 5);
  return {
    top: padded.slice(0, topLen).replace(/^0+(?=\d)/, ''),
    bottom: `${padded.slice(topLen)}.${dec}`,
  };
}

// ---------------------------------------------------------------------------
// ภาษีมูลค่าเพิ่ม (ราคาน้ำมันหน้าตู้รวม VAT แล้ว)
// ---------------------------------------------------------------------------

export function vatSplit(net: number, ratePct: number): { vat: number; beforeVat: number } {
  if (ratePct <= 0) return { vat: 0, beforeVat: net };
  const vat = Math.round((net * ratePct) / (100 + ratePct));
  return { vat, beforeVat: net - vat };
}

// ---------------------------------------------------------------------------
// โปรโมชั่นและแต้มสะสม
// ---------------------------------------------------------------------------

export function isPromotionApplicable(
  p: Promotion,
  ctx: { month: string; productId: string; gross: number; isMember: boolean },
): boolean {
  if (!p.active || p.month !== ctx.month) return false;
  if (p.productIds.length > 0 && !p.productIds.includes(ctx.productId)) return false;
  if (ctx.gross < p.minAmount) return false;
  if (p.membersOnly && !ctx.isMember) return false;
  return true;
}

export function promotionDiscount(p: Promotion, gross: number, volume: number): number {
  if (p.type === 'discount_per_liter') return Math.min(gross, Math.round((volume * p.value) / 1000));
  if (p.type === 'percent_discount') return Math.min(gross, Math.round((gross * p.value) / 100));
  return 0;
}

export interface PriceInput {
  product: Product;
  mode: 'amount' | 'volume';
  /** สตางค์ (mode=amount) หรือ ml (mode=volume) */
  value: number;
  isMember: boolean;
  promotions: Promotion[];
  month: string;
  vatRate: number;
  bahtPerPoint: number;
}

export interface PriceResult {
  volume: number;
  gross: number;
  discount: number;
  net: number;
  vat: number;
  beforeVat: number;
  points: number;
  applied: Promotion[];
}

/**
 * คำนวณบิลขายน้ำมัน 1 รายการ
 *  - โปรส่วนลด: ใช้ตัวที่ลดได้มากที่สุดตัวเดียว (ไม่ซ้อนกัน)
 *  - โปรแต้ม: ใช้ตัวคูณสูงสุด 1 ตัว + แต้มโบนัสทุกตัวที่เข้าเงื่อนไข
 *  - แต้มคิดจากยอดสุทธิหลังหักส่วนลด ปัดลง
 */
export function priceSale(input: PriceInput): PriceResult {
  const { product, mode, value } = input;
  const volume = mode === 'volume' ? value : calcVolume(value, product.price);
  const gross = mode === 'amount' ? value : calcAmount(value, product.price);

  const ctx = { month: input.month, productId: product.id, gross, isMember: input.isMember };
  const eligible = input.promotions.filter((p) => isPromotionApplicable(p, ctx));

  let bestDiscount: Promotion | null = null;
  let discount = 0;
  for (const p of eligible) {
    const d = promotionDiscount(p, gross, volume);
    if (d > discount) {
      discount = d;
      bestDiscount = p;
    }
  }
  const net = gross - discount;

  let points = 0;
  const applied: Promotion[] = bestDiscount ? [bestDiscount] : [];
  if (input.isMember && input.bahtPerPoint > 0) {
    const base = Math.floor(net / (input.bahtPerPoint * 100));
    const multipliers = eligible.filter((p) => p.type === 'points_multiplier');
    const best = multipliers.reduce<Promotion | null>((a, p) => (!a || p.value > a.value ? p : a), null);
    points = best ? Math.floor(base * best.value) : base;
    if (best) applied.push(best);
    for (const p of eligible.filter((p) => p.type === 'bonus_points')) {
      points += p.value;
      applied.push(p);
    }
  }

  const { vat, beforeVat } = vatSplit(net, input.vatRate);
  return { volume, gross, discount, net, vat, beforeVat, points, applied };
}

// ---------------------------------------------------------------------------
// กระทบยอดปิดกะ
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  shift: Shift;
  closeReadings: Record<string, MeterReading>;
  dips: TankDip[];
  countedCash: number;
  sales: Sale[]; // เฉพาะของกะนี้
  deliveries: Delivery[]; // เฉพาะที่รับระหว่างกะ
  nozzles: Nozzle[];
  products: Product[];
  tankIds: string[];
  tolerancePct: number;
}

export const emptyByMethod = (): Record<PaymentMethod, number> => ({
  cash: 0,
  qr: 0,
  card: 0,
  transfer: 0,
  credit: 0,
});

/**
 * หลักการ:
 *  1) ยอดขายจริง = ส่วนต่างมิเตอร์หน้าตู้ (ปิด − เปิด) ทั้งลิตรและบาท
 *  2) เทียบกับรายการที่คีย์ในระบบ → ส่วนต่าง = จ่ายน้ำมันแต่ไม่ได้คีย์บิล
 *  3) เงินสดที่ต้องส่ง = เงินทอนตั้งต้น + ยอดตามมิเตอร์ − ยอดที่ไม่ใช่เงินสด − ส่วนลด
 *  4) สต๊อกถังตามบัญชี = ต้นกะ + รับเข้า − ลิตรตามมิเตอร์ของหัวจ่ายที่ผูกกับถัง
 *     เทียบกับวัดจริง (dip) ถ้ามี
 */
export function reconcileShift(input: ReconcileInput): ShiftSummary {
  const paid = input.sales.filter((s) => s.status === 'paid');
  const productById = new Map(input.products.map((p) => [p.id, p]));

  const nozzles: NozzleRecon[] = input.nozzles.map((n) => {
    const open = input.shift.openReadings[n.id] ?? { volume: 0, amount: 0 };
    const close = input.closeReadings[n.id] ?? open;
    const meterVolume = meterDiff(open.volume, close.volume);
    const meterAmount = meterDiff(open.amount, close.amount);
    const mine = paid.filter((s) => s.nozzleId === n.id);
    const posVolume = mine.reduce((a, s) => a + s.volume, 0);
    const posGross = mine.reduce((a, s) => a + s.gross, 0);
    const unitPrice = productById.get(n.productId)?.price ?? 0;
    return {
      nozzleId: n.id,
      open,
      close,
      meterVolume,
      meterAmount,
      posVolume,
      posGross,
      varVolume: meterVolume - posVolume,
      varAmount: meterAmount - posGross,
      priceCheck: calcAmount(meterVolume, unitPrice),
    };
  });

  const tanks: TankRecon[] = input.tankIds.map((tankId) => {
    const opening = input.shift.tankLevelsAtOpen[tankId] ?? 0;
    const deliveries = input.deliveries.filter((d) => d.tankId === tankId).reduce((a, d) => a + d.volume, 0);
    const meterOut = nozzles
      .filter((r) => input.nozzles.find((n) => n.id === r.nozzleId)?.tankId === tankId)
      .reduce((a, r) => a + r.meterVolume, 0);
    const expected = opening + deliveries - meterOut;
    const dipEntry = input.dips.find((d) => d.tankId === tankId);
    const dip = dipEntry ? dipEntry.measured : null;
    const variance = dip === null ? null : dip - expected;
    const variancePct = variance === null ? null : meterOut > 0 ? (variance / meterOut) * 100 : 0;
    const withinTolerance =
      variancePct === null ? null : Math.abs(variancePct) <= input.tolerancePct || Math.abs(variance ?? 0) <= 1000;
    return { tankId, opening, deliveries, meterOut, expected, dip, variance, variancePct, withinTolerance };
  });

  const byMethod = emptyByMethod();
  for (const s of paid) byMethod[s.method] += s.net;
  const discount = paid.reduce((a, s) => a + s.discount, 0);
  const posGross = paid.reduce((a, s) => a + s.gross, 0);
  const posNet = paid.reduce((a, s) => a + s.net, 0);
  const meterAmount = nozzles.reduce((a, r) => a + r.meterAmount, 0);
  const meterVolume = nozzles.reduce((a, r) => a + r.meterVolume, 0);
  const nonCash = posNet - byMethod.cash;
  const expectedCash = input.shift.openingCash + meterAmount - nonCash - discount;

  return {
    nozzles,
    tanks,
    meterAmount,
    meterVolume,
    posGross,
    posNet,
    discount,
    byMethod,
    saleCount: paid.length,
    expectedCash,
    countedCash: input.countedCash,
    cashDiff: input.countedCash - expectedCash,
  };
}

// ---------------------------------------------------------------------------
// สิทธิ์การใช้งาน
// ---------------------------------------------------------------------------

export type Permission =
  | 'pos'
  | 'shift'
  | 'members'
  | 'rewards'
  | 'invoice'
  | 'stock'
  | 'stock.receive'
  | 'promotions'
  | 'employees'
  | 'settings'
  | 'reports'
  | 'void';

const ROLE_PERMS: Record<Role, Permission[]> = {
  owner: ['pos', 'shift', 'members', 'rewards', 'invoice', 'stock', 'stock.receive', 'promotions', 'employees', 'settings', 'reports', 'void'],
  manager: ['pos', 'shift', 'members', 'rewards', 'invoice', 'stock', 'stock.receive', 'promotions', 'employees', 'reports', 'void'],
  cashier: ['pos', 'shift', 'members', 'rewards', 'invoice', 'stock'],
  attendant: ['pos', 'members'],
};

export const can = (role: Role | undefined, perm: Permission): boolean =>
  !!role && ROLE_PERMS[role].includes(perm);

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'เจ้าของ',
  manager: 'ผู้จัดการ',
  cashier: 'แคชเชียร์',
  attendant: 'พนักงานหน้าลาน',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  qr: 'QR พร้อมเพย์',
  card: 'บัตรเครดิต/เดบิต',
  transfer: 'โอนเงิน',
  credit: 'ลูกหนี้/เครดิต',
};

export const PROMO_LABEL: Record<Promotion['type'], string> = {
  discount_per_liter: 'ลดต่อลิตร',
  percent_discount: 'ลด %',
  points_multiplier: 'คูณแต้ม',
  bonus_points: 'แต้มพิเศษ',
};

/** ชั่วโมงทำงาน (ms) ของรายการลงเวลา — ยังไม่ออกงานนับถึงตอนนี้ */
export const workedMs = (clockIn: string, clockOut: string | null, now = Date.now()) =>
  Math.max(0, (clockOut ? new Date(clockOut).getTime() : now) - new Date(clockIn).getTime());
