import 'reflect-metadata';

import { Controller, Get, Inject, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { Public } from './auth/auth-context.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { ApiExceptionFilter } from './common/errors.js';
import { APP_CONFIG, AppConfig } from './config.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { Db } from './db/db.js';
import { HttpLineClient, LINE_CLIENT, LineClient, LineController, NotifyWorker } from './notify/line.js';
import { createStorage, MAX_PHOTO_BYTES, PHOTO_STORAGE, PHOTO_TYPES, PhotosController, PhotosService, PhotoStorage } from './photos/photos.js';
import { CatalogService } from './settings/catalog.service.js';
import { EquipmentService } from './settings/equipment.service.js';
import { SettingsController } from './settings/settings.controller.js';
import { UsersService } from './settings/users.service.js';
import { ShiftsController } from './shifts/shifts.controller.js';
import { ShiftsService } from './shifts/shifts.service.js';
import { StockController } from './stock/stock.controller.js';
import { StockService } from './stock/stock.service.js';

@Controller('health')
class HealthController {
  constructor(@Inject(Db) private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    await this.db.query('SELECT 1');
    return { ok: true, time: new Date().toISOString() };
  }
}

export interface AppOverrides {
  db?: Db;
  lineClient?: LineClient;
  storage?: PhotoStorage;
}

@Module({})
class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        SettingsController,
        ShiftsController,
        StockController,
        DashboardController,
        PhotosController,
        LineController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: Db, useValue: overrides.db ?? new Db(config.databaseUrl) },
        { provide: LINE_CLIENT, useValue: overrides.lineClient ?? new HttpLineClient(config.line.channelAccessToken) },
        { provide: PHOTO_STORAGE, useValue: overrides.storage ?? createStorage(config) },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        AuthService,
        CatalogService,
        EquipmentService,
        UsersService,
        ShiftsService,
        StockService,
        DashboardService,
        PhotosService,
        NotifyWorker,
      ],
    };
  }
}

/** สร้างแอป (ใช้ทั้งตอนรันจริงและในชุดทดสอบ) */
export async function createApp(config: AppConfig, overrides: AppOverrides = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config, overrides), adapter, {
    rawBody: true,
    logger: process.env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  app.enableShutdownHooks();
  // รูปถ่ายส่งมาเป็นไบต์ตรง ๆ
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser([...PHOTO_TYPES], { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) => done(null, body));
  await app.init();
  return app;
}
