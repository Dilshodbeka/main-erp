import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, reservedQty } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { draftShortage, orderShortage, reservedExcept } from './shortage';
import { positionsFromOrder } from './order-editor';
import type { PositionDraft } from './order-editor';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import type { Actor, Command, Item, MaterialLine, Operation, Order, State, Status, StockMovement } from './types';

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, name: `Pozitsiya ${id}`, unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01', ...over };
}

function stock(itemId: string, qty: number): StockMovement {
  return { id: `mv-${itemId}`, itemId, direction: 'in', qty, unitCost: 10, source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-11-01T00:00:00.000Z' };
}

function material(id: string, itemId: string, qty: number, issuedQty = 0, lineId = 'L1'): MaterialLine {
  return { id, lineId, itemId, qty, estimatedCost: 0, issuedQty, actualCost: 0 };
}

function order(id: string, status: Status, materials: MaterialLine[], over: Partial<Order> = {}): Order {
  return { id, number: `ORD-${id}`, kind: 'product', customerId: 'c1', title: id, outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 1, price: 0, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status, lines: [], materials, route: [], ...over };
}

function world(over: Partial<State> = {}): State {
  return { ...emptyState(), items: [item('paint'), item('thinner', { name: 'Erituvchi 646', category: '06.05' })], ...over };
}

const paintOperation = (norms: { itemId: string; qtyPerM2: number }[]): Operation => ({
  id: 'opPaint', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0,
  machineId: null, employeeIds: [], active: true, autoAccept: true, norms,
});

// те же хелперы, что в src/domain.test.ts: селектор проверяется о реальный домен, а не о фикстуру
const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

describe('orderShortage', () => {
  it('не считает дефицитом превышение в пределах допуска домена', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 10 + Number.EPSILON * 40)])],
    });
    expect(orderShortage(state, state.orders[0])).toEqual([]);
  });

  it('отдаёт одну строку с точными цифрами', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 6)]), order('B', 'production', [material('m2', 'paint', 8)])],
    });
    const rows = orderShortage(state, state.orders[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'paint', name: 'Pozitsiya paint', needed: 6, stock: 10, reserved: 8, available: 2, short: 4 });
  });

  it('не резервирует материал против самого себя и вычитает чужие заказы', () => {
    const state = world({ movements: [stock('paint', 10)], orders: [order('A', 'production', [material('m1', 'paint', 6)]), order('B', 'production', [material('m2', 'paint', 3)])] });
    expect(reservedExcept(state, 'paint', 'A')).toBe(3);
    expect(reservedExcept(state, 'paint', null)).toBe(9);
    expect(orderShortage(state, state.orders.find(o => o.id === 'A')!)).toEqual([]);
  });

  it('паритет с доменной бронью: чужая броня плюс своё невыданное равно reservedQty', () => {
    // заказ C в ready ничего не занимает (так же считает public.erp_reserved_qty),
    // поэтому без проверки статуса в reservedExcept сумма разъедается на его 4 л
    const state = world({
      movements: [stock('paint', 10)],
      orders: [
        order('A', 'production', [material('m1', 'paint', 6)]),
        order('B', 'production', [material('m2', 'paint', 3)]),
        order('C', 'ready', [material('m3', 'paint', 4)]),
      ],
    });
    const own = state.orders[0].materials.filter(line => line.issuedQty < line.qty).reduce((qty, line) => qty + line.qty, 0);
    expect(reservedExcept(state, 'paint', 'A')).toBe(3);
    expect(own).toBe(6);
    expect(reservedExcept(state, 'paint', 'A') + own).toBe(reservedQty(state, 'paint'));
    expect(reservedQty(state, 'paint')).toBe(9);
  });

  it('складывает один материал по всем позициям и игнорирует выданное', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 4, 0, 'L1'), material('m2', 'paint', 5, 0, 'L2'), material('m3', 'paint', 9, 9, 'L3')])],
    });
    expect(orderShortage(state, state.orders[0])).toEqual([]);
    const deficit = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 8, 0, 'L1'), material('m2', 'paint', 5, 0, 'L2'), material('m3', 'paint', 9, 9, 'L3')])],
    });
    expect(orderShortage(deficit, deficit.orders[0])).toEqual([
      { itemId: 'paint', name: 'Pozitsiya paint', unit: 'l', needed: 13, stock: 10, reserved: 0, available: 10, short: 3,
        warehouseId: MAIN_WAREHOUSE_ID, suggestedFrom: [] },
    ]);
  });

  it('сортирует по убыванию дефицита', () => {
    const state = world({
      movements: [stock('paint', 1), stock('thinner', 1)],
      orders: [order('A', 'production', [material('m1', 'paint', 4), material('m2', 'thinner', 8)])],
    });
    expect(orderShortage(state, state.orders[0]).map(row => row.itemId)).toEqual(['thinner', 'paint']);
  });
});

describe('draftShortage', () => {
  it('агрегирует один материал из двух позиций черновика', () => {
    const positions: PositionDraft[] = [
      { kind: 'product', title: 'A', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 4, issuedQty: 0 }], route: [] },
      { kind: 'product', title: 'B', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 7, issuedQty: 0 }], route: [] },
    ];
    const state = world({ movements: [stock('paint', 10)] });
    const rows = draftShortage(state, positions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ needed: 11, stock: 10, reserved: 0, short: 1 });
  });

  it('учитывает нормы m² ровно так же, как order.create, и сливает их с явной строкой', () => {
    const state = world({ movements: [stock('paint', 0)], operations: [paintOperation([{ itemId: 'paint', qtyPerM2: 0.25 }])] });
    const positions: PositionDraft[] = [{
      kind: 'product', title: 'Fasad', qty: 4, unitPrice: 0, floor: 0,
      materials: [{ itemId: 'paint', qty: 0.5, issuedQty: 0 }],
      route: [{ operationId: 'opPaint', executorKind: 'employee', employeeId: null, supplierId: null, rate: 0, salePrice: 0, qty: 4, locked: false, completed: 0 }],
    }];
    const rows = draftShortage(state, positions);
    expect(rows).toHaveLength(1);
    expect(rows[0].needed).toBeCloseTo(1.5, 10);
  });

  it('исключает бронь редактируемого заказа', () => {
    const state = world({ movements: [stock('paint', 10)], orders: [order('A', 'production', [material('m1', 'paint', 6)])] });
    const positions: PositionDraft[] = [{ kind: 'product', title: 'A', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 8, issuedQty: 0 }], route: [] }];
    expect(draftShortage(state, positions, 'A')).toEqual([]);
    expect(draftShortage(state, positions).map(row => row.short)).toEqual([4]);
  });

  it('ревизия сохранённого заказа не удваивает нормы: домен печёт их только в order.create', () => {
    const state = world({
      movements: [stock('paint', 0)],
      operations: [paintOperation([{ itemId: 'paint', qtyPerM2: 0.25 }])],
      orders: [order('A', 'production', [material('m1', 'paint', 1)])],
    });
    const positions: PositionDraft[] = [{
      id: 'L1', kind: 'product', title: 'Fasad', qty: 4, unitPrice: 0, floor: 0,
      materials: [{ itemId: 'paint', qty: 1, issuedQty: 0 }],
      route: [{ operationId: 'opPaint', executorKind: 'employee', employeeId: null, supplierId: null, rate: 0, salePrice: 0, qty: 4, locked: false, completed: 0 }],
    }];
    expect(draftShortage(state, positions, 'A').map(row => row.needed)).toEqual([1]);
    expect(draftShortage(state, positions).map(row => row.needed)).toEqual([2]);
  });

  it('не бросает на пустом и полузаполненном черновике', () => {
    const state = world({ movements: [stock('paint', 1)], operations: [paintOperation([{ itemId: 'ghost', qtyPerM2: 1 }])] });
    const positions = [
      { kind: 'product' as const, title: '', qty: 0, unitPrice: 0, floor: 0, materials: [{ itemId: '', qty: 5, issuedQty: 0 }, { itemId: 'paint', qty: 0, issuedQty: 0 }], route: [{ operationId: '', executorKind: 'employee' as const, employeeId: null, supplierId: null, rate: 0, qty: 2, locked: false, completed: 0 }] },
      { id: 'L2', kind: 'product' as const, title: '', qty: 2, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 1, issuedQty: 0 }], route: [{ operationId: 'opPaint', executorKind: 'employee' as const, employeeId: null, supplierId: null, rate: 0, qty: 2, locked: false, completed: 0 }] },
    ];
    expect(() => draftShortage(state, positions)).not.toThrow();
    expect(draftShortage(state, positions)).toEqual([]);
  });

  it('одна битая норма не скрывает остальные', () => {
    const state = world({
      movements: [stock('paint', 0)],
      operations: [paintOperation([{ itemId: 'paint', qtyPerM2: 0.25 }, { itemId: 'ghost', qtyPerM2: 1 }])],
    });
    const positions: PositionDraft[] = [{
      kind: 'product', title: 'Fasad', qty: 4, unitPrice: 0, floor: 0,
      materials: [{ itemId: 'paint', qty: 0, issuedQty: 0 }],
      route: [{ operationId: 'opPaint', executorKind: 'employee', employeeId: null, supplierId: null, rate: 0, salePrice: 0, qty: 4, locked: false, completed: 0 }],
    }];
    const rows = draftShortage(state, positions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'paint', needed: 1, stock: 0, reserved: 0, available: 0, short: 1 });
  });
});

describe('домен печёт нормы только в order.create — посылка fromNorms', () => {
  // справочник собирается командами, как в src/domain.test.ts: краска 0.25 л/м² и приход на склад
  function paintShop() {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Aliya', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Poliuretan bo‘yoq', unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material', category: '06.01' });
    state = run(state, { type: 'employee.create', name: 'Usta' });
    state = run(state, { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.25 }] });
    state = run(state, { type: 'supplier.create', name: 'LKM yetkazib beruvchi', phone: '' });
    state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId: state.items[0].id, qty: 10, price: 10 }] });
    const purchase = state.purchases.at(-1)!;
    state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 10 }] });
    const paintId = state.items[0].id;
    const created = run(state, {
      type: 'order.create',
      input: {
        kind: 'composite', customerId: state.customers[0].id, overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash',
        lines: [{
          kind: 'product', title: 'Fasad', qty: 1, unitPrice: 100,
          materials: [{ itemId: paintId, qty: 0.5 }],
          route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 4 }],
        }],
      },
    });
    return { state: created, order: created.orders.at(-1)!, paintId };
  }

  const paintQty = (order: Order, paintId: string) => order.materials
    .filter(row => row.itemId === paintId  && row.issuedQty < row.qty)
    .reduce((total, row) => total + row.qty, 0);

  it('A: order.create дописывает норму 0.25 × 4 м² к явной строке 0.5 л', () => {
    const { order, paintId } = paintShop();
    expect(paintQty(order, paintId)).toBeCloseTo(1.5, 10);
  });

  it('B: order.update той же позиции норму второй раз не добавляет', () => {
    const { state, order, paintId } = paintShop();
    // редактор возвращает домену ровно то, что домен сам запёк в order.create: 1.5 л одной строкой
    const materials = order.materials.filter(row => row.itemId === paintId).map(row => ({ itemId: row.itemId, qty: row.qty }));
    const revised = run(state, {
      type: 'order.update', orderId: order.id, overhead: 0, dueDate: '2026-11-20',
      lines: [{
        id: order.lines[0].id, kind: 'product', title: 'Fasad', qty: 1, unitPrice: 100, materials,
        route: order.route.map(task => ({ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, qty: 4, taskId: task.id })),
      }],
    });
    const after = revised.orders.find(row => row.id === order.id)!;
    // норма ровно 1 л: начнёт домен сливать её при ревизии — здесь станет 2.5, и тест покраснеет
    expect(paintQty(after, paintId)).toBeCloseTo(1.5, 10);
    expect(after.materials.filter(row => row.itemId === paintId)).toHaveLength(1);
  });

  it('D: ревизия запущенного заказа — та же ветка revisionMaterials — норму второй раз не добавляет', () => {
    const { state, order, paintId } = paintShop();
    const launched = run(state, { type: 'order.launch', orderId: order.id });
    const running = launched.orders.find(row => row.id === order.id)!;
    const materials = running.materials.filter(row => row.itemId === paintId).map(row => ({ itemId: row.itemId, qty: row.qty }));
    const revised = run(launched, {
      type: 'order.update', orderId: order.id, overhead: 0, dueDate: '2026-11-20',
      lines: [{
        id: running.lines[0].id, kind: 'product', title: 'Fasad', qty: 1, unitPrice: 100, materials,
        route: running.route.map(task => ({ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, qty: 4, taskId: task.id })),
      }],
    });
    const after = revised.orders.find(row => row.id === order.id)!;
    // именно эта ветка живёт в редакторе сохранённого заказа: бронь есть, строки лежат как их прислали
    expect(after.status).toBe('production');
    expect(paintQty(after, paintId)).toBeCloseTo(1.5, 10);
    expect(after.materials.filter(row => row.itemId === paintId)).toHaveLength(1);
    // строка та же (revisionMaterials переиспользует existing), а не пересоздана orderMaterials
    expect(after.materials.find(row => row.itemId === paintId)!.id).toBe(running.materials.find(row => row.itemId === paintId)!.id);
  });

  it('E: полоса редактора сохранённого заказа считает needed из домена, а не из норм', () => {
    const { state, order, paintId } = paintShop();
    // остаток 1 л < 1,5 л, которые домен запёк в order.create: строка дефицита появляется, и needed обязан быть равён строкам заказа
    const thin = run(state, { type: 'inventory.count', itemId: paintId, qty: 1, note: '' });
    const saved = thin.orders.find(row => row.id === order.id)!;
    const rows = draftShortage(thin, positionsFromOrder(thin, saved), saved.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe(paintId);
    // fromNorms когда-нибудь станет true — здесь вырастет 2.5, и это тот же класс «второй правды», что чинил I-3
    expect(rows[0].needed).toBeCloseTo(1.5, 10);
    expect(rows[0].short).toBeCloseTo(0.5, 10);
  });
});

describe('дефицит считается по складу заказа', () => {
  const second = '00000000-0000-4000-8000-00000000a002';

  function world2(over: Partial<State> = {}): State {
    return world({
      warehouses: [...emptyState().warehouses, { id: second, name: 'Sex ombori', active: true }],
      ...over,
    });
  }

  function atWarehouse(itemId: string, qty: number, warehouseId: string | undefined, id = `mv-${warehouseId ?? 'main'}`): StockMovement {
    return { ...stock(itemId, qty), id, ...(warehouseId ? { warehouseId } : {}) };
  }

  it('берёт остаток и бронь только со склада заказа и подсказывает другие склады', () => {
    const state = world2({
      movements: [atWarehouse('paint', 10, undefined), atWarehouse('paint', 4, second)],
      orders: [order('A', 'production', [material('m1', 'paint', 8)], { warehouseId: second })],
    });
    const rows = orderShortage(state, state.orders[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stock: 4, reserved: 0, available: 4, short: 4, warehouseId: second });
    expect(rows[0].suggestedFrom).toEqual([{ warehouseId: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', available: 10 }]);
  });

  it('вычитает чужую бронь на том же складе и не смешивает склады', () => {
    const state = world2({
      movements: [atWarehouse('paint', 10, undefined), atWarehouse('paint', 4, second)],
      orders: [
        order('A', 'production', [material('m1', 'paint', 8)], { warehouseId: second }),
        order('B', 'production', [material('m2', 'paint', 3)], { warehouseId: second }),
        order('C', 'production', [material('m3', 'paint', 9)]),
      ],
    });
    const rows = orderShortage(state, state.orders[0]);
    expect(rows[0]).toMatchObject({ stock: 4, reserved: 3, available: 1, short: 7 });
    expect(rows[0].suggestedFrom).toEqual([{ warehouseId: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', available: 1 }]);
  });

  it('не подсказывает пустые и неактивные склады', () => {
    const state = world2({
      warehouses: [...emptyState().warehouses, { id: second, name: 'Sex ombori', active: true }, { id: 'third', name: 'Yopiq', active: false }],
      movements: [atWarehouse('paint', 2, undefined), atWarehouse('paint', 1, second), atWarehouse('paint', 5, 'third')],
      orders: [order('A', 'production', [material('m1', 'paint', 10)])],
    });
    const rows = orderShortage(state, state.orders[0]);
    expect(rows[0].suggestedFrom).toEqual([{ warehouseId: second, name: 'Sex ombori', available: 1 }]);
  });

  it('draftShortage считает по переданному складу', () => {
    const state = world2({ movements: [atWarehouse('paint', 10, undefined), atWarehouse('paint', 1, second)] });
    const positions: PositionDraft[] = [{ kind: 'product', title: 'A', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 4, issuedQty: 0 }], route: [] }];
    expect(draftShortage(state, positions).map(row => row.short)).toEqual([]);
    const rows = draftShortage(state, positions, null, second);
    expect(rows[0]).toMatchObject({ stock: 1, short: 3, warehouseId: second });
    expect(rows[0].suggestedFrom).toEqual([{ warehouseId: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', available: 10 }]);
  });

  it('reservedExcept фильтрует по складу', () => {
    const state = world2({
      movements: [atWarehouse('paint', 10, undefined), atWarehouse('paint', 4, second)],
      orders: [
        order('A', 'production', [material('m1', 'paint', 2)], { warehouseId: second }),
        order('B', 'production', [material('m2', 'paint', 3)], { warehouseId: second }),
        order('C', 'production', [material('m3', 'paint', 9)]),
      ],
    });
    expect(reservedExcept(state, 'paint', null, second)).toBe(5);
    expect(reservedExcept(state, 'paint', null)).toBe(14);
  });
});

describe('паритет с сервером', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

  it('доменные тексты нехватки по-прежнему зеркалятся в erp_execute', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '23514';");
    expect(sql).toContain("RAISE EXCEPTION 'Omborda material yo‘q. Qoldiqni to‘ldiring' USING ERRCODE = '23514';");
    expect(sql).toContain("RAISE EXCEPTION 'Stock cannot be negative' USING ERRCODE = '23514';");
  });
});
