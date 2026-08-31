import type { NozzleStatus, PresetMode, RequestName } from '@fuel-pos/shared';

/** ค่าที่อ่านได้จากหัวจ่ายหนึ่งหัวในรอบ poll หนึ่งครั้ง */
export interface NozzleReading {
  /** ลำดับหัวจ่ายในตู้ เริ่มที่ 1 */
  nozzle: number;
  status: NozzleStatus;
  /** ปริมาตรรายการปัจจุบัน (มิลลิลิตร) */
  volume: number;
  /** ยอดเงินรายการปัจจุบัน (สตางค์) */
  amount: number;
  /** ราคาที่ตู้ใช้อยู่ (สตางค์/ลิตร) — null ถ้าโปรโตคอลไม่ส่งมา */
  unitPrice: number | null;
  /** มิเตอร์สะสม (มิลลิลิตร) — null ถ้าต้องอ่านด้วยคำสั่งแยก */
  totalizerVolume: number | null;
  /** มิเตอร์เงินสะสม (สตางค์) */
  totalizerAmount: number | null;
  errorCode: number | null;
}

export interface PresetRequest {
  mode: PresetMode;
  /** สตางค์ (mode='amount') หรือ มิลลิลิตร (mode='volume') */
  value: number;
}

/**
 * สัญญาที่ทุกไดรเวอร์ตู้จ่ายต้องทำได้
 *
 * ชั้นบน (PumpManager / POS) ไม่รู้จักโปรโตคอลเลย จึงสลับไดรเวอร์
 * ระหว่างของจริงกับตัวจำลองได้โดยไม่ต้องแก้ตรรกะธุรกิจ
 */
export interface PumpDriver {
  readonly profileId: string;
  readonly nozzlesPerPump: number;

  /** ไดรเวอร์รองรับคำสั่งนี้หรือไม่ */
  supports(command: RequestName): boolean;

  /** อ่านสถานะทุกหัวจ่ายของตู้หนึ่งตู้ */
  poll(address: number): Promise<NozzleReading[]>;

  /** อ่านมิเตอร์สะสม (บางโปรโตคอลต้องสั่งแยกจาก poll) */
  readTotalizer(
    address: number,
    nozzle: number,
  ): Promise<{ volume: number; amount: number } | null>;

  /** ปลดล็อกให้หัวจ่ายจ่ายน้ำมันได้ */
  authorize(address: number, nozzle: number, preset: PresetRequest): Promise<void>;

  /** สั่งหยุดจ่าย */
  stop(address: number, nozzle: number): Promise<void>;

  /** เคลียร์รายการที่จบแล้ว ให้ตู้พร้อมรับรายการใหม่ */
  clear(address: number, nozzle: number): Promise<void>;

  /** ตั้งราคาต่อลิตร (สตางค์/ลิตร) */
  setPrice(address: number, nozzle: number, satangPerLitre: number): Promise<void>;
}

export class DriverError extends Error {
  constructor(
    message: string,
    readonly address?: number,
    readonly nozzle?: number,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}
