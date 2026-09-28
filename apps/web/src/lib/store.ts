'use client';

/**
 * State ของแอปทั้งหมด (Zustand + persist)
 *
 * เวอร์ชันนี้เก็บข้อมูลใน localStorage ของเบราว์เซอร์ — ใช้งานได้ทันทีโดยไม่ต้องตั้งเซิร์ฟเวอร์
 * กฎธุรกิจทั้งหมดอยู่ใน domain.ts (pure) จึงย้ายไปฝั่ง API + ฐานข้อมูลได้โดยไม่ต้องแก้ตรรกะ
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Counters,
  Delivery,
  Dispenser,
  Employee,
  Member,
  MeterReading,
  Nozzle,
  PaymentMethod,
  Product,
  Promotion,
  Redemption,
  Reward,
  Sale,
  Shift,
  Station,
  StockMove,
  StockMoveType,
  Tank,
  TankDip,
  TaxInvoice,
  TimeEntry,
} from './types';
import {
  seedDispensers,
  seedEmployees,
  seedMembers,
  seedMeters,
  seedNozzles,
  seedProducts,
  seedPromotions,
  seedRewards,
  seedStation,
  seedTanks,
} from './seed';
import { priceSale, reconcileShift, vatSplit } from './domain';
import { dayKey, monthKey, pad, uid } from './units';

export interface Data {
  station: Station;
  products: Product[];
  tanks: Tank[];
  dispensers: Dispenser[];
  nozzles: Nozzle[];
  /** ค่ามิเตอร์ล่าสุดของแต่ละหัวจ่าย (อัปเดตตอนปิดกะ) */
  meters: Record<string, MeterReading>;
  employees: Employee[];
  timeEntries: TimeEntry[];
  members: Member[];
  rewards: Reward[];
  redemptions: Redemption[];
  promotions: Promotion[];
  shifts: Shift[];
  sales: Sale[];
  invoices: TaxInvoice[];
  deliveries: Delivery[];
  stockMoves: StockMove[];
  priceHistory: { productId: string; old: number; next: number; at: string; by: string | null }[];
  counters: Counters;
}

export interface SaleDraft {
  nozzleId: string;
  mode: 'amount' | 'volume';
  value: number;
  method: PaymentMethod;
  received: number;
  memberId: string | null;
  plate: string;
}

interface Actions {
  currentUserId: string | null;
  login: (pin: string) => Employee | null;
  logout: () => void;

  updateStation: (patch: Partial<Station>) => void;
  setPrice: (productId: string, price: number) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  updateTank: (id: string, patch: Partial<Tank>) => void;
  updateNozzle: (id: string, patch: Partial<Nozzle>) => void;
  setMeters: (m: Record<string, MeterReading>) => string | null;

  saveEmployee: (e: Omit<Employee, 'id' | 'code' | 'createdAt'> & { id?: string }) => void;
  clockToggle: (pin: string) => { employee: Employee; entry: TimeEntry; action: 'in' | 'out' } | string;

  saveMember: (m: Partial<Member> & { name: string; phone: string }) => Member;
  deleteMember: (id: string) => void;
  saveReward: (r: Omit<Reward, 'id'> & { id?: string }) => void;
  deleteReward: (id: string) => void;
  redeem: (memberId: string, rewardId: string) => string | null;
  savePromotion: (p: Omit<Promotion, 'id'> & { id?: string }) => void;
  deletePromotion: (id: string) => void;

  openShift: (input: { name: string; openingCash: number; readings: Record<string, MeterReading> }) => string | null;
  closeShift: (input: {
    readings: Record<string, MeterReading>;
    dips: TankDip[];
    countedCash: number;
    note: string;
    adjustToDip: boolean;
  }) => string | null;

  createSale: (draft: SaleDraft) => Sale | string;
  voidSale: (id: string, reason: string) => string | null;

  issueInvoice: (input: {
    saleIds: string[];
    customerName: string;
    customerTaxId: string;
    customerBranch: string;
    customerAddress: string;
    plate: string;
  }) => TaxInvoice | string;
  cancelInvoice: (id: string) => void;

  receiveDelivery: (d: Omit<Delivery, 'id' | 'at' | 'byEmployeeId'>) => string | null;
  adjustTank: (tankId: string, newLevel: number, note: string) => void;

  importData: (json: string) => string | null;
  resetAll: () => void;
}

export type Store = Data & Actions;

const initialData = (): Data => ({
  station: seedStation,
  products: seedProducts,
  tanks: seedTanks,
  dispensers: seedDispensers,
  nozzles: seedNozzles,
  meters: seedMeters,
  employees: seedEmployees,
  timeEntries: [],
  members: seedMembers,
  rewards: seedRewards,
  redemptions: [],
  promotions: seedPromotions(),
  shifts: [],
  sales: [],
  invoices: [],
  deliveries: [],
  stockMoves: [],
  priceHistory: [],
  counters: { receipt: 0, receiptDay: '', invoice: 0, invoiceMonth: '', shift: 0, member: seedMembers.length, employee: seedEmployees.length },
});

/** เคลื่อนไหวสต๊อกถัง + บันทึก ledger (คืนค่า tanks/stockMoves ชุดใหม่) */
function moveStock(
  s: Pick<Data, 'tanks' | 'stockMoves'>,
  tankId: string,
  delta: number,
  type: StockMoveType,
  ref: string,
  note = '',
): Pick<Data, 'tanks' | 'stockMoves'> {
  if (delta === 0) return s;
  let balance = 0;
  const tanks = s.tanks.map((t) => {
    if (t.id !== tankId) return t;
    balance = t.level + delta;
    return { ...t, level: balance };
  });
  const move: StockMove = { id: uid(), tankId, type, volume: delta, balance, ref, note, at: new Date().toISOString() };
  return { tanks, stockMoves: [move, ...s.stockMoves].slice(0, 5000) };
}

export const openShiftOf = (s: Pick<Data, 'shifts'>) => s.shifts.find((x) => x.status === 'open') ?? null;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initialData(),
      currentUserId: null,

      login: (pin) => {
        const e = get().employees.find((x) => x.active && x.pin === pin);
        if (e) set({ currentUserId: e.id });
        return e ?? null;
      },
      logout: () => set({ currentUserId: null }),

      updateStation: (patch) => set((s) => ({ station: { ...s.station, ...patch } })),
      setPrice: (productId, price) =>
        set((s) => {
          const p = s.products.find((x) => x.id === productId);
          if (!p || p.price === price) return {};
          return {
            products: s.products.map((x) => (x.id === productId ? { ...x, price } : x)),
            priceHistory: [
              { productId, old: p.price, next: price, at: new Date().toISOString(), by: s.currentUserId },
              ...s.priceHistory,
            ],
          };
        }),
      updateProduct: (id, patch) => set((s) => ({ products: s.products.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      updateTank: (id, patch) => set((s) => ({ tanks: s.tanks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      updateNozzle: (id, patch) => set((s) => ({ nozzles: s.nozzles.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

      setMeters: (m) => {
        if (openShiftOf(get())) return 'แก้ค่ามิเตอร์ตั้งต้นได้เฉพาะตอนไม่มีกะเปิดอยู่';
        set((s) => ({ meters: { ...s.meters, ...m } }));
        return null;
      },

      saveEmployee: (e) =>
        set((s) => {
          if (e.id) return { employees: s.employees.map((x) => (x.id === e.id ? { ...x, ...e, id: x.id } : x)) };
          const n = s.counters.employee + 1;
          const emp: Employee = { ...e, id: uid(), code: `EMP${pad(n, 3)}`, createdAt: new Date().toISOString() };
          return { employees: [...s.employees, emp], counters: { ...s.counters, employee: n } };
        }),

      clockToggle: (pin) => {
        const s = get();
        const employee = s.employees.find((x) => x.active && x.pin === pin);
        if (!employee) return 'PIN ไม่ถูกต้อง';
        const open = s.timeEntries.find((t) => t.employeeId === employee.id && !t.clockOut);
        const now = new Date().toISOString();
        if (open) {
          const entry = { ...open, clockOut: now };
          set({ timeEntries: s.timeEntries.map((t) => (t.id === open.id ? entry : t)) });
          return { employee, entry, action: 'out' };
        }
        const entry: TimeEntry = { id: uid(), employeeId: employee.id, clockIn: now, clockOut: null };
        set({ timeEntries: [entry, ...s.timeEntries] });
        return { employee, entry, action: 'in' };
      },

      saveMember: (m) => {
        const s = get();
        if (m.id) {
          const updated = { ...s.members.find((x) => x.id === m.id)!, ...m } as Member;
          set({ members: s.members.map((x) => (x.id === m.id ? updated : x)) });
          return updated;
        }
        const n = s.counters.member + 1;
        const member: Member = {
          id: uid(),
          code: `MB${pad(n, 5)}`,
          name: m.name,
          phone: m.phone,
          plate: m.plate ?? '',
          points: 0,
          totalSpent: 0,
          taxId: m.taxId ?? '',
          address: m.address ?? '',
          joinedAt: new Date().toISOString(),
        };
        set({ members: [member, ...s.members], counters: { ...s.counters, member: n } });
        return member;
      },
      deleteMember: (id) => set((s) => ({ members: s.members.filter((x) => x.id !== id) })),

      saveReward: (r) =>
        set((s) =>
          r.id
            ? { rewards: s.rewards.map((x) => (x.id === r.id ? { ...x, ...r, id: x.id } : x)) }
            : { rewards: [...s.rewards, { ...r, id: uid() }] },
        ),
      deleteReward: (id) => set((s) => ({ rewards: s.rewards.filter((x) => x.id !== id) })),

      redeem: (memberId, rewardId) => {
        const s = get();
        const m = s.members.find((x) => x.id === memberId);
        const r = s.rewards.find((x) => x.id === rewardId);
        if (!m || !r) return 'ไม่พบข้อมูล';
        if (!r.active) return 'ของรางวัลนี้ปิดใช้งาน';
        if (r.stock <= 0) return 'ของรางวัลหมด';
        if (m.points < r.points) return `แต้มไม่พอ (มี ${m.points} ต้องใช้ ${r.points})`;
        set({
          members: s.members.map((x) => (x.id === memberId ? { ...x, points: x.points - r.points } : x)),
          rewards: s.rewards.map((x) => (x.id === rewardId ? { ...x, stock: x.stock - 1 } : x)),
          redemptions: [
            { id: uid(), memberId, rewardId, points: r.points, at: new Date().toISOString(), byEmployeeId: s.currentUserId },
            ...s.redemptions,
          ],
        });
        return null;
      },

      savePromotion: (p) =>
        set((s) =>
          p.id
            ? { promotions: s.promotions.map((x) => (x.id === p.id ? { ...x, ...p, id: x.id } : x)) }
            : { promotions: [...s.promotions, { ...p, id: uid() }] },
        ),
      deletePromotion: (id) => set((s) => ({ promotions: s.promotions.filter((x) => x.id !== id) })),

      openShift: ({ name, openingCash, readings }) => {
        const s = get();
        if (openShiftOf(s)) return 'มีกะที่เปิดอยู่แล้ว ต้องปิดกะเดิมก่อน';
        if (!s.currentUserId) return 'กรุณาเข้าสู่ระบบ';
        const n = s.counters.shift + 1;
        const shift: Shift = {
          id: uid(),
          no: `S${pad(n, 5)}`,
          name,
          status: 'open',
          openedAt: new Date().toISOString(),
          openedBy: s.currentUserId,
          openingCash,
          openReadings: readings,
          tankLevelsAtOpen: Object.fromEntries(s.tanks.map((t) => [t.id, t.level])),
          closedAt: null,
          closedBy: null,
          closeReadings: null,
          dips: [],
          countedCash: null,
          note: '',
          summary: null,
        };
        set({ shifts: [shift, ...s.shifts], counters: { ...s.counters, shift: n } });
        return null;
      },

      closeShift: ({ readings, dips, countedCash, note, adjustToDip }) => {
        const s = get();
        const shift = openShiftOf(s);
        if (!shift) return 'ไม่มีกะที่เปิดอยู่';
        const summary = reconcileShift({
          shift,
          closeReadings: readings,
          dips,
          countedCash,
          sales: s.sales.filter((x) => x.shiftId === shift.id),
          deliveries: s.deliveries.filter((d) => d.at >= shift.openedAt),
          nozzles: s.nozzles,
          products: s.products,
          tankIds: s.tanks.map((t) => t.id),
          tolerancePct: s.station.stockTolerancePct,
        });

        // 1) ลิตรที่ออกจากหัวจ่ายตามมิเตอร์แต่ไม่ได้คีย์บิล → ตัดสต๊อกถังที่ผูกไว้เพิ่ม
        //    ทำให้สต๊อกตามบัญชี = ต้นกะ + รับเข้า − ลิตรตามมิเตอร์ เสมอ
        let stock: Pick<Data, 'tanks' | 'stockMoves'> = { tanks: s.tanks, stockMoves: s.stockMoves };
        for (const r of summary.nozzles) {
          const nozzle = s.nozzles.find((n) => n.id === r.nozzleId)!;
          stock = moveStock(stock, nozzle.tankId, -r.varVolume, 'meter_adjust', shift.no, `ปรับตามมิเตอร์หัว ${nozzle.label}`);
        }
        // 2) ปรับตามวัดจริง (ถ้าเลือก)
        if (adjustToDip) {
          for (const t of summary.tanks) {
            if (t.variance) stock = moveStock(stock, t.tankId, t.variance, 'dip_adjust', shift.no, 'ปรับตามวัดถังจริง');
          }
        }

        const closed: Shift = {
          ...shift,
          status: 'closed',
          closedAt: new Date().toISOString(),
          closedBy: s.currentUserId,
          closeReadings: readings,
          dips,
          countedCash,
          note,
          summary,
        };
        set({
          ...stock,
          shifts: s.shifts.map((x) => (x.id === shift.id ? closed : x)),
          meters: { ...s.meters, ...readings },
        });
        return null;
      },

      createSale: (d) => {
        const s = get();
        const shift = openShiftOf(s);
        if (!shift) return 'ยังไม่ได้เปิดกะ';
        if (!s.currentUserId) return 'กรุณาเข้าสู่ระบบ';
        const nozzle = s.nozzles.find((n) => n.id === d.nozzleId);
        if (!nozzle) return 'ไม่พบหัวจ่าย';
        const product = s.products.find((p) => p.id === nozzle.productId)!;
        if (!(d.value > 0)) return 'กรุณาระบุจำนวน';
        const r = priceSale({
          product,
          mode: d.mode,
          value: d.value,
          isMember: !!d.memberId,
          promotions: s.promotions,
          month: monthKey(),
          vatRate: s.station.vatRegistered ? s.station.vatRate : 0,
          bahtPerPoint: s.station.bahtPerPoint,
        });
        const tank = s.tanks.find((t) => t.id === nozzle.tankId)!;
        if (r.volume > tank.level) return `น้ำมันใน${tank.name} ไม่พอ`;
        if (d.method === 'cash' && d.received < r.net) return 'รับเงินไม่พอ';

        const today = dayKey().replace(/-/g, '').slice(2);
        const seq = s.counters.receiptDay === today ? s.counters.receipt + 1 : 1;
        const sale: Sale = {
          id: uid(),
          docNo: `R${today}-${pad(seq, 4)}`,
          shiftId: shift.id,
          nozzleId: nozzle.id,
          dispenserId: nozzle.dispenserId,
          productId: product.id,
          tankId: nozzle.tankId,
          volume: r.volume,
          unitPrice: product.price,
          gross: r.gross,
          discount: r.discount,
          net: r.net,
          vat: r.vat,
          beforeVat: r.beforeVat,
          method: d.method,
          received: d.method === 'cash' ? d.received : r.net,
          change: d.method === 'cash' ? d.received - r.net : 0,
          memberId: d.memberId,
          pointsEarned: r.points,
          promotionIds: r.applied.map((p) => p.id),
          plate: d.plate.trim(),
          employeeId: s.currentUserId,
          createdAt: new Date().toISOString(),
          status: 'paid',
          taxInvoiceId: null,
        };
        const stock = moveStock(s, nozzle.tankId, -r.volume, 'sale', sale.docNo, `หัว ${nozzle.label}`);
        set({
          ...stock,
          sales: [sale, ...s.sales],
          counters: { ...s.counters, receipt: seq, receiptDay: today },
          members: d.memberId
            ? s.members.map((m) =>
                m.id === d.memberId ? { ...m, points: m.points + r.points, totalSpent: m.totalSpent + r.net } : m,
              )
            : s.members,
        });
        return sale;
      },

      voidSale: (id, reason) => {
        const s = get();
        const sale = s.sales.find((x) => x.id === id);
        if (!sale || sale.status === 'void') return 'ไม่พบรายการ';
        const shift = s.shifts.find((x) => x.id === sale.shiftId);
        if (shift?.status !== 'open') return 'ยกเลิกได้เฉพาะรายการในกะที่ยังเปิดอยู่';
        if (sale.taxInvoiceId && s.invoices.find((i) => i.id === sale.taxInvoiceId)?.status === 'issued')
          return 'รายการนี้ออกใบกำกับภาษีแล้ว ต้องยกเลิกใบกำกับก่อน';
        const stock = moveStock(s, sale.tankId, sale.volume, 'void', sale.docNo, `ยกเลิก: ${reason}`);
        set({
          ...stock,
          sales: s.sales.map((x) => (x.id === id ? { ...x, status: 'void', voidReason: reason } : x)),
          members: sale.memberId
            ? s.members.map((m) =>
                m.id === sale.memberId
                  ? { ...m, points: Math.max(0, m.points - sale.pointsEarned), totalSpent: m.totalSpent - sale.net }
                  : m,
              )
            : s.members,
        });
        return null;
      },

      issueInvoice: (input) => {
        const s = get();
        const sales = s.sales.filter((x) => input.saleIds.includes(x.id));
        if (sales.length === 0) return 'กรุณาเลือกรายการขาย';
        if (sales.some((x) => x.status !== 'paid')) return 'มีรายการที่ถูกยกเลิก';
        if (sales.some((x) => x.taxInvoiceId && s.invoices.find((i) => i.id === x.taxInvoiceId)?.status === 'issued'))
          return 'มีรายการที่ออกใบกำกับภาษีไปแล้ว';
        if (!input.customerName.trim()) return 'กรุณาระบุชื่อผู้ซื้อ';
        if (input.customerTaxId && !/^\d{13}$/.test(input.customerTaxId)) return 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';

        const month = monthKey().replace('-', '');
        const seq = s.counters.invoiceMonth === month ? s.counters.invoice + 1 : 1;
        const total = sales.reduce((a, x) => a + x.net, 0);
        const { vat, beforeVat } = vatSplit(total, s.station.vatRegistered ? s.station.vatRate : 0);
        const inv: TaxInvoice = {
          id: uid(),
          no: `INV${month}-${pad(seq, 4)}`,
          saleIds: sales.map((x) => x.id),
          customerName: input.customerName.trim(),
          customerTaxId: input.customerTaxId.trim(),
          customerBranch: input.customerBranch.trim(),
          customerAddress: input.customerAddress.trim(),
          plate: input.plate.trim(),
          issuedAt: new Date().toISOString(),
          issuedBy: s.currentUserId ?? '',
          lines: sales.map((x) => ({
            productId: x.productId,
            volume: x.volume,
            unitPrice: x.unitPrice,
            gross: x.gross,
            discount: x.discount,
            net: x.net,
          })),
          total,
          vat,
          beforeVat,
          status: 'issued',
        };
        set({
          invoices: [inv, ...s.invoices],
          sales: s.sales.map((x) => (inv.saleIds.includes(x.id) ? { ...x, taxInvoiceId: inv.id } : x)),
          counters: { ...s.counters, invoice: seq, invoiceMonth: month },
        });
        return inv;
      },
      cancelInvoice: (id) =>
        set((s) => ({
          invoices: s.invoices.map((i) => (i.id === id ? { ...i, status: 'cancelled' } : i)),
          sales: s.sales.map((x) => (x.taxInvoiceId === id ? { ...x, taxInvoiceId: null } : x)),
        })),

      receiveDelivery: (d) => {
        const s = get();
        const tank = s.tanks.find((t) => t.id === d.tankId);
        if (!tank) return 'ไม่พบถัง';
        if (!(d.volume > 0)) return 'กรุณาระบุจำนวนลิตร';
        if (tank.level + d.volume > tank.capacity)
          return `เกินความจุถัง (รับได้อีกไม่เกิน ${((tank.capacity - tank.level) / 1000).toLocaleString('th-TH')} ลิตร)`;
        const delivery: Delivery = { ...d, id: uid(), at: new Date().toISOString(), byEmployeeId: s.currentUserId };
        const stock = moveStock(s, d.tankId, d.volume, 'delivery', d.docNo || 'รับน้ำมัน', d.supplier);
        set({ ...stock, deliveries: [delivery, ...s.deliveries] });
        return null;
      },
      adjustTank: (tankId, newLevel, note) => {
        const s = get();
        const tank = s.tanks.find((t) => t.id === tankId);
        if (!tank) return;
        set(moveStock(s, tankId, newLevel - tank.level, 'manual', 'ปรับสต๊อก', note));
      },

      importData: (json) => {
        try {
          const data = JSON.parse(json) as Partial<Data>;
          if (!data.products || !data.tanks || !data.nozzles) return 'ไฟล์ไม่ถูกต้อง';
          set({ ...initialData(), ...data, currentUserId: null });
          return null;
        } catch {
          return 'อ่านไฟล์ไม่ได้';
        }
      },
      resetAll: () => set({ ...initialData(), currentUserId: null }),
    }),
    {
      name: 'fuel-pos-cloud',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
);

export const dataKeys: (keyof Data)[] = Object.keys(initialData()) as (keyof Data)[];

export const useCurrentUser = () =>
  useStore((s) => s.employees.find((e) => e.id === s.currentUserId) ?? null);
