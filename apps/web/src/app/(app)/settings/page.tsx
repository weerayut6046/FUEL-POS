'use client';

import { useRef, useState } from 'react';
import { Database, Download, Fuel, Gauge, RotateCcw, Save, Settings, Store, Upload } from 'lucide-react';
import { useStore, openShiftOf, dataKeys } from '@/lib/store';
import type { Station } from '@/lib/types';
import { litres, parseNum, price, thDateTime, toMl, toSatang } from '@/lib/units';
import { Button, Card, CardHeader, cn, Field, Input, PageHeader, ProductDot, Select, Table, Textarea, Toggle, toast } from '@/components/ui';
import { MeterInput } from '@/components/Lcd';
import { RequirePerm } from '@/components/AppShell';

const TABS = [
  { id: 'store', label: 'ข้อมูลร้าน & VAT', icon: Store },
  { id: 'price', label: 'ราคาน้ำมัน', icon: Fuel },
  { id: 'equip', label: 'ตู้จ่าย / ถัง', icon: Gauge },
  { id: 'data', label: 'ข้อมูล & สำรอง', icon: Database },
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('store');
  return (
    <RequirePerm perm="settings">
      <PageHeader title="ตั้งค่าระบบ" subtitle="ข้อมูลร้าน ภาษี ราคา อุปกรณ์ และข้อมูลสำรอง" icon={<Settings className="size-5" />} />
      <div className="scroll-thin mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
              tab === t.id ? 'bg-brand-600 text-white shadow' : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'store' && <StoreTab />}
      {tab === 'price' && <PriceTab />}
      {tab === 'equip' && <EquipTab />}
      {tab === 'data' && <DataTab />}
    </RequirePerm>
  );
}

function StoreTab() {
  const s = useStore();
  const [f, setF] = useState<Station>(s.station);
  const set = <K extends keyof Station>(k: K, v: Station[K]) => setF({ ...f, [k]: v });
  return (
    <Card>
      <CardHeader title="ข้อมูลร้าน (แสดงบนใบเสร็จและใบกำกับภาษี)" />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="ชื่อสถานีบริการ / นิติบุคคล" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี 13 หลัก">
          <Input inputMode="numeric" maxLength={13} value={f.taxId} onChange={(e) => set('taxId', e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="สาขา">
          <Input value={f.branch} onChange={(e) => set('branch', e.target.value)} placeholder="สำนักงานใหญ่ / สาขาที่ 00001" />
        </Field>
        <Field label="ที่อยู่" className="sm:col-span-2">
          <Textarea value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="เบอร์โทร">
          <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="ข้อความท้ายใบเสร็จ">
          <Input value={f.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} />
        </Field>
        <div className="flex items-center sm:col-span-2">
          <Toggle checked={f.vatRegistered} onChange={(v) => set('vatRegistered', v)} label="จดทะเบียนภาษีมูลค่าเพิ่ม (ออกใบกำกับภาษีได้)" />
        </div>
        <Field label="อัตรา VAT (%)" hint="ราคาหน้าตู้รวม VAT แล้ว ระบบถอด VAT ออกจากยอดขาย">
          <Input inputMode="decimal" value={f.vatRate} onChange={(e) => set('vatRate', Number(e.target.value) || 0)} />
        </Field>
        <Field label="ยอดซื้อกี่บาทได้ 1 แต้ม">
          <Input inputMode="numeric" value={f.bahtPerPoint} onChange={(e) => set('bahtPerPoint', Number(e.target.value) || 0)} />
        </Field>
        <Field label="ความคลาดเคลื่อนสต๊อกที่ยอมรับ (% ของลิตรขาย)">
          <Input inputMode="decimal" value={f.stockTolerancePct} onChange={(e) => set('stockTolerancePct', Number(e.target.value) || 0)} />
        </Field>
      </div>
      <div className="flex justify-end border-t border-slate-100 p-4">
        <Button
          onClick={() => {
            if (f.taxId && !/^\d{13}$/.test(f.taxId)) return toast.error('เลขผู้เสียภาษีต้องเป็น 13 หลัก');
            s.updateStation(f);
            toast.success('บันทึกข้อมูลร้านแล้ว');
          }}
        >
          <Save className="size-4" /> บันทึก
        </Button>
      </div>
    </Card>
  );
}

function PriceTab() {
  const s = useStore();
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(s.products.map((p) => [p.id, price(p.price)])));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="ราคาขายปลีก (บาท/ลิตร รวม VAT)" />
        <div className="space-y-4 p-5">
          {s.products.map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_130px_56px] items-end gap-3">
              <Field label="ชื่อผลิตภัณฑ์">
                <Input value={p.name} onChange={(e) => s.updateProduct(p.id, { name: e.target.value })} />
              </Field>
              <Field label="ราคา">
                <Input inputMode="decimal" className="lcd text-right text-lg" value={prices[p.id]} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} />
              </Field>
              <Field label="สี">
                <input type="color" value={p.color} onChange={(e) => s.updateProduct(p.id, { color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-xl border border-slate-200" />
              </Field>
            </div>
          ))}
          <Button
            onClick={() => {
              for (const p of s.products) {
                const v = parseNum(prices[p.id]);
                if (!(v > 0)) return toast.error(`ราคา ${p.name} ไม่ถูกต้อง`);
              }
              s.products.forEach((p) => s.setPrice(p.id, toSatang(parseNum(prices[p.id]))));
              toast.success('อัปเดตราคาแล้ว — มีผลกับบิลถัดไป');
            }}
          >
            <Save className="size-4" /> บันทึกราคา
          </Button>
          <p className="text-xs text-slate-500">อย่าลืมตั้งราคาที่หน้าตู้จ่ายให้ตรงกัน — ถ้าเปลี่ยนราคากลางกะ ช่อง "ลิตร × ราคา" ในหน้าตัดกะจะไม่ตรงกับจอ P ซึ่งเป็นเรื่องปกติ</p>
        </div>
      </Card>
      <Card>
        <CardHeader title="ประวัติการเปลี่ยนราคา" />
        {s.priceHistory.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีการเปลี่ยนราคา</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>วันเวลา</th>
                <th>ผลิตภัณฑ์</th>
                <th className="text-right">เดิม</th>
                <th className="text-right">ใหม่</th>
              </tr>
            </thead>
            <tbody>
              {s.priceHistory.map((h, i) => (
                <tr key={i} className="tabular-nums">
                  <td>{thDateTime(h.at)}</td>
                  <td>{s.products.find((p) => p.id === h.productId)?.name}</td>
                  <td className="text-right">{price(h.old)}</td>
                  <td className={cn('text-right font-semibold', h.next > h.old ? 'text-rose-600' : 'text-emerald-600')}>{price(h.next)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function EquipTab() {
  const s = useStore();
  const hasShift = !!openShiftOf(s);
  const [meters, setMeters] = useState(() =>
    Object.fromEntries(Object.entries(s.meters).map(([k, v]) => [k, { L: (v.volume / 1000).toFixed(2), P: (v.amount / 100).toFixed(1) }])),
  );
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="ถังน้ำมัน" />
        <Table>
          <thead>
            <tr>
              <th>ถัง</th>
              <th>ผลิตภัณฑ์</th>
              <th>ความจุ (ลิตร)</th>
              <th>แจ้งเตือนต่ำกว่า (%)</th>
              <th className="text-right">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {s.tanks.map((t) => (
              <tr key={t.id}>
                <td>
                  <Input className="h-8" value={t.name} onChange={(e) => s.updateTank(t.id, { name: e.target.value })} />
                </td>
                <td>
                  <Select className="h-8" value={t.productId} onChange={(e) => s.updateTank(t.id, { productId: e.target.value })}>
                    {s.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <div className="w-28">
                    <Input
                      className="h-8"
                      inputMode="numeric"
                      defaultValue={t.capacity / 1000}
                      onBlur={(e) => {
                        const v = parseNum(e.target.value);
                        if (v > 0) s.updateTank(t.id, { capacity: toMl(v) });
                      }}
                    />
                  </div>
                </td>
                <td>
                  <div className="w-20">
                    <Input className="h-8" inputMode="numeric" value={t.lowPct} onChange={(e) => s.updateTank(t.id, { lowPct: Number(e.target.value) || 0 })} />
                  </div>
                </td>
                <td className="text-right tabular-nums">{litres(t.level)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="หัวจ่าย → ผลิตภัณฑ์ → ถัง" />
        <Table>
          <thead>
            <tr>
              <th>ตู้จ่าย</th>
              <th>หัวจ่าย</th>
              <th>ผลิตภัณฑ์</th>
              <th>ดูดจากถัง</th>
            </tr>
          </thead>
          <tbody>
            {s.nozzles.map((n) => {
              const p = s.products.find((x) => x.id === n.productId);
              const tankOk = s.tanks.find((t) => t.id === n.tankId)?.productId === n.productId;
              return (
                <tr key={n.id}>
                  <td>{s.dispensers.find((d) => d.id === n.dispenserId)?.name}</td>
                  <td>
                    <span className="flex items-center gap-2">
                      <ProductDot color={p?.color ?? '#999'} /> {n.label} ({n.side === 'L' ? 'จอซ้าย' : 'จอขวา'})
                    </span>
                  </td>
                  <td>
                    <Select className="h-8" disabled={hasShift} value={n.productId} onChange={(e) => s.updateNozzle(n.id, { productId: e.target.value })}>
                      {s.products.map((pp) => (
                        <option key={pp.id} value={pp.id}>
                          {pp.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <Select className={cn('h-8', !tankOk && 'border-rose-400')} disabled={hasShift} value={n.tankId} onChange={(e) => s.updateNozzle(n.id, { tankId: e.target.value })}>
                      {s.tanks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    {!tankOk && <p className="mt-1 text-xs text-rose-600">ผลิตภัณฑ์ของหัวจ่ายไม่ตรงกับถัง</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {hasShift && <p className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">ปิดกะก่อนจึงจะเปลี่ยนการผูกหัวจ่ายได้</p>}
      </Card>

      <Card>
        <CardHeader title="ค่ามิเตอร์สะสมล่าสุด (ใช้เป็นค่าเปิดกะถัดไป)" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {s.nozzles.map((n) => (
            <div key={n.id} className="space-y-2">
              <p className="text-sm font-semibold">หัว {n.label}</p>
              <MeterInput mode="P" value={meters[n.id]?.P ?? ''} onChange={(v) => setMeters({ ...meters, [n.id]: { ...meters[n.id], P: v } })} />
              <MeterInput mode="L" value={meters[n.id]?.L ?? ''} onChange={(v) => setMeters({ ...meters, [n.id]: { ...meters[n.id], L: v } })} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-4">
          <p className="text-xs text-slate-500">ใช้ตอนเริ่มใช้งานระบบครั้งแรก หรือหลังซ่อม/เปลี่ยนบอร์ดตู้จ่าย</p>
          <Button
            disabled={hasShift}
            onClick={() => {
              const out: Record<string, { volume: number; amount: number }> = {};
              for (const n of s.nozzles) {
                const L = parseNum(meters[n.id]?.L ?? '');
                const P = parseNum(meters[n.id]?.P ?? '');
                if (!Number.isFinite(L) || !Number.isFinite(P)) return toast.error(`มิเตอร์หัว ${n.label} ไม่ถูกต้อง`);
                out[n.id] = { volume: toMl(L), amount: toSatang(P) };
              }
              const err = s.setMeters(out);
              if (err) toast.error(err);
              else toast.success('บันทึกค่ามิเตอร์แล้ว');
            }}
          >
            <Save className="size-4" /> บันทึกมิเตอร์
          </Button>
        </div>
      </Card>
    </div>
  );
}

function DataTab() {
  const s = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = () => {
    const state = useStore.getState();
    const data = Object.fromEntries(dataKeys.map((k) => [k, state[k]]));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fuel-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Card>
      <CardHeader title="สำรองและกู้คืนข้อมูล" />
      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600">
          ข้อมูลเวอร์ชันนี้เก็บในเบราว์เซอร์ของเครื่องนี้ — ควรสำรองเป็นไฟล์ทุกวัน (บิล {s.sales.length.toLocaleString()} รายการ · กะ {s.shifts.length} กะ)
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportJson}>
            <Download className="size-4" /> ดาวน์โหลดไฟล์สำรอง
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> กู้คืนจากไฟล์
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (!confirm('ข้อมูลปัจจุบันจะถูกแทนที่ด้วยไฟล์สำรอง ดำเนินการต่อ?')) return;
              const err = s.importData(await file.text());
              if (err) toast.error(err);
              else toast.success('กู้คืนข้อมูลแล้ว กรุณาเข้าสู่ระบบใหม่');
            }}
          />
          <Button
            variant="danger"
            onClick={() => {
              if (confirm('ล้างข้อมูลทั้งหมดและกลับไปใช้ข้อมูลตัวอย่าง? (ไม่สามารถย้อนกลับได้)')) s.resetAll();
            }}
          >
            <RotateCcw className="size-4" /> ล้างข้อมูลทั้งหมด
          </Button>
        </div>
      </div>
    </Card>
  );
}
