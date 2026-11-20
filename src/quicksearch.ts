import { customerKindLabel } from './customers';
import { matchesSearch } from './listview';
import { customerBalance, orderBalance } from './receivables';
import type { CustomerKind, State, Status } from './types';

export interface QuickCustomer {
  kind: 'customer';
  id: string;
  title: string;
  meta: string;
  debt: number;
  customerKind: CustomerKind;
}

export interface QuickOrder {
  kind: 'order';
  id: string;
  title: string;
  meta: string;
  debt: number;
  status: Status;
}

export type QuickMatch = QuickCustomer | QuickOrder;

export interface QuickSearchResult {
  customers: QuickCustomer[];
  orders: QuickOrder[];
}

export function quickMatches(state: State, query: string, limit = 4): QuickSearchResult {
  if (!query.trim()) return { customers: [], orders: [] };
  const name = (id: string) => state.customers.find(customer => customer.id === id)?.name || 'Mijoz';
  const phone = (id: string) => state.customers.find(customer => customer.id === id)?.phone || '';
  const customers = state.customers
    .filter(customer => matchesSearch(query, [customer.name, customer.address], customer.phone))
    .sort((left, right) => left.name.localeCompare(right.name, 'uz'))
    .slice(0, limit)
    .map((customer): QuickCustomer => ({
      kind: 'customer', id: customer.id, title: customer.name,
      meta: [customer.phone, customerKindLabel(customer.kind)].filter(Boolean).join(' · '),
      debt: customerBalance(state, customer.id).debt,
      customerKind: customer.kind,
    }));
  const orders = state.orders
    .filter(order => matchesSearch(query, [order.number, order.title, name(order.customerId)], phone(order.customerId)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.number.localeCompare(right.number))
    .slice(0, limit)
    .map((order): QuickOrder => ({
      kind: 'order', id: order.id, title: `${order.number} · ${order.title}`,
      meta: name(order.customerId), status: order.status,
      debt: orderBalance(state, order.id)?.outstanding ?? 0,
    }));
  return { customers, orders };
}
