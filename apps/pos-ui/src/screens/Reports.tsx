import { useEffect, useState } from 'react';
import { formatBaht, formatLitres } from '@fuel-pos/shared';
import { api } from '../api.js';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const METHOD_LABEL: Record<string, string> = {
  cash: 'เงินสด',
  qr: 'QR พร้อมเพย์',
  card: 'บัตรเครดิต',
  credit: 'ลูกหนี้',
  coupon: 'คูปอง',
  fleet: 'บัตรฟลีท',
};

export function Reports() {
  const today = isoDate(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof api.dashboard>> | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.reportSummary>> | null>(null);
  const [daily, setDaily] = useState<Awaited<ReturnType<typeof api.daily>>>([]);

  useEffect(() => {
    api.dashboard().then(setDashboard).catch(() => undefined);
    api.daily(14).then(setDaily).catch(() => undefined);
  }, []);

  useEffect(() => {
    api.reportSummary(from, to).then(setSummary).catch(() => undefined);
  }, [from, to]);

  const maxDaily = Math.max(1, ...daily.map((d) => d.amount));

  return (
    <div className="stack">
      <div className="stat-grid">
        <div className="stat">
          <div className="k">ยอดขายวันนี้</div>
          <div className="v">{formatBaht(dashboard?.today.amount ?? 0)} ฿</div>
        </div>
        <div className="stat">
          <div className="k">ปริมาณวันนี้</div>
          <div className="v">{formatLitres(dashboard?.today.volume ?? 0)} ล.</div>
        </div>
        <div className="stat">
          <div className="k">จำนวนรายการ</div>
          <div className="v">{dashboard?.today.saleCount ?? 0}</div>
        </div>
        <div className="stat">
          <div className="k">ค้างชำระ</div>
          <div className="v">{formatBaht(dashboard?.pending.amount ?? 0)} ฿</div>
          <div className="hint">{dashboard?.pending.count ?? 0} รายการ</div>
        </div>
      </div>

      <div className="panel">
        <h3>ยอดขายรายวัน (14 วันล่าสุด)</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
          {[...daily].reverse().map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${formatBaht(day.amount)} บาท`}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(4, (day.amount / maxDaily) * 110)}px`,
                  background: 'linear-gradient(180deg, #60a5fa, #2563eb)',
                  borderRadius: '6px 6px 0 0',
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{day.date.slice(5)}</div>
            </div>
          ))}
          {daily.length === 0 && <div className="hint">ยังไม่มีข้อมูลการขาย</div>}
        </div>
      </div>

      <div className="panel">
        <h3>รายงานตามช่วงเวลา</h3>
        <div className="row" style={{ marginBottom: 14 }}>
          <div>
            <div className="hint">ตั้งแต่</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="hint">ถึง</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <a
            href={`/api/reports/export.csv?from=${from}&to=${to}`}
            style={{ alignSelf: 'flex-end' }}
          >
            <button type="button">ดาวน์โหลด CSV</button>
          </a>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div>
            <h4>แยกตามชนิดน้ำมัน</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>สินค้า</th>
                    <th className="num">ลิตร</th>
                    <th className="num">ยอดเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.byProduct ?? []).map((row) => (
                    <tr key={row.productId}>
                      <td>
                        <span
                          className="badge"
                          style={{ background: row.color, color: '#0b1220', borderColor: row.color }}
                        >
                          {row.code}
                        </span>{' '}
                        {row.name}
                      </td>
                      <td className="num">{formatLitres(row.volume)}</td>
                      <td className="num">{formatBaht(row.amount)}</td>
                    </tr>
                  ))}
                  {(summary?.byProduct.length ?? 0) === 0 && (
                    <tr className="dim">
                      <td colSpan={3}>ไม่มีข้อมูลในช่วงนี้</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4>แยกตามหัวจ่าย</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>หัวจ่าย</th>
                    <th className="num">ลิตร</th>
                    <th className="num">ยอดเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.byNozzle ?? []).map((row) => (
                    <tr key={row.nozzleId}>
                      <td>
                        {row.label} <span className="hint">{row.productName}</span>
                      </td>
                      <td className="num">{formatLitres(row.volume)}</td>
                      <td className="num">{formatBaht(row.amount)}</td>
                    </tr>
                  ))}
                  {(summary?.byNozzle.length ?? 0) === 0 && (
                    <tr className="dim">
                      <td colSpan={3}>ไม่มีข้อมูลในช่วงนี้</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4>แยกตามวิธีชำระเงิน</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>วิธีชำระ</th>
                    <th className="num">จำนวน</th>
                    <th className="num">ยอดเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.byMethod ?? []).map((row) => (
                    <tr key={row.method}>
                      <td>{METHOD_LABEL[row.method] ?? row.method}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{formatBaht(row.amount)}</td>
                    </tr>
                  ))}
                  {(summary?.byMethod.length ?? 0) === 0 && (
                    <tr className="dim">
                      <td colSpan={3}>ไม่มีข้อมูลในช่วงนี้</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4>ตรวจผลต่างมิเตอร์</h4>
            <div className="hint" style={{ marginBottom: 6 }}>
              ผลต่างที่มากผิดปกติ = มีการจ่ายที่ไม่ได้บันทึกเป็นรายการขาย
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>หัวจ่าย</th>
                    <th className="num">ตามมิเตอร์</th>
                    <th className="num">ตามระบบ</th>
                    <th className="num">ผลต่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {(summary?.meter ?? []).map((row) => (
                    <tr key={row.nozzleId}>
                      <td>{row.label}</td>
                      <td className="num">{formatLitres(row.meterVolume)}</td>
                      <td className="num">{formatLitres(row.soldVolume)}</td>
                      <td
                        className="num"
                        style={{ color: Math.abs(row.variance) > 100 ? '#fca5a5' : undefined }}
                      >
                        {formatLitres(row.variance)}
                      </td>
                    </tr>
                  ))}
                  {(summary?.meter.length ?? 0) === 0 && (
                    <tr className="dim">
                      <td colSpan={4}>ไม่มีข้อมูลในช่วงนี้</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
