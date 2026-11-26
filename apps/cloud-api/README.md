# ระบบหลังบ้านบนคลาวด์ (SaaS)

NestJS (Fastify) + PostgreSQL · multi-tenant ด้วย Row-Level Security

อ่านรายละเอียดทั้งหมดที่ [docs/06-saas-cloud.md](../../docs/06-saas-cloud.md)

```bash
psql -U postgres -f scripts/db-init.sql   # ครั้งเดียว: บทบาท fuel_owner / fuel_app + ฐานข้อมูล
npm run build
npm run migrate
npm run seed:demo                          # ปั๊มเดโม รหัส "demo" รหัสผ่าน 1234
npm start                                  # http://localhost:8080/api/v1
npm test                                   # ต้องมีฐานข้อมูล fuel_saas_test
```

| โฟลเดอร์ | เนื้อหา |
|---|---|
| `migrations/` | โครงสร้างฐานข้อมูล + RLS + สิทธิ์ (รันด้วยบทบาทเจ้าของตาราง) |
| `src/auth` | เข้าสู่ระบบ (scrypt) · token · guard · บทบาท |
| `src/settings` | สาขา ชนิดน้ำมัน ราคา ถัง ตารางแปลง หัวจ่าย ผู้ใช้ |
| `src/shifts` | ปิดกะ · `shift-calc.ts` สูตรคำนวณ (ฟังก์ชันล้วน) |
| `src/stock` | วัดถัง รับน้ำมัน เทียบยอด · `calibration.ts` · `reconciliation.ts` |
| `src/dashboard` | Dashboard + ข้อความสรุปประจำวัน |
| `src/notify` | LINE OA: outbox · worker · webhook เชื่อมด้วยรหัส 6 หลัก |
| `src/photos` | รูปมิเตอร์/ใบส่ง (`PhotoStorage`) |
| `test/` | `tenant-isolation` · `shifts` · `stock` · `units` |
