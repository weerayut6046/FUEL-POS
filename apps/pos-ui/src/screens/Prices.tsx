import { useEffect, useState } from 'react';
import type { Product } from '@fuel-pos/shared';
import { formatPrice, toSatang } from '@fuel-pos/shared';
import { api } from '../api.js';

interface Props {
  products: Product[];
  onToast: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export function Prices({ products, onToast }: Props) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [history, setHistory] = useState<
    { id: number; old_price: number; new_price: number; changed_at: string; changed_by_name: string | null; pushed_to_pumps: number; note: string | null }[]
  >([]);

  useEffect(() => {
    if (historyFor === null) return;
    api.priceHistory(historyFor).then(setHistory).catch(() => setHistory([]));
  }, [historyFor]);

  const save = async (product: Product): Promise<void> => {
    const text = drafts[product.id];
    if (!text) return;
    const price = toSatang(Number(text));
    if (!Number.isFinite(price) || price <= 0) {
      onToast('error', 'ราคาไม่ถูกต้อง');
      return;
    }

    setBusyId(product.id);
    try {
      const result = await api.setPrice(product.id, price);
      const failed = result.pushResults.filter((r) => !r.ok);
      setDrafts((prev) => ({ ...prev, [product.id]: '' }));

      if (result.pushResults.length === 0) {
        onToast('warn', `เปลี่ยนราคา ${product.code} แล้ว แต่ยังไม่มีหัวจ่ายที่ผูกกับสินค้านี้`);
      } else if (failed.length === 0) {
        onToast('info', `ตั้งราคา ${product.code} เป็น ${formatPrice(price)} บาท และส่งไปตู้ครบทุกหัวแล้ว`);
      } else {
        onToast(
          'error',
          `เปลี่ยนราคาในระบบแล้ว แต่ส่งไปตู้ไม่สำเร็จ ${failed.length} หัว — ต้องไปตั้งราคาที่หน้าตู้เอง`,
        );
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <h3>ราคาน้ำมัน</h3>
        <div className="hint" style={{ marginBottom: 12 }}>
          เมื่อบันทึก ระบบจะส่งราคาใหม่ไปยังตู้จ่ายทุกหัวที่ขายสินค้านั้นทันที
          และบันทึกประวัติการเปลี่ยนราคาไว้ตรวจสอบย้อนหลังเสมอ
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อสินค้า</th>
                <th className="num">ราคาปัจจุบัน</th>
                <th style={{ width: 180 }}>ราคาใหม่ (บาท/ลิตร)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    <span
                      className="badge"
                      style={{ background: product.color, color: '#0b1220', borderColor: product.color }}
                    >
                      {product.code}
                    </span>
                  </td>
                  <td>{product.name}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatPrice(product.unitPrice)}
                  </td>
                  <td>
                    <input
                      value={drafts[product.id] ?? ''}
                      placeholder={formatPrice(product.unitPrice)}
                      inputMode="decimal"
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [product.id]: e.target.value.replace(/[^\d.]/g, ''),
                        }))
                      }
                      style={{ textAlign: 'right' }}
                    />
                  </td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="primary"
                        disabled={busyId === product.id || !drafts[product.id]}
                        onClick={() => void save(product)}
                      >
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryFor(historyFor === product.id ? null : product.id)}
                      >
                        ประวัติ
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {historyFor !== null && (
        <div className="panel">
          <h3>ประวัติการเปลี่ยนราคา</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th className="num">ราคาเดิม</th>
                  <th className="num">ราคาใหม่</th>
                  <th>ผู้เปลี่ยน</th>
                  <th>ส่งไปตู้</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.changed_at).toLocaleString('th-TH')}</td>
                    <td className="num">{formatPrice(row.old_price)}</td>
                    <td className="num">{formatPrice(row.new_price)}</td>
                    <td>{row.changed_by_name ?? '-'}</td>
                    <td>
                      {row.pushed_to_pumps ? (
                        <span className="badge ok">สำเร็จ</span>
                      ) : (
                        <span className="badge warn">ยังไม่สำเร็จ</span>
                      )}
                    </td>
                    <td>{row.note ?? '-'}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr className="dim">
                    <td colSpan={6}>ยังไม่มีประวัติ</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
