import type { Payment, PaymentMethod, Sale, SaleStatus } from '@fuel-pos/shared';
import { Database } from '../db/index.js';
import type { CatalogService } from './catalog.js';

interface SaleRow {
  id: number;
  doc_no: string;
  shift_id: number | null;
  nozzle_id: number;
  pump_id: number;
  product_id: number;
  volume: number;
  unit_price: number;
  amount: number;
  status: SaleStatus;
  started_at: string;
  ended_at: string;
  paid_at: string | null;
  cashier_id: number | null;
  attendant_id: number | null;
  vehicle_plate: string | null;
  customer_id: number | null;
  note: string | null;
  totalizer_start: number;
  totalizer_end: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** สตางค์ */
  amount: number;
  /** เงินที่รับมา (เฉพาะเงินสด) */
  tendered?: number;
  reference?: string;
}

export class SalesService {
  constructor(
    private readonly db: Database,
    private readonly catalog: CatalogService,
  ) {}

  // -- สร้างรายการ ----------------------------------------------------------

  /**
   * บันทึกรายการจ่ายน้ำมันที่เพิ่งจบ เป็นรายการ "รอชำระเงิน"
   * เรียกจาก event ของ PumpManager เมื่อตู้แจ้งว่าจ่ายเสร็จ
   */
  createPending(input: {
    shiftId: number | null;
    nozzleId: number;
    pumpId: number;
    productId: number;
    volume: number;
    unitPrice: number;
    amount: number;
    startedAt: Date;
    endedAt: Date;
    totalizerStart: number;
    totalizerEnd: number;
    attendantId?: number | null;
  }): Sale {
    const docNo = this.nextDocNo(input.endedAt);
    const result = this.db.run(
      `INSERT INTO sales (
         doc_no, shift_id, nozzle_id, pump_id, product_id,
         volume, unit_price, amount, status,
         started_at, ended_at, attendant_id, totalizer_start, totalizer_end
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      docNo,
      input.shiftId,
      input.nozzleId,
      input.pumpId,
      input.productId,
      input.volume,
      input.unitPrice,
      input.amount,
      input.startedAt.toISOString(),
      input.endedAt.toISOString(),
      input.attendantId ?? null,
      input.totalizerStart,
      input.totalizerEnd,
    );
    return this.require(result.lastInsertRowid);
  }

  /**
   * เลขที่เอกสารรูปแบบ YYYYMMDD-NNNN นับใหม่ทุกวัน
   * อ่านเลขล่าสุดของวันแล้ว +1 (ทั้งหมดอยู่ใน transaction ของผู้เรียกเมื่อจำเป็น)
   */
  private nextDocNo(when: Date): string {
    const prefix = [
      when.getFullYear(),
      String(when.getMonth() + 1).padStart(2, '0'),
      String(when.getDate()).padStart(2, '0'),
    ].join('');

    const last = this.db.get<{ doc_no: string }>(
      'SELECT doc_no FROM sales WHERE doc_no LIKE ? ORDER BY doc_no DESC LIMIT 1',
      `${prefix}-%`,
    );
    const sequence = last ? Number(last.doc_no.split('-')[1] ?? 0) + 1 : 1;
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  // -- อ่าน -----------------------------------------------------------------

  get(id: number): Sale | null {
    const row = this.db.get<SaleRow>('SELECT * FROM sales WHERE id = ?', id);
    return row ? SalesService.toSale(row) : null;
  }

  require(id: number): Sale {
    const sale = this.get(id);
    if (!sale) throw new Error(`ไม่พบรายการขาย id ${id}`);
    return sale;
  }

  listPending(): Sale[] {
    return this.db
      .all<SaleRow>("SELECT * FROM sales WHERE status = 'pending' ORDER BY ended_at")
      .map(SalesService.toSale);
  }

  listByShift(shiftId: number): Sale[] {
    return this.db
      .all<SaleRow>('SELECT * FROM sales WHERE shift_id = ? ORDER BY id DESC', shiftId)
      .map(SalesService.toSale);
  }

  listRecent(limit = 100): Sale[] {
    return this.db
      .all<SaleRow>('SELECT * FROM sales ORDER BY id DESC LIMIT ?', limit)
      .map(SalesService.toSale);
  }

  listBetween(fromIso: string, toIso: string): Sale[] {
    return this.db
      .all<SaleRow>(
        'SELECT * FROM sales WHERE ended_at >= ? AND ended_at < ? ORDER BY id',
        fromIso,
        toIso,
      )
      .map(SalesService.toSale);
  }

  payments(saleId: number): Payment[] {
    return this.db
      .all<{
        id: number;
        sale_id: number;
        method: PaymentMethod;
        amount: number;
        tendered: number | null;
        change: number | null;
        reference: string | null;
        created_at: string;
      }>('SELECT * FROM payments WHERE sale_id = ? ORDER BY id', saleId)
      .map((row) => ({
        id: row.id,
        saleId: row.sale_id,
        method: row.method,
        amount: row.amount,
        tendered: row.tendered,
        change: row.change,
        reference: row.reference,
        createdAt: row.created_at,
      }));
  }

  // -- ชำระเงิน -------------------------------------------------------------

  /**
   * รับชำระเงิน — รองรับจ่ายหลายวิธีในรายการเดียว (เช่น เงินสด + คูปอง)
   * ทั้งหมดอยู่ในทรานแซกชันเดียว เพื่อไม่ให้เกิดสถานะครึ่ง ๆ กลาง ๆ
   */
  pay(
    saleId: number,
    payments: PaymentInput[],
    cashierId: number | null,
    extra?: { vehiclePlate?: string; note?: string },
  ): { sale: Sale; change: number } {
    if (payments.length === 0) throw new Error('ต้องระบุวิธีชำระเงินอย่างน้อย 1 รายการ');

    return this.db.transaction(() => {
      const sale = this.require(saleId);
      if (sale.status !== 'pending') {
        throw new Error(`รายการ ${sale.docNo} ไม่ได้อยู่ในสถานะรอชำระ (${sale.status})`);
      }

      const paid = payments.reduce((sum, p) => sum + p.amount, 0);
      if (paid < sale.amount) {
        throw new Error(
          `ยอดชำระ (${paid / 100} บาท) น้อยกว่ายอดที่ต้องชำระ (${sale.amount / 100} บาท)`,
        );
      }

      // เงินทอนคิดจากเงินสดเท่านั้น — วิธีอื่นทอนไม่ได้
      const cash = payments.filter((p) => p.method === 'cash');
      const tendered = cash.reduce((sum, p) => sum + (p.tendered ?? p.amount), 0);
      const nonCash = paid - cash.reduce((sum, p) => sum + p.amount, 0);
      const change = Math.max(0, tendered + nonCash - sale.amount);

      for (const payment of payments) {
        const isCash = payment.method === 'cash';
        this.db.run(
          `INSERT INTO payments (sale_id, method, amount, tendered, change, reference)
           VALUES (?, ?, ?, ?, ?, ?)`,
          saleId,
          payment.method,
          payment.amount,
          isCash ? (payment.tendered ?? payment.amount) : null,
          isCash ? change : null,
          payment.reference ?? null,
        );
      }

      this.db.run(
        `UPDATE sales SET status = 'paid', paid_at = datetime('now'), cashier_id = ?,
                          vehicle_plate = COALESCE(?, vehicle_plate),
                          note = COALESCE(?, note)
         WHERE id = ?`,
        cashierId,
        extra?.vehiclePlate ?? null,
        extra?.note ?? null,
        saleId,
      );

      // ตัดสต็อกถังตามปริมาณที่ขายจริง
      const tankId = this.catalog.nozzleTankId(sale.nozzleId);
      if (tankId !== null) {
        this.catalog.recordTankMovement({
          tankId,
          type: 'sale',
          volume: -sale.volume,
          refId: saleId,
          note: sale.docNo,
        });
      }

      return { sale: this.require(saleId), change };
    });
  }

  /** ยกเลิกรายการ — ต้องระบุเหตุผลเสมอเพื่อการตรวจสอบ */
  voidSale(saleId: number, userId: number, reason: string): Sale {
    if (!reason.trim()) throw new Error('ต้องระบุเหตุผลในการยกเลิกรายการ');

    return this.db.transaction(() => {
      const sale = this.require(saleId);
      if (sale.status === 'void') return sale;

      // คืนสต็อกถ้าเคยตัดไปแล้ว
      if (sale.status === 'paid') {
        const tankId = this.catalog.nozzleTankId(sale.nozzleId);
        if (tankId !== null) {
          this.catalog.recordTankMovement({
            tankId,
            type: 'adjust',
            volume: sale.volume,
            refId: saleId,
            note: `ยกเลิก ${sale.docNo}`,
          });
        }
      }

      this.db.run("UPDATE sales SET status = 'void', note = ? WHERE id = ?", reason, saleId);
      this.db.run(
        'INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)',
        userId,
        'sale.void',
        JSON.stringify({ saleId, docNo: sale.docNo, reason }),
      );
      return this.require(saleId);
    });
  }

  private static toSale(row: SaleRow): Sale {
    return {
      id: row.id,
      docNo: row.doc_no,
      shiftId: row.shift_id,
      nozzleId: row.nozzle_id,
      pumpId: row.pump_id,
      productId: row.product_id,
      volume: row.volume,
      unitPrice: row.unit_price,
      amount: row.amount,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      paidAt: row.paid_at,
      cashierId: row.cashier_id,
      attendantId: row.attendant_id,
      vehiclePlate: row.vehicle_plate,
      customerId: row.customer_id,
      note: row.note,
      totalizerStart: row.totalizer_start,
      totalizerEnd: row.totalizer_end,
    };
  }
}
