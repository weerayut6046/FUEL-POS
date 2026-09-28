/**
 * โดเมนของ FUEL-POS Cloud
 *
 * หน่วยตัวเลขทั้งระบบเป็นจำนวนเต็ม (เหมือน apps/server):
 *  - เงิน           → สตางค์          40.59 บาท = 4059
 *  - ปริมาตร        → มิลลิลิตร        12.34 ลิตร = 12340
 *  - ราคาต่อลิตร    → สตางค์/ลิตร
 *  - มิเตอร์ L       → มิลลิลิตร        405,117.80 ลิตร = 405117800
 *  - มิเตอร์ P       → สตางค์          8,790,824.6 บาท = 879082460
 */

export type ID = string;

export type Role = 'owner' | 'manager' | 'cashier' | 'attendant';

export type PaymentMethod = 'cash' | 'qr' | 'card' | 'transfer' | 'credit';

export interface Station {
  name: string;
  branch: string; // "สำนักงานใหญ่" หรือ "สาขาที่ 00001"
  taxId: string;
  address: string;
  phone: string;
  vatRate: number; // เปอร์เซ็นต์ เช่น 7
  vatRegistered: boolean;
  /** ใช้จ่ายกี่บาทได้ 1 แต้ม */
  bahtPerPoint: number;
  receiptFooter: string;
  /** ค่าคลาดเคลื่อนที่ยอมรับได้ของสต๊อกถัง (% ของยอดขายในกะ) */
  stockTolerancePct: number;
}

export interface Product {
  id: ID;
  code: string;
  name: string;
  shortName: string;
  color: string; // hex
  price: number; // สตางค์/ลิตร
}

export interface Tank {
  id: ID;
  no: number;
  name: string;
  productId: ID;
  capacity: number; // ml
  level: number; // ml (สต๊อกตามบัญชี)
  lowPct: number; // แจ้งเตือนเมื่อต่ำกว่า %
}

export interface Dispenser {
  id: ID;
  no: number;
  name: string;
}

export interface Nozzle {
  id: ID;
  dispenserId: ID;
  /** ฝั่งของจอตู้จ่าย: ซ้าย/ขวา (ตามจอมิเตอร์หน้าตู้) */
  side: 'L' | 'R';
  label: string;
  productId: ID;
  tankId: ID;
}

/** ค่ามิเตอร์สะสมหน้าตู้ ต่อ 1 หัวจ่าย — L = ลิตร, P = บาท */
export interface MeterReading {
  volume: number; // ml  (จอโหมด L)
  amount: number; // สตางค์ (จอโหมด P)
}

export interface Employee {
  id: ID;
  code: string;
  name: string;
  nickname: string;
  role: Role;
  pin: string;
  phone: string;
  active: boolean;
  createdAt: string;
}

export interface TimeEntry {
  id: ID;
  employeeId: ID;
  clockIn: string;
  clockOut: string | null;
}

export interface Member {
  id: ID;
  code: string;
  name: string;
  phone: string;
  plate: string;
  points: number;
  totalSpent: number; // สตางค์
  taxId: string;
  address: string;
  joinedAt: string;
}

export interface Reward {
  id: ID;
  name: string;
  emoji: string;
  points: number;
  stock: number;
  active: boolean;
}

export interface Redemption {
  id: ID;
  memberId: ID;
  rewardId: ID;
  points: number;
  at: string;
  byEmployeeId: ID | null;
}

export type PromotionType =
  | 'discount_per_liter' // ลดราคาต่อลิตร (value = สตางค์/ลิตร)
  | 'percent_discount' // ลดเป็นเปอร์เซ็นต์ (value = %)
  | 'points_multiplier' // คูณแต้ม (value = เท่า)
  | 'bonus_points'; // แต้มพิเศษต่อบิล (value = แต้ม)

export interface Promotion {
  id: ID;
  name: string;
  description: string;
  month: string; // YYYY-MM
  type: PromotionType;
  value: number;
  productIds: ID[]; // ว่าง = ทุกผลิตภัณฑ์
  minAmount: number; // สตางค์
  membersOnly: boolean;
  active: boolean;
}

export interface Sale {
  id: ID;
  docNo: string;
  shiftId: ID;
  nozzleId: ID;
  dispenserId: ID;
  productId: ID;
  tankId: ID;
  volume: number; // ml
  unitPrice: number; // สตางค์/ลิตร
  gross: number; // สตางค์ (ตามหน้าตู้)
  discount: number; // สตางค์
  net: number; // สตางค์ (ลูกค้าจ่ายจริง รวม VAT)
  vat: number;
  beforeVat: number;
  method: PaymentMethod;
  received: number; // สตางค์ (เงินสดที่รับ)
  change: number;
  memberId: ID | null;
  pointsEarned: number;
  promotionIds: ID[];
  plate: string;
  employeeId: ID;
  createdAt: string;
  status: 'paid' | 'void';
  voidReason?: string;
  taxInvoiceId: ID | null;
}

export interface TaxInvoice {
  id: ID;
  no: string;
  saleIds: ID[];
  customerName: string;
  customerTaxId: string;
  customerBranch: string;
  customerAddress: string;
  plate: string;
  issuedAt: string;
  issuedBy: ID;
  lines: { productId: ID; volume: number; unitPrice: number; gross: number; discount: number; net: number }[];
  total: number;
  vat: number;
  beforeVat: number;
  status: 'issued' | 'cancelled';
}

export interface TankDip {
  tankId: ID;
  measured: number; // ml
}

export type StockMoveType = 'delivery' | 'sale' | 'void' | 'meter_adjust' | 'dip_adjust' | 'manual';

export interface StockMove {
  id: ID;
  tankId: ID;
  type: StockMoveType;
  volume: number; // + เข้า / - ออก (ml)
  balance: number; // คงเหลือหลังรายการ
  ref: string;
  note: string;
  at: string;
}

export interface Delivery {
  id: ID;
  tankId: ID;
  volume: number;
  cost: number; // สตางค์/ลิตร
  supplier: string;
  docNo: string;
  at: string;
  byEmployeeId: ID | null;
}

export interface NozzleRecon {
  nozzleId: ID;
  open: MeterReading;
  close: MeterReading;
  meterVolume: number;
  meterAmount: number;
  posVolume: number;
  posGross: number;
  varVolume: number; // มิเตอร์ - ระบบ
  varAmount: number;
  /** ยอดเงินที่ควรเป็น = ลิตรตามมิเตอร์ × ราคา (ใช้ตรวจความสอดคล้องของจอ P กับ L) */
  priceCheck: number;
}

export interface TankRecon {
  tankId: ID;
  opening: number;
  deliveries: number;
  meterOut: number;
  expected: number;
  dip: number | null;
  variance: number | null; // วัดจริง - ตามบัญชี
  variancePct: number | null;
  withinTolerance: boolean | null;
}

export interface ShiftSummary {
  nozzles: NozzleRecon[];
  tanks: TankRecon[];
  meterAmount: number;
  meterVolume: number;
  posGross: number;
  posNet: number;
  discount: number;
  byMethod: Record<PaymentMethod, number>;
  saleCount: number;
  expectedCash: number;
  countedCash: number;
  cashDiff: number;
}

export interface Shift {
  id: ID;
  no: string;
  name: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedBy: ID;
  openingCash: number;
  openReadings: Record<ID, MeterReading>;
  tankLevelsAtOpen: Record<ID, number>;
  closedAt: string | null;
  closedBy: ID | null;
  closeReadings: Record<ID, MeterReading> | null;
  dips: TankDip[];
  countedCash: number | null;
  note: string;
  summary: ShiftSummary | null;
}

export interface Counters {
  receipt: number;
  receiptDay: string;
  invoice: number;
  invoiceMonth: string;
  shift: number;
  member: number;
  employee: number;
}
