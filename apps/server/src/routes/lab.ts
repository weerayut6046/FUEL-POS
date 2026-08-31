import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SerialSettings } from '@fuel-pos/shared';
import {
  BusScanner,
  COMMON_BAUD_RATES,
  ProfileCodec,
  SerialTransport,
  fromHex,
  guessChecksum,
  analyzeColumns,
  parseProfile,
  summarize,
  toHex,
  toPrintable,
} from '@fuel-pos/pump-core';
import type { AppContext } from '../context.js';
import { fail, requireRole } from './index.js';

/**
 * Protocol Lab — เครื่องมือหาโปรโตคอลของตู้จ่ายที่ไม่มีเอกสาร
 *
 * ทุกเส้นทางในไฟล์นี้ต้องเป็นสิทธิ์ผู้ดูแลระบบ เพราะเป็นการส่งไบต์ดิบ
 * เข้าบัสที่ต่อกับตู้จ่ายจริง ซึ่งอาจทำให้ตู้ทำงานผิดปกติได้ถ้าใช้ผิด
 */
export async function labRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/lab/serial-ports', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    return SerialTransport.list();
  });

  app.get('/api/lab/buses', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    return ctx.pumps.listBuses();
  });

  app.get('/api/lab/profiles', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    return ctx.pumps.listProfiles().map((p) => ({
      id: p.id,
      name: p.name,
      vendor: p.vendor ?? null,
      unverified: p.unverified ?? false,
      description: p.description ?? null,
      baudRate: p.serial.baudRate,
      framing: p.framing.kind,
      checksum: p.checksum.kind,
      nozzlesPerPump: p.nozzlesPerPump,
    }));
  });

  app.get<{ Params: { id: string } }>('/api/lab/profiles/:id', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    const profile = ctx.pumps.getProfile(request.params.id);
    if (!profile) return fail(reply, new Error('ไม่พบโปรไฟล์'), 404);
    return profile;
  });

  /** บันทึกโปรไฟล์ที่ผู้ใช้แก้ไข ลงโฟลเดอร์ของผู้ใช้ (ไม่ทับไฟล์ที่มากับโปรแกรม) */
  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/lab/profiles/:id',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        const profile = parseProfile(request.body, `${request.params.id}.json`);
        if (profile.id !== request.params.id) {
          throw new Error(`id ในไฟล์ ("${profile.id}") ไม่ตรงกับชื่อที่บันทึก ("${request.params.id}")`);
        }
        await mkdir(ctx.config.profilesDir, { recursive: true });
        await writeFile(
          path.join(ctx.config.profilesDir, `${profile.id}.json`),
          JSON.stringify(request.body, null, 2),
          'utf8',
        );
        await ctx.pumps.restart();
        return { ok: true, profile };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /**
   * ส่งไบต์ดิบเข้าบัส — ใช้ทดลองคำสั่งที่เดาไว้ว่าตู้น่าจะเข้าใจ
   * คำตอบที่ตู้ส่งกลับจะไหลไปหน้าจอผ่าน WebSocket (bus.traffic)
   */
  app.post<{ Body: { busId: string; hex: string } }>(
    '/api/lab/send',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      const runtime = ctx.pumps.getBus(request.body.busId);
      if (!runtime) return fail(reply, new Error('ไม่พบบัสที่ระบุ'), 404);

      try {
        const bytes = fromHex(request.body.hex);
        await runtime.bus.sendRaw(bytes);
        return { ok: true, sent: toHex(bytes) };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /** ถอดรหัสเฟรมด้วยโปรไฟล์ที่เลือก เพื่อดูว่าตีความได้ตรงหรือไม่ */
  app.post<{ Body: { profileId: string; hex: string } }>(
    '/api/lab/decode',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      const profile = ctx.pumps.getProfile(request.body.profileId);
      if (!profile) return fail(reply, new Error('ไม่พบโปรไฟล์'), 404);

      try {
        const codec = new ProfileCodec(profile);
        const wire = fromHex(request.body.hex);
        const frame = codec.unescape(wire);

        const result: Record<string, unknown> = {
          wire: toHex(wire),
          unescaped: toHex(frame),
          ascii: toPrintable(frame),
          checksumValid: codec.verify(frame),
        };

        try {
          result.asRequest = codec.decodeRequest(frame);
        } catch (err) {
          result.asRequest = { error: (err as Error).message };
        }
        try {
          result.asResponse = codec.decode(frame);
        } catch (err) {
          result.asResponse = { error: (err as Error).message };
        }
        return result;
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /**
   * วิเคราะห์เฟรมที่ดักจับได้ — หัวใจของการถอดรหัสโปรโตคอล
   * บอกว่าไบต์ไหนคงที่ (STX/คำสั่ง) ไบต์ไหนเปลี่ยน (ข้อมูล) และ checksum น่าจะเป็นสูตรไหน
   */
  app.post<{ Body: { frames: string[] } }>('/api/lab/analyze', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    try {
      const frames = (request.body.frames ?? []).map((hex) => fromHex(hex));
      if (frames.length === 0) return fail(reply, new Error('ต้องมีเฟรมอย่างน้อย 1 เฟรม'));

      return {
        summary: summarize(frames),
        columns: analyzeColumns(frames),
        checksums: guessChecksum(frames).map((c) => ({
          kind: c.kind,
          description: c.description,
          spec: c.spec,
        })),
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /**
   * ดักฟังบัสแบบไม่ส่งอะไรออกไป
   * ใช้เมื่อมีอุปกรณ์เดิมคุยกับตู้อยู่แล้ว — เป็นวิธีที่ได้ผลที่สุดในการถอดรหัส
   */
  app.post<{
    Body: { path: string; baudRate?: number; durationMs?: number; parity?: SerialSettings['parity'] };
  }>('/api/lab/sniff', async (request, reply) => {
    if (!requireRole(request, reply, 'admin')) return;
    try {
      const result = await BusScanner.sniff(
        request.body.path,
        {
          baudRate: request.body.baudRate ?? 9600,
          dataBits: 8,
          stopBits: 1,
          parity: request.body.parity ?? 'none',
        },
        Math.min(60_000, request.body.durationMs ?? 5000),
      );

      const suggestion = BusScanner.suggestProfile(result.blocks);
      return {
        totalBytes: result.totalBytes,
        durationMs: result.durationMs,
        blocks: result.blocks.map((b) => ({ hex: toHex(b), ascii: toPrintable(b), length: b.length })),
        suggestion: {
          boundaries: suggestion.boundaries,
          checksums: suggestion.checksums.map((c) => ({ kind: c.kind, description: c.description })),
        },
        summary: summarize(result.blocks),
      };
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** ลองทีละความเร็ว เพื่อหาว่าตู้ใช้ baud rate เท่าไร */
  app.post<{ Body: { path: string; baudRates?: number[]; perBaudMs?: number } }>(
    '/api/lab/scan-baud',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      try {
        return await BusScanner.scanBaudRates(
          request.body.path,
          request.body.baudRates ?? COMMON_BAUD_RATES,
          Math.min(15_000, request.body.perBaudMs ?? 3000),
        );
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  /** ยิงคำสั่ง status ไปทีละ address เพื่อหาว่ามีตู้อยู่ที่ address ไหน */
  app.post<{ Body: { busId: string; from?: number; to?: number } }>(
    '/api/lab/probe-addresses',
    async (request, reply) => {
      if (!requireRole(request, reply, 'admin')) return;
      const runtime = ctx.pumps.getBus(request.body.busId);
      if (!runtime) return fail(reply, new Error('ไม่พบบัสที่ระบุ'), 404);

      try {
        const results = await BusScanner.probeAddresses(
          runtime.bus,
          runtime.profile,
          request.body.from ?? 0,
          Math.min(64, request.body.to ?? 16),
        );
        return {
          found: results.filter((r) => r.responded),
          all: results,
        };
      } catch (err) {
        return fail(reply, err);
      }
    },
  );

  app.get('/api/lab/baud-rates', async () => COMMON_BAUD_RATES);
}
