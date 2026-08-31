/** ตัวช่วยจัดการไบต์/hex ที่ใช้ทั้งใน codec และหน้า Protocol Lab */

/** Buffer → "02 01 11 03" */
export function toHex(buf: Uint8Array, separator = ' '): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(separator);
}

/**
 * แปลง hex string เป็นไบต์ รับได้หลายรูปแบบ:
 *   "02 01 11"  "0201 11"  "0x02,0x01"  "02-01-11"
 */
export function fromHex(text: string): Uint8Array {
  const cleaned = text
    .replace(/0x/gi, '')
    .replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new Error(`hex string มีจำนวนตัวอักษรเป็นเลขคี่: "${text}"`);
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** แสดงไบต์เป็น ASCII โดยแทนอักขระที่พิมพ์ไม่ได้ด้วยจุด — ช่วยดูโปรโตคอลแบบ ASCII */
export function toPrintable(buf: Uint8Array): string {
  return Array.from(buf, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
}

/** แปลง index ติดลบ (นับจากท้าย แบบ Python) เป็น index จริง */
export function resolveIndex(index: number, length: number): number {
  return index < 0 ? length + index : index;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** หา index แรกที่ pattern ปรากฏใน buf เริ่มค้นจาก start */
export function indexOfBytes(buf: Uint8Array, pattern: Uint8Array, start = 0): number {
  if (pattern.length === 0) return start;
  outer: for (let i = start; i <= buf.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}
