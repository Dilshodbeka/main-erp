import { describe, expect, it } from 'vitest';
import { applyCommand, availableTask, stockQty, taskBlockReason } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { emptyState } from './domain';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function atomic(state: State, command: Command, actor = admin): void {
  const before = structuredClone(state);
  expect(() => run(state, command, actor)).toThrow();
  expect(state).toEqual(before);
}

function worker(state: State, id: string, name: string): Actor {
  return { id, name, role: 'worker', companyId: state.companyId };
}

function fixture() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Assembler' });
  state = run(state, { type: 'employee.create', name: 'Helper' });
  state = run(state, { type: 'employee.create', name: 'Outsider' });
  const assemblerId = state.employees[0].id;
  const helperId = state.employees[1].id;
  const outsiderId = state.employees[2].id;
  state = run(state, {
    type: 'operation.create', name: 'Yig‘ish', unit: 'piece', salePrice: 0, workerRate: 100,
    standardMinutes: 0, machineId: null, employeeIds: [assemblerId, helperId], active: true, autoAccept: false,
  });
  const operationId = state.operations[0].id;
  state = run(state, { type: 'item.create', name: 'Board', unit: 'pcs', minQty: 0, cost: 100, customerId: null, kind: 'blank', openQty: 10 });
  state = run(state, { type: 'item.create', name: 'Door', unit: 'pcs', minQty: 0, cost: 200, customerId: null, kind: 'blank', openQty: 5 });
  state = run(state, { type: 'item.create', name: 'Wardrobe', unit: 'pcs', minQty: 0, cost: 0, customerId: null, kind: 'finished' });
  const boardId = state.items[0].id;
  const doorId = state.items[1].id;
  const wardrobeId = state.items[2].id;
  const input: OrderInput = {
    kind: 'product', customerId: state.customers[0].id, title: 'Shkaf', qty: 2, price: 1000, overhead: 0,
    dueDate: '2026-12-01', advance: 0, account: 'cash',
    outputItemId: wardrobeId,
    materials: [{ itemId: boardId, qty: 2 }],
    route: [{ operationId, employeeId: assemblerId, rate: 100, assembly: true, crew: [{ employeeId: assemblerId, weight: 3 }, { employeeId: helperId, weight: 1 }] }],
  };
  return { state, input, assemblerId, helperId, outsiderId, operationId, boardId, doorId, wardrobeId };
}

function launched() {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: f.input });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  const order = state.orders[0];
  return { ...f, state, orderId, taskId: order.route[0].id, rowId: order.materials[0].id };
}

function complete(p: ReturnType<typeof launched>, qty: number, extra: { itemId?: string; output?: 'client' | 'stock'; outputItemId?: string } = {}) {
  const command: Command = {
    type: 'assembly.complete', orderId: p.orderId, taskId: p.taskId,
    materials: [{ id: p.rowId, qty, ...(extra.itemId === undefined ? {} : { itemId: extra.itemId }) }],
    output: extra.output ?? 'client',
    ...(extra.outputItemId === undefined ? {} : { outputItemId: extra.outputItemId }),
  } as Command;
  return run(p.state, command, worker(p.state, p.assemblerId, 'Assembler'));
}

describe('Yig‘ish: assembly completion', () => {
  it('writes off the actual consumption and makes the order ready', () => {
    const p = launched();
    const state = complete(p, 2.5);
    const order = state.orders[0];
    expect(stockQty(state, p.boardId)).toBe(7.5);
    expect(order.route[0].status).toBe('completed');
    expect(order.materials[0]).toMatchObject({ qty: 2.5, issuedQty: 2.5, actualQty: 2.5, actualCost: 100 });
    expect(order.status).toBe('ready');
  });

  it('splits the stage pay by crew weights', () => {
    const p = launched();
    const state = complete(p, 2);
    const lines = state.payroll.map(row => [row.employeeId, row.amount, row.status]);
    expect(lines).toEqual([[p.assemblerId, 150, 'accepted'], [p.helperId, 50, 'accepted']]);
  });

  it('lets a crew helper finish the stage', () => {
    const p = launched();
    const state = run(p.state, {
      type: 'assembly.complete', orderId: p.orderId, taskId: p.taskId,
      materials: [{ id: p.rowId, qty: 2 }], output: 'client',
    } as Command, worker(p.state, p.helperId, 'Helper'));
    expect(state.orders[0].route[0].status).toBe('completed');
  });

  it('rejects a worker outside the crew', () => {
    const p = launched();
    atomic(p.state, {
      type: 'assembly.complete', orderId: p.orderId, taskId: p.taskId,
      materials: [{ id: p.rowId, qty: 2 }], output: 'client',
    } as Command, worker(p.state, p.outsiderId, 'Outsider'));
  });

  it('substitutes the blank that was actually consumed', () => {
    const p = launched();
    const state = complete(p, 1, { itemId: p.doorId });
    const row = state.orders[0].materials[0];
    expect(stockQty(state, p.boardId)).toBe(10);
    expect(stockQty(state, p.doorId)).toBe(4);
    expect(row).toMatchObject({ itemId: p.doorId, actualItemId: p.doorId, actualQty: 1, actualCost: 200 });
  });

  it('removes a material that was not consumed at all', () => {
    const p = launched();
    const state = complete(p, 0);
    expect(state.orders[0].materials).toEqual([]);
    expect(stockQty(state, p.boardId)).toBe(10);
  });

  it('refuses to write off more than the warehouse holds', () => {
    const p = launched();
    atomic(p.state, {
      type: 'assembly.complete', orderId: p.orderId, taskId: p.taskId,
      materials: [{ id: p.rowId, qty: 15 }], output: 'client',
    } as Command, worker(p.state, p.assemblerId, 'Assembler'));
  });
});

describe('Yig‘ish: output', () => {
  it('receives the finished item into stock at its actual cost', () => {
    const p = launched();
    const state = complete(p, 2.5, { output: 'stock' });
    expect(stockQty(state, p.wardrobeId)).toBe(2);
    expect(state.items.find(item => item.id === p.wardrobeId)!.cost).toBe(225);
    const receipt = state.movements.filter(row => row.source === 'production');
    expect(receipt).toHaveLength(1);
    expect(receipt[0]).toMatchObject({ itemId: p.wardrobeId, direction: 'in', qty: 2, unitCost: 225 });
  });

  it('keeps the output out of stock when it goes to the client', () => {
    const p = launched();
    const state = complete(p, 2.5, { output: 'client' });
    expect(stockQty(state, p.wardrobeId)).toBe(0);
    expect(state.movements.some(row => row.source === 'production')).toBe(false);
  });

  it('picks the output item at completion when the order has none', () => {
    const f = fixture();
    let state = run(f.state, { type: 'order.create', input: { ...f.input, outputItemId: undefined } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    const p = { ...f, state, orderId, taskId: state.orders[0].route[0].id, rowId: state.orders[0].materials[0].id };
    const next = complete(p, 2.5, { output: 'stock', outputItemId: f.wardrobeId });
    expect(stockQty(next, f.wardrobeId)).toBe(2);
  });
});

describe('Yig‘ish: guards', () => {
  it('does not wait for materials to be issued before assembly work', () => {
    const p = launched();
    expect(availableTask(p.state, p.orderId, p.taskId)).toBe(true);
    expect(taskBlockReason(p.state, p.orderId, p.taskId)).toBeNull();
    const accepted = run(p.state, { type: 'work.accept', orderId: p.orderId, taskId: p.taskId }, worker(p.state, p.assemblerId, 'Assembler'));
    expect(accepted.orders[0].route[0].status).toBe('accepted');
  });

  it('refuses a work report on an assembly stage', () => {
    const p = launched();
    let state = run(p.state, { type: 'work.accept', orderId: p.orderId, taskId: p.taskId }, worker(p.state, p.assemblerId, 'Assembler'));
    state = run(state, { type: 'work.start', orderId: p.orderId, taskId: p.taskId }, worker(state, p.assemblerId, 'Assembler'));
    atomic(state, { type: 'work.submit', orderId: p.orderId, taskId: p.taskId, qty: 1, note: '' }, worker(state, p.assemblerId, 'Assembler'));
  });

  it('rejects assembly completion on a regular stage', () => {
    const f = fixture();
    let state = run(f.state, {
      type: 'order.create',
      input: { ...f.input, materials: [{ itemId: f.boardId, qty: 1 }], route: [{ operationId: f.operationId, employeeId: f.assemblerId, rate: 100 }] },
    });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    atomic(state, {
      type: 'assembly.complete', orderId, taskId: state.orders[0].route[0].id,
      materials: [{ id: state.orders[0].materials[0].id, qty: 1 }], output: 'client',
    } as Command);
  });

  it('rejects a crew on a regular stage', () => {
    const f = fixture();
    atomic(f.state, {
      type: 'order.create',
      input: {
        ...f.input,
        materials: [{ itemId: f.boardId, qty: 1 }],
        route: [{ operationId: f.operationId, employeeId: f.assemblerId, rate: 100, crew: [{ employeeId: f.assemblerId, weight: 1 }] }],
      },
    });
  });

  it('rejects a crew member who is not authorized for the operation', () => {
    const f = fixture();
    atomic(f.state, {
      type: 'order.create',
      input: {
        ...f.input,
        materials: [{ itemId: f.boardId, qty: 1 }],
        route: [{
          operationId: f.operationId, employeeId: f.assemblerId, rate: 100, assembly: true,
          crew: [{ employeeId: f.assemblerId, weight: 1 }, { employeeId: f.outsiderId, weight: 1 }],
        }],
      },
    });
  });
});
