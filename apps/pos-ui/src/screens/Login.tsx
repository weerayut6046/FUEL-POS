import { useEffect, useState } from 'react';
import type { User } from '@fuel-pos/shared';
import { api, setToken } from '../api.js';
import { Keypad } from '../components/Keypad.js';

interface Props {
  onLogin: (user: User) => void;
}

export function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('admin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [station, setStation] = useState('ระบบ POS ปั๊มน้ำมัน');
  const [mode, setMode] = useState<string>('');

  useEffect(() => {
    api
      .bootstrap()
      .then((info) => {
        setStation(info.station.name);
        setMode(info.mode);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (pinValue: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(username, pinValue);
      setToken(result.token);
      onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const pressKey = (key: string): void => {
    if (key === '.') return;
    const next = (pin + key).slice(0, 8);
    setPin(next);
    // PIN 4 หลักเป็นค่ามาตรฐาน — ส่งให้อัตโนมัติเพื่อให้กดเร็วขึ้นหน้าเคาน์เตอร์
    if (next.length === 4) void submit(next);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div className="panel" style={{ width: 'min(400px, 100%)' }}>
        <h2 style={{ marginTop: 0, textAlign: 'center' }}>{station}</h2>
        {mode === 'simulator' && (
          <div className="warn-box" style={{ marginBottom: 12 }}>
            กำลังทำงานในโหมดจำลอง — ยังไม่ได้ต่อกับตู้จ่ายจริง
          </div>
        )}

        <div className="stack">
          <div>
            <div className="hint">ชื่อผู้ใช้</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>

          <div>
            <div className="hint">รหัส PIN</div>
            <input
              value={'•'.repeat(pin.length)}
              readOnly
              style={{ fontSize: 30, textAlign: 'center', letterSpacing: 8 }}
            />
          </div>

          <Keypad
            decimal={false}
            onKey={pressKey}
            onClear={() => setPin('')}
            onBackspace={() => setPin((prev) => prev.slice(0, -1))}
          />

          {error && <div className="error-box">{error}</div>}

          <button
            type="button"
            className="primary big"
            onClick={() => void submit(pin)}
            disabled={busy || pin.length < 4}
          >
            {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
          </button>

          <div className="hint" style={{ textAlign: 'center' }}>
            PIN เริ่มต้นของผู้ดูแลระบบแสดงอยู่ในหน้าต่างเซิร์ฟเวอร์ตอนเปิดโปรแกรมครั้งแรก
          </div>
        </div>
      </div>
    </div>
  );
}
