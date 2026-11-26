import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnApplicationBootstrap,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { AuthCtx, AuthedRequest, CurrentAuth, Public, Roles } from '../auth/auth-context.js';
import { sixDigitCode } from '../auth/crypto.js';
import { tenantNow } from '../common/access.js';
import { ApiError, notFound, unauthorized } from '../common/errors.js';
import { parse, text, uuid } from '../common/validation.js';
import { APP_CONFIG, AppConfig } from '../config.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { Db, many, maybeOne, one } from '../db/db.js';
import { enqueueNotification } from './outbox.js';

// ---------------------------------------------------------------------------
// LINE Messaging API
// ---------------------------------------------------------------------------

export interface LineClient {
  readonly configured: boolean;
  push(to: string, text: string): Promise<void>;
  reply(replyToken: string, text: string): Promise<void>;
}

export const LINE_CLIENT = Symbol('LINE_CLIENT');

export class HttpLineClient implements LineClient {
  readonly configured: boolean;

  constructor(private readonly token: string | null) {
    this.configured = !!token;
  }

  private async call(path: string, body: unknown): Promise<void> {
    if (!this.token) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
    const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`LINE ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  push(to: string, text: string) {
    return this.call('push', { to, messages: [{ type: 'text', text }] });
  }

  reply(replyToken: string, text: string) {
    return this.call('reply', { replyToken, messages: [{ type: 'text', text }] });
  }
}

/** ตรวจลายเซ็น webhook: base64(HMAC-SHA256(channel secret, raw body)) */
export function verifyLineSignature(secret: string, rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// Worker ส่งข้อความจาก outbox + สรุปประจำวัน
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;

@Injectable()
export class NotifyWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Notify');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(LINE_CLIENT) private readonly line: LineClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DashboardService) private readonly dashboard: DashboardService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.notifyIntervalMs > 0) {
      this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.error(e)), this.config.notifyIntervalMs);
      this.timer.unref();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** หนึ่งรอบ: ทุกลูกค้า → สร้างสรุปประจำวันถ้าถึงเวลา → ส่งข้อความที่ค้าง */
  async runOnce(): Promise<{ sent: number; failed: number; skipped: number }> {
    const stats = { sent: 0, failed: 0, skipped: 0 };
    if (this.running) return stats;
    this.running = true;
    try {
      const tenants = await this.db.query<{ tenant_id: string }>('SELECT tenant_id FROM app_job_tenants()');
      for (const { tenant_id } of tenants) {
        await this.db.withTenant({ tenantId: tenant_id, userId: null }, async (tx) => {
          const settings = await one<{ daily_summary_hour: number | null }>(tx, 'SELECT daily_summary_hour FROM tenant_settings');
          const now = await tenantNow(tx);
          if (settings.daily_summary_hour !== null && now.hour >= settings.daily_summary_hour) {
            const exists = await maybeOne(tx, 'SELECT 1 FROM notifications WHERE dedupe_key = $1', [`daily:${now.today}`]);
            if (!exists) {
              const text = await this.dashboard.dailySummaryText(tx, now.today);
              if (text) await enqueueNotification(tx, tenant_id, `daily:${now.today}`, 'daily_summary', text);
            }
          }

          const pending = await many<{ id: string; message: string; attempts: number }>(
            tx,
            `SELECT id, message, attempts FROM notifications WHERE status = 'pending'
             ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
          );
          if (!pending.length) return;
          const recipients = await many<{ line_id: string }>(tx, 'SELECT line_id FROM line_recipients WHERE active');
          for (const n of pending) {
            if (!this.line.configured || recipients.length === 0) {
              await tx.query("UPDATE notifications SET status = 'skipped', last_error = $2 WHERE id = $1", [
                n.id,
                this.line.configured ? 'ยังไม่ได้เชื่อม LINE กับผู้รับ' : 'ระบบยังไม่ได้ตั้งค่า LINE OA',
              ]);
              stats.skipped++;
              continue;
            }
            try {
              for (const r of recipients) await this.line.push(r.line_id, n.message);
              await tx.query("UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1", [n.id]);
              stats.sent++;
            } catch (err) {
              const attempts = n.attempts + 1;
              await tx.query('UPDATE notifications SET attempts = $2, last_error = $3, status = $4 WHERE id = $1', [
                n.id,
                attempts,
                (err as Error).message.slice(0, 500),
                attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
              ]);
              stats.failed++;
            }
          }
        });
      }
    } finally {
      this.running = false;
    }
    return stats;
  }
}

// ---------------------------------------------------------------------------
// API: เชื่อม LINE, รายชื่อผู้รับ, webhook
// ---------------------------------------------------------------------------

const RecipientPatch = z.object({ active: z.boolean() });
const TestBody = z.object({ message: text(500).optional() });

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
  message?: { type: string; text?: string };
}

const HELP_TEXT =
  'สวัสดีครับ นี่คือระบบแจ้งเตือนปั๊มน้ำมัน\nเปิดแอป → ตั้งค่า → LINE แจ้งเตือน → กด "สร้างรหัสเชื่อม" แล้วพิมพ์รหัส 6 หลักส่งมาในแชตนี้';

@Controller('line')
export class LineController {
  private readonly log = new Logger('LINE');

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(LINE_CLIENT) private readonly line: LineClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** สร้างรหัส 6 หลัก (หมดอายุใน 15 นาที) ให้ผู้ใช้พิมพ์ส่งใน LINE OA ของระบบ */
  @Post('link-codes')
  @Roles('owner', 'manager')
  createLinkCode(@CurrentAuth() auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = sixDigitCode();
        await tx.query('SAVEPOINT link_code');
        try {
          const row = await one<{ code: string; expires_at: Date }>(
            tx,
            `INSERT INTO line_link_codes (code, tenant_id, created_by, expires_at)
             VALUES ($1, $2, $3, now() + interval '15 minutes') RETURNING code, expires_at`,
            [code, auth.tenantId, auth.userId],
          );
          await tx.query('RELEASE SAVEPOINT link_code');
          return { code: row.code, expiresAt: row.expires_at, lineConfigured: this.line.configured };
        } catch (err) {
          await tx.query('ROLLBACK TO SAVEPOINT link_code');
          if ((err as { code?: string }).code !== '23505') throw err;
        }
      }
      throw new ApiError(503, 'TRY_AGAIN', 'สร้างรหัสไม่สำเร็จ กรุณาลองใหม่');
    });
  }

  @Get('recipients')
  @Roles('owner', 'manager')
  recipients(@CurrentAuth() auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) => {
      const rows = await many<{ id: string; kind: string; display_name: string | null; active: boolean; linked_at: Date }>(
        tx,
        'SELECT id, kind, display_name, active, linked_at FROM line_recipients ORDER BY linked_at DESC',
      );
      return {
        lineConfigured: this.line.configured,
        recipients: rows.map((r) => ({ id: r.id, kind: r.kind, displayName: r.display_name, active: r.active, linkedAt: r.linked_at })),
      };
    });
  }

  @Patch('recipients/:id')
  @Roles('owner', 'manager')
  updateRecipient(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Body() body: unknown) {
    const { active } = parse(RecipientPatch, body);
    return this.db.withTenant(auth, async (tx) => {
      const row = await maybeOne<{ id: string }>(tx, 'UPDATE line_recipients SET active = $2 WHERE id = $1 RETURNING id', [
        parse(uuid, id),
        active,
      ]);
      if (!row) throw notFound('ผู้รับแจ้งเตือน');
      return { id: row.id, active };
    });
  }

  /** ส่งข้อความทดสอบ (เข้าคิว แล้ว worker ส่ง) */
  @Post('test')
  @Roles('owner', 'manager')
  test(@CurrentAuth() auth: AuthCtx, @Body() body: unknown) {
    const { message } = parse(TestBody, body);
    return this.db.withTenant(auth, async (tx) => {
      await enqueueNotification(tx, auth.tenantId, `test:${Date.now()}`, 'test', message ?? `ทดสอบการแจ้งเตือนจาก ${auth.displayName} ✅`);
      return { queued: true };
    });
  }

  @Get('notifications')
  @Roles('owner', 'manager')
  notifications(@CurrentAuth() auth: AuthCtx) {
    return this.db.withTenant(auth, async (tx) =>
      (
        await many<{ id: string; kind: string; message: string; status: string; last_error: string | null; created_at: Date; sent_at: Date | null }>(
          tx,
          'SELECT id, kind, message, status, last_error, created_at, sent_at FROM notifications ORDER BY created_at DESC LIMIT 100',
        )
      ).map((n) => ({
        id: n.id,
        kind: n.kind,
        message: n.message,
        status: n.status,
        lastError: n.last_error,
        createdAt: n.created_at,
        sentAt: n.sent_at,
      })),
    );
  }

  /** Webhook จาก LINE Platform — รับรหัสเชื่อมจากแชต */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: AuthedRequest) {
    const secret = this.config.line.channelSecret;
    const signature = req.headers['x-line-signature'];
    if (!secret || typeof signature !== 'string' || !req.rawBody || !verifyLineSignature(secret, req.rawBody, signature)) {
      throw unauthorized('ลายเซ็นไม่ถูกต้อง');
    }
    const events = ((req.body as { events?: LineEvent[] })?.events ?? []).slice(0, 50);
    for (const ev of events) {
      try {
        await this.handleEvent(ev);
      } catch (err) {
        this.log.error(`handle LINE event: ${(err as Error).message}`);
      }
    }
    return { ok: true };
  }

  private async handleEvent(ev: LineEvent) {
    const src = ev.source;
    const lineId = src?.groupId ?? src?.roomId ?? src?.userId;
    if (!src || !lineId) return;
    if (ev.type === 'follow' || ev.type === 'join') {
      if (ev.replyToken) await this.line.reply(ev.replyToken, HELP_TEXT);
      return;
    }
    if (ev.type !== 'message' || ev.message?.type !== 'text') return;
    const code = /(?:^|\D)(\d{6})(?:\D|$)/.exec(ev.message.text ?? '')?.[1];
    if (!code) {
      if (src.type === 'user' && ev.replyToken) await this.line.reply(ev.replyToken, HELP_TEXT);
      return;
    }
    const [row] = await this.db.query<{ app_line_link: string | null }>('SELECT app_line_link($1, $2, $3, $4)', [
      code,
      lineId,
      src.type,
      null,
    ]);
    if (!ev.replyToken) return;
    await this.line.reply(
      ev.replyToken,
      row?.app_line_link
        ? `เชื่อมต่อกับ "${row.app_line_link}" เรียบร้อย ✅\nจะได้รับแจ้งเตือนเงินขาดเกิน น้ำมันใกล้หมด และสรุปประจำวันที่แชตนี้`
        : 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว กรุณาสร้างรหัสใหม่ในแอป',
    );
  }
}
