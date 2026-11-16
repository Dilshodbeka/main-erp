import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { customerStatements, orderStatements, supplierStatements } from './statements';
import type { Order, State } from './types';

function fixture(): State {
  const state = emptyState();
  state.customers = [{ id: 'customer-1', name: 'Aziza', phone: '', address: '', kind: 'customer', employeeId: null }];
  state.suppliers = [{ id: 'supplier-1', name: 'Egger', phone: '' }];
  state.employees = [
    { id: 'employee-1', name: 'Kamol', active: true },
    { id: 'employee-2', name: 'Dilnoza', active: true },
  ];
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
  state.reports = [
    { id: 'report-1', orderId: 'order-1', taskId: 'task-1', employeeId: 'employee-1', qty: 5, status: 'accepted', note: '', createdAt: '2026-10-29T09:30:00.000Z' },
    { id: 'report-2', orderId: 'order-1', taskId: 'task-1', employeeId: 'employee-2', qty: 1, status: 'submitted', note: '', createdAt: '2026-11-02T09:30:00.000Z' },
  ];
  state.payroll = [
    {
      id: 'payroll-1', employeeId: 'employee-1', reportId: 'report-1', orderId: 'order-1',
      taskId: 'task-1', amount: 25000, status: 'accepted', createdAt: '2026-10-29T10:00:00.000Z',
    },
    {
      id: 'payroll-2', employeeId: 'employee-2', reportId: 'report-2', orderId: 'order-1',
      taskId: 'task-1', amount: 5000, status: 'pending', createdAt: '2026-11-02T10:00:00.000Z',
    },
  ];
  state.shipments = [{
    id: 'shipment-1', orderId: 'order-1', customerId: 'customer-1', kind: 'order',
    lines: [{ id: 'line-1', itemId: null, description: 'Shkaf', qty: 5, salePrice: 50000, unitCost: 9000, materialCost: 10000, laborCost: 5000 }],
    address: '', dueDate: '2026-11-09', status: 'delivered', createdAt: '2026-10-29T11:00:00.000Z',
    deliveredAt: '2026-10-30T11:00:00.000Z', reversalOf: null,
  }];
  state.cash = [
    {
      id: 'pay-1', direction: 'out', amount: 10000, account: 'cash', toAccount: null,
      source: 'payroll', sourceId: 'employee-1', customerId: null, category: 'payroll', note: '',
      number: null, reversalOf: null, createdAt: '2026-10-30T10:00:00.000Z',
    },
    {
      id: 'sale-1', direction: 'in', amount: 100000, account: 'cash', toAccount: null,
      source: 'sale', sourceId: 'customer-1', customerId: 'customer-1', category: 'Mijoz to‘lovi',
      note: '', number: null, reversalOf: null, createdAt: '2026-10-29T12:00:00.000Z',
    },
    {
      id: 'supplier-1', direction: 'out', amount: 30000, account: 'bank', toAccount: null,
      source: 'supplier', sourceId: 'supplier-1', customerId: null, category: 'Ta’minot',
      note: '', number: null, reversalOf: null, createdAt: '2026-10-28T10:00:00.000Z',
    },
  ];
  state.purchases = [{
    id: 'purchase-1', number: 'PUR-0001', supplierId: 'supplier-1', createdAt: '2026-10-28T09:00:00.000Z',
    lines: [{ id: 'purchase-line-1', itemId: 'item-1', qty: 10, price: 5000, received: 10, previousPurchasePrice: 0, newPurchasePrice: 5000, previousAverageCost: 0, newAverageCost: 5000 }],
  }];
  state.movements = [{
    id: 'movement-1', itemId: 'item-1', direction: 'in', qty: 10, unitCost: 5000,
    source: 'purchase', sourceId: 'purchase-1', note: '', createdAt: '2026-10-28T09:00:00.000Z',
  }];
  return state;
}

describe('customer statements', () => {
  it('shows shipped value, received money and current debt with payment dates', () => {
    const row = customerStatements(fixture(), '2026-10-01', '2026-11-01')[0];
    expect(row).toMatchObject({ name: 'Aziza', orders: 1, shipped: 250000, paid: 100000, debt: 150000, advance: 0 });
    expect(row.lastPaidAt).toBe('2026-10-29T12:00:00.000Z');
    expect(row.payments[0]).toMatchObject({ amount: 100000, account: 'cash' });
    expect(row.shipments[0]).toMatchObject({ orderNumber: 'ORD-0001', qty: 5, amount: 250000, status: 'delivered' });
  });
});

describe('supplier statements', () => {
  it('shows received value, paid money and current debt', () => {
    const row = supplierStatements(fixture(), '2026-10-01', '2026-11-01')[0];
    expect(row).toMatchObject({ name: 'Egger', purchases: 1, receivedValue: 50000, paid: 30000, debt: 20000 });
    expect(row.lastPaidAt).toBe('2026-10-28T10:00:00.000Z');
    expect(row.purchases === 1 && row.purchaseRows[0]).toMatchObject({ number: 'PUR-0001', value: 50000, receivedValue: 50000 });
    expect(row.payments[0]).toMatchObject({ amount: 30000, account: 'bank' });
  });

  it('shows accepted services separately and keeps a service-only contractor visible', () => {
    const state = fixture();
    state.purchases = [];
    state.movements = [];
    state.payroll = [];
    state.reports = [];
    state.shipments = [];
    state.cash = [];
    state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
    state.orders[0].route = [{
      id: 'task-outsourced', lineId: 'order-1-line', operationId: 'operation-1', name: 'Metall ish',
      executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
      rate: 120000, planned: 1, completed: 1, status: 'completed',
    }];
    const rows = supplierStatements(state, '2026-10-01', '2026-11-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supplierId: 'supplier-1', receivedValue: 0, outsourced: 120000, debt: 120000 });
    expect(rows[0].purchaseRows).toEqual([]);
  });
});

describe('order statements', () => {
  it('lists customer orders created in the period with paid and outstanding amounts', () => {
    const rows = orderStatements(fixture(), '2026-10-01', '2026-11-01');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      number: 'ORD-0001', customer: 'Aziza', status: 'delivered', price: 250000, paid: 100000, debt: 150000,
    });
  });
});
