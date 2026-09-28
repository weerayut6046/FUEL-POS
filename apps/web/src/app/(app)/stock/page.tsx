'use client';

import { useState } from 'react';
import { ArrowDownToLine, Container, SlidersHorizontal } from 'lucide-react';
import { useStore, useCurrentUser } from '@/lib/store';
import { can } from '@/lib/domain';
import type { StockMoveType } from '@/lib/types';
import { baht, litres, parseNum, thDateTime, toMl, toSatang } from '@/lib/units';
import { Badge, Button, Card, CardHeader, cn, Field, Input, Modal, PageHeader, ProductDot, Select, Table, toast } from '@/components/ui';
import { TankGauge } from '@/components/TankGauge';
import { RequirePerm } from '@/components/AppShell';

const MOVE_LABEL: Record<StockMoveType, { label: string; tone: 'green' | 'red' | 'amber' | 'slate' | 'brand' }> = {
  delivery: { label: 'รับเข้า', tone: 'green' },
  sale: { label: 'ขาย', tone: 'slate' },
  void: { label: 'ยกเลิกบิล', tone: 'brand' },
  meter_adjust: { label: 'ปรับตามมิเตอร์', tone: 'amber' },
  dip_adjust: { label: 'ปรับตามวัดจริง', tone: 'amber' },
  manual: { label: 'ปรับมือ', tone: 'red' },
};

export default function StockPage() {
  return (
    <RequirePerm perm="stock">
      <Stock />
    </RequirePerm>
  );
}

function Stock() {
  const s = useStore();
  const user = useCurrentUser();
  const [receive, setReceive] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [filter, setFilter] = useState('');
  const moves = s.stockMoves.filter((m) => !filter || m.tankId === filter).slice(0, 200);

  return (
    <div>
      <PageHeader
        title="สต๊อกน้ำมัน"
        subtitle="ถัง 3 ใบ ผูกกับหัวจ่าย — ตัดสต๊อกทุกบิลขาย และปรับตามมิเตอร์ทุกครั้งที่ปิดกะ"
        icon={<Container className="size-5" />}
        actions={
          <>
            {can(user?.role, 'stock.receive') && (
              <Button variant="secondary" onClick={() => setAdjust(true)}>
                <SlidersHorizontal className="size-4" /> ปรับสต๊อก
              </Button>
            )}
            {can(user?.role, 'stock.receive') && (
              <Button onClick={() => setReceive(true)}>
                <ArrowDownToLine className="size-4" /> รับน้ำมันเข้าถัง
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="ระดับน้ำมัน" />
          <div className="grid grid-cols-3 gap-3 p-4">
            {s.tanks.map((t) => (
              <TankGauge key={t.id} tank={t} />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="ผังการเชื่อมต่อ ถัง → หัวจ่าย" />
          <div className="space-y-3 p-4">
            {s.tanks.map((t) => {
              const p = s.products.find((x) => x.id === t.productId)!;
              const ns = s.nozzles.filter((n) => n.tankId === t.id);
              return (
                <div key={t.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <ProductDot color={p.color} /> {t.name}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ns.map((n) => (
                      <Badge key={n.id} tone="brand">
                        {s.dispensers.find((d) => d.id === n.dispenserId)?.name} · หัว {n.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">แก้ไขการผูกได้ที่ ตั้งค่าระบบ → ตู้จ่าย/ถัง</p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="ความเคลื่อนไหวสต๊อก"
          extra={
            <div className="w-44 shrink-0">
              <Select className="h-8" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">ทุกถัง</option>
                {s.tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        {moves.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีความเคลื่อนไหว</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ถัง</th>
                <th>ประเภท</th>
                <th>อ้างอิง</th>
                <th className="text-right">ปริมาณ (ล.)</th>
                <th className="text-right">คงเหลือ (ล.)</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="tabular-nums">
                  <td className="whitespace-nowrap">{thDateTime(m.at)}</td>
                  <td>ถัง {s.tanks.find((t) => t.id === m.tankId)?.no}</td>
                  <td>
                    <Badge tone={MOVE_LABEL[m.type].tone}>{MOVE_LABEL[m.type].label}</Badge>
                  </td>
                  <td>
                    {m.ref}
                    {m.note && <span className="block text-xs text-slate-500">{m.note}</span>}
                  </td>
                  <td className={cn('text-right font-medium', m.volume > 0 ? 'text-emerald-600' : 'text-slate-700')}>
                    {m.volume > 0 ? '+' : ''}
                    {litres(m.volume)}
                  </td>
                  <td className="text-right">{litres(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="ประวัติรับน้ำมันเข้า" />
        {s.deliveries.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีการรับน้ำมัน</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>ถัง</th>
                <th>ผู้ส่ง / เลขที่เอกสาร</th>
                <th className="text-right">ลิตร</th>
                <th className="text-right">ต้นทุน/ล.</th>
                <th className="text-right">มูลค่า</th>
              </tr>
            </thead>
            <tbody>
              {s.deliveries.map((d) => (
                <tr key={d.id} className="tabular-nums">
                  <td>{thDateTime(d.at)}</td>
                  <td>{s.tanks.find((t) => t.id === d.tankId)?.name}</td>
                  <td>
                    {d.supplier} <span className="text-xs text-slate-500">{d.docNo}</span>
                  </td>
                  <td className="text-right">{litres(d.volume)}</td>
                  <td className="text-right">{baht(d.cost)}</td>
                  <td className="text-right">{baht(Math.round((d.volume * d.cost) / 1000))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ReceiveModal open={receive} onClose={() => setReceive(false)} />
      <AdjustModal open={adjust} onClose={() => setAdjust(false)} />
    </div>
  );
}

function ReceiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [f, setF] = useState({ tankId: s.tanks[0]?.id ?? '', volume: '', cost: '', supplier: '', docNo: '' });
  const tank = s.tanks.find((t) => t.id === f.tankId);
  const submit = () => {
    const err = s.receiveDelivery({
      tankId: f.tankId,
      volume: toMl(parseNum(f.volume) || 0),
      cost: toSatang(parseNum(f.cost) || 0),
      supplier: f.supplier,
      docNo: f.docNo,
    });
    if (err) return toast.error(err);
    toast.success('รับน้ำมันเข้าถังแล้ว');
    setF({ ...f, volume: '', cost: '', docNo: '' });
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="รับน้ำมันเข้าถัง"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={submit}>บันทึก</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ถัง" className="sm:col-span-2" hint={tank && `คงเหลือ ${litres(tank.level)} ล. · รับได้อีก ${litres(tank.capacity - tank.level)} ล.`}>
          <Select value={f.tankId} onChange={(e) => setF({ ...f, tankId: e.target.value })}>
            {s.tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="จำนวน (ลิตร)">
          <Input inputMode="decimal" value={f.volume} onChange={(e) => setF({ ...f, volume: e.target.value })} />
        </Field>
        <Field label="ต้นทุนต่อลิตร (บาท)">
          <Input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        </Field>
        <Field label="ผู้ส่ง / คลังน้ำมัน">
          <Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
        </Field>
        <Field label="เลขที่ใบส่งของ">
          <Input value={f.docNo} onChange={(e) => setF({ ...f, docNo: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStore();
  const [tankId, setTankId] = useState(s.tanks[0]?.id ?? '');
  const [level, setLevel] = useState('');
  const [note, setNote] = useState('');
  const tank = s.tanks.find((t) => t.id === tankId);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ปรับสต๊อกถัง"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const v = parseNum(level);
              if (!Number.isFinite(v) || v < 0) return toast.error('ระบุปริมาณให้ถูกต้อง');
              if (!note.trim()) return toast.error('กรุณาระบุเหตุผล');
              s.adjustTank(tankId, toMl(v), note);
              toast.success('ปรับสต๊อกแล้ว');
              setLevel('');
              setNote('');
              onClose();
            }}
          >
            ปรับสต๊อก
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="ถัง" hint={tank && `ตามบัญชีตอนนี้ ${litres(tank.level)} ล.`}>
          <Select value={tankId} onChange={(e) => setTankId(e.target.value)}>
            {s.tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ปริมาณที่ถูกต้อง (ลิตร)">
          <Input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} />
        </Field>
        <Field label="เหตุผล">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ตรวจนับประจำเดือน" />
        </Field>
      </div>
    </Modal>
  );
}
