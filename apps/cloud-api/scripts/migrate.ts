/**
 * รัน migration: MIGRATION_DATABASE_URL=postgres://fuel_owner:...@host/fuel_saas npm run migrate
 */
import { migrate } from '../src/db/migrator.js';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://fuel_owner:fuel_owner@localhost:5432/fuel_saas';

migrate(url, (m) => console.log(m))
  .then((applied) => {
    console.log(applied.length ? `รัน migration แล้ว ${applied.length} ไฟล์` : 'ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว');
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
