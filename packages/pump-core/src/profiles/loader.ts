import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProtocolProfile } from '@fuel-pos/shared';

export class ProfileValidationError extends Error {
  constructor(
    readonly file: string,
    readonly problems: string[],
  ) {
    super(`โปรไฟล์ "${file}" ไม่ถูกต้อง:\n- ${problems.join('\n- ')}`);
    this.name = 'ProfileValidationError';
  }
}

/**
 * โฟลเดอร์โปรไฟล์ที่มากับโปรแกรม
 *
 * ตั้ง FUEL_POS_BUILTIN_PROFILES ทับได้ สำหรับตอนแพ็กโปรแกรม
 * ซึ่งไฟล์อาจไม่ได้อยู่ในตำแหน่งเดียวกับซอร์ส
 */
export function builtinProfileDir(): string {
  if (process.env.FUEL_POS_BUILTIN_PROFILES) {
    return path.resolve(process.env.FUEL_POS_BUILTIN_PROFILES);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/profiles/loader.js → ../../profiles
  return path.resolve(here, '..', '..', 'profiles');
}

/**
 * รับค่าไบต์ได้ทั้ง 2, "0x02" และ "02" เพื่อให้ไฟล์ profile อ่านง่าย
 */
function normalizeByte(value: unknown, where: string, problems: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value.replace(/^0x/i, ''), 16);
    if (Number.isInteger(n) && n >= 0 && n <= 255) return n;
  }
  problems.push(`${where}: ต้องเป็นไบต์ 0-255 (ได้ ${JSON.stringify(value)})`);
  return 0;
}

function normalizeByteArray(value: unknown, where: string, problems: string[]): number[] {
  if (!Array.isArray(value)) {
    problems.push(`${where}: ต้องเป็น array ของไบต์`);
    return [];
  }
  return value.map((v, i) => normalizeByte(v, `${where}[${i}]`, problems));
}

/** แปลง/ตรวจสอบ JSON ดิบให้เป็น ProtocolProfile */
export function parseProfile(raw: unknown, source = '<memory>'): ProtocolProfile {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    throw new ProfileValidationError(source, ['ไฟล์ต้องเป็น JSON object']);
  }
  const p = raw as Record<string, any>;

  for (const key of [
    'id',
    'name',
    'serial',
    'framing',
    'checksum',
    'numbers',
    'addressing',
    'timing',
    'requests',
    'responses',
    'statusMap',
  ]) {
    if (p[key] === undefined) problems.push(`ขาดฟิลด์ "${key}"`);
  }

  if (p.framing && typeof p.framing === 'object') {
    const f = p.framing as Record<string, any>;
    if (f.kind === 'delimited') {
      f.stx = normalizeByteArray(f.stx, 'framing.stx', problems);
      f.etx = normalizeByteArray(f.etx, 'framing.etx', problems);
      if (f.escape != null) f.escape = normalizeByte(f.escape, 'framing.escape', problems);
      if (f.etx.length === 0) problems.push('framing.etx ของโหมด delimited ต้องมีอย่างน้อย 1 ไบต์');
    } else if (f.kind === 'length') {
      f.stx = normalizeByteArray(f.stx ?? [], 'framing.stx', problems);
    } else if (f.kind !== 'silence') {
      problems.push(`framing.kind ต้องเป็น delimited | length | silence (ได้ "${f.kind}")`);
    }
    if (typeof f.maxLength !== 'number' || f.maxLength <= 0) {
      problems.push('framing.maxLength ต้องเป็นจำนวนเต็มบวก');
    }
  }

  if (p.requests && typeof p.requests === 'object') {
    for (const [name, spec] of Object.entries(p.requests as Record<string, any>)) {
      if (!spec || typeof spec !== 'object') {
        problems.push(`requests.${name}: ต้องเป็น object`);
        continue;
      }
      if (spec.unsupported) continue;
      if (!Array.isArray(spec.tokens)) {
        problems.push(`requests.${name}.tokens: ต้องเป็น array`);
        continue;
      }
      spec.tokens.forEach((token: any, i: number) => {
        const where = `requests.${name}.tokens[${i}]`;
        if (token?.kind === 'const') {
          token.bytes = normalizeByteArray(token.bytes, `${where}.bytes`, problems);
        } else if (token?.kind === 'var') {
          if (!token.name) problems.push(`${where}.name: ต้องระบุชื่อตัวแปร`);
          if (!token.encoding) problems.push(`${where}.encoding: ต้องระบุรูปแบบตัวเลข`);
          if (typeof token.length !== 'number') problems.push(`${where}.length: ต้องเป็นตัวเลข`);
        } else if (token?.kind !== 'address') {
          problems.push(`${where}.kind ต้องเป็น const | address | var`);
        }
      });
    }
  }

  if (Array.isArray(p.responses)) {
    p.responses.forEach((resp: any, i: number) => {
      if (!Array.isArray(resp?.match) || resp.match.length === 0) {
        problems.push(`responses[${i}].match: ต้องมีเงื่อนไขอย่างน้อย 1 ข้อ`);
      } else {
        resp.match.forEach((cond: any, j: number) => {
          const where = `responses[${i}].match[${j}]`;
          if (typeof cond?.at !== 'number') problems.push(`${where}.at: ต้องเป็นตัวเลข`);
          cond.equals = normalizeByte(cond?.equals, `${where}.equals`, problems);
          if (cond.mask !== undefined) {
            cond.mask = normalizeByte(cond.mask, `${where}.mask`, problems);
          }
        });
      }
      if (!Array.isArray(resp?.fields)) {
        problems.push(`responses[${i}].fields: ต้องเป็น array`);
      } else {
        resp.fields.forEach((field: any, j: number) => {
          const where = `responses[${i}].fields[${j}]`;
          if (!field?.name) problems.push(`${where}.name: ต้องระบุชื่อฟิลด์`);
          if (typeof field?.at !== 'number') problems.push(`${where}.at: ต้องเป็นตัวเลข`);
          if (typeof field?.length !== 'number') problems.push(`${where}.length: ต้องเป็นตัวเลข`);
          if (!field?.encoding) problems.push(`${where}.encoding: ต้องระบุรูปแบบตัวเลข`);
          if (field?.mask !== undefined) {
            field.mask = normalizeByte(field.mask, `${where}.mask`, problems);
          }
        });
      }
    });
  }

  if (p.nozzlesPerPump === undefined) p.nozzlesPerPump = 2;
  if (p.pollGranularity === undefined) p.pollGranularity = 'per_nozzle';

  if (problems.length > 0) throw new ProfileValidationError(source, problems);
  return p as ProtocolProfile;
}

/** โหลดโปรไฟล์ทั้งหมดจากหลายโฟลเดอร์ (built-in + ของผู้ใช้) */
export async function loadProfiles(dirs: string[]): Promise<{
  profiles: Map<string, ProtocolProfile>;
  errors: { file: string; message: string }[];
}> {
  const profiles = new Map<string, ProtocolProfile>();
  const errors: { file: string; message: string }[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const text = await readFile(full, 'utf8');
        const profile = parseProfile(JSON.parse(text), file);
        // โปรไฟล์ของผู้ใช้ (โฟลเดอร์หลัง) เขียนทับ built-in ที่ id เดียวกันได้
        profiles.set(profile.id, profile);
      } catch (err) {
        errors.push({ file: full, message: (err as Error).message });
      }
    }
  }

  return { profiles, errors };
}
