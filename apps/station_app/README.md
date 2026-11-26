# แอปปั๊มน้ำมัน (Flutter)

แอปเดียวสำหรับทุกบทบาท — ปรับหน้าจอตามขนาดจอ

- **พนักงานหน้าลาน (มือถือ):** เปิดกะ · จดเลขมิเตอร์ทีละหัวพร้อมรูป · บันทึกเงินส่ง · ส่งปิดกะ · วัดถัง
- **ผู้จัดการ (แท็บเล็ต):** ตรวจและยืนยันกะ · รับน้ำมัน · เทียบยอดถัง · ตั้งราคา/ถัง/หัวจ่าย/พนักงาน
- **เจ้าของ (คอมพิวเตอร์/เว็บ):** Dashboard หลายคอลัมน์ · ตั้งค่า LINE · เกณฑ์แจ้งเตือน

ใช้งานออฟไลน์ได้: ทุกการบันทึกลงคิวในเครื่อง (SQLite ผ่าน drift) แล้วซิงก์อัตโนมัติเมื่อเน็ตกลับมา
มุมขวาบนแสดงสถานะ — กดเพื่อดูรายการรอส่ง/ส่งไม่ผ่าน

## รัน

```bash
flutter pub get
flutter run -d chrome --dart-define=API_URL=http://localhost:8080/api/v1
# หรือ -d android / ios / windows / macos / linux
```

ที่อยู่เซิร์ฟเวอร์แก้ได้ที่หน้าเข้าสู่ระบบ ("ตั้งค่าเซิร์ฟเวอร์")

## โครงสร้าง

```
lib/
  core/        units (สตางค์/มิลลิลิตร) · shift_calc (สูตรเดียวกับเซิร์ฟเวอร์) · api (dio)
               local_db (drift) · sync (คิวออฟไลน์) · session · responsive
  features/    auth · home (เมนูปรับตามจอ) · shifts · stock · dashboard · settings · sync
  widgets/     ส่วนประกอบร่วม · กราฟแท่ง
web/           sqlite3.wasm + drift_worker.js (ฐานข้อมูลในเบราว์เซอร์)
assets/fonts/  Sarabun (SIL OFL) ฝังในแอป
```

แก้ตาราง drift แล้วต้องสร้างโค้ดใหม่: `dart run build_runner build --delete-conflicting-outputs`
(ไฟล์ `local_db.g.dart` commit ไว้แล้ว จึง build ได้โดยไม่ต้องรันคำสั่งนี้)

Flutter 3.50 แยก Material เป็นแพ็กเกจ `material_ui` — import `package:material_ui/material_ui.dart`
