import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { TenantScope } from '../db/db.js';

export type Role = 'owner' | 'manager' | 'staff';

/** ข้อมูลผู้ใช้ของคำขอปัจจุบัน — ได้จาก token เสมอ ไม่เชื่อ tenant ที่ส่งมาใน body */
export interface AuthCtx extends TenantScope {
  tenantId: string;
  userId: string;
  role: Role;
  allBranches: boolean;
  username: string;
  displayName: string;
  tokenHash: string;
}

export type AuthedRequest = FastifyRequest & { auth?: AuthCtx; rawBody?: Buffer };

export const IS_PUBLIC = 'fuelpos:isPublic';
export const ROLES = 'fuelpos:roles';

/** เส้นทางที่ไม่ต้องเข้าสู่ระบบ */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** จำกัดบทบาทที่เรียกได้ */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** ดึง AuthCtx ของคำขอ */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthCtx => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('ไม่มีข้อมูลผู้ใช้ในคำขอ (ลืมใส่ guard?)');
  return req.auth;
});

export const isManagerOrOwner = (a: AuthCtx) => a.role === 'owner' || a.role === 'manager';
