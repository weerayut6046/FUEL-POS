import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';

import { AuthCtx, CurrentAuth, Roles } from '../auth/auth-context.js';
import { isoDate, parse, uuid } from '../common/validation.js';
import { DashboardService } from './dashboard.service.js';

const DashboardQuery = z
  .object({ from: isoDate, to: isoDate, branchId: uuid.optional() })
  .refine((r) => r.from <= r.to, { message: 'วันเริ่มต้องไม่เกินวันสิ้นสุด' });

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  @Roles('owner', 'manager')
  summary(@CurrentAuth() auth: AuthCtx, @Query() query: unknown) {
    return this.dashboard.summary(auth, parse(DashboardQuery, query));
  }
}
