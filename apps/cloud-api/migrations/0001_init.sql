-- =============================================================================
-- ระบบบริหารจัดการปั๊มน้ำมัน (SaaS) — โครงสร้างฐานข้อมูล MVP
-- =============================================================================
--
-- กติกาที่บังคับในระดับฐานข้อมูล (ไม่ได้พึ่งแค่โค้ด API):
--
--   1. ทุกตารางมี tenant_id และเปิด Row-Level Security
--      API เชื่อมต่อด้วยบทบาท fuel_app ซึ่งเห็นเฉพาะแถวที่ tenant_id ตรงกับ
--      current_setting('app.tenant_id') ที่ตั้งไว้ในแต่ละ transaction
--
--   2. Foreign key อ้างด้วย (tenant_id, id) เสมอ — แม้รู้ UUID ของลูกค้ารายอื่น
--      ก็สร้างแถวที่ชี้ข้ามลูกค้าไม่ได้ (การตรวจ FK ของ Postgres ข้าม RLS)
--
--   3. เงินเก็บเป็นสตางค์ (BIGINT) ลิตรเก็บเป็น NUMERIC(14,3) — ไม่มีเลขทศนิยมลอยตัว
--
--   4. ตารางตัวเลข (เลขมิเตอร์ ยอดเงิน วัดถัง รับน้ำมัน ราคา) เป็นแบบเพิ่มอย่างเดียว
--      fuel_app ไม่มีสิทธิ์ UPDATE/DELETE และมี trigger กันการแก้ไขอีกชั้น
--      การแก้ตัวเลข = เพิ่มแถวใหม่ที่ชี้ supersedes_id ไปยังแถวเดิม พร้อมเหตุผล คนแก้ และเวลา
--      แถว "ปัจจุบัน" คือแถวที่ไม่มีแถวอื่นมาแทน (หัวของสายการแก้ไข)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ฟังก์ชันช่วย
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- กันการแก้ไข/ลบตารางที่เป็นบัญชีตัวเลข
CREATE FUNCTION forbid_ledger_update() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'ตาราง % เป็นข้อมูลแบบเพิ่มอย่างเดียว ห้ามแก้ไขทับ ให้บันทึกรายการแก้ไขแทน', TG_TABLE_NAME
    USING ERRCODE = 'P0001', HINT = 'append_only';
END
$$;

-- บันทึกประวัติการเปลี่ยนแปลงของตารางตั้งค่า (ใครเปลี่ยน อะไร เมื่อไร)
CREATE FUNCTION audit_row() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_tenant uuid;
  v_id text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD) - 'password_hash';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW) - 'password_hash';
  END IF;
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'tenants' THEN
    v_tenant := (coalesce(v_new, v_old) ->> 'id')::uuid;
  ELSE
    v_tenant := (coalesce(v_new, v_old) ->> 'tenant_id')::uuid;
  END IF;
  v_id := CASE TG_TABLE_NAME
    WHEN 'shift_nozzles' THEN (coalesce(v_new, v_old) ->> 'shift_id') || ':' || (coalesce(v_new, v_old) ->> 'nozzle_id')
    WHEN 'user_branches' THEN (coalesce(v_new, v_old) ->> 'user_id') || ':' || (coalesce(v_new, v_old) ->> 'branch_id')
    WHEN 'tenant_settings' THEN coalesce(v_new, v_old) ->> 'tenant_id'
    ELSE coalesce(v_new, v_old) ->> 'id'
  END;
  INSERT INTO audit_log (tenant_id, table_name, row_id, action, actor_id, old_data, new_data)
  VALUES (v_tenant, TG_TABLE_NAME, v_id, TG_OP, app_current_user(), v_old, v_new);
  RETURN coalesce(NEW, OLD);
END
$$;

-- ---------------------------------------------------------------------------
-- ลูกค้า (tenant) — ปั๊มนำร่องของเราก็เป็นลูกค้ารายหนึ่งเหมือนรายอื่น
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  plan           text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'multi')),
  status         text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
  trial_ends_at  date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_settings (
  tenant_id               uuid PRIMARY KEY REFERENCES tenants(id),
  timezone                text NOT NULL DEFAULT 'Asia/Bangkok',
  -- เงินขาด/เกินเกินเท่านี้ (สตางค์) ต่อกะ ให้แจ้งเตือนเจ้าของ
  cash_alert_satang       bigint NOT NULL DEFAULT 10000 CHECK (cash_alert_satang >= 0),
  -- น้ำมันขาด/เกินเทียบยอดขาย เกินกี่เปอร์เซ็นต์ให้แจ้งเตือน
  variance_alert_percent  numeric(5, 2) NOT NULL DEFAULT 0.50 CHECK (variance_alert_percent >= 0),
  -- ส่งสรุปประจำวันทาง LINE เวลากี่โมง (ตามเขตเวลาของลูกค้า) — null = ไม่ส่ง
  daily_summary_hour      smallint DEFAULT 21 CHECK (daily_summary_hour BETWEEN 0 AND 23),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- สาขาและผู้ใช้
-- ---------------------------------------------------------------------------

CREATE TABLE branches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  address     text,
  tax_id      text,
  phone       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  username       text NOT NULL CHECK (username ~ '^[a-z0-9._-]{2,40}$'),
  display_name   text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  -- owner = เจ้าของ · manager = ผู้จัดการปั๊ม · staff = พนักงานหน้าลาน
  role           text NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
  password_hash  text NOT NULL,
  all_branches   boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, username)
);

CREATE TABLE user_branches (
  tenant_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  branch_id  uuid NOT NULL,
  PRIMARY KEY (user_id, branch_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id)
);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  user_agent  text,
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX sessions_user_idx ON sessions (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- ชนิดน้ำมัน ราคา ถัง หัวจ่าย
-- ---------------------------------------------------------------------------

CREATE TABLE fuel_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  code        text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  color       text NOT NULL DEFAULT '#1565C0' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- ประวัติราคาขาย (เพิ่มอย่างเดียว) — ราคาที่ใช้ = แถวล่าสุดที่ effective_at <= เวลาที่ต้องการ
CREATE TABLE fuel_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  branch_id      uuid NOT NULL,
  fuel_type_id   uuid NOT NULL,
  price_satang   bigint NOT NULL CHECK (price_satang > 0),
  effective_at   timestamptz NOT NULL,
  note           text,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  FOREIGN KEY (tenant_id, fuel_type_id) REFERENCES fuel_types (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX fuel_prices_lookup_idx ON fuel_prices (branch_id, fuel_type_id, effective_at DESC);

CREATE TABLE tanks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  branch_id        uuid NOT NULL,
  code             text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  fuel_type_id     uuid NOT NULL,
  capacity_litres  numeric(14, 3) NOT NULL CHECK (capacity_litres > 0),
  -- จุดสั่งน้ำมัน: ต่ำกว่านี้ให้เตือน
  reorder_litres   numeric(14, 3) NOT NULL DEFAULT 0 CHECK (reorder_litres >= 0),
  sort_order       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  FOREIGN KEY (tenant_id, fuel_type_id) REFERENCES fuel_types (tenant_id, id)
);

-- ตารางแปลงระดับน้ำมัน (มม.) เป็นลิตรของแต่ละถัง — เพิ่มเป็นเวอร์ชันใหม่ ไม่แก้ของเดิม
-- การวัดถังแต่ละครั้งเก็บว่าใช้ตารางเวอร์ชันไหน ตัวเลขย้อนหลังจึงไม่เปลี่ยนเมื่ออัปเดตตาราง
CREATE TABLE tank_calibrations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  tank_id     uuid NOT NULL,
  -- [{"mm": 0, "litres": "0.000"}, {"mm": 100, "litres": "312.500"}, ...] เรียงตาม mm
  points      jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) >= 2),
  note        text,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, tank_id) REFERENCES tanks (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX tank_calibrations_tank_idx ON tank_calibrations (tank_id, created_at DESC);

CREATE TABLE nozzles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  branch_id      uuid NOT NULL,
  code           text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  dispenser_no   integer NOT NULL DEFAULT 1 CHECK (dispenser_no > 0),
  fuel_type_id   uuid NOT NULL,
  tank_id        uuid NOT NULL,
  -- มิเตอร์วนรอบที่ค่านี้ (เช่น 1,000,000.000 ลิตร แล้วกลับไป 0)
  meter_modulus  numeric(14, 3) NOT NULL DEFAULT 1000000 CHECK (meter_modulus > 0),
  sort_order     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id),
  UNIQUE (branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  FOREIGN KEY (tenant_id, fuel_type_id) REFERENCES fuel_types (tenant_id, id),
  FOREIGN KEY (tenant_id, tank_id) REFERENCES tanks (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- รูปถ่าย (มิเตอร์ ใบส่งน้ำมัน ไม้วัดถัง) — id สร้างจากเครื่องเพื่อให้ส่งซ้ำได้ตอนเน็ตหลุด
-- ---------------------------------------------------------------------------

CREATE TABLE photos (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  storage_key   text NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL,
  uploaded_by   uuid NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, uploaded_by) REFERENCES users (tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- กะ
-- ---------------------------------------------------------------------------

CREATE TABLE shifts (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  branch_id       uuid NOT NULL,
  business_date   date NOT NULL,
  shift_no        smallint NOT NULL CHECK (shift_no BETWEEN 1 AND 9),
  -- open = กำลังทำงาน · submitted = ส่งปิดกะแล้ว รอผู้จัดการตรวจ · approved = ผู้จัดการยืนยันแล้ว
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'approved')),
  opened_by       uuid NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  submitted_by    uuid,
  submitted_at    timestamptz,
  approved_by     uuid,
  approved_at     timestamptz,
  approval_note   text,
  note            text,
  UNIQUE (tenant_id, id),
  UNIQUE (branch_id, business_date, shift_no),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  FOREIGN KEY (tenant_id, opened_by) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX shifts_branch_date_idx ON shifts (branch_id, business_date, shift_no);

-- ประวัติการเปลี่ยนสถานะกะ (เพิ่มอย่างเดียว)
CREATE TABLE shift_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  shift_id   uuid NOT NULL,
  action     text NOT NULL CHECK (action IN ('open', 'submit', 'approve', 'reopen')),
  actor_id   uuid NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  note       text,
  data       jsonb,
  FOREIGN KEY (tenant_id, shift_id) REFERENCES shifts (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX shift_events_shift_idx ON shift_events (shift_id, at);

-- หัวจ่ายในกะ — บันทึก ณ ตอนเปิดกะ: ชนิดน้ำมัน ถัง และราคา ณ เวลานั้น
-- ตั้งค่าหัวจ่ายภายหลังจึงไม่กระทบตัวเลขของกะที่ผ่านมา
CREATE TABLE shift_nozzles (
  tenant_id     uuid NOT NULL,
  shift_id      uuid NOT NULL,
  nozzle_id     uuid NOT NULL,
  fuel_type_id  uuid NOT NULL,
  tank_id       uuid NOT NULL,
  price_satang  bigint NOT NULL CHECK (price_satang >= 0),
  -- พนักงานที่รับผิดชอบเงินของหัวจ่ายนี้ (ใช้คิดเงินขาด/เกินรายคน)
  attendant_id  uuid,
  PRIMARY KEY (shift_id, nozzle_id),
  UNIQUE (tenant_id, shift_id, nozzle_id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES shifts (tenant_id, id),
  FOREIGN KEY (tenant_id, nozzle_id) REFERENCES nozzles (tenant_id, id),
  FOREIGN KEY (tenant_id, fuel_type_id) REFERENCES fuel_types (tenant_id, id),
  FOREIGN KEY (tenant_id, tank_id) REFERENCES tanks (tenant_id, id),
  FOREIGN KEY (tenant_id, attendant_id) REFERENCES users (tenant_id, id)
);

-- เลขมิเตอร์ต้นกะ/ปลายกะ (เพิ่มอย่างเดียว)
CREATE TABLE meter_readings (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  shift_id       uuid NOT NULL,
  nozzle_id      uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('open', 'close')),
  reading        numeric(14, 3) NOT NULL CHECK (reading >= 0),
  -- ปลายกะ: มิเตอร์วนรอบระหว่างกะ (ยืนยันโดยผู้บันทึก)
  rollover       boolean NOT NULL DEFAULT false,
  photo_id       uuid,
  supersedes_id  uuid UNIQUE REFERENCES meter_readings (id),
  reason         text,
  recorded_by    uuid NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  device_at      timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (supersedes_id IS NULL OR length(coalesce(reason, '')) > 0),
  CHECK (kind = 'close' OR rollover = false),
  FOREIGN KEY (tenant_id, shift_id, nozzle_id) REFERENCES shift_nozzles (tenant_id, shift_id, nozzle_id),
  FOREIGN KEY (tenant_id, photo_id) REFERENCES photos (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX meter_readings_first_uq ON meter_readings (shift_id, nozzle_id, kind) WHERE supersedes_id IS NULL;
CREATE INDEX meter_readings_shift_idx ON meter_readings (shift_id, nozzle_id, kind);

-- น้ำมันทดสอบ/ตวงที่เทกลับถัง — หักออกจากยอดขายของหัวจ่าย (เพิ่มอย่างเดียว)
CREATE TABLE pump_tests (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  shift_id       uuid NOT NULL,
  nozzle_id      uuid NOT NULL,
  litres         numeric(14, 3) NOT NULL CHECK (litres >= 0),
  supersedes_id  uuid UNIQUE REFERENCES pump_tests (id),
  reason         text,
  recorded_by    uuid NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  device_at      timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (supersedes_id IS NULL OR length(coalesce(reason, '')) > 0),
  FOREIGN KEY (tenant_id, shift_id, nozzle_id) REFERENCES shift_nozzles (tenant_id, shift_id, nozzle_id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX pump_tests_first_uq ON pump_tests (shift_id, nozzle_id) WHERE supersedes_id IS NULL;

-- เงินที่พนักงานส่งต่อกะ แยกตามวิธีรับชำระ (เพิ่มอย่างเดียว)
CREATE TABLE shift_collections (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  shift_id       uuid NOT NULL,
  attendant_id   uuid NOT NULL,
  method         text NOT NULL CHECK (method IN ('cash', 'qr', 'card', 'coupon', 'credit')),
  amount_satang  bigint NOT NULL CHECK (amount_satang >= 0),
  note           text,
  supersedes_id  uuid UNIQUE REFERENCES shift_collections (id),
  reason         text,
  recorded_by    uuid NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  device_at      timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (supersedes_id IS NULL OR length(coalesce(reason, '')) > 0),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES shifts (tenant_id, id),
  FOREIGN KEY (tenant_id, attendant_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX shift_collections_first_uq ON shift_collections (shift_id, attendant_id, method) WHERE supersedes_id IS NULL;

-- ---------------------------------------------------------------------------
-- สต็อกน้ำมันในถัง
-- ---------------------------------------------------------------------------

-- วัดถังประจำวัน (หลังปิดกะสุดท้ายของวัน) — เพิ่มอย่างเดียว
CREATE TABLE tank_dips (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  tank_id         uuid NOT NULL,
  business_date   date NOT NULL,
  measured_at     timestamptz NOT NULL,
  level_mm        numeric(7, 1) NOT NULL CHECK (level_mm >= 0),
  water_mm        numeric(7, 1) NOT NULL DEFAULT 0 CHECK (water_mm >= 0),
  -- ลิตรน้ำมัน (หักน้ำแล้ว) คำนวณจากตารางแปลงเวอร์ชัน calibration_id ตอนบันทึก
  litres          numeric(14, 3) NOT NULL CHECK (litres >= 0),
  calibration_id  uuid NOT NULL,
  photo_id        uuid,
  supersedes_id   uuid UNIQUE REFERENCES tank_dips (id),
  reason          text,
  recorded_by     uuid NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  device_at       timestamptz,
  UNIQUE (tenant_id, id),
  CHECK (supersedes_id IS NULL OR length(coalesce(reason, '')) > 0),
  CHECK (water_mm <= level_mm),
  FOREIGN KEY (tenant_id, tank_id) REFERENCES tanks (tenant_id, id),
  FOREIGN KEY (tenant_id, calibration_id) REFERENCES tank_calibrations (tenant_id, id),
  FOREIGN KEY (tenant_id, photo_id) REFERENCES photos (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX tank_dips_first_uq ON tank_dips (tank_id, business_date) WHERE supersedes_id IS NULL;
CREATE INDEX tank_dips_tank_date_idx ON tank_dips (tank_id, business_date);

-- รับน้ำมันจากรถส่ง — เพิ่มอย่างเดียว ยกเลิกได้ด้วยการเพิ่มรายการ voided = true
CREATE TABLE fuel_deliveries (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  root_id          uuid NOT NULL,
  branch_id        uuid NOT NULL,
  tank_id          uuid NOT NULL,
  business_date    date NOT NULL,
  delivered_at     timestamptz NOT NULL,
  document_no      text,
  supplier         text,
  -- ลิตรตามใบส่งของ (ใช้ลงบัญชีสต็อก)
  invoice_litres   numeric(14, 3) NOT NULL CHECK (invoice_litres >= 0),
  -- วัดถังก่อน/หลังรับ (ถ้ามี) ใช้ตรวจว่าได้น้ำมันครบตามใบส่งไหม
  dip_before_mm    numeric(7, 1),
  dip_after_mm     numeric(7, 1),
  measured_litres  numeric(14, 3),
  calibration_id   uuid,
  voided           boolean NOT NULL DEFAULT false,
  photo_id         uuid,
  supersedes_id    uuid UNIQUE REFERENCES fuel_deliveries (id),
  reason           text,
  recorded_by      uuid NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  device_at        timestamptz,
  UNIQUE (tenant_id, id),
  CHECK ((supersedes_id IS NULL) = (root_id = id)),
  CHECK (supersedes_id IS NULL OR length(coalesce(reason, '')) > 0),
  CHECK (voided OR invoice_litres > 0),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches (tenant_id, id),
  FOREIGN KEY (tenant_id, tank_id) REFERENCES tanks (tenant_id, id),
  FOREIGN KEY (tenant_id, calibration_id) REFERENCES tank_calibrations (tenant_id, id),
  FOREIGN KEY (tenant_id, photo_id) REFERENCES photos (tenant_id, id),
  FOREIGN KEY (tenant_id, recorded_by) REFERENCES users (tenant_id, id)
);
CREATE INDEX fuel_deliveries_tank_date_idx ON fuel_deliveries (tank_id, business_date);
CREATE INDEX fuel_deliveries_root_idx ON fuel_deliveries (root_id);

-- ---------------------------------------------------------------------------
-- LINE OA และการแจ้งเตือน
-- ---------------------------------------------------------------------------

-- รหัสเชื่อม LINE: ผู้ใช้กดสร้างรหัสในแอป แล้วพิมพ์รหัสส่งให้ LINE OA ของระบบ
CREATE TABLE line_link_codes (
  code        text PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  tenant_id   uuid NOT NULL,
  created_by  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id)
);

CREATE TABLE line_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  line_id       text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('user', 'group', 'room')),
  display_name  text,
  active        boolean NOT NULL DEFAULT true,
  linked_by     uuid,
  linked_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, line_id)
);

-- กล่องจดหมายขาออก (outbox) — บันทึกใน transaction เดียวกับเหตุการณ์ แล้วให้ worker ส่ง
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  dedupe_key  text NOT NULL,
  kind        text NOT NULL,
  message     text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE INDEX notifications_pending_idx ON notifications (status, created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- ประวัติการแก้ไขตารางตั้งค่า
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  table_name  text NOT NULL,
  row_id      text,
  action      text NOT NULL,
  actor_id    uuid,
  at          timestamptz NOT NULL DEFAULT now(),
  old_data    jsonb,
  new_data    jsonb
);
CREATE INDEX audit_log_tenant_idx ON audit_log (tenant_id, at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: กันแก้ไขตารางตัวเลข + บันทึกประวัติตารางตั้งค่า
-- ---------------------------------------------------------------------------

CREATE TRIGGER fuel_prices_append_only       BEFORE UPDATE ON fuel_prices       FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER tank_calibrations_append_only BEFORE UPDATE ON tank_calibrations FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER photos_append_only            BEFORE UPDATE ON photos            FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER shift_events_append_only      BEFORE UPDATE ON shift_events      FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER meter_readings_append_only    BEFORE UPDATE ON meter_readings    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER pump_tests_append_only        BEFORE UPDATE ON pump_tests        FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER shift_collections_append_only BEFORE UPDATE ON shift_collections FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER tank_dips_append_only         BEFORE UPDATE ON tank_dips         FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER fuel_deliveries_append_only   BEFORE UPDATE ON fuel_deliveries   FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();
CREATE TRIGGER audit_log_append_only         BEFORE UPDATE ON audit_log         FOR EACH ROW EXECUTE FUNCTION forbid_ledger_update();

-- ราคาในกะถูกตรึงตั้งแต่เปิดกะ: เปลี่ยนได้เฉพาะพนักงานที่รับผิดชอบหัวจ่าย
CREATE FUNCTION shift_nozzles_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.price_satang <> OLD.price_satang OR NEW.fuel_type_id <> OLD.fuel_type_id
     OR NEW.tank_id <> OLD.tank_id OR NEW.nozzle_id <> OLD.nozzle_id OR NEW.shift_id <> OLD.shift_id THEN
    RAISE EXCEPTION 'ข้อมูลหัวจ่ายในกะถูกตรึงตั้งแต่เปิดกะ แก้ได้เฉพาะพนักงานที่รับผิดชอบ'
      USING ERRCODE = 'P0001', HINT = 'append_only';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER shift_nozzles_guard BEFORE UPDATE ON shift_nozzles FOR EACH ROW EXECUTE FUNCTION shift_nozzles_guard();

CREATE TRIGGER tenants_audit         AFTER INSERT OR UPDATE ON tenants         FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER tenant_settings_audit AFTER INSERT OR UPDATE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER branches_audit        AFTER INSERT OR UPDATE ON branches        FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER users_audit           AFTER INSERT OR UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER user_branches_audit   AFTER INSERT OR DELETE ON user_branches   FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER fuel_types_audit      AFTER INSERT OR UPDATE ON fuel_types      FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER tanks_audit           AFTER INSERT OR UPDATE ON tanks           FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER nozzles_audit         AFTER INSERT OR UPDATE ON nozzles         FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER shifts_audit          AFTER UPDATE ON shifts                    FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER shift_nozzles_audit   AFTER UPDATE ON shift_nozzles             FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE TRIGGER line_recipients_audit AFTER INSERT OR UPDATE ON line_recipients FOR EACH ROW EXECUTE FUNCTION audit_row();

-- ---------------------------------------------------------------------------
-- View: แถวปัจจุบันของตารางแบบเพิ่มอย่างเดียว
-- security_invoker = true → view ใช้สิทธิ์ของผู้เรียก RLS จึงยังมีผล
-- ---------------------------------------------------------------------------

CREATE VIEW meter_readings_current WITH (security_invoker = true) AS
  SELECT m.* FROM meter_readings m
  WHERE NOT EXISTS (SELECT 1 FROM meter_readings s WHERE s.supersedes_id = m.id);

CREATE VIEW pump_tests_current WITH (security_invoker = true) AS
  SELECT t.* FROM pump_tests t
  WHERE NOT EXISTS (SELECT 1 FROM pump_tests s WHERE s.supersedes_id = t.id);

CREATE VIEW shift_collections_current WITH (security_invoker = true) AS
  SELECT c.* FROM shift_collections c
  WHERE NOT EXISTS (SELECT 1 FROM shift_collections s WHERE s.supersedes_id = c.id);

CREATE VIEW tank_dips_current WITH (security_invoker = true) AS
  SELECT d.* FROM tank_dips d
  WHERE NOT EXISTS (SELECT 1 FROM tank_dips s WHERE s.supersedes_id = d.id);

CREATE VIEW fuel_deliveries_current WITH (security_invoker = true) AS
  SELECT d.* FROM fuel_deliveries d
  WHERE NOT EXISTS (SELECT 1 FROM fuel_deliveries s WHERE s.supersedes_id = d.id);

-- ยอดขายต่อหัวจ่ายต่อกะ: ลิตรจากมิเตอร์ − น้ำมันทดสอบ × ราคาที่ตรึงไว้ตอนเปิดกะ
CREATE VIEW shift_lines WITH (security_invoker = true) AS
  SELECT
    sn.tenant_id,
    sn.shift_id,
    sn.nozzle_id,
    sn.fuel_type_id,
    sn.tank_id,
    sn.price_satang,
    sn.attendant_id,
    s.branch_id,
    s.business_date,
    s.shift_no,
    s.status,
    o.reading AS open_reading,
    c.reading AS close_reading,
    coalesce(c.rollover, false) AS rollover,
    n.meter_modulus,
    CASE
      WHEN o.reading IS NULL OR c.reading IS NULL THEN NULL
      WHEN c.rollover THEN n.meter_modulus - o.reading + c.reading
      ELSE c.reading - o.reading
    END AS meter_litres,
    coalesce(t.litres, 0)::numeric(14, 3) AS test_litres
  FROM shift_nozzles sn
  JOIN shifts s ON s.id = sn.shift_id
  JOIN nozzles n ON n.id = sn.nozzle_id
  LEFT JOIN meter_readings_current o ON o.shift_id = sn.shift_id AND o.nozzle_id = sn.nozzle_id AND o.kind = 'open'
  LEFT JOIN meter_readings_current c ON c.shift_id = sn.shift_id AND c.nozzle_id = sn.nozzle_id AND c.kind = 'close'
  LEFT JOIN pump_tests_current t ON t.shift_id = sn.shift_id AND t.nozzle_id = sn.nozzle_id;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'branches', 'users', 'user_branches', 'sessions',
    'fuel_types', 'fuel_prices', 'tanks', 'tank_calibrations', 'nozzles',
    'photos', 'shifts', 'shift_events', 'shift_nozzles', 'meter_readings',
    'pump_tests', 'shift_collections', 'tank_dips', 'fuel_deliveries',
    'line_link_codes', 'line_recipients', 'notifications', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- ฟังก์ชันที่ต้องทำงานก่อนรู้ว่าเป็นลูกค้ารายไหน (SECURITY DEFINER)
-- คืนข้อมูลเท่าที่จำเป็นเท่านั้น
-- ---------------------------------------------------------------------------

-- เข้าสู่ระบบ: หา tenant จากรหัสปั๊ม แล้วหาผู้ใช้
CREATE FUNCTION app_login_lookup(p_slug text, p_username text)
  RETURNS TABLE (tenant_id uuid, tenant_name text, tenant_status text, user_id uuid, password_hash text, active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.id, t.name, t.status, u.id, u.password_hash, u.active
    FROM tenants t JOIN users u ON u.tenant_id = t.id
    WHERE t.slug = lower(p_slug) AND u.username = lower(p_username)
  $$;

-- ตรวจ token ของทุกคำขอ
CREATE FUNCTION app_session_lookup(p_token_hash text)
  RETURNS TABLE (tenant_id uuid, user_id uuid, role text, all_branches boolean, username text, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT s.tenant_id, u.id, u.role, u.all_branches, u.username, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.active
      AND t.status <> 'suspended'
  $$;

-- LINE webhook: ใช้รหัสเชื่อมแล้วผูกห้องแชตเข้ากับลูกค้า คืนชื่อลูกค้า (null = รหัสไม่ถูกต้อง/หมดอายุ)
CREATE FUNCTION app_line_link(p_code text, p_line_id text, p_kind text, p_display_name text)
  RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_code line_link_codes%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO v_code FROM line_link_codes
  WHERE code = p_code AND used_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE line_link_codes SET used_at = now() WHERE code = p_code;
  INSERT INTO line_recipients (tenant_id, line_id, kind, display_name, active, linked_by)
  VALUES (v_code.tenant_id, p_line_id, p_kind, p_display_name, true, v_code.created_by)
  ON CONFLICT (tenant_id, line_id) DO UPDATE SET active = true, display_name = EXCLUDED.display_name;
  SELECT name INTO v_name FROM tenants WHERE id = v_code.tenant_id;
  RETURN v_name;
END
$$;

-- งานเบื้องหลัง: รายชื่อลูกค้าที่ยังใช้งานอยู่ (worker จะตั้ง tenant แล้วทำงานใต้ RLS ทีละราย)
CREATE FUNCTION app_job_tenants()
  RETURNS TABLE (tenant_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT id FROM tenants WHERE status <> 'suspended' ORDER BY created_at $$;

REVOKE ALL ON FUNCTION app_login_lookup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_session_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_line_link(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_job_tenants() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- สิทธิ์ของบทบาท API (fuel_app)
-- ไม่มี DELETE ยกเว้นสิทธิ์สาขาของผู้ใช้ · ตารางตัวเลขได้แค่ SELECT/INSERT
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO fuel_app;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO fuel_app;
GRANT EXECUTE ON FUNCTION app_current_user() TO fuel_app;
GRANT EXECUTE ON FUNCTION app_login_lookup(text, text) TO fuel_app;
GRANT EXECUTE ON FUNCTION app_session_lookup(text) TO fuel_app;
GRANT EXECUTE ON FUNCTION app_line_link(text, text, text, text) TO fuel_app;
GRANT EXECUTE ON FUNCTION app_job_tenants() TO fuel_app;

-- ตารางตั้งค่า: อ่าน เพิ่ม แก้ไข (ปิดใช้งานแทนการลบ)
GRANT SELECT, INSERT ON tenants TO fuel_app;
GRANT UPDATE (name) ON tenants TO fuel_app;
GRANT SELECT, INSERT, UPDATE ON tenant_settings, branches, users, fuel_types, tanks, nozzles, line_recipients
  TO fuel_app;
GRANT SELECT, INSERT, DELETE ON user_branches TO fuel_app;
GRANT SELECT, INSERT ON sessions TO fuel_app;
GRANT UPDATE (revoked_at) ON sessions TO fuel_app;
GRANT SELECT, INSERT ON line_link_codes TO fuel_app;
GRANT SELECT, INSERT ON notifications TO fuel_app;
GRANT UPDATE (status, attempts, last_error, sent_at) ON notifications TO fuel_app;

-- กะ: แก้ได้เฉพาะคอลัมน์สถานะ
GRANT SELECT, INSERT ON shifts TO fuel_app;
GRANT UPDATE (status, submitted_by, submitted_at, approved_by, approved_at, approval_note, note) ON shifts TO fuel_app;
GRANT SELECT, INSERT ON shift_nozzles TO fuel_app;
GRANT UPDATE (attendant_id) ON shift_nozzles TO fuel_app;

-- ตารางตัวเลข: เพิ่มอย่างเดียว
GRANT SELECT, INSERT ON fuel_prices, tank_calibrations, photos, shift_events, meter_readings, pump_tests,
  shift_collections, tank_dips, fuel_deliveries, audit_log TO fuel_app;

GRANT SELECT ON meter_readings_current, pump_tests_current, shift_collections_current, tank_dips_current,
  fuel_deliveries_current, shift_lines TO fuel_app;
