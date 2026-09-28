'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Banknote, CheckCircle2, CreditCard, FileText, Fuel, Landmark, Printer, QrCode, Search, UserPlus, UserRound, Wallet, X } from 'lucide-react';
import { useStore, openShiftOf } from '@/lib/store';
import { METHOD_LABEL, priceSale } from '@/lib/domain';
import type { Member, PaymentMethod, Sale } from '@/lib/types';
import { baht, litres, monthKey, parseNum, price, toMl, toSatang } from '@/lib/units';
import { applyKey, Badge, Button, Card, cn, Input, Keypad, Modal, PageHeader, ProductDot, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';
import { ReceiptView } from '@/components/Documents';

const METHOD_ICON: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  cash: Banknote,
  qr: QrCode,
  card: CreditCard,
  transfer: Landmark,
  credit: Wallet,
};

export default function PosPage() {
  return (
    <RequirePerm perm="pos">
      <Pos />
    </RequirePerm>
  );
}

function Pos() {
  const s = useStore();
  const shift = openShiftOf(s);
  const [nozzleId, setNozzleId] = useState(s.nozzles[0]?.id ?? '');
  const [mode, setMode] = useState<'amount' | 'volume'>('amount');
  const [input, setInput] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [plate, setPlate] = useState('');
  const [memberOpen, setMemberOpen] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);

  const nozzle = s.nozzles.find((n) => n.id === nozzleId);
  const product = s.products.find((p) => p.id === nozzle?.productId);
  const tank = s.tanks.find((t) => t.id === nozzle?.tankId);

  const value = parseNum(input);
  const raw = Number.isFinite(value) && value > 0 ? (mode === 'amount' ? toSatang(value) : toMl(value)) : 0;

  const quote = useMemo(
    () =>
      product && raw > 0
        ? priceSale({
            product,
            mode,
            value: raw,
            isMember: !!member,
            promotions: s.promotions,
            month: monthKey(),
            vatRate: s.station.vatRegistered ? s.station.vatRate : 0,
            bahtPerPoint: s.station.bahtPerPoint,
          })
        : null,
    [product, raw, mode, member, s.promotions, s.station],
  );

  const receivedSatang = method === 'cash' ? toSatang(parseNum(received) || 0) : quote?.net ?? 0;
  const change = quote ? receivedSatang - quote.net : 0;

  const reset = () => {
    setInput('');
    setReceived('');
    setMember(null);
    setPlate('');
    setMethod('cash');
  };

  const submit = () => {
    if (!quote) return;
    const r = s.createSale({
      nozzleId,
      mode,
      value: raw,
      method,
      received: method === 'cash' ? (received === '' ? quote.net : receivedSatang) : quote.net,
      memberId: member?.id ?? null,
      plate: plate || member?.plate || '',
    });
    if (typeof r === 'string') return toast.error(r);
    setDone(r);
    reset();
    toast.success(`บันทึกการขาย ${r.docNo} แล้ว`);
  };

  const quick = mode === 'amount' ? [100, 200, 300, 500, 1000, 1500] : [5, 10, 20, 30, 40, 50];

  return (
    <div>
      <PageHeader title="ขายน้ำมัน" subtitle="เลือกหัวจ่าย ระบุยอดเงินหรือจำนวนลิตร แล้วรับชำระ" icon={<Fuel className="size-5" />} />

      {!shift && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p>ยังไม่ได้เปิดกะ — ต้องเปิดกะพร้อมบันทึกมิเตอร์ตั้งต้นก่อนขาย</p>
          <Link href="/shifts">
            <Button size="sm">ไปเปิดกะ</Button>
          </Link>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ตู้จ่าย / หัวจ่าย */}
        <div className="space-y-4 lg:col-span-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {s.dispensers.map((d) => (
              <Card key={d.id} className="overflow-hidden">
                <div className="flex items-center justify-between bg-gradient-to-r from-[#0f1d4a] to-[#1c3278] px-4 py-2.5 text-white">
                  <span className="font-semibold">{d.name}</span>
                  <span className="grid size-8 place-items-center rounded-lg bg-white text-lg font-black text-[#1c3278]">{d.no}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {s.nozzles
                    .filter((n) => n.dispenserId === d.id)
                    .sort((a, b) => a.side.localeCompare(b.side))
                    .map((n) => {
                      const p = s.products.find((x) => x.id === n.productId)!;
                      const t = s.tanks.find((x) => x.id === n.tankId)!;
                      const pct = Math.max(0, Math.min(100, (t.level / t.capacity) * 100));
                      const active = n.id === nozzleId;
                      return (
                        <button
                          key={n.id}
                          onClick={() => setNozzleId(n.id)}
                          className={cn(
                            'relative rounded-xl border-2 p-3 text-left transition active:scale-[.98]',
                            active ? 'shadow-lg' : 'border-slate-200 hover:border-slate-300',
                          )}
                          style={active ? { borderColor: p.color, boxShadow: `0 8px 24px -8px ${p.color}66` } : undefined}
                        >
                          <div className="flex items-center justify-between">
                            <span className="rounded-md px-1.5 py-0.5 text-xs font-bold text-white" style={{ background: p.color }}>
                              หัว {n.label}
                            </span>
                            {active && <CheckCircle2 className="size-5" style={{ color: p.color }} />}
                          </div>
                          <p className="mt-2 font-semibold leading-tight">{p.name}</p>
                          <p className="lcd mt-2 inline-block rounded px-2 py-0.5 text-lg">{price(p.price)}</p>
                          <p className="mt-2 text-[11px] text-slate-500">
                            ถัง {t.no} · {litres(t.level, 0)} ล.
                          </p>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={cn('h-full rounded-full', pct < t.lowPct ? 'bg-rose-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                          </div>
                        </button>
                      );
                    })}
                </div>
              </Card>
            ))}
          </div>

          {/* สมาชิก */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {member ? (
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                    <UserRound className="size-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{member.name}</p>
                    <p className="text-xs text-slate-500">
                      {member.code} · {member.phone} · แต้มคงเหลือ <b className="text-amber-600">{member.points.toLocaleString()}</b>
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">ลูกค้าทั่วไป — ค้นหาสมาชิกเพื่อสะสมแต้มและรับโปรโมชั่น</p>
              )}
              <div className="flex gap-2">
                {member && (
                  <Button variant="ghost" size="sm" onClick={() => setMember(null)}>
                    <X className="size-4" /> ล้าง
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setMemberOpen(true)}>
                  <Search className="size-4" /> สมาชิก
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <Input placeholder="ทะเบียนรถ (ถ้ามี)" value={plate} onChange={(e) => setPlate(e.target.value)} />
            </div>
          </Card>
        </div>

        {/* แผงคิดเงิน */}
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            {product && <ProductDot color={product.color} className="size-3" />}
            <p className="font-semibold">
              หัว {nozzle?.label} · {product?.name}
            </p>
            <span className="ml-auto text-sm text-slate-500">{product && price(product.price)} ฿/ล.</span>
          </div>

          <div className="mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            {(['amount', 'volume'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setInput('');
                }}
                className={cn('rounded-lg py-2 transition', mode === m ? 'bg-white shadow' : 'text-slate-500')}
              >
                {m === 'amount' ? 'ระบุเป็นบาท' : 'ระบุเป็นลิตร'}
              </button>
            ))}
          </div>

          <div className="lcd mb-3 rounded-xl px-4 py-3 text-right">
            <p className="font-sans text-xs opacity-70">{mode === 'amount' ? 'จำนวนเงิน (บาท)' : 'ปริมาณ (ลิตร)'}</p>
            <p className="text-4xl leading-tight">{input || '0'}</p>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            {quick.map((q) => (
              <button key={q} onClick={() => setInput(String(q))} className="rounded-lg bg-brand-50 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100">
                {q.toLocaleString()} {mode === 'amount' ? '฿' : 'ล.'}
              </button>
            ))}
          </div>
          <Keypad onKey={(k) => setInput((v) => applyKey(v, k))} />

          {quote && (
            <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
              <Row label="ปริมาณ" value={`${litres(quote.volume, 3)} ลิตร`} />
              <Row label="ราคาตามหน้าตู้" value={`${baht(quote.gross)} ฿`} />
              {quote.discount > 0 && <Row label="ส่วนลดโปรโมชั่น" value={`-${baht(quote.discount)} ฿`} className="text-emerald-600" />}
              <Row label="มูลค่าก่อน VAT" value={`${baht(quote.beforeVat)} ฿`} muted />
              <Row label={`VAT ${s.station.vatRate}%`} value={`${baht(quote.vat)} ฿`} muted />
              <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                <span className="font-semibold">ยอดชำระ</span>
                <span className="text-2xl font-bold tabular-nums">{baht(quote.net)} ฿</span>
              </div>
              {member && <Row label="แต้มที่จะได้รับ" value={`+${quote.points} แต้ม`} className="text-amber-600" />}
              {quote.applied.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {quote.applied.map((p) => (
                    <Badge key={p.id} tone="green">
                      🎉 {p.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="mb-2 mt-4 text-sm font-medium text-slate-600">วิธีชำระเงิน</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => {
              const Icon = METHOD_ICON[m];
              return (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2 text-[11px] font-medium transition',
                    method === m ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600',
                  )}
                >
                  <Icon className="size-5" />
                  {METHOD_LABEL[m].split(' ')[0].split('/')[0]}
                </button>
              );
            })}
          </div>

          {method === 'cash' && quote && (
            <div className="mt-3">
              <Input inputMode="decimal" placeholder={`รับเงิน (ว่าง = พอดี ${baht(quote.net)})`} value={received} onChange={(e) => setReceived(e.target.value.replace(/[^\d.]/g, ''))} />
              <div className="mt-2 flex flex-wrap gap-2">
                {[100, 500, 1000].map((b) => (
                  <button key={b} onClick={() => setReceived(String(b))} className="rounded-lg bg-slate-100 px-3 py-1 text-sm hover:bg-slate-200">
                    {b}
                  </button>
                ))}
              </div>
              {received !== '' && (
                <p className={cn('mt-2 text-right text-lg font-semibold', change < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                  {change < 0 ? `ขาดอีก ${baht(-change)}` : `เงินทอน ${baht(change)}`} ฿
                </p>
              )}
            </div>
          )}

          <Button size="lg" variant="success" className="mt-4 w-full" disabled={!shift || !quote || (method === 'cash' && received !== '' && change < 0)} onClick={submit}>
            <CheckCircle2 className="size-5" /> ยืนยันการขาย
          </Button>
          {tank && quote && quote.volume > tank.level && <p className="mt-2 text-center text-sm text-rose-600">น้ำมันในถังไม่พอ</p>}
        </Card>
      </div>

      <MemberPicker open={memberOpen} onClose={() => setMemberOpen(false)} onPick={(m) => { setMember(m); setMemberOpen(false); }} />

      <Modal
        open={!!done}
        onClose={() => setDone(null)}
        title="ขายสำเร็จ"
        size="sm"
        footer={
          done && (
            <>
              <Link href={`/invoices?sale=${done.id}`}>
                <Button variant="secondary">
                  <FileText className="size-4" /> ใบกำกับเต็มรูป
                </Button>
              </Link>
              <a href={`/print/receipt/${done.id}`} target="_blank" rel="noreferrer">
                <Button>
                  <Printer className="size-4" /> พิมพ์ใบเสร็จ
                </Button>
              </a>
            </>
          )
        }
      >
        {done && <ReceiptView sale={done} />}
      </Modal>
    </div>
  );
}

function Row({ label, value, className, muted }: { label: string; value: string; className?: string; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between tabular-nums', muted && 'text-xs text-slate-400', className)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function MemberPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (m: Member) => void }) {
  const members = useStore((s) => s.members);
  const saveMember = useStore((s) => s.saveMember);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', plate: '' });
  const found = members
    .filter((m) => !q || m.phone.includes(q) || m.name.includes(q) || m.plate.includes(q) || m.code.includes(q.toUpperCase()))
    .slice(0, 20);

  return (
    <Modal open={open} onClose={onClose} title={adding ? 'สมัครสมาชิกใหม่' : 'ค้นหาสมาชิก'}>
      {adding ? (
        <div className="space-y-3">
          <Input placeholder="ชื่อ-นามสกุล" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="เบอร์โทร" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '') })} />
          <Input placeholder="ทะเบียนรถ" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={() => {
                if (!form.name || form.phone.length < 9) return toast.error('กรอกชื่อและเบอร์โทรให้ครบ');
                if (members.some((m) => m.phone === form.phone)) return toast.error('เบอร์นี้เป็นสมาชิกแล้ว');
                const m = saveMember(form);
                toast.success(`สมัครสมาชิก ${m.code} แล้ว`);
                setForm({ name: '', phone: '', plate: '' });
                setAdding(false);
                onPick(m);
              }}
            >
              สมัครและเลือก
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input autoFocus placeholder="เบอร์โทร / ชื่อ / ทะเบียน / รหัส" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" />
            </Button>
          </div>
          <div className="divide-y divide-slate-100">
            {found.map((m) => (
              <button key={m.id} onClick={() => onPick(m)} className="flex w-full items-center justify-between gap-2 px-1 py-2.5 text-left hover:bg-slate-50">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-slate-500">
                    {m.code} · {m.phone} {m.plate && `· ${m.plate}`}
                  </p>
                </div>
                <Badge tone="amber">{m.points.toLocaleString()} แต้ม</Badge>
              </button>
            ))}
            {found.length === 0 && <p className="py-6 text-center text-sm text-slate-500">ไม่พบสมาชิก</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
