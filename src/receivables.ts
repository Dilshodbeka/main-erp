import { shipmentTotals } from './sales';
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const byTime = (left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number =>
  left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt);

export interface LedgerShipment {
  shipmentId: string; orderId: string | null; createdAt: string;
  total: number; paid: number; outstanding: number;
}

export interface CustomerLedger {
  customerId: string; shipped: number; paid: number; debt: number; advance: number;
  shipments: LedgerShipment[];
}

export function customerLedger(state: State, customerId: string): CustomerLedger {
  const shipments = state.shipments
    .filter(row => row.customerId === customerId && row.status !== 'cancelled')
    .sort(byTime);
  const payments = state.cash
    .filter(row => row.source === 'sale' && row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'out' ? -row.amount : row.direction === 'in' ? row.amount : 0), 0);
  const deductionPayments = state.workerDeductions
    .filter(row => row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'deduct' ? row.amount : -row.amount), 0);
  let available = Math.max(0, round(payments + deductionPayments));
  const rows: LedgerShipment[] = [];
  for (const shipment of shipments) {
    const total = shipmentTotals(shipment).revenue;
    const paid = Math.min(total, available);
    available = round(available - paid);
    rows.push({ shipmentId: shipment.id, orderId: shipment.orderId, createdAt: shipment.createdAt, total, paid, outstanding: round(total - paid) });
  }
  const shipped = round(rows.reduce((sum, row) => sum + row.total, 0));
  return {
    customerId, shipped, paid: Math.max(0, round(payments + deductionPayments)),
    debt: round(rows.reduce((sum, row) => sum + row.outstanding, 0)),
    advance: Math.max(0, available), shipments: rows,
  };
}

export interface OrderLedger {
  orderId: string; customerId: string; total: number; paid: number; outstanding: number; advance: number;
}

export function orderLedger(state: State, orderId: string): OrderLedger {
  const order = state.orders.find(row => row.id === orderId);
  if (!order) throw new Error('Order not found');
  const ledger = customerLedger(state, order.customerId);
  const settledFor = (id: string) => round(ledger.shipments
    .filter(row => row.orderId === id)
    .reduce((sum, row) => sum + row.paid, 0));
  const orders = state.orders
    .filter(row => row.customerId === order.customerId && row.status !== 'cancelled')
    .sort(byTime);
  let available = ledger.advance;
  let earmarked = 0;
  for (const row of orders) {
    const remaining = Math.max(0, round(row.price - settledFor(row.id)));
    const use = Math.min(available, remaining);
    if (row.id === orderId) earmarked = use;
    available = round(available - use);
  }
  const settled = settledFor(orderId);
  const paid = Math.min(order.price, round(settled + earmarked));
  return {
    orderId, customerId: order.customerId, total: order.price,
    paid, outstanding: round(order.price - paid), advance: earmarked,
  };
}
