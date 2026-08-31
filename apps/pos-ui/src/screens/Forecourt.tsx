import { useMemo, useState } from 'react';
import type { NozzleLiveState, PresetMode, Sale } from '@fuel-pos/shared';
import { formatBaht, formatLitres, toMl, toSatang } from '@fuel-pos/shared';
import { api } from '../api.js';
import type { LiveState } from '../useLive.js';
import { NozzleCard } from '../components/NozzleCard.js';
import { PaymentDialog } from '../components/PaymentDialog.js';
import { Keypad, applyKey } from '../components/Keypad.js';

const QUICK_AMOUNTS = [100, 200, 300, 500, 1000];
const QUICK_VOLUMES = [5, 10, 20, 40];

interface Props {
  live: LiveState;
  onToast: (level: 'info' | 'warn' | 'error', message: string) => void;
  refresh: () => void;
}

export function Forecourt({ live, onToast, refresh }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [presetMode, setPresetMode] = useState<PresetMode>('amount');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [payingSale, setPayingSale] = useState<Sale | null>(null);

  const productById = useMemo(
    () => new Map(live.products.map((p) => [p.id, p])),
    [live.products],
  );
  const nozzleById = useMemo(
    () => new Map(live.nozzles.map((n) => [n.nozzleId, n])),
    [live.nozzles],
  );

  const selected: NozzleLiveState | null =
    selectedId !== null ? (nozzleById.get(selectedId) ?? null) : null;

  const authorize = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    try {
      const value =
        presetMode === 'amount'
          ? toSatang(Number(input || 0))
          : presetMode === 'volume'
            ? toMl(Number(input || 0))
            : 0;
      await api.authorize(selected.nozzleId, presetMode, value);
      setInput('');
      onToast('info', `สั่งจ่ายหัว ${selected.label} เรียบร้อย — ยกหัวจ่ายได้เลย`);
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (!selected) return;
    try {
      await api.stopNozzle(selected.nozzleId);
      onToast('warn', `สั่งหยุดหัว ${selected.label} แล้ว`);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  const simulate = async (action: 'lift' | 'hang' | 'trigger-on' | 'trigger-off'): Promise<void> => {
    if (!selected) return;
    const nozzle = live.nozzles.find((n) => n.nozzleId === selected.nozzleId);
    if (!nozzle) return;
    try {
      // ลำดับหัวจ่ายในตู้หาได้จากป้าย (1A → 1, 1B → 2) โดยเรียงตามที่ server ส่งมา
      const sameP = live.nozzles.filter((n) => n.pumpId === nozzle.pumpId);
      const index = sameP.findIndex((n) => n.nozzleId === nozzle.nozzleId) + 1;
      await api.simulate(nozzle.pumpId, index, action);
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  return (
    <div className="stack">
      {!live.shift && (
        <div className="warn-box">
          ยังไม่ได้เปิดกะ — ไปที่แท็บ “กะ” เพื่อเปิดกะก่อน จึงจะสั่งจ่ายน้ำมันได้
        </div>
      )}

      {live.pendingSales.length > 0 && (
        <div className="panel">
          <h3>รอเก็บเงิน ({live.pendingSales.length} รายการ)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เลขที่</th>
                  <th>หัวจ่าย</th>
                  <th className="num">ลิตร</th>
                  <th className="num">จำนวนเงิน</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {live.pendingSales.map((sale) => {
                  const nozzle = nozzleById.get(sale.nozzleId);
                  return (
                    <tr key={sale.id}>
                      <td className="mono">{sale.docNo}</td>
                      <td>{nozzle?.label ?? sale.nozzleId}</td>
                      <td className="num">{formatLitres(sale.volume)}</td>
                      <td className="num" style={{ fontWeight: 700, color: '#fcd34d' }}>
                        {formatBaht(sale.amount)}
                      </td>
                      <td className="num">
                        <button type="button" className="primary" onClick={() => setPayingSale(sale)}>
                          เก็บเงิน
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="nozzle-grid">
        {live.nozzles.map((nozzle) => (
          <NozzleCard
            key={nozzle.nozzleId}
            nozzle={nozzle}
            product={productById.get(nozzle.productId)}
            selected={nozzle.nozzleId === selectedId}
            onSelect={() => setSelectedId(nozzle.nozzleId)}
          />
        ))}
        {live.nozzles.length === 0 && (
          <div className="panel">
            ยังไม่พบหัวจ่าย — ตรวจสอบการตั้งค่าตู้จ่ายและการเชื่อมต่อบัส RS-485
          </div>
        )}
      </div>

      {selected && (
        <div className="panel">
          <h3>สั่งงานหัวจ่าย {selected.label}</h3>

          <div className="row" style={{ marginBottom: 12 }}>
            {(['amount', 'volume', 'full'] as PresetMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={presetMode === mode ? 'primary' : ''}
                onClick={() => {
                  setPresetMode(mode);
                  setInput('');
                }}
              >
                {mode === 'amount' ? 'ตั้งยอดเงิน' : mode === 'volume' ? 'ตั้งจำนวนลิตร' : 'เต็มถัง'}
              </button>
            ))}
          </div>

          {presetMode !== 'full' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 1fr) minmax(200px, 260px)',
                gap: 16,
                alignItems: 'start',
              }}
            >
              <div className="stack">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={presetMode === 'amount' ? 'จำนวนเงิน (บาท)' : 'จำนวนลิตร'}
                  inputMode="decimal"
                  style={{ fontSize: 30, textAlign: 'right', fontWeight: 700 }}
                />
                <div className="quick-amounts">
                  {(presetMode === 'amount' ? QUICK_AMOUNTS : QUICK_VOLUMES).map((value) => (
                    <button key={value} type="button" onClick={() => setInput(String(value))}>
                      {value}
                      {presetMode === 'amount' ? ' ฿' : ' ล.'}
                    </button>
                  ))}
                </div>
                {presetMode === 'amount' && Number(input) > 0 && selected.unitPrice > 0 && (
                  <div className="hint">
                    ≈ {formatLitres(toMl((Number(input) * 100) / selected.unitPrice))} ลิตร
                  </div>
                )}
              </div>

              <Keypad
                onKey={(key) => setInput((prev) => applyKey(prev, key))}
                onClear={() => setInput('')}
                onBackspace={() => setInput((prev) => prev.slice(0, -1))}
              />
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="primary big"
              onClick={() => void authorize()}
              disabled={
                busy ||
                !live.shift ||
                (presetMode !== 'full' && Number(input) <= 0) ||
                selected.pendingSaleId !== null ||
                selected.status === 'filling'
              }
            >
              สั่งจ่ายน้ำมัน
            </button>
            <button
              type="button"
              className="danger big"
              onClick={() => void stop()}
              disabled={!['filling', 'nozzle_out', 'authorized'].includes(selected.status)}
            >
              หยุดจ่าย
            </button>
            <button type="button" onClick={() => setSelectedId(null)}>
              ปิดแผง
            </button>
          </div>

          {selected.pendingSaleId !== null && (
            <div className="warn-box" style={{ marginTop: 12 }}>
              หัวจ่ายนี้ถูกล็อกไว้เพราะมีรายการค้างชำระ — เก็บเงินให้เรียบร้อยก่อนจึงจะสั่งจ่ายใหม่ได้
            </div>
          )}

          {live.mode === 'simulator' && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div className="hint" style={{ marginBottom: 8 }}>
                โหมดจำลอง — ใช้ปุ่มเหล่านี้แทนการกระทำที่หน้าตู้จริง
              </div>
              <div className="row">
                <button type="button" onClick={() => void simulate('lift')}>
                  ยกหัวจ่าย
                </button>
                <button type="button" onClick={() => void simulate('trigger-on')}>
                  บีบคันโยก
                </button>
                <button type="button" onClick={() => void simulate('trigger-off')}>
                  ปล่อยคันโยก
                </button>
                <button type="button" onClick={() => void simulate('hang')}>
                  เก็บหัวจ่าย
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {payingSale && (
        <PaymentDialog
          sale={payingSale}
          product={productById.get(payingSale.productId)}
          nozzleLabel={nozzleById.get(payingSale.nozzleId)?.label ?? '-'}
          onClose={() => setPayingSale(null)}
          onPaid={(result) => {
            setPayingSale(null);
            refresh();
            onToast('info', `รับเงินเรียบร้อย — เงินทอน ${formatBaht(result.change)} บาท`);
            if (!result.released) {
              onToast(
                'error',
                `เก็บเงินแล้ว แต่ปลดล็อกตู้ไม่สำเร็จ: ${result.releaseError ?? 'ไม่ทราบสาเหตุ'} — กรุณากด Reset ที่หน้าตู้`,
              );
            }
          }}
        />
      )}
    </div>
  );
}
