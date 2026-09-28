import { describe, expect, it } from 'vitest';
import { meterDiff, priceSale, reconcileShift, splitMeterDisplay, vatSplit } from '@/lib/domain';
import { seedMeters, seedNozzles, seedProducts, seedTanks } from '@/lib/seed';
import { bahtText } from '@/lib/units';
import type { Promotion, Sale, Shift } from '@/lib/types';

const g95 = seedProducts[0];
const dsl = seedProducts[1];

describe('มิเตอร์หน้าตู้', () => {
  it('แยกค่าเป็น 2 บรรทัดตามจอจริง', () => {
    expect(splitMeterDisplay(seedMeters['D1-L'].volume, 2)).toEqual({ top: '40', bottom: '5117.80' });
    expect(splitMeterDisplay(seedMeters['D1-L'].amount, 1)).toEqual({ top: '87', bottom: '90824.6' });
    expect(splitMeterDisplay(seedMeters['D2-R'].amount, 1)).toEqual({ top: '2', bottom: '78077.6' });
    expect(splitMeterDisplay(seedMeters['D2-R'].volume, 2)).toEqual({ top: '30', bottom: '0236.03' });
  });

  it('คำนวณส่วนต่างเมื่อมิเตอร์วนกลับศูนย์', () => {
    expect(meterDiff(100, 250)).toBe(150);
    expect(meterDiff(999_999_000, 500)).toBe(1500);
  });
});

describe('ราคาและ VAT', () => {
  it('ถอด VAT 7% จากราคารวม', () => {
    expect(vatSplit(10700, 7)).toEqual({ vat: 700, beforeVat: 10000 });
  });

  it('ขายเป็นบาท → คำนวณลิตร', () => {
    const r = priceSale({ product: g95, mode: 'amount', value: 50000, isMember: false, promotions: [], month: '2026-09', vatRate: 7, bahtPerPoint: 25 });
    expect(r.volume).toBe(12318); // 500 / 40.59 = 12.318 ลิตร
    expect(r.net).toBe(50000);
    expect(r.points).toBe(0);
  });

  it('ใช้โปรส่วนลดต่อลิตรและคูณแต้มกับสมาชิก', () => {
    const promos: Promotion[] = [
      { id: 'a', name: '', description: '', month: '2026-09', type: 'discount_per_liter', value: 30, productIds: ['DSL'], minAmount: 50000, membersOnly: true, active: true },
      { id: 'b', name: '', description: '', month: '2026-09', type: 'points_multiplier', value: 2, productIds: [], minAmount: 0, membersOnly: true, active: true },
      { id: 'c', name: '', description: '', month: '2026-08', type: 'percent_discount', value: 50, productIds: [], minAmount: 0, membersOnly: false, active: true },
    ];
    const r = priceSale({ product: dsl, mode: 'volume', value: 20000, isMember: true, promotions: promos, month: '2026-09', vatRate: 7, bahtPerPoint: 25 });
    expect(r.gross).toBe(81580);
    expect(r.discount).toBe(600);
    expect(r.net).toBe(80980);
    expect(r.points).toBe(64); // floor(809.80/25)=32 ×2
    expect(r.applied.map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('กระทบยอดปิดกะ', () => {
  it('จับลิตรที่จ่ายแต่ไม่ได้คีย์ และคำนวณเงินสดที่ต้องส่ง', () => {
    const shift: Shift = {
      id: 's', no: 'S1', name: '', status: 'open', openedAt: '', openedBy: 'E1', openingCash: 200000,
      openReadings: seedMeters, tankLevelsAtOpen: { T1: 3_200_000, T2: 2_800_000, T3: 3_500_000 },
      closedAt: null, closedBy: null, closeReadings: null, dips: [], countedCash: null, note: '', summary: null,
    };
    const close = structuredClone(seedMeters);
    close['D1-L'] = { volume: close['D1-L'].volume + 30000, amount: close['D1-L'].amount + 121770 }; // 30 L
    const sale = { id: 'x', shiftId: 's', nozzleId: 'D1-L', status: 'paid', volume: 20000, gross: 81180, net: 81180, discount: 0, method: 'qr' } as Sale;
    const r = reconcileShift({
      shift, closeReadings: close, dips: [{ tankId: 'T1', measured: 3_170_000 }], countedCash: 240590,
      sales: [sale], deliveries: [], nozzles: seedNozzles, products: seedProducts,
      tankIds: seedTanks.map((t) => t.id), tolerancePct: 0.5,
    });
    const n = r.nozzles.find((x) => x.nozzleId === 'D1-L')!;
    expect(n.meterVolume).toBe(30000);
    expect(n.varVolume).toBe(10000);
    expect(r.expectedCash).toBe(200000 + 121770 - 81180);
    expect(r.cashDiff).toBe(0);
    expect(r.tanks.find((t) => t.tankId === 'T1')).toMatchObject({ expected: 3_170_000, variance: 0 });
    expect(r.tanks.find((t) => t.tankId === 'T3')).toMatchObject({ meterOut: 0, dip: null });
  });
});

describe('จำนวนเงินตัวอักษร', () => {
  it('อ่านเป็นภาษาไทย', () => {
    expect(bahtText(121_50)).toBe('หนึ่งร้อยยี่สิบเอ็ดบาทห้าสิบสตางค์');
    expect(bahtText(1_000_001_00)).toBe('หนึ่งล้านเอ็ดบาทถ้วน');
    expect(bahtText(11_00)).toBe('สิบเอ็ดบาทถ้วน');
  });
});
