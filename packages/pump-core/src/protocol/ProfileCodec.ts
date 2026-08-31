import type {
  ProtocolProfile,
  RequestName,
  RequestSpec,
  RequestVar,
  ResponseFieldSpec,
  ResponseSpec,
} from '@fuel-pos/shared';
import { concat, resolveIndex } from '../util/bytes.js';
import { applyChecksum, checksumWidth, verifyChecksum } from '../util/checksum.js';
import { decodeNumber, encodeNumber } from '../util/numbers.js';
import { escapeBytes, unescapeBytes } from '../framing/Framer.js';

export type RequestVars = Partial<Record<RequestVar, number>>;

export interface DecodedResponse {
  /** ชื่อ ResponseSpec ที่จับคู่ได้ */
  name: string;
  /** address ของตู้ที่ตอบมา */
  address: number;
  /** ค่าที่ถอดได้ แปลงเป็นหน่วยภายในระบบแล้ว (มิลลิลิตร / สตางค์) */
  fields: Partial<Record<ResponseFieldSpec['name'], number>>;
  /** ค่าดิบก่อนแปลงหน่วย — มีประโยชน์ตอน debug */
  raw: Partial<Record<ResponseFieldSpec['name'], number>>;
  frame: Uint8Array;
}

export class ProtocolError extends Error {
  constructor(
    message: string,
    readonly frame?: Uint8Array,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** ตัวคูณเพื่อแปลงหน่วยแสดงผล → หน่วยภายในระบบ */
const INTERNAL_MULTIPLIER: Record<ResponseFieldSpec['name'], number> = {
  nozzle: 1,
  status: 1,
  errorCode: 1,
  volume: 1000, // ลิตร → มิลลิลิตร
  totalizerVolume: 1000,
  amount: 100, // บาท → สตางค์
  totalizerAmount: 100,
  unitPrice: 100,
};

/**
 * ตัวเข้ารหัส/ถอดรหัสเฟรมตาม Protocol Profile
 *
 * แยกจาก transport และ framing โดยสิ้นเชิง จึงทดสอบด้วย unit test ได้ครบ
 * โดยไม่ต้องมีพอร์ตอนุกรมจริง
 */
export class ProfileCodec {
  constructor(readonly profile: ProtocolProfile) {}

  /** โปรไฟล์รองรับคำสั่งนี้หรือไม่ */
  supports(name: RequestName): boolean {
    const spec = this.profile.requests[name];
    return !!spec && !spec.unsupported;
  }

  /**
   * ประกอบเฟรมคำสั่ง
   * @param vars ค่าตัวแปรใน "หน่วยดิบของโปรโตคอล" แล้ว (ProfileDriver แปลงมาให้)
   */
  buildRequest(name: RequestName, address: number, vars: RequestVars = {}): Uint8Array {
    const spec = this.profile.requests[name];
    if (!spec || spec.unsupported) {
      throw new ProtocolError(`โปรไฟล์ "${this.profile.id}" ไม่รองรับคำสั่ง "${name}"`);
    }

    const payload = this.buildPayload(spec, address, vars, name);
    return this.wrapFrame(payload);
  }

  private buildPayload(
    spec: RequestSpec,
    address: number,
    vars: RequestVars,
    name: RequestName,
  ): Uint8Array {
    const parts: Uint8Array[] = [];

    for (const token of spec.tokens) {
      switch (token.kind) {
        case 'const':
          parts.push(Uint8Array.from(token.bytes));
          break;
        case 'address':
          parts.push(Uint8Array.of((address + this.profile.addressing.offset) & 0xff));
          break;
        case 'var': {
          const value = vars[token.name];
          if (value === undefined) {
            throw new ProtocolError(
              `คำสั่ง "${name}" ต้องการตัวแปร "${token.name}" แต่ไม่ได้ส่งมา`,
            );
          }
          const scaled = Math.round(value * (token.scale ?? 1)) + (token.offset ?? 0);
          parts.push(encodeNumber(scaled, token.length, token.encoding));
          break;
        }
      }
    }
    return concat(...parts);
  }

  /** ห่อ payload ด้วย STX/ETX/ความยาว/checksum ตาม framing spec */
  private wrapFrame(payloadIn: Uint8Array): Uint8Array {
    const { framing, checksum } = this.profile;
    const width = checksumWidth(checksum.kind);
    const pad = new Uint8Array(width); // ที่ว่างสำหรับ checksum

    let frame: Uint8Array;

    switch (framing.kind) {
      case 'delimited': {
        // สำคัญ: คำนวณ checksum บนเฟรม "ก่อน" ทำ byte-stuffing เสมอ
        // เพราะฝั่งรับจะถอด stuffing ออกก่อนตรวจ checksum
        frame = concat(
          Uint8Array.from(framing.stx),
          payloadIn,
          pad,
          Uint8Array.from(framing.etx),
        );
        return this.escapeFrame(applyChecksum(frame, checksum));
      }
      case 'length': {
        const stx = Uint8Array.from(framing.stx);
        const lenBytes = new Uint8Array(framing.lengthBytes);
        const provisional = concat(stx, lenBytes, payloadIn, pad);
        const declared =
          framing.lengthIncludes === 'frame'
            ? provisional.length
            : provisional.length - (framing.lengthAt + framing.lengthBytes);
        for (let i = 0; i < framing.lengthBytes; i++) {
          const shift = framing.lengthEndian === 'le' ? i : framing.lengthBytes - 1 - i;
          provisional[framing.lengthAt + i] = (declared >>> (8 * shift)) & 0xff;
        }
        frame = provisional;
        break;
      }
      case 'silence':
        frame = concat(payloadIn, pad);
        break;
    }

    return applyChecksum(frame, checksum);
  }

  /** ตรวจ checksum ของเฟรมที่รับมา */
  verify(frame: Uint8Array): boolean {
    return verifyChecksum(frame, this.profile.checksum);
  }

  /**
   * ถอด byte-stuffing ออกจากเฟรมดิบที่อ่านได้จากสาย
   *
   * ปกติไม่ต้องเรียกเอง เพราะ Framer ถอดให้แล้วก่อนส่งต่อ
   * มีไว้สำหรับหน้า Protocol Lab และเทสต์ที่ทำงานกับไบต์บนสายโดยตรง
   */
  unescape(frame: Uint8Array): Uint8Array {
    const f = this.profile.framing;
    if (f.kind !== 'delimited' || f.escape == null) return frame;
    return unescapeBytes(frame, f.escape);
  }

  /**
   * ถอดรหัสเฟรม "คำสั่ง" กลับเป็นชื่อคำสั่ง + ค่าตัวแปร
   *
   * ใช้ 2 ที่:
   *  1. ตู้จำลอง (SimulatedDevice) เพื่อรู้ว่า POS สั่งอะไรมา
   *  2. หน้า Protocol Lab เพื่ออธิบายไบต์ที่ดักจับได้บนบัส
   */
  decodeRequest(
    frame: Uint8Array,
  ): { name: RequestName; address: number; vars: RequestVars } | null {
    const start = this.payloadStart();

    for (const [name, spec] of Object.entries(this.profile.requests)) {
      if (!spec || spec.unsupported) continue;
      const parsed = this.tryDecodeRequest(frame, start, spec);
      if (parsed) return { name: name as RequestName, ...parsed };
    }
    return null;
  }

  private tryDecodeRequest(
    frame: Uint8Array,
    start: number,
    spec: RequestSpec,
  ): { address: number; vars: RequestVars } | null {
    let offset = start;
    let address = 0;
    const vars: RequestVars = {};

    for (const token of spec.tokens) {
      switch (token.kind) {
        case 'const': {
          for (let i = 0; i < token.bytes.length; i++) {
            if (frame[offset + i] !== token.bytes[i]) return null;
          }
          offset += token.bytes.length;
          break;
        }
        case 'address': {
          if (offset >= frame.length) return null;
          address = ((frame[offset] as number) - this.profile.addressing.offset) & 0xff;
          offset += 1;
          break;
        }
        case 'var': {
          if (offset + token.length > frame.length) return null;
          let value: number;
          try {
            value = decodeNumber(frame, offset, token.length, token.encoding);
          } catch {
            return null;
          }
          vars[token.name] = Math.round((value - (token.offset ?? 0)) / (token.scale ?? 1));
          offset += token.length;
          break;
        }
      }
    }

    // ไบต์ที่เหลือต้องพอดีกับ checksum + ETX เท่านั้น
    const trailer = checksumWidth(this.profile.checksum.kind) + this.etxLength();
    if (offset + trailer !== frame.length) return null;
    return { address, vars };
  }

  /**
   * ประกอบเฟรม "คำตอบ" จาก ResponseSpec — ตรงข้ามกับ decode()
   * ใช้โดยตู้จำลอง ทำให้ทดสอบโปรไฟล์ที่เขียนขึ้นใหม่ได้ก่อนต่อฮาร์ดแวร์จริง
   */
  buildResponse(
    name: string,
    address: number,
    values: Partial<Record<ResponseFieldSpec['name'], number>>,
    /** ค่าดิบที่ไม่ต้องแปลงหน่วย (เช่น status) */
    rawValues: Partial<Record<ResponseFieldSpec['name'], number>> = {},
  ): Uint8Array {
    const spec = this.profile.responses.find((r) => r.name === name);
    if (!spec) {
      throw new ProtocolError(`โปรไฟล์ "${this.profile.id}" ไม่มี response ชื่อ "${name}"`);
    }

    const { framing, checksum, addressing } = this.profile;
    const addrAt = addressing.responseAt ?? addressing.at;
    const stx = framing.kind === 'silence' ? [] : framing.stx;
    const etxLen = this.etxLength();
    const csWidth = checksumWidth(checksum.kind);

    let bodyEnd = Math.max(stx.length, addrAt + 1);
    for (const cond of spec.match) bodyEnd = Math.max(bodyEnd, cond.at + 1);
    for (const field of spec.fields) bodyEnd = Math.max(bodyEnd, field.at + field.length);

    const frame = new Uint8Array(bodyEnd + csWidth + etxLen);
    frame.set(Uint8Array.from(stx), 0);
    frame[addrAt] = (address + addressing.offset) & 0xff;
    for (const cond of spec.match) frame[cond.at] = cond.equals & 0xff;

    for (const field of spec.fields) {
      const raw =
        rawValues[field.name] !== undefined
          ? (rawValues[field.name] as number)
          : this.toRawUnits(field, values[field.name] ?? 0);
      frame.set(encodeNumber(raw, field.length, field.encoding), field.at);
    }

    if (etxLen > 0 && framing.kind === 'delimited') {
      frame.set(Uint8Array.from(framing.etx), frame.length - etxLen);
      return this.escapeFrame(applyChecksum(frame, checksum));
    }
    if (framing.kind === 'length') {
      const declared =
        framing.lengthIncludes === 'frame'
          ? frame.length
          : frame.length - (framing.lengthAt + framing.lengthBytes);
      for (let i = 0; i < framing.lengthBytes; i++) {
        const shift = framing.lengthEndian === 'le' ? i : framing.lengthBytes - 1 - i;
        frame[framing.lengthAt + i] = (declared >>> (8 * shift)) & 0xff;
      }
    }

    return applyChecksum(frame, checksum);
  }

  /**
   * ทำ byte-stuffing ให้ไบต์ข้อมูลที่บังเอิญมีค่าเท่ากับ STX/ETX/ESC
   *
   * จำเป็นมากกับโปรโตคอลแบบ STX/ETX ที่ส่งข้อมูลไบนารี เช่น สถานะ "กำลังจ่าย" = 3
   * ซึ่งมีค่าเท่ากับ ETX (0x03) พอดี ถ้าไม่ทำ stuffing เฟรมจะถูกตัดกลางคัน
   */
  private escapeFrame(frame: Uint8Array): Uint8Array {
    const f = this.profile.framing;
    if (f.kind !== 'delimited' || f.escape == null) return frame;

    const stx = Uint8Array.from(f.stx);
    const etx = Uint8Array.from(f.etx);
    const middle = frame.subarray(stx.length, frame.length - etx.length);
    const escaped = escapeBytes(middle, f.escape, [...f.stx, ...f.etx]);
    return concat(stx, escaped, etx);
  }

  /** ตำแหน่งไบต์แรกของ payload (หลัง STX / ไบต์ความยาว) */
  private payloadStart(): number {
    const f = this.profile.framing;
    if (f.kind === 'silence') return 0;
    if (f.kind === 'length') return Math.max(f.stx.length, f.lengthAt + f.lengthBytes);
    return f.stx.length;
  }

  private etxLength(): number {
    const f = this.profile.framing;
    return f.kind === 'delimited' ? f.etx.length : 0;
  }

  private toRawUnits(field: ResponseFieldSpec, internal: number): number {
    const multiplier = INTERNAL_MULTIPLIER[field.name];
    if (multiplier === 1) return Math.round(internal);
    const divisor = field.divisor ?? 10 ** this.decimalsFor(field.name);
    return Math.round((internal * divisor) / multiplier);
  }

  /**
   * ถอดรหัสเฟรมที่ตู้ตอบกลับมา
   * คืน null ถ้าเฟรมนี้ไม่ตรงกับ response spec ใดเลย (เช่น เป็นเฟรมของตู้อื่นบนบัส)
   */
  decode(frame: Uint8Array): DecodedResponse | null {
    if (!this.verify(frame)) {
      throw new ProtocolError('checksum ไม่ถูกต้อง', frame);
    }

    const spec = this.matchResponse(frame);
    if (!spec) return null;

    const addrAt = resolveIndex(
      this.profile.addressing.responseAt ?? this.profile.addressing.at,
      frame.length,
    );
    const address = ((frame[addrAt] ?? 0) - this.profile.addressing.offset) & 0xff;

    const fields: DecodedResponse['fields'] = {};
    const raw: DecodedResponse['raw'] = {};

    for (const field of spec.fields) {
      const rawValue = this.readField(frame, field);
      raw[field.name] = rawValue;
      fields[field.name] = this.toInternalUnits(field, rawValue);
    }

    return { name: spec.name, address, fields, raw, frame };
  }

  private matchResponse(frame: Uint8Array): ResponseSpec | null {
    for (const spec of this.profile.responses) {
      const ok = spec.match.every((cond) => {
        const at = resolveIndex(cond.at, frame.length);
        if (at < 0 || at >= frame.length) return false;
        const actual = (frame[at] as number) & (cond.mask ?? 0xff);
        return actual === (cond.equals & (cond.mask ?? 0xff));
      });
      if (ok) return spec;
    }
    return null;
  }

  private readField(frame: Uint8Array, field: ResponseFieldSpec): number {
    const at = resolveIndex(field.at, frame.length);
    let value = decodeNumber(frame, at, field.length, field.encoding);
    if (field.mask !== undefined) value &= field.mask;
    if (field.shift !== undefined) value >>>= field.shift;
    return value;
  }

  /** แปลงค่าดิบเป็นหน่วยภายใน (มิลลิลิตร / สตางค์) แบบ integer ล้วน */
  private toInternalUnits(field: ResponseFieldSpec, rawValue: number): number {
    const multiplier = INTERNAL_MULTIPLIER[field.name];
    if (multiplier === 1) return rawValue;
    const divisor = field.divisor ?? 10 ** this.decimalsFor(field.name);
    return Math.round((rawValue * multiplier) / divisor);
  }

  private decimalsFor(name: ResponseFieldSpec['name']): number {
    const n = this.profile.numbers;
    switch (name) {
      case 'volume':
        return n.volumeDecimals;
      case 'amount':
        return n.amountDecimals;
      case 'unitPrice':
        return n.priceDecimals;
      case 'totalizerVolume':
        return n.totalizerVolumeDecimals;
      case 'totalizerAmount':
        return n.totalizerAmountDecimals;
      default:
        return 0;
    }
  }

  /** แปลงหน่วยภายใน → หน่วยดิบของโปรโตคอล (ใช้ตอนส่ง preset/ราคา) */
  toRawVolume(ml: number): number {
    return Math.round((ml * 10 ** this.profile.numbers.volumeDecimals) / 1000);
  }

  toRawAmount(satang: number): number {
    return Math.round((satang * 10 ** this.profile.numbers.amountDecimals) / 100);
  }

  toRawPrice(satangPerLitre: number): number {
    return Math.round((satangPerLitre * 10 ** this.profile.numbers.priceDecimals) / 100);
  }
}
