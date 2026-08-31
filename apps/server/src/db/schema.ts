/**
 * โครงสร้างฐานข้อมูล
 *
 * เก็บเป็นสตริงในโค้ดแทนการอ่านไฟล์ .sql ตอนรัน เพราะทำให้แพ็กโปรแกรมลง Windows
 * ได้โดยไม่ต้องกังวลว่าไฟล์ประกอบจะถูกคัดลอกไปด้วยหรือไม่
 */

export const SCHEMA_SQL = String.raw`
-- โครงสร้างฐานข้อมูล POS ปั๊มน้ำมัน
-- หน่วยตัวเลขทั้งหมดเป็นจำนวนเต็ม: เงิน = สตางค์, ปริมาตร = มิลลิลิตร

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- ผู้ใช้งาน -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin','manager','cashier','attendant')),
  pin_hash      TEXT    NOT NULL,
  pin_salt      TEXT    NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- สินค้า / ราคา ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#2563eb',
  unit_price  INTEGER NOT NULL,           -- สตางค์ต่อลิตร
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS price_changes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  old_price       INTEGER NOT NULL,
  new_price       INTEGER NOT NULL,
  changed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  changed_by      INTEGER REFERENCES users(id),
  pushed_to_pumps INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_price_changes_product ON price_changes(product_id, changed_at);

-- ถังน้ำมัน -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tanks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  capacity    INTEGER NOT NULL,           -- มิลลิลิตร
  book_level  INTEGER NOT NULL DEFAULT 0  -- มิลลิลิตร
);

CREATE TABLE IF NOT EXISTS tank_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tank_id     INTEGER NOT NULL REFERENCES tanks(id),
  type        TEXT    NOT NULL CHECK (type IN ('delivery','sale','adjust','dip')),
  volume      INTEGER NOT NULL,           -- + รับเข้า / - จ่ายออก
  ref_id      INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_tank_movements_tank ON tank_movements(tank_id, created_at);

-- ตู้จ่าย / หัวจ่าย ------------------------------------------------------
CREATE TABLE IF NOT EXISTS pumps (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT    NOT NULL,
  address  INTEGER NOT NULL,
  bus_id   TEXT    NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (bus_id, address)
);

CREATE TABLE IF NOT EXISTS nozzles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pump_id     INTEGER NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,           -- 1 = หัว A, 2 = หัว B (ตามป้ายบอร์ด ZB01)
  label       TEXT    NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  tank_id     INTEGER REFERENCES tanks(id),
  enabled     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (pump_id, idx)
);

-- กะ --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('open','closed')),
  opened_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT,
  opened_by     INTEGER NOT NULL REFERENCES users(id),
  closed_by     INTEGER REFERENCES users(id),
  opening_float INTEGER NOT NULL DEFAULT 0,
  counted_cash  INTEGER,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);

CREATE TABLE IF NOT EXISTS shift_readings (
  shift_id      INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  nozzle_id     INTEGER NOT NULL REFERENCES nozzles(id),
  open_volume   INTEGER NOT NULL,
  open_amount   INTEGER NOT NULL,
  close_volume  INTEGER,
  close_amount  INTEGER,
  PRIMARY KEY (shift_id, nozzle_id)
);

-- การขาย ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no           TEXT    NOT NULL UNIQUE,
  shift_id         INTEGER REFERENCES shifts(id),
  nozzle_id        INTEGER NOT NULL REFERENCES nozzles(id),
  pump_id          INTEGER NOT NULL REFERENCES pumps(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  volume           INTEGER NOT NULL,      -- มิลลิลิตร
  unit_price       INTEGER NOT NULL,      -- สตางค์/ลิตร
  amount           INTEGER NOT NULL,      -- สตางค์
  status           TEXT    NOT NULL CHECK (status IN ('pending','paid','void')),
  started_at       TEXT    NOT NULL,
  ended_at         TEXT    NOT NULL,
  paid_at          TEXT,
  cashier_id       INTEGER REFERENCES users(id),
  attendant_id     INTEGER REFERENCES users(id),
  vehicle_plate    TEXT,
  customer_id      INTEGER,
  note             TEXT,
  totalizer_start  INTEGER NOT NULL DEFAULT 0,
  totalizer_end    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_ended ON sales(ended_at);
CREATE INDEX IF NOT EXISTS idx_sales_nozzle ON sales(nozzle_id, ended_at);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method      TEXT    NOT NULL CHECK (method IN ('cash','qr','card','credit','coupon','fleet')),
  amount      INTEGER NOT NULL,
  tendered    INTEGER,
  change      INTEGER,
  reference   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

-- ตั้งค่า / บันทึกการใช้งาน ---------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id  INTEGER REFERENCES users(id),
  action   TEXT    NOT NULL,
  detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`;
