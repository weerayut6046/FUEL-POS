'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Droplets, Fuel, LayoutDashboard, Receipt, TrendingUp, UserCheck, Users } from 'lucide-react';
import { useStore, openShiftOf, useCurrentUser } from '@/lib/store';
import { baht, dayKey, litres, thTime } from '@/lib/units';
import { Badge, Button, Card, CardHeader, cn, PageHeader, ProductDot, Stat } from '@/components/ui';
import { TankGauge } from '@/components/TankGauge';

export default function Dashboard() {
  const s = useStore();
  const user = useCurrentUser();
  const shift = openShiftOf(s);
  const today = dayKey();
  const paid = s.sales.filter((x) => x.status === 'paid');
  const todays = paid.filter((x) => dayKey(new Date(x.createdAt)) === today);
  const onDuty = s.timeEntries.filter((t) => !t.clockOut);
  const lowTanks = s.tanks.filter((t) => (t.level / t.capacity) * 100 < t.lowPct);

  return (
    <div>
      <PageHeader
        title={`สวัสดี ${user?.nickname || user?.name} 👋`}
        subtitle={new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        icon={<LayoutDashboard className="size-5" />}
        actions={
          <Link href="/pos">
            <Button>
              <Fuel className="size-4" /> เริ่มขาย
            </Button>
          </Link>
        }
      />

      {lowTanks.length > 0 && (
        <Card className="mb-4 flex items-center gap-3 border-rose-200 bg-rose-50 p-4 text-rose-800">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="text-sm">
            น้ำมันใกล้หมด: {lowTanks.map((t) => `${t.name} (${litres(t.level, 0)} ล.)`).join(' · ')} —{' '}
            <Link href="/stock" className="font-semibold underline">
              สั่งน้ำมันเข้า
            </Link>
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ยอดขายวันนี้" value={baht(todays.reduce((a, x) => a + x.net, 0))} unit="฿" icon={<TrendingUp className="size-5" />} tone="brand" />
        <Stat label="ปริมาณวันนี้" value={litres(todays.reduce((a, x) => a + x.volume, 0))} unit="ลิตร" icon={<Droplets className="size-5" />} tone="green" />
        <Stat label="จำนวนบิล" value={todays.length} unit="บิล" icon={<Receipt className="size-5" />} tone="amber" />
        <Stat
          label="กะปัจจุบัน"
          value={shift ? shift.name : 'ยังไม่เปิด'}
          hint={shift ? `เปิด ${thTime(shift.openedAt)}` : <Link href="/shifts" className="text-brand-600 underline">เปิดกะ</Link>}
          icon={<UserCheck className="size-5" />}
          tone={shift ? 'green' : 'red'}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="ยอดขาย 7 วันล่าสุด (บาท)" />
          <WeekChart />
        </Card>
        <Card>
          <CardHeader title="วันนี้แยกตามผลิตภัณฑ์" />
          <div className="space-y-4 p-4">
            {s.products.map((p) => {
              const rows = todays.filter((x) => x.productId === p.id);
              return (
                <div key={p.id} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ProductDot color={p.color} className="size-3" />
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-slate-500">{rows.length} บิล</p>
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-semibold">{baht(rows.reduce((a, x) => a + x.net, 0))} ฿</p>
                    <p className="text-xs text-slate-500">{litres(rows.reduce((a, x) => a + x.volume, 0))} ล.</p>
                  </div>
                </div>
              );
            })}
            <div className="border-t border-slate-100 pt-3 text-sm text-slate-500">
              <Users className="mr-1 inline size-4" /> สมาชิกทั้งหมด {s.members.length.toLocaleString()} คน
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="ระดับน้ำมันในถัง" extra={<Link href="/stock" className="text-sm text-brand-600">จัดการสต๊อก →</Link>} />
        <div className="grid grid-cols-3 gap-3 p-4">
          {s.tanks.map((t) => (
            <TankGauge key={t.id} tank={t} />
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="รายการขายล่าสุด" extra={<Link href="/sales" className="text-sm text-brand-600">ทั้งหมด →</Link>} />
          <div className="divide-y divide-slate-100">
            {paid.slice(0, 6).map((x) => {
              const p = s.products.find((pp) => pp.id === x.productId)!;
              const n = s.nozzles.find((nn) => nn.id === x.nozzleId);
              return (
                <div key={x.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <ProductDot color={p.color} />
                    <div>
                      <p className="font-medium">
                        หัว {n?.label} · {litres(x.volume)} ล.
                      </p>
                      <p className="text-xs text-slate-500">
                        {x.docNo} · {thTime(x.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold tabular-nums">{baht(x.net)}</span>
                </div>
              );
            })}
            {paid.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีการขาย</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="พนักงานที่กำลังเข้างาน" extra={<Link href="/timeclock" className="text-sm text-brand-600">ลงเวลา →</Link>} />
          <div className="divide-y divide-slate-100">
            {onDuty.map((t) => {
              const e = s.employees.find((x) => x.id === t.employeeId);
              return (
                <div key={t.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium">{e?.name}</span>
                  <Badge tone="green">เข้างาน {thTime(t.clockIn)}</Badge>
                </div>
              );
            })}
            {onDuty.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีพนักงานลงเวลาเข้างาน</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** กราฟแท่งชุดเดียว ยอดขายสุทธิรายวัน — hover ดูตัวเลข และมีป้ายตัวเลขเฉพาะวันนี้ */
function WeekChart() {
  const sales = useStore((s) => s.sales);
  const [hover, setHover] = useState<number | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = dayKey(d);
    const rows = sales.filter((x) => x.status === 'paid' && dayKey(new Date(x.createdAt)) === key);
    return {
      key,
      label: d.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric' }),
      net: rows.reduce((a, x) => a + x.net, 0),
      vol: rows.reduce((a, x) => a + x.volume, 0),
      n: rows.length,
    };
  });
  const max = Math.max(...days.map((d) => d.net), 1);
  return (
    <div className="p-4">
      <div className="relative flex h-52 items-end gap-2 border-b border-slate-200 sm:gap-4">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: `${f * 100}%` }} />
        ))}
        {days.map((d, i) => (
          <div
            key={d.key}
            className="relative flex h-full flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(i)}
          >
            {(hover === i || (hover === null && i === 6 && d.net > 0)) && (
              <div className="absolute z-10 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg" style={{ bottom: `calc(${(d.net / max) * 100}% + 6px)` }}>
                {baht(d.net, 0)} ฿ · {litres(d.vol, 0)} ล. · {d.n} บิล
              </div>
            )}
            <div
              className={cn('w-full max-w-12 rounded-t-[4px] transition-colors', hover === i ? 'bg-brand-700' : 'bg-brand-500')}
              style={{ height: `${Math.max((d.net / max) * 100, d.net > 0 ? 2 : 0)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-4">
        {days.map((d) => (
          <p key={d.key} className="flex-1 text-center text-[11px] text-slate-500">
            {d.label}
          </p>
        ))}
      </div>
    </div>
  );
}
