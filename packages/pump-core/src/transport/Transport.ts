import { EventEmitter } from 'node:events';

export interface TransportEvents {
  data: [Uint8Array];
  open: [];
  close: [];
  error: [Error];
}

/**
 * ชั้นสื่อสารกับบัส — แยกออกจากโปรโตคอล เพื่อให้สลับระหว่าง
 * serial (USB-RS485), TCP (RS485-to-Ethernet gateway) และตัวจำลอง ได้อิสระ
 */
export abstract class Transport extends EventEmitter<TransportEvents> {
  protected _open = false;

  constructor(readonly id: string) {
    super();
    // บัสหนึ่งเส้นมีผู้ฟังได้หลายราย (manager + protocol lab + logger)
    this.setMaxListeners(50);
  }

  get isOpen(): boolean {
    return this._open;
  }

  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  abstract write(data: Uint8Array): Promise<void>;

  /** ชื่อที่ใช้แสดงใน log/UI */
  abstract describe(): string;
}

/** ตัวช่วย: รอจนกว่าจะครบเวลา */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
