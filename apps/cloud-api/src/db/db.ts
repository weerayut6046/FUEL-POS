import pg from 'pg';

/**
 * ชั้นเชื่อมต่อฐานข้อมูล
 *
 * ทุกคำสั่งที่แตะข้อมูลลูกค้าต้องผ่าน withTenant() ซึ่งเปิด transaction แล้วตั้ง
 * app.tenant_id / app.user_id แบบ LOCAL (หมดอายุเมื่อจบ transaction)
 * นโยบาย RLS ในฐานข้อมูลจะกรองให้เห็นเฉพาะข้อมูลของลูกค้ารายนั้น — ต่อให้โค้ดลืมใส่
 * WHERE tenant_id ก็ไม่รั่ว และ connection ที่คืนเข้า pool จะไม่ติดค่าลูกค้าค้างไว้
 */

// BIGINT (สตางค์) → number: ยอดเงินในระบบไม่มีทางเกิน 2^53 สตางค์
pg.types.setTypeParser(20, (v: string) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`ค่าเกินช่วงที่ปลอดภัย: ${v}`);
  return n;
});
// DATE → สตริง YYYY-MM-DD (ไม่แปลงเป็น Date เพื่อไม่ให้เขตเวลาเลื่อนวัน)
pg.types.setTypeParser(1082, (v: string) => v);
// NUMERIC คงเป็นสตริง (ค่าเริ่มต้นของ pg) — แปลงเป็นมิลลิลิตรด้วย units.ts

export type Tx = pg.PoolClient;

export interface TenantScope {
  tenantId: string;
  userId: string | null;
}

export class Db {
  readonly pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max });
  }

  /** คำสั่งที่ไม่ผูกกับลูกค้า — ใช้เรียกฟังก์ชัน SECURITY DEFINER เท่านั้น */
  async query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)",
        [scope.tenantId, scope.userId ?? ''],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function many<T extends pg.QueryResultRow>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await tx.query<T>(sql, params)).rows;
}

export async function maybeOne<T extends pg.QueryResultRow>(
  tx: Tx,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = (await tx.query<T>(sql, params)).rows;
  return rows[0] ?? null;
}

export async function one<T extends pg.QueryResultRow>(tx: Tx, sql: string, params: unknown[] = []): Promise<T> {
  const row = await maybeOne<T>(tx, sql, params);
  if (!row) throw new Error('คาดว่าจะได้ข้อมูล 1 แถวแต่ไม่พบ');
  return row;
}
