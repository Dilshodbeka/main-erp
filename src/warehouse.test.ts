import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, reservedQty, stockQty } from './domain';
import { MAIN_WAREHOUSE_ID, mainWarehouse } from './warehouse-default';
import { migrateState } from './migrations';
import { categoryCodes, categoryGroupName, categoryLabel, isCategoryCode, warehouseGroups } from './warehouse';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'admin', name: 'Admin', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

describe('paint warehouse group', () => {
  it('adds group 06 with six leaves', () => {
    const group = warehouseGroups.find(row => row.code === '06');
    expect(group?.name).toBe('Bo‘yoq va kimyo');
    expect(group?.children.map(leaf => leaf.code)).toEqual(['06.01', '06.02', '06.03', '06.04', '06.05', '06.06']);
  });
  it('recognizes the new codes', () => {
    expect(isCategoryCode('06.01')).toBe(true);
    expect(categoryCodes).toContain('06.06');
    expect(categoryGroupName('06.02')).toBe('Bo‘yoq va kimyo');
    expect(categoryLabel('06.01')).toBe('06.01 · Bo‘yoq');
  });
  it('keeps abrasives in group 07', () => {
    expect(categoryGroupName('07.03')).toBe('Sarf materiallari');
    expect(categoryLabel('07.03')).toBe('07.03 · Abrazivlar');
  });
});

describe('default warehouse', () => {
  it('starts every company with the main warehouse', () => {
    expect(emptyState().warehouses).toEqual([{ id: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', active: true }]);
  });

  it('normalizes a snapshot that predates warehouses', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete source.warehouses;
    expect(migrateState(source).warehouses).toEqual([mainWarehouse()]);
  });

  it('keeps saved warehouses as they are', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as State;
    source.warehouses = [{ id: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', active: true }, { id: 'w2', name: 'Seh ombori', active: true }];
    expect(migrateState(source).warehouses).toHaveLength(2);
  });

  it('moves legacy stock, purchases and orders into the main warehouse', () => {
    const state = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete state.warehouses;
    state.movements = [{ id: 'mv', itemId: 'paint', direction: 'in', qty: 10, unitCost: 10, source: 'purchase', sourceId: 'p1', note: '', createdAt: '' }];
    state.purchases = [{ id: 'p1', number: 'PUR-0001', supplierId: 's1', createdAt: '', lines: [] }];
    state.orders = [{
      id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Fasad', outputItemId: null,
      recipeVersionId: null, substitutions: {}, qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20', createdAt: '',
      status: 'draft', materials: [], route: [],
    }];
    const migrated = migrateState(state);
    expect(migrated.movements[0].warehouseId).toBe(MAIN_WAREHOUSE_ID);
    expect(migrated.purchases[0].warehouseId).toBe(MAIN_WAREHOUSE_ID);
    expect(migrated.orders[0].warehouseId).toBe(MAIN_WAREHOUSE_ID);
  });
});

describe('warehouse stock scope', () => {
  const movement = (id: string, warehouseId: string, qty: number) => ({
    id, itemId: 'paint', direction: 'in' as const, qty, unitCost: 10, source: 'purchase' as const,
    sourceId: 'p1', warehouseId, note: '', createdAt: '',
  });

  it('counts the whole company without a warehouse and one shelf with it', () => {
    const state: State = {
      ...emptyState(),
      warehouses: [mainWarehouse(), { id: 'w2', name: 'Seh ombori', active: true }],
      movements: [movement('a', MAIN_WAREHOUSE_ID, 6), movement('b', 'w2', 4)],
    };
    expect(stockQty(state, 'paint')).toBe(10);
    expect(stockQty(state, 'paint', MAIN_WAREHOUSE_ID)).toBe(6);
    expect(stockQty(state, 'paint', 'w2')).toBe(4);
  });
});

function paintWorld(mainQty: number, workshopQty: number) {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Painter' });
  state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 10, customerId: null });
  state = run(state, {
    type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 10,
    standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true, norms: [],
  });
  state = run(state, { type: 'warehouse.create', name: 'Seh ombori' });
  const workshopId = state.warehouses.find(row => row.name === 'Seh ombori')!.id;
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: mainQty, note: '', warehouseId: MAIN_WAREHOUSE_ID });
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: workshopQty, note: '', warehouseId: workshopId });
  return { state, workshopId };
}

const routeOf = (state: State) => [{
  operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 10, qty: 1,
}];

function orderFor(state: State, warehouseId: string, qty: number) {
  const next = run(state, {
    type: 'order.create',
    input: {
      kind: 'product', customerId: state.customers[0].id, title: 'Stol', qty: 1, price: 100,
      overhead: 0, dueDate: '2026-11-25', advance: 0, account: 'cash',
      materials: [{ itemId: state.items[0].id, qty }], route: routeOf(state), warehouseId,
    },
  });
  const orderId = next.orders.at(-1)!.id;
  return { state: run(next, { type: 'order.launch', orderId }), orderId };
}

const issuedQty = (state: State, orderId: string) =>
  state.orders.find(order => order.id === orderId)!.materials[0].issuedQty;

describe('warehouse-scoped material issue', () => {
  it('issues only from the order warehouse and stops at what is there', () => {
    const { state: base, workshopId } = paintWorld(6, 2);
    let { state, orderId } = orderFor(base, workshopId, 5);
    state = run(state, { type: 'order.issue', orderId });
    expect(issuedQty(state, orderId)).toBe(2);
    expect(stockQty(state, state.items[0].id, workshopId)).toBe(0);
    expect(stockQty(state, state.items[0].id, MAIN_WAREHOUSE_ID)).toBe(6);
    state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: 10, note: '', warehouseId: workshopId });
    state = run(state, { type: 'order.issue', orderId });
    expect(issuedQty(state, orderId)).toBe(5);
    expect(stockQty(state, state.items[0].id, workshopId)).toBe(7);
  });

  it('keeps stock promised to another production order out of the issue', () => {
    const { state: base } = paintWorld(5, 0);
    let a = orderFor(base, MAIN_WAREHOUSE_ID, 3);
    let b = orderFor(a.state, MAIN_WAREHOUSE_ID, 4);
    let state = run(b.state, { type: 'order.issue', orderId: b.orderId });
    expect(issuedQty(state, b.orderId)).toBe(2);
    state = run(state, { type: 'order.issue', orderId: a.orderId });
    expect(issuedQty(state, a.orderId)).toBe(1);
    expect(() => run(state, { type: 'order.issue', orderId: a.orderId })).toThrow('Omborda material yo‘q. Qoldiqni to‘ldiring');
    expect(stockQty(state, state.items[0].id)).toBe(2);
  });

  it('locks the warehouse once material has left the shelf', () => {
    const { state: base, workshopId } = paintWorld(5, 0);
    let { state, orderId } = orderFor(base, MAIN_WAREHOUSE_ID, 2);
    state = run(state, { type: 'order.issue', orderId });
    const order = state.orders[0];
    expect(() => run(state, {
      type: 'order.update', orderId, title: order.title, qty: order.lines[0].qty, price: order.lines[0].total,
      overhead: order.overhead, dueDate: order.dueDate, materials: [], route: [], warehouseId: workshopId,
    })).toThrow('Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi');
  });

  it('counts a shelf against its own reservations, not the whole company', () => {
    const { state: base, workshopId } = paintWorld(5, 0);
    const { state } = orderFor(base, MAIN_WAREHOUSE_ID, 5);
    const itemId = base.items[0].id;
    expect(reservedQty(state, itemId)).toBe(5);
    const counted = run(state, { type: 'inventory.count', itemId, qty: 2, note: '', warehouseId: workshopId });
    expect(stockQty(counted, itemId, workshopId)).toBe(2);
    expect(() => run(counted, { type: 'inventory.count', itemId, qty: 4, note: '', warehouseId: MAIN_WAREHOUSE_ID }))
      .toThrow('Count cannot be below reserved stock');
  });

  it('moves a draft order to another warehouse', () => {
    const { state: base, workshopId } = paintWorld(0, 0);
    const created = run(base, {
      type: 'order.create',
      input: {
        kind: 'product', customerId: base.customers[0].id, title: 'Stol', qty: 1, price: 100,
        overhead: 0, dueDate: '2026-11-25', advance: 0, account: 'cash', materials: [], route: routeOf(base),
      },
    });
    const order = created.orders[0];
    expect(order.warehouseId).toBe(MAIN_WAREHOUSE_ID);
    const next = run(created, {
      type: 'order.update', orderId: order.id, title: order.title, qty: order.lines[0].qty,
      price: order.lines[0].total, overhead: order.overhead, dueDate: order.dueDate,
      materials: [], route: order.route.map(task => ({
        operationId: task.operationId, employeeId: task.employeeId!, rate: task.rate, qty: task.planned,
      })), warehouseId: workshopId,
    });
    expect(next.orders[0].warehouseId).toBe(workshopId);
  });
});

describe('warehouse transfer', () => {
  const transfer = (itemId: string, workshopId: string, qty: number) => ({
    type: 'warehouse.transfer' as const, itemId, fromId: MAIN_WAREHOUSE_ID, toId: workshopId, qty, note: '',
  });

  it('moves quantity between shelves in one journal entry', () => {
    const { state: base, workshopId } = paintWorld(5, 0);
    const state = run(base, transfer(base.items[0].id, workshopId, 2));
    const itemId = state.items[0].id;
    expect(stockQty(state, itemId, MAIN_WAREHOUSE_ID)).toBe(3);
    expect(stockQty(state, itemId, workshopId)).toBe(2);
    expect(stockQty(state, itemId)).toBe(5);
    const rows = state.movements.filter(row => row.source === 'transfer');
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceId).toBe(rows[1].sourceId);
    expect(rows.map(row => row.direction).sort()).toEqual(['in', 'out']);
  });

  it('refuses a transfer above free stock or to the same shelf', () => {
    const { state: base, workshopId } = paintWorld(3, 0);
    expect(() => run(base, transfer(base.items[0].id, workshopId, 4))).toThrow('Omborda yetarli qoldiq yo‘q');
    expect(() => run(base, { ...transfer(base.items[0].id, workshopId, 1), toId: MAIN_WAREHOUSE_ID }))
      .toThrow('Omborlar bir xil bo‘lmasligi kerak');
  });

  it('refuses a transfer into an inactive warehouse', () => {
    const { state: base, workshopId } = paintWorld(3, 0);
    const off = run(base, { type: 'warehouse.update', warehouseId: workshopId, name: 'Seh ombori', active: false });
    expect(() => run(off, transfer(base.items[0].id, workshopId, 1))).toThrow('Ombor nofaol');
  });
});

describe('warehouse catalog', () => {
  it('creates shelves with unique names and keeps at least one active', () => {
    let state = emptyState();
    expect(() => run(state, { type: 'warehouse.create', name: 'Asosiy ombor' })).toThrow('Name already exists');
    state = run(state, { type: 'warehouse.create', name: 'Seh ombori' });
    const workshopId = state.warehouses[1].id;
    state = run(state, { type: 'warehouse.update', warehouseId: workshopId, name: 'Ikkinchi ombor', active: false });
    expect(state.warehouses[1]).toMatchObject({ name: 'Ikkinchi ombor', active: false });
    expect(() => run(state, { type: 'warehouse.update', warehouseId: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', active: false }))
      .toThrow('Kamida bitta faol ombor qolishi kerak');
  });

  it('refuses a new order on a closed warehouse', () => {
    const { state: base, workshopId } = paintWorld(0, 0);
    const off = run(base, { type: 'warehouse.update', warehouseId: workshopId, name: 'Seh ombori', active: false });
    expect(() => orderFor(off, workshopId, 1)).toThrow('Ombor nofaol');
  });
});