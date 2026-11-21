import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { nextDemoCommand, setupSteps, type SetupStepId } from './setup';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'setup-admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
let seq = 0;
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: `setup-${++seq}`, expectedRevision: state.revision, command }, admin);

function runStep(step: SetupStepId, state: State): State {
  for (let i = 0; i < 32; i++) {
    const command = nextDemoCommand(step, state);
    if (!command) return state;
    state = run(state, command);
  }
  throw new Error(`Demo step ${step} did not settle`);
}

const done = (state: State) => setupSteps.map(step => [step.id, step.done(state)] as const);

describe('setup steps', () => {
  it('reports progress from the current state', () => {
    let state = emptyState();
    expect(done(state)).toEqual([['employees', false], ['materials', false], ['operations', false], ['order', false]]);
    state = run(state, { type: 'employee.create', name: 'Usta' });
    expect(done(state)[0]).toEqual(['employees', true]);
    expect(done(state)[1]).toEqual(['materials', false]);
    state = run(state, { type: 'item.create', name: 'Bo‘yoq', unit: 'litr', minQty: 0, cost: 0, customerId: null });
    expect(done(state)[1]).toEqual(['materials', true]);
    state = run(state, { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 100000, workerRate: 40000, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
    expect(done(state)[2]).toEqual(['operations', true]);
    expect(done(state)[3]).toEqual(['order', false]);
  });

  it('counts only active workers, own materials and active operations', () => {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Usta' });
    state = run(state, { type: 'employee.update', employeeId: state.employees[0].id, name: 'Usta', active: false });
    state = run(state, { type: 'customer.create', name: 'Mijoz', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Mijoz materiali', unit: 'dona', minQty: 0, cost: 0, customerId: state.customers[0].id });
    state = run(state, { type: 'operation.create', name: 'Kesish', unit: 'piece', salePrice: 10000, workerRate: 5000, standardMinutes: 0, machineId: null, employeeIds: [], active: false, autoAccept: true });
    expect(done(state)).toEqual([['employees', false], ['materials', false], ['operations', false], ['order', false]]);
  });
});

describe('demo planner', () => {
  it('creates two employees, then stops', () => {
    const state = runStep('employees', emptyState());
    expect(state.employees.map(row => row.name)).toEqual(['Seh ustasi', 'Yig‘uvchi']);
    expect(nextDemoCommand('employees', state)).toBeNull();
    expect(state.items).toHaveLength(0);
    expect(state.operations).toHaveLength(0);
  });

  it('recognizes an existing worker by normalized name', () => {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: '  seh USTASI ' });
    const next = nextDemoCommand('employees', state);
    expect(next).toEqual({ type: 'employee.create', name: 'Yig‘uvchi' });
  });

  it('creates exactly six materials without touching people or operations', () => {
    const state = runStep('materials', emptyState());
    expect(state.items.map(row => [row.name, row.unit, row.minQty, row.customerId, row.category])).toEqual([
      ['Fasad · eman', 'dona', 0, null, '01.07'],
      ['Fasad · oq', 'dona', 0, null, '01.07'],
      ['Poliuretan bo‘yoq · oq', 'litr', 5, null, '06.01'],
      ['Qotiruvchi', 'litr', 2, null, '06.04'],
      ['Erituvchi 646', 'litr', 2, null, '06.05'],
      ['Abraziv doira P120', 'dona', 20, null, '07.03'],
    ]);
    expect(state.employees).toHaveLength(0);
    expect(state.operations).toHaveLength(0);
  });

  it('creates prerequisites and both operations with norms', () => {
    const state = runStep('operations', emptyState());
    expect(state.employees).toHaveLength(2);
    expect(state.items).toHaveLength(6);
    expect(state.operations.map(row => row.name)).toEqual(['Jilolash', 'Bo‘yash']);
    const abrasive = state.items.find(row => row.name === 'Abraziv doira P120')!;
    const paint = state.items.find(row => row.name === 'Poliuretan bo‘yoq · oq')!;
    const hardener = state.items.find(row => row.name === 'Qotiruvchi')!;
    const jilolash = state.operations.find(row => row.name === 'Jilolash')!;
    const boyash = state.operations.find(row => row.name === 'Bo‘yash')!;
    expect(jilolash).toMatchObject({ unit: 'squareMeter', salePrice: 80000, workerRate: 30000, active: true, autoAccept: false });
    expect(jilolash.norms).toEqual([{ itemId: abrasive.id, qtyPerM2: 0.5 }]);
    expect(boyash).toMatchObject({ unit: 'squareMeter', salePrice: 150000, workerRate: 50000, active: true, autoAccept: false });
    expect(boyash.norms).toEqual([{ itemId: paint.id, qtyPerM2: 0.25 }, { itemId: hardener.id, qtyPerM2: 0.1 }]);
    expect(jilolash.employeeIds).toHaveLength(2);
    expect(nextDemoCommand('operations', state)).toBeNull();
  });

  it('builds the whole chain and a draft order from an empty company', () => {
    const state = runStep('order', emptyState());
    expect(state.employees).toHaveLength(2);
    expect(state.items).toHaveLength(6);
    expect(state.operations).toHaveLength(2);
    expect(state.customers.map(row => [row.name, row.phone, row.kind])).toEqual([['Aziza Karimova', '+998 90 123 45 67', 'customer']]);
    expect(state.cash).toHaveLength(0);
    expect(state.orders).toHaveLength(1);
    const order = state.orders[0];
    expect(order).toMatchObject({ status: 'draft', kind: 'service', title: 'Fasadlarni bo‘yash · 12 m²', qty: 1, price: 1800000, overhead: 100000 });
    expect(order.route.map(task => [task.name, task.planned, task.rate, task.status])).toEqual([
      ['Jilolash', 12, 30000, 'assigned'],
      ['Bo‘yash', 12, 50000, 'assigned'],
    ]);
    expect(order.materials).toHaveLength(3);
    const byName = Object.fromEntries(order.materials.map(line => [state.items.find(item => item.id === line.itemId)!.name, line]));
    expect(byName['Abraziv doira P120'].qty).toBe(6);
    expect(byName['Poliuretan bo‘yoq · oq'].qty).toBe(3);
    expect(byName['Qotiruvchi'].qty).toBeCloseTo(1.2, 8);
    expect(order.materials.every(line => line.issuedQty === 0)).toBe(true);
    expect(setupSteps.every(step => step.done(state))).toBe(true);
  });

  it('is idempotent on a repeated full run', () => {
    let state = runStep('order', emptyState());
    const counts = [state.employees.length, state.items.length, state.operations.length, state.customers.length, state.orders.length];
    for (const step of ['employees', 'materials', 'operations', 'order'] as SetupStepId[]) state = runStep(step, state);
    expect([state.employees.length, state.items.length, state.operations.length, state.customers.length, state.orders.length]).toEqual(counts);
    expect(nextDemoCommand('order', state)).toBeNull();
  });
});
