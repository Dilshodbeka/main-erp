import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { buildSeriesInput, validateRecipeGraph } from './recipes';
import type { Actor, Command, ItemKind, State } from './types';
import { DEMO_COMPANY_ID } from './migrations';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function atomic(state: State, command: Command): void {
  const before = structuredClone(state);
  expect(() => run(state, command)).toThrow();
  expect(state).toEqual(before);
}

function addItem(state: State, name: string, kind: ItemKind): State {
  return run(state, { type: 'item.create', kind, name, unit: 'шт', minQty: 0, cost: 0, salePrice: 0, customerId: null });
}

export function itemId(state: State, name: string): string {
  return state.items.find(item => item.name === name)!.id;
}

export function catalogWithBlankAndFacade(): State {
  let state = emptyState();
  state = addItem(state, 'LDSP', 'material');
  state = addItem(state, 'Fasad A', 'material');
  state = addItem(state, 'Fasad B', 'material');
  state = addItem(state, 'Shkaf korpus', 'blank');
  state = addItem(state, 'Shkaf', 'finished');
  return state;
}

describe('recipe versions and substitutions', () => {
  it('allows only listed substitutions and rejects recipe cycles', () => {
    let state = catalogWithBlankAndFacade();
    state = run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [
        { slot: 'Korpus', itemId: itemId(state, 'LDSP'), allowedItemIds: [], qtyPerUnit: 1 },
        { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 },
      ],
    });
    expect(state.recipes[0].versions).toHaveLength(1);
    expect(state.recipes[0].versions[0].version).toBe(1);
    expect(state.recipes[0].versions[0].components).toHaveLength(2);
    expect(state.recipes[0].versions[0].components[1]).toMatchObject({ slot: 'Fasad', itemId: null, qtyPerUnit: 1 });
    expect(() => run(state, {
      type: 'recipe.version.create', recipeId: state.recipes[0].id,
      components: [{ slot: 'Loop', itemId: itemId(state, 'Shkaf'), allowedItemIds: [], qtyPerUnit: 1 }],
    })).toThrow('Retsept sikl hosil qilmoqda');
  });

  it('appends numbered immutable versions', () => {
    let state = catalogWithBlankAndFacade();
    state = run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 }],
    });
    const first = structuredClone(state.recipes[0].versions[0]);
    state = run(state, {
      type: 'recipe.version.create', recipeId: state.recipes[0].id,
      components: [
        { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A'), itemId(state, 'Fasad B')], qtyPerUnit: 1 },
        { slot: 'Korpus', itemId: itemId(state, 'LDSP'), allowedItemIds: [], qtyPerUnit: 2 },
      ],
    });
    expect(state.recipes[0].versions.map(version => version.version)).toEqual([1, 2]);
    expect(state.recipes[0].versions[0]).toEqual(first);
    expect(state.recipes[0].active).toBe(true);
  });

  it('rejects invalid slots, norms and output kinds', () => {
    const state = catalogWithBlankAndFacade();
    const base = { type: 'recipe.create' as const, outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf' };
    atomic(state, { ...base, components: [] });
    atomic(state, { ...base, components: [{ slot: ' ', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 }] });
    atomic(state, { ...base, components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [], qtyPerUnit: 1 }] });
    atomic(state, { ...base, components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 0 }] });
    atomic(state, { ...base, components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: -1 }] });
    atomic(state, {
      ...base,
      components: [
        { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 },
        { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad B')], qtyPerUnit: 1 },
      ],
    });
    atomic(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'LDSP'), name: 'Raw',
      components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 }],
    });
    atomic(state, { ...base, name: 'Shkaf', components: [{ slot: 'Fasad', itemId: 'missing', allowedItemIds: [], qtyPerUnit: 1 }] });
  });

  it('rejects customer-owned items as recipe components', () => {
    let state = catalogWithBlankAndFacade();
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    const customerId = state.customers[0].id;
    state = run(state, { type: 'item.create', name: 'Client facade', unit: 'шт', minQty: 0, cost: 0, customerId, salePrice: 0, kind: 'material' });
    const clientItem = state.items.at(-1)!.id;
    atomic(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [clientItem], qtyPerUnit: 1 }],
    });
  });

  it('detects cycles through allowed substitutions in both directions', () => {
    let state = catalogWithBlankAndFacade();
    state = run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [{ slot: 'Korpus', itemId: itemId(state, 'Shkaf korpus'), allowedItemIds: [], qtyPerUnit: 1 }],
    });
    state = run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf korpus'), name: 'Korpus',
      components: [{ slot: 'Panel', itemId: itemId(state, 'LDSP'), allowedItemIds: [], qtyPerUnit: 1 }],
    });
    expect(() => validateRecipeGraph({
      ...state,
      recipes: state.recipes.map(recipe => recipe.outputItemId === itemId(state, 'Shkaf korpus')
        ? {
            ...recipe,
            versions: recipe.versions.map(version => ({
              ...version,
              components: version.components.map(component => ({ ...component, allowedItemIds: [itemId(state, 'Shkaf')] })),
            })),
          }
        : recipe),
    })).toThrow('Retsept sikl hosil qilmoqda');
    expect(() => validateRecipeGraph(state)).not.toThrow();
  });

  it('requires administrator rights', () => {
    const state = catalogWithBlankAndFacade();
    state.employees.push({ id: 'worker', name: 'Worker', active: true });
    const worker: Actor = { id: 'worker', name: 'Worker', role: 'worker', companyId: state.companyId };
    atomic(state, { type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf', components: [] });
    expect(() => run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [{ slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 }],
    }, worker)).toThrow('Administrator action required');
  });
});

describe('series input builder', () => {
  const route = [{ operationId: 'operation', employeeId: 'employee', rate: 1000 }];

  function recipeState() {
    let state = catalogWithBlankAndFacade();
    state = run(state, {
      type: 'recipe.create', outputItemId: itemId(state, 'Shkaf'), name: 'Shkaf',
      components: [
        { slot: 'Korpus', itemId: itemId(state, 'LDSP'), allowedItemIds: [], qtyPerUnit: 1 },
        { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 },
      ],
    });
    return { state, recipe: state.recipes[0], version: state.recipes[0].versions[0] };
  }

  it('builds series input with only allowed facade substitution', () => {
    const { state, recipe, version } = recipeState();
    const facadeA = itemId(state, 'Fasad A');
    const forbidden = itemId(state, 'LDSP');
    const input = buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: facadeA }, route, dueDate: '2026-11-10' });
    expect(input).toMatchObject({
      outputItemId: recipe.outputItemId, recipeVersionId: version.id, qty: 5, dueDate: '2026-11-10', route,
    });
    expect(input.substitutions).toEqual({ Fasad: facadeA });
    expect(() => buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: forbidden }, route })).toThrow();
  });

  it('rejects unknown slots, empty required slots and non-positive quantities', () => {
    const { recipe, version } = recipeState();
    expect(() => buildSeriesInput({ recipe, version, qty: 5, substitutions: {}, route })).toThrow('Fasad');
    expect(() => buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: 'missing' }, route })).toThrow();
    const facadeA = version.components[1].allowedItemIds[0];
    expect(() => buildSeriesInput({ recipe, version, qty: 0, substitutions: { Fasad: facadeA }, route })).toThrow();
    expect(() => buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: facadeA, Unknown: facadeA }, route })).toThrow();
  });
});
