'use client';

import { splitMeterDisplay } from '@/lib/domain';
import { cn } from './ui';

/**
 * จำลองจอมิเตอร์สะสมหน้าตู้จ่าย
 *   โหมด P = ยอดเงินสะสม (บาท ทศนิยม 1)   → บรรทัดบน 2 หลักสูง + บรรทัดล่าง "90824.6"
 *   โหมด L = ปริมาตรสะสม (ลิตร ทศนิยม 2)  → บรรทัดบน 2 หลักสูง + บรรทัดล่าง "5117.80"
 */
export function MeterLcd({ mode, value, className }: { mode: 'P' | 'L'; value: number; className?: string }) {
  const { top, bottom } = splitMeterDisplay(value, mode === 'L' ? 2 : 1);
  return (
    <div className={cn('lcd rounded-lg px-3 py-2', className)} aria-label={`มิเตอร์ ${mode} ${top}${bottom}`}>
      <div className="flex items-baseline justify-between text-2xl leading-none sm:text-3xl">
        <span>{mode}</span>
        <span>{top}</span>
      </div>
      <div className="mt-1 text-right text-2xl leading-none sm:text-3xl">{bottom}</div>
    </div>
  );
}

/** ช่องกรอกค่ามิเตอร์ สไตล์จอ LCD พร้อมตัวช่วยแสดงผลแบบจอจริง */
export function MeterInput({
  mode,
  value,
  onChange,
  invalid,
}: {
  mode: 'P' | 'L';
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const decimals = mode === 'L' ? 2 : 1;
  const n = Number(value.replace(/,/g, ''));
  const preview = value !== '' && Number.isFinite(n) ? splitMeterDisplay(Math.round(n * (mode === 'L' ? 1000 : 100)), decimals) : null;
  return (
    <div className={cn('lcd rounded-lg px-3 py-2', invalid && 'ring-2 ring-rose-500')}>
      <div className="flex items-center justify-between text-xs opacity-80">
        <span className="text-lg leading-none">{mode}</span>
        <span className="font-sans">{mode === 'L' ? 'ลิตรสะสม' : 'บาทสะสม'}</span>
      </div>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder={mode === 'L' ? '405117.80' : '8790824.6'}
        className="w-full bg-transparent text-right text-2xl leading-tight outline-none placeholder:text-[#1e2a78]/30"
      />
      {preview && (
        <div className="text-right text-[11px] opacity-70">
          จอตู้: <b>{preview.top || '0'}</b> | <b>{preview.bottom}</b>
        </div>
      )}
    </div>
  );
}
