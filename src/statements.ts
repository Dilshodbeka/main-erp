import { acceptedOutsourceCost, orderDebt, orderPaid, supplierDebt } from './domain';
import { customerBalance } from './receivables';
import { withinPeriod } from './reports';
import { shipmentTotals } from './sales';
import type { Account, CashEntry, CashSource, CustomerKind, Order, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const byDateDesc = (left: { date: string }, right: { date: string }): number => right.date.localeCompare(left.date);

export interface PaymentRow {
  id: string; date: string; amount: number; account: Account;
  note: string; reversalOf: string | null; reversed: boolean;
}

function paymentRows(state: State, match: (entry: CashEntry) => boolean, incoming: boolean, from: string, to: string): PaymentRow[] {
  return state.cash
    .filter(entry => match(entry) && withinPeriod(entry.createdAt, from, to))
    .map(entry => ({
      id: entry.id,
      date: entry.createdAt,
      amount: round(entry.direction === (incoming ? 'in' : 'out') ? entry.amount : entry.direction === 'transfer' ? 0 : -entry.amount),
      account: entry.account,
      note: entry.note,
      reversalOf: entry.reversalOf,
      reversed: state.cash.some(row => row.reversalOf === entry.id),
    }))
    .sort(byDateDesc);
}

function lastPaymentAt(state: State, match: (entry: CashEntry) => boolean, incoming: boolean): string | null {
  const latest = state.cash
    .filter(entry => match(entry) && entry.direction === (incoming ? 'in' : 'out'))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  return latest?.createdAt ?? null;
}

const partyCash = (source: CashSource, sourceId: string) => (entry: CashEntry) =>
  entry.source === source && entry.sourceId === sourceId;

export interface StatementShipmentRow {
  id: string; date: string; orderNumber: string; title: string;
  qty: number; amount: number; status: 'shipped' | 'delivered';
}

export interface CustomerStatementRow {
  customerId: string; name: string; kind: CustomerKind; employeeId: string | null;
  orders: number; shipped: number; paid: number; debt: number; advance: number;
  lastPaidAt: string | null; payments: PaymentRow[]; shipments: StatementShipmentRow[];
}

export function customerStatements(state: State, from: string, to: string): CustomerStatementRow[] {
  return state.customers.map(customer => {
    const match = (entry: CashEntry) => entry.source === 'sale' && entry.customerId === customer.id;
    const periodShipments = state.shipments
      .filter(shipment => shipment.customerId === customer.id && shipment.status !== 'cancelled' && withinPeriod(shipment.createdAt, from, to));
    const shipments = periodShipments.map((shipment): StatementShipmentRow => {
      const order = shipment.orderId ? state.orders.find(row => row.id === shipment.orderId) : undefined;
      return {
        id: shipment.id, date: shipment.createdAt,
        orderNumber: order?.number ?? '—', title: order?.title ?? shipment.lines[0]?.description ?? 'Ombordan sotuv',
        qty: round(shipment.lines.reduce((sum, line) => sum + line.qty, 0)),
        amount: round(shipmentTotals(shipment).revenue),
        status: shipment.status === 'delivered' ? 'delivered' : 'shipped',
      };
    }).sort(byDateDesc);
    const payments = paymentRows(state, match, true, from, to);
    const ledger = customerBalance(state, customer.id);
    return {
      customerId: customer.id, name: customer.name, kind: customer.kind, employeeId: customer.employeeId,
      orders: state.orders.filter(order => order.customerId === customer.id && order.kind !== 'series' && withinPeriod(order.createdAt, from, to)).length,
      shipped: round(shipments.reduce((sum, shipment) => sum + shipment.amount, 0)),
      paid: round(payments.reduce((sum, payment) => sum + payment.amount, 0)),
      debt: ledger.debt, advance: ledger.advance,
      lastPaidAt: lastPaymentAt(state, match, true),
      payments, shipments,
    };
  }).filter(row => row.orders > 0 || row.shipments.length > 0 || row.payments.length > 0 || row.debt !== 0 || row.advance !== 0);
}

export interface PurchaseStatementRow {
  id: string; number: string; date: string; value: number; receivedValue: number;
}

export interface SupplierStatementRow {
  supplierId: string; name: string; purchases: number; receivedValue: number;
  outsourced: number; paid: number; debt: number; lastPaidAt: string | null;
  payments: PaymentRow[]; purchaseRows: PurchaseStatementRow[];
}

export function supplierStatements(state: State, from: string, to: string): SupplierStatementRow[] {
  return state.suppliers.map(supplier => {
    const match = partyCash('supplier', supplier.id);
    const supplierPurchases = state.purchases.filter(purchase => purchase.supplierId === supplier.id);
    const purchaseIds = new Set(supplierPurchases.map(purchase => purchase.id));
    const periodPurchases = supplierPurchases.filter(purchase => withinPeriod(purchase.createdAt, from, to));
    const purchaseRows = periodPurchases.map((purchase): PurchaseStatementRow => ({
      id: purchase.id, number: purchase.number, date: purchase.createdAt,
      value: round(purchase.lines.reduce((sum, line) => sum + line.qty * line.price, 0)),
      receivedValue: round(purchase.lines.reduce((sum, line) => sum + line.received * line.price, 0)),
    })).sort(byDateDesc);
    const receivedValue = round(state.movements
      .filter(movement => movement.source === 'purchase' && purchaseIds.has(movement.sourceId) && withinPeriod(movement.createdAt, from, to))
      .reduce((sum, movement) => sum + round(movement.qty * movement.unitCost) * (movement.direction === 'in' ? 1 : -1), 0));
    const payments = paymentRows(state, match, false, from, to);
    const outsourced = acceptedOutsourceCost(state, supplier.id);
    return {
      supplierId: supplier.id, name: supplier.name,
      purchases: periodPurchases.length, receivedValue, outsourced,
      paid: round(payments.reduce((sum, payment) => sum + payment.amount, 0)),
      debt: supplierDebt(state, supplier.id),
      lastPaidAt: lastPaymentAt(state, match, false),
      payments, purchaseRows,
    };
  }).filter(row => row.purchases > 0 || row.receivedValue !== 0 || row.outsourced !== 0
    || row.payments.length > 0 || row.debt !== 0);
}

export interface OrderStatementRow {
  orderId: string; number: string; title: string; customer: string;
  kind: Order['kind']; createdAt: string; status: Order['status'];
  qty: number; price: number; paid: number; debt: number;
}

export function orderStatements(state: State, from: string, to: string): OrderStatementRow[] {
  return state.orders
    .filter(order => order.kind !== 'series' && withinPeriod(order.createdAt, from, to))
    .map(order => {
      const paid = orderPaid(state, order.id);
      return {
        orderId: order.id, number: order.number, title: order.title,
        customer: state.customers.find(customer => customer.id === order.customerId)?.name ?? 'Mijoz topilmadi',
        kind: order.kind, createdAt: order.createdAt, status: order.status,
        qty: round(order.qty), price: round(order.price), paid, debt: orderDebt(state, order.id),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.number.localeCompare(left.number));
}
