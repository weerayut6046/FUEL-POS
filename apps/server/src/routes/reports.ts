import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/** แปลงช่วงวันที่จาก query string เป็น ISO (ครอบคลุมทั้งวันสุดท้าย) */
function range(query: { from?: string; to?: string }): { from: string; to: string } {
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = query.from ? new Date(`${query.from}T00:00:00`) : defaultFrom;
  const to = query.to
    ? new Date(new Date(`${query.to}T00:00:00`).getTime() + 86_400_000)
    : new Date(defaultFrom.getTime() + 86_400_000);

  return { from: from.toISOString(), to: to.toISOString() };
}

export async function reportRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/reports/dashboard', async () => ctx.reports.dashboard());

  app.get<{ Querystring: { days?: string } }>('/api/reports/daily', async (request) =>
    ctx.reports.daily(Math.min(365, Number(request.query.days ?? 30))),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/reports/summary',
    async (request) => {
      const { from, to } = range(request.query);
      return {
        from,
        to,
        byProduct: ctx.reports.byProduct(from, to),
        byNozzle: ctx.reports.byNozzle(from, to),
        byMethod: ctx.reports.byPaymentMethod(from, to),
        meter: ctx.reports.meterReconciliation(from, to),
      };
    },
  );

  /** ส่งออกรายการขายเป็น CSV สำหรับนำเข้าโปรแกรมบัญชี */
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/reports/export.csv',
    async (request, reply) => {
      const { from, to } = range(request.query);
      const sales = ctx.sales.listBetween(from, to);
      const products = new Map(ctx.catalog.listProducts(true).map((p) => [p.id, p]));
      const nozzles = new Map(ctx.catalog.listNozzles().map((n) => [n.id, n]));

      const header = [
        'เลขที่',
        'วันที่จ่าย',
        'หัวจ่าย',
        'สินค้า',
        'ลิตร',
        'ราคา/ลิตร',
        'จำนวนเงิน',
        'สถานะ',
        'ทะเบียนรถ',
      ];

      const rows = sales.map((sale) =>
        [
          sale.docNo,
          sale.endedAt,
          nozzles.get(sale.nozzleId)?.label ?? '',
          products.get(sale.productId)?.name ?? '',
          (sale.volume / 1000).toFixed(3),
          (sale.unitPrice / 100).toFixed(2),
          (sale.amount / 100).toFixed(2),
          sale.status,
          sale.vehiclePlate ?? '',
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(','),
      );

      // BOM เพื่อให้ Excel บน Windows อ่านภาษาไทยได้ถูกต้อง
      const csv = `﻿${header.join(',')}\n${rows.join('\n')}\n`;
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="sales-${Date.now()}.csv"`)
        .send(csv);
    },
  );
}
