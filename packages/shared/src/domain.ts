/**
 * โดเมนหลักของระบบ POS ปั๊มน้ำมัน
 *
 * หน่วยตัวเลขทั้งระบบ (สำคัญมาก):
 *  - ปริมาตร  เก็บเป็น "มิลลิลิตร" (integer)  → 12.34 ลิตร = 12340
 *  - จำนวนเงิน เก็บเป็น "สตางค์"   (integer)  → 45.50 บาท  = 4550
 *  - ราคาต่อลิตร เก็บเป็น "สตางค์ต่อลิตร" (integer) → 39.75 บาท/ล. = 3975
 * เหตุผล: หลีกเลี่ยง floating point error สะสมในยอดขาย/ยอดมิเตอร์
 */

// ---------------------------------------------------------------------------
// สินค้า (ชนิดน้ำมัน)
// ---------------------------------------------------------------------------

export interface Product {
  id: number;
  /** รหัสสั้น เช่น G95, G91, E20, B7 */
  code: string;
  /** ชื่อแสดงผล เช่น "แก๊สโซฮอล์ 95" */
  name: string;
  /** สีประจำชนิดน้ำมันสำหรับ UI (hex) */
  color: string;
  /** ราคาปัจจุบัน หน่วย: สตางค์/ลิตร */
  unitPrice: number;
  active: boolean;
}

export interface PriceChange {
  id: number;
  productId: number;
  oldPrice: number;
  newPrice: number;
  changedAt: string;
  changedBy: number | null;
  /** ส่งราคาไปตู้จ่ายสำเร็จหรือไม่ */
  pushedToPumps: boolean;
  note: string | null;
}

// ---------------------------------------------------------------------------
// ตู้จ่าย / หัวจ่าย
// ---------------------------------------------------------------------------

export interface Pump {
  id: number;
  /** ชื่อที่พนักงานเรียก เช่น "ตู้ 1" */
  name: string;
  /** address บนบัส RS-485 (ตั้งที่ตู้ด้วยกุญแจ Set) */
  address: number;
  /** id ของ transport ที่ใช้ (บัสหนึ่งเส้นมีได้หลายตู้) */
  busId: string;
  /** id ของ protocol profile */
  profileId: string;
  enabled: boolean;
}

export interface Nozzle {
  id: number;
  pumpId: number;
  /** ลำดับหัวจ่ายในตู้ (1 = A, 2 = B ตามป้ายบอร์ด ZB01) */
  index: number;
  /** ป้ายที่แสดงบนจอ POS เช่น "1A" */
  label: string;
  productId: number;
  enabled: boolean;
}

export type NozzleStatus =
  /** ว่าง พร้อมรับคำสั่ง */
  | 'idle'
  /** ได้รับ authorize แล้ว รอยกหัวจ่าย */
  | 'authorized'
  /** ยกหัวจ่ายออกจากแท่นแล้ว แต่ยังไม่จ่าย */
  | 'nozzle_out'
  /** กำลังจ่ายน้ำมัน */
  | 'filling'
  /** จ่ายจบ (เก็บหัวคืน / ถึง preset) รอชำระเงิน */
  | 'complete'
  /** ตู้หยุดกลางคัน โดยคำสั่ง STOP */
  | 'stopped'
  /** ติดต่อตู้ไม่ได้ */
  | 'offline'
  /** ตู้แจ้ง error */
  | 'error';

export type PresetMode = 'none' | 'amount' | 'volume' | 'full';

/** สถานะสดของหัวจ่าย ที่ push ผ่าน WebSocket ไปหน้าจอ POS */
export interface NozzleLiveState {
  nozzleId: number;
  pumpId: number;
  label: string;
  productId: number;
  status: NozzleStatus;
  /** ปริมาตรที่จ่ายในรายการปัจจุบัน (มิลลิลิตร) */
  volume: number;
  /** ยอดเงินรายการปัจจุบัน (สตางค์) */
  amount: number;
  /** ราคาที่ตู้ใช้อยู่จริง (สตางค์/ลิตร) */
  unitPrice: number;
  presetMode: PresetMode;
  /** ค่า preset (สตางค์ หรือ มิลลิลิตร ตาม presetMode) */
  presetValue: number;
  /** มิเตอร์รวมสะสมของหัวจ่าย (มิลลิลิตร) */
  totalizerVolume: number;
  /** มิเตอร์เงินรวมสะสม (สตางค์) */
  totalizerAmount: number;
  /** id ของรายการค้างชำระ ถ้ามี */
  pendingSaleId: number | null;
  /** เวลาที่ได้ข้อมูลล่าสุดจากตู้ (epoch ms) */
  updatedAt: number;
  /** ข้อความ error ล่าสุด */
  error: string | null;
}

// ---------------------------------------------------------------------------
// รายการขาย
// ---------------------------------------------------------------------------

export type SaleStatus = 'pending' | 'paid' | 'void';
export type PaymentMethod = 'cash' | 'qr' | 'card' | 'credit' | 'coupon' | 'fleet';

export interface Sale {
  id: number;
  /** เลขที่ใบเสร็จ เช่น 20260831-0001 */
  docNo: string;
  shiftId: number | null;
  nozzleId: number;
  pumpId: number;
  productId: number;
  /** มิลลิลิตร */
  volume: number;
  /** สตางค์/ลิตร */
  unitPrice: number;
  /** สตางค์ */
  amount: number;
  status: SaleStatus;
  startedAt: string;
  endedAt: string;
  paidAt: string | null;
  cashierId: number | null;
  attendantId: number | null;
  vehiclePlate: string | null;
  customerId: number | null;
  note: string | null;
  /** ค่ามิเตอร์ก่อน/หลังจ่าย ใช้ตรวจสอบย้อนหลัง */
  totalizerStart: number;
  totalizerEnd: number;
}

export interface Payment {
  id: number;
  saleId: number;
  method: PaymentMethod;
  /** สตางค์ */
  amount: number;
  /** เงินที่รับมา (เงินสด) สตางค์ */
  tendered: number | null;
  /** เงินทอน สตางค์ */
  change: number | null;
  reference: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// กะ (Shift)
// ---------------------------------------------------------------------------

export type ShiftStatus = 'open' | 'closed';

export interface Shift {
  id: number;
  name: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
  openedBy: number;
  closedBy: number | null;
  /** เงินทอนตั้งต้นในลิ้นชัก (สตางค์) */
  openingFloat: number;
  /** เงินสดที่นับได้จริงตอนปิดกะ (สตางค์) */
  countedCash: number | null;
  note: string | null;
}

/** ค่ามิเตอร์หัวจ่าย ณ เวลาเปิด/ปิดกะ ใช้กระทบยอด */
export interface ShiftNozzleReading {
  shiftId: number;
  nozzleId: number;
  openVolume: number;
  openAmount: number;
  closeVolume: number | null;
  closeAmount: number | null;
}

// ---------------------------------------------------------------------------
// ผู้ใช้งาน
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'manager' | 'cashier' | 'attendant';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

// ---------------------------------------------------------------------------
// ถัง (สำหรับกระทบยอดสต็อก)
// ---------------------------------------------------------------------------

export interface Tank {
  id: number;
  name: string;
  productId: number;
  /** ความจุ (มิลลิลิตร) */
  capacity: number;
  /** ยอดคงเหลือตามบัญชี (มิลลิลิตร) */
  bookLevel: number;
}

export interface TankMovement {
  id: number;
  tankId: number;
  type: 'delivery' | 'sale' | 'adjust' | 'dip';
  /** มิลลิลิตร (+ รับเข้า / - จ่ายออก) */
  volume: number;
  refId: number | null;
  createdAt: string;
  note: string | null;
}
