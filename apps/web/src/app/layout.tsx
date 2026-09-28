import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Thai, Share_Tech_Mono } from 'next/font/google';
import './globals.css';

const thai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-thai',
});
const lcd = Share_Tech_Mono({ subsets: ['latin'], weight: '400', variable: '--font-lcd-face' });

export const metadata: Metadata = {
  title: 'FUEL-POS Cloud · ระบบ POS ปั๊มน้ำมัน',
  description: 'ขายน้ำมัน · ตัดกะด้วยมิเตอร์หน้าตู้ · สต๊อกถัง · สมาชิกสะสมแต้ม · ใบกำกับภาษีเต็มรูป',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1224',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${thai.variable} ${lcd.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
