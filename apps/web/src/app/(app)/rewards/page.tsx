'use client';

import { useState } from 'react';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore, useCurrentUser } from '@/lib/store';
import { can } from '@/lib/domain';
import type { Reward } from '@/lib/types';
import { thDateTime } from '@/lib/units';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Table, Toggle, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

export default function RewardsPage() {
  return (
    <RequirePerm perm="rewards">
      <Rewards />
    </RequirePerm>
  );
}

function Rewards() {
  const s = useStore();
  const user = useCurrentUser();
  const manage = can(user?.role, 'promotions');
  const [editing, setEditing] = useState<Partial<Reward> | null>(null);

  return (
    <div>
      <PageHeader
        title="ของรางวัล"
        subtitle="ของรางวัลสำหรับแลกแต้ม — แลกได้ที่หน้าสมาชิก"
        icon={<Gift className="size-5" />}
        actions={
          manage && (
            <Button onClick={() => setEditing({ emoji: '🎁', active: true })}>
              <Plus className="size-4" /> เพิ่มของรางวัล
            </Button>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {s.rewards.map((r) => (
          <Card key={r.id} className="relative overflow-hidden p-4">
            <div className="absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br from-amber-100 to-rose-100" />
            <div className="relative">
              <p className="text-4xl">{r.emoji}</p>
              <p className="mt-2 font-semibold leading-tight">{r.name}</p>
              <p className="mt-1 text-lg font-bold text-amber-600">{r.points.toLocaleString()} แต้ม</p>
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={r.stock > 0 ? 'slate' : 'red'}>คงเหลือ {r.stock}</Badge>
                {!r.active && <Badge tone="red">ปิดใช้งาน</Badge>}
              </div>
              {manage && (
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setEditing(r)}>
                  <Pencil className="size-4" /> แก้ไข
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="ประวัติการแลกของรางวัล" />
        {s.redemptions.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">ยังไม่มีการแลก</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>วันเวลา</th>
                <th>สมาชิก</th>
                <th>ของรางวัล</th>
                <th className="text-right">แต้มที่ใช้</th>
                <th>พนักงาน</th>
              </tr>
            </thead>
            <tbody>
              {s.redemptions.slice(0, 100).map((r) => (
                <tr key={r.id}>
                  <td>{thDateTime(r.at)}</td>
                  <td>{s.members.find((m) => m.id === r.memberId)?.name ?? '-'}</td>
                  <td>{s.rewards.find((x) => x.id === r.rewardId)?.name ?? '-'}</td>
                  <td className="text-right tabular-nums">{r.points}</td>
                  <td>{s.employees.find((e) => e.id === r.byEmployeeId)?.nickname ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && <RewardForm reward={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RewardForm({ reward, onClose }: { reward: Partial<Reward>; onClose: () => void }) {
  const s = useStore();
  const [f, setF] = useState({
    name: reward.name ?? '',
    emoji: reward.emoji ?? '🎁',
    points: String(reward.points ?? ''),
    stock: String(reward.stock ?? ''),
    active: reward.active ?? true,
  });
  const save = () => {
    const points = parseInt(f.points);
    const stock = parseInt(f.stock);
    if (!f.name.trim() || !(points > 0) || !(stock >= 0)) return toast.error('กรอกข้อมูลให้ครบ');
    s.saveReward({ id: reward.id, name: f.name, emoji: f.emoji, points, stock, active: f.active });
    toast.success('บันทึกแล้ว');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={reward.id ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัล'}
      size="sm"
      footer={
        <>
          {reward.id && (
            <Button
              variant="ghost"
              className="mr-auto text-rose-600"
              onClick={() => {
                s.deleteReward(reward.id!);
                onClose();
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save}>บันทึก</Button>
        </>
      }
    >
      <div className="grid grid-cols-[80px_1fr] gap-3">
        <Field label="ไอคอน">
          <Input value={f.emoji} onChange={(e) => setF({ ...f, emoji: e.target.value })} className="text-center text-xl" />
        </Field>
        <Field label="ชื่อของรางวัล">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="แต้มที่ใช้" className="col-span-2">
          <Input inputMode="numeric" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="จำนวนคงเหลือ" className="col-span-2">
          <Input inputMode="numeric" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <div className="col-span-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="เปิดให้แลก" />
        </div>
      </div>
    </Modal>
  );
}
