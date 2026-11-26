import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AuthCtx } from '../auth/auth-context.js';
import { accessibleBranches, assertBranch, branchDto, BranchRow } from '../common/access.js';
import { badRequest, notFound } from '../common/errors.js';
import { Db, many, maybeOne, one, Tx } from '../db/db.js';

interface FuelTypeRow {
  id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
  active: boolean;
}

interface PriceRow {
  id: string;
  fuel_type_id: string;
  price_satang: number;
  effective_at: Date;
  note: string | null;
  created_by: string;
  created_by_name?: string;
  created_at: Date;
}

export const fuelTypeDto = (f: FuelTypeRow) => ({
  id: f.id,
  code: f.code,
  name: f.name,
  color: f.color,
  sortOrder: f.sort_order,
  active: f.active,
});

const priceDto = (p: PriceRow) => ({
  id: p.id,
  fuelTypeId: p.fuel_type_id,
  priceSatang: p.price_satang,
  effectiveAt: p.effective_at,
  note: p.note,
  createdBy: p.created_by,
  createdByName: p.created_by_name ?? null,
  createdAt: p.created_at,
});

/** ราคาที่มีผล ณ เวลาหนึ่ง ต่อชนิดน้ำมัน ของสาขา */
export async function pricesAt(tx: Tx, branchId: string, at: Date | string = new Date()): Promise<Map<string, number>> {
  const rows = await many<{ fuel_type_id: string; price_satang: number }>(
    tx,
    `SELECT DISTINCT ON (fuel_type_id) fuel_type_id, price_satang
     FROM fuel_prices WHERE branch_id = $1 AND effective_at <= $2
     ORDER BY fuel_type_id, effective_at DESC, created_at DESC`,
    [branchId, at],
  );
  return new Map(rows.map((r) => [r.fuel_type_id, r.price_satang]));
}

@Injectable()
export class CatalogService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---------------------------------------------------------------- สาขา

  listBranches(auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) =>
      (await accessibleBranches(tx, auth, auth.role === 'owner')).map(branchDto),
    );
  }

  createBranch(auth: AuthCtx, input: { code: string; name: string; address?: string | null; taxId?: string | null; phone?: string | null }) {
    return this.db.withTenant(auth, async (tx) => {
      const row = await one<BranchRow>(
        tx,
        `INSERT INTO branches (tenant_id, code, name, address, tax_id, phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [auth.tenantId, input.code, input.name, input.address ?? null, input.taxId ?? null, input.phone ?? null],
      );
      return branchDto(row);
    });
  }

  updateBranch(
    auth: AuthCtx,
    id: string,
    input: Partial<{ code: string; name: string; address: string | null; taxId: string | null; phone: string | null; active: boolean }>,
  ) {
    return this.db.withTenant(auth, async (tx) => {
      const row = await maybeOne<BranchRow>(
        tx,
        `UPDATE branches SET
           code = coalesce($2, code), name = coalesce($3, name),
           address = CASE WHEN $4::boolean THEN $5 ELSE address END,
           tax_id = CASE WHEN $6::boolean THEN $7 ELSE tax_id END,
           phone = CASE WHEN $8::boolean THEN $9 ELSE phone END,
           active = coalesce($10, active)
         WHERE id = $1 RETURNING *`,
        [
          id,
          input.code ?? null,
          input.name ?? null,
          input.address !== undefined,
          input.address ?? null,
          input.taxId !== undefined,
          input.taxId ?? null,
          input.phone !== undefined,
          input.phone ?? null,
          input.active ?? null,
        ],
      );
      if (!row) throw notFound('สาขา');
      return branchDto(row);
    });
  }

  // ---------------------------------------------------------------- ชนิดน้ำมัน

  listFuelTypes(auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) =>
      (await many<FuelTypeRow>(tx, 'SELECT * FROM fuel_types ORDER BY sort_order, code')).map(fuelTypeDto),
    );
  }

  createFuelType(auth: AuthCtx, input: { code: string; name: string; color?: string; sortOrder?: number }) {
    return this.db.withTenant(auth, async (tx) => {
      const row = await one<FuelTypeRow>(
        tx,
        `INSERT INTO fuel_types (tenant_id, code, name, color, sort_order)
         VALUES ($1, $2, $3, coalesce($4, '#1565C0'), coalesce($5, 0)) RETURNING *`,
        [auth.tenantId, input.code, input.name, input.color ?? null, input.sortOrder ?? null],
      );
      return fuelTypeDto(row);
    });
  }

  updateFuelType(auth: AuthCtx, id: string, input: Partial<{ code: string; name: string; color: string; sortOrder: number; active: boolean }>) {
    return this.db.withTenant(auth, async (tx) => {
      const row = await maybeOne<FuelTypeRow>(
        tx,
        `UPDATE fuel_types SET code = coalesce($2, code), name = coalesce($3, name), color = coalesce($4, color),
           sort_order = coalesce($5, sort_order), active = coalesce($6, active)
         WHERE id = $1 RETURNING *`,
        [id, input.code ?? null, input.name ?? null, input.color ?? null, input.sortOrder ?? null, input.active ?? null],
      );
      if (!row) throw notFound('ชนิดน้ำมัน');
      return fuelTypeDto(row);
    });
  }

  // ---------------------------------------------------------------- ราคา

  listPrices(auth: AuthCtx, branchId: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const current = await many<PriceRow>(
        tx,
        `SELECT DISTINCT ON (fuel_type_id) p.*, u.display_name AS created_by_name
         FROM fuel_prices p JOIN users u ON u.id = p.created_by
         WHERE p.branch_id = $1 AND p.effective_at <= now()
         ORDER BY fuel_type_id, effective_at DESC, created_at DESC`,
        [branchId],
      );
      const scheduled = await many<PriceRow>(
        tx,
        `SELECT p.*, u.display_name AS created_by_name FROM fuel_prices p JOIN users u ON u.id = p.created_by
         WHERE p.branch_id = $1 AND p.effective_at > now() ORDER BY effective_at`,
        [branchId],
      );
      const history = await many<PriceRow>(
        tx,
        `SELECT p.*, u.display_name AS created_by_name FROM fuel_prices p JOIN users u ON u.id = p.created_by
         WHERE p.branch_id = $1 ORDER BY effective_at DESC, created_at DESC LIMIT 200`,
        [branchId],
      );
      return { current: current.map(priceDto), scheduled: scheduled.map(priceDto), history: history.map(priceDto) };
    });
  }

  /** ประกาศราคาใหม่ (หลายชนิดพร้อมกัน) — เพิ่มประวัติ ไม่แก้ราคาเดิม */
  setPrices(
    auth: AuthCtx,
    branchId: string,
    input: { effectiveAt?: string | null; note?: string | null; items: { fuelTypeId: string; priceSatang: number }[] },
  ) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const effectiveAt = input.effectiveAt ?? new Date().toISOString();
      const seen = new Set<string>();
      for (const item of input.items) {
        if (seen.has(item.fuelTypeId)) throw badRequest('DUPLICATE_FUEL', 'ระบุชนิดน้ำมันซ้ำ');
        seen.add(item.fuelTypeId);
        await tx.query(
          `INSERT INTO fuel_prices (id, tenant_id, branch_id, fuel_type_id, price_satang, effective_at, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [randomUUID(), auth.tenantId, branchId, item.fuelTypeId, item.priceSatang, effectiveAt, input.note ?? null, auth.userId],
        );
      }
      return { effectiveAt, count: input.items.length };
    });
  }

  // ---------------------------------------------------------------- ค่าตั้งของลูกค้า

  getSettings(auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) => {
      const s = await one<{
        timezone: string;
        cash_alert_satang: number;
        variance_alert_percent: string;
        daily_summary_hour: number | null;
      }>(tx, 'SELECT * FROM tenant_settings');
      const t = await one<{ name: string; slug: string; plan: string; status: string; trial_ends_at: string | null }>(
        tx,
        'SELECT name, slug, plan, status, trial_ends_at FROM tenants',
      );
      return {
        tenantName: t.name,
        slug: t.slug,
        plan: t.plan,
        status: t.status,
        trialEndsAt: t.trial_ends_at,
        timezone: s.timezone,
        cashAlertSatang: s.cash_alert_satang,
        varianceAlertPercent: s.variance_alert_percent,
        dailySummaryHour: s.daily_summary_hour,
      };
    });
  }

  async updateSettings(
    auth: AuthCtx,
    input: Partial<{ tenantName: string; cashAlertSatang: number; varianceAlertPercent: string; dailySummaryHour: number | null }>,
  ) {
    await this.db.withTenant(auth, async (tx) => {
      if (input.tenantName) await tx.query('UPDATE tenants SET name = $1', [input.tenantName]);
      await tx.query(
        `UPDATE tenant_settings SET
           cash_alert_satang = coalesce($1, cash_alert_satang),
           variance_alert_percent = coalesce($2::numeric, variance_alert_percent),
           daily_summary_hour = CASE WHEN $3::boolean THEN $4 ELSE daily_summary_hour END,
           updated_at = now()`,
        [
          input.cashAlertSatang ?? null,
          input.varianceAlertPercent ?? null,
          input.dailySummaryHour !== undefined,
          input.dailySummaryHour ?? null,
        ],
      );
    });
    return this.getSettings(auth);
  }

  /** ประวัติการแก้ไขตั้งค่า (ใครแก้อะไร เมื่อไร) */
  auditLog(auth: AuthCtx, limit: number) {
    return this.db.withTenant(auth, async (tx) => {
      const rows = await many<{
        id: number;
        table_name: string;
        row_id: string | null;
        action: string;
        actor_id: string | null;
        actor_name: string | null;
        at: Date;
        old_data: unknown;
        new_data: unknown;
      }>(
        tx,
        `SELECT a.*, u.display_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.at DESC, a.id DESC LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        table: r.table_name,
        rowId: r.row_id,
        action: r.action,
        actorId: r.actor_id,
        actorName: r.actor_name,
        at: r.at,
        old: r.old_data,
        new: r.new_data,
      }));
    });
  }
}
