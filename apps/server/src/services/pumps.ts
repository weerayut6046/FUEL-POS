import { EventEmitter } from 'node:events';
import type { NozzleLiveState, PresetMode, ProtocolProfile, Sale } from '@fuel-pos/shared';
import {
  Bus,
  LoopbackTransport,
  ProfileDriver,
  PumpManager,
  SerialTransport,
  SimulatedDevice,
  TcpTransport,
  builtinProfileDir,
  loadProfiles,
  type ManagedPump,
  type PumpDriver,
  type Transport,
} from '@fuel-pos/pump-core';

import type { AppConfig, BusConfig } from '../config.js';
import type { CatalogService } from './catalog.js';
import type { SalesService } from './sales.js';
import type { ShiftService } from './shift.js';

export interface PumpServiceEvents {
  nozzle: [NozzleLiveState];
  sale: [Sale];
  busStatus: [{ busId: string; connected: boolean; error: string | null }];
  traffic: [{ busId: string; direction: 'tx' | 'rx'; bytes: Uint8Array; at: number }];
  log: [{ level: 'info' | 'warn' | 'error'; message: string }];
}

interface BusRuntime {
  config: BusConfig;
  bus: Bus;
  transport: Transport;
  driver: PumpDriver;
  profile: ProtocolProfile;
  /** ตู้จำลองที่ผูกกับบัสนี้ (เฉพาะโหมด simulator) */
  device: SimulatedDevice | null;
  connected: boolean;
  lastError: string | null;
}

/**
 * ชั้นเชื่อมระหว่างฮาร์ดแวร์ตู้จ่ายกับตรรกะธุรกิจของ POS
 *
 * เมื่อตู้แจ้งว่าจ่ายน้ำมันจบ ที่นี่คือจุดที่แปลงเหตุการณ์นั้น
 * ให้กลายเป็น "รายการรอชำระเงิน" ในฐานข้อมูล แล้วล็อกหัวจ่ายไว้จนกว่าจะเก็บเงิน
 */
export class PumpService extends EventEmitter<PumpServiceEvents> {
  private readonly buses = new Map<string, BusRuntime>();
  private profiles = new Map<string, ProtocolProfile>();
  private manager: PumpManager | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly catalog: CatalogService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftService,
  ) {
    super();
    this.setMaxListeners(100);
  }

  // -- เริ่ม/หยุด ระบบ ------------------------------------------------------

  async start(): Promise<void> {
    const loaded = await loadProfiles([builtinProfileDir(), this.config.profilesDir]);
    this.profiles = loaded.profiles;
    for (const err of loaded.errors) {
      this.emit('log', { level: 'warn', message: `โหลดโปรไฟล์ ${err.file} ไม่สำเร็จ: ${err.message}` });
    }

    const drivers = new Map<string, PumpDriver>();

    for (const busConfig of this.config.buses) {
      if (!busConfig.enabled) continue;
      try {
        const runtime = await this.createBus(busConfig);
        this.buses.set(busConfig.id, runtime);
        drivers.set(busConfig.id, runtime.driver);
      } catch (err) {
        this.emit('log', {
          level: 'error',
          message: `เปิดบัส "${busConfig.id}" ไม่สำเร็จ: ${(err as Error).message}`,
        });
      }
    }

    this.manager = new PumpManager({
      pumps: this.loadManagedPumps(),
      drivers,
      pollIntervalMs: this.defaultPollInterval(),
      priceLookup: (productId) => this.catalog.getProduct(productId)?.unitPrice ?? 0,
    });

    this.manager.on('nozzle', (state) => this.emit('nozzle', state));
    this.manager.on('transaction', (fuelling) => this.onFuellingComplete(fuelling));
    this.manager.on('error', (err) =>
      this.emit('log', { level: 'error', message: err.message }),
    );
    this.manager.on('pumpAvailability', ({ pumpId, online }) =>
      this.emit('log', {
        level: online ? 'info' : 'warn',
        message: online ? `ตู้จ่าย ${pumpId} ออนไลน์แล้ว` : `ติดต่อตู้จ่าย ${pumpId} ไม่ได้`,
      }),
    );

    this.manager.start();
  }

  async stop(): Promise<void> {
    this.manager?.stop();
    for (const runtime of this.buses.values()) {
      runtime.device?.dispose();
      await runtime.bus.close().catch(() => undefined);
    }
    this.buses.clear();
  }

  /** สร้างระบบใหม่ทั้งหมดหลังแก้ไขการตั้งค่าตู้จ่าย */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // -- สร้างบัส -------------------------------------------------------------

  private async createBus(busConfig: BusConfig): Promise<BusRuntime> {
    const profile = this.profiles.get(busConfig.profileId);
    if (!profile) {
      throw new Error(
        `ไม่พบ protocol profile "${busConfig.profileId}" (มีอยู่: ${[...this.profiles.keys()].join(', ') || 'ไม่มีเลย'})`,
      );
    }

    const serial = { ...profile.serial, ...(busConfig.connection.kind === 'serial' ? busConfig.connection.serial : {}) };

    let transport: Transport;
    let device: SimulatedDevice | null = null;

    if (this.config.mode === 'simulator') {
      // โหมดจำลอง: ต่อไดรเวอร์จริงเข้ากับตู้เสมือนผ่านบัสในหน่วยความจำ
      // ทุกไบต์ยังวิ่งผ่านชั้น framing/checksum เหมือนของจริง
      const loopback = new LoopbackTransport(busConfig.id, 5);
      transport = loopback;
      device = new SimulatedDevice(
        profile,
        this.simulatorPumpConfigs(busConfig.id),
        loopback,
        100,
      );
    } else if (busConfig.connection.kind === 'serial') {
      transport = new SerialTransport(busConfig.id, busConfig.connection.path, serial);
    } else {
      transport = new TcpTransport(busConfig.id, busConfig.connection.host, busConfig.connection.port);
    }

    const bus = new Bus(transport, profile.framing, profile.timing.interCommandDelayMs);
    const runtime: BusRuntime = {
      config: busConfig,
      bus,
      transport,
      driver: new ProfileDriver(bus, profile),
      profile,
      device,
      connected: false,
      lastError: null,
    };

    bus.on('traffic', (event) =>
      this.emit('traffic', { busId: busConfig.id, ...event }),
    );
    bus.on('open', () => {
      runtime.connected = true;
      runtime.lastError = null;
      this.emit('busStatus', { busId: busConfig.id, connected: true, error: null });
    });
    bus.on('close', () => {
      runtime.connected = false;
      this.emit('busStatus', { busId: busConfig.id, connected: false, error: runtime.lastError });
    });
    bus.on('error', (err) => {
      runtime.lastError = err.message;
      this.emit('busStatus', { busId: busConfig.id, connected: runtime.connected, error: err.message });
    });

    await bus.open();
    return runtime;
  }

  /** ตู้จำลองใช้ address ตามที่ตั้งไว้จริงในฐานข้อมูล เพื่อให้สลับโหมดได้ไร้รอยต่อ */
  private simulatorPumpConfigs(busId: string) {
    const pumps = this.catalog.listPumps().filter((p) => p.busId === busId);
    const nozzles = this.catalog.listNozzles();

    if (pumps.length === 0) {
      return Array.from({ length: this.config.simulator.pumps }, (_, i) => ({
        address: i + 1,
        nozzleCount: this.config.simulator.nozzlesPerPump,
      }));
    }

    return pumps.map((pump) => {
      const pumpNozzles = nozzles
        .filter((n) => n.pumpId === pump.id)
        .sort((a, b) => a.index - b.index);
      return {
        address: pump.address,
        nozzleCount: Math.max(1, pumpNozzles.length),
        // แต่ละหัวจ่ายในตู้เดียวกันมักขายคนละชนิด จึงต้องตั้งราคาแยกรายหัว
        initialPrices: pumpNozzles.map(
          (n) => this.catalog.getProduct(n.productId)?.unitPrice ?? 3975,
        ),
        // เริ่มมิเตอร์ที่ค่าไม่เป็นศูนย์ ให้เหมือนตู้ที่ใช้งานมาแล้ว
        initialTotalizer: 1_000_000 * pump.address,
      };
    });
  }

  private loadManagedPumps(): ManagedPump[] {
    const nozzles = this.catalog.listNozzles();
    return this.catalog.listPumps().map((pump) => ({
      pumpId: pump.id,
      name: pump.name,
      address: pump.address,
      busId: pump.busId,
      enabled: pump.enabled,
      nozzles: nozzles
        .filter((n) => n.pumpId === pump.id)
        .map((n) => ({
          nozzleId: n.id,
          index: n.index,
          label: n.label,
          productId: n.productId,
          enabled: n.enabled,
        })),
    }));
  }

  private defaultPollInterval(): number {
    const intervals = [...this.buses.values()].map((b) => b.profile.timing.pollIntervalMs);
    return intervals.length > 0 ? Math.min(...intervals) : 400;
  }

  // -- เหตุการณ์จากตู้ ------------------------------------------------------

  /**
   * ตู้แจ้งว่าจ่ายน้ำมันจบ → สร้างรายการรอชำระเงินทันที
   *
   * ทำทันทีโดยไม่รอให้พนักงานกดอะไร เพราะน้ำมันออกจากถังไปแล้วจริง ๆ
   * ถ้าไม่บันทึกตรงนี้ ยอดมิเตอร์กับยอดขายในระบบจะไม่ตรงกัน
   */
  private onFuellingComplete(fuelling: {
    nozzleId: number;
    pumpId: number;
    productId: number;
    volume: number;
    amount: number;
    unitPrice: number;
    totalizerStart: number;
    totalizerEnd: number;
    startedAt: number;
    endedAt: number;
  }): void {
    try {
      const sale = this.sales.createPending({
        shiftId: this.shifts.current()?.id ?? null,
        nozzleId: fuelling.nozzleId,
        pumpId: fuelling.pumpId,
        productId: fuelling.productId,
        volume: fuelling.volume,
        unitPrice: fuelling.unitPrice,
        amount: fuelling.amount,
        startedAt: new Date(fuelling.startedAt),
        endedAt: new Date(fuelling.endedAt),
        totalizerStart: fuelling.totalizerStart,
        totalizerEnd: fuelling.totalizerEnd,
      });

      this.manager?.attachSale(fuelling.nozzleId, sale.id);
      this.emit('sale', sale);
      this.emit('log', {
        level: 'info',
        message: `รายการใหม่ ${sale.docNo}: ${(sale.volume / 1000).toFixed(2)} ลิตร ${(sale.amount / 100).toFixed(2)} บาท`,
      });
    } catch (err) {
      this.emit('log', {
        level: 'error',
        message: `บันทึกรายการจากหัวจ่าย ${fuelling.nozzleId} ไม่สำเร็จ: ${(err as Error).message}`,
      });
    }
  }

  // -- คำสั่งจาก POS --------------------------------------------------------

  snapshot(): NozzleLiveState[] {
    return this.manager?.snapshot() ?? [];
  }

  getNozzle(nozzleId: number): NozzleLiveState | null {
    return this.manager?.getNozzle(nozzleId) ?? null;
  }

  async authorize(nozzleId: number, mode: PresetMode, value: number): Promise<void> {
    await this.requireManager().authorize(nozzleId, mode, value);
  }

  async stopNozzle(nozzleId: number): Promise<void> {
    await this.requireManager().stopNozzle(nozzleId);
  }

  /** ปลดล็อกหัวจ่ายหลังเก็บเงินเสร็จ */
  async release(nozzleId: number): Promise<void> {
    await this.requireManager().release(nozzleId);
  }

  /** ส่งราคาปัจจุบันของสินค้าไปยังหัวจ่ายทุกหัวที่ขายสินค้านั้น */
  async pushPrice(productId: number): Promise<{ nozzleId: number; ok: boolean; error?: string }[]> {
    const manager = this.requireManager();
    const product = this.catalog.requireProduct(productId);
    const results: { nozzleId: number; ok: boolean; error?: string }[] = [];

    for (const nozzle of this.catalog.listNozzles()) {
      if (nozzle.productId !== productId || !nozzle.enabled) continue;
      try {
        await manager.setPrice(nozzle.id, product.unitPrice);
        results.push({ nozzleId: nozzle.id, ok: true });
      } catch (err) {
        results.push({ nozzleId: nozzle.id, ok: false, error: (err as Error).message });
      }
    }

    if (results.length > 0 && results.every((r) => r.ok)) {
      this.catalog.markPricePushed(productId);
    }
    manager.refreshPrices();
    return results;
  }

  // -- สำหรับหน้า Protocol Lab และโหมดสาธิต --------------------------------

  listBuses(): {
    id: string;
    label: string;
    profileId: string;
    connected: boolean;
    error: string | null;
    describe: string;
  }[] {
    return [...this.buses.values()].map((runtime) => ({
      id: runtime.config.id,
      label: runtime.config.label,
      profileId: runtime.profile.id,
      connected: runtime.connected,
      error: runtime.lastError,
      describe: runtime.transport.describe(),
    }));
  }

  getBus(busId: string): BusRuntime | null {
    return this.buses.get(busId) ?? null;
  }

  listProfiles(): ProtocolProfile[] {
    return [...this.profiles.values()];
  }

  getProfile(id: string): ProtocolProfile | null {
    return this.profiles.get(id) ?? null;
  }

  /** ตู้จำลองทั้งหมด (โหมด simulator) — ใช้กดจำลองยกหัวจ่าย/บีบคันโยกจากหน้าจอ */
  simulatorDevices(): { busId: string; device: SimulatedDevice }[] {
    return [...this.buses.values()]
      .filter((r): r is BusRuntime & { device: SimulatedDevice } => r.device !== null)
      .map((r) => ({ busId: r.config.id, device: r.device }));
  }

  findSimulatedPump(pumpId: number) {
    const pump = this.catalog.listPumps().find((p) => p.id === pumpId);
    if (!pump) return null;
    const runtime = this.buses.get(pump.busId);
    return runtime?.device?.pump(pump.address) ?? null;
  }

  get isSimulator(): boolean {
    return this.config.mode === 'simulator';
  }

  private requireManager(): PumpManager {
    if (!this.manager) throw new Error('ระบบตู้จ่ายยังไม่พร้อมใช้งาน');
    return this.manager;
  }
}
