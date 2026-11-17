import { stockQty } from './domain';
import { customerAnalytics, orderProfit, type CustomerAnalyticsRow, type OrderProfitRow } from './history';
import { customerLedger, type CustomerLedger } from './receivables';
import { shipmentTotals } from './sales';
import type { CashEntry, Customer, Shipment, State, StockMovement, WorkerDeduction } from './types';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
export type PeriodKind = 'day' | 'week' | 'month';

const DAY = 86400000;
const mondayOffset = (date: Date): number => (date.getUTCDay() + 6) % 7;

function isoWeek(iso: string): { year: number; week: number } {
  const thursday = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  thursday.setUTCDate(thursday.getUTCDate() - mondayOffset(thursday) + 3);
  const year = thursday.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  first.setUTCDate(first.getUTCDate() - mondayOffset(first) + 3);
  return { year, week: 1 + Math.round((thursday.getTime() - first.getTime()) / (7 * DAY)) };
}

export function periodKey(iso: string, kind: PeriodKind): string {
  if (kind === 'day') return iso.slice(0, 10);
  if (kind === 'month') return iso.slice(0, 7);
  const { year, week } = isoWeek(iso);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function periodStart(key: string, kind: PeriodKind): string {
  if (kind === 'day') return key;
  if (kind === 'month') return `${key}-01`;
  const [yearText, weekText] = key.split('-W');
  const monday = new Date(Date.UTC(Number(yearText), 0, 4));
  monday.setUTCDate(monday.getUTCDate() - mondayOffset(monday) + (Number(weekText) - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

export function periodEnd(key: string, kind: PeriodKind): string {
  const start = new Date(`${periodStart(key, kind)}T00:00:00.000Z`);
  if (kind === 'week') start.setUTCDate(start.getUTCDate() + 6);
  if (kind === 'month') { start.setUTCMonth(start.getUTCMonth() + 1); start.setUTCDate(start.getUTCDate() - 1); }
  return start.toISOString().slice(0, 10);
}

const sourceLabels: Record<StockMovement['source'], string> = {
  purchase: 'Xarid', order: 'Buyurtma', inventory: 'Inventarizatsiya',
  customer: 'Mijoz materiali', production: 'Ishlab chiqarish', sale: 'Sotuv', transfer: 'Ko‘chirish',
};

export interface MovementRow {
  id: string; date: string; itemId: string; item: string; unit: string;
  direction: 'in' | 'out'; qty: number; unitCost: number; value: number;
  source: StockMovement['source']; sourceLabel: string; counterparty: string; note: string;
}

export function movementJournal(state: State, warehouseId?: string): MovementRow[] {
  return state.movements.filter(movement => warehouseId === undefined
    || (movement.warehouseId ?? MAIN_WAREHOUSE_ID) === warehouseId).map(movement => {
    const item = state.items.find(row => row.id === movement.itemId);
    const purchase = movement.source === 'purchase' ? state.purchases.find(row => row.id === movement.sourceId) : undefined;
    const order = ['order', 'production'].includes(movement.source) ? state.orders.find(row => row.id === movement.sourceId) : undefined;
    const shipment = movement.source === 'sale' ? state.shipments.find(row => row.id === movement.sourceId) : undefined;
    const counterparty = purchase
      ? state.suppliers.find(row => row.id === purchase.supplierId)?.name ?? purchase.number
      : order ? `${order.number} · ${order.title}`
      : shipment ? state.customers.find(row => row.id === shipment.customerId)?.name ?? 'Sotuv'
      : movement.source === 'customer' ? state.customers.find(row => row.id === item?.customerId)?.name ?? sourceLabels.customer
      : sourceLabels[movement.source];
    return {
      id: movement.id, date: movement.createdAt, itemId: movement.itemId,
      item: item?.name ?? 'Pozitsiya topilmadi', unit: item?.unit ?? '',
      direction: movement.direction, qty: movement.qty, unitCost: movement.unitCost,
      value: round(movement.qty * movement.unitCost), source: movement.source,
      sourceLabel: sourceLabels[movement.source], counterparty, note: movement.note,
    };
  }).sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

export interface ItemTurnoverRow {
  itemId: string; item: string; unit: string;
  inQty: number; outQty: number; inValue: number; outValue: number;
  purchasedQty: number; purchasedValue: number; issuedQty: number; issuedValue: number;
  stock: number;
}

export function itemTurnover(state: State, warehouseId?: string): ItemTurnoverRow[] {
  return state.items.map(item => {
    const rows = state.movements.filter(movement => movement.itemId === item.id
      && (warehouseId === undefined || (movement.warehouseId ?? MAIN_WAREHOUSE_ID) === warehouseId));
    const sum = (predicate: (movement: StockMovement) => boolean) => rows.filter(predicate)
      .reduce((total, movement) => total + movement.qty, 0);
    const value = (predicate: (movement: StockMovement) => boolean) => round(rows.filter(predicate)
      .reduce((total, movement) => total + round(movement.qty * movement.unitCost), 0));
    return {
      itemId: item.id, item: item.name, unit: item.unit,
      inQty: sum(row => row.direction === 'in'), outQty: sum(row => row.direction === 'out'),
      inValue: value(row => row.direction === 'in'), outValue: value(row => row.direction === 'out'),
      purchasedQty: sum(row => row.source === 'purchase'), purchasedValue: value(row => row.source === 'purchase'),
      issuedQty: sum(row => row.direction === 'out' && ['order', 'production'].includes(row.source)),
      issuedValue: value(row => row.direction === 'out' && ['order', 'production'].includes(row.source)),
      stock: stockQty(state, item.id, warehouseId),
    };
  });
}

export interface CashPeriodRow { key: string; income: number; expense: number; net: number; count: number }

export function cashByPeriod(state: State, kind: PeriodKind): CashPeriodRow[] {
  const rows = new Map<string, CashPeriodRow>();
  for (const entry of state.cash) {
    if (entry.direction === 'transfer' || entry.source === 'loan') continue;
    const key = periodKey(entry.createdAt, kind);
    const current = rows.get(key) ?? { key, income: 0, expense: 0, net: 0, count: 0 };
    if (entry.direction === 'in') current.income = round(current.income + entry.amount);
    else current.expense = round(current.expense + entry.amount);
    current.net = round(current.income - current.expense);
    current.count += 1;
    rows.set(key, current);
  }
  return [...rows.values()].sort((left, right) => right.key.localeCompare(left.key));
}

export interface CashCategoryRow { category: string; income: number; expense: number; net: number; count: number }

export function cashByCategory(state: State): CashCategoryRow[] {
  const rows = new Map<string, CashCategoryRow>();
  for (const entry of state.cash) {
    if (entry.direction === 'transfer' || entry.source === 'loan') continue;
    const category = entry.category || 'Kategoriyasiz';
    const current = rows.get(category) ?? { category, income: 0, expense: 0, net: 0, count: 0 };
    if (entry.direction === 'in') current.income = round(current.income + entry.amount);
    else current.expense = round(current.expense + entry.amount);
    current.net = round(current.income - current.expense);
    current.count += 1;
    rows.set(category, current);
  }
  return [...rows.values()].sort((left, right) => right.expense - left.expense || right.income - left.income);
}

export interface SalesPeriodRow {
  key: string; orders: number; revenue: number; profit: number; shipped: number; paid: number;
}

export function salesByPeriod(state: State, kind: PeriodKind): SalesPeriodRow[] {
  const rows = new Map<string, SalesPeriodRow>();
  const bucket = (iso: string): SalesPeriodRow => {
    const key = periodKey(iso, kind);
    const current = rows.get(key) ?? { key, orders: 0, revenue: 0, profit: 0, shipped: 0, paid: 0 };
    rows.set(key, current);
    return current;
  };
  for (const order of state.orders) {
    if (order.kind === 'series' || order.status === 'cancelled') continue;
    const current = bucket(order.createdAt);
    const profit = orderProfit(state, order);
    current.orders += 1;
    current.revenue = round(current.revenue + profit.revenue);
    current.profit = round(current.profit + profit.profit);
  }
  for (const shipment of state.shipments) {
    if (shipment.status === 'cancelled') continue;
    const current = bucket(shipment.deliveredAt ?? shipment.createdAt);
    current.shipped = round(current.shipped + shipmentTotals(shipment).revenue);
  }
  for (const entry of state.cash) {
    if (entry.source !== 'sale' || entry.direction === 'transfer') continue;
    const current = bucket(entry.createdAt);
    current.paid = round(current.paid + (entry.direction === 'in' ? entry.amount : -entry.amount));
  }
  return [...rows.values()].sort((left, right) => right.key.localeCompare(left.key));
}

export interface CustomerDetail {
  customer: Customer; stats: CustomerAnalyticsRow; orders: OrderProfitRow[];
  payments: CashEntry[]; shipments: Shipment[]; ledger: CustomerLedger;
  deductions: WorkerDeduction[];
}

export function customerDetail(state: State, customerId: string): CustomerDetail {
  const customer = state.customers.find(row => row.id === customerId);
  if (!customer) throw new Error('Mijoz topilmadi');
  const stats = customerAnalytics(state).find(row => row.customerId === customerId)!;
  const orders = state.orders
    .filter(order => order.customerId === customerId && order.kind !== 'series')
    .map(order => orderProfit(state, order))
    .sort((left, right) => right.date.localeCompare(left.date));
  const payments = state.cash.filter(entry => entry.customerId === customerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const shipments = state.shipments.filter(shipment => shipment.customerId === customerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const deductions = state.workerDeductions.filter(row => row.customerId === customerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { customer, stats, orders, payments, shipments, ledger: customerLedger(state, customerId), deductions };
}
