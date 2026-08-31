import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { PaymentInput } from '../services/sales.js';
import { fail, requireRole } from './index.js';

export async function salesRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/sales/pending', async () => ctx.sales.listPending());

  app.get<{ Querystring: { limit?: string } }>('/api/sales', async (request) =>
    ctx.sales.listRecent(Math.min(500, Number(request.query.limit ?? 100))),
  );

  app.get<{ Params: { id: string } }>('/api/sales/:id', async (request, reply) => {
    const sale = ctx.sales.get(Number(request.params.id));
    if (!sale) return fail(reply, new Error('ไม่พบรายการขาย'), 404);
    return { sale, payments: ctx.sales.payments(sale.id) };
  });

  /**
   * รับชำระเงิน แล้วปลดล็อกหัวจ่ายให้พร้อมรับลูกค้ารายถัดไป
   *
   * ลำดับสำคัญ: บันทึกเงินก่อน แล้วค่อยสั่งปลดล็อกตู้
   * ถ้าสลับลำดับ แล้วบันทึกเงินพลาด จะได้ตู้ที่ว่างแต่ไม่มีรายการเก็บเงิน
   */
  app.post<{
    Params: { id: string };
    Body: { payments: PaymentInput[]; vehiclePlate?: string; note?: string };
  }>('/api/sales/:id/pay', async (request, reply) => {
    if (!requireRole(request, reply, 'cashier')) return;
    const saleId = Number(request.params.id);

    try {
      const { sale, change } = ctx.sales.pay(
        saleId,
        request.body.payments,
        request.user?.id ?? null,
        { vehiclePlate: request.body.vehiclePlate, note: request.body.note },
      );

      let released = true;
      let releaseError: string | null = null;
      try {
        await ctx.pumps.release(sale.nozzleId);
      } catch (err) {
        // เงินเก็บแล้ว แต่ปลดล็อกตู้ไม่สำเร็จ — ต้องบอกพนักงานให้ไปกด Reset ที่ตู้
        released = false;
        releaseError = (err as Error).message;
      }

      app.broadcast({ type: 'sale.paid', sale });
      return {
        sale,
        change,
        payments: ctx.sales.payments(sale.id),
        released,
        releaseError,
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/api/sales/:id/void',
    async (request, reply) => {
      if (!requireRole(request, reply, 'manager')) return;
      try {
        const sale = ctx.sales.voidSale(
          Number(request.params.id),
          request.user?.id ?? 0,
          request.body?.reason ?? '',
        );
        // รายการที่ถูกยกเลิกไม่ควรค้างล็อกหัวจ่ายไว้
        await ctx.pumps.release(sale.nozzleId).catch(() => undefined);
        return sale;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /** ข้อมูลสำหรับพิมพ์ใบเสร็จ */
  app.get<{ Params: { id: string } }>('/api/sales/:id/receipt', async (request, reply) => {
    const sale = ctx.sales.get(Number(request.params.id));
    if (!sale) return fail(reply, new Error('ไม่พบรายการขาย'), 404);

    const nozzle = ctx.catalog.getNozzle(sale.nozzleId);
    const product = ctx.catalog.getProduct(sale.productId);
    const cashier = sale.cashierId ? ctx.auth.requireUser(sale.cashierId) : null;

    return {
      station: ctx.config.station,
      sale,
      payments: ctx.sales.payments(sale.id),
      nozzleLabel: nozzle?.label ?? '-',
      productName: product?.name ?? '-',
      cashierName: cashier?.displayName ?? '-',
    };
  });
}
