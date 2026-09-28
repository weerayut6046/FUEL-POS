'use client';

import { useState } from 'react';
import { IdCard, Pencil, UserPlus } from 'lucide-react';
import { useStore } from '@/lib/store';
import { ROLE_LABEL, workedMs } from '@/lib/domain';
import type { Employee, Role } from '@/lib/types';
import { monthKey, thDateTime, thMonth } from '@/lib/units';
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, Table, Toggle, toast } from '@/components/ui';
import { RequirePerm } from '@/components/AppShell';

const hours = (ms: number) => `${Math.floor(ms / 3_600_000)} ชม. ${Math.floor((ms % 3_600_000) / 60_000)} น.`;

export default function EmployeesPage() {
  return (
    <RequirePerm perm="employees">
      <Employees />
    </RequirePerm>
  );
}

function Employees() {
  const s = useStore();
  const [editing, setEditing] = useState<Partial<Employee> | null>(null);
  const [month, setMonth] = useState(monthKey());
  const entries = s.timeEntries.filter((t) => monthKey(new Date(t.clockIn)) === month);

  return (
    <div>
      <PageHeader
        title="พนักงาน"
        subtitle="ข้อมูลพนักงาน สิทธิ์การใช้งาน และสรุปเวลาทำงาน"
        icon={<IdCard className="size-5" />}
        actions={
          <Button onClick={() => setEditing({ role: 'attendant', active: true })}>
            <UserPlus className="size-4" /> เพิ่มพนักงาน
          </Button>
        }
      />
      <Card>
        <Table>
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>ตำแหน่ง</th>
              <th>เบอร์โทร</th>
              <th className="text-right">ชั่วโมงเดือนนี้</th>
              <th>สถานะ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.employees.map((e) => {
              const ms = entries.filter((t) => t.employeeId === e.id).reduce((a, t) => a + workedMs(t.clockIn, t.clockOut), 0);
              const onDuty = s.timeEntries.some((t) => t.employeeId === e.id && !t.clockOut);
              return (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{e.code}</td>
                  <td>
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-slate-500">{e.nickname}</p>
                  </td>
                  <td>
                    <Badge tone={e.role === 'owner' || e.role === 'manager' ? 'brand' : 'slate'}>{ROLE_LABEL[e.role]}</Badge>
                  </td>
                  <td>{e.phone || '-'}</td>
                  <td className="text-right tabular-nums">{hours(ms)}</td>
                  <td>
                    {!e.active ? <Badge tone="red">พ้นสภาพ</Badge> : onDuty ? <Badge tone="green">กำลังทำงาน</Badge> : <Badge>ออกงาน</Badge>}
                  </td>
                  <td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label="แก้ไข">
                      <Pencil className="size-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title={`บันทึกเวลาเข้า-ออก · ${thMonth(month)}`}
          extra={
            <div className="w-40 shrink-0">
              <Input type="month" className="h-8" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          }
        />
        {entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">ไม่มีข้อมูล</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th>เข้างาน</th>
                <th>ออกงาน</th>
                <th className="text-right">รวม</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((t) => (
                <tr key={t.id}>
                  <td>{s.employees.find((e) => e.id === t.employeeId)?.name}</td>
                  <td>{thDateTime(t.clockIn)}</td>
                  <td>{t.clockOut ? thDateTime(t.clockOut) : <Badge tone="green">ยังไม่ออก</Badge>}</td>
                  <td className="text-right tabular-nums">{hours(workedMs(t.clockIn, t.clockOut))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <EmployeeForm emp={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EmployeeForm({ emp, onClose }: { emp: Partial<Employee>; onClose: () => void }) {
  const s = useStore();
  const [f, setF] = useState({ name: '', nickname: '', role: 'attendant' as Role, pin: '', phone: '', active: true, ...emp });
  const save = () => {
    if (!f.name.trim()) return toast.error('กรุณาระบุชื่อ');
    if (!/^\d{4}$/.test(f.pin)) return toast.error('PIN ต้องเป็นตัวเลข 4 หลัก');
    if (s.employees.some((e) => e.pin === f.pin && e.id !== emp.id)) return toast.error('PIN นี้ถูกใช้แล้ว');
    if (emp.role === 'owner' && f.role !== 'owner' && s.employees.filter((e) => e.role === 'owner' && e.active).length <= 1)
      return toast.error('ต้องมีเจ้าของอย่างน้อย 1 คน');
    s.saveEmployee({ id: emp.id, name: f.name, nickname: f.nickname, role: f.role, pin: f.pin, phone: f.phone, active: f.active });
    toast.success('บันทึกแล้ว');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={emp.id ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save}>บันทึก</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ชื่อ-นามสกุล">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="ชื่อเล่น">
          <Input value={f.nickname} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
        </Field>
        <Field label="ตำแหน่ง / สิทธิ์">
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PIN 4 หลัก (ใช้เข้าระบบและลงเวลา)">
          <Input inputMode="numeric" maxLength={4} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="เบอร์โทร">
          <Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <div className="flex items-end pb-2">
          <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="ยังทำงานอยู่" />
        </div>
      </div>
    </Modal>
  );
}
