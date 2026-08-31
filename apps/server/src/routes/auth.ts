import type { FastifyInstance } from 'fastify';
import type { UserRole } from '@fuel-pos/shared';
import type { AppContext } from '../context.js';
import { fail, requireRole } from './index.js';

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post<{ Body: { username: string; pin: string } }>('/api/auth/login', async (request, reply) => {
    try {
      const { username, pin } = request.body ?? {};
      if (!username || !pin) return fail(reply, new Error('กรุณากรอกชื่อผู้ใช้และ PIN'));
      return ctx.auth.login(username, pin);
    } catch (err) {
      return fail(reply, err, 401);
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) ctx.auth.logout(header.slice(7));
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request) => ({ user: request.user }));

  app.get('/api/users', async (request, reply) => {
    if (!requireRole(request, reply, 'manager')) return;
    return ctx.auth.listUsers();
  });

  app.post<{ Body: { username: string; displayName: string; role: UserRole; pin: string } }>(
    '/api/users',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        return ctx.auth.createUser(request.body);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { pin: string } }>(
    '/api/users/:id/pin',
    async (request, reply) => {
      const targetId = Number(request.params.id);
      // ผู้ใช้เปลี่ยน PIN ตัวเองได้ นอกนั้นต้องเป็น admin
      if (request.user?.id !== targetId && !requireRole(request, reply, 'admin')) return;
      try {
        ctx.auth.changePin(targetId, request.body.pin);
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { active: boolean } }>(
    '/api/users/:id/active',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      ctx.auth.setActive(Number(request.params.id), request.body.active);
      return { ok: true };
    },
  );
}
