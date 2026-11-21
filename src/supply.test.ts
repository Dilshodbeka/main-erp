import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID, migrateState } from './migrations';
import { planCommand, purchasePlan, supplyNeeds } from './supply';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import type { Actor, Command, Item, MaterialLine, Order, State, Status, StockMovement } from './types';

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, name: `Pozitsiya ${id}`, unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01', ...over };
}

function stock(itemId: string, qty: number, warehouseId = MAIN_WAREHOUSE_ID): StockMovement {
  return { id: `mv-${itemId}-${warehouseId}`, itemId, direction: 'in', qty, unitCost: 10, source: 'purchase', sourceId: 'p1',
    note: '', createdAt: '2026-11-01T00:00:00.000Z', warehouseId };
}

function material(id: string, itemId: string, qty: number, issuedQty = 0): MaterialLine {
  return { id, lineId: 'L1', itemId, qty, estimatedCost: 0, issuedQty, actualCost: 0 };
}

function order(id: string, materials: MaterialLine[], over: Partial<Order> = {}, status: Status = 'production'): Order {
  return { id, number: `ORD-${id}`, kind: 'product', customerId: 'c1', title: id, outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 1, price: 0, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status, lines: [], materials, route: [], ...over };
}

function world(over: Partial<State> = {}): State {
  return { ...emptyState(), items: [item('paint')], ...over };
}

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

describe('supplyNeeds', () => {
  it('суммирует потребность двух заказов по одной позиции и складу', () => {
    const state = world({
      items: [item('paint', { lastPurchasePrice: 12 })],
      movements: [stock('paint', 10)],
      orders: [
        order('A', [material('m1', 'paint', 13)], { dueDate: '2026-11-20' }),
        order('B', [material('m2', 'paint', 2)], { dueDate: '2026-11-22' }),
      ],
    });
    const needs = supplyNeeds(state);
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ itemId: 'paint', warehouseId: MAIN_WAREHOUSE_ID, short: 5, lastPurchasePrice: 12 });
    expect(needs[0].orders.map(row => row.id)).toEqual(['A', 'B']);
    expect(needs[0].orders.map(row => row.short)).toEqual([13, 2]);
  });

  it('вычитает уже выданное количество', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', [material('m1', 'paint', 13, 6)]), order('B', [material('m2', 'paint', 2)])],
    });
    // выдано 6 из 13: спрос 7 + 2 = 9 при остатке 10 — дефицита нет
    expect(supplyNeeds(state)).toEqual([]);
  });

  it('не смешивает склады', () => {
    const state = world({
      movements: [stock('paint', 20, MAIN_WAREHOUSE_ID)],
      orders: [order('A', [material('m1', 'paint', 5)], { warehouseId: '00000000-0000-4000-8000-00000000a002' })],
    });
    const needs = supplyNeeds(state);
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ warehouseId: '00000000-0000-4000-8000-00000000a002', short: 5 });
  });

  it('не считает черновые и закрытые заказы', () => {
    const state = world({
      movements: [stock('paint', 1)],
      orders: [order('A', [material('m1', 'paint', 5)], {}, 'draft'), order('B', [material('m2', 'paint', 5)], {}, 'delivered')],
    });
    expect(supplyNeeds(state)).toEqual([]);
  });

  it('сортирует по размеру дефицита, затем по ближайшему сроку', () => {
    const state = world({
      items: [item('paint'), item('glue', { name: 'Kley' })],
      movements: [],
      orders: [
        order('A', [material('m1', 'paint', 2)], { dueDate: '2026-12-01' }),
        order('B', [material('m2', 'glue', 2)], { dueDate: '2026-11-19' }),
        order('C', [material('m3', 'glue', 3)], { dueDate: '2026-11-25' }),
      ],
    });
    const needs = supplyNeeds(state);
    expect(needs.map(row => row.itemId)).toEqual(['glue', 'paint']);
    expect(needs[0].short).toBe(5);
  });
});

describe('purchase.create с orderId', () => {
  function purchaseWorld(): { state: State; supplierId: string; itemId: string } {
    let state = emptyState();
    state = run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
    state = run(state, { type: 'item.create', name: 'Fabric', unit: 'm', minQty: 0, cost: 5, customerId: null });
    state = { ...state, orders: [order('A', [material('m1', state.items[0].id, 5)])] };
    return { state, supplierId: state.suppliers[0].id, itemId: state.items[0].id };
  }

  it('сохраняет заказ для трассировки', () => {
    const { state, supplierId, itemId } = purchaseWorld();
    const next = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId, qty: 5, price: 10 }], orderId: 'A' });
    expect(next.purchases[0].orderId).toBe('A');
  });

  it('без заказа пишет null', () => {
    const { state, supplierId, itemId } = purchaseWorld();
    const next = run(state, { type: 'purchase.create', supplierId, lines: [{ itemId, qty: 5, price: 10 }] });
    expect(next.purchases[0].orderId).toBeNull();
  });

  it('отклоняет неизвестный заказ', () => {
    const { state, supplierId, itemId } = purchaseWorld();
    const before = structuredClone(state);
    expect(() => run(state, { type: 'purchase.create', supplierId, lines: [{ itemId, qty: 5, price: 10 }], orderId: 'nope' })).toThrow();
    expect(state).toEqual(before);
  });

  it('миграция заполняет orderId у старых закупок', () => {
    const migrated = migrateState({ ...emptyState(), version: 4, purchases: [{ id: 'p1', number: 'PUR-0001', supplierId: 's1', lines: [], createdAt: '' }] });
    expect(migrated.purchases[0].orderId).toBeNull();
  });
});

describe('дефицит → закупка → приём', () => {
  it('потребность закрывается только после приёма материала', () => {
    let state = emptyState();
    state = run(state, { type: 'supplier.create', name: 'Supplier', phone: '' });
    state = run(state, { type: 'item.create', name: 'Fabric', unit: 'm', minQty: 0, cost: 5, customerId: null });
    const itemId = state.items[0].id;
    state = { ...state, orders: [order('A', [material('m1', itemId, 5)])] };
    expect(supplyNeeds(state)[0]).toMatchObject({ itemId, short: 5 });

    state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId, qty: 5, price: 10 }], orderId: 'A' });
    expect(state.purchases[0].orderId).toBe('A');
    expect(supplyNeeds(state)[0].short).toBe(5);

    const purchase = state.purchases[0];
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 5 }] });
    expect(supplyNeeds(state)).toEqual([]);
  });
});

describe('purchasePlan', () => {
  const supplier = (id: string, name: string) => ({ id, name, phone: '' });
  const bought = (id: string, supplierId: string, itemId: string, qty: number, received: number, createdAt: string) => ({
    id, number: id, supplierId, createdAt, warehouseId: MAIN_WAREHOUSE_ID, orderId: null,
    lines: [{ id: `${id}-l`, itemId, qty, price: 100, received, previousPurchasePrice: 0, newPurchasePrice: 0, previousAverageCost: 0, newAverageCost: 0 }],
  });

  it('groups what is missing by the supplier who sold it last, at the last price', () => {
    const state = world({
      items: [item('paint', { name: 'Lak', lastPurchasePrice: 50000 }), item('edge', { name: 'Kromka', unit: 'm', lastPurchasePrice: 2000 })],
      suppliers: [supplier('s1', 'Gigant'), supplier('s2', 'Yufurni')] as State['suppliers'],
      purchases: [bought('p1', 's2', 'paint', 5, 5, '2026-10-01T00:00:00.000Z'), bought('p2', 's1', 'paint', 5, 5, '2026-11-01T00:00:00.000Z'),
        bought('p3', 's2', 'edge', 100, 100, '2026-11-02T00:00:00.000Z')] as State['purchases'],
      movements: [stock('paint', 3)],
      orders: [order('A', [material('m1', 'paint', 10), material('m2', 'edge', 40)])],
    });
    const plan = purchasePlan(state, MAIN_WAREHOUSE_ID);
    expect(plan.map(group => [group.supplierName, group.lines.map(line => [line.name, line.qty, line.price])])).toEqual([
      ['Gigant', [['Lak', 7, 50000]]], ['Yufurni', [['Kromka', 40, 2000]]]]);
    expect(plan[0].total).toBe(350000);
    expect(planCommand(plan[0], 's1', MAIN_WAREHOUSE_ID)).toEqual({ type: 'purchase.create', supplierId: 's1', warehouseId: MAIN_WAREHOUSE_ID,
      lines: [{ itemId: 'paint', qty: 7, price: 50000 }] });
  });

  it('does not order twice what is already on its way', () => {
    const state = world({
      suppliers: [supplier('s1', 'Gigant')] as State['suppliers'],
      purchases: [bought('p1', 's1', 'paint', 6, 0, '2026-11-01T00:00:00.000Z')] as State['purchases'],
      orders: [order('A', [material('m1', 'paint', 10)])],
    });
    expect(purchasePlan(state, MAIN_WAREHOUSE_ID)[0].lines[0]).toMatchObject({ qty: 4, onOrder: 6, forOrders: 4 });
    const covered = { ...state, purchases: [bought('p1', 's1', 'paint', 10, 0, '2026-11-01T00:00:00.000Z')] as State['purchases'] };
    expect(purchasePlan(covered, MAIN_WAREHOUSE_ID)).toEqual([]);
  });

  it('tops the stock up to the minimum and keeps never-bought materials in a group without a supplier', () => {
    const state = world({ items: [item('paint', { name: 'Lak', minQty: 5 }), item('glue', { name: 'Yelim', minQty: 0 })], movements: [stock('paint', 2)] });
    const plan = purchasePlan(state, MAIN_WAREHOUSE_ID);
    expect(plan).toHaveLength(1);
    expect(plan[0].supplierId).toBeNull();
    expect(plan[0].lines).toEqual([expect.objectContaining({ name: 'Lak', qty: 3, forMinimum: 3, forOrders: 0 })]);
  });

  it('never plans customer materials or own products', () => {
    const state = world({ items: [item('paint', { customerId: 'c1', cost: 0 }), item('blank', { kind: 'blank', minQty: 4 })],
      orders: [order('A', [material('m1', 'paint', 10)])] });
    expect(purchasePlan(state, MAIN_WAREHOUSE_ID)).toEqual([]);
  });

  it('one click creates a real purchase the kernel accepts', () => {
    let state = run(emptyState(), { type: 'supplier.create', name: 'Gigant', phone: '' });
    state = run(state, { type: 'item.create', name: 'Lak', unit: 'l', minQty: 8, cost: 0, customerId: null });
    const plan = purchasePlan(state, MAIN_WAREHOUSE_ID);
    state = run(state, planCommand(plan[0], state.suppliers[0].id, MAIN_WAREHOUSE_ID));
    expect(state.purchases[0].lines[0]).toMatchObject({ qty: 8, received: 0 });
    expect(purchasePlan(state, MAIN_WAREHOUSE_ID)).toEqual([]);
  });
});
