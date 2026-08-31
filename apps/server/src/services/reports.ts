import { Database } from '../db/index.js';

export interface DailyTotals {
  date: string;
  saleCount: number;
  volume: number;
  amount: number;
}

export interface ProductBreakdown {
  productId: number;
  code: string;
  name: string;
  color: string;
  saleCount: number;
  volume: number;
  amount: number;
}

export interface NozzleBreakdown {
  nozzleId: number;
  label: string;
  pumpName: string;
  productName: string;
  saleCount: number;
  volume: number;
  amount: number;
}

export interface MethodBreakdown {
  method: string;
  count: number;
  amount: number;
}

/**
 * รายงานยอดขาย
 *
 * ทุกช่วงเวลาใช้ ended_at (เวลาที่จ่ายน้ำมันเสร็จ) เป็นเกณฑ์ ไม่ใช่เวลาชำระเงิน
 * เพื่อให้ยอดขายตรงกับปริมาณน้ำมันที่ออกจากถังในวันนั้นจริง ๆ
 */
export class ReportService {
  constructor(private readonly db: Database) {}

  /** ยอดรวมรายวันย้อนหลัง n วัน */
  daily(days = 30): DailyTotals[] {
    return this.db.all<DailyTotals>(
      `SELECT date(ended_at) AS date,
              COUNT(*)       AS saleCount,
              SUM(volume)    AS volume,
              SUM(amount)    AS amount
       FROM sales
       WHERE status != 'void' AND ended_at >= date('now', ?)
       GROUP BY date(ended_at)
       ORDER BY date DESC`,
      `-${days} days`,
    );
  }

  byProduct(fromIso: string, toIso: string): ProductBreakdown[] {
    return this.db.all<ProductBreakdown>(
      `SELECT p.id AS productId, p.code, p.name, p.color,
              COUNT(*)    AS saleCount,
              SUM(s.volume) AS volume,
              SUM(s.amount) AS amount
       FROM sales s
       JOIN products p ON p.id = s.product_id
       WHERE s.status != 'void' AND s.ended_at >= ? AND s.ended_at < ?
       GROUP BY p.id
       ORDER BY amount DESC`,
      fromIso,
      toIso,
    );
  }

  byNozzle(fromIso: string, toIso: string): NozzleBreakdown[] {
    return this.db.all<NozzleBreakdown>(
      `SELECT n.id AS nozzleId, n.label, pu.name AS pumpName, pr.name AS productName,
              COUNT(*)      AS saleCount,
              SUM(s.volume) AS volume,
              SUM(s.amount) AS amount
       FROM sales s
       JOIN nozzles n  ON n.id = s.nozzle_id
       JOIN pumps pu   ON pu.id = n.pump_id
       JOIN products pr ON pr.id = n.product_id
       WHERE s.status != 'void' AND s.ended_at >= ? AND s.ended_at < ?
       GROUP BY n.id
       ORDER BY pu.id, n.idx`,
      fromIso,
      toIso,
    );
  }

  byPaymentMethod(fromIso: string, toIso: string): MethodBreakdown[] {
    return this.db.all<MethodBreakdown>(
      `SELECT pm.method, COUNT(*) AS count, SUM(pm.amount) AS amount
       FROM payments pm
       JOIN sales s ON s.id = pm.sale_id
       WHERE s.status = 'paid' AND s.ended_at >= ? AND s.ended_at < ?
       GROUP BY pm.method
       ORDER BY amount DESC`,
      fromIso,
      toIso,
    );
  }

  /** ภาพรวมสำหรับหน้าแรก: ยอดวันนี้ + รายการค้างชำระ */
  dashboard(): {
    today: { saleCount: number; volume: number; amount: number };
    pending: { count: number; amount: number };
    byProductToday: ProductBreakdown[];
  } {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const from = startOfDay.toISOString();
    const to = new Date(startOfDay.getTime() + 86_400_000).toISOString();

    const today = this.db.get<{ saleCount: number; volume: number | null; amount: number | null }>(
      `SELECT COUNT(*) AS saleCount, SUM(volume) AS volume, SUM(amount) AS amount
       FROM sales WHERE status != 'void' AND ended_at >= ? AND ended_at < ?`,
      from,
      to,
    );

    const pending = this.db.get<{ count: number; amount: number | null }>(
      "SELECT COUNT(*) AS count, SUM(amount) AS amount FROM sales WHERE status = 'pending'",
    );

    return {
      today: {
        saleCount: today?.saleCount ?? 0,
        volume: today?.volume ?? 0,
        amount: today?.amount ?? 0,
      },
      pending: { count: pending?.count ?? 0, amount: pending?.amount ?? 0 },
      byProductToday: this.byProduct(from, to),
    };
  }

  /** ผลต่างมิเตอร์รายหัวจ่ายในช่วงเวลา — ใช้ตรวจการจ่ายที่ไม่ได้บันทึก */
  meterReconciliation(fromIso: string, toIso: string) {
    return this.db.all<{
      nozzleId: number;
      label: string;
      firstTotalizer: number;
      lastTotalizer: number;
      meterVolume: number;
      soldVolume: number;
      variance: number;
    }>(
      `SELECT n.id AS nozzleId, n.label,
              MIN(s.totalizer_start) AS firstTotalizer,
              MAX(s.totalizer_end)   AS lastTotalizer,
              MAX(s.totalizer_end) - MIN(s.totalizer_start) AS meterVolume,
              SUM(s.volume) AS soldVolume,
              (MAX(s.totalizer_end) - MIN(s.totalizer_start)) - SUM(s.volume) AS variance
       FROM sales s
       JOIN nozzles n ON n.id = s.nozzle_id
       WHERE s.status != 'void' AND s.ended_at >= ? AND s.ended_at < ?
       GROUP BY n.id
       ORDER BY n.id`,
      fromIso,
      toIso,
    );
  }
}
