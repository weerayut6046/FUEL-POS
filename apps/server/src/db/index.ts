import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';

export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;

const SCHEMA_VERSION = 1;

/**
 * ชั้นห่อ SQLite บาง ๆ
 *
 * ใช้ node:sqlite ที่มากับ Node 22 จึงไม่มี native module ให้คอมไพล์
 * ทำให้ติดตั้งบน Windows ง่ายมาก (ไม่ต้องมี Visual Studio Build Tools)
 *
 * ใช้พารามิเตอร์แบบ ? เท่านั้น เพื่อกันปัญหาชื่อพารามิเตอร์ต่างกัน
 * ระหว่าง sqlite แต่ละ implementation
 */
export class Database {
  private readonly db: DatabaseSync;

  constructor(readonly file: string) {
    if (file !== ':memory:') {
      mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA_SQL);

    const current = this.get<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
    if (!current) {
      this.run('INSERT INTO schema_version (version) VALUES (?)', SCHEMA_VERSION);
    }
  }

  /** อ่านหลายแถว */
  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  /** อ่านแถวเดียว (คืน null ถ้าไม่พบ) */
  get<T = Row>(sql: string, ...params: SqlValue[]): T | null {
    const row = this.db.prepare(sql).get(...(params as never[]));
    return (row as T) ?? null;
  }

  /** เขียนข้อมูล คืนจำนวนแถวที่เปลี่ยนและ id ที่เพิ่งเพิ่ม */
  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
    const result = this.db.prepare(sql).run(...(params as never[]));
    return {
      changes: Number(result.changes),
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * ทำงานเป็นทรานแซกชัน — ถ้าฟังก์ชันโยน error จะ rollback ทั้งหมด
   * สำคัญกับการบันทึกการขาย ที่ต้องเขียน sales + payments + tank_movements พร้อมกัน
   */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* ถ้า rollback ล้มเหลวด้วย ให้โยน error เดิมออกไป */
      }
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** แปลง 0/1 ของ SQLite เป็น boolean */
export const toBool = (value: SqlValue): boolean => value === 1 || value === '1';

/** แปลง boolean เป็น 0/1 (node:sqlite ไม่รับ boolean โดยตรง) */
export const fromBool = (value: boolean): number => (value ? 1 : 0);
