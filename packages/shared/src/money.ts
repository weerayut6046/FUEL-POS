/** ตัวช่วยแปลงหน่วย — ทั้งระบบเก็บเป็น integer เสมอ (สตางค์ / มิลลิลิตร) */

export const SATANG_PER_BAHT = 100;
export const ML_PER_LITRE = 1000;

/** สตางค์ → บาท (number, ใช้แสดงผลเท่านั้น) */
export const toBaht = (satang: number): number => satang / SATANG_PER_BAHT;

/** บาท → สตางค์ (ปัดครึ่งขึ้น) */
export const toSatang = (baht: number): number => Math.round(baht * SATANG_PER_BAHT);

/** มิลลิลิตร → ลิตร */
export const toLitres = (ml: number): number => ml / ML_PER_LITRE;

/** ลิตร → มิลลิลิตร */
export const toMl = (litres: number): number => Math.round(litres * ML_PER_LITRE);

export const formatBaht = (satang: number, decimals = 2): string =>
  toBaht(satang).toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export const formatLitres = (ml: number, decimals = 2): string =>
  toLitres(ml).toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** ราคา สตางค์/ลิตร แสดงเป็น บาท/ลิตร (2 ตำแหน่ง) */
export const formatPrice = (satangPerLitre: number): string =>
  (satangPerLitre / SATANG_PER_BAHT).toFixed(2);

/**
 * คำนวณยอดเงินจากปริมาตร
 * ml (มิลลิลิตร) × price (สตางค์/ลิตร) ÷ 1000 = สตางค์
 * ปัดตามหลักการค้าปลีกน้ำมัน: ปัดเศษครึ่งขึ้นเป็นสตางค์
 */
export const calcAmount = (ml: number, satangPerLitre: number): number =>
  Math.round((ml * satangPerLitre) / ML_PER_LITRE);

/**
 * คำนวณปริมาตรจากยอดเงิน (ใช้ตอน preset เป็นบาท)
 * satang × 1000 ÷ (สตางค์/ลิตร) = มิลลิลิตร
 */
export const calcVolume = (satang: number, satangPerLitre: number): number =>
  satangPerLitre <= 0 ? 0 : Math.round((satang * ML_PER_LITRE) / satangPerLitre);
