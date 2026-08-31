@echo off
REM ============================================================
REM  เริ่มระบบ POS ปั๊มน้ำมัน บน Windows (ไม่ต้องติดตั้งเป็นโปรแกรม)
REM  ต้องมี Node.js เวอร์ชัน 22 ขึ้นไปติดตั้งไว้ก่อน
REM ============================================================

setlocal
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo [ผิดพลาด] ไม่พบ Node.js ในเครื่อง
  echo กรุณาติดตั้ง Node.js เวอร์ชัน 22 ขึ้นไปจาก https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo [ผิดพลาด] ต้องใช้ Node.js 22 ขึ้นไป ^(พบเวอร์ชัน %NODE_MAJOR%^)
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo กำลังติดตั้งไลบรารีที่จำเป็น...
  call npm install || goto :error
)

if not exist "apps\server\dist\main.js" (
  echo กำลังสร้างไฟล์โปรแกรม...
  call npm run build || goto :error
)

echo.
echo เริ่มระบบ POS แล้ว — เปิดเบราว์เซอร์ไปที่ http://localhost:4000
echo กด Ctrl+C เพื่อหยุดระบบ
echo.

start "" http://localhost:4000
node --disable-warning=ExperimentalWarning apps\server\dist\main.js
goto :eof

:error
echo.
echo เกิดข้อผิดพลาดระหว่างเตรียมระบบ
pause
exit /b 1
