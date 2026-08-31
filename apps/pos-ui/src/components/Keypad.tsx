interface KeypadProps {
  onKey: (key: string) => void;
  onClear: () => void;
  onBackspace: () => void;
  /** แสดงปุ่มจุดทศนิยม (ปิดเมื่อกรอก PIN) */
  decimal?: boolean;
}

/** แป้นตัวเลขขนาดใหญ่สำหรับจอสัมผัสหน้าลาน */
export function Keypad({ onKey, onClear, onBackspace, decimal = true }: KeypadProps) {
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
        <button key={key} type="button" onClick={() => onKey(key)}>
          {key}
        </button>
      ))}
      <button type="button" onClick={decimal ? () => onKey('.') : onClear}>
        {decimal ? '.' : 'ล้าง'}
      </button>
      <button type="button" onClick={() => onKey('0')}>
        0
      </button>
      <button type="button" onClick={onBackspace} aria-label="ลบทีละตัว">
        ⌫
      </button>
    </div>
  );
}

/** ตัวช่วยแก้ไขสตริงตัวเลขจากแป้นกด */
export function applyKey(current: string, key: string, maxLength = 9): string {
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }
  // จำกัดทศนิยม 2 ตำแหน่ง (สตางค์)
  const [, fraction] = current.split('.');
  if (fraction !== undefined && fraction.length >= 2) return current;
  if (current.replace('.', '').length >= maxLength) return current;
  if (current === '0' && key !== '.') return key;
  return current + key;
}
