import { actualCost, orderPaid, supplierDebt } from './domain';
import type { Order, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export interface OrderProfitRow {
  order: Order; customer: string; date: string;
  revenue: number; cost: number; overhead: number; profit: number; margin: number;
  paid: number; debt: number;
}

export function orderProfit(state: State, order: Order): OrderProfitRow {
  const revenue = order.status === 'cancelled' ? 0 : round(order.price);
  const cost = actualCost(state, order);
  const profit = round(revenue - cost - order.overhead);
  const delivery = state.shipments
    .filter(row => row.orderId === order.id && row.deliveredAt)
    .map(row => row.deliveredAt as string)
    .sort()
    .at(-1);
  return {
    order,
    customer: state.customers.find(row => row.id === order.customerId)?.name ?? 'Mijoz topilmadi',
    date: delivery ?? order.createdAt,
    revenue, cost, overhead: round(order.overhead), profit,
    margin: revenue > 0 ? round(profit / revenue * 100) : 0,
    paid: orderPaid(state, order.id),
    debt: order.status === 'cancelled' ? 0 : round(order.price - orderPaid(state, order.id)),
  };
}

export function completedOrderRows(state: State): OrderProfitRow[] {
  return state.orders
    .filter(order => order.kind !== 'series' && ['delivered', 'cancelled'].includes(order.status))
    .map(order => orderProfit(state, order))
    .sort((left, right) => right.date.localeCompare(left.date));
}

export interface CustomerAnalyticsRow {
  customerId: string; name: string; orders: number; revenue: number; profit: number;
  paid: number; debt: number; average: number; lastOrder: string;
}

export function customerAnalytics(state: State): CustomerAnalyticsRow[] {
  return state.customers.map(customer => {
    const orders = state.orders.filter(order => order.customerId === customer.id && order.kind !== 'series' && order.status !== 'cancelled');
    const rows = orders.map(order => orderProfit(state, order));
    const revenue = round(rows.reduce((sum, row) => sum + row.revenue, 0));
    return {
      customerId: customer.id, name: customer.name, orders: orders.length, revenue,
      profit: round(rows.reduce((sum, row) => sum + row.profit, 0)),
      paid: round(rows.reduce((sum, row) => sum + row.paid, 0)),
      debt: round(rows.reduce((sum, row) => sum + row.debt, 0)),
      average: orders.length ? round(revenue / orders.length) : 0,
      lastOrder: orders.map(order => order.createdAt).sort().at(-1) ?? '',
    };
  }).sort((left, right) => right.revenue - left.revenue);
}

export interface SupplierAnalyticsRow {
  supplierId: string; name: string; purchases: number; receivedValue: number;
  paid: number; debt: number; lastPurchase: string;
}

export function supplierAnalytics(state: State): SupplierAnalyticsRow[] {
  return state.suppliers.map(supplier => {
    const purchases = state.purchases.filter(purchase => purchase.supplierId === supplier.id);
    const receivedValue = round(purchases.reduce((sum, purchase) => sum + purchase.lines.reduce(
      (lineSum, line) => lineSum + round(line.received * line.price), 0), 0));
    const paid = round(state.cash.reduce((sum, entry) => entry.source === 'supplier' && entry.sourceId === supplier.id
      ? sum + (entry.direction === 'in' ? -entry.amount : entry.amount) : sum, 0));
    return {
      supplierId: supplier.id, name: supplier.name, purchases: purchases.length, receivedValue,
      paid, debt: supplierDebt(state, supplier.id),
      lastPurchase: purchases.map(purchase => purchase.createdAt).sort().at(-1) ?? '',
    };
  }).sort((left, right) => right.receivedValue - left.receivedValue);
}

export interface ProcessAnalyticsRow {
  operationId: string; name: string; planned: number; completed: number;
  payroll: number; saleValue: number; rejected: number; rate: number;
}

export function processAnalytics(state: State): ProcessAnalyticsRow[] {
  const rows = new Map<string, ProcessAnalyticsRow>();
  for (const order of state.orders) {
    if (order.status === 'cancelled') continue;
    for (const task of order.route) {
      const operation = state.operations.find(row => row.id === task.operationId);
      const current = rows.get(task.operationId) ?? {
        operationId: task.operationId, name: task.name, planned: 0, completed: 0,
        payroll: 0, saleValue: 0, rejected: 0, rate: round(task.rate),
      };
      current.planned = round(current.planned + task.planned);
      current.completed = round(current.completed + task.completed);
      const payroll = state.payroll.filter(row => row.orderId === order.id && row.taskId === task.id && row.status === 'accepted');
      current.payroll = round(current.payroll + payroll.reduce((sum, row) => sum + row.amount, 0));
      current.saleValue = round(current.saleValue + round(task.planned * (task.salePrice ?? operation?.salePrice ?? 0)));
      current.rejected = current.rejected + state.reports.filter(row => row.orderId === order.id && row.taskId === task.id && row.status === 'rejected').length;
      rows.set(task.operationId, current);
    }
  }
  return [...rows.values()].sort((left, right) => right.planned - left.planned);
}
