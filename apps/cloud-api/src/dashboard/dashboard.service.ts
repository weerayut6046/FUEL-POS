import { Inject, Injectable } from '@nestjs/common';

import type { AuthCtx } from '../auth/auth-context.js';
import { accessibleBranches, assertBranch, tenantNow } from '../common/access.js';
import { formatBaht, formatLitresShort, litresToMilli, milliToLitres } from '../common/units.js';
import { Db, many, one, Tx } from '../db/db.js';
import { thaiDate } from '../notify/outbox.js';
import { tankStatuses } from '../stock/tank-status.js';

const LINES_CTE = `
  WITH lines AS (
    SELECT l.branch_id, l.business_date, l.shift_id, l.fuel_type_id, l.attendant_id,
           (l.meter_litres - l.test_litres) AS sold,
           round((l.meter_litres - l.test_litres) * l.price_satang)::bigint AS amount
    FROM shift_lines l
    WHERE l.branch_id = ANY($1::uuid[]) AND l.business_date BETWEEN $2 AND $3
      AND l.status IN ('submitted', 'approved') AND l.meter_litres IS NOT NULL
  )`;

export interface Alert {
  kind: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  branchId: string;
  refId?: string;
}

/**
 * Dashboard เจ้าของ — ตอบคำถามทุกเช้า "เมื่อวานเงินกับน้ำมันครบไหม"
 * นับเฉพาะกะที่ส่งปิดแล้ว (รออนุมัติ + อนุมัติแล้ว)
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(Db) private readonly db: Db) {}

  summary(auth: AuthCtx, input: { from: string; to: string; branchId?: string | null }) {
    return this.db.withTenant(auth, async (tx) => {
      const branches = input.branchId ? [await assertBranch(tx, auth, input.branchId)] : await accessibleBranches(tx, auth);
      const branchIds = branches.map((b) => b.id);
      return {
        range: { from: input.from, to: input.to },
        branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
        ...(await this.figures(tx, branchIds, input.from, input.to)),
        tanks: await tankStatuses(tx, branchIds),
        alerts: await this.alerts(tx, branchIds, new Map(branches.map((b) => [b.id, b.name]))),
      };
    });
  }

  async figures(tx: Tx, branchIds: string[], from: string, to: string) {
    const params = [branchIds, from, to];
    const daily = await many<{ business_date: string; sold: string; amount: number }>(
      tx,
      `${LINES_CTE} SELECT business_date, sum(sold)::numeric(14,3) AS sold, sum(amount)::bigint AS amount
       FROM lines GROUP BY business_date ORDER BY business_date`,
      params,
    );
    const byBranch = await many<{ branch_id: string; sold: string; amount: number }>(
      tx,
      `${LINES_CTE} SELECT branch_id, sum(sold)::numeric(14,3) AS sold, sum(amount)::bigint AS amount FROM lines GROUP BY branch_id`,
      params,
    );
    const byFuel = await many<{ fuel_type_id: string; name: string; color: string; sold: string; amount: number }>(
      tx,
      `${LINES_CTE} SELECT l.fuel_type_id, f.name, f.color, sum(l.sold)::numeric(14,3) AS sold, sum(l.amount)::bigint AS amount
       FROM lines l JOIN fuel_types f ON f.id = l.fuel_type_id
       GROUP BY l.fuel_type_id, f.name, f.color, f.sort_order ORDER BY f.sort_order`,
      params,
    );
    const dailyByFuel = await many<{ business_date: string; fuel_type_id: string; sold: string }>(
      tx,
      `${LINES_CTE} SELECT business_date, fuel_type_id, sum(sold)::numeric(14,3) AS sold
       FROM lines GROUP BY business_date, fuel_type_id ORDER BY business_date`,
      params,
    );
    const expected = await many<{ shift_id: string; attendant_id: string | null; amount: number }>(
      tx,
      `${LINES_CTE} SELECT shift_id, attendant_id, sum(amount)::bigint AS amount FROM lines GROUP BY shift_id, attendant_id`,
      params,
    );
    const collected = await many<{ shift_id: string; attendant_id: string; amount: number }>(
      tx,
      `SELECT c.shift_id, c.attendant_id, sum(c.amount_satang)::bigint AS amount
       FROM shift_collections_current c JOIN shifts s ON s.id = c.shift_id
       WHERE s.branch_id = ANY($1::uuid[]) AND s.business_date BETWEEN $2 AND $3 AND s.status IN ('submitted', 'approved')
       GROUP BY c.shift_id, c.attendant_id`,
      params,
    );
    const shifts = await many<{ id: string; branch_id: string; business_date: string; shift_no: number; status: string }>(
      tx,
      `SELECT id, branch_id, business_date, shift_no, status FROM shifts
       WHERE branch_id = ANY($1::uuid[]) AND business_date BETWEEN $2 AND $3`,
      params,
    );
    const names = new Map(
      (await many<{ id: string; display_name: string }>(tx, 'SELECT id, display_name FROM users')).map((u) => [u.id, u.display_name]),
    );

    // เงินขาด/เกิน รายกะ และรายพนักงาน
    const key = (s: string, a: string | null) => `${s}|${a ?? ''}`;
    const cash = new Map<string, { shiftId: string; attendantId: string | null; expected: number; collected: number }>();
    for (const e of expected) cash.set(key(e.shift_id, e.attendant_id), { shiftId: e.shift_id, attendantId: e.attendant_id, expected: e.amount, collected: 0 });
    for (const c of collected) {
      const k = key(c.shift_id, c.attendant_id);
      const row = cash.get(k) ?? { shiftId: c.shift_id, attendantId: c.attendant_id, expected: 0, collected: 0 };
      row.collected += c.amount;
      cash.set(k, row);
    }
    const shiftMap = new Map(shifts.map((s) => [s.id, s]));
    const perShift = new Map<string, { expected: number; collected: number }>();
    const perAttendant = new Map<string, { attendantId: string | null; shifts: Set<string>; diff: number; shortCount: number }>();
    for (const r of cash.values()) {
      const ps = perShift.get(r.shiftId) ?? { expected: 0, collected: 0 };
      ps.expected += r.expected;
      ps.collected += r.collected;
      perShift.set(r.shiftId, ps);
      const ak = r.attendantId ?? '';
      const pa = perAttendant.get(ak) ?? { attendantId: r.attendantId, shifts: new Set<string>(), diff: 0, shortCount: 0 };
      pa.shifts.add(r.shiftId);
      pa.diff += r.collected - r.expected;
      if (r.collected - r.expected < 0) pa.shortCount++;
      perAttendant.set(ak, pa);
    }

    const totalSales = daily.reduce((s, d) => s + d.amount, 0);
    const totalSold = daily.reduce((s, d) => s + litresToMilli(d.sold), 0);
    const totalDiff = [...perShift.values()].reduce((s, p) => s + p.collected - p.expected, 0);
    const done = shifts.filter((s) => s.status !== 'open');

    return {
      totals: {
        salesSatang: totalSales,
        soldLitres: milliToLitres(totalSold),
        cashDiffSatang: totalDiff,
        shiftCount: done.length,
        pendingApproval: shifts.filter((s) => s.status === 'submitted').length,
        openShifts: shifts.filter((s) => s.status === 'open').length,
      },
      daily: daily.map((d) => ({ date: d.business_date, soldLitres: d.sold, salesSatang: d.amount })),
      dailyByFuel: dailyByFuel.map((d) => ({ date: d.business_date, fuelTypeId: d.fuel_type_id, soldLitres: d.sold })),
      byBranch: byBranch.map((b) => {
        const diff = [...perShift.entries()]
          .filter(([sid]) => shiftMap.get(sid)?.branch_id === b.branch_id)
          .reduce((s, [, p]) => s + p.collected - p.expected, 0);
        return { branchId: b.branch_id, soldLitres: b.sold, salesSatang: b.amount, cashDiffSatang: diff };
      }),
      byFuel: byFuel.map((f) => ({ fuelTypeId: f.fuel_type_id, name: f.name, color: f.color, soldLitres: f.sold, salesSatang: f.amount })),
      cashByShift: [...perShift.entries()]
        .map(([shiftId, p]) => {
          const s = shiftMap.get(shiftId)!;
          return {
            shiftId,
            branchId: s.branch_id,
            businessDate: s.business_date,
            shiftNo: s.shift_no,
            status: s.status,
            expectedSatang: p.expected,
            collectedSatang: p.collected,
            diffSatang: p.collected - p.expected,
          };
        })
        .sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.shiftNo - a.shiftNo),
      cashByAttendant: [...perAttendant.values()]
        .map((a) => ({
          attendantId: a.attendantId,
          name: a.attendantId ? names.get(a.attendantId) ?? '-' : 'ไม่ระบุพนักงาน',
          shifts: a.shifts.size,
          shortShifts: a.shortCount,
          diffSatang: a.diff,
        }))
        .sort((a, b) => a.diffSatang - b.diffSatang),
    };
  }

  /** เรื่องที่เจ้าของต้องรู้ตอนนี้ */
  async alerts(tx: Tx, branchIds: string[], branchNames: Map<string, string>): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const settings = await one<{ variance_alert_percent: string }>(tx, 'SELECT variance_alert_percent FROM tenant_settings');
    const { today } = await tenantNow(tx);
    const bn = (id: string) => branchNames.get(id) ?? '';

    for (const t of await tankStatuses(tx, branchIds)) {
      if (t.belowReorder) {
        alerts.push({
          kind: 'reorder',
          severity: 'critical',
          message: `${bn(t.branchId)} · ${t.name}: เหลือ ~${formatLitresShort(litresToMilli(t.bookLitres!))} ลิตร ถึงจุดสั่งแล้ว`,
          branchId: t.branchId,
          refId: t.tankId,
        });
      }
      if (!t.lastDipDate) {
        alerts.push({ kind: 'no_dip', severity: 'info', message: `${bn(t.branchId)} · ${t.name}: ยังไม่เคยวัดถัง`, branchId: t.branchId, refId: t.tankId });
      } else if (t.lastDipDate < (await one<{ d: string }>(tx, 'SELECT ($1::date - 1)::date AS d', [today])).d) {
        alerts.push({
          kind: 'stale_dip',
          severity: 'warning',
          message: `${bn(t.branchId)} · ${t.name}: ไม่ได้วัดถังตั้งแต่ ${thaiDate(t.lastDipDate)}`,
          branchId: t.branchId,
          refId: t.tankId,
        });
      }
      const v = t.lastVariance;
      if (v?.variancePercent && Math.abs(Number(v.variancePercent)) >= Number(settings.variance_alert_percent)) {
        const milli = litresToMilli(v.varianceLitres);
        alerts.push({
          kind: 'variance',
          severity: milli < 0 ? 'critical' : 'warning',
          message: `${bn(t.branchId)} · ${t.name}: น้ำมัน${milli < 0 ? 'ขาด' : 'เกิน'} ${formatLitresShort(Math.abs(milli))} ลิตร (${v.variancePercent}%) วันที่ ${thaiDate(v.date)}`,
          branchId: t.branchId,
          refId: t.tankId,
        });
      }
    }

    const pending = await many<{ id: string; branch_id: string; business_date: string; shift_no: number; status: string; stale: boolean }>(
      tx,
      `SELECT id, branch_id, business_date, shift_no, status, opened_at < now() - interval '16 hours' AS stale
       FROM shifts WHERE branch_id = ANY($1::uuid[]) AND status IN ('open', 'submitted')
       ORDER BY business_date, shift_no`,
      [branchIds],
    );
    for (const s of pending) {
      if (s.status === 'submitted') {
        alerts.push({
          kind: 'pending_approval',
          severity: 'info',
          message: `${bn(s.branch_id)}: กะ ${s.shift_no} วันที่ ${thaiDate(s.business_date)} รอผู้จัดการยืนยัน`,
          branchId: s.branch_id,
          refId: s.id,
        });
      } else if (s.stale) {
        alerts.push({
          kind: 'stale_shift',
          severity: 'warning',
          message: `${bn(s.branch_id)}: กะ ${s.shift_no} วันที่ ${thaiDate(s.business_date)} เปิดค้างเกิน 16 ชั่วโมง`,
          branchId: s.branch_id,
          refId: s.id,
        });
      }
    }
    const order = { critical: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /** ข้อความสรุปประจำวันสำหรับส่ง LINE */
  async dailySummaryText(tx: Tx, date: string): Promise<string | null> {
    const branches = await many<{ id: string; name: string }>(tx, 'SELECT id, name FROM branches WHERE active ORDER BY code');
    if (!branches.length) return null;
    const parts: string[] = [`📊 สรุปประจำวันที่ ${thaiDate(date)}`];
    for (const b of branches) {
      const f = await this.figures(tx, [b.id], date, date);
      parts.push('', `🏪 ${b.name}`);
      if (f.totals.shiftCount === 0) {
        parts.push('ยังไม่มีกะที่ปิดแล้ว');
      } else {
        parts.push(`ยอดขาย ${formatBaht(f.totals.salesSatang)} บาท · ${formatLitresShort(litresToMilli(f.totals.soldLitres))} ลิตร`);
        for (const fuel of f.byFuel) parts.push(`• ${fuel.name}: ${formatLitresShort(litresToMilli(fuel.soldLitres))} ลิตร`);
        const d = f.totals.cashDiffSatang;
        parts.push(d === 0 ? 'เงินครบทุกกะ ✅' : `เงิน${d < 0 ? 'ขาด' : 'เกิน'}รวม ${formatBaht(Math.abs(d))} บาท`);
        if (f.totals.pendingApproval) parts.push(`รอยืนยัน ${f.totals.pendingApproval} กะ`);
      }
      if (f.totals.openShifts) parts.push(`กะที่ยังเปิดอยู่ ${f.totals.openShifts} กะ`);
      const tanks = await tankStatuses(tx, [b.id]);
      const low = tanks.filter((t) => t.belowReorder);
      if (low.length) parts.push(`⛽ ถึงจุดสั่ง: ${low.map((t) => t.name).join(', ')}`);
    }
    return parts.join('\n');
  }
}
