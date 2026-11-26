import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { NotifyWorker } from '../src/notify/line.js';
import { Harness, id, openShiftWithReadings, setupTenant, startHarness, TenantFixture } from './helpers.js';

let h: Harness;
let T: TenantFixture;

before(async () => {
  h = await startHarness();
  T = await setupTenant(h.api, h.db, 'stock');
  const code = await h.api.post('/line/link-codes', {}, T.ownerToken);
  await h.db.query("SELECT app_line_link($1, 'Cgroup', 'group', null)", [code.body.code]);
});

after(async () => {
  await h?.close();
});

/** ปิดกะหนึ่งกะ ขายดีเซลจากหัว 1A ตามลิตรที่กำหนด */
async function sellDiesel(date: string, shiftNo: number, open: string, close: string) {
  const s = await openShiftWithReadings(h.api, T, T.staffToken, date, shiftNo, { n1: open, n2: '0', n3: '0' });
  for (const [n, v] of [['n1', close], ['n2', '0'], ['n3', '0']] as const) {
    const r = await h.api.post(`/shifts/${s}/readings`, { id: id(), nozzleId: T.nozzles[n], kind: 'close', reading: v }, T.staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const sub = await h.api.post(`/shifts/${s}/submit`, {}, T.staffToken);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  return s;
}

describe('สต็อกน้ำมันในถัง', () => {
  test('วัดถัง: แปลงระดับเป็นลิตรด้วยตารางของถัง และหักน้ำก้นถัง', async () => {
    const r = await h.api.post(`/tanks/${T.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-01', levelMm: '1200.5', waterMm: '20' }, T.staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // 1200.5 มม. × 10 = 12,005 ลิตร − น้ำ 200 ลิตร
    assert.equal(r.body.dip.litres, '11805.000');
    assert.equal(r.body.reconciliation, null, 'วัดครั้งแรกยังเทียบยอดไม่ได้');
  });

  test('ระดับเกินตารางแปลง → ปฏิเสธ', async () => {
    const r = await h.api.post(`/tanks/${T.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-02', levelMm: '2500' }, T.staffToken);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'LEVEL_ABOVE_TABLE');
  });

  test('รับน้ำมัน: ผู้จัดการบันทึก พนักงานบันทึกไม่ได้ · คำนวณได้จริงเทียบใบส่ง', async () => {
    const staff = await h.api.post('/deliveries', { id: id(), tankId: T.tanks.b7, businessDate: '2026-11-02', invoiceLitres: '5000' }, T.staffToken);
    assert.equal(staff.status, 403);
    const r = await h.api.post(
      '/deliveries',
      {
        id: id(),
        tankId: T.tanks.b7,
        businessDate: '2026-11-02',
        invoiceLitres: '5000',
        documentNo: 'DO-001',
        supplier: 'คลังน้ำมัน',
        dipBeforeMm: '1000',
        dipAfterMm: '1495',
      },
      T.managerToken,
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.measuredLitres, '4950.000');
    assert.equal(r.body.receivedDiffLitres, '-50.000');
  });

  test('แก้รายการรับน้ำมัน = เพิ่มรายการใหม่ในสายเดียวกัน', async () => {
    const created = await h.api.post(
      '/deliveries',
      { id: id(), tankId: T.tanks.g95, businessDate: '2026-11-02', invoiceLitres: '3000', documentNo: 'DO-002' },
      T.managerToken,
    );
    const fixed = await h.api.post(
      '/deliveries',
      { id: id(), tankId: T.tanks.g95, businessDate: '2026-11-02', invoiceLitres: '3500', documentNo: 'DO-002', supersedesId: created.body.id, reason: 'พิมพ์ผิด' },
      T.managerToken,
    );
    assert.equal(fixed.status, 201, JSON.stringify(fixed.body));
    assert.equal(fixed.body.rootId, created.body.id);
    const voided = await h.api.post(
      '/deliveries',
      { id: id(), tankId: T.tanks.g95, businessDate: '2026-11-02', invoiceLitres: '0', voided: true, supersedesId: created.body.id, reason: 'ลงซ้ำ' },
      T.managerToken,
    );
    assert.equal(voided.status, 201, JSON.stringify(voided.body));
    assert.equal(voided.body.supersedesId, fixed.body.id, 'ต่อจากหัวสายเสมอ');
    const list = await h.api.get(`/branches/${T.branchId}/deliveries?from=2026-11-02&to=2026-11-02`, T.managerToken);
    const chain = list.body.filter((d: { rootId: string }) => d.rootId === created.body.id);
    assert.equal(chain.length, 3);
    assert.equal(chain.filter((d: { current: boolean }) => d.current).length, 1);
  });

  test('เทียบยอดตามบัญชีกับวัดจริง → แจ้งน้ำมันขาดเกินเกณฑ์', async () => {
    // วันที่ 2: ขาย 1,000 ลิตร รับ 5,000 ลิตร → บัญชี 11,805 + 5,000 − 1,000 = 15,805
    await sellDiesel('2026-11-02', 1, '50000', '51000');
    // วัดได้ 1575.0 มม. = 15,750 − น้ำ 0 → ขาด 55 ลิตร = 5.5% ของยอดขาย
    const r = await h.api.post(`/tanks/${T.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-02', levelMm: '1575' }, T.staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(
      {
        book: r.body.reconciliation.bookLitres,
        actual: r.body.reconciliation.actualLitres,
        variance: r.body.reconciliation.varianceLitres,
        pct: r.body.reconciliation.variancePercent,
      },
      { book: '15805.000', actual: '15750.000', variance: '-55.000', pct: '-5.50' },
    );

    const recon = await h.api.get(`/branches/${T.branchId}/tank-reconciliation?from=2026-11-01&to=2026-11-30`, T.managerToken);
    const b7 = recon.body.tanks.find((t: { tankId: string }) => t.tankId === T.tanks.b7);
    assert.equal(b7.rows.length, 1);
    assert.equal(b7.rows[0].salesLitres, '1000.000');
    assert.equal(b7.rows[0].deliveriesLitres, '5000.000');

    const stats = await h.app.get(NotifyWorker).runOnce();
    assert.ok(stats.sent >= 1);
    const msg = h.line.pushes.find((p) => p.text.includes('น้ำมันขาดเกินเกณฑ์'));
    assert.ok(msg, 'ต้องแจ้งน้ำมันขาด');
    assert.equal(msg.to, 'Cgroup');
    assert.match(msg.text, /ขาด 55\.00 ลิตร \(-5\.50% ของยอดขาย\)/);
  });

  test('แก้การวัดถัง: พนักงานต้องระบุเหตุผล ประวัติยังอยู่', async () => {
    const noReason = await h.api.post(`/tanks/${T.tanks.b7}/dips`, { id: id(), businessDate: '2026-11-02', levelMm: '1580' }, T.staffToken);
    assert.equal(noReason.status, 400);
    const ok = await h.api.post(
      `/tanks/${T.tanks.b7}/dips`,
      { id: id(), businessDate: '2026-11-02', levelMm: '1580', reason: 'วัดซ้ำ ไม้วัดเอียง' },
      T.staffToken,
    );
    assert.equal(ok.status, 201);
    assert.equal(ok.body.reconciliation.varianceLitres, '-5.000');
    const dips = await h.api.get(`/tanks/${T.tanks.b7}/dips?from=2026-11-02&to=2026-11-02`, T.staffToken);
    assert.equal(dips.body.length, 2);
    assert.equal(dips.body.filter((d: { current: boolean }) => d.current).length, 1);
  });

  test('ถึงจุดสั่ง → เตือนบน Dashboard และ LINE', async () => {
    // ขายอีก 13,000 ลิตร → เหลือตามบัญชี 15,800 − 13,000 = 2,800 < จุดสั่ง 3,000
    await sellDiesel('2026-11-03', 1, '51000', '64000');
    const status = await h.api.get(`/branches/${T.branchId}/tank-status`, T.staffToken);
    const b7 = status.body.find((t: { tankId: string }) => t.tankId === T.tanks.b7);
    assert.equal(b7.bookLitres, '2800.000');
    assert.equal(b7.belowReorder, true);
    assert.equal(b7.fillPercent, '14.00');

    const dash = await h.api.get('/dashboard?from=2026-11-01&to=2026-11-30', T.ownerToken);
    assert.ok(dash.body.alerts.some((a: { kind: string; refId: string }) => a.kind === 'reorder' && a.refId === T.tanks.b7));

    await h.app.get(NotifyWorker).runOnce();
    assert.ok(h.line.pushes.some((p) => p.text.includes('น้ำมันใกล้หมด') && p.text.includes('ถัง T1')));
  });

  test('ยังไม่มีตารางแปลง → วัดถังไม่ได้', async () => {
    const t = await h.api.post(
      `/branches/${T.branchId}/tanks`,
      { code: 'T9', name: 'ถังใหม่', fuelTypeId: T.fuel.g95, capacityLitres: '10000' },
      T.ownerToken,
    );
    const r = await h.api.post(`/tanks/${t.body.id}/dips`, { id: id(), businessDate: '2026-11-03', levelMm: '100' }, T.staffToken);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'NO_CALIBRATION');
  });
});

describe('รูปถ่ายและ LINE', () => {
  test('อัปโหลดรูปซ้ำด้วย id เดิมได้ (คิวออฟไลน์) และดาวน์โหลดได้เฉพาะลูกค้าเดียวกัน', async () => {
    const photoId = id();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const opts = { token: T.staffToken, raw: bytes, headers: { 'content-type': 'image/png' } };
    const a = await h.api.call('PUT', `/photos/${photoId}`, opts);
    const b = await h.api.call('PUT', `/photos/${photoId}`, opts);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const got = await h.api.call('GET', `/photos/${photoId}`, { token: T.ownerToken });
    assert.equal(got.status, 200);
    const other = await h.api.call('PUT', `/photos/${photoId}`, { ...opts, raw: Buffer.from([1, 2, 3]) });
    assert.equal(other.status, 409);
    const bad = await h.api.call('PUT', `/photos/${id()}`, { token: T.staffToken, raw: bytes, headers: { 'content-type': 'application/pdf' } });
    assert.ok([400, 415].includes(bad.status));
  });

  test('webhook LINE: ตรวจลายเซ็น และเชื่อมด้วยรหัส 6 หลัก', async () => {
    const { createHmac } = await import('node:crypto');
    const code = await h.api.post('/line/link-codes', {}, T.ownerToken);
    const payload = JSON.stringify({
      events: [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'Unew' }, message: { type: 'text', text: `รหัส ${code.body.code}` } }],
    });
    const sig = createHmac('sha256', 'test-secret').update(payload).digest('base64');
    const bad = await h.api.call('POST', '/line/webhook', { raw: Buffer.from(payload), headers: { 'content-type': 'application/json', 'x-line-signature': 'AAAA' } });
    assert.equal(bad.status, 401);
    const ok = await h.api.call('POST', '/line/webhook', { raw: Buffer.from(payload), headers: { 'content-type': 'application/json', 'x-line-signature': sig } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.match(h.line.replies.at(-1)!.text, /เชื่อมต่อกับ "ปั๊ม stock" เรียบร้อย/);
    const rec = await h.api.get('/line/recipients', T.ownerToken);
    assert.equal(rec.body.recipients.length, 2);
    // ใช้รหัสซ้ำไม่ได้
    await h.api.call('POST', '/line/webhook', { raw: Buffer.from(payload), headers: { 'content-type': 'application/json', 'x-line-signature': sig } });
    assert.match(h.line.replies.at(-1)!.text, /หมดอายุ/);
  });
});
