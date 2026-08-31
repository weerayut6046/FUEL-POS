import type { FastifyInstance } from 'fastify';
import type { PresetMode } from '@fuel-pos/shared';
import { calcVolume } from '@fuel-pos/shared';
import type { AppContext } from '../context.js';
import { fail, requireRole } from './index.js';

/** เส้นทางที่ใช้ควบคุมหัวจ่ายหน้าลาน */
export async function floorRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/floor/live', async () => ({
    nozzles: ctx.pumps.snapshot(),
    products: ctx.catalog.listProducts(true),
    shift: ctx.shifts.current(),
    pendingSales: ctx.sales.listPending(),
    mode: ctx.config.mode,
  }));

  /**
   * สั่งจ่ายน้ำมัน
   *
   * mode:
   *   'amount' — กำหนดยอดเงิน (บาท) → value เป็นสตางค์
   *   'volume' — กำหนดปริมาตร (ลิตร) → value เป็นมิลลิลิตร
   *   'full'   — เติมเต็มถัง ไม่กำหนดยอด
   */
  app.post<{ Params: { id: string }; Body: { mode: PresetMode; value?: number } }>(
    '/api/floor/nozzles/:id/authorize',
    async (request, reply) => {
      if (!requireRole(request, reply, 'attendant')) return;
      const nozzleId = Number(request.params.id);
      const { mode, value = 0 } = request.body ?? { mode: 'full' as PresetMode };

      try {
        if (!ctx.shifts.current()) {
          throw new Error('ยังไม่ได้เปิดกะ — ต้องเปิดกะก่อนจึงจะสั่งจ่ายได้');
        }
        if ((mode === 'amount' || mode === 'volume') && value <= 0) {
          throw new Error('ต้องระบุยอดที่ต้องการมากกว่า 0');
        }

        // กันตั้งยอดเงินที่คำนวณเป็นปริมาตรแล้วเกินความจุถังรถทั่วไป (ป้องกันพิมพ์ผิด)
        if (mode === 'amount') {
          const live = ctx.pumps.getNozzle(nozzleId);
          const price = live?.unitPrice ?? 0;
          if (price > 0 && calcVolume(value, price) > 200_000) {
            throw new Error('ยอดเงินที่ตั้งสูงผิดปกติ (เกิน 200 ลิตร) กรุณาตรวจสอบอีกครั้ง');
          }
        }

        await ctx.pumps.authorize(nozzleId, mode, value);
        return { ok: true, nozzle: ctx.pumps.getNozzle(nozzleId) };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/floor/nozzles/:id/stop', async (request, reply) => {
    if (!requireRole(request, reply, 'attendant')) return;
    try {
      await ctx.pumps.stopNozzle(Number(request.params.id));
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // -- โหมดจำลอง: ควบคุมตู้เสมือนจากหน้าจอ ---------------------------------

  app.post<{ Params: { pumpId: string; index: string }; Body: { action: 'lift' | 'hang' | 'trigger-on' | 'trigger-off' } }>(
    '/api/floor/simulate/:pumpId/:index',
    async (request, reply) => {
      if (!ctx.pumps.isSimulator) {
        return fail(reply, new Error('คำสั่งนี้ใช้ได้เฉพาะโหมดจำลองเท่านั้น'), 409);
      }
      const pump = ctx.pumps.findSimulatedPump(Number(request.params.pumpId));
      if (!pump) return fail(reply, new Error('ไม่พบตู้จำลอง'), 404);

      const index = Number(request.params.index);
      try {
        switch (request.body.action) {
          case 'lift':
            pump.liftNozzle(index);
            break;
          case 'hang':
            pump.hangNozzle(index);
            break;
          case 'trigger-on':
            pump.setTrigger(index, true);
            break;
          case 'trigger-off':
            pump.setTrigger(index, false);
            break;
        }
        return { ok: true };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );
}
