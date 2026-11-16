import { acceptedOutsourceCost, stockQty, supplierDebt, supplierStageActual } from './domain';
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const accountLabel = (account: 'cash' | 'bank'): string => account === 'cash' ? 'Naqd pul' : 'Bank';

function itemOf(state: State, itemId: string) {
  return state.items.find(row => row.id === itemId);
}

function itemName(state: State, itemId: string): string {
  return itemOf(state, itemId)?.name ?? 'Pozitsiya topilmadi';
}

function lineText(state: State, itemId: string, qty: number): string {
  const item = itemOf(state, itemId);
  return `${itemName(state, itemId)} · ${qty}${item ? ` ${item.unit}` : ''}`;
}

function supplierPurchases(state: State, supplierId: string) {
  return state.purchases.filter(purchase => purchase.supplierId === supplierId);
}

function latestBy<T>(rows: T[], date: (row: T) => string): T | undefined {
  return [...rows].sort((left, right) => date(left).localeCompare(date(right))).at(-1);
}

export type SupplierActionKind = 'purchase' | 'receipt' | 'payment' | 'service';

export interface SupplierActionRow {
  id: string;
  date: string;
  kind: SupplierActionKind;
  title: string;
  detail: string;
  amount: number;
  reversalOf: string | null;
  orderId?: string;
  purchaseId?: string;
}

export function supplierActions(state: State, supplierId: string): SupplierActionRow[] {
  const purchases = supplierPurchases(state, supplierId);
  const purchaseById = new Map(purchases.map(purchase => [purchase.id, purchase]));
  const rows: SupplierActionRow[] = [];

  for (const purchase of purchases) {
    rows.push({
      id: `purchase:${purchase.id}`,
      date: purchase.createdAt,
      kind: 'purchase',
      title: `${purchase.number} · xarid`,
      detail: purchase.lines.map(line => lineText(state, line.itemId, line.qty)).join(', '),
      amount: round(purchase.lines.reduce((sum, line) => sum + round(line.qty * line.price), 0)),
      reversalOf: null,
      purchaseId: purchase.id,
    });
  }

  for (const movement of state.movements) {
    if (movement.source !== 'purchase' || movement.direction !== 'in') continue;
    const purchase = purchaseById.get(movement.sourceId);
    if (!purchase) continue;
    rows.push({
      id: `receipt:${movement.id}`,
      date: movement.createdAt,
      kind: 'receipt',
      title: `${purchase.number} · qabul`,
      detail: lineText(state, movement.itemId, movement.qty),
      amount: round(movement.qty * movement.unitCost),
      reversalOf: null,
      purchaseId: purchase.id,
    });
  }

  for (const entry of state.cash) {
    if (entry.source !== 'supplier' || entry.sourceId !== supplierId) continue;
    const sign = entry.direction === 'out' ? -1 : entry.direction === 'in' ? 1 : 0;
    rows.push({
      id: `payment:${entry.id}`,
      date: entry.createdAt,
      kind: 'payment',
      title: entry.direction === 'out' ? `To‘lov · ${accountLabel(entry.account)}` : `To‘lov qaytarildi · ${accountLabel(entry.account)}`,
      detail: entry.note,
      amount: round(sign * entry.amount),
      reversalOf: entry.reversalOf,
    });
  }

  for (const order of state.orders) {
    for (const task of order.route) {
      if (task.executorKind !== 'supplier' || task.supplierId !== supplierId || task.status !== 'completed') continue;
      rows.push({
        id: `service:${task.id}`,
        date: order.createdAt,
        kind: 'service',
        title: `${order.number} · Autsors xizmati`,
        detail: `${task.name} · ${order.title}`,
        amount: supplierStageActual(task),
        reversalOf: null,
        orderId: order.id,
      });
    }
  }

  return rows.sort((left, right) => right.date.localeCompare(left.date)
    || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

export interface SupplierYearRow {
  year: string;
  purchases: number;
  orderedValue: number;
  receivedValue: number;
  outsourced: number;
  paid: number;
}

export function supplierYears(state: State, supplierId: string): SupplierYearRow[] {
  const years = new Map<string, SupplierYearRow>();
  for (const action of supplierActions(state, supplierId)) {
    const year = action.date.slice(0, 4);
    const row = years.get(year) ?? { year, purchases: 0, orderedValue: 0, receivedValue: 0, outsourced: 0, paid: 0 };
    if (action.kind === 'purchase') {
      row.purchases += 1;
      row.orderedValue = round(row.orderedValue + action.amount);
    } else if (action.kind === 'receipt') {
      row.receivedValue = round(row.receivedValue + action.amount);
    } else if (action.kind === 'service') {
      row.outsourced = round(row.outsourced + action.amount);
    } else {
      row.paid = round(row.paid - action.amount);
    }
    years.set(year, row);
  }
  return [...years.values()].sort((left, right) => right.year.localeCompare(left.year));
}

export interface SupplierCardSummary {
  purchases: number;
  orderedValue: number;
  receivedValue: number;
  outsourced: number;
  paid: number;
  debt: number;
  lastPurchaseAt: string | null;
  lastPaidAt: string | null;
}

export function supplierSummary(state: State, supplierId: string): SupplierCardSummary {
  const purchases = supplierPurchases(state, supplierId);
  const purchaseIds = new Set(purchases.map(purchase => purchase.id));
  const receivedValue = round(state.movements.reduce((sum, movement) => movement.source === 'purchase'
    && purchaseIds.has(movement.sourceId)
    ? sum + round(movement.qty * movement.unitCost) * (movement.direction === 'in' ? 1 : -1) : sum, 0));
  const payments = state.cash.filter(entry => entry.source === 'supplier' && entry.sourceId === supplierId);
  const paid = round(payments.reduce((sum, entry) => sum + (entry.direction === 'out' ? entry.amount : entry.direction === 'in' ? -entry.amount : 0), 0));
  return {
    purchases: purchases.length,
    orderedValue: round(purchases.reduce((sum, purchase) => sum + purchase.lines.reduce(
      (lineSum, line) => lineSum + round(line.qty * line.price), 0), 0)),
    receivedValue,
    outsourced: acceptedOutsourceCost(state, supplierId),
    paid,
    debt: supplierDebt(state, supplierId),
    lastPurchaseAt: latestBy(purchases, purchase => purchase.createdAt)?.createdAt ?? null,
    lastPaidAt: latestBy(payments.filter(entry => entry.direction === 'out'), entry => entry.createdAt)?.createdAt ?? null,
  };
}

export interface SupplierMaterialUse {
  orderId: string;
  number: string;
  title: string;
  qty: number;
  date: string;
}

export interface SupplierMaterialRecipe {
  recipeId: string;
  name: string;
  output: string;
}

export interface SupplierMaterialRow {
  itemId: string;
  name: string;
  unit: string;
  lastPrice: number;
  receivedQty: number;
  receivedValue: number;
  stock: number;
  uses: SupplierMaterialUse[];
  recipes: SupplierMaterialRecipe[];
}

function usages(state: State, itemId: string): SupplierMaterialUse[] {
  const groups = new Map<string, { qty: number; date: string }>();
  for (const movement of state.movements) {
    if (movement.source !== 'order' || movement.itemId !== itemId) continue;
    const current = groups.get(movement.sourceId) ?? { qty: 0, date: movement.createdAt };
    current.qty = round(current.qty + (movement.direction === 'out' ? movement.qty : -movement.qty));
    if (movement.createdAt > current.date) current.date = movement.createdAt;
    groups.set(movement.sourceId, current);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.qty > 0)
    .map(([orderId, group]) => {
      const order = state.orders.find(row => row.id === orderId);
      return {
        orderId, number: order?.number ?? '—', title: order?.title ?? 'Buyurtma topilmadi',
        qty: group.qty, date: group.date,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

function recipesUsing(state: State, itemId: string): SupplierMaterialRecipe[] {
  return state.recipes.flatMap(recipe => {
    const latest = [...recipe.versions].sort((left, right) => right.version - left.version)[0];
    if (!latest?.components.some(component => component.itemId === itemId || component.allowedItemIds.includes(itemId))) return [];
    return [{
      recipeId: recipe.id, name: recipe.name,
      output: itemOf(state, recipe.outputItemId)?.name ?? 'Mahsulot topilmadi',
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function supplierMaterials(state: State, supplierId: string): SupplierMaterialRow[] {
  const purchases = supplierPurchases(state, supplierId);
  const purchaseIds = new Set(purchases.map(purchase => purchase.id));
  const itemIds = [...new Set(purchases.flatMap(purchase => purchase.lines.map(line => line.itemId)))];

  return itemIds.map(itemId => {
    const item = itemOf(state, itemId);
    const lines = purchases.flatMap(purchase => purchase.lines
      .filter(line => line.itemId === itemId)
      .map(line => ({ line, date: purchase.createdAt })));
    const movements = state.movements.filter(movement => movement.source === 'purchase'
      && purchaseIds.has(movement.sourceId) && movement.itemId === itemId && movement.direction === 'in');
    return {
      itemId,
      name: item?.name ?? 'Pozitsiya topilmadi',
      unit: item?.unit ?? '',
      lastPrice: round(latestBy(lines, row => row.date)?.line.price ?? 0),
      receivedQty: round(movements.reduce((sum, movement) => sum + movement.qty, 0)),
      receivedValue: round(movements.reduce((sum, movement) => sum + round(movement.qty * movement.unitCost), 0)),
      stock: stockQty(state, itemId),
      uses: usages(state, itemId),
      recipes: recipesUsing(state, itemId),
    };
  }).sort((left, right) => right.receivedValue - left.receivedValue || left.name.localeCompare(right.name));
}
