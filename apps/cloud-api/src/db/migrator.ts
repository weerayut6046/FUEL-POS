import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

/** โฟลเดอร์ migrations/ อยู่ที่รากของแอป (ไม่ถูกคอมไพล์) */
export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/src/db → ../../../migrations
  return join(here, '..', '..', '..', 'migrations');
}

/**
 * รัน migration ที่ยังไม่เคยรัน เรียงตามชื่อไฟล์ — ต้องต่อด้วยบทบาทเจ้าของตาราง (fuel_owner)
 * แต่ละไฟล์รันใน transaction เดียว ถ้าพังกลางทางจะไม่ค้างครึ่ง ๆ
 */
export async function migrate(connectionString: string, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    // กันรัน migration พร้อมกันหลายเครื่อง
    await client.query('SELECT pg_advisory_lock(727001)');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(migrationsDir())).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(migrationsDir(), file), 'utf8');
      log(`กำลังรัน migration ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} ล้มเหลว: ${(err as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(727001)');
  } finally {
    await client.end();
  }
  return applied;
}
