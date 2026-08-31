import type { AppConfig } from '../config.js';
import { Database } from '../db/index.js';
import type { AuthService } from './auth.js';
import type { CatalogService } from './catalog.js';

/**
 * ใส่ข้อมูลตั้งต้นเมื่อเปิดระบบครั้งแรก
 *
 * ตั้งค่าให้ตรงกับหน้างานจริง: 2 ตู้จ่าย ตู้ละ 2 หัวจ่าย (ตามบอร์ด ZB01-1)
 * ราคาน้ำมันเป็นค่าตัวอย่าง ให้ผู้ใช้แก้ในหน้าตั้งราคาก่อนเปิดขายจริง
 */
export function seedIfEmpty(
  db: Database,
  auth: AuthService,
  catalog: CatalogService,
  config: AppConfig,
): { seeded: boolean; adminPin: string | null } {
  if (auth.countUsers() > 0) return { seeded: false, adminPin: null };

  // PIN เริ่มต้นแบบสุ่ม แล้วแสดงใน log ครั้งเดียว
  // ดีกว่าค่าคงที่ที่ทุกเครื่องเหมือนกันและมักไม่มีใครเปลี่ยน
  const adminPin = String(Math.floor(1000 + Math.random() * 9000));

  db.transaction(() => {
    auth.createUser({
      username: 'admin',
      displayName: 'ผู้ดูแลระบบ',
      role: 'admin',
      pin: adminPin,
    });

    const products = [
      { code: 'G95', name: 'แก๊สโซฮอล์ 95', color: '#f59e0b', unitPrice: 3975, active: true },
      { code: 'G91', name: 'แก๊สโซฮอล์ 91', color: '#22c55e', unitPrice: 3855, active: true },
      { code: 'E20', name: 'แก๊สโซฮอล์ E20', color: '#3b82f6', unitPrice: 3625, active: true },
      { code: 'B7', name: 'ดีเซล B7', color: '#ef4444', unitPrice: 3294, active: true },
    ].map((p) => catalog.createProduct(p));

    const tanks = products.map((product) =>
      catalog.createTank({
        name: `ถัง ${product.code}`,
        productId: product.id,
        capacity: 20_000_000, // 20,000 ลิตร
        bookLevel: 10_000_000,
      }),
    );

    const busId = config.buses[0]?.id ?? 'bus1';

    // 2 ตู้จ่าย × 2 หัวจ่าย ตามที่ติดตั้งจริง
    // หัวจ่าย A/B ของบอร์ด ZB01-1 = idx 1/2
    const layout: { pump: string; address: number; nozzles: { label: string; productCode: string }[] }[] = [
      {
        pump: 'ตู้ 1',
        address: 1,
        nozzles: [
          { label: '1A', productCode: 'G95' },
          { label: '1B', productCode: 'G91' },
        ],
      },
      {
        pump: 'ตู้ 2',
        address: 2,
        nozzles: [
          { label: '2A', productCode: 'E20' },
          { label: '2B', productCode: 'B7' },
        ],
      },
    ];

    for (const item of layout) {
      const pump = catalog.createPump({ name: item.pump, address: item.address, busId });
      item.nozzles.forEach((nozzle, index) => {
        const product = products.find((p) => p.code === nozzle.productCode);
        if (!product) return;
        const tank = tanks.find((t) => t.productId === product.id);
        catalog.createNozzle({
          pumpId: pump.id,
          index: index + 1,
          label: nozzle.label,
          productId: product.id,
          tankId: tank?.id ?? null,
        });
      });
    }

    db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      'seeded_at',
      new Date().toISOString(),
    );
  });

  return { seeded: true, adminPin };
}
