import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';

import type { AppContext } from './context.js';
import { registerRoutes } from './routes/index.js';
import { registerWebSocket } from './ws.js';

/** โฟลเดอร์ไฟล์หน้าเว็บที่ build แล้ว */
function uiRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // ตั้งทับได้ตอนแพ็กโปรแกรม ซึ่งไฟล์อยู่คนละที่กับตอนพัฒนา
    ...(process.env.FUEL_POS_UI_DIR ? [path.resolve(process.env.FUEL_POS_UI_DIR)] : []),
    path.resolve(here, 'public'),
    path.resolve(here, '..', '..', 'pos-ui', 'dist'), // ตอนรันจาก repo
  ];
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: undefined,
    },
    // ตู้จ่ายมีจำนวนน้อย แต่ request ถี่ — ปิด logging ต่อ request ของ /ws
    disableRequestLogging: true,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerWebSocket(app, ctx);
  await registerRoutes(app, ctx);

  const ui = uiRoot();
  if (ui) {
    await app.register(fastifyStatic, { root: ui, prefix: '/' });
    // หน้าเว็บเป็น SPA — เส้นทางที่ไม่ใช่ /api ให้ตกมาที่ index.html
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'ไม่พบเส้นทางที่ร้องขอ' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(
      'ยังไม่ได้ build หน้าเว็บ (apps/pos-ui/dist) — เซิร์ฟเวอร์จะให้บริการเฉพาะ API',
    );
  }

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error({ err: error }, 'เกิดข้อผิดพลาดที่ไม่ได้จัดการ');
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode) || 500
        : 500;
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดภายในระบบ';
    reply.code(status).send({ error: message });
  });

  return app;
}
