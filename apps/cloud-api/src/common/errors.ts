import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

/**
 * ข้อผิดพลาดที่ตั้งใจส่งให้ผู้ใช้เห็น — ข้อความเป็นภาษาไทยอ่านเข้าใจได้
 * code ใช้ให้แอปตัดสินใจ (เช่น ปิดกะไม่ได้เพราะยังกรอกมิเตอร์ไม่ครบ)
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = 'กรุณาเข้าสู่ระบบ') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'ไม่มีสิทธิ์ทำรายการนี้') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `ไม่พบ${what}`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new ApiError(422, code, message, details);

interface PgError {
  code?: string;
  constraint?: string;
  hint?: string;
  message: string;
}

function fromPg(err: PgError): ApiError | null {
  switch (err.code) {
    case '23505':
      return conflict('DUPLICATE', 'ข้อมูลนี้มีอยู่แล้ว', { constraint: err.constraint });
    case '23503':
      return badRequest('INVALID_REFERENCE', 'อ้างถึงข้อมูลที่ไม่มีอยู่', { constraint: err.constraint });
    case '23514':
      return badRequest('CHECK_FAILED', 'ข้อมูลไม่ผ่านเงื่อนไขของระบบ', { constraint: err.constraint });
    case '42501':
      return forbidden('ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
    case 'P0001':
      return conflict(err.hint === 'append_only' ? 'APPEND_ONLY' : 'DB_RULE', err.message);
    case '22P02':
      return badRequest('INVALID_INPUT', 'รูปแบบข้อมูลไม่ถูกต้อง');
    default:
      return null;
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const err = this.normalize(exception);
    if (err.status >= 500) {
      this.log.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    }
    void reply.status(err.status).send({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }

  private normalize(exception: unknown): ApiError {
    if (exception instanceof ApiError) return exception;
    if (exception instanceof z.ZodError) {
      return badRequest(
        'VALIDATION',
        'ข้อมูลไม่ครบหรือรูปแบบไม่ถูกต้อง',
        exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return new ApiError(status, status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', exception.message);
    }
    if (exception && typeof exception === 'object' && 'code' in exception) {
      const pg = fromPg(exception as PgError);
      if (pg) return pg;
      const e = exception as { statusCode?: number; code?: string; message?: string };
      if (typeof e.statusCode === 'number' && e.statusCode < 500) {
        // ข้อผิดพลาดจาก Fastify เช่น body ใหญ่เกิน หรือ content-type ไม่รองรับ
        return new ApiError(e.statusCode, e.code ?? 'HTTP_ERROR', e.message ?? 'คำขอไม่ถูกต้อง');
      }
    }
    return new ApiError(500, 'INTERNAL', 'ระบบขัดข้อง กรุณาลองใหม่');
  }
}
