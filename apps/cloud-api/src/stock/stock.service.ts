import { Inject, Injectable } from '@nestjs/common';

import { AuthCtx, isManagerOrOwner } from '../auth/auth-context.js';
import { assertBranch, tenantNow } from '../common/access.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../common/errors.js';
import { formatLitresShort, litresToMilli, milliToLitres, mmToDeci } from '../common/units.js';
import { Db, many, maybeOne, one, Tx } from '../db/db.js';
import { enqueueNotification, thaiDate } from '../notify/outbox.js';
import { currentCalibration, getTank } from '../settings/equipment.service.js';
import { calibrationFromJson, litresAtLevel } from './calibration.js';
import { reconcile } from './reconciliation.js';
import { notifyReorder, reconDto, tankDips, tankFlows, tankStatuses } from './tank-status.js';

interface DipRow {
  id: string;
  tank_id: string;
  business_date: string;
  measured_at: Date;
  level_mm: string;
  water_mm: string;
  litres: string;
  calibration_id: string;
  photo_id: string | null;
  supersedes_id: string | null;
  reason: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: Date;
  is_current: boolean;
}

interface DeliveryRow {
  id: string;
  root_id: string;
  branch_id: string;
  tank_id: string;
  business_date: string;
  delivered_at: Date;
  document_no: string | null;
  supplier: string | null;
  invoice_litres: string;
  dip_before_mm: string | null;
  dip_after_mm: string | null;
  measured_litres: string | null;
  voided: boolean;
  photo_id: string | null;
  supersedes_id: string | null;
  reason: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: Date;
  is_current: boolean;
}

const dipDto = (d: DipRow) => ({
  id: d.id,
  tankId: d.tank_id,
  businessDate: d.business_date,
  measuredAt: d.measured_at,
  levelMm: d.level_mm,
  waterMm: d.water_mm,
  litres: d.litres,
  calibrationId: d.calibration_id,
  photoId: d.photo_id,
  supersedesId: d.supersedes_id,
  reason: d.reason,
  recordedBy: d.recorded_by,
  recordedByName: d.recorded_by_name,
  recordedAt: d.recorded_at,
  current: d.is_current,
});

const deliveryDto = (d: DeliveryRow) => ({
  id: d.id,
  rootId: d.root_id,
  branchId: d.branch_id,
  tankId: d.tank_id,
  businessDate: d.business_date,
  deliveredAt: d.delivered_at,
  documentNo: d.document_no,
  supplier: d.supplier,
  invoiceLitres: d.invoice_litres,
  dipBeforeMm: d.dip_before_mm,
  dipAfterMm: d.dip_after_mm,
  measuredLitres: d.measured_litres,
  /** ได้จริง − ตามใบส่ง (ติดลบ = ได้น้อยกว่าใบส่ง) */
  receivedDiffLitres:
    d.measured_litres === null ? null : milliToLitres(litresToMilli(d.measured_litres) - litresToMilli(d.invoice_litres)),
  voided: d.voided,
  photoId: d.photo_id,
  supersedesId: d.supersedes_id,
  reason: d.reason,
  recordedBy: d.recorded_by,
  recordedByName: d.recorded_by_name,
  recordedAt: d.recorded_at,
  current: d.is_current,
});

const SELECT_DIPS = `
  SELECT d.*, u.display_name AS recorded_by_name,
         NOT EXISTS (SELECT 1 FROM tank_dips s WHERE s.supersedes_id = d.id) AS is_current
  FROM tank_dips d JOIN users u ON u.id = d.recorded_by`;

const SELECT_DELIVERIES = `
  SELECT d.*, u.display_name AS recorded_by_name,
         NOT EXISTS (SELECT 1 FROM fuel_deliveries s WHERE s.supersedes_id = d.id) AS is_current
  FROM fuel_deliveries d JOIN users u ON u.id = d.recorded_by`;

export interface DipInput {
  id: string;
  businessDate: string;
  measuredAt?: string | null;
  levelMm: string;
  waterMm?: string | null;
  photoId?: string | null;
  supersedesId?: string | null;
  reason?: string | null;
  deviceAt?: string | null;
}

export interface DeliveryInput {
  id: string;
  tankId: string;
  businessDate: string;
  deliveredAt?: string | null;
  documentNo?: string | null;
  supplier?: string | null;
  invoiceLitres: string;
  dipBeforeMm?: string | null;
  dipAfterMm?: string | null;
  voided?: boolean;
  photoId?: string | null;
  supersedesId?: string | null;
  reason?: string | null;
  deviceAt?: string | null;
}

@Injectable()
export class StockService {
  constructor(@Inject(Db) private readonly db: Db) {}

  tankStatus(auth: AuthCtx, branchId: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      return tankStatuses(tx, [branchId]);
    });
  }

  // ---------------------------------------------------------------- วัดถัง

  listDips(auth: AuthCtx, tankId: string, from: string, to: string) {
    return this.db.withTenant(auth, async (tx) => {
      await getTank(tx, auth, tankId);
      const rows = await many<DipRow>(
        tx,
        `${SELECT_DIPS} WHERE d.tank_id = $1 AND d.business_date BETWEEN $2 AND $3 ORDER BY d.business_date DESC, d.recorded_at`,
        [tankId, from, to],
      );
      return rows.map(dipDto);
    });
  }

  /** บันทึกการวัดถัง แปลงระดับเป็นลิตรด้วยตารางของถังนั้น (หักน้ำก้นถัง) */
  recordDip(auth: AuthCtx, tankId: string, input: DipInput) {
    return this.db.withTenant(auth, async (tx) => {
      const tank = await getTank(tx, auth, tankId);
      const existing = await maybeOne<DipRow>(tx, `${SELECT_DIPS} WHERE d.id = $1`, [input.id]);
      if (existing) {
        if (existing.tank_id !== tankId) throw conflict('ID_CONFLICT', 'รหัสรายการซ้ำกับรายการอื่น');
        return { dip: dipDto(existing), reconciliation: await this.dipRecon(tx, tankId, existing.business_date) };
      }
      await tx.query('SELECT 1 FROM tanks WHERE id = $1 FOR UPDATE', [tankId]);
      const cal = await currentCalibration(tx, tankId);
      if (!cal) throw unprocessable('NO_CALIBRATION', `ถัง ${tank.name} ยังไม่มีตารางแปลงระดับเป็นลิตร`);
      const points = calibrationFromJson(cal.points);
      const level = mmToDeci(input.levelMm);
      const water = mmToDeci(input.waterMm ?? '0');
      if (water > level) throw badRequest('WATER_ABOVE_LEVEL', 'ระดับน้ำต้องไม่สูงกว่าระดับน้ำมัน');
      const litres = litresAtLevel(points, level) - (water > 0 ? litresAtLevel(points, water) : 0);
      if (litres > litresToMilli(tank.capacity_litres) * 1.05) {
        throw unprocessable('OVER_CAPACITY', 'ปริมาณที่คำนวณได้เกินความจุถัง ตรวจระดับหรือตารางแปลงอีกครั้ง');
      }

      const head = await maybeOne<{ id: string }>(tx, 'SELECT id FROM tank_dips_current WHERE tank_id = $1 AND business_date = $2', [
        tankId,
        input.businessDate,
      ]);
      if (!head && input.supersedesId) throw badRequest('NOTHING_TO_CORRECT', 'ยังไม่มีรายการเดิมให้แก้ไข');
      if (head && !isManagerOrOwner(auth) && !input.reason?.trim()) {
        throw badRequest('REASON_REQUIRED', 'วันนี้วัดถังนี้แล้ว ถ้าต้องการแก้ไขให้ระบุเหตุผล');
      }
      await tx.query(
        `INSERT INTO tank_dips (id, tenant_id, tank_id, business_date, measured_at, level_mm, water_mm, litres,
           calibration_id, photo_id, supersedes_id, reason, recorded_by, device_at)
         VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          input.id,
          auth.tenantId,
          tankId,
          input.businessDate,
          input.measuredAt ?? null,
          input.levelMm,
          input.waterMm ?? '0',
          milliToLitres(litres),
          cal.id,
          input.photoId ?? null,
          head?.id ?? null,
          head ? input.reason?.trim() || 'แก้ไขการวัดถัง' : input.reason ?? null,
          auth.userId,
          input.deviceAt ?? null,
        ],
      );
      const dip = await one<DipRow>(tx, `${SELECT_DIPS} WHERE d.id = $1`, [input.id]);
      const recon = await this.dipRecon(tx, tankId, input.businessDate);
      await this.notifyDip(tx, auth, tank.branch_id, tank.name, tankId, recon);
      return { dip: dipDto(dip), reconciliation: recon };
    });
  }

  private async dipRecon(tx: Tx, tankId: string, date: string) {
    const dips = (await tankDips(tx, [tankId], null)).get(tankId) ?? [];
    const flows = (await tankFlows(tx, [tankId], null)).get(tankId) ?? new Map();
    const row = reconcile(dips, flows, date, date)[0];
    return row ? reconDto(row) : null;
  }

  private async notifyDip(
    tx: Tx,
    auth: AuthCtx,
    branchId: string,
    tankName: string,
    tankId: string,
    recon: ReturnType<typeof reconDto> | null,
  ) {
    const { today } = await tenantNow(tx);
    await notifyReorder(tx, auth.tenantId, branchId, today);
    if (!recon || recon.variancePercent === null) return;
    const settings = await one<{ variance_alert_percent: string }>(tx, 'SELECT variance_alert_percent FROM tenant_settings');
    const pct = Math.abs(Number(recon.variancePercent));
    if (pct < Number(settings.variance_alert_percent)) return;
    const branch = await one<{ name: string }>(tx, 'SELECT name FROM branches WHERE id = $1', [branchId]);
    const variance = litresToMilli(recon.varianceLitres);
    await enqueueNotification(
      tx,
      auth.tenantId,
      `variance:${tankId}:${recon.date}`,
      'tank_variance',
      [
        `🛢️ น้ำมัน${variance < 0 ? 'ขาด' : 'เกิน'}เกินเกณฑ์`,
        `${branch.name} · ${tankName} · วันที่ ${thaiDate(recon.date)}`,
        `ตามบัญชี ${formatLitresShort(litresToMilli(recon.bookLitres))} ลิตร · วัดจริง ${formatLitresShort(litresToMilli(recon.actualLitres))} ลิตร`,
        `${variance < 0 ? 'ขาด' : 'เกิน'} ${formatLitresShort(Math.abs(variance))} ลิตร (${recon.variancePercent}% ของยอดขาย)`,
      ].join('\n'),
    );
  }

  // ---------------------------------------------------------------- รับน้ำมัน

  listDeliveries(auth: AuthCtx, branchId: string, from: string, to: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const rows = await many<DeliveryRow>(
        tx,
        `${SELECT_DELIVERIES} WHERE d.branch_id = $1 AND d.business_date BETWEEN $2 AND $3
         ORDER BY d.business_date DESC, d.delivered_at DESC, d.recorded_at`,
        [branchId, from, to],
      );
      return rows.map(deliveryDto);
    });
  }

  /** บันทึกรับน้ำมันจากรถส่ง (ผู้จัดการ/เจ้าของ) */
  recordDelivery(auth: AuthCtx, input: DeliveryInput) {
    if (!isManagerOrOwner(auth)) throw forbidden('เฉพาะผู้จัดการหรือเจ้าของที่บันทึกรับน้ำมันได้');
    return this.db.withTenant(auth, async (tx) => {
      const tank = await getTank(tx, auth, input.tankId);
      const existing = await maybeOne<DeliveryRow>(tx, `${SELECT_DELIVERIES} WHERE d.id = $1`, [input.id]);
      if (existing) {
        if (existing.tank_id !== input.tankId && !input.supersedesId) throw conflict('ID_CONFLICT', 'รหัสรายการซ้ำกับรายการอื่น');
        return deliveryDto(existing);
      }
      await tx.query('SELECT 1 FROM tanks WHERE id = $1 FOR UPDATE', [input.tankId]);

      let rootId = input.id;
      let supersedesId: string | null = null;
      if (input.supersedesId) {
        const prev = await maybeOne<{ root_id: string }>(tx, 'SELECT root_id FROM fuel_deliveries WHERE id = $1', [input.supersedesId]);
        if (!prev) throw notFound('รายการรับน้ำมันเดิม');
        const head = await one<{ id: string }>(tx, 'SELECT id FROM fuel_deliveries_current WHERE root_id = $1', [prev.root_id]);
        rootId = prev.root_id;
        supersedesId = head.id;
        if (!input.reason?.trim()) throw badRequest('REASON_REQUIRED', 'กรุณาระบุเหตุผลการแก้ไข');
      }
      if (!input.voided && litresToMilli(input.invoiceLitres) <= 0) {
        throw badRequest('INVALID_LITRES', 'ลิตรตามใบส่งต้องมากกว่า 0');
      }

      let measured: string | null = null;
      let calibrationId: string | null = null;
      if (input.dipBeforeMm && input.dipAfterMm) {
        const cal = await currentCalibration(tx, input.tankId);
        if (cal) {
          const points = calibrationFromJson(cal.points);
          measured = milliToLitres(litresAtLevel(points, mmToDeci(input.dipAfterMm)) - litresAtLevel(points, mmToDeci(input.dipBeforeMm)));
          calibrationId = cal.id;
        }
      }
      await tx.query(
        `INSERT INTO fuel_deliveries (id, tenant_id, root_id, branch_id, tank_id, business_date, delivered_at, document_no,
           supplier, invoice_litres, dip_before_mm, dip_after_mm, measured_litres, calibration_id, voided, photo_id,
           supersedes_id, reason, recorded_by, device_at)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8, $9, $10, $11, $12, $13, $14, $15, $16,
           $17, $18, $19, $20)`,
        [
          input.id,
          auth.tenantId,
          rootId,
          tank.branch_id,
          input.tankId,
          input.businessDate,
          input.deliveredAt ?? null,
          input.documentNo ?? null,
          input.supplier ?? null,
          input.invoiceLitres,
          input.dipBeforeMm ?? null,
          input.dipAfterMm ?? null,
          measured,
          calibrationId,
          input.voided ?? false,
          input.photoId ?? null,
          supersedesId,
          supersedesId ? input.reason : input.reason ?? null,
          auth.userId,
          input.deviceAt ?? null,
        ],
      );
      return deliveryDto(await one<DeliveryRow>(tx, `${SELECT_DELIVERIES} WHERE d.id = $1`, [input.id]));
    });
  }

  // ---------------------------------------------------------------- เทียบยอด

  reconciliation(auth: AuthCtx, branchId: string, from: string, to: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const tanks = await many<{ id: string; code: string; name: string; fuel_type_id: string }>(
        tx,
        'SELECT id, code, name, fuel_type_id FROM tanks WHERE branch_id = $1 AND active ORDER BY sort_order, code',
        [branchId],
      );
      const ids = tanks.map((t) => t.id);
      // ต้องรู้วัดครั้งก่อนวันแรกของช่วง จึงดึงย้อนไปอีก 31 วัน
      const start = (await one<{ d: string }>(tx, 'SELECT ($1::date - 31)::date AS d', [from])).d;
      const dips = await tankDips(tx, ids, start);
      const flows = await tankFlows(tx, ids, start);
      const openShifts = await many<{ business_date: string; n: number }>(
        tx,
        `SELECT business_date, count(*)::int AS n FROM shifts
         WHERE branch_id = $1 AND status = 'open' AND business_date BETWEEN $2 AND $3 GROUP BY business_date`,
        [branchId, from, to],
      );
      return {
        tanks: tanks.map((t) => ({
          tankId: t.id,
          code: t.code,
          name: t.name,
          fuelTypeId: t.fuel_type_id,
          rows: reconcile(dips.get(t.id) ?? [], flows.get(t.id) ?? new Map(), from, to).map(reconDto),
        })),
        openShiftDates: openShifts.map((o) => o.business_date),
      };
    });
  }
}
