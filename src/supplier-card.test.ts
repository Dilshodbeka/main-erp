import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, supplierDebt } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { supplierActions, supplierMaterials, supplierSummary, supplierYears } from './supplier-card';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function fund(state: State, amount: number): State {
  return run(state, { type: 'cash.post', direction: 'in', amount, account: 'cash', toAccount: null, category: 'Capital', note: '' });
}

function moveDate(state: State, list: { id: string; createdAt: string }[], id: string, createdAt: string): void {
  list.find(row => row.id === id)!.createdAt = createdAt;
}

function fixture() {
  let state = emptyState();
  state = run(state, { type: 'supplier.create', name: 'Yog‘och savdo', phone: '+998 90 111 22 33' });
  state = run(state, { type: 'customer.create', name: 'Mijoz', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Usta' });
  state = run(state, { type: 'operation.create', name: 'Kromkalash', unit: 'meter', salePrice: 5000, workerRate: 3000, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
  state = run(state, { type: 'operation.create', name: 'Yig‘ish', unit: 'piece', salePrice: 8000, workerRate: 4000, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true });
  state = run(state, { type: 'item.create', name: 'ABS kromka 2 mm', unit: 'm', minQty: 0, cost: 0, customerId: null });
  state = run(state, { type: 'item.create', name: 'MDF 18 mm', unit: 'list', minQty: 0, cost: 0, customerId: null });
  state = run(state, { type: 'item.create', name: 'Shkaf', unit: 'dona', minQty: 0, cost: 0, customerId: null, kind: 'finished' });

  const supplierId = state.suppliers[0].id;
  const customerId = state.customers[0].id;
  const employeeId = state.employees[0].id;
  const outsourcedOperationId = state.operations[0].id;
  const ownOperationId = state.operations[1].id;
  const tapeId = state.items[0].id;
  const mdfId = state.items[1].id;
  const finishedId = state.items[2].id;

  state = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId: mdfId, qty: 10, price: 250000 }] });
  const oldPurchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: oldPurchase.id, lines: [{ lineId: oldPurchase.lines[0].id, qty: 10 }] });
  const oldReceipt = state.movements.at(-1)!;

  state = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId: tapeId, qty: 500, price: 1200 }, { itemId: mdfId, qty: 4, price: 260000 }] });
  const newPurchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: newPurchase.id, lines: [{ lineId: newPurchase.lines[0].id, qty: 200 }] });
  const newReceipt = state.movements.at(-1)!;

  state = fund(state, 5000000);
  state = run(state, { type: 'supplier.pay', supplierId, amount: 3000000, account: 'cash', allowPrepay: true, note: 'Birinchi to‘lov', category: 'supplier' });
  const payment = state.cash.at(-1)!;

  const outsourcedInput: OrderInput = {
    kind: 'product', customerId, title: 'Oshxona fasadlari', qty: 1, price: 1200000, overhead: 0,
    dueDate: '2026-12-01', materials: [], route: [{
      operationId: outsourcedOperationId, executorKind: 'supplier', employeeId: null,
      supplierId, rate: 3000, qty: 2,
    }], advance: 0, account: 'cash',
  };
  state = run(state, { type: 'order.create', input: outsourcedInput });
  const serviceOrder = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: serviceOrder.id });
  state = run(state, { type: 'outsource.accept', taskId: serviceOrder.route[0].id });

  const ownInput: OrderInput = {
    kind: 'product', customerId, title: 'Shkaf korpusi', qty: 1, price: 900000, overhead: 0,
    dueDate: '2026-12-10', materials: [{ itemId: mdfId, qty: 2 }],
    route: [{ operationId: ownOperationId, employeeId, rate: 4000 }], advance: 0, account: 'cash',
  };
  state = run(state, { type: 'order.create', input: ownInput });
  const ownOrder = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: ownOrder.id });
  state = run(state, { type: 'order.issue', orderId: ownOrder.id });
  const issue = state.movements.at(-1)!;

  state.recipes.push({
    id: 'recipe-1', outputItemId: finishedId, name: 'Shkaf korpusi', active: true,
    versions: [{ id: 'version-1', version: 1, createdAt: '2026-01-10T09:00:00.000Z', components: [
      { id: 'component-1', slot: 'Kromka', itemId: null, allowedItemIds: [tapeId], qtyPerUnit: 3 },
    ] }],
  });

  moveDate(state, state.purchases, oldPurchase.id, '2025-06-10T09:00:00.000Z');
  moveDate(state, state.movements, oldReceipt.id, '2025-06-12T09:00:00.000Z');
  moveDate(state, state.purchases, newPurchase.id, '2026-11-02T09:00:00.000Z');
  moveDate(state, state.movements, newReceipt.id, '2026-11-03T10:00:00.000Z');
  moveDate(state, state.cash, payment.id, '2026-11-04T11:00:00.000Z');
  moveDate(state, state.orders, serviceOrder.id, '2026-10-20T09:00:00.000Z');
  moveDate(state, state.movements, issue.id, '2026-11-06T09:00:00.000Z');

  return { state, supplierId, tapeId, mdfId, paymentId: payment.id, ownOrderId: ownOrder.id, serviceOrderId: serviceOrder.id };
}

describe('supplier card actions', () => {
  it('collects purchases, receipts, payments and outsourced services with signed amounts', () => {
    const f = fixture();
    const rows = supplierActions(f.state, f.supplierId);
    expect(rows.map(row => ({ kind: row.kind, date: row.date, amount: row.amount }))).toEqual([
      { kind: 'payment', date: '2026-11-04T11:00:00.000Z', amount: -3000000 },
      { kind: 'receipt', date: '2026-11-03T10:00:00.000Z', amount: 240000 },
      { kind: 'purchase', date: '2026-11-02T09:00:00.000Z', amount: 1640000 },
      { kind: 'service', date: '2026-10-20T09:00:00.000Z', amount: 6000 },
      { kind: 'receipt', date: '2025-06-12T09:00:00.000Z', amount: 2500000 },
      { kind: 'purchase', date: '2025-06-10T09:00:00.000Z', amount: 2500000 },
    ]);
    expect(rows[2]).toMatchObject({ title: 'PUR-0002 · xarid', purchaseId: f.state.purchases[1].id });
    expect(rows[3].orderId).toBe(f.serviceOrderId);
    expect(rows[3].detail).toContain('Kromkalash');
  });

  it('prices an accepted service row by its fixed supplier sum', () => {
    const f = fixture();
    const state = structuredClone(f.state);
    state.orders.find(order => order.id === f.serviceOrderId)!.route[0].supplierCost = 9000;
    const row = supplierActions(state, f.supplierId).find(action => action.kind === 'service')!;
    expect(row.amount).toBe(9000);
  });

  it('shows a reversal next to the original payment and nets it out', () => {
    const f = fixture();
    const state = run(f.state, { type: 'cash.reverse', entryId: f.paymentId, note: 'Xato to‘lov' });
    const rows = supplierActions(state, f.supplierId).filter(row => row.kind === 'payment');
    expect(rows.map(row => row.amount)).toEqual([3000000, -3000000]);
    expect(rows[0].reversalOf).toBe(f.paymentId);
    expect(supplierSummary(state, f.supplierId).paid).toBe(0);
  });

  it('groups history into yearly statistics', () => {
    const f = fixture();
    expect(supplierYears(f.state, f.supplierId)).toEqual([
      { year: '2026', purchases: 1, orderedValue: 1640000, receivedValue: 240000, outsourced: 6000, paid: 3000000 },
      { year: '2025', purchases: 1, orderedValue: 2500000, receivedValue: 2500000, outsourced: 0, paid: 0 },
    ]);
  });

  it('summarises totals and keeps the same debt as the domain', () => {
    const f = fixture();
    const summary = supplierSummary(f.state, f.supplierId);
    expect(summary).toEqual({
      purchases: 2, orderedValue: 4140000, receivedValue: 2740000,
      outsourced: 6000, paid: 3000000, debt: supplierDebt(f.state, f.supplierId),
      lastPurchaseAt: '2026-11-02T09:00:00.000Z', lastPaidAt: '2026-11-04T11:00:00.000Z',
    });
  });
});

describe('supplier card materials', () => {
  it('aggregates received quantity, value, last price and stock per item', () => {
    const f = fixture();
    const rows = supplierMaterials(f.state, f.supplierId);
    expect(rows.map(row => ({ itemId: row.itemId, lastPrice: row.lastPrice, receivedQty: row.receivedQty, receivedValue: row.receivedValue, stock: row.stock }))).toEqual([
      { itemId: f.mdfId, lastPrice: 260000, receivedQty: 10, receivedValue: 2500000, stock: 8 },
      { itemId: f.tapeId, lastPrice: 1200, receivedQty: 200, receivedValue: 240000, stock: 200 },
    ]);
  });

  it('shows consuming orders and recipes that use the material', () => {
    const f = fixture();
    const rows = supplierMaterials(f.state, f.supplierId);
    const mdf = rows.find(row => row.itemId === f.mdfId)!;
    expect(mdf.uses).toEqual([{
      orderId: f.ownOrderId, number: expect.stringMatching(/^ORD-/), title: 'Shkaf korpusi',
      qty: 2, date: '2026-11-06T09:00:00.000Z',
    }]);
    const tape = rows.find(row => row.itemId === f.tapeId)!;
    expect(tape.uses).toEqual([]);
    expect(tape.recipes).toEqual([{ recipeId: 'recipe-1', name: 'Shkaf korpusi', output: 'Shkaf' }]);
  });

  it('ignores materials supplied by other suppliers', () => {
    const f = fixture();
    let state = run(f.state, { type: 'supplier.create', name: 'Boshqa', phone: '' });
    const otherId = state.suppliers.at(-1)!.id;
    state = run(state, { type: 'item.create', name: 'Lak', unit: 'l', minQty: 0, cost: 0, customerId: null });
    const paintId = state.items.at(-1)!.id;
    state = run(state, { type: 'purchase.create', supplierId: otherId, lines: [{ itemId: paintId, qty: 5, price: 90000 }] });
    const purchase = state.purchases.at(-1)!;
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 5 }] });
    expect(supplierMaterials(state, f.supplierId).some(row => row.itemId === paintId)).toBe(false);
    expect(supplierMaterials(state, otherId).map(row => row.itemId)).toEqual([paintId]);
    expect(supplierActions(state, otherId).map(row => row.kind).sort()).toEqual(['purchase', 'receipt']);
  });
});
