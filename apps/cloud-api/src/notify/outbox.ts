import type { Tx } from '../db/db.js';

/**
 * ใส่ข้อความแจ้งเตือนลงกล่องขาออก ใน transaction เดียวกับเหตุการณ์ที่เกิด
 * — ถ้าบันทึกเหตุการณ์ไม่สำเร็จ ข้อความก็ไม่ถูกส่ง และถ้า LINE ล่มข้อความยังรอส่งอยู่
 * dedupeKey กันส่งซ้ำ (เช่น เตือนถังใกล้หมดวันละครั้งต่อถัง)
 */
export async function enqueueNotification(
  tx: Tx,
  tenantId: string,
  dedupeKey: string,
  kind: string,
  message: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (tenant_id, dedupe_key, kind, message)
     VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
    [tenantId, dedupeKey, kind, message.slice(0, 4900)],
  );
}

/** วันที่แบบไทยสั้น: 2026-11-26 → 26/11/2026 */
export function thaiDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
