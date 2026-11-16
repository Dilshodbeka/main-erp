import { describe, expect, it } from 'vitest';
import { cashBalance, emptyState } from './domain';
import { machineReport, periodReport, shopReport, stockBalanceReport } from './reports';
import type { CashEntry, Employee, Machine, Operation, Order, Shipment, State, WorkReport } from './types';

function reportFixture(): State {
  const state = emptyState();
  state.customers = [
    { id: 'shop-1', name: 'Магазин', phone: '', address: '', kind: 'shop', employeeId: null },
    { id: 'customer-1', name: 'Клиент', phone: '', address: '', kind: 'customer', employeeId: null },
  ];
  state.items = [
    {
      id: 'finished-1', name: 'Шкаф', unit: 'шт', minQty: 0, cost: 60000, customerId: null,
      kind: 'finished', salePrice: 50000, lastPurchasePrice: 0, materialCost: 50000, laborCost: 10000, category: null,
    },
    {
      id: 'material-1', name: 'ЛДСП', unit: 'лист', minQty: 0, cost: 100, customerId: null,
      kind: 'material', salePrice: 0, lastPurchasePrice: 100, materialCost: 100, laborCost: 0, category: null,
    },
  ];
  state.movements = [
    {
      id: 'opening', itemId: 'finished-1', direction: 'in', qty: 5, unitCost: 60000, source: 'inventory',
      sourceId: '', note: '', createdAt: '2026-10-20T09:00:00Z',
    },
    {
      id: 'produced', itemId: 'finished-1', direction: 'in', qty: 3, unitCost: 60000, source: 'production',
      sourceId: 'series-1', note: '', createdAt: '2026-11-05T09:00:00Z',
    },
    {
      id: 'purchased', itemId: 'material-1', direction: 'in', qty: 10, unitCost: 100, source: 'purchase',
      sourceId: 'purchase-1', note: '', createdAt: '2026-11-06T09:00:00Z',
    },
    {
      id: 'sold', itemId: 'finished-1', direction: 'out', qty: 2, unitCost: 60000, source: 'sale',
      sourceId: 'shipment-1', note: '', createdAt: '2026-11-10T09:00:00Z',
    },
  ];
  const line = {
    id: 'shipment-1-line', itemId: 'finished-1', description: 'Шкаф', qty: 2,
    salePrice: 50000, unitCost: 30000, materialCost: 25000, laborCost: 5000,
  };
  state.shipments = [{
    id: 'shipment-1', orderId: null, customerId: 'shop-1', kind: 'stock', lines: [line],
    address: '', dueDate: '2026-11-12', status: 'delivered',
    createdAt: '2026-11-10T09:00:00Z', deliveredAt: '2026-11-11T09:00:00Z', reversalOf: null,
  }];
  state.cash = [
    {
      id: 'payment', direction: 'in', amount: 50000, account: 'cash', toAccount: null, source: 'sale',
      sourceId: 'shop-1', customerId: 'shop-1', category: 'sale', note: '', number: null, reversalOf: null,
      createdAt: '2026-11-12T09:00:00Z',
    },
    {
      id: 'wage', direction: 'out', amount: 200, account: 'cash', toAccount: null, source: 'payroll',
      sourceId: 'worker-1', customerId: null, category: 'payroll', note: '', number: null, reversalOf: null,
      createdAt: '2026-11-15T09:00:00Z',
    },
  ];
  state.employees = [{ id: 'worker-1', name: 'Мастер', active: true }] as Employee[];
  state.machines = [{ id: 'machine-1', name: 'Раскрой', hourlyRevenueTarget: 150000, active: true }] as Machine[];
  state.operations = [{
    id: 'operation-1', name: 'Раскрой', unit: 'sheet', salePrice: 50000, workerRate: 10000,
    standardMinutes: 30, machineId: 'machine-1', employeeIds: ['worker-1'], active: true,
  }] as Operation[];
  const machineOrder: Order = {
    id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'customer-1', title: 'Кухня',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 2, price: 200000, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T09:00:00Z',
    status: 'production',
    lines: [{ id: 'order-1-line', kind: 'product', title: 'Кухня', qty: 2, total: 200000, status: 'production' }],
    materials: [], route: [{
      id: 'task-1', lineId: 'order-1-line', operationId: 'operation-1', name: 'Раскрой',
      executorKind: 'employee', employeeId: 'worker-1', supplierId: null,
      rate: 10000, salePrice: 50000, standardMinutes: 30, planned: 2, completed: 2, status: 'completed',
    }],
  };
  const seriesOrder: Order = {
    id: 'series-1', number: 'ORD-0002', kind: 'series', customerId: '', title: 'Серия шкафов',
    outputItemId: 'finished-1', recipeVersionId: 'recipe-1', substitutions: {},
    qty: 3, price: 0, overhead: 0, dueDate: '2026-11-15', createdAt: '2026-11-02T09:00:00Z',
    status: 'ready',
    lines: [{ id: 'series-1-line', kind: 'product', title: 'Серия шкафов', qty: 3, total: 0, status: 'ready' }],
    materials: [{
      id: 'material-line', lineId: 'series-1-line', itemId: 'material-1', qty: 1, estimatedCost: 100, issuedQty: 1, actualCost: 120,
    }], route: [],
  };
  state.orders = [machineOrder, seriesOrder];
  state.reports = [{
    id: 'report-1', orderId: 'order-1', taskId: 'task-1', employeeId: 'worker-1',
    qty: 2, status: 'accepted', note: '', createdAt: '2026-11-08T09:00:00Z',
  }] as WorkReport[];
  state.payroll = [
    {
      id: 'pending', employeeId: 'worker-1', reportId: 'report-2', orderId: 'order-1', taskId: 'task-1',
      amount: 1000, status: 'pending', createdAt: '2026-11-03T09:00:00Z',
    },
    {
      id: 'accepted', employeeId: 'worker-1', reportId: 'report-1', orderId: 'order-1', taskId: 'task-1',
      amount: 500, status: 'accepted', createdAt: '2026-11-08T09:00:00Z',
    },
  ];
  return state;
}

const ship = (id: string, overrides: Partial<Shipment>): Shipment => ({
  id, orderId: null, customerId: 'shop-1', kind: 'stock',
  lines: [{ id: `${id}-line`, itemId: 'finished-1', description: '', qty: 1, salePrice: 100000, unitCost: 0, materialCost: 0, laborCost: 0 }],
  address: '', dueDate: '2026-11-30', status: 'delivered', createdAt: '2026-11-10T09:00:00Z',
  deliveredAt: null, reversalOf: null, ...overrides,
});

describe('period report', () => {
  it('separates revenue recognition from cash and reports shop gross profit', () => {
    const report = periodReport(reportFixture(), '2026-11-01', '2026-11-30');
    expect(report).toMatchObject({ revenue: 100000, cogs: 60000, grossProfit: 40000, cashIn: 50000 });
    const shop = shopReport(reportFixture(), 'shop-1', '2026-11-01', '2026-11-30');
    expect(shop).toMatchObject({ deliveredQty: 2, revenue: 100000, materialCost: 50000, laborCost: 10000, debt: 50000 });
    expect(report.seriesRevenue + report.customRevenue).toBe(report.revenue);
  });

  it('splits custom order shipments from series stock sales', () => {
    const state = reportFixture();
    state.shipments.push(ship('custom', {
      orderId: 'order-1', kind: 'order', customerId: 'customer-1',
      lines: [{ id: 'custom-line', itemId: null, description: 'Кухня', qty: 1, salePrice: 30000, unitCost: 10000, materialCost: 6000, laborCost: 4000 }],
    }));
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.customRevenue).toBe(30000);
    expect(report.seriesRevenue).toBe(100000);
    expect(report.revenue).toBe(130000);
    expect(report.cogs).toBe(70000);
  });

  it('uses a half-open period and ignores cancelled shipments', () => {
    const state = reportFixture();
    state.shipments.push(
      ship('at-start', { createdAt: '2026-11-01T00:00:00Z' }),
      ship('at-end', { createdAt: '2026-11-30T00:00:00Z' }),
      ship('cancelled', { status: 'cancelled' }),
    );
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.revenue).toBe(100000 + 100000);
    expect(report.cogs).toBe(60000);
  });

  it('reports payroll by status and net paid cash', () => {
    const report = periodReport(reportFixture(), '2026-11-01', '2026-11-30');
    expect(report).toMatchObject({ payrollPending: 1000, payrollAccepted: 500, payrollPaid: 200 });
  });

  it('reports recipe variance for series production in the period', () => {
    const report = periodReport(reportFixture(), '2026-11-01', '2026-11-30');
    expect(report.recipeVariance).toEqual([
      { orderId: 'series-1', number: 'ORD-0002', plannedMaterial: 100, actualMaterial: 120, variance: 20 },
    ]);
  });
});

describe('monthly expense payments in operating costs', () => {
  const expenseEntry = (id: string, direction: 'in' | 'out', amount: number, reversalOf: string | null = null): CashEntry => ({
    id, direction, amount, account: 'cash', toAccount: null, source: 'expense',
    sourceId: 'p1', customerId: null, category: 'expense', note: '', number: null, reversalOf,
    createdAt: '2026-11-18T09:00:00Z',
  });

  it('counts expense payments net of reversals', () => {
    const state = reportFixture();
    state.cash.push(
      expenseEntry('rent', 'out', 500000),
      expenseEntry('rent-back', 'in', 200000, 'rent'),
    );
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.operating).toBe(300000);
  });

  it('keeps payroll and supplier payments out of operating costs', () => {
    const state = reportFixture();
    state.cash.push(
      { ...expenseEntry('wage2', 'out', 700000), source: 'payroll', sourceId: 'worker-1', category: 'payroll' },
      { ...expenseEntry('supplier2', 'out', 400000), source: 'supplier', sourceId: 'sup-1', category: 'supplier' },
    );
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.operating).toBe(0);
  });

  it('excludes loan wires from operating income and spending but keeps them in the balance', () => {
    const state = emptyState();
    state.cash = [
      { id: 'm1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'manual', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'l1', direction: 'in', amount: 5_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'l2', direction: 'out', amount: 1_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-repay', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    ] as CashEntry[];
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.cashIn).toBe(1_000);
    expect(report.cashOut).toBe(0);
    expect(cashBalance(state, 'cash')).toBe(5_000);
  });
});

describe('stock balance', () => {
  it('keeps opening + inbound − outbound equal to closing and counts manufacture', () => {
    const report = stockBalanceReport(reportFixture(), '2026-11-01', '2026-11-30');
    const finished = report.rows.find(row => row.itemId === 'finished-1')!;
    expect(finished).toMatchObject({ opening: 5, inbound: 3, outbound: 2, closing: 6, manufactured: 3 });
    const material = report.rows.find(row => row.itemId === 'material-1')!;
    expect(material).toMatchObject({ opening: 0, inbound: 10, outbound: 0, closing: 10, manufactured: 0 });
    for (const row of report.rows) expect(row.closing).toBe(row.opening + row.inbound - row.outbound);
    expect(report.manufactured).toBe(3);
  });

  it('values opening and closing stock at the item cost', () => {
    const report = stockBalanceReport(reportFixture(), '2026-11-01', '2026-11-30');
    expect(report.openingValue).toBe(5 * 60000);
    expect(report.closingValue).toBe(6 * 60000 + 10 * 100);
  });
});

describe('machine report', () => {
  it('compares the machine revenue target with accepted output', () => {
    const report = machineReport(reportFixture(), '2026-11-01', '2026-11-30');
    expect(report.rows[0]).toMatchObject({ machineId: 'machine-1', targetRevenue: 150000, actualRevenue: 100000, lostRevenue: 50000 });
    expect(report.lostRevenue).toBe(50000);
  });

  it('does not show a negative loss and hides the target when no plan is set', () => {
    const profitable = reportFixture();
    profitable.machines[0].hourlyRevenueTarget = 100000;
    expect(machineReport(profitable, '2026-11-01', '2026-11-30').rows[0].lostRevenue).toBe(0);
    const unplanned = reportFixture();
    unplanned.machines[0].hourlyRevenueTarget = 0;
    expect(machineReport(unplanned, '2026-11-01', '2026-11-30').rows[0].lostRevenue).toBeNull();
  });
});
