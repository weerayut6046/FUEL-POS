import { useCallback, useEffect, useState } from 'react';
import type { Shift } from '@fuel-pos/shared';
import { formatBaht, formatLitres, toSatang } from '@fuel-pos/shared';
import { api, type ShiftSummary } from '../api.js';

interface Props {
  shift: Shift | null;
  onToast: (level: 'info' | 'warn' | 'error', message: string) => void;
  refresh: () => void;
}

function defaultShiftName(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'กะเช้า';
  if (hour < 18) return 'กะบ่าย';
  return 'กะดึก';
}

export function ShiftScreen({ shift, onToast, refresh }: Props) {
  const [name, setName] = useState(defaultShiftName());
  const [float, setFloat] = useState('2000');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    if (!shift) {
      setSummary(null);
      return;
    }
    try {
      setSummary(await api.shiftSummary(shift.id));
    } catch {
      setSummary(null);
    }
  }, [shift]);

  useEffect(() => {
    void loadSummary();
    api.shifts().then(setHistory).catch(() => undefined);
  }, [loadSummary]);

  // ยอดขายเดินตลอดกะ จึงรีเฟรชสรุปเป็นระยะ
  useEffect(() => {
    if (!shift) return;
    const timer = window.setInterval(() => void loadSummary(), 10_000);
    return () => window.clearInterval(timer);
  }, [shift, loadSummary]);

  const open = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.openShift(name, toSatang(Number(float || 0)));
      onToast('info', `เปิดกะ "${name}" เรียบร้อย — บันทึกค่ามิเตอร์ตั้งต้นของทุกหัวจ่ายแล้ว`);
      refresh();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = async (force: boolean): Promise<void> => {
    if (!shift) return;
    setBusy(true);
    try {
      const result = await api.closeShift(shift.id, toSatang(Number(counted || 0)), note, force);
      setSummary(result.summary);
      const variance = result.summary.totals.cashVariance ?? 0;
      onToast(
        variance === 0 ? 'info' : 'warn',
        variance === 0
          ? 'ปิดกะเรียบร้อย เงินสดตรงพอดี'
          : `ปิดกะแล้ว — เงินสด${variance > 0 ? 'เกิน' : 'ขาด'} ${formatBaht(Math.abs(variance))} บาท`,
      );
      refresh();
      api.shifts().then(setHistory).catch(() => undefined);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!shift) {
    return (
      <div className="stack">
        <div className="panel" style={{ maxWidth: 480 }}>
          <h3>เปิดกะใหม่</h3>
          <div className="hint" style={{ marginBottom: 12 }}>
            ระบบจะบันทึกค่ามิเตอร์รวมของทุกหัวจ่าย ณ ขณะนี้ไว้เป็นค่าตั้งต้น
            เพื่อใช้กระทบยอดกับยอดขายตอนปิดกะ
          </div>
          <div className="stack">
            <div>
              <div className="hint">ชื่อกะ</div>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <div className="hint">เงินทอนตั้งต้นในลิ้นชัก (บาท)</div>
              <input
                value={float}
                inputMode="decimal"
                onChange={(e) => setFloat(e.target.value.replace(/[^\d.]/g, ''))}
              />
            </div>
            <button type="button" className="primary big" onClick={() => void open()} disabled={busy}>
              เปิดกะ
            </button>
          </div>
        </div>

        <ShiftHistory shifts={history} />
      </div>
    );
  }

  const totals = summary?.totals;

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <div className="k">กะปัจจุบัน</div>
          <div className="v" style={{ fontSize: 20 }}>{shift.name}</div>
          <div className="hint">เปิดเมื่อ {new Date(shift.openedAt).toLocaleString('th-TH')}</div>
        </div>
        <div className="stat">
          <div className="k">ยอดขายในกะ</div>
          <div className="v">{formatBaht(totals?.soldAmount ?? 0)} ฿</div>
        </div>
        <div className="stat">
          <div className="k">ปริมาณที่ขาย</div>
          <div className="v">{formatLitres(totals?.soldVolume ?? 0)} ล.</div>
        </div>
        <div className="stat">
          <div className="k">เงินสดที่ควรมีในลิ้นชัก</div>
          <div className="v">{formatBaht(totals?.expectedCash ?? 0)} ฿</div>
          <div className="hint">รวมเงินทอนตั้งต้น {formatBaht(shift.openingFloat)} บาท</div>
        </div>
      </div>

      {totals && totals.pendingCount > 0 && (
        <div className="warn-box">
          ยังมีรายการค้างชำระ {totals.pendingCount} รายการ รวม {formatBaht(totals.pendingAmount)} บาท
          — ต้องเก็บเงินให้ครบก่อนปิดกะ
        </div>
      )}

      <div className="panel">
        <h3>กระทบยอดมิเตอร์รายหัวจ่าย</h3>
        <div className="hint" style={{ marginBottom: 10 }}>
          “ผลต่าง” คือปริมาณที่มิเตอร์ตู้เดินไป ลบด้วยปริมาณที่บันทึกขายในระบบ
          ถ้าเป็นบวกมาก แปลว่ามีการจ่ายน้ำมันที่ไม่ได้บันทึกเป็นรายการขาย
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>หัวจ่าย</th>
                <th>สินค้า</th>
                <th className="num">มิเตอร์เปิดกะ</th>
                <th className="num">ขายในระบบ</th>
                <th className="num">ยอดเงิน</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.nozzles ?? []).map((row) => (
                <tr key={row.nozzleId}>
                  <td>{row.label}</td>
                  <td>{row.productName}</td>
                  <td className="num">{formatLitres(row.openVolume)}</td>
                  <td className="num">{formatLitres(row.soldVolume)}</td>
                  <td className="num">{formatBaht(row.soldAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 520 }}>
        <h3>ปิดกะ</h3>
        <div className="stack">
          <div>
            <div className="hint">เงินสดที่นับได้จริงในลิ้นชัก (บาท)</div>
            <input
              value={counted}
              inputMode="decimal"
              onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ fontSize: 24, textAlign: 'right', fontWeight: 700 }}
            />
          </div>
          {counted !== '' && totals && (
            <div className={Math.abs(toSatang(Number(counted)) - totals.expectedCash) === 0 ? 'panel' : 'warn-box'}>
              ผลต่างเงินสด:{' '}
              {formatBaht(toSatang(Number(counted)) - totals.expectedCash)} บาท
            </div>
          )}
          <div>
            <div className="hint">หมายเหตุ</div>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row">
            <button
              type="button"
              className="primary big"
              onClick={() => void close(false)}
              disabled={busy || counted === ''}
            >
              ปิดกะ
            </button>
            {totals && totals.pendingCount > 0 && (
              <button
                type="button"
                className="danger"
                onClick={() => void close(true)}
                disabled={busy || counted === ''}
              >
                ปิดกะทั้งที่มีรายการค้าง (ผู้จัดการ)
              </button>
            )}
          </div>
        </div>
      </div>

      <ShiftHistory shifts={history} />
    </div>
  );
}

function ShiftHistory({ shifts }: { shifts: Shift[] }) {
  if (shifts.length === 0) return null;
  return (
    <div className="panel">
      <h3>ประวัติกะ</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>กะ</th>
              <th>เปิด</th>
              <th>ปิด</th>
              <th className="num">เงินทอนตั้งต้น</th>
              <th className="num">เงินสดที่นับได้</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id}>
                <td>{shift.name}</td>
                <td>{new Date(shift.openedAt).toLocaleString('th-TH')}</td>
                <td>{shift.closedAt ? new Date(shift.closedAt).toLocaleString('th-TH') : '-'}</td>
                <td className="num">{formatBaht(shift.openingFloat)}</td>
                <td className="num">{shift.countedCash === null ? '-' : formatBaht(shift.countedCash)}</td>
                <td>
                  {shift.status === 'open' ? (
                    <span className="badge ok">เปิดอยู่</span>
                  ) : (
                    <span className="badge">ปิดแล้ว</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
