import type { User } from '@fuel-pos/shared';
import type { AppConfig } from './config.js';
import { Database } from './db/index.js';
import { AuthService } from './services/auth.js';
import { CatalogService } from './services/catalog.js';
import { PumpService } from './services/pumps.js';
import { ReportService } from './services/reports.js';
import { SalesService } from './services/sales.js';
import { ShiftService } from './services/shift.js';

/** รวมบริการทั้งหมดไว้ที่เดียว ส่งต่อให้ route ต่าง ๆ ใช้ */
export interface AppContext {
  config: AppConfig;
  db: Database;
  auth: AuthService;
  catalog: CatalogService;
  sales: SalesService;
  shifts: ShiftService;
  reports: ReportService;
  pumps: PumpService;
}

export function createContext(config: AppConfig): AppContext {
  const db = new Database(config.databaseFile);
  const auth = new AuthService(db);
  const catalog = new CatalogService(db);
  const sales = new SalesService(db, catalog);
  const shifts = new ShiftService(db);
  const reports = new ReportService(db);
  const pumps = new PumpService(config, catalog, sales, shifts);

  return { config, db, auth, catalog, sales, shifts, reports, pumps };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** ผู้ใช้ที่ล็อกอินอยู่ (null ถ้ายังไม่ได้ล็อกอิน) */
    user: User | null;
  }
}
