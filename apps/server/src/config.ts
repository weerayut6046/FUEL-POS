import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SerialSettings } from '@fuel-pos/shared';

export interface BusConfig {
  id: string;
  /** ป้ายชื่อให้คนอ่าน เช่น "บัสลานหน้า" */
  label: string;
  /** id ของ protocol profile ที่ตู้บนบัสนี้ใช้ */
  profileId: string;
  connection:
    | { kind: 'serial'; path: string; serial?: Partial<SerialSettings> }
    | { kind: 'tcp'; host: string; port: number };
  enabled: boolean;
}

export interface AppConfig {
  /**
   *  - 'simulator' : ใช้ตู้จำลอง ไม่ต้องมีฮาร์ดแวร์ (สำหรับสาธิต/ฝึกพนักงาน/พัฒนา)
   *  - 'hardware'  : ต่อกับตู้จริงผ่านบัสที่กำหนดใน buses
   */
  mode: 'simulator' | 'hardware';
  http: { host: string; port: number };
  station: {
    name: string;
    branch: string;
    taxId: string;
    address: string;
    phone: string;
  };
  buses: BusConfig[];
  /** โฟลเดอร์เก็บ protocol profile ที่ผู้ใช้เขียนเอง (มีลำดับความสำคัญเหนือของที่มากับโปรแกรม) */
  profilesDir: string;
  /** ไฟล์ฐานข้อมูล */
  databaseFile: string;
  /** ตู้จำลอง: จำนวนตู้และหัวจ่ายต่อตู้ */
  simulator: { pumps: number; nozzlesPerPump: number };
}

/** โฟลเดอร์เก็บข้อมูลของระบบ (แก้ได้ด้วยตัวแปรแวดล้อม FUEL_POS_DATA) */
export function dataDir(): string {
  if (process.env.FUEL_POS_DATA) return path.resolve(process.env.FUEL_POS_DATA);
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/config.js → ../../../../data (รากของ repo)
  return path.resolve(here, '..', '..', '..', 'data');
}

export const DEFAULT_CONFIG: AppConfig = {
  // เริ่มที่โหมดจำลองเสมอ เพื่อให้เปิดใช้งานได้ทันทีโดยไม่ต้องมีตู้ต่ออยู่
  mode: 'simulator',
  http: { host: '0.0.0.0', port: 4000 },
  station: {
    name: 'สถานีบริการน้ำมัน',
    branch: 'สำนักงานใหญ่',
    taxId: '',
    address: '',
    phone: '',
  },
  buses: [
    {
      id: 'bus1',
      label: 'บัสตู้จ่าย (RS-485)',
      profileId: 'zb01-template',
      // Windows ใช้ COM3 / Linux ใช้ /dev/ttyUSB0 — แก้ให้ตรงกับเครื่องจริง
      connection: { kind: 'serial', path: process.platform === 'win32' ? 'COM3' : '/dev/ttyUSB0' },
      enabled: true,
    },
  ],
  profilesDir: path.join(dataDir(), 'profiles'),
  databaseFile: path.join(dataDir(), 'fuel-pos.db'),
  simulator: { pumps: 2, nozzlesPerPump: 2 },
};

export function configFile(): string {
  return path.join(dataDir(), 'config.json');
}

/** อ่านค่าตั้งค่า — สร้างไฟล์ค่าเริ่มต้นให้อัตโนมัติถ้ายังไม่มี */
export function loadConfig(): AppConfig {
  const file = configFile();
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    return { ...DEFAULT_CONFIG };
  }

  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    http: { ...DEFAULT_CONFIG.http, ...raw.http },
    station: { ...DEFAULT_CONFIG.station, ...raw.station },
    simulator: { ...DEFAULT_CONFIG.simulator, ...raw.simulator },
    buses: raw.buses ?? DEFAULT_CONFIG.buses,
  };
}

export function saveConfig(config: AppConfig): void {
  const file = configFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}
