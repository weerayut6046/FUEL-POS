import type { RequestName } from '@fuel-pos/shared';
import { VirtualPump, type VirtualPumpOptions } from '../sim/VirtualPump.js';
import { DriverError, type NozzleReading, type PresetRequest, type PumpDriver } from './PumpDriver.js';

const SUPPORTED = new Set<RequestName>([
  'status',
  'readTotalizer',
  'authorize',
  'presetAmount',
  'presetVolume',
  'stop',
  'clear',
  'setPrice',
  'readPrice',
]);

/**
 * ไดรเวอร์สำหรับตู้จำลอง — มี API เหมือนไดรเวอร์จริงทุกประการ
 * ทำให้เปลี่ยนระหว่างโหมดสาธิตกับโหมดใช้งานจริงได้ด้วยการแก้ค่าตั้งค่าบรรทัดเดียว
 */
export class SimulatorDriver implements PumpDriver {
  readonly profileId = 'simulator';
  readonly nozzlesPerPump: number;
  private readonly pumps = new Map<number, VirtualPump>();
  private timer: NodeJS.Timeout | null = null;
  private lastTick = Date.now();

  constructor(
    pumpConfigs: VirtualPumpOptions[],
    /** ความถี่ในการเดินฟิสิกส์ (ms) */
    private readonly tickMs = 100,
  ) {
    if (pumpConfigs.length === 0) throw new Error('ต้องระบุตู้จำลองอย่างน้อย 1 ตู้');
    for (const cfg of pumpConfigs) {
      this.pumps.set(cfg.address, new VirtualPump(cfg));
    }
    this.nozzlesPerPump = pumpConfigs[0]?.nozzleCount ?? 2;
    this.start();
  }

  start(): void {
    if (this.timer) return;
    this.lastTick = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastTick;
      this.lastTick = now;
      for (const pump of this.pumps.values()) pump.tick(delta);
    }, this.tickMs);
    this.timer.unref?.();
  }

  stopSimulation(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** เข้าถึงตู้จำลองโดยตรง — ใช้จาก API สาธิต (ยกหัวจ่าย/บีบคันโยก) */
  pump(address: number): VirtualPump {
    const p = this.pumps.get(address);
    if (!p) throw new DriverError(`ไม่มีตู้จำลอง address ${address}`, address);
    return p;
  }

  listPumps(): VirtualPump[] {
    return [...this.pumps.values()];
  }

  supports(command: RequestName): boolean {
    return SUPPORTED.has(command);
  }

  async poll(address: number): Promise<NozzleReading[]> {
    return this.pump(address).nozzles.map((n) => ({
      nozzle: n.index,
      status: n.status,
      volume: Math.round(n.volume),
      amount: n.amount,
      unitPrice: n.unitPrice,
      totalizerVolume: Math.round(n.totalizerVolume),
      totalizerAmount: Math.round(n.totalizerAmount),
      errorCode: null,
    }));
  }

  async readTotalizer(
    address: number,
    nozzle: number,
  ): Promise<{ volume: number; amount: number }> {
    const n = this.pump(address).get(nozzle);
    return { volume: Math.round(n.totalizerVolume), amount: Math.round(n.totalizerAmount) };
  }

  async authorize(address: number, nozzle: number, preset: PresetRequest): Promise<void> {
    this.pump(address).authorize(nozzle, preset.mode, preset.value);
  }

  async stop(address: number, nozzle: number): Promise<void> {
    this.pump(address).stop(nozzle);
  }

  async clear(address: number, nozzle: number): Promise<void> {
    this.pump(address).clear(nozzle);
  }

  async setPrice(address: number, nozzle: number, satangPerLitre: number): Promise<void> {
    this.pump(address).setPrice(nozzle, satangPerLitre);
  }
}
