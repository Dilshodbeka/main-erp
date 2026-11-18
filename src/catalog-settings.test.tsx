import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { blankOperation } from './components/CatalogSettings';
import type { State } from './types';

describe('new operation draft', () => {
  it('starts with no authorized worker so the owner picks them himself', () => {
    const state: State = {
      ...emptyState(),
      employees: [
        { id: 'e1', name: 'Akbar', active: true },
        { id: 'e2', name: 'Dilnoza', active: true },
        { id: 'e3', name: 'Sobir', active: false, deactivatedAt: '2026-10-01' },
      ],
    };
    expect(blankOperation(state).employeeIds).toEqual([]);
  });
});
