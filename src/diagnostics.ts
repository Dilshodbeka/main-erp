import { shippedQty, stockQty } from './domain';
import type { Actor, Order, State } from './types';

export type DiagnosticKind = 'error' | 'rejection';
export interface DiagnosticEntry { at: string; kind: DiagnosticKind; message: string; detail: string }
export interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface DiagnosticTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}
export interface DiagnosticCheck { id: string; title: string; hint: string; count: number }
export interface ReportSync { online: boolean; pending: { status: string; type: string; error: string }[] }
export interface ReportInput {
  state: State;
  actor: Actor;
  mode: string;
  build: string;
  entries: DiagnosticEntry[];
  sync?: ReportSync;
  at?: string;
}

const KEY = 'aliya-erp-diagnostics-v1';
const LAST_EXPORT_KEY = 'aliya-erp-diagnostics:last-export';
export const LIMIT = 100;
export const DEDUPE_MS = 10 * 60 * 1000;
export const REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
const EPS = 1e-6;

const clean = (value: string, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export const redact = (value: string) => value.replace(/\d{4,}/g, '[son]');
const ids = (rows: { id: string }[]) => new Set(rows.map(row => row.id));

export function listDiagnostics(storage: DiagnosticStorage): DiagnosticEntry[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(row => row && typeof row.at === 'string' && typeof row.message === 'string'
      && (row.kind === 'error' || row.kind === 'rejection')) as DiagnosticEntry[];
  } catch { return []; }
}

export function recordDiagnostic(storage: DiagnosticStorage, entry: DiagnosticEntry): DiagnosticEntry[] {
  const rows = listDiagnostics(storage);
  const next = {
    at: entry.at,
    kind: entry.kind,
    message: clean(entry.message, 300) || 'Noma’lum xatolik',
    detail: clean(entry.detail, 300),
  };
  const time = new Date(next.at).getTime();
  const duplicate = Number.isFinite(time) && rows.some(row => row.kind === next.kind && row.message === next.message
    && Math.abs(new Date(row.at).getTime() - time) < DEDUPE_MS);
  if (duplicate) return rows;
  const list = [next, ...rows].slice(0, LIMIT);
  storage.setItem(KEY, JSON.stringify(list));
  return list;
}

export function clearDiagnostics(storage: DiagnosticStorage) {
  storage.removeItem(KEY);
}

export function installDiagnostics(target: DiagnosticTarget, storage: DiagnosticStorage): () => void {
  const now = () => new Date().toISOString();
  const onError = (event: any) => {
    recordDiagnostic(storage, {
      at: now(), kind: 'error',
      message: event?.message || 'Skript xatosi',
      detail: `${event?.filename ?? ''}:${event?.lineno ?? 0}:${event?.colno ?? 0}`,
    });
  };
  const onRejection = (event: any) => {
    const reason = event?.reason;
    recordDiagnostic(storage, {
      at: now(), kind: 'rejection',
      message: reason instanceof Error ? reason.message : reason === undefined ? 'Va’da rad etildi' : String(reason),
      detail: 'unhandledrejection',
    });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

export function lastExportAt(storage: DiagnosticStorage): string | null {
  return storage.getItem(LAST_EXPORT_KEY);
}

export function markExported(storage: DiagnosticStorage, at: string) {
  storage.setItem(LAST_EXPORT_KEY, at);
}

export function reminderDue(storage: DiagnosticStorage, now: Date = new Date()): boolean {
  const last = lastExportAt(storage);
  if (!last) return true;
  const time = new Date(last).getTime();
  return !Number.isFinite(time) || now.getTime() - time >= REMINDER_MS;
}

function duplicateNumbers(state: State): number {
  const seen = new Map<string, number>();
  for (const order of state.orders) {
    const number = order.number.trim().toLowerCase();
    if (!number) continue;
    seen.set(number, (seen.get(number) ?? 0) + 1);
  }
  return [...seen.values()].filter(count => count > 1).length;
}

export function diagnosticChecks(state: State): DiagnosticCheck[] {
  const customerIds = ids(state.customers);
  const supplierIds = ids(state.suppliers);
  const employeeIds = ids(state.employees);
  const itemIds = ids(state.items);
  const orderIds = ids(state.orders);
  const shipmentIds = ids(state.shipments);
  const cashIds = ids(state.cash);
  const reportIds = ids(state.reports);
  const taskIds = new Map<string, Set<string>>(state.orders.map(order => [order.id, ids(order.route)]));
  const taskExists = (orderId: string, taskId: string) => !!taskIds.get(orderId)?.has(taskId);

  const negativeStock = state.items.filter(item => item.customerId === null && stockQty(state, item.id) < -EPS).length;
  const overshipped = state.orders.filter(order => shippedQty(state, order.id) - order.qty > EPS).length;
  const cashLinks = state.cash.filter(row => {
    if (row.customerId && !customerIds.has(row.customerId)) return true;
    if (!row.sourceId) return false;
    if (row.source === 'supplier') return !supplierIds.has(row.sourceId);
    if (row.source === 'payroll') return !employeeIds.has(row.sourceId);
    if (row.source === 'sale') return !customerIds.has(row.sourceId) && !orderIds.has(row.sourceId) && !shipmentIds.has(row.sourceId);
    return false;
  }).length;
  const cashReversal = state.cash.filter(row => !!row.reversalOf && !cashIds.has(row.reversalOf)).length;
  const payrollLinks = state.payroll.filter(row => (row.reportId !== null && !reportIds.has(row.reportId)) || !employeeIds.has(row.employeeId)
    || !orderIds.has(row.orderId) || !taskExists(row.orderId, row.taskId)).length;
  const reportLinks = state.reports.filter(row => !orderIds.has(row.orderId) || !employeeIds.has(row.employeeId)
    || !taskExists(row.orderId, row.taskId)).length;
  const movementItems = state.movements.filter(row => !itemIds.has(row.itemId)).length;
  const shipmentCustomer = state.shipments.filter(row => !customerIds.has(row.customerId)).length;
  const orderCustomer = state.orders.filter((order: Order) => order.kind !== 'series' && !customerIds.has(order.customerId)).length;

  return [
    {
      id: 'stock-negative', count: negativeStock,
      title: 'Ombor qoldig‘i manfiy emas',
      hint: 'Kirim va chiqimni solishtiring; omborni sanab, qoldiqni qayta tasdiqlang.',
    },
    {
      id: 'shipment-over', count: overshipped,
      title: 'Yuborilgan miqdor buyurtmadan oshmagan',
      hint: 'Buyurtma miqdori va yuborishlar qatorlarini solishtiring.',
    },
    {
      id: 'cash-links', count: cashLinks,
      title: 'Kassa yozuvlari mavjud yozuvga bog‘langan',
      hint: 'Kassadagi to‘lov bog‘langan mijoz, xodim, ta’minotchi yoki buyurtmani topmadi. Bekor qilish bilan tuzatish kerak.',
    },
    {
      id: 'cash-reversal', count: cashReversal,
      title: 'Bekor qilish asl kassa yozuvini topadi',
      hint: 'Bekor qilingan yozuv o‘chirilgan yoki ko‘chirilgan. Asl yozuvni tiklang.',
    },
    {
      id: 'payroll-links', count: payrollLinks,
      title: 'Bosqich tannarxi yozuvlari hisobot va bosqichga bog‘langan',
      hint: 'Tannarx yozuvida xodim, hisobot yoki buyurtma bosqichi topilmadi.',
    },
    {
      id: 'report-links', count: reportLinks,
      title: 'Ish hisobotlari buyurtma va bosqichga bog‘langan',
      hint: 'Qabul qilingan hisobotda buyurtma yoki marshrut bosqichi topilmadi.',
    },
    {
      id: 'order-numbers', count: duplicateNumbers(state),
      title: 'Buyurtma raqamlari takrorlanmaydi',
      hint: 'Bir xil raqamli buyurtmalar bor. Raqamlarni ajratib belgilang.',
    },
    {
      id: 'movement-items', count: movementItems,
      title: 'Ombor harakati mavjud pozitsiyaga bog‘langan',
      hint: 'Harakat bog‘langan material yoki mahsulot topilmadi.',
    },
    {
      id: 'shipment-customer', count: shipmentCustomer,
      title: 'Yuborishlar mavjud mijozga bog‘langan',
      hint: 'Yuborishda mijoz topilmadi; hujjat va qarz noto‘g‘ri hisoblanishi mumkin.',
    },
    {
      id: 'order-customer', count: orderCustomer,
      title: 'Buyurtmalar mavjud mijozga bog‘langan',
      hint: 'Seriyadan tashqari buyurtmada mijoz topilmadi.',
    },
  ];
}

function entityCounts(state: State): string {
  return [
    `mijozlar ${state.customers.length}`,
    `ta’minotchilar ${state.suppliers.length}`,
    `xodimlar ${state.employees.length}`,
    `stanoklar ${state.machines.length}`,
    `operatsiyalar ${state.operations.length}`,
    `pozitsiyalar ${state.items.length}`,
    `retseptlar ${state.recipes.length}`,
    `buyurtmalar ${state.orders.length}`,
    `xaridlar ${state.purchases.length}`,
    `harakatlar ${state.movements.length}`,
    `kassa ${state.cash.length}`,
    `hisobotlar ${state.reports.length}`,
    `tannarx yozuvlari ${state.payroll.length}`,
    `yuborishlar ${state.shipments.length}`,
    `audit ${state.audit.length}`,
  ].join(' · ');
}

export function buildDiagnosticReport(input: ReportInput): string {
  const at = input.at ?? new Date().toISOString();
  const checks = diagnosticChecks(input.state);
  const lines = [
    'ALIYA ERP — DIAGNOSTIKA',
    `Vaqt: ${at}`,
    `Yig‘ilma: ${input.build || 'noma’lum'}`,
    `Rejim: ${input.mode}`,
    `Rol: ${input.actor.role}`,
    `Kompaniya: ${input.state.companyId.slice(0, 8)}`,
    `Reviziya: ${input.state.revision}`,
    `Yozuvlar: ${entityCounts(input.state)}`,
  ];
  if (input.sync) {
    const pending = input.sync.pending;
    const statuses = ['queued', 'uncertain', 'rejected']
      .map(status => [status, pending.filter(row => row.status === status).length] as const)
      .filter(([, total]) => total > 0).map(([status, total]) => `${status} ${total}`);
    lines.push(`Sinxronizatsiya: ${input.sync.online ? 'onlayn' : 'oflayn'} · navbatda ${pending.length}${statuses.length ? ` (${statuses.join(', ')})` : ''}`);
    for (const row of pending) lines.push(`  - [${row.status}] ${row.type}${row.error ? `: ${redact(clean(row.error, 200))}` : ''}`);
  }
  lines.push('', `TEKSHIRUVLAR (${checks.length})`);
  for (const check of checks) {
    if (!check.count) lines.push(`[OK] ${check.title}`);
    else { lines.push(`[!] ${check.title}: ${check.count}`); lines.push(`    ${check.hint}`); }
  }
  lines.push('', `XATOLAR (${input.entries.length})`);
  if (!input.entries.length) lines.push('yo‘q');
  else for (const entry of input.entries) {
    lines.push(`${entry.at} [${entry.kind}] ${redact(clean(entry.message, 300))}${entry.detail ? ` (${redact(clean(entry.detail, 200))})` : ''}`);
  }
  lines.push('', 'Fayl texnik: uzun raqamlar (summa, telefon) [son] bilan almashtirilgan.');
  return lines.join('\n');
}

export function diagnosticFileName(at: string): string {
  return `aliya-diagnostics-${at.slice(0, 10)}.txt`;
}

export function downloadDiagnosticReport(input: ReportInput, storage: DiagnosticStorage): string {
  const at = input.at ?? new Date().toISOString();
  const text = buildDiagnosticReport({ ...input, at });
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = diagnosticFileName(at);
  link.click();
  URL.revokeObjectURL(link.href);
  markExported(storage, at);
  return text;
}
