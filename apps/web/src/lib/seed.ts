import type {
  Dispenser,
  Employee,
  Member,
  MeterReading,
  Nozzle,
  Product,
  Promotion,
  Reward,
  Station,
  Tank,
} from './types';
import { monthKey } from './units';

export const seedStation: Station = {
  name: 'สถานีบริการน้ำมัน ตัวอย่าง',
  branch: 'สำนักงานใหญ่',
  taxId: '0000000000000',
  address: '99 หมู่ 1 ถนนสายหลัก ตำบลตัวอย่าง อำเภอเมือง จังหวัดตัวอย่าง 10000',
  phone: '02-000-0000',
  vatRate: 7,
  vatRegistered: true,
  bahtPerPoint: 25,
  receiptFooter: 'ขอบคุณที่ใช้บริการ ขับขี่ปลอดภัย',
  stockTolerancePct: 0.5,
};

/** ราคาตามป้ายหน้าตู้ในรูป: ซ้าย 40.59 (แก๊สโซฮอล์ 95) · ขวา 40.79 (ดีเซล) */
export const seedProducts: Product[] = [
  { id: 'G95', code: 'G95', name: 'แก๊สโซฮอล์ 95', shortName: 'GSH 95', color: '#e11d48', price: 4059 },
  { id: 'DSL', code: 'B7', name: 'ดีเซล', shortName: 'ดีเซล', color: '#2563eb', price: 4079 },
];

/**
 * ถังใต้ดิน 3 ใบ ใบละ 5,000 ลิตร
 *  ถัง 1 แก๊สโซฮอล์ 95 → หัวจ่าย 95 ของทั้งตู้ 1 และตู้ 2
 *  ถัง 2 ดีเซล          → หัวดีเซลตู้ 2
 *  ถัง 3 ดีเซล          → หัวดีเซลตู้ 1
 */
export const seedTanks: Tank[] = [
  { id: 'T1', no: 1, name: 'ถัง 1 · แก๊สโซฮอล์ 95', productId: 'G95', capacity: 5_000_000, level: 3_200_000, lowPct: 20 },
  { id: 'T2', no: 2, name: 'ถัง 2 · ดีเซล', productId: 'DSL', capacity: 5_000_000, level: 2_800_000, lowPct: 20 },
  { id: 'T3', no: 3, name: 'ถัง 3 · ดีเซล', productId: 'DSL', capacity: 5_000_000, level: 3_500_000, lowPct: 20 },
];

export const seedDispensers: Dispenser[] = [
  { id: 'D1', no: 1, name: 'ตู้จ่าย 1' },
  { id: 'D2', no: 2, name: 'ตู้จ่าย 2' },
];

export const seedNozzles: Nozzle[] = [
  { id: 'D1-L', dispenserId: 'D1', side: 'L', label: '1A', productId: 'G95', tankId: 'T1' },
  { id: 'D1-R', dispenserId: 'D1', side: 'R', label: '1B', productId: 'DSL', tankId: 'T3' },
  { id: 'D2-L', dispenserId: 'D2', side: 'L', label: '2A', productId: 'G95', tankId: 'T1' },
  { id: 'D2-R', dispenserId: 'D2', side: 'R', label: '2B', productId: 'DSL', tankId: 'T2' },
];

/** ค่ามิเตอร์สะสมล่าสุด อ่านจากรูปหน้าจอตู้จ่ายจริง (จอ P = บาท, จอ L = ลิตร) */
export const seedMeters: Record<string, MeterReading> = {
  'D1-L': { amount: 879_082_460, volume: 405_117_800 }, // P 87|90824.6  L 40|5117.80
  'D1-R': { amount: 179_883_970, volume: 924_149_770 }, // P 17|98839.7  L 92|4149.77
  'D2-L': { amount: 581_223_490, volume: 429_191_520 }, // P 58|12234.9  L 42|9191.52
  'D2-R': { amount: 27_807_760, volume: 300_236_030 }, //  P  2|78077.6  L 30|0236.03
};

const now = new Date().toISOString();

export const seedEmployees: Employee[] = [
  { id: 'E1', code: 'EMP001', name: 'เจ้าของปั๊ม', nickname: 'เถ้าแก่', role: 'owner', pin: '1234', phone: '', active: true, createdAt: now },
  { id: 'E2', code: 'EMP002', name: 'สมศรี ใจดี', nickname: 'ศรี', role: 'cashier', pin: '1111', phone: '', active: true, createdAt: now },
  { id: 'E3', code: 'EMP003', name: 'สมชาย ขยัน', nickname: 'ชาย', role: 'attendant', pin: '2222', phone: '', active: true, createdAt: now },
];

export const seedMembers: Member[] = [
  { id: 'M1', code: 'MB00001', name: 'คุณวิชัย รักดี', phone: '0812345678', plate: 'กข 1234', points: 120, totalSpent: 1_250_000, taxId: '', address: '', joinedAt: now },
  { id: 'M2', code: 'MB00002', name: 'บริษัท ขนส่งดี จำกัด', phone: '0898765432', plate: '70-1234', points: 860, totalSpent: 8_600_000, taxId: '0105500000000', address: '1 ถนนตัวอย่าง กรุงเทพฯ 10100', joinedAt: now },
];

export const seedRewards: Reward[] = [
  { id: 'R1', name: 'น้ำดื่ม 1 แพ็ค', emoji: '💧', points: 50, stock: 40, active: true },
  { id: 'R2', name: 'คูปองส่วนลด 50 บาท', emoji: '🎟️', points: 200, stock: 100, active: true },
  { id: 'R3', name: 'ล้างรถฟรี 1 ครั้ง', emoji: '🚗', points: 300, stock: 20, active: true },
  { id: 'R4', name: 'แก้วเก็บความเย็น', emoji: '🥤', points: 500, stock: 10, active: true },
];

export const seedPromotions = (): Promotion[] => [
  {
    id: 'P1',
    name: 'สมาชิกเติมดีเซล ลด 30 สต./ลิตร',
    description: 'เฉพาะสมาชิก เติมดีเซลขั้นต่ำ 500 บาท',
    month: monthKey(),
    type: 'discount_per_liter',
    value: 30,
    productIds: ['DSL'],
    minAmount: 50_000,
    membersOnly: true,
    active: true,
  },
  {
    id: 'P2',
    name: 'แต้ม x2 ทุกวัน',
    description: 'สมาชิกรับแต้มสองเท่าตลอดเดือน',
    month: monthKey(),
    type: 'points_multiplier',
    value: 2,
    productIds: [],
    minAmount: 0,
    membersOnly: true,
    active: true,
  },
];
