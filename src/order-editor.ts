import { areaMaterialCost, lineMaterials, lineRoute, shippedForLine, stagePlanCost, startedTask, supplierStagePlan } from './domain';
import { formatQty } from './i18n';
import { matchesQuery } from './listview';
import { categoryLabel } from './warehouse';
import type { ExecutorKind, Item, Order, OrderLine, OrderLineInput, OrderLineKind, RouteTemplate, RouteTemplateStage, State, Status } from './types';

export type PositionMaterial = { itemId: string; qty: number; issuedQty: number };
export type PositionStage = {
  operationId: string;
  executorKind: ExecutorKind;
  employeeId: string | null;
  supplierId: string | null;
  rate: number;
  supplierCost?: number;
  salePrice?: number;
  qty: number;
  taskId?: string;
  locked: boolean;
  completed: number;
};
export type MaterialGroup = { category: string; items: Item[] };
export type PositionDraft = {
  id?: string;
  kind: OrderLineKind;
  title: string;
  qty: number;
  unitPrice: number;
  status?: Status;
  floor: number;
  materials: PositionMaterial[];
  route: PositionStage[];
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const exceedsWork = (completed: number, planned: number) => completed - planned > Number.EPSILON * Math.max(Math.abs(completed), Math.abs(planned)) * 8;
const byName = (left: Item, right: Item) => left.name.localeCompare(right.name, 'uz');
const byCategory = (left: MaterialGroup, right: MaterialGroup) => {
  if (left.category === 'Tasniflanmagan' && right.category !== 'Tasniflanmagan') return 1;
  if (right.category === 'Tasniflanmagan' && left.category !== 'Tasniflanmagan') return -1;
  return left.category.localeCompare(right.category, 'uz');
};

export function groupItems(items: Item[]): MaterialGroup[] {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const category = categoryLabel(item.category);
    const rows = groups.get(category);
    if (rows) rows.push(item);
    else groups.set(category, [item]);
  }
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items: [...items].sort(byName) }))
    .sort(byCategory);
}

export function materialGroups(state: State, customerId: string, selectedItemId = '', takenItemIds: string[] = []): MaterialGroup[] {
  return groupItems(state.items.filter(item => item.kind !== 'finished'
    && (!item.customerId || item.customerId === customerId)
    && (!takenItemIds.includes(item.id) || item.id === selectedItemId)));
}

export function searchMaterialGroups(groups: MaterialGroup[], query: string): MaterialGroup[] {
  if (!query.trim()) return groups;
  return groups
    .map(group => ({
      category: group.category,
      items: group.items.filter(item => matchesQuery([item.name, item.unit, group.category], query)),
    }))
    .filter(group => group.items.length > 0);
}

export function blankPosition(): PositionDraft {
  return { kind: 'product', title: '', qty: 1, unitPrice: 0, floor: 0, materials: [], route: [] };
}

export function positionFloor(state: State, order: Order, line: OrderLine): number {
  return Math.max(0, shippedForLine(state, order, line));
}

export function positionsFromOrder(state: State, order: Order): PositionDraft[] {
  return order.lines.filter(line => line.status !== 'cancelled').map(line => ({
    id: line.id,
    kind: line.kind,
    title: line.title,
    qty: line.qty,
    unitPrice: line.qty > 0 ? round(line.total / line.qty) : line.total,
    status: line.status,
    floor: positionFloor(state, order, line),
    materials: lineMaterials(order, line.id).map(row => ({ itemId: row.itemId, qty: row.qty, issuedQty: row.issuedQty })),
    route: lineRoute(order, line.id).map(task => ({
      operationId: task.operationId,
      executorKind: task.executorKind,
      employeeId: task.employeeId,
      supplierId: task.supplierId,
      rate: task.rate,
      ...(task.executorKind === 'supplier' ? { supplierCost: supplierStagePlan(task) } : {}),
      salePrice: task.salePrice ?? state.operations.find(row => row.id === task.operationId)?.salePrice ?? 0,
      qty: task.planned,
      taskId: task.id,
      locked: startedTask(state, order, task),
      completed: task.completed,
    })),
  }));
}

export function duplicatePosition(position: PositionDraft): PositionDraft {
  return {
    ...position,
    id: undefined,
    status: undefined,
    floor: 0,
    materials: position.materials.map(row => ({ ...row, issuedQty: 0 })),
    route: position.route.map(task => ({ ...task, taskId: undefined, locked: false, completed: 0 })),
  };
}

export function positionTotal(position: PositionDraft): number {
  return round(position.qty * position.unitPrice);
}

export function stageAmounts(stage: PositionStage): { price: number; worker: number } {
  return { price: round((stage.salePrice ?? 0) * stage.qty), worker: stage.executorKind === 'supplier' ? 0 : round(stage.rate * stage.qty) };
}

export function stageNormEstimate(state: State, stage: PositionStage): number | null {
  const operation = state.operations.find(row => row.id === stage.operationId);
  if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) return null;
  return areaMaterialCost(operation.norms, stage.qty, itemId => state.items.find(item => item.id === itemId)?.cost ?? 0);
}

export function orderTotals(state: State, positions: PositionDraft[], overhead: number, markup = 0): { qty: number; positions: number; markup: number; price: number; cost: number; margin: number } {
  const positionsTotal = round(positions.reduce((total, position) => total + positionTotal(position), 0));
  const qty = round(positions.reduce((total, position) => total + position.qty, 0));
  const cost = round(overhead + positions.reduce((total, position) => total
    + position.materials.reduce((sum, row) => sum + row.qty * (state.items.find(item => item.id === row.itemId)?.cost || 0), 0)
    + position.route.reduce((sum, task) => sum + (task.executorKind === 'supplier' ? (task.supplierCost ?? 0) : task.rate * task.qty), 0), 0));
  const price = round(positionsTotal + markup);
  return { qty, positions: positionsTotal, markup: round(markup), price, cost, margin: round(price - cost) };
}

export function positionCost(order: Order, line: OrderLine): { material: number; labor: number; total: number; margin: number } {
  const material = round(lineMaterials(order, line.id).reduce((sum, row) => sum + row.qty * row.estimatedCost, 0));
  const labor = round(lineRoute(order, line.id).reduce((sum, task) => sum + stagePlanCost(task), 0));
  const total = round(material + labor);
  return { material, labor, total, margin: round(line.total - total) };
}

export function positionLines(positions: PositionDraft[]): OrderLineInput[] {
  return positions.map(position => ({
    id: position.id,
    kind: position.kind,
    title: position.title.trim(),
    qty: position.qty,
    unitPrice: position.unitPrice,
    materials: position.materials.filter(row => row.itemId).map(row => ({ itemId: row.itemId, qty: row.qty })),
    route: position.route.map(task => ({
      operationId: task.operationId,
      executorKind: task.executorKind,
      employeeId: task.employeeId,
      supplierId: task.supplierId,
      rate: task.rate,
      ...(task.executorKind === 'supplier' ? { supplierCost: task.supplierCost ?? 0 } : {}),
      qty: task.qty,
      taskId: task.taskId,
    })),
  }));
}

export function positionIssue(positions: PositionDraft[]): string {
  if (!positions.length) return 'Kamida bitta pozitsiya kerak.';
  for (const [index, position] of positions.entries()) {
    const label = `Pozitsiya ${index + 1}`;
    if (!position.title.trim()) return `${label}: nomini kiriting.`;
    if (position.qty <= 0) return `${label}: miqdorini kiriting.`;
    if (position.qty < position.floor) return `${label}: miqdor yuborilgan miqdordan (${formatQty(position.floor)}) past bo‘lishi mumkin emas.`;
    if (!position.route.length || position.route.some(task => !task.operationId
      || (task.executorKind === 'employee' ? !task.employeeId || task.supplierId !== null
        : !task.supplierId || task.employeeId !== null))) {
      return `${label}: ijrochi bilan kamida bitta bosqich qo‘shing.`;
    }
    if (position.route.some(task => task.qty <= 0)) return `${label}: bosqich miqdorini kiriting.`;
    const overWork = position.route.find(task => exceedsWork(task.completed, task.qty));
    if (overWork) return `${label}: bosqich miqdori qabul qilingan ishdan (${formatQty(overWork.completed)}) past bo‘lishi mumkin emas.`;
    if (position.unitPrice <= 0) return `${label}: narxini kiriting.`;
    if (position.materials.some(row => !row.itemId || row.qty <= 0)) return `${label}: material qatorlarini to‘ldiring.`;
  }
  return '';
}

export function applicableTemplates(state: State, kind: OrderLineKind): RouteTemplate[] {
  return state.routeTemplates.filter(template => template.active && template.kind === kind);
}

function resolveTemplateEmployee(state: State, stage: RouteTemplateStage): string | null {
  if (stage.employeeId) return stage.employeeId;
  const operation = state.operations.find(row => row.id === stage.operationId);
  if (!operation) return null;
  const active = state.employees.filter(employee => employee.active && operation.employeeIds.includes(employee.id));
  return active.length === 1 ? active[0].id : null;
}

export function applyTemplate(state: State, template: RouteTemplate, qty: number): PositionStage[] {
  return template.stages.map(stage => {
    const operation = state.operations.find(row => row.id === stage.operationId);
    if (!operation) throw new Error('Operation not found');
    const executorKind = stage.executorKind ?? 'employee';
    return {
      operationId: operation.id,
      executorKind,
      employeeId: executorKind === 'employee' ? resolveTemplateEmployee(state, stage) : null,
      supplierId: executorKind === 'supplier' ? stage.supplierId ?? null : null,
      rate: executorKind === 'supplier' ? 0 : stage.rate ?? operation.workerRate,
      ...(executorKind === 'supplier' ? { supplierCost: 0 } : {}),
      salePrice: operation.salePrice,
      qty,
      locked: false,
      completed: 0,
    };
  });
}
