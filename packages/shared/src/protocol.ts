/**
 * สคีมาของ "Protocol Profile" — คำอธิบายโปรโตคอลตู้จ่ายในรูปแบบ JSON
 *
 * ทำไมต้องเป็นไฟล์ JSON แทนการเขียนโค้ด?
 * บอร์ด ZB01-1 / RT-TG224 (และตู้จีนรุ่นอื่น ๆ) ไม่มีสเปกสาธารณะ ต้องหาโปรโตคอลจริง
 * จากหน้างานด้วยการ sniff บัส RS-485 เมื่อถอดรหัสได้แล้ว ผู้ใช้แก้แค่ไฟล์ profile
 * ไม่ต้อง build โปรแกรมใหม่ ทำให้ปรับจูนหน้างานได้ทันที
 *
 * ดูขั้นตอนการหาโปรโตคอลจริงที่ docs/02-protocol-discovery.md
 */

import type { NozzleStatus } from './domain.js';

// ---------------------------------------------------------------------------
// การเชื่อมต่อทางกายภาพ
// ---------------------------------------------------------------------------

export type Parity = 'none' | 'even' | 'odd' | 'mark' | 'space';

export interface SerialSettings {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: Parity;
  /** เปิด RTS ก่อนส่ง (จำเป็นกับ RS-485 converter บางรุ่นที่ไม่มี auto-direction) */
  rtsControl?: boolean;
  /** หน่วงหลังเปิด RTS ก่อนเริ่มส่ง (ms) */
  rtsPreDelayMs?: number;
  /** หน่วงก่อนปิด RTS หลังส่งจบ (ms) */
  rtsPostDelayMs?: number;
}

export type TransportConfig =
  | {
      kind: 'serial';
      id: string;
      /** เช่น COM3 (Windows) หรือ /dev/ttyUSB0 (Linux) */
      path: string;
      serial: SerialSettings;
    }
  | {
      kind: 'tcp';
      id: string;
      /** RS-485-to-Ethernet gateway เช่น USR-TCP232 */
      host: string;
      port: number;
    }
  | {
      kind: 'simulator';
      id: string;
      /** จำนวนตู้จำลอง */
      pumps?: number;
    };

// ---------------------------------------------------------------------------
// การตัดเฟรม
// ---------------------------------------------------------------------------

export type FramingSpec =
  | {
      /** ตัดเฟรมด้วยไบต์เริ่ม/จบ (STX ... ETX) */
      kind: 'delimited';
      stx: number[];
      etx: number[];
      /** ไบต์ escape สำหรับ byte-stuffing (เช่น 0x10) — null = ไม่มี */
      escape?: number | null;
      maxLength: number;
    }
  | {
      /** เฟรมมีไบต์บอกความยาว */
      kind: 'length';
      stx: number[];
      /** ตำแหน่งไบต์ความยาว (นับจาก 0 ของทั้งเฟรม) */
      lengthAt: number;
      lengthBytes: 1 | 2;
      lengthEndian: 'le' | 'be';
      /** ความยาวที่อ่านได้ ครอบคลุมกี่ไบต์เพิ่มจากตัวมันเอง */
      lengthIncludes: 'payload' | 'frame';
      maxLength: number;
    }
  | {
      /** ตัดเฟรมด้วยช่องว่างเวลา (แบบ Modbus RTU 3.5 char) */
      kind: 'silence';
      silenceMs: number;
      maxLength: number;
    };

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

export type ChecksumKind =
  | 'none'
  | 'sum8'
  | 'sum8_2c'
  | 'xor8'
  | 'lrc'
  | 'crc16_modbus'
  | 'crc16_ccitt_false'
  | 'crc8_maxim';

export interface ChecksumSpec {
  kind: ChecksumKind;
  /** ช่วงไบต์ที่นำมาคำนวณ (index แบบ Python: ลบได้, end ไม่รวม) */
  from: number;
  to: number;
  /** ตำแหน่งที่วาง checksum ในเฟรม (ลบได้ = นับจากท้าย) */
  at: number;
  endian: 'le' | 'be';
}

// ---------------------------------------------------------------------------
// การเข้ารหัสตัวเลข
// ---------------------------------------------------------------------------

export type NumberEncoding =
  | 'bcd'
  | 'bcd_le'
  | 'u8'
  | 'u16le'
  | 'u16be'
  | 'u24le'
  | 'u24be'
  | 'u32le'
  | 'u32be'
  | 'ascii';

export interface NumberSpec {
  /** ทศนิยมของปริมาตรที่ตู้ส่งมา (2 = ตู้ส่ง 1234 หมายถึง 12.34 ลิตร) */
  volumeDecimals: number;
  amountDecimals: number;
  priceDecimals: number;
  /** ทศนิยมของมิเตอร์รวม มักต่างจากรายการปัจจุบัน */
  totalizerVolumeDecimals: number;
  totalizerAmountDecimals: number;
}

export interface AddressSpec {
  /** ตำแหน่งไบต์ address ในเฟรม */
  at: number;
  /** ค่าที่บวกเข้ากับ address ก่อนใส่ในเฟรม (บางตู้ address 1 = 0x31) */
  offset: number;
  /** address ที่ตอบกลับ ใช้ตำแหน่งเดียวกันหรือไม่ */
  responseAt?: number;
}

export interface TimingSpec {
  /** รอบ poll สถานะ (ms) */
  pollIntervalMs: number;
  /** timeout รอคำตอบ (ms) */
  responseTimeoutMs: number;
  /** หน่วงระหว่างคำสั่งบนบัสเดียวกัน (ms) — RS-485 half duplex ต้องเว้นจังหวะ */
  interCommandDelayMs: number;
  /** จำนวนครั้งที่ retry ก่อนถือว่า offline */
  retries: number;
  /** จำนวน poll ที่ fail ติดกันก่อนตั้งสถานะ offline */
  offlineAfterFailures: number;
}

// ---------------------------------------------------------------------------
// คำสั่ง (Request)
// ---------------------------------------------------------------------------

/** ชิ้นส่วนหนึ่งของ payload ที่จะประกอบเป็นเฟรม */
export type FieldToken =
  | {
      kind: 'const';
      /** ไบต์ตายตัว */
      bytes: number[];
    }
  | {
      kind: 'address';
    }
  | {
      kind: 'var';
      /** ชื่อตัวแปรที่ผู้เรียกส่งเข้ามา เช่น nozzle, preset, price */
      name: RequestVar;
      encoding: NumberEncoding;
      /** จำนวนไบต์ (ascii/bcd ต้องระบุ) */
      length: number;
      /** คูณค่าก่อนเข้ารหัส เช่น 100 เพื่อแปลงลิตร→ค่าทศนิยม 2 ตำแหน่ง */
      scale?: number;
      /** บวกค่าหลังคูณ เช่น nozzle index ฐาน 1 → 0 */
      offset?: number;
    };

export type RequestVar = 'nozzle' | 'preset' | 'price' | 'value' | 'mode';

export type RequestName =
  /** ถามสถานะ + ปริมาตร/ยอดเงินปัจจุบัน */
  | 'status'
  /** อ่านมิเตอร์รวมสะสม */
  | 'readTotalizer'
  /** ปลดล็อกให้จ่ายได้ (ไม่กำหนดยอด) */
  | 'authorize'
  /** ปลดล็อกพร้อมกำหนดยอดเงิน */
  | 'presetAmount'
  /** ปลดล็อกพร้อมกำหนดปริมาตร */
  | 'presetVolume'
  /** สั่งหยุดจ่าย */
  | 'stop'
  /** เคลียร์รายการที่จ่ายจบแล้ว (ให้ตู้พร้อมรับรายการใหม่) */
  | 'clear'
  /** ตั้งราคาต่อลิตร */
  | 'setPrice'
  /** อ่านราคาที่ตู้ใช้อยู่ */
  | 'readPrice';

export interface RequestSpec {
  /** true = โปรไฟล์นี้ไม่รองรับคำสั่งนี้ */
  unsupported?: boolean;
  tokens: FieldToken[];
  /** ต้องรอคำตอบไหม */
  expectResponse: boolean;
}

// ---------------------------------------------------------------------------
// คำตอบ (Response)
// ---------------------------------------------------------------------------

export interface ResponseFieldSpec {
  name:
    | 'nozzle'
    | 'status'
    | 'volume'
    | 'amount'
    | 'unitPrice'
    | 'totalizerVolume'
    | 'totalizerAmount'
    | 'errorCode';
  at: number;
  length: number;
  encoding: NumberEncoding;
  /** หารด้วยค่านี้เพื่อกลับเป็นหน่วยจริง (ถ้าไม่ระบุ ใช้ค่าจาก NumberSpec) */
  divisor?: number;
  /** bit mask ก่อนใช้งาน */
  mask?: number;
  /** เลื่อนบิตขวาก่อนใช้งาน */
  shift?: number;
}

export interface ResponseSpec {
  /** ชื่อเชิงตรรกะ ใช้จับคู่กับ request */
  name: string;
  /** เงื่อนไขที่ใช้ระบุว่าเฟรมนี้คือ response ชนิดนี้ */
  match: { at: number; equals: number; mask?: number }[];
  fields: ResponseFieldSpec[];
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProtocolProfile {
  id: string;
  name: string;
  vendor?: string;
  description?: string;
  /** true = โปรไฟล์นี้ยังไม่ได้ยืนยันกับฮาร์ดแวร์จริง ต้องทดสอบก่อนใช้งานจริง */
  unverified?: boolean;
  serial: SerialSettings;
  framing: FramingSpec;
  checksum: ChecksumSpec;
  numbers: NumberSpec;
  addressing: AddressSpec;
  timing: TimingSpec;
  requests: Partial<Record<RequestName, RequestSpec>>;
  responses: ResponseSpec[];
  /** แปลงเลขสถานะจากตู้ → สถานะในระบบ */
  statusMap: Record<string, NozzleStatus>;
  /**
   * ตู้ส่งข้อมูล 2 หัวจ่ายมาในเฟรมเดียวหรือแยกเฟรม
   *  - 'per_nozzle' : ต้อง poll ทีละหัวจ่าย (ส่ง nozzle index ไปด้วย)
   *  - 'per_pump'   : poll ครั้งเดียวได้ทั้งตู้ (response มีฟิลด์ nozzle บอก)
   */
  pollGranularity: 'per_nozzle' | 'per_pump';
  /** จำนวนหัวจ่ายสูงสุดต่อบอร์ด */
  nozzlesPerPump: number;
}
