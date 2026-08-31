import type {
  NozzleLiveState,
  Nozzle,
  Payment,
  PaymentMethod,
  PresetMode,
  Product,
  Pump,
  Sale,
  Shift,
  User,
} from '@fuel-pos/shared';

const TOKEN_KEY = 'fuel-pos.token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let token = localStorage.getItem(TOKEN_KEY) ?? '';

export const getToken = (): string => token;

export function setToken(value: string): void {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `คำขอล้มเหลว (${response.status})`;
    if (response.status === 401) setToken('');
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export interface FloorLive {
  nozzles: NozzleLiveState[];
  products: Product[];
  shift: Shift | null;
  pendingSales: Sale[];
  mode: 'simulator' | 'hardware';
}

export interface ShiftSummary {
  shift: Shift;
  nozzles: {
    nozzleId: number;
    label: string;
    productName: string;
    openVolume: number;
    closeVolume: number | null;
    meterVolume: number | null;
    soldVolume: number;
    varianceVolume: number | null;
    soldAmount: number;
  }[];
  totals: {
    soldVolume: number;
    soldAmount: number;
    byMethod: { method: string; amount: number; count: number }[];
    pendingCount: number;
    pendingAmount: number;
    expectedCash: number;
    countedCash: number | null;
    cashVariance: number | null;
  };
}

export const api = {
  // -- ระบบ ---------------------------------------------------------------
  bootstrap: () =>
    request<{ station: { name: string; branch: string }; mode: string; hasUsers: boolean }>(
      'GET',
      '/api/bootstrap',
    ),

  // -- เข้าสู่ระบบ ---------------------------------------------------------
  login: (username: string, pin: string) =>
    request<{ token: string; user: User }>('POST', '/api/auth/login', { username, pin }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),
  me: () => request<{ user: User | null }>('GET', '/api/auth/me'),
  changePin: (userId: number, pin: string) =>
    request<{ ok: boolean }>('POST', `/api/users/${userId}/pin`, { pin }),

  // -- หน้าลาน ------------------------------------------------------------
  live: () => request<FloorLive>('GET', '/api/floor/live'),
  authorize: (nozzleId: number, mode: PresetMode, value: number) =>
    request<{ ok: boolean }>('POST', `/api/floor/nozzles/${nozzleId}/authorize`, { mode, value }),
  stopNozzle: (nozzleId: number) =>
    request<{ ok: boolean }>('POST', `/api/floor/nozzles/${nozzleId}/stop`),
  simulate: (pumpId: number, index: number, action: 'lift' | 'hang' | 'trigger-on' | 'trigger-off') =>
    request<{ ok: boolean }>('POST', `/api/floor/simulate/${pumpId}/${index}`, { action }),

  // -- การขาย -------------------------------------------------------------
  pendingSales: () => request<Sale[]>('GET', '/api/sales/pending'),
  recentSales: (limit = 50) => request<Sale[]>('GET', `/api/sales?limit=${limit}`),
  pay: (
    saleId: number,
    payments: { method: PaymentMethod; amount: number; tendered?: number; reference?: string }[],
    extra?: { vehiclePlate?: string; note?: string },
  ) =>
    request<{
      sale: Sale;
      change: number;
      payments: Payment[];
      released: boolean;
      releaseError: string | null;
    }>('POST', `/api/sales/${saleId}/pay`, { payments, ...extra }),
  voidSale: (saleId: number, reason: string) =>
    request<Sale>('POST', `/api/sales/${saleId}/void`, { reason }),
  receipt: (saleId: number) =>
    request<{
      station: { name: string; branch: string; taxId: string; address: string; phone: string };
      sale: Sale;
      payments: Payment[];
      nozzleLabel: string;
      productName: string;
      cashierName: string;
    }>('GET', `/api/sales/${saleId}/receipt`),

  // -- กะ -----------------------------------------------------------------
  currentShift: () => request<Shift | null>('GET', '/api/shifts/current'),
  shifts: () => request<Shift[]>('GET', '/api/shifts'),
  openShift: (name: string, openingFloat: number) =>
    request<Shift>('POST', '/api/shifts/open', { name, openingFloat }),
  closeShift: (id: number, countedCash: number, note?: string, force?: boolean) =>
    request<{ shift: Shift; summary: ShiftSummary }>('POST', `/api/shifts/${id}/close`, {
      countedCash,
      note,
      force,
    }),
  shiftSummary: (id: number) => request<ShiftSummary>('GET', `/api/shifts/${id}/summary`),

  // -- สินค้า / ราคา -------------------------------------------------------
  products: () => request<Product[]>('GET', '/api/products'),
  setPrice: (productId: number, unitPrice: number, note?: string) =>
    request<{
      product: Product;
      pushResults: { nozzleId: number; ok: boolean; error?: string }[];
    }>('POST', `/api/products/${productId}/price`, { unitPrice, note }),
  priceHistory: (productId: number) =>
    request<
      {
        id: number;
        old_price: number;
        new_price: number;
        changed_at: string;
        changed_by_name: string | null;
        pushed_to_pumps: number;
        note: string | null;
      }[]
    >('GET', `/api/products/${productId}/price-history`),

  // -- ตู้จ่าย -------------------------------------------------------------
  pumps: () =>
    request<{
      pumps: Pump[];
      nozzles: Nozzle[];
      buses: { id: string; label: string; profileId: string; connected: boolean; error: string | null; describe: string }[];
    }>('GET', '/api/pumps'),

  // -- รายงาน -------------------------------------------------------------
  dashboard: () =>
    request<{
      today: { saleCount: number; volume: number; amount: number };
      pending: { count: number; amount: number };
      byProductToday: { productId: number; code: string; name: string; color: string; saleCount: number; volume: number; amount: number }[];
    }>('GET', '/api/reports/dashboard'),
  daily: (days = 14) =>
    request<{ date: string; saleCount: number; volume: number; amount: number }[]>(
      'GET',
      `/api/reports/daily?days=${days}`,
    ),
  reportSummary: (from: string, to: string) =>
    request<{
      from: string;
      to: string;
      byProduct: { productId: number; code: string; name: string; color: string; saleCount: number; volume: number; amount: number }[];
      byNozzle: { nozzleId: number; label: string; pumpName: string; productName: string; saleCount: number; volume: number; amount: number }[];
      byMethod: { method: string; count: number; amount: number }[];
      meter: { nozzleId: number; label: string; meterVolume: number; soldVolume: number; variance: number }[];
    }>('GET', `/api/reports/summary?from=${from}&to=${to}`),

  // -- Protocol Lab --------------------------------------------------------
  lab: {
    serialPorts: () =>
      request<{ path: string; manufacturer?: string; serialNumber?: string }[]>(
        'GET',
        '/api/lab/serial-ports',
      ),
    buses: () =>
      request<{ id: string; label: string; profileId: string; connected: boolean; error: string | null; describe: string }[]>(
        'GET',
        '/api/lab/buses',
      ),
    profiles: () =>
      request<
        {
          id: string;
          name: string;
          vendor: string | null;
          unverified: boolean;
          description: string | null;
          baudRate: number;
          framing: string;
          checksum: string;
          nozzlesPerPump: number;
        }[]
      >('GET', '/api/lab/profiles'),
    profile: (id: string) => request<unknown>('GET', `/api/lab/profiles/${id}`),
    send: (busId: string, hex: string) =>
      request<{ ok: boolean; sent: string }>('POST', '/api/lab/send', { busId, hex }),
    decode: (profileId: string, hex: string) =>
      request<Record<string, unknown>>('POST', '/api/lab/decode', { profileId, hex }),
    analyze: (frames: string[]) =>
      request<{
        summary: string[];
        columns: { index: number; values: number[]; constant: boolean }[];
        checksums: { kind: string; description: string }[];
      }>('POST', '/api/lab/analyze', { frames }),
    sniff: (path: string, baudRate: number, durationMs: number) =>
      request<{
        totalBytes: number;
        durationMs: number;
        blocks: { hex: string; ascii: string; length: number }[];
        suggestion: {
          boundaries: { stx: number; etx: number; stxConfidence: number; etxConfidence: number } | null;
          checksums: { kind: string; description: string }[];
        };
        summary: string[];
      }>('POST', '/api/lab/sniff', { path, baudRate, durationMs }),
    scanBaud: (path: string, perBaudMs = 3000) =>
      request<{ baudRate: number; bytes: number; blocks: number; score: number; sample: string }[]>(
        'POST',
        '/api/lab/scan-baud',
        { path, perBaudMs },
      ),
    probeAddresses: (busId: string, from = 0, to = 16) =>
      request<{
        found: { address: number; responseHex: string | null }[];
        all: { address: number; responded: boolean; responseHex: string | null; error: string | null }[];
      }>('POST', '/api/lab/probe-addresses', { busId, from, to }),
  },
};
