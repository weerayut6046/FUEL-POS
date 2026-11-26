import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { Harness, id, openShiftWithReadings, setupTenant, startHarness, TenantFixture } from './helpers.js';

let h: Harness;
let T: TenantFixture;

before(async () => {
  h = await startHarness();
  T = await setupTenant(h.api, h.db, 'pilot');
});

after(async () => {
  await h?.close();
});

describe('ปิดกะหน้าลาน', () => {
  let shiftId: string;

  test('เปิดกะ: ตรึงราคาและหัวจ่ายทุกหัว', async () => {
    const r = await h.api.post(`/branches/${T.branchId}/shifts`, { id: id(), businessDate: '2026-11-25', shiftNo: 1 }, T.staffToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    shiftId = r.body.shift.id;
    assert.equal(r.body.shift.status, 'open');
    assert.equal(r.body.nozzles.length, 3);
    const n1 = r.body.nozzles.find((n: { nozzleId: string }) => n.nozzleId === T.nozzles.n1);
    assert.equal(n1.priceSatang, 3244);
    assert.equal(n1.attendantId, T.staffId);
    // ยังไม่จดมิเตอร์ → มีข้อผิดพลาด
    assert.ok(r.body.issues.some((i: { code: string }) => i.code === 'MISSING_OPEN'));
  });

  test('เปิดกะซ้อนในสาขาเดียวกันไม่ได้', async () => {
    const r = await h.api.post(`/branches/${T.branchId}/shifts`, { id: id(), businessDate: '2026-11-25', shiftNo: 2 }, T.staffToken);
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'SHIFT_ALREADY_OPEN');
  });

  test('จดมิเตอร์ต้นกะ/ปลายกะ แบ่งหัวจ่ายให้พนักงาน 2 คน', async () => {
    const { api } = h;
    const put = async (nozzleId: string, kind: string, reading: string, token = T.staffToken) => {
      const r = await api.post(`/shifts/${shiftId}/readings`, { id: id(), nozzleId, kind, reading }, token);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    await put(T.nozzles.n1, 'open', '10000.000');
    await put(T.nozzles.n2, 'open', '20000.000');
    await put(T.nozzles.n3, 'open', '30000.000');
    const r = await api.put(`/shifts/${shiftId}/nozzles/${T.nozzles.n3}/attendant`, { attendantId: T.staff2Id }, T.staffToken);
    assert.equal(r.status, 200);

    await put(T.nozzles.n1, 'close', '10500.000'); // 500 ลิตร × 32.44 = 16,220.00
    await put(T.nozzles.n2, 'close', '20200.500'); // 200.5 × 37.85 = 7,588.925 → 7,588.93
    const res = await put(T.nozzles.n3, 'close', '29999.000', T.staff2Token); // ผิด: น้อยกว่าต้นกะ
    assert.ok(res.issues.some((i: { code: string }) => i.code === 'CLOSE_LT_OPEN'), 'ต้องเตือนทันที');
  });

  test('ส่งปิดกะไม่ได้ถ้ายังมีข้อผิดพลาด', async () => {
    const r = await h.api.post(`/shifts/${shiftId}/submit`, {}, T.staffToken);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'SHIFT_INCOMPLETE');
    assert.ok(r.body.error.details.some((i: { code: string }) => i.code === 'CLOSE_LT_OPEN'));
  });

  test('แก้เลขมิเตอร์ = เพิ่มรายการแก้ไข เก็บประวัติครบ ไม่ทับของเดิม', async () => {
    const detail = (await h.api.get(`/shifts/${shiftId}`, T.staffToken)).body;
    const wrong = detail.nozzles.find((n: { nozzleId: string }) => n.nozzleId === T.nozzles.n3).close;
    const r = await h.api.post(
      `/shifts/${shiftId}/readings`,
      { id: id(), nozzleId: T.nozzles.n3, kind: 'close', reading: '30100.000', supersedesId: wrong.id, reason: 'อ่านเลขผิด' },
      T.staff2Token,
    );
    assert.equal(r.status, 201);
    assert.equal(r.body.reading.supersedesId, wrong.id);
    assert.equal(r.body.reading.reason, 'อ่านเลขผิด');
    assert.equal(r.body.reading.recordedByName, 'สมศรี');
    assert.ok(
      r.body.issues.every((i: { code: string }) => i.code === 'MISSING_PHOTO'),
      'เหลือแค่เตือนไม่มีรูป',
    );

    const after = (await h.api.get(`/shifts/${shiftId}`, T.staffToken)).body;
    const hist = after.history.readings.filter((x: { nozzleId: string; kind: string }) => x.nozzleId === T.nozzles.n3 && x.kind === 'close');
    assert.equal(hist.length, 2);
    assert.equal(hist.find((x: { id: string }) => x.id === wrong.id).current, false);
    assert.equal(hist.find((x: { reading: string }) => x.reading === '30100.000').current, true);
  });

  test('ส่งรายการเดิมซ้ำ (คิวออฟไลน์) ไม่เกิดรายการซ้ำ', async () => {
    const body = { id: id(), nozzleId: T.nozzles.n1, litres: '5.000' };
    const a = await h.api.post(`/shifts/${shiftId}/pump-tests`, body, T.staffToken);
    const b = await h.api.post(`/shifts/${shiftId}/pump-tests`, body, T.staffToken);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const d = (await h.api.get(`/shifts/${shiftId}`, T.staffToken)).body;
    assert.equal(d.history.tests.length, 1);
    const n1 = d.nozzles.find((n: { nozzleId: string }) => n.nozzleId === T.nozzles.n1);
    assert.equal(n1.soldLitres, '495.000');
    assert.equal(n1.amountSatang, 1_605_780); // 495 × 32.44
  });

  test('บันทึกเงินที่ส่ง แล้วคำนวณเงินขาด/เกินรายคน', async () => {
    const { api } = h;
    // สมชาย: หัว 1A (495 ลิตร = 16,057.80) + 1B (200.5 ลิตร = 7,588.93) = 23,646.73
    // สมศรี: หัว 2A (100 ลิตร × 32.44 = 3,244.00)
    const col = async (attendantId: string, method: string, amountSatang: number, token = T.staffToken) => {
      const r = await api.post(`/shifts/${shiftId}/collections`, { id: id(), attendantId, method, amountSatang }, token);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    await col(T.staffId, 'cash', 15_000_00);
    await col(T.staffId, 'qr', 5_000_00);
    await col(T.staffId, 'credit', 3_446_73); // ขาด 200 บาท
    const last = await col(T.staff2Id, 'cash', 3_244_00, T.staff2Token);
    const somchai = last.summary.byAttendant.find((a: { attendantId: string }) => a.attendantId === T.staffId);
    assert.equal(somchai.expectedSatang, 2_364_673);
    assert.equal(somchai.collectedSatang, 2_344_673);
    assert.equal(somchai.diffSatang, -20_000);
    assert.equal(somchai.collected.qr, 5_000_00);
    const somsri = last.summary.byAttendant.find((a: { attendantId: string }) => a.attendantId === T.staff2Id);
    assert.equal(somsri.diffSatang, 0);
  });

  test('ส่งปิดกะ → แจ้งเงินขาดทาง LINE', async () => {
    const r = await h.api.post(`/shifts/${shiftId}/submit`, { note: 'ปิดกะเช้า' }, T.staffToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.shift.status, 'submitted');
    assert.equal(r.body.summary.totals.diffSatang, -20_000);

    // พนักงานแก้กะที่ส่งแล้วไม่ได้
    const edit = await h.api.post(`/shifts/${shiftId}/collections`, { id: id(), attendantId: T.staffId, method: 'cash', amountSatang: 1 }, T.staffToken);
    assert.equal(edit.status, 409);

    await h.api.post('/line/link-codes', {}, T.ownerToken).then(async (code) => {
      // จำลองเจ้าของพิมพ์รหัสใน LINE OA
      const [row] = await h.db.query<{ app_line_link: string }>("SELECT app_line_link($1, 'Uowner', 'user', null)", [code.body.code]);
      assert.equal(row?.app_line_link, 'ปั๊ม pilot');
    });
    const worker = h.app.get((await import('../src/notify/line.js')).NotifyWorker);
    const stats = await worker.runOnce();
    assert.ok(stats.sent >= 1);
    const cash = h.line.pushes.find((p) => p.text.includes('เงินขาด/เกินเกินเกณฑ์'));
    assert.ok(cash, 'ต้องส่งแจ้งเตือนเงินขาด');
    assert.equal(cash.to, 'Uowner');
    assert.match(cash.text, /สมชาย: เงินขาด 200\.00 บาท/);
  });

  test('พนักงานยืนยันกะไม่ได้ · ผู้จัดการต้องรับทราบคำเตือนก่อน', async () => {
    const staff = await h.api.post(`/shifts/${shiftId}/approve`, {}, T.staffToken);
    assert.equal(staff.status, 403);
    const noAck = await h.api.post(`/shifts/${shiftId}/approve`, {}, T.managerToken);
    assert.equal(noAck.status, 422);
    assert.equal(noAck.body.error.code, 'WARNINGS_NOT_ACKNOWLEDGED');
    const ok = await h.api.post(`/shifts/${shiftId}/approve`, { acknowledgeWarnings: true, note: 'ตรวจแล้ว สมชายรับทราบเงินขาด' }, T.managerToken);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.shift.status, 'approved');
    assert.equal(ok.body.shift.approvedByName, 'ผู้จัดการ');
    // ยืนยันแล้วแก้ไม่ได้ แม้แต่ผู้จัดการ
    const edit = await h.api.post(`/shifts/${shiftId}/collections`, { id: id(), attendantId: T.staffId, method: 'cash', amountSatang: 1 }, T.managerToken);
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'SHIFT_APPROVED');
  });

  test('กะถัดไป: ต้นกะไม่ตรงกับปลายกะก่อนหน้า → เตือนทันที', async () => {
    const next = await openShiftWithReadings(h.api, T, T.staffToken, '2026-11-25', 2, { n1: '10500', n2: '20200.5', n3: '30100' });
    const d = (await h.api.get(`/shifts/${next}`, T.staffToken)).body;
    assert.equal(d.nozzles.find((n: { nozzleId: string }) => n.nozzleId === T.nozzles.n1).prevClose, '10500.000');
    assert.ok(!d.issues.some((i: { code: string }) => i.code === 'OPEN_MISMATCH_PREV'));

    const r = await h.api.post(
      `/shifts/${next}/readings`,
      { id: id(), nozzleId: T.nozzles.n1, kind: 'open', reading: '10510', reason: 'จดใหม่' },
      T.staffToken,
    );
    assert.ok(r.body.issues.some((i: { code: string }) => i.code === 'OPEN_MISMATCH_PREV'));
    // ฝั่งกะก่อนหน้าก็เห็นว่าไม่ต่อเนื่อง
    const prev = (await h.api.get(`/shifts/${shiftId}`, T.managerToken)).body;
    assert.ok(prev.issues.some((i: { code: string }) => i.code === 'CLOSE_MISMATCH_NEXT'));
  });

  test('รายการกะของสาขาพร้อมยอดสรุป', async () => {
    const r = await h.api.get(`/branches/${T.branchId}/shifts?from=2026-11-25&to=2026-11-25`, T.managerToken);
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 2);
    const first = r.body.find((s: { shiftNo: number }) => s.shiftNo === 1);
    assert.equal(first.expectedSatang, 2_689_073);
    assert.equal(first.diffSatang, -20_000);
    assert.equal(first.soldLitres, '795.500');
  });

  test('Dashboard รวมยอดตรงกับการคำนวณในกะ', async () => {
    const r = await h.api.get(`/dashboard?from=2026-11-25&to=2026-11-25`, T.ownerToken);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.totals.salesSatang, 2_689_073);
    assert.equal(r.body.totals.soldLitres, '795.500');
    assert.equal(r.body.totals.cashDiffSatang, -20_000);
    const b7 = r.body.byFuel.find((f: { fuelTypeId: string }) => f.fuelTypeId === T.fuel.b7);
    assert.equal(b7.soldLitres, '595.000');
    const somchai = r.body.cashByAttendant.find((a: { attendantId: string }) => a.attendantId === T.staffId);
    assert.equal(somchai.diffSatang, -20_000);
    const staff = await h.api.get(`/dashboard?from=2026-11-25&to=2026-11-25`, T.staffToken);
    assert.equal(staff.status, 403);
  });

  test('เปิดกะกลับ (ผู้จัดการ) ต้องมีเหตุผลและเก็บในประวัติ', async () => {
    // ปิดกะที่ 2 ก่อนไม่ได้เพราะยังจดไม่ครบ → เปิดกะ 1 กลับไม่ได้เพราะมีกะเปิดอยู่
    const blocked = await h.api.post(`/shifts/${shiftId}/reopen`, { reason: 'แก้ยอด' }, T.managerToken);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'SHIFT_ALREADY_OPEN');
  });

  test('มิเตอร์วนรอบต้องติ๊กยืนยัน', async () => {
    const list = await h.api.get(`/branches/${T.branchId}/shifts?from=2026-11-25&to=2026-11-25`, T.staffToken);
    const s2 = list.body.find((s: { shiftNo: number }) => s.shiftNo === 2).id;
    const r = await h.api.post(
      `/shifts/${s2}/readings`,
      { id: id(), nozzleId: T.nozzles.n2, kind: 'close', reading: '5.000', rollover: true },
      T.staffToken,
    );
    assert.equal(r.status, 201);
    // modulus 1,000,000 → 1,000,000 − 20,200.5 + 5 = 979,804.5 ลิตร → ผิดปกติ
    assert.ok(r.body.issues.some((i: { code: string }) => i.code === 'ROLLOVER_SUSPICIOUS'));
    const tooBig = await h.api.post(
      `/shifts/${s2}/readings`,
      { id: id(), nozzleId: T.nozzles.n2, kind: 'close', reading: '1000000', reason: 'x' },
      T.staffToken,
    );
    assert.equal(tooBig.status, 422);
  });
});

describe('สิทธิ์ผู้ใช้', () => {
  test('ผู้จัดการเพิ่มได้เฉพาะพนักงานในสาขาตัวเอง', async () => {
    const ok = await h.api.post('/users', { username: 'newbie', displayName: 'น้องใหม่', role: 'staff', password: '1111', branchIds: [T.branchId] }, T.managerToken);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const bad = await h.api.post('/users', { username: 'boss2', displayName: 'x', role: 'owner', password: '1111' }, T.managerToken);
    assert.equal(bad.status, 403);
  });

  test('ปิดใช้งานผู้ใช้ → token เดิมใช้ไม่ได้ทันที', async () => {
    const token = await h.api.login('pilot', 'newbie', '1111');
    const list = await h.api.get('/users', T.ownerToken);
    const newbie = list.body.find((u: { username: string }) => u.username === 'newbie');
    await h.api.patch(`/users/${newbie.id}`, { active: false }, T.ownerToken);
    assert.equal((await h.api.get('/auth/me', token)).status, 401);
  });

  test('เจ้าของคนสุดท้ายปิดใช้งานไม่ได้', async () => {
    const r = await h.api.patch(`/users/${T.ownerId}`, { active: false }, T.ownerToken);
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'LAST_OWNER');
  });

  test('รหัสผ่านผิด', async () => {
    const r = await h.api.post('/auth/login', { tenant: 'pilot', username: 'owner', password: 'wrong' });
    assert.equal(r.status, 401);
  });

  test('ประวัติการแก้ไขตั้งค่า', async () => {
    const r = await h.api.get('/audit-log?limit=50', T.ownerToken);
    assert.equal(r.status, 200);
    assert.ok(r.body.some((a: { table: string; action: string }) => a.table === 'users' && a.action === 'UPDATE'));
    assert.ok(r.body.every((a: { new: Record<string, unknown> | null }) => !a.new || !('password_hash' in a.new)));
  });
});
