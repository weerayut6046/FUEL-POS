// @ts-check
'use strict';

/**
 * ตัวห่อหน้าจอ POS สำหรับติดตั้งเป็นโปรแกรมบน Windows
 *
 * แนวคิด: Electron ไม่ได้รันตรรกะของ POS เอง แต่เปิดเซิร์ฟเวอร์ Node
 * เป็นโปรเซสลูก แล้วเปิดหน้าต่างชี้ไปที่เซิร์ฟเวอร์นั้น
 *
 * ข้อดี:
 *  - ตรรกะทั้งหมดเหมือนกันไม่ว่าจะรันบน Windows, Linux หรือเป็นเซิร์ฟเวอร์กลาง
 *  - เครื่องอื่น (แท็บเล็ตหน้าลาน) เปิดเบราว์เซอร์เข้ามาที่เครื่องนี้ใช้งานพร้อมกันได้
 *  - ใช้ Node ที่มากับ Electron (ELECTRON_RUN_AS_NODE) จึงไม่ต้องติดตั้ง Node แยก
 */

const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PORT = Number(process.env.FUEL_POS_PORT || 4000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let serverLog = '';

/** รากของไฟล์โปรแกรม: ตอนติดตั้งแล้วอยู่ใน resources/app-payload */
function payloadRoot() {
  const packaged = path.join(process.resourcesPath || '', 'app-payload');
  if (fs.existsSync(packaged)) return packaged;
  // ตอนพัฒนา: apps/desktop → รากของ repo
  return path.resolve(__dirname, '..', '..');
}

function dataDir() {
  // เก็บฐานข้อมูลไว้ในโฟลเดอร์ข้อมูลผู้ใช้ เพื่อไม่ให้หายตอนอัปเดตโปรแกรม
  return path.join(app.getPath('userData'), 'data');
}

function startServer() {
  const root = payloadRoot();
  const entry = path.join(root, 'apps', 'server', 'dist', 'main.js');

  if (!fs.existsSync(entry)) {
    dialog.showErrorBox(
      'ไม่พบไฟล์เซิร์ฟเวอร์',
      `หาไฟล์ไม่พบ:\n${entry}\n\nกรุณารัน "npm run build" ที่รากของโปรเจกต์ก่อน`,
    );
    app.quit();
    return;
  }

  serverProcess = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      // บอก Electron ให้รันไฟล์นี้เป็น Node ธรรมดา ไม่ใช่โปรเซส Electron
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
      FUEL_POS_DATA: dataDir(),
      FUEL_POS_UI_DIR: path.join(root, 'apps', 'pos-ui', 'dist'),
      FUEL_POS_BUILTIN_PROFILES: path.join(root, 'packages', 'pump-core', 'profiles'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const capture = (/** @type {Buffer} */ chunk) => {
    serverLog = (serverLog + chunk.toString()).slice(-20000);
    process.stdout.write(chunk);
  };
  serverProcess.stdout?.on('data', capture);
  serverProcess.stderr?.on('data', capture);

  serverProcess.on('exit', (code) => {
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox(
        'เซิร์ฟเวอร์หยุดทำงาน',
        `เซิร์ฟเวอร์ปิดตัวด้วยรหัส ${code}\n\nบันทึกล่าสุด:\n${serverLog.slice(-2000)}`,
      );
    }
  });
}

/** รอจนเซิร์ฟเวอร์พร้อมรับงาน */
async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return true;
    } catch {
      /* ยังไม่พร้อม ลองใหม่ */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0b1220',
    title: 'ระบบ POS ปั๊มน้ำมัน',
    autoHideMenuBar: true,
    webPreferences: {
      // หน้าเว็บคุยกับเซิร์ฟเวอร์ผ่าน HTTP เท่านั้น ไม่ต้องเข้าถึง Node จากหน้าเว็บ
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  void mainWindow.loadURL(BASE_URL);

  // ลิงก์ภายนอกให้เปิดในเบราว์เซอร์ ไม่ใช่ในหน้าต่าง POS
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'ระบบ',
      submenu: [
        {
          label: 'โหลดหน้าจอใหม่',
          accelerator: 'F5',
          click: () => mainWindow?.reload(),
        },
        {
          label: 'เปิดในเบราว์เซอร์',
          click: () => void shell.openExternal(BASE_URL),
        },
        {
          label: 'เปิดโฟลเดอร์ข้อมูล',
          click: () => void shell.openPath(dataDir()),
        },
        { type: 'separator' },
        {
          label: 'เครื่องมือนักพัฒนา',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'ออกจากโปรแกรม' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(/** @type {any} */ (template)));
}

// อนุญาตให้เปิดโปรแกรมได้ครั้งเดียว — กันการเปิดเซิร์ฟเวอร์ซ้อนกันจนพอร์ตชนกัน
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    startServer();

    const ready = await waitForServer();
    if (!ready) {
      dialog.showErrorBox(
        'เริ่มเซิร์ฟเวอร์ไม่สำเร็จ',
        `รอเกิน 30 วินาทีแล้วยังติดต่อ ${BASE_URL} ไม่ได้\n\nบันทึกล่าสุด:\n${serverLog.slice(-2000)}`,
      );
      app.quit();
      return;
    }

    createWindow();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    serverProcess?.kill();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
