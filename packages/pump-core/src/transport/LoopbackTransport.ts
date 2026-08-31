import { Transport } from './Transport.js';

/**
 * บัสจำลองในหน่วยความจำ — ใช้ต่อกับตู้จ่ายเสมือน (VirtualPump)
 * ทำให้พัฒนา/สาธิต/เขียนเทสต์ POS ได้โดยไม่ต้องมีตู้จริง
 */
export class LoopbackTransport extends Transport {
  /** ฟังก์ชันที่จำลอง "อีกฝั่งของสาย" — รับไบต์ที่ POS ส่งออกไป */
  private peer: ((data: Uint8Array) => void) | null = null;
  /** หน่วงจำลองเวลาเดินทางบนบัส (ms) */
  constructor(id: string, private readonly latencyMs = 8) {
    super(id);
  }

  describe(): string {
    return `loopback:${this.id}`;
  }

  attachPeer(handler: (data: Uint8Array) => void): void {
    this.peer = handler;
  }

  /** ให้อุปกรณ์เสมือนส่งข้อมูลกลับมาหา POS */
  injectFromDevice(data: Uint8Array): void {
    setTimeout(() => this.emit('data', data), this.latencyMs);
  }

  async open(): Promise<void> {
    this._open = true;
    this.emit('open');
  }

  async close(): Promise<void> {
    this._open = false;
    this.emit('close');
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this._open) throw new Error('loopback ยังไม่ได้เปิด');
    const peer = this.peer;
    if (!peer) return;
    setTimeout(() => peer(data), this.latencyMs);
  }
}
