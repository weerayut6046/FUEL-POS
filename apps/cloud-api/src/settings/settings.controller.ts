import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';

import { AuthCtx, CurrentAuth, Roles } from '../auth/auth-context.js';
import { forbidden } from '../common/errors.js';
import { isoDateTime, litres, mm, parse, satang, text, uuid } from '../common/validation.js';
import { CatalogService } from './catalog.service.js';
import { EquipmentService } from './equipment.service.js';
import { UsersService } from './users.service.js';

const code = z.string().trim().min(1, 'กรุณากรอกรหัส').max(20);
const name = z.string().trim().min(1, 'กรุณากรอกชื่อ').max(200);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'สีต้องอยู่ในรูป #RRGGBB');
const role = z.enum(['owner', 'manager', 'staff']);
const password = z.string().min(4, 'รหัสผ่านอย่างน้อย 4 ตัว').max(200);
const sortOrder = z.number().int().min(0).max(10_000);
const positiveLitres = litres.refine((v) => Number(v) > 0, 'ต้องมากกว่า 0');

const BranchBody = z.object({
  code,
  name,
  address: text(500).nullish(),
  taxId: z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก').nullish(),
  phone: text(30).nullish(),
});
const BranchPatch = BranchBody.partial().extend({ active: z.boolean().optional() });

const FuelTypeBody = z.object({ code, name, color: color.optional(), sortOrder: sortOrder.optional() });
const FuelTypePatch = FuelTypeBody.partial().extend({ active: z.boolean().optional() });

const PricesBody = z.object({
  effectiveAt: isoDateTime.nullish(),
  note: text(300).nullish(),
  items: z
    .array(z.object({ fuelTypeId: uuid, priceSatang: satang.refine((v) => v > 0, 'ราคาต้องมากกว่า 0') }))
    .min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
});

const TankBody = z.object({
  code,
  name,
  fuelTypeId: uuid,
  capacityLitres: positiveLitres,
  reorderLitres: litres.nullish(),
  sortOrder: sortOrder.nullish(),
});
const TankPatch = TankBody.partial().extend({ active: z.boolean().optional() });

const CalibrationBody = z.object({
  points: z.array(z.object({ mm, litres })).min(2, 'ตารางต้องมีอย่างน้อย 2 แถว').max(5000),
  note: text(300).nullish(),
});

const NozzleBody = z.object({
  code,
  name,
  dispenserNo: z.number().int().min(1).max(999).nullish(),
  fuelTypeId: uuid,
  tankId: uuid,
  meterModulus: positiveLitres.nullish(),
  sortOrder: sortOrder.nullish(),
});
const NozzlePatch = NozzleBody.partial().extend({ active: z.boolean().optional() });

const UserBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - (2–40 ตัว)'),
  displayName: z.string().trim().min(1).max(100),
  role,
  password,
  allBranches: z.boolean().optional(),
  branchIds: z.array(uuid).optional(),
});
const UserPatch = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  role: role.optional(),
  password: password.optional(),
  allBranches: z.boolean().optional(),
  branchIds: z.array(uuid).optional(),
  active: z.boolean().optional(),
});

const SettingsPatch = z.object({
  tenantName: name.optional(),
  cashAlertSatang: satang.optional(),
  varianceAlertPercent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'เปอร์เซ็นต์ทศนิยมไม่เกิน 2 ตำแหน่ง').optional(),
  dailySummaryHour: z.number().int().min(0).max(23).nullable().optional(),
});

@Controller()
export class SettingsController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(EquipmentService) private readonly equipment: EquipmentService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  // สาขา
  @Get('branches')
  listBranches(@CurrentAuth() auth: AuthCtx) {
    return this.catalog.listBranches(auth);
  }

  @Post('branches')
  @Roles('owner')
  createBranch(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    return this.catalog.createBranch(auth, parse(BranchBody, body));
  }

  @Patch('branches/:id')
  @Roles('owner')
  updateBranch(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.catalog.updateBranch(auth, parse(uuid, id), parse(BranchPatch, body));
  }

  /** ข้อมูลตั้งค่าครบชุดของสาขา สำหรับแอปเก็บไว้ใช้ออฟไลน์ */
  @Get('branches/:id/setup')
  branchSetup(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.equipment.branchSetup(auth, parse(uuid, id));
  }

  // ชนิดน้ำมัน
  @Get('fuel-types')
  listFuelTypes(@CurrentAuth() auth: AuthCtx) {
    return this.catalog.listFuelTypes(auth);
  }

  @Post('fuel-types')
  @Roles('owner')
  createFuelType(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    return this.catalog.createFuelType(auth, parse(FuelTypeBody, body));
  }

  @Patch('fuel-types/:id')
  @Roles('owner')
  updateFuelType(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.catalog.updateFuelType(auth, parse(uuid, id), parse(FuelTypePatch, body));
  }

  // ราคา
  @Get('branches/:id/prices')
  listPrices(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.catalog.listPrices(auth, parse(uuid, id));
  }

  @Post('branches/:id/prices')
  @Roles('owner', 'manager')
  setPrices(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.catalog.setPrices(auth, parse(uuid, id), parse(PricesBody, body));
  }

  // ถัง
  @Get('branches/:id/tanks')
  listTanks(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.equipment.listTanks(auth, parse(uuid, id));
  }

  @Post('branches/:id/tanks')
  @Roles('owner', 'manager')
  createTank(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.equipment.createTank(auth, parse(uuid, id), parse(TankBody, body));
  }

  @Patch('tanks/:id')
  @Roles('owner', 'manager')
  updateTank(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.equipment.updateTank(auth, parse(uuid, id), parse(TankPatch, body));
  }

  @Get('tanks/:id/calibration')
  getCalibration(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.equipment.getCalibration(auth, parse(uuid, id));
  }

  @Put('tanks/:id/calibration')
  @Roles('owner', 'manager')
  setCalibration(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.equipment.setCalibration(auth, parse(uuid, id), parse(CalibrationBody, body));
  }

  // หัวจ่าย
  @Get('branches/:id/nozzles')
  listNozzles(@CurrentAuth() auth: AuthCtx, @Param('id') id: string) {
    return this.equipment.listNozzles(auth, parse(uuid, id));
  }

  @Post('branches/:id/nozzles')
  @Roles('owner', 'manager')
  createNozzle(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.equipment.createNozzle(auth, parse(uuid, id), parse(NozzleBody, body));
  }

  @Patch('nozzles/:id')
  @Roles('owner', 'manager')
  updateNozzle(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.equipment.updateNozzle(auth, parse(uuid, id), parse(NozzlePatch, body));
  }

  // ผู้ใช้
  @Get('users')
  @Roles('owner', 'manager')
  listUsers(@CurrentAuth() auth: AuthCtx) {
    return this.users.list(auth);
  }

  @Post('users')
  @Roles('owner', 'manager')
  createUser(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    return this.users.create(auth, parse(UserBody, body));
  }

  @Patch('users/:id')
  updateUser(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    const userId = parse(uuid, id);
    const patch = parse(UserPatch, body);
    // พนักงานเปลี่ยนได้แค่รหัสผ่านของตัวเอง
    if (auth.role === 'staff' && (userId !== auth.userId || Object.keys(patch).some((k) => k !== 'password'))) {
      throw forbidden('พนักงานเปลี่ยนได้เฉพาะรหัสผ่านของตัวเอง');
    }
    return this.users.update(auth, userId, patch);
  }

  // ค่าตั้งของลูกค้า
  @Get('settings')
  @Roles('owner', 'manager')
  getSettings(@CurrentAuth() auth: AuthCtx) {
    return this.catalog.getSettings(auth);
  }

  @Patch('settings')
  @Roles('owner')
  updateSettings(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    return this.catalog.updateSettings(auth, parse(SettingsPatch, body));
  }

  @Get('audit-log')
  @Roles('owner')
  auditLog(@CurrentAuth() auth: AuthCtx, @Query('limit') limit?: string) {
    return this.catalog.auditLog(auth, Math.min(Math.max(Number(limit) || 100, 1), 500));
  }
}
