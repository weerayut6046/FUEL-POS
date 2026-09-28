/** ตัวช่วยแปลงหน่วย — ทั้งระบบเก็บเป็นจำนวนเต็ม (สตางค์ / มิลลิลิตร) */

export const toSatang = (baht: number): number => Math.round(baht * 100);
export const toMl = (litres: number): number => Math.round(litres * 1000);
export const toBaht = (satang: number): number => satang / 100;
export const toLitres = (ml: number): number => ml / 1000;

const fmt = (n: number, d: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

export const baht = (satang: number, d = 2): string => fmt(satang / 100, d);
export const litres = (ml: number, d = 2): string => fmt(ml / 1000, d);
export const price = (satangPerLitre: number): string => (satangPerLitre / 100).toFixed(2);
export const int = (n: number): string => n.toLocaleString('th-TH');

/** ลิตร × ราคา → สตางค์ (ปัดครึ่งขึ้น) */
export const calcAmount = (ml: number, satangPerLitre: number): number =>
  Math.round((ml * satangPerLitre) / 1000);

/** สตางค์ ÷ ราคา → มิลลิลิตร */
export const calcVolume = (satang: number, satangPerLitre: number): number =>
  satangPerLitre <= 0 ? 0 : Math.round((satang * 1000) / satangPerLitre);

/** แปลงข้อความตัวเลขที่ผู้ใช้พิมพ์ (อาจมี , ) เป็น number; ไม่ถูกต้อง → NaN */
export const parseNum = (s: string): number => {
  const cleaned = s.replace(/,/g, '').trim();
  if (cleaned === '') return NaN;
  return Number(cleaned);
};

/** จำนวนเงินเป็นตัวอักษรไทย (สำหรับใบกำกับภาษี) */
export function bahtText(satang: number): string {
  const digits = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const units = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const readGroup = (n: number, afterMillion = false): string => {
    // อ่านเลขไม่เกิน 6 หลัก
    const s = String(n);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = Number(s[i]);
      const pos = s.length - i - 1;
      if (d === 0) continue;
      if (pos === 0 && d === 1 && (s.length > 1 || afterMillion)) out += 'เอ็ด';
      else if (pos === 1 && d === 2) out += 'ยี่';
      else if (pos === 1 && d === 1) out += '';
      else out += digits[d];
      out += units[pos];
    }
    return out;
  };
  const readNumber = (n: number): string => {
    if (n === 0) return 'ศูนย์';
    let out = '';
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    if (millions > 0) out += readNumber(millions) + 'ล้าน';
    if (rest > 0) out += readGroup(rest, millions > 0);
    return out;
  };
  const abs = Math.abs(Math.round(satang));
  const b = Math.floor(abs / 100);
  const st = abs % 100;
  let text = readNumber(b) + 'บาท';
  text += st === 0 ? 'ถ้วน' : readNumber(st) + 'สตางค์';
  return (satang < 0 ? 'ลบ' : '') + text;
}

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** YYYY-MM ของเวลาท้องถิ่น */
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
export const dayKey = (d = new Date()) => `${monthKey(d)}-${pad(d.getDate(), 2)}`;

export const thDate = (iso: string) =>
  new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
export const thDateTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
export const thTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
export const thMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
};
