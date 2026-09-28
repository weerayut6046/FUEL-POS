'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilePlus2, FileText, Printer, XCircle } from 'lucide-react';
import { useStore } from '@/lib/store';
import { baht, litres, thDate, thDateTime } from '@/lib/units';
import { Badge, Button, Card, cn, Field, Input, Modal, PageHeader, Select, Table, Textarea, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

export default function InvoicesPage() {
  return (
    <RequirePerm perm="invoice">
      <Suspense>
        <Invoices />
      </Suspense>
    </RequirePerm>
  );
}

function Invoices() {
  const s = useStore();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [preselect, setPreselect] = useState<string[]>([]);
  const [cancelId, setCancelId] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get('sale');
    if (id) {
      setPreselect([id]);
      setCreating(true);
    }
  }, [params]);

  return (
    <div>
      <PageHeader
        title="ใบกำกับภาษีเต็มรูปแบบ"
        subtitle="ออกจากบิลขายเดียวหรือรวมหลายบิล ตามมาตรา 86/4 — พิมพ์ต้นฉบับและสำเนา"
        icon={<FileText className="size-5" />}
        actions={
          <Button
            onClick={() => {
              setPreselect([]);
              setCreating(true);
            }}
          >
            <FilePlus2 className="size-4" /> ออกใบกำกับภาษี
          </Button>
        }
      />
      {!s.station.vatRegistered && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          ร้านยังไม่ได้ตั้งค่าเป็นผู้จดทะเบียน VAT — ไปที่ตั้งค่าระบบเพื่อเปิดใช้งาน
        </Card>
      )}
      <Card>
        {s.invoices.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">ยังไม่มีใบกำกับภาษี</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ผู้ซื้อ</th>
                <th className="text-right">ก่อน VAT</th>
                <th className="text-right">VAT</th>
                <th className="text-right">รวม</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.invoices.map((inv) => (
                <tr key={inv.id} className="tabular-nums">
                  <td className="font-medium">{inv.no}</td>
                  <td>{thDate(inv.issuedAt)}</td>
                  <td>
                    {inv.customerName}
                    <span className="block text-xs text-slate-500">{inv.customerTaxId}</span>
                  </td>
                  <td className="text-right">{baht(inv.beforeVat)}</td>
                  <td className="text-right">{baht(inv.vat)}</td>
                  <td className="text-right font-semibold">{baht(inv.total)}</td>
                  <td>{inv.status === 'issued' ? <Badge tone="green">ออกแล้ว</Badge> : <Badge tone="red">ยกเลิก</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    <a href={`/print/invoice/${inv.id}`} target="_blank" rel="noreferrer">
                      <Button variant="ghost" size="sm">
                        <Printer className="size-4" /> พิมพ์
                      </Button>
                    </a>
                    {inv.status === 'issued' && (
                      <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setCancelId(inv.id)} aria-label="ยกเลิกใบกำกับ">
                        <XCircle className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && <CreateInvoice preselect={preselect} onClose={() => setCreating(false)} />}

      <Modal
        open={!!cancelId}
        onClose={() => setCancelId(null)}
        title="ยกเลิกใบกำกับภาษี"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelId(null)}>
              ปิด
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                s.cancelInvoice(cancelId!);
                setCancelId(null);
                toast.success('ยกเลิกใบกำกับภาษีแล้ว บิลขายสามารถออกใบใหม่ได้');
              }}
            >
              ยืนยัน
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">เลขที่เอกสารจะไม่ถูกนำกลับมาใช้ใหม่ และยังคงอยู่ในรายงานภาษีขายในสถานะยกเลิก</p>
      </Modal>
    </div>
  );
}

function CreateInvoice({ preselect, onClose }: { preselect: string[]; onClose: () => void }) {
  const s = useStore();
  const available = s.sales.filter((x) => x.status === 'paid' && !x.taxInvoiceId).slice(0, 100);
  const [selected, setSelected] = useState<string[]>(preselect);
  const first = s.sales.find((x) => x.id === preselect[0]);
  const firstMember = s.members.find((m) => m.id === first?.memberId);
  const [f, setF] = useState({
    customerName: firstMember?.name ?? '',
    customerTaxId: firstMember?.taxId ?? '',
    customerBranch: 'สำนักงานใหญ่',
    customerAddress: firstMember?.address ?? '',
    plate: first?.plate ?? '',
  });
  const total = available.filter((x) => selected.includes(x.id)).reduce((a, x) => a + x.net, 0);

  const pickMember = (id: string) => {
    const m = s.members.find((x) => x.id === id);
    if (m) setF({ ...f, customerName: m.name, customerTaxId: m.taxId, customerAddress: m.address, plate: m.plate || f.plate });
  };

  const submit = () => {
    const r = s.issueInvoice({ saleIds: selected, ...f });
    if (typeof r === 'string') return toast.error(r);
    toast.success(`ออกใบกำกับภาษี ${r.no} แล้ว`);
    window.open(`/print/invoice/${r.id}`, '_blank');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="ออกใบกำกับภาษีเต็มรูปแบบ"
      size="xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-600">
            เลือก {selected.length} บิล · รวม <b>{baht(total)} ฿</b>
          </span>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit}>ออกใบกำกับและพิมพ์</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="ดึงข้อมูลจากสมาชิก">
            <Select defaultValue="" onChange={(e) => pickMember(e.target.value)}>
              <option value="">— เลือกสมาชิก —</option>
              {s.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.phone})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ชื่อผู้ซื้อ / บริษัท *">
            <Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)">
              <Input inputMode="numeric" maxLength={13} value={f.customerTaxId} onChange={(e) => setF({ ...f, customerTaxId: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label="สาขา">
              <Input value={f.customerBranch} onChange={(e) => setF({ ...f, customerBranch: e.target.value })} />
            </Field>
          </div>
          <Field label="ที่อยู่">
            <Textarea value={f.customerAddress} onChange={(e) => setF({ ...f, customerAddress: e.target.value })} />
          </Field>
          <Field label="ทะเบียนรถ">
            <Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">เลือกบิลขายที่ยังไม่ออกใบกำกับ</p>
          <div className="scroll-thin max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {available.map((x) => {
              const p = s.products.find((pp) => pp.id === x.productId);
              const on = selected.includes(x.id);
              return (
                <label key={x.id} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', on && 'bg-brand-50')}>
                  <input type="checkbox" checked={on} onChange={() => setSelected(on ? selected.filter((i) => i !== x.id) : [...selected, x.id])} />
                  <div className="flex-1">
                    <p className="font-medium">{x.docNo}</p>
                    <p className="text-xs text-slate-500">
                      {thDateTime(x.createdAt)} · {p?.shortName} {litres(x.volume)} ล. {x.plate && `· ${x.plate}`}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{baht(x.net)}</span>
                </label>
              );
            })}
            {available.length === 0 && <p className="p-6 text-center text-sm text-slate-500">ไม่มีบิลที่รอออกใบกำกับ</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
