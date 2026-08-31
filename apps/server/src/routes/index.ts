import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '@fuel-pos/shared';
import { hasRole } from '../services/auth.js';
import type { AppContext } from '../context.js';

import { authRoutes } from './auth.js';
import { catalogRoutes } from './catalog.js';
import { floorRoutes } from './floor.js';
import { salesRoutes } from './sales.js';
import { shiftRoutes } from './shifts.js';
import { reportRoutes } from './reports.js';
import { labRoutes } from './lab.js';

/** เส้นทางที่เข้าถึงได้โดยไม่ต้องล็อกอิน */
const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health', '/api/bootstrap']);

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // ตรวจ token ทุก request ที่ขึ้นต้นด้วย /api
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    request.user = null;
    if (!request.url.startsWith('/api')) return;

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    request.user = ctx.auth.resolveToken(token);

    const path = request.url.split('?')[0] ?? '';
    if (PUBLIC_PATHS.has(path)) return;
    if (!request.user) {
      return reply.code(401).send({ error: 'ต้องเข้าสู่ระบบก่อน' });
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    mode: ctx.config.mode,
    time: new Date().toISOString(),
  }));

  /** ข้อมูลที่หน้าล็อกอินต้องใช้ก่อนมีสิทธิ์ */
  app.get('/api/bootstrap', async () => ({
    station: ctx.config.station,
    mode: ctx.config.mode,
    hasUsers: ctx.auth.countUsers() > 0,
  }));

  await authRoutes(app, ctx);
  await catalogRoutes(app, ctx);
  await floorRoutes(app, ctx);
  await salesRoutes(app, ctx);
  await shiftRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await labRoutes(app, ctx);
}

/** ตัวช่วยตรวจสิทธิ์ในแต่ละเส้นทาง */
export function requireRole(request: FastifyRequest, reply: FastifyReply, minimum: UserRole): boolean {
  const user = request.user;
  if (!user) {
    reply.code(401).send({ error: 'ต้องเข้าสู่ระบบก่อน' });
    return false;
  }
  if (!hasRole(user, minimum)) {
    reply.code(403).send({ error: `ต้องมีสิทธิ์ระดับ ${minimum} ขึ้นไป` });
    return false;
  }
  return true;
}

/** แปลง error ของ service เป็น response ที่หน้าจออ่านรู้เรื่อง */
export function fail(reply: FastifyReply, err: unknown, code = 400) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(code).send({ error: message });
}
