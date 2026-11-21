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

// ── Avto-xarid rejasi ────────────────────────────────────────────────────────────────────────────
// Nima sotib olish kerak: ishlab chiqarishdagi buyurtmalarga yetishmayotgani va minimal qoldiqdan
// pastga tushgani, allaqachon buyurtma qilingan (hali kelmagan) miqdor ayirilgan holda.
// Yetkazib beruvchi — shu materialni oxirgi marta sotgan; narx — oxirgi xarid narxi.
export interface PlanLine {
  itemId: string; name: string; unit: string; qty: number; price: number;
  forOrders: number; forMinimum: number; onOrder: number; orders: SupplyNeedOrder[];
}
export interface PlanGroup { supplierId: string | null; supplierName: string; lines: PlanLine[]; total: number }

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function purchasePlan(state: State, warehouseId: string): PlanGroup[] {
  const demand = new Map<string, { qty: number; orders: SupplyNeedOrder[] }>();
  for (const order of state.orders) {
    if (order.status !== 'production' || (order.warehouseId ?? MAIN_WAREHOUSE_ID) !== warehouseId) continue;
    const perItem = new Map<string, number>();
    for (const line of order.materials) {
      if (!line.itemId || line.issuedQty >= line.qty) continue;
      perItem.set(line.itemId, (perItem.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
    }
    for (const [itemId, qty] of perItem) {
      const row = demand.get(itemId) ?? { qty: 0, orders: [] };
      row.qty += qty;
      row.orders.push({ id: order.id, number: order.number, dueDate: order.dueDate, short: qty });
      demand.set(itemId, row);
    }
  }
  const onOrder = new Map<string, number>();
  const lastSupplier = new Map<string, { supplierId: string; at: string }>();
  for (const purchase of state.purchases) {
    for (const line of purchase.lines) {
      const known = lastSupplier.get(line.itemId);
      if (!known || known.at < purchase.createdAt) lastSupplier.set(line.itemId, { supplierId: purchase.supplierId, at: purchase.createdAt });
      if ((purchase.warehouseId ?? MAIN_WAREHOUSE_ID) === warehouseId && line.received < line.qty) {
        onOrder.set(line.itemId, (onOrder.get(line.itemId) ?? 0) + (line.qty - line.received));
      }
    }
  }
  const groups = new Map<string, PlanGroup>();
  for (const item of state.items) {
    // Mijoz materiali va o‘zimiz ishlab chiqaradigan pozitsiyalar sotib olinmaydi.
    if (item.customerId !== null || item.kind !== 'material') continue;
    const need = demand.get(item.id);
    const stock = stockQty(state, item.id, warehouseId);
    const coming = onOrder.get(item.id) ?? 0;
    const forOrders = Math.max(0, round3((need?.qty ?? 0) - stock));
    // Buyurtmalar yopilgach omborda minimal qoldiq qolishi kerak (asosiy omborda).
    const target = warehouseId === MAIN_WAREHOUSE_ID ? item.minQty : 0;
    const total = Math.max(0, round3((need?.qty ?? 0) + target - stock - coming));
    if (total <= 0) continue;
    const supplier = lastSupplier.get(item.id)?.supplierId ?? null;
    const known = supplier ? state.suppliers.find(row => row.id === supplier) : undefined;
    const key = known ? known.id : '';
    const group = groups.get(key) ?? { supplierId: known?.id ?? null, supplierName: known?.name ?? '', lines: [], total: 0 };
    const forMinimum = Math.max(0, round3(total - Math.max(0, forOrders - coming)));
    group.lines.push({ itemId: item.id, name: item.name, unit: item.unit, qty: total, price: item.lastPurchasePrice,
      forOrders: round3(total - forMinimum), forMinimum, onOrder: coming,
      orders: (need?.orders ?? []).sort((left, right) => left.dueDate.localeCompare(right.dueDate)) });
    group.total = Math.round((group.total + total * item.lastPurchasePrice) * 100) / 100;
    groups.set(key, group);
  }
  for (const group of groups.values()) group.lines.sort((left, right) => right.forOrders - left.forOrders || left.name.localeCompare(right.name));
  // Buyurtmalarni to‘xtatib turgan yetkazib beruvchilar birinchi; ta’minotchisi noma’lum guruh oxirida.
  return [...groups.values()].sort((left, right) => Number(left.supplierId === null) - Number(right.supplierId === null)
    || Number(right.lines.some(line => line.forOrders > 0)) - Number(left.lines.some(line => line.forOrders > 0))
    || left.supplierName.localeCompare(right.supplierName));
}

/** Bitta yetkazib beruvchiga bitta xarid: rejadagi barcha qatorlar. */
export function planCommand(group: PlanGroup, supplierId: string, warehouseId: string): import('./types').Command {
  return { type: 'purchase.create', supplierId, warehouseId, lines: group.lines.map(line => ({ itemId: line.itemId, qty: line.qty, price: line.price })) };
}
