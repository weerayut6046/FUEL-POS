import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Controller, Get, Inject, Injectable, Param, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { AuthCtx, AuthedRequest, CurrentAuth } from '../auth/auth-context.js';
import { sha256Hex } from '../auth/crypto.js';
import { badRequest, conflict, notFound } from '../common/errors.js';
import { parse, uuid } from '../common/validation.js';
import type { AppConfig } from '../config.js';
import { Db, maybeOne } from '../db/db.js';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * ที่เก็บไฟล์ — ตอนนี้เก็บบนดิสก์ (โฟลเดอร์แยกตามลูกค้า)
 * ใช้งานจริงบนคลาวด์ให้เปลี่ยนเป็น object storage (S3/GCS) ที่ implement interface เดียวกัน
 */
export interface PhotoStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export class LocalDiskStorage implements PhotoStorage {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root))) throw new Error('invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}

export const PHOTO_STORAGE = Symbol('PHOTO_STORAGE');

export function createStorage(config: AppConfig): PhotoStorage {
  return new LocalDiskStorage(config.photoDir);
}

@Injectable()
export class PhotosService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {}

  /** อัปโหลดรูป — id มาจากเครื่อง ส่งซ้ำได้ (ถ้าไฟล์เดิมจะคืนรายการเดิม) */
  async upload(auth: AuthCtx, id: string, contentType: string, data: Buffer) {
    if (!PHOTO_TYPES.includes(contentType as (typeof PHOTO_TYPES)[number])) {
      throw badRequest('UNSUPPORTED_TYPE', 'รองรับเฉพาะไฟล์ JPEG, PNG, WebP');
    }
    if (!data.length) throw badRequest('EMPTY_FILE', 'ไฟล์ว่าง');
    const sha = sha256Hex(data);
    return this.db.withTenant(auth, async (tx) => {
      const existing = await maybeOne<{ sha256: string; size_bytes: number; content_type: string }>(
        tx,
        'SELECT sha256, size_bytes, content_type FROM photos WHERE id = $1',
        [id],
      );
      if (existing) {
        if (existing.sha256 !== sha) throw conflict('ID_CONFLICT', 'รหัสรูปซ้ำกับรูปอื่น');
        return { id, sizeBytes: existing.size_bytes, contentType: existing.content_type, sha256: sha };
      }
      const now = new Date();
      const key = `${auth.tenantId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${EXT[contentType]}`;
      await this.storage.put(key, data);
      await tx.query(
        `INSERT INTO photos (id, tenant_id, storage_key, content_type, size_bytes, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, auth.tenantId, key, contentType, data.length, sha, auth.userId],
      );
      return { id, sizeBytes: data.length, contentType, sha256: sha };
    });
  }

  async download(auth: AuthCtx, id: string): Promise<{ contentType: string; data: Buffer }> {
    const row = await this.db.withTenant(auth, (tx) =>
      maybeOne<{ storage_key: string; content_type: string }>(tx, 'SELECT storage_key, content_type FROM photos WHERE id = $1', [id]),
    );
    if (!row) throw notFound('รูป');
    return { contentType: row.content_type, data: await this.storage.get(row.storage_key) };
  }
}

@Controller('photos')
export class PhotosController {
  constructor(@Inject(PhotosService) private readonly photos: PhotosService) {}

  /** body เป็นไบต์ของรูปตรง ๆ (Content-Type: image/jpeg) */
  @Put(':id')
  upload(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Req() req: AuthedRequest) {
    const body = req.body;
    if (!Buffer.isBuffer(body)) throw badRequest('UNSUPPORTED_TYPE', 'รองรับเฉพาะไฟล์ JPEG, PNG, WebP');
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    return this.photos.upload(auth, parse(uuid, id), contentType, body);
  }

  @Get(':id')
  async download(@CurrentAuth() auth: AuthCtx, @Param('id') id: string, @Res() reply: FastifyReply) {
    const photo = await this.photos.download(auth, parse(uuid, id));
    void reply
      .header('Content-Type', photo.contentType)
      .header('Cache-Control', 'private, max-age=86400, immutable')
      .send(photo.data);
  }
}

