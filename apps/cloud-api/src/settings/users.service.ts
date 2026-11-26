import { Inject, Injectable } from '@nestjs/common';

import type { AuthCtx, Role } from '../auth/auth-context.js';
import { hashPassword } from '../auth/crypto.js';
import { assertBranch } from '../common/access.js';
import { forbidden, notFound, unprocessable } from '../common/errors.js';
import { Db, many, maybeOne, one, Tx } from '../db/db.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  all_branches: boolean;
  active: boolean;
  created_at: Date;
  branch_ids: string[] | null;
}

const userDto = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  allBranches: u.all_branches || u.role === 'owner',
  active: u.active,
  branchIds: u.branch_ids ?? [],
  createdAt: u.created_at,
});

const SELECT_USERS = `
  SELECT u.id, u.username, u.display_name, u.role, u.all_branches, u.active, u.created_at,
         array_remove(array_agg(ub.branch_id ORDER BY ub.branch_id), NULL) AS branch_ids
  FROM users u LEFT JOIN user_branches ub ON ub.user_id = u.id`;

export interface UserInput {
  username: string;
  displayName: string;
  role: Role;
  password: string;
  allBranches?: boolean;
  branchIds?: string[];
}

/**
 * ผู้ใช้และสิทธิ์
 *   เจ้าของ: จัดการได้ทุกคน
 *   ผู้จัดการ: เพิ่ม/แก้ได้เฉพาะพนักงานหน้าลานในสาขาที่ตัวเองดูแล (รับพนักงานใหม่ได้เองไม่ต้องรอเจ้าของ)
 */
@Injectable()
export class UsersService {
  constructor(@Inject(Db) private readonly db: Db) {}

  list(auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) => {
      const rows = await many<UserRow>(tx, `${SELECT_USERS} GROUP BY u.id ORDER BY u.role DESC, u.display_name`);
      if (auth.role === 'owner') return rows.map(userDto);
      const mine = new Set(await this.myBranchIds(tx, auth));
      return rows
        .filter((u) => u.id === auth.userId || (u.role === 'staff' && (u.branch_ids ?? []).some((b) => mine.has(b))))
        .map(userDto);
    });
  }

  create(auth: AuthCtx, input: UserInput) {
    return this.db.withTenant(auth, async (tx) => {
      await this.checkManagerScope(tx, auth, input.role, input.allBranches ?? false, input.branchIds ?? []);
      for (const b of input.branchIds ?? []) await assertBranch(tx, auth, b);
      const hash = await hashPassword(input.password);
      const { id } = await one<{ id: string }>(
        tx,
        `INSERT INTO users (tenant_id, username, display_name, role, password_hash, all_branches)
         VALUES ($1, lower($2), $3, $4, $5, $6) RETURNING id`,
        [auth.tenantId, input.username, input.displayName, input.role, hash, input.allBranches ?? false],
      );
      await this.setBranches(tx, auth, id, input.branchIds ?? []);
      return userDto(await one<UserRow>(tx, `${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [id]));
    });
  }

  update(
    auth: AuthCtx,
    userId: string,
    input: Partial<Omit<UserInput, 'username'>> & { active?: boolean },
  ) {
    return this.db.withTenant(auth, async (tx) => {
      const cur = await maybeOne<UserRow>(tx, `${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [userId]);
      if (!cur) throw notFound('ผู้ใช้');
      if (auth.role !== 'owner') {
        // ผู้จัดการแก้ได้เฉพาะพนักงานในสาขาตัวเอง (และเปลี่ยนรหัสผ่านตัวเองได้)
        const self = userId === auth.userId;
        const mine = new Set(await this.myBranchIds(tx, auth));
        const inScope = cur.role === 'staff' && (cur.branch_ids ?? []).some((b) => mine.has(b));
        if (!inScope && !(self && Object.keys(input).every((k) => k === 'password'))) throw forbidden();
        await this.checkManagerScope(tx, auth, input.role ?? cur.role, input.allBranches ?? cur.all_branches, input.branchIds ?? []);
      }
      // กันเจ้าของคนสุดท้ายถูกปิด/ลดสิทธิ์ ไม่อย่างนั้นจะไม่มีใครเข้าตั้งค่าได้อีก
      if (cur.role === 'owner' && (input.active === false || (input.role && input.role !== 'owner'))) {
        const owners = await one<{ n: number }>(tx, "SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND active");
        if (owners.n <= 1) throw unprocessable('LAST_OWNER', 'ต้องมีเจ้าของที่ใช้งานได้อย่างน้อย 1 คน');
      }
      const hash = input.password ? await hashPassword(input.password) : null;
      await tx.query(
        `UPDATE users SET display_name = coalesce($2, display_name), role = coalesce($3, role),
           password_hash = coalesce($4, password_hash), all_branches = coalesce($5, all_branches),
           active = coalesce($6, active), updated_at = now()
         WHERE id = $1`,
        [userId, input.displayName ?? null, input.role ?? null, hash, input.allBranches ?? null, input.active ?? null],
      );
      if (input.branchIds) {
        for (const b of input.branchIds) await assertBranch(tx, auth, b);
        let next = input.branchIds;
        if (auth.role !== 'owner') {
          // ผู้จัดการไม่แตะสิทธิ์สาขาที่ตัวเองไม่ได้ดูแล
          const mine = new Set(await this.myBranchIds(tx, auth));
          next = [...new Set([...next, ...(cur.branch_ids ?? []).filter((b) => !mine.has(b))])];
        }
        await this.setBranches(tx, auth, userId, next);
      }
      // ปิดใช้งานหรือเปลี่ยนรหัสผ่าน → ตัดเซสชันเดิมทุกเครื่อง
      if (input.active === false || hash) {
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      }
      return userDto(await one<UserRow>(tx, `${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [userId]));
    });
  }

  private async myBranchIds(tx: Tx, auth: AuthCtx): Promise<string[]> {
    if (auth.allBranches) return (await many<{ id: string }>(tx, 'SELECT id FROM branches')).map((r) => r.id);
    return (await many<{ branch_id: string }>(tx, 'SELECT branch_id FROM user_branches WHERE user_id = $1', [auth.userId])).map(
      (r) => r.branch_id,
    );
  }

  private async checkManagerScope(tx: Tx, auth: AuthCtx, role: Role, allBranches: boolean, branchIds: string[]) {
    if (auth.role === 'owner') return;
    if (auth.role !== 'manager' || role !== 'staff' || allBranches) {
      throw forbidden('ผู้จัดการเพิ่มหรือแก้ไขได้เฉพาะพนักงานหน้าลานในสาขาของตัวเอง');
    }
    const mine = new Set(await this.myBranchIds(tx, auth));
    if (branchIds.length === 0 || branchIds.some((b) => !mine.has(b))) {
      throw forbidden('ผู้จัดการกำหนดสาขาได้เฉพาะสาขาที่ตัวเองดูแล');
    }
  }

  private async setBranches(tx: Tx, auth: AuthCtx, userId: string, branchIds: string[]) {
    await tx.query('DELETE FROM user_branches WHERE user_id = $1 AND NOT (branch_id = ANY($2::uuid[]))', [userId, branchIds]);
    for (const b of branchIds) {
      await tx.query(
        'INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [auth.tenantId, userId, b],
      );
    }
  }
}
