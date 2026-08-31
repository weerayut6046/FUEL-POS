import type { NozzleLiveState, NozzleStatus, Product } from '@fuel-pos/shared';
import { formatBaht, formatLitres, formatPrice } from '@fuel-pos/shared';

const STATUS_TEXT: Record<NozzleStatus, string> = {
  idle: 'ว่าง',
  authorized: 'ปลดล็อกแล้ว รอยกหัวจ่าย',
  nozzle_out: 'ยกหัวจ่ายแล้ว',
  filling: 'กำลังจ่าย',
  complete: 'จ่ายเสร็จ — รอเก็บเงิน',
  stopped: 'หยุดกลางคัน',
  offline: 'ติดต่อตู้ไม่ได้',
  error: 'ตู้แจ้งข้อผิดพลาด',
};

const STATUS_TONE: Record<NozzleStatus, string> = {
  idle: '',
  authorized: 'warn',
  nozzle_out: 'warn',
  filling: 'ok',
  complete: 'warn',
  stopped: 'warn',
  offline: 'danger',
  error: 'danger',
};

interface Props {
  nozzle: NozzleLiveState;
  product: Product | undefined;
  selected: boolean;
  onSelect: () => void;
}

export function NozzleCard({ nozzle, product, selected, onSelect }: Props) {
  const classes = [
    'nozzle-card',
    nozzle.status,
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{ ['--product-color' as string]: product?.color ?? '#3b82f6' }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect();
      }}
    >
      <div className="nozzle-head">
        <div>
          <div className="nozzle-label">{nozzle.label}</div>
          <div className="nozzle-product">{product?.name ?? 'ยังไม่ได้กำหนดสินค้า'}</div>
        </div>
        <span className={`badge ${STATUS_TONE[nozzle.status]}`}>{STATUS_TEXT[nozzle.status]}</span>
      </div>

      <div className="readout">
        <div className="cell">
          <div className="k">ลิตร</div>
          <div className="v">{formatLitres(nozzle.volume)}</div>
        </div>
        <div className="cell">
          <div className="k">จำนวนเงิน (บาท)</div>
          <div className="v money">{formatBaht(nozzle.amount)}</div>
        </div>
      </div>

      <div className="meta-row">
        <span>ราคา {formatPrice(nozzle.unitPrice)} บาท/ลิตร</span>
        {nozzle.presetMode !== 'none' && nozzle.presetValue > 0 && (
          <span>
            ตั้งไว้{' '}
            {nozzle.presetMode === 'amount'
              ? `${formatBaht(nozzle.presetValue)} บาท`
              : `${formatLitres(nozzle.presetValue)} ลิตร`}
          </span>
        )}
      </div>

      <div className="meta-row">
        <span>มิเตอร์รวม {formatLitres(nozzle.totalizerVolume)} ล.</span>
        {nozzle.pendingSaleId !== null && <span className="badge warn">ค้างชำระ</span>}
      </div>

      {nozzle.error && <div className="error-box">{nozzle.error}</div>}
    </div>
  );
}
