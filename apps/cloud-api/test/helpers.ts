process.env.NODE_ENV = 'test';

import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';

import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrator.js';
import type { LineClient } from '../src/notify/line.js';
import type { PhotoStorage } from '../src/photos/photos.js';
import { createTenant } from '../src/tenants/provisioning.js';

export const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://fuel_owner:fuel_owner@localhost:5432/fuel_saas_test';
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://fuel_app:fuel_app@localhost:5432/fuel_saas_test';

export class FakeLine implements LineClient {
  configured = true;
  pushes: { to: string; text: string }[] = [];
  replies: { token: string; text: string }[] = [];
  async push(to: string, text: string) {
    this.pushes.push({ to, text });
  }
  async reply(token: string, text: string) {
    this.replies.push({ token, text });
  }
}

export class MemoryStorage implements PhotoStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error('not found');
    return f;
  }
}

/** ล้างฐานข้อมูลทดสอบแล้วรัน migration ใหม่ทั้งหมด */
export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: OWNER_URL });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await migrate(OWNER_URL);
}

export function testConfig(): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: APP_URL,
    photoDir: '/nonexistent',
    sessionDays: 30,
    corsOrigins: true,
    line: { channelAccessToken: 'test-token', channelSecret: 'test-secret' },
    notifyIntervalMs: 0,
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
}

export class TestApi {
  constructor(readonly app: NestFastifyApplication) {}

  async call<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: Buffer } = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await this.app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url: `/api/v1${url}`,
        headers,
        ...(opts.raw ? { payload: opts.raw } : opts.body !== undefined ? { payload: opts.body as object } : {}),
      });
    let body: unknown = res.body;
    if ((res.headers['content-type'] ?? '').toString().includes('application/json')) body = res.json();
    return { status: res.statusCode, body: body as T };
  }

  get = <T = any>(url: string, token?: string) => this.call<T>('GET', url, { token });
  post = <T = any>(url: string, body: unknown, token?: string) => this.call<T>('POST', url, { body, token });
  put = <T = any>(url: string, body: unknown, token?: string) => this.call<T>('PUT', url, { body, token });
  patch = <T = any>(url: string, body: unknown, token?: string) => this.call<T>('PATCH', url, { body, token });

  async login(tenant: string, username: string, password: string): Promise<string> {
    const res = await this.post('/auth/login', { tenant, username, password });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.token as string;
  }
}

export interface TenantFixture {
  slug: string;
  tenantId: string;
  branchId: string;
  ownerToken: string;
  managerToken: string;
  staffToken: string;
  staffId: string;
  staff2Id: string;
  staff2Token: string;
  managerId: string;
  ownerId: string;
  fuel: { b7: string; g95: string };
  tanks: { b7: string; g95: string };
  nozzles: { n1: string; n2: string; n3: string };
}

/** ตารางแปลงระดับแบบง่าย: 0–2000 มม. ทุก 100 มม. ได้ 10 ลิตร/มม. (ถังสี่เหลี่ยม 20,000 ลิตร) */
export function linearCalibration(maxMm = 2000, litresPerMm = 10) {
  const points: { mm: string; litres: string }[] = [];
  for (let mm = 0; mm <= maxMm; mm += 100) points.push({ mm: `${mm}.0`, litres: `${mm * litresPerMm}.000` });
  return points;
}

/** สร้างลูกค้าพร้อมผู้ใช้ 3 บทบาท ถัง 2 ใบ หัวจ่าย 3 หัว และราคา */
export async function setupTenant(api: TestApi, db: Db, slug: string): Promise<TenantFixture> {
  const { tenantId, branchId, ownerId } = await createTenant(db, {
    slug,
    name: `ปั๊ม ${slug}`,
    branch: { code: 'HQ', name: `สาขาหลัก ${slug}` },
    owner: { username: 'owner', displayName: 'เจ้าของ', password: 'owner-pass' },
  });
  const ownerToken = await api.login(slug, 'owner', 'owner-pass');
  const fuels = (await api.get('/fuel-types', ownerToken)).body as { id: string; code: string }[];
  const b7 = fuels.find((f) => f.code === 'B7')!.id;
  const g95 = fuels.find((f) => f.code === 'G95')!.id;

  const mk = async (username: string, role: string, displayName: string) => {
    const r = await api.post('/users', { username, displayName, role, password: '1234', branchIds: [branchId] }, ownerToken);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.id as string;
  };
  const managerId = await mk('manager', 'manager', 'ผู้จัดการ');
  const staffId = await mk('somchai', 'staff', 'สมชาย');
  const staff2Id = await mk('somsri', 'staff', 'สมศรี');

  const tank = async (code: string, fuelTypeId: string) => {
    const r = await api.post(
      `/branches/${branchId}/tanks`,
      { code, name: `ถัง ${code}`, fuelTypeId, capacityLitres: '20000', reorderLitres: '3000' },
      ownerToken,
    );
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    const cal = await api.put(`/tanks/${r.body.id}/calibration`, { points: linearCalibration() }, ownerToken);
    if (cal.status !== 200) throw new Error(JSON.stringify(cal.body));
    return r.body.id as string;
  };
  const tB7 = await tank('T1', b7);
  const tG95 = await tank('T2', g95);

  const nozzle = async (code: string, fuelTypeId: string, tankId: string, dispenserNo: number) => {
    const r = await api.post(`/branches/${branchId}/nozzles`, { code, name: `หัว ${code}`, fuelTypeId, tankId, dispenserNo }, ownerToken);
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.id as string;
  };
  const n1 = await nozzle('1A', b7, tB7, 1);
  const n2 = await nozzle('1B', g95, tG95, 1);
  const n3 = await nozzle('2A', b7, tB7, 2);

  const effectiveAt = new Date(Date.now() - 3600_000).toISOString();
  const pr = await api.post(
    `/branches/${branchId}/prices`,
    {
      effectiveAt,
      items: [
        { fuelTypeId: b7, priceSatang: 3244 },
        { fuelTypeId: g95, priceSatang: 3785 },
      ],
    },
    ownerToken,
  );
  if (pr.status !== 201) throw new Error(JSON.stringify(pr.body));

  return {
    slug,
    tenantId,
    branchId,
    ownerId,
    ownerToken,
    managerId,
    managerToken: await api.login(slug, 'manager', '1234'),
    staffId,
    staffToken: await api.login(slug, 'somchai', '1234'),
    staff2Id,
    staff2Token: await api.login(slug, 'somsri', '1234'),
    fuel: { b7, g95 },
    tanks: { b7: tB7, g95: tG95 },
    nozzles: { n1, n2, n3 },
  };
}

export interface Harness {
  app: NestFastifyApplication;
  api: TestApi;
  db: Db;
  line: FakeLine;
  storage: MemoryStorage;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  await resetDatabase();
  const db = new Db(APP_URL, 5);
  const line = new FakeLine();
  const storage = new MemoryStorage();
  const app = await createApp(testConfig(), { db, lineClient: line, storage });
  return {
    app,
    api: new TestApi(app),
    db,
    line,
    storage,
    async close() {
      await app.close();
      await db.close();
    },
  };
}

export const id = () => randomUUID();

/** เปิดกะ จดมิเตอร์ต้นกะครบทุกหัว แล้วคืนรายละเอียดกะ */
export async function openShiftWithReadings(
  api: TestApi,
  t: TenantFixture,
  token: string,
  businessDate: string,
  shiftNo: number,
  opens: Record<keyof TenantFixture['nozzles'], string>,
) {
  const shiftId = id();
  const r = await api.post(`/branches/${t.branchId}/shifts`, { id: shiftId, businessDate, shiftNo }, token);
  if (r.status !== 201) throw new Error(`open shift: ${r.status} ${JSON.stringify(r.body)}`);
  for (const [key, reading] of Object.entries(opens)) {
    const nozzleId = t.nozzles[key as keyof TenantFixture['nozzles']];
    const rr = await api.post(`/shifts/${shiftId}/readings`, { id: id(), nozzleId, kind: 'open', reading }, token);
    if (rr.status !== 201) throw new Error(`reading: ${rr.status} ${JSON.stringify(rr.body)}`);
  }
  return shiftId;
}
