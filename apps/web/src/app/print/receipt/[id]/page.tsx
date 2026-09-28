'use client';

import { useParams } from 'next/navigation';
import { PrintShell } from '@/components/PrintShell';
import { ReceiptView } from '@/components/Documents';
import { useStore } from '@/lib/store';

export default function PrintReceipt() {
  const { id } = useParams<{ id: string }>();
  useStore((s) => s.sales);
  return (
    <PrintShell>
      {() => {
        const sale = useStore.getState().sales.find((x) => x.id === id);
        return sale ? <ReceiptView sale={sale} /> : <p>ไม่พบใบเสร็จ</p>;
      }}
    </PrintShell>
  );
}
