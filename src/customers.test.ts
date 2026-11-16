import { describe, expect, it } from 'vitest';
import { customerKindLabel, groupCustomers } from './customers';
import type { Customer } from './types';

const rows: Customer[] = [
  { id: 's1', name: '«Mo‘ljal» saloni', phone: '+998 71 200 30 40', address: '', kind: 'shop', employeeId: null },
  { id: 'c1', name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: '', kind: 'customer', employeeId: null },
  { id: 'v1', name: 'Kesish ustasi', phone: '+998 91 555 12 12', address: '', kind: 'service', employeeId: null },
];

describe('customer kinds', () => {
  it('labels each kind in Uzbek', () => {
    expect(customerKindLabel('shop')).toBe('Do‘kon');
    expect(customerKindLabel('customer')).toBe('Mijoz');
    expect(customerKindLabel('service')).toBe('Xizmat buyurtmachisi');
  });

  it('groups shops, clients and service customers in that order', () => {
    expect(groupCustomers(rows).map(group => [group.kind, group.rows.map(row => row.name)]))
      .toEqual([
        ['shop', ['«Mo‘ljal» saloni']],
        ['customer', ['Aziza Karimova']],
        ['service', ['Kesish ustasi']],
      ]);
  });

  it('filters by name and by the last digits of a phone', () => {
    expect(groupCustomers(rows, 'aziza').flatMap(group => group.rows.map(row => row.id))).toEqual(['c1']);
    expect(groupCustomers(rows, '4567').flatMap(group => group.rows.map(row => row.id))).toEqual(['c1']);
    expect(groupCustomers(rows, '55 12').flatMap(group => group.rows.map(row => row.id))).toEqual(['v1']);
    expect(groupCustomers(rows, 'nothing')).toEqual([]);
  });
});
