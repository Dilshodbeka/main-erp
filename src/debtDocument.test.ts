import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { debtDocument, debtFileName } from './debtDocument';
import type { Actor, Command, Order, State } from './types';

const admin: Actor = { id: 'admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const company = { name: 'Mebel Aliya', phone: '+998 90 123 45 67' };
const today = new Date(2026, 10, 20, 10, 0);

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

function order(id: string, price: number, createdAt: string, overrides: Partial<Order> = {}): Order {
  return {
    id, number: id, kind: 'product', customerId: 'customer-1', title: 'Oshxona',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 1, price, overhead: 0, dueDate: '2026-12-01', createdAt, status: 'delivered',
    lines: [{ id: `${id}-line`, kind: 'product', title: 'Oshxona', qty: 1, total: price, status: 'delivered' }],
    materials: [], route: [],
    ...overrides,
  };
}

function base(): State {
  const state = emptyState();
  state.customers.push({ id: 'customer-1', name: 'Aziza Karimova', phone: '', address: '', kind: 'customer', employeeId: null });
  return state;
}

describe('debtDocument', () => {
  it('lists every agreed obligation with what was paid and what remains', () => {
    const state = base();
    state.orders.push(order('ORD-0001', 30000000, '2026-10-01T00:00:00Z'));
    state.orders.push(order('ORD-0002', 20000000, '2026-10-05T00:00:00Z'));
    const paid = run(state, { type: 'customer.pay', customerId: 'customer-1', amount: 9200000, account: 'cash' });
    const model = debtDocument(paid, 'customer-1', company, today)!;
    expect(model.customer).toBe('Aziza Karimova');
    expect(model.rows.map(row => row.label)).toEqual(['ORD-0001 · Oshxona', 'ORD-0002 · Oshxona']);
    expect(model.rows[0]).toMatchObject({ createdAt: '2026-10-01T00:00:00Z', total: 30000000, paid: 9200000, outstanding: 20800000 });
    expect(model.rows[1]).toMatchObject({ total: 20000000, paid: 0, outstanding: 20000000 });
    expect(model).toMatchObject({ contract: 50000000, paid: 9200000, debt: 40800000 });
  });

  it('dates the statement with the day it is built, not the oldest order', () => {
    const state = base();
    state.orders.push(order('ORD-0001', 30000000, '2026-10-01T00:00:00Z'));
    expect(debtDocument(state, 'customer-1', company, today)!.date).toBe('2026-11-20');
  });

  it('refuses to build a statement for a customer with nothing agreed', () => {
    const state = base();
    expect(debtDocument(state, 'customer-1', company, today)).toBeNull();
    state.orders.push(order('ORD-0001', 30000000, '2026-10-01T00:00:00Z', { status: 'draft' }));
    expect(debtDocument(state, 'customer-1', company, today)).toBeNull();
  });
});

describe('debtFileName', () => {
  it('names the file after the customer family name', () => {
    expect(debtFileName('Aziza Karimova')).toBe('Qarz-haqida-Karimova.png');
  });

  it('keeps Uzbek letters the customer would recognise', () => {
    expect(debtFileName('Aziza O‘g‘iloy')).toBe('Qarz-haqida-Ogiloy.png');
  });

  it('falls back to a neutral name when the customer has no name', () => {
    expect(debtFileName('   ')).toBe('Qarz-haqida-Mijoz.png');
  });
});
