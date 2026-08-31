import type { ChecksumKind, ChecksumSpec } from '@fuel-pos/shared';
import { computeChecksum, checksumWidth } from '../util/checksum.js';
import { toHex } from '../util/bytes.js';

/**
 * เครื่องมือช่วยถอดรหัสโปรโตคอลจากข้อมูลที่ดักจับได้จริงบนบัส RS-485
 *
 * แนวทางใช้งาน (ดูละเอียดที่ docs/02-protocol-discovery.md):
 *   1. ต่อ USB-RS485 ขนานกับสายที่มีอยู่ แล้วดักจับข้อมูลด้วยหน้า Protocol Lab
 *   2. ใช้ guessFrameBoundaries หาไบต์เริ่ม/จบเฟรม
 *   3. ใช้ guessChecksum หาสูตร checksum
 *   4. ใช้ findVaryingColumns เทียบเฟรมตอน "ตู้ว่าง" กับ "ตู้กำลังจ่าย"
 *      เพื่อชี้ว่าไบต์ไหนคือปริมาตร/ยอดเงิน
 */

export interface ChecksumCandidate {
  kind: ChecksumKind;
  spec: ChecksumSpec;
  /** จำนวนเฟรมที่ผ่านการตรวจ */
  matched: number;
  total: number;
  description: string;
}

const ALL_KINDS: ChecksumKind[] = [
  'sum8',
  'sum8_2c',
  'xor8',
  'lrc',
  'crc8_maxim',
  'crc16_modbus',
  'crc16_ccitt_false',
];

/**
 * เดาสูตร checksum โดยลองทุกชุดค่าที่พบบ่อยกับเฟรมที่ดักจับได้
 * คืนเฉพาะสูตรที่ผ่าน "ทุกเฟรม" เรียงตามความน่าจะเป็น
 */
export function guessChecksum(frames: Uint8Array[]): ChecksumCandidate[] {
  const usable = frames.filter((f) => f.length >= 4);
  if (usable.length === 0) return [];

  const candidates: ChecksumCandidate[] = [];

  for (const kind of ALL_KINDS) {
    const width = checksumWidth(kind);
    // ตำแหน่ง checksum: ก่อน ETX 1 ไบต์ (-2), ท้ายสุด (-1), ก่อน ETX 2 ไบต์ (-3)
    for (const at of [-1 - width + 1, -2 - width + 1, -3 - width + 1]) {
      for (const from of [0, 1, 2]) {
        for (const endian of ['le', 'be'] as const) {
          if (width === 1 && endian === 'be') continue; // 1 ไบต์ ไม่มีเรื่อง endian
          const spec: ChecksumSpec = { kind, from, to: at, at, endian };
          let matched = 0;
          for (const frame of usable) {
            if (checkFrame(frame, spec, width)) matched++;
          }
          if (matched === usable.length) {
            candidates.push({
              kind,
              spec,
              matched,
              total: usable.length,
              description: describeSpec(spec, width),
            });
          }
        }
      }
    }
  }

  // สูตรที่ครอบคลุมไบต์มากกว่า น่าเชื่อถือกว่า (โอกาสบังเอิญตรงน้อยกว่า)
  return candidates.sort((a, b) => a.spec.from - b.spec.from);
}

function checkFrame(frame: Uint8Array, spec: ChecksumSpec, width: number): boolean {
  const at = spec.at < 0 ? frame.length + spec.at : spec.at;
  const to = spec.to < 0 ? frame.length + spec.to : spec.to;
  if (at < 0 || at + width > frame.length) return false;
  if (to <= spec.from || to > frame.length) return false;

  const expected = computeChecksum(spec.kind, frame.subarray(spec.from, to));
  const b0 = frame[at] as number;
  if (width === 1) return (expected & 0xff) === b0;
  const b1 = frame[at + 1] as number;
  const actual = spec.endian === 'le' ? b0 | (b1 << 8) : (b0 << 8) | b1;
  return (expected & 0xffff) === actual;
}

function describeSpec(spec: ChecksumSpec, width: number): string {
  const range = `ไบต์ที่ ${spec.from} ถึง ${spec.to}`;
  const pos = spec.at === -1 ? 'ไบต์สุดท้าย' : `ตำแหน่ง ${spec.at} จากท้าย`;
  const endian = width > 1 ? ` (${spec.endian === 'le' ? 'low byte ก่อน' : 'high byte ก่อน'})` : '';
  return `${spec.kind} ของ ${range} วางที่ ${pos}${endian}`;
}

// ---------------------------------------------------------------------------

export interface ColumnReport {
  index: number;
  /** ค่าที่พบทั้งหมดในตำแหน่งนี้ */
  values: number[];
  constant: boolean;
}

/**
 * เทียบเฟรมที่ยาวเท่ากันทีละคอลัมน์
 * คอลัมน์ที่ค่าคงที่ = STX/ETX/รหัสคำสั่ง/address
 * คอลัมน์ที่ค่าเปลี่ยน = ข้อมูล (ปริมาตร ยอดเงิน สถานะ)
 */
export function analyzeColumns(frames: Uint8Array[]): ColumnReport[] {
  if (frames.length === 0) return [];
  const length = frames[0]?.length ?? 0;
  const sameLength = frames.filter((f) => f.length === length);
  const reports: ColumnReport[] = [];

  for (let i = 0; i < length; i++) {
    const values = new Set<number>();
    for (const frame of sameLength) values.add(frame[i] as number);
    reports.push({
      index: i,
      values: [...values].sort((a, b) => a - b),
      constant: values.size === 1,
    });
  }
  return reports;
}

/** จัดกลุ่มเฟรมตามความยาว — โปรโตคอลส่วนใหญ่มีเฟรมไม่กี่ขนาด */
export function groupByLength(frames: Uint8Array[]): Map<number, Uint8Array[]> {
  const groups = new Map<number, Uint8Array[]>();
  for (const frame of frames) {
    const list = groups.get(frame.length) ?? [];
    list.push(frame);
    groups.set(frame.length, list);
  }
  return groups;
}

export interface BoundaryGuess {
  /** ไบต์ที่พบเป็นตัวแรกของบล็อกบ่อยที่สุด */
  stx: number;
  /** ไบต์ที่พบเป็นตัวสุดท้ายบ่อยที่สุด */
  etx: number;
  stxConfidence: number;
  etxConfidence: number;
}

/**
 * เดาไบต์เริ่ม/จบเฟรมจากข้อมูลดิบที่ดักจับมาเป็นบล็อก
 * (แต่ละบล็อก = ข้อมูลที่มาติดกันโดยไม่มีช่องว่างเวลา)
 */
export function guessFrameBoundaries(blocks: Uint8Array[]): BoundaryGuess | null {
  const usable = blocks.filter((b) => b.length >= 3);
  if (usable.length === 0) return null;

  const firstCount = new Map<number, number>();
  const lastCount = new Map<number, number>();
  for (const block of usable) {
    const first = block[0] as number;
    const last = block[block.length - 1] as number;
    firstCount.set(first, (firstCount.get(first) ?? 0) + 1);
    lastCount.set(last, (lastCount.get(last) ?? 0) + 1);
  }

  const topFirst = [...firstCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const topLast = [...lastCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!topFirst || !topLast) return null;

  return {
    stx: topFirst[0],
    etx: topLast[0],
    stxConfidence: topFirst[1] / usable.length,
    etxConfidence: topLast[1] / usable.length,
  };
}

/** สรุปผลวิเคราะห์เป็นข้อความอ่านง่าย สำหรับแสดงในหน้า Protocol Lab */
export function summarize(frames: Uint8Array[]): string[] {
  const lines: string[] = [];
  const groups = groupByLength(frames);

  lines.push(`ดักจับได้ ${frames.length} เฟรม, ความยาวที่พบ: ${[...groups.keys()].join(', ')} ไบต์`);

  for (const [length, group] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`\n▸ เฟรมยาว ${length} ไบต์ (${group.length} เฟรม)`);
    const columns = analyzeColumns(group);
    const constants = columns.filter((c) => c.constant);
    lines.push(
      `  ไบต์ที่ค่าคงที่: ${
        constants.map((c) => `[${c.index}]=0x${(c.values[0] ?? 0).toString(16).padStart(2, '0')}`).join(' ') ||
        '(ไม่มี)'
      }`,
    );
    const varying = columns.filter((c) => !c.constant);
    lines.push(
      `  ไบต์ที่ค่าเปลี่ยน: ${varying.map((c) => c.index).join(', ') || '(ไม่มี)'}`,
    );
    lines.push(`  ตัวอย่าง: ${toHex(group[0] as Uint8Array)}`);

    const checksums = guessChecksum(group);
    if (checksums.length > 0) {
      lines.push('  สูตร checksum ที่เป็นไปได้:');
      for (const c of checksums.slice(0, 5)) lines.push(`    • ${c.description}`);
    } else {
      lines.push('  ไม่พบสูตร checksum ที่ตรงทุกเฟรม (อาจไม่มี checksum หรือใช้สูตรเฉพาะ)');
    }
  }

  return lines;
}
