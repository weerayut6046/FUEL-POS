'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  BadgePercent,
  ClipboardCheck,
  Clock,
  Container,
  Fuel,
  Gift,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  FileText,
  Settings,
  Users,
  X,
  Delete,
} from 'lucide-react';
import { useStore, useCurrentUser, openShiftOf } from '@/lib/store';
import { can, ROLE_LABEL, type Permission } from '@/lib/domain';
import { thTime } from '@/lib/units';
import { cn, Toaster, toast } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  perm?: Permission;
}

export const NAV: NavItem[] = [
  { href: '/', label: 'แดชบอร์ด', icon: LayoutDashboard },
  { href: '/pos', label: 'ขายน้ำมัน', icon: Fuel, perm: 'pos' },
  { href: '/shifts', label: 'เปิด/ตัดกะ', icon: ClipboardCheck, perm: 'shift' },
  { href: '/sales', label: 'รายการขาย', icon: Receipt, perm: 'pos' },
  { href: '/invoices', label: 'ใบกำกับภาษี', icon: FileText, perm: 'invoice' },
  { href: '/stock', label: 'สต๊อกน้ำมัน', icon: Container, perm: 'stock' },
  { href: '/members', label: 'สมาชิก', icon: Users, perm: 'members' },
  { href: '/rewards', label: 'ของรางวัล', icon: Gift, perm: 'rewards' },
  { href: '/promotions', label: 'โปรโมชั่น', icon: BadgePercent, perm: 'promotions' },
  { href: '/employees', label: 'พนักงาน', icon: IdCard, perm: 'employees' },
  { href: '/timeclock', label: 'ลงเวลาเข้า-ออก', icon: Clock },
  { href: '/settings', label: 'ตั้งค่าระบบ', icon: Settings, perm: 'settings' },
];

const MOBILE_MAIN = ['/', '/pos', '/shifts', '/stock'];

/** รอให้ข้อมูลจาก localStorage โหลดเสร็จก่อนเรนเดอร์ (กัน hydration mismatch) */
function useHydrated() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const unsub = useStore.persist.onFinishHydration(() => setOk(true));
    void useStore.persist.rehydrate();
    if (useStore.persist.hasHydrated()) setOk(true);
    return unsub;
  }, []);
  return ok;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const user = useCurrentUser();
  const pathname = usePathname();

  if (!hydrated) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Fuel className="size-6 animate-pulse text-brand-600" /> กำลังโหลด…
        </div>
      </div>
    );
  }

  // หน้าลงเวลาใช้ได้โดยไม่ต้องล็อกอิน (ตั้งเป็นเครื่อง kiosk หน้าร้านได้)
  if (!user && pathname === '/timeclock') {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-slate-950 via-[#0b1633] to-brand-700 p-4">
        <Toaster />
        <div className="mx-auto max-w-5xl">
          <Link href="/" className="mb-4 inline-block text-sm text-white/70 hover:text-white">
            ← กลับหน้าเข้าสู่ระบบ
          </Link>
          {children}
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  return (
    <div className="min-h-dvh lg:pl-64">
      <Toaster />
      <Sidebar />
      <MobileTopBar />
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-4 sm:px-6 lg:pb-10 lg:pt-8">{children}</main>
      <MobileBottomNav />
    </div>
  );
}

function Brand() {
  const station = useStore((s) => s.station);
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 via-rose-500 to-brand-600 shadow-lg">
        <Fuel className="size-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="font-bold leading-tight text-white">FUEL-POS</p>
        <p className="truncate text-xs text-slate-400">{station.name}</p>
      </div>
    </div>
  );
}

function ShiftPill() {
  const shift = useStore((s) => openShiftOf(s));
  return shift ? (
    <Link href="/shifts" className="flex items-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300">
      <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
      กะ {shift.name} · เปิด {thTime(shift.openedAt)}
    </Link>
  ) : (
    <Link href="/shifts" className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-300">
      <span className="size-2 rounded-full bg-amber-400" />
      ยังไม่เปิดกะ
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.filter((n) => !n.perm || can(user?.role, n.perm)).map((n) => {
        const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
              active ? 'bg-white/10 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon className={cn('size-[18px]', active && 'text-orange-300')} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserBox() {
  const user = useCurrentUser();
  const logout = useStore((s) => s.logout);
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
      <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-indigo-500 text-sm font-semibold text-white">
        {user.nickname.slice(0, 2) || user.name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="text-xs text-slate-400">{ROLE_LABEL[user.role]}</p>
      </div>
      <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="ออกจากระบบ">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-5 bg-[#0b1224] p-4 lg:flex">
      <Brand />
      <ShiftPill />
      <div className="scroll-thin -mx-1 flex-1 overflow-y-auto px-1">
        <NavLinks />
      </div>
      <UserBox />
    </aside>
  );
}

function MobileTopBar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-[#0b1224] px-4 py-3 lg:hidden">
        <Brand />
        <button onClick={() => setOpen(true)} className="rounded-xl p-2 text-white hover:bg-white/10" aria-label="เมนู">
          <Menu className="size-6" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-y-0 right-0 flex w-72 flex-col gap-4 bg-[#0b1224] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400" aria-label="ปิดเมนู">
                <X className="size-5" />
              </button>
            </div>
            <ShiftPill />
            <div className="scroll-thin flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <UserBox />
          </div>
        </div>
      )}
    </>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const items = NAV.filter((n) => MOBILE_MAIN.includes(n.href) && (!n.perm || can(user?.role, n.perm)));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((n) => {
          const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link key={n.href} href={n.href} className={cn('flex flex-col items-center gap-0.5 py-2 text-[11px]', active ? 'text-brand-600' : 'text-slate-500')}>
              <Icon className="size-5" />
              {n.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// หน้าเข้าสู่ระบบด้วย PIN
// ---------------------------------------------------------------------------

function LoginScreen() {
  const login = useStore((s) => s.login);
  const station = useStore((s) => s.station);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const press = (k: string) => {
    setError(false);
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      const ok = login(next);
      if (ok) toast.success(`ยินดีต้อนรับ ${ok.name}`);
      else {
        setError(true);
        setPin('');
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') press('del');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#070d1c] p-4">
      <Toaster />
      <div className="pointer-events-none absolute -left-40 -top-40 size-[480px] rounded-full bg-rose-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 size-[520px] rounded-full bg-brand-600/40 blur-3xl" />
      <div className="relative grid w-full max-w-4xl gap-8 md:grid-cols-2 md:items-center">
        <div className="text-white">
          <div className="mb-6 grid size-14 place-items-center rounded-3xl bg-gradient-to-br from-orange-400 via-rose-500 to-brand-600 shadow-2xl">
            <Fuel className="size-7" />
          </div>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            FUEL-POS <span className="bg-gradient-to-r from-orange-300 to-rose-400 bg-clip-text text-transparent">Cloud</span>
          </h1>
          <p className="mt-2 text-slate-300">{station.name}</p>
          <ul className="mt-6 hidden space-y-2 text-sm text-slate-400 md:block">
            <li>⛽ ขายน้ำมัน 2 ตู้จ่าย · 4 หัวจ่าย</li>
            <li>📟 ตัดกะด้วยมิเตอร์ P/L หน้าตู้ กระทบยอดอัตโนมัติ</li>
            <li>🛢️ สต๊อก 3 ถัง ผูกกับหัวจ่าย</li>
            <li>🎁 สมาชิกสะสมแต้ม แลกของรางวัล · 🧾 ใบกำกับภาษีเต็มรูป</li>
          </ul>
          <Link href="/timeclock" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
            <Clock className="size-4" /> ลงเวลาเข้า-ออกงาน
          </Link>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
          <p className="text-center text-sm text-slate-300">ใส่รหัส PIN เพื่อเข้าสู่ระบบ</p>
          <div className="my-5 flex justify-center gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className={cn('size-4 rounded-full border-2', i < pin.length ? 'border-orange-300 bg-orange-300' : 'border-white/30')} />
            ))}
          </div>
          {error && <p className="-mt-2 mb-3 text-center text-sm text-rose-300">PIN ไม่ถูกต้อง</p>}
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
              k === '' ? (
                <span key={i} />
              ) : (
                <button
                  key={i}
                  onClick={() => press(k)}
                  className="h-16 rounded-2xl bg-white/10 text-2xl font-semibold text-white transition hover:bg-white/20 active:scale-95"
                  aria-label={k === 'del' ? 'ลบ' : k}
                >
                  {k === 'del' ? <Delete className="mx-auto size-6" /> : k}
                </button>
              ),
            )}
          </div>
          <p className="mt-5 text-center text-xs text-slate-500">
            ตัวอย่าง PIN: เจ้าของ 1234 · แคชเชียร์ 1111 · หน้าลาน 2222
          </p>
        </div>
      </div>
    </div>
  );
}

/** ใช้ครอบเนื้อหาหน้าที่ต้องมีสิทธิ์ */
export function RequirePerm({ perm, children }: { perm: Permission; children: React.ReactNode }) {
  const user = useCurrentUser();
  if (!can(user?.role, perm))
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">คุณไม่มีสิทธิ์เข้าถึงหน้านี้</div>;
  return <>{children}</>;
}
