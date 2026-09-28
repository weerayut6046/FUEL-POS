'use client';

import { useParams } from 'next/navigation';
import { PrintShell } from '@/components/PrintShell';
import { ShiftReportView } from '@/components/Documents';
import { useStore } from '@/lib/store';

export default function PrintShift() {
  const { id } = useParams<{ id: string }>();
  useStore((s) => s.shifts);
  return (
    <PrintShell>
      {() => {
        const shift = useStore.getState().shifts.find((x) => x.id === id);
        return shift?.summary ? <ShiftReportView shift={shift} /> : <p>ไม่พบรายงานกะ</p>;
      }}
    </PrintShell>
  );
}
