import type { ChecksumKind, ChecksumSpec } from '@fuel-pos/shared';
import { resolveIndex } from './bytes.js';

/** ผลรวมไบต์ ตัดเหลือ 8 บิต */
export function sum8(data: Uint8Array): number {
  let s = 0;
  for (const b of data) s = (s + b) & 0xff;
  return s;
}

/** ผลรวมไบต์แบบ two's complement (ผลบวกทั้งเฟรมรวม checksum = 0) */
export function sum8TwosComplement(data: Uint8Array): number {
  return (0x100 - sum8(data)) & 0xff;
}

export function xor8(data: Uint8Array): number {
  let x = 0;
  for (const b of data) x ^= b;
  return x;
}

/** LRC แบบ Modbus ASCII */
export function lrc(data: Uint8Array): number {
  return sum8TwosComplement(data);
}

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF) */
export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, ไม่ reflect) */
export function crc16CcittFalse(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/** CRC-8/MAXIM (Dallas/1-Wire, poly 0x8C reflected) */
export function crc8Maxim(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    let cur = b;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ cur) & 0x01;
      crc >>>= 1;
      if (mix) crc ^= 0x8c;
      cur >>>= 1;
    }
  }
  return crc & 0xff;
}

/** จำนวนไบต์ที่ checksum แต่ละแบบใช้ */
export function checksumWidth(kind: ChecksumKind): number {
  switch (kind) {
    case 'none':
      return 0;
    case 'crc16_modbus':
    case 'crc16_ccitt_false':
      return 2;
    default:
      return 1;
  }
}

export function computeChecksum(kind: ChecksumKind, data: Uint8Array): number {
  switch (kind) {
    case 'none':
      return 0;
    case 'sum8':
      return sum8(data);
    case 'sum8_2c':
      return sum8TwosComplement(data);
    case 'xor8':
      return xor8(data);
    case 'lrc':
      return lrc(data);
    case 'crc16_modbus':
      return crc16Modbus(data);
    case 'crc16_ccitt_false':
      return crc16CcittFalse(data);
    case 'crc8_maxim':
      return crc8Maxim(data);
    default: {
      const never: never = kind;
      throw new Error(`ไม่รู้จัก checksum kind: ${String(never)}`);
    }
  }
}

/** เขียน checksum ลงในเฟรม (แก้ไข frame ในที่) */
export function applyChecksum(frame: Uint8Array, spec: ChecksumSpec): Uint8Array {
  const width = checksumWidth(spec.kind);
  if (width === 0) return frame;

  const from = resolveIndex(spec.from, frame.length);
  const to = resolveIndex(spec.to, frame.length);
  const at = resolveIndex(spec.at, frame.length);
  const value = computeChecksum(spec.kind, frame.subarray(from, to));

  if (at + width > frame.length) {
    throw new Error(
      `ตำแหน่ง checksum (${at}) + ความกว้าง (${width}) เกินความยาวเฟรม (${frame.length})`,
    );
  }
  if (width === 1) {
    frame[at] = value & 0xff;
  } else if (spec.endian === 'le') {
    frame[at] = value & 0xff;
    frame[at + 1] = (value >>> 8) & 0xff;
  } else {
    frame[at] = (value >>> 8) & 0xff;
    frame[at + 1] = value & 0xff;
  }
  return frame;
}

/** ตรวจ checksum ของเฟรมที่รับมา */
export function verifyChecksum(frame: Uint8Array, spec: ChecksumSpec): boolean {
  const width = checksumWidth(spec.kind);
  if (width === 0) return true;

  const from = resolveIndex(spec.from, frame.length);
  const to = resolveIndex(spec.to, frame.length);
  const at = resolveIndex(spec.at, frame.length);
  if (from < 0 || to > frame.length || at + width > frame.length) return false;

  const expected = computeChecksum(spec.kind, frame.subarray(from, to));
  const b0 = frame[at] ?? 0;
  if (width === 1) return (expected & 0xff) === b0;

  const b1 = frame[at + 1] ?? 0;
  const actual = spec.endian === 'le' ? b0 | (b1 << 8) : (b0 << 8) | b1;
  return (expected & 0xffff) === actual;
}
