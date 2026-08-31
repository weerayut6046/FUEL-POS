import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER = process.env.FUEL_POS_SERVER ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // ตอนพัฒนา เรียก API ผ่าน proxy จึงไม่ต้องตั้ง CORS หรือแก้ URL ในโค้ด
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    // เครื่อง POS ในปั๊มมักเป็นเครื่องเก่า — คุมขนาดบันเดิลไว้
    chunkSizeWarningLimit: 700,
  },
});
