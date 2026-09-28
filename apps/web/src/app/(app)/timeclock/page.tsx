'use client';

import { useEffect, useState } from 'react';
import { Delete, LogIn, LogOut } from 'lucide-react';
import { useStore } from '@/lib/store';
import { workedMs } from '@/lib/domain';
import { dayKey, thTime } from '@/lib/units';
import { Badge, Card, cn, toast } from '@/components/ui';

export default function TimeclockPage() {
  const s = useStore();
  const [now, setNow] = useState(new Date());
  const [pin, setPin] = useState('');
  const [last, setLast] = useState<{ name: string; action: 'in' | 'out'; at: string } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const press = (k: string) => {
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      const r = s.clockToggle(next);
      setPin('');
      if (typeof r === 'string') return toast.error(r);
      setLast({ name: r.employee.name, action: r.action, at: r.action === 'in' ? r.entry.clockIn : r.entry.clockOut! });
      toast.success(`${r.employee.name} ${r.action === 'in' ? 'ลงเวลาเข้างาน' : 'ลงเวลาออกงาน'}แล้ว`);
    }
  };

  const today = s.timeEntries.filter((t) => dayKey(new Date(t.clockIn)) === dayKey());

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-[#0f1d4a] to-brand-700 p-6 text-center text-white">
          <p className="text-sm text-white/70">{now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <p className="mt-1 font-[family-name:var(--font-lcd)] text-6xl tabular-nums tracking-wider">{now.toLocaleTimeString('th-TH', { hour12: false })}</p>
          <p className="mt-2 text-sm text-white/80">ใส่ PIN 4 หลักเพื่อลงเวลาเข้า/ออก</p>
        </div>
        <div className="p-6">
          <div className="mb-5 flex justify-center gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className={cn('size-4 rounded-full border-2', i < pin.length ? 'border-brand-600 bg-brand-600' : 'border-slate-300')} />
            ))}
          </div>
          <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
              k === '' ? (
                <span key={i} />
              ) : (
                <button key={i} onClick={() => press(k)} className="h-16 rounded-2xl bg-slate-100 text-2xl font-semibold transition hover:bg-slate-200 active:scale-95" aria-label={k === 'del' ? 'ลบ' : k}>
                  {k === 'del' ? <Delete className="mx-auto size-6" /> : k}
                </button>
              ),
            )}
          </div>
          {last && (
            <div className={cn('mt-5 flex items-center gap-3 rounded-2xl p-4', last.action === 'in' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
              {last.action === 'in' ? <LogIn className="size-6" /> : <LogOut className="size-6" />}
              <div>
                <p className="font-semibold">{last.name}</p>
                <p className="text-sm">
                  {last.action === 'in' ? 'เข้างาน' : 'ออกงาน'} เวลา {thTime(last.at)}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-5 py-3 font-semibold">ลงเวลาวันนี้</div>
        <div className="divide-y divide-slate-100">
          {today.map((t) => {
            const e = s.employees.find((x) => x.id === t.employeeId);
            const ms = workedMs(t.clockIn, t.clockOut, now.getTime());
            return (
              <div key={t.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="font-medium">{e?.name}</p>
                  <p className="text-xs text-slate-500">
                    เข้า {thTime(t.clockIn)} {t.clockOut && `· ออก ${thTime(t.clockOut)}`}
                  </p>
                </div>
                <div className="text-right">
                  {t.clockOut ? <Badge>ออกงานแล้ว</Badge> : <Badge tone="green">กำลังทำงาน</Badge>}
                  <p className="mt-1 text-xs tabular-nums text-slate-500">
                    {Math.floor(ms / 3_600_000)} ชม. {Math.floor((ms % 3_600_000) / 60_000)} น.
                  </p>
                </div>
              </div>
            );
          })}
          {today.length === 0 && <p className="p-8 text-center text-sm text-slate-500">ยังไม่มีการลงเวลาวันนี้</p>}
        </div>
      </Card>
    </div>
  );
}
