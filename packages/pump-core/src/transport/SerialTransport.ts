import type { SerialSettings } from '@fuel-pos/shared';
import { Transport, delay } from './Transport.js';

/**
 * เชื่อมต่อผ่านพอร์ตอนุกรม — กรณีใช้งานจริงคือ USB-to-RS485 converter
 * เสียบเข้ากับขั้ว 17 (RS485 A/B) ของบอร์ด ZB01-1
 *
 * หมายเหตุ RS-485 half-duplex:
 *  - converter รุ่นที่มี auto-direction (ส่วนใหญ่ในท้องตลาด) ไม่ต้องคุม RTS
 *  - รุ่นที่ต้องคุมเอง ให้เปิด rtsControl ใน profile
 */
export class SerialTransport extends Transport {
  private port: any = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(
    id: string,
    private readonly path: string,
    private readonly settings: SerialSettings,
    private readonly reconnectDelayMs = 3000,
  ) {
    super(id);
  }

  describe(): string {
    const s = this.settings;
    return `${this.path} @ ${s.baudRate},${s.dataBits}${s.parity[0]?.toUpperCase()},${s.stopBits}`;
  }

  async open(): Promise<void> {
    this.closing = false;
    // import แบบ dynamic เพื่อให้เครื่องที่ไม่มี native binding ของ serialport
    // (เช่น CI หรือโหมดจำลอง) ยังรันส่วนอื่นของระบบได้
    const { SerialPort } = await import('serialport');

    await new Promise<void>((resolve, reject) => {
      this.port = new SerialPort(
        {
          path: this.path,
          baudRate: this.settings.baudRate,
          dataBits: this.settings.dataBits,
          stopBits: this.settings.stopBits,
          parity: this.settings.parity,
          autoOpen: false,
        },
        undefined,
      );

      this.port.on('data', (chunk: Buffer) => {
        this.emit('data', new Uint8Array(chunk));
      });
      this.port.on('error', (err: Error) => {
        this.emit('error', err);
      });
      this.port.on('close', () => {
        this._open = false;
        this.emit('close');
        this.scheduleReconnect();
      });

      this.port.open((err: Error | null) => {
        if (err) {
          this.scheduleReconnect();
          reject(new Error(`เปิดพอร์ต ${this.path} ไม่สำเร็จ: ${err.message}`));
          return;
        }
        this._open = true;
        this.emit('open');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.port) return;
    await new Promise<void>((resolve) => this.port.close(() => resolve()));
    this._open = false;
    this.port = null;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port || !this._open) {
      throw new Error(`พอร์ต ${this.path} ยังไม่ได้เปิด`);
    }
    const { rtsControl, rtsPreDelayMs = 1, rtsPostDelayMs = 1 } = this.settings;

    if (rtsControl) {
      await this.setSignals({ rts: true });
      if (rtsPreDelayMs > 0) await delay(rtsPreDelayMs);
    }

    await new Promise<void>((resolve, reject) => {
      this.port.write(Buffer.from(data), (err: Error | null | undefined) =>
        err ? reject(err) : resolve(),
      );
    });
    // drain = รอให้ข้อมูลออกจาก UART จริง ๆ ก่อนสลับทิศทาง RS-485
    await new Promise<void>((resolve, reject) => {
      this.port.drain((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });

    if (rtsControl) {
      if (rtsPostDelayMs > 0) await delay(rtsPostDelayMs);
      await this.setSignals({ rts: false });
    }
  }

  private setSignals(signals: { rts: boolean }): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.port?.set) return resolve();
      this.port.set(signals, () => resolve());
    });
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open().catch((err: Error) => this.emit('error', err));
    }, this.reconnectDelayMs);
  }

  /** รายชื่อพอร์ตที่มีในเครื่อง — ใช้ในหน้าตั้งค่าให้ผู้ใช้เลือก COM port */
  static async list(): Promise<
    { path: string; manufacturer?: string; serialNumber?: string; pnpId?: string }[]
  > {
    try {
      const { SerialPort } = await import('serialport');
      const ports = await SerialPort.list();
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        pnpId: p.pnpId,
      }));
    } catch {
      return [];
    }
  }
}
