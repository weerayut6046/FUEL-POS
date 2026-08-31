import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { fail, requireRole } from './index.js';

export async function shiftRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/shifts/current', async () => ctx.shifts.current());

  app.get('/api/shifts', async () => ctx.shifts.list());

  app.get<{ Params: { id: string } }>('/api/shifts/:id/summary', async (request, reply) => {
    try {
      return ctx.shifts.summary(Number(request.params.id));
    } catch (err) {
      return fail(reply, err, 404);
    }
  });

  /**
   * เปิดกะ — บันทึกค่ามิเตอร์ของทุกหัวจ่าย ณ เวลานั้นโดยอ่านจากตู้จริง
   * ค่านี้คือหลักฐานตั้งต้นที่ใช้กระทบยอดตอนปิดกะ
   */
  app.post<{ Body: { name: string; openingFloat: number } }>(
    '/api/shifts/open',
    async (request, reply) => {
      if (!requireRole(request, reply, 'cashier')) return;
      try {
        const shift = ctx.shifts.open({
          name: request.body.name,
          openedBy: request.user?.id ?? 0,
          openingFloat: request.body.openingFloat ?? 0,
          readings: ctx.pumps.snapshot(),
        });
        app.broadcast({ type: 'shift.changed', shift });
        return shift;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { countedCash: number; note?: string; force?: boolean } }>(
    '/api/shifts/:id/close',
    async (request, reply) => {
      if (!requireRole(request, reply, 'cashier')) return;
      // การปิดกะทั้งที่ยังมีรายการค้าง ต้องเป็นผู้จัดการขึ้นไป
      if (request.body.force && !requireRole(request, reply, 'manager')) return;

      try {
        const shift = ctx.shifts.close({
          shiftId: Number(request.params.id),
          closedBy: request.user?.id ?? 0,
          countedCash: request.body.countedCash ?? 0,
          readings: ctx.pumps.snapshot(),
          note: request.body.note,
          force: request.body.force,
        });
        app.broadcast({ type: 'shift.changed', shift: null });
        return { shift, summary: ctx.shifts.summary(shift.id) };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
