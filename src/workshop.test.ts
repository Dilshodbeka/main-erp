import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID, migrateState } from './migrations';
import { mainWorkshop, MAIN_WORKSHOP_ID } from './workshop-default';
import type { Actor, Command, Operation, Order, State, WorkReport } from './types';

const WH2 = '00000000-0000-4000-8000-00000000b002';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor: Actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function operation(over: Partial<Operation> = {}): Operation {
  return {
    id: 'op2', name: 'Bo‘yash', unit: 'piece', salePrice: 10, workerRate: 5, standardMinutes: 10,
    machineId: null, employeeIds: ['e1'], active: true, autoAccept: false, norms: [], workshopId: WH2, ...over,
  };
}

function world(over: Partial<State> = {}): State {
  return {
    ...emptyState(),
    workshops: [mainWorkshop(), { id: WH2, name: 'Bo‘yash sehi', active: true }],
    employees: [{ id: 'e1', name: 'Ali', active: true }],
    operations: [operation()],
    customers: [{ id: 'c1', name: 'Mijoz', phone: '', address: '', kind: 'customer', employeeId: null }],
    ...over,
  };
}

function orderWithReport(state: State): { state: State; taskId: string; reportId: string } {
  const line = { id: 'l1', kind: 'product' as const, title: 'Stol', qty: 1, total: 100, status: 'production' as const };
  const task = {
    id: 't1', lineId: line.id, operationId: 'op2', name: 'Bo‘yash', executorKind: 'employee' as const,
    employeeId: 'e1', supplierId: null, rate: 5, planned: 1, completed: 0, status: 'submitted' as const, workshopId: WH2,
  };
  const order: Order = {
    id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Stol', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20',
    createdAt: '2026-11-01T00:00:00.000Z', status: 'production', lines: [line], materials: [], route: [task],
  };
  const report: WorkReport = {
    id: 'r1', orderId: order.id, taskId: task.id, employeeId: 'e1', qty: 1, status: 'submitted', note: '',
    createdAt: '2026-11-02T00:00:00.000Z',
  };
  return { state: { ...state, orders: [order], reports: [report] }, taskId: task.id, reportId: report.id };
}

describe('миграция цехов', () => {
  it('заполняет workshops и workshopId у станков, операций и этапов', () => {
    const legacy = {
      ...emptyState(),
      workshops: undefined,
      machines: [{ id: 'mc1', name: 'Press', hourlyRevenueTarget: 0, active: true }],
      operations: [{ id: 'op1', name: 'Kesish', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 1,
        machineId: 'mc1', employeeIds: [], active: true, autoAccept: true, norms: [] }],
      orders: [{
        id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Stol', qty: 1, price: 0,
        overhead: 0, dueDate: '2026-11-20', createdAt: '', status: 'production', lines: [], materials: [],
        route: [{ id: 't1', operationId: 'op1', name: 'Kesish', rate: 1, planned: 1, completed: 0 }],
      }],
    };
    const state = migrateState(legacy);
    expect(state.workshops).toEqual([{ id: MAIN_WORKSHOP_ID, name: 'Asosiy ishlab chiqarish', active: true }]);
    expect(state.machines[0].workshopId).toBe(MAIN_WORKSHOP_ID);
    expect(state.operations[0].workshopId).toBe(MAIN_WORKSHOP_ID);
    expect(state.orders[0].route[0].workshopId).toBe(MAIN_WORKSHOP_ID);
  });

  it('берёт цех операции для этапа без собственного цеха', () => {
    const legacy = {
      ...emptyState(),
      operations: [operation({ id: 'op2' })],
      orders: [{
        id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Stol', qty: 1, price: 0,
        overhead: 0, dueDate: '2026-11-20', createdAt: '', status: 'production', lines: [], materials: [],
        route: [{ id: 't1', operationId: 'op2', name: 'Bo‘yash', rate: 1, planned: 1, completed: 0 }],
      }],
    };
    expect(migrateState(legacy).orders[0].route[0].workshopId).toBe(WH2);
  });
});

describe('цех этапа', () => {
  it('этап получает цех операции при создании заказа', () => {
    let state = world();
    state = run(state, {
      type: 'order.create',
      input: {
        kind: 'product', customerId: 'c1', title: 'Stol', qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20',
        advance: 0, account: 'cash', route: [{ operationId: 'op2', employeeId: 'e1', rate: 5 }],
      },
    });
    expect(state.orders[0].route[0].workshopId).toBe(WH2);
  });

  it('перенос операции не переписывает цех уже созданного этапа', () => {
    let state = world();
    state = run(state, {
      type: 'order.create',
      input: {
        kind: 'product', customerId: 'c1', title: 'Stol', qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20',
        advance: 0, account: 'cash', route: [{ operationId: 'op2', employeeId: 'e1', rate: 5 }],
      },
    });
    state = run(state, {
      type: 'operation.update', operationId: 'op2', name: 'Bo‘yash', unit: 'piece', salePrice: 10, workerRate: 5,
      standardMinutes: 10, machineId: null, employeeIds: ['e1'], active: true, autoAccept: false,
      workshopId: MAIN_WORKSHOP_ID,
    });
    expect(state.operations[0].workshopId).toBe(MAIN_WORKSHOP_ID);
    expect(state.orders[0].route[0].workshopId).toBe(WH2);
  });

  it('ревизия заказа не переносит цех начатого этапа', () => {
    let state = world();
    state = run(state, {
      type: 'order.create',
      input: {
        kind: 'product', customerId: 'c1', title: 'Stol', qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20',
        advance: 0, account: 'cash', route: [{ operationId: 'op2', employeeId: 'e1', rate: 5 }],
      },
    });
    state = run(state, { type: 'order.launch', orderId: state.orders[0].id });
    const taskId = state.orders[0].route[0].id;
    const worker: Actor = { id: 'e1', name: 'Ali', role: 'worker', companyId: DEMO_COMPANY_ID };
    state = run(state, { type: 'work.accept', orderId: state.orders[0].id, taskId }, worker);
    state = run(state, {
      type: 'operation.update', operationId: 'op2', name: 'Bo‘yash', unit: 'piece', salePrice: 10, workerRate: 5,
      standardMinutes: 10, machineId: null, employeeIds: ['e1'], active: true, autoAccept: false,
      workshopId: MAIN_WORKSHOP_ID,
    });
    state = run(state, {
      type: 'order.update', orderId: state.orders[0].id, title: 'Stol', qty: 1, price: 100,
      overhead: 0, dueDate: '2026-11-21', materials: [],
      route: [{ taskId, operationId: 'op2', employeeId: 'e1', rate: 5 }],
    });
    expect(state.orders[0].route[0].workshopId).toBe(WH2);
  });
});

describe('приёмка начальником цеха', () => {
  const chief = (workshopIds: string[]): Actor => ({
    id: 'chief', name: 'Seh boshlig‘i', role: 'worker', companyId: DEMO_COMPANY_ID,
    permissions: ['work.review', 'production.view_all', 'orders.issue_materials'], workshopIds,
  });

  it('чужой этап принимать нельзя', () => {
    const { state, reportId } = orderWithReport(world());
    expect(() => run(state, { type: 'work.review', reportId, accept: true }, chief([MAIN_WORKSHOP_ID]))).toThrow();
  });

  it('этап своего цеха принимается', () => {
    const { state, reportId } = orderWithReport(world());
    const next = run(state, { type: 'work.review', reportId, accept: true }, chief([WH2]));
    expect(next.reports[0].status).toBe('accepted');
  });

  it('админ не ограничен цехом', () => {
    const { state, reportId } = orderWithReport(world());
    expect(run(state, { type: 'work.review', reportId, accept: true }).reports[0].status).toBe('accepted');
  });

  it('начальник цеха выдаёт материалы только по заказам своих цехов', () => {
    const base = orderWithReport(world());
    const order = base.state.orders[0];
    const state: State = {
      ...base.state,
      items: [{ id: 'i1', name: 'LDSP', unit: 'sheet', minQty: 0, cost: 10, customerId: null, kind: 'material',
        salePrice: 0, lastPurchasePrice: 10, materialCost: 10, laborCost: 0, category: null }],
      movements: [{ id: 'in1', itemId: 'i1', direction: 'in', qty: 10, unitCost: 10, source: 'purchase',
        sourceId: '', note: '', createdAt: '2026-11-01T00:00:00.000Z' }],
      orders: [{ ...order, materials: [{ id: 'm1', lineId: order.lines[0].id, itemId: 'i1', qty: 2, issuedQty: 0, estimatedCost: 20, actualCost: 0 }] }],
    };
    expect(() => run(state, { type: 'order.issue', orderId: order.id }, chief([MAIN_WORKSHOP_ID]))).toThrow();
    const next = run(state, { type: 'order.issue', orderId: order.id }, chief([WH2]));
    expect(next.orders[0].materials[0].issuedQty).toBe(2);
  });
});
