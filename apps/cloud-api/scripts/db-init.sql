-- สร้างบทบาท (role) และฐานข้อมูลสำหรับระบบคลาวด์ — รันครั้งเดียวโดยผู้ดูแลฐานข้อมูล (superuser)
--
--   psql -U postgres -f apps/cloud-api/scripts/db-init.sql
--
-- แยก 2 บทบาทเพื่อให้ Row-Level Security มีผลจริง:
--   fuel_owner  เจ้าของตาราง ใช้รัน migration และสคริปต์ดูแลระบบเท่านั้น
--   fuel_app    บทบาทที่ API ใช้ — ไม่ใช่เจ้าของตาราง ไม่มี BYPASSRLS
--               จึงเห็นเฉพาะข้อมูลของลูกค้าที่ตั้งไว้ใน app.tenant_id
--
-- เปลี่ยนรหัสผ่านก่อนใช้งานจริง

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fuel_owner') THEN
    CREATE ROLE fuel_owner LOGIN PASSWORD 'fuel_owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fuel_app') THEN
    CREATE ROLE fuel_app LOGIN PASSWORD 'fuel_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

SELECT 'CREATE DATABASE fuel_saas OWNER fuel_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'fuel_saas') \gexec

SELECT 'CREATE DATABASE fuel_saas_test OWNER fuel_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'fuel_saas_test') \gexec

GRANT CONNECT ON DATABASE fuel_saas TO fuel_app;
GRANT CONNECT ON DATABASE fuel_saas_test TO fuel_app;
