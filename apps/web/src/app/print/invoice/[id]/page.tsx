'use client';

import { useParams } from 'next/navigation';
import { PrintShell } from '@/components/PrintShell';
import { InvoiceView } from '@/components/Documents';
import { useStore } from '@/lib/store';

export default function PrintInvoice() {
  const { id } = useParams<{ id: string }>();
  useStore((s) => s.invoices);
  return (
    <PrintShell>
      {() => {
        const inv = useStore.getState().invoices.find((x) => x.id === id);
        if (!inv) return <p>ไม่พบใบกำกับภาษี</p>;
        return (
          <>
            <InvoiceView inv={inv} copy="ต้นฉบับ" />
            <div className="break-before-page" />
            <InvoiceView inv={inv} copy="สำเนา" />
          </>
        );
      }}
    </PrintShell>
  );
}
