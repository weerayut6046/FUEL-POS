import { createApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen({ port: config.port, host: config.host });
  console.log(`ระบบหลังบ้านปั๊มน้ำมัน (SaaS) พร้อมใช้งานที่ http://localhost:${config.port}/api/v1`);
  if (!config.line.channelAccessToken) {
    console.log('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN — ข้อความแจ้งเตือนจะถูกบันทึกแต่ไม่ส่ง');
  }
}

main().catch((err: Error) => {
  console.error('เริ่มระบบไม่สำเร็จ:', err);
  process.exit(1);
});
