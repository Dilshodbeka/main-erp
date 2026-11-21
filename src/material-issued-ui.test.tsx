import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { OrderEditor } from './components/OrderEditor';
import { OrderPositions } from './components/OrderPositions';
import { SeriesList } from './components/SeriesList';
import type { Item, MaterialLine, Order, OrderLine, State } from './types';

const item = (id: string, name: string): Item => ({
  id, name, unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
  salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01',
});

function baseState(issuedQty: number, kind: Order['kind'] = 'product'): State {
  const line: OrderLine = { id: 'L1', kind: 'product', title: 'Lak', qty: 5, total: 1000, status: 'production' };
  const materials: MaterialLine[] = [
    { id: 'm1', lineId: 'L1', itemId: 'paint', qty: 5, issuedQty, estimatedCost: 50, actualCost: issuedQty * 10 },
    { id: 'm2', lineId: 'L1', itemId: 'hard', qty: 2, issuedQty: 2, estimatedCost: 20, actualCost: 20 },
  ];
  const order: Order = {
    id: 'o1', number: 'ORD-0001', kind, customerId: '', title: 'Lak', outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 5, price: 1000, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status: 'production', lines: [line], materials, route: [],
  };
  return { ...emptyState(), items: [item('paint', 'Bo‘yoq'), item('hard', 'Qotirgich')], orders: [order] };
}

const inputTag = (html: string, index: number) =>
  html.match(new RegExp(`<input[^>]*aria-label="Material miqdori ${index}"[^>]*>`))![0];

const editorHtml = (state: State) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders[0], busy: false, close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

const positionsHtml = (state: State) => renderToStaticMarkup(createElement(OrderPositions, {
  state, order: state.orders[0], busy: false, onIssue: () => {}, onShip: () => {}, onCancel: () => {},
}));

const noop = async () => true;

describe('P2 partial issue in UI', () => {
  it('keeps quantity editable and locks item and delete on issued rows', () => {
    const html = editorHtml(baseState(3));
    const partial = inputTag(html, 1);
    expect(partial).toContain('min="3"');
    expect(partial).not.toContain('disabled');
    const full = inputTag(html, 2);
    expect(full).toContain('min="2"');
    expect(full).not.toContain('disabled');
    expect(html.match(/class="material-picker-static"/g)).toHaveLength(2);
    const deleteButtons = html.match(/<button[^>]*aria-label="Materialni olib tashlash \d"[^>]*>/g) ?? [];
    expect(deleteButtons).toHaveLength(2);
    for (const button of deleteButtons) expect(button).toContain('disabled');
    expect(html).toContain('Berilgan 3 · Kerak 5');
    expect(html).toContain('Berilgan 2 · to‘liq');
  });

  it('marks partial rows in the order card and keeps the issue button', () => {
    const html = positionsHtml(baseState(3));
    expect(html).toContain('qisman berilgan · 3 / 5');
    expect(html).toContain(' · berilgan');
    expect(html).toContain('Materiallarni berish');
  });

  it('marks partial rows in the series card', () => {
    const state = baseState(3, 'series');
    const html = renderToStaticMarkup(createElement(SeriesList, { state, busy: false, run: noop, onGo: () => {} }));
    expect(html).toContain('qisman · 3 / 5');
    expect(html).toContain('2 dan 1 berildi');
    expect(html).toContain('Sehga berish');
  });

  it('shows a full numeric label and lifts the minimum on a fully issued row', () => {
    const state = baseState(5);
    const editor = editorHtml(state);
    expect(inputTag(editor, 1)).toContain('min="5"');
    expect(editor).toContain('Berilgan 5 · to‘liq');
    const positions = positionsHtml(state);
    expect(positions).not.toContain('qisman');
    expect(positions).not.toContain('Materiallarni berish');
  });
});
