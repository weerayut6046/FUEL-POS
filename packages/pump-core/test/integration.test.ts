import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import type { ProtocolProfile } from '@fuel-pos/shared';

import { Bus } from '../src/bus/Bus.js';
import { LoopbackTransport } from '../src/transport/LoopbackTransport.js';
import { ProfileDriver } from '../src/protocol/ProfileDriver.js';
import { SimulatedDevice } from '../src/sim/SimulatedDevice.js';
import { PumpManager, type CompletedFuelling } from '../src/PumpManager.js';
import { loadTemplateProfile, sleep } from './helpers.js';

let profile: ProtocolProfile;

before(async () => {
  profile = await loadTemplateProfile();
});

/**
 * ทดสอบทั้ง stack: ProfileDriver → Bus → Framer → LoopbackTransport → ตู้จำลอง
 * ผ่านโปรโตคอลจริงทุกไบต์ (ไม่ได้ลัดผ่านชั้นใดเลย)
 */
describe('ต่อกันครบวงจร: ไดรเวอร์ ↔ ตู้จำลองที่พูดโปรโตคอลจริง', () => {
  let transport: LoopbackTransport;
  let bus: Bus;
  let device: SimulatedDevice;
  let driver: ProfileDriver;

  before(async () => {
    transport = new LoopbackTransport('test-bus', 1);
    bus = new Bus(transport, profile.framing, 2);
    device = new SimulatedDevice(
      profile,
      [
        { address: 1, nozzleCount: 2, initialPrice: 3975 },
        { address: 2, nozzleCount: 2, initialPrice: 3120 },
      ],
      transport,
      20,
    );
    driver = new ProfileDriver(bus, profile);
    await bus.open();
  });

  after(async () => {
    device.dispose();
    await bus.close();
  });

  test('อ่านสถานะตู้ที่ว่างอยู่ได้ทั้งสองหัวจ่าย', async () => {
    const readings = await driver.poll(1);
    assert.equal(readings.length, 2);
    assert.equal(readings[0]?.status, 'idle');
    assert.equal(readings[0]?.unitPrice, 3975);
    assert.equal(readings[1]?.nozzle, 2);
  });

  test('ตู้แต่ละ address ตอบข้อมูลของตัวเอง ไม่ปนกันบนบัสเดียว', async () => {
    const [pump1, pump2] = await Promise.all([driver.poll(1), driver.poll(2)]);
    assert.equal(pump1[0]?.unitPrice, 3975);
    assert.equal(pump2[0]?.unitPrice, 3120);
  });

  test('ไม่มีคำตอบจาก address ที่ไม่มีตู้อยู่', async () => {
    await assert.rejects(() => driver.poll(9), /ไม่ได้รับคำตอบ/);
  });

  test('สั่งจ่ายแบบกำหนดยอดเงินแล้วตู้หยุดเองเมื่อครบ', async () => {
    const pump = device.pump(1);
    assert.ok(pump);

    // ตั้ง 200.00 บาท ที่ราคา 39.75 บาท/ลิตร → ควรได้ ~5.031 ลิตร
    await driver.authorize(1, 1, { mode: 'amount', value: 20_000 });
    pump.liftNozzle(1);
    pump.setTrigger(1, true);

    // เดินเวลาจำลอง 20 วินาที (ที่ 750 มล./วินาที เกินยอดที่ตั้งไว้แน่นอน)
    for (let i = 0; i < 200; i++) device.tick(100);

    const readings = await driver.poll(1);
    const nozzle1 = readings.find((r) => r.nozzle === 1);
    assert.ok(nozzle1);
    assert.equal(nozzle1.status, 'complete');
    assert.equal(nozzle1.amount, 20_000, 'ยอดเงินต้องหยุดตรงที่ตั้งไว้พอดี');
    // 20000 สตางค์ ÷ 3975 สตางค์/ลิตร × 1000 = 5031.4 มล.
    // โปรไฟล์ส่งปริมาตรทศนิยม 2 ตำแหน่ง (ละเอียด 0.01 ลิตร = 10 มล.) จึงยอมคลาดได้ 1 ขั้น
    assert.ok(Math.abs(nozzle1.volume - 5031) <= 10, `ได้ปริมาตร ${nozzle1.volume} มล.`);
  });

  test('เคลียร์รายการแล้วหัวจ่ายกลับมาพร้อมใช้งาน', async () => {
    const pump = device.pump(1);
    assert.ok(pump);
    pump.hangNozzle(1);
    await driver.clear(1, 1);

    const readings = await driver.poll(1);
    const nozzle1 = readings.find((r) => r.nozzle === 1);
    assert.equal(nozzle1?.status, 'idle');
    assert.equal(nozzle1?.volume, 0);
  });

  test('ตั้งราคาใหม่แล้วตู้รับค่าไปใช้จริง', async () => {
    await driver.setPrice(1, 2, 4210);
    const readings = await driver.poll(1);
    assert.equal(readings.find((r) => r.nozzle === 2)?.unitPrice, 4210);
  });

  test('มิเตอร์สะสมเดินขึ้นตามปริมาณที่จ่ายจริง', async () => {
    const pump = device.pump(2);
    assert.ok(pump);
    const before = await driver.readTotalizer(2, 1);

    await driver.authorize(2, 1, { mode: 'volume', value: 10_000 }); // 10 ลิตร
    pump.liftNozzle(1);
    pump.setTrigger(1, true);
    for (let i = 0; i < 250; i++) device.tick(100);

    const after = await driver.readTotalizer(2, 1);
    assert.ok(before && after);
    assert.equal(after.volume - before.volume, 10_000);
  });
});

describe('PumpManager จับจังหวะรายการจ่ายจบ', () => {
  let transport: LoopbackTransport;
  let bus: Bus;
  let device: SimulatedDevice;
  let manager: PumpManager;

  before(async () => {
    transport = new LoopbackTransport('mgr-bus', 1);
    bus = new Bus(transport, profile.framing, 2);
    device = new SimulatedDevice(profile, [{ address: 1, nozzleCount: 2 }], transport, 20);
    const driver = new ProfileDriver(bus, profile);
    await bus.open();

    manager = new PumpManager({
      pumps: [
        {
          pumpId: 1,
          name: 'ตู้ 1',
          address: 1,
          busId: 'mgr-bus',
          enabled: true,
          nozzles: [
            { nozzleId: 11, index: 1, label: '1A', productId: 1, enabled: true },
            { nozzleId: 12, index: 2, label: '1B', productId: 2, enabled: true },
          ],
        },
      ],
      drivers: new Map([['mgr-bus', driver]]),
      pollIntervalMs: 30,
    });
    manager.start();
    await sleep(150);
  });

  after(async () => {
    manager.stop();
    device.dispose();
    await bus.close();
  });

  test('เห็นสถานะสดของทุกหัวจ่ายหลังเริ่ม poll', () => {
    const snapshot = manager.snapshot();
    assert.equal(snapshot.length, 2);
    assert.equal(snapshot[0]?.status, 'idle');
    assert.equal(manager.isPumpOnline(1), true);
  });

  test('ยิง event รายการจ่ายจบเพียงครั้งเดียว พร้อมค่ามิเตอร์ก่อน-หลัง', async () => {
    const events: CompletedFuelling[] = [];
    manager.on('transaction', (e) => events.push(e));

    await manager.authorize(11, 'volume', 5000); // 5 ลิตร
    const pump = device.pump(1);
    assert.ok(pump);
    pump.liftNozzle(1);
    pump.setTrigger(1, true);

    for (let i = 0; i < 120; i++) device.tick(100);
    await sleep(250); // รอให้ manager poll เห็นสถานะ complete

    assert.equal(events.length, 1, `ต้องได้ 1 รายการ (ได้ ${events.length})`);
    const sale = events[0];
    assert.ok(sale);
    assert.equal(sale.nozzleId, 11);
    assert.equal(sale.volume, 5000);
    assert.equal(sale.totalizerEnd - sale.totalizerStart, 5000);

    // poll ต่ออีกหลายรอบต้องไม่ยิงซ้ำ
    await sleep(200);
    assert.equal(events.length, 1, 'ต้องไม่ยิง event ซ้ำระหว่างรอชำระเงิน');
  });

  test('ปฏิเสธการสั่งจ่ายซ้ำเมื่อยังมีรายการค้างชำระ', async () => {
    manager.attachSale(11, 999);
    await assert.rejects(() => manager.authorize(11, 'amount', 10_000), /ค้างชำระ/);
  });

  test('ปลดล็อกหัวจ่ายหลังชำระเงินแล้วสั่งจ่ายใหม่ได้', async () => {
    const pump = device.pump(1);
    assert.ok(pump);
    pump.hangNozzle(1);

    await manager.release(11);
    await sleep(120);

    assert.equal(manager.getNozzle(11)?.pendingSaleId, null);
    await manager.authorize(11, 'amount', 10_000);
    assert.equal(manager.getNozzle(11)?.status, 'authorized');
  });
});
