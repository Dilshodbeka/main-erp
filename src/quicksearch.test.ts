import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { quickMatches } from './quicksearch';
import type { Customer, Order, State } from './types';

function order(id: string, number: string, customerId: string, title: string, price: number): Order {
  return {
    id, number, kind: 'product', customerId, title,
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 1, price, overhead: 0, dueDate: '2026-11-10', createdAt: '2026-10-01T09:00:00.000Z',
    status: 'production',
    lines: [{ id: `${id}-line`, kind: 'product', title, qty: 1, total: price, status: 'production' }],
    materials: [], route: [],
  };
}

function state(): State {
  const base = emptyState();
  const customers: Customer[] = [
    { id: 'c1', name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: '', kind: 'customer', employeeId: null },
    { id: 's1', name: '«Mo‘ljal» saloni', phone: '+998 71 200 30 40', address: '', kind: 'shop', employeeId: null },
    { id: 'v1', name: 'Kesish xizmati', phone: '+998 91 999 88 77', address: '', kind: 'service', employeeId: null },
  ];
  return {
    ...base,
    customers,
    orders: [
      order('o1', 'ORD-0001', 'c1', 'Oshxona', 5_000_000),
      order('o2', 'ORD-0002', 's1', 'Fasadlarni bo‘yash', 2_000_000),
    ],
  };
}

describe('quickMatches', () => {
  it('returns nothing for an empty query', () => {
    expect(quickMatches(state(), '   ')).toEqual({ customers: [], orders: [] });
  });

  it('finds a client by the last digits of the phone and shows their orders too', () => {
    const result = quickMatches(state(), '4567');
    expect(result.customers.map(row => [row.id, row.title, row.meta])).toEqual([
      ['c1', 'Aziza Karimova', '+998 90 123 45 67 · Mijoz'],
    ]);
    expect(result.orders.map(row => row.id)).toEqual(['o1']);
  });

  it('finds an order by number and includes the customer name', () => {
    const result = quickMatches(state(), 'ord-0002');
    expect(result.orders.map(row => [row.id, row.meta, row.status])).toEqual([
      ['o2', '«Mo‘ljal» saloni', 'production'],
    ]);
  });

  it('shows the outstanding amount and the customer kind', () => {
    const result = quickMatches(state(), 'aziza');
    expect(result.customers[0]).toMatchObject({ customerKind: 'customer' });
    expect(result.orders[0]).toMatchObject({ debt: 5_000_000 });
  });

  it('limits each group independently', () => {
    const result = quickMatches(state(), 'o', 1);
    expect(result.customers).toHaveLength(1);
    expect(result.orders).toHaveLength(1);
  });
});
