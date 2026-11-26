import { randomUUID } from 'node:crypto';

import { hashPassword } from '../auth/crypto.js';
import { Db } from '../db/db.js';

export interface NewTenant {
  slug: string;
  name: string;
  plan?: 'starter' | 'pro' | 'multi';
  trialDays?: number;
  branch: { code: string; name: string; address?: string; taxId?: string };
  owner: { username: string; displayName: string; password: string };
  /** สร้างชนิดน้ำมันที่ใช้บ่อยในไทยให้เลย (ค่าเริ่มต้น true) */
  defaultFuelTypes?: boolean;
}

export const DEFAULT_FUEL_TYPES = [
  { code: 'B7', name: 'ดีเซล B7', color: '#2E7D32' },
  { code: 'G95', name: 'แก๊สโซฮอล์ 95', color: '#EF6C00' },
  { code: 'G91', name: 'แก๊สโซฮอล์ 91', color: '#43A047' },
  { code: 'E20', name: 'แก๊สโซฮอล์ E20', color: '#00897B' },
  { code: 'B95', name: 'เบนซิน 95', color: '#C62828' },
];

/**
 * เปิดลูกค้ารายใหม่ — ทำงานใต้ RLS ด้วยบทบาทเดียวกับ API (ตั้ง tenant เป็นรายใหม่ก่อนแล้วค่อยสร้าง)
 * ปั๊มนำร่องของเราก็สร้างด้วยวิธีนี้ เหมือนลูกค้ารายอื่นทุกประการ
 */
export async function createTenant(db: Db, input: NewTenant) {
  const tenantId = randomUUID();
  const ownerId = randomUUID();
  const branchId = randomUUID();
  const passwordHash = await hashPassword(input.owner.password);
  const trialDays = input.trialDays ?? 30;

  await db.withTenant({ tenantId, userId: ownerId }, async (tx) => {
    await tx.query(
      `INSERT INTO tenants (id, slug, name, plan, status, trial_ends_at)
       VALUES ($1, lower($2), $3, $4, 'trial', current_date + $5::int)`,
      [tenantId, input.slug, input.name, input.plan ?? 'starter', trialDays],
    );
    await tx.query('INSERT INTO tenant_settings (tenant_id) VALUES ($1)', [tenantId]);
    await tx.query(
      `INSERT INTO users (id, tenant_id, username, display_name, role, password_hash, all_branches)
       VALUES ($1, $2, lower($3), $4, 'owner', $5, true)`,
      [ownerId, tenantId, input.owner.username, input.owner.displayName, passwordHash],
    );
    await tx.query(
      `INSERT INTO branches (id, tenant_id, code, name, address, tax_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [branchId, tenantId, input.branch.code, input.branch.name, input.branch.address ?? null, input.branch.taxId ?? null],
    );
    if (input.defaultFuelTypes !== false) {
      for (const [i, f] of DEFAULT_FUEL_TYPES.entries()) {
        await tx.query(
          'INSERT INTO fuel_types (tenant_id, code, name, color, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [tenantId, f.code, f.name, f.color, i],
        );
      }
    }
  });

  return { tenantId, ownerId, branchId };
}
