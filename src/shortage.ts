import { exceeds, mergeNormMaterials, normMaterialLines, stockQty } from './domain';
import type { MaterialLine, Order, RouteLine, State } from './types';

export type ShortageRow = {
  itemId: string; name: string; unit: string;
  needed: number; stock: number; reserved: number; available: number; short: number;
};
export type DraftMaterial = { itemId: string; qty: number; issuedQty: number };
export type DraftStage = { operationId: string; qty: number };
export type DraftPosition = { id?: string; materials: DraftMaterial[]; route: DraftStage[] };

export function reservedExcept(state: State, itemId: string, excludeOrderId: string | null): number {
  return state.orders.reduce((total, order) => order.id === excludeOrderId || order.status !== 'production' ? total
    : total + order.materials.reduce((qty, line) => line.itemId === itemId && line.issuedQty < line.qty ? qty + (line.qty - line.issuedQty) : qty, 0), 0);
}

function collect(state: State, needed: Map<string, number>, excludeOrderId: string | null): ShortageRow[] {
  const rows: ShortageRow[] = [];
  for (const [itemId, qty] of needed) {
    const item = state.items.find(row => row.id === itemId);
    if (!item) continue;
    const stock = stockQty(state, itemId);
    const reserved = reservedExcept(state, itemId, excludeOrderId);
    const available = stock - reserved;
    if (!exceeds(qty, available)) continue;
    rows.push({ itemId, name: item.name, unit: item.unit, needed: qty, stock, reserved, available, short: qty - available });
  }
  return rows.sort((left, right) => right.short - left.short || left.name.localeCompare(right.name, 'uz'));
}

export function orderShortage(state: State, order: Order): ShortageRow[] {
  const needed = new Map<string, number>();
  for (const line of order.materials) {
    if (line.issuedQty >= line.qty || !line.itemId) continue;
    needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
  }
  return collect(state, needed, order.id);
}

function positionLines(state: State, position: DraftPosition, lineId: string, fromNorms: boolean): MaterialLine[] {
  const explicit: MaterialLine[] = position.materials
    .filter(row => row.itemId && row.qty > 0)
    .map((row, index) => ({ id: `${lineId}-m${index}`, lineId, itemId: row.itemId, qty: row.qty, estimatedCost: 0, issuedQty: row.issuedQty, actualCost: 0 }));
  if (!fromNorms) return explicit;
  const tasks: RouteLine[] = position.route
    .filter(stage => stage.operationId && stage.qty > 0)
    .map((stage, index) => ({ id: `${lineId}-r${index}`, lineId, operationId: stage.operationId, name: '', executorKind: 'employee',
      employeeId: null, supplierId: null, rate: 0, planned: stage.qty, completed: 0, status: 'assigned' }));
  // normMaterialLines loses the whole stage when a single norm points at a removed nomenclature item
  const known = new Set(state.items.map(row => row.id));
  const normState: State = { ...state, operations: state.operations.map(row => ({ ...row, norms: row.norms.filter(norm => known.has(norm.itemId)) })) };
  const normLines: MaterialLine[] = [];
  for (const task of tasks) {
    try {
      normLines.push(...normMaterialLines(normState, [task], lineId));
    } catch {
      continue;
    }
  }
  return mergeNormMaterials(explicit, normLines);
}

export function draftShortage(state: State, positions: DraftPosition[], excludeOrderId: string | null = null): ShortageRow[] {
  // order.create bakes m² norms into the stored materials; revisions store the submitted rows as they are,
  // so a saved order's draft must not add the norms a second time.
  const fromNorms = excludeOrderId === null;
  const needed = new Map<string, number>();
  positions.forEach((position, index) => {
    for (const line of positionLines(state, position, position.id ?? `draft-${index}`, fromNorms)) {
      if (line.issuedQty >= line.qty || !line.itemId) continue;
      needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
    }
  });
  return collect(state, needed, excludeOrderId);
}
