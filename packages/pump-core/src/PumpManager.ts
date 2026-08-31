import { EventEmitter } from 'node:events';
import type { NozzleLiveState, NozzleStatus, PresetMode } from '@fuel-pos/shared';
import type { PumpDriver } from './protocol/PumpDriver.js';

export interface ManagedNozzle {
  nozzleId: number;
  /** ลำดับในตู้ (1 = A, 2 = B) */
  index: number;
  label: string;
  productId: number;
  enabled: boolean;
}

export interface ManagedPump {
  pumpId: number;
  name: string;
  address: number;
  busId: string;
  enabled: boolean;
  nozzles: ManagedNozzle[];
}

/** ข้อมูลรายการจ่ายที่จบแล้ว พร้อมให้ POS สร้างใบเสร็จ */
export interface CompletedFuelling {
  nozzleId: number;
  pumpId: number;
  productId: number;
  /** มิลลิลิตร */
  volume: number;
  /** สตางค์ */
  amount: number;
  /** สตางค์/ลิตร */
  unitPrice: number;
  totalizerStart: number;
  totalizerEnd: number;
  startedAt: number;
  endedAt: number;
}

export interface PumpManagerEvents {
  nozzle: [NozzleLiveState];
  transaction: [CompletedFuelling];
  error: [Error];
  /** ตู้เปลี่ยนสถานะออนไลน์/ออฟไลน์ */
  pumpAvailability: [{ pumpId: number; online: boolean }];
}

interface NozzleRuntime {
  state: NozzleLiveState;
  pump: ManagedPump;
  nozzle: ManagedNozzle;
  /** มิเตอร์ตอนเริ่มรายการ ใช้ตรวจสอบย้อนหลังว่าปริมาตรตรงกับมิเตอร์ */
  totalizerAtStart: number;
  startedAt: number;
  /** สถานะรอบก่อน ใช้จับ transition */
  previousStatus: NozzleStatus;
  /** รายการนี้ถูกส่งให้ POS แล้วหรือยัง (กันส่งซ้ำระหว่างรอชำระเงิน) */
  reported: boolean;
}

export interface PumpManagerOptions {
  pumps: ManagedPump[];
  /** ไดรเวอร์ต่อบัส: busId → driver */
  drivers: Map<string, PumpDriver>;
  pollIntervalMs?: number;
  /** จำนวน poll ที่ล้มเหลวติดกันก่อนถือว่าตู้ offline */
  offlineAfterFailures?: number;
  /** ราคาต่อลิตรของแต่ละสินค้า (สตางค์) ใช้คำนวณสำรองเมื่อตู้ไม่ส่งราคามา */
  priceLookup?: (productId: number) => number;
}

/**
 * ตัวประสานงานตู้จ่ายทั้งหมด
 *
 * หน้าที่:
 *  1. poll ทุกตู้เป็นรอบ ๆ แล้วแปลงเป็นสถานะสดที่ POS ใช้ได้ทันที
 *  2. ตรวจจับว่ารายการจ่ายจบเมื่อไร แล้วยิง event ให้ POS สร้างใบเสร็จ
 *  3. ล็อกหัวจ่ายไว้จนกว่าจะชำระเงิน (กันลูกค้ารายถัดไปจ่ายทับรายการค้าง)
 */
export class PumpManager extends EventEmitter<PumpManagerEvents> {
  private readonly runtimes = new Map<number, NozzleRuntime>();
  private readonly failureCount = new Map<number, number>();
  private readonly pumpOnline = new Map<number, boolean>();
  private readonly pumps: ManagedPump[];
  private readonly drivers: Map<string, PumpDriver>;
  private readonly pollIntervalMs: number;
  private readonly offlineAfterFailures: number;
  private readonly priceLookup: (productId: number) => number;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = true;

  constructor(opts: PumpManagerOptions) {
    super();
    this.setMaxListeners(50);
    this.pumps = opts.pumps;
    this.drivers = opts.drivers;
    this.pollIntervalMs = opts.pollIntervalMs ?? 400;
    this.offlineAfterFailures = opts.offlineAfterFailures ?? 3;
    this.priceLookup = opts.priceLookup ?? (() => 0);

    for (const pump of this.pumps) {
      this.pumpOnline.set(pump.pumpId, false);
      for (const nozzle of pump.nozzles) {
        this.runtimes.set(nozzle.nozzleId, {
          pump,
          nozzle,
          totalizerAtStart: 0,
          startedAt: 0,
          previousStatus: 'offline',
          reported: false,
          state: {
            nozzleId: nozzle.nozzleId,
            pumpId: pump.pumpId,
            label: nozzle.label,
            productId: nozzle.productId,
            status: 'offline',
            volume: 0,
            amount: 0,
            unitPrice: this.priceLookup(nozzle.productId),
            presetMode: 'none',
            presetValue: 0,
            totalizerVolume: 0,
            totalizerAmount: 0,
            pendingSaleId: null,
            updatedAt: 0,
            error: null,
          },
        });
      }
    }
  }

  // -- วงจรชีวิต -----------------------------------------------------------

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      void this.pollAll().finally(() => {
        if (this.stopped) return;
        this.timer = setTimeout(loop, this.pollIntervalMs);
        this.timer.unref?.();
      });
    };
    loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // -- อ่านสถานะ -----------------------------------------------------------

  snapshot(): NozzleLiveState[] {
    return [...this.runtimes.values()].map((r) => ({ ...r.state }));
  }

  getNozzle(nozzleId: number): NozzleLiveState | null {
    const rt = this.runtimes.get(nozzleId);
    return rt ? { ...rt.state } : null;
  }

  isPumpOnline(pumpId: number): boolean {
    return this.pumpOnline.get(pumpId) ?? false;
  }

  /** อัปเดตราคาที่ POS ถือไว้ (เรียกเมื่อผู้ใช้เปลี่ยนราคาสินค้า) */
  refreshPrices(): void {
    for (const rt of this.runtimes.values()) {
      if (rt.state.status === 'idle') {
        rt.state.unitPrice = this.priceLookup(rt.nozzle.productId);
      }
    }
  }

  // -- คำสั่งไปตู้ ----------------------------------------------------------

  async authorize(nozzleId: number, mode: PresetMode, value: number): Promise<void> {
    const rt = this.requireRuntime(nozzleId);
    if (rt.state.pendingSaleId !== null) {
      throw new Error(`หัวจ่าย ${rt.nozzle.label} ยังมีรายการค้างชำระ`);
    }
    if (rt.state.status === 'filling') {
      throw new Error(`หัวจ่าย ${rt.nozzle.label} กำลังจ่ายอยู่`);
    }
    const driver = this.requireDriver(rt.pump);
    await driver.authorize(rt.pump.address, rt.nozzle.index, { mode, value });

    rt.state.presetMode = mode;
    rt.state.presetValue = value;
    rt.state.status = 'authorized';
    rt.state.volume = 0;
    rt.state.amount = 0;
    rt.reported = false;
    rt.startedAt = Date.now();
    rt.totalizerAtStart = rt.state.totalizerVolume;
    this.emitNozzle(rt);
  }

  async stopNozzle(nozzleId: number): Promise<void> {
    const rt = this.requireRuntime(nozzleId);
    await this.requireDriver(rt.pump).stop(rt.pump.address, rt.nozzle.index);
  }

  /**
   * ปลดล็อกหัวจ่ายหลังชำระเงินเสร็จ — สั่ง clear ที่ตู้และล้างสถานะค้าง
   */
  async release(nozzleId: number): Promise<void> {
    const rt = this.requireRuntime(nozzleId);
    const driver = this.requireDriver(rt.pump);
    await driver.clear(rt.pump.address, rt.nozzle.index);
    rt.state.pendingSaleId = null;
    rt.state.presetMode = 'none';
    rt.state.presetValue = 0;
    rt.reported = false;
    this.emitNozzle(rt);
  }

  /** ผูกเลขที่รายการขายกับหัวจ่าย เพื่อล็อกไว้จนกว่าจะชำระเงิน */
  attachSale(nozzleId: number, saleId: number): void {
    const rt = this.runtimes.get(nozzleId);
    if (!rt) return;
    rt.state.pendingSaleId = saleId;
    this.emitNozzle(rt);
  }

  async setPrice(nozzleId: number, satangPerLitre: number): Promise<void> {
    const rt = this.requireRuntime(nozzleId);
    const driver = this.requireDriver(rt.pump);
    if (!driver.supports('setPrice')) return;
    await driver.setPrice(rt.pump.address, rt.nozzle.index, satangPerLitre);
    rt.state.unitPrice = satangPerLitre;
    this.emitNozzle(rt);
  }

  // -- วงรอบ poll -----------------------------------------------------------

  private async pollAll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const pump of this.pumps) {
        if (!pump.enabled) continue;
        await this.pollPump(pump);
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollPump(pump: ManagedPump): Promise<void> {
    const driver = this.drivers.get(pump.busId);
    if (!driver) {
      this.markOffline(pump, `ไม่พบไดรเวอร์ของบัส "${pump.busId}"`);
      return;
    }

    try {
      const readings = await driver.poll(pump.address);
      this.failureCount.set(pump.pumpId, 0);
      this.setOnline(pump, true);

      for (const reading of readings) {
        const nozzle = pump.nozzles.find((n) => n.index === reading.nozzle);
        if (!nozzle) continue;
        const rt = this.runtimes.get(nozzle.nozzleId);
        if (!rt) continue;
        this.applyReading(rt, reading);
      }
    } catch (err) {
      const failures = (this.failureCount.get(pump.pumpId) ?? 0) + 1;
      this.failureCount.set(pump.pumpId, failures);
      if (failures >= this.offlineAfterFailures) {
        this.markOffline(pump, (err as Error).message);
      }
    }
  }

  private applyReading(
    rt: NozzleRuntime,
    reading: {
      status: NozzleStatus;
      volume: number;
      amount: number;
      unitPrice: number | null;
      totalizerVolume: number | null;
      totalizerAmount: number | null;
      errorCode: number | null;
    },
  ): void {
    const prev = rt.previousStatus;
    const state = rt.state;
    const before = JSON.stringify(state);

    state.status = reading.status;
    state.volume = reading.volume;
    state.amount = reading.amount;
    if (reading.unitPrice !== null && reading.unitPrice > 0) state.unitPrice = reading.unitPrice;
    if (reading.totalizerVolume !== null) state.totalizerVolume = reading.totalizerVolume;
    if (reading.totalizerAmount !== null) state.totalizerAmount = reading.totalizerAmount;
    state.error = reading.errorCode ? `รหัสข้อผิดพลาดจากตู้: ${reading.errorCode}` : null;
    state.updatedAt = Date.now();

    // เริ่มรายการใหม่: จับค่ามิเตอร์ตั้งต้นไว้กระทบยอด
    const startingNow =
      (prev === 'idle' || prev === 'authorized' || prev === 'offline') &&
      (reading.status === 'filling' || reading.status === 'nozzle_out');
    if (startingNow) {
      rt.startedAt = Date.now();
      rt.totalizerAtStart = state.totalizerVolume - reading.volume;
      rt.reported = false;
    }

    // รายการจบ: แจ้ง POS ครั้งเดียวเท่านั้น
    const finishedNow =
      reading.status === 'complete' && prev !== 'complete' && !rt.reported && reading.volume > 0;
    if (finishedNow) {
      rt.reported = true;
      this.emit('transaction', {
        nozzleId: rt.nozzle.nozzleId,
        pumpId: rt.pump.pumpId,
        productId: rt.nozzle.productId,
        volume: reading.volume,
        amount: reading.amount,
        unitPrice: state.unitPrice,
        totalizerStart: rt.totalizerAtStart,
        totalizerEnd: state.totalizerVolume,
        startedAt: rt.startedAt || Date.now(),
        endedAt: Date.now(),
      });
    }

    rt.previousStatus = reading.status;
    if (JSON.stringify(state) !== before) this.emitNozzle(rt);
  }

  private markOffline(pump: ManagedPump, message: string): void {
    this.setOnline(pump, false);
    for (const nozzle of pump.nozzles) {
      const rt = this.runtimes.get(nozzle.nozzleId);
      if (!rt || rt.state.status === 'offline') continue;
      rt.state.status = 'offline';
      rt.state.error = message;
      rt.state.updatedAt = Date.now();
      rt.previousStatus = 'offline';
      this.emitNozzle(rt);
    }
  }

  private setOnline(pump: ManagedPump, online: boolean): void {
    if (this.pumpOnline.get(pump.pumpId) === online) return;
    this.pumpOnline.set(pump.pumpId, online);
    this.emit('pumpAvailability', { pumpId: pump.pumpId, online });
  }

  private emitNozzle(rt: NozzleRuntime): void {
    this.emit('nozzle', { ...rt.state });
  }

  private requireRuntime(nozzleId: number): NozzleRuntime {
    const rt = this.runtimes.get(nozzleId);
    if (!rt) throw new Error(`ไม่พบหัวจ่าย id ${nozzleId}`);
    return rt;
  }

  private requireDriver(pump: ManagedPump): PumpDriver {
    const driver = this.drivers.get(pump.busId);
    if (!driver) throw new Error(`ไม่พบไดรเวอร์ของบัส "${pump.busId}"`);
    return driver;
  }
}
