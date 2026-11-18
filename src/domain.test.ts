import { describe, expect, it } from 'vitest';
import {
  acceptedOutsourceCost, actualCost, actualSeriesCost, applyCommand, areaLaborCost, areaMaterialCost, availableTask,
  cashBalance, defectMaterials, emptyState, estimatedCost, normMaterialLines, orderPaid, payrollDebt, reservedQty, shippedQty, stockQty,
  supplierDebt, supplierStageActual, supplierStagePlan, supplierStagePriced, taskState,
} from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { customerLedger } from './receivables';
import { expenseLedger } from './expenses';
import { loanLedger } from './loans';
import { salaryLedger } from './salary';
import { createDemo } from './seed';
import type { Actor, Command, Envelope, OrderInput, State, SupportTicket } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function atomic(state: State, command: Command, actor = admin): void {
  const before = structuredClone(state);
  expect(() => run(state, command, actor)).toThrow();
  expect(state).toEqual(before);
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

function fixture() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'First customer', phone: '123', address: 'Warehouse', kind: 'customer' });
  state = run(state, { type: 'customer.create', name: 'Second customer', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Cutter' });
  state = run(state, { type: 'employee.create', name: 'Assembler' });
  state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 2, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: false });
  state = run(state, { type: 'operation.create', name: 'Assemble', unit: 'piece', salePrice: 3, workerRate: 3, standardMinutes: 0, machineId: null, employeeIds: [state.employees[1].id], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'Fabric', unit: 'm', minQty: 0, cost: 5, customerId: null });
  state = run(state, { type: 'item.create', name: 'Thread', unit: 'm', minQty: 0, cost: 1, customerId: null });
  const customerId = state.customers[0].id;
  const otherCustomerId = state.customers[1].id;
  const supplierId = state.suppliers[0].id;
  const employeeId = state.employees[0].id;
  const otherEmployeeId = state.employees[1].id;
  const operationId = state.operations[0].id;
  const otherOperationId = state.operations[1].id;
  const itemId = state.items[0].id;
  const otherItemId = state.items[1].id;
  const worker: Actor = { id: employeeId, name: 'Cutter', role: 'worker', companyId: state.companyId };
  const otherWorker: Actor = { id: otherEmployeeId, name: 'Assembler', role: 'worker', companyId: state.companyId };
  const input = {
    kind: 'product', customerId, title: 'Uniforms', qty: 10, price: 1000, overhead: 20,
    dueDate: '2026-11-05', materials: [{ itemId, qty: 10 }],
    route: [{ operationId, employeeId, rate: 2 }, { operationId: otherOperationId, employeeId: otherEmployeeId, rate: 3 }],
    advance: 0, account: 'cash',
  } satisfies OrderInput;
  return {
    state, customerId, otherCustomerId, supplierId, employeeId, otherEmployeeId,
    operationId, otherOperationId, itemId, otherItemId, worker, otherWorker, input,
  };
}

function receive(state: State, supplierId: string, itemId: string, qty: number, price: number): State {
  state = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId, qty, price }] });
  const purchase = state.purchases.at(-1)!;
  return run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty }] });
}

function receivePurchase(state: State, itemId: string, qty: number, price: number): State {
  let next = state.suppliers.length > 0 ? state : run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
  next = run(next, { type: 'purchase.create', supplierId: next.suppliers[0].id, lines: [{ itemId, qty, price }] });
  const purchase = next.purchases.at(-1)!;
  return run(next, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty }] });
}

function production(overrides: Partial<OrderInput> = {}) {
  const f = fixture();
  let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
  state = run(state, { type: 'order.create', input: { ...f.input, ...overrides } });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return { ...f, state, orderId, taskId: state.orders[0].route[0]?.id };
}

describe('permissions gate', () => {
  it('worker without rights still does own work', () => {
    const p = production();
    const s = run(p.state, { type: 'work.accept', orderId: p.orderId, taskId: p.taskId }, p.worker);
    expect(s.orders[0].route[0].status).toBe('accepted');
  });
  it('worker without rights cannot create customer', () => {
    const s = fixture().state;
    atomic(s, { type: 'customer.create', name: 'X', phone: '', address: '', kind: 'customer' },
      { id: s.employees[0].id, name: 'Sotuvchi', role: 'worker', companyId: s.companyId, permissions: [] });
  });
  it('seller with orders.create creates customer and auto-claims it', () => {
    const s = fixture().state;
    const seller = { id: s.employees[0].id, name: 'Sotuvchi', role: 'worker' as const, companyId: s.companyId, permissions: ['orders.create', 'customers.claim'] };
    const next = run(s, { type: 'customer.create', name: 'X', phone: '', address: '', kind: 'customer' }, seller);
    expect(next.customers.at(-1)!.sellerId).toBe(s.employees[0].id);
  });
  it('seller edits own order, not others', () => {
    const f = fixture();
    const seller = { id: f.employeeId, name: 'Sotuvchi', role: 'worker' as const, companyId: f.state.companyId, permissions: ['orders.create', 'orders.edit_own', 'customers.claim'] };
    let s = run(f.state, { type: 'customer.create', name: 'Mine', phone: '', address: '', kind: 'customer' }, seller);
    const mine = s.customers.at(-1)!;
    const input: OrderInput = {
      kind: 'product', customerId: mine.id, title: 'A', qty: 1, price: 10, overhead: 0,
      dueDate: '2026-12-01', advance: 0, account: 'cash',
      materials: [{ itemId: f.itemId, qty: 1 }],
      route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }],
    };
    s = run(s, { type: 'order.create', input }, seller);
    const order = s.orders.at(-1)!;
    expect(mine.sellerId).toBe(f.employeeId);
    run(s, { type: 'order.update', orderId: order.id, title: 'A2', qty: 1, price: 10, overhead: 0, dueDate: '2026-12-02', materials: [{ itemId: f.itemId, qty: 1 }], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] }, seller);
    const other = { id: f.otherEmployeeId, name: 'Other', role: 'worker' as const, companyId: s.companyId, permissions: ['orders.edit_own'] };
    atomic(s, { type: 'order.update', orderId: order.id, title: 'X', qty: 1, price: 10, overhead: 0, dueDate: '2026-12-02' }, other);
  });
  it('customer.claim only when unassigned and has right', () => {
    const f = fixture();
    const seller = { id: f.employeeId, name: 'S', role: 'worker' as const, companyId: f.state.companyId, permissions: ['customers.claim'] };
    let s = f.state;
    const c = s.customers[0];
    s = run(s, { type: 'customer.claim', customerId: c.id }, seller);
    expect(s.customers.find(x => x.id === c.id)!.sellerId).toBe(f.employeeId);
    atomic(s, { type: 'customer.claim', customerId: c.id }, seller); // already assigned
  });
  it('customer.assign requires right', () => {
    const f = fixture();
    const sellerNoRight = { id: f.employeeId, name: 'S', role: 'worker' as const, companyId: f.state.companyId, permissions: [] };
    atomic(f.state, { type: 'customer.assign', customerId: f.state.customers[0].id, sellerId: f.employeeId }, sellerNoRight);
    const seller = { id: f.employeeId, name: 'S', role: 'worker' as const, companyId: f.state.companyId, permissions: ['customers.assign'] };
    const next = run(f.state, { type: 'customer.assign', customerId: f.state.customers[0].id, sellerId: f.employeeId }, seller);
    expect(next.customers[0].sellerId).toBe(f.employeeId);
  });
});

function composite() {
  const f = fixture();
  let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
  state = receive(state, f.supplierId, f.otherItemId, 10, 1);
  state = run(state, { type: 'order.create', input: {
    kind: 'composite', customerId: f.customerId, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
    lines: [
      { kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000, materials: [{ itemId: f.itemId, qty: 3 }], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] },
      { kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100, materials: [{ itemId: f.otherItemId, qty: 1 }], route: [{ operationId: f.otherOperationId, employeeId: f.otherEmployeeId, rate: 3 }] },
    ],
  } });
  return { ...f, state, orderId: state.orders[0].id };
}

function report(state: State, orderId: string, taskId: string, qty: number, accept = true, actor = admin): State {
  state = startWork(state, orderId, taskId, actor);
  state = run(state, { type: 'work.submit', orderId, taskId, qty, note: '' }, actor);
  return run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept });
}

function startWork(state: State, orderId: string, taskId: string, actor = admin): State {
  if (taskState(state, orderId, taskId) === 'assigned') state = run(state, { type: 'work.accept', orderId, taskId }, actor);
  if (taskState(state, orderId, taskId) === 'accepted') state = run(state, { type: 'work.start', orderId, taskId }, actor);
  return state;
}

function launchedOrder(): State {
  // Legacy operations that still wait for a manual decision; the app now always auto-accepts.
  const state = createDemo(admin);
  for (const operation of state.operations) operation.autoAccept = false;
  state.salaryPlans = [];
  state.cash = state.cash.filter(row => row.source !== 'payroll');
  return state;
}

function ownTask(state: State) {
  const order = state.orders.find(o => o.status === 'production' && o.route.length > 0)!;
  const task = order.route[0];
  const worker: Actor = { id: task.employeeId!, name: 'Worker', role: 'worker', companyId: state.companyId };
  return { order, task, worker };
}

function funds(state: State, amount: number, account: 'cash' | 'bank' = 'cash'): State {
  return run(state, { type: 'cash.post', direction: 'in', amount, account, toAccount: null, category: 'Capital', note: '' });
}

function acceptedPayroll(state: State, employeeId?: string): number {
  return state.payroll
    .filter(row => row.status === 'accepted' && (!employeeId || row.employeeId === employeeId))
    .reduce((sum, row) => sum + row.amount, 0);
}

const outsourcedRoute = (operationId: string, supplierId: string) => [{
  operationId, executorKind: 'supplier' as const, employeeId: null, supplierId, rate: 250000, qty: 2,
}];

function ship(orderId: string, qty: number, allowDebt = false): Command {
  return { type: 'shipment.create', orderId, qty, allowDebt, address: 'Warehouse', dueDate: '2026-11-05' };
}

describe('outsourced stages in orders', () => {
  it('creates an outsourced stage without an employee or stock activity', () => {
    const f = fixture();
    const state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000, qty: 2,
    }] } });
    const task = state.orders.at(-1)!.route[0];
    expect(task).toMatchObject({
      executorKind: 'supplier', employeeId: null, supplierId: f.supplierId,
      planned: 2, completed: 0, status: 'assigned', rate: 30000,
    });
    expect(state.movements).toEqual(f.state.movements);
    expect(state.payroll).toEqual([]);
  });

  it('rejects missing, double and unknown executors atomically', () => {
    const f = fixture();
    const base = { operationId: f.operationId, rate: 30000 };
    atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
      { ...base, executorKind: 'supplier', employeeId: null, supplierId: null },
    ] } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
      { ...base, executorKind: 'employee', employeeId: f.employeeId, supplierId: f.supplierId },
    ] } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
      { ...base, executorKind: 'supplier', employeeId: null, supplierId: crypto.randomUUID() },
    ] } });
  });

  it('keeps legacy employee route commands authorized by the operation', () => {
    const f = fixture();
    const result = run(f.state, { type: 'order.create', input: f.input });
    expect(result.orders.at(-1)!.route[0]).toMatchObject({
      executorKind: 'employee', employeeId: f.employeeId, supplierId: null,
    });
  });

  it('launches an order whose only stage is outsourced', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000,
    }] } });
    const orderId = state.orders.at(-1)!.id;
    state = run(state, { type: 'order.launch', orderId });
    expect(state.orders.at(-1)!.status).toBe('production');
    expect(state.orders.at(-1)!.route[0]).toMatchObject({ status: 'assigned', completed: 0 });
  });

  it('accepts the whole outsourced stage, updates readiness and creates no payroll or cash', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000, qty: 2,
    }] } });
    const orderId = state.orders.at(-1)!.id;
    state = run(state, { type: 'order.launch', orderId });
    const taskId = state.orders.at(-1)!.route[0].id;
    const before = { payroll: state.payroll.length, cash: state.cash.length, movements: state.movements.length };
    state = run(state, { type: 'outsource.accept', taskId });
    const order = state.orders.at(-1)!;
    expect(order.route[0]).toMatchObject({ completed: 2, status: 'completed' });
    expect(order.lines[0].status).toBe('ready');
    expect(order.status).toBe('ready');
    expect({ payroll: state.payroll.length, cash: state.cash.length, movements: state.movements.length }).toEqual(before);
    atomic(state, { type: 'outsource.accept', taskId });
  });

  it('does not reassign an accepted outsourced stage during route revision', () => {
    const f = fixture();
    let state = run(f.state, { type: 'supplier.create', name: 'Other supplier', phone: '' });
    const otherSupplierId = state.suppliers.at(-1)!.id;
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000,
    }] } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    atomic(state, { type: 'order.update', orderId: order.id, overhead: 0, dueDate: order.dueDate,
      lines: [{ id: order.lines[0].id, kind: 'product', title: order.lines[0].title, qty: order.lines[0].qty,
        unitPrice: order.lines[0].total / order.lines[0].qty, materials: [], route: [{ operationId: f.operationId,
          executorKind: 'supplier', employeeId: null, supplierId: otherSupplierId, rate: 30000,
          taskId: order.route[0].id }] }] });
  });

  it('rejects internal, cancelled and worker acceptance', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [] } });
    const internal = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: internal.id });
    atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id });
    atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id }, f.worker);
    state = run(state, { type: 'order.cancel', orderId: internal.id });
    atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id });
  });

  it('never exposes an outsourced stage as worker work', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000,
    }] } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    expect(availableTask(state, order.id, order.route[0].id)).toBe(false);
    expect(() => run(state, { type: 'work.start', orderId: order.id, taskId: order.route[0].id }, f.worker))
      .toThrow('Outsourced task is not available to workers');
  });

  it('rejects a contractor in a series route', () => {
    const state = seriesCatalog();
    const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Shkaf'))!;
    atomic(state, { type: 'series.create', input: {
      outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 1,
      dueDate: '2026-11-12', substitutions: { Fasad: itemId(state, 'Fasad A') },
      route: [{ operationId: state.operations[0].id, executorKind: 'supplier', employeeId: null,
        supplierId: state.suppliers[0].id, rate: 30000 }],
    } });
  });

  it('keeps accepted work on order cancellation and blocks line cancellation', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 30000,
    }] } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    atomic(state, { type: 'orderLine.cancel', orderId: order.id, lineId: order.lines[0].id });
    state = run(state, { type: 'order.cancel', orderId: order.id });
    expect(state.orders.at(-1)!.route[0].status).toBe('completed');
    expect(state.orders.at(-1)!.route).toHaveLength(1);
  });

  it('tracks advance, accepted outsourcing and remaining debt in one supplier balance', () => {
    const f = fixture();
    let state = funds(f.state, 1000000);
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 300000,
      account: 'cash', allowPrepay: true, note: 'Autsors avansi', category: 'outsourcing' });
    expect(supplierDebt(state, f.supplierId)).toBe(-300000);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
      route: outsourcedRoute(f.operationId, f.supplierId) } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    expect(supplierDebt(state, f.supplierId)).toBe(-300000);
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    expect(supplierDebt(state, f.supplierId)).toBe(200000);
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
      amount: 200000, account: 'cash', note: `${order.number} · Autsors xizmati`, category: 'outsourcing' });
    expect(supplierDebt(state, f.supplierId)).toBe(0);
  });

  it('rejects overpayment without prepay and insufficient funds', () => {
    const f = fixture();
    atomic(f.state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 1000,
      account: 'cash', allowPrepay: false });
    const funded = funds(f.state, 1000);
    atomic(funded, { type: 'supplier.pay', supplierId: f.supplierId, amount: 1001,
      account: 'cash', allowPrepay: true });
  });

  it('keeps outsourcing payment metadata and reversal category inheritance', () => {
    const f = fixture();
    let state = funds(f.state, 500000);
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 100000,
      account: 'cash', allowPrepay: true, note: 'Metall uchun avans', category: 'outsourcing' });
    const entry = state.cash.at(-1)!;
    expect(entry).toMatchObject({ direction: 'out', source: 'supplier', sourceId: f.supplierId,
      category: 'outsourcing', note: 'Metall uchun avans' });
    state = run(state, { type: 'cash.reverse', entryId: entry.id, note: 'Avans bekor qilindi' });
    expect(state.cash.at(-1)).toMatchObject({ direction: 'in', source: 'supplier',
      sourceId: f.supplierId, category: 'outsourcing', note: 'Avans bekor qilindi', reversalOf: entry.id });
    expect(supplierDebt(state, f.supplierId)).toBe(0);
  });

  it('rejects order-originated payment for an unrelated or cancelled order', () => {
    const f = fixture();
    let state = funds(f.state, 500000);
    state = run(state, { type: 'supplier.create', name: 'Other supplier', phone: '' });
    const otherSupplierId = state.suppliers.at(-1)!.id;
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
      route: outsourcedRoute(f.operationId, f.supplierId) } });
    const order = state.orders.at(-1)!;
    atomic(state, { type: 'supplier.pay', supplierId: otherSupplierId, orderId: order.id,
      amount: 1000, account: 'cash', allowPrepay: true, category: 'outsourcing' });
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'order.cancel', orderId: order.id });
    atomic(state, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
      amount: 1000, account: 'cash', allowPrepay: true, category: 'outsourcing' });
  });

  it('keeps the accepted obligation and advance after cancelling the whole order', () => {
    const f = fixture();
    let state = funds(f.state, 1000000);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
      route: outsourcedRoute(f.operationId, f.supplierId) } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 100000,
      account: 'cash', allowPrepay: true, category: 'outsourcing' });
    state = run(state, { type: 'order.cancel', orderId: order.id });
    expect(supplierDebt(state, f.supplierId)).toBe(400000);
  });

  it('adds accepted outsourcing to actual cost once, not again when paid', () => {
    const f = fixture();
    let state = funds(f.state, 500000);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 40000, qty: 2 }] } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    const accepted = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    expect(actualCost(accepted, accepted.orders.at(-1)!)).toBe(80000);
    const paid = run(accepted, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
      amount: 80000, account: 'cash', category: 'outsourcing' });
    expect(actualCost(paid, paid.orders.at(-1)!)).toBe(80000);
    expect(paid.cash.filter(row => row.source === 'supplier')).toHaveLength(1);
  });

  it('sums issued materials, accepted internal work and accepted outsourcing', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, route: [
      { operationId: f.operationId, employeeId: f.employeeId, rate: 2 },
      { operationId: f.otherOperationId, executorKind: 'supplier', employeeId: null,
        supplierId: f.supplierId, rate: 300 },
    ] } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'order.issue', orderId: order.id });
    expect(estimatedCost(state, state.orders.at(-1)!)).toBe(50 + 20 + 3000 + 20);
    state = report(state, order.id, order.route[0].id, 10);
    state = run(state, { type: 'outsource.accept', taskId: order.route[1].id });
    expect(actualCost(state, state.orders.at(-1)!)).toBe(50 + 20 + 3000);
  });
});

describe('fixed supplier stage cost', () => {
  const fixedRoute = (operationId: string, supplierId: string, supplierCost: number) => [{
    operationId, executorKind: 'supplier' as const, employeeId: null, supplierId, rate: 0, supplierCost, qty: 2,
  }];

  it('stores the manual sum instead of a rate on a supplier stage', () => {
    const f = fixture();
    const state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [],
      route: fixedRoute(f.operationId, f.supplierId, 900000) } });
    const task = state.orders.at(-1)!.route[0];
    expect(task.rate).toBe(0);
    expect(task.supplierCost).toBe(900000);
    expect(task.planned).toBe(2);
  });

  it('counts the fixed sum in plan cost, supplier debt and actual cost', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, overhead: 0, materials: [],
      route: fixedRoute(f.operationId, f.supplierId, 900000) } });
    const order = state.orders.at(-1)!;
    expect(estimatedCost(state, order)).toBe(900000);
    expect(supplierStagePlan(order.route[0])).toBe(900000);
    expect(supplierStagePriced(order.route[0])).toBe(true);
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    expect(acceptedOutsourceCost(state, f.supplierId)).toBe(900000);
    expect(supplierDebt(state, f.supplierId)).toBe(900000);
    expect(supplierStageActual(state.orders.at(-1)!.route[0])).toBe(900000);
    expect(actualCost(state, state.orders.at(-1)!)).toBe(900000);
  });

  it('keeps legacy rate-based supplier stages working when no sum is stored', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, overhead: 0, materials: [],
      route: outsourcedRoute(f.operationId, f.supplierId) } });
    const order = state.orders.at(-1)!;
    expect(order.route[0].supplierCost).toBe(0);
    expect(estimatedCost(state, order)).toBe(500000);
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    expect(acceptedOutsourceCost(state, f.supplierId)).toBe(500000);
  });

  it('allows saving without a sum but blocks acceptance until it is filled in', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [],
      route: fixedRoute(f.operationId, f.supplierId, 0) } });
    const created = state.orders.at(-1)!;
    expect(created.route[0].supplierCost).toBe(0);
    expect(supplierStagePriced(created.route[0])).toBe(false);
    state = run(state, { type: 'order.launch', orderId: created.id });
    atomic(state, { type: 'outsource.accept', taskId: created.route[0].id });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.update', orderId: order.id, title: order.title, qty: order.qty,
      price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [],
      route: [{ ...fixedRoute(f.operationId, f.supplierId, 900000)[0], taskId: order.route[0].id }] });
    expect(state.orders.at(-1)!.route[0].supplierCost).toBe(900000);
    state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
    expect(supplierDebt(state, f.supplierId)).toBe(900000);
  });

  it('keeps the accepted fixed sum frozen through later revisions', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [],
      route: fixedRoute(f.operationId, f.supplierId, 900000) } });
    const created = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: created.id });
    state = run(state, { type: 'outsource.accept', taskId: created.route[0].id });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.update', orderId: order.id, title: order.title, qty: order.qty,
      price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [],
      route: [{ ...fixedRoute(f.operationId, f.supplierId, 900000)[0], taskId: order.route[0].id }] });
    expect(state.orders.at(-1)!.route[0]).toMatchObject({ supplierCost: 900000, status: 'completed', completed: 2 });
    atomic(state, { type: 'order.update', orderId: order.id, title: order.title, qty: order.qty,
      price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [],
      route: [{ ...fixedRoute(f.operationId, f.supplierId, 800000)[0], taskId: order.route[0].id }] });
  });

  it('keeps a legacy started supplier stage on its rate when no sum was stored', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, overhead: 0, materials: [],
      route: outsourcedRoute(f.operationId, f.supplierId) } });
    const created = state.orders.at(-1)!;
    state = run(state, { type: 'order.launch', orderId: created.id });
    state = run(state, { type: 'outsource.accept', taskId: created.route[0].id });
    const order = state.orders.at(-1)!;
    const kept = run(state, { type: 'order.update', orderId: order.id, title: order.title, qty: order.qty,
      price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [],
      route: [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null, supplierId: f.supplierId,
        rate: 250000, supplierCost: 500000, qty: 2, taskId: order.route[0].id }] });
    expect(kept.orders.at(-1)!.route[0]).toMatchObject({ rate: 250000, supplierCost: 0, status: 'completed' });
    expect(supplierStageActual(kept.orders.at(-1)!.route[0])).toBe(500000);
    expect(supplierDebt(kept, f.supplierId)).toBe(500000);
    atomic(kept, { type: 'order.update', orderId: order.id, title: order.title, qty: order.qty,
      price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [],
      route: [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null, supplierId: f.supplierId,
        rate: 250000, supplierCost: 400000, qty: 2, taskId: order.route[0].id }] });
  });
});

describe('integrated production and ledgers', () => {
  it('receives, reserves, issues, reviews, pays and partially delivers without double receivables', () => {
    const f = fixture();
    expect(stockQty(f.state, f.itemId)).toBe(0);
    let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
    expect(supplierDebt(state, f.supplierId)).toBe(100);
    expect(cashBalance(state, 'cash')).toBe(0);
    state = run(state, { type: 'order.create', input: { ...f.input, advance: 100 } });
    const orderId = state.orders[0].id;
    const [first, second] = state.orders[0].route;
    expect(estimatedCost(state, state.orders[0])).toBe(120);
    expect(orderPaid(state, orderId)).toBe(100);
    expect(availableTask(state, orderId, first.id)).toBe(false);
    state = run(state, { type: 'order.launch', orderId });
    expect(reservedQty(state, f.itemId)).toBe(10);
    expect(stockQty(state, f.itemId)).toBe(20);
    atomic(state, { type: 'work.submit', orderId, taskId: first.id, qty: 1, note: '' }, f.worker);
    state = run(state, { type: 'order.issue', orderId });
    expect(stockQty(state, f.itemId)).toBe(10);
    expect(reservedQty(state, f.itemId)).toBe(0);
    expect(actualCost(state, state.orders[0])).toBe(50);
    expect(availableTask(state, orderId, first.id)).toBe(true);
    expect(availableTask(state, orderId, second.id)).toBe(false);
    state = report(state, orderId, first.id, 4, true, f.worker);
    expect(acceptedPayroll(state, f.employeeId)).toBe(8);
    state = run(state, { type: 'salary.pay', employeeId: f.employeeId, amount: 3, account: 'cash', kind: 'advance', note: '', allowPrepay: true });
    expect(payrollDebt(state, f.employeeId)).toBe(0);
    state = report(state, orderId, first.id, 6, true, f.worker);
    expect(availableTask(state, orderId, second.id)).toBe(true);
    expect(state.orders[0].status).toBe('production');
    state = report(state, orderId, second.id, 10);
    expect(state.reports.at(-1)!.employeeId).toBe(f.otherEmployeeId);
    expect(state.orders[0].status).toBe('ready');
    expect(actualCost(state, state.orders[0])).toBe(100);
    expect(acceptedPayroll(state, f.employeeId)).toBe(20);
    expect(acceptedPayroll(state, f.otherEmployeeId)).toBe(30);
    atomic(state, ship(orderId, 4));
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 40, account: 'cash' });
    state = run(state, { type: 'customer.pay', customerId: state.orders[0].customerId, amount: 900, account: 'cash' });
    state = run(state, { type: 'salary.pay', employeeId: f.employeeId, amount: 17, account: 'cash', kind: 'advance', note: '', allowPrepay: true });
    state = run(state, { type: 'salary.pay', employeeId: f.otherEmployeeId, amount: 30, account: 'cash', kind: 'advance', note: '', allowPrepay: true });
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 60, account: 'cash' });
    expect(supplierDebt(state, f.supplierId)).toBe(0);
    expect(payrollDebt(state, f.employeeId)).toBe(0);
    expect(payrollDebt(state, f.otherEmployeeId)).toBe(0);
    expect(orderPaid(state, orderId)).toBe(1000);
    state = run(state, ship(orderId, 4));
    state = run(state, { type: 'shipment.deliver', shipmentId: state.shipments[0].id });
    expect(state.orders[0].status).toBe('shipped');
    expect(shippedQty(state, orderId)).toBe(4);
    state = run(state, ship(orderId, 6));
    atomic(state, ship(orderId, 1));
    state = run(state, { type: 'shipment.deliver', shipmentId: state.shipments[1].id });
    expect(state.orders[0].status).toBe('delivered');
    expect(shippedQty(state, orderId)).toBe(10);
    expect(cashBalance(state, 'cash')).toBe(850);
    expect(state.cash.filter(row => row.source === 'sale')).toHaveLength(2);
    expect(state.payroll).toHaveLength(2);
    expect(new Set(state.payroll.map(row => row.reportId)).size).toBe(2);
    expect(state.audit).toHaveLength(state.revision);
    atomic(state, { type: 'shipment.deliver', shipmentId: state.shipments[1].id });
  });

  it.each(['product', 'service'] as const)('has only one price receivable for a fully paid %s order', kind => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, kind, materials: [], route: [{ ...f.input.route[0], rate: 0 }], advance: 1000 } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    state = report(state, orderId, state.orders[0].route[0].id, 10);
    expect(state.orders[0].status).toBe('ready');
    state = run(state, ship(orderId, 10));
    state = run(state, { type: 'shipment.deliver', shipmentId: state.shipments[0].id });
    expect(orderPaid(state, orderId)).toBe(1000);
    expect(cashBalance(state, 'cash')).toBe(1000);
    expect(state.cash).toHaveLength(1);
  });

  it('requires explicit debt approval to ship unpaid orders', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{ ...f.input.route[0], rate: 0 }] } });
    const orderId = state.orders[0].id;
    atomic(state, ship(orderId, 1, true));
    state = run(state, { type: 'order.launch', orderId });
    state = report(state, orderId, state.orders[0].route[0].id, 10);
    atomic(state, ship(orderId, 1));
    state = run(state, ship(orderId, 1, true));
    expect(state.orders[0].status).toBe('shipped');
    expect(orderPaid(state, orderId)).toBe(0);
    expect(state.cash).toHaveLength(0);
  });
});

describe('immutability, idempotency and conflicts', () => {
  it('clones nested state, preserves original ledgers and audits every mutation', () => {
    const f = production();
    const before = structuredClone(f.state);
    freeze(f.state);
    const state = report(f.state, f.orderId, f.taskId, 2);
    expect(f.state).toEqual(before);
    expect(state).not.toBe(f.state);
    expect(state.orders[0]).not.toBe(f.state.orders[0]);
    expect(state.movements).toEqual(before.movements);
    expect(state.cash).toEqual(before.cash);
    expect(state.audit).toHaveLength(state.revision);
    expect(state.audit.at(-1)).toMatchObject({ actorId: admin.id, action: 'work.review', entityId: state.reports[0].id });
    const ids = [
      ...state.customers, ...state.suppliers, ...state.employees, ...state.operations, ...state.items,
      ...state.orders, ...state.purchases, ...state.movements, ...state.reports, ...state.payroll,
      ...state.orders.flatMap(row => [...row.materials, ...row.route]), ...state.purchases.flatMap(row => row.lines),
    ].map(row => row.id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('acknowledges the same command twice even with its original stale revision', () => {
    const initial = emptyState();
    const envelope: Envelope = {
      requestId: 'double-command', expectedRevision: 0,
      command: { type: 'customer.create', name: 'Customer', phone: '', address: '', kind: 'customer' },
    };
    const state = applyCommand(initial, envelope, admin);
    const repeated = applyCommand(state, envelope, admin);
    expect(repeated).toBe(state);
    expect(repeated.customers).toHaveLength(1);
    expect(repeated.audit).toHaveLength(1);
    expect(repeated.audit[0].id).toBe(envelope.requestId);
    expect(repeated.revision).toBe(1);
  });

  it('rejects conflicting revisions and invalid request IDs before any mutation', () => {
    const state = funds(emptyState(), 10);
    const before = structuredClone(state);
    const command: Command = { type: 'employee.create', name: 'Employee' };
    for (const expectedRevision of [0, 2, NaN, 1.5]) {
      expect(() => applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision, command }, admin)).toThrow('Revision conflict');
    }
    expect(() => applyCommand(state, { requestId: ' ', expectedRevision: state.revision, command }, admin)).toThrow();
    expect(state).toEqual(before);
  });

  it('does not consume a failed request ID', () => {
    const state = emptyState();
    const envelope: Envelope = {
      requestId: 'retry-after-error', expectedRevision: 0,
      command: { type: 'cash.post', direction: 'out', amount: 5, account: 'cash', toAccount: null, category: '', note: '' },
    };
    expect(() => applyCommand(state, envelope, admin)).toThrow();
    const next = applyCommand(state, {
      ...envelope,
      command: { type: 'cash.post', direction: 'in', amount: 5, account: 'cash', toAccount: null, category: '', note: '' },
    }, admin);
    expect(next.audit[0].id).toBe(envelope.requestId);
    expect(cashBalance(next, 'cash')).toBe(5);
  });
});

describe('stock reservations and atomic receipts', () => {
  it('launches an order that needs more material than the shelf holds', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 10 }, { itemId: f.otherItemId, qty: 1 }] } });
    state = run(state, { type: 'order.launch', orderId: state.orders[0].id });
    expect(state.orders[0].status).toBe('production');
    expect(reservedQty(state, f.itemId)).toBe(10);
    expect(reservedQty(state, f.otherItemId)).toBe(1);
    expect(stockQty(state, f.itemId)).toBe(10);
  });

  it('counts cannot fall below the reserved quantity', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 15, 5);
    state = run(state, { type: 'order.create', input: f.input });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    atomic(state, { type: 'inventory.count', itemId: f.itemId, qty: 9, note: '' });
    state = run(state, { type: 'inventory.count', itemId: f.itemId, qty: 10, note: 'Count' });
    expect(stockQty(state, f.itemId)).toBe(10);
    expect(reservedQty(state, f.itemId)).toBe(10);
    state = run(state, { type: 'order.cancel', orderId });
    expect(reservedQty(state, f.itemId)).toBe(0);
    state = run(state, { type: 'inventory.count', itemId: f.itemId, qty: 0, note: 'Empty' });
    expect(stockQty(state, f.itemId)).toBe(0);
    expect(state.movements.map(row => row.direction)).toEqual(['in', 'out', 'out']);
  });

  it('issues every reserved line atomically and does not issue twice', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = receive(state, f.supplierId, f.otherItemId, 2, 1);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 10 }, { itemId: f.otherItemId, qty: 2 }] } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    const damaged = structuredClone(state);
    damaged.movements = damaged.movements.filter(row => row.itemId !== f.otherItemId);
    atomic(damaged, { type: 'order.issue', orderId });
    expect(damaged.orders[0].materials.every(row => row.issuedQty === 0)).toBe(true);
    expect(stockQty(damaged, f.itemId)).toBe(10);
    state = run(state, { type: 'order.issue', orderId });
    expect(state.orders[0].materials.every(row => row.issuedQty === row.qty)).toBe(true);
    expect(stockQty(state, f.itemId)).toBe(0);
    expect(stockQty(state, f.otherItemId)).toBe(0);
    expect(reservedQty(state, f.itemId)).toBe(0);
    atomic(state, { type: 'order.issue', orderId });
    state = run(state, { type: 'order.cancel', orderId });
    expect(state.orders[0].status).toBe('cancelled');
    expect(state.orders[0].materials.every(row => row.issuedQty === 0 && row.actualCost === 0)).toBe(true);
    expect(stockQty(state, f.itemId)).toBe(10);
    expect(stockQty(state, f.otherItemId)).toBe(2);
  });

  it('receives partial quantities and rejects duplicate or excessive lines without partial updates', () => {
    const f = fixture();
    let state = run(f.state, {
      type: 'purchase.create', supplierId: f.supplierId,
      lines: [{ itemId: f.itemId, qty: 10, price: 5 }, { itemId: f.otherItemId, qty: 5, price: 2 }],
    });
    const purchase = state.purchases[0];
    const [a, b] = purchase.lines;
    atomic(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: a.id, qty: 3 }, { lineId: b.id, qty: 6 }] });
    expect(stockQty(state, f.itemId)).toBe(0);
    expect(state.items[0].cost).toBe(5);
    expect(supplierDebt(state, f.supplierId)).toBe(0);
    atomic(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: a.id, qty: 3 }, { lineId: a.id, qty: 3 }] });
    atomic(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [] });
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: a.id, qty: 3 }, { lineId: b.id, qty: 2 }] });
    expect(state.purchases[0].lines.map(row => row.received)).toEqual([3, 2]);
    expect(stockQty(state, f.itemId)).toBe(3);
    expect(supplierDebt(state, f.supplierId)).toBe(19);
    expect(state.cash).toHaveLength(0);
    atomic(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: b.id, qty: 4 }] });
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: a.id, qty: 7 }, { lineId: b.id, qty: 3 }] });
    expect(supplierDebt(state, f.supplierId)).toBe(60);
    atomic(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: a.id, qty: 1 }] });
  });

  it('averages receipt costs using stock before the receipt, not ordered quantities', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 10);
    expect(state.items[0].cost).toBe(10);
    const history = structuredClone(state.movements);
    state = run(state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: f.itemId, qty: 10, price: 20 }] });
    const purchase = state.purchases[1];
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 5 }] });
    expect(stockQty(state, f.itemId)).toBe(15);
    expect(state.items[0].cost).toBe(13.33);
    expect(supplierDebt(state, f.supplierId)).toBe(200);
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 5 }] });
    expect(state.items[0].cost).toBe(15);
    expect(supplierDebt(state, f.supplierId)).toBe(300);
    expect(state.movements.slice(0, history.length)).toEqual(history);
    expect(state.movements.map(row => row.unitCost)).toEqual([10, 20, 20]);
  });

  it('keeps last purchase price separate from moving average cost', () => {
    let state = emptyState();
    state = run(state, { type: 'item.create', kind: 'material', name: 'LDSP', unit: 'sheet', minQty: 0, cost: 0, salePrice: 0, customerId: null });
    const itemId = state.items[0].id;
    state = receivePurchase(state, itemId, 10, 40000);
    state = receivePurchase(state, itemId, 10, 60000);
    expect(state.items[0].cost).toBe(50000);
    expect(state.items[0].lastPurchasePrice).toBe(60000);
    expect(state.items[0]).toMatchObject({ kind: 'material', salePrice: 0, materialCost: 50000, laborCost: 0 });
    expect(state.purchases[1].lines[0]).toMatchObject({
      previousPurchasePrice: 40000, newPurchasePrice: 60000,
      previousAverageCost: 40000, newAverageCost: 50000,
    });
  });

  it('does not let customer goods touch business price history', () => {
    const f = fixture();
    let state = run(f.state, { type: 'item.create', name: 'Customer fabric', unit: 'm', minQty: 0, cost: 0, customerId: f.customerId });
    const customerItemId = state.items.at(-1)!.id;
    state = receivePurchase(state, f.itemId, 5, 10);
    const own = structuredClone(state.items[0]);
    state = run(state, { type: 'customer.receive', itemId: customerItemId, qty: 4, note: '' });
    expect(state.items[0]).toEqual(own);
    expect(state.items.find(row => row.id === customerItemId)).toMatchObject({ lastPurchasePrice: 0, materialCost: 0, laborCost: 0 });
    expect(stockQty(state, f.itemId)).toBe(5);
    atomic(state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: customerItemId, qty: 1, price: 10 }] });
  });

  it('issues only what the customer actually supplied', () => {
    const f = fixture();
    let state = run(f.state, { type: 'item.create', name: 'Customer fabric', unit: 'm', minQty: 0, cost: 0, customerId: f.customerId });
    const itemId = state.items.at(-1)!.id;
    state = run(state, { type: 'customer.receive', itemId, qty: 5, note: '' });
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId, qty: 6 }], route: [{ ...f.input.route[0], rate: 0 }], overhead: 0 } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    state = run(state, { type: 'order.issue', orderId });
    expect(state.orders[0].materials[0].issuedQty).toBe(5);
    expect(stockQty(state, itemId)).toBe(0);
  });

  it('validates item kind and client price', () => {
    const f = fixture();
    const blank = run(f.state, { type: 'item.create', kind: 'blank', name: 'Blank', unit: 'шт', minQty: 0, cost: 0, salePrice: 250000, customerId: null });
    expect(blank.items.at(-1)).toMatchObject({ kind: 'blank', salePrice: 250000 });
    atomic(f.state, { type: 'item.create', kind: 'unknown' as never, name: 'Bad', unit: 'шт', minQty: 0, cost: 0, salePrice: 0, customerId: null });
    atomic(f.state, { type: 'item.create', name: 'Negative', unit: 'шт', minQty: 0, cost: 0, salePrice: -1, customerId: null });
  });

  it('snapshots material estimates at creation and actual cost at issue', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 10);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 5 }], route: [{ ...f.input.route[0], rate: 0 }], overhead: 0 } });
    const orderId = state.orders[0].id;
    state = receive(state, f.supplierId, f.itemId, 5, 20);
    state = run(state, { type: 'order.launch', orderId });
    state = run(state, { type: 'order.issue', orderId });
    expect(estimatedCost(state, state.orders[0])).toBe(50);
    expect(actualCost(state, state.orders[0])).toBe(66.65);
    expect(state.orders[0].materials[0].actualCost).toBe(13.33);
    expect(state.orders[0].status).toBe('production');
    state = receive(state, f.supplierId, f.itemId, 10, 30);
    expect(actualCost(state, state.orders[0])).toBe(66.65);
  });

  it('keeps customer materials isolated, zero-cost and outside supplier purchases', () => {
    const f = fixture();
    let state = run(f.state, { type: 'item.create', name: 'Customer fabric', unit: 'm', minQty: 0, cost: 0, customerId: f.customerId });
    const itemId = state.items.at(-1)!.id;
    state = run(state, { type: 'customer.receive', itemId, qty: 10, note: 'Customer goods' });
    expect(stockQty(state, itemId)).toBe(10);
    expect(state.movements[0]).toMatchObject({ unitCost: 0, source: 'customer', sourceId: f.customerId });
    atomic(state, { type: 'customer.receive', itemId: f.itemId, qty: 1, note: '' });
    atomic(state, { type: 'item.create', name: 'Costly customer goods', unit: 'm', minQty: 0, cost: 1, customerId: f.customerId });
    atomic(state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId, qty: 1, price: 0 }] });
    atomic(state, { type: 'order.create', input: { ...f.input, customerId: f.otherCustomerId, materials: [{ itemId, qty: 10 }] } });
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId, qty: 10 }], route: [{ ...f.input.route[0], rate: 0 }], overhead: 0 } });
    const orderId = state.orders[0].id;
    const wrongOwner = structuredClone(state);
    wrongOwner.orders[0].customerId = f.otherCustomerId;
    atomic(wrongOwner, { type: 'order.launch', orderId });
    state = run(state, { type: 'order.launch', orderId });
    expect(reservedQty(state, itemId)).toBe(10);
    state = run(state, { type: 'order.issue', orderId });
    expect(stockQty(state, itemId)).toBe(0);
    expect(actualCost(state, state.orders[0])).toBe(0);
    expect(supplierDebt(state, f.supplierId)).toBe(0);
  });
});

describe('замок: доменные тексты нехватки', () => {
  it('order.launch пропускает заказ с нехваткой, а выдача отдаёт сколько есть', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 4, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 10 }] } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    expect(state.orders[0].status).toBe('production');
    state = run(state, { type: 'order.issue', orderId });
    expect(state.orders[0].materials[0].issuedQty).toBe(4);
  });

  it('order.issue бросает ровно Omborda material yo‘q, когда на полке пусто', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 10 }] } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    expect(() => run(state, { type: 'order.issue', orderId })).toThrow(/^Omborda material yo‘q\. Qoldiqni to‘ldiring$/);
  });

  it('order.issue по ревизии выдаёт остаток полки и оставляет долг', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 4 }] } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    const order = state.orders[0];
    const route = order.route.map(task => ({ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id }));
    state = run(state, { type: 'order.update', orderId, title: order.title, qty: order.qty, price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [{ itemId: f.itemId, qty: 50 }], route });
    state = run(state, { type: 'order.issue', orderId });
    expect(state.orders[0].materials[0].issuedQty).toBe(10);
    expect(reservedQty(state, f.itemId)).toBe(40);
  });
});

describe('work state machine and payroll statuses', () => {
  it('accrues a pending stage cost once and keeps salary debt plan-based', () => {
    let state = launchedOrder();
    const { order, task, worker } = ownTask(state);
    state = run(state, { type: 'work.accept', orderId: order.id, taskId: task.id }, worker);
    expect(taskState(state, order.id, task.id)).toBe('accepted');
    state = run(state, { type: 'work.start', orderId: order.id, taskId: task.id }, worker);
    expect(taskState(state, order.id, task.id)).toBe('in_progress');
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned, note: '' }, worker);
    expect(taskState(state, order.id, task.id)).toBe('submitted');
    expect(state.payroll).toHaveLength(1);
    expect(state.payroll[0]).toMatchObject({ taskId: task.id, employeeId: worker.id, status: 'pending' });
    expect(payrollDebt(state, worker.id)).toBe(0);
    state = run(state, { type: 'work.review', reportId: state.reports[0].id, accept: true });
    expect(taskState(state, order.id, task.id)).toBe('completed');
    expect(state.payroll[0]).toMatchObject({ status: 'accepted', amount: task.planned * task.rate });
    expect(payrollDebt(state, worker.id)).toBe(0);
  });

  it('auto-accepts a submitted stage when the operation allows it', () => {
    const start = production();
    const orderId = start.orderId;
    const taskId = start.taskId!;
    start.state.operations[0].autoAccept = true;
    let state = startWork(start.state, orderId, taskId);
    state = run(state, { type: 'work.submit', orderId, taskId, qty: 10, note: '' });
    expect(taskState(state, orderId, taskId)).toBe('completed');
    expect(state.reports.at(-1)!.status).toBe('accepted');
    expect(state.payroll.at(-1)).toMatchObject({ amount: 20, status: 'accepted' });
    expect(payrollDebt(state, state.employees[0].id)).toBe(0);
    atomic(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
  });

  it('requires acceptance and start before submission', () => {
    let state = launchedOrder();
    const { order, task, worker } = ownTask(state);
    atomic(state, { type: 'work.start', orderId: order.id, taskId: task.id }, worker);
    state = run(state, { type: 'work.accept', orderId: order.id, taskId: task.id }, worker);
    atomic(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: 1, note: '' }, worker);
    atomic(state, { type: 'work.accept', orderId: order.id, taskId: task.id }, worker);
  });

  it('rejects foreign, inactive and unauthorized workers', () => {
    const state = launchedOrder();
    const { order, task } = ownTask(state);
    const foreign: Actor = { id: state.employees[1].id, name: 'Other', role: 'worker', companyId: state.companyId };
    atomic(state, { type: 'work.accept', orderId: order.id, taskId: task.id }, foreign);
    const inactive = structuredClone(state);
    inactive.employees.find(employee => employee.id === task.employeeId)!.active = false;
    atomic(inactive, { type: 'work.accept', orderId: order.id, taskId: task.id }, { id: task.employeeId!, name: 'Worker', role: 'worker', companyId: state.companyId });
    const unauthorized = structuredClone(state);
    unauthorized.operations.find(operation => operation.id === task.operationId)!.employeeIds = [];
    atomic(unauthorized, { type: 'work.accept', orderId: order.id, taskId: task.id }, { id: task.employeeId!, name: 'Worker', role: 'worker', companyId: state.companyId });
  });

  it('blocks the next stage until the previous one is accepted', () => {
    let state = launchedOrder();
    const { order, task, worker } = ownTask(state);
    const next = order.route[1];
    state = startWork(state, order.id, task.id, worker);
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned, note: '' }, worker);
    atomic(state, { type: 'work.accept', orderId: order.id, taskId: next.id }, { id: next.employeeId!, name: 'Next', role: 'worker', companyId: state.companyId });
    state = run(state, { type: 'work.review', reportId: state.reports[0].id, accept: true });
    expect(availableTask(state, order.id, next.id)).toBe(true);
  });

  it('rejects and resubmits through the same payroll record', () => {
    let state = launchedOrder();
    const { order, task, worker } = ownTask(state);
    state = startWork(state, order.id, task.id, worker);
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned, note: '' }, worker);
    const reportId = state.reports[0].id;
    const payrollId = state.payroll[0].id;
    state = run(state, { type: 'work.review', reportId, accept: false, reason: 'quality' });
    expect(state.reports[0].status).toBe('rejected');
    expect(state.payroll[0]).toMatchObject({ id: payrollId, status: 'rejected' });
    expect(taskState(state, order.id, task.id)).toBe('in_progress');
    expect(payrollDebt(state, worker.id)).toBe(0);
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned, note: 'Again' }, worker);
    expect(state.reports).toHaveLength(2);
    expect(state.reports[1]).toMatchObject({ status: 'submitted', note: 'Again' });
    expect(state.payroll).toHaveLength(1);
    expect(state.payroll[0]).toMatchObject({ id: payrollId, status: 'pending' });
    const envelope: Envelope = { requestId: 'review-once', expectedRevision: state.revision, command: { type: 'work.review', reportId: state.reports[1].id, accept: true } };
    state = applyCommand(state, envelope, admin);
    expect(applyCommand(state, envelope, admin)).toBe(state);
    expect(state.payroll[0]).toMatchObject({ id: payrollId, status: 'accepted' });
    expect(state.payroll[0].amount).toBe(task.planned * task.rate);
    expect(payrollDebt(state, worker.id)).toBe(0);
  });

  it('reports only the salary plan balance through payrollDebt', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 5))
      .toISOString().slice(0, 7);
    const state = emptyState();
    state.employees.push({ id: 'e1', name: 'Usta', active: true });
    state.payroll.push({ id: 'p1', employeeId: 'e1', reportId: 'r', orderId: 'o', taskId: 't',
      amount: 340000, status: 'accepted', createdAt: `${prevMonth}-05T09:00:00.000Z` });
    expect(payrollDebt(state, 'e1')).toBe(0);

    state.salaryPlans.push({ id: 's1', employeeId: 'e1', amount: 1200000,
      fromMonth: thisMonth, createdAt: `${thisMonth}-01T00:00:00.000Z` });
    expect(payrollDebt(state, 'e1')).toBe(1200000);

    // Принятая работа остаётся записью себестоимости и оклад не увеличивает.
    state.payroll.push({ id: 'p2', employeeId: 'e1', reportId: 'r2', orderId: 'o', taskId: 't2',
      amount: 500000, status: 'accepted', createdAt: new Date().toISOString() });
    expect(payrollDebt(state, 'e1')).toBe(1200000);
    expect(payrollDebt(state, 'e1')).toBe(salaryLedger(state, 'e1').owed);
  });
});

describe('workers, pending quantities and review', () => {
  it('allows workers only their own available stage and assigns demo submissions to the employee', () => {
    const f = production();
    atomic(f.state, { type: 'customer.create', name: 'Unauthorized', phone: '', address: '', kind: 'customer' }, f.worker);
    atomic(f.state, { type: 'work.accept', orderId: f.orderId, taskId: f.taskId }, f.otherWorker);
    atomic(f.state, { type: 'work.accept', orderId: f.orderId, taskId: f.state.orders[0].route[1].id }, f.otherWorker);
    atomic(f.state, { type: 'work.accept', orderId: f.orderId, taskId: f.taskId }, { id: 'unknown', name: '', role: 'worker', companyId: DEMO_COMPANY_ID });
    let state = startWork(f.state, f.orderId, f.taskId, f.worker);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 2, note: '' }, f.worker);
    atomic(state, { type: 'work.review', reportId: state.reports[0].id, accept: true }, f.worker);
    state = run(state, { type: 'work.review', reportId: state.reports[0].id, accept: false, reason: 'quality' });
    state = startWork(state, f.orderId, f.taskId, f.worker);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 3, note: '' });
    expect(state.reports.map(row => row.employeeId)).toEqual([f.employeeId, f.employeeId]);
    const started = startWork(f.state, f.orderId, f.taskId, f.worker);
    const inactive = structuredClone(started);
    inactive.employees[0].active = false;
    expect(availableTask(inactive, f.orderId, f.taskId)).toBe(false);
    atomic(inactive, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 1, note: '' });
  });

  it('caps submissions by accepted plus pending quantity and rejection frees pending quantity', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId, f.worker);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 6, note: '' }, f.worker);
    const rejectedId = state.reports[0].id;
    atomic(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 5, note: '' }, f.worker);
    expect(availableTask(state, f.orderId, f.taskId)).toBe(false);
    state = run(state, { type: 'work.review', reportId: rejectedId, accept: false, reason: 'quality' });
    expect(availableTask(state, f.orderId, f.taskId)).toBe(true);
    expect(payrollDebt(state, f.employeeId)).toBe(0);
    expect(state.orders[0].route[0].completed).toBe(0);
    atomic(state, { type: 'work.review', reportId: rejectedId, accept: true });
    atomic(state, { type: 'work.review', reportId: rejectedId, accept: false, reason: 'quality' });
    state = startWork(state, f.orderId, f.taskId, f.worker);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: '' }, f.worker);
    expect(state.reports).toHaveLength(2);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
    const acceptedId = state.reports.at(-1)!.id;
    expect(acceptedPayroll(state, f.employeeId)).toBe(8);
    atomic(state, { type: 'work.review', reportId: acceptedId, accept: true });
    atomic(state, { type: 'work.review', reportId: acceptedId, accept: false, reason: 'quality' });
    state = report(state, f.orderId, f.taskId, 6, true, f.worker);
    expect(state.orders[0].route[0].completed).toBe(10);
    expect(state.payroll).toHaveLength(1);
    expect(acceptedPayroll(state, f.employeeId)).toBe(20);
    expect(availableTask(state, f.orderId, f.state.orders[0].route[1].id)).toBe(true);
    state = run(state, { type: 'order.cancel', orderId: f.orderId });
    expect(state.orders[0].status).toBe('cancelled');
    expect(acceptedPayroll(state, f.employeeId)).toBe(20);
    expect(state.reports).toHaveLength(3);
    expect(stockQty(state, f.itemId)).toBe(20);
  });

  it('accepted payroll uses the route rate snapshot instead of the current operation rate', () => {
    const f = production();
    const changed = structuredClone(f.state);
    changed.operations[0].workerRate = 999;
    const state = report(changed, f.orderId, f.taskId, 3);
    expect(state.payroll[0].amount).toBe(6);
    expect(payrollDebt(state, f.employeeId)).toBe(0);
  });

  it('accepting a repeated envelope records exactly one payroll entry', () => {
    const f = production();
    const started = startWork(f.state, f.orderId, f.taskId);
    const submitted = run(started, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 10, note: '' });
    const envelope: Envelope = {
      requestId: 'accept-once', expectedRevision: submitted.revision,
      command: { type: 'work.review', reportId: submitted.reports[0].id, accept: true },
    };
    const accepted = applyCommand(submitted, envelope, admin);
    expect(applyCommand(accepted, envelope, admin)).toBe(accepted);
    expect(accepted.payroll).toHaveLength(1);
    expect(accepted.orders[0].route[0].completed).toBe(10);
  });

  it('supports fractional quantities without opening the next stage on pending reports', () => {
    const f = production({ qty: 0.3 });
    let state = report(f.state, f.orderId, f.taskId, 0.1);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 0.2, note: '' });
    const secondTaskId = state.orders[0].route[1].id;
    expect(availableTask(state, f.orderId, secondTaskId)).toBe(false);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
    expect(state.orders[0].route[0].completed).toBe(0.3);
    expect(availableTask(state, f.orderId, secondTaskId)).toBe(true);
    expect(acceptedPayroll(state, f.employeeId)).toBe(0.6);
  });
});

describe('cash document numbers', () => {
  it('assigns sequential PKO and RKO numbers per direction', () => {
    let state = emptyState();
    state = run(state, { type: 'cash.post', direction: 'in', amount: 100, account: 'cash', toAccount: null, category: '', note: '' });
    state = run(state, { type: 'cash.post', direction: 'in', amount: 200, account: 'cash', toAccount: null, category: '', note: '' });
    state = run(state, { type: 'cash.post', direction: 'out', amount: 50, account: 'cash', toAccount: null, category: '', note: '' });
    expect(state.cash.map(row => row.number)).toEqual(['PKO-0001', 'PKO-0002', 'RKO-0001']);
  });

  it('leaves transfers unnumbered', () => {
    let state = funds(emptyState(), 100);
    state = run(state, { type: 'cash.post', direction: 'transfer', amount: 40, account: 'cash', toAccount: 'bank', category: '', note: '' });
    expect(state.cash[0].number).toBe('PKO-0001');
    expect(state.cash[1].number).toBeNull();
  });

  it('numbers a reversal as its own new document', () => {
    let state = funds(emptyState(), 100);
    const original = state.cash[0];
    state = run(state, { type: 'cash.reverse', entryId: original.id, note: '' });
    expect(state.cash.at(-1)).toMatchObject({ direction: 'out', number: 'RKO-0001', reversalOf: original.id });
  });
});

describe('cash, payable caps, transfers and reversals', () => {
  it('enforces supplier caps based only on received cost and supports net reversal totals', () => {
    const f = fixture();
    let state = funds(f.state, 1000);
    state = run(state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: f.itemId, qty: 20, price: 5 }] });
    atomic(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 1, account: 'cash' });
    const purchase = state.purchases[0];
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 10 }] });
    atomic(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 51, account: 'cash' });
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 20, account: 'cash' });
    const original = state.cash.at(-1)!;
    expect(supplierDebt(state, f.supplierId)).toBe(30);
    state = run(state, { type: 'cash.reverse', entryId: original.id, note: 'Undo supplier payment' });
    expect(supplierDebt(state, f.supplierId)).toBe(50);
    expect(state.cash.at(-1)).toMatchObject({ source: 'supplier', sourceId: f.supplierId, direction: 'in', reversalOf: original.id });
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 50, account: 'cash' });
    expect(supplierDebt(state, f.supplierId)).toBe(0);
    expect(cashBalance(state, 'cash')).toBe(950);
    atomic(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 0.01, account: 'cash' });
  });

  it('caps salary payments by the fixed plan balance and reversal restores payable', () => {
    const f = production();
    const thisMonth = new Date().toISOString().slice(0, 7);
    let state = report(f.state, f.orderId, f.taskId, 10);
    state = run(state, { type: 'salary.plan.set', employeeId: f.employeeId, amount: 20, fromMonth: thisMonth });
    expect(payrollDebt(state, f.employeeId)).toBe(20);
    atomic(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 1, account: 'cash' });
    state = funds(state, 100);
    atomic(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 21, account: 'cash' });
    state = run(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 7, account: 'cash' });
    expect(payrollDebt(state, f.employeeId)).toBe(13);
    const originalId = state.cash.at(-1)!.id;
    state = run(state, { type: 'cash.reverse', entryId: originalId, note: '' });
    expect(payrollDebt(state, f.employeeId)).toBe(20);
    state = run(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 20, account: 'cash' });
    expect(payrollDebt(state, f.employeeId)).toBe(0);
    expect(cashBalance(state, 'cash')).toBe(80);
    atomic(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 0.01, account: 'cash' });
    atomic(state, { type: 'payroll.pay', employeeId: f.otherEmployeeId, amount: 1, account: 'cash' });
  });

  it('moves money in one row and reverses by swapping accounts without rewriting history', () => {
    let state = funds(emptyState(), 100);
    state = run(state, { type: 'cash.post', direction: 'transfer', amount: 40, account: 'cash', toAccount: 'bank', category: '', note: '' });
    const transfer = structuredClone(state.cash[1]);
    expect(state.cash).toHaveLength(2);
    expect(transfer.source).toBe('transfer');
    expect(cashBalance(state, 'cash')).toBe(60);
    expect(cashBalance(state, 'bank')).toBe(40);
    const envelope: Envelope = { requestId: 'reverse-once', expectedRevision: state.revision, command: { type: 'cash.reverse', entryId: transfer.id, note: '' } };
    state = applyCommand(state, envelope, admin);
    expect(applyCommand(state, envelope, admin)).toBe(state);
    expect(state.cash[1]).toEqual(transfer);
    expect(state.cash[2]).toMatchObject({ direction: 'transfer', account: 'bank', toAccount: 'cash', reversalOf: transfer.id, source: 'transfer', sourceId: null });
    expect(cashBalance(state, 'cash')).toBe(100);
    expect(cashBalance(state, 'bank')).toBe(0);
    atomic(state, { type: 'cash.reverse', entryId: transfer.id, note: '' });
    atomic(state, { type: 'cash.reverse', entryId: state.cash[2].id, note: '' });
    atomic(state, { type: 'cash.post', direction: 'transfer', amount: 10, account: 'cash', toAccount: 'cash', category: '', note: '' });
    atomic(state, { type: 'cash.post', direction: 'transfer', amount: 101, account: 'cash', toAccount: 'bank', category: '', note: '' });
  });

  it('rejects reversing spent incoming funds or a spent transfer destination', () => {
    let state = funds(emptyState(), 50);
    const incomingId = state.cash[0].id;
    state = run(state, { type: 'cash.post', direction: 'out', amount: 30, account: 'cash', toAccount: null, category: '', note: '' });
    atomic(state, { type: 'cash.reverse', entryId: incomingId, note: '' });
    state = run(state, { type: 'cash.reverse', entryId: state.cash[1].id, note: '' });
    expect(cashBalance(state, 'cash')).toBe(50);
    state = run(state, { type: 'cash.post', direction: 'transfer', amount: 40, account: 'cash', toAccount: 'bank', category: '', note: '' });
    const transferId = state.cash.at(-1)!.id;
    state = run(state, { type: 'cash.post', direction: 'out', amount: 1, account: 'bank', toAccount: null, category: '', note: '' });
    atomic(state, { type: 'cash.reverse', entryId: transferId, note: '' });
    expect(cashBalance(state, 'cash')).toBe(10);
    expect(cashBalance(state, 'bank')).toBe(39);
  });

  it('keeps a cancelled order advance as customer credit and releases reservations', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, advance: 100 } });
    const orderId = state.orders[0].id;
    const customerId = state.orders[0].customerId;
    const advance = structuredClone(state.cash[0]);
    state = run(state, { type: 'order.launch', orderId });
    expect(reservedQty(state, f.itemId)).toBe(10);
    state = run(state, { type: 'order.cancel', orderId });
    expect(reservedQty(state, f.itemId)).toBe(0);
    expect(stockQty(state, f.itemId)).toBe(10);
    expect(customerLedger(state, customerId).advance).toBe(100);
    state = run(state, { type: 'cash.reverse', entryId: advance.id, note: 'Refund' });
    expect(state.cash[0]).toEqual(advance);
    expect(state.cash[1]).toMatchObject({ direction: 'out', source: 'sale', customerId });
    expect(customerLedger(state, customerId).advance).toBe(0);
    expect(cashBalance(state, 'cash')).toBe(0);
    atomic(state, { type: 'order.launch', orderId });
  });

  it('caps order advances at the order price and keeps extra payments as customer advance', () => {
    const f = fixture();
    atomic(f.state, { type: 'order.create', input: { ...f.input, advance: 1000.01 } });
    let state = run(f.state, { type: 'order.create', input: { ...f.input, advance: 250 } });
    const orderId = state.orders[0].id;
    const customerId = state.orders[0].customerId;
    state = run(state, { type: 'customer.pay', customerId, amount: 750, account: 'bank' });
    expect(orderPaid(state, orderId)).toBe(1000);
    expect(cashBalance(state, 'bank')).toBe(750);
    state = run(state, { type: 'cash.reverse', entryId: state.cash[1].id, note: '' });
    expect(orderPaid(state, orderId)).toBe(250);
    expect(cashBalance(state, 'bank')).toBe(0);
    state = run(state, { type: 'customer.pay', customerId, amount: 750, account: 'cash' });
    expect(orderPaid(state, orderId)).toBe(1000);
    state = run(state, { type: 'customer.pay', customerId, amount: 50, account: 'bank' });
    expect(orderPaid(state, orderId)).toBe(1000);
    expect(customerLedger(state, customerId).advance).toBe(1050);
  });
});

describe('salary plan and payment commands', () => {
  it('stacks salary plan versions and repairs the same month in place', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 5)).toISOString().slice(0, 7);
    const nextMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)), 1)).toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'r1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'r2', expectedRevision: 1, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(1);
    state = applyCommand(state, { requestId: 'r3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1300000, fromMonth: thisMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(1);
    expect(state.salaryPlans[0].amount).toBe(1300000);
    state = applyCommand(state, { requestId: 'r4', expectedRevision: 3, command: { type: 'salary.plan.set', employeeId, amount: 1500000, fromMonth: nextMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(2);

    // План задним числом допустим — это отдельная версия, а не правка текущей.
    state = applyCommand(state, { requestId: 'r8', expectedRevision: 4, command: { type: 'salary.plan.set', employeeId, amount: 1000000, fromMonth: prevMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(3);
    expect(state.salaryPlans.filter(row => row.fromMonth === prevMonth).map(row => row.amount)).toEqual([1000000]);

    expect(() => applyCommand(state, { requestId: 'r5', expectedRevision: 5, command: { type: 'salary.plan.set', employeeId, amount: 1000000, fromMonth: thisMonth + '-01' } }, admin))
      .toThrow('Invalid salary plan month');
    expect(() => applyCommand(state, { requestId: 'r6', expectedRevision: 5, command: { type: 'salary.plan.set', employeeId, amount: -1, fromMonth: nextMonth } }, admin))
      .toThrow('Invalid amount');
    expect(() => applyCommand(state, { requestId: 'r7', expectedRevision: 5, command: { type: 'salary.plan.set', employeeId: 'nobody', amount: 1000, fromMonth: nextMonth } }, admin))
      .toThrow('Employee not found');
  });

  it('pays the plan balance, honours the prepay flag and rejects a worker', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const worker: Actor = { id: 'worker-actor', name: 'Usta', role: 'worker', companyId: DEMO_COMPANY_ID };
    let state = emptyState();
    state = applyCommand(state, { requestId: 'p0', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'p1', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 5000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'p2', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);

    state = applyCommand(state, { requestId: 'p3', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 400000, account: 'cash', kind: 'advance', note: 'Dastlabki avans', allowPrepay: false } }, admin);
    const advance = state.cash.at(-1)!;
    expect(advance).toMatchObject({ direction: 'out', source: 'payroll', sourceId: employeeId, category: 'advance', note: 'Dastlabki avans' });
    expect(payrollDebt(state, employeeId)).toBe(800000);

    const same = applyCommand(state, { requestId: 'p3', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 999999, account: 'cash', kind: 'advance', note: 'boshqa', allowPrepay: false } }, admin);
    expect(same).toEqual(state);

    expect(() => applyCommand(state, { requestId: 'p4', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 9000000, account: 'cash', kind: 'payroll', note: '', allowPrepay: false } }, admin))
      .toThrow('Payment exceeds payable');
    expect(() => applyCommand(state, { requestId: 'p5', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 4700000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Insufficient account balance');
    expect(() => applyCommand(state, { requestId: 'p6', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 0, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Amount must be positive');
    expect(() => applyCommand(state, { requestId: 'pa', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 100, account: 'cash', kind: 'bonus' as unknown as 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Invalid salary payment kind');
    expect(() => applyCommand(state, { requestId: 'pb', expectedRevision: 4, command: { type: 'salary.pay', employeeId: 'nobody', amount: 100, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Employee not found');

    state = applyCommand(state, { requestId: 'p7', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 1000000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin);
    expect(salaryLedger(state, employeeId).prepaid).toBe(200000);
    expect(payrollDebt(state, employeeId)).toBe(0);
    expect(state.cash.at(-1)).toMatchObject({ source: 'payroll', sourceId: employeeId, category: 'payroll', note: '' });

    expect(() => applyCommand(state, { requestId: 'p8', expectedRevision: 5, command: { type: 'salary.pay', employeeId, amount: 1000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, worker))
      .toThrow('Administrator action required');
  });

  it('accepts a 200 character note and stores it trimmed', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const atLimit = 'x'.repeat(200);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'n1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'n2', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 5000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'n3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);

    // Граница: ровно 200 символов проходит и сохраняется целиком.
    state = applyCommand(state, { requestId: 'n4', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 100, account: 'cash', kind: 'advance', note: atLimit, allowPrepay: false } }, admin);
    expect(state.cash.at(-1)).toMatchObject({ source: 'payroll', sourceId: employeeId, category: 'advance', note: atLimit });

    // Потолок считается по обрезанной строке: 200 символов + хвост пробелов — всё ещё 200,
    // а в кассу ложится обрезанное значение.
    state = applyCommand(state, { requestId: 'n5', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 100, account: 'cash', kind: 'payroll', note: `${atLimit}   `, allowPrepay: false } }, admin);
    expect(state.cash.at(-1)).toMatchObject({ source: 'payroll', sourceId: employeeId, category: 'payroll', note: atLimit });
  });

  it('rejects a salary payment note longer than 200 characters', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'm1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'm2', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 5000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'm3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);

    expect(() => applyCommand(state, { requestId: 'm4', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 100, account: 'cash', kind: 'advance', note: 'x'.repeat(201), allowPrepay: false } }, admin))
      .toThrow('Note is too long');
    // Обрезка идёт до проверки: 201 символ плюс пробелы всё равно длинна 201.
    expect(() => applyCommand(state, { requestId: 'm5', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 100, account: 'cash', kind: 'payroll', note: `${'x'.repeat(201)}  `, allowPrepay: false } }, admin))
      .toThrow('Note is too long');
    expect(state.cash).toHaveLength(1);
  });

  it('records the leaving date, keeps the ex-worker payable and restores it on reversal', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'd1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'd2', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 3000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'd3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);
    state = applyCommand(state, { requestId: 'd4', expectedRevision: 3, command: { type: 'employee.update', employeeId, name: 'Usta', active: false, deactivatedAt: `${thisMonth}-15` } }, admin);
    expect(state.employees[0]).toMatchObject({ active: false, deactivatedAt: `${thisMonth}-15` });

    // Число дней в месяце и день прогона меняют сумму, поэтому проверка — на интервале, а не на константе.
    const payable = payrollDebt(state, employeeId);
    expect(payable).toBeGreaterThan(0);
    expect(payable).toBeLessThanOrEqual(1200000);

    state = applyCommand(state, { requestId: 'd5', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: payable, account: 'cash', kind: 'payroll', note: 'Ishdan chiqqanda qoldiq', allowPrepay: false } }, admin);
    expect(payrollDebt(state, employeeId)).toBe(0);

    const paymentId = state.cash.at(-1)!.id;
    state = applyCommand(state, { requestId: 'd6', expectedRevision: 5, command: { type: 'cash.reverse', entryId: paymentId, note: 'Notog‘ri to‘lov' } }, admin);
    expect(payrollDebt(state, employeeId)).toBe(payable);

    state = applyCommand(state, { requestId: 'd7', expectedRevision: 6, command: { type: 'employee.update', employeeId, name: 'Usta', active: true } }, admin);
    expect(state.employees[0].deactivatedAt).toBeNull();
    expect(() => applyCommand(state, { requestId: 'd8', expectedRevision: 7, command: { type: 'employee.update', employeeId, name: 'Usta', active: false, deactivatedAt: '2026-13-45' } }, admin))
      .toThrow('Invalid deactivation date');

    // Без даты увольнения деактивация берёт сегодняшний день.
    state = applyCommand(state, { requestId: 'd9', expectedRevision: 7, command: { type: 'employee.update', employeeId, name: 'Usta', active: false } }, admin);
    expect(state.employees[0]).toMatchObject({ active: false, deactivatedAt: new Date().toISOString().slice(0, 10) });
  });

  it('reports only the command-written plan in payrollDebt', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 5)).toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'c1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    const employeeId = state.employees[0].id;
    state.payroll.push({ id: 'c-p1', employeeId, reportId: 'r', orderId: 'o', taskId: 't',
      amount: 340000, status: 'accepted', createdAt: `${prevMonth}-05T09:00:00.000Z` });
    expect(payrollDebt(state, employeeId)).toBe(0);

    state = applyCommand(state, { requestId: 'c2', expectedRevision: 1, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(1);
    expect(payrollDebt(state, employeeId)).toBe(1200000);
    expect(payrollDebt(state, employeeId)).toBe(salaryLedger(state, employeeId).owed);
  });

  it('keeps the legacy payroll and supplier cash categories untouched', () => {
    const f = production();
    const thisMonth = new Date().toISOString().slice(0, 7);
    let state = funds(report(f.state, f.orderId, f.taskId, 10), 100);
    state = run(state, { type: 'salary.plan.set', employeeId: f.employeeId, amount: 100, fromMonth: thisMonth });
    state = run(state, { type: 'payroll.pay', employeeId: f.employeeId, amount: 7, account: 'cash' });
    expect(state.cash.at(-1)).toMatchObject({ direction: 'out', source: 'payroll', sourceId: f.employeeId, category: 'payroll', note: '' });
    state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 40, account: 'cash' });
    expect(state.cash.at(-1)).toMatchObject({ direction: 'out', source: 'supplier', sourceId: f.supplierId, category: 'supplier', note: '' });
  });
});

describe('validation', () => {
  it('requires a route and caps finite values and aggregate balances safely', () => {
    const f = fixture();
    const blank = run(f.state, { type: 'order.create', input: { ...f.input, route: [] } });
    atomic(blank, { type: 'order.launch', orderId: blank.orders.at(-1)!.id });
    atomic(f.state, { type: 'order.create', input: { ...f.input, price: 1e12 + 1 } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, qty: 1e9 + 1 } });
    const full = funds(emptyState(), 1e12);
    atomic(full, { type: 'cash.post', direction: 'in', amount: 0.01, account: 'bank', toAccount: null, category: '', note: '' });
  });

  it('rounds fractional accepted work to a cent in the stage cost', () => {
    const f = production();
    const state = report(f.state, f.orderId, f.taskId, 0.333);
    expect(state.payroll[0].amount).toBe(0.67);
    expect(payrollDebt(state, f.employeeId)).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid positive quantity %s atomically', qty => {
    const f = production();
    atomic(f.state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty, note: '' });
    atomic(f.state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: f.itemId, qty, price: 1 }] });
    atomic(f.state, { type: 'order.create', input: { ...f.input, qty } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty }] } });
    const readyState = report(report(f.state, f.orderId, f.taskId, 10), f.orderId, f.state.orders[0].route[1].id, 10);
    atomic(readyState, ship(f.orderId, qty, true));
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid cost or payment %s', value => {
    const f = fixture();
    atomic(f.state, { type: 'operation.create', name: 'Invalid', unit: 'piece', salePrice: value, workerRate: 0, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
    atomic(f.state, { type: 'item.create', name: 'Invalid', unit: 'm', minQty: 0, cost: value, customerId: null });
    atomic(f.state, { type: 'order.create', input: { ...f.input, price: value } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, overhead: value } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, advance: value } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: value }] } });
    atomic(f.state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: f.itemId, qty: 1, price: value }] });
    atomic(f.state, { type: 'inventory.count', itemId: f.itemId, qty: value, note: '' });
    atomic(f.state, { type: 'cash.post', direction: 'in', amount: value, account: 'cash', toAccount: null, category: '', note: '' });
  });

  it('rounds UZS monetary values to two decimals and rejects zero-sized rounded payments', () => {
    let state = funds(emptyState(), 1.005);
    expect(state.cash[0].amount).toBe(1.01);
    state = funds(state, 0.104);
    expect(cashBalance(state, 'cash')).toBe(1.11);
    state = run(state, { type: 'cash.post', direction: 'out', amount: 0.105, account: 'cash', toAccount: null, category: '', note: '' });
    expect(state.cash.at(-1)!.amount).toBe(0.11);
    expect(cashBalance(state, 'cash')).toBe(1);
    atomic(state, { type: 'cash.post', direction: 'in', amount: 0.001, account: 'cash', toAccount: null, category: '', note: '' });
    atomic(state, { type: 'cash.post', direction: 'in', amount: 0, account: 'cash', toAccount: null, category: '', note: '' });
    const f = fixture();
    state = run(f.state, { type: 'operation.create', name: 'Rounded operation', unit: 'piece', salePrice: 2.345, workerRate: 2.345, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
    expect(state.operations.at(-1)!.salePrice).toBe(2.35);
    expect(state.operations.at(-1)!.workerRate).toBe(2.35);
  });

  it('checks every command reference instead of creating dangling relationships', () => {
    const f = production();
    const state = funds(f.state, 100);
    const commands: Command[] = [
      { type: 'item.create', name: 'Missing owner', unit: 'm', minQty: 0, cost: 0, customerId: 'missing' },
      { type: 'customer.receive', itemId: 'missing', qty: 1, note: '' },
      { type: 'order.create', input: { ...f.input, customerId: 'missing' } },
      { type: 'order.create', input: { ...f.input, materials: [{ itemId: 'missing', qty: 1 }] } },
      { type: 'order.create', input: { ...f.input, route: [{ operationId: 'missing', employeeId: f.employeeId, rate: 1 }] } },
      { type: 'order.create', input: { ...f.input, route: [{ operationId: f.operationId, employeeId: 'missing', rate: 1 }] } },
      { type: 'order.launch', orderId: 'missing' },
      { type: 'order.issue', orderId: 'missing' },
      { type: 'order.cancel', orderId: 'missing' },
      { type: 'customer.pay', customerId: 'missing', amount: 1, account: 'cash' },
      { type: 'work.submit', orderId: 'missing', taskId: f.taskId, qty: 1, note: '' },
      { type: 'work.submit', orderId: f.orderId, taskId: 'missing', qty: 1, note: '' },
      { type: 'work.review', reportId: 'missing', accept: true },
      { type: 'purchase.create', supplierId: 'missing', lines: [{ itemId: f.itemId, qty: 1, price: 1 }] },
      { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: 'missing', qty: 1, price: 1 }] },
      { type: 'purchase.receive', purchaseId: 'missing', lines: [{ lineId: 'missing', qty: 1 }] },
      { type: 'purchase.receive', purchaseId: state.purchases[0].id, lines: [{ lineId: 'missing', qty: 1 }] },
      { type: 'supplier.pay', supplierId: 'missing', amount: 1, account: 'cash' },
      { type: 'payroll.pay', employeeId: 'missing', amount: 1, account: 'cash' },
      { type: 'inventory.count', itemId: 'missing', qty: 0, note: '' },
      { type: 'cash.reverse', entryId: 'missing', note: '' },
      ship('missing', 1, true),
      { type: 'shipment.deliver', shipmentId: 'missing' },
    ];
    for (const command of commands) atomic(state, command);
    expect(availableTask(state, 'missing', f.taskId)).toBe(false);
    expect(availableTask(state, f.orderId, 'missing')).toBe(false);
  });

  it('rejects blank and duplicate normalized names and duplicate material or purchase lines', () => {
    const f = fixture();
    atomic(f.state, { type: 'customer.create', name: ' first CUSTOMER ', phone: '', address: '', kind: 'customer' });
    atomic(f.state, { type: 'supplier.create', name: 'SUPPLIER', phone: '' });
    atomic(f.state, { type: 'employee.create', name: 'cutter' });
    atomic(f.state, { type: 'operation.create', name: ' CUT ', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
    atomic(f.state, { type: 'item.create', name: 'fabric', unit: 'm', minQty: 0, cost: 1, customerId: null });
    atomic(f.state, { type: 'employee.create', name: ' ' });
    atomic(f.state, { type: 'item.create', name: 'New', unit: ' ', minQty: 0, cost: 1, customerId: null });
    atomic(f.state, { type: 'order.create', input: { ...f.input, title: ' ' } });
    atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 1 }, { itemId: f.itemId, qty: 1 }] } });
    atomic(f.state, { type: 'purchase.create', supplierId: f.supplierId, lines: [{ itemId: f.itemId, qty: 1, price: 1 }, { itemId: f.itemId, qty: 1, price: 2 }] });
    atomic(f.state, { type: 'purchase.create', supplierId: f.supplierId, lines: [] });
    const state = run(f.state, { type: 'item.create', name: 'Fabric', unit: 'm', minQty: 0, cost: 0, customerId: f.customerId });
    expect(state.items).toHaveLength(3);
  });

  it('stores machine economics and operation authorization', () => {
    let state = emptyState();
    state = run(state, { type: 'machine.create', name: 'Format kesish', hourlyRevenueTarget: 200000 });
    const machine = state.machines[0];
    state = run(state, { type: 'employee.create', name: 'Operator' });
    state = run(state, {
      type: 'operation.create', name: 'Kesish', unit: 'sheet', salePrice: 50000,
      workerRate: 5000, standardMinutes: 15, machineId: machine.id,
      employeeIds: [state.employees[0].id], active: true, autoAccept: false,
    });
    expect(state.operations[0]).toMatchObject({
      unit: 'sheet', salePrice: 50000, workerRate: 5000,
      standardMinutes: 15, machineId: machine.id,
    });
    expect(state.operations[0].employeeIds).toEqual([state.employees[0].id]);
  });

  it('rejects invalid machine and operation catalog changes atomically', () => {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Operator' });
    const employeeId = state.employees[0].id;
    atomic(state, { type: 'machine.create', name: 'Bad', hourlyRevenueTarget: -1 });
    state = run(state, { type: 'machine.create', name: 'Saw', hourlyRevenueTarget: 200000 });
    const machineId = state.machines[0].id;
    const operation = {
      type: 'operation.create' as const, name: 'Cut', unit: 'sheet' as const,
      salePrice: 50000, workerRate: 5000, standardMinutes: 15,
      machineId, employeeIds: [employeeId], active: true, autoAccept: false,
    };
    atomic(state, { ...operation, salePrice: -1 });
    atomic(state, { ...operation, workerRate: -1 });
    atomic(state, { ...operation, standardMinutes: -1 });
    atomic(state, { ...operation, machineId: 'missing' });
    atomic(state, { ...operation, employeeIds: ['missing'] });
    atomic(state, operation, { id: 'worker', name: 'Worker', role: 'worker', companyId: state.companyId });
    state = run(state, operation);
    const operationId = state.operations[0].id;
    state = run(state, { ...operation, type: 'operation.update', operationId, name: 'Cut 2', active: false });
    expect(state.operations[0]).toMatchObject({ name: 'Cut 2', active: false });
    state = run(state, { type: 'machine.update', machineId, name: 'Saw 2', hourlyRevenueTarget: 250000, active: false });
    expect(state.machines[0]).toMatchObject({ name: 'Saw 2', hourlyRevenueTarget: 250000, active: false });
  });

  it('keeps inactive operations and unauthorized workers out of new orders', () => {
    const f = fixture();
    atomic(f.state, {
      type: 'order.create',
      input: { ...f.input, route: [{ operationId: f.operationId, employeeId: f.otherEmployeeId, rate: 2 }] },
    });
    const paused = run(f.state, {
      type: 'operation.update', operationId: f.operationId, name: 'Cut', unit: 'piece',
      salePrice: 2, workerRate: 2, standardMinutes: 0, machineId: null,
      employeeIds: [f.employeeId], active: false, autoAccept: false,
    });
    atomic(paused, { type: 'order.create', input: f.input });
  });

  it('validates runtime accounts, roles and transfer destinations', () => {
    const state = funds(emptyState(), 100);
    atomic(state, { type: 'cash.post', direction: 'transfer', amount: 10, account: 'cash', toAccount: null, category: '', note: '' });
    atomic(state, { type: 'cash.post', direction: 'in', amount: 10, account: 'cash', toAccount: 'bank', category: '', note: '' });
    atomic(state, { type: 'cash.post', direction: 'in', amount: 10, account: 'invalid' as 'cash', toAccount: null, category: '', note: '' });
    atomic(state, { type: 'employee.create', name: 'Invalid actor' }, { ...admin, role: 'invalid' as 'admin' });
    atomic(state, { type: 'employee.create', name: 'Invalid actor' }, { ...admin, id: '' });
  });

  it('quick-edits employees, items and a draft order with validation', () => {
    const f = fixture();
    let state = run(f.state, { type: 'employee.update', employeeId: f.otherEmployeeId, name: 'Senior assembler', active: false });
    expect(state.employees[1]).toMatchObject({ name: 'Senior assembler', active: false });
    atomic(state, { type: 'employee.update', employeeId: f.employeeId, name: 'SENIOR ASSEMBLER', active: true });
    atomic(state, { type: 'employee.update', employeeId: 'missing', name: 'Ghost', active: true });
    atomic(state, { type: 'employee.update', employeeId: f.employeeId, name: 'Cutter', active: 'yes' as unknown as boolean });

    state = run(state, { type: 'item.update', itemId: f.itemId, name: 'Fabric 2', unit: 'm', minQty: 2, salePrice: 12, category: '01.01' });
    expect(state.items[0]).toMatchObject({ name: 'Fabric 2', minQty: 2, salePrice: 12, category: '01.01', cost: 5 });
    atomic(state, { type: 'item.update', itemId: f.itemId, name: 'Fabric 2', unit: 'm', minQty: 2, salePrice: 12, category: '1.1' });
    atomic(state, { type: 'item.update', itemId: f.itemId, name: 'thread', unit: 'm', minQty: 2, salePrice: 12, category: null });
    atomic(state, { type: 'item.update', itemId: f.itemId, name: 'Fabric 2', unit: 'm', minQty: 2, salePrice: -1, category: null });

    state = run(state, { type: 'employee.update', employeeId: f.otherEmployeeId, name: 'Senior assembler', active: true });
    state = receivePurchase(state, f.otherItemId, 10, 1);
    state = run(state, { type: 'order.create', input: f.input });
    const orderId = state.orders[0].id;
    state = run(state, {
      type: 'order.update', orderId, title: 'Uniforms 2', qty: 6, price: 900, overhead: 30,
      dueDate: '2026-12-01', materials: [{ itemId: f.otherItemId, qty: 3 }],
      route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 4 }],
    });
    expect(state.orders[0]).toMatchObject({ title: 'Uniforms 2', qty: 6, price: 900, overhead: 30, dueDate: '2026-12-01' });
    expect(state.orders[0].materials).toHaveLength(1);
    expect(state.orders[0].materials[0]).toMatchObject({ itemId: f.otherItemId, qty: 3, issuedQty: 0 });
    expect(state.orders[0].route).toHaveLength(1);
    expect(state.orders[0].route[0]).toMatchObject({ planned: 6, rate: 4, status: 'assigned' });
    expect(estimatedCost(state, state.orders[0])).toBe(3 * 1 + 6 * 4 + 30);
    atomic(state, { type: 'order.update', orderId, title: 'Bad', qty: 0, price: 900, overhead: 0, dueDate: '', materials: [], route: [] });
    atomic(state, {
      type: 'order.update', orderId, title: 'Bad', qty: 1, price: 900, overhead: 0, dueDate: '',
      materials: [], route: [{ operationId: f.operationId, employeeId: f.otherEmployeeId, rate: 1 }],
    });
    state = run(state, { type: 'order.launch', orderId });
    state = run(state, {
      type: 'order.update', orderId, title: 'Late', qty: 1, price: 900, overhead: 0, dueDate: '',
      materials: [], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 1 }],
    });
    expect(state.orders[0]).toMatchObject({ title: 'Late', qty: 1, status: 'production' });
    expect(state.orders[0].materials).toHaveLength(0);
    expect(state.orders[0].route).toHaveLength(1);
    expect(state.orders[0].route[0]).toMatchObject({ planned: 1, rate: 1, status: 'assigned' });
  });

  it('rejects invalid warehouse categories when creating items', () => {
    const f = fixture();
    atomic(f.state, { type: 'item.create', name: 'Bad category', unit: 'm', minQty: 0, cost: 1, customerId: null, category: '01' });
    const state = run(f.state, { type: 'item.create', name: 'Categorized', unit: 'm', minQty: 0, cost: 1, customerId: null, category: '03.02' });
    expect(state.items.at(-1)).toMatchObject({ category: '03.02' });
  });
});

function seriesCatalog() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Buyer', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Assembler' });
  state = run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
  state = run(state, {
    type: 'operation.create', name: 'Assemble', unit: 'piece', salePrice: 100, workerRate: 10,
    standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: false,
  });
  state = run(state, { type: 'item.create', kind: 'material', name: 'LDSP', unit: 'sheet', minQty: 0, cost: 0, salePrice: 0, customerId: null });
  state = run(state, { type: 'item.create', kind: 'material', name: 'Fasad A', unit: 'piece', minQty: 0, cost: 0, salePrice: 0, customerId: null });
  state = run(state, { type: 'item.create', kind: 'material', name: 'Fasad B', unit: 'piece', minQty: 0, cost: 0, salePrice: 0, customerId: null });
  state = run(state, { type: 'item.create', kind: 'blank', name: 'Korpus', unit: 'piece', minQty: 0, cost: 0, salePrice: 0, customerId: null });
  state = run(state, { type: 'item.create', kind: 'finished', name: 'Shkaf', unit: 'piece', minQty: 0, cost: 0, salePrice: 0, customerId: null });
  state = receivePurchase(state, state.items[0].id, 20, 40000);
  state = receivePurchase(state, state.items[1].id, 10, 20000);
  state = receivePurchase(state, state.items[2].id, 10, 25000);
  state = run(state, {
    type: 'recipe.create', outputItemId: itemId(state, 'Korpus'), name: 'Korpus',
    components: [{ slot: 'Panel', itemId: state.items[0].id, allowedItemIds: [], qtyPerUnit: 1 }],
  });
  state = run(state, {
    type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
    components: [
      { slot: 'Korpus', itemId: itemId(state, 'Korpus'), allowedItemIds: [], qtyPerUnit: 1 },
      { slot: 'Fasad', itemId: null, allowedItemIds: [state.items[1].id, state.items[2].id], qtyPerUnit: 1 },
    ],
  });
  return state;
}

function itemId(state: State, name: string): string {
  return state.items.find(item => item.name === name)!.id;
}

function seriesRoute(state: State) {
  return [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 10 }];
}

function blankSeriesReady(): State {
  let state = seriesCatalog();
  const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Korpus'))!;
  state = run(state, { type: 'series.create', input: {
    outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 5,
    dueDate: '2026-11-10', substitutions: {}, route: seriesRoute(state),
  } });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return state;
}

function finishedSeriesReady(state: State, _blankItemId: string): State {
  const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Shkaf'))!;
  state = run(state, { type: 'series.create', input: {
    outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 2,
    dueDate: '2026-11-12', substitutions: { Fasad: itemId(state, 'Fasad A') }, route: seriesRoute(state),
  } });
  const orderId = state.orders.at(-1)!.id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return state;
}

function completeLastTask(state: State, order: State['orders'][number]): State {
  for (const task of order.route) {
    if (taskState(state, order.id, task.id) === 'completed') continue;
    state = startWork(state, order.id, task.id);
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned - task.completed, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
  }
  return state;
}

describe('series production and stock receipt', () => {
  it('receives a blank and carries its cost into the finished product', () => {
    let state = blankSeriesReady();
    const blankOrder = state.orders[0];
    state = completeLastTask(state, blankOrder);
    const blank = state.items.find(i => i.id === blankOrder.outputItemId)!;
    const expectedBlankCost = actualSeriesCost(state, blankOrder) / blankOrder.qty;
    expect(stockQty(state, blank.id)).toBe(blankOrder.qty);
    expect(blank.cost).toBe(expectedBlankCost);
    expect(state.movements.filter(row => row.source === 'production' && row.sourceId === blankOrder.id)).toHaveLength(1);

    state = finishedSeriesReady(state, blank.id);
    const finishedOrder = state.orders.at(-1)!;
    state = completeLastTask(state, finishedOrder);
    const finished = state.items.find(i => i.id === finishedOrder.outputItemId)!;
    expect(stockQty(state, finished.id)).toBe(finishedOrder.qty);
    expect(state.movements.filter(row => row.source === 'production' && row.sourceId === finishedOrder.id)).toHaveLength(1);
    expect(actualSeriesCost(state, finishedOrder)).toBeGreaterThanOrEqual(expectedBlankCost);
    expect(finished.cost).toBe(actualSeriesCost(state, finishedOrder) / finishedOrder.qty);
  });

  it('does not receive output before every stage is accepted', () => {
    let state = seriesCatalog();
    const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Korpus'))!;
    state = run(state, { type: 'series.create', input: {
      outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 3,
      dueDate: '2026-11-10', substitutions: {},
      route: [
        { operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 10 },
        { operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 10 },
      ],
    } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    state = run(state, { type: 'order.issue', orderId });
    state = completeLastTask(state, { ...state.orders[0], route: [state.orders[0].route[0]] });
    expect(state.orders[0].status).toBe('production');
    expect(state.movements.filter(row => row.source === 'production')).toHaveLength(0);
    state = completeLastTask(state, state.orders[0]);
    expect(state.movements.filter(row => row.source === 'production')).toHaveLength(1);
  });

  it('keeps one receipt for repeated requests and blocks selling stock output', () => {
    let state = blankSeriesReady();
    const order = state.orders[0];
    state = completeLastTask(state, order);
    expect(state.movements.filter(row => row.source === 'production' && row.sourceId === order.id)).toHaveLength(1);
    const replay = {
      requestId: state.audit.at(-1)!.id, expectedRevision: 1,
      command: { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true } as Command,
    };
    expect(applyCommand(state, replay, admin)).toEqual(state);
    expect(state.movements.filter(row => row.source === 'production')).toHaveLength(1);
    atomic(state, { type: 'customer.pay', customerId: order.customerId, amount: 1, account: 'cash' });
  });

  it('substitutes only allowed components and unlocks finished-goods orders', () => {
    let state = blankSeriesReady();
    const blankOrder = state.orders[0];
    const blank = state.items.find(row => row.id === blankOrder.outputItemId)!;

    const customerId = state.customers[0].id;
    const productInput: OrderInput = {
      kind: 'product', customerId, title: 'Ready cabinet', qty: 2, price: 500000, overhead: 0,
      dueDate: '2026-11-20', advance: 0, account: 'cash',
      materials: [{ itemId: blank.id, qty: 2 }], route: seriesRoute(state),
    };
    state = run(state, { type: 'order.create', input: productInput });
    const productOrder = state.orders.at(-1)!;

    state = completeLastTask(state, blankOrder);
    state = finishedSeriesReady(state, blank.id);
    const finishedOrder = state.orders.at(-1)!;
    expect(finishedOrder.materials.find(row => row.itemId === blank.id)?.qty).toBe(2);
    expect(finishedOrder.substitutions).toEqual({ Fasad: itemId(state, 'Fasad A') });
    expect(finishedOrder.materials.some(row => row.itemId === itemId(state, 'Fasad B'))).toBe(false);
    state = completeLastTask(state, finishedOrder);
    const finished = state.items.find(row => row.id === finishedOrder.outputItemId)!;
    expect(stockQty(state, finished.id)).toBe(2);

    state = run(state, { type: 'order.launch', orderId: productOrder.id });
    expect(state.orders.find(row => row.id === productOrder.id)?.status).toBe('production');
  });

  it('rejects forbidden or incomplete substitutions and unknown versions', () => {
    const state = seriesCatalog();
    const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Shkaf'))!;
    const base = {
      type: 'series.create' as const,
      input: {
        outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 1,
        dueDate: '2026-11-10', substitutions: {}, route: seriesRoute(state),
      },
    };
    atomic(state, { ...base, input: { ...base.input, substitutions: { Fasad: itemId(state, 'Fasad A'), Unknown: itemId(state, 'Fasad A') } } });
    atomic(state, { ...base, input: { ...base.input, substitutions: { Fasad: itemId(state, 'LDSP') } } });
    atomic(state, { ...base, input: { ...base.input, recipeVersionId: 'missing' } });
    atomic(state, { ...base, input: { ...base.input, outputItemId: itemId(state, 'Korpus') } });
    atomic(state, { ...base, input: { ...base.input, substitutions: {} } });
  });
});

type UpdateCommand = Extract<Command, { type: 'order.update' }>;

function revised(state: State, orderId: string, overrides: Partial<UpdateCommand> = {}): UpdateCommand {
  const order = state.orders.find(row => row.id === orderId)!;
  return {
    type: 'order.update', orderId,
    title: order.title, qty: order.qty, price: order.price, overhead: order.overhead, dueDate: order.dueDate,
    materials: order.materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    route: order.route.map(task => ({
      operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id,
    })),
    ...overrides,
  };
}

describe('order revisions after launch', () => {
  it('edits a launched order while keeping issued materials and started work', () => {
    const f = production();
    let state = report(f.state, f.orderId, f.taskId, 4);
    const before = state.orders[0];
    const [first, second] = before.route;
    const materialId = before.materials[0].id;
    state = run(state, revised(state, f.orderId, {
      title: 'Uniforms revised', qty: 12, price: 1200, dueDate: '2026-12-01',
      materials: [{ itemId: f.itemId, qty: 10 }, { itemId: f.otherItemId, qty: 2 }],
      route: [
        { operationId: first.operationId, employeeId: first.employeeId, rate: first.rate, taskId: first.id },
        { operationId: second.operationId, employeeId: second.employeeId, rate: 5, taskId: second.id },
        { operationId: first.operationId, employeeId: first.employeeId, rate: 2 },
      ],
    }));
    const order = state.orders[0];
    expect(order).toMatchObject({ title: 'Uniforms revised', qty: 12, price: 1200, dueDate: '2026-12-01', status: 'production' });
    expect(order.materials[0]).toMatchObject({ id: materialId, itemId: f.itemId, qty: 10, issuedQty: 10, actualCost: 5 });
    expect(order.materials[1]).toMatchObject({ itemId: f.otherItemId, qty: 2, issuedQty: 0 });
    expect(order.route[0]).toMatchObject({ id: first.id, completed: 4, planned: 12, status: 'in_progress', rate: first.rate });
    expect(order.route[1]).toMatchObject({ id: second.id, planned: 12, rate: 5, status: 'assigned' });
    expect(order.route[2]).toMatchObject({ operationId: first.operationId, employeeId: first.employeeId, planned: 12, rate: 2, status: 'assigned' });
    expect(order.route[2].id).not.toBe(first.id);
    expect(estimatedCost(state, order)).toBe(10 * 5 + 2 * 1 + 12 * 2 + 12 * 5 + 12 * 2 + 20);
  });

  it('rejects quantity below accepted work, removal of issued material and started stage changes', () => {
    const f = production();
    const state = report(f.state, f.orderId, f.taskId, 4);
    const [first, second] = state.orders[0].route;
    atomic(state, revised(state, f.orderId, { qty: 3 }));
    atomic(state, revised(state, f.orderId, { materials: [] }));
    atomic(state, revised(state, f.orderId, {
      route: [{ operationId: second.operationId, employeeId: second.employeeId, rate: second.rate }],
    }));
    atomic(state, revised(state, f.orderId, {
      route: [
        { operationId: first.operationId, employeeId: first.employeeId, rate: 9, taskId: first.id },
        { operationId: second.operationId, employeeId: second.employeeId, rate: second.rate, taskId: second.id },
      ],
    }));
  });

  it('edits unstarted stages and appends new ones before production begins', () => {
    const f = production();
    let state = f.state;
    const [first, second] = state.orders[0].route;
    state = run(state, revised(state, f.orderId, {
      route: [
        { operationId: first.operationId, employeeId: first.employeeId, rate: first.rate, taskId: first.id },
        { operationId: second.operationId, employeeId: second.employeeId, rate: 4, taskId: second.id },
        { operationId: first.operationId, employeeId: first.employeeId, rate: 2 },
      ],
    }));
    expect(state.orders[0].route.map(task => task.rate)).toEqual([2, 4, 2]);
    expect(state.orders[0].route[1].id).toBe(second.id);
    const extended = state.orders[0];
    state = run(state, revised(state, f.orderId, {
      route: [
        { operationId: extended.route[0].operationId, employeeId: extended.route[0].employeeId, rate: extended.route[0].rate, taskId: extended.route[0].id },
        { operationId: extended.route[2].operationId, employeeId: extended.route[2].employeeId, rate: extended.route[2].rate, taskId: extended.route[2].id },
      ],
    }));
    expect(state.orders[0].route.map(task => task.id)).toEqual([extended.route[0].id, extended.route[2].id]);
  });

  it('reopens a ready order when the quantity grows above accepted work', () => {
    const f = production();
    let state = report(f.state, f.orderId, f.taskId, 10);
    state = report(state, f.orderId, f.state.orders[0].route[1].id, 10);
    expect(state.orders[0].status).toBe('ready');
    state = run(state, revised(state, f.orderId, { qty: 12 }));
    expect(state.orders[0].status).toBe('production');
    expect(state.orders[0].route.map(task => task.planned)).toEqual([12, 12]);
    expect(state.orders[0].route.map(task => task.status)).toEqual(['in_progress', 'in_progress']);
    expect(state.payroll.map(row => row.amount)).toEqual([20, 30]);
  });

  it('cancels a started order, returns issued stock and keeps accepted payroll', () => {
    const f = production();
    let state = report(f.state, f.orderId, f.taskId, 4);
    expect(acceptedPayroll(state, f.employeeId)).toBe(8);
    expect(stockQty(state, f.itemId)).toBe(10);
    state = run(state, { type: 'order.cancel', orderId: f.orderId });
    expect(state.orders[0].status).toBe('cancelled');
    expect(state.orders[0].materials.every(row => row.issuedQty === 0 && row.actualCost === 0)).toBe(true);
    expect(stockQty(state, f.itemId)).toBe(20);
    expect(reservedQty(state, f.itemId)).toBe(0);
    expect(acceptedPayroll(state, f.employeeId)).toBe(8);
    expect(state.payroll).toHaveLength(1);
    expect(state.reports).toHaveLength(1);
    expect(state.movements.at(-1)).toMatchObject({
      itemId: f.itemId, direction: 'in', qty: 10, unitCost: 5, source: 'order', sourceId: f.orderId,
    });
  });

  it('cancels a ready order and keeps the whole accepted payroll', () => {
    const f = production();
    let state = report(f.state, f.orderId, f.taskId, 10);
    state = report(state, f.orderId, f.state.orders[0].route[1].id, 10);
    expect(state.orders[0].status).toBe('ready');
    state = run(state, { type: 'order.cancel', orderId: f.orderId });
    expect(state.orders[0].status).toBe('cancelled');
    expect(acceptedPayroll(state, f.employeeId)).toBe(20);
    expect(acceptedPayroll(state, f.otherEmployeeId)).toBe(30);
    expect(stockQty(state, f.itemId)).toBe(20);
    expect(state.reports).toHaveLength(2);
  });

  it('blocks revisions and cancellation after shipping', () => {
    const f = production();
    let state = report(f.state, f.orderId, f.taskId, 10);
    state = report(state, f.orderId, f.state.orders[0].route[1].id, 10);
    state = run(state, ship(f.orderId, 10, true));
    expect(state.orders[0].status).toBe('shipped');
    atomic(state, revised(state, f.orderId, { title: 'Too late' }));
    atomic(state, { type: 'order.cancel', orderId: f.orderId });
  });

  it('does not rewrite series orders manually', () => {
    const state = blankSeriesReady();
    const order = state.orders[0];
    atomic(state, revised(state, order.id, { title: 'Series revision' }));
  });
});

describe('customer kinds', () => {
  it('keeps a service customer as a separate kind', () => {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Kesish mijoz', phone: '+998 90 000 11 22', address: '', kind: 'service' });
    expect(state.customers[0]).toMatchObject({ name: 'Kesish mijoz', kind: 'service' });
  });

  it('rejects an unknown customer kind', () => {
    const state = emptyState();
    expect(() => run(state, { type: 'customer.create', name: 'Wrong', phone: '', address: '', kind: 'wholesale' as never }))
      .toThrow('Invalid customer kind');
  });
});

describe('composite customer orders', () => {
  it('creates product and service lines with separate totals and production routes', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = receive(state, f.supplierId, f.otherItemId, 10, 1);
    state = run(state, { type: 'order.create', input: {
      kind: 'composite', customerId: f.customerId, dueDate: '2026-11-10', overhead: 20, advance: 100, account: 'cash',
      lines: [
        { kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000, materials: [{ itemId: f.itemId, qty: 3 }], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] },
        { kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100, materials: [{ itemId: f.otherItemId, qty: 1 }], route: [{ operationId: f.otherOperationId, employeeId: f.otherEmployeeId, rate: 3 }] },
      ],
    } });
    const order = state.orders[0];
    expect(order.lines).toHaveLength(2);
    expect(order.lines.map(line => line.total)).toEqual([2000, 300]);
    expect(order.price).toBe(2300);
    expect(order.qty).toBe(5);
    expect(order.kind).toBe('composite');
    expect(order.materials.map(line => line.lineId)).toEqual([order.lines[0].id, order.lines[1].id]);
    expect(order.route.map(task => task.lineId)).toEqual([order.lines[0].id, order.lines[1].id]);
    expect(orderPaid(state, order.id)).toBe(100);
  });

  it('issues materials for one position without touching the other', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId, lineId: state.orders[0].lines[0].id });
    const order = state.orders[0];
    expect(order.materials.filter(row => row.lineId === order.lines[0].id).every(row => row.issuedQty === row.qty)).toBe(true);
    expect(order.materials.filter(row => row.lineId === order.lines[1].id).every(row => row.issuedQty < row.qty)).toBe(true);
    expect(stockQty(state, c.itemId)).toBe(7);
    expect(stockQty(state, c.otherItemId)).toBe(10);
  });

  it('finishes one position while the other stays in production', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const task = state.orders[0].route.find(row => row.lineId === state.orders[0].lines[0].id)!;
    state = report(state, c.orderId, task.id, 2);
    expect(state.orders[0].lines.map(line => line.status)).toEqual(['ready', 'production']);
    expect(state.orders[0].status).toBe('production');
  });

  it('ships a ready position alone and puts only its sum on the customer account', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const task = state.orders[0].route.find(row => row.lineId === state.orders[0].lines[0].id)!;
    state = report(state, c.orderId, task.id, 2);
    state = run(state, { type: 'shipment.create', orderId: c.orderId, lines: [{ lineId: state.orders[0].lines[0].id, qty: 2 }], allowDebt: true, address: 'Warehouse', dueDate: '2026-11-05' });
    const order = state.orders[0];
    expect(order.lines.map(line => line.status)).toEqual(['shipped', 'production']);
    expect(order.status).toBe('production');
    expect(state.shipments[0].lines).toHaveLength(1);
    expect(state.shipments[0].lines[0]).toMatchObject({ lineId: order.lines[0].id, qty: 2, salePrice: 1000 });
    expect(customerLedger(state, c.customerId)).toMatchObject({ shipped: 2000, debt: 2000 });
    atomic(state, { type: 'shipment.create', orderId: c.orderId, lines: [{ lineId: order.lines[1].id, qty: 1 }], allowDebt: true, address: '', dueDate: '2026-11-05' });
  });

  it('delivers positions separately and closes the order only when all are delivered', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    for (const [qty, index] of [[2, 0], [3, 1]] as const) {
      const task = state.orders[0].route[index];
      state = report(state, c.orderId, task.id, qty);
    }
    expect(state.orders[0].lines.map(line => line.status)).toEqual(['ready', 'ready']);
    expect(state.orders[0].status).toBe('ready');
    for (const [index, qty] of [[0, 2], [1, 3]] as const) {
      state = run(state, { type: 'shipment.create', orderId: c.orderId, lines: [{ lineId: state.orders[0].lines[index].id, qty }], allowDebt: true, address: 'Warehouse', dueDate: '2026-11-05' });
      state = run(state, { type: 'shipment.deliver', shipmentId: state.shipments.at(-1)!.id });
    }
    expect(state.orders[0].lines.map(line => line.status)).toEqual(['delivered', 'delivered']);
    expect(state.orders[0].status).toBe('delivered');
    expect(customerLedger(state, c.customerId)).toMatchObject({ shipped: 2300, debt: 2300, advance: 0 });
  });

  it('accepts one position work while another position is still mid-route', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const [first, second] = state.orders[0].route;
    state = report(state, c.orderId, second.id, 3);
    expect(state.orders[0].route.find(row => row.id === second.id)?.completed).toBe(3);
    expect(state.orders[0].route.find(row => row.id === first.id)?.completed).toBe(0);
  });

  it('returns a cancelled position materials and drops only its sum', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId, lineId: state.orders[0].lines[0].id });
    state = run(state, { type: 'orderLine.cancel', orderId: c.orderId, lineId: state.orders[0].lines[0].id });
    const order = state.orders[0];
    expect(order.lines.map(line => line.status)).toEqual(['cancelled', 'production']);
    expect(order.price).toBe(300);
    expect(order.qty).toBe(3);
    expect(order.materials.map(row => row.lineId)).toEqual([order.lines[1].id]);
    expect(order.route.map(row => row.lineId)).toEqual([order.lines[1].id]);
    expect(stockQty(state, c.itemId)).toBe(10);
    expect(stockQty(state, c.otherItemId)).toBe(10);
  });

  it('keeps a fractional position quantity when the order aggregates its positions', () => {
    const c = composite();
    const state = run(c.state, { type: 'order.create', input: {
      kind: 'composite', customerId: c.customerId, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'service', title: 'Frezalash', qty: 0.001, unitPrice: 100, materials: [], route: [{ operationId: c.operationId, employeeId: c.employeeId, rate: 2 }] }],
    } });
    const order = state.orders.at(-1)!;
    expect(order.lines[0].qty).toBe(0.001);
    expect(order.qty).toBe(0.001);
    expect(order.price).toBe(0.1);
  });

  it('plans and costs every production stage from its own quantity', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.create', input: {
      kind: 'product', customerId: c.customerId, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'product', title: 'Oshxona', qty: 1, unitPrice: 2000, materials: [], route: [
        { operationId: c.operationId, employeeId: c.employeeId, rate: 2, qty: 5 },
        { operationId: c.otherOperationId, employeeId: c.otherEmployeeId, rate: 3, qty: 300 },
      ] }],
    } });
    const order = state.orders.at(-1)!;
    expect(order.qty).toBe(1);
    expect(order.route.map(task => task.planned)).toEqual([5, 300]);
    expect(estimatedCost(state, order)).toBe(910);
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = report(state, order.id, order.route[0].id, 2);
    expect(state.orders.at(-1)!.route[0]).toMatchObject({ planned: 5, completed: 2, status: 'in_progress' });
    expect(state.orders.at(-1)!.status).toBe('production');
  });

  it('leaves a cancelled position out when the order launches', () => {
    const c = composite();
    let state = run(c.state, { type: 'orderLine.cancel', orderId: c.orderId, lineId: c.state.orders[0].lines[0].id });
    state = run(state, { type: 'order.launch', orderId: c.orderId });
    const order = state.orders[0];
    expect(order.lines.map(line => line.status)).toEqual(['cancelled', 'production']);
    expect(order.price).toBe(300);
    expect(order.materials.every(row => row.lineId === order.lines[1].id)).toBe(true);
  });

  it('drops a cancelled position from the order title and kind', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'orderLine.cancel', orderId: c.orderId, lineId: state.orders[0].lines[0].id });
    const order = state.orders[0];
    expect(order.title).toBe('45 gradus kesish');
    expect(order.kind).toBe('service');
  });

  it('refuses to cancel a position that already left the workshop', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const task = state.orders[0].route.find(row => row.lineId === state.orders[0].lines[0].id)!;
    state = report(state, c.orderId, task.id, 2);
    state = run(state, { type: 'shipment.create', orderId: c.orderId, lines: [{ lineId: state.orders[0].lines[0].id, qty: 2 }], allowDebt: true, address: 'Warehouse', dueDate: '2026-11-05' });
    atomic(state, { type: 'orderLine.cancel', orderId: c.orderId, lineId: state.orders[0].lines[0].id });
  });

  it('keeps a single accepted position on the legacy order shape', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
    state = run(state, { type: 'order.create', input: f.input });
    const order = state.orders[0];
    expect(order.kind).toBe('product');
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ title: 'Uniforms', qty: 10, total: 1000, status: 'draft' });
    expect(order.materials.every(row => row.lineId === order.lines[0].id)).toBe(true);
    expect(order.route.every(row => row.lineId === order.lines[0].id)).toBe(true);
  });

  it('revises positions and adds a new one without losing issued material or started work', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const order = state.orders[0];
    const productTask = order.route.find(row => row.lineId === order.lines[0].id)!;
    const serviceTask = order.route.find(row => row.lineId === order.lines[1].id)!;
    state = startWork(state, c.orderId, productTask.id);
    state = run(state, { type: 'order.update', orderId: c.orderId, overhead: 0, dueDate: '2026-11-12', lines: [
      { id: order.lines[0].id, kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1200, materials: [{ itemId: c.itemId, qty: 3 }], route: [{ operationId: productTask.operationId, employeeId: productTask.employeeId, rate: productTask.rate, taskId: productTask.id }] },
      { id: order.lines[1].id, kind: 'service', title: 'Kromka', qty: 4, unitPrice: 100, materials: [{ itemId: c.otherItemId, qty: 1 }], route: [{ operationId: serviceTask.operationId, employeeId: serviceTask.employeeId, rate: 3 }] },
      { kind: 'service', title: '45 gradus kesish', qty: 1, unitPrice: 50, materials: [], route: [{ operationId: c.operationId, employeeId: c.employeeId, rate: 2 }] },
    ] });
    const revised = state.orders[0];
    expect(revised.lines.map(line => line.title)).toEqual(['Oshxona', 'Kromka', '45 gradus kesish']);
    expect(revised.lines.map(line => line.total)).toEqual([2400, 400, 50]);
    expect(revised.price).toBe(2850);
    expect(revised.qty).toBe(7);
    expect(revised.status).toBe('production');
    expect(revised.lines[2].status).toBe('production');
    expect(revised.materials.find(row => row.itemId === c.itemId)).toMatchObject({ issuedQty: 3, qty: 3 });
    expect(revised.route.find(row => row.id === productTask.id)).toMatchObject({ status: 'in_progress', planned: 2, completed: 0 });
    expect(revised.route.filter(row => row.lineId === revised.lines[1].id)).toHaveLength(1);
    expect(revised.route.find(row => row.lineId === revised.lines[1].id)).toMatchObject({ planned: 4 });
  });

  it('refuses to drop an active position through a revision', () => {
    const c = composite();
    const order = c.state.orders[0];
    expect(() => run(c.state, { type: 'order.update', orderId: c.orderId, overhead: 0, dueDate: '2026-11-12', lines: [
      { id: order.lines[0].id, kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000, materials: [{ itemId: c.itemId, qty: 3 }], route: [{ operationId: c.operationId, employeeId: c.employeeId, rate: 2 }] },
    ] })).toThrow('Order line cannot be removed');
  });

  it('keeps the product quantity independent from accepted stage work', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const order = state.orders[0];
    const task = order.route.find(row => row.lineId === order.lines[0].id)!;
    state = report(state, c.orderId, task.id, 2);
    state = run(state, { type: 'order.update', orderId: c.orderId, overhead: 0, dueDate: '2026-11-12', lines: [
      { id: order.lines[0].id, kind: 'product', title: 'Oshxona', qty: 1, unitPrice: 1000, materials: [{ itemId: c.itemId, qty: 3 }], route: [{ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id, qty: 5 }] },
      { id: order.lines[1].id, kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100, materials: [{ itemId: c.otherItemId, qty: 1 }], route: [{ operationId: c.otherOperationId, employeeId: c.otherEmployeeId, rate: 3 }] },
    ] });
    const revised = state.orders[0];
    expect(revised.lines[0].qty).toBe(1);
    expect(revised.route.find(row => row.id === task.id)).toMatchObject({ planned: 5, completed: 2, status: 'in_progress' });
  });

  it('refuses a stage quantity below the work already accepted for it', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'order.issue', orderId: c.orderId });
    const order = state.orders[0];
    const task = order.route.find(row => row.lineId === order.lines[0].id)!;
    state = report(state, c.orderId, task.id, 2);
    expect(() => run(state, { type: 'order.update', orderId: c.orderId, overhead: 0, dueDate: '2026-11-12', lines: [
      { id: order.lines[0].id, kind: 'product', title: 'Oshxona', qty: 1, unitPrice: 1000, materials: [{ itemId: c.itemId, qty: 3 }], route: [{ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id, qty: 1 }] },
      { id: order.lines[1].id, kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100, materials: [{ itemId: c.otherItemId, qty: 1 }], route: [{ operationId: c.otherOperationId, employeeId: c.otherEmployeeId, rate: 3 }] },
    ] })).toThrow('Stage quantity is below accepted work');
  });

  it('keeps a cancelled position out of the totals of a later revision', () => {
    const c = composite();
    let state = run(c.state, { type: 'order.launch', orderId: c.orderId });
    state = run(state, { type: 'orderLine.cancel', orderId: c.orderId, lineId: state.orders[0].lines[1].id });
    state = run(state, { type: 'order.update', orderId: c.orderId, overhead: 0, dueDate: '2026-11-12', lines: [
      { id: c.state.orders[0].lines[0].id, kind: 'product', title: 'Oshxona', qty: 3, unitPrice: 1000, materials: [{ itemId: c.itemId, qty: 3 }], route: [{ operationId: c.operationId, employeeId: c.employeeId, rate: 2 }] },
    ] });
    const order = state.orders[0];
    expect(order.lines.map(line => line.status)).toEqual(['production', 'cancelled']);
    expect(order.price).toBe(3000);
    expect(order.qty).toBe(3);
  });
});

describe('draft orders without materials or stages', () => {
  function draft(f: ReturnType<typeof fixture>) {
    return run(f.state, { type: 'order.create', input: {
      kind: 'composite', customerId: f.customerId, dueDate: '', overhead: 0, advance: 0, account: 'cash',
      lines: [
        { kind: 'product', title: 'Shkaf', qty: 1, unitPrice: 0, materials: [], route: [] },
        { kind: 'service', title: 'Raskroy', qty: 1, unitPrice: 0, materials: [], route: [] },
      ],
    } });
  }

  it('accepts a composite draft whose positions have no materials or stages', () => {
    const f = fixture();
    const state = draft(f);
    const order = state.orders.at(-1)!;
    expect(order.status).toBe('draft');
    expect(order.price).toBe(0);
    expect(order.materials).toEqual([]);
    expect(order.route).toEqual([]);
    expect(order.lines.map(line => line.status)).toEqual(['draft', 'draft']);
  });

  it('keeps a stageless draft out of production', () => {
    const f = fixture();
    const state = draft(f);
    const order = state.orders.at(-1)!;
    expect(() => run(state, { type: 'order.launch', orderId: order.id })).toThrow(/bosqich/);
  });

  it('launches the draft once every position gets materials and a stage', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
    state = run(state, { type: 'order.create', input: {
      kind: 'composite', customerId: f.customerId, dueDate: '', overhead: 0, advance: 0, account: 'cash',
      lines: [
        { kind: 'product', title: 'Shkaf', qty: 1, unitPrice: 0, materials: [], route: [] },
        { kind: 'service', title: 'Raskroy', qty: 1, unitPrice: 0, materials: [], route: [] },
      ],
    } });
    const order = state.orders.at(-1)!;
    state = run(state, { type: 'order.update', orderId: order.id, overhead: 0, dueDate: '', lines: [
      { id: order.lines[0].id, kind: 'product', title: 'Shkaf', qty: 1, unitPrice: 800, materials: [{ itemId: f.itemId, qty: 2 }], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] },
      { id: order.lines[1].id, kind: 'service', title: 'Raskroy', qty: 1, unitPrice: 200, materials: [], route: [{ operationId: f.otherOperationId, employeeId: f.otherEmployeeId, rate: 3 }] },
    ] });
    state = run(state, { type: 'order.launch', orderId: order.id });
    const launched = state.orders.at(-1)!;
    expect(launched.status).toBe('production');
    expect(launched.price).toBe(1000);
    expect(launched.route).toHaveLength(2);
  });
});

describe('monthly expense plans', () => {
  it('creates a plan and returns its planId', () => {
    let state = emptyState();
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const row = state.expensePlans[0];
    expect(row.planId).toBeTruthy();
    expect(row.title).toBe('Ijara');
    expect(row.dueDay).toBe(15);
    expect(state.expensePlans).toHaveLength(1);
  });

  it('replaces a version of the same plan and month instead of stacking', () => {
    let state = emptyState();
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const planId = state.expensePlans[0].planId;
    state = run(state, { type: 'expense.plan.set', planId, title: 'Ijara', amount: 1300000, fromMonth: '2026-11', dueDay: 10, supplierId: null });
    expect(state.expensePlans).toHaveLength(1);
    expect(state.expensePlans[0].amount).toBe(1300000);
    expect(state.expensePlans[0].dueDay).toBe(10);
  });

  it('rejects an invalid month, day, amount, title and unknown supplier', () => {
    let state = emptyState();
    expect(() => run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-13', dueDay: 15, supplierId: null }))
      .toThrow('Invalid expense plan month');
    expect(() => run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 0, supplierId: null }))
      .toThrow('Invalid expense due day');
    expect(() => run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: -5, fromMonth: '2026-11', dueDay: 15, supplierId: null }))
      .toThrow('Invalid amount');
    expect(() => run(state, { type: 'expense.plan.set', planId: null, title: '  ', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }))
      .toThrow('Expense title required');
    expect(() => run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: 'no-such-supplier' }))
      .toThrow('Supplier not found');
    expect(state.expensePlans).toHaveLength(0);
  });

  it('pays within owed and refuses overpayment without the flag', () => {
    let state = emptyState();
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const planId = state.expensePlans[0].planId;
    state = run(state, { type: 'cash.post', direction: 'in', amount: 3000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' });
    expect(() => run(state, { type: 'expense.pay', planId, amount: 1300000, account: 'cash', note: '', allowPrepay: false }))
      .toThrow('Payment exceeds payable');
    state = run(state, { type: 'expense.pay', planId, amount: 1200000, account: 'cash', note: 'noyabr', allowPrepay: false });
    const entry = state.cash.at(-1)!;
    expect(entry.source).toBe('expense');
    expect(entry.sourceId).toBe(planId);
    expect(entry.category).toBe('expense');
    expect(entry.direction).toBe('out');
    expect(expenseLedger(state, planId).owed).toBe(0);
  });

  it('allows prepayment with the flag and pushes the surplus into prepaid', () => {
    let state = emptyState();
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const planId = state.expensePlans[0].planId;
    state = run(state, { type: 'cash.post', direction: 'in', amount: 3000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' });
    state = run(state, { type: 'expense.pay', planId, amount: 2000000, account: 'cash', note: 'ikki oy', allowPrepay: true });
    const ledger = expenseLedger(state, planId);
    expect(ledger.owed).toBe(0);
    expect(ledger.prepaid).toBe(800000);
  });

  it('rejects payments to a missing plan, an unknown account and a long note', () => {
    let state = emptyState();
    expect(() => run(state, { type: 'expense.pay', planId: 'no-plan', amount: 100, account: 'cash', note: '', allowPrepay: false }))
      .toThrow('Expense plan not found');
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const planId = state.expensePlans[0].planId;
    expect(() => run(state, { type: 'expense.pay', planId, amount: 100, account: 'wallet' as never, note: '', allowPrepay: false }))
      .toThrow('Invalid account');
    expect(() => run(state, { type: 'expense.pay', planId, amount: 100, account: 'cash', note: 'x'.repeat(201), allowPrepay: false }))
      .toThrow('Note is too long');
  });

  it('reverses an expense payment and returns the money to the balance', () => {
    let state = emptyState();
    state = run(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const planId = state.expensePlans[0].planId;
    state = run(state, { type: 'cash.post', direction: 'in', amount: 1000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' });
    state = run(state, { type: 'expense.pay', planId, amount: 500000, account: 'cash', note: '', allowPrepay: false });
    const entry = state.cash.at(-1)!;
    state = run(state, { type: 'cash.reverse', entryId: entry.id, note: 'xato' });
    expect(expenseLedger(state, planId).paidTotal).toBe(0);
    expect(expenseLedger(state, planId).owed).toBe(1200000);
  });

  it('acknowledges an idempotent retry of the same request', () => {
    let state = emptyState();
    state.revision = 1;
    const envelope = { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null } as Command };
    const first = applyCommand(state, envelope, admin);
    const second = applyCommand(first, envelope, admin);
    expect(second.expensePlans).toHaveLength(1);
    expect(second.revision).toBe(first.revision);
  });
});

describe('loan commands', () => {
  it('creates, draws and repays a loan with derived books', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    expect(s.loans).toHaveLength(1);
    expect(s.loans[0]).toMatchObject({ title: 'Jasur aka', kind: 'loan', amount: 10_000_000 });
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: 'Birinchi transh' });
    expect(loanLedger(s, loanId)).toMatchObject({ drawn: 6_000_000, available: 4_000_000 });
    expect(cashBalance(s, 'cash')).toBe(6_000_000);
    s = run(s, { type: 'loan.repay', loanId, amount: 2_000_000, account: 'cash', note: 'Qisman' });
    expect(loanLedger(s, loanId)).toMatchObject({ repaid: 2_000_000, owed: 8_000_000 });
    expect(cashBalance(s, 'cash')).toBe(4_000_000);
  });

  it('edits a loan in place and keeps its id and createdAt', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const { id, createdAt } = s.loans[0];
    s = run(s, { type: 'loan.set', loanId: id, title: 'Jasur aka (yangilangan)', kind: 'investment', amount: 12_000_000, note: 'Qo‘shimcha' });
    expect(s.loans).toHaveLength(1);
    expect(s.loans[0]).toMatchObject({ id, createdAt, title: 'Jasur aka (yangilangan)', kind: 'investment', amount: 12_000_000, note: 'Qo‘shimcha' });
  });

  it('validates the loan.set input', () => {
    const s = fixture().state;
    atomic(s, { type: 'loan.set', loanId: null, title: '   ', kind: 'loan', amount: 1000, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'grant' as never, amount: 1000, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'loan', amount: -1, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'loan', amount: 1000, note: 'x'.repeat(201) });
  });

  it('limits a draw to the available balance and validates the input', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    atomic(s, { type: 'loan.draw', loanId, amount: 10_000_001, account: 'cash', note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 0, account: 'cash', note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 1000, account: 'crypto' as never, note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 1000, account: 'cash', note: 'x'.repeat(201) });
    atomic(s, { type: 'loan.draw', loanId: crypto.randomUUID(), amount: 1000, account: 'cash', note: '' });
    expect(cashBalance(s, 'cash')).toBe(0);
  });

  it('limits a repayment to the owed balance and the account balance', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    atomic(s, { type: 'loan.repay', loanId, amount: 1, account: 'cash', note: '' });
    s = run(s, { type: 'loan.draw', loanId, amount: 5_000_000, account: 'cash', note: '' });
    atomic(s, { type: 'loan.repay', loanId, amount: 10_000_001, account: 'cash', note: '' });
    atomic(s, { type: 'loan.repay', loanId, amount: 5_000_001, account: 'cash', note: '' });
    expect(cashBalance(s, 'cash')).toBe(5_000_000);
  });

  it('reverses a draw and restores availability', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: '' });
    const entry = s.cash[0];
    s = run(s, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
    expect(loanLedger(s, loanId).drawn).toBe(0);
    expect(loanLedger(s, loanId).available).toBe(10_000_000);
  });

  it('refuses to reverse a loan entry after the loan was edited away', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: '' });
    const entry = s.cash[0];
    const reduced = { ...s, loans: [] };
    atomic(reduced, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
  });

  it('applies a loan command exactly once per request id', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    const envelope: Envelope = { requestId: crypto.randomUUID(), expectedRevision: s.revision, command: { type: 'loan.draw', loanId, amount: 4_000_000, account: 'cash', note: '' } };
    s = applyCommand(s, envelope, admin);
    const cashCount = s.cash.length;
    const retried = applyCommand(s, envelope, admin);
    expect(retried.cash).toHaveLength(cashCount);
    expect(loanLedger(retried, loanId).drawn).toBe(4_000_000);
  });

  it('rejects loan commands from a worker', () => {
    const f = fixture();
    atomic(f.state, { type: 'loan.set', loanId: null, title: 'X', kind: 'loan', amount: 1000, note: '' }, f.worker);
  });
});

describe('worker as customer', () => {
  function linkedWorker() {
    let state = fixture().state;
    const employeeId = state.employees[0].id;
    const operationId = state.operations[0].id;
    state = run(state, { type: 'customer.create', name: 'Usta hisobi', phone: '', address: '', kind: 'customer', employeeId });
    const customerId = state.customers.at(-1)!.id;
    state = run(state, { type: 'order.create', input: {
      kind: 'product', customerId, title: 'Uniforms', qty: 10, price: 1000, overhead: 0,
      dueDate: '2026-11-20', materials: [], route: [{ operationId, employeeId, rate: 0 }], advance: 0, account: 'cash',
    } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    state = report(state, orderId, state.orders[0].route[0].id, 10);
    state = run(state, ship(orderId, 1, true));
    const debt = customerLedger(state, customerId).debt;
    const thisMonth = new Date().toISOString().slice(0, 7);
    state.salaryPlans.push({ id: crypto.randomUUID(), employeeId, amount: 2000, fromMonth: thisMonth, createdAt: `${thisMonth}-01T00:00:00.000Z` });
    const owed = payrollDebt(state, employeeId);
    return { state, employeeId, customerId, debt, owed };
  }

  it('customer.create links an employee and rejects a missing or taken employee', () => {
    let state = fixture().state;
    const employeeId = state.employees[0].id;
    state = run(state, { type: 'customer.create', name: 'Usta hisobi', phone: '', address: '', kind: 'customer', employeeId });
    const row = state.customers.find(customer => customer.employeeId === employeeId)!;
    expect(row.name).toBe('Usta hisobi');
    atomic(state, { type: 'customer.create', name: 'Ghost', phone: '', address: '', kind: 'customer', employeeId: 'missing' });
    expect(() => run(state, { type: 'customer.create', name: 'Ghost', phone: '', address: '', kind: 'customer', employeeId }))
      .toThrow('Employee already has a customer account');
  });

  it('customer.link attaches and detaches the link', () => {
    let state = fixture().state;
    const customerId = state.customers[0].id;
    const otherCustomerId = state.customers[1].id;
    const employeeId = state.employees[0].id;
    const otherId = state.employees[1].id;
    state = run(state, { type: 'customer.link', customerId, employeeId });
    expect(state.customers[0].employeeId).toBe(employeeId);
    state = run(state, { type: 'customer.link', customerId: otherCustomerId, employeeId: otherId });
    expect(state.customers[1].employeeId).toBe(otherId);
    atomic(state, { type: 'customer.link', customerId, employeeId: otherId });
    atomic(state, { type: 'customer.link', customerId, employeeId: 'missing' });
    atomic(state, { type: 'customer.link', customerId: 'missing', employeeId: null });
    const detached = run(state, { type: 'customer.link', customerId, employeeId: null });
    expect(detached.customers[0].employeeId).toBeNull();  });

  it('salary.deduct offsets both ledgers and enforces both caps', () => {
    const { state: initial, employeeId, customerId, debt, owed } = linkedWorker();
    expect(debt).toBe(100);
    expect(owed).toBe(2000);
    const amount = Math.min(debt, owed, 500);
    const state = run(initial, { type: 'salary.deduct', employeeId, amount, note: 'Material uchun' });
    const deductionId = state.workerDeductions.at(-1)!.id;
    expect(state.workerDeductions.find(row => row.id === deductionId)).toMatchObject({
      employeeId, customerId, amount, direction: 'deduct', reversalOf: null,
    });
    expect(customerLedger(state, customerId).debt).toBe(debt - amount);
    expect(payrollDebt(state, employeeId)).toBe(owed - amount);
    atomic(state, { type: 'salary.deduct', employeeId, amount: 0, note: '' });
    atomic(state, { type: 'salary.deduct', employeeId, amount: debt + 1, note: '' });
    atomic(state, { type: 'salary.deduct', employeeId, amount: owed + 1, note: '' });
  });

  it('salary.deduct rejects a worker without a customer account', () => {
    const state = fixture().state;
    atomic(state, { type: 'salary.deduct', employeeId: state.employees[0].id, amount: 100, note: '' });
  });

  it('salary.deduct.reverse restores both ledgers and cannot run twice', () => {
    const { state: initial, employeeId, customerId, debt, owed } = linkedWorker();
    const amount = Math.min(debt, owed);
    const deducted = run(initial, { type: 'salary.deduct', employeeId, amount, note: 'Material uchun' });
    const deductionId = deducted.workerDeductions.at(-1)!.id;
    const state = run(deducted, { type: 'salary.deduct.reverse', deductionId });
    const refundId = state.workerDeductions.at(-1)!.id;
    expect(state.workerDeductions.find(row => row.id === refundId)).toMatchObject({
      employeeId, customerId, amount, direction: 'refund', reversalOf: deductionId,
    });
    expect(customerLedger(state, customerId).debt).toBe(debt);
    expect(payrollDebt(state, employeeId)).toBe(owed);
    atomic(state, { type: 'salary.deduct.reverse', deductionId });
    atomic(state, { type: 'salary.deduct.reverse', deductionId: 'missing' });
  });

  it('salary.deduct is admin-only', () => {
    const f = fixture();
    atomic(f.state, { type: 'salary.deduct', employeeId: f.employeeId, amount: 100, note: '' }, f.worker);
    atomic(f.state, { type: 'customer.link', customerId: f.customerId, employeeId: f.employeeId }, f.worker);
  });
});

it('demo seed keeps the worker deduction within salary owed and customer debt', () => {
  const state = createDemo(admin);
  const worker = state.employees.find(row => row.name === 'Yig‘uvchi')!;
  const customer = state.customers.find(row => row.employeeId === worker.id)!;
  const deduction = state.workerDeductions.find(row => row.employeeId === worker.id)!;
  expect(customerLedger(state, customer.id).debt).toBeGreaterThanOrEqual(deduction.amount);
  expect(payrollDebt(state, worker.id)).toBeGreaterThanOrEqual(deduction.amount);
});

it('seeds one unaccepted outsourced stage without payroll or stock', () => {
  const state = createDemo(admin);
  const contractor = state.suppliers.find(row => row.name === 'Pudratchi Metall');
  expect(contractor).toBeDefined();
  const operation = state.operations.find(row => row.name === 'Metall ish');
  expect(operation).toMatchObject({ employeeIds: [], active: true, autoAccept: true });
  const task = state.orders.flatMap(order => order.route).find(row => row.executorKind === 'supplier');
  expect(task).toMatchObject({
    supplierId: contractor!.id, employeeId: null, status: 'assigned',
    completed: 0, planned: 1, rate: 0, supplierCost: 500000,
  });
  const order = state.orders.find(row => row.route.some(stage => stage.id === task!.id))!;
  expect(order.status).toBe('production');
  expect(order.materials).toEqual([]);
  expect(state.payroll.some(row => row.taskId === task!.id)).toBe(false);
  expect(state.reports.some(row => row.taskId === task!.id)).toBe(false);
  expect(state.movements.some(row => row.sourceId === task!.id)).toBe(false);
  expect(state.cash.some(row => row.source === 'supplier' && row.category === 'outsourcing')).toBe(false);
});

describe('operation norms', () => {
  function normFixture() {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Client paint', unit: 'litr', minQty: 0, cost: 0, customerId: state.customers[0].id });
    return state;
  }
  const base = (state: State) => ({
    name: 'Paint', unit: 'squareMeter' as const, salePrice: 50, workerRate: 20, standardMinutes: 0,
    machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true,
  });

  it('defaults norms to an empty array when omitted', () => {
    const state = normFixture();
    const next = run(state, { type: 'operation.create', ...base(state) });
    expect(next.operations[0].norms).toEqual([]);
  });

  it('stores valid norms', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    const next = run(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }] });
    expect(next.operations[0].norms).toEqual([{ itemId, qtyPerM2: 0.2 }]);
  });

  it('rejects duplicate norm items', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }, { itemId, qtyPerM2: 0.3 }] });
  });

  it('rejects an unknown norm item', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: 'missing', qtyPerM2: 0.2 }] });
  });

  it('rejects a customer-owned norm item', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: state.items[1].id, qtyPerM2: 0.2 }] });
  });

  it('rejects non-positive qtyPerM2', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: state.items[0].id, qtyPerM2: 0 }] });
  });

  it('updates norms on operation.update', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    let next = run(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }] });
    next = run(next, { type: 'operation.update', operationId: next.operations[0].id, ...base(next), norms: [{ itemId, qtyPerM2: 0.5 }] });
    expect(next.operations[0].norms).toEqual([{ itemId, qtyPerM2: 0.5 }]);
  });
});

describe('area cost helpers', () => {
  it('areaLaborCost rounds rate × area', () => {
    expect(areaLaborCost(20, 3)).toBe(60);
    expect(areaLaborCost(0.333, 3)).toBe(1);
  });
  it('areaMaterialCost sums rounded norm × area × cost', () => {
    const norms = [{ itemId: 'a', qtyPerM2: 0.2 }, { itemId: 'b', qtyPerM2: 0.1 }];
    expect(areaMaterialCost(norms, 10, id => (id === 'a' ? 100 : 50))).toBe(250);
  });
});

describe('norm materials on order creation', () => {
  function paintFixture() {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
    const employeeId = state.employees[0].id;
    state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
    state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
    return state;
  }
  const paintInput = (state: State) => ({
    kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
    overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
    materials: [] as { itemId: string; qty: number }[], route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 10 }],
  });

  it('adds norm materials for a squareMeter stage', () => {
    const state = paintFixture();
    const next = run(state, { type: 'order.create', input: paintInput(state) });
    const order = next.orders[0];
    const paint = order.materials.find(row => row.itemId === state.items[0].id)!;
    const hardener = order.materials.find(row => row.itemId === state.items[1].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.estimatedCost).toBe(100);
    expect(paint.issuedQty).toBe(0);
    expect(hardener.qty).toBe(1);
    expect(estimatedCost(next, order)).toBe(2 * 100 + 1 * 200 + 10 * 20);
  });

  it('sums a norm item already present in manual materials', () => {
    const state = paintFixture();
    const input = paintInput(state);
    input.materials = [{ itemId: state.items[0].id, qty: 3 }];
    const next = run(state, { type: 'order.create', input });
    const paint = next.orders[0].materials.filter(row => row.itemId === state.items[0].id);
    expect(paint).toHaveLength(1);
    expect(paint[0].qty).toBe(5);
  });

  it('does not add norm materials for non-squareMeter stages', () => {
    const state = paintFixture();
    const input = paintInput(state);
    input.route = [{ operationId: state.operations[1].id, employeeId: state.employees[0].id, rate: 2, qty: 10 }];
    const next = run(state, { type: 'order.create', input });
    expect(next.orders[0].materials).toEqual([]);
  });

  it('normMaterialLines returns lines only for squareMeter tasks of the line', () => {
    const state = paintFixture();
    const next = run(state, { type: 'order.create', input: paintInput(state) });
    const order = next.orders[0];
    const lines = normMaterialLines(next, order.route, order.lines[0].id);
    expect(lines.map(row => row.itemId).sort()).toEqual([state.items[0].id, state.items[1].id].sort());
  });
});

describe('route templates', () => {
  it('creates an active template and defaults executorKind to employee', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId, rate: 5 }] });
    expect(state.routeTemplates).toHaveLength(1);
    expect(state.routeTemplates[0]).toMatchObject({ name: 'Paint', kind: 'service', active: true });
    expect(state.routeTemplates[0].stages).toEqual([{ operationId: f.operationId, executorKind: 'employee', rate: 5 }]);
  });

  it('keeps an explicit employee executor and no supplier', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId }] });
    expect(state.routeTemplates[0].stages[0].employeeId).toBe(f.employeeId);
    expect(state.routeTemplates[0].stages[0].supplierId).toBeUndefined();
  });

  it('keeps an explicit supplier executor', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Coat', kind: 'service', stages: [{ operationId: f.operationId, executorKind: 'supplier', supplierId: f.supplierId }] });
    expect(state.routeTemplates[0].stages[0].supplierId).toBe(f.supplierId);
  });

  it('rejects a duplicate name case-insensitively', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId }] });
    atomic(state, { type: 'routeTemplate.create', name: 'paint', kind: 'service', stages: [{ operationId: f.operationId }] });
  });

  it('rejects an empty stage list', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Empty', kind: 'service', stages: [] });
  });

  it('rejects an unknown or inactive operation', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: 'missing' }] });
    const inactive = run(f.state, { type: 'operation.update', operationId: f.operationId, name: 'Cut', unit: 'piece', salePrice: 2, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [f.employeeId], active: false, autoAccept: false });
    atomic(inactive, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId }] });
  });

  it('rejects a negative rate override', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, rate: -1 }] });
  });

  it('rejects an unauthorized or inactive employee', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.otherEmployeeId }] });
    const inactive = run(f.state, { type: 'employee.update', employeeId: f.employeeId, name: 'Cutter', active: false });
    atomic(inactive, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId }] });
  });

  it('rejects a supplier stage without a supplier and two executors at once', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, executorKind: 'supplier' }] });
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId, supplierId: f.supplierId }] });
  });

  it('updates a template and toggles active without hard delete', () => {
    const f = fixture();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId }] });
    const id = state.routeTemplates[0].id;
    state = run(state, { type: 'routeTemplate.update', templateId: id, name: 'Paint v2', kind: 'service', stages: [{ operationId: f.otherOperationId }], active: false });
    expect(state.routeTemplates).toHaveLength(1);
    expect(state.routeTemplates[0]).toMatchObject({ id, name: 'Paint v2', active: false });
    expect(state.routeTemplates[0].stages[0].operationId).toBe(f.otherOperationId);
  });

  it('rejects an update that collides with another template name', () => {
    const f = fixture();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'A', kind: 'service', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'B', kind: 'service', stages: [{ operationId: f.operationId }] });
    atomic(state, { type: 'routeTemplate.update', templateId: state.routeTemplates[0].id, name: 'B', kind: 'service', stages: [{ operationId: f.operationId }], active: true });
  });
});

describe('route template demo seed', () => {
  it('seeds two templates: paint service and full kitchen', () => {
    const state = createDemo(admin);
    expect(state.routeTemplates.map(t => t.name)).toEqual(['Bo‘yash xizmati', 'Oshxona pod klyuch']);
    expect(state.routeTemplates[0]).toMatchObject({ kind: 'service', active: true });
    expect(state.routeTemplates[1]).toMatchObject({ kind: 'product', active: true });
  });
});

describe('support tickets', () => {
  const context = { page: 'orders', revision: 0, sync: 'offline' as const, pending: 2, build: 'test', errors: ['Xato 1234'] };

  it('creates a ticket authored by the actor with context only on the first message', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: '  Ombor xatosi  ', context }, worker);
    const row = created.tickets[0];
    expect(created.audit.at(-1)).toMatchObject({ action: 'ticket.create', entityId: row.id, actorId: worker.id });
    expect(row).toMatchObject({
      authorId: worker.id, authorName: worker.name, authorRole: 'worker',
      status: 'open', closedAt: null, closedByName: null,
    });
    expect(row.messages).toHaveLength(1);
    expect(row.messages[0]).toMatchObject({ authorId: worker.id, text: 'Ombor xatosi', context });
    expect(row.messages[0].context).not.toBe(context);
    expect(row.createdAt).toBe(row.updatedAt);
    expect(row.messages[0].at).toBe(row.createdAt);

    const replied = run(created, { type: 'ticket.reply', ticketId: row.id, text: 'Javob' }, admin);
    expect(replied.tickets[0].messages[1]).toMatchObject({ authorRole: 'admin', text: 'Javob', context: null });
    expect(replied.audit.at(-1)).toMatchObject({ action: 'ticket.reply', entityId: row.id });
  });

  it('accepts an owner-created ticket without context', () => {
    const { state } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Eslatma', context: null });
    expect(created.tickets[0]).toMatchObject({ authorRole: 'admin', authorId: admin.id });
    expect(created.tickets[0].messages[0].context).toBeNull();
  });

  it('rejects empty, long and malformed input without mutating state', () => {
    const { state, worker } = fixture();
    atomic(state, { type: 'ticket.create', text: '   ', context: null }, worker);
    expect(() => run(state, { type: 'ticket.create', text: 'x'.repeat(2001), context: null }, worker)).toThrow('Ticket text is too long');
    expect(() => run(state, { type: 'ticket.create', text: 'x', context: { ...context, pending: 1000 } }, worker)).toThrow('Invalid ticket context');
    expect(() => run(state, { type: 'ticket.reply', ticketId: 'missing', text: 'x' }, worker)).toThrow('Ticket not found');
  });

  it('lets a worker reply only to their own ticket and never close it', () => {
    const { state, worker, otherWorker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const id = created.tickets[0].id;
    const replied = run(created, { type: 'ticket.reply', ticketId: id, text: 'Qo‘shimcha' }, worker);
    expect(replied.tickets[0].messages).toHaveLength(2);
    expect(() => run(created, { type: 'ticket.reply', ticketId: id, text: 'Begona' }, otherWorker)).toThrow('Ticket not found');
    expect(() => run(created, { type: 'ticket.close', ticketId: id }, worker)).toThrow('Administrator action required');
  });

  it('closes once, keeps updatedAt, and reopens on a reply', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const id = created.tickets[0].id;
    const closed = run(created, { type: 'ticket.close', ticketId: id }, admin);
    expect(closed.tickets[0]).toMatchObject({ status: 'closed', closedByName: admin.name });
    expect(closed.tickets[0].closedAt).toBeTruthy();
    expect(closed.tickets[0].updatedAt).toBe(created.tickets[0].updatedAt);
    expect(closed.audit.at(-1)).toMatchObject({ action: 'ticket.close', entityId: id });

    const again = run(closed, { type: 'ticket.close', ticketId: id }, admin);
    expect(again.tickets[0].updatedAt).toBe(created.tickets[0].updatedAt);
    expect(again.tickets[0].closedAt).toBe(closed.tickets[0].closedAt);

    const reopened = run(closed, { type: 'ticket.reply', ticketId: id, text: 'Yana savol' }, worker);
    expect(reopened.tickets[0]).toMatchObject({ status: 'open', closedAt: null, closedByName: null });
    expect(reopened.tickets[0].updatedAt).toBe(reopened.tickets[0].messages.at(-1)!.at);
  });

  it('rejects the 201st message', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const full = structuredClone(created);
    const row = full.tickets[0];
    const at = row.createdAt;
    row.messages = Array.from({ length: 200 }, (_, index): SupportTicket['messages'][number] => ({
      id: `m-${index}`, authorId: worker.id, authorName: worker.name, authorRole: 'worker', at, text: 'x', context: null,
    }));
    expect(() => run(full, { type: 'ticket.reply', ticketId: row.id, text: 'y' }, worker)).toThrow('Ticket is full');
  });

  it('rejects display accounts', () => {
    const { state } = fixture();
    const display: Actor = { id: 'tv', name: 'TV', role: 'display', companyId: state.companyId };
    expect(() => run(state, { type: 'ticket.create', text: 'x', context: null }, display)).toThrow('Invalid actor role');
  });
});

describe('defect materials', () => {
  it('expands square-metre norms for the rejected quantity', () => {
    const f = production();
    f.state.operations[0].unit = 'squareMeter';
    f.state.operations[0].norms = [
      { itemId: f.itemId, qtyPerM2: 0.25 },
      { itemId: f.otherItemId, qtyPerM2: 0.1 },
    ];
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 3)).toEqual([
      { itemId: f.itemId, qty: 0.75 },
      { itemId: f.otherItemId, qty: 0.3 },
    ]);
  });

  it('skips a norm whose item was deleted', () => {
    const f = production();
    f.state.operations[0].unit = 'squareMeter';
    f.state.operations[0].norms = [
      { itemId: 'missing', qtyPerM2: 1 },
      { itemId: f.itemId, qtyPerM2: 0.25 },
    ];
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 2)).toEqual([{ itemId: f.itemId, qty: 0.5 }]);
  });

  it('returns nothing for piecework stages', () => {
    const f = production();
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 2)).toEqual([]);
  });
});

describe('work submissions', () => {
  it('keeps every submission as its own report row', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: 'birinchi' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 4, reason: 'quality' });
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 6, note: 'ikkinchi' });
    expect(state.reports).toHaveLength(2);
    expect(state.reports[0]).toMatchObject({ qty: 4, status: 'rejected', note: 'birinchi' });
    expect(state.reports[1]).toMatchObject({ qty: 6, status: 'submitted', note: 'ikkinchi' });
    expect(state.payroll).toHaveLength(1);
    expect(state.payroll[0].reportId).toBe(state.reports[1].id);
    expect(state.payroll[0].amount).toBe(12);
  });
});

describe('defect review', () => {
  it('records a defect and keeps work open on a full reject', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 10, note: '' });
    const report = state.reports.at(-1)!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 10, reason: 'quality' });
    expect(state.reports.at(-1)).toMatchObject({ id: report.id, status: 'rejected', qty: 10 });
    expect(state.orders[0].route[0]).toMatchObject({ status: 'in_progress', completed: 0 });
    expect(state.payroll[0]).toMatchObject({ status: 'rejected', amount: 0 });
    expect(state.defects).toEqual([expect.objectContaining({
      reportId: report.id, orderId: f.orderId, lineId: state.orders[0].lines[0].id,
      taskId: f.taskId, employeeId: f.employeeId, operationId: f.operationId,
      qty: 10, reason: 'quality', note: '', materials: [],
    })]);
  });

  it('accepts the good part and journals only the defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    const report = state.reports.at(-1)!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 3, reason: 'measurement' });
    expect(state.reports.at(-1)).toMatchObject({ id: report.id, status: 'accepted', qty: 9 });
    expect(state.orders[0].route[0]).toMatchObject({ completed: 9, status: 'in_progress' });
    expect(state.payroll[0]).toMatchObject({ status: 'accepted', amount: 18 });
    expect(state.defects[0]).toMatchObject({ qty: 3, reason: 'measurement', materials: [] });
  });

  it('keeps accepted pay untouched while a resubmitted result awaits review', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 3, reason: 'measurement' });
    const accepted = { amount: state.payroll[0].amount, reportId: state.payroll[0].reportId };
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 3, note: '' });
    expect(state.payroll).toHaveLength(1);
    expect(state.payroll[0]).toMatchObject({ status: 'accepted', amount: 18, reportId: accepted.reportId });
  });

  it('lets the worker resubmit the remaining quantity after a partial defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 3, reason: 'measurement' });
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 3, note: '' });
    expect(state.reports).toHaveLength(2);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
    expect(state.orders[0].route[0]).toMatchObject({ completed: 12, status: 'completed' });
    expect(state.payroll[0]).toMatchObject({ amount: 24, status: 'accepted' });
  });

  it('caps the next submission by the remaining quantity after a defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 3, reason: 'measurement' });
    atomic(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: '' });
  });

  it('validates review decisions', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: '' });
    const reportId = state.reports.at(-1)!.id;
    atomic(state, { type: 'work.review', reportId, accept: true, reason: 'quality' });
    expect(() => run(state, { type: 'work.review', reportId, accept: true, reason: 'quality' })).toThrow('Review must be plain');
    expect(() => run(state, { type: 'work.review', reportId, accept: false })).toThrow('Defect reason is required');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'other' })).toThrow('Defect note is required');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'quality', defectQty: 0 })).toThrow('Nothing to reject');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'quality', defectQty: 5 })).toThrow('Defect quantity exceeds report');
    expect(state.defects).toEqual([]);
  });

  it('never moves stock or un-issues materials on reject', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 10, note: '' });
    const movements = structuredClone(state.movements);
    const materials = structuredClone(state.orders[0].materials);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 10, reason: 'quality' });
    expect(state.movements).toEqual(movements);
    expect(state.orders[0].materials).toEqual(materials);
  });
});
