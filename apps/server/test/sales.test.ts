import assert from 'node:assert/strict';
import { test, describe, beforeEach } from 'node:test';
import { calcAmount } from '@fuel-pos/shared';

import { Database } from '../src/db/index.js';
import { AuthService } from '../src/services/auth.js';
import { CatalogService } from '../src/services/catalog.js';
import { SalesService } from '../src/services/sales.js';
import { ShiftService } from '../src/services/shift.js';

interface Fixture {
  db: Database;
  auth: AuthService;
  catalog: CatalogService;
  sales: SalesService;
  shifts: ShiftService;
  userId: number;
  nozzleId: number;
  pumpId: number;
  productId: number;
  tankId: number;
}

function setup(): Fixture {
  const db = new Database(':memory:');
  const auth = new AuthService(db);
  const catalog = new CatalogService(db);
  const sales = new SalesService(db, catalog);
  const shifts = new ShiftService(db);

  const user = auth.createUser({
    username: 'test',
    displayName: 'ผู้ทดสอบ',
    role: 'admin',
    pin: '1234',
  });
  const product = catalog.createProduct({
    code: 'G95',
    name: 'แก๊สโซฮอล์ 95',
    color: '#f59e0b',
    unitPrice: 3975,
    active: true,
  });
  const tank = catalog.createTank({
    name: 'ถัง 1',
    productId: product.id,
    capacity: 20_000_000,
    bookLevel: 10_000_000,
  });
  const pump = catalog.createPump({ name: 'ตู้ 1', address: 1, busId: 'bus1' });
  const nozzle = catalog.createNozzle({
    pumpId: pump.id,
    index: 1,
    label: '1A',
    productId: product.id,
    tankId: tank.id,
  });

  return {
    db,
    auth,
    catalog,
    sales,
    shifts,
    userId: user.id,
    nozzleId: nozzle.id,
    pumpId: pump.id,
    productId: product.id,
    tankId: tank.id,
  };
}

function makeSale(f: Fixture, volumeMl = 10_000) {
  return f.sales.createPending({
    shiftId: f.shifts.current()?.id ?? null,
    nozzleId: f.nozzleId,
    pumpId: f.pumpId,
    productId: f.productId,
    volume: volumeMl,
    unitPrice: 3975,
    amount: calcAmount(volumeMl, 3975),
    startedAt: new Date(),
    endedAt: new Date(),
    totalizerStart: 1_000_000,
    totalizerEnd: 1_000_000 + volumeMl,
  });
}

describe('การขายและการรับชำระเงิน', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setup();
  });

  test('สร้างรายการรอชำระพร้อมเลขที่เอกสารเรียงตามวัน', () => {
    const first = makeSale(f);
    const second = makeSale(f);
    assert.match(first.docNo, /^\d{8}-0001$/);
    assert.match(second.docNo, /^\d{8}-0002$/);
    assert.equal(first.status, 'pending');
    // 10 ลิตร × 39.75 บาท = 397.50 บาท
    assert.equal(first.amount, 39_750);
  });

  test('รับเงินสดแล้วคำนวณเงินทอนถูกต้อง', () => {
    const sale = makeSale(f);
    const result = f.sales.pay(
      sale.id,
      [{ method: 'cash', amount: sale.amount, tendered: 50_000 }],
      f.userId,
    );
    assert.equal(result.sale.status, 'paid');
    assert.equal(result.change, 50_000 - 39_750);
    assert.equal(f.sales.payments(sale.id).length, 1);
  });

  test('ปฏิเสธเมื่อจ่ายเงินไม่ครบ', () => {
    const sale = makeSale(f);
    assert.throws(
      () => f.sales.pay(sale.id, [{ method: 'cash', amount: 100 }], f.userId),
      /น้อยกว่ายอดที่ต้องชำระ/,
    );
    assert.equal(f.sales.require(sale.id).status, 'pending', 'สถานะต้องไม่เปลี่ยน');
  });

  test('รับชำระหลายวิธีในรายการเดียวได้', () => {
    const sale = makeSale(f);
    const result = f.sales.pay(
      sale.id,
      [
        { method: 'coupon', amount: 20_000 },
        { method: 'cash', amount: 19_750, tendered: 20_000 },
      ],
      f.userId,
    );
    assert.equal(result.sale.status, 'paid');
    assert.equal(result.change, 250);
    assert.equal(f.sales.payments(sale.id).length, 2);
  });

  test('รับเงินซ้ำไม่ได้', () => {
    const sale = makeSale(f);
    f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount }], f.userId);
    assert.throws(
      () => f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount }], f.userId),
      /ไม่ได้อยู่ในสถานะรอชำระ/,
    );
  });

  test('การชำระเงินตัดสต็อกถังตามปริมาณที่ขายจริง', () => {
    const before = f.catalog.listTanks()[0]?.bookLevel ?? 0;
    const sale = makeSale(f, 25_000);
    f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount }], f.userId);
    const after = f.catalog.listTanks()[0]?.bookLevel ?? 0;
    assert.equal(before - after, 25_000);
  });

  test('ยกเลิกรายการที่ชำระแล้วต้องคืนสต็อก และต้องระบุเหตุผล', () => {
    const sale = makeSale(f, 25_000);
    f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount }], f.userId);
    const afterPay = f.catalog.listTanks()[0]?.bookLevel ?? 0;

    assert.throws(() => f.sales.voidSale(sale.id, f.userId, '  '), /ต้องระบุเหตุผล/);

    const voided = f.sales.voidSale(sale.id, f.userId, 'ลูกค้าคืนสินค้า');
    assert.equal(voided.status, 'void');
    assert.equal((f.catalog.listTanks()[0]?.bookLevel ?? 0) - afterPay, 25_000);
  });
});

describe('การจัดการกะ', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setup();
  });

  const readings = (fixture: Fixture, totalizer: number) => [
    {
      nozzleId: fixture.nozzleId,
      pumpId: fixture.pumpId,
      label: '1A',
      productId: fixture.productId,
      status: 'idle' as const,
      volume: 0,
      amount: 0,
      unitPrice: 3975,
      presetMode: 'none' as const,
      presetValue: 0,
      totalizerVolume: totalizer,
      totalizerAmount: 0,
      pendingSaleId: null,
      updatedAt: Date.now(),
      error: null,
    },
  ];

  test('เปิดกะซ้อนกันไม่ได้', () => {
    f.shifts.open({ name: 'กะเช้า', openedBy: f.userId, openingFloat: 200_000, readings: readings(f, 1_000_000) });
    assert.throws(
      () =>
        f.shifts.open({
          name: 'กะบ่าย',
          openedBy: f.userId,
          openingFloat: 0,
          readings: readings(f, 1_000_000),
        }),
      /ยังมีกะที่เปิดค้างอยู่/,
    );
  });

  test('ปิดกะไม่ได้ถ้ายังมีรายการค้างชำระ', () => {
    const shift = f.shifts.open({
      name: 'กะเช้า',
      openedBy: f.userId,
      openingFloat: 200_000,
      readings: readings(f, 1_000_000),
    });
    makeSale(f);
    assert.throws(
      () =>
        f.shifts.close({
          shiftId: shift.id,
          closedBy: f.userId,
          countedCash: 0,
          readings: readings(f, 1_010_000),
        }),
      /ยังมีรายการค้างชำระ/,
    );
  });

  test('สรุปกะคำนวณเงินสดที่ควรมีและผลต่างถูกต้อง', () => {
    const shift = f.shifts.open({
      name: 'กะเช้า',
      openedBy: f.userId,
      openingFloat: 200_000, // 2,000 บาท
      readings: readings(f, 1_000_000),
    });

    const sale = makeSale(f, 10_000); // 397.50 บาท
    f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount, tendered: 40_000 }], f.userId);

    const summary = f.shifts.summary(shift.id);
    assert.equal(summary.totals.soldVolume, 10_000);
    assert.equal(summary.totals.soldAmount, 39_750);
    // เงินสดที่ควรมี = เงินทอนตั้งต้น + ยอดขายเงินสด
    assert.equal(summary.totals.expectedCash, 200_000 + 39_750);

    const closed = f.shifts.close({
      shiftId: shift.id,
      closedBy: f.userId,
      countedCash: 239_000, // นับได้น้อยกว่าที่ควรมี 7.50 บาท
      readings: readings(f, 1_010_000),
    });
    assert.equal(closed.status, 'closed');

    const final = f.shifts.summary(shift.id);
    assert.equal(final.totals.cashVariance, 239_000 - 239_750);
    assert.equal(final.nozzles[0]?.meterVolume, 10_000);
    assert.equal(final.nozzles[0]?.varianceVolume, 0, 'มิเตอร์ต้องตรงกับยอดขายที่บันทึก');
  });

  test('ผลต่างมิเตอร์จับการจ่ายที่ไม่ได้บันทึกได้', () => {
    const shift = f.shifts.open({
      name: 'กะเช้า',
      openedBy: f.userId,
      openingFloat: 0,
      readings: readings(f, 1_000_000),
    });
    const sale = makeSale(f, 10_000);
    f.sales.pay(sale.id, [{ method: 'cash', amount: sale.amount }], f.userId);

    // มิเตอร์เดินไป 15 ลิตร แต่ระบบบันทึกขายแค่ 10 ลิตร
    f.shifts.close({
      shiftId: shift.id,
      closedBy: f.userId,
      countedCash: 39_750,
      readings: readings(f, 1_015_000),
    });

    const summary = f.shifts.summary(shift.id);
    assert.equal(summary.nozzles[0]?.varianceVolume, 5000, 'ต้องพบส่วนต่าง 5 ลิตร');
  });
});

describe('ผู้ใช้และการเข้าสู่ระบบ', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setup();
  });

  test('เข้าสู่ระบบด้วย PIN ถูกต้องแล้วได้ token ใช้งานได้', () => {
    const { token, user } = f.auth.login('test', '1234');
    assert.equal(user.username, 'test');
    assert.equal(f.auth.resolveToken(token)?.id, user.id);
  });

  test('PIN ผิดต้องไม่บอกว่าผิดที่ชื่อผู้ใช้หรือ PIN', () => {
    assert.throws(() => f.auth.login('test', '9999'), /ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง/);
    assert.throws(() => f.auth.login('ไม่มีคนนี้', '1234'), /ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง/);
  });

  test('เปลี่ยน PIN แล้ว token เดิมใช้ไม่ได้', () => {
    const { token } = f.auth.login('test', '1234');
    f.auth.changePin(f.userId, '5678');
    assert.equal(f.auth.resolveToken(token), null);
    assert.ok(f.auth.login('test', '5678').token);
  });

  test('ปิดการใช้งานผู้ใช้แล้วเข้าระบบไม่ได้', () => {
    f.auth.setActive(f.userId, false);
    assert.throws(() => f.auth.login('test', '1234'), /ไม่ถูกต้อง/);
  });

  test('PIN ต้องเป็นตัวเลข 4-8 หลัก', () => {
    assert.throws(
      () => f.auth.createUser({ username: 'x', displayName: 'x', role: 'cashier', pin: '12' }),
      /4-8 หลัก/,
    );
  });
});

describe('ราคาสินค้า', () => {
  let f: Fixture;
  beforeEach(() => {
    f = setup();
  });

  test('เปลี่ยนราคาแล้วบันทึกประวัติทุกครั้ง', () => {
    f.catalog.changePrice(f.productId, 4050, f.userId, 'ปรับตามราคาหน้าปั๊ม');
    f.catalog.changePrice(f.productId, 4100, f.userId);

    assert.equal(f.catalog.requireProduct(f.productId).unitPrice, 4100);
    const history = f.catalog.priceHistory(f.productId) as { old_price: number; new_price: number }[];
    assert.equal(history.length, 2);
    assert.equal(history[0]?.old_price, 4050);
    assert.equal(history[0]?.new_price, 4100);
  });

  test('ปฏิเสธราคาที่ไม่ถูกต้อง', () => {
    assert.throws(() => f.catalog.changePrice(f.productId, 0, f.userId), /จำนวนเต็มบวก/);
    assert.throws(() => f.catalog.changePrice(f.productId, -100, f.userId), /จำนวนเต็มบวก/);
  });
});
