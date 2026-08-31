import type { NumberEncoding } from '@fuel-pos/shared';

/**
 * ถอดรหัสตัวเลขจากไบต์ตามรูปแบบที่ profile กำหนด
 * ตู้จ่ายจีนส่วนใหญ่ใช้ BCD (packed) หรือ binary little-endian
 */
export function decodeNumber(
  buf: Uint8Array,
  at: number,
  length: number,
  encoding: NumberEncoding,
): number {
  if (at < 0 || at + length > buf.length) {
    throw new RangeError(
      `อ่านเลขนอกขอบเขตเฟรม: at=${at} len=${length} frameLen=${buf.length}`,
    );
  }
  const slice = buf.subarray(at, at + length);

  switch (encoding) {
    case 'bcd':
      return decodeBcd(slice, false);
    case 'bcd_le':
      return decodeBcd(slice, true);
    case 'ascii':
      return decodeAscii(slice);
    case 'u8':
      return slice[0] ?? 0;
    case 'u16le':
      return readUInt(slice, 2, true);
    case 'u16be':
      return readUInt(slice, 2, false);
    case 'u24le':
      return readUInt(slice, 3, true);
    case 'u24be':
      return readUInt(slice, 3, false);
    case 'u32le':
      return readUInt(slice, 4, true);
    case 'u32be':
      return readUInt(slice, 4, false);
    default: {
      const never: never = encoding;
      throw new Error(`ไม่รู้จัก encoding: ${String(never)}`);
    }
  }
}

/** เข้ารหัสตัวเลขเป็นไบต์ */
export function encodeNumber(
  value: number,
  length: number,
  encoding: NumberEncoding,
): Uint8Array {
  const v = Math.max(0, Math.round(value));

  switch (encoding) {
    case 'bcd':
      return encodeBcd(v, length, false);
    case 'bcd_le':
      return encodeBcd(v, length, true);
    case 'ascii':
      return encodeAscii(v, length);
    case 'u8':
      return Uint8Array.of(v & 0xff);
    case 'u16le':
      return writeUInt(v, 2, true);
    case 'u16be':
      return writeUInt(v, 2, false);
    case 'u24le':
      return writeUInt(v, 3, true);
    case 'u24be':
      return writeUInt(v, 3, false);
    case 'u32le':
      return writeUInt(v, 4, true);
    case 'u32be':
      return writeUInt(v, 4, false);
    default: {
      const never: never = encoding;
      throw new Error(`ไม่รู้จัก encoding: ${String(never)}`);
    }
  }
}

/** จำนวนไบต์ที่ encoding หนึ่ง ๆ ใช้ (0 = ต้องระบุ length เอง) */
export function encodingWidth(encoding: NumberEncoding): number {
  switch (encoding) {
    case 'u8':
      return 1;
    case 'u16le':
    case 'u16be':
      return 2;
    case 'u24le':
    case 'u24be':
      return 3;
    case 'u32le':
    case 'u32be':
      return 4;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------

function readUInt(slice: Uint8Array, width: number, little: boolean): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    const b = slice[little ? width - 1 - i : i] ?? 0;
    value = value * 256 + b;
  }
  return value;
}

function writeUInt(value: number, width: number, little: boolean): Uint8Array {
  const out = new Uint8Array(width);
  let v = value;
  for (let i = width - 1; i >= 0; i--) {
    out[little ? width - 1 - i : i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

/** BCD packed: ไบต์ 0x12 = เลข 12 */
function decodeBcd(slice: Uint8Array, littleEndian: boolean): number {
  let value = 0;
  const bytes = littleEndian ? Array.from(slice).reverse() : Array.from(slice);
  for (const b of bytes) {
    const hi = (b >> 4) & 0x0f;
    const lo = b & 0x0f;
    if (hi > 9 || lo > 9) {
      throw new Error(`ไบต์ 0x${b.toString(16)} ไม่ใช่ BCD ที่ถูกต้อง`);
    }
    value = value * 100 + hi * 10 + lo;
  }
  return value;
}

function encodeBcd(value: number, length: number, littleEndian: boolean): Uint8Array {
  const digits = length * 2;
  const text = String(value).padStart(digits, '0');
  if (text.length > digits) {
    throw new RangeError(`ค่า ${value} ใส่ใน BCD ${length} ไบต์ (${digits} หลัก) ไม่พอ`);
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const hi = Number(text[i * 2]);
    const lo = Number(text[i * 2 + 1]);
    out[i] = (hi << 4) | lo;
  }
  return littleEndian ? out.reverse() : out;
}

function decodeAscii(slice: Uint8Array): number {
  let text = '';
  for (const b of slice) {
    if (b >= 0x30 && b <= 0x39) text += String.fromCharCode(b);
    else if (b === 0x20 || b === 0x2e) continue; // เว้นวรรค/จุด ข้าม
    else throw new Error(`ไบต์ 0x${b.toString(16)} ไม่ใช่ตัวเลข ASCII`);
  }
  return text.length === 0 ? 0 : Number(text);
}

function encodeAscii(value: number, length: number): Uint8Array {
  const text = String(value).padStart(length, '0');
  if (text.length > length) {
    throw new RangeError(`ค่า ${value} ใส่ใน ASCII ${length} ไบต์ไม่พอ`);
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = text.charCodeAt(i);
  return out;
}
