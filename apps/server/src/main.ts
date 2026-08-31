import { buildApp } from './app.js';
import { configFile, loadConfig } from './config.js';
import { createContext } from './context.js';
import { seedIfEmpty } from './services/seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createContext(config);

  const seed = seedIfEmpty(ctx.db, ctx.auth, ctx.catalog, config);

  const app = await buildApp(ctx);

  await ctx.pumps.start();

  await app.listen({ host: config.http.host, port: config.http.port });

  const url = `http://localhost:${config.http.port}`;
  app.log.info(`ระบบ POS พร้อมใช้งานที่ ${url}`);
  app.log.info(`โหมดการทำงาน: ${config.mode === 'simulator' ? 'จำลอง (ไม่ต้องมีตู้จริง)' : 'ต่อตู้จ่ายจริง'}`);
  app.log.info(`ไฟล์ตั้งค่า: ${configFile()}`);

  if (seed.seeded) {
    app.log.warn('─'.repeat(60));
    app.log.warn(`สร้างผู้ใช้เริ่มต้นแล้ว — ชื่อผู้ใช้: admin  PIN: ${seed.adminPin}`);
    app.log.warn('กรุณาเปลี่ยน PIN ทันทีหลังเข้าสู่ระบบครั้งแรก');
    app.log.warn('─'.repeat(60));
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`ได้รับสัญญาณ ${signal} — กำลังปิดระบบ`);
    await ctx.pumps.stop();
    await app.close();
    ctx.db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: Error) => {
  console.error('เริ่มระบบไม่สำเร็จ:', err);
  process.exit(1);
});
