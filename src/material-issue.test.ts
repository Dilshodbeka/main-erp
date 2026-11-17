import { describe, expect, it } from 'vitest';
import { actualCost, actualSeriesMaterialCost, applyCommand, emptyState, reservedQty, stockQty } from './domain';
import { orderShortage } from './shortage';
import type { Actor, Command, MaterialLine, State } from './types';

const admin: Actor = { id: 'admin', name: 'Admin', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function paintWorld(paint: number, hardener: number) {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Painter' });
  state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
  state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: paint, note: '' });
  state = run(state, { type: 'inventory.count', itemId: state.items[1].id, qty: hardener, note: '' });
  return state;
}

const createInput = (state: State) => ({
  kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
  materials: [] as { itemId: string; qty: number }[],
  route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 10 }],
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

function launched(paint = 100, hardener = 100) {
  let state = paintWorld(paint, hardener);
  state = run(state, { type: 'order.create', input: createInput(state) });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return { state, orderId };
}

function grow(state: State): State {
  return run(state, updateCommand(state, {
    route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
  }));
}

const rowFor = (state: State, index: number) => state.orders[0].materials.find(row => row.itemId === state.items[index].id)!;

describe('partial material issue', () => {
  it('issues only the remaining quantity on the second call', () => {
    let { state, orderId } = launched();
    expect(rowFor(state, 0)).toMatchObject({ qty: 2, issuedQty: 2, actualCost: 100 });
    expect(rowFor(state, 1)).toMatchObject({ qty: 1, issuedQty: 1, actualCost: 200 });
    state = grow(state);
    expect(rowFor(state, 0)).toMatchObject({ qty: 4, issuedQty: 2 });
    expect(rowFor(state, 1)).toMatchObject({ qty: 2, issuedQty: 1 });
    expect(state.movements.filter(row => row.source === 'order').map(row => row.qty)).toEqual([2, 1]);
    state = run(state, { type: 'order.issue', orderId });
    expect(state.movements.filter(row => row.source === 'order').map(row => row.qty)).toEqual([2, 1, 2, 1]);
    expect(rowFor(state, 0).issuedQty).toBe(4);
    expect(rowFor(state, 1).issuedQty).toBe(2);
  });

  it('reserves and reports shortage only for the unissued remainder', () => {
    let { state } = launched(3, 10);
    state = grow(state);
    expect(reservedQty(state, state.items[0].id)).toBe(2);
    expect(reservedQty(state, state.items[1].id)).toBe(1);
    const shortage = orderShortage(state, state.orders[0]);
    expect(shortage).toHaveLength(1);
    expect(shortage[0]).toMatchObject({ itemId: state.items[0].id, needed: 2, short: 1 });
  });

  it('pays only for the issued part in actual cost', () => {
    let { state, orderId } = launched();
    state = grow(state);
    expect(actualCost(state, state.orders[0])).toBe(400);
    state = run(state, { type: 'order.issue', orderId });
    expect(actualCost(state, state.orders[0])).toBe(800);
  });

  it('returns only the issued quantity when the order is cancelled', () => {
    let { state, orderId } = launched();
    state = grow(state);
    state = run(state, { type: 'order.issue', orderId });
    expect(stockQty(state, state.items[0].id)).toBe(96);
    state = run(state, { type: 'order.cancel', orderId });
    expect(stockQty(state, state.items[0].id)).toBe(100);
    expect(rowFor(state, 0).issuedQty).toBe(0);
    expect(rowFor(state, 0).actualCost).toBe(0);
  });

  it('counts only issued material in the series material cost', () => {
    const { state } = launched();
    const line: MaterialLine = { id: 'line', lineId: 'l', itemId: 'i', qty: 10, issuedQty: 4, estimatedCost: 100, actualCost: 100 };
    const order = { ...state.orders[0], materials: [line] };
    expect(actualSeriesMaterialCost(state, order)).toBe(400);
  });

  it('records a revised need above the shelf and refuses only the issue', () => {
    let { state, orderId } = launched(2, 100);
    expect(stockQty(state, state.items[0].id)).toBe(0);
    state = grow(state);
    expect(rowFor(state, 0)).toMatchObject({ qty: 4, issuedQty: 2 });
    expect(reservedQty(state, state.items[0].id)).toBe(2);
    expect(orderShortage(state, state.orders[0])[0]).toMatchObject({ itemId: state.items[0].id, needed: 2, short: 2 });
    expect(() => run(state, { type: 'order.issue', orderId })).toThrow('Omborda material yo‘q. Qoldiqni to‘ldiring');
  });
});
