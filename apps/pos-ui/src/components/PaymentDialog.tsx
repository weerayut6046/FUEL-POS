import { useMemo, useState } from 'react';
import type { PaymentMethod, Product, Sale } from '@fuel-pos/shared';
import { formatBaht, formatLitres, formatPrice, toSatang } from '@fuel-pos/shared';
import { api } from '../api.js';
import { Keypad, applyKey } from './Keypad.js';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'เงินสด',
  qr: 'QR พร้อมเพย์',
  card: 'บัตรเครดิต',
  credit: 'ลูกหนี้ (เครดิต)',
  coupon: 'คูปอง',
  fleet: 'บัตรฟลีท',
};

/** ปุ่มธนบัตรที่พนักงานกดบ่อย */
const QUICK_NOTES = [20, 50, 100, 500, 1000];

interface Props {
  sale: Sale;
  product: Product | undefined;
  nozzleLabel: string;
  onClose: () => void;
  onPaid: (result: { change: number; released: boolean; releaseError: string | null }) => void;
}

export function PaymentDialog({ sale, product, nozzleLabel, onClose, onPaid }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tenderedText, setTenderedText] = useState('');
  const [plate, setPlate] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tendered = useMemo(() => {
    const value = Number(tenderedText);
    return Number.isFinite(value) ? toSatang(value) : 0;
  }, [tenderedText]);

  // วิธีที่ไม่ใช่เงินสดตัดยอดพอดีเสมอ จึงไม่มีเงินทอน
  const isCash = method === 'cash';
  const change = isCash ? Math.max(0, tendered - sale.amount) : 0;
  const insufficient = isCash && tenderedText !== '' && tendered < sale.amount;

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.pay(
        sale.id,
        [
          {
            method,
            amount: sale.amount,
            ...(isCash ? { tendered: tendered || sale.amount } : {}),
            ...(reference ? { reference } : {}),
          },
        ],
        plate ? { vehiclePlate: plate } : undefined,
      );
      onPaid({
        change: result.change,
        released: result.released,
        releaseError: result.releaseError,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>รับชำระเงิน</h2>
        <div className="hint" style={{ marginBottom: 14 }}>
          เลขที่ {sale.docNo} · หัวจ่าย {nozzleLabel} · {product?.name ?? ''}
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              {formatLitres(sale.volume)} ลิตร × {formatPrice(sale.unitPrice)} บาท
            </span>
            <span style={{ fontSize: 30, fontWeight: 700, color: '#fcd34d' }}>
              {formatBaht(sale.amount)} ฿
            </span>
          </div>
        </div>

        <div className="stack">
          <div>
            <div className="hint">วิธีชำระเงิน</div>
            <div className="quick-amounts" style={{ marginTop: 6 }}>
              {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={method === key ? 'primary' : ''}
                  onClick={() => setMethod(key)}
                >
                  {METHOD_LABEL[key]}
                </button>
              ))}
            </div>
          </div>

          {isCash ? (
            <>
              <div>
                <div className="hint">รับเงินมา (บาท)</div>
                <input
                  value={tenderedText}
                  onChange={(e) => setTenderedText(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={formatBaht(sale.amount)}
                  inputMode="decimal"
                  style={{ fontSize: 28, textAlign: 'right', fontWeight: 700 }}
                />
              </div>

              <div className="quick-amounts">
                <button type="button" onClick={() => setTenderedText(String(sale.amount / 100))}>
                  พอดี
                </button>
                {QUICK_NOTES.map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() =>
                      setTenderedText(String(Number(tenderedText || 0) + note))
                    }
                  >
                    +{note}
                  </button>
                ))}
              </div>

              <Keypad
                onKey={(key) => setTenderedText((prev) => applyKey(prev, key))}
                onClear={() => setTenderedText('')}
                onBackspace={() => setTenderedText((prev) => prev.slice(0, -1))}
              />

              <div className="panel row" style={{ justifyContent: 'space-between' }}>
                <span>เงินทอน</span>
                <span style={{ fontSize: 28, fontWeight: 700, color: change > 0 ? '#86efac' : undefined }}>
                  {formatBaht(change)} ฿
                </span>
              </div>
            </>
          ) : (
            <div>
              <div className="hint">เลขอ้างอิง (ถ้ามี)</div>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="เช่น เลขที่อนุมัติ / เลขที่สลิป"
              />
            </div>
          )}

          <div>
            <div className="hint">ทะเบียนรถ (ไม่บังคับ)</div>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="เช่น กข 1234" />
          </div>

          {insufficient && <div className="warn-box">เงินที่รับมายังไม่พอกับยอดที่ต้องชำระ</div>}
          {error && <div className="error-box">{error}</div>}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} disabled={busy}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="primary big"
              onClick={() => void submit()}
              disabled={busy || insufficient}
            >
              {busy ? 'กำลังบันทึก…' : 'รับเงินและปลดล็อกตู้'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
