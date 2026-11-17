import { stockQty } from './domain';
import type { State } from './types';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';

export interface SupplyNeedOrder { id: string; number: string; dueDate: string; short: number }
export interface SupplyNeed {
  itemId: string; name: string; unit: string;
  warehouseId: string; short: number;
  orders: SupplyNeedOrder[];
  lastPurchasePrice: number;
}

export function supplyNeeds(state: State): SupplyNeed[] {
  const needs = new Map<string, SupplyNeed>();
  for (const order of state.orders) {
    if (order.status !== 'production') continue;
    const warehouseId = order.warehouseId ?? MAIN_WAREHOUSE_ID;
    const perItem = new Map<string, number>();
    for (const line of order.materials) {
      if (!line.itemId || line.issuedQty >= line.qty) continue;
      perItem.set(line.itemId, (perItem.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
    }
    for (const [itemId, qty] of perItem) {
      const item = state.items.find(row => row.id === itemId);
      if (!item) continue;
      const key = `${itemId}|${warehouseId}`;
      const need = needs.get(key) ?? { itemId, name: item.name, unit: item.unit, warehouseId, short: 0,
        orders: [], lastPurchasePrice: item.lastPurchasePrice };
      need.orders.push({ id: order.id, number: order.number, dueDate: order.dueDate, short: qty });
      needs.set(key, need);
    }
  }
  const rows: SupplyNeed[] = [];
  for (const need of needs.values()) {
    need.short = need.orders.reduce((sum, row) => sum + row.short, 0) - stockQty(state, need.itemId, need.warehouseId);
    if (need.short <= 0) continue;
    need.orders.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
    rows.push(need);
  }
  return rows.sort((left, right) => right.short - left.short || left.orders[0].dueDate.localeCompare(right.orders[0].dueDate));
}
