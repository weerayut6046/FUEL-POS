'use client';

import { useState } from 'react';
import { BadgePercent, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { PROMO_LABEL } from '@/lib/domain';
import type { Promotion, PromotionType } from '@/lib/types';
import { baht, monthKey, parseNum, thMonth, toSatang } from '@/lib/units';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, ProductDot, Select, Textarea, Toggle, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

const shiftMonth = (key: string, delta: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
};

const describe = (p: Promotion) =>
  p.type === 'discount_per_liter'
    ? `ลด ${p.value} สตางค์/ลิตร`
    : p.type === 'percent_discount'
      ? `ลด ${p.value}%`
      : p.type === 'points_multiplier'
        ? `แต้ม x${p.value}`
        : `+${p.value} แต้ม/บิล`;

export default function PromotionsPage() {
  return (
    <RequirePerm perm="promotions">
      <Promotions />
    </RequirePerm>
  );
}

function Promotions() {
  const s = useStore();
  const [month, setMonth] = useState(monthKey());
  const [editing, setEditing] = useState<Partial<Promotion> | null>(null);
  const list = s.promotions.filter((p) => p.month === month);

  const copyPrev = () => {
    const prev = s.promotions.filter((p) => p.month === shiftMonth(month, -1));
    if (prev.length === 0) return toast.error('เดือนก่อนหน้าไม่มีโปรโมชั่น');
    prev.forEach(({ id: _id, ...p }) => s.savePromotion({ ...p, month }));
    toast.success(`คัดลอก ${prev.length} โปรโมชั่นแล้ว`);
  };

  return (
    <div>
      <PageHeader
        title="โปรโมชั่นประจำเดือน"
        subtitle="ระบบใช้โปรที่ตรงเงื่อนไขอัตโนมัติตอนขาย — ส่วนลดใช้ตัวที่ดีที่สุด 1 ตัว แต้มใช้ตัวคูณสูงสุด + แต้มพิเศษ"
        icon={<BadgePercent className="size-5" />}
        actions={
          <Button onClick={() => setEditing({ month, type: 'discount_per_liter', productIds: [], active: true, membersOnly: false })}>
            <Plus className="size-4" /> สร้างโปรโมชั่น
          </Button>
        }
      />
      <Card className="mb-4 flex items-center justify-between gap-2 p-2">
        <Button variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="เดือนก่อน">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{thMonth(month)}</p>
          {month === monthKey() && <p className="text-xs text-emerald-600">เดือนปัจจุบัน</p>}
        </div>
        <Button variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="เดือนถัดไป">
          <ChevronRight className="size-5" />
        </Button>
      </Card>

      {list.length === 0 ? (
        <Card>
          <Empty icon={<BadgePercent className="size-6" />} title="ยังไม่มีโปรโมชั่นในเดือนนี้">
            <Button variant="secondary" size="sm" className="mt-2" onClick={copyPrev}>
              <Copy className="size-4" /> คัดลอกจากเดือนก่อน
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id} className="flex gap-4 p-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-rose-500 text-sm font-bold text-white">
                {p.type === 'points_multiplier' ? `x${p.value}` : p.type === 'bonus_points' ? `+${p.value}` : p.type === 'percent_discount' ? `${p.value}%` : `-${p.value}`}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{p.name}</p>
                  <Badge tone={p.active ? 'green' : 'slate'}>{p.active ? 'ใช้งาน' : 'ปิด'}</Badge>
                </div>
                <p className="text-sm text-slate-500">{p.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="brand">{describe(p)}</Badge>
                  {p.membersOnly && <Badge tone="amber">เฉพาะสมาชิก</Badge>}
                  {p.minAmount > 0 && <Badge>ขั้นต่ำ {baht(p.minAmount, 0)} ฿</Badge>}
                  {(p.productIds.length ? s.products.filter((x) => p.productIds.includes(x.id)) : s.products).map((x) => (
                    <Badge key={x.id}>
                      <ProductDot color={x.color} className="size-2" /> {x.shortName}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditing(p)} aria-label="แก้ไข">
                <Pencil className="size-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
      {editing && <PromoForm promo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PromoForm({ promo, onClose }: { promo: Partial<Promotion>; onClose: () => void }) {
  const s = useStore();
  const [f, setF] = useState({
    name: promo.name ?? '',
    description: promo.description ?? '',
    month: promo.month ?? monthKey(),
    type: promo.type ?? ('discount_per_liter' as PromotionType),
    value: String(promo.value ?? ''),
    productIds: promo.productIds ?? [],
    minAmount: promo.minAmount ? String(promo.minAmount / 100) : '',
    membersOnly: promo.membersOnly ?? false,
    active: promo.active ?? true,
  });
  const unit = { discount_per_liter: 'สตางค์ต่อลิตร', percent_discount: '%', points_multiplier: 'เท่า', bonus_points: 'แต้มต่อบิล' }[f.type];
  const save = () => {
    const value = parseNum(f.value);
    if (!f.name.trim() || !(value > 0)) return toast.error('กรอกชื่อและค่าโปรโมชั่น');
    s.savePromotion({
      id: promo.id,
      name: f.name,
      description: f.description,
      month: f.month,
      type: f.type,
      value,
      productIds: f.productIds,
      minAmount: toSatang(parseNum(f.minAmount) || 0),
      membersOnly: f.membersOnly || f.type === 'points_multiplier' || f.type === 'bonus_points',
      active: f.active,
    });
    toast.success('บันทึกโปรโมชั่นแล้ว');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={promo.id ? 'แก้ไขโปรโมชั่น' : 'สร้างโปรโมชั่น'}
      footer={
        <>
          {promo.id && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={() => {
                s.deletePromotion(promo.id!);
                onClose();
              }}
            >
              <Trash2 className="size-4" /> ลบ
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save}>บันทึก</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อโปรโมชั่น" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="รายละเอียด" className="sm:col-span-2">
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="เดือน">
          <Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
        </Field>
        <Field label="ประเภท">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PromotionType })}>
            {(Object.keys(PROMO_LABEL) as PromotionType[]).map((t) => (
              <option key={t} value={t}>
                {PROMO_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`ค่า (${unit})`}>
          <Input inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </Field>
        <Field label="ยอดขั้นต่ำต่อบิล (บาท)">
          <Input inputMode="decimal" value={f.minAmount} onChange={(e) => setF({ ...f, minAmount: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-slate-600">ผลิตภัณฑ์ (ไม่เลือก = ทุกชนิด)</p>
          <div className="flex flex-wrap gap-2">
            {s.products.map((p) => {
              const on = f.productIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setF({ ...f, productIds: on ? f.productIds.filter((x) => x !== p.id) : [...f.productIds, p.id] })}
                  className={`flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}
                >
                  <ProductDot color={p.color} /> {p.name}
                </button>
              );
            })}
          </div>
        </div>
        <Toggle checked={f.membersOnly || f.type === 'points_multiplier' || f.type === 'bonus_points'} onChange={(v) => setF({ ...f, membersOnly: v })} label="เฉพาะสมาชิก" />
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดใช้งาน" />
      </div>
    </Modal>
  );
}
