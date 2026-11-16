import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, shippedQty, stockQty } from './domain';
import { buildStockSaleInput, shipmentTotals } from './sales';
import type { Actor, Command, Customer, Item, Order, State } from './types';

const admin: Actor = { id: 'admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function stockedFinishedItem(input: { qty: number; cost: number; materialCost: number; laborCost: number; salePrice: number }): State {
  const state = emptyState();
  const customer: Customer = { id: 'shop-1', name: 'Мебельный магазин', phone: '', address: 'Ташкент', kind: 'shop', employeeId: null };
  const item: Item = {
    id: 'finished-1', name: 'Шкаф «Стандарт»', unit: 'шт', minQty: 0, cost: input.cost, customerId: null,
    kind: 'finished', salePrice: input.salePrice, lastPurchasePrice: input.cost,
    materialCost: input.materialCost, laborCost: input.laborCost, category: null,
  };
  state.customers.push(customer);
  state.items.push(item);
  state.movements.push({
    id: 'stock-1', itemId: item.id, direction: 'in', qty: input.qty, unitCost: input.cost,
    source: 'inventory', sourceId: 'opening', note: '', createdAt: '2026-10-01T00:00:00Z',
  });
  return state;
}

function readyOrder(qty: number, price: number): State {
  const state = emptyState();
  state.customers.push({ id: 'customer-1', name: 'Клиент', phone: '', address: 'Ташкент', kind: 'customer', employeeId: null });
  const order: Order = {
    id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'customer-1', title: 'Кухня',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty, price, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'ready',
    lines: [{ id: 'order-1-line', kind: 'product', title: 'Кухня', qty, total: price, status: 'ready' }],
    materials: [{ id: 'material-1', lineId: 'order-1-line', itemId: 'item-1', qty: 1, estimatedCost: 300, issuedQty: 1, actualCost: 300 }],
    route: [],
  };
  state.orders.push(order);
  return state;
}

const stockSale = (customerId: string, itemId: string, qty: number, allowDebt = true): Command => ({
  type: 'shipment.createStock', customerId, lines: [{ itemId, qty }], dueDate: '2026-11-05', allowDebt,
});

describe('stock shipment', () => {
  it('ships finished stock at item price and fixes current cost', () => {
    let state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    state = run(state, stockSale('shop-1', 'finished-1', 2));
    const shipment = state.shipments[0];
    expect(shipment).toMatchObject({ orderId: null, customerId: 'shop-1', kind: 'stock', status: 'shipped' });
    expect(shipment.lines[0]).toMatchObject({ qty: 2, salePrice: 50000, unitCost: 30000, materialCost: 25000, laborCost: 5000 });
    expect(shipmentTotals(shipment)).toEqual({ revenue: 100000, cost: 60000, materialCost: 50000, laborCost: 10000 });
    expect(stockQty(state, 'finished-1')).toBe(8);
  });

  it('rejects a stock sale above the free quantity', () => {
    const state = stockedFinishedItem({ qty: 3, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    expect(() => run(state, stockSale('shop-1', 'finished-1', 4))).toThrow('Insufficient stock');
    expect(state.shipments).toHaveLength(0);
    expect(stockQty(state, 'finished-1')).toBe(3);
  });

  it('sells only business finished goods, never materials or blanks', () => {
    let state = stockedFinishedItem({ qty: 3, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    state = run(state, { type: 'item.create', name: 'ЛДСП', unit: 'лист', minQty: 0, cost: 1000, customerId: null, kind: 'material' });
    state = run(state, { type: 'item.create', name: 'Корпус', unit: 'шт', minQty: 0, cost: 1000, customerId: null, kind: 'blank' });
    const material = state.items.find(item => item.kind === 'material')!;
    const blank = state.items.find(item => item.kind === 'blank')!;
    state.movements.push(
      { id: 'material-stock', itemId: material.id, direction: 'in', qty: 5, unitCost: 1000, source: 'inventory', sourceId: 'opening', note: '', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'blank-stock', itemId: blank.id, direction: 'in', qty: 5, unitCost: 1000, source: 'inventory', sourceId: 'opening', note: '', createdAt: '2026-10-01T00:00:00Z' },
    );
    expect(() => run(state, stockSale('shop-1', material.id, 1))).toThrow('Only finished goods can be sold from stock');
    expect(() => run(state, stockSale('shop-1', blank.id, 1))).toThrow('Only finished goods can be sold from stock');
  });

  it('requires a known shop and rejects shipment on credit without advance', () => {
    const state = stockedFinishedItem({ qty: 3, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    expect(() => run(state, stockSale('missing', 'finished-1', 1))).toThrow('Customer not found');
    state.customers.push({ id: 'regular-1', name: 'Частный клиент', phone: '', address: '', kind: 'customer', employeeId: null });
    expect(() => run(state, stockSale('regular-1', 'finished-1', 1))).toThrow('Stock sales require a shop');
    expect(() => run(state, stockSale('shop-1', 'finished-1', 1, false))).toThrow('Unpaid stock shipment');
  });

  it('keeps the sale price and cost at shipment time when the catalog changes later', () => {
    let state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    state = run(state, stockSale('shop-1', 'finished-1', 2));
    state.items[0].salePrice = 70000;
    state.items[0].cost = 40000;
    expect(shipmentTotals(state.shipments[0])).toEqual({ revenue: 100000, cost: 60000, materialCost: 50000, laborCost: 10000 });
  });

  it('returns goods at the original cost when the shipment is reversed', () => {
    let state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    state = run(state, stockSale('shop-1', 'finished-1', 2));
    const shipmentId = state.shipments[0].id;
    state = run(state, { type: 'shipment.reverse', shipmentId });
    expect(state.shipments[0].status).toBe('cancelled');
    expect(stockQty(state, 'finished-1')).toBe(10);
    const returned = state.movements.at(-1)!;
    expect(returned).toMatchObject({ direction: 'in', qty: 2, unitCost: 30000, source: 'sale', sourceId: shipmentId });
    expect(() => run(state, { type: 'shipment.reverse', shipmentId })).toThrow('Shipment already reversed');
  });
});

describe('stock sale form', () => {
  it('builds stock sale input without accepting a client price', () => {
    const state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
    const shop = state.customers.find(c => c.kind === 'shop')!;
    const item = state.items.find(i => i.kind === 'finished')!;
    const command = buildStockSaleInput(state, shop.id, [{ itemId: item.id, qty: 2 }]);
    expect(command).toEqual({ type: 'shipment.createStock', customerId: shop.id, lines: [{ itemId: item.id, qty: 2 }], dueDate: expect.any(String), allowDebt: true });
    expect(JSON.stringify(command)).not.toContain('salePrice');
  });
});

describe('order shipment lines', () => {
  it('splits order revenue and cost across partial shipments without rounding loss', () => {
    let state = readyOrder(3, 1000);
    state = run(state, { type: 'shipment.create', orderId: 'order-1', qty: 1, address: 'Цех', dueDate: '2026-11-05', allowDebt: true });
    state = run(state, { type: 'shipment.create', orderId: 'order-1', qty: 2, address: 'Цех', dueDate: '2026-11-05', allowDebt: true });
    const totals = state.shipments.map(shipment => shipmentTotals(shipment));
    expect(totals[0].revenue + totals[1].revenue).toBe(1000);
    expect(totals[0].cost + totals[1].cost).toBe(300);
    expect(totals.every(total => total.materialCost + total.laborCost === total.cost)).toBe(true);
    expect(state.shipments[0]).toMatchObject({ orderId: 'order-1', customerId: 'customer-1', kind: 'order' });
    expect(state.shipments[0].lines[0].itemId).toBeNull();
    expect(shippedQty(state, 'order-1')).toBe(3);
    expect(() => run(state, { type: 'shipment.create', orderId: 'order-1', qty: 1, address: 'Цех', dueDate: '2026-11-05', allowDebt: true })).toThrow('Shipment exceeds remaining quantity');
  });

  it('charges accepted outsourcing into shipment labor once per unit', () => {
    let state = readyOrder(1, 500000);
    state.orders[0].route = [{
      id: 'task-outsourced', lineId: 'order-1-line', operationId: 'operation-1', name: 'Metall ish',
      executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
      rate: 80000, planned: 1, completed: 1, status: 'completed',
    }];
    state = run(state, { type: 'shipment.create', orderId: 'order-1', qty: 1,
      address: 'Цех', dueDate: '2026-11-05', allowDebt: true });
    const shipment = state.shipments.at(-1)!;
    expect(shipment.lines[0]).toMatchObject({ qty: 1, materialCost: 300, laborCost: 80000 });
    expect(shipmentTotals(shipment)).toMatchObject({ materialCost: 300, laborCost: 80000 });
  });
});
