import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import { SupplyNeeds } from './components/SupplyNeeds';
import type { Item, MaterialLine, Order, State } from './types';

function item(over: Partial<Item> = {}): Item {
  return { id: 'paint', name: 'Lak', unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 12, materialCost: 0, laborCost: 0, category: '06.01', ...over };
}

function material(itemId: string, qty: number): MaterialLine {
  return { id: 'm1', lineId: 'L1', itemId, qty, estimatedCost: 0, issuedQty: 0, actualCost: 0 };
}

function order(over: Partial<Order> = {}): Order {
  return { id: 'A', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Shkaf', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 0, overhead: 0, dueDate: '2026-11-20',
    createdAt: '2026-11-01T00:00:00.000Z', status: 'production', lines: [], materials: [material('paint', 7)],
    route: [], ...over };
}

function world(over: Partial<State> = {}): State {
  return { ...emptyState(), items: [item()], orders: [order()], ...over };
}

function render(state: State, warehouseId = MAIN_WAREHOUSE_ID): string {
  return renderToStaticMarkup(createElement(SupplyNeeds, { state, warehouseId, search: '', onPurchase: () => {} }));
}

describe('supply needs panel', () => {
  it('shows the deficit, its orders and the purchase button', () => {
    const html = render(world());
    expect(html).toContain('Lak');
    expect(html).toContain('Yetishmaydi 7');
    expect(html).toContain('ORD-0001');
    expect(html).toContain('Xarid qilish');
  });

  it('does not mix warehouses', () => {
    const html = render(world({ orders: [order({ warehouseId: '00000000-0000-4000-8000-00000000a002' })] }));
    expect(html).not.toContain('Lak');
    expect(html).toContain('yetishmayotgan material yo‘q');
  });

  it('skips orders that already have stock', () => {
    const html = render(world({ movements: [{ id: 'mv', itemId: 'paint', direction: 'in', qty: 10, unitCost: 10,
      source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-11-01T00:00:00.000Z', warehouseId: MAIN_WAREHOUSE_ID }] }));
    expect(html).not.toContain('Lak');
    expect(html).toContain('yetishmayotgan material yo‘q');
  });

  it('filters by search text', () => {
    expect(render(world(), MAIN_WAREHOUSE_ID).length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(createElement(SupplyNeeds, { state: world(), warehouseId: MAIN_WAREHOUSE_ID, search: 'zzz', onPurchase: () => {} }));
    expect(html).not.toContain('Lak');
  });
});
