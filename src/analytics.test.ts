import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import {
  cashByCategory, cashByPeriod, customerDetail, itemTurnover, movementJournal,
  periodEnd, periodKey, periodStart, salesByPeriod,
} from './analytics';
import type { State } from './types';

function fixture(): State {
  const state = emptyState();
  state.customers = [
    { id: 'c1', name: 'Aziza', phone: '', address: '', kind: 'customer', employeeId: null },
    { id: 'c2', name: 'Do‘kon', phone: '', address: '', kind: 'shop', employeeId: null },
  ];
  state.suppliers = [{ id: 's1', name: 'Supplier A', phone: '' }];
  state.items = [{
    id: 'i1', name: 'LDSP', unit: 'list', minQty: 0, cost: 100, customerId: null,
    kind: 'material', salePrice: 0, lastPurchasePrice: 100, materialCost: 100, laborCost: 0, category: null,
  }];
  state.purchases = [{ id: 'p1', number: 'P-1', supplierId: 's1', lines: [], createdAt: '2026-10-26T08:00:00.000Z' }];
  state.orders = [{
    id: 'o1', number: 'ORD-1', kind: 'product', customerId: 'c1', title: 'Oshxona',
    outputItemId: null, recipeVersionId: null, substitutions: {}, qty: 1, price: 1000, overhead: 0,
    dueDate: '2026-11-05', createdAt: '2026-10-31T09:00:00.000Z', status: 'production',
    lines: [{ id: 'l1', kind: 'product', title: 'Oshxona', qty: 1, total: 1000, status: 'production' }], materials: [], route: [],
  }];
  state.movements = [
    { id: 'm1', itemId: 'i1', direction: 'in', qty: 10, unitCost: 100, source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-10-26T08:00:00.000Z' },
    { id: 'm2', itemId: 'i1', direction: 'out', qty: 4, unitCost: 100, source: 'order', sourceId: 'o1', note: '', createdAt: '2026-10-31T09:00:00.000Z' },
    { id: 'm3', itemId: 'i1', direction: 'in', qty: 1, unitCost: 100, source: 'inventory', sourceId: 'i1', note: '', createdAt: '2026-11-02T09:00:00.000Z' },
  ];
  state.cash = [
    { id: 'k1', direction: 'in', amount: 500, account: 'cash', toAccount: null, source: 'sale', sourceId: null, customerId: 'c1', category: 'Buyurtma', note: '', number: null, reversalOf: null, createdAt: '2026-10-31T10:00:00.000Z' },
    { id: 'k2', direction: 'out', amount: 100, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'Arenda', note: '', number: null, reversalOf: null, createdAt: '2026-11-02T10:00:00.000Z' },
    { id: 'k3', direction: 'transfer', amount: 50, account: 'cash', toAccount: 'bank', source: 'transfer', sourceId: null, customerId: null, category: 'O‘tkazma', note: '', number: null, reversalOf: null, createdAt: '2026-11-02T11:00:00.000Z' },
  ];
  return state;
}

describe('periodKey', () => {
  it('builds day, ISO week and month keys', () => {
    expect(periodKey('2026-10-31T10:00:00.000Z', 'day')).toBe('2026-10-31');
    expect(periodKey('2026-10-31T10:00:00.000Z', 'month')).toBe('2026-10');
    expect(periodKey('2026-10-26T10:00:00.000Z', 'week')).toBe('2026-W44');
    expect(periodKey('2026-11-01T10:00:00.000Z', 'week')).toBe('2026-W44');
    expect(periodKey('2026-11-02T10:00:00.000Z', 'week')).toBe('2026-W45');
  });

  it('restores period bounds for labels', () => {
    expect(periodStart('2026-W44', 'week')).toBe('2026-10-26');
    expect(periodEnd('2026-W44', 'week')).toBe('2026-11-01');
    expect(periodStart('2026-10', 'month')).toBe('2026-10-01');
    expect(periodEnd('2026-10', 'month')).toBe('2026-10-31');
  });
});

describe('movementJournal', () => {
  it('resolves supplier, order and inventory counterparties with values', () => {
    const rows = movementJournal(fixture());
    expect(rows).toHaveLength(3);
    const purchase = rows.find(row => row.id === 'm1')!;
    expect(purchase.counterparty).toBe('Supplier A');
    expect(purchase.value).toBe(1000);
    expect(purchase.item).toBe('LDSP');
    expect(rows.find(row => row.id === 'm2')!.counterparty).toBe('ORD-1 · Oshxona');
    expect(rows.find(row => row.id === 'm3')!.counterparty).toBe('Inventarizatsiya');
  });
});

describe('itemTurnover', () => {
  it('aggregates purchases, issues and remaining stock per item', () => {
    const rows = itemTurnover(fixture());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: 'i1', inQty: 11, outQty: 4, purchasedQty: 10, purchasedValue: 1000,
      issuedQty: 4, issuedValue: 400, stock: 7,
    });
  });

  it('carries the last purchase price as the per-unit price', () => {
    const state = fixture();
    state.items[0].lastPurchasePrice = 250;
    expect(itemTurnover(state)[0].unitPrice).toBe(250);
  });
});

describe('склад в аналитике', () => {
  const second = '00000000-0000-4000-8000-00000000a002';

  function split(): State {
    const state = fixture();
    state.warehouses = [...state.warehouses, { id: second, name: 'Sex ombori', active: true }];
    state.movements = [
      state.movements[0],
      { ...state.movements[0], id: 'm4', warehouseId: second, qty: 5, createdAt: '2026-10-27T08:00:00.000Z' },
      state.movements[1],
    ];
    return state;
  }

  it('journal сужается до одного склада, без аргумента — все склады', () => {
    expect(movementJournal(split(), second).map(row => row.id)).toEqual(['m4']);
    expect(movementJournal(split())).toHaveLength(3);
  });

  it('turnover считает движения и остаток выбранного склада', () => {
    const rows = itemTurnover(split(), second);
    expect(rows[0]).toMatchObject({ inQty: 5, outQty: 0, purchasedQty: 5, purchasedValue: 500, stock: 5 });
    expect(itemTurnover(split())[0].stock).toBe(11);
  });
});

describe('cashByPeriod', () => {
  it('groups income and expense by day and month, excluding transfers', () => {
    const days = cashByPeriod(fixture(), 'day');
    expect(days.find(row => row.key === '2026-10-31')).toMatchObject({ income: 500, expense: 0, net: 500 });
    expect(days.find(row => row.key === '2026-11-02')).toMatchObject({ income: 0, expense: 100, net: -100, count: 1 });
    const months = cashByPeriod(fixture(), 'month');
    expect(months.find(row => row.key === '2026-10')).toMatchObject({ income: 500, net: 500 });
    expect(months.find(row => row.key === '2026-11')).toMatchObject({ expense: 100, net: -100 });
  });
});

describe('cashByCategory', () => {
  it('groups net amounts by category without transfers', () => {
    const rows = cashByCategory(fixture());
    expect(rows.find(row => row.category === 'Arenda')).toMatchObject({ expense: 100, net: -100 });
    expect(rows.find(row => row.category === 'Buyurtma')).toMatchObject({ income: 500, net: 500 });
    expect(rows.some(row => row.category === 'O‘tkazma')).toBe(false);
  });
});

describe('loan wires in cash analytics', () => {
  it('skips loan wires in cashByPeriod and cashByCategory', () => {
    const state = emptyState();
    state.cash = [
      { id: 'm1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'manual', note: '', number: null, reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'l1', direction: 'in', amount: 5_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', number: null, reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    ];
    const byPeriod = cashByPeriod(state, 'day');
    const byCategory = cashByCategory(state);
    expect(byPeriod).toHaveLength(1);
    expect(byPeriod[0]).toMatchObject({ income: 1_000, net: 1_000, count: 1 });
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0]).toMatchObject({ category: 'manual', income: 1_000, net: 1_000, count: 1 });
  });
});

describe('salesByPeriod', () => {
  it('aggregates orders, revenue and collected payments per month', () => {
    const rows = salesByPeriod(fixture(), 'month');
    const october = rows.find(row => row.key === '2026-10')!;
    expect(october).toMatchObject({ orders: 1, revenue: 1000, paid: 500 });
    expect(rows.every(row => row.key !== '2026-11' || row.orders === 0)).toBe(true);
  });
});

describe('customerDetail', () => {
  it('returns the customer orders, payments and ledger in one view', () => {
    const detail = customerDetail(fixture(), 'c1');
    expect(detail.customer.name).toBe('Aziza');
    expect(detail.orders).toHaveLength(1);
    expect(detail.orders[0].revenue).toBe(1000);
    expect(detail.payments).toHaveLength(1);
    expect(detail.stats.paid).toBe(500);
    expect(detail.balance.customerId).toBe('c1');
  });

  it('fails clearly for an unknown customer', () => {
    expect(() => customerDetail(fixture(), 'missing')).toThrow('Mijoz topilmadi');
  });
});
