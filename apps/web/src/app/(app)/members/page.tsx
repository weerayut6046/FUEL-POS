'use client';

import { useState } from 'react';
import { Gift, Pencil, Search, Star, Trash2, UserPlus, Users } from 'lucide-react';
import { useStore, useCurrentUser } from '@/lib/store';
import { can } from '@/lib/domain';
import type { Member } from '@/lib/types';
import { baht, litres, thDate, thDateTime } from '@/lib/units';
import { Badge, Button, Card, cn, Empty, Field, Input, Modal, PageHeader, Stat, Table, Textarea, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

export default function MembersPage() {
  return (
    <RequirePerm perm="members">
      <Members />
    </RequirePerm>
  );
}

function Members() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Member> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const list = s.members.filter((m) => !q || [m.name, m.phone, m.plate, m.code].some((v) => v.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <PageHeader
        title="สมาชิกสะสมแต้ม"
        subtitle={`ทุก ${s.station.bahtPerPoint} บาท = 1 แต้ม · แลกของรางวัลได้ที่หน้าสมาชิก`}
        icon={<Users className="size-5" />}
        actions={
          <Button onClick={() => setEditing({})}>
            <UserPlus className="size-4" /> สมัครสมาชิก
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="สมาชิกทั้งหมด" value={s.members.length.toLocaleString()} unit="คน" tone="brand" />
        <Stat label="แต้มคงค้างในระบบ" value={s.members.reduce((a, m) => a + m.points, 0).toLocaleString()} unit="แต้ม" tone="amber" />
        <Stat label="แลกของรางวัลแล้ว" value={s.redemptions.length.toLocaleString()} unit="ครั้ง" tone="green" />
      </div>
      <Card>
        <div className="border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="ค้นหาชื่อ เบอร์โทร ทะเบียน รหัส" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {list.length === 0 ? (
          <Empty icon={<Users className="size-6" />} title="ไม่พบสมาชิก" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>เบอร์โทร</th>
                <th>ทะเบียน</th>
                <th className="text-right">ยอดสะสม</th>
                <th className="text-right">แต้ม</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => setViewing(m.id)}>
                  <td>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-slate-500">
                      {m.code} · สมัคร {thDate(m.joinedAt)}
                    </p>
                  </td>
                  <td>{m.phone}</td>
                  <td>{m.plate || '-'}</td>
                  <td className="text-right tabular-nums">{baht(m.totalSpent)}</td>
                  <td className="text-right">
                    <Badge tone="amber">
                      <Star className="size-3" /> {m.points.toLocaleString()}
                    </Badge>
                  </td>
                  <td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(m);
                      }}
                      aria-label="แก้ไข"
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <MemberForm member={editing} onClose={() => setEditing(null)} />}
      {viewing && <MemberDetail id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function MemberForm({ member, onClose }: { member: Partial<Member>; onClose: () => void }) {
  const s = useStore();
  const user = useCurrentUser();
  const [f, setF] = useState({ name: '', phone: '', plate: '', taxId: '', address: '', ...member });
  const save = () => {
    if (!f.name.trim() || f.phone.length < 9) return toast.error('กรอกชื่อและเบอร์โทรให้ถูกต้อง');
    if (s.members.some((m) => m.phone === f.phone && m.id !== f.id)) return toast.error('เบอร์นี้เป็นสมาชิกแล้ว');
    if (f.taxId && !/^\d{13}$/.test(f.taxId)) return toast.error('เลขผู้เสียภาษีต้องเป็น 13 หลัก');
    const m = s.saveMember(f);
    toast.success(member.id ? 'บันทึกแล้ว' : `สมัครสมาชิก ${m.code} แล้ว`);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={member.id ? 'แก้ไขสมาชิก' : 'สมัครสมาชิกใหม่'}
      footer={
        <>
          {member.id && can(user?.role, 'settings') && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={() => {
                if (confirm('ลบสมาชิกนี้?')) {
                  s.deleteMember(member.id!);
                  onClose();
                }
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
        <Field label="ชื่อ-นามสกุล / บริษัท *" className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="เบอร์โทร *">
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="ทะเบียนรถ">
          <Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} />
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี (สำหรับใบกำกับ)" className="sm:col-span-2">
          <Input inputMode="numeric" maxLength={13} value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="ที่อยู่ (สำหรับใบกำกับ)" className="sm:col-span-2">
          <Textarea value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function MemberDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const m = s.members.find((x) => x.id === id);
  if (!m) return null;
  const sales = s.sales.filter((x) => x.memberId === id).slice(0, 20);
  const reds = s.redemptions.filter((r) => r.memberId === id);
  const redeem = (rewardId: string) => {
    const r = s.rewards.find((x) => x.id === rewardId)!;
    if (!confirm(`แลก "${r.name}" ใช้ ${r.points} แต้ม?`)) return;
    const err = s.redeem(id, rewardId);
    if (err) return toast.error(err);
    toast.success(`แลก ${r.name} สำเร็จ`);
  };
  return (
    <Modal open onClose={onClose} title={m.name} size="lg">
      <div className="rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 p-5 text-white shadow-lg">
        <p className="text-sm opacity-80">
          {m.code} · {m.phone}
        </p>
        <p className="mt-2 text-4xl font-bold tabular-nums">{m.points.toLocaleString()}</p>
        <p className="text-sm opacity-90">แต้มสะสม · ยอดซื้อรวม {baht(m.totalSpent)} ฿</p>
      </div>

      <p className="mb-2 mt-5 flex items-center gap-2 font-semibold">
        <Gift className="size-4" /> แลกของรางวัล
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {s.rewards
          .filter((r) => r.active)
          .map((r) => {
            const ok = m.points >= r.points && r.stock > 0;
            return (
              <button
                key={r.id}
                disabled={!ok}
                onClick={() => redeem(r.id)}
                className={cn('rounded-xl border-2 p-3 text-left transition', ok ? 'border-amber-200 hover:border-amber-400 hover:bg-amber-50' : 'border-slate-100 opacity-50')}
              >
                <p className="text-2xl">{r.emoji}</p>
                <p className="mt-1 text-sm font-medium leading-tight">{r.name}</p>
                <p className="mt-1 text-xs text-amber-700">{r.points} แต้ม</p>
                <p className="text-[11px] text-slate-400">เหลือ {r.stock}</p>
              </button>
            );
          })}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 font-semibold">ประวัติการเติม</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {sales.map((x) => (
              <div key={x.id} className="flex justify-between px-3 py-2">
                <span>
                  {thDateTime(x.createdAt)}
                  <span className="block text-xs text-slate-500">
                    {s.products.find((p) => p.id === x.productId)?.shortName} {litres(x.volume)} ล.
                  </span>
                </span>
                <span className="text-right tabular-nums">
                  {baht(x.net)}
                  <span className="block text-xs text-amber-600">+{x.pointsEarned}</span>
                </span>
              </div>
            ))}
            {sales.length === 0 && <p className="p-4 text-center text-slate-500">ยังไม่มี</p>}
          </div>
        </div>
        <div>
          <p className="mb-2 font-semibold">ประวัติการแลก</p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {reds.map((r) => (
              <div key={r.id} className="flex justify-between px-3 py-2">
                <span>
                  {s.rewards.find((x) => x.id === r.rewardId)?.name}
                  <span className="block text-xs text-slate-500">{thDateTime(r.at)}</span>
                </span>
                <span className="text-rose-600">-{r.points}</span>
              </div>
            ))}
            {reds.length === 0 && <p className="p-4 text-center text-slate-500">ยังไม่มี</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
