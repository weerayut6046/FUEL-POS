'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useStore } from '@/lib/store';

/** โครงหน้าพิมพ์: โหลดข้อมูล + แถบปุ่มพิมพ์ (ไม่ถูกพิมพ์ออกไป) */
export function PrintShell({ children }: { children: () => React.ReactNode }) {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    void Promise.resolve(useStore.persist.rehydrate()).then(() => setOk(true));
  }, []);
  if (!ok) return null;
  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end gap-2 px-4">
        <button onClick={() => window.close()} className="rounded-xl bg-white px-4 py-2 text-sm shadow">
          ปิด
        </button>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow">
          <Printer className="size-4" /> พิมพ์
        </button>
      </div>
      <div className="mx-auto w-fit max-w-full bg-white p-4 shadow print:p-0 print:shadow-none">{children()}</div>
    </div>
  );
}
