/**
 * สร้างลูกค้าเดโม "demo" พร้อมข้อมูลย้อนหลัง 14 วัน — ใช้สาธิตให้ปั๊มอื่นดู และใช้ตอนพัฒนาแอป
 *
 *   npm run seed:demo -w @fuel-pos/cloud-api
 *
 * เข้าสู่ระบบ: รหัสปั๊ม demo · owner / manager / somchai / somsri · รหัสผ่าน 1234
 * ข้อมูลไหลผ่าน API จริงทุกขั้น (เปิดกะ จดมิเตอร์ ส่งเงิน ปิดกะ วัดถัง รับน้ำมัน)
 */
import { randomUUID } from 'node:crypto';

import { createApp } from '../src/app.js';
import { amountSatang } from '../src/common/units.js';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db/db.js';
import { createTenant } from '../src/tenants/provisioning.js';

const SLUG = process.env.DEMO_SLUG ?? 'demo';
const DAYS = Number(process.env.DEMO_DAYS ?? '14');

/** ตัวเลขสุ่มแบบกำหนดผลได้ (ได้ข้อมูลเดิมทุกครั้ง) */
let seed = 20261126;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};

/** ตารางแปลงของถังทรงกระบอกนอน (เส้นผ่านศูนย์กลาง D มม. ความจุ litres) */
function cylinderCalibration(diameterMm: number, capacityLitres: number) {
  const r = diameterMm / 2;
  const length = (capacityLitres * 1e6) / (Math.PI * r * r);
  const points: { mm: string; litres: string }[] = [];
  for (let h = 0; h <= diameterMm; h += 50) {
    const area = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, 2 * r * h - h * h));
    points.push({ mm: h.toFixed(1), litres: ((area * length) / 1e6).toFixed(3) });
  }
  return points;
}

/** ระดับ (มม.) ที่ได้ปริมาตรใกล้ litres ที่สุด — ใช้จำลองการวัดถัง */
function levelFor(points: { mm: string; litres: string }[], litres: number): string {
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    if (Number(hi.litres) >= litres) {
      const f = (litres - Number(lo.litres)) / (Number(hi.litres) - Number(lo.litres));
      return (Number(lo.mm) + f * (Number(hi.mm) - Number(lo.mm))).toFixed(1);
    }
  }
  return points.at(-1)!.mm;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const config = { ...loadConfig(), notifyIntervalMs: 0 };
  const db = new Db(config.databaseUrl, 4);
  const app = await createApp(config, { db });
  const http = app.getHttpAdapter().getInstance();
  const call = async (method: 'GET' | 'POST' | 'PUT', url: string, token: string | null, body?: unknown) => {
    const res = await http.inject({
      method,
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const login = async (username: string) => (await call('POST', '/auth/login', null, { tenant: SLUG, username, password: '1234' })).token as string;

  try {
    const { branchId } = await createTenant(db, {
      slug: SLUG,
      name: 'ปั๊มตัวอย่าง (เดโม)',
      plan: 'pro',
      branch: { code: 'HQ', name: 'สาขาบ้านนา', address: '99 ถ.มิตรภาพ อ.เมือง จ.ขอนแก่น' },
      owner: { username: 'owner', displayName: 'คุณวีระ (เจ้าของ)', password: '1234' },
    });
    const owner = await login('owner');
    const fuels: { id: string; code: string }[] = await call('GET', '/fuel-types', owner);
    const fuel = (code: string) => fuels.find((f) => f.code === code)!.id;

    for (const [username, displayName, role] of [
      ['manager', 'คุณมานพ (ผู้จัดการ)', 'manager'],
      ['somchai', 'สมชาย', 'staff'],
      ['somsri', 'สมศรี', 'staff'],
    ] as const) {
      await call('POST', '/users', owner, { username, displayName, role, password: '1234', branchIds: [branchId] });
    }
    const users: { id: string; username: string }[] = await call('GET', '/users', owner);
    const uid = (u: string) => users.find((x) => x.username === u)!.id;
    const manager = await login('manager');
    const staff = { somchai: await login('somchai'), somsri: await login('somsri') };

    const tankDefs = [
      { code: 'T1', name: 'ถัง 1 ดีเซล B7', fuel: 'B7', capacity: 30000, diameter: 2500, reorder: 8000, daily: 2600, price: 3244 },
      { code: 'T2', name: 'ถัง 2 แก๊สโซฮอล์ 95', fuel: 'G95', capacity: 20000, diameter: 2200, reorder: 5000, daily: 1500, price: 3785 },
      { code: 'T3', name: 'ถัง 3 แก๊สโซฮอล์ 91', fuel: 'G91', capacity: 15000, diameter: 2000, reorder: 4000, daily: 900, price: 3748 },
    ];
    const tanks: { id: string; def: (typeof tankDefs)[number]; cal: { mm: string; litres: string }[]; level: number }[] = [];
    for (const def of tankDefs) {
      const t = await call('POST', `/branches/${branchId}/tanks`, owner, {
        code: def.code,
        name: def.name,
        fuelTypeId: fuel(def.fuel),
        capacityLitres: String(def.capacity),
        reorderLitres: String(def.reorder),
      });
      const cal = cylinderCalibration(def.diameter, def.capacity);
      await call('PUT', `/tanks/${t.id}/calibration`, owner, { points: cal, note: 'ตารางจากผู้ติดตั้งถัง' });
      tanks.push({ id: t.id, def, cal, level: def.capacity * 0.7 });
    }

    // ตู้ 1: B7 + G95 · ตู้ 2: B7 + G91 · ตู้ 3: G95 + G91
    const nozzleDefs = [
      { code: '1A', dispenser: 1, tank: 0 },
      { code: '1B', dispenser: 1, tank: 1 },
      { code: '2A', dispenser: 2, tank: 0 },
      { code: '2B', dispenser: 2, tank: 2 },
      { code: '3A', dispenser: 3, tank: 1 },
      { code: '3B', dispenser: 3, tank: 2 },
    ];
    const nozzles: { id: string; tank: number; meter: number; attendant: 'somchai' | 'somsri' }[] = [];
    for (const [i, n] of nozzleDefs.entries()) {
      const t = tanks[n.tank]!;
      const created = await call('POST', `/branches/${branchId}/nozzles`, owner, {
        code: n.code,
        name: `หัว ${n.code} ${t.def.fuel}`,
        dispenserNo: n.dispenser,
        fuelTypeId: fuel(t.def.fuel),
        tankId: t.id,
        sortOrder: i,
      });
      nozzles.push({ id: created.id, tank: n.tank, meter: 120000 + Math.round(rand() * 400000), attendant: n.dispenser === 3 ? 'somsri' : n.dispenser === 1 ? 'somchai' : 'somsri' });
    }

    const start = new Date();
    start.setUTCDate(start.getUTCDate() - DAYS);
    await call('POST', `/branches/${branchId}/prices`, owner, {
      effectiveAt: new Date(start.getTime() - 86400_000).toISOString(),
      note: 'ราคาเริ่มต้น',
      items: tanks.map((t) => ({ fuelTypeId: fuel(t.def.fuel), priceSatang: t.def.price })),
    });

    // วัดถังครั้งแรก (วันก่อนเริ่ม)
    for (const t of tanks) {
      await call('POST', `/tanks/${t.id}/dips`, manager, { id: randomUUID(), businessDate: isoDate(start), levelMm: levelFor(t.cal, t.level) });
    }

    for (let d = 1; d <= DAYS; d++) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + d);
      const day = isoDate(date);
      const last = d === DAYS;

      // รับน้ำมันเมื่อถังต่ำกว่า 40%
      for (const t of tanks) {
        if (t.level < t.def.capacity * 0.4 && !last) {
          const qty = Math.round((t.def.capacity * 0.5) / 1000) * 1000;
          const before = levelFor(t.cal, t.level);
          const after = levelFor(t.cal, t.level + qty - 20);
          await call('POST', '/deliveries', manager, {
            id: randomUUID(),
            tankId: t.id,
            businessDate: day,
            invoiceLitres: String(qty),
            documentNo: `DO-${day.replaceAll('-', '')}-${t.def.code}`,
            supplier: 'คลังน้ำมันขอนแก่น',
            dipBeforeMm: before,
            dipAfterMm: after,
          });
          t.level += qty - 20;
        }
      }

      for (const shiftNo of [1, 2]) {
        if (last && shiftNo === 2) break; // วันล่าสุดเหลือกะที่ 2 ไว้ให้ลองปิดกะเอง
        const token = shiftNo === 1 ? staff.somchai : staff.somsri;
        const shiftId = randomUUID();
        await call('POST', `/branches/${branchId}/shifts`, token, { id: shiftId, businessDate: day, shiftNo });
        for (const n of nozzles) {
          await call('PUT', `/shifts/${shiftId}/nozzles/${n.id}/attendant`, token, { attendantId: uid(n.attendant) });
          await call('POST', `/shifts/${shiftId}/readings`, token, { id: randomUUID(), nozzleId: n.id, kind: 'open', reading: n.meter.toFixed(3) });
        }
        if (last) break; // กะสุดท้ายเปิดค้างไว้
        const expected: Record<string, number> = { somchai: 0, somsri: 0 };
        for (const n of nozzles) {
          const t = tanks[n.tank]!;
          const share = nozzles.filter((x) => x.tank === n.tank).length;
          const milli = Math.round((t.def.daily / 2 / share) * (0.8 + rand() * 0.4) * 1000);
          n.meter = (Math.round(n.meter * 1000) + milli) / 1000;
          t.level -= milli / 1000;
          expected[n.attendant]! += amountSatang(milli, t.def.price);
          await call('POST', `/shifts/${shiftId}/readings`, token, { id: randomUUID(), nozzleId: n.id, kind: 'close', reading: n.meter.toFixed(3) });
        }
        for (const who of ['somchai', 'somsri'] as const) {
          const total = expected[who]!;
          // ส่วนใหญ่เงินครบ บางกะขาดเล็กน้อย
          const diff = rand() < 0.25 ? -Math.round(rand() * 400) * 100 : 0;
          const qr = Math.round(total * 0.3);
          const card = Math.round(total * 0.1);
          const credit = Math.round(total * 0.08);
          const cash = total - qr - card - credit + diff;
          for (const [method, amountSatang] of Object.entries({ cash, qr, card, credit })) {
            await call('POST', `/shifts/${shiftId}/collections`, token, { id: randomUUID(), attendantId: uid(who), method, amountSatang });
          }
        }
        await call('POST', `/shifts/${shiftId}/submit`, token, {});
        if (d < DAYS - 1) {
          await call('POST', `/shifts/${shiftId}/approve`, manager, { acknowledgeWarnings: true, note: 'ตรวจแล้ว (เดโม)' });
        }
      }

      if (!last) {
        // วัดถังหลังปิดกะสุดท้าย — มีขาดหายเล็กน้อยตามธรรมชาติ (ระเหย/วัดคลาด)
        for (const t of tanks) {
          t.level -= t.def.daily * (rand() * 0.004);
          await call('POST', `/tanks/${t.id}/dips`, manager, { id: randomUUID(), businessDate: day, levelMm: levelFor(t.cal, t.level) });
        }
      }
    }

    console.log(`สร้างข้อมูลเดโมแล้ว: รหัสปั๊ม "${SLUG}" · ผู้ใช้ owner / manager / somchai / somsri · รหัสผ่าน 1234`);
  } finally {
    await app.close();
    await db.close();
  }
}

main().catch((err: Error) => {
  console.error('สร้างข้อมูลเดโมไม่สำเร็จ:', err.message);
  process.exit(1);
});
