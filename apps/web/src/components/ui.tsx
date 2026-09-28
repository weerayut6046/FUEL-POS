'use client';

import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';

export const cn = clsx;

// ---------------------------------------------------------------------------
// โครงหน้า
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {icon && (
          <div className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white shadow-lg shadow-brand-500/25">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-slate-200/80 bg-white shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, extra, icon }: { title: React.ReactNode; extra?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
      <h2 className="flex items-center gap-2 font-semibold text-slate-800">
        {icon}
        {title}
      </h2>
      {extra}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'slate',
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'slate' | 'brand' | 'green' | 'amber' | 'red';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-rose-50 text-rose-600',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-500">{label}</p>
        {icon && <div className={cn('grid size-9 place-items-center rounded-xl', tones[tone])}>{icon}</div>}
      </div>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-slate-400">{unit}</span>}
      </p>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-slate-500">
      {icon && <div className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="text-sm">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ฟอร์ม
// ---------------------------------------------------------------------------

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }) {
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/30',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/30',
  };
  const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base' };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10';

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...rest} />;
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(inputCls, 'pr-8', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, 'h-auto min-h-20 py-2', className)} {...rest} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2 text-sm text-slate-700">
      <span className={cn('relative h-6 w-10 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'amber' | 'red' | 'brand'; children: React.ReactNode }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent', tones[tone])}>{children}</span>;
}

export function ProductDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const sizes = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={cn('flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl', sizes[size])}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="ปิด">
            <X className="size-5" />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}
const useToasts = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, 'id'>) => void; remove: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), 3500);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (text: string) => useToasts.getState().push({ tone: 'success', text }),
  error: (text: string) => useToasts.getState().push({ tone: 'error', text }),
  info: (text: string) => useToasts.getState().push({ tone: 'info', text }),
};

export function Toaster() {
  const items = useToasts((s) => s.items);
  const remove = useToasts((s) => s.remove);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => remove(t.id)}
          className={cn(
            'pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-xl',
            t.tone === 'success' && 'bg-emerald-600',
            t.tone === 'error' && 'bg-rose-600',
            t.tone === 'info' && 'bg-slate-800',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ตาราง
// ---------------------------------------------------------------------------

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm [&_td]:px-4 [&_td]:py-2.5 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-500 [&_thead]:bg-slate-50 [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tbody_tr:hover]:bg-slate-50/60">
        {children}
      </table>
    </div>
  );
}

/** ปุ่มตัวเลข สำหรับจอสัมผัส */
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          className="h-12 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 sm:h-14"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

/** ใช้กับ Keypad: ต่อ/ลบตัวอักษรของข้อความตัวเลข */
export function applyKey(current: string, k: string, maxDecimals = 2): string {
  if (k === '⌫') return current.slice(0, -1);
  if (k === 'C') return '';
  if (k === '.') return current.includes('.') ? current : (current || '0') + '.';
  const [, dec] = current.split('.');
  if (dec !== undefined && dec.length >= maxDecimals) return current;
  if (current === '0') return k;
  return (current + k).slice(0, 10);
}
