'use client';

import { useStore } from '@/lib/store';
import type { Tank } from '@/lib/types';
import { litres } from '@/lib/units';
import { cn } from './ui';

/** ถังน้ำมันแนวตั้ง แสดงระดับเป็น % พร้อมตัวเลขลิตร และหัวจ่ายที่ผูกอยู่ */
export function TankGauge({ tank }: { tank: Tank }) {
  const product = useStore((s) => s.products.find((p) => p.id === tank.productId));
  const nozzles = useStore((s) => s.nozzles).filter((n) => n.tankId === tank.id);
  const pct = Math.max(0, Math.min(100, (tank.level / tank.capacity) * 100));
  const low = pct < tank.lowPct;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative h-36 w-full max-w-24 overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50 sm:h-44">
        <div
          className="absolute inset-x-0 bottom-0 transition-all duration-700"
          style={{ height: `${pct}%`, background: `linear-gradient(180deg, ${product?.color}cc, ${product?.color})` }}
        />
        <div className="absolute inset-x-0 border-t-2 border-dashed border-rose-400/70" style={{ bottom: `${tank.lowPct}%` }} />
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn('rounded-lg bg-white/90 px-1.5 py-0.5 text-sm font-bold tabular-nums shadow-sm', low && 'text-rose-600')}>{pct.toFixed(0)}%</span>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold">ถัง {tank.no}</p>
        <p className="text-xs text-slate-500">{product?.name}</p>
        <p className="text-sm font-medium tabular-nums">
          {litres(tank.level, 0)} <span className="text-xs text-slate-400">/ {litres(tank.capacity, 0)} ล.</span>
        </p>
        <p className="text-[11px] text-slate-400">หัว {nozzles.map((n) => n.label).join(', ') || '-'}</p>
      </div>
    </div>
  );
}
