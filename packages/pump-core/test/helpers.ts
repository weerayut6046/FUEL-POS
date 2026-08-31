import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProtocolProfile } from '@fuel-pos/shared';
import { parseProfile } from '../src/profiles/loader.js';

/**
 * หาโฟลเดอร์รากของแพ็กเกจ โดยไต่ขึ้นไปจนเจอโฟลเดอร์ profiles
 * (จำเป็นเพราะไฟล์เทสต์ถูกคอมไพล์ไปอยู่คนละความลึกกับซอร์ส)
 */
export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, 'profiles')) && existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('หาโฟลเดอร์รากของแพ็กเกจ pump-core ไม่พบ');
}

export async function loadProfileFile(name: string): Promise<ProtocolProfile> {
  const file = path.join(packageRoot(), 'profiles', name);
  return parseProfile(JSON.parse(await readFile(file, 'utf8')), name);
}

export const loadTemplateProfile = (): Promise<ProtocolProfile> =>
  loadProfileFile('zb01-template.json');

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
