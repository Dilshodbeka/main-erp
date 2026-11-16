import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { SupplierCard } from './components/SupplierCard';
import { DEMO_COMPANY_ID } from './migrations';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

function cardState() {
  let state = emptyState();
  state = run(state, { type: 'supplier.create', name: 'Yog‘och savdo', phone: '+998 90 111 22 33' });
  state = run(state, { type: 'customer.create', name: 'Mijoz', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'operation.create', name: 'Kromkalash', unit: 'meter', salePrice: 5000, workerRate: 3000, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
  state = run(state, { type: 'item.create', name: 'MDF 18 mm', unit: 'list', minQty: 0, cost: 0, customerId: null });
  const supplierId = state.suppliers[0].id;
  const itemId = state.items[0].id;
  const operationId = state.operations[0].id;
  state = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId, qty: 4, price: 250000 }] });
  const purchase = state.purchases[0];
  state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 4 }] });
  state = run(state, { type: 'cash.post', direction: 'in', amount: 3000000, account: 'cash', toAccount: null, category: 'Capital', note: '' });
  state = run(state, { type: 'supplier.pay', supplierId, amount: 400000, account: 'cash', note: 'Qisman to‘lov', category: 'supplier' });
  const input: OrderInput = {
    kind: 'service', customerId: state.customers[0].id, title: 'Kromkalash xizmati', qty: 1, price: 200000, overhead: 0,
    dueDate: '2026-12-01', materials: [], route: [{ operationId, executorKind: 'supplier', employeeId: null, supplierId, rate: 3000, qty: 2 }],
    advance: 0, account: 'cash',
  };
  state = run(state, { type: 'order.create', input });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  return { state, supplierId, purchaseNumber: purchase.number, orderNumber: order.number };
}

function render(state: State, supplierId: string): string {
  return renderToStaticMarkup(createElement(SupplierCard, {
    state, supplierId, onOpenOrder: () => {}, onPay: () => {},
  }));
}

describe('supplier card UI', () => {
  it('renders totals, yearly statistics, history and materials', () => {
    const f = cardState();
    const html = render(f.state, f.supplierId);
    expect(html).toContain('+998 90 111 22 33');
    expect(html).toContain('Yillik statistika');
    expect(html).toContain('Hamkorlik tarixi');
    expect(html).toContain('Yetkazib berilgan materiallar');
    expect(html).toContain(f.purchaseNumber);
    expect(html).toContain('MDF 18 mm');
    expect(html).toContain('Autsors xizmati');
    expect(html).toContain(f.orderNumber);
    expect(html).toContain('Barcha harakatlar');
    expect(html).toContain('Barcha yillar');
    expect(html).toContain('MDF 18 mm qayerda ishlatilgan');
    expect(html).toContain('To‘lov · Naqd pul');
  });

  it('shows empty states for a supplier without actions', () => {
    let state = emptyState();
    state = run(state, { type: 'supplier.create', name: 'Yangi hamkor', phone: '' });
    const html = render(state, state.suppliers[0].id);
    expect(html).toContain('Telefon ko‘rsatilmagan');
    expect(html).toContain('Hali statistika uchun harakat yo‘q');
    expect(html).toContain('Bu davrda harakatlar yo‘q');
    expect(html).toContain('Bu yetkazib beruvchida materiallar yo‘q');
  });
});
