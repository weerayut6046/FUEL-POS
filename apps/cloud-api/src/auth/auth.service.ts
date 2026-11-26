import { Inject, Injectable } from '@nestjs/common';

import { accessibleBranches, branchDto } from '../common/access.js';
import { ApiError, unauthorized } from '../common/errors.js';
import { APP_CONFIG, AppConfig } from '../config.js';
import { Db, maybeOne, Tx } from '../db/db.js';
import { AuthCtx, Role } from './auth-context.js';
import { DUMMY_HASH, hashToken, newToken, verifyPassword } from './crypto.js';

interface LoginRow {
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  user_id: string;
  password_hash: string;
  active: boolean;
}

const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  /** นับการเข้าสู่ระบบผิด ต่อ "รหัสปั๊ม:ชื่อผู้ใช้" กันการเดารหัสผ่าน */
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: { tenant: string; username: string; password: string }, userAgent?: string) {
    const key = `${input.tenant.toLowerCase()}:${input.username.toLowerCase()}`;
    const fail = this.fails.get(key);
    if (fail && fail.count >= MAX_FAILS && fail.until > Date.now()) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที');
    }

    const [row] = await this.db.query<LoginRow>('SELECT * FROM app_login_lookup($1, $2)', [
      input.tenant,
      input.username,
    ]);
    const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok || !row.active || row.tenant_status === 'suspended') {
      const prev = fail && fail.until > Date.now() ? fail.count : 0;
      this.fails.set(key, { count: prev + 1, until: Date.now() + LOCK_MS });
      if (row && ok && row.tenant_status === 'suspended') {
        throw new ApiError(403, 'TENANT_SUSPENDED', 'บัญชีปั๊มนี้ถูกระงับ กรุณาติดต่อผู้ให้บริการ');
      }
      throw unauthorized('รหัสปั๊ม ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง');
    }
    this.fails.delete(key);

    const token = newToken();
    const scope = { tenantId: row.tenant_id, userId: row.user_id };
    return this.db.withTenant(scope, async (tx) => {
      await tx.query(
        `INSERT INTO sessions (token_hash, tenant_id, user_id, expires_at, user_agent)
         VALUES ($1, $2, $3, now() + make_interval(days => $4), $5)`,
        [hashToken(token), row.tenant_id, row.user_id, this.config.sessionDays, userAgent?.slice(0, 300) ?? null],
      );
      return { token, ...(await this.profile(tx, row.user_id)) };
    });
  }

  async logout(auth: AuthCtx): Promise<void> {
    await this.db.withTenant(auth, (tx) =>
      tx.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [auth.tokenHash]),
    );
  }

  async me(auth: AuthCtx) {
    return this.db.withTenant(auth, (tx) => this.profile(tx, auth.userId));
  }

  /** ข้อมูลที่แอปต้องใช้หลังเข้าสู่ระบบ: ผู้ใช้ ลูกค้า สาขาที่เข้าถึงได้ */
  private async profile(tx: Tx, userId: string) {
    const user = await maybeOne<{
      id: string;
      username: string;
      display_name: string;
      role: Role;
      all_branches: boolean;
      tenant_id: string;
    }>(tx, 'SELECT id, username, display_name, role, all_branches, tenant_id FROM users WHERE id = $1', [userId]);
    if (!user) throw unauthorized();
    const tenant = await maybeOne<{ id: string; slug: string; name: string; plan: string; status: string; trial_ends_at: string | null }>(
      tx,
      'SELECT id, slug, name, plan, status, trial_ends_at FROM tenants WHERE id = $1',
      [user.tenant_id],
    );
    const auth = {
      tenantId: user.tenant_id,
      userId: user.id,
      role: user.role,
      allBranches: user.all_branches || user.role === 'owner',
    } as AuthCtx;
    const branches = await accessibleBranches(tx, auth);
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        allBranches: auth.allBranches,
      },
      tenant: tenant && {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        status: tenant.status,
        trialEndsAt: tenant.trial_ends_at,
      },
      branches: branches.map(branchDto),
    };
  }
}
