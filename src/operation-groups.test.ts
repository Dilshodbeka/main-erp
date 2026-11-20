import { describe, expect, it } from 'vitest';
import { operationGroups } from './operation-groups';
import type { Machine, Operation } from './types';

const op = (id: string, name: string, patch: Partial<Operation> = {}): Operation => ({
  id, name, unit: 'piece', salePrice: 0, workerRate: 0,
  standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true,
  norms: [], ...patch,
});

const machine = (id: string, name: string): Machine => ({ id, name, hourlyRevenueTarget: 0, active: true });

describe('operationGroups', () => {
  it('puts unassigned operations first, then machines sorted by name', () => {
    const groups = operationGroups(
      [op('o1', 'B', { machineId: 'm2' }), op('o2', 'A'), op('o3', 'C', { machineId: 'm1' })],
      [machine('m2', 'Frezer'), machine('m1', 'CNC')],
    );
    expect(groups.map(g => g.id)).toEqual(['none', 'm1', 'm2']);
    expect(groups.map(g => g.label)).toEqual(['Dastgohsiz', 'CNC', 'Frezer']);
  });

  it('sorts operations by name inside every group', () => {
    const groups = operationGroups(
      [
        op('s1', 'Kromka', { machineId: 'm1' }),
        op('s2', 'Aktar', { machineId: 'm1' }),
        op('s3', 'Kesish', { machineId: 'm1' }),
        op('n1', 'Yig’ish'),
        op('n2', 'Bosish'),
      ],
      [machine('m1', 'Kromka dastgohi')],
    );
    expect(groups[0].operations.map(row => row.name)).toEqual(['Bosish', 'Yig’ish']);
    expect(groups[1].operations.map(row => row.name)).toEqual(['Aktar', 'Kesish', 'Kromka']);
  });

  it('keeps inactive operations so already locked route stages still resolve', () => {
    const groups = operationGroups(
      [op('o1', 'Aktar'), op('o2', 'Keskich', { active: false })],
      [],
    );
    expect(groups[0].operations.map(row => row.id)).toEqual(['o1', 'o2']);
  });

  it('drops an operation whose machine was deleted into the unassigned group', () => {
    const groups = operationGroups([op('o1', 'Aktar', { machineId: 'gone' })], [machine('m1', 'CNC')]);
    expect(groups.map(g => g.id)).toEqual(['none']);
  });
});
