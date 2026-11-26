import { z } from 'zod';

import { LITRES_PATTERN, MM_PATTERN } from './units.js';

/** ตรวจ body/query ด้วย zod — ถ้าไม่ผ่านจะโยน ZodError ซึ่ง filter แปลงเป็น 400 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

export const uuid = z.guid({ message: 'ต้องเป็น UUID' });
export const isoDate = z.iso.date({ message: 'วันที่ต้องอยู่ในรูป YYYY-MM-DD' });
export const isoDateTime = z.iso.datetime({ offset: true, message: 'เวลาต้องอยู่ในรูป ISO 8601' });
export const litres = z.string().regex(LITRES_PATTERN, 'ลิตรต้องเป็นตัวเลขทศนิยมไม่เกิน 3 ตำแหน่ง');
export const mm = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .pipe(z.string().regex(MM_PATTERN, 'ระดับ (มม.) ต้องเป็นตัวเลขทศนิยมไม่เกิน 1 ตำแหน่ง'));
export const satang = z.number().int('ยอดเงินต้องเป็นจำนวนเต็มสตางค์').min(0).max(1e13);
export const text = (max = 500) => z.string().trim().max(max);

/** ช่วงวันที่สำหรับรายงาน */
export const dateRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: 'วันเริ่มต้องไม่เกินวันสิ้นสุด' });

/** ฟิลด์ร่วมของรายการแก้ไขตัวเลข */
export const correctionFields = {
  supersedesId: uuid.nullish(),
  reason: text(500).nullish(),
  deviceAt: isoDateTime.nullish(),
};
