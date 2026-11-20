import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { ShortageNotice } from './components/ShortageNotice';
import { OrderEditor } from './components/OrderEditor';
import { SeriesList } from './components/SeriesList';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import type { Item, MaterialLine, Order, OrderLine, State, StockMovement } from './types';

const row = { itemId: 'paint', name: 'Poliuretan bo‘yoq', unit: 'l', needed: 13, stock: 10, reserved: 0, available: 10, short: 3,
  warehouseId: MAIN_WAREHOUSE_ID, suggestedFrom: [] };

function baseState(): State {
  const item: Item = { id: 'paint', name: 'Poliuretan bo‘yoq', unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01' };
  const movement: StockMovement = { id: 'mv1', itemId: 'paint', direction: 'in', qty: 10, unitCost: 10, source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-11-01T00:00:00.000Z' };
  const material: MaterialLine = { id: 'm1', lineId: 'L1', itemId: 'paint', qty: 13, estimatedCost: 130, issuedQty: 0, actualCost: 0 };
  const line: OrderLine = { id: 'L1', kind: 'product', title: 'Qora lak', qty: 4, total: 0, status: 'production' };
  const order: Order = { id: 'o1', number: 'ORD-0001', kind: 'series', customerId: '', title: 'Qora lak', outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 4, price: 0, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status: 'production', lines: [line], materials: [material], route: [] };
  const material2: MaterialLine = { id: 'm2', lineId: 'L2', itemId: 'paint', qty: 2, estimatedCost: 20, issuedQty: 0, actualCost: 0 };
  const line2: OrderLine = { id: 'L2', kind: 'product', title: 'Korpus', qty: 2, total: 0, status: 'production' };
  const second: Order = { id: 'o2', number: 'ORD-0002', kind: 'series', customerId: '', title: 'Korpus', outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 2, price: 0, overhead: 0, dueDate: '2026-11-22', createdAt: '2026-11-01T00:00:00.000Z',
    status: 'production', lines: [line2], materials: [material2], route: [] };
  return { ...emptyState(), items: [item], movements: [movement], orders: [order, second] };
}

const noop = async () => true;

describe('ShortageNotice', () => {
  it('рендерит null без дефицита', () => {
    expect(renderToStaticMarkup(createElement(ShortageNotice, { rows: [] }))).toBe('');
  });

  it('показывает цифры и обе ссылки', () => {
    const html = renderToStaticMarkup(createElement(ShortageNotice, { rows: [row], onGo: () => {} }));
    expect(html).toContain('Materiallar yetishmaydi (1):');
    expect(html).toContain('Poliuretan bo‘yoq');
    expect(html).toContain('kerak');
    expect(html).toContain('yetishmaydi');
    expect(html).toContain('Omborga');
    expect(html).toContain('Xaridga');
    expect(html).toContain('kerak 13');
    expect(html).toContain('omborda 10');
    expect(html).toContain('band 0');
    expect(html).toContain('yetishmaydi <i>3</i>');
  });

  it('ссылки не отправляют форму заказа', () => {
    const html = renderToStaticMarkup(createElement(ShortageNotice, { rows: [row], onGo: () => {} }));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain('type="button"');
  });

  it('без onGo не оставляет ссылок', () => {
    const html = renderToStaticMarkup(createElement(ShortageNotice, { rows: [row] }));
    expect(html).toContain('yetishmaydi');
    expect(html).not.toContain('Omborga');
  });
});

describe('точки применения', () => {
  it('редактор заказа с дефицитом показывает список и обе ссылки', () => {
    const state = baseState();
    const html = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(html).toContain('Materiallar yetishmaydi (1):');
    expect(html).toContain('Omborga');
    expect(html).toContain('Xaridga');
    expect(html).toContain('band 2');
    expect(html).toContain('class="shortage-chip">yetishmaydi');
  });

  it('подсказка erkin в списке материалов берёт ту же бронь, что и полоса', () => {
    // та же модалка, что и выше: полоса показывает band 2 (чужой o2), значит и подсказка
    // должна печатать 10 − 2 = 8, а не stock минус вся броня вместе со своей (−5).
    const state = baseState();
    const html = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(html).toContain('band 2');
    expect(html).toContain('erkin 8');
    expect(html.match(/erkin -\d/g)).toBeNull();
  });

  it('при нескольких складах подсказка erkin называет склад-источник', () => {
    const state = baseState();
    state.warehouses = [...state.warehouses, { id: '00000000-0000-4000-8000-00000000a002', name: 'Sex ombori', active: true }];
    const html = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(html).toContain('erkin 8 l · Asosiy ombor');
  });

  it('список серий показывает дефицит в полосе material-warning', () => {
    const html = renderToStaticMarkup(createElement(SeriesList, { state: baseState(), busy: false, run: noop, onGo: () => {} }));
    expect(html).toContain('material-warning');
    expect(html).toContain('Materiallar yetishmaydi (1):');
    expect(html).toContain('band 2');
    expect(html).toContain('band 13');
  });

  it('без дефицита блока нет, полоса остаётся', () => {
    const state = { ...baseState(), movements: [{ ...baseState().movements[0], qty: 40 }] };
    const editor = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(editor).not.toContain('Materiallar yetishmaydi');
    const series = renderToStaticMarkup(createElement(SeriesList, { state, busy: false, run: noop, onGo: () => {} }));
    expect(series).toContain('material-warning');
    expect(series).not.toContain('Materiallar yetishmaydi');
  });
});
