import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { gapCount, priceCommands, priceGaps } from './price-board';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };
const run = (state: State, command: Command): State =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

function fixture(): State {
  let state = emptyState();
  state = run(state, { type: 'operation.create', name: 'Kromka', unit: 'meter', salePrice: 0, workerRate: 0, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
  state = run(state, { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 90000, workerRate: 20000, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'LDSP', unit: 'list', minQty: 0, cost: 0, customerId: null });
  state = run(state, { type: 'item.create', name: 'Shkaf', unit: 'dona', minQty: 0, cost: 0, customerId: null, kind: 'finished' });
  return state;
}

describe('price board', () => {
  it('lists what is not filled in', () => {
    const gaps = priceGaps(fixture());
    expect(gaps.operations.map(row => row.name)).toEqual(['Kromka']);
    expect(gaps.norms.map(row => row.name)).toEqual(['Bo‘yash']);
    expect(gaps.items.map(row => row.name)).toEqual(['Shkaf']);
    expect(gaps.costs.map(row => row.name)).toEqual(['LDSP']);
    expect(gapCount(gaps)).toBe(4);
  });

  it('builds commands only for changed rows and keeps every other field of the operation', () => {
    const state = fixture();
    const [kromka, paint] = state.operations;
    const shkaf = state.items.find(row => row.name === 'Shkaf')!;
    expect(priceCommands(state, {}, {})).toEqual([]);
    expect(priceCommands(state, { [paint.id]: { salePrice: 90000, workerRate: 20000 } }, { [shkaf.id]: 0 })).toEqual([]);
    const commands = priceCommands(state, { [kromka.id]: { salePrice: 3000, workerRate: 800 }, [paint.id]: { workerRate: -5 } }, { [shkaf.id]: 2500000 });
    expect(commands.map(row => row.type)).toEqual(['operation.update', 'item.update']);
    let next = state;
    for (const command of commands) next = run(next, command);
    expect(next.operations[0]).toMatchObject({ name: 'Kromka', unit: 'meter', salePrice: 3000, workerRate: 800, autoAccept: true, active: true });
    expect(next.operations[1]).toMatchObject({ salePrice: 90000, workerRate: 20000 });
    expect(next.items.find(row => row.id === shkaf.id)!.salePrice).toBe(2500000);
    expect(gapCount(priceGaps(next))).toBe(2);
  });
});
