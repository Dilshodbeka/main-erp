import { describe, expect, it } from 'vitest';
import { applyCommand, taskState } from './domain';
import { formatMoney } from './i18n';
import { DEMO_COMPANY_ID } from './migrations';
import { createDemo } from './seed';
import { acceptedWorkQty, boardTaskLabels, boardTaskLabel, executorLabel, stageCostText, taskUnit, unitLabel, workHistoryRows, workTaskRows } from './work-view';
import type { Actor, Command, RouteLine, State, TaskStatus } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function demo() {
  const state = createDemo(admin);
  const order = state.orders.find(row => row.status === 'production')!;
  const [first, second] = order.route;
  const worker: Actor = { id: first.employeeId!, name: 'Worker', role: 'worker', companyId: state.companyId };
  const otherWorker: Actor = {
    id: state.employees.find(employee => employee.id !== first.employeeId)!.id,
    name: 'Other', role: 'worker', companyId: state.companyId,
  };
  return { state, order, first, second, worker, otherWorker };
}

describe('worker terminal view model', () => {
  it('shows own active tasks and removes submitted work without exposing sale prices', () => {
    const { state, order, first, second, worker } = demo();
    expect(workTaskRows(state, worker).map(row => row.taskId)).toEqual([first.id, second.id]);

    let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
    expect(workTaskRows(next, worker)[0]).toMatchObject({ taskId: first.id, status: 'accepted' });
    next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    expect(workTaskRows(next, worker)[0].status).toBe('in_progress');
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: first.planned, note: '' }, worker);

    expect(workTaskRows(next, worker).map(row => row.taskId)).toEqual([second.id]);
    const history = workHistoryRows(next, worker);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      orderId: order.id, taskId: first.id, operationName: first.name, unit: 'sheet',
      taskStatus: 'completed', qty: first.planned,
    });
    expect(history[0]).not.toHaveProperty('amount');
    expect(history[0]).not.toHaveProperty('payrollStatus');
    expect(history[0]).not.toHaveProperty('salePrice');
    expect(history[0]).not.toHaveProperty('price');
  });

  it('returns rejected work to the active list and marks its payroll rejected', () => {
    const { state, order, first, worker } = demo();
    // Manual acceptance keeps the reject path reachable.
    for (const operation of state.operations) operation.autoAccept = false;
    let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: first.planned, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports[0].id, accept: false, reason: 'quality' });

    const rows = workTaskRows(next, worker);
    expect(rows[0]).toMatchObject({ taskId: first.id, status: 'in_progress' });
    expect(workHistoryRows(next, worker)[0]).toMatchObject({ status: 'rejected', taskStatus: 'in_progress' });
    expect(taskState(next, order.id, first.id)).toBe('in_progress');
  });

  it('explains that a freshly launched first stage is waiting for materials', () => {
    const { state, order, worker } = demo();
    let next = run(state, { type: 'order.create', input: {
      kind: 'product', customerId: state.customers[0].id, title: 'Rover', qty: 1, price: 100000,
      overhead: 0, dueDate: order.dueDate, advance: 0, account: 'cash',
      materials: [{ itemId: state.items[0].id, qty: 1 }],
      route: [{ operationId: state.operations[0].id, employeeId: worker.id, rate: 4000 }],
    } });
    const launched = next.orders.at(-1)!;
    next = run(next, { type: 'order.launch', orderId: launched.id });

    expect(workTaskRows(next, worker).find(row => row.taskId === launched.route[0].id)).toMatchObject({
      status: 'assigned', available: false, blockReason: 'materials',
    });

    next = run(next, { type: 'order.issue', orderId: launched.id });
    expect(workTaskRows(next, worker).find(row => row.taskId === launched.route[0].id)).toMatchObject({
      available: true, blockReason: null,
    });
  });

  it('opens the next stage as soon as the previous result is submitted', () => {
    const { state, order, first, second, worker } = demo();
    expect(second.employeeId).toBe(worker.id);
    expect(workTaskRows(state, worker).find(row => row.taskId === second.id)).toMatchObject({
      available: false, blockReason: 'previous-stage',
    });

    let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: first.planned, note: '' }, worker);

    expect(taskState(next, order.id, first.id)).toBe('completed');
    expect(workTaskRows(next, worker).find(row => row.taskId === second.id)).toMatchObject({ available: true, status: 'assigned' });
  });

  it('never exposes another worker tasks or earnings', () => {
    const { state, first, otherWorker } = demo();
    expect(workTaskRows(state, otherWorker).some(row => row.taskId === first.id)).toBe(false);
    expect(workHistoryRows(state, otherWorker)).toHaveLength(0);
  });

  it('labels every task status for the board and TV without money', () => {
    const statuses: TaskStatus[] = ['assigned', 'accepted', 'in_progress', 'submitted', 'completed'];
    expect(statuses.every(status => boardTaskLabel(status) === boardTaskLabels[status] && boardTaskLabel(status).length > 0)).toBe(true);
    expect(unitLabel('squareMeter')).toBe('m²');
  });

  it('reads a stage unit from its operation so quantities are not called pieces', () => {
    const { state, first } = demo();
    expect(taskUnit(state, first)).toBe('sheet');
    expect(unitLabel(taskUnit(state, { ...first, operationId: 'deleted-operation' }))).toBe('dona');
  });

  it('opens the task when the server snapshot authorizes the worker for the operation', () => {
    // Contract with erp_snapshot: the worker receives only their own employee row and
    // operations carrying their own id in employeeIds; the task must then be available.
    const employeeId = 'emp-kamol';
    const state: State = {
      version: 4, revision: 1, companyId: 'co-1', customers: [], suppliers: [], machines: [],
      items: [], recipes: [], purchases: [], movements: [], cash: [], reports: [], defects: [], payroll: [], warehouses: [],
      salaryPlans: [], expensePlans: [], loans: [], routeTemplates: [], workerDeductions: [], shipments: [], tickets: [], audit: [],
      employees: [{ id: employeeId, name: 'Kamol', active: true }],
      operations: [{
        id: 'op-1', name: 'Raskroy', unit: 'sheet', salePrice: 0, workerRate: 0, standardMinutes: 15,
        machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [],
      }],
      orders: [{
        id: 'ord-1', number: 'ORD-0001', kind: 'product', customerId: 'c-1', title: 'Shkaf',
        outputItemId: null, recipeVersionId: null, substitutions: {}, qty: 1, price: 0, overhead: 0,
        dueDate: '2026-11-20', createdAt: '2026-11-01T09:00:00.000Z', status: 'production',
        lines: [{ id: 'line-1', kind: 'product', title: 'Shkaf', qty: 1, total: 0, status: 'production' }],
        materials: [],
        route: [{ id: 'task-1', lineId: 'line-1', operationId: 'op-1', name: 'Raskroy', executorKind: 'employee', employeeId,
          supplierId: null, rate: 2, planned: 1, completed: 0, status: 'assigned' }],
      }],
    };
    const worker: Actor = { id: employeeId, name: 'Kamol', role: 'worker', companyId: 'co-1' };
    expect(workTaskRows(state, worker)[0]).toMatchObject({ taskId: 'task-1', available: true, blockReason: null });

    const oldServerShape = {
      ...state,
      operations: [{ ...state.operations[0], employeeIds: [] }],
    };
    expect(workTaskRows(oldServerShape, worker)[0]).toMatchObject({ available: false, blockReason: 'other' });
  });

  it('names the contractor of a supplier stage and the worker otherwise', () => {
    const { state, first } = demo();
    expect(executorLabel(state, first)).toBe(state.employees.find(row => row.id === first.employeeId)!.name);
    state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
    const outsourced: RouteLine = { ...first, executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1' };
    expect(executorLabel(state, outsourced)).toBe('Metall usta');
    expect(executorLabel(state, { ...outsourced, supplierId: 'removed' })).toBe('Pudratchi');
  });

  it('prices a supplier stage by its fixed sum and calls a worker rate a cost', () => {
    const { state, first } = demo();
    const supplierTask = state.orders.find(row => row.title === 'Metall karishlar')!.route[0];
    expect(stageCostText(state, { ...supplierTask, supplierCost: 900000 })).toContain('summa');
    expect(stageCostText(state, { ...supplierTask, supplierCost: 900000 })).not.toContain('/');
    expect(stageCostText(state, { ...supplierTask, supplierCost: 0 })).toBe('summa kiritilmagan');
    expect(stageCostText(state, first)).toBe(`tannarx ${formatMoney(first.rate)} / ${unitLabel(taskUnit(state, first))}`);
  });

  it('prices a legacy supplier stage that only carries a rate', () => {
    const { state } = demo();
    const supplierTask = state.orders.find(row => row.title === 'Metall karishlar')!.route[0];
    const legacy: RouteLine = { ...supplierTask, rate: 400000, supplierCost: 0 };
    expect(stageCostText(state, legacy)).toBe(`summa ${formatMoney(400000 * legacy.planned)}`);
  });
});

describe('defect-aware work history', () => {
  function painting() {
    const { state } = demo();
    const order = state.orders.find(row => row.title === 'Mijozning 8 fasadini bo‘yash')!;
    const first = order.route[0];
    const worker: Actor = { id: first.employeeId!, name: 'Worker', role: 'worker', companyId: state.companyId };
    return { state, order, first, worker };
  }

  it('shows no money for a rejected report and exposes the review status', () => {
    const { state, order, first, worker } = painting();
    for (const operation of state.operations) operation.autoAccept = false;
    let next = run(state, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 4, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 4, reason: 'quality' });
    expect(workHistoryRows(next, worker)[0]).toMatchObject({ qty: 4, status: 'rejected' });
    expect(workHistoryRows(next, worker)[0]).not.toHaveProperty('amount');
  });

  it('sums accepted report quantities for the period instead of payroll rows', () => {
    const { state, order, first, worker } = painting();
    for (const operation of state.operations) operation.autoAccept = false;
    let next = run(state, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 6, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 2, reason: 'quality' });
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 2, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: true });
    expect(acceptedWorkQty(next, worker.id, '2000-01-01', '2100-01-01')).toBe(6);
  });

  it('counts open defect quantity until the stage completes', () => {
    const { state, order, first, worker } = painting();
    for (const operation of state.operations) operation.autoAccept = false;
    let next = run(state, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: first.planned, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 2, reason: 'quality' });
    expect(workTaskRows(next, worker)[0]).toMatchObject({ taskId: first.id, defectQty: 2 });
    next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 2, note: '' }, worker);
    next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: true });
    expect(workTaskRows(next, worker).some(row => row.taskId === first.id)).toBe(false);
    expect(workHistoryRows(next, worker).map(row => row.qty).sort((a, b) => a - b)).toEqual([2, first.planned - 2]);
  });
});
