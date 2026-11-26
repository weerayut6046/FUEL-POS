import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { forbidden, unauthorized } from '../common/errors.js';
import { Db } from '../db/db.js';
import { AuthCtx, AuthedRequest, IS_PUBLIC, Role, ROLES } from './auth-context.js';
import { hashToken } from './crypto.js';

interface SessionRow {
  tenant_id: string;
  user_id: string;
  role: Role;
  all_branches: boolean;
  username: string;
  display_name: string;
}

/**
 * ตรวจ token ทุกคำขอ (ยกเว้นเส้นทาง @Public)
 * tenant ของคำขอมาจาก session ในฐานข้อมูลเท่านั้น — ผู้ใช้ส่ง tenant อื่นมาเองไม่ได้
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Db) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match?.[1]) throw unauthorized();

    const tokenHash = hashToken(match[1]);
    const [row] = await this.db.query<SessionRow>('SELECT * FROM app_session_lookup($1)', [tokenHash]);
    if (!row) throw unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

    const auth: AuthCtx = {
      tenantId: row.tenant_id,
      userId: row.user_id,
      role: row.role,
      allBranches: row.all_branches || row.role === 'owner',
      username: row.username,
      displayName: row.display_name,
      tokenHash,
    };
    req.auth = auth;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(auth.role)) throw forbidden();
    return true;
  }
}
