import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, reservedQty } from './domain';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'admin', name: 'Admin', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function paintWorld() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Painter' });
  state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
  state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
  state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: 100, note: '' });
  state = run(state, { type: 'inventory.count', itemId: state.items[1].id, qty: 100, note: '' });
  return state;
}

const createInput = (state: State, qty: number) => ({
  kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
  materials: [] as { itemId: string; qty: number }[],
  route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty }],
});

function updateCommand(state: State, overrides: Partial<Extract<Command, { type: 'order.update' }>> = {}): Extract<Command, { type: 'order.update' }> {
  const order = state.orders[0];
  return {
    type: 'order.update', orderId: order.id, title: order.title, qty: order.qty, price: order.price,
    overhead: order.overhead, dueDate: order.dueDate,
    materials: order.materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    route: order.route.map(task => ({
      operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id, qty: task.planned,
    })),
    ...overrides,
  };
}

function launched(qty: number) {
  let state = paintWorld();
  state = run(state, { type: 'order.create', input: createInput(state, qty) });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return { state, orderId };
}

describe('revision keeps issued quantities', () => {
  it('clamps a submitted quantity to what was already issued', () => {
    let { state, orderId } = launched(10);
    state = run(state, updateCommand(state, { materials: state.orders[0].materials.map(line => ({ itemId: line.itemId, qty: 1 })) }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.issuedQty).toBe(2);
    expect(paint.actualCost).toBe(100);
    expect(state.orders[0].status).toBe('production');
    expect(state.orders[0].id).toBe(orderId);
  });
});

describe('norm delta on revision', () => {
  it('grows norm materials by the stage delta and leaves issued quantity', () => {
    let { state } = launched(10);
    expect(state.orders[0].materials.find(row => row.itemId === state.items[0].id)!.qty).toBe(2);
    expect(state.orders[0].materials.find(row => row.itemId === state.items[1].id)!.qty).toBe(1);
    state = run(state, updateCommand(state, {
      qty: 1,
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
      materials: state.orders[0].materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    const hardener = state.orders[0].materials.find(row => row.itemId === state.items[1].id)!;
    expect(paint.qty).toBe(4);
    expect(paint.issuedQty).toBe(2);
    expect(hardener.qty).toBe(2);
    expect(hardener.issuedQty).toBe(1);
  });

  it('shrinks norm materials and clamps them at issued quantity', () => {
    let { state } = launched(10);
    state = run(state, updateCommand(state, {
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 4, taskId: state.orders[0].route[0].id }],
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.issuedQty).toBe(2);
    expect(reservedQty(state, state.items[0].id)).toBe(0);
  });

  it('is idempotent when the same revision is submitted twice', () => {
    let { state } = launched(10);
    const route = [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }];
    state = run(state, updateCommand(state, { route }));
    const once = state.orders[0].materials.map(row => row.qty);
    state = run(state, updateCommand(state, { route }));
    expect(state.orders[0].materials.map(row => row.qty)).toEqual(once);
  });

  it('removes norm material when its stage is removed and nothing was issued', () => {
    let state = paintWorld();
    state = run(state, { type: 'order.create', input: createInput(state, 10) });
    const cut = state.operations[1];
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    expect(state.orders[0].materials).toHaveLength(2);
    state = run(state, updateCommand(state, {
      route: [{ operationId: cut.id, employeeId: state.employees[0].id, rate: 2, qty: 10 }],
    }));
    expect(state.orders[0].materials).toEqual([]);
  });

  it('stacks a hand-entered row with the norm delta', () => {
    let { state } = launched(10);
    const paintId = state.items[0].id;
    state = run(state, updateCommand(state, {
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
      materials: state.orders[0].materials.map(line => line.itemId === paintId ? { itemId: line.itemId, qty: 5 } : { itemId: line.itemId, qty: line.qty }),
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === paintId)!;
    expect(paint.qty).toBe(7);
    expect(paint.issuedQty).toBe(2);
  });
});
