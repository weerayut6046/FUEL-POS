import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { AuthCtx, CurrentAuth } from '../auth/auth-context.js';
import { correctionFields, dateRange, isoDate, litres, parse, satang, text, uuid } from '../common/validation.js';
import { PAYMENT_METHODS } from './shift-calc.js';
import { ShiftsService } from './shifts.service.js';

const OpenBody = z.object({
  id: uuid,
  businessDate: isoDate,
  shiftNo: z.number().int().min(1).max(9),
  note: text(500).nullish(),
  attendantId: uuid.nullish(),
});

const ReadingBody = z.object({
  id: uuid,
  nozzleId: uuid,
  kind: z.enum(['open', 'close']),
  reading: litres,
  rollover: z.boolean().optional(),
  photoId: uuid.nullish(),
  ...correctionFields,
});

const TestBody = z.object({ id: uuid, nozzleId: uuid, litres, ...correctionFields });

const CollectionBody = z.object({
  id: uuid,
  attendantId: uuid,
  method: z.enum(PAYMENT_METHODS),
  amountSatang: satang,
  note: text(300).nullish(),
  ...correctionFields,
});

const AttendantBody = z.object({ attendantId: uuid.nullable() });
const SubmitBody = z.object({ note: text(1000).nullish() });
const ApproveBody = z.object({ note: text(1000).nullish(), acknowledgeWarnings: z.boolean().optional() });
const ReopenBody = z.object({ reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(500) });

/**
 * ปิดกะหน้าลาน
 *
 * ทุกคำขอที่สร้างข้อมูลรับ id (UUID) ที่สร้างจากเครื่อง — ส่งซ้ำได้ไม่เกิดรายการซ้ำ
 * แอปจึงเก็บคิวไว้ในเครื่องตอนเน็ตหลุด แล้วส่งใหม่ภายหลังได้อย่างปลอดภัย
 */
@Controller()
export class ShiftsController {
  constructor(@Inject(ShiftsService) private readonly shifts: ShiftsService) {}

  @Get('branches/:branchId/shifts')
  list(@CurrentAuth() auth: AuthCtx, @Param('branchId') branchId: string, @Query() query: unknown) {
    const r = parse(dateRange, query);
    return this.shifts.list(auth, parse(uuid, branchId), r.from, r.to);
  }

  @Post('branches/:branchId/shifts')
  open(@CurrentAuth() auth: AuthCtx, @Param('branchId') branchId: string, @Body() body: unknown) {
    return this.shifts.open(auth, parse(uuid, branchId), parse(OpenBody, body));
  }

  @Get('shifts/:id')
  detail(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.shifts.detail(auth, parse(uuid, id));
  }

  @Post('shifts/:id/readings')
  reading(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.recordReading(auth, parse(uuid, id), parse(ReadingBody, body));
  }

  @Post('shifts/:id/pump-tests')
  pumpTest(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.recordPumpTest(auth, parse(uuid, id), parse(TestBody, body));
  }

  @Post('shifts/:id/collections')
  collection(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.recordCollection(auth, parse(uuid, id), parse(CollectionBody, body));
  }

  @Put('shifts/:id/nozzles/:nozzleId/attendant')
  attendant(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Param('nozzleId') nozzleId: string, @Body() body: unknown) {
    return this.shifts.setAttendant(auth, parse(uuid, id), parse(uuid, nozzleId), parse(AttendantBody, body).attendantId);
  }

  @Post('shifts/:id/submit')
  @HttpCode(200)
  submit(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.submit(auth, parse(uuid, id), parse(SubmitBody, body));
  }

  @Post('shifts/:id/approve')
  @HttpCode(200)
  approve(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.approve(auth, parse(uuid, id), parse(ApproveBody, body));
  }

  @Post('shifts/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.shifts.reopen(auth, parse(uuid, id), parse(ReopenBody, body));
  }
}
