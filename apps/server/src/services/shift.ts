import type { NozzleLiveState, Shift, ShiftStatus } from '@fuel-pos/shared';
import { Database } from '../db/index.js';

interface ShiftRow {
  id: number;
  name: string;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  opened_by: number;
  closed_by: number | null;
  opening_float: number;
  counted_cash: number | null;
  note: string | null;
}

export interface ShiftNozzleSummary {
  nozzleId: number;
  label: string;
  productName: string;
  /** มิเตอร์เปิด/ปิดกะ (มิลลิลิตร) */
  openVolume: number;
  closeVolume: number | null;
  /** ปริมาตรตามมิเตอร์ (ปิด - เปิด) */
  meterVolume: number | null;
  /** ปริมาตรที่บันทึกขายจริงในระบบ */
  soldVolume: number;
  /** ผลต่าง: มิเตอร์ - ที่บันทึกขาย (ควรใกล้ 0) */
  varianceVolume: number | null;
  soldAmount: number;
}

export interface ShiftSummary {
  shift: Shift;
  nozzles: ShiftNozzleSummary[];
  totals: {
    soldVolume: number;
    soldAmount: number;
    /** ยอดตามวิธีชำระเงิน */
    byMethod: { method: string; amount: number; count: number }[];
    pendingCount: number;
    pendingAmount: number;
    /** เงินสดที่ควรมีในลิ้นชัก = เงินทอนตั้งต้น + ขายเงินสด - ทอน */
    expectedCash: number;
    countedCash: number | null;
    cashVariance: number | null;
  };
}

export class ShiftService {
  constructor(private readonly db: Database) {}

  current(): Shift | null {
    const row = this.db.get<ShiftRow>("SELECT * FROM shifts WHERE status = 'open' LIMIT 1");
    return row ? ShiftService.toShift(row) : null;
  }

  get(id: number): Shift | null {
    const row = this.db.get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', id);
    return row ? ShiftService.toShift(row) : null;
  }

  list(limit = 50): Shift[] {
    return this.db
      .all<ShiftRow>('SELECT * FROM shifts ORDER BY id DESC LIMIT ?', limit)
      .map(ShiftService.toShift);
  }

  /**
   * เปิดกะ — บันทึกค่ามิเตอร์ของทุกหัวจ่าย ณ ขณะนั้นไว้กระทบยอดตอนปิดกะ
   * ระบบอนุญาตให้เปิดได้ครั้งละ 1 กะเท่านั้น
   */
  open(input: {
    name: string;
    openedBy: number;
    openingFloat: number;
    readings: NozzleLiveState[];
  }): Shift {
    return this.db.transaction(() => {
      if (this.current()) {
        throw new Error('ยังมีกะที่เปิดค้างอยู่ ต้องปิดกะเดิมก่อน');
      }
      const result = this.db.run(
        'INSERT INTO shifts (name, status, opened_by, opening_float) VALUES (?, ?, ?, ?)',
        input.name,
        'open',
        input.openedBy,
        input.openingFloat,
      );
      const shiftId = result.lastInsertRowid;

      for (const reading of input.readings) {
        this.db.run(
          `INSERT INTO shift_readings (shift_id, nozzle_id, open_volume, open_amount)
           VALUES (?, ?, ?, ?)`,
          shiftId,
          reading.nozzleId,
          reading.totalizerVolume,
          reading.totalizerAmount,
        );
      }

      // ผูกรายการที่ยังค้างชำระเข้ากับกะใหม่
      this.db.run("UPDATE sales SET shift_id = ? WHERE status = 'pending' AND shift_id IS NULL", shiftId);

      return this.get(shiftId) as Shift;
    });
  }

  /** ปิดกะ — ต้องไม่มีรายการค้างชำระเหลืออยู่ */
  close(input: {
    shiftId: number;
    closedBy: number;
    countedCash: number;
    readings: NozzleLiveState[];
    note?: string;
    /** ปิดทั้งที่ยังมีรายการค้าง (ต้องเป็นผู้จัดการ และระบุเหตุผล) */
    force?: boolean;
  }): Shift {
    return this.db.transaction(() => {
      const shift = this.get(input.shiftId);
      if (!shift) throw new Error(`ไม่พบกะ id ${input.shiftId}`);
      if (shift.status === 'closed') throw new Error('กะนี้ปิดไปแล้ว');

      const pending = this.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sales WHERE shift_id = ? AND status = 'pending'",
        input.shiftId,
      );
      if ((pending?.n ?? 0) > 0 && !input.force) {
        throw new Error(`ยังมีรายการค้างชำระ ${pending?.n} รายการ ต้องเคลียร์ให้หมดก่อนปิดกะ`);
      }

      for (const reading of input.readings) {
        this.db.run(
          `UPDATE shift_readings SET close_volume = ?, close_amount = ?
           WHERE shift_id = ? AND nozzle_id = ?`,
          reading.totalizerVolume,
          reading.totalizerAmount,
          input.shiftId,
          reading.nozzleId,
        );
      }

      this.db.run(
        `UPDATE shifts SET status = 'closed', closed_at = datetime('now'),
                           closed_by = ?, counted_cash = ?, note = ?
         WHERE id = ?`,
        input.closedBy,
        input.countedCash,
        input.note ?? null,
        input.shiftId,
      );

      return this.get(input.shiftId) as Shift;
    });
  }

  /**
   * สรุปกะ — ตัวเลขสำคัญคือ "ผลต่างมิเตอร์" ระหว่างปริมาตรที่มิเตอร์ตู้เดินไป
   * กับปริมาตรที่ระบบบันทึกขาย ถ้าต่างกันมากแปลว่ามีการจ่ายที่ไม่ได้บันทึก
   */
  summary(shiftId: number): ShiftSummary {
    const shift = this.get(shiftId);
    if (!shift) throw new Error(`ไม่พบกะ id ${shiftId}`);

    const nozzles = this.db.all<{
      nozzle_id: number;
      label: string;
      product_name: string;
      open_volume: number;
      close_volume: number | null;
      sold_volume: number | null;
      sold_amount: number | null;
    }>(
      `SELECT r.nozzle_id, n.label, p.name AS product_name,
              r.open_volume, r.close_volume,
              (SELECT SUM(s.volume) FROM sales s
                WHERE s.shift_id = r.shift_id AND s.nozzle_id = r.nozzle_id
                  AND s.status != 'void') AS sold_volume,
              (SELECT SUM(s.amount) FROM sales s
                WHERE s.shift_id = r.shift_id AND s.nozzle_id = r.nozzle_id
                  AND s.status != 'void') AS sold_amount
       FROM shift_readings r
       JOIN nozzles n ON n.id = r.nozzle_id
       JOIN products p ON p.id = n.product_id
       WHERE r.shift_id = ?
       ORDER BY n.pump_id, n.idx`,
      shiftId,
    );

    const nozzleSummaries: ShiftNozzleSummary[] = nozzles.map((row) => {
      const soldVolume = row.sold_volume ?? 0;
      const meterVolume = row.close_volume === null ? null : row.close_volume - row.open_volume;
      return {
        nozzleId: row.nozzle_id,
        label: row.label,
        productName: row.product_name,
        openVolume: row.open_volume,
        closeVolume: row.close_volume,
        meterVolume,
        soldVolume,
        varianceVolume: meterVolume === null ? null : meterVolume - soldVolume,
        soldAmount: row.sold_amount ?? 0,
      };
    });

    const byMethod = this.db.all<{ method: string; amount: number; count: number }>(
      `SELECT pm.method, SUM(pm.amount) AS amount, COUNT(*) AS count
       FROM payments pm
       JOIN sales s ON s.id = pm.sale_id
       WHERE s.shift_id = ? AND s.status = 'paid'
       GROUP BY pm.method`,
      shiftId,
    );

    const pending = this.db.get<{ n: number; total: number | null }>(
      "SELECT COUNT(*) AS n, SUM(amount) AS total FROM sales WHERE shift_id = ? AND status = 'pending'",
      shiftId,
    );

    const cashRow = this.db.get<{ amount: number | null; change: number | null }>(
      `SELECT SUM(pm.amount) AS amount, SUM(COALESCE(pm.change, 0)) AS change
       FROM payments pm
       JOIN sales s ON s.id = pm.sale_id
       WHERE s.shift_id = ? AND s.status = 'paid' AND pm.method = 'cash'`,
      shiftId,
    );

    const cashSales = cashRow?.amount ?? 0;
    const expectedCash = shift.openingFloat + cashSales;

    return {
      shift,
      nozzles: nozzleSummaries,
      totals: {
        soldVolume: nozzleSummaries.reduce((sum, n) => sum + n.soldVolume, 0),
        soldAmount: nozzleSummaries.reduce((sum, n) => sum + n.soldAmount, 0),
        byMethod,
        pendingCount: pending?.n ?? 0,
        pendingAmount: pending?.total ?? 0,
        expectedCash,
        countedCash: shift.countedCash,
        cashVariance: shift.countedCash === null ? null : shift.countedCash - expectedCash,
      },
    };
  }

  private static toShift(row: ShiftRow): Shift {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openedBy: row.opened_by,
      closedBy: row.closed_by,
      openingFloat: row.opening_float,
      countedCash: row.counted_cash,
      note: row.note,
    };
  }
}
