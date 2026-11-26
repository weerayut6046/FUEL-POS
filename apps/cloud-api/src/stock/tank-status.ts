import { dbLitres, formatLitresShort, litresToMilli, milliToLitres } from '../common/units.js';
import { many, maybeOne, Tx } from '../db/db.js';
import { enqueueNotification, thaiDate } from '../notify/outbox.js';
import { bookStock, DayFlow, DipPoint, percentString, reconcile, ReconRow } from './reconciliation.js';

/**
 * ข้อมูลการเคลื่อนไหวรายวันของถัง (รับเข้า/ขายออก) ตั้งแต่วันที่กำหนด
 * ยอดขายนับเฉพาะกะที่ส่งปิดแล้ว (submitted/approved)
 */
export async function tankFlows(tx: Tx, tankIds: string[], fromDate: string | null): Promise<Map<string, Map<string, DayFlow>>> {
  const result = new Map<string, Map<string, DayFlow>>();
  const get = (tankId: string, date: string): DayFlow => {
    let byDate = result.get(tankId);
    if (!byDate) result.set(tankId, (byDate = new Map()));
    let f = byDate.get(date);
    if (!f) byDate.set(date, (f = { deliveriesMilli: 0, salesMilli: 0 }));
    return f;
  };
  if (tankIds.length === 0) return result;
  const deliveries = await many<{ tank_id: string; business_date: string; litres: string }>(
    tx,
    `SELECT tank_id, business_date, sum(invoice_litres)::numeric(14,3) AS litres
     FROM fuel_deliveries_current
     WHERE tank_id = ANY($1::uuid[]) AND NOT voided AND ($2::date IS NULL OR business_date >= $2::date)
     GROUP BY tank_id, business_date`,
    [tankIds, fromDate],
  );
  for (const d of deliveries) get(d.tank_id, d.business_date).deliveriesMilli += litresToMilli(d.litres);
  const sales = await many<{ tank_id: string; business_date: string; litres: string }>(
    tx,
    `SELECT tank_id, business_date, sum(meter_litres - test_litres)::numeric(14,3) AS litres
     FROM shift_lines
     WHERE tank_id = ANY($1::uuid[]) AND status IN ('submitted', 'approved') AND meter_litres IS NOT NULL
       AND ($2::date IS NULL OR business_date >= $2::date)
     GROUP BY tank_id, business_date`,
    [tankIds, fromDate],
  );
  for (const s of sales) get(s.tank_id, s.business_date).salesMilli += litresToMilli(s.litres);
  return result;
}

export async function tankDips(tx: Tx, tankIds: string[], fromDate: string | null): Promise<Map<string, DipPoint[]>> {
  const rows = await many<{ tank_id: string; business_date: string; litres: string }>(
    tx,
    `SELECT tank_id, business_date, litres FROM tank_dips_current
     WHERE tank_id = ANY($1::uuid[]) AND ($2::date IS NULL OR business_date >= $2::date)
     ORDER BY business_date`,
    [tankIds, fromDate],
  );
  const map = new Map<string, DipPoint[]>();
  for (const r of rows) {
    const list = map.get(r.tank_id) ?? [];
    list.push({ date: r.business_date, milli: litresToMilli(r.litres) });
    map.set(r.tank_id, list);
  }
  return map;
}

export interface TankStatus {
  tankId: string;
  code: string;
  name: string;
  branchId: string;
  fuelTypeId: string;
  capacityLitres: string;
  reorderLitres: string;
  lastDipDate: string | null;
  lastDipLitres: string | null;
  bookLitres: string | null;
  fillPercent: string | null;
  belowReorder: boolean;
  lastVariance: ReturnType<typeof reconDto> | null;
}

export function reconDto(r: ReconRow) {
  return {
    date: r.date,
    prevDate: r.prevDate,
    openingLitres: milliToLitres(r.openingMilli),
    deliveriesLitres: milliToLitres(r.deliveriesMilli),
    salesLitres: milliToLitres(r.salesMilli),
    bookLitres: milliToLitres(r.bookMilli),
    actualLitres: milliToLitres(r.actualMilli),
    varianceLitres: milliToLitres(r.varianceMilli),
    variancePercent: r.variancePercent,
  };
}

/** สถานะปัจจุบันของถังในสาขา: วัดล่าสุด ยอดตามบัญชี เปอร์เซ็นต์ความจุ ถึงจุดสั่งหรือยัง */
export async function tankStatuses(tx: Tx, branchIds: string[]): Promise<TankStatus[]> {
  const tanks = await many<{
    id: string;
    code: string;
    name: string;
    branch_id: string;
    fuel_type_id: string;
    capacity_litres: string;
    reorder_litres: string;
  }>(
    tx,
    `SELECT id, code, name, branch_id, fuel_type_id, capacity_litres, reorder_litres
     FROM tanks WHERE branch_id = ANY($1::uuid[]) AND active ORDER BY branch_id, sort_order, code`,
    [branchIds],
  );
  const ids = tanks.map((t) => t.id);
  // ใช้แค่การวัด 2 ครั้งล่าสุดของแต่ละถัง (ล่าสุด = ฐานของยอดคงเหลือ, ก่อนหน้า = ใช้หาขาด/เกินล่าสุด)
  const recent = await many<{ tank_id: string; business_date: string; litres: string }>(
    tx,
    `SELECT tank_id, business_date, litres FROM (
       SELECT tank_id, business_date, litres,
              row_number() OVER (PARTITION BY tank_id ORDER BY business_date DESC) AS rn
       FROM tank_dips_current WHERE tank_id = ANY($1::uuid[])
     ) x WHERE rn <= 2 ORDER BY business_date`,
    [ids],
  );
  const dips = new Map<string, DipPoint[]>();
  for (const r of recent) {
    const list = dips.get(r.tank_id) ?? [];
    list.push({ date: r.business_date, milli: litresToMilli(r.litres) });
    dips.set(r.tank_id, list);
  }
  const since = recent.length ? recent.reduce((m, r) => (r.business_date < m ? r.business_date : m), recent[0]!.business_date) : null;
  const flows = since ? await tankFlows(tx, ids, since) : new Map<string, Map<string, DayFlow>>();
  return tanks.map((t) => {
    const list = dips.get(t.id) ?? [];
    const last = list.at(-1) ?? null;
    const f = flows.get(t.id) ?? new Map<string, DayFlow>();
    const book = bookStock(last, f);
    const recon = reconcile(list, f, '0000-01-01', '9999-12-31');
    const capacity = litresToMilli(t.capacity_litres);
    const level = book ?? null;
    return {
      tankId: t.id,
      code: t.code,
      name: t.name,
      branchId: t.branch_id,
      fuelTypeId: t.fuel_type_id,
      capacityLitres: t.capacity_litres,
      reorderLitres: t.reorder_litres,
      lastDipDate: last?.date ?? null,
      lastDipLitres: last ? milliToLitres(last.milli) : null,
      bookLitres: book === null ? null : milliToLitres(book),
      fillPercent: level === null ? null : percentString(level, capacity),
      belowReorder: level !== null && level < (dbLitres(t.reorder_litres) ?? 0),
      lastVariance: recon.length ? reconDto(recon.at(-1)!) : null,
    };
  });
}

/** เตือนถังที่ยอดคงเหลือต่ำกว่าจุดสั่ง (วันละครั้งต่อถัง) */
export async function notifyReorder(tx: Tx, tenantId: string, branchId: string, today: string): Promise<void> {
  const statuses = await tankStatuses(tx, [branchId]);
  const low = statuses.filter((s) => s.belowReorder);
  if (!low.length) return;
  const branch = await maybeOne<{ name: string }>(tx, 'SELECT name FROM branches WHERE id = $1', [branchId]);
  for (const s of low) {
    await enqueueNotification(
      tx,
      tenantId,
      `reorder:${s.tankId}:${today}`,
      'reorder',
      [
        `⛽ น้ำมันใกล้หมด ถึงจุดสั่งแล้ว`,
        `${branch?.name ?? ''} · ${s.name}`,
        `คงเหลือ ~${formatLitresShort(litresToMilli(s.bookLitres!))} ลิตร (${s.fillPercent}% ของถัง)`,
        `จุดสั่ง ${formatLitresShort(litresToMilli(s.reorderLitres))} ลิตร · วัดล่าสุด ${s.lastDipDate ? thaiDate(s.lastDipDate) : '-'}`,
      ].join('\n'),
    );
  }
}
