import type { Nozzle, Product, Pump, Tank } from '@fuel-pos/shared';
import { Database, fromBool, toBool } from '../db/index.js';

interface ProductRow {
  id: number;
  code: string;
  name: string;
  color: string;
  unit_price: number;
  active: number;
}
interface PumpRow {
  id: number;
  name: string;
  address: number;
  bus_id: string;
  enabled: number;
}
interface NozzleRow {
  id: number;
  pump_id: number;
  idx: number;
  label: string;
  product_id: number;
  tank_id: number | null;
  enabled: number;
}
interface TankRow {
  id: number;
  name: string;
  product_id: number;
  capacity: number;
  book_level: number;
}

/** ข้อมูลตั้งต้นของระบบ: สินค้า ราคา ตู้จ่าย หัวจ่าย ถัง */
export class CatalogService {
  constructor(private readonly db: Database) {}

  // -- สินค้า ---------------------------------------------------------------

  listProducts(includeInactive = false): Product[] {
    const sql = includeInactive
      ? 'SELECT * FROM products ORDER BY code'
      : 'SELECT * FROM products WHERE active = 1 ORDER BY code';
    return this.db.all<ProductRow>(sql).map(CatalogService.toProduct);
  }

  getProduct(id: number): Product | null {
    const row = this.db.get<ProductRow>('SELECT * FROM products WHERE id = ?', id);
    return row ? CatalogService.toProduct(row) : null;
  }

  requireProduct(id: number): Product {
    const product = this.getProduct(id);
    if (!product) throw new Error(`ไม่พบสินค้า id ${id}`);
    return product;
  }

  createProduct(input: Omit<Product, 'id'>): Product {
    const result = this.db.run(
      'INSERT INTO products (code, name, color, unit_price, active) VALUES (?, ?, ?, ?, ?)',
      input.code,
      input.name,
      input.color,
      input.unitPrice,
      fromBool(input.active),
    );
    return this.requireProduct(result.lastInsertRowid);
  }

  updateProduct(id: number, patch: Partial<Omit<Product, 'id'>>): Product {
    const current = this.requireProduct(id);
    const next = { ...current, ...patch };
    this.db.run(
      'UPDATE products SET code = ?, name = ?, color = ?, active = ? WHERE id = ?',
      next.code,
      next.name,
      next.color,
      fromBool(next.active),
      id,
    );
    return this.requireProduct(id);
  }

  /**
   * เปลี่ยนราคา — บันทึกประวัติเสมอเพื่อการตรวจสอบย้อนหลัง
   * (ราคาน้ำมันเป็นข้อมูลที่หน่วยงานกำกับอาจขอตรวจ)
   */
  changePrice(
    productId: number,
    newPrice: number,
    changedBy: number | null,
    note?: string,
  ): Product {
    if (!Number.isInteger(newPrice) || newPrice <= 0) {
      throw new Error('ราคาต้องเป็นจำนวนเต็มบวก (หน่วยสตางค์ต่อลิตร)');
    }
    return this.db.transaction(() => {
      const current = this.requireProduct(productId);
      this.db.run('UPDATE products SET unit_price = ? WHERE id = ?', newPrice, productId);
      this.db.run(
        `INSERT INTO price_changes (product_id, old_price, new_price, changed_by, note)
         VALUES (?, ?, ?, ?, ?)`,
        productId,
        current.unitPrice,
        newPrice,
        changedBy,
        note ?? null,
      );
      return this.requireProduct(productId);
    });
  }

  markPricePushed(productId: number): void {
    this.db.run(
      `UPDATE price_changes SET pushed_to_pumps = 1
       WHERE id = (SELECT id FROM price_changes WHERE product_id = ? ORDER BY id DESC LIMIT 1)`,
      productId,
    );
  }

  priceHistory(productId: number, limit = 50) {
    return this.db.all(
      `SELECT pc.*, u.display_name AS changed_by_name
       FROM price_changes pc
       LEFT JOIN users u ON u.id = pc.changed_by
       WHERE pc.product_id = ?
       ORDER BY pc.id DESC LIMIT ?`,
      productId,
      limit,
    );
  }

  // -- ตู้จ่าย / หัวจ่าย ----------------------------------------------------

  listPumps(): Pump[] {
    return this.db.all<PumpRow>('SELECT * FROM pumps ORDER BY id').map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      busId: row.bus_id,
      profileId: '', // profile กำหนดที่ระดับบัส (ดู config.json)
      enabled: toBool(row.enabled),
    }));
  }

  listNozzles(): Nozzle[] {
    return this.db
      .all<NozzleRow>('SELECT * FROM nozzles ORDER BY pump_id, idx')
      .map(CatalogService.toNozzle);
  }

  getNozzle(id: number): Nozzle | null {
    const row = this.db.get<NozzleRow>('SELECT * FROM nozzles WHERE id = ?', id);
    return row ? CatalogService.toNozzle(row) : null;
  }

  requireNozzle(id: number): Nozzle {
    const nozzle = this.getNozzle(id);
    if (!nozzle) throw new Error(`ไม่พบหัวจ่าย id ${id}`);
    return nozzle;
  }

  nozzleTankId(nozzleId: number): number | null {
    return (
      this.db.get<{ tank_id: number | null }>('SELECT tank_id FROM nozzles WHERE id = ?', nozzleId)
        ?.tank_id ?? null
    );
  }

  createPump(input: { name: string; address: number; busId: string; enabled?: boolean }): Pump {
    const result = this.db.run(
      'INSERT INTO pumps (name, address, bus_id, enabled) VALUES (?, ?, ?, ?)',
      input.name,
      input.address,
      input.busId,
      fromBool(input.enabled ?? true),
    );
    const pump = this.listPumps().find((p) => p.id === result.lastInsertRowid);
    if (!pump) throw new Error('สร้างตู้จ่ายไม่สำเร็จ');
    return pump;
  }

  updatePump(id: number, patch: { name?: string; address?: number; enabled?: boolean }): Pump {
    const current = this.listPumps().find((p) => p.id === id);
    if (!current) throw new Error(`ไม่พบตู้จ่าย id ${id}`);
    this.db.run(
      'UPDATE pumps SET name = ?, address = ?, enabled = ? WHERE id = ?',
      patch.name ?? current.name,
      patch.address ?? current.address,
      fromBool(patch.enabled ?? current.enabled),
      id,
    );
    return this.listPumps().find((p) => p.id === id) as Pump;
  }

  createNozzle(input: {
    pumpId: number;
    index: number;
    label: string;
    productId: number;
    tankId?: number | null;
    enabled?: boolean;
  }): Nozzle {
    const result = this.db.run(
      `INSERT INTO nozzles (pump_id, idx, label, product_id, tank_id, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.pumpId,
      input.index,
      input.label,
      input.productId,
      input.tankId ?? null,
      fromBool(input.enabled ?? true),
    );
    return this.requireNozzle(result.lastInsertRowid);
  }

  updateNozzle(
    id: number,
    patch: { label?: string; productId?: number; tankId?: number | null; enabled?: boolean },
  ): Nozzle {
    const current = this.requireNozzle(id);
    const tankId = patch.tankId === undefined ? this.nozzleTankId(id) : patch.tankId;
    this.db.run(
      'UPDATE nozzles SET label = ?, product_id = ?, tank_id = ?, enabled = ? WHERE id = ?',
      patch.label ?? current.label,
      patch.productId ?? current.productId,
      tankId,
      fromBool(patch.enabled ?? current.enabled),
      id,
    );
    return this.requireNozzle(id);
  }

  // -- ถัง ------------------------------------------------------------------

  listTanks(): Tank[] {
    return this.db.all<TankRow>('SELECT * FROM tanks ORDER BY id').map((row) => ({
      id: row.id,
      name: row.name,
      productId: row.product_id,
      capacity: row.capacity,
      bookLevel: row.book_level,
    }));
  }

  createTank(input: Omit<Tank, 'id'>): Tank {
    const result = this.db.run(
      'INSERT INTO tanks (name, product_id, capacity, book_level) VALUES (?, ?, ?, ?)',
      input.name,
      input.productId,
      input.capacity,
      input.bookLevel,
    );
    return this.listTanks().find((t) => t.id === result.lastInsertRowid) as Tank;
  }

  /** บันทึกการเคลื่อนไหวของถัง และปรับยอดคงเหลือตามบัญชี */
  recordTankMovement(input: {
    tankId: number;
    type: 'delivery' | 'sale' | 'adjust' | 'dip';
    volume: number;
    refId?: number | null;
    note?: string | null;
  }): void {
    this.db.run(
      'INSERT INTO tank_movements (tank_id, type, volume, ref_id, note) VALUES (?, ?, ?, ?, ?)',
      input.tankId,
      input.type,
      input.volume,
      input.refId ?? null,
      input.note ?? null,
    );
    if (input.type === 'dip') {
      // การวัดไม้วัดถังเป็นค่าจริง จึงตั้งยอดใหม่แทนการบวกลบ
      this.db.run('UPDATE tanks SET book_level = ? WHERE id = ?', input.volume, input.tankId);
    } else {
      this.db.run(
        'UPDATE tanks SET book_level = book_level + ? WHERE id = ?',
        input.volume,
        input.tankId,
      );
    }
  }

  // -- ตัวช่วยแปลงแถว -------------------------------------------------------

  private static toProduct(row: ProductRow): Product {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      color: row.color,
      unitPrice: row.unit_price,
      active: toBool(row.active),
    };
  }

  private static toNozzle(row: NozzleRow): Nozzle {
    return {
      id: row.id,
      pumpId: row.pump_id,
      index: row.idx,
      label: row.label,
      productId: row.product_id,
      enabled: toBool(row.enabled),
    };
  }
}
