import { describe, expect, it } from 'vitest';
import { mainWorkshop, MAIN_WORKSHOP_ID } from './workshop-default';
import {
  activeWorkshops, ordersForWorkshop, resolveWorkshopTab, routeForWorkshop, visibleInWorkshop, workshopName, workshopTabs,
} from './workshop-view';
import type { Order, RouteLine, Workshop } from './types';

const WH2 = '00000000-0000-4000-8000-00000000b002';
const workshops: Workshop[] = [mainWorkshop(), { id: WH2, name: 'Bo‘yash sehi', active: true }];

function stage(over: Partial<RouteLine>): RouteLine {
  return {
    id: 't1', lineId: 'l1', operationId: 'op1', name: 'Kesish', executorKind: 'employee', employeeId: 'e1',
    supplierId: null, rate: 1, planned: 1, completed: 0, status: 'assigned', workshopId: MAIN_WORKSHOP_ID, ...over,
  };
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Stol', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20',
    createdAt: '2026-11-01T00:00:00.000Z', status: 'production', lines: [], materials: [], route: [stage({})],
    ...over,
  };
}

describe('workshop board filters', () => {
  it('keeps a single-workshop company unchanged without tabs', () => {
    const single = [mainWorkshop()];
    expect(activeWorkshops(single).length).toBe(1);
    expect(workshopTabs(single, [order()])).toEqual([]);
    expect(visibleInWorkshop(order(), null)).toBe(true);
    expect(routeForWorkshop(order(), null)).toEqual(order().route);
  });

  it('counts an order in every workshop that still has an unfinished stage', () => {
    const mixed = order({ route: [stage({ id: 't1' }), stage({ id: 't2', name: 'Bo‘yash', workshopId: WH2 })] });
    const tabs = workshopTabs(workshops, [mixed]);
    expect(tabs.map(tab => tab.name)).toEqual(['Barchasi', 'Asosiy ishlab chiqarish', 'Bo‘yash sehi']);
    expect(tabs.map(tab => tab.count)).toEqual([1, 1, 1]);
    expect(visibleInWorkshop(mixed, WH2)).toBe(true);
    expect(routeForWorkshop(mixed, WH2).map(task => task.id)).toEqual(['t2']);
    expect(routeForWorkshop(mixed, MAIN_WORKSHOP_ID).map(task => task.id)).toEqual(['t1']);
  });

  it('drops an order from a workshop once only finished stages remain there', () => {
    const done = order({ route: [
      stage({ id: 't1', completed: 1, status: 'accepted' }),
      stage({ id: 't2', name: 'Bo‘yash', workshopId: WH2 }),
    ] });
    expect(visibleInWorkshop(done, MAIN_WORKSHOP_ID)).toBe(false);
    expect(visibleInWorkshop(done, WH2)).toBe(true);
    const tabs = workshopTabs(workshops, [done]);
    expect(tabs.map(tab => tab.count)).toEqual([1, 0, 1]);
  });

  it('ignores inactive workshops in the tab list', () => {
    const rows: Workshop[] = [mainWorkshop(), { id: WH2, name: 'Bo‘yash sehi', active: false }];
    expect(workshopTabs(rows, [order()])).toEqual([]);
    expect(resolveWorkshopTab(rows, WH2)).toBeNull();
    expect(resolveWorkshopTab(workshops, WH2)).toBe(WH2);
    expect(resolveWorkshopTab(workshops, 'gone')).toBeNull();
  });

  it('falls back to a readable label for an unknown workshop', () => {
    expect(workshopName(workshops, WH2)).toBe('Bo‘yash sehi');
    expect(workshopName(workshops, undefined)).toBe('Asosiy ishlab chiqarish');
    expect(workshopName(workshops, 'gone')).toBe('Seh');
  });

  it('board shows only orders of the selected workshop tab', () => {
    const orders = [order(), order({ id: 'o2', route: [stage({ id: 't2', workshopId: WH2 })] })];
    expect(ordersForWorkshop(orders, null).map(o => o.id)).toEqual(['o1', 'o2']);
    expect(ordersForWorkshop(orders, MAIN_WORKSHOP_ID).map(o => o.id)).toEqual(['o1']);
    expect(ordersForWorkshop(orders, WH2).map(o => o.id)).toEqual(['o2']);
  });
});
