import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { AssemblyComplete, WorkTasks } from './components/WorkTasks';
import { OrderPositions } from './components/OrderPositions';
import { positionLines, positionsFromOrder } from './order-editor';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function worker(state: State, id: string, name: string): Actor {
  return { id, name, role: 'worker', companyId: state.companyId };
}

function launched() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Assembler' });
  state = run(state, { type: 'employee.create', name: 'Helper' });
  const assemblerId = state.employees[0].id;
  const helperId = state.employees[1].id;
  state = run(state, {
    type: 'operation.create', name: 'Yig‘ish', unit: 'piece', salePrice: 0, workerRate: 100,
    standardMinutes: 0, machineId: null, employeeIds: [assemblerId, helperId], active: true, autoAccept: false,
  });
  state = run(state, { type: 'item.create', name: 'Board', unit: 'pcs', minQty: 0, cost: 100, customerId: null, kind: 'blank', openQty: 10 });
  state = run(state, { type: 'item.create', name: 'Wardrobe', unit: 'pcs', minQty: 0, cost: 0, customerId: null, kind: 'finished' });
  const boardId = state.items[0].id;
  const wardrobeId = state.items[1].id;
  const input: OrderInput = {
    kind: 'product', customerId: state.customers[0].id, title: 'Shkaf', qty: 2, price: 1000, overhead: 0,
    dueDate: '2026-12-01', advance: 0, account: 'cash', outputItemId: wardrobeId,
    materials: [{ itemId: boardId, qty: 2 }],
    route: [{ operationId: state.operations[0].id, employeeId: assemblerId, rate: 100, assembly: true, crew: [{ employeeId: assemblerId, weight: 3 }, { employeeId: helperId, weight: 1 }] }],
  };
  state = run(state, { type: 'order.create', input });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  const order = state.orders[0];
  return { state, orderId, taskId: order.route[0].id, assemblerId, helperId, boardId, wardrobeId };
}

describe('Yig‘ish UI: worker card', () => {
  it('offers the big Tayyor button instead of the report flow', () => {
    const p = launched();
    const html = renderToStaticMarkup(createElement(WorkTasks, {
      state: p.state, actor: worker(p.state, p.assemblerId, 'Assembler'), busy: false, run: async () => true,
    }));
    expect(html).toContain('Tayyor');
    expect(html).toContain('Haqiqiy sarf');
    expect(html).not.toContain('Topshiriqni qabul qilish');
    expect(html).not.toContain('Natijani topshirish');
  });

  it('shows the stage to every crew member', () => {
    const p = launched();
    const html = renderToStaticMarkup(createElement(WorkTasks, {
      state: p.state, actor: worker(p.state, p.helperId, 'Helper'), busy: false, run: async () => true,
    }));
    expect(html).toContain('Yig‘ish');
    expect(html).toContain('Tayyor');
  });
});

describe('Yig‘ish UI: completion dialog', () => {
  it('renders consumption rows and the output choice', () => {
    const p = launched();
    const html = renderToStaticMarkup(createElement(AssemblyComplete, {
      state: p.state, orderId: p.orderId, taskId: p.taskId, busy: false, close: () => {}, save: async () => true,
    }));
    for (const text of ['Haqiqiy sarf', 'Board', 'Mijozga', 'Omborga', 'Tayyor']) expect(html).toContain(text);
  });
});

describe('Yig‘ish UI: order positions', () => {
  it('marks the stage as assembly and names the crew', () => {
    const p = launched();
    const html = renderToStaticMarkup(createElement(OrderPositions, {
      state: p.state, order: p.state.orders[0], busy: false, onIssue: () => {}, onShip: () => {}, onCancel: () => {},
    }));
    expect(html).toContain('Yig‘ish');
    expect(html).toContain('brigada');
    expect(html).toContain('Assembler');
    expect(html).toContain('Helper');
  });
});

describe('Yig‘ish UI: route editor model', () => {
  it('round-trips the assembly flag and crew through the editor draft', () => {
    const p = launched();
    const [position] = positionsFromOrder(p.state, p.state.orders[0]);
    expect(position.route[0]).toMatchObject({ assembly: true, crew: [{ employeeId: p.assemblerId, weight: 3 }, { employeeId: p.helperId, weight: 1 }] });
    expect(positionLines([position])[0].route[0]).toMatchObject({ assembly: true, crew: [{ employeeId: p.assemblerId, weight: 3 }, { employeeId: p.helperId, weight: 1 }] });
  });
});
