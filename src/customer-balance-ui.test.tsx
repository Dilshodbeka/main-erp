import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { CustomerCard } from './components/CustomerCard';
import { CustomerLedger } from './components/CustomerLedger';
import { customerBalance } from './receivables';
import type { Actor, Customer, State } from './types';

const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: emptyState().companyId };
const ledgerSource = readFileSync(new URL('./components/CustomerLedger.tsx', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('./components/CustomerCard.tsx', import.meta.url), 'utf8');

// `money()` форматирует разряды через U+00A0, а не обычный пробел — подстроки сравниваем после нормализации.
const spaced = (value: string): string => value.replace(/\u00a0/g, ' ');

function shopState(withDebt: boolean): State {
  const state = emptyState();
  const customer: Customer = { id: 'shop-1', name: 'Chorzu', phone: '', address: '', kind: 'shop', employeeId: null };
  state.customers.push(customer);
  if (withDebt) {
    state.orders.push({
      id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'shop-1', title: 'Kreslo',
      outputItemId: null, recipeVersionId: null, substitutions: {},
      qty: 1, price: 30000000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
      lines: [{ id: 'line-1', kind: 'product', title: 'Kreslo', qty: 1, total: 30000000, status: 'delivered' }],
      materials: [], route: [],
    });
    return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'customer.pay', customerId: 'shop-1', amount: 9200000, account: 'cash' } }, admin);
  }
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'customer.pay', customerId: 'shop-1', amount: 1000000, account: 'cash' } }, admin);
}

function panel(state: State) {
  const customer = state.customers.find(row => row.id === 'shop-1')!;
  return renderToStaticMarkup(createElement(CustomerLedger, {
    customer, ledger: customerBalance(state, 'shop-1'), busy: false, run: async () => true,
  }));
}

function draftState(): State {
  const state = emptyState();
  state.customers.push({ id: 'shop-1', name: 'Chorzu', phone: '', address: '', kind: 'shop', employeeId: null });
  return applyCommand(state, {
    requestId: crypto.randomUUID(), expectedRevision: state.revision,
    command: { type: 'order.create', input: { kind: 'product' as const, customerId: 'shop-1', title: 'Kreslo', qty: 1, price: 7000000, overhead: 0, dueDate: '2026-12-05', advance: 0, account: 'cash' as const, materials: [], route: [] } },
  }, admin);
}

function card(state: State) {
  return renderToStaticMarkup(createElement(CustomerCard, { state, customerId: 'shop-1', onOpenOrder: () => {} }));
}

describe('customer balance panels', () => {
  it('shows the agreed contract instead of shipped goods', () => {
    expect(panel(shopState(true))).toContain('Shartnoma');
    expect(ledgerSource).not.toContain('Yuborilgan');
  });

  it('lists obligations with their own outstanding amount', () => {
    const html = spaced(panel(shopState(true)));
    expect(html).toContain('ORD-0001 · Kreslo');
    expect(html).toContain('30 000 000');
    expect(html).toContain('20 800 000');
  });

  it('never prints a zero advance next to a live debt', () => {
    const html = panel(shopState(true));
    expect(html).not.toMatch(/>0 so‘m</);
    expect(html).toContain('<small>Avans</small><b>—</b>');
  });

  it('prints a dash where the balance is settled', () => {
    const html = panel(shopState(false));
    expect(html).toContain('<small>Qarz</small><b>—</b>');
    expect(html).not.toMatch(/>0 so‘m</);
  });

  it('keeps the card and the panel on the same four numbers', () => {
    for (const label of ['Shartnoma', 'To‘langan', 'Qarz', 'Avans']) {
      expect(cardSource).toContain(label);
    }
    expect(cardSource).toContain('detail.balance.contract');
    expect(cardSource).toContain('detail.balance.advance');
  });

  it('explains that a payment closes the oldest debt first', () => {
    expect(ledgerSource).toContain('eng eski');
  });

  it('prints dashes in the order row of an agreed-free draft', () => {
    const html = spaced(card(draftState()));
    expect(html).toContain('data-label="Qarz" class="right">—');
    expect(html).toContain('data-label="To‘langan" class="right">—');
  });
});
