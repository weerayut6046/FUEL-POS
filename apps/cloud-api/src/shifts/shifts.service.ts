import { Inject, Injectable } from '@nestjs/common';

import { AuthCtx, isManagerOrOwner } from '../auth/auth-context.js';
import { assertBranch, tenantNow } from '../common/access.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors.js';
import { dbLitres, formatBaht, litresToMilli, milliToLitres } from '../common/units.js';
import { Db, many, maybeOne, one, Tx } from '../db/db.js';
import { enqueueNotification, thaiDate } from '../notify/outbox.js';
import { pricesAt } from '../settings/catalog.service.js';
import { notifyReorder } from '../stock/tank-status.js';
import { CollectionInput, computeShift, Issue, LineInput, PaymentMethod, ShiftCalc } from './shift-calc.js';

export interface ShiftRow {
  id: string;
  tenant_id: string;
  branch_id: string;
  business_date: string;
  shift_no: number;
  status: 'open' | 'submitted' | 'approved';
  opened_by: string;
  opened_at: Date;
  submitted_by: string | null;
  submitted_at: Date | null;
  approved_by: string | null;
  approved_at: Date | null;
  approval_note: string | null;
  note: string | null;
}

interface ShiftNozzleRow {
  nozzle_id: string;
  code: string;
  name: string;
  dispenser_no: number;
  fuel_type_id: string;
  tank_id: string;
  price_satang: number;
  attendant_id: string | null;
  meter_modulus: string;
}

interface ReadingRow {
  id: string;
  nozzle_id: string;
  kind: 'open' | 'close';
  reading: string;
  rollover: boolean;
  photo_id: string | null;
  supersedes_id: string | null;
  reason: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: Date;
  device_at: Date | null;
  is_current: boolean;
}

interface TestRow {
  id: string;
  nozzle_id: string;
  litres: string;
  supersedes_id: string | null;
  reason: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: Date;
  is_current: boolean;
}

interface CollectionRow {
  id: string;
  attendant_id: string;
  method: PaymentMethod;
  amount_satang: number;
  note: string | null;
  supersedes_id: string | null;
  reason: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: Date;
  is_current: boolean;
}

const shiftDto = (s: ShiftRow & { opened_by_name?: string; approved_by_name?: string | null }) => ({
  id: s.id,
  branchId: s.branch_id,
  businessDate: s.business_date,
  shiftNo: s.shift_no,
  status: s.status,
  openedBy: s.opened_by,
  openedByName: s.opened_by_name ?? null,
  openedAt: s.opened_at,
  submittedBy: s.submitted_by,
  submittedAt: s.submitted_at,
  approvedBy: s.approved_by,
  approvedByName: s.approved_by_name ?? null,
  approvedAt: s.approved_at,
  approvalNote: s.approval_note,
  note: s.note,
});

const readingDto = (r: ReadingRow) => ({
  id: r.id,
  nozzleId: r.nozzle_id,
  kind: r.kind,
  reading: r.reading,
  rollover: r.rollover,
  photoId: r.photo_id,
  supersedesId: r.supersedes_id,
  reason: r.reason,
  recordedBy: r.recorded_by,
  recordedByName: r.recorded_by_name,
  recordedAt: r.recorded_at,
  deviceAt: r.device_at,
  current: r.is_current,
});

const testDto = (t: TestRow) => ({
  id: t.id,
  nozzleId: t.nozzle_id,
  litres: t.litres,
  supersedesId: t.supersedes_id,
  reason: t.reason,
  recordedBy: t.recorded_by,
  recordedByName: t.recorded_by_name,
  recordedAt: t.recorded_at,
  current: t.is_current,
});

const collectionDto = (c: CollectionRow) => ({
  id: c.id,
  attendantId: c.attendant_id,
  method: c.method,
  amountSatang: c.amount_satang,
  note: c.note,
  supersedesId: c.supersedes_id,
  reason: c.reason,
  recordedBy: c.recorded_by,
  recordedByName: c.recorded_by_name,
  recordedAt: c.recorded_at,
  current: c.is_current,
});

const issueDto = (i: Issue) => i;

export interface CorrectionInput {
  supersedesId?: string | null;
  reason?: string | null;
  deviceAt?: string | null;
}

const DUPLICATE_REASON = 'บันทึกซ้ำจากอีกเครื่อง (ซิงก์ตอนออนไลน์)';

/**
 * หาแถวที่จะถูกแทนในสายการแก้ไข
 * - ยังไม่มีข้อมูล → แถวแรก (ห้ามระบุ supersedesId)
 * - มีแล้ว → ต่อท้ายหัวสายเสมอ แม้เครื่องจะส่ง supersedesId เก่ามา (เช่น สองเครื่องแก้พร้อมกันตอนออฟไลน์)
 *   ข้อมูลทุกแถวยังอยู่ครบในประวัติ ไม่มีอะไรหาย
 */
function chainTarget(headId: string | null, input: CorrectionInput): { supersedesId: string | null; reason: string | null } {
  if (!headId) {
    if (input.supersedesId) throw badRequest('NOTHING_TO_CORRECT', 'ยังไม่มีรายการเดิมให้แก้ไข');
    return { supersedesId: null, reason: input.reason ?? null };
  }
  return { supersedesId: headId, reason: input.reason?.trim() || DUPLICATE_REASON };
}

@Injectable()
export class ShiftsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---------------------------------------------------------------- อ่าน

  list(auth: AuthCtx, branchId: string, from: string, to: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const rows = await many<
        ShiftRow & {
          opened_by_name: string;
          approved_by_name: string | null;
          expected_satang: number;
          collected_satang: number;
          sold_litres: string;
          nozzle_count: number;
          closed_count: number;
        }
      >(
        tx,
        `SELECT s.*, ou.display_name AS opened_by_name, au.display_name AS approved_by_name,
           (SELECT coalesce(sum(round((l.meter_litres - l.test_litres) * l.price_satang)), 0)::bigint
              FROM shift_lines l WHERE l.shift_id = s.id AND l.meter_litres IS NOT NULL) AS expected_satang,
           (SELECT coalesce(sum(l.meter_litres - l.test_litres), 0)::numeric(14,3)
              FROM shift_lines l WHERE l.shift_id = s.id AND l.meter_litres IS NOT NULL) AS sold_litres,
           (SELECT coalesce(sum(c.amount_satang), 0)::bigint FROM shift_collections_current c WHERE c.shift_id = s.id) AS collected_satang,
           (SELECT count(*)::int FROM shift_nozzles sn WHERE sn.shift_id = s.id) AS nozzle_count,
           (SELECT count(*)::int FROM shift_lines l WHERE l.shift_id = s.id AND l.close_reading IS NOT NULL) AS closed_count
         FROM shifts s
         JOIN users ou ON ou.id = s.opened_by
         LEFT JOIN users au ON au.id = s.approved_by
         WHERE s.branch_id = $1 AND s.business_date BETWEEN $2 AND $3
         ORDER BY s.business_date DESC, s.shift_no DESC`,
        [branchId, from, to],
      );
      return rows.map((r) => ({
        ...shiftDto(r),
        soldLitres: r.sold_litres,
        expectedSatang: r.expected_satang,
        collectedSatang: r.collected_satang,
        diffSatang: r.collected_satang - r.expected_satang,
        nozzleCount: r.nozzle_count,
        closedCount: r.closed_count,
      }));
    });
  }

  detail(auth: AuthCtx, shiftId: string) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId);
      return this.buildDetail(tx, shift);
    });
  }

  // ---------------------------------------------------------------- เปิดกะ

  open(
    auth: AuthCtx,
    branchId: string,
    input: { id: string; businessDate: string; shiftNo: number; note?: string | null; attendantId?: string | null },
  ) {
    return this.db.withTenant(auth, async (tx) => {
      const existing = await maybeOne<ShiftRow>(tx, 'SELECT * FROM shifts WHERE id = $1', [input.id]);
      if (existing) {
        // ส่งซ้ำจากคิวออฟไลน์ → คืนกะเดิม
        if (existing.branch_id !== branchId) throw conflict('ID_CONFLICT', 'รหัสกะซ้ำกับกะของสาขาอื่น');
        await assertBranch(tx, auth, branchId);
        return this.buildDetail(tx, existing);
      }
      await assertBranch(tx, auth, branchId);
      // ล็อกสาขาไว้ กันสองเครื่องเปิดกะพร้อมกัน
      await tx.query('SELECT 1 FROM branches WHERE id = $1 FOR UPDATE', [branchId]);
      const openShift = await maybeOne<ShiftRow>(tx, "SELECT * FROM shifts WHERE branch_id = $1 AND status = 'open'", [branchId]);
      if (openShift) {
        throw conflict('SHIFT_ALREADY_OPEN', `ยังมีกะที่ ${openShift.shift_no} วันที่ ${thaiDate(openShift.business_date)} เปิดอยู่ ต้องปิดกะนั้นก่อน`, {
          shiftId: openShift.id,
        });
      }
      const dup = await maybeOne(tx, 'SELECT 1 FROM shifts WHERE branch_id = $1 AND business_date = $2 AND shift_no = $3', [
        branchId,
        input.businessDate,
        input.shiftNo,
      ]);
      if (dup) throw conflict('SHIFT_EXISTS', `กะที่ ${input.shiftNo} ของวันที่ ${thaiDate(input.businessDate)} มีอยู่แล้ว`);

      const nozzles = await many<{ id: string; fuel_type_id: string; tank_id: string; code: string }>(
        tx,
        'SELECT id, fuel_type_id, tank_id, code FROM nozzles WHERE branch_id = $1 AND active ORDER BY sort_order, code',
        [branchId],
      );
      if (nozzles.length === 0) throw unprocessable('NO_NOZZLES', 'สาขานี้ยังไม่ได้ตั้งค่าหัวจ่าย');
      const prices = await pricesAt(tx, branchId);
      const missing = [...new Set(nozzles.filter((n) => !prices.has(n.fuel_type_id)).map((n) => n.fuel_type_id))];
      if (missing.length) {
        const names = await many<{ name: string }>(tx, 'SELECT name FROM fuel_types WHERE id = ANY($1::uuid[])', [missing]);
        throw unprocessable('NO_PRICE', `ยังไม่ได้ตั้งราคา: ${names.map((n) => n.name).join(', ')}`);
      }

      const shift = await one<ShiftRow>(
        tx,
        `INSERT INTO shifts (id, tenant_id, branch_id, business_date, shift_no, opened_by, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.id, auth.tenantId, branchId, input.businessDate, input.shiftNo, auth.userId, input.note ?? null],
      );
      const attendant = input.attendantId === undefined ? auth.userId : input.attendantId;
      for (const n of nozzles) {
        await tx.query(
          `INSERT INTO shift_nozzles (tenant_id, shift_id, nozzle_id, fuel_type_id, tank_id, price_satang, attendant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [auth.tenantId, shift.id, n.id, n.fuel_type_id, n.tank_id, prices.get(n.fuel_type_id), attendant],
        );
      }
      await this.event(tx, auth, shift.id, 'open', null);
      return this.buildDetail(tx, shift);
    });
  }

  // ---------------------------------------------------------------- บันทึกตัวเลข

  recordReading(
    auth: AuthCtx,
    shiftId: string,
    input: CorrectionInput & {
      id: string;
      nozzleId: string;
      kind: 'open' | 'close';
      reading: string;
      rollover?: boolean;
      photoId?: string | null;
    },
  ) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      const dup = await maybeOne<{ shift_id: string; nozzle_id: string; kind: string }>(
        tx,
        'SELECT shift_id, nozzle_id, kind FROM meter_readings WHERE id = $1',
        [input.id],
      );
      if (dup) {
        if (dup.shift_id !== shiftId || dup.nozzle_id !== input.nozzleId || dup.kind !== input.kind) {
          throw conflict('ID_CONFLICT', 'รหัสรายการซ้ำกับรายการอื่น');
        }
        return this.nozzleResult(tx, shift, input.nozzleId, input.id);
      }
      this.assertEditable(shift, auth);
      const sn = await maybeOne<{ meter_modulus: string }>(
        tx,
        `SELECT n.meter_modulus FROM shift_nozzles sn JOIN nozzles n ON n.id = sn.nozzle_id
         WHERE sn.shift_id = $1 AND sn.nozzle_id = $2`,
        [shiftId, input.nozzleId],
      );
      if (!sn) throw notFound('หัวจ่ายในกะนี้');
      if (litresToMilli(input.reading) >= litresToMilli(sn.meter_modulus)) {
        throw unprocessable('READING_TOO_LARGE', `เลขมิเตอร์ต้องน้อยกว่า ${sn.meter_modulus} (ค่าที่มิเตอร์วนรอบ)`);
      }
      if (input.kind === 'open' && input.rollover) throw badRequest('INVALID_ROLLOVER', 'มิเตอร์วนรอบใช้กับปลายกะเท่านั้น');
      const head = await maybeOne<{ id: string }>(
        tx,
        'SELECT id FROM meter_readings_current WHERE shift_id = $1 AND nozzle_id = $2 AND kind = $3',
        [shiftId, input.nozzleId, input.kind],
      );
      const chain = chainTarget(head?.id ?? null, input);
      await tx.query(
        `INSERT INTO meter_readings (id, tenant_id, shift_id, nozzle_id, kind, reading, rollover, photo_id,
           supersedes_id, reason, recorded_by, device_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          input.id,
          auth.tenantId,
          shiftId,
          input.nozzleId,
          input.kind,
          input.reading,
          input.rollover ?? false,
          input.photoId ?? null,
          chain.supersedesId,
          chain.reason,
          auth.userId,
          input.deviceAt ?? null,
        ],
      );
      return this.nozzleResult(tx, shift, input.nozzleId, input.id);
    });
  }

  recordPumpTest(auth: AuthCtx, shiftId: string, input: CorrectionInput & { id: string; nozzleId: string; litres: string }) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      const dup = await maybeOne<{ shift_id: string; nozzle_id: string }>(tx, 'SELECT shift_id, nozzle_id FROM pump_tests WHERE id = $1', [
        input.id,
      ]);
      if (dup) {
        if (dup.shift_id !== shiftId || dup.nozzle_id !== input.nozzleId) throw conflict('ID_CONFLICT', 'รหัสรายการซ้ำกับรายการอื่น');
        return this.nozzleResult(tx, shift, input.nozzleId, null);
      }
      this.assertEditable(shift, auth);
      const head = await maybeOne<{ id: string }>(tx, 'SELECT id FROM pump_tests_current WHERE shift_id = $1 AND nozzle_id = $2', [
        shiftId,
        input.nozzleId,
      ]);
      const chain = chainTarget(head?.id ?? null, input);
      await tx.query(
        `INSERT INTO pump_tests (id, tenant_id, shift_id, nozzle_id, litres, supersedes_id, reason, recorded_by, device_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [input.id, auth.tenantId, shiftId, input.nozzleId, input.litres, chain.supersedesId, chain.reason, auth.userId, input.deviceAt ?? null],
      );
      return this.nozzleResult(tx, shift, input.nozzleId, null);
    });
  }

  recordCollection(
    auth: AuthCtx,
    shiftId: string,
    input: CorrectionInput & { id: string; attendantId: string; method: PaymentMethod; amountSatang: number; note?: string | null },
  ) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      const dup = await maybeOne<{ shift_id: string }>(tx, 'SELECT shift_id FROM shift_collections WHERE id = $1', [input.id]);
      if (dup) {
        if (dup.shift_id !== shiftId) throw conflict('ID_CONFLICT', 'รหัสรายการซ้ำกับรายการอื่น');
        return this.collectionResult(tx, shift, input.id);
      }
      this.assertEditable(shift, auth);
      const head = await maybeOne<{ id: string }>(
        tx,
        'SELECT id FROM shift_collections_current WHERE shift_id = $1 AND attendant_id = $2 AND method = $3',
        [shiftId, input.attendantId, input.method],
      );
      const chain = chainTarget(head?.id ?? null, input);
      await tx.query(
        `INSERT INTO shift_collections (id, tenant_id, shift_id, attendant_id, method, amount_satang, note,
           supersedes_id, reason, recorded_by, device_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.id,
          auth.tenantId,
          shiftId,
          input.attendantId,
          input.method,
          input.amountSatang,
          input.note ?? null,
          chain.supersedesId,
          chain.reason,
          auth.userId,
          input.deviceAt ?? null,
        ],
      );
      return this.collectionResult(tx, shift, input.id);
    });
  }

  setAttendant(auth: AuthCtx, shiftId: string, nozzleId: string, attendantId: string | null) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      this.assertEditable(shift, auth);
      const res = await tx.query('UPDATE shift_nozzles SET attendant_id = $3 WHERE shift_id = $1 AND nozzle_id = $2', [
        shiftId,
        nozzleId,
        attendantId,
      ]);
      if (res.rowCount === 0) throw notFound('หัวจ่ายในกะนี้');
      return this.buildDetail(tx, shift);
    });
  }

  // ---------------------------------------------------------------- เปลี่ยนสถานะ

  /** ส่งปิดกะ — ต้องจดมิเตอร์ครบและไม่มีข้อผิดพลาด แล้วรอผู้จัดการยืนยัน */
  submit(auth: AuthCtx, shiftId: string, input: { note?: string | null }) {
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      if (shift.status !== 'open') return this.buildDetail(tx, shift); // ส่งซ้ำจากคิวออฟไลน์
      const { calc, names } = await this.calc(tx, shift);
      const errors = calc.issues.filter((i) => i.severity === 'error');
      if (errors.length) throw unprocessable('SHIFT_INCOMPLETE', 'ยังปิดกะไม่ได้ กรุณาแก้รายการต่อไปนี้', errors);
      const updated = await one<ShiftRow>(
        tx,
        `UPDATE shifts SET status = 'submitted', submitted_by = $2, submitted_at = now(), note = coalesce($3, note)
         WHERE id = $1 RETURNING *`,
        [shiftId, auth.userId, input.note ?? null],
      );
      const eventId = await this.event(tx, auth, shiftId, 'submit', input.note ?? null, {
        expectedSatang: calc.totals.expectedSatang,
        collectedSatang: calc.totals.collectedSatang,
        diffSatang: calc.totals.diffSatang,
      });
      await this.notifyCash(tx, auth, updated, calc, names, eventId);
      await notifyReorder(tx, auth.tenantId, shift.branch_id, (await tenantNow(tx)).today);
      return this.buildDetail(tx, updated);
    });
  }

  /** ผู้จัดการยืนยันกะ — ถ้ามีคำเตือนต้องกดรับทราบ */
  approve(auth: AuthCtx, shiftId: string, input: { note?: string | null; acknowledgeWarnings?: boolean }) {
    if (!isManagerOrOwner(auth)) throw forbidden('เฉพาะผู้จัดการหรือเจ้าของที่ยืนยันกะได้');
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      if (shift.status === 'approved') return this.buildDetail(tx, shift);
      if (shift.status !== 'submitted') throw conflict('SHIFT_NOT_SUBMITTED', 'กะนี้ยังไม่ได้ส่งปิดกะ');
      const { calc } = await this.calc(tx, shift);
      const errors = calc.issues.filter((i) => i.severity === 'error');
      if (errors.length) throw unprocessable('SHIFT_INCOMPLETE', 'กะนี้ยังมีข้อผิดพลาด', errors);
      const warnings = calc.issues.filter((i) => i.severity === 'warning');
      if (warnings.length && !input.acknowledgeWarnings) {
        throw unprocessable('WARNINGS_NOT_ACKNOWLEDGED', 'กะนี้มีคำเตือน กรุณาตรวจและกดรับทราบก่อนยืนยัน', warnings);
      }
      if (warnings.length && !input.note?.trim()) {
        throw unprocessable('NOTE_REQUIRED', 'กะนี้มีคำเตือน กรุณาระบุหมายเหตุการตรวจ');
      }
      const updated = await one<ShiftRow>(
        tx,
        `UPDATE shifts SET status = 'approved', approved_by = $2, approved_at = now(), approval_note = $3
         WHERE id = $1 RETURNING *`,
        [shiftId, auth.userId, input.note ?? null],
      );
      await this.event(tx, auth, shiftId, 'approve', input.note ?? null, { warnings: warnings.length });
      return this.buildDetail(tx, updated);
    });
  }

  /** เปิดกะกลับมาแก้ไข (ผู้จัดการ/เจ้าของ) — เก็บเหตุผลไว้ในประวัติ */
  reopen(auth: AuthCtx, shiftId: string, input: { reason: string }) {
    if (!isManagerOrOwner(auth)) throw forbidden('เฉพาะผู้จัดการหรือเจ้าของที่เปิดกะกลับได้');
    return this.db.withTenant(auth, async (tx) => {
      const shift = await this.getShift(tx, auth, shiftId, true);
      if (shift.status === 'open') return this.buildDetail(tx, shift);
      const other = await maybeOne<ShiftRow>(
        tx,
        "SELECT * FROM shifts WHERE branch_id = $1 AND status = 'open' AND id <> $2",
        [shift.branch_id, shiftId],
      );
      if (other) throw conflict('SHIFT_ALREADY_OPEN', `ต้องปิดกะที่ ${other.shift_no} ที่เปิดอยู่ก่อน`, { shiftId: other.id });
      const updated = await one<ShiftRow>(
        tx,
        `UPDATE shifts SET status = 'open', submitted_by = NULL, submitted_at = NULL,
           approved_by = NULL, approved_at = NULL, approval_note = NULL
         WHERE id = $1 RETURNING *`,
        [shiftId],
      );
      await this.event(tx, auth, shiftId, 'reopen', input.reason, { previousStatus: shift.status });
      return this.buildDetail(tx, updated);
    });
  }

  // ---------------------------------------------------------------- ภายใน

  private async getShift(tx: Tx, auth: AuthCtx, shiftId: string, lock = false): Promise<ShiftRow> {
    const shift = await maybeOne<ShiftRow>(tx, `SELECT * FROM shifts WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [shiftId]);
    if (!shift) throw notFound('กะ');
    await assertBranch(tx, auth, shift.branch_id);
    return shift;
  }

  private assertEditable(shift: ShiftRow, auth: AuthCtx) {
    if (shift.status === 'approved') {
      throw conflict('SHIFT_APPROVED', 'กะนี้ผู้จัดการยืนยันแล้ว ต้องเปิดกะกลับก่อนแก้ไข');
    }
    if (shift.status === 'submitted' && !isManagerOrOwner(auth)) {
      throw conflict('SHIFT_SUBMITTED', 'กะนี้ส่งปิดแล้ว ให้ผู้จัดการเป็นผู้แก้ไข');
    }
  }

  private async event(tx: Tx, auth: AuthCtx, shiftId: string, action: string, note: string | null, data?: unknown): Promise<number> {
    const row = await one<{ id: number }>(
      tx,
      `INSERT INTO shift_events (tenant_id, shift_id, action, actor_id, note, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [auth.tenantId, shiftId, action, auth.userId, note, data === undefined ? null : JSON.stringify(data)],
    );
    return row.id;
  }

  /** รวบรวมข้อมูลแล้วคำนวณกะ */
  private async calc(tx: Tx, shift: ShiftRow) {
    const nozzles = await many<ShiftNozzleRow>(
      tx,
      `SELECT sn.nozzle_id, n.code, n.name, n.dispenser_no, sn.fuel_type_id, sn.tank_id, sn.price_satang,
              sn.attendant_id, n.meter_modulus
       FROM shift_nozzles sn JOIN nozzles n ON n.id = sn.nozzle_id
       WHERE sn.shift_id = $1 ORDER BY n.sort_order, n.dispenser_no, n.code`,
      [shift.id],
    );
    const current = await many<{ nozzle_id: string; kind: 'open' | 'close'; reading: string; rollover: boolean; photo_id: string | null }>(
      tx,
      'SELECT nozzle_id, kind, reading, rollover, photo_id FROM meter_readings_current WHERE shift_id = $1',
      [shift.id],
    );
    const tests = await many<{ nozzle_id: string; litres: string }>(
      tx,
      'SELECT nozzle_id, litres FROM pump_tests_current WHERE shift_id = $1',
      [shift.id],
    );
    const collections = await many<{ attendant_id: string; method: PaymentMethod; amount_satang: number }>(
      tx,
      'SELECT attendant_id, method, amount_satang FROM shift_collections_current WHERE shift_id = $1',
      [shift.id],
    );
    const nozzleIds = nozzles.map((n) => n.nozzle_id);
    // ปลายกะล่าสุดก่อนกะนี้ / ต้นกะแรกหลังกะนี้ ของแต่ละหัวจ่าย — ใช้ตรวจความต่อเนื่องของมิเตอร์
    const prev = await many<{ nozzle_id: string; reading: string }>(
      tx,
      `SELECT DISTINCT ON (r.nozzle_id) r.nozzle_id, r.reading
       FROM meter_readings_current r JOIN shifts s ON s.id = r.shift_id
       WHERE r.kind = 'close' AND s.branch_id = $1 AND r.nozzle_id = ANY($4::uuid[])
         AND (s.business_date, s.shift_no) < ($2::date, $3::smallint)
       ORDER BY r.nozzle_id, s.business_date DESC, s.shift_no DESC`,
      [shift.branch_id, shift.business_date, shift.shift_no, nozzleIds],
    );
    const next = await many<{ nozzle_id: string; reading: string }>(
      tx,
      `SELECT DISTINCT ON (r.nozzle_id) r.nozzle_id, r.reading
       FROM meter_readings_current r JOIN shifts s ON s.id = r.shift_id
       WHERE r.kind = 'open' AND s.branch_id = $1 AND r.nozzle_id = ANY($4::uuid[])
         AND (s.business_date, s.shift_no) > ($2::date, $3::smallint)
       ORDER BY r.nozzle_id, s.business_date ASC, s.shift_no ASC`,
      [shift.branch_id, shift.business_date, shift.shift_no, nozzleIds],
    );
    const settings = await one<{ cash_alert_satang: number }>(tx, 'SELECT cash_alert_satang FROM tenant_settings');
    const users = await many<{ id: string; display_name: string }>(tx, 'SELECT id, display_name FROM users');
    const fuels = await many<{ id: string; name: string }>(tx, 'SELECT id, name FROM fuel_types');
    // ราคาที่ประกาศใหม่ระหว่างกะ (ต่างจากราคาที่ตรึงไว้)
    const priceChanges = await many<{ fuel_type_id: string; price_satang: number }>(
      tx,
      `SELECT DISTINCT ON (p.fuel_type_id) p.fuel_type_id, p.price_satang
       FROM fuel_prices p
       WHERE p.branch_id = $1 AND p.effective_at > $2 AND p.effective_at <= coalesce($3, now())
         AND p.fuel_type_id IN (SELECT fuel_type_id FROM shift_nozzles WHERE shift_id = $4)
       ORDER BY p.fuel_type_id, p.effective_at DESC`,
      [shift.branch_id, shift.opened_at, shift.submitted_at, shift.id],
    );
    const shiftPrice = new Map(nozzles.map((n) => [n.fuel_type_id, n.price_satang]));

    const byKey = new Map(current.map((r) => [`${r.nozzle_id}:${r.kind}`, r]));
    const testMap = new Map(tests.map((t) => [t.nozzle_id, litresToMilli(t.litres)]));
    const prevMap = new Map(prev.map((p) => [p.nozzle_id, litresToMilli(p.reading)]));
    const nextMap = new Map(next.map((p) => [p.nozzle_id, litresToMilli(p.reading)]));

    const lines: LineInput[] = nozzles.map((n) => {
      const o = byKey.get(`${n.nozzle_id}:open`);
      const c = byKey.get(`${n.nozzle_id}:close`);
      return {
        nozzleId: n.nozzle_id,
        nozzleCode: n.code,
        fuelTypeId: n.fuel_type_id,
        tankId: n.tank_id,
        priceSatang: n.price_satang,
        attendantId: n.attendant_id,
        modulusMilli: litresToMilli(n.meter_modulus),
        openMilli: dbLitres(o?.reading),
        closeMilli: dbLitres(c?.reading),
        rollover: c?.rollover ?? false,
        testMilli: testMap.get(n.nozzle_id) ?? 0,
        openHasPhoto: !!o?.photo_id,
        closeHasPhoto: !!c?.photo_id,
        prevCloseMilli: prevMap.get(n.nozzle_id) ?? null,
        nextOpenMilli: nextMap.get(n.nozzle_id) ?? null,
      };
    });
    const cols: CollectionInput[] = collections.map((c) => ({
      attendantId: c.attendant_id,
      method: c.method,
      amountSatang: c.amount_satang,
    }));
    const names = new Map(users.map((u) => [u.id, u.display_name]));
    const calc = computeShift(lines, cols, {
      cashAlertSatang: settings.cash_alert_satang,
      attendantNames: names,
      fuelNames: new Map(fuels.map((f) => [f.id, f.name])),
      priceChanges: priceChanges
        .filter((p) => p.price_satang !== shiftPrice.get(p.fuel_type_id))
        .map((p) => ({ fuelTypeId: p.fuel_type_id, priceSatang: p.price_satang })),
    });
    return { calc, lines, nozzles, names, prevMap, nextMap };
  }

  private async buildDetail(tx: Tx, shift: ShiftRow) {
    const { calc, lines, nozzles, names } = await this.calc(tx, shift);
    const readings = await many<ReadingRow>(
      tx,
      `SELECT m.*, u.display_name AS recorded_by_name,
              NOT EXISTS (SELECT 1 FROM meter_readings s WHERE s.supersedes_id = m.id) AS is_current
       FROM meter_readings m JOIN users u ON u.id = m.recorded_by
       WHERE m.shift_id = $1 ORDER BY m.recorded_at, m.id`,
      [shift.id],
    );
    const tests = await many<TestRow>(
      tx,
      `SELECT t.*, u.display_name AS recorded_by_name,
              NOT EXISTS (SELECT 1 FROM pump_tests s WHERE s.supersedes_id = t.id) AS is_current
       FROM pump_tests t JOIN users u ON u.id = t.recorded_by
       WHERE t.shift_id = $1 ORDER BY t.recorded_at, t.id`,
      [shift.id],
    );
    const collections = await many<CollectionRow>(
      tx,
      `SELECT c.*, u.display_name AS recorded_by_name,
              NOT EXISTS (SELECT 1 FROM shift_collections s WHERE s.supersedes_id = c.id) AS is_current
       FROM shift_collections c JOIN users u ON u.id = c.recorded_by
       WHERE c.shift_id = $1 ORDER BY c.recorded_at, c.id`,
      [shift.id],
    );
    const events = await many<{ id: number; action: string; actor_id: string; at: Date; note: string | null; data: unknown }>(
      tx,
      'SELECT id, action, actor_id, at, note, data FROM shift_events WHERE shift_id = $1 ORDER BY at, id',
      [shift.id],
    );
    const openedBy = names.get(shift.opened_by) ?? null;
    const approvedBy = shift.approved_by ? names.get(shift.approved_by) ?? null : null;

    return {
      shift: { ...shiftDto(shift), openedByName: openedBy, approvedByName: approvedBy },
      nozzles: nozzles.map((n, i) => {
        const line = lines[i]!;
        const res = calc.lines[i]!;
        const cur = (kind: 'open' | 'close') => {
          const r = readings.find((x) => x.nozzle_id === n.nozzle_id && x.kind === kind && x.is_current);
          return r ? readingDto(r) : null;
        };
        const test = tests.find((t) => t.nozzle_id === n.nozzle_id && t.is_current);
        return {
          nozzleId: n.nozzle_id,
          code: n.code,
          name: n.name,
          dispenserNo: n.dispenser_no,
          fuelTypeId: n.fuel_type_id,
          tankId: n.tank_id,
          priceSatang: n.price_satang,
          attendantId: n.attendant_id,
          meterModulus: n.meter_modulus,
          open: cur('open'),
          close: cur('close'),
          test: test ? testDto(test) : null,
          prevClose: line.prevCloseMilli === null ? null : milliToLitres(line.prevCloseMilli),
          nextOpen: line.nextOpenMilli === null ? null : milliToLitres(line.nextOpenMilli),
          meterLitres: res.meterMilli === null ? null : milliToLitres(res.meterMilli),
          testLitres: milliToLitres(res.testMilli),
          soldLitres: res.soldMilli === null ? null : milliToLitres(res.soldMilli),
          amountSatang: res.amountSatang,
        };
      }),
      collections: collections.filter((c) => c.is_current).map(collectionDto),
      history: {
        readings: readings.map(readingDto),
        tests: tests.map(testDto),
        collections: collections.map(collectionDto),
      },
      summary: this.summaryDto(calc, names),
      issues: calc.issues.map(issueDto),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        actorId: e.actor_id,
        actorName: names.get(e.actor_id) ?? null,
        at: e.at,
        note: e.note,
        data: e.data,
      })),
    };
  }

  private summaryDto(calc: ShiftCalc, names: Map<string, string>) {
    return {
      totals: {
        soldLitres: milliToLitres(calc.totals.soldMilli),
        expectedSatang: calc.totals.expectedSatang,
        collectedSatang: calc.totals.collectedSatang,
        diffSatang: calc.totals.diffSatang,
      },
      byFuel: calc.byFuel.map((f) => ({ fuelTypeId: f.fuelTypeId, soldLitres: milliToLitres(f.soldMilli), amountSatang: f.amountSatang })),
      byAttendant: calc.byAttendant.map((a) => ({
        attendantId: a.attendantId,
        attendantName: a.attendantId ? names.get(a.attendantId) ?? null : null,
        soldLitres: milliToLitres(a.soldMilli),
        expectedSatang: a.expectedSatang,
        collected: a.collected,
        collectedSatang: a.collectedSatang,
        diffSatang: a.diffSatang,
      })),
    };
  }

  /** ผลหลังบันทึกเลขมิเตอร์: คำเตือนของหัวจ่ายนั้น (แอปแสดงทันที) */
  private async nozzleResult(tx: Tx, shift: ShiftRow, nozzleId: string, readingId: string | null) {
    const { calc } = await this.calc(tx, shift);
    const reading = readingId
      ? await maybeOne<ReadingRow>(
          tx,
          `SELECT m.*, u.display_name AS recorded_by_name,
                  NOT EXISTS (SELECT 1 FROM meter_readings s WHERE s.supersedes_id = m.id) AS is_current
           FROM meter_readings m JOIN users u ON u.id = m.recorded_by WHERE m.id = $1`,
          [readingId],
        )
      : null;
    const idx = calc.lines.findIndex((l) => l.nozzleId === nozzleId);
    const line = calc.lines[idx];
    return {
      reading: reading ? readingDto(reading) : null,
      nozzle: line && {
        nozzleId,
        meterLitres: line.meterMilli === null ? null : milliToLitres(line.meterMilli),
        soldLitres: line.soldMilli === null ? null : milliToLitres(line.soldMilli),
        amountSatang: line.amountSatang,
      },
      issues: calc.issues.filter((i) => i.nozzleId === nozzleId),
    };
  }

  private async collectionResult(tx: Tx, shift: ShiftRow, collectionId: string) {
    const { calc, names } = await this.calc(tx, shift);
    const row = await one<CollectionRow>(
      tx,
      `SELECT c.*, u.display_name AS recorded_by_name,
              NOT EXISTS (SELECT 1 FROM shift_collections s WHERE s.supersedes_id = c.id) AS is_current
       FROM shift_collections c JOIN users u ON u.id = c.recorded_by WHERE c.id = $1`,
      [collectionId],
    );
    return { collection: collectionDto(row), summary: this.summaryDto(calc, names) };
  }

  /** แจ้งเจ้าของทาง LINE เมื่อเงินขาด/เกินเกินเกณฑ์ */
  private async notifyCash(tx: Tx, auth: AuthCtx, shift: ShiftRow, calc: ShiftCalc, names: Map<string, string>, eventId: number) {
    const settings = await one<{ cash_alert_satang: number }>(tx, 'SELECT cash_alert_satang FROM tenant_settings');
    const branch = await one<{ name: string }>(tx, 'SELECT name FROM branches WHERE id = $1', [shift.branch_id]);
    const flagged = calc.byAttendant.filter((a) => a.collectedSatang > 0 && Math.abs(a.diffSatang) >= settings.cash_alert_satang);
    if (!flagged.length) return;
    const lines = flagged.map(
      (a) =>
        `• ${a.attendantId ? names.get(a.attendantId) ?? '-' : 'ไม่ระบุพนักงาน'}: เงิน${a.diffSatang < 0 ? 'ขาด' : 'เกิน'} ${formatBaht(
          Math.abs(a.diffSatang),
        )} บาท (ควรได้ ${formatBaht(a.expectedSatang)} · ส่งจริง ${formatBaht(a.collectedSatang)})`,
    );
    const msg = [
      `⚠️ เงินขาด/เกินเกินเกณฑ์`,
      `${branch.name} · กะ ${shift.shift_no} วันที่ ${thaiDate(shift.business_date)}`,
      ...lines,
      `รวมทั้งกะ: ${calc.totals.diffSatang < 0 ? 'ขาด' : 'เกิน'} ${formatBaht(Math.abs(calc.totals.diffSatang))} บาท`,
    ].join('\n');
    await enqueueNotification(tx, auth.tenantId, `cash:${shift.id}:${eventId}`, 'cash_diff', msg);
  }
}
