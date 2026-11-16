import { matchesSearch } from './listview';
import type { Customer, CustomerKind } from './types';

const labels: Record<CustomerKind, string> = {
  shop: 'Do‘kon',
  customer: 'Mijoz',
  service: 'Xizmat buyurtmachisi',
};

const plurals: Record<CustomerKind, string> = {
  shop: 'Do‘konlar',
  customer: 'Mijozlar',
  service: 'Xizmat buyurtmachilari',
};

export const customerKindOrder: CustomerKind[] = ['shop', 'customer', 'service'];

export interface CustomerDraft {
  name: string;
  phone: string;
  address: string;
  kind: CustomerKind;
}

export function customerKindLabel(kind: CustomerKind): string {
  return labels[kind];
}

export function customerKindPlural(kind: CustomerKind): string {
  return plurals[kind];
}

export interface CustomerGroup {
  kind: CustomerKind;
  title: string;
  rows: Customer[];
}

export function groupCustomers(customers: Customer[], query = ''): CustomerGroup[] {
  return customerKindOrder
    .map(kind => ({
      kind,
      title: plurals[kind],
      rows: customers
        .filter(customer => customer.kind === kind && matchesSearch(query, [customer.name, customer.address], customer.phone))
        .sort((left, right) => left.name.localeCompare(right.name, 'uz')),
    }))
    .filter(group => group.rows.length > 0);
}
