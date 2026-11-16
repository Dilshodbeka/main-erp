import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { completedOrderRows, customerAnalytics, orderProfit, processAnalytics, supplierAnalytics } from './history';
import type { Order, State } from './types';

function fixture(): State {
  const state = emptyState();
  state.customers = [{ id: 'customer-1', name: 'Aziza', phone: '', address: '', kind: 'customer', employeeId: null }];
  state.suppliers = [{ id: 'supplier-1', name: 'Egger', phone: '' }];
  state.employees = [{ id: 'employee-1', name: 'Kamol', active: true }];
  state.operations = [{
    id: 'operation-1', name: 'Kesish', unit: 'piece', salePrice: 40000, workerRate: 5000,
    standardMinutes: 15, machineId: null, employeeIds: ['employee-1'], active: true, autoAccept: false, norms: [],
  }];
  state.orders = [{
    id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'customer-1', title: 'Shkaf',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 5, price: 250000, overhead: 5000, dueDate: '2026-11-09', createdAt: '2026-10-29T09:00:00.000Z',
    status: 'delivered',
    materials: [{ id: 'material-1', itemId: 'item-1', qty: 2, estimatedCost: 10000, issuedQty: 2, actualCost: 10000 }],
    route: [{
      id: 'task-1', operationId: 'operation-1', name: 'Kesish', employeeId: 'employee-1',
      rate: 5000, salePrice: 40000, standardMinutes: 15, planned: 5, completed: 5, status: 'completed',
    }],
  } as Order];
  state.payroll = [{
    id: 'payroll-1', employeeId: 'employee-1', reportId: 'report-1', orderId: 'order-1',
    taskId: 'task-1', amount: 25000, status: 'accepted', createdAt: '2026-10-29T10:00:00.000Z',
  }];
  state.shipments = [{
    id: 'shipment-1', orderId: 'order-1', customerId: 'customer-1', kind: 'order',
    lines: [{ id: 'line-1', itemId: null, description: 'Shkaf', qty: 5, salePrice: 50000, unitCost: 9000, materialCost: 10000, laborCost: 5000 }],
    address: '', dueDate: '2026-11-09', status: 'delivered', createdAt: '2026-10-29T11:00:00.000Z',
    deliveredAt: '2026-10-30T11:00:00.000Z', reversalOf: null,
  }];
  state.cash = [{ id: 'cash-1', direction: 'in', amount: 100000, account: 'cash', toAccount: null, source: 'sale', sourceId: 'shipment-1', customerId: 'customer-1', category: 'Mijoz to‘lovi', note: '', number: null, reversalOf: null, createdAt: '2026-10-29T12:00:00.000Z' }];
  state.purchases = [{
    id: 'purchase-1', number: 'PUR-0001', supplierId: 'supplier-1', createdAt: '2026-10-28T09:00:00.000Z',
    lines: [{ id: 'purchase-line-1', itemId: 'item-1', qty: 10, price: 5000, received: 10, previousPurchasePrice: 0, newPurchasePrice: 5000, previousAverageCost: 0, newAverageCost: 5000 }],
  }];
  state.movements = [{ id: 'movement-1', itemId: 'item-1', direction: 'in', qty: 10, unitCost: 5000, source: 'purchase', sourceId: 'purchase-1', note: '', createdAt: '2026-10-28T09:00:00.000Z' }];
  state.cash.push({ id: 'cash-2', direction: 'out', amount: 30000, account: 'bank', toAccount: null, source: 'supplier', sourceId: 'supplier-1', customerId: null, category: 'Ta’minot', note: '', number: null, reversalOf: null, createdAt: '2026-10-28T10:00:00.000Z' });
  return state;
}

describe('order history', () => {
  it('calculates delivered order profit from actual cost and overhead', () => {
    const row = orderProfit(fixture(), fixture().orders[0]);
    expect(row).toMatchObject({ revenue: 250000, cost: 45000, overhead: 5000, profit: 200000, margin: 80, paid: 100000, debt: 150000 });
    expect(row.date).toBe('2026-10-30T11:00:00.000Z');
  });

  it('lists only completed and cancelled orders, newest first', () => {
    const state = fixture();
    state.orders.push({ ...state.orders[0], id: 'order-2', number: 'ORD-0002', status: 'production' } as Order);
    expect(completedOrderRows(state).map(row => row.order.number)).toEqual(['ORD-0001']);
  });

  it('summarizes customer revenue, debt and average order', () => {
    const row = customerAnalytics(fixture()).find(item => item.customerId === 'customer-1');
    expect(row).toMatchObject({ orders: 1, revenue: 250000, profit: 200000, paid: 100000, debt: 150000, average: 250000 });
  });

  it('summarizes supplier received value, payments and debt', () => {
    const row = supplierAnalytics(fixture()).find(item => item.supplierId === 'supplier-1');
    expect(row).toMatchObject({ purchases: 1, receivedValue: 50000, paid: 30000, debt: 20000 });
  });

  it('summarizes operation load, payroll and client value', () => {
    const row = processAnalytics(fixture()).find(item => item.operationId === 'operation-1');
    expect(row).toMatchObject({ planned: 5, completed: 5, payroll: 25000, saleValue: 200000, rejected: 0 });
  });
});
