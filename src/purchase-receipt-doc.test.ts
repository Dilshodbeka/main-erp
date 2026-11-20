import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { purchaseReceipt } from './documents';
import { PrintDocument } from './components/PrintDocument';
import type { Item, Order, Purchase, State } from './types';

const board: Item = {
  id: 'item-board', name: 'DSP plate', unit: 'dona', minQty: 0, cost: 0, customerId: null,
  kind: 'material', salePrice: 0, lastPurchasePrice: 22000, materialCost: 0, laborCost: 0, category: null,
};
const film: Item = {
  id: 'item-film', name: 'Kollyuk', unit: 'm', minQty: 0, cost: 0, customerId: null,
  kind: 'material', salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: null,
};

function fixture(): State {
  const state = emptyState();
  state.items = [board, film];
  state.suppliers = [{ id: 'supplier-1', name: 'Pudratchi Aliyev', phone: '+998901112233' }];
  state.warehouses = [...state.warehouses, { id: 'warehouse-2', name: 'Janubiy ombor', active: true }];
  state.orders = [{
    id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'customer-1', title: 'Oshxona shkafi',
    outputItemId: null, recipeVersionId: null, substitutions: {}, qty: 1, price: 0, overhead: 0,
    dueDate: '2026-11-30', createdAt: '2026-11-17T09:00:00.000Z', status: 'production',
    lines: [], materials: [], route: [],
  } as Order];
  const purchase: Purchase = {
    id: 'purchase-1', number: 'PUR-0004', supplierId: 'supplier-1', orderId: 'order-1',
    createdAt: '2026-11-18T08:00:00.000Z',
    lines: [
      { id: 'line-1', itemId: board.id, qty: 10, price: 25000, received: 8, previousPurchasePrice: 22000, newPurchasePrice: 25000, previousAverageCost: 20000, newAverageCost: 24000 },
      { id: 'line-2', itemId: film.id, qty: 5, price: 40000, received: 0, previousPurchasePrice: 0, newPurchasePrice: 0, previousAverageCost: 0, newAverageCost: 0 },
    ],
  };
  state.purchases = [purchase];
  return state;
}

describe('purchaseReceipt document model', () => {
  it('carries the purchase header, supplier and linked order', () => {
    const model = purchaseReceipt(fixture(), 'purchase-1');
    expect(model.number).toBe('PUR-0004');
    expect(model.date).toBe('2026-11-18T08:00:00.000Z');
    expect(model.supplier).toBe('Pudratchi Aliyev');
    expect(model.phone).toBe('+998901112233');
    expect(model.orderNumber).toBe('ORD-0001');
  });

  it('defaults the warehouse to the main store and resolves an explicit one', () => {
    expect(purchaseReceipt(fixture(), 'purchase-1').warehouse).toBe('Asosiy ombor');
    const state = fixture();
    state.purchases[0].warehouseId = 'warehouse-2';
    expect(purchaseReceipt(state, 'purchase-1').warehouse).toBe('Janubiy ombor');
  });

  it('lists every ordered line with received and remaining quantity', () => {
    const model = purchaseReceipt(fixture(), 'purchase-1');
    expect(model.lines).toEqual([
      { name: 'DSP plate', unit: 'dona', qty: 10, received: 8, remaining: 2, price: 25000, total: 250000 },
      { name: 'Kollyuk', unit: 'm', qty: 5, received: 0, remaining: 5, price: 40000, total: 200000 },
    ]);
  });

  it('totals accepted value separately from the whole purchase', () => {
    const model = purchaseReceipt(fixture(), 'purchase-1');
    expect(model.receivedTotal).toBe(200000);
    expect(model.total).toBe(450000);
  });

  it('prints a dash-free document for an order-less purchase with an unknown supplier', () => {
    const state = fixture();
    state.purchases[0].orderId = null;
    state.purchases[0].supplierId = 'gone';
    const model = purchaseReceipt(state, 'purchase-1');
    expect(model.orderNumber).toBeNull();
    expect(model.supplier).toBe('Yetkazib beruvchi');
    expect(model.phone).toBe('');
  });

  it('rejects an unknown purchase', () => {
    expect(() => purchaseReceipt(fixture(), 'nope')).toThrow('Hujjat topilmadi');
  });
});

describe('purchaseReceipt print page', () => {
  it('renders the accepted-goods page through PrintDocument', () => {
    const markup = renderToStaticMarkup(createElement(PrintDocument, {
      model: { type: 'receipt', data: purchaseReceipt(fixture(), 'purchase-1') },
      close: () => {},
    }));
    expect(markup).toContain('QABUL VARAQASI');
    expect(markup).toContain('PUR-0004');
    expect(markup).toContain('Pudratchi Aliyev');
    expect(markup).toContain('DSP plate');
    expect(markup).toContain('Asosiy ombor');
  });
});
