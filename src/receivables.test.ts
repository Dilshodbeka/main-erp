import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { customerBalance, orderBalance } from './receivables';
import type { Actor, Command, Order, Shipment, State } from './types';

const admin: Actor = { id: 'admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

const pay = (customerId: string, amount: number): Command => ({ type: 'customer.pay', customerId, amount, account: 'cash' });

function shipment(id: string, total: number, createdAt: string, overrides: Partial<Shipment> = {}): Shipment {
  return {
    id, orderId: null, customerId: 'customer-1', kind: 'stock',
    lines: [{ id: `${id}-line`, itemId: 'item-1', description: '', qty: 1, salePrice: total, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: '2026-11-05', status: 'delivered', createdAt, deliveredAt: null, reversalOf: null,
    ...overrides,
  };
}

function order(id: string, price: number, overrides: Partial<Order> = {}): Order {
  return {
    id, number: id, kind: 'product', customerId: 'customer-1', title: 'Кухня',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 1, price, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
    lines: [{ id: `${id}-line`, kind: 'product', title: 'Кухня', qty: 1, total: price, status: 'delivered' }],
    materials: [], route: [],
    ...overrides,
  };
}

function base(): State {
  const state = emptyState();
  state.customers.push({ id: 'customer-1', name: 'Alif', phone: '', address: '', kind: 'customer', employeeId: null });
  return state;
}

describe('single customer balance', () => {
  it('charges the agreed contract and shows only debt while money is short', () => {
    const state = base();
    state.orders.push(order('order-1', 30000000));
    const paid = run(state, pay('customer-1', 9200000));
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ contract: 30000000, paid: 9200000, debt: 20800000, advance: 0 });
  });

  it('never reports debt and advance together', () => {
    const state = base();
    state.orders.push(order('order-1', 30000000));
    const settled = run(state, pay('customer-1', 30000000));
    expect(customerBalance(settled, 'customer-1')).toMatchObject({ debt: 0, advance: 0 });
    const over = run(settled, pay('customer-1', 5000000));
    const balance = customerBalance(over, 'customer-1');
    expect(balance).toMatchObject({ debt: 0, advance: 5000000, paid: 35000000 });
    expect(balance.debt > 0 && balance.advance > 0).toBe(false);
  });

  it('keeps a draft order out of the contract and out of the debt', () => {
    const state = base();
    state.orders.push(order('order-1', 20000000, { status: 'draft' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 0, debt: 0, advance: 0 });
    const agreed = run(state, pay('customer-1', 5000000));
    expect(customerBalance(agreed, 'customer-1')).toMatchObject({ contract: 0, debt: 0, advance: 5000000 });
  });

  it('ignores cancelled orders and series production', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000, { status: 'cancelled' }));
    state.orders.push(order('order-2', 7000000, { kind: 'series' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 0, debt: 0 });
  });

  it('treats a stock shipment without an order as an obligation', () => {
    const state = base();
    state.shipments.push(shipment('stock-1', 4000000, '2026-10-05T00:00:00Z'));
    const balance = customerBalance(state, 'customer-1');
    expect(balance).toMatchObject({ contract: 4000000, debt: 4000000, advance: 0 });
    expect(balance.obligations[0]).toMatchObject({ kind: 'stock', id: 'stock-1', orderId: null });
  });

  it('applies a payment to the oldest obligation first', () => {
    const state = base();
    state.orders.push(order('order-old', 10000000, { createdAt: '2026-10-01T00:00:00Z' }));
    state.orders.push(order('order-new', 20000000, { createdAt: '2026-10-09T00:00:00Z' }));
    const paid = run(state, pay('customer-1', 12000000));
    expect(orderBalance(paid, 'order-old')).toMatchObject({ paid: 10000000, outstanding: 0 });
    expect(orderBalance(paid, 'order-new')).toMatchObject({ paid: 2000000, outstanding: 18000000 });
  });

  it('counts a shipment of an order once, through the order contract', () => {
    const state = base();
    state.orders.push(order('order-1', 6000000));
    state.shipments.push(shipment('shipment-1', 6000000, '2026-10-03T00:00:00Z', { orderId: 'order-1', kind: 'order' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 6000000, debt: 6000000 });
  });

  it('nets a reversed payment out of the pool', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000));
    let paid = run(state, pay('customer-1', 10000000));
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ debt: 0, advance: 0 });
    const entry = paid.cash.find(row => row.source === 'sale' && row.customerId === 'customer-1')!;
    paid = run(paid, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ paid: 0, debt: 10000000, advance: 0 });
  });

  it('adds worker deductions to the pool and floors the pool at zero', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000));
    state.workerDeductions.push({ id: 'deduct-1', employeeId: 'employee-1', customerId: 'customer-1', amount: 4000000, direction: 'deduct', note: '', createdAt: '2026-10-04T00:00:00Z', reversalOf: null });
    expect(customerBalance(state, 'customer-1')).toMatchObject({ paid: 4000000, debt: 6000000, advance: 0 });
    const negative = base();
    negative.cash.push({ id: 'cash-1', number: null, direction: 'out', amount: 500000, account: 'cash', toAccount: null, category: 'To‘lov qaytarildi', note: '', source: 'sale', sourceId: null, customerId: 'customer-1', createdAt: '2026-10-04T00:00:00Z', reversalOf: null });
    expect(customerBalance(negative, 'customer-1')).toMatchObject({ paid: 0, debt: 0, advance: 0 });
  });

  it('exposes per-order zero for a draft so the UI cannot invent debt', () => {
    const state = base();
    state.orders.push(order('order-1', 15000000, { status: 'draft' }));
    expect(orderBalance(state, 'order-1')).toBeNull();
    expect(orderBalance(state, 'missing-order')).toBeNull();
  });
});
