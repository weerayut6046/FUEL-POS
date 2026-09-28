'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Lock, PlayCircle, Printer, Scale } from 'lucide-react';
import { useStore, openShiftOf } from '@/lib/store';
import { METHOD_LABEL, reconcileShift } from '@/lib/domain';
import type { MeterReading, Shift, ShiftSummary, TankDip } from '@/lib/types';
import { baht, litres, parseNum, thDateTime, toMl, toSatang } from '@/lib/units';
import { Badge, Button, Card, CardHeader, cn, Field, Input, Modal, PageHeader, ProductDot, Stat, Table, Textarea, Toggle, toast } from '@/components/ui';
import { MeterInput, MeterLcd } from '@/components/Lcd';
import { RequirePerm } from '@/components/AppShell';

type ReadingText = Record<string, { L: string; P: string }>;

const toText = (r: Record<string, MeterReading>): ReadingText =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { L: (v.volume / 1000).toFixed(2), P: (v.amount / 100).toFixed(1) }]));

function parseReadings(t: ReadingText, ids: string[]): Record<string, MeterReading> | null {
  const out: Record<string, MeterReading> = {};
  for (const id of ids) {
    const L = parseNum(t[id]?.L ?? '');
    const P = parseNum(t[id]?.P ?? '');
    if (!Number.isFinite(L) || !Number.isFinite(P) || L < 0 || P < 0) return null;
    out[id] = { volume: toMl(L), amount: toSatang(P) };
  }
  return out;
}

function defaultShiftName() {
  const h = new Date().getHours();
  return h < 14 ? 'กะเช้า' : h < 22 ? 'กะบ่าย' : 'กะดึก';
}

export default function ShiftsPage() {
  return (
    <RequirePerm perm="shift">
      <Shifts />
    </RequirePerm>
  );
}

function Shifts() {
  const shift = useStore((s) => openShiftOf(s));
  return (
    <div>
      <PageHeader
        title="เปิดกะ / ตัดกะ"
        subtitle="บันทึกตัวเลขมิเตอร์สะสมหน้าตู้ (จอ P = บาท · จอ L = ลิตร) เพื่อกระทบยอดขาย เงินสด และสต๊อกถัง"
        icon={<ClipboardCheck className="size-5" />}
      />
      {shift ? <CloseShift shift={shift} /> : <OpenShift />}
      <History />
    </div>
  );
}

/** ฟอร์มกรอกมิเตอร์ จัดวางเหมือนหน้าตู้จริง: ซ้าย/ขวา ตามหัวจ่าย */
function MeterBoard({
  readings,
  setReadings,
  reference,
}: {
  readings: ReadingText;
  setReadings: (r: ReadingText) => void;
  reference?: Record<string, MeterReading>;
}) {
  const s = useStore();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {s.dispensers.map((d) => (
        <div key={d.id} className="rounded-2xl border border-[#c9c2b1] bg-[#f3efe6] p-3">
          <div className="mb-2 flex items-center justify-center">
            <span className="grid size-10 place-items-center rounded-lg bg-[#1c2d6e] text-2xl font-black text-white">{d.no}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {s.nozzles
              .filter((n) => n.dispenserId === d.id)
              .sort((a, b) => a.side.localeCompare(b.side))
              .map((n) => {
                const p = s.products.find((x) => x.id === n.productId)!;
                const val = readings[n.id] ?? { L: '', P: '' };
                const ref = reference?.[n.id];
                const Lml = toMl(parseNum(val.L));
                const Pst = toSatang(parseNum(val.P));
                const backL = ref && Number.isFinite(Lml) && Lml < ref.volume;
                const backP = ref && Number.isFinite(Pst) && Pst < ref.amount;
                return (
                  <div key={n.id} className="space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <ProductDot color={p.color} />
                      หัว {n.label} · {p.name}
                    </div>
                    <MeterInput mode="P" value={val.P} invalid={!!backP} onChange={(v) => setReadings({ ...readings, [n.id]: { ...val, P: v } })} />
                    <MeterInput mode="L" value={val.L} invalid={!!backL} onChange={(v) => setReadings({ ...readings, [n.id]: { ...val, L: v } })} />
                    {ref && (
                      <p className="text-[11px] text-slate-500">
                        ค่าก่อนหน้า P {baht(ref.amount, 1)} · L {litres(ref.volume)}
                      </p>
                    )}
                    {(backL || backP) && <p className="text-[11px] text-rose-600">ค่าน้อยกว่าเดิม — ตรวจสอบ (หรือมิเตอร์วนรอบ)</p>}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OpenShift() {
  const s = useStore();
  const [name, setName] = useState(defaultShiftName());
  const [cash, setCash] = useState('2000');
  const [readings, setReadings] = useState<ReadingText>(() => toText(s.meters));

  const parsed = parseReadings(readings, s.nozzles.map((n) => n.id));
  const mismatched = parsed ? s.nozzles.filter((n) => parsed[n.id].volume !== s.meters[n.id]?.volume || parsed[n.id].amount !== s.meters[n.id]?.amount) : [];

  const open = () => {
    if (!parsed) return toast.error('กรอกมิเตอร์ให้ครบทุกหัวจ่าย');
    const err = s.openShift({ name, openingCash: toSatang(parseNum(cash) || 0), readings: parsed });
    if (err) return toast.error(err);
    toast.success(`เปิด${name}แล้ว`);
  };

  return (
    <Card className="mb-6">
      <CardHeader title="เปิดกะใหม่" icon={<PlayCircle className="size-5 text-emerald-600" />} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="ชื่อกะ">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="เงินทอนตั้งต้นในลิ้นชัก (บาท)">
            <Input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </div>
        <p className="text-sm text-slate-600">
          ตรวจตัวเลขมิเตอร์หน้าตู้ทุกหัวจ่าย — ระบบดึงค่าปิดกะล่าสุดมาให้ ถ้าหน้าตู้ไม่ตรงให้แก้เป็นค่าจริง
        </p>
        <MeterBoard readings={readings} setReadings={setReadings} />
        {mismatched.length > 0 && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            หัว {mismatched.map((n) => n.label).join(', ')} ไม่ตรงกับค่าปิดกะล่าสุด — แปลว่ามีการจ่ายน้ำมันระหว่างกะ หรือกรอกผิด
          </div>
        )}
        <div className="flex justify-end">
          <Button size="lg" variant="success" onClick={open}>
            <PlayCircle className="size-5" /> เปิดกะ
          </Button>
        </div>
      </div>
    </Card>
  );
}

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

function CloseShift({ shift }: { shift: Shift }) {
  const s = useStore();
  const [readings, setReadings] = useState<ReadingText>({});
  const [dips, setDips] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('');
  const [note, setNote] = useState('');
  const [adjustToDip, setAdjustToDip] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const shiftSales = s.sales.filter((x) => x.shiftId === shift.id);
  const paid = shiftSales.filter((x) => x.status === 'paid');
  const counted = DENOMS.reduce((a, d) => a + d * (parseInt(counts[d] || '0') || 0), 0) * 100 + toSatang(parseNum(coins) || 0);

  const parsed = parseReadings(readings, s.nozzles.map((n) => n.id));
  const dipList: TankDip[] = Object.entries(dips)
    .filter(([, v]) => v !== '' && Number.isFinite(parseNum(v)))
    .map(([tankId, v]) => ({ tankId, measured: toMl(parseNum(v)) }));

  // คำนวณสดทุกครั้งที่พิมพ์ — ให้เห็นผลกระทบยอดก่อนกดปิดกะ
  const summary: ShiftSummary | null = parsed
    ? reconcileShift({
        shift,
        closeReadings: parsed,
        dips: dipList,
        countedCash: counted,
        sales: shiftSales,
        deliveries: s.deliveries.filter((d) => d.at >= shift.openedAt),
        nozzles: s.nozzles,
        products: s.products,
        tankIds: s.tanks.map((t) => t.id),
        tolerancePct: s.station.stockTolerancePct,
      })
    : null;

  const close = () => {
    if (!parsed) return;
    const err = s.closeShift({ readings: parsed, dips: dipList, countedCash: counted, note, adjustToDip });
    setConfirm(false);
    if (err) return toast.error(err);
    toast.success('ปิดกะเรียบร้อย — ปรับสต๊อกถังตามมิเตอร์แล้ว');
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="กะปัจจุบัน" value={shift.name} hint={`${shift.no} · เปิด ${thDateTime(shift.openedAt)}`} />
        <Stat label="บิลในกะ" value={paid.length} unit="บิล" />
        <Stat label="ยอดขายในระบบ" value={baht(paid.reduce((a, x) => a + x.net, 0))} unit="฿" tone="brand" />
        <Stat label="ลิตรในระบบ" value={litres(paid.reduce((a, x) => a + x.volume, 0))} unit="ล." tone="green" />
      </div>

      <Card>
        <CardHeader title="มิเตอร์ต้นกะ (ที่บันทึกไว้)" icon={<Lock className="size-4 text-slate-400" />} />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {s.nozzles.map((n) => {
            const r = shift.openReadings[n.id];
            const p = s.products.find((x) => x.id === n.productId)!;
            return (
              <div key={n.id}>
                <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                  <ProductDot color={p.color} /> หัว {n.label} · {p.shortName}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <MeterLcd mode="P" value={r?.amount ?? 0} className="[&_*]:text-lg" />
                  <MeterLcd mode="L" value={r?.volume ?? 0} className="[&_*]:text-lg" />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="1) กรอกมิเตอร์ปิดกะจากหน้าตู้" />
        <div className="p-4 sm:p-5">
          <MeterBoard readings={readings} setReadings={setReadings} reference={shift.openReadings} />
        </div>
      </Card>

      {summary && (
        <Card>
          <CardHeader title="ผลกระทบยอดรายหัวจ่าย" icon={<Scale className="size-4 text-brand-600" />} />
          <Table>
            <thead>
              <tr>
                <th>หัวจ่าย</th>
                <th className="text-right">ลิตรตามมิเตอร์</th>
                <th className="text-right">บาทตามมิเตอร์ (P)</th>
                <th className="text-right">ลิตร × ราคา</th>
                <th className="text-right">ลิตรในระบบ</th>
                <th className="text-right">ส่วนต่าง (ล.)</th>
                <th className="text-right">ส่วนต่าง (฿)</th>
              </tr>
            </thead>
            <tbody>
              {summary.nozzles.map((r) => {
                const n = s.nozzles.find((x) => x.id === r.nozzleId)!;
                const p = s.products.find((x) => x.id === n.productId)!;
                const priceGap = Math.abs(r.priceCheck - r.meterAmount) > 100;
                return (
                  <tr key={r.nozzleId} className="tabular-nums">
                    <td>
                      <span className="flex items-center gap-1.5">
                        <ProductDot color={p.color} /> {n.label} {p.shortName}
                      </span>
                    </td>
                    <td className="text-right font-semibold">{litres(r.meterVolume)}</td>
                    <td className="text-right">{baht(r.meterAmount)}</td>
                    <td className={cn('text-right', priceGap && 'text-amber-600')} title={priceGap ? 'จอ P กับ L ไม่สอดคล้องกับราคาปัจจุบัน (อาจเปลี่ยนราคาระหว่างกะ)' : ''}>
                      {baht(r.priceCheck)}
                    </td>
                    <td className="text-right">{litres(r.posVolume)}</td>
                    <td className={cn('text-right font-semibold', r.varVolume !== 0 && 'text-amber-600')}>{litres(r.varVolume)}</td>
                    <td className={cn('text-right', r.varAmount !== 0 && 'text-amber-600')}>{baht(r.varAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            ส่วนต่าง = ลิตรที่ออกจากหัวจ่ายแต่ไม่ได้คีย์บิลในระบบ (ขายเงินสดหน้าลาน) — ระบบจะตัดสต๊อกถังส่วนนี้ให้อัตโนมัติเมื่อปิดกะ
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="2) วัดน้ำมันในถัง (ไม่บังคับ)" />
          <div className="space-y-3 p-4">
            {s.tanks.map((t) => {
              const r = summary?.tanks.find((x) => x.tankId === t.id);
              return (
                <div key={t.id} className="grid grid-cols-[1fr_140px] items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-slate-500">
                      ตามบัญชีหลังปิดกะ: <b>{r ? litres(r.expected) : '—'}</b> ล.
                      {r?.variance != null && (
                        <span className={cn('ml-1 font-semibold', r.withinTolerance ? 'text-emerald-600' : 'text-rose-600')}>
                          ({r.variance > 0 ? '+' : ''}
                          {litres(r.variance)} ล. · {r.variancePct?.toFixed(2)}%)
                        </span>
                      )}
                    </p>
                  </div>
                  <Input inputMode="decimal" placeholder="วัดได้ (ลิตร)" value={dips[t.id] ?? ''} onChange={(e) => setDips({ ...dips, [t.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                </div>
              );
            })}
            <Toggle checked={adjustToDip} onChange={setAdjustToDip} label="ปรับสต๊อกตามบัญชีให้เท่ากับค่าที่วัดได้" />
          </div>
        </Card>

        <Card>
          <CardHeader title="3) นับเงินสด" extra={<span className="text-lg font-bold tabular-nums">{baht(counted)} ฿</span>} />
          <div className="grid grid-cols-3 gap-2 p-4">
            {DENOMS.map((d) => (
              <label key={d} className="flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
                <span className="w-10 text-right text-sm font-semibold text-slate-600">{d}</span>
                <span className="text-slate-300">×</span>
                <input
                  inputMode="numeric"
                  className="w-full bg-transparent text-right text-sm outline-none"
                  placeholder="0"
                  value={counts[d] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, '') })}
                />
              </label>
            ))}
            <label className="col-span-3 flex items-center gap-2 rounded-xl border border-slate-200 px-2 py-1.5">
              <span className="text-sm text-slate-600">เศษสตางค์/อื่นๆ</span>
              <input inputMode="decimal" className="w-full bg-transparent text-right text-sm outline-none" placeholder="0.00" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d.]/g, ''))} />
            </label>
          </div>
        </Card>
      </div>

      {summary && <SummaryCard summary={summary} openingCash={shift.openingCash} />}

      <Card className="p-4">
        <Field label="หมายเหตุ">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ลูกค้าเครดิต, เงินขาดเพราะ..." />
        </Field>
        <div className="mt-4 flex justify-end">
          <Button size="lg" disabled={!parsed} onClick={() => setConfirm(true)}>
            <CheckCircle2 className="size-5" /> ยืนยันปิดกะ
          </Button>
        </div>
        {!parsed && <p className="mt-2 text-right text-sm text-slate-500">กรอกมิเตอร์ปิดกะให้ครบทุกหัวจ่ายก่อน</p>}
      </Card>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="ยืนยันปิดกะ"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              ยกเลิก
            </Button>
            <Button onClick={close}>ปิดกะ</Button>
          </>
        }
      >
        {summary && (
          <div className="space-y-2 text-sm">
            <p>
              ยอดตามมิเตอร์ <b>{baht(summary.meterAmount)} ฿</b> · {litres(summary.meterVolume)} ลิตร
            </p>
            <p>
              เงินสดที่ต้องส่ง <b>{baht(summary.expectedCash)} ฿</b> · นับได้ <b>{baht(summary.countedCash)} ฿</b>
            </p>
            <p className={cn('text-base font-semibold', summary.cashDiff < 0 ? 'text-rose-600' : summary.cashDiff > 0 ? 'text-amber-600' : 'text-emerald-600')}>
              {summary.cashDiff === 0 ? 'เงินสดตรง' : summary.cashDiff < 0 ? `เงินขาด ${baht(-summary.cashDiff)} ฿` : `เงินเกิน ${baht(summary.cashDiff)} ฿`}
            </p>
            <p className="text-slate-500">หลังปิดกะ ค่ามิเตอร์ปิดจะถูกใช้เป็นค่าตั้งต้นของกะถัดไป และแก้ไขไม่ได้</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryCard({ summary, openingCash }: { summary: ShiftSummary; openingCash: number }) {
  const diffTone = summary.cashDiff < 0 ? 'red' : summary.cashDiff > 0 ? 'amber' : 'green';
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-[#0f1d4a] to-brand-700 px-5 py-4 text-white">
        <p className="text-sm text-white/70">เงินสดที่ต้องส่ง</p>
        <p className="text-3xl font-bold tabular-nums">{baht(summary.expectedCash)} ฿</p>
        <p className="mt-1 text-xs text-white/70">
          = เงินทอนตั้งต้น {baht(openingCash)} + ยอดตามมิเตอร์ {baht(summary.meterAmount)} − ชำระช่องทางอื่น{' '}
          {baht(summary.posNet - summary.byMethod.cash)} − ส่วนลด {baht(summary.discount)}
        </p>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">แยกตามวิธีชำระ (ในระบบ)</p>
          {Object.entries(summary.byMethod).map(([k, v]) => (
            <div key={k} className="flex justify-between tabular-nums">
              <span className="text-slate-600">{METHOD_LABEL[k as keyof typeof METHOD_LABEL]}</span>
              <span>{baht(v)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">เงินสดนับได้</span>
            <span className="font-semibold tabular-nums">{baht(summary.countedCash)} ฿</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">ผลต่าง</span>
            <Badge tone={diffTone}>
              {summary.cashDiff === 0 ? 'ตรง' : summary.cashDiff < 0 ? `ขาด ${baht(-summary.cashDiff)}` : `เกิน ${baht(summary.cashDiff)}`}
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

function History() {
  const s = useStore();
  const closed = s.shifts.filter((x) => x.status === 'closed');
  const emp = (id: string | null) => s.employees.find((e) => e.id === id)?.nickname ?? '-';
  return (
    <Card>
      <CardHeader title="ประวัติการปิดกะ" />
      {closed.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีกะที่ปิดแล้ว</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>กะ</th>
              <th>ปิดเมื่อ</th>
              <th className="text-right">ลิตรตามมิเตอร์</th>
              <th className="text-right">บาทตามมิเตอร์</th>
              <th className="text-right">เงินสดขาด/เกิน</th>
              <th>ผู้ปิด</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {closed.map((x) => (
              <tr key={x.id} className="tabular-nums">
                <td>
                  <p className="font-medium">{x.name}</p>
                  <p className="text-xs text-slate-500">{x.no}</p>
                </td>
                <td>{x.closedAt && thDateTime(x.closedAt)}</td>
                <td className="text-right">{litres(x.summary?.meterVolume ?? 0)}</td>
                <td className="text-right">{baht(x.summary?.meterAmount ?? 0)}</td>
                <td className={cn('text-right font-semibold', (x.summary?.cashDiff ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>{baht(x.summary?.cashDiff ?? 0)}</td>
                <td>{emp(x.closedBy)}</td>
                <td className="text-right">
                  <a href={`/print/shift/${x.id}`} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm">
                      <Printer className="size-4" /> รายงาน
                    </Button>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
