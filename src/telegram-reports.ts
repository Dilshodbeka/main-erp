// Pure report formatting for the owner Telegram bot.
// Takes an admin ERP snapshot (State) and produces Uzbek text for Telegram's HTML parse mode.
// Reuses the same domain/analytics functions as the web app so the numbers never diverge.
// No Deno, Supabase or React imports here: the Edge Function and the browser bundle both load it.
import { cashBalance, supplierDebt, payrollDebt, stockQty } from './domain';
import { customerBalance } from './receivables';
import { statusLabel } from './i18n';
import { watchDigest, watchFindings } from './watch';
import type { State, Status } from './types';

/** Telegram HTML parse mode: only &, < and > need escaping. */
export const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const round = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** 1234567 → "1 234 567 so'm" (NBSP groups, matches the app's money() grouping). */
export function uzs(value: number): string {
  const rounded = Math.round(round(value));
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} so‘m`;
}

export type ReportKey =
  | 'kassa' | 'mijoz_qarz' | 'taminot_qarz' | 'buyurtmalar' | 'ombor' | 'hisobot' | 'nazorat' | 'davomat';

export interface OwnerCommand { key: ReportKey; label: string; command: string }

/** The owner menu — one row per report. Keep labels short for inline buttons. */
export const OWNER_COMMANDS: OwnerCommand[] = [
  { key: 'hisobot', label: '📊 Umumiy hisobot', command: '/hisobot' },
  { key: 'nazorat', label: '🔔 Nazorat', command: '/nazorat' },
  { key: 'davomat', label: '🕘 Davomat', command: '/davomat' },
  { key: 'kassa', label: '💵 Kassa', command: '/kassa' },
  { key: 'mijoz_qarz', label: '👤 Mijozlar qarzi', command: '/mijoz_qarz' },
  { key: 'taminot_qarz', label: '🚚 Taʼminot qarzi', command: '/taminot_qarz' },
  { key: 'buyurtmalar', label: '🧾 Buyurtmalar', command: '/buyurtmalar' },
  { key: 'ombor', label: '📦 Ombor tanqisligi', command: '/ombor' },
];

/** Maps an incoming "/kassa" or "kassa" or a callback key to a report key. */
export function parseOwnerCommand(input: string): ReportKey | 'menu' | null {
  const token = input.trim().toLowerCase().replace(/^\//, '').split(/\s+/)[0];
  if (!token || token === 'start' || token === 'menu' || token === 'help') return 'menu';
  const match = OWNER_COMMANDS.find(row => row.key === token);
  return match ? match.key : null;
}

export function ownerMenuText(): string {
  const lines = OWNER_COMMANDS.map(row => `${row.label} — ${row.command}`);
  return ['🏭 <b>Mebel Aliya — boshqaruv</b>', '', 'Hisobot uchun buyruq tanlang:', ...lines].join('\n');
}

export function kassaReport(state: State): string {
  const cash = cashBalance(state, 'cash');
  const bank = cashBalance(state, 'bank');
  const customerDebt = state.customers.reduce((sum, c) => sum + Math.max(0, customerBalance(state, c.id).debt), 0);
  const supplier = state.suppliers.reduce((sum, s) => sum + Math.max(0, supplierDebt(state, s.id)), 0);
  const payroll = state.employees.reduce((sum, e) => sum + Math.max(0, payrollDebt(state, e.id)), 0);
  return [
    '💵 <b>Kassa holati</b>',
    '',
    `Naqd pul: <b>${uzs(cash)}</b>`,
    `Bank / karta: <b>${uzs(bank)}</b>`,
    `Jami kassada: <b>${uzs(cash + bank)}</b>`,
    '',
    `Mijozlar qarzi (bizga): ${uzs(customerDebt)}`,
    `Taʼminotchilarga qarz: ${uzs(supplier)}`,
    `Ish haqi qarzi: ${uzs(payroll)}`,
  ].join('\n');
}

export function mijozQarzReport(state: State): string {
  const rows = state.customers
    .map(c => ({ name: c.name, debt: round(customerBalance(state, c.id).debt) }))
    .filter(row => row.debt > 0)
    .sort((a, b) => b.debt - a.debt);
  if (!rows.length) return '👤 <b>Mijozlar qarzi</b>\n\nQarzdor mijoz yoʻq.';
  const total = rows.reduce((sum, row) => sum + row.debt, 0);
  const lines = rows.slice(0, 30).map((row, i) => `${i + 1}. ${esc(row.name)} — <b>${uzs(row.debt)}</b>`);
  const tail = rows.length > 30 ? [`…va yana ${rows.length - 30} ta`] : [];
  return ['👤 <b>Mijozlar qarzi</b>', '', ...lines, ...tail, '', `Jami: <b>${uzs(total)}</b>`].join('\n');
}

export function taminotQarzReport(state: State): string {
  const rows = state.suppliers
    .map(s => ({ name: s.name, debt: round(supplierDebt(state, s.id)) }))
    .filter(row => row.debt > 0)
    .sort((a, b) => b.debt - a.debt);
  if (!rows.length) return '🚚 <b>Taʼminotchilarga qarz</b>\n\nQarz yoʻq.';
  const total = rows.reduce((sum, row) => sum + row.debt, 0);
  const lines = rows.slice(0, 30).map((row, i) => `${i + 1}. ${esc(row.name)} — <b>${uzs(row.debt)}</b>`);
  return ['🚚 <b>Taʼminotchilarga qarz</b>', '', ...lines, '', `Jami: <b>${uzs(total)}</b>`].join('\n');
}

const ACTIVE_STATUSES: Status[] = ['draft', 'production', 'ready', 'shipped'];

export function buyurtmalarReport(state: State): string {
  const groups = new Map<Status, { count: number; sum: number }>();
  for (const order of state.orders) {
    const bucket = groups.get(order.status) ?? { count: 0, sum: 0 };
    bucket.count += 1;
    bucket.sum += round(order.price);
    groups.set(order.status, bucket);
  }
  const lines = ACTIVE_STATUSES
    .filter(status => groups.has(status))
    .map(status => {
      const bucket = groups.get(status)!;
      return `${statusLabel(status)}: <b>${bucket.count}</b> — ${uzs(bucket.sum)}`;
    });
  if (!lines.length) return '🧾 <b>Buyurtmalar</b>\n\nFaol buyurtma yoʻq.';
  return ['🧾 <b>Faol buyurtmalar</b>', '', ...lines].join('\n');
}

export function omborReport(state: State): string {
  const rows = state.items
    .map(item => ({ name: item.name, unit: item.unit, qty: stockQty(state, item.id), min: item.minQty }))
    .filter(row => row.min > 0 && row.qty < row.min)
    .sort((a, b) => (a.qty - a.min) - (b.qty - b.min));
  if (!rows.length) return '📦 <b>Ombor</b>\n\nTanqis material yoʻq. Barcha qoldiqlar meʼyorida.';
  const lines = rows.slice(0, 40).map(row => `• ${esc(row.name)}: ${row.qty} ${esc(row.unit)} (meʼyor ${row.min})`);
  return ['📦 <b>Toʻldirish kerak</b>', '', ...lines].join('\n');
}

export function hisobotReport(state: State): string {
  const cash = cashBalance(state, 'cash') + cashBalance(state, 'bank');
  const activeOrders = state.orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
  const customerDebt = state.customers.reduce((sum, c) => sum + Math.max(0, customerBalance(state, c.id).debt), 0);
  const supplier = state.suppliers.reduce((sum, s) => sum + Math.max(0, supplierDebt(state, s.id)), 0);
  const shortage = state.items.filter(item => item.minQty > 0 && stockQty(state, item.id) < item.minQty).length;
  return [
    '📊 <b>Umumiy hisobot</b>',
    '',
    `💵 Kassada: <b>${uzs(cash)}</b>`,
    `🧾 Faol buyurtmalar: <b>${activeOrders}</b>`,
    `👤 Mijozlar qarzi: ${uzs(customerDebt)}`,
    `🚚 Taʼminot qarzi: ${uzs(supplier)}`,
    `📦 Tanqis materiallar: ${shortage}`,
  ].join('\n');
}

/** Single entry point: a report key → Telegram text. */
export function ownerReport(state: State, key: ReportKey, today = new Date().toISOString().slice(0, 10), nowIso = new Date().toISOString()): string {
  switch (key) {
    case 'nazorat': return watchDigest(watchFindings(state, nowIso, today));
    // Attendance needs Timepay data; the owner handler answers it before reaching here.
    case 'davomat': return '🕘 <b>Davomat</b>\n\nTimepay ulanmagan. Supabase sirlariga TIMEPAY_TOKEN qo‘shing.';
    case 'kassa': return kassaReport(state);
    case 'mijoz_qarz': return mijozQarzReport(state);
    case 'taminot_qarz': return taminotQarzReport(state);
    case 'buyurtmalar': return buyurtmalarReport(state);
    case 'ombor': return omborReport(state);
    case 'hisobot': return hisobotReport(state);
  }
}
