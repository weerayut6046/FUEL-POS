'use client';

import { useStore } from '@/lib/store';
import { METHOD_LABEL } from '@/lib/domain';
import type { Sale, Shift, TaxInvoice } from '@/lib/types';
import { baht, bahtText, litres, price, thDate, thDateTime } from '@/lib/units';

/** ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ (กระดาษ 80 มม.) */
export function ReceiptView({ sale }: { sale: Sale }) {
  const s = useStore();
  const product = s.products.find((p) => p.id === sale.productId);
  const nozzle = s.nozzles.find((n) => n.id === sale.nozzleId);
  const member = s.members.find((m) => m.id === sale.memberId);
  const employee = s.employees.find((e) => e.id === sale.employeeId);
  const st = s.station;
  return (
    <div className="mx-auto w-full max-w-[300px] font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        <p className="text-sm font-bold">{st.name}</p>
        <p>{st.branch}</p>
        <p className="whitespace-pre-line">{st.address}</p>
        {st.vatRegistered && <p>เลขประจำตัวผู้เสียภาษี {st.taxId}</p>}
        <p>โทร {st.phone}</p>
        <p className="mt-1 font-bold">{st.vatRegistered ? 'ใบกำกับภาษีอย่างย่อ/ใบเสร็จรับเงิน' : 'ใบเสร็จรับเงิน'}</p>
        {sale.status === 'void' && <p className="font-bold">*** ยกเลิก ***</p>}
      </div>
      <Dash />
      <Line l="เลขที่" r={sale.docNo} />
      <Line l="วันที่" r={thDateTime(sale.createdAt)} />
      <Line l="ตู้/หัวจ่าย" r={nozzle?.label ?? '-'} />
      {sale.plate && <Line l="ทะเบียน" r={sale.plate} />}
      <Dash />
      <p className="font-bold">{product?.name}</p>
      <Line l={`${litres(sale.volume, 3)} ล. x ${price(sale.unitPrice)}`} r={baht(sale.gross)} />
      {sale.discount > 0 && <Line l="ส่วนลด" r={`-${baht(sale.discount)}`} />}
      <Dash />
      <Line l="รวมเงิน" r={baht(sale.net)} bold />
      {st.vatRegistered && (
        <>
          <Line l="มูลค่าสินค้า" r={baht(sale.beforeVat)} />
          <Line l={`ภาษีมูลค่าเพิ่ม ${st.vatRate}%`} r={baht(sale.vat)} />
        </>
      )}
      <Line l={METHOD_LABEL[sale.method]} r={baht(sale.received)} />
      {sale.change > 0 && <Line l="เงินทอน" r={baht(sale.change)} />}
      {member && (
        <>
          <Dash />
          <Line l="สมาชิก" r={member.code} />
          <Line l="แต้มที่ได้รับ" r={`+${sale.pointsEarned}`} />
          <Line l="แต้มคงเหลือ" r={member.points.toLocaleString()} />
        </>
      )}
      <Dash />
      <p>พนักงาน: {employee?.nickname || employee?.name}</p>
      <p className="mt-2 text-center">{st.receiptFooter}</p>
    </div>
  );
}

function Dash() {
  return <div className="my-1.5 border-t border-dashed border-black/60" />;
}
function Line({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'text-sm font-bold' : ''}`}>
      <span>{l}</span>
      <span className="text-right tabular-nums">{r}</span>
    </div>
  );
}

/** ใบกำกับภาษีเต็มรูปแบบ (A4) ตามมาตรา 86/4 แห่งประมวลรัษฎากร */
export function InvoiceView({ inv, copy }: { inv: TaxInvoice; copy: 'ต้นฉบับ' | 'สำเนา' }) {
  const s = useStore();
  const st = s.station;
  const sales = s.sales.filter((x) => inv.saleIds.includes(x.id));
  const discount = inv.lines.reduce((a, l) => a + l.discount, 0);
  const gross = inv.lines.reduce((a, l) => a + l.gross, 0);
  return (
    <div className="mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] text-black print:p-0">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-lg font-bold">{st.name}</p>
          <p className="whitespace-pre-line">{st.address}</p>
          <p>โทร {st.phone}</p>
          <p>
            เลขประจำตัวผู้เสียภาษีอากร <b>{st.taxId}</b> · {st.branch}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold">ใบกำกับภาษี / ใบเสร็จรับเงิน</p>
          <p className="text-sm">TAX INVOICE / RECEIPT</p>
          <p className="mt-1 inline-block rounded border border-black px-2 text-sm">{copy}</p>
          {inv.status === 'cancelled' && <p className="mt-1 font-bold text-red-600">*** ยกเลิก ***</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4 rounded border border-black/40 p-3">
        <div className="col-span-2 space-y-0.5">
          <p>
            <b>ผู้ซื้อ:</b> {inv.customerName}
          </p>
          <p>
            <b>ที่อยู่:</b> {inv.customerAddress || '-'}
          </p>
          <p>
            <b>เลขประจำตัวผู้เสียภาษี:</b> {inv.customerTaxId || '-'} {inv.customerBranch && <>· {inv.customerBranch}</>}
          </p>
          {inv.plate && (
            <p>
              <b>ทะเบียนรถ:</b> {inv.plate}
            </p>
          )}
        </div>
        <div className="space-y-0.5">
          <p>
            <b>เลขที่:</b> {inv.no}
          </p>
          <p>
            <b>วันที่:</b> {thDate(inv.issuedAt)}
          </p>
          <p>
            <b>อ้างอิง:</b> {sales.map((x) => x.docNo).join(', ')}
          </p>
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-[13px] [&_td]:border [&_td]:border-black/40 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-black/40 [&_th]:bg-slate-100 [&_th]:px-2 [&_th]:py-1.5">
        <thead>
          <tr>
            <th className="w-10">ลำดับ</th>
            <th className="text-left">รายการ</th>
            <th className="text-right">จำนวน (ลิตร)</th>
            <th className="text-right">ราคา/ลิตร</th>
            <th className="text-right">ส่วนลด</th>
            <th className="text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td className="text-center">{i + 1}</td>
              <td>{s.products.find((p) => p.id === l.productId)?.name ?? l.productId}</td>
              <td className="text-right tabular-nums">{litres(l.volume, 3)}</td>
              <td className="text-right tabular-nums">{price(l.unitPrice)}</td>
              <td className="text-right tabular-nums">{l.discount ? baht(l.discount) : '-'}</td>
              <td className="text-right tabular-nums">{baht(l.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex justify-between gap-6">
        <div className="self-end rounded bg-slate-100 px-3 py-2 font-medium">({bahtText(inv.total)})</div>
        <table className="w-72 text-[13px] [&_td]:px-2 [&_td]:py-1">
          <tbody>
            <tr>
              <td>รวมราคาตามหน้าตู้</td>
              <td className="text-right tabular-nums">{baht(gross)}</td>
            </tr>
            <tr>
              <td>ส่วนลด</td>
              <td className="text-right tabular-nums">{baht(discount)}</td>
            </tr>
            <tr>
              <td>มูลค่าสินค้าก่อนภาษี</td>
              <td className="text-right tabular-nums">{baht(inv.beforeVat)}</td>
            </tr>
            <tr>
              <td>ภาษีมูลค่าเพิ่ม {st.vatRate}%</td>
              <td className="text-right tabular-nums">{baht(inv.vat)}</td>
            </tr>
            <tr className="border-t-2 border-black font-bold">
              <td>จำนวนเงินรวมทั้งสิ้น</td>
              <td className="text-right tabular-nums">{baht(inv.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-16 grid grid-cols-2 gap-10 text-center">
        <div>
          <div className="mx-auto w-48 border-t border-black pt-1">ผู้รับสินค้า</div>
        </div>
        <div>
          <div className="mx-auto w-48 border-t border-black pt-1">ผู้รับเงิน / ผู้มีอำนาจลงนาม</div>
        </div>
      </div>
    </div>
  );
}

/** รายงานปิดกะ */
export function ShiftReportView({ shift }: { shift: Shift }) {
  const s = useStore();
  const sum = shift.summary;
  const emp = (id: string | null) => s.employees.find((e) => e.id === id)?.name ?? '-';
  if (!sum) return null;
  return (
    <div className="mx-auto w-full max-w-[210mm] bg-white p-6 text-[12px] text-black print:p-0">
      <p className="text-center text-base font-bold">รายงานปิดกะ {shift.no} · {shift.name}</p>
      <p className="text-center">{s.station.name}</p>
      <p className="mt-2">
        เปิด {thDateTime(shift.openedAt)} โดย {emp(shift.openedBy)} · ปิด {shift.closedAt && thDateTime(shift.closedAt)} โดย {emp(shift.closedBy)}
      </p>
      <table className="mt-3 w-full border-collapse [&_td]:border [&_td]:border-black/40 [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-black/40 [&_th]:bg-slate-100 [&_th]:px-1.5 [&_th]:py-1">
        <thead>
          <tr>
            <th>หัวจ่าย</th>
            <th>L เปิด</th>
            <th>L ปิด</th>
            <th>ลิตรตามมิเตอร์</th>
            <th>P เปิด</th>
            <th>P ปิด</th>
            <th>บาทตามมิเตอร์</th>
            <th>ลิตรในระบบ</th>
            <th>ต่าง (ล.)</th>
          </tr>
        </thead>
        <tbody>
          {sum.nozzles.map((r) => {
            const n = s.nozzles.find((x) => x.id === r.nozzleId);
            return (
              <tr key={r.nozzleId} className="text-right tabular-nums">
                <td className="text-left">{n?.label} {s.products.find((p) => p.id === n?.productId)?.shortName}</td>
                <td>{litres(r.open.volume)}</td>
                <td>{litres(r.close.volume)}</td>
                <td>{litres(r.meterVolume)}</td>
                <td>{baht(r.open.amount, 1)}</td>
                <td>{baht(r.close.amount, 1)}</td>
                <td>{baht(r.meterAmount)}</td>
                <td>{litres(r.posVolume)}</td>
                <td>{litres(r.varVolume)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 grid grid-cols-2 gap-6">
        <div>
          <p className="font-bold">การเงิน</p>
          <RL l="ยอดขายตามมิเตอร์" r={baht(sum.meterAmount)} />
          <RL l="ยอดในระบบ (สุทธิ)" r={baht(sum.posNet)} />
          <RL l="ส่วนลด" r={baht(sum.discount)} />
          {Object.entries(sum.byMethod).map(([k, v]) => v > 0 && <RL key={k} l={`  ${METHOD_LABEL[k as keyof typeof METHOD_LABEL]}`} r={baht(v)} />)}
          <RL l="เงินทอนตั้งต้น" r={baht(shift.openingCash)} />
          <RL l="เงินสดที่ต้องส่ง" r={baht(sum.expectedCash)} />
          <RL l="เงินสดนับได้" r={baht(sum.countedCash)} />
          <RL l="ขาด/เกิน" r={baht(sum.cashDiff)} bold />
        </div>
        <div>
          <p className="font-bold">สต๊อกถัง (ลิตร)</p>
          {sum.tanks.map((t) => (
            <RL
              key={t.tankId}
              l={s.tanks.find((x) => x.id === t.tankId)?.name ?? t.tankId}
              r={`${litres(t.expected)}${t.dip !== null ? ` / วัด ${litres(t.dip)} (${litres(t.variance ?? 0)})` : ''}`}
            />
          ))}
        </div>
      </div>
      {shift.note && <p className="mt-3">หมายเหตุ: {shift.note}</p>}
      <div className="mt-12 grid grid-cols-2 gap-10 text-center">
        <div className="mx-auto w-48 border-t border-black pt-1">ผู้ส่งกะ</div>
        <div className="mx-auto w-48 border-t border-black pt-1">ผู้ตรวจรับ</div>
      </div>
    </div>
  );
}

function RL({ l, r, bold }: { l: string; r: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between whitespace-pre ${bold ? 'font-bold' : ''}`}>
      <span>{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  );
}
