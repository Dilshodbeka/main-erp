import { describe, expect, it } from 'vitest';
import { applyCommand, cashBalance, emptyState } from './domain';
import { customerLedger, orderLedger } from './receivables';
import type { Actor, Command, Order, Shipment, State } from './types';

const admin: Actor = { id: 'admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const worker: Actor = { id: 'worker', name: 'Worker', role: 'worker', companyId: emptyState().companyId };

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

function fixtureWithShipments(totals: number[]): State {
  const state = emptyState();
  state.customers.push({ id: 'customer-1', name: 'Магазин', phone: '', address: '', kind: 'shop', employeeId: null });
  totals.forEach((total, index) => {
    state.shipments.push(shipment(`shipment-${index + 1}`, total, `2026-10-0${index + 1}T00:00:00Z`));
  });
  return state;
}

function order(id: string, price: number): Order {
  return {
    id, number: id, kind: 'product', customerId: 'customer-1', title: 'Кухня',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 1, price, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
    lines: [{ id: `${id}-line`, kind: 'product', title: 'Кухня', qty: 1, total: price, status: 'delivered' }],
    materials: [], route: [],
  };
}

describe('customer ledger', () => {
  it('applies payments FIFO and keeps overpayment as advance', () => {
    const state = fixtureWithShipments([100000, 80000]);
    const paid = run(state, pay('customer-1', 150000));
    const ledger = customerLedger(paid, 'customer-1');
    expect(ledger.shipments.map(row => row.outstanding)).toEqual([0, 30000]);
    expect(ledger.debt).toBe(30000);
    expect(ledger.advance).toBe(0);
    const advanced = run(paid, pay('customer-1', 50000));
    expect(customerLedger(advanced, 'customer-1')).toMatchObject({ debt: 0, advance: 20000, paid: 200000 });
  });

  it('uses an existing advance for a new shipment before creating debt', () => {
    let state = fixtureWithShipments([]);
    state = run(state, pay('customer-1', 150000));
    expect(customerLedger(state, 'customer-1')).toMatchObject({ shipped: 0, advance: 150000, debt: 0 });
    state.shipments.push(shipment('later', 100000, '2026-10-09T00:00:00Z'));
    expect(customerLedger(state, 'customer-1')).toMatchObject({ debt: 0, advance: 50000 });
  });

  it('reopens the oldest remaining debt when a payment is reversed', () => {
    let state = fixtureWithShipments([100000, 80000]);
    state = run(state, pay('customer-1', 100000));
    state = run(state, pay('customer-1', 80000));
    expect(customerLedger(state, 'customer-1').debt).toBe(0);
    state = run(state, { type: 'cash.reverse', entryId: state.cash[1].id, note: 'Ошибка кассира' });
    const ledger = customerLedger(state, 'customer-1');
    expect(ledger.shipments.map(row => row.outstanding)).toEqual([0, 80000]);
    expect(ledger).toMatchObject({ debt: 80000, advance: 0, paid: 100000 });
  });

  it('excludes a reversed shipment from the ledger and turns its payment into advance', () => {
    let state = fixtureWithShipments([100000, 80000]);
    state = run(state, pay('customer-1', 150000));
    state.shipments[0].status = 'cancelled';
    const ledger = customerLedger(state, 'customer-1');
    expect(ledger.shipments).toHaveLength(1);
    expect(ledger).toMatchObject({ shipped: 80000, debt: 0, advance: 70000 });
  });

  it('orders equal timestamps by shipment id deterministically', () => {
    const state = emptyState();
    state.customers.push({ id: 'customer-1', name: 'Магазин', phone: '', address: '', kind: 'shop', employeeId: null });
    state.shipments.push(
      shipment('b', 20, '2026-10-01T00:00:00Z'),
      shipment('a', 10, '2026-10-01T00:00:00Z'),
    );
    state.cash.push({ id: 'payment', direction: 'in', amount: 15, account: 'cash', toAccount: null, source: 'sale', sourceId: 'customer-1', customerId: 'customer-1', category: 'sale', note: '', number: null, reversalOf: null, createdAt: '2026-10-02T00:00:00Z' });
    const ledger = customerLedger(state, 'customer-1');
    expect(ledger.shipments.map(row => row.shipmentId)).toEqual(['a', 'b']);
    expect(ledger.shipments.map(row => row.paid)).toEqual([10, 5]);
  });

  it('keeps cash balances independent from customer debt', () => {
    let state = fixtureWithShipments([100000]);
    state = run(state, pay('customer-1', 150000));
    expect(cashBalance(state, 'cash')).toBe(150000);
    expect(customerLedger(state, 'customer-1')).toMatchObject({ paid: 150000, debt: 0, advance: 50000 });
  });

  it('rejects unknown customers, invalid amounts and worker payments', () => {
    const state = fixtureWithShipments([]);
    expect(() => run(state, pay('missing', 1))).toThrow('Customer not found');
    expect(() => run(state, pay('customer-1', 0))).toThrow('Invalid amount');
    expect(() => run(state, pay('customer-1', 1), worker)).toThrow('Administrator action required');
    expect(state.cash).toHaveLength(0);
  });
});

describe('worker deductions in the customer ledger', () => {
  it('counts a deduction as a payment that closes debt FIFO', () => {
    const state = fixtureWithShipments([100000, 80000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push({
      id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 150000,
      direction: 'deduct', note: 'Material uchun', reversalOf: null, createdAt: '2026-10-15T00:00:00Z',
    });
    const ledger = customerLedger(state, 'customer-1');
    expect(ledger.shipments.map(row => row.outstanding)).toEqual([0, 30000]);
    expect(ledger.debt).toBe(30000);
    expect(ledger.paid).toBe(150000);
  });

  it('reversing a deduction restores the debt', () => {
    const state = fixtureWithShipments([100000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push(
      { id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 60000, direction: 'deduct', note: '', reversalOf: null, createdAt: '2026-10-15T00:00:00Z' },
      { id: 'ref-1', employeeId: 'e1', customerId: 'customer-1', amount: 60000, direction: 'refund', note: '', reversalOf: 'ded-1', createdAt: '2026-10-16T00:00:00Z' },
    );
    expect(customerLedger(state, 'customer-1').debt).toBe(100000);
  });

  it('a deduction beyond the debt lands in advance', () => {
    const state = fixtureWithShipments([50000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push({
      id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 70000,
      direction: 'deduct', note: '', reversalOf: null, createdAt: '2026-10-15T00:00:00Z',
    });
    expect(customerLedger(state, 'customer-1')).toMatchObject({ debt: 0, advance: 20000 });
  });
});

describe('order ledger', () => {
  it('settles shipments FIFO and earmarks free advance up to the order price', () => {
    let state = fixtureWithShipments([]);
    state.orders.push(order('order-1', 1000));
    state.shipments.push(shipment('order-ship', 400, '2026-10-05T00:00:00Z', { orderId: 'order-1', kind: 'order' }));
    state = run(state, pay('customer-1', 100));
    expect(orderLedger(state, 'order-1')).toMatchObject({ total: 1000, paid: 100, outstanding: 900 });
    state = run(state, pay('customer-1', 900));
    expect(orderLedger(state, 'order-1')).toMatchObject({ paid: 1000, outstanding: 0 });
  });

  it('counts a prepayment as paid before the order ships', () => {
    let state = fixtureWithShipments([]);
    state.orders.push(order('order-1', 1000));
    state = run(state, pay('customer-1', 250));
    expect(orderLedger(state, 'order-1')).toMatchObject({ total: 1000, paid: 250, outstanding: 750 });
  });

  it('does not create a negative debt for overpaid orders', () => {
    let state = fixtureWithShipments([]);
    state.orders.push(order('order-1', 1000));
    state = run(state, pay('customer-1', 1500));
    expect(orderLedger(state, 'order-1')).toMatchObject({ paid: 1000, outstanding: 0 });
  });
});
