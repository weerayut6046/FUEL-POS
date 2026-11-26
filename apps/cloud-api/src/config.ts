/**
 * ค่าตั้งระบบ อ่านจากตัวแปรสภาพแวดล้อม (environment variables)
 *
 * DATABASE_URL           ต่อด้วยบทบาท fuel_app (ไม่ใช่เจ้าของตาราง → RLS มีผล)
 * MIGRATION_DATABASE_URL ต่อด้วยบทบาท fuel_owner ใช้รัน migration เท่านั้น
 */

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  photoDir: string;
  /** อายุ token เข้าสู่ระบบ (วัน) — ยาวพอให้แอปหน้าลานใช้ออฟไลน์ได้ข้ามวัน */
  sessionDays: number;
  corsOrigins: string[] | true;
  line: {
    channelAccessToken: string | null;
    channelSecret: string | null;
  };
  /** รอบการทำงานของ worker ส่งแจ้งเตือน (มิลลิวินาที) — 0 = ไม่เริ่ม worker */
  notifyIntervalMs: number;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`ต้องตั้งค่าตัวแปร ${name}`);
}

export function loadConfig(): AppConfig {
  const cors = env('CORS_ORIGINS', '*');
  return {
    port: Number(env('PORT', '8080')),
    host: env('HOST', '0.0.0.0'),
    databaseUrl: env('DATABASE_URL', 'postgres://fuel_app:fuel_app@localhost:5432/fuel_saas'),
    photoDir: env('PHOTO_DIR', './data/photos'),
    sessionDays: Number(env('SESSION_DAYS', '30')),
    corsOrigins: cors === '*' ? true : cors.split(',').map((s) => s.trim()),
    line: {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || null,
      channelSecret: process.env.LINE_CHANNEL_SECRET || null,
    },
    notifyIntervalMs: Number(env('NOTIFY_INTERVAL_MS', '15000')),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
