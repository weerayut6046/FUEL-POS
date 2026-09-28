'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Ban, Download, FileText, Printer, Receipt } from 'lucide-react';
import { useStore, useCurrentUser } from '@/lib/store';
import { can, METHOD_LABEL } from '@/lib/domain';
import { baht, dayKey, litres, price, thDateTime } from '@/lib/units';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, ProductDot, Select, Stat, Table, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

export default function SalesPage() {
  return (
    <RequirePerm perm="pos">
      <Sales />
    </RequirePerm>
  );
}

function Sales() {
  const s = useStore();
  const user = useCurrentUser();
  const [date, setDate] = useState(dayKey());
  const [product, setProduct] = useState('');
  const [q, setQ] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const rows = s.sales.filter(
    (x) =>
      (!date || dayKey(new Date(x.createdAt)) === date) &&
      (!product || x.productId === product) &&
      (!q || x.docNo.includes(q.toUpperCase()) || x.plate.includes(q)),
  );
  const paid = rows.filter((x) => x.status === 'paid');

  const exportCsv = () => {
    const head = ['เลขที่', 'วันเวลา', 'หัวจ่าย', 'ผลิตภัณฑ์', 'ลิตร', 'ราคา/ลิตร', 'ยอดหน้าตู้', 'ส่วนลด', 'สุทธิ', 'VAT', 'ก่อน VAT', 'ชำระ', 'สมาชิก', 'แต้ม', 'ทะเบียน', 'สถานะ'];
    const lines = rows.map((x) =>
      [
        x.docNo,
        new Date(x.createdAt).toLocaleString('th-TH'),
        s.nozzles.find((n) => n.id === x.nozzleId)?.label,
        s.products.find((p) => p.id === x.productId)?.name,
        (x.volume / 1000).toFixed(3),
        (x.unitPrice / 100).toFixed(2),
        (x.gross / 100).toFixed(2),
        (x.discount / 100).toFixed(2),
        (x.net / 100).toFixed(2),
        (x.vat / 100).toFixed(2),
        (x.beforeVat / 100).toFixed(2),
        METHOD_LABEL[x.method],
        s.members.find((m) => m.id === x.memberId)?.code ?? '',
        x.pointsEarned,
        x.plate,
        x.status === 'paid' ? 'ปกติ' : 'ยกเลิก',
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales-${date || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PageHeader
        title="รายการขาย"
        subtitle="ค้นหา พิมพ์ใบเสร็จซ้ำ ออกใบกำกับภาษี หรือยกเลิกบิล"
        icon={<Receipt className="size-5" />}
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download className="size-4" /> ส่งออก CSV
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ยอดสุทธิ" value={baht(paid.reduce((a, x) => a + x.net, 0))} unit="฿" tone="brand" />
        <Stat label="ปริมาณ" value={litres(paid.reduce((a, x) => a + x.volume, 0))} unit="ล." tone="green" />
        <Stat label="ภาษีขาย" value={baht(paid.reduce((a, x) => a + x.vat, 0))} unit="฿" />
        <Stat label="ส่วนลดโปรโมชั่น" value={baht(paid.reduce((a, x) => a + x.discount, 0))} unit="฿" tone="amber" />
      </div>
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">ทุกผลิตภัณฑ์</option>
            {s.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input placeholder="ค้นหาเลขที่ / ทะเบียน" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">ไม่มีรายการ</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>หัวจ่าย</th>
                <th className="text-right">ลิตร</th>
                <th className="text-right">ราคา</th>
                <th className="text-right">สุทธิ</th>
                <th>ชำระ</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const p = s.products.find((pp) => pp.id === x.productId)!;
                const inv = x.taxInvoiceId ? s.invoices.find((i) => i.id === x.taxInvoiceId) : null;
                return (
                  <tr key={x.id} className="tabular-nums">
                    <td>
                      <p className="font-medium">{x.docNo}</p>
                      <p className="text-xs text-slate-500">
                        {thDateTime(x.createdAt)} {x.plate && `· ${x.plate}`}
                      </p>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5">
                        <ProductDot color={p.color} /> {s.nozzles.find((n) => n.id === x.nozzleId)?.label} {p.shortName}
                      </span>
                    </td>
                    <td className="text-right">{litres(x.volume, 3)}</td>
                    <td className="text-right">{price(x.unitPrice)}</td>
                    <td className="text-right font-semibold">
                      {baht(x.net)}
                      {x.discount > 0 && <span className="block text-xs text-emerald-600">-{baht(x.discount)}</span>}
                    </td>
                    <td>{METHOD_LABEL[x.method]}</td>
                    <td>
                      {x.status === 'void' ? (
                        <Badge tone="red">ยกเลิก</Badge>
                      ) : inv ? (
                        <Badge tone="brand">{inv.no}</Badge>
                      ) : (
                        <Badge tone="green">ปกติ</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <a href={`/print/receipt/${x.id}`} target="_blank" rel="noreferrer">
                        <Button variant="ghost" size="sm" aria-label="พิมพ์ใบเสร็จ">
                          <Printer className="size-4" />
                        </Button>
                      </a>
                      {x.status === 'paid' && !x.taxInvoiceId && can(user?.role, 'invoice') && (
                        <Link href={`/invoices?sale=${x.id}`}>
                          <Button variant="ghost" size="sm" aria-label="ออกใบกำกับภาษี">
                            <FileText className="size-4" />
                          </Button>
                        </Link>
                      )}
                      {x.status === 'paid' && can(user?.role, 'void') && (
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setVoiding(x.id)} aria-label="ยกเลิกบิล">
                          <Ban className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title="ยกเลิกบิล"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoiding(null)}>
              ปิด
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!reason.trim()) return toast.error('กรุณาระบุเหตุผล');
                const err = s.voidSale(voiding!, reason);
                if (err) return toast.error(err);
                toast.success('ยกเลิกบิลแล้ว — คืนสต๊อกและแต้มเรียบร้อย');
                setVoiding(null);
                setReason('');
              }}
            >
              ยืนยันยกเลิก
            </Button>
          </>
        }
      >
        <Field label="เหตุผลการยกเลิก">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น คีย์ผิดหัวจ่าย" />
        </Field>
        <p className="mt-2 text-xs text-slate-500">ระบบจะคืนน้ำมันเข้าถังและหักแต้มสมาชิกคืนอัตโนมัติ</p>
      </Modal>
    </div>
  );
}
