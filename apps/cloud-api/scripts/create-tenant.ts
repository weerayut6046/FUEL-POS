/**
 * เปิดลูกค้ารายใหม่ (ใช้ตอนตั้งค่าให้ปั๊มที่สมัคร ก่อนมีหน้าสมัครเองในเฟส 2)
 *
 *   npm run tenant:create -w @fuel-pos/cloud-api -- \
 *     --slug banna --name "ปั๊มบ้านนา" --branch-code HQ --branch-name "สาขาหลัก" \
 *     --owner owner --owner-name "เจ้าของปั๊ม" --password 'รหัสผ่าน'
 */
import { parseArgs } from 'node:util';

import { loadConfig } from '../src/config.js';
import { Db } from '../src/db/db.js';
import { createTenant } from '../src/tenants/provisioning.js';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    plan: { type: 'string', default: 'starter' },
    'branch-code': { type: 'string', default: 'HQ' },
    'branch-name': { type: 'string', default: 'สาขาหลัก' },
    owner: { type: 'string', default: 'owner' },
    'owner-name': { type: 'string', default: 'เจ้าของ' },
    password: { type: 'string' },
  },
});

if (!values.slug || !values.name || !values.password) {
  console.error('ต้องระบุ --slug --name --password');
  process.exit(1);
}

const db = new Db(loadConfig().databaseUrl, 2);
createTenant(db, {
  slug: values.slug,
  name: values.name,
  plan: values.plan as 'starter' | 'pro' | 'multi',
  branch: { code: values['branch-code']!, name: values['branch-name']! },
  owner: { username: values.owner!, displayName: values['owner-name']!, password: values.password },
})
  .then((r) => {
    console.log(`สร้างลูกค้าแล้ว: รหัสปั๊ม "${values.slug}" (tenant ${r.tenantId})`);
    console.log(`เข้าสู่ระบบด้วยชื่อผู้ใช้ "${values.owner}"`);
  })
  .catch((err: Error) => {
    console.error('สร้างลูกค้าไม่สำเร็จ:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
