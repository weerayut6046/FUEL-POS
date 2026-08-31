import type { NozzleStatus, ProtocolProfile, RequestName } from '@fuel-pos/shared';
import type { Bus } from '../bus/Bus.js';
import { resolveIndex, toHex } from '../util/bytes.js';
import { ProfileCodec, ProtocolError, type RequestVars } from './ProfileCodec.js';
import { DriverError, type NozzleReading, type PresetRequest, type PumpDriver } from './PumpDriver.js';

/**
 * ไดรเวอร์ที่ทำงานตาม Protocol Profile (ไฟล์ JSON)
 *
 * นี่คือไดรเวอร์ที่ใช้กับตู้จริง เมื่อถอดรหัสโปรโตคอลของบอร์ด ZB01-1 ได้แล้ว
 * ให้แก้ไฟล์ profile ไม่ต้องแก้คลาสนี้
 */
export class ProfileDriver implements PumpDriver {
  private readonly codec: ProfileCodec;

  constructor(
    private readonly bus: Bus,
    readonly profile: ProtocolProfile,
  ) {
    this.codec = new ProfileCodec(profile);
  }

  get profileId(): string {
    return this.profile.id;
  }

  get nozzlesPerPump(): number {
    return this.profile.nozzlesPerPump;
  }

  supports(command: RequestName): boolean {
    return this.codec.supports(command);
  }

  async poll(address: number): Promise<NozzleReading[]> {
    if (this.profile.pollGranularity === 'per_pump') {
      const decoded = await this.send('status', address, {});
      return decoded ? [this.toReading(decoded)] : [];
    }

    const readings: NozzleReading[] = [];
    for (let nozzle = 1; nozzle <= this.profile.nozzlesPerPump; nozzle++) {
      const decoded = await this.send('status', address, { nozzle });
      if (decoded) readings.push({ ...this.toReading(decoded), nozzle });
    }
    return readings;
  }

  async readTotalizer(
    address: number,
    nozzle: number,
  ): Promise<{ volume: number; amount: number } | null> {
    if (!this.supports('readTotalizer')) return null;
    const decoded = await this.send('readTotalizer', address, { nozzle });
    if (!decoded) return null;
    return {
      volume: decoded.fields.totalizerVolume ?? 0,
      amount: decoded.fields.totalizerAmount ?? 0,
    };
  }

  async authorize(address: number, nozzle: number, preset: PresetRequest): Promise<void> {
    switch (preset.mode) {
      case 'amount': {
        if (!this.supports('presetAmount')) {
          throw new DriverError('โปรไฟล์นี้ไม่รองรับการตั้งยอดเงินล่วงหน้า', address, nozzle);
        }
        await this.send('presetAmount', address, {
          nozzle,
          preset: this.codec.toRawAmount(preset.value),
        });
        return;
      }
      case 'volume': {
        if (!this.supports('presetVolume')) {
          throw new DriverError('โปรไฟล์นี้ไม่รองรับการตั้งปริมาตรล่วงหน้า', address, nozzle);
        }
        await this.send('presetVolume', address, {
          nozzle,
          preset: this.codec.toRawVolume(preset.value),
        });
        return;
      }
      case 'none':
      case 'full':
      default: {
        if (!this.supports('authorize')) {
          throw new DriverError('โปรไฟล์นี้ไม่รองรับคำสั่ง authorize', address, nozzle);
        }
        await this.send('authorize', address, { nozzle });
      }
    }
  }

  async stop(address: number, nozzle: number): Promise<void> {
    await this.send('stop', address, { nozzle });
  }

  async clear(address: number, nozzle: number): Promise<void> {
    if (!this.supports('clear')) return;
    await this.send('clear', address, { nozzle });
  }

  async setPrice(address: number, nozzle: number, satangPerLitre: number): Promise<void> {
    if (!this.supports('setPrice')) {
      throw new DriverError('โปรไฟล์นี้ไม่รองรับการตั้งราคาจากส่วนกลาง', address, nozzle);
    }
    await this.send('setPrice', address, {
      nozzle,
      price: this.codec.toRawPrice(satangPerLitre),
    });
  }

  // -------------------------------------------------------------------------

  private async send(name: RequestName, address: number, vars: RequestVars) {
    const spec = this.profile.requests[name];
    if (!spec || spec.unsupported) {
      throw new DriverError(`โปรไฟล์ "${this.profile.id}" ไม่รองรับคำสั่ง "${name}"`, address);
    }

    const frame = this.codec.buildRequest(name, address, vars);
    const response = await this.bus.request(frame, {
      timeoutMs: this.profile.timing.responseTimeoutMs,
      expectResponse: spec.expectResponse,
      retries: this.profile.timing.retries,
      // บนบัส multi-drop ต้องกรองเฉพาะเฟรมที่มาจาก address ที่เราถาม
      matcher: (candidate) => this.isFromAddress(candidate, address),
    });

    if (!response) return null;

    try {
      return this.codec.decode(response);
    } catch (err) {
      if (err instanceof ProtocolError) {
        throw new DriverError(
          `ถอดรหัสคำตอบจากตู้ address ${address} ไม่สำเร็จ: ${err.message} [${toHex(response)}]`,
          address,
        );
      }
      throw err;
    }
  }

  private isFromAddress(frame: Uint8Array, address: number): boolean {
    const at = resolveIndex(
      this.profile.addressing.responseAt ?? this.profile.addressing.at,
      frame.length,
    );
    if (at < 0 || at >= frame.length) return false;
    return frame[at] === ((address + this.profile.addressing.offset) & 0xff);
  }

  private toReading(decoded: {
    fields: Partial<Record<string, number>>;
    raw: Partial<Record<string, number>>;
  }): NozzleReading {
    const rawStatus = decoded.raw.status ?? 0;
    return {
      nozzle: decoded.fields.nozzle ?? 1,
      status: this.mapStatus(rawStatus),
      volume: decoded.fields.volume ?? 0,
      amount: decoded.fields.amount ?? 0,
      unitPrice: decoded.fields.unitPrice ?? null,
      totalizerVolume: decoded.fields.totalizerVolume ?? null,
      totalizerAmount: decoded.fields.totalizerAmount ?? null,
      errorCode: decoded.fields.errorCode ?? null,
    };
  }

  private mapStatus(raw: number): NozzleStatus {
    return (
      this.profile.statusMap[String(raw)] ??
      this.profile.statusMap[`0x${raw.toString(16)}`] ??
      'error'
    );
  }
}
