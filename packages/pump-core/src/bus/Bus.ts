import { EventEmitter } from 'node:events';
import type { FramingSpec } from '@fuel-pos/shared';
import { Framer, unescapeBytes } from '../framing/Framer.js';
import { Transport, delay } from '../transport/Transport.js';
import { equalBytes, toHex } from '../util/bytes.js';

export interface BusEvents {
  /** เฟรมที่ไม่มีใครรออยู่ (unsolicited) */
  frame: [Uint8Array];
  /** ข้อมูลดิบทุกทิศทาง สำหรับหน้า Protocol Lab */
  traffic: [{ direction: 'tx' | 'rx'; bytes: Uint8Array; at: number }];
  open: [];
  close: [];
  error: [Error];
}

export interface RequestOptions {
  timeoutMs: number;
  /** ไม่รอคำตอบ (คำสั่งแบบ fire-and-forget) */
  expectResponse?: boolean;
  /** ตัวกรองว่าเฟรมที่เข้ามาใช่คำตอบของคำสั่งนี้หรือไม่ */
  matcher?: (frame: Uint8Array) => boolean;
  /** จำนวนครั้งที่ลองใหม่เมื่อ timeout */
  retries?: number;
}

interface PendingRequest {
  frame: Uint8Array;
  options: Required<Pick<RequestOptions, 'timeoutMs' | 'expectResponse'>> &
    Pick<RequestOptions, 'matcher'> & { retries: number };
  resolve: (frame: Uint8Array | null) => void;
  reject: (err: Error) => void;
}

export class BusTimeoutError extends Error {
  constructor(hex: string, timeoutMs: number) {
    super(`ไม่ได้รับคำตอบภายใน ${timeoutMs} ms (ส่งไป: ${hex})`);
    this.name = 'BusTimeoutError';
  }
}

/**
 * บัสสื่อสารหนึ่งเส้น (เช่น COM3 ที่มีตู้จ่าย 2 ตู้ต่อพ่วงกันอยู่)
 *
 * RS-485 เป็น half-duplex และเป็น multi-drop: ห้ามส่งซ้อนกัน
 * คลาสนี้จึงบังคับให้คำสั่งทั้งหมด "เข้าคิว" ทีละคำสั่ง และเว้นจังหวะระหว่างคำสั่ง
 */
export class Bus extends EventEmitter<BusEvents> {
  private readonly framer: Framer;
  private readonly queue: PendingRequest[] = [];
  private processing = false;
  private waiter: ((frame: Uint8Array) => void) | null = null;
  private lastTx: Uint8Array | null = null;

  constructor(
    readonly transport: Transport,
    private readonly framing: FramingSpec,
    private readonly interCommandDelayMs = 30,
    /** ตัดเฟรมที่เหมือนกับที่เพิ่งส่งออกไป (converter บางรุ่นสะท้อนกลับ) */
    private readonly dropEcho = true,
  ) {
    super();
    this.setMaxListeners(50);
    this.framer = new Framer(framing, (frame) => this.handleFrame(frame));

    transport.on('data', (chunk) => {
      this.emit('traffic', { direction: 'rx', bytes: chunk, at: Date.now() });
      this.framer.push(chunk);
    });
    transport.on('open', () => {
      this.framer.reset();
      this.emit('open');
    });
    transport.on('close', () => {
      this.framer.reset();
      this.failAllPending(new Error(`บัส ${transport.id} หลุดการเชื่อมต่อ`));
      this.emit('close');
    });
    transport.on('error', (err) => this.emit('error', err));
  }

  get id(): string {
    return this.transport.id;
  }

  get isOpen(): boolean {
    return this.transport.isOpen;
  }

  async open(): Promise<void> {
    await this.transport.open();
  }

  async close(): Promise<void> {
    this.failAllPending(new Error(`บัส ${this.transport.id} ถูกปิด`));
    this.framer.dispose();
    await this.transport.close();
  }

  /** ส่งคำสั่งและ (ถ้าต้องการ) รอคำตอบ — เข้าคิวอัตโนมัติ */
  request(frame: Uint8Array, options: RequestOptions): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this.queue.push({
        frame,
        options: {
          timeoutMs: options.timeoutMs,
          expectResponse: options.expectResponse ?? true,
          matcher: options.matcher,
          retries: options.retries ?? 0,
        },
        resolve,
        reject,
      });
      void this.drain();
    });
  }

  /** ส่งไบต์ดิบโดยไม่ผ่านคิว — ใช้เฉพาะหน้า Protocol Lab */
  async sendRaw(bytes: Uint8Array): Promise<void> {
    this.lastTx = bytes;
    this.emit('traffic', { direction: 'tx', bytes, at: Date.now() });
    await this.transport.write(bytes);
  }

  // -------------------------------------------------------------------------

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) break;
        await this.runJob(job);
        if (this.interCommandDelayMs > 0) await delay(this.interCommandDelayMs);
      }
    } finally {
      this.processing = false;
    }
  }

  private async runJob(job: PendingRequest): Promise<void> {
    const attempts = job.options.retries + 1;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = await this.transact(job);
        job.resolve(result);
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < attempts - 1) await delay(this.interCommandDelayMs);
      }
    }
    job.reject(lastError ?? new Error('ส่งคำสั่งไม่สำเร็จ'));
  }

  private async transact(job: PendingRequest): Promise<Uint8Array | null> {
    this.lastTx = job.frame;
    this.emit('traffic', { direction: 'tx', bytes: job.frame, at: Date.now() });
    await this.transport.write(job.frame);

    if (!job.options.expectResponse) return null;

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new BusTimeoutError(toHex(job.frame), job.options.timeoutMs));
      }, job.options.timeoutMs);

      this.waiter = (frame: Uint8Array) => {
        if (job.options.matcher && !job.options.matcher(frame)) {
          // ไม่ใช่คำตอบที่รอ — ปล่อยผ่านไปเป็นเฟรมอิสระ แล้วรอต่อ
          this.emit('frame', frame);
          return;
        }
        clearTimeout(timer);
        this.waiter = null;
        resolve(frame);
      };
    });
  }

  private handleFrame(frame: Uint8Array): void {
    // Framer ถอด byte-stuffing ออกแล้ว จึงต้องเทียบกับรูปที่ถอดแล้วของสิ่งที่เพิ่งส่ง
    if (this.dropEcho && this.lastTx && equalBytes(frame, this.unescapedLastTx())) {
      this.lastTx = null; // echo ของคำสั่งที่เพิ่งส่ง — ข้าม
      return;
    }
    if (this.waiter) {
      this.waiter(frame);
      return;
    }
    this.emit('frame', frame);
  }

  /** รูปแบบ "ถอด stuffing แล้ว" ของเฟรมล่าสุดที่ส่งออกไป ใช้ตรวจจับ echo */
  private unescapedLastTx(): Uint8Array {
    const tx = this.lastTx as Uint8Array;
    if (this.framing.kind !== 'delimited' || this.framing.escape == null) return tx;
    return unescapeBytes(tx, this.framing.escape);
  }

  private failAllPending(err: Error): void {
    if (this.waiter) this.waiter = null;
    while (this.queue.length > 0) {
      this.queue.shift()?.reject(err);
    }
  }
}
