import type { Command, Shipment, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export function shipmentQty(shipment: Shipment): number {
  return shipment.lines.reduce((total, line) => total + line.qty, 0);
}

export function shipmentTotals(shipment: Shipment): { revenue: number; cost: number; materialCost: number; laborCost: number } {
  const sum = (pick: (line: Shipment['lines'][number]) => number) =>
    round(shipment.lines.reduce((total, line) => total + line.qty * pick(line), 0));
  return { revenue: sum(line => line.salePrice), cost: sum(line => line.unitCost), materialCost: sum(line => line.materialCost), laborCost: sum(line => line.laborCost) };
}

export function salesCost(_state: State, shipment: Shipment): number {
  return shipmentTotals(shipment).cost;
}

export interface StockSaleLineInput { itemId: string; qty: number }

export function buildStockSaleInput(state: State, customerId: string, lines: StockSaleLineInput[]): Extract<Command, { type: 'shipment.createStock' }> {
  const shop = state.customers.find(row => row.id === customerId);
  if (!shop) throw new Error('Customer not found');
  if (shop.kind !== 'shop') throw new Error('Stock sales require a shop');
  if (!lines.length) throw new Error('Shipment requires lines');
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  return {
    type: 'shipment.createStock', customerId,
    lines: lines.map(line => ({ itemId: line.itemId, qty: line.qty })),
    dueDate, allowDebt: true,
  };
}
