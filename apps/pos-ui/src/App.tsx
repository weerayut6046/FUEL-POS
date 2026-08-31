import { useCallback, useEffect, useState } from 'react';
import type { User } from '@fuel-pos/shared';
import { formatBaht } from '@fuel-pos/shared';
import { api, setToken } from './api.js';
import { useLive } from './useLive.js';
import { Login } from './screens/Login.js';
import { Forecourt } from './screens/Forecourt.js';
import { Prices } from './screens/Prices.js';
import { Reports } from './screens/Reports.js';
import { ShiftScreen } from './screens/ShiftScreen.js';
import { ProtocolLab } from './screens/ProtocolLab.js';

type Tab = 'floor' | 'shift' | 'prices' | 'reports' | 'lab';

const TABS: { key: Tab; label: string; minRole: 'attendant' | 'cashier' | 'manager' | 'admin' }[] = [
  { key: 'floor', label: 'หน้าลาน', minRole: 'attendant' },
  { key: 'shift', label: 'กะ', minRole: 'cashier' },
  { key: 'prices', label: 'ราคา', minRole: 'manager' },
  { key: 'reports', label: 'รายงาน', minRole: 'manager' },
  { key: 'lab', label: 'ตั้งค่าตู้จ่าย', minRole: 'admin' },
];

const ROLE_RANK = { attendant: 1, cashier: 2, manager: 3, admin: 4 } as const;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('floor');
  const { state, refresh, pushToast, subscribeTraffic } = useLive(user !== null);

  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setToken('');
    setUser(null);
  }, []);

  if (checking) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <div className="hint">กำลังเริ่มระบบ…</div>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  const visibleTabs = TABS.filter((t) => ROLE_RANK[user.role] >= ROLE_RANK[t.minRole]);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key ?? 'floor');

  const pendingTotal = state.pendingSales.reduce((sum, sale) => sum + sale.amount, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⛽ POS ปั๊มน้ำมัน</div>

        <nav className="tabs">
          {visibleTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={activeTab === item.key ? 'active' : ''}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {item.key === 'floor' && state.pendingSales.length > 0 && (
                <span className="badge warn" style={{ marginLeft: 8 }}>
                  {state.pendingSales.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="row">
          {state.pendingSales.length > 0 && (
            <span className="badge warn">ค้างชำระ {formatBaht(pendingTotal)} ฿</span>
          )}
          {state.mode === 'simulator' && <span className="badge warn">โหมดจำลอง</span>}
          <span className={`badge ${state.connected ? 'ok' : 'danger'}`}>
            {state.connected ? 'ออนไลน์' : 'ขาดการเชื่อมต่อ'}
          </span>
          <span className="badge">
            {state.shift ? `กะ: ${state.shift.name}` : 'ยังไม่เปิดกะ'}
          </span>
          <span className="hint">{user.displayName}</span>
          <button type="button" className="ghost" onClick={() => void logout()}>
            ออกจากระบบ
          </button>
        </div>
      </header>

      <main className="content">
        {activeTab === 'floor' && (
          <Forecourt live={state} onToast={pushToast} refresh={() => void refresh()} />
        )}
        {activeTab === 'shift' && (
          <ShiftScreen shift={state.shift} onToast={pushToast} refresh={() => void refresh()} />
        )}
        {activeTab === 'prices' && <Prices products={state.products} onToast={pushToast} />}
        {activeTab === 'reports' && <Reports />}
        {activeTab === 'lab' && (
          <ProtocolLab live={state} subscribeTraffic={subscribeTraffic} onToast={pushToast} />
        )}
      </main>

      <div className="toast-stack">
        {state.toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.level}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
