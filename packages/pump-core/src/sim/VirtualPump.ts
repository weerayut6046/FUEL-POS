import type { NozzleStatus, PresetMode } from '@fuel-pos/shared';
import { calcAmount } from '@fuel-pos/shared';

export interface VirtualNozzleState {
  index: number;
  status: NozzleStatus;
  /** มิลลิลิตร */
  volume: number;
  /** สตางค์ */
  amount: number;
  /** สตางค์/ลิตร */
  unitPrice: number;
  presetMode: PresetMode;
  presetValue: number;
  /** มิเตอร์สะสม (มิลลิลิตร) — เดินขึ้นตลอดเวลาที่จ่าย เหมือนมิเตอร์จริง */
  totalizerVolume: number;
  totalizerAmount: number;
  /** หัวจ่ายถูกยกออกจากแท่นหรือยัง (จำลอง nozzle switch ขั้ว 11/12) */
  nozzleOut: boolean;
}

export interface VirtualPumpOptions {
  address: number;
  nozzleCount?: number;
  /** อัตราการจ่ายสูงสุด มิลลิลิตร/วินาที (RT-TG224 rated 45 ลิตร/นาที = 750) */
  maxFlowMlPerSec?: number;
  /** เวลาเร่งจนถึงอัตราสูงสุด (ms) จำลองการค่อย ๆ บีบคันโยก */
  rampMs?: number;
  /** ราคาเริ่มต้นของทุกหัวจ่าย สตางค์/ลิตร */
  initialPrice?: number;
  /** ราคาเริ่มต้นแยกรายหัวจ่าย (index 0 = หัวที่ 1) — ใช้เมื่อแต่ละหัวขายคนละชนิด */
  initialPrices?: number[];
  /** ค่ามิเตอร์สะสมเริ่มต้น (มิลลิลิตร) */
  initialTotalizer?: number;
}

/**
 * ตู้จ่ายเสมือน — จำลองพฤติกรรมบอร์ด ZB01-1 (1 บอร์ด = 2 หัวจ่าย)
 *
 * ใช้พัฒนา/สาธิต/ทดสอบ POS ได้ครบวงจรโดยไม่ต้องมีตู้จริง
 * และทำให้ integration test รันบน CI ได้
 */
export class VirtualPump {
  readonly address: number;
  readonly nozzles: VirtualNozzleState[] = [];
  private readonly maxFlow: number;
  private readonly rampMs: number;
  private readonly flowStartedAt: (number | null)[] = [];
  /**
   * นาฬิกาจำลองภายใน (ms) เดินเฉพาะตอนเรียก tick()
   * ไม่ผูกกับ Date.now() เพื่อให้ฟิสิกส์ทำซ้ำได้แน่นอนในเทสต์
   */
  private clock = 0;

  constructor(opts: VirtualPumpOptions) {
    this.address = opts.address;
    this.maxFlow = opts.maxFlowMlPerSec ?? 750;
    this.rampMs = opts.rampMs ?? 1500;
    const count = opts.nozzleCount ?? 2;

    for (let i = 1; i <= count; i++) {
      this.nozzles.push({
        index: i,
        status: 'idle',
        volume: 0,
        amount: 0,
        unitPrice: opts.initialPrices?.[i - 1] ?? opts.initialPrice ?? 3975,
        presetMode: 'none',
        presetValue: 0,
        totalizerVolume: opts.initialTotalizer ?? 0,
        totalizerAmount: 0,
        nozzleOut: false,
      });
      this.flowStartedAt.push(null);
    }
  }

  get(index: number): VirtualNozzleState {
    const n = this.nozzles[index - 1];
    if (!n) throw new Error(`ตู้ address ${this.address} ไม่มีหัวจ่ายลำดับ ${index}`);
    return n;
  }

  // -- คำสั่งจาก POS -------------------------------------------------------

  authorize(index: number, mode: PresetMode, value: number): void {
    const n = this.get(index);
    if (n.status === 'filling') throw new Error('หัวจ่ายกำลังจ่ายอยู่ ยกเลิกไม่ได้');
    if (n.status === 'complete') throw new Error('ยังมีรายการค้างชำระที่หัวจ่ายนี้');
    n.volume = 0;
    n.amount = 0;
    n.presetMode = mode;
    n.presetValue = value;
    n.status = n.nozzleOut ? 'nozzle_out' : 'authorized';
  }

  stop(index: number): void {
    const n = this.get(index);
    if (n.status === 'filling' || n.status === 'nozzle_out' || n.status === 'authorized') {
      n.status = n.volume > 0 ? 'complete' : 'idle';
      this.flowStartedAt[index - 1] = null;
    }
  }

  clear(index: number): void {
    const n = this.get(index);
    if (n.status !== 'complete' && n.status !== 'stopped') return;
    n.volume = 0;
    n.amount = 0;
    n.presetMode = 'none';
    n.presetValue = 0;
    n.status = n.nozzleOut ? 'nozzle_out' : 'idle';
  }

  setPrice(index: number, satangPerLitre: number): void {
    const n = this.get(index);
    if (n.status === 'filling') throw new Error('เปลี่ยนราคาขณะกำลังจ่ายไม่ได้');
    n.unitPrice = satangPerLitre;
  }

  // -- การกระทำทางกายภาพ (จำลองพนักงานหน้าลาน) ---------------------------

  /** ยกหัวจ่ายออกจากแท่น */
  liftNozzle(index: number): void {
    const n = this.get(index);
    n.nozzleOut = true;
    if (n.status === 'authorized') n.status = 'nozzle_out';
  }

  /** เก็บหัวจ่ายคืนแท่น — จบรายการถ้าจ่ายไปแล้ว */
  hangNozzle(index: number): void {
    const n = this.get(index);
    n.nozzleOut = false;
    this.flowStartedAt[index - 1] = null;
    if (n.status === 'filling' || n.status === 'nozzle_out') {
      n.status = n.volume > 0 ? 'complete' : 'idle';
      if (n.status === 'complete') n.volume = Math.round(n.volume);
    }
  }

  /** บีบ/ปล่อยคันโยก */
  setTrigger(index: number, pulled: boolean): void {
    const n = this.get(index);
    if (pulled) {
      if (n.status === 'nozzle_out') {
        n.status = 'filling';
        this.flowStartedAt[index - 1] = this.clock;
      }
    } else if (n.status === 'filling') {
      n.status = 'nozzle_out';
      this.flowStartedAt[index - 1] = null;
    }
  }

  // -- ฟิสิกส์ --------------------------------------------------------------

  /** เดินเวลาจำลองไปข้างหน้า deltaMs มิลลิวินาที */
  tick(deltaMs: number): void {
    this.clock += deltaMs;

    for (const n of this.nozzles) {
      if (n.status !== 'filling') continue;

      const startedAt = this.flowStartedAt[n.index - 1];
      const elapsed = startedAt == null ? this.rampMs : this.clock - startedAt;
      const rampFactor = Math.min(1, Math.max(0, elapsed / this.rampMs));
      let deltaMl = (this.maxFlow * rampFactor * deltaMs) / 1000;

      const remaining = this.remainingMl(n);
      if (remaining !== null && deltaMl >= remaining) {
        deltaMl = Math.max(0, remaining);
        this.advance(n, deltaMl);
        this.finish(n);
        continue;
      }
      this.advance(n, deltaMl);
    }
  }

  /** เดินทั้งปริมาตรรายการและมิเตอร์สะสมพร้อมกัน เหมือนมิเตอร์เชิงกลจริง */
  private advance(n: VirtualNozzleState, deltaMl: number): void {
    if (deltaMl <= 0) return;
    n.volume += deltaMl;
    n.totalizerVolume += deltaMl;
    const amountBefore = n.amount;
    n.amount = calcAmount(Math.round(n.volume), n.unitPrice);
    n.totalizerAmount += Math.max(0, n.amount - amountBefore);
  }

  private remainingMl(n: VirtualNozzleState): number | null {
    if (n.presetMode === 'volume') return n.presetValue - n.volume;
    if (n.presetMode === 'amount') {
      if (n.unitPrice <= 0) return null;
      return (n.presetValue * 1000) / n.unitPrice - n.volume;
    }
    return null;
  }

  private finish(n: VirtualNozzleState): void {
    n.volume = Math.round(n.volume);
    n.amount = calcAmount(n.volume, n.unitPrice);
    // ตู้จริงหยุดที่ยอดเงินที่ตั้งไว้พอดี (จอเงินเป็นตัวสั่งหยุด)
    // ไม่ใช่ยอดที่คำนวณย้อนจากปริมาตรที่ปัดเศษแล้ว
    if (n.presetMode === 'amount' && n.presetValue > 0) {
      n.totalizerAmount += n.presetValue - n.amount;
      n.amount = n.presetValue;
    }
    n.status = 'complete';
    this.flowStartedAt[n.index - 1] = null;
  }
}
