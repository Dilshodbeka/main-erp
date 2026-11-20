import { shipmentTotals } from './sales';
import type { Order, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const byTime = (left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number =>
  left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt);

export interface ObligationRow {
  id: string; kind: 'order' | 'stock'; orderId: string | null; label: string;
  createdAt: string; total: number; paid: number; outstanding: number;
}

export interface CustomerBalance {
  customerId: string; contract: number; paid: number; debt: number; advance: number;
  obligations: ObligationRow[];
}

/** Договор считается согласованным, когда заказ выведен из расчёта и не отменён; серийный выпуск клиенту не выставляется. */
export function isAgreed(order: Order): boolean {
  return order.kind !== 'series' && order.status !== 'draft' && order.status !== 'cancelled';
}

export function customerBalance(state: State, customerId: string): CustomerBalance {
  const rows: Array<Omit<ObligationRow, 'paid' | 'outstanding'>> = [];
  for (const order of state.orders) {
    if (order.customerId !== customerId || !isAgreed(order)) continue;
    const total = round(order.price);
    if (total > 0) rows.push({ id: order.id, kind: 'order', orderId: order.id, label: `${order.number} · ${order.title}`, createdAt: order.createdAt, total });
  }
  for (const shipment of state.shipments) {
    if (shipment.customerId !== customerId || shipment.orderId !== null || shipment.status === 'cancelled') continue;
    const total = round(shipmentTotals(shipment).revenue);
    if (total > 0) rows.push({ id: shipment.id, kind: 'stock', orderId: null, label: 'Ombordan sotuv', createdAt: shipment.createdAt, total });
  }
  rows.sort(byTime);

  const payments = state.cash
    .filter(row => row.source === 'sale' && row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'out' ? -row.amount : row.direction === 'in' ? row.amount : 0), 0);
  const deductions = state.workerDeductions
    .filter(row => row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'deduct' ? row.amount : -row.amount), 0);

  let pool = Math.max(0, round(payments + deductions));
  const received = pool;
  const obligations: ObligationRow[] = rows.map(row => {
    const paid = Math.min(row.total, pool);
    pool = round(pool - paid);
    return { ...row, paid, outstanding: round(row.total - paid) };
  });

  return {
    customerId,
    contract: round(obligations.reduce((sum, row) => sum + row.total, 0)),
    paid: received,
    debt: round(obligations.reduce((sum, row) => sum + row.outstanding, 0)),
    advance: Math.max(0, pool),
    obligations,
  };
}

export function orderBalance(state: State, orderId: string): ObligationRow | null {
  const order = state.orders.find(row => row.id === orderId);
  if (!order || !isAgreed(order)) return null;
  return customerBalance(state, order.customerId).obligations.find(row => row.orderId === orderId) ?? null;
}
