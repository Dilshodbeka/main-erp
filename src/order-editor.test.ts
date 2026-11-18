import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { formatQty } from './i18n';
import {
  applicableTemplates,
  applyTemplate,
  blankPosition,
  duplicatePosition,
  groupItems,
  materialGroups,
  orderTotals,
  positionCost,
  positionIssue,
  positionLines,
  positionTotal,
  positionsFromOrder,
  searchMaterialGroups,
  stageAmounts,
  stageNormEstimate,
  type PositionDraft,
} from './order-editor';
import type { Actor, Command, Order, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

function base() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '998901111', address: 'Buyuruvchi ko‘chasi', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Cutter' });
  state = run(state, { type: 'employee.create', name: 'Assembler' });
  state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: false });
  state = run(state, { type: 'operation.create', name: 'Assemble', unit: 'piece', salePrice: 7, workerRate: 3, standardMinutes: 0, machineId: null, employeeIds: [state.employees[1].id], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'Fabric', unit: 'm', minQty: 0, cost: 5, customerId: null });
  state = run(state, { type: 'item.create', name: 'Thread', unit: 'm', minQty: 0, cost: 1, customerId: null });
  state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId: state.items[0].id, qty: 20, price: 5 }, { itemId: state.items[1].id, qty: 20, price: 1 }] });
  state = run(state, { type: 'purchase.receive', purchaseId: state.purchases.at(-1)!.id, lines: state.purchases.at(-1)!.lines.map(line => ({ lineId: line.id, qty: line.qty })) });
  const employeeId = state.employees[0].id;
  const otherEmployeeId = state.employees[1].id;
  const operationId = state.operations[0].id;
  const otherOperationId = state.operations[1].id;
  const itemId = state.items[0].id;
  const otherItemId = state.items[1].id;
  state = run(state, { type: 'order.create', input: {
    kind: 'composite', customerId: state.customers[0].id, dueDate: '2026-11-10', overhead: 20, advance: 0, account: 'cash',
    lines: [
      { kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000, materials: [{ itemId, qty: 3 }], route: [{ operationId, employeeId, rate: 2 }] },
      { kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100, materials: [{ itemId: otherItemId, qty: 1 }], route: [{ operationId: otherOperationId, employeeId: otherEmployeeId, rate: 3 }] },
    ],
  } });
  const order = state.orders[0];
  return {
    state, employeeId, otherEmployeeId, operationId, otherOperationId, itemId, otherItemId,
    productLineId: order.lines[0].id, serviceLineId: order.lines[1].id,
    cutTaskId: order.route[0].id, assembleTaskId: order.route[1].id,
  };
}

function report(state: State, orderId: string, taskId: string, qty: number): State {
  state = run(state, { type: 'work.accept', orderId, taskId });
  state = run(state, { type: 'work.start', orderId, taskId });
  state = run(state, { type: 'work.submit', orderId, taskId, qty, note: '' });
  return run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
}

/** Product position has 1 accepted unit, service position is fully shipped. */
function running() {
  const f = base();
  const orderId = f.state.orders[0].id;
  let state = run(f.state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  state = report(state, orderId, f.cutTaskId, 1);
  state = report(state, orderId, f.assembleTaskId, 3);
  state = run(state, { type: 'shipment.create', orderId, lines: [{ lineId: f.serviceLineId, qty: 3 }], address: 'Manzil', dueDate: '2026-11-06', allowDebt: true });
  return { ...f, state, orderId, order: state.orders[0] };
}

describe('order position drafts', () => {
  it('starts a new order with one empty product position', () => {
    expect(blankPosition()).toEqual({
      id: undefined, kind: 'product', title: '', qty: 1, unitPrice: 0, status: undefined, floor: 0,
      materials: [], route: [],
    });
  });

  it('splits each position into its own rows and locks what already started', () => {
    const fixture = running();
    const positions = positionsFromOrder(fixture.state, fixture.order);
    const [kitchen, service] = positions;
    expect(kitchen).toMatchObject({ id: fixture.productLineId, kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000, floor: 0 });
    expect(kitchen.materials).toEqual([{ itemId: fixture.itemId, qty: 3, issuedQty: 3 }]);
    expect(kitchen.route).toEqual([{
      operationId: fixture.operationId, executorKind: 'employee', employeeId: fixture.employeeId, supplierId: null,
      rate: 2, salePrice: 5, qty: 2, taskId: fixture.cutTaskId, locked: true, completed: 1,
    }]);
    expect(service).toMatchObject({ id: fixture.serviceLineId, qty: 3, unitPrice: 100, floor: 3 });
    expect(service.route[0]).toMatchObject({ locked: true, completed: 3 });
    expect(service.materials).toEqual([{ itemId: fixture.otherItemId, qty: 1, issuedQty: 1 }]);
  });

  it('leaves cancelled positions out of the editor', () => {
    const f = base();
    const state = run(f.state, { type: 'orderLine.cancel', orderId: f.state.orders[0].id, lineId: f.serviceLineId });
    const positions = positionsFromOrder(state, state.orders[0]);
    expect(positions.map(position => position.title)).toEqual(['Oshxona']);
  });

  it('rounds every position sum instead of carrying float drift', () => {
    const position: PositionDraft = { ...blankPosition(), title: 'Shkaf', qty: 3, unitPrice: 0.1 };
    expect(positionTotal(position)).toBe(0.3);
  });

  it('adds up positions for the order price and planned cost', () => {
    const fixture = running();
    const positions = positionsFromOrder(fixture.state, fixture.order);
    expect(orderTotals(fixture.state, positions, 20)).toEqual({ qty: 5, positions: 2300, markup: 0, price: 2300, cost: 49, margin: 2251 });
  });

  it('keeps the owner markup apart from the position sums', () => {
    const fixture = running();
    const positions = positionsFromOrder(fixture.state, fixture.order);
    expect(orderTotals(fixture.state, positions, 20, 500)).toEqual({ qty: 5, positions: 2300, markup: 500, price: 2800, cost: 49, margin: 2751 });
    expect(orderTotals(fixture.state, positions, 20, -300)).toEqual({ qty: 5, positions: 2300, markup: -300, price: 2000, cost: 49, margin: 1951 });
  });

  it('stores the markup on a new order and revises it with the lines', () => {
    const f = base();
    const created = run(f.state, { type: 'order.create', input: {
      kind: 'product', customerId: f.state.customers[0].id, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash', markup: 200,
      lines: [{ kind: 'product', title: 'Shkaf', qty: 1, unitPrice: 1000, materials: [], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] }],
    } });
    expect(created.orders.at(-1)).toMatchObject({ markup: 200, price: 1200 });
    const order = created.orders.at(-1)!;
    const current = positionLines(positionsFromOrder(created, order));
    const discounted = run(created, { type: 'order.update', orderId: order.id, overhead: 0, dueDate: '2026-11-10', markup: -300, lines: current });
    expect(discounted.orders.at(-1)).toMatchObject({ markup: -300, price: 700 });
  });

  it('rejects a discount bigger than the order sum', () => {
    const f = base();
    const current = positionLines(positionsFromOrder(f.state, f.state.orders[0]));
    expect(() => run(f.state, { type: 'order.update', orderId: f.state.orders[0].id, overhead: 0, dueDate: '2026-11-10', markup: -5000, lines: current }))
      .toThrow('Markup exceeds order total');
  });

  it('costs a saved position from its own materials and route', () => {
    const fixture = running();
    const [kitchen, service] = fixture.order.lines;
    expect(positionCost(fixture.order, kitchen!)).toEqual({ material: 15, labor: 4, total: 19, margin: 1981 });
    expect(positionCost(fixture.order, service!)).toEqual({ material: 1, labor: 9, total: 10, margin: 290 });
  });

  it('keeps position and task identity so a revision reuses locked rows', () => {
    const fixture = running();
    const positions = positionsFromOrder(fixture.state, fixture.order);
    expect(positionLines(positions)).toEqual([
      {
        id: fixture.productLineId, kind: 'product', title: 'Oshxona', qty: 2, unitPrice: 1000,
        materials: [{ itemId: fixture.itemId, qty: 3 }],
        route: [{ operationId: fixture.operationId, executorKind: 'employee', employeeId: fixture.employeeId, supplierId: null, rate: 2, qty: 2, taskId: fixture.cutTaskId }],
      },
      {
        id: fixture.serviceLineId, kind: 'service', title: '45 gradus kesish', qty: 3, unitPrice: 100,
        materials: [{ itemId: fixture.otherItemId, qty: 1 }],
        route: [{ operationId: fixture.otherOperationId, executorKind: 'employee', employeeId: fixture.otherEmployeeId, supplierId: null, rate: 3, qty: 3, taskId: fixture.assembleTaskId }],
      },
    ]);
  });

  it('copies a position without inheriting its identity or locks', () => {
    const fixture = running();
    const copy = duplicatePosition(positionsFromOrder(fixture.state, fixture.order)[0]);
    expect(copy).toMatchObject({ id: undefined, floor: 0, title: 'Oshxona', qty: 2, unitPrice: 1000 });
    expect(copy.materials[0]).toEqual({ itemId: fixture.itemId, qty: 3, issuedQty: 0 });
    expect(copy.route[0]).toEqual({ operationId: fixture.operationId, executorKind: 'employee', employeeId: fixture.employeeId, supplierId: null, rate: 2, salePrice: 5, qty: 2, taskId: undefined, locked: false, completed: 0 });
  });

  it('keeps accepted stage work out of the product floor but still respects shipped work', () => {
    const fixture = running();
    const positions = positionsFromOrder(fixture.state, fixture.order);
    expect(positionIssue(positions)).toBe('');
    positions[0]!.qty = 1;
    expect(positionIssue(positions)).toBe('');
    positions[1]!.qty = 2;
    expect(positionIssue(positions)).toBe(`Pozitsiya 2: miqdor yuborilgan miqdordan (${formatQty(3)}) past bo‘lishi mumkin emas.`);
  });

  it('accepts a draft position but refuses half-filled stages and negative prices', () => {
    const f = base();
    const [kitchen] = positionsFromOrder(f.state, f.state.orders[0]);
    kitchen.title = '';
    expect(positionIssue([kitchen])).toBe('Pozitsiya 1: nomini kiriting.');
    kitchen.title = 'Oshxona';
    kitchen.route = [];
    expect(positionIssue([kitchen])).toBe('');
    kitchen.route = [{ operationId: f.operationId, executorKind: 'employee', employeeId: '', supplierId: null, rate: 2, qty: 2, locked: false, completed: 0 }];
    expect(positionIssue([kitchen])).toBe('Pozitsiya 1: ijrochi bilan kamida bitta bosqich qo‘shing.');
    kitchen.route = [{ operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, qty: 2, locked: false, completed: 0 }];
    kitchen.unitPrice = 0;
    expect(positionIssue([kitchen])).toBe('');
    kitchen.unitPrice = -1;
    expect(positionIssue([kitchen])).toBe('Pozitsiya 1: narxini kiriting.');
    kitchen.unitPrice = 1000;
    kitchen.materials = [{ itemId: '', qty: 2, issuedQty: 0 }];
    expect(positionIssue([kitchen])).toBe('Pozitsiya 1: material qatorlarini to‘ldiring.');
    kitchen.materials = [];
    expect(positionIssue([kitchen])).toBe('');
    expect(positionIssue([])).toBe('Kamida bitta pozitsiya kerak.');
  });

  it('saves a blank draft position with only a name and quantity', () => {
    const draft: PositionDraft = { ...blankPosition(), title: 'Shkaf', qty: 1 };
    expect(positionIssue([draft])).toBe('');
    expect(positionIssue([{ ...blankPosition(), qty: 1 }])).toBe('Pozitsiya 1: nomini kiriting.');
    expect(positionIssue([{ ...blankPosition(), title: 'Shkaf', qty: 0 }])).toBe('Pozitsiya 1: miqdorini kiriting.');
  });

  it('holds the draft shape an order revision command needs', () => {
    const f = base();
    const current = positionLines(positionsFromOrder(f.state, f.state.orders[0]));
    const state = run(f.state, { type: 'order.update', orderId: f.state.orders[0].id, overhead: 25, dueDate: '2026-11-20',
      lines: [
        { ...current[0], qty: 4 },
        current[1],
        { id: undefined, kind: 'product', title: 'Shkaf', qty: 1, unitPrice: 500, materials: [], route: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 2 }] },
      ] });
    const order: Order = state.orders[0];
    expect(order.lines.map(line => line.title)).toEqual(['Oshxona', '45 gradus kesish', 'Shkaf']);
    expect(order.price).toBe(4000 + 300 + 500);
  });

  it('shows the operation price apart from the worker rate on every stage', () => {
    const f = base();
    const [kitchen, service] = positionsFromOrder(f.state, f.state.orders[0]);
    expect(kitchen!.route[0]).toMatchObject({ rate: 2, salePrice: 5, qty: 2 });
    expect(service!.route[0]).toMatchObject({ rate: 3, salePrice: 7, qty: 3 });
    expect(stageAmounts(kitchen!.route[0]!)).toEqual({ price: 10, worker: 4 });
    expect(stageAmounts(service!.route[0]!)).toEqual({ price: 21, worker: 9 });
  });

  it('falls back to the catalog operation price for a stage saved without one', () => {
    const f = base();
    const order = f.state.orders[0];
    order.route[0] = { ...order.route[0]!, salePrice: undefined };
    const [kitchen] = positionsFromOrder(f.state, order);
    expect(kitchen!.route[0]!.salePrice).toBe(5);
    expect(stageAmounts(kitchen!.route[0]!)).toEqual({ price: 10, worker: 4 });
  });

  it('rounds the operation sum and the worker sum independently', () => {
    expect(stageAmounts({ operationId: 'op', executorKind: 'employee', employeeId: 'emp', supplierId: null, rate: 0.1, salePrice: 0.1, qty: 3, locked: false, completed: 0 }))
      .toEqual({ price: 0.3, worker: 0.3 });
    expect(stageAmounts({ operationId: 'op', executorKind: 'employee', employeeId: 'emp', supplierId: null, rate: 2, qty: 4, locked: false, completed: 0 }))
      .toEqual({ price: 0, worker: 8 });
  });

  it('keeps each stage quantity when loading a position', () => {
    const f = base();
    const state = run(f.state, { type: 'order.create', input: {
      kind: 'product', customerId: f.state.customers[0].id, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'product', title: 'Korpus', qty: 1, unitPrice: 2000, materials: [], route: [
        { operationId: f.operationId, employeeId: f.employeeId, rate: 2, qty: 5 },
      ] }],
    } });
    const order = state.orders.at(-1)!;
    expect(positionsFromOrder(state, order)[0]!.route).toEqual([{
      operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null,
      rate: 2, salePrice: 5, qty: 5, taskId: order.route[0].id, locked: false, completed: 0,
    }]);
  });

  it('prices the planned cost from each stage quantity, not the product quantity', () => {
    const f = base();
    const position: PositionDraft = {
      ...blankPosition(), title: 'Oshxona', qty: 1, unitPrice: 2000,
      route: [
        { operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, qty: 5, locked: false, completed: 0 },
        { operationId: f.otherOperationId, executorKind: 'employee', employeeId: f.otherEmployeeId, supplierId: null, rate: 3, qty: 300, locked: false, completed: 0 },
      ],
    };
    expect(orderTotals(f.state, [position], 0)).toEqual({ qty: 1, positions: 2000, markup: 0, price: 2000, cost: 910, margin: 1090 });
    expect(positionLines([position])[0]!.route).toEqual([
      { operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, qty: 5 },
      { operationId: f.otherOperationId, executorKind: 'employee', employeeId: f.otherEmployeeId, supplierId: null, rate: 3, qty: 300 },
    ]);
  });

  it('refuses a missing stage quantity or work already accepted on a stage', () => {
    const f = base();
    const [kitchen] = positionsFromOrder(f.state, f.state.orders[0]);
    kitchen!.route = [{ operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, qty: 0, locked: false, completed: 0 }];
    expect(positionIssue([kitchen!])).toBe('Pozitsiya 1: bosqich miqdorini kiriting.');
    kitchen!.route = [{ operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, qty: 1, locked: true, completed: 2 }];
    expect(positionIssue([kitchen!])).toBe(`Pozitsiya 1: bosqich miqdori qabul qilingan ishdan (${formatQty(2)}) past bo‘lishi mumkin emas.`);
  });

  it('offers production stock, grouped and sorted by category and name', () => {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'customer.create', name: 'Other client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Oddiy material', unit: 'm', minQty: 0, cost: 1, customerId: null, kind: 'material' });
    state = run(state, { type: 'item.create', name: 'Alum profil', unit: 'm', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '03.01' });
    state = run(state, { type: 'item.create', name: 'Yong`in profil', unit: 'm', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '03.01' });
    state = run(state, { type: 'item.create', name: 'KPLA', unit: 'list', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '01.01' });
    state = run(state, { type: 'item.create', name: 'MDF', unit: 'list', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '01.02' });
    state = run(state, { type: 'item.create', name: 'Korpus paneli', unit: 'list', minQty: 0, cost: 1, customerId: null, kind: 'blank', category: '01.03' });
    state = run(state, { type: 'item.create', name: 'Tayyor shkaf', unit: 'dona', minQty: 0, cost: 1, customerId: null, kind: 'finished', category: '01.01', salePrice: 10 });
    state = run(state, { type: 'item.create', name: 'Mijoz materiali', unit: 'm', minQty: 0, cost: 0, customerId: state.customers[1].id, kind: 'material' });
    const customerId = state.customers[0].id;
    expect(materialGroups(state, customerId).map(group => ({
      category: group.category,
      items: group.items.map(item => item.name),
    }))).toEqual([
      { category: '01.01 · LDSP', items: ['KPLA'] },
      { category: '01.02 · MDF', items: ['MDF'] },
      { category: '01.03 · HDF', items: ['Korpus paneli'] },
      { category: '03.01 · Alyuminiy profil', items: ['Alum profil', 'Yong`in profil'] },
      { category: 'Tasniflanmagan', items: ['Oddiy material'] },
    ]);
    const alumId = state.items.find(item => item.name === 'Alum profil')!.id;
    const takenId = state.items.find(item => item.name === 'KPLA')!.id;
    expect(materialGroups(state, customerId, alumId, [takenId]).flatMap(group => group.items).map(item => item.name))
      .toEqual(['MDF', 'Korpus paneli', 'Alum profil', 'Yong`in profil', 'Oddiy material']);
  });

  it('searches materials by name, category and folded Uzbek letters', () => {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Alum profil', unit: 'm', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '03.01' });
    state = run(state, { type: 'item.create', name: 'Yong`in profil', unit: 'm', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '03.01' });
    state = run(state, { type: 'item.create', name: 'KPLA', unit: 'list', minQty: 0, cost: 1, customerId: null, kind: 'material', category: '01.01' });
    const groups = materialGroups(state, state.customers[0].id);
    const names = (query: string) => searchMaterialGroups(groups, query).flatMap(group => group.items.map(item => item.name));
    expect(searchMaterialGroups(groups, '')).toEqual(groups);
    expect(names('alum')).toEqual(['Alum profil']);
    expect(names('03.01')).toEqual(['Alum profil', 'Yong`in profil']);
    expect(names('yongʻin')).toEqual(['Yong`in profil']);
    expect(names('profil alum')).toEqual(['Alum profil']);
    expect(names('beton')).toEqual([]);
    expect(searchMaterialGroups(groups, 'kromka')).toEqual([]);
    expect(groupItems(state.items).map(group => group.category)).toEqual(['01.01 · LDSP', '03.01 · Alyuminiy profil']);
  });

  it('round-trips an outsourced position stage', () => {
    const f = base();
    const supplierId = f.state.suppliers[0].id;
    const state = run(f.state, { type: 'order.create', input: {
      kind: 'product', customerId: f.state.customers[0].id, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'product', title: 'Metall', qty: 2, unitPrice: 100000, materials: [],
        route: [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null, supplierId, rate: 0, supplierCost: 60000, qty: 2 }] }],
    } });
    const order = state.orders.at(-1)!;
    const positions = positionsFromOrder(state, order);
    expect(positions[0].route[0]).toMatchObject({
      executorKind: 'supplier', employeeId: null, supplierId, locked: false,
    });
    expect(positionLines(positions)[0].route[0]).toEqual({
      operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId, rate: 0, supplierCost: 60000, qty: 2, taskId: order.route[0].id,
    });
  });

  it('prefills a fixed sum for a legacy supplier stage and sends it back', () => {
    const f = base();
    const supplierId = f.state.suppliers[0].id;
    const state = run(f.state, { type: 'order.create', input: {
      kind: 'product', customerId: f.state.customers[0].id, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'product', title: 'Metall', qty: 2, unitPrice: 100000, materials: [],
        route: [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null, supplierId, rate: 30000, qty: 2 }] }],
    } });
    const order = state.orders.at(-1)!;
    expect(order.route[0].supplierCost).toBe(0);
    const positions = positionsFromOrder(state, order);
    expect(positions[0].route[0].supplierCost).toBe(60000);
    expect(positionLines(positions)[0].route[0]).toMatchObject({ rate: 30000, supplierCost: 60000 });
  });

  it('costs a supplier draft by its fixed sum and not by its rate', () => {
    const f = base();
    const positions = positionsFromOrder(f.state, f.state.orders[0]);
    positions[0].materials = [];
    positions[0].route = [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.state.suppliers[0].id, rate: 0, supplierCost: 900000, salePrice: 5, qty: 2, locked: false, completed: 0 }];
    positions[1].materials = [];
    positions[1].route = [];
    expect(orderTotals(f.state, positions, 0).cost).toBe(900000);
    expect(stageAmounts(positions[0].route[0])).toEqual({ price: 10, worker: 0 });
  });

  it('uses the accepted fixed sum as position labor cost', () => {
    const f = base();
    const state = run(f.state, { type: 'order.create', input: {
      kind: 'product', customerId: f.state.customers[0].id, dueDate: '2026-11-10', overhead: 0, advance: 0, account: 'cash',
      lines: [{ kind: 'product', title: 'Metall', qty: 2, unitPrice: 100000, materials: [],
        route: [{ operationId: f.operationId, executorKind: 'supplier', employeeId: null,
          supplierId: f.state.suppliers[0].id, rate: 0, supplierCost: 900000, qty: 2 }] }],
    } });
    const order = state.orders.at(-1)!;
    expect(positionCost(order, order.lines[0])).toEqual({ material: 0, labor: 900000, total: 900000, margin: -700000 });
  });

  it('requires the executor selected by executorKind', () => {
    const position = blankPosition();
    Object.assign(position, { title: 'Metall', qty: 1, unitPrice: 100000 });
    position.route = [{ operationId: 'operation-1', executorKind: 'supplier', employeeId: null,
      supplierId: null, rate: 30000, qty: 1, locked: false, completed: 0 }];
    expect(positionIssue([position])).toContain('ijrochi');
    position.route[0].supplierId = 'supplier-1';
    expect(positionIssue([position])).toBe('');
  });
});

describe('stageNormEstimate', () => {
  function paintState() {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }] });
    state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true });
    return state;
  }
  const stage = (state: State, operationId: string) => ({
    operationId, executorKind: 'employee' as const, employeeId: state.employees[0].id, supplierId: null,
    rate: 20, qty: 10, locked: false, completed: 0,
  });

  it('estimates norm material cost for a squareMeter stage', () => {
    const state = paintState();
    expect(stageNormEstimate(state, stage(state, state.operations[0].id))).toBe(200);
  });
  it('returns null for a non-squareMeter stage', () => {
    const state = paintState();
    expect(stageNormEstimate(state, stage(state, state.operations[1].id))).toBeNull();
  });
});

describe('route templates in the editor', () => {
  it('filters applicable templates by kind and active', () => {
    const f = base();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'Service tpl', kind: 'service', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Product tpl', kind: 'product', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Hidden tpl', kind: 'service', stages: [{ operationId: f.operationId }] });
    const hidden = state.routeTemplates.find(t => t.name === 'Hidden tpl')!;
    state = run(state, { type: 'routeTemplate.update', templateId: hidden.id, name: hidden.name, kind: hidden.kind, stages: hidden.stages, active: false });
    expect(applicableTemplates(state, 'service').map(t => t.name)).toEqual(['Service tpl']);
  });

  it('applies a template with fallback rate, sale price and auto-resolved worker', () => {
    const f = base();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Cut only', kind: 'product', stages: [{ operationId: f.operationId }] });
    const stages = applyTemplate(state, state.routeTemplates[0], 4);
    expect(stages).toEqual([{ operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, salePrice: 5, qty: 4, locked: false, completed: 0 }]);
  });

  it('honors an explicit employee and a rate override', () => {
    const f = base();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Cut rate', kind: 'product', stages: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 9 }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 1);
    expect(stage.rate).toBe(9);
    expect(stage.employeeId).toBe(f.employeeId);
  });

  it('maps a supplier stage to supplierId with no employee and no rate', () => {
    const f = base();
    const supplierId = f.state.suppliers[0].id;
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Outsource cut', kind: 'product', stages: [{ operationId: f.operationId, executorKind: 'supplier', supplierId }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 2);
    expect(stage.executorKind).toBe('supplier');
    expect(stage.supplierId).toBe(supplierId);
    expect(stage.employeeId).toBeNull();
    expect(stage.rate).toBe(0);
    expect(stage.supplierCost).toBe(0);
  });

  it('leaves the worker empty when more than one active authorized worker', () => {
    const f = base();
    let state = run(f.state, { type: 'operation.create', name: 'Both', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [f.employeeId, f.otherEmployeeId], active: true, autoAccept: false });
    const bothOp = state.operations.at(-1)!.id;
    state = run(state, { type: 'routeTemplate.create', name: 'Ambiguous', kind: 'product', stages: [{ operationId: bothOp }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 3);
    expect(stage.employeeId).toBeNull();
  });

  it('leaves the worker empty when the operation authorizes no one', () => {
    const f = base();
    let state = run(f.state, { type: 'operation.create', name: 'Machine only', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
    const opId = state.operations.at(-1)!.id;
    state = run(state, { type: 'routeTemplate.create', name: 'None', kind: 'product', stages: [{ operationId: opId }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 3);
    expect(stage.employeeId).toBeNull();
  });
});
