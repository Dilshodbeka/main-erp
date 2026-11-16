import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './domain';
import { HealthSection, healthMetrics } from './health';
import type { CashEntry, Item, Order, Shipment, StockMovement } from './types';

const NOW = new Date(2026, 9, 29, 12);
const DAY = 86_400_000;

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, number: id, kind: 'product', customerId: 'customer', title: 'Форма',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 10, price: 1000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T12:00:00',
    status: 'production',
    lines: [{ id: 'line', kind: 'product', title: 'Форма', qty: 10, total: 1000, status: 'production' }],
    materials: [], route: [], ...overrides,
  };
}

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id, name: id, unit: 'м', minQty: 10, cost: 5, customerId: null,
    kind: 'material', salePrice: 0, lastPurchasePrice: 0, materialCost: 5, laborCost: 0, category: null, ...overrides,
  };
}

function movement(id: string, itemId: string, overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id, itemId, direction: 'in', qty: 100, unitCost: 5, source: 'purchase', sourceId: 'purchase',
    note: '', createdAt: '2026-10-01T12:00:00', ...overrides,
  };
}

function cash(id: string, customerId: string, amount: number, overrides: Partial<CashEntry> = {}): CashEntry {
  return {
    id, sourceId: customerId, direction: 'in', amount, account: 'cash', toAccount: null,
    source: 'sale', customerId, category: 'Оплата клиента', note: '', number: null, reversalOf: null,
    createdAt: '2026-10-10T12:00:00', ...overrides,
  };
}

function shipment(id: string, orderId: string, qty: number, deliveredAt: string | null, overrides: Partial<Shipment> = {}): Shipment {
  return {
    id, orderId, customerId: 'customer', kind: 'order',
    lines: [{ id: `${id}-line`, itemId: null, description: '', qty, salePrice: 0, unitCost: 0, materialCost: 0, laborCost: 0 }],
    deliveredAt, status: 'delivered', address: '', dueDate: '2026-10-10',
    createdAt: '2026-10-02T00:00:00Z', reversalOf: null, ...overrides,
  };
}

function createdDaysAgo(days: number): string {
  const created = new Date(NOW);
  created.setDate(created.getDate() - days);
  return created.toISOString();
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

afterEach(() => vi.useRealTimers());

describe('healthMetrics: deadlines and receivables', () => {
  it('uses local today, excludes today/future/invalid deadlines and closed orders', () => {
    const state = emptyState();
    state.orders = [
      order('production', { dueDate: '2026-10-28' }),
      order('draft', { status: 'draft', dueDate: '2026-10-27', price: 200 }),
      order('ready', { status: 'ready', dueDate: '2026-10-28', price: 300 }),
      order('shipped', { status: 'shipped', dueDate: '2026-10-28', price: 400 }),
      order('today', { dueDate: '2026-10-29' }),
      order('future', { dueDate: '2026-10-30' }),
      order('delivered', { status: 'delivered', dueDate: '2026-10-20' }),
      order('cancelled', { status: 'cancelled', dueDate: '2026-10-20' }),
      order('invalid', { dueDate: '' }),
    ];
    const localJustAfterMidnight = new Date(2026, 9, 29, 0, 1);
    const result = healthMetrics(state, localJustAfterMidnight);
    expect(result.today).toBe('2026-10-29');
    expect(result.delayed.count).toBe(4);
    expect(result.delayed.amount).toBe(1900);
    expect(result.delayed.rows.map(row => row.order.id)).toEqual(['draft', 'production', 'shipped', 'ready']);
    expect(result.delayed.rows.map(row => row.delayDays)).toEqual([2, 1, 1, 1]);
    expect(result.delayed.rows.find(row => row.order.id === 'ready')?.action).toContain('yuborish');
    expect(result.delayed.rows.find(row => row.order.id === 'shipped')?.action).toContain('Yetkazib');
  });

  it('counts debt on delivered orders only, using full price and net payments/reversals', () => {
    const state = emptyState();
    state.customers = ['debt', 'paid', 'overpaid', 'partial', 'cancelled'].map(id => ({
      id: `customer-${id}`, name: id === 'debt' ? 'Алия' : id, phone: '', address: '', kind: 'customer' as const, employeeId: null,
    }));
    state.orders = [
      order('debt', { status: 'delivered', qty: 25, customerId: 'customer-debt' }),
      order('paid', { status: 'delivered', customerId: 'customer-paid' }),
      order('overpaid', { status: 'delivered', customerId: 'customer-overpaid' }),
      order('partial', { status: 'shipped', customerId: 'customer-partial' }),
      order('cancelled', { status: 'cancelled', customerId: 'customer-cancelled' }),
    ];
    state.cash = [
      cash('advance', 'customer-debt', 250),
      cash('refund', 'customer-debt', 100, { direction: 'out', reversalOf: 'advance' }),
      cash('payment', 'customer-paid', 1000), cash('overpayment', 'customer-overpaid', 1100),
      cash('manual', 'customer-debt', 300, { source: 'manual' }),
      cash('transfer', 'customer-debt', 500, { direction: 'transfer', source: 'transfer', toAccount: 'bank' }),
    ];
    const result = healthMetrics(state, NOW);
    expect(result.receivables.count).toBe(1);
    expect(result.receivables.amount).toBe(850);
    expect(result.receivables.rows[0]).toMatchObject({ paid: 150, debt: 850, ageDays: 28, ageBand: '0-30', customerName: 'Алия' });
    expect(result.receivables.ageBands.reduce((sum, band) => sum + band.amount, 0)).toBe(850);
  });

  it('allocates customer payments to the oldest delivered order through the shared ledger', () => {
    const state = emptyState();
    state.customers = [{ id: 'customer', name: 'Алия', phone: '', address: '', kind: 'customer', employeeId: null }];
    state.orders = [
      order('older', { status: 'delivered', createdAt: '2026-09-01T09:00:00' }),
      order('newer', { status: 'delivered', createdAt: '2026-10-01T09:00:00' }),
    ];
    state.cash = [cash('payment', 'customer', 600, { createdAt: '2026-10-10T12:00:00' })];
    const result = healthMetrics(state, NOW);
    expect(result.receivables.rows.map(row => [row.order.id, row.paid, row.debt]))
      .toEqual([['older', 600, 400], ['newer', 0, 1000]]);
    expect(result.receivables.amount).toBe(1400);
  });

  it.each([
    [0, '0-30'], [30, '0-30'], [31, '31-60'], [60, '31-60'],
    [61, '61-90'], [90, '61-90'], [91, '91+'],
  ])('assigns creation age %i days to band %s, regardless of due date or payment date', (days, band) => {
    const state = emptyState();
    state.orders = [order('debt', { status: 'delivered', createdAt: createdDaysAgo(Number(days)), dueDate: '2027-01-01' })];
    state.cash = [cash('recent-payment', 'customer', 100, { createdAt: NOW.toISOString() })];
    const result = healthMetrics(state, NOW);
    expect(result.receivables.rows[0]).toMatchObject({ ageDays: days, ageBand: band, debt: 900 });
    expect(result.receivables.ageBands.find(row => row.key === band)).toMatchObject({ count: 1, amount: 900 });
  });

  it('counts local calendar ages across midnight, and preserves unknown dates without NaN', () => {
    const state = emptyState();
    state.orders = [
      order('midnight', { status: 'delivered', createdAt: '2026-10-28T23:59:00' }),
      order('unknown', { status: 'delivered', createdAt: 'invalid' }),
      order('future', { status: 'delivered', createdAt: '2026-10-30T12:00:00' }),
    ];
    const result = healthMetrics(state, new Date(2026, 9, 29, 0, 1));
    expect(result.receivables.rows.find(row => row.order.id === 'midnight')?.ageDays).toBe(1);
    expect(result.receivables.rows.find(row => row.order.id === 'future')?.ageDays).toBe(0);
    expect(result.receivables.ageBands.find(row => row.key === 'unknown')).toMatchObject({ count: 1, amount: 1000 });
  });
});

describe('healthMetrics: planned economics', () => {
  it('uses full price with qty > 1, includes overhead only in planned cost and ignores cash transfers', () => {
    const state = emptyState();
    state.orders = [order('low', {
      qty: 20, overhead: 250,
      materials: [{ id: 'material', lineId: 'line', itemId: 'own', qty: 5, estimatedCost: 100, issuedQty: 5, actualCost: 60 }],
      route: [{ id: 'route', lineId: 'line', operationId: 'cut', name: 'Раскрой', executorKind: 'employee', employeeId: 'worker', supplierId: null, rate: 10, planned: 20, completed: 15, status: 'in_progress' }],
    })];
    state.payroll = [{ id: 'payroll', employeeId: 'worker', reportId: 'report', orderId: 'low', taskId: 'route', amount: 150, status: 'accepted', createdAt: '2026-10-20T12:00:00' }];
    const before = healthMetrics(state, NOW);
    expect(before.margins[0]).toMatchObject({ plannedCost: 950, plannedProfit: 50, plannedMarginPercent: 5, actualCost: 450 });
    expect(before.lowMargin).toMatchObject({ count: 1, amount: 1000, thresholdPercent: 10 });
    state.cash.push(cash('move', 'low', 800, { direction: 'transfer', source: 'transfer', toAccount: 'bank' }));
    state.cash.push(cash('reverse-move', 'low', 800, { direction: 'transfer', source: 'transfer', account: 'bank', toAccount: 'cash', reversalOf: 'move' }));
    expect(healthMetrics(state, NOW)).toEqual(before);
  });

  it('uses a strict 10% threshold, retains negative planned margins, excludes cancelled and handles zero price', () => {
    const state = emptyState();
    state.orders = [
      order('ten', { overhead: 900 }), order('below', { overhead: 900.01 }),
      order('negative', { overhead: 1100 }), order('healthy', { overhead: 800 }),
      order('cancelled', { status: 'cancelled', overhead: 1100 }),
      order('zero', { price: 0, overhead: 10 }),
    ];
    const result = healthMetrics(state, NOW);
    expect(result.lowMargin.rows.map(row => row.order.id)).toEqual(['negative', 'below']);
    expect(result.margins.find(row => row.order.id === 'ten')?.plannedMarginPercent).toBe(10);
    expect(result.margins.find(row => row.order.id === 'negative')?.plannedMarginPercent).toBe(-10);
    expect(result.margins.find(row => row.order.id === 'zero')?.plannedMarginPercent).toBeNull();
  });

  it('keeps fractional monetary totals exact and does not flag floating-point noise at 10%', () => {
    const state = emptyState();
    state.orders = [
      order('ten-small', { price: 0.3, overhead: 0.27 }),
      order('debt-small', { status: 'delivered', price: 0.3, customerId: 'customer-small' }),
      order('debt-smaller', { status: 'delivered', price: 0.2, customerId: 'customer-smaller' }),
    ];
    state.cash = [cash('payment-small', 'customer-small', 0.2)];
    const result = healthMetrics(state, NOW);
    expect(result.lowMargin.count).toBe(0);
    expect(result.margins[0].plannedProfit).toBe(0.03);
    expect(result.margins[0].plannedMarginPercent).toBe(10);
    expect(result.receivables.rows.find(row => row.order.id === 'debt-small')?.debt).toBe(0.1);
    expect(result.receivables.amount).toBe(0.3);
    expect(result.receivables.ageBands[0].amount).toBe(0.3);
  });
});

describe('healthMetrics: own inventory and measured cover', () => {
  it('subtracts reservations, applies strict free > 3 × min only with a positive min and excludes customer goods', () => {
    const state = emptyState();
    state.items = [item('own'), item('equal', { minQty: 2, cost: 3 }), item('no-min', { minQty: 0, cost: 2 }), item('customer', { customerId: 'customer', cost: 0, minQty: 1 })];
    state.movements = [
      movement('receipt', 'own'),
      movement('issue', 'own', { direction: 'out', qty: 10, source: 'order', sourceId: 'issued', createdAt: '2026-10-20T12:00:00' }),
      movement('equal-receipt', 'equal', { qty: 6, unitCost: 3 }),
      movement('no-min-receipt', 'no-min', { qty: 100, unitCost: 2 }),
      movement('customer-receipt', 'customer', { qty: 1000, unitCost: 0, source: 'customer' }),
      movement('customer-issue', 'customer', { direction: 'out', qty: 100, unitCost: 0, source: 'order', createdAt: '2026-10-20T12:00:00' }),
    ];
    state.orders = [order('reserved', { materials: [{ id: 'reserve', lineId: 'line', itemId: 'own', qty: 50, estimatedCost: 5, issuedQty: 0, actualCost: 0 }] })];
    const result = healthMetrics(state, NOW).inventory;
    expect(result.count).toBe(3);
    expect(result.reviewRows.map(row => row.item.id)).toEqual(['own']);
    expect(result.reviewRows[0]).toMatchObject({ stock: 90, reserved: 50, free: 40, thresholdQty: 30, aboveThresholdQty: 10, freeValue: 200, aboveThresholdValue: 50 });
    expect(result.reviewCount).toBe(1);
    expect(result.reviewFreeValue).toBe(200);
    expect(result.aboveThresholdValue).toBe(50);
    expect(result.stockValue).toBe(668);
    expect(result.freeValue).toBe(418);
    expect(result.issuedOwnMaterialCost30Days).toBe(50);
    expect(result.stockCoverDays).toBeCloseTo(400.8);
  });

  it('filters a rolling 30-day issue window and values consumption at historical issue cost', () => {
    const state = emptyState();
    state.items = [item('own', { cost: 4 }), item('customer', { customerId: 'customer', cost: 0 })];
    const windowStart = NOW.getTime() - 30 * DAY;
    state.movements = [
      movement('receipt', 'own', { qty: 1000, unitCost: 1 }),
      movement('start', 'own', { direction: 'out', source: 'order', qty: 2, unitCost: 3, createdAt: new Date(windowStart).toISOString() }),
      movement('now', 'own', { direction: 'out', source: 'order', qty: 3, unitCost: 7, createdAt: NOW.toISOString() }),
      movement('old', 'own', { direction: 'out', source: 'order', qty: 10, unitCost: 20, createdAt: new Date(windowStart - 1).toISOString() }),
      movement('future', 'own', { direction: 'out', source: 'order', qty: 10, unitCost: 20, createdAt: new Date(NOW.getTime() + 1).toISOString() }),
      movement('count', 'own', { direction: 'out', source: 'inventory', qty: 10, unitCost: 20, createdAt: NOW.toISOString() }),
      movement('incoming-order', 'own', { source: 'order', qty: 10, unitCost: 20, createdAt: NOW.toISOString() }),
      movement('customer', 'customer', { direction: 'out', source: 'order', qty: 10, unitCost: 0, createdAt: NOW.toISOString() }),
      movement('invalid-date', 'own', { direction: 'out', source: 'order', qty: 1, createdAt: 'invalid' }),
    ];
    const result = healthMetrics(state, NOW).inventory;
    expect(result.issuedOwnMaterialCost30Days).toBe(27);
    expect(result.stockValue).toBe(3896);
    expect(result.stockCoverDays).toBeCloseTo(3896 / 27 * 30);
  });

  it('returns null without valued own consumption, including customer-only zero-cost issues', () => {
    const state = emptyState();
    state.items = [item('own'), item('customer', { customerId: 'customer', cost: 0 })];
    state.movements = [movement('own-in', 'own'), movement('customer-in', 'customer', { unitCost: 0, source: 'customer' }), movement('customer-out', 'customer', { direction: 'out', qty: 10, unitCost: 0, source: 'order', createdAt: NOW.toISOString() })];
    const result = healthMetrics(state, NOW).inventory;
    expect(result.stockValue).toBe(500);
    expect(result.issuedOwnMaterialCost30Days).toBe(0);
    expect(result.stockCoverDays).toBeNull();
  });

  it('returns zero cover when stock is exhausted but measured consumption is positive', () => {
    const state = emptyState();
    state.items = [item('own')];
    state.movements = [movement('in', 'own'), movement('out', 'own', { direction: 'out', source: 'order', createdAt: NOW.toISOString() })];
    expect(healthMetrics(state, NOW).inventory).toMatchObject({ stockValue: 0, issuedOwnMaterialCost30Days: 500, stockCoverDays: 0 });
  });

  it('does not classify decimal quantity equal to the heuristic threshold as above it', () => {
    const state = emptyState();
    state.items = [item('fractional', { minQty: 0.3, cost: 1 })];
    state.movements = [movement('stock', 'fractional', { qty: 0.9, unitCost: 1 })];
    const result = healthMetrics(state, NOW).inventory;
    expect(result.reviewCount).toBe(0);
    expect(result.rows[0].aboveThresholdQty).toBe(0);
    expect(result.stockValue).toBe(0.9);
  });
});

describe('healthMetrics: fulfillment and purity', () => {
  it('measures created-to-last-delivery days once per fully delivered order, not per shipment', () => {
    const state = emptyState();
    state.orders = [
      order('split', { status: 'delivered', createdAt: '2026-10-01T00:00:00Z' }),
      order('single', { status: 'delivered', qty: 1, createdAt: '2026-10-01T00:00:00Z' }),
      order('partial', { status: 'shipped', createdAt: '2026-10-01T00:00:00Z' }),
      order('missing', { status: 'delivered' }), order('short', { status: 'delivered' }),
      order('invalid', { status: 'delivered', createdAt: 'invalid' }),
      order('future', { status: 'delivered' }), order('backwards', { status: 'delivered' }),
    ];
    state.shipments = [
      shipment('last', 'split', 6, '2026-10-11T12:00:00Z'), shipment('first', 'split', 4, '2026-10-05T00:00:00Z'),
      shipment('one', 'single', 1, '2026-10-03T00:00:00Z'),
      shipment('part', 'partial', 4, '2026-10-04T00:00:00Z'),
      shipment('missing-date', 'missing', 10, null), shipment('short-qty', 'short', 9, '2026-10-10T00:00:00Z'),
      shipment('bad-created', 'invalid', 10, '2026-10-10T00:00:00Z'),
      shipment('future-date', 'future', 10, '2027-01-01T00:00:00Z'), shipment('backwards-date', 'backwards', 10, '2026-09-01T00:00:00Z'),
    ];
    const result = healthMetrics(state, NOW).fulfillment;
    expect(result.count).toBe(2);
    expect(result.rows.map(row => row.days)).toEqual([10.5, 2]);
    expect(result.rows[0].deliveredAt).toBe('2026-10-11T12:00:00.000Z');
    expect(result.averageDays).toBe(6.25);
  });

  it('returns empty/null metrics, uses the optional default clock and does not mutate frozen input or now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const state = emptyState();
    const before = structuredClone(state);
    freeze(state);
    const now = new Date(NOW);
    const result = healthMetrics(state, now);
    expect(result).toEqual(healthMetrics(state));
    expect(result.delayed).toMatchObject({ rows: [], count: 0, amount: 0 });
    expect(result.receivables).toMatchObject({ rows: [], count: 0, amount: 0 });
    expect(result.lowMargin).toMatchObject({ rows: [], count: 0, amount: 0 });
    expect(result.inventory).toMatchObject({ rows: [], reviewRows: [], stockValue: 0, stockCoverDays: null });
    expect(result.fulfillment).toEqual({ rows: [], count: 0, averageDays: null });
    expect(state).toEqual(before);
    expect(now.getTime()).toBe(NOW.getTime());
  });

  it('keeps populated nested state immutable when sorting risks and measuring ledgers', () => {
    const state = emptyState();
    state.items = [item('own')];
    state.orders = [order('newer', { dueDate: '2026-10-28', overhead: 950 }), order('older', { status: 'delivered', dueDate: '2026-10-20', createdAt: '2026-09-01T00:00:00Z' })];
    state.movements = [movement('stock', 'own')];
    state.cash = [cash('payment', 'customer', 100)];
    state.shipments = [shipment('delivery', 'older', 10, '2026-09-05T00:00:00Z')];
    const before = structuredClone(state);
    freeze(state);
    healthMetrics(state, NOW);
    expect(state).toEqual(before);
  });
});

describe('HealthSection: truthful Uzbek management reporting', () => {
  it('renders empty states and explains heuristics, creation ages and missing consumption', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const html = renderToStaticMarkup(createElement(HealthSection, { state: emptyState() }));
    expect(html).toContain('Rejadagi marja &lt; 10%');
    expect(html).toContain('Muddati buzilgan buyurtmalar yo‘q');
    expect(html).toContain('Yetkazilgan buyurtmalar bo‘yicha qarz yo‘q');
    expect(html).toContain('Oxirgi 30 kunda buyurtmalarga chiqim yo‘q');
    expect(html).toContain('bu to‘lov kechikishi emas');
    expect(html).toContain('isbotlangan ortiqcha emas');
    expect(html).toContain('rejadagi ustama xarajatlarsiz');
    expect(html).not.toMatch(/NaN|Infinity|<svg[^>]*class="[^"]*chart/);
  });

  it('renders risk tables with measured debt, ages, threshold and concrete next actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const state = emptyState();
    state.items = [item('Ткань')];
    state.movements = [movement('stock', 'Ткань')];
    state.orders = [order('П-100', { dueDate: '2026-10-28', overhead: 950 }), order('П-101', { status: 'delivered', createdAt: createdDaysAgo(61) })];
    state.cash = [cash('paid', 'customer', 200)];
    const html = renderToStaticMarkup(createElement(HealthSection, { state }));
    expect(html).toContain('П-100');
    expect(html).toContain('П-101');
    expect(html).toContain('61–90 kun');
    expect(html).toContain('61 kun');
    expect(html).toContain('800 so‘m');
    expect(html).toContain('5%');
    expect(html).toContain('Keyingi qadam');
    expect(html).toContain('3 × minimal me’yor');
    expect(html).toContain('bo‘sh zaxirani ishlating');
  });
});
