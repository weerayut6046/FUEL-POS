import type { NozzleLiveState, Sale, Shift, Product } from './domain.js';

/** ข้อความที่ server ส่งไปหน้าจอ POS ผ่าน WebSocket */
export type ServerEvent =
  | { type: 'hello'; serverTime: number; version: string }
  /** สถานะสดของทุกหัวจ่าย (ส่งตอนเชื่อมต่อครั้งแรก) */
  | { type: 'nozzles.snapshot'; nozzles: NozzleLiveState[] }
  /** สถานะหัวจ่ายเปลี่ยน */
  | { type: 'nozzle.update'; nozzle: NozzleLiveState }
  /** จ่ายน้ำมันจบ เกิดรายการค้างชำระ */
  | { type: 'sale.created'; sale: Sale }
  | { type: 'sale.paid'; sale: Sale }
  | { type: 'shift.changed'; shift: Shift | null }
  | { type: 'products.changed'; products: Product[] }
  /** สถานะบัสสื่อสาร */
  | { type: 'bus.status'; busId: string; connected: boolean; error: string | null }
  /** ข้อมูลดิบบนบัส สำหรับหน้า Protocol Lab */
  | {
      type: 'bus.traffic';
      busId: string;
      direction: 'tx' | 'rx';
      /** hex string เช่น "02 01 11 03 7A" */
      hex: string;
      at: number;
    }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; message: string };

/** ข้อความที่หน้าจอ POS ส่งกลับมา */
export type ClientCommand =
  | { type: 'subscribe.traffic'; busId: string | null }
  | { type: 'ping' };
