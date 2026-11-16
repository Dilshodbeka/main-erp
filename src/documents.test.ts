import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { cashReceipt, invoice, routeSheet } from './documents';
import { PrintDocument } from './components/PrintDocument';
import type { Actor, CashEntry, Customer, Item, Order, Shipment, State } from './types';

const admin: Actor = { id: 'admin', name: 'Egasi', role: 'admin', companyId: emptyState().companyId };
const worker: Actor = { id: 'worker', name: 'Xodim', role: 'worker', companyId: emptyState().companyId };
const display: Actor = { id: 'display', name: 'Sex ekrani', role: 'display', companyId: emptyState().companyId };

const customer: Customer = { id: 'customer-1', name: 'Aziza Karimova', phone: '', address: 'Toshkent', kind: 'customer', employeeId: null };
const whiteFacade: Item = {
  id: 'facade-white', name: 'Fasad · oq', unit: 'dona', minQty: 0, cost: 0, customerId: null,
  kind: 'material', salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: null,
};

function fixture(): State {
  const state = emptyState();
  state.customers = [customer];
  state.employees = [{ id: 'employee-1', name: 'Worker', active: true }];
  state.operations = [{
    id: 'operation-1', name: 'Kesish', unit: 'piece', salePrice: 40000, workerRate: 5000,
    standardMinutes: 15, machineId: null, employeeIds: ['employee-1'], active: true, autoAccept: false, norms: [],
  }];
  state.items = [whiteFacade];
  state.orders = [{
    id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: customer.id, title: 'Oshxona shkafi',
    outputItemId: null, recipeVersionId: 'recipe-version-1', substitutions: { Fasad: whiteFacade.id },
    qty: 5, price: 250000, overhead: 0, dueDate: '2026-11-09', createdAt: '2026-10-29T09:00:00.000Z',
    status: 'shipped',
    lines: [{ id: 'order-line-1', kind: 'product', title: 'Oshxona shkafi', qty: 5, total: 250000, status: 'shipped' }],
    materials: [{ id: 'material-1', lineId: 'order-line-1', itemId: whiteFacade.id, qty: 2, estimatedCost: 10000, issuedQty: 2, actualCost: 10000 }],
    route: [{
      id: 'task-1', lineId: 'order-line-1', operationId: 'operation-1', name: 'Kesish',
      executorKind: 'employee', employeeId: 'employee-1', supplierId: null,
      rate: 5000, standardMinutes: 15, planned: 5, completed: 5, status: 'completed',
    }],
    drawingUrl: 'https://example.com/drawings/42',
  } as Order];
  const shipment: Shipment = {
    id: 'shipment-1', orderId: 'order-1', customerId: customer.id, kind: 'order',
    lines: [{
      id: 'line-1', itemId: null, description: 'Oshxona shkafi', qty: 5,
      salePrice: 50000, unitCost: 10000, materialCost: 10000, laborCost: 5000,
    }],
    address: 'Toshkent', dueDate: '2026-11-09', status: 'shipped',
    createdAt: '2026-10-29T10:00:00.000Z', deliveredAt: null, reversalOf: null,
  };
  state.shipments = [shipment];
  state.cash = [{
    id: 'cash-1', direction: 'in', amount: 100000, account: 'cash', toAccount: null,
    source: 'sale', sourceId: shipment.id, customerId: customer.id, category: 'Mijoz to‘lovi',
    note: '', number: null, reversalOf: null, createdAt: '2026-10-29T11:00:00.000Z',
  }];
  state.items = [whiteFacade, {
    id: 'cabinet', name: 'Oshxona shkafi', unit: 'dona', minQty: 0, cost: 0, customerId: null,
    kind: 'finished', salePrice: 50000, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: null,
  }];
  state.orders[0].outputItemId = 'cabinet';
  return state;
}

function composite(): State {
  const state = fixture();
  const order = state.orders[0];
  order.kind = 'composite';
  order.title = 'Oshxona · 45 gradus kesish';
  order.qty = 6;
  order.price = 300000;
  order.overhead = 10000;
  order.lines = [
    { id: 'order-line-1', kind: 'product', title: 'Oshxona', qty: 5, total: 250000, status: 'production' },
    { id: 'order-line-2', kind: 'service', title: '45 gradus kesish', qty: 1, total: 50000, status: 'production' },
    { id: 'order-line-3', kind: 'product', title: 'Bekor qilingan qism', qty: 2, total: 80000, status: 'cancelled' },
  ];
  order.materials.push({ id: 'material-2', lineId: 'order-line-2', itemId: whiteFacade.id, qty: 3, estimatedCost: 2000, issuedQty: 0, actualCost: 0 });
  order.route.push({
    id: 'task-2', lineId: 'order-line-2', operationId: 'operation-1', name: 'Kesish',
    executorKind: 'employee', employeeId: 'employee-1', supplierId: null,
    rate: 5000, standardMinutes: 15, planned: 1, completed: 0, status: 'assigned',
  });
  return state;
}

describe('route sheet', () => {
  it('keeps all money out and lists operations, workers, standards and drawing', () => {
    const route = routeSheet(fixture(), 'order-1');
    expect(JSON.stringify(route)).not.toMatch(/salePrice|unitCost|price|paid|debt|cash/);
    expect(route.operations[0]).toMatchObject({ name: 'Kesish', qty: 5, workerName: 'Worker', standardMinutes: 15 });
    expect(route.drawingUrl).toBe('https://example.com/drawings/42');
  });

  it('labels every operation with the position it belongs to', () => {
    const route = routeSheet(composite(), 'order-1');
    expect(route.operations.map(row => row.position)).toEqual(['Oshxona', '45 gradus kesish']);
    expect(JSON.stringify(route)).not.toMatch(/salePrice|unitCost|rate/);
  });

  it('prints the actually substituted material for every recipe slot', () => {
    const route = routeSheet(fixture(), 'order-1');
    expect(route.substitutions).toEqual([{ slot: 'Fasad', itemName: 'Fasad · oq' }]);
  });

  it('does not require admin rights and works without a drawing', () => {
    const state = fixture();
    delete state.orders[0].drawingUrl;
    expect(routeSheet(state, 'order-1').drawingUrl).toBeNull();
  });

  it('rejects an unknown order', () => {
    expect(() => routeSheet(fixture(), 'missing')).toThrow('Buyurtma topilmadi');
  });

  it('names the contractor in the route sheet and still hides all money', () => {
    const state = fixture();
    state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
    state.orders[0].route = [{
      id: 'task-1', lineId: 'order-line-1', operationId: 'operation-1', name: 'Metall ish',
      executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
      rate: 5000, standardMinutes: 15, planned: 5, completed: 5, status: 'completed',
    }];
    const route = routeSheet(state, 'order-1');
    expect(route.operations[0]).toMatchObject({ name: 'Metall ish', qty: 5, workerName: 'Metall usta' });
    expect(JSON.stringify(route)).not.toMatch(/salePrice|unitCost|"rate"|paid|debt|cash/);
  });
});

describe('invoice', () => {
  it('settles the order, exposes paid, debt and the internal cost', () => {
    const model = invoice(fixture(), 'order-1', admin);
    expect(model).toMatchObject({ total: 250000, paid: 100000, debt: 150000, subtotal: 250000, markup: 0 });
    expect(model.lines).toEqual([]);
    expect(model.costs).toEqual([{ position: 'Oshxona shkafi', material: 20000, labor: 25000, total: 45000, margin: 205000 }]);
    expect(model.cost).toEqual({ material: 20000, labor: 25000, overhead: 0, total: 45000, margin: 205000 });
  });

  it('costs every position separately without touching the customer sums', () => {
    const model = invoice(composite(), 'order-1', admin);
    expect(model.positions).toEqual([
      { title: 'Oshxona', kind: 'product', qty: 5, unitPrice: 50000, total: 250000 },
      { title: '45 gradus kesish', kind: 'service', qty: 1, unitPrice: 50000, total: 50000 },
    ]);
    expect(model.costs).toEqual([
      { position: 'Oshxona', material: 20000, labor: 25000, total: 45000, margin: 205000 },
      { position: '45 gradus kesish', material: 6000, labor: 5000, total: 11000, margin: 39000 },
    ]);
    expect(model.cost).toEqual({ material: 26000, labor: 30000, overhead: 10000, total: 66000, margin: 234000 });
    expect(model).toMatchObject({ subtotal: 300000, markup: 0, total: 300000 });
  });

  it('keeps a single-position order on one position summary and one cost row', () => {
    const model = invoice(fixture(), 'order-1', admin);
    expect(model.positions).toEqual([{ title: 'Oshxona shkafi', kind: 'product', qty: 5, unitPrice: 50000, total: 250000 }]);
    expect(model.costs.map(row => row.position)).toEqual(['Oshxona shkafi']);
  });

  it('costs a fixed-sum supplier stage without using a worker rate', () => {
    const state = fixture();
    state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
    state.orders[0].route = [{
      id: 'task-1', lineId: 'order-line-1', operationId: 'operation-1', name: 'Metall ish',
      executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
      rate: 0, supplierCost: 30000, standardMinutes: 15, planned: 5, completed: 5, status: 'completed',
    }];
    const model = invoice(state, 'order-1', admin);
    expect(model.cost.labor).toBe(30000);
    expect(model.costs[0]).toMatchObject({ labor: 30000, total: 50000, margin: 200000 });
  });

  it('hides VAT while the company setting is off', () => {
    expect(invoice(fixture(), 'order-1', admin).vat).toBeNull();
  });

  it('shows the owner markup on top of the agreed positions', () => {
    const state = fixture();
    state.orders[0].markup = 30000;
    state.orders[0].price = 280000;
    expect(invoice(state, 'order-1', admin)).toMatchObject({ subtotal: 250000, markup: 30000, total: 280000, debt: 180000 });
  });

  it('shows a discount as a negative markup', () => {
    const state = fixture();
    state.orders[0].markup = -20000;
    state.orders[0].price = 230000;
    const model = invoice(state, 'order-1', admin);
    expect(model).toMatchObject({ subtotal: 250000, markup: -20000, total: 230000 });
    const html = renderToStaticMarkup(createElement(PrintDocument, { model: { type: 'invoice', data: model }, close: () => {} }));
    expect(html).toContain('Chegirma');
    expect(html).not.toContain('Natsenka');
  });

  it('prints the internal tannarx and keeps it out of the customer sum', () => {
    const html = renderToStaticMarkup(createElement(PrintDocument, {
      model: { type: 'invoice', data: invoice(fixture(), 'order-1', admin) },
      close: () => {},
    }));
    expect(html).toContain('Tannarx (ichki hisob)');
    expect(html).toContain('Tannarx mijoz summasiga qo‘shilmaydi');
    expect(html).toContain('HISOB-FAKTURA');
  });

  it('prints no enterprise name on a customer invoice', () => {
    const model = invoice(fixture(), 'order-1', admin);
    expect(model).not.toHaveProperty('seller');
    expect(JSON.stringify(model)).not.toContain('Korxona');
  });

  it('prints a stock sale invoice from its shipment lines and costs it from unit cost', () => {
    const state = fixture();
    state.shipments[0] = {
      ...state.shipments[0], id: 'shipment-2', orderId: null, kind: 'stock',
      lines: [{ ...state.shipments[0].lines[0], itemId: 'cabinet', description: 'Oshxona shkafi', qty: 2, salePrice: 50000 }],
    };
    state.cash = [];
    const model = invoice(state, 'shipment-2', admin);
    expect(model).toMatchObject({ total: 100000, paid: 0, debt: 100000, subtotal: 100000, markup: 0 });
    expect(model.lines[0]).toMatchObject({ qty: 2, price: 50000, total: 100000, unit: 'dona' });
    expect(model.positions).toEqual([]);
    expect(model.costs).toEqual([]);
    expect(model.cost).toEqual({ material: 20000, labor: 0, overhead: 0, total: 20000, margin: 80000 });
  });

  it('is available to the owner only', () => {
    for (const actor of [worker, display]) {
      expect(() => invoice(fixture(), 'order-1', actor)).toThrow('Hisob-faktura faqat egasiga');
    }
  });

  it('rejects unknown or cancelled documents', () => {
    expect(() => invoice(fixture(), 'missing', admin)).toThrow('Hujjat topilmadi');
    const state = fixture();
    state.shipments[0].status = 'cancelled';
    expect(() => invoice(state, 'shipment-1', admin)).toThrow('Hujjat topilmadi');
  });
});

describe('cash receipt document', () => {
  const incoming: CashEntry = {
    id: 'cash-in-1', direction: 'in', amount: 500000, account: 'cash', toAccount: null,
    source: 'sale', sourceId: null, customerId: customer.id, category: 'sale',
    note: 'Shkaf uchun avans', number: 'PKO-0001', reversalOf: null, createdAt: '2026-11-11T09:00:00.000Z',
  };
  const cashState = (entry: CashEntry): State => {
    const state = emptyState();
    state.customers = [customer];
    state.cash = [entry];
    return state;
  };

  it('builds an incoming cash order model from the entry', () => {
    expect(cashReceipt(cashState(incoming), 'cash-in-1')).toEqual({
      kind: 'in', number: 'PKO-0001', date: '2026-11-11T09:00:00.000Z',
      party: customer.name, basis: 'Mijoz to‘lovi', account: 'Naqd pul',
      amount: 500000, note: 'Shkaf uchun avans', reversed: false,
    });
  });

  it('labels the counterparty for an outgoing supplier payment', () => {
    const state = emptyState();
    state.suppliers = [{ id: 'supplier-1', name: 'MDF Kompaniya', phone: '' }];
    state.cash = [{ ...incoming, id: 'cash-out-1', direction: 'out', source: 'supplier', sourceId: 'supplier-1', customerId: null, category: 'supplier', number: 'RKO-0001' }];
    expect(cashReceipt(state, 'cash-out-1')).toMatchObject({
      kind: 'out', party: 'MDF Kompaniya', basis: 'Yetkazib beruvchi', account: 'Naqd pul',
    });
  });

  it('rejects transfers, unnumbered entries and unknown ids', () => {
    expect(() => cashReceipt(cashState(incoming), 'missing')).toThrow('Hujjat topilmadi');
    const transfer: CashEntry = { ...incoming, id: 't1', direction: 'transfer', toAccount: 'bank', number: null };
    expect(() => cashReceipt(cashState(transfer), 't1')).toThrow('Hujjat topilmadi');
    const legacy: CashEntry = { ...incoming, id: 'legacy', number: null };
    expect(() => cashReceipt(cashState(legacy), 'legacy')).toThrow('Hujjat topilmadi');
  });

  it('renders the cash order form in uzbek latin', () => {
    const html = renderToStaticMarkup(createElement(PrintDocument, {
      model: { type: 'cash', data: cashReceipt(cashState(incoming), 'cash-in-1') },
      close: () => {},
    }));
    expect(html).toContain('KASSA KIRIM ORDERI');
    expect(html).toContain('PKO-0001');
    expect(html).toContain(customer.name);
    expect(html).toContain('Mijoz to‘lovi');
    expect(html).toContain('so‘m');
  });
});
