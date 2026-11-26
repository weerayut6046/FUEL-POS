import type { AuthCtx } from '../auth/auth-context.js';
import { many, maybeOne, Tx } from '../db/db.js';
import { forbidden, notFound } from './errors.js';

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  tax_id: string | null;
  phone: string | null;
  active: boolean;
}

/** สาขาที่ผู้ใช้เข้าถึงได้ — เจ้าของและผู้ที่ได้สิทธิ์ทุกสาขาเห็นทั้งหมด */
export async function accessibleBranches(tx: Tx, auth: AuthCtx, includeInactive = false): Promise<BranchRow[]> {
  if (auth.allBranches) {
    return many<BranchRow>(
      tx,
      `SELECT * FROM branches ${includeInactive ? '' : 'WHERE active'} ORDER BY code`,
    );
  }
  return many<BranchRow>(
    tx,
    `SELECT b.* FROM branches b JOIN user_branches ub ON ub.branch_id = b.id
     WHERE ub.user_id = $1 ${includeInactive ? '' : 'AND b.active'} ORDER BY b.code`,
    [auth.userId],
  );
}

/** ตรวจว่าผู้ใช้เข้าถึงสาขานี้ได้ (RLS กันข้ามลูกค้าอยู่แล้ว ส่วนนี้กันข้ามสาขาในลูกค้าเดียวกัน) */
export async function assertBranch(tx: Tx, auth: AuthCtx, branchId: string): Promise<BranchRow> {
  const branch = await maybeOne<BranchRow>(tx, 'SELECT * FROM branches WHERE id = $1', [branchId]);
  if (!branch) throw notFound('สาขา');
  if (!auth.allBranches) {
    const ok = await maybeOne(tx, 'SELECT 1 FROM user_branches WHERE user_id = $1 AND branch_id = $2', [
      auth.userId,
      branchId,
    ]);
    if (!ok) throw forbidden('ไม่มีสิทธิ์เข้าถึงสาขานี้');
  }
  return branch;
}

export function branchDto(b: BranchRow) {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    address: b.address,
    taxId: b.tax_id,
    phone: b.phone,
    active: b.active,
  };
}

/** เวลาปัจจุบันตามเขตเวลาของลูกค้า → วันที่ทำการ (YYYY-MM-DD) และชั่วโมง */
export async function tenantNow(tx: Tx): Promise<{ today: string; hour: number; timezone: string }> {
  const row = await maybeOne<{ today: string; hour: number; timezone: string }>(
    tx,
    `SELECT (now() AT TIME ZONE s.timezone)::date AS today,
            extract(hour FROM now() AT TIME ZONE s.timezone)::int AS hour,
            s.timezone
     FROM tenant_settings s`,
  );
  return row ?? { today: new Date().toISOString().slice(0, 10), hour: new Date().getUTCHours(), timezone: 'UTC' };
}
