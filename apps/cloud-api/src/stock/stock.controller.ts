import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AuthCtx, CurrentAuth } from '../auth/auth-context.js';
import { correctionFields, dateRange, isoDate, isoDateTime, litres, mm, parse, text, uuid } from '../common/validation.js';
import { StockService } from './stock.service.js';

const DipBody = z.object({
  id: uuid,
  businessDate: isoDate,
  measuredAt: isoDateTime.nullish(),
  levelMm: mm,
  waterMm: mm.nullish(),
  photoId: uuid.nullish(),
  ...correctionFields,
});

const DeliveryBody = z.object({
  id: uuid,
  tankId: uuid,
  businessDate: isoDate,
  deliveredAt: isoDateTime.nullish(),
  documentNo: text(100).nullish(),
  supplier: text(200).nullish(),
  invoiceLitres: litres,
  dipBeforeMm: mm.nullish(),
  dipAfterMm: mm.nullish(),
  voided: z.boolean().optional(),
  photoId: uuid.nullish(),
  ...correctionFields,
});

@Controller()
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  /** สถานะถังทั้งหมดของสาขา: คงเหลือ % ความจุ ถึงจุดสั่งหรือยัง ขาด/เกินล่าสุด */
  @Get('branches/:branchId/tank-status')
  status(@CurrentAuth() auth: AuthCtx, @Param('branchId') branchId: string) {
    return this.stock.tankStatus(auth, parse(uuid, branchId));
  }

  @Get('tanks/:id/dips')
  dips(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Query() query: unknown) {
    const r = parse(dateRange, query);
    return this.stock.listDips(auth, parse(uuid, id), r.from, r.to);
  }

  @Post('tanks/:id/dips')
  recordDip(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.stock.recordDip(auth, parse(uuid, id), parse(DipBody, body));
  }

  @Get('branches/:branchId/deliveries')
  deliveries(@CurrentAuth() auth: AuthCtx, @Param('branchId') branchId: string, @Query() query: unknown) {
    const r = parse(dateRange, query);
    return this.stock.listDeliveries(auth, parse(uuid, branchId), r.from, r.to);
  }

  @Post('deliveries')
  recordDelivery(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    return this.stock.recordDelivery(auth, parse(DeliveryBody, body));
  }

  @Get('branches/:branchId/tank-reconciliation')
  reconciliation(@CurrentAuth() auth: AuthCtx, @Param('branchId') branchId: string, @Query() query: unknown) {
    const r = parse(dateRange, query);
    return this.stock.reconciliation(auth, parse(uuid, branchId), r.from, r.to);
  }
}
