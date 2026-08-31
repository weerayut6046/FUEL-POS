import type { FramingSpec } from '@fuel-pos/shared';
import { indexOfBytes } from '../util/bytes.js';

export type FrameHandler = (frame: Uint8Array) => void;

/**
 * ตัดสตรีมไบต์ที่ไหลเข้ามาให้เป็น "เฟรม" ตามกติกาใน profile
 *
 * ทำไมต้องมีชั้นนี้แยก: UART ส่งข้อมูลมาเป็นก้อนที่ไม่ตรงกับขอบเฟรม
 * เช่น เฟรม 8 ไบต์อาจมาถึงเป็น 3 + 5 ไบต์ หรือ 2 เฟรมมาพร้อมกันใน chunk เดียว
 */
export class Framer {
  private buffer: Uint8Array = new Uint8Array(0);
  private silenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly spec: FramingSpec,
    private readonly onFrame: FrameHandler,
  ) {}

  reset(): void {
    this.buffer = new Uint8Array(0);
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  dispose(): void {
    this.reset();
  }

  push(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    switch (this.spec.kind) {
      case 'delimited':
        this.scanDelimited();
        break;
      case 'length':
        this.scanLength();
        break;
      case 'silence':
        this.scanSilence();
        break;
    }
  }

  // -------------------------------------------------------------------------

  private scanDelimited(): void {
    if (this.spec.kind !== 'delimited') return;
    const { stx, etx, escape, maxLength } = this.spec;
    const stxBytes = Uint8Array.from(stx);
    const etxBytes = Uint8Array.from(etx);

    for (;;) {
      const start = stxBytes.length === 0 ? 0 : indexOfBytes(this.buffer, stxBytes, 0);
      if (start < 0) {
        // ไม่มี STX เลย — เก็บไว้แค่ท้าย ๆ เผื่อ STX ถูกตัดครึ่ง
        if (this.buffer.length > maxLength) {
          this.buffer = this.buffer.subarray(this.buffer.length - stxBytes.length);
        }
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);

      const end = this.findEtx(this.buffer, etxBytes, stxBytes.length, escape ?? null);
      if (end < 0) {
        if (this.buffer.length > maxLength) {
          // เฟรมยาวเกินกำหนด แปลว่าหลงจังหวะ — ทิ้ง STX ตัวแรกแล้วหาใหม่
          this.buffer = this.buffer.subarray(1);
          continue;
        }
        return; // รอข้อมูลเพิ่ม
      }

      const frameEnd = end + etxBytes.length;
      const frame = this.buffer.slice(0, frameEnd);
      this.buffer = this.buffer.subarray(frameEnd);
      this.emitFrame(escape != null ? unescapeBytes(frame, escape) : frame);
    }
  }

  /**
   * หาตำแหน่ง ETX โดยเดินหน้าไปทีละไบต์และ "ข้ามคู่ที่ถูก escape"
   *
   * ต้องเดินหน้าแบบมีสถานะ ไม่ใช่มองย้อนหลังแค่ 1 ไบต์ มิฉะนั้นลำดับอย่าง
   * `10 10 03` (ข้อมูลคือไบต์ escape เอง แล้วตามด้วย ETX จริง) จะถูกอ่านผิด
   */
  private findEtx(
    buf: Uint8Array,
    etx: Uint8Array,
    from: number,
    escape: number | null,
  ): number {
    if (etx.length === 0) return -1;
    let i = from;
    while (i <= buf.length - etx.length) {
      if (escape != null && buf[i] === escape) {
        i += 2; // ไบต์ถัดไปเป็นข้อมูลเสมอ ไม่ใช่ตัวคุม
        continue;
      }
      let match = true;
      for (let j = 0; j < etx.length; j++) {
        if (buf[i + j] !== etx[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
      i += 1;
    }
    return -1;
  }

  private scanLength(): void {
    if (this.spec.kind !== 'length') return;
    const { stx, lengthAt, lengthBytes, lengthEndian, lengthIncludes, maxLength } = this.spec;
    const stxBytes = Uint8Array.from(stx);

    for (;;) {
      const start = stxBytes.length === 0 ? 0 : indexOfBytes(this.buffer, stxBytes, 0);
      if (start < 0) {
        if (this.buffer.length > maxLength) {
          this.buffer = this.buffer.subarray(this.buffer.length - Math.max(1, stxBytes.length));
        }
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);

      const headerNeeded = lengthAt + lengthBytes;
      if (this.buffer.length < headerNeeded) return;

      let declared = 0;
      for (let i = 0; i < lengthBytes; i++) {
        const b = this.buffer[lengthAt + (lengthEndian === 'le' ? lengthBytes - 1 - i : i)] ?? 0;
        declared = declared * 256 + b;
      }

      const frameLength = lengthIncludes === 'frame' ? declared : headerNeeded + declared;
      if (frameLength <= 0 || frameLength > maxLength) {
        this.buffer = this.buffer.subarray(1); // ค่าความยาวเพี้ยน — หา STX ตัวถัดไป
        continue;
      }
      if (this.buffer.length < frameLength) return;

      const frame = this.buffer.slice(0, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      this.emitFrame(frame);
    }
  }

  private scanSilence(): void {
    if (this.spec.kind !== 'silence') return;
    const { silenceMs, maxLength } = this.spec;

    if (this.silenceTimer) clearTimeout(this.silenceTimer);

    if (this.buffer.length >= maxLength) {
      this.flushSilence();
      return;
    }
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.flushSilence();
    }, silenceMs);
  }

  private flushSilence(): void {
    if (this.buffer.length === 0) return;
    const frame = this.buffer.slice(0);
    this.buffer = new Uint8Array(0);
    this.emitFrame(frame);
  }

  private emitFrame(frame: Uint8Array): void {
    if (frame.length === 0) return;
    this.onFrame(frame);
  }
}

/** ถอด byte-stuffing: ESC X → X */
export function unescapeBytes(frame: Uint8Array, escape: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] === escape && i + 1 < frame.length) {
      i += 1;
      out.push(frame[i] as number);
    } else {
      out.push(frame[i] as number);
    }
  }
  return Uint8Array.from(out);
}

/** ใส่ byte-stuffing ให้ไบต์ที่ชนกับ STX/ETX/ESC */
export function escapeBytes(
  payload: Uint8Array,
  escape: number,
  reserved: number[],
): Uint8Array {
  const needsEscape = new Set([escape, ...reserved]);
  const out: number[] = [];
  for (const b of payload) {
    if (needsEscape.has(b)) out.push(escape);
    out.push(b);
  }
  return Uint8Array.from(out);
}
