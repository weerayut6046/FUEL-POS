import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { fail, requireRole } from './index.js';

export async function catalogRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // -- สินค้า ---------------------------------------------------------------

  app.get('/api/products', async () => ctx.catalog.listProducts(true));

  app.post<{ Body: { code: string; name: string; color: string; unitPrice: number } }>(
    '/api/products',
    async (request, reply) => {
      if (!requireRole(request, reply, 'manager')) return;
      try {
        return ctx.catalog.createProduct({ ...request.body, active: true });
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { code?: string; name?: string; color?: string; active?: boolean } }>(
    '/api/products/:id',
    async (request, reply) => {
      if (!requireRole(request, reply, 'manager')) return;
      try {
        return ctx.catalog.updateProduct(Number(request.params.id), request.body);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /**
   * เปลี่ยนราคา แล้วส่งราคาใหม่ไปยังตู้ทันที
   * ถ้าส่งไปตู้ไม่สำเร็จ ราคาในระบบยังเปลี่ยนแล้ว จึงต้องรายงานผลกลับไปให้ชัด
   * เพื่อให้พนักงานรู้ว่าต้องไปตั้งราคาที่หน้าตู้เอง
   */
  app.post<{ Params: { id: string }; Body: { unitPrice: number; note?: string; push?: boolean } }>(
    '/api/products/:id/price',
    async (request, reply) => {
      if (!requireRole(request, reply, 'manager')) return;
      const productId = Number(request.params.id);
      try {
        const product = ctx.catalog.changePrice(
          productId,
          request.body.unitPrice,
          request.user?.id ?? null,
          request.body.note,
        );

        let pushResults: { nozzleId: number; ok: boolean; error?: string }[] = [];
        if (request.body.push !== false) {
          pushResults = await ctx.pumps.pushPrice(productId);
        }

        app.broadcast({ type: 'products.changed', products: ctx.catalog.listProducts(true) });
        return { product, pushResults };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/products/:id/price-history', async (request) =>
    ctx.catalog.priceHistory(Number(request.params.id)),
  );

  // -- ตู้จ่าย / หัวจ่าย ----------------------------------------------------

  app.get('/api/pumps', async () => ({
    pumps: ctx.catalog.listPumps(),
    nozzles: ctx.catalog.listNozzles(),
    buses: ctx.pumps.listBuses(),
  }));

  app.post<{ Body: { name: string; address: number; busId: string } }>(
    '/api/pumps',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        const pump = ctx.catalog.createPump(request.body);
        await ctx.pumps.restart();
        return pump;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; address?: number; enabled?: boolean } }>(
    '/api/pumps/:id',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        const pump = ctx.catalog.updatePump(Number(request.params.id), request.body);
        await ctx.pumps.restart();
        return pump;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{ Body: { pumpId: number; index: number; label: string; productId: number; tankId?: number | null } }>(
    '/api/nozzles',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        const nozzle = ctx.catalog.createNozzle(request.body);
        await ctx.pumps.restart();
        return nozzle;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { label?: string; productId?: number; tankId?: number | null; enabled?: boolean };
  }>('/api/nozzles/:id', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    try {
      const nozzle = ctx.catalog.updateNozzle(Number(request.params.id), request.body);
      await ctx.pumps.restart();
      return nozzle;
    } catch (err) {
      return fail(reply, err);
    }
  });

  // -- ถัง ------------------------------------------------------------------

  app.get('/api/tanks', async () => ctx.catalog.listTanks());

  app.post<{ Body: { name: string; productId: number; capacity: number; bookLevel: number } }>(
    '/api/tanks',
    async (request, reply) => {
      if (!requireRole(request, reply, 'manager')) return;
      try {
        return ctx.catalog.createTank(request.body);
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.post<{
    Body: { tankId: number; type: 'delivery' | 'adjust' | 'dip'; volume: number; note?: string };
  }>('/api/tanks/movement', async (request, reply) => {
    if (!requireRole(request, reply, 'manager')) return;
    try {
      ctx.catalog.recordTankMovement(request.body);
      return { ok: true, tanks: ctx.catalog.listTanks() };
    } catch (err) {
      return fail(reply, err);
    }
  });
}
