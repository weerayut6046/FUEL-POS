import type { NozzleStatus, ProtocolProfile } from '@fuel-pos/shared';
import { Framer } from '../framing/Framer.js';
import { ProfileCodec } from '../protocol/ProfileCodec.js';
import type { LoopbackTransport } from '../transport/LoopbackTransport.js';
import { VirtualPump, type VirtualPumpOptions } from './VirtualPump.js';

/**
 * ตู้จ่ายเสมือนที่ "พูดโปรโตคอลจริง" ตาม Protocol Profile ที่กำหนด
 *
 * ต่างจาก SimulatorDriver ตรงที่ตัวนี้ทำงานผ่านชั้นสื่อสารครบทุกชั้น
 * (framing → checksum → codec → bus) จึงใช้:
 *   1. ทดสอบโปรไฟล์ที่เพิ่งเขียนขึ้น ว่าประกอบ/ถอดเฟรมได้จริงก่อนต่อตู้จริง
 *   2. เป็น integration test ของทั้ง stack บน CI
 */
export class SimulatedDevice {
  private readonly codec: ProfileCodec;
  private readonly framer: Framer;
  private readonly pumps = new Map<number, VirtualPump>();
  private readonly statusCodes: Map<NozzleStatus, number>;
  private ticker: NodeJS.Timeout | null = null;
  private lastTick = Date.now();

  constructor(
    readonly profile: ProtocolProfile,
    pumpConfigs: VirtualPumpOptions[],
    private readonly transport: LoopbackTransport,
    tickMs = 100,
  ) {
    this.codec = new ProfileCodec(profile);
    this.statusCodes = reverseStatusMap(profile.statusMap);

    for (const cfg of pumpConfigs) {
      this.pumps.set(cfg.address, new VirtualPump({ nozzleCount: profile.nozzlesPerPump, ...cfg }));
    }

    this.framer = new Framer(profile.framing, (frame) => this.handleFrame(frame));
    transport.attachPeer((bytes) => this.framer.push(bytes));

    this.lastTick = Date.now();
    this.ticker = setInterval(() => {
      const now = Date.now();
      const delta = now - this.lastTick;
      this.lastTick = now;
      for (const pump of this.pumps.values()) pump.tick(delta);
    }, tickMs);
    this.ticker.unref?.();
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.framer.dispose();
  }

  pump(address: number): VirtualPump | undefined {
    return this.pumps.get(address);
  }

  listPumps(): VirtualPump[] {
    return [...this.pumps.values()];
  }

  /** เดินฟิสิกส์ด้วยตัวเอง — ใช้ในเทสต์ที่ไม่อยากพึ่ง timer จริง */
  tick(deltaMs: number): void {
    for (const pump of this.pumps.values()) pump.tick(deltaMs);
  }

  // -------------------------------------------------------------------------

  private handleFrame(frame: Uint8Array): void {
    if (!this.codec.verify(frame)) return; // เฟรมเสีย — ตู้จริงก็เงียบเช่นกัน

    const request = this.codec.decodeRequest(frame);
    if (!request) return;

    const pump = this.pumps.get(request.address);
    if (!pump) return; // ไม่ใช่ address ของตู้นี้ — เงียบไว้ (multi-drop)

    const nozzleIndex = request.vars.nozzle ?? 1;
    let response: Uint8Array | null = null;

    try {
      switch (request.name) {
        case 'status':
          response = this.buildStatus(pump, nozzleIndex);
          break;

        case 'readTotalizer': {
          const n = pump.get(nozzleIndex);
          response = this.tryBuild('totalizer', pump.address, {
            nozzle: n.index,
            totalizerVolume: Math.round(n.totalizerVolume),
            totalizerAmount: Math.round(n.totalizerAmount),
          });
          break;
        }

        case 'authorize':
          pump.authorize(nozzleIndex, 'none', 0);
          response = this.buildAck(pump.address, 0);
          break;

        case 'presetAmount':
          pump.authorize(
            nozzleIndex,
            'amount',
            Math.round(((request.vars.preset ?? 0) * 100) / 10 ** this.profile.numbers.amountDecimals),
          );
          response = this.buildAck(pump.address, 0);
          break;

        case 'presetVolume':
          pump.authorize(
            nozzleIndex,
            'volume',
            Math.round(
              ((request.vars.preset ?? 0) * 1000) / 10 ** this.profile.numbers.volumeDecimals,
            ),
          );
          response = this.buildAck(pump.address, 0);
          break;

        case 'stop':
          pump.stop(nozzleIndex);
          response = this.buildAck(pump.address, 0);
          break;

        case 'clear':
          pump.clear(nozzleIndex);
          response = this.buildAck(pump.address, 0);
          break;

        case 'setPrice':
          pump.setPrice(
            nozzleIndex,
            Math.round(((request.vars.price ?? 0) * 100) / 10 ** this.profile.numbers.priceDecimals),
          );
          response = this.buildAck(pump.address, 0);
          break;

        default:
          response = this.buildAck(pump.address, 0);
      }
    } catch {
      response = this.buildAck(pump.address, 1); // ตู้ปฏิเสธคำสั่ง
    }

    if (response) this.transport.injectFromDevice(response);
  }

  private buildStatus(pump: VirtualPump, nozzleIndex: number): Uint8Array | null {
    const n = pump.get(nozzleIndex);
    return this.tryBuild(
      'status',
      pump.address,
      {
        nozzle: n.index,
        volume: Math.round(n.volume),
        amount: n.amount,
        unitPrice: n.unitPrice,
        totalizerVolume: Math.round(n.totalizerVolume),
        totalizerAmount: Math.round(n.totalizerAmount),
      },
      { status: this.statusCodes.get(n.status) ?? 0, nozzle: n.index },
    );
  }

  private buildAck(address: number, code: number): Uint8Array | null {
    return this.tryBuild('ack', address, {}, { errorCode: code });
  }

  private tryBuild(
    name: string,
    address: number,
    values: Record<string, number>,
    raw: Record<string, number> = {},
  ): Uint8Array | null {
    if (!this.profile.responses.some((r) => r.name === name)) return null;
    return this.codec.buildResponse(name, address, values as never, raw as never);
  }
}

/** สร้างตารางกลับด้าน: สถานะในระบบ → เลขที่ตู้ใช้ */
function reverseStatusMap(map: Record<string, NozzleStatus>): Map<NozzleStatus, number> {
  const out = new Map<NozzleStatus, number>();
  for (const [code, status] of Object.entries(map)) {
    const num = code.startsWith('0x') ? Number.parseInt(code, 16) : Number(code);
    if (!Number.isNaN(num) && !out.has(status)) out.set(status, num);
  }
  return out;
}
