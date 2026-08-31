# 3. คู่มืออ้างอิงไฟล์ Protocol Profile

ไฟล์ JSON หนึ่งไฟล์ = โปรโตคอลหนึ่งแบบ วางไว้ที่:

- `packages/pump-core/profiles/` — โปรไฟล์ที่มากับโปรแกรม
- `data/profiles/` — โปรไฟล์ของผู้ใช้ (**มีลำดับความสำคัญเหนือกว่า** ถ้า `id` ซ้ำกัน)

ค่าไบต์เขียนได้ทั้ง `2`, `"0x02"` และ `"02"` เลือกแบบที่อ่านง่ายที่สุด
คีย์ที่ขึ้นต้นด้วย `_` (เช่น `_frameLayout`) จะถูกละเว้น ใช้เขียนคำอธิบายได้

---

## โครงสร้างโดยรวม

```jsonc
{
  "id": "zb01-ของฉัน",          // ต้องตรงกับชื่อไฟล์
  "name": "ชื่อที่แสดงในหน้าจอ",
  "unverified": true,            // true = ยังไม่ยืนยันกับตู้จริง (แสดงป้ายเตือน)
  "serial":     { ... },         // พารามิเตอร์พอร์ตอนุกรม
  "framing":    { ... },         // วิธีตัดเฟรม
  "checksum":   { ... },         // สูตรตรวจสอบความถูกต้อง
  "numbers":    { ... },         // จำนวนทศนิยมของแต่ละค่า
  "addressing": { ... },         // ตำแหน่ง address ในเฟรม
  "timing":     { ... },         // จังหวะการสื่อสาร
  "pollGranularity": "per_nozzle",
  "nozzlesPerPump": 2,
  "requests":   { ... },         // คำสั่งที่ POS ส่งไปตู้
  "responses":  [ ... ],         // คำตอบที่ตู้ส่งกลับ
  "statusMap":  { ... }          // แปลงเลขสถานะเป็นสถานะในระบบ
}
```

---

## `serial` — พารามิเตอร์พอร์ตอนุกรม

```json
{
  "baudRate": 9600,
  "dataBits": 8,
  "stopBits": 1,
  "parity": "none",
  "rtsControl": false,
  "rtsPreDelayMs": 1,
  "rtsPostDelayMs": 2
}
```

`rtsControl` เปิดเมื่อตัวแปลง RS-485 ของคุณ**ไม่มี** วงจรสลับทิศทางอัตโนมัติ
ตัวแปลงส่วนใหญ่ในท้องตลาดมีมาให้แล้ว จึงตั้ง `false` ได้

---

## `framing` — วิธีตัดเฟรม

### แบบ `delimited` (ใช้บ่อยที่สุด)

```json
{
  "kind": "delimited",
  "stx": ["0x02"],
  "etx": ["0x03"],
  "escape": "0x10",
  "maxLength": 64
}
```

**`escape` สำคัญมากเมื่อส่งข้อมูลไบนารี** — ถ้าไบต์ข้อมูลมีค่าเท่ากับ STX/ETX
มันจะถูกใส่ไบต์ escape นำหน้า มิฉะนั้นเฟรมจะถูกตัดผิดที่
ตั้งเป็น `null` เฉพาะเมื่อแน่ใจว่าข้อมูลไม่มีทางชนกับ STX/ETX (เช่นโปรโตคอล ASCII ล้วน)

> ลำดับการทำงาน: คำนวณ checksum ก่อน แล้วจึงทำ byte-stuffing
> ฝั่งรับถอด stuffing ออกก่อนตรวจ checksum

### แบบ `length`

```json
{
  "kind": "length",
  "stx": ["0x7E"],
  "lengthAt": 1,
  "lengthBytes": 1,
  "lengthEndian": "be",
  "lengthIncludes": "payload",
  "maxLength": 64
}
```

`lengthIncludes`:
- `"payload"` — ค่าความยาวนับเฉพาะไบต์ที่อยู่**หลัง**ไบต์ความยาว
- `"frame"` — ค่าความยาวคือความยาวทั้งเฟรมรวม STX

### แบบ `silence` (แบบ Modbus RTU)

```json
{ "kind": "silence", "silenceMs": 15, "maxLength": 256 }
```

ตัดเฟรมเมื่อบัสเงียบครบเวลาที่กำหนด ใช้กับโปรโตคอลที่ไม่มีไบต์เริ่ม/จบ

---

## `checksum`

```json
{
  "kind": "sum8",
  "from": 1,
  "to": -2,
  "at": -2,
  "endian": "le"
}
```

- `from` / `to` — ช่วงไบต์ที่นำมาคำนวณ (แบบ Python: `to` ไม่รวม, เลขติดลบนับจากท้าย)
- `at` — ตำแหน่งที่วางค่า checksum

สูตรที่รองรับ:

| ค่า | ความหมาย | ขนาด |
|---|---|---|
| `none` | ไม่มี checksum | 0 |
| `sum8` | ผลรวมไบต์ ตัดเหลือ 8 บิต | 1 |
| `sum8_2c` | ผลรวมแบบ two's complement | 1 |
| `xor8` | XOR ทุกไบต์ | 1 |
| `lrc` | LRC (เท่ากับ `sum8_2c`) | 1 |
| `crc8_maxim` | CRC-8/MAXIM (Dallas 1-Wire) | 1 |
| `crc16_modbus` | CRC-16/MODBUS | 2 |
| `crc16_ccitt_false` | CRC-16/CCITT-FALSE | 2 |

---

## `numbers` — จำนวนทศนิยมที่ตู้ส่งมา

```json
{
  "volumeDecimals": 2,
  "amountDecimals": 2,
  "priceDecimals": 2,
  "totalizerVolumeDecimals": 2,
  "totalizerAmountDecimals": 2
}
```

`volumeDecimals: 2` หมายถึงตู้ส่งค่า `1234` เพื่อสื่อถึง **12.34 ลิตร**

> ระบบเก็บข้อมูลภายในเป็นจำนวนเต็มเสมอ (มิลลิลิตร / สตางค์)
> จึงไม่มีปัญหาเศษทศนิยมสะสมในยอดขาย

---

## `addressing`

```json
{ "at": 1, "offset": 0, "responseAt": 1 }
```

- `at` — ตำแหน่งไบต์ address ในเฟรมคำสั่ง
- `offset` — ค่าที่บวกก่อนใส่ในเฟรม (ตู้บางรุ่นใช้ address 1 = `0x31` ให้ตั้ง `offset: 48`)
- `responseAt` — ตำแหน่ง address ในเฟรมคำตอบ (ถ้าไม่ระบุ ใช้ `at`)

---

## `timing`

```json
{
  "pollIntervalMs": 400,
  "responseTimeoutMs": 300,
  "interCommandDelayMs": 30,
  "retries": 1,
  "offlineAfterFailures": 3
}
```

`interCommandDelayMs` สำคัญกับ RS-485 — ต้องเว้นจังหวะให้อุปกรณ์สลับทิศทางสายเสร็จ
ถ้าตั้งน้อยเกินไปจะเกิดข้อมูลชนกันบนบัส

---

## `requests` — คำสั่งที่ส่งไปตู้

คำสั่งที่ระบบรู้จัก: `status`, `readTotalizer`, `authorize`, `presetAmount`,
`presetVolume`, `stop`, `clear`, `setPrice`, `readPrice`

คำสั่งไหนที่ตู้ไม่รองรับ ให้ตั้ง `"unsupported": true` — ระบบจะซ่อนฟีเจอร์นั้นออกจากหน้าจอ

```json
"presetAmount": {
  "expectResponse": true,
  "tokens": [
    { "kind": "address" },
    { "kind": "const", "bytes": ["0x22"] },
    { "kind": "var", "name": "nozzle", "encoding": "u8", "length": 1 },
    { "kind": "var", "name": "preset", "encoding": "bcd", "length": 3 }
  ]
}
```

`tokens` ประกอบกันตามลำดับเป็น payload (ยังไม่รวม STX/checksum/ETX ที่ระบบใส่ให้)

| kind | ความหมาย |
|---|---|
| `const` | ไบต์ตายตัว เช่น รหัสคำสั่ง |
| `address` | address ของตู้ |
| `var` | ค่าที่เปลี่ยนได้: `nozzle`, `preset`, `price`, `value`, `mode` |

`var` รับ `scale` และ `offset` เพิ่มได้ เช่นตู้ที่นับหัวจ่ายเริ่มจาก 0:
`{ "kind": "var", "name": "nozzle", "encoding": "u8", "length": 1, "offset": -1 }`

**การเข้ารหัสตัวเลข (`encoding`):**
`bcd`, `bcd_le`, `u8`, `u16le`, `u16be`, `u24le`, `u24be`, `u32le`, `u32be`, `ascii`

---

## `responses` — คำตอบจากตู้

```json
{
  "name": "status",
  "match": [{ "at": 2, "equals": "0x91" }],
  "fields": [
    { "name": "nozzle",          "at": 3,  "length": 1, "encoding": "u8"  },
    { "name": "status",          "at": 4,  "length": 1, "encoding": "u8"  },
    { "name": "volume",          "at": 5,  "length": 3, "encoding": "bcd" },
    { "name": "amount",          "at": 8,  "length": 3, "encoding": "bcd" },
    { "name": "unitPrice",       "at": 11, "length": 2, "encoding": "bcd" },
    { "name": "totalizerVolume", "at": 13, "length": 4, "encoding": "bcd" }
  ]
}
```

- `match` — เงื่อนไขระบุว่าเฟรมนี้คือคำตอบชนิดนี้ (ใส่ `mask` ได้ถ้าดูเฉพาะบางบิต)
- `at` นับจากไบต์แรกของเฟรม **หลังถอด byte-stuffing แล้ว** (รวม STX ด้วย)

ชื่อฟิลด์ที่ระบบเข้าใจ: `nozzle`, `status`, `volume`, `amount`, `unitPrice`,
`totalizerVolume`, `totalizerAmount`, `errorCode`

ใส่ `"divisor"` เพื่อกำหนดตัวหารเองแทนค่าจาก `numbers`
และ `"mask"` / `"shift"` เมื่อสถานะถูกอัดรวมอยู่ในไบต์เดียวกับข้อมูลอื่น

**ชื่อ response ที่ระบบใช้เป็นพิเศษ:**
- `status` — คำตอบของคำสั่ง `status`
- `totalizer` — คำตอบของ `readTotalizer`
- `ack` — คำตอบตอบรับคำสั่งทั่วไป

---

## `statusMap` — แปลงเลขสถานะ

```json
{
  "0": "idle",
  "1": "authorized",
  "2": "nozzle_out",
  "3": "filling",
  "4": "complete",
  "5": "stopped",
  "15": "error"
}
```

สถานะในระบบและความหมาย:

| สถานะ | ความหมาย | ระบบทำอะไร |
|---|---|---|
| `idle` | ว่าง | รับคำสั่งจ่ายได้ |
| `authorized` | ปลดล็อกแล้ว รอยกหัวจ่าย | — |
| `nozzle_out` | ยกหัวจ่ายแล้ว ยังไม่จ่าย | จับค่ามิเตอร์ตั้งต้น |
| `filling` | กำลังจ่าย | อัปเดตตัวเลขสดบนหน้าจอ |
| `complete` | จ่ายจบ | **สร้างรายการรอชำระเงิน + ล็อกหัวจ่าย** |
| `stopped` | หยุดกลางคัน | เหมือน complete |
| `offline` | ติดต่อไม่ได้ | แสดงเตือนบนหน้าจอ |
| `error` | ตู้แจ้งข้อผิดพลาด | แสดงรหัสข้อผิดพลาด |

---

## `pollGranularity`

- `"per_nozzle"` — ต้องถาม status ทีละหัวจ่าย (ส่ง `nozzle` ไปในคำสั่งด้วย)
- `"per_pump"` — ถามครั้งเดียวได้ข้อมูลทั้งตู้ (คำตอบมีฟิลด์ `nozzle` บอกว่าเป็นหัวไหน)

---

## ตรวจสอบโปรไฟล์

โปรไฟล์ที่รูปแบบไม่ถูกต้องจะถูกปฏิเสธพร้อมข้อความบอกทุกจุดที่ผิด เช่น:

```
โปรไฟล์ "zb01-ของฉัน.json" ไม่ถูกต้อง:
- responses[0].fields[2].encoding: ต้องระบุรูปแบบตัวเลข
- framing.etx ของโหมด delimited ต้องมีอย่างน้อย 1 ไบต์
```

ทดสอบโปรไฟล์ได้ทันทีในหน้า **ตั้งค่าตู้จ่าย → ถอดรหัส / ทดสอบคำสั่ง**
โดยวางไบต์ที่ดักจับมาแล้วดูว่าระบบตีความได้ตรงกับที่ตู้แสดงบนจอหรือไม่
