/**
 * ยืนยันว่าลูกค้ารายหนึ่งมองไม่เห็นและแก้ไขข้อมูลของอีกรายไม่ได้ — ทั้งผ่าน API และผ่าน SQL ตรง
 * (กติกาข้อ 4 ในแผน: ทุกตารางมี tenant_id และมีชุดทดสอบอัตโนมัติยืนยันการแยกข้อมูล)
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import pg from 'pg';

import { APP_URL, Harness, id, openShiftWithReadings, OWNER_URL, setupTenant, startHarness, TenantFixture } from './helpers.js';

let h: Harness;
let A: TenantFixture;
let B: TenantFixture;
const ids: Record<string, string> = {};

before(async () => {
  h = await startHarness();
  A = await setupTenant(h.api, h.db, 'pump-a');
  B = await setupTenant(h.api, h.db, 'pump-b');
  const { api } = h;

  // ใส่ข้อมูลให้ลูกค้า A ครบทุกประเภท
  const photo = id();
  const up = await api.call('PUT', `/photos/${photo}`, {
    token: A.staffToken,
    raw: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    headers: { 'content-type': 'image/jpeg' },
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  ids.photo = photo;

  ids.shift = await openShiftWithReadings(api, A, A.staffToken, '2026-11-20', 1, { n1: '1000', n2: '2000', n3: '3000' });
  for (const [n, v] of [['n1', '1100'], ['n2', '2050'], ['n3', '3010']] as const) {
    await api.post(`/shifts/${ids.shift}/readings`, { id: id(), nozzleId: A.nozzles[n], kind: 'close', reading: v, photoId: photo }, A.staffToken);
  }
  await api.post(`/shifts/${ids.shift}/pump-tests`, { id: id(), nozzleId: A.nozzles.n1, litres: '5' }, A.staffToken);
  await api.post(`/shifts/${ids.shift}/collections`, { id: id(), attendantId: A.staffId, method: 'cash', amountSatang: 100 }, A.staffToken);
  const sub = await api.post(`/shifts/${ids.shift}/submit`, {}, A.staffToken);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));

  const dip = await api.post(`/tanks/${A.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-20', levelMm: '1000' }, A.staffToken);
  assert.equal(dip.status, 201, JSON.stringify(dip.body));
  const del = await api.post(
    '/deliveries',
    { id: id(), tankId: A.tanks.b7, businessDate: '2026-11-20', invoiceLitres: '5000', documentNo: 'INV-1' },
    A.managerToken,
  );
  assert.equal(del.status, 201, JSON.stringify(del.body));
  ids.delivery = del.body.id;
  await api.post('/line/link-codes', {}, A.ownerToken);
  await api.post('/line/test', {}, A.ownerToken);
});

after(async () => {
  await h?.close();
});

describe('การแยกข้อมูลลูกค้า (multi-tenant)', () => {
  test('ทุกตารางมี tenant_id และเปิด Row-Level Security', async () => {
    const c = new pg.Client({ connectionString: OWNER_URL });
    await c.connect();
    try {
      const tables = await c.query<{ relname: string; rls: boolean; has_tenant: boolean }>(`
        SELECT c.relname, c.relrowsecurity AS rls,
               EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`);
      assert.ok(tables.rows.length > 20);
      for (const t of tables.rows) {
        assert.ok(t.rls, `ตาราง ${t.relname} ต้องเปิด RLS`);
        if (t.relname !== 'tenants') assert.ok(t.has_tenant, `ตาราง ${t.relname} ต้องมี tenant_id`);
      }
      // view ต้องใช้สิทธิ์ผู้เรียก ไม่งั้นจะข้าม RLS
      const views = await c.query<{ relname: string; opts: string[] | null }>(`
        SELECT c.relname, c.reloptions AS opts FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'`);
      for (const v of views.rows) {
        assert.ok(v.opts?.includes('security_invoker=true'), `view ${v.relname} ต้องเป็น security_invoker`);
      }
    } finally {
      await c.end();
    }
  });

  test('SQL ตรงด้วยบทบาทของ API: ลูกค้า B ไม่เห็นแถวของ A ในทุกตาราง และไม่ตั้ง tenant = ไม่เห็นอะไรเลย', async () => {
    const owner = new pg.Client({ connectionString: OWNER_URL });
    const app = new pg.Client({ connectionString: APP_URL });
    await owner.connect();
    await app.connect();
    try {
      const tables = (
        await owner.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'
           AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')`,
        )
      ).rows.map((r) => r.table_name);

      let checked = 0;
      for (const table of tables) {
        const total = Number((await owner.query(`SELECT count(*) FROM ${table} WHERE tenant_id = $1`, [A.tenantId])).rows[0].count);
        await app.query('BEGIN');
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [B.tenantId]);
        const seenByB = Number((await app.query(`SELECT count(*) FROM ${table} WHERE tenant_id = $1`, [A.tenantId])).rows[0].count);
        await app.query('ROLLBACK');
        await app.query('BEGIN');
        const noTenant = Number((await app.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
        await app.query('ROLLBACK');
        assert.equal(seenByB, 0, `${table}: B เห็นข้อมูล A`);
        assert.equal(noTenant, 0, `${table}: ไม่ตั้ง tenant แต่เห็นข้อมูล`);
        if (total > 0) checked++;
      }
      assert.ok(checked >= 18, `ต้องมีข้อมูลของ A ในตารางส่วนใหญ่ (มี ${checked})`);

      // tenants: B เห็นแค่ตัวเอง
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [B.tenantId]);
      const t = await app.query('SELECT id FROM tenants');
      await app.query('ROLLBACK');
      assert.deepEqual(t.rows.map((r) => r.id), [B.tenantId]);
    } finally {
      await owner.end();
      await app.end();
    }
  });

  test('SQL ตรง: B เขียนแถวที่ tenant_id เป็นของ A ไม่ได้ และอ้าง id ของ A ข้ามลูกค้าไม่ได้', async () => {
    const app = new pg.Client({ connectionString: APP_URL });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [B.tenantId]);
      await assert.rejects(
        app.query("INSERT INTO branches (tenant_id, code, name) VALUES ($1, 'X', 'แอบใส่')", [A.tenantId]),
        /row-level security/,
      );
      await app.query('ROLLBACK');

      // composite FK: tenant ของ B แต่ชี้ไปที่สาขาของ A
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [B.tenantId]);
      await assert.rejects(
        app.query(
          "INSERT INTO tanks (tenant_id, branch_id, code, name, fuel_type_id, capacity_litres) VALUES ($1, $2, 'X', 'X', $3, 100)",
          [B.tenantId, A.branchId, B.fuel.b7],
        ),
        /foreign key/,
      );
      await app.query('ROLLBACK');

      // แก้ไขแถวของ A ด้วย UPDATE → ไม่โดนแถวไหนเลย
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [B.tenantId]);
      const upd = await app.query("UPDATE branches SET name = 'ถูกแฮก' WHERE id = $1", [A.branchId]);
      await app.query('ROLLBACK');
      assert.equal(upd.rowCount, 0);
    } finally {
      await app.end();
    }
  });

  test('API: B เข้าถึงข้อมูลของ A ไม่ได้ทุกเส้นทาง', async () => {
    const { api } = h;
    const tok = B.ownerToken;
    const denied = [
      await api.get(`/branches/${A.branchId}/setup`, tok),
      await api.get(`/branches/${A.branchId}/shifts?from=2026-11-01&to=2026-11-30`, tok),
      await api.get(`/shifts/${ids.shift}`, tok),
      await api.get(`/branches/${A.branchId}/tanks`, tok),
      await api.get(`/branches/${A.branchId}/tank-status`, tok),
      await api.get(`/tanks/${A.tanks.b7}/dips?from=2026-11-01&to=2026-11-30`, tok),
      await api.get(`/tanks/${A.tanks.b7}/calibration`, tok),
      await api.get(`/branches/${A.branchId}/deliveries?from=2026-11-01&to=2026-11-30`, tok),
      await api.get(`/branches/${A.branchId}/prices`, tok),
      await api.get(`/photos/${ids.photo}`, tok),
      await api.get(`/dashboard?from=2026-11-01&to=2026-11-30&branchId=${A.branchId}`, tok),
    ];
    for (const r of denied) assert.ok([403, 404].includes(r.status), `ได้ ${r.status}: ${JSON.stringify(r.body)}`);

    const writes = [
      await api.post(`/branches/${A.branchId}/shifts`, { id: id(), businessDate: '2026-11-21', shiftNo: 1 }, tok),
      await api.post(`/shifts/${ids.shift}/readings`, { id: id(), nozzleId: A.nozzles.n1, kind: 'open', reading: '1' }, tok),
      await api.post(`/shifts/${ids.shift}/approve`, { acknowledgeWarnings: true, note: 'x' }, tok),
      await api.post(`/tanks/${A.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-21', levelMm: '10' }, tok),
      await api.post('/deliveries', { id: id(), tankId: A.tanks.b7, businessDate: '2026-11-21', invoiceLitres: '1' }, tok),
      await api.patch(`/branches/${A.branchId}`, { name: 'ถูกแฮก' }, tok),
      await api.patch(`/tanks/${A.tanks.b7}`, { name: 'ถูกแฮก' }, tok),
      await api.patch(`/nozzles/${A.nozzles.n1}`, { name: 'ถูกแฮก' }, tok),
      await api.patch(`/users/${A.staffId}`, { active: false }, tok),
      await api.post(`/branches/${A.branchId}/prices`, { items: [{ fuelTypeId: A.fuel.b7, priceSatang: 1 }] }, tok),
    ];
    for (const r of writes) assert.ok([403, 404].includes(r.status), `เขียนได้ ${r.status}: ${JSON.stringify(r.body)}`);

    // B สร้างถังของตัวเองแต่อ้างชนิดน้ำมันของ A → FK ข้ามลูกค้าไม่ผ่าน
    const cross = await api.post(
      `/branches/${B.branchId}/tanks`,
      { code: 'X9', name: 'X', fuelTypeId: A.fuel.b7, capacityLitres: '100' },
      tok,
    );
    assert.equal(cross.status, 400);

    // รายการของ B มีแต่ของ B
    const branches = await api.get('/branches', tok);
    assert.deepEqual(branches.body.map((b: { id: string }) => b.id), [B.branchId]);
    const users = await api.get('/users', tok);
    assert.ok(users.body.every((u: { id: string }) => u.id !== A.staffId));
    const fuels = await api.get('/fuel-types', tok);
    assert.ok(fuels.body.every((f: { id: string }) => f.id !== A.fuel.b7));

    // ข้อมูลของ A ไม่ถูกเปลี่ยน
    const mine = await api.get('/branches', A.ownerToken);
    assert.equal(mine.body[0].name, 'สาขาหลัก pump-a');
  });

  test('id ที่สร้างจากเครื่องซ้ำกับของลูกค้าอื่น → ไม่ทับและไม่รั่ว', async () => {
    const r = await h.api.post(`/branches/${B.branchId}/shifts`, { id: ids.shift, businessDate: '2026-11-21', shiftNo: 1 }, B.ownerToken);
    assert.equal(r.status, 409);
    assert.ok(!JSON.stringify(r.body).includes(A.branchId));
  });

  test('ข้อมูลตัวเลขแก้ไข/ลบไม่ได้ แม้ใช้ SQL ตรง', async () => {
    const app = new pg.Client({ connectionString: APP_URL });
    const owner = new pg.Client({ connectionString: OWNER_URL });
    await app.connect();
    await owner.connect();
    try {
      for (const sql of [
        'UPDATE meter_readings SET reading = 1',
        'DELETE FROM meter_readings',
        'UPDATE shift_collections SET amount_satang = 0',
        'DELETE FROM tank_dips',
        'UPDATE fuel_deliveries SET invoice_litres = 1',
        'UPDATE fuel_prices SET price_satang = 1',
        'DELETE FROM shifts',
      ]) {
        await app.query('BEGIN');
        await app.query("SELECT set_config('app.tenant_id', $1, true)", [A.tenantId]);
        await assert.rejects(app.query(sql), /permission denied/, sql);
        await app.query('ROLLBACK');
      }
      // ราคาที่ตรึงไว้ในกะแก้ไม่ได้ (แก้ได้แค่พนักงานที่รับผิดชอบ)
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.tenant_id', $1, true)", [A.tenantId]);
      await assert.rejects(app.query('UPDATE shift_nozzles SET price_satang = 1'), /permission denied/);
      await app.query('ROLLBACK');
      // แม้แต่เจ้าของตารางก็แก้ทับไม่ได้ (trigger)
      await assert.rejects(owner.query('UPDATE meter_readings SET reading = 1'), /เพิ่มอย่างเดียว/);
    } finally {
      await app.end();
      await owner.end();
    }
  });

  test('token ของลูกค้าที่ถูกระงับใช้ไม่ได้', async () => {
    const owner = new pg.Client({ connectionString: OWNER_URL });
    await owner.connect();
    try {
      await owner.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [B.tenantId]);
      const r = await h.api.get('/auth/me', B.ownerToken);
      assert.equal(r.status, 401);
      const login = await h.api.post('/auth/login', { tenant: 'pump-b', username: 'owner', password: 'owner-pass' });
      assert.equal(login.status, 403);
      await owner.query("UPDATE tenants SET status = 'trial' WHERE id = $1", [B.tenantId]);
    } finally {
      await owner.end();
    }
  });
});
