import { Inject, Injectable } from '@nestjs/common';

import type { AuthCtx } from '../auth/auth-context.js';
import { assertBranch, branchDto } from '../common/access.js';
import { notFound, unprocessable } from '../common/errors.js';
import { Db, many, maybeOne, one, Tx } from '../db/db.js';
import { calibrationToJson, CalPointJson, parseCalibration } from '../stock/calibration.js';
import { fuelTypeDto, pricesAt } from './catalog.service.js';

export interface TankRow {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  fuel_type_id: string;
  capacity_litres: string;
  reorder_litres: string;
  sort_order: number;
  active: boolean;
}

export interface NozzleRow {
  id: string;
  branch_id: string;
  code: string;
  name: string;
  dispenser_no: number;
  fuel_type_id: string;
  tank_id: string;
  meter_modulus: string;
  sort_order: number;
  active: boolean;
}

export interface CalibrationRow {
  id: string;
  tank_id: string;
  points: CalPointJson[];
  note: string | null;
  created_by: string;
  created_at: Date;
}

export const tankDto = (t: TankRow) => ({
  id: t.id,
  branchId: t.branch_id,
  code: t.code,
  name: t.name,
  fuelTypeId: t.fuel_type_id,
  capacityLitres: t.capacity_litres,
  reorderLitres: t.reorder_litres,
  sortOrder: t.sort_order,
  active: t.active,
});

export const nozzleDto = (n: NozzleRow) => ({
  id: n.id,
  branchId: n.branch_id,
  code: n.code,
  name: n.name,
  dispenserNo: n.dispenser_no,
  fuelTypeId: n.fuel_type_id,
  tankId: n.tank_id,
  meterModulus: n.meter_modulus,
  sortOrder: n.sort_order,
  active: n.active,
});

const calibrationDto = (c: CalibrationRow) => ({
  id: c.id,
  tankId: c.tank_id,
  points: c.points,
  note: c.note,
  createdBy: c.created_by,
  createdAt: c.created_at,
});

/** ตารางแปลงเวอร์ชันล่าสุดของถัง */
export async function currentCalibration(tx: Tx, tankId: string): Promise<CalibrationRow | null> {
  return maybeOne<CalibrationRow>(
    tx,
    'SELECT * FROM tank_calibrations WHERE tank_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
    [tankId],
  );
}

export async function getTank(tx: Tx, auth: AuthCtx, tankId: string): Promise<TankRow> {
  const tank = await maybeOne<TankRow>(tx, 'SELECT * FROM tanks WHERE id = $1', [tankId]);
  if (!tank) throw notFound('ถัง');
  await assertBranch(tx, auth, tank.branch_id);
  return tank;
}

type TankInput = {
  code: string;
  name: string;
  fuelTypeId: string;
  capacityLitres: string;
  reorderLitres?: string | null;
  sortOrder?: number | null;
};

type NozzleInput = {
  code: string;
  name: string;
  dispenserNo?: number | null;
  fuelTypeId: string;
  tankId: string;
  meterModulus?: string | null;
  sortOrder?: number | null;
};

@Injectable()
export class EquipmentService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---------------------------------------------------------------- ถัง

  listTanks(auth: AuthCtx, branchId: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const tanks = await many<TankRow & { cal_id: string | null; cal_points: CalPointJson[] | null; cal_at: Date | null }>(
        tx,
        `SELECT t.*, c.id AS cal_id, c.points AS cal_points, c.created_at AS cal_at
         FROM tanks t
         LEFT JOIN LATERAL (
           SELECT id, points, created_at FROM tank_calibrations
           WHERE tank_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1
         ) c ON true
         WHERE t.branch_id = $1 ORDER BY t.sort_order, t.code`,
        [branchId],
      );
      return tanks.map((t) => ({
        ...tankDto(t),
        calibration: t.cal_id
          ? {
              id: t.cal_id,
              rows: t.cal_points?.length ?? 0,
              maxMm: t.cal_points?.at(-1)?.mm ?? null,
              maxLitres: t.cal_points?.at(-1)?.litres ?? null,
              createdAt: t.cal_at,
            }
          : null,
      }));
    });
  }

  createTank(auth: AuthCtx, branchId: string, input: TankInput) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const row = await one<TankRow>(
        tx,
        `INSERT INTO tanks (tenant_id, branch_id, code, name, fuel_type_id, capacity_litres, reorder_litres, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, coalesce($7::numeric, 0), coalesce($8, 0)) RETURNING *`,
        [
          auth.tenantId,
          branchId,
          input.code,
          input.name,
          input.fuelTypeId,
          input.capacityLitres,
          input.reorderLitres ?? null,
          input.sortOrder ?? null,
        ],
      );
      return tankDto(row);
    });
  }

  updateTank(auth: AuthCtx, tankId: string, input: Partial<TankInput & { active: boolean }>) {
    return this.db.withTenant(auth, async (tx) => {
      const tank = await getTank(tx, auth, tankId);
      if (input.fuelTypeId && input.fuelTypeId !== tank.fuel_type_id) {
        const used = await maybeOne(tx, 'SELECT 1 FROM nozzles WHERE tank_id = $1 AND active', [tankId]);
        if (used) throw unprocessable('TANK_IN_USE', 'ถังนี้มีหัวจ่ายผูกอยู่ ให้ย้ายหัวจ่ายก่อนเปลี่ยนชนิดน้ำมัน');
      }
      const row = await one<TankRow>(
        tx,
        `UPDATE tanks SET code = coalesce($2, code), name = coalesce($3, name),
           fuel_type_id = coalesce($4, fuel_type_id), capacity_litres = coalesce($5::numeric, capacity_litres),
           reorder_litres = coalesce($6::numeric, reorder_litres), sort_order = coalesce($7, sort_order),
           active = coalesce($8, active)
         WHERE id = $1 RETURNING *`,
        [
          tankId,
          input.code ?? null,
          input.name ?? null,
          input.fuelTypeId ?? null,
          input.capacityLitres ?? null,
          input.reorderLitres ?? null,
          input.sortOrder ?? null,
          input.active ?? null,
        ],
      );
      return tankDto(row);
    });
  }

  getCalibration(auth: AuthCtx, tankId: string) {
    return this.db.withTenant(auth, async (tx) => {
      await getTank(tx, auth, tankId);
      const cal = await currentCalibration(tx, tankId);
      return cal ? calibrationDto(cal) : null;
    });
  }

  /** อัปโหลดตารางแปลงเวอร์ชันใหม่ — การวัดถังก่อนหน้ายังอ้างเวอร์ชันเดิม ตัวเลขย้อนหลังไม่เปลี่ยน */
  setCalibration(auth: AuthCtx, tankId: string, input: { points: { mm: string; litres: string }[]; note?: string | null }) {
    return this.db.withTenant(auth, async (tx) => {
      await getTank(tx, auth, tankId);
      const points = calibrationToJson(parseCalibration(input.points));
      const row = await one<CalibrationRow>(
        tx,
        `INSERT INTO tank_calibrations (tenant_id, tank_id, points, note, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`,
        [auth.tenantId, tankId, JSON.stringify(points), input.note ?? null, auth.userId],
      );
      return calibrationDto(row);
    });
  }

  // ---------------------------------------------------------------- หัวจ่าย

  listNozzles(auth: AuthCtx, branchId: string) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      const rows = await many<NozzleRow>(
        tx,
        'SELECT * FROM nozzles WHERE branch_id = $1 ORDER BY sort_order, dispenser_no, code',
        [branchId],
      );
      return rows.map(nozzleDto);
    });
  }

  private async checkNozzleTank(tx: Tx, branchId: string, tankId: string, fuelTypeId: string) {
    const tank = await maybeOne<TankRow>(tx, 'SELECT * FROM tanks WHERE id = $1', [tankId]);
    if (!tank || tank.branch_id !== branchId) throw unprocessable('TANK_NOT_IN_BRANCH', 'ถังต้องอยู่สาขาเดียวกับหัวจ่าย');
    if (tank.fuel_type_id !== fuelTypeId) {
      throw unprocessable('FUEL_MISMATCH', 'ชนิดน้ำมันของหัวจ่ายต้องตรงกับถังที่ดูดน้ำมัน');
    }
  }

  createNozzle(auth: AuthCtx, branchId: string, input: NozzleInput) {
    return this.db.withTenant(auth, async (tx) => {
      await assertBranch(tx, auth, branchId);
      await this.checkNozzleTank(tx, branchId, input.tankId, input.fuelTypeId);
      const row = await one<NozzleRow>(
        tx,
        `INSERT INTO nozzles (tenant_id, branch_id, code, name, dispenser_no, fuel_type_id, tank_id, meter_modulus, sort_order)
         VALUES ($1, $2, $3, $4, coalesce($5, 1), $6, $7, coalesce($8::numeric, 1000000), coalesce($9, 0)) RETURNING *`,
        [
          auth.tenantId,
          branchId,
          input.code,
          input.name,
          input.dispenserNo ?? null,
          input.fuelTypeId,
          input.tankId,
          input.meterModulus ?? null,
          input.sortOrder ?? null,
        ],
      );
      return nozzleDto(row);
    });
  }

  updateNozzle(auth: AuthCtx, nozzleId: string, input: Partial<NozzleInput & { active: boolean }>) {
    return this.db.withTenant(auth, async (tx) => {
      const cur = await maybeOne<NozzleRow>(tx, 'SELECT * FROM nozzles WHERE id = $1', [nozzleId]);
      if (!cur) throw notFound('หัวจ่าย');
      await assertBranch(tx, auth, cur.branch_id);
      const tankId = input.tankId ?? cur.tank_id;
      const fuelTypeId = input.fuelTypeId ?? cur.fuel_type_id;
      if (input.tankId || input.fuelTypeId) await this.checkNozzleTank(tx, cur.branch_id, tankId, fuelTypeId);
      const row = await one<NozzleRow>(
        tx,
        `UPDATE nozzles SET code = coalesce($2, code), name = coalesce($3, name), dispenser_no = coalesce($4, dispenser_no),
           fuel_type_id = $5, tank_id = $6, meter_modulus = coalesce($7::numeric, meter_modulus),
           sort_order = coalesce($8, sort_order), active = coalesce($9, active)
         WHERE id = $1 RETURNING *`,
        [
          nozzleId,
          input.code ?? null,
          input.name ?? null,
          input.dispenserNo ?? null,
          fuelTypeId,
          tankId,
          input.meterModulus ?? null,
          input.sortOrder ?? null,
          input.active ?? null,
        ],
      );
      return nozzleDto(row);
    });
  }

  /**
   * ข้อมูลตั้งค่าทั้งหมดของสาขาในคำขอเดียว — แอปหน้าลานเก็บไว้ในเครื่องเพื่อใช้ตอนออฟไลน์
   * (ตารางแปลงระดับของทุกถัง ราคาปัจจุบัน รายชื่อพนักงาน)
   */
  branchSetup(auth: AuthCtx, branchId: string) {
    return this.db.withTenant(auth, async (tx) => {
      const branch = await assertBranch(tx, auth, branchId);
      const fuelTypes = await many<Parameters<typeof fuelTypeDto>[0]>(tx, 'SELECT * FROM fuel_types ORDER BY sort_order, code');
      const tanks = await many<TankRow>(tx, 'SELECT * FROM tanks WHERE branch_id = $1 AND active ORDER BY sort_order, code', [branchId]);
      const nozzles = await many<NozzleRow>(
        tx,
        'SELECT * FROM nozzles WHERE branch_id = $1 AND active ORDER BY sort_order, dispenser_no, code',
        [branchId],
      );
      const prices = await pricesAt(tx, branchId);
      const staff = await many<{ id: string; display_name: string; role: string }>(
        tx,
        `SELECT u.id, u.display_name, u.role FROM users u
         WHERE u.active AND (u.all_branches OR u.role = 'owner'
           OR EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = $1))
         ORDER BY u.role DESC, u.display_name`,
        [branchId],
      );
      const calibrations: Record<string, unknown> = {};
      for (const t of tanks) {
        const cal = await currentCalibration(tx, t.id);
        if (cal) calibrations[t.id] = calibrationDto(cal);
      }
      return {
        branch: branchDto(branch),
        fuelTypes: fuelTypes.map(fuelTypeDto),
        tanks: tanks.map(tankDto),
        nozzles: nozzles.map(nozzleDto),
        prices: [...prices.entries()].map(([fuelTypeId, priceSatang]) => ({ fuelTypeId, priceSatang })),
        staff: staff.map((s) => ({ id: s.id, displayName: s.display_name, role: s.role })),
        calibrations,
        fetchedAt: new Date().toISOString(),
      };
    });
  }
}
