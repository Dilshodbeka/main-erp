import { DEMO_COMPANY_ID } from './migrations';
import { customerLedger, orderLedger } from './receivables';
import { validateRecipeGraph } from './recipes';
import { expenseLedger } from './expenses';
import { loanLedger } from './loans';
import { salaryLedger } from './salary';
import { shipmentQty } from './sales';
import { normalizeTicketContext } from './support';
import { canTouchOrder, requiredPermission, WORKER_BASE } from './permissions';
import type {
  Account, Actor, CashEntry, CashSource, Command, Customer, CustomerKind, DefectMaterial, DefectReason, Envelope, Item, ItemKind, MaterialLine, Operation,
  OperationNorm, OperationUnit, Order, OrderInput, OrderLine, OrderLineInput, OrderLineKind, OrderMaterialInput, OrderRouteInput,
  RecipeComponent, RecipeComponentInput, RouteLine, RouteTemplate, RouteTemplateStage, SeriesInput, Shipment,
  ShipmentLine, State, Status, StockMovement, SupportTicket, TaskStatus, WorkerDeduction, WorkReport,
} from './types';

const uuid = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const defectReasons: DefectReason[] = ['quality', 'measurement', 'drawing', 'customer', 'other'];

function round(value: number): number {
  check(Number.isFinite(value) && Math.abs(value) <= 1e12, 'Amount must be finite and not exceed 1 trillion UZS');
  const result = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  check(Number.isFinite(result), 'Amount is too large');
  return result === 0 ? 0 : result;
}

function money(value: number, positive = false): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'Invalid amount');
  const result = round(value);
  check(!positive || result > 0, 'Amount must be positive');
  return result;
}

function quantity(value: number, allowZero = false): number {
  check(typeof value === 'number' && Number.isFinite(value) && value <= 1e9 && (allowZero ? value >= 0 : value > 0), 'Invalid quantity');
  return value;
}

function signedMoney(value: number): number {
  check(typeof value === 'number' && Number.isFinite(value), 'Invalid amount');
  return round(value);
}

export function exceeds(value: number, limit: number): boolean {
  return value - limit > Number.EPSILON * Math.max(Math.abs(value), Math.abs(limit)) * 8;
}

export function isIssued(row: { qty: number; issuedQty: number }): boolean {
  return !exceeds(row.qty, row.issuedQty);
}

function text(value: string, label: string): string {
  check(typeof value === 'string' && value.trim().length > 0, `${label} is required`);
  return value.trim();
}

function named<T extends { name: string }>(rows: T[], name: string): string {
  const result = text(name, 'Name');
  check(!rows.some(row => row.name.trim().toLocaleLowerCase() === result.toLocaleLowerCase()), 'Name already exists');
  return result;
}

function find<T extends { id: string }>(rows: T[], id: string, label: string): T {
  const row = rows.find(entry => entry.id === id);
  check(row, `${label} not found`);
  return row;
}

function account(value: Account): Account {
  check(value === 'cash' || value === 'bank', 'Invalid account');
  return value;
}

function unique(values: string[], label: string): void {
  check(new Set(values).size === values.length, `Duplicate ${label}`);
}

const units: OperationUnit[] = ['sheet', 'meter', 'squareMeter', 'piece', 'hole', 'minute', 'hour'];
const itemKinds: ItemKind[] = ['material', 'blank', 'finished'];
const customerKinds: CustomerKind[] = ['customer', 'shop', 'service'];

function customerKind(value: CustomerKind): CustomerKind {
  check(customerKinds.includes(value), 'Invalid customer kind');
  return value;
}

function checkWorkerLink(state: State, employeeId: string, excludeCustomerId?: string): void {
  find(state.employees, employeeId, 'Employee');
  check(!state.customers.some(customer => customer.id !== excludeCustomerId && customer.employeeId === employeeId),
    'Employee already has a customer account');
}

function itemKind(value: ItemKind | undefined): ItemKind {
  const kind = value ?? 'material';
  check(itemKinds.includes(kind), 'Invalid item kind');
  return kind;
}

function warehouseCategory(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  check(typeof value === 'string' && /^\d{2}\.\d{2}$/.test(value), 'Invalid warehouse category');
  return value;
}

function itemPhoto(value: string | undefined): string {
  if (value === undefined) return '';
  const photo = value.trim();
  check(photo.length <= 200000, 'Photo is too large');
  check(!photo || /^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/.test(photo), 'Invalid photo');
  return photo;
}

function operationUnit(value: OperationUnit): OperationUnit {
  check(units.includes(value), 'Invalid operation unit');
  return value;
}

const orderLineKinds: OrderLineKind[] = ['product', 'service'];
const statusRanks: Status[] = ['draft', 'production', 'ready', 'shipped', 'delivered'];

function orderLineKind(value: OrderLineKind): OrderLineKind {
  check(orderLineKinds.includes(value), 'Invalid order line kind');
  return value;
}

type OperationValuesInput = Omit<Operation, 'id' | 'norms'> & { norms?: OperationNorm[] };

function operationValues(state: State, input: OperationValuesInput, exclude = ''): Omit<Operation, 'id'> {
  const name = named(state.operations.filter(row => row.id !== exclude), input.name);
  const unit = operationUnit(input.unit);
  const salePrice = money(input.salePrice);
  const workerRate = money(input.workerRate);
  const standardMinutes = quantity(input.standardMinutes, true);
  check(typeof input.active === 'boolean', 'Invalid active flag');
  check(typeof input.autoAccept === 'boolean', 'Invalid auto accept flag');
  let machineId: string | null = null;
  if (input.machineId !== null) {
    const machine = find(state.machines, input.machineId, 'Machine');
    check(machine.active, 'Machine is inactive');
    machineId = machine.id;
  }
  unique(input.employeeIds, 'employee');
  for (const id of input.employeeIds) check(find(state.employees, id, 'Employee').active, 'Employee is inactive');
  const norms = (input.norms ?? []).map(norm => {
    const item = find(state.items, norm.itemId, 'Item');
    check(item.customerId === null, 'Norm material must be a business item');
    return { itemId: item.id, qtyPerM2: quantity(norm.qtyPerM2) };
  });
  unique(norms.map(norm => norm.itemId), 'norm item');
  return {
    name, unit, salePrice, workerRate, standardMinutes, machineId,
    employeeIds: [...input.employeeIds], active: input.active, autoAccept: input.autoAccept, norms,
  };
}

function componentValues(state: State, inputs: RecipeComponentInput[]): RecipeComponent[] {
  check(inputs.length > 0, 'Recipe requires components');
  const slots = inputs.map(input => text(input.slot, 'Slot').toLocaleLowerCase());
  unique(slots, 'slot');
  return inputs.map(input => {
    const slot = text(input.slot, 'Slot');
    const qtyPerUnit = quantity(input.qtyPerUnit);
    unique(input.allowedItemIds, 'allowed item');
    check(input.itemId !== null || input.allowedItemIds.length > 0, 'Slot requires a default or allowed item');
    for (const id of [...(input.itemId === null ? [] : [input.itemId]), ...input.allowedItemIds]) {
      const item = find(state.items, id, 'Item');
      check(item.customerId === null, 'Customer materials cannot be used in recipes');
    }
    return { id: uuid(), slot, itemId: input.itemId, allowedItemIds: [...input.allowedItemIds], qtyPerUnit };
  });
}

function recipeOutput(state: State, itemId: string) {
  const item = find(state.items, itemId, 'Item');
  check(item.customerId === null, 'Recipe output must be a business item');
  check(item.kind === 'blank' || item.kind === 'finished', 'Recipe output must be a blank or finished item');
  return item;
}

export function lineMaterials(order: Order, lineId: string): MaterialLine[] {
  return order.materials.filter(row => row.lineId === lineId);
}

export function lineRoute(order: Order, lineId: string): RouteLine[] {
  return order.route.filter(row => row.lineId === lineId);
}

export function activeLines(order: Order): OrderLine[] {
  return order.lines.filter(line => line.status !== 'cancelled');
}

function orderLineOf(order: Order, lineId: string): OrderLine {
  return find(order.lines, lineId, 'Order line');
}

function syncOrder(order: Order): void {
  const active = activeLines(order);
  if (!active.length) {
    order.status = 'cancelled';
    return;
  }
  const qty = active.reduce((total, line) => total + line.qty, 0);
  check(Number.isFinite(qty) && qty > 0 && qty <= 1000000000, 'Order quantity is out of range');
  order.qty = qty;
  const markup = order.markup ?? 0;
  const price = round(active.reduce((total, line) => total + line.total, 0) + markup);
  check(price >= 0, 'Markup exceeds order total');
  order.price = price;
  const rank = active.reduce((lowest, line) => Math.min(lowest, statusRanks.indexOf(line.status)), statusRanks.length - 1);
  order.status = statusRanks[rank] ?? 'production';
}

function syncIdentity(order: Order): void {
  const active = activeLines(order);
  if (!active.length) return;
  const kinds = new Set(active.map(line => line.kind));
  order.kind = kinds.size === 1 ? [...kinds][0]! : 'composite';
  order.title = active.map(line => line.title).join(' · ');
}

function routeExecutor(state: State, operation: Operation, line: OrderRouteInput):
  Pick<RouteLine, 'executorKind' | 'employeeId' | 'supplierId'> {
  const executorKind = line.executorKind ?? 'employee';
  const employeeId = line.employeeId ?? null;
  const supplierId = line.supplierId ?? null;
  if (executorKind === 'employee') {
    check(employeeId !== null && supplierId === null, 'Employee stage requires exactly one employee');
    const employee = find(state.employees, employeeId, 'Employee');
    check(employee.active, 'Employee is inactive');
    check(operation.employeeIds.includes(employee.id), 'Employee is not authorized for this operation');
    return { executorKind, employeeId: employee.id, supplierId: null };
  }
  check(executorKind === 'supplier', 'Invalid executor kind');
  check(employeeId === null && supplierId !== null, 'Supplier stage requires exactly one supplier');
  const supplier = find(state.suppliers, supplierId, 'Supplier');
  return { executorKind, employeeId: null, supplierId: supplier.id };
}

function routeValues(state: State, lines: OrderRouteInput[], qty: number, lineId: string): RouteLine[] {
  check(lines.length > 0, 'Order requires a production route');
  return lines.map(line => {
    const operation = find(state.operations, line.operationId, 'Operation');
    check(operation.active, 'Operation is inactive');
    const executor = routeExecutor(state, operation, line);
    const rate = money(line.rate);
    const stageQty = line.qty === undefined ? qty : quantity(line.qty);
    round(stageQty * rate);
    return {
      id: uuid(), lineId, operationId: operation.id, name: operation.name,
      ...executor,
      rate, supplierCost: executor.executorKind === 'supplier' ? money(line.supplierCost ?? 0) : 0,
      salePrice: operation.salePrice, standardMinutes: operation.standardMinutes,
      planned: stageQty, completed: 0, status: 'assigned' as const,
    };
  });
}

function routeTemplateStage(state: State, input: RouteTemplateStage): RouteTemplateStage {
  const operation = find(state.operations, input.operationId, 'Operation');
  check(operation.active, 'Operation is inactive');
  const executorKind = input.executorKind ?? 'employee';
  check(executorKind === 'employee' || executorKind === 'supplier', 'Invalid executor kind');
  const stage: RouteTemplateStage = { operationId: operation.id, executorKind };
  if (input.rate !== undefined) stage.rate = money(input.rate);
  if (executorKind === 'employee') {
    check(input.supplierId === undefined || input.supplierId === null, 'Employee stage requires no supplier');
    if (input.employeeId !== undefined && input.employeeId !== null) {
      const employee = find(state.employees, input.employeeId, 'Employee');
      check(employee.active, 'Employee is inactive');
      check(operation.employeeIds.includes(employee.id), 'Employee is not authorized for this operation');
      stage.employeeId = employee.id;
    }
  } else {
    check(input.employeeId === undefined || input.employeeId === null, 'Supplier stage requires no employee');
    check(input.supplierId !== undefined && input.supplierId !== null, 'Supplier stage requires a supplier');
    const supplier = find(state.suppliers, input.supplierId, 'Supplier');
    stage.supplierId = supplier.id;
  }
  return stage;
}

function routeTemplateValues(state: State, input: { name: string; kind: OrderLineKind; stages: RouteTemplateStage[] }, exclude = ''): Omit<RouteTemplate, 'id' | 'active'> {
  const name = named(state.routeTemplates.filter(row => row.id !== exclude), input.name);
  const kind = orderLineKind(input.kind);
  check(input.stages.length > 0, 'Template requires at least one stage');
  return { name, kind, stages: input.stages.map(stage => routeTemplateStage(state, stage)) };
}

function findRecipeVersion(state: State, versionId: string) {
  for (const recipe of state.recipes) {
    const version = recipe.versions.find(row => row.id === versionId);
    if (version) return { recipe, version };
  }
  throw new Error('Recipe version not found');
}

function orderMaterials(state: State, lines: OrderMaterialInput[], customerId: string, lineId: string): MaterialLine[] {
  unique(lines.map(row => row.itemId), 'material');
  return lines.map(line => {
    const item = find(state.items, line.itemId, 'Item');
    check(item.customerId === null || item.customerId === customerId, 'Material belongs to another customer');
    if (item.customerId !== null) find(state.customers, item.customerId, 'Customer');
    const qty = quantity(line.qty);
    round(qty * item.cost);
    return { id: uuid(), lineId, itemId: item.id, qty, estimatedCost: item.customerId === null ? item.cost : 0, issuedQty: 0, actualCost: 0 };
  });
}

export function areaLaborCost(rate: number, area: number): number {
  return round(rate * area);
}

export function areaMaterialCost(norms: OperationNorm[], area: number, getCost: (itemId: string) => number): number {
  return round(norms.reduce((total, norm) => total + round(norm.qtyPerM2 * area * getCost(norm.itemId)), 0));
}

const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function defectMaterials(state: State, task: RouteLine, qty: number): DefectMaterial[] {
  const operation = state.operations.find(row => row.id === task.operationId);
  if (!operation || operation.unit !== 'squareMeter') return [];
  return operation.norms
    .filter(norm => state.items.some(item => item.id === norm.itemId))
    .map(norm => ({ itemId: norm.itemId, qty: round3(norm.qtyPerM2 * qty) }));
}

export function normMaterialLines(state: State, route: RouteLine[], lineId: string): MaterialLine[] {
  const lines: MaterialLine[] = [];
  for (const task of route) {
    if (task.lineId !== lineId) continue;
    const operation = state.operations.find(row => row.id === task.operationId);
    if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) continue;
    for (const norm of operation.norms) {
      const item = find(state.items, norm.itemId, 'Item');
      lines.push({
        id: uuid(), lineId, itemId: item.id, qty: quantity(norm.qtyPerM2 * task.planned),
        estimatedCost: item.cost, issuedQty: 0, actualCost: 0,
      });
    }
  }
  return lines;
}

export function mergeNormMaterials(materials: MaterialLine[], normLines: MaterialLine[]): MaterialLine[] {
  const result = materials.map(row => ({ ...row }));
  for (const norm of normLines) {
    const existing = result.find(row => row.itemId === norm.itemId && row.lineId === norm.lineId);
    if (existing) existing.qty = quantity(existing.qty + norm.qty);
    else result.push(norm);
  }
  return result;
}

function revisionMaterials(state: State, order: Order, lines: OrderMaterialInput[], lineId: string): MaterialLine[] {
  unique(lines.map(row => row.itemId), 'material');
  const current = lineMaterials(order, lineId);
  for (const line of current.filter(row => row.issuedQty > 0)) {
    const next = lines.find(row => row.itemId === line.itemId);
    check(next, 'Issued material cannot be removed');
  }
  return lines.map(line => {
    const existing = current.find(row => row.itemId === line.itemId);
    if (existing && existing.issuedQty > 0) {
      quantity(line.qty, true);
      existing.qty = quantity(Math.max(line.qty, existing.issuedQty));
      return existing;
    }
    const item = find(state.items, line.itemId, 'Item');
    check(item.customerId === null || item.customerId === order.customerId, 'Material belongs to another customer');
    if (item.customerId !== null) find(state.customers, item.customerId, 'Customer');
    const qty = quantity(line.qty);
    const estimatedCost = item.customerId === null ? item.cost : 0;
    round(qty * estimatedCost);
    if (existing) {
      existing.qty = qty;
      existing.estimatedCost = estimatedCost;
      return existing;
    }
    return { id: uuid(), lineId, itemId: item.id, qty, estimatedCost, issuedQty: 0, actualCost: 0 };
  });
}

export function startedTask(state: State, order: Order, task: Order['route'][number]): boolean {
  return task.status !== 'assigned' || task.completed > 0
    || state.reports.some(row => row.orderId === order.id && row.taskId === task.id);
}

function revisionCostKept(task: RouteLine, line: OrderRouteInput): boolean {
  if (task.executorKind !== 'supplier') return true;
  const stored = task.supplierCost ?? 0;
  const supplied = money(line.supplierCost ?? 0);
  return stored > 0 ? supplied === stored : supplied === 0 || supplied === round(task.planned * task.rate);
}

export function normDelta(state: State, lineId: string, materials: MaterialLine[], previous: RouteLine[], next: RouteLine[]): MaterialLine[] {
  const plannedByOperation = (route: RouteLine[]): Map<string, number> => {
    const totals = new Map<string, number>();
    for (const task of route) {
      if (task.lineId !== lineId) continue;
      totals.set(task.operationId, (totals.get(task.operationId) ?? 0) + task.planned);
    }
    return totals;
  };
  const before = plannedByOperation(previous);
  const after = plannedByOperation(next);
  for (const operationId of new Set([...before.keys(), ...after.keys()])) {
    const operation = state.operations.find(row => row.id === operationId);
    if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) continue;
    const shift = (after.get(operationId) ?? 0) - (before.get(operationId) ?? 0);
    if (shift === 0) continue;
    for (const norm of operation.norms) {
      const item = state.items.find(row => row.id === norm.itemId);
      if (!item || item.customerId !== null) continue;
      const delta = round3(norm.qtyPerM2 * shift);
      if (delta === 0) continue;
      const existing = materials.find(row => row.lineId === lineId && row.itemId === item.id);
      if (existing) {
        const nextQty = round3(existing.qty + delta);
        if (nextQty <= 0 && existing.issuedQty === 0) {
          materials.splice(materials.indexOf(existing), 1);
          continue;
        }
        existing.qty = Math.max(nextQty, existing.issuedQty);
        continue;
      }
      if (delta > 0) {
        materials.push({
          id: uuid(), lineId, itemId: item.id, qty: quantity(delta),
          estimatedCost: item.cost, issuedQty: 0, actualCost: 0,
        });
      }
    }
  }
  return materials;
}

function routeRevision(state: State, order: Order, lines: OrderRouteInput[], qty: number, lineId: string): Order['route'] {
  check(lines.length > 0, 'Order requires a production route');
  unique(lines.map(line => line.taskId).filter((id): id is string => id !== undefined), 'task');
  const current = lineRoute(order, lineId);
  for (const line of lines) {
    if (line.taskId === undefined) continue;
    const existing = find(current, line.taskId, 'Task');
    const stageQty = line.qty === undefined ? qty : quantity(line.qty);
    check(!exceeds(existing.completed, stageQty), 'Stage quantity is below accepted work');
  }
  for (const task of current.filter(row => startedTask(state, order, row))) {
    const line = lines.find(row => row.taskId === task.id);
    check(line, 'Started stage cannot be removed');
    const operation = find(state.operations, line.operationId, 'Operation');
    const executor = routeExecutor(state, operation, line);
    check(line.operationId === task.operationId
      && executor.executorKind === task.executorKind
      && executor.employeeId === task.employeeId
      && executor.supplierId === task.supplierId
      && money(line.rate) === task.rate
      && revisionCostKept(task, line), 'Started stage cannot be changed');
  }
  const route = lines.map(line => {
    const values = routeValues(state, [line], qty, lineId)[0];
    const existing = line.taskId === undefined ? undefined : find(current, line.taskId, 'Task');
    if (!existing) return values;
    const task: RouteLine = { ...existing, ...values, id: existing.id };
    if (startedTask(state, order, existing)) {
      task.completed = existing.completed;
      task.status = existing.status;
      task.supplierCost = existing.supplierCost ?? 0;
    }
    return task;
  });
  for (const task of route) {
    if (task.status === 'completed' && exceeds(task.planned, task.completed)) task.status = 'in_progress';
  }
  return route;
}

function buildLines(state: State, customerId: string, inputs: OrderLineInput[]) {
  check(Array.isArray(inputs) && inputs.length > 0, 'Order requires lines');
  const lines: OrderLine[] = [];
  const materials: MaterialLine[] = [];
  const route: RouteLine[] = [];
  for (const input of inputs) {
    const qty = quantity(input.qty);
    const unitPrice = money(input.unitPrice);
    const line: OrderLine = {
      id: uuid(), kind: orderLineKind(input.kind), title: text(input.title, 'Title'),
      qty, total: round(qty * unitPrice), status: 'draft',
    };
    lines.push(line);
    materials.push(...orderMaterials(state, input.materials, customerId, line.id));
    route.push(...routeValues(state, input.route, qty, line.id));
  }
  return { lines, materials, route };
}

function revisionLines(state: State, order: Order, inputs: OrderLineInput[]): OrderLine[] {
  check(Array.isArray(inputs) && inputs.length > 0, 'Order requires lines');
  const open = new Map(order.lines.filter(line => line.status !== 'cancelled').map(line => [line.id, line]));
  const rebuilt: OrderLine[] = [];
  const materials: MaterialLine[] = [];
  const route: RouteLine[] = [];
  for (const input of inputs) {
    const previous = input.id === undefined ? undefined : find(order.lines, input.id, 'Order line');
    check(previous === undefined || previous.status !== 'cancelled', 'Cancelled position cannot be revised');
    const current: OrderLine = previous ?? {
      id: uuid(), kind: orderLineKind(input.kind), title: '', qty: 0, total: 0,
      status: order.status === 'draft' ? 'draft' : 'production',
    };
    const qty = quantity(input.qty);
    check(!exceeds(shippedForLine(state, order, current), qty), 'Quantity is below shipped quantity');
    const draft = current.status === 'draft';
    current.kind = orderLineKind(input.kind);
    current.title = text(input.title, 'Title');
    current.qty = qty;
    current.total = round(qty * money(input.unitPrice));
    const rows = draft
      ? orderMaterials(state, input.materials, order.customerId, current.id)
      : revisionMaterials(state, order, input.materials, current.id);
    const previousRoute = lineRoute(order, current.id);
    const tasks = draft
      ? routeValues(state, input.route, qty, current.id)
      : routeRevision(state, order, input.route, qty, current.id);
    if (!draft) normDelta(state, current.id, rows, previousRoute, tasks);
    if (current.status === 'ready' && !(rows.every(row => isIssued(row)) && tasks.every(row => !exceeds(row.planned, row.completed)))) {
      current.status = 'production';
    }
    materials.push(...rows);
    route.push(...tasks);
    rebuilt.push(current);
    if (previous) open.delete(previous.id);
  }
  check(open.size === 0, 'Order line cannot be removed');
  order.lines = [...rebuilt, ...order.lines.filter(row => row.status === 'cancelled')];
  order.materials = materials;
  order.route = route;
  return rebuilt;
}

export function emptyState(): State {
  return {
    version: 4, revision: 0, companyId: DEMO_COMPANY_ID, customers: [], suppliers: [], employees: [], machines: [], operations: [],
    items: [], recipes: [], orders: [], purchases: [], movements: [], cash: [], reports: [], defects: [], payroll: [],
    shipments: [], audit: [], salaryPlans: [], expensePlans: [], loans: [], routeTemplates: [], workerDeductions: [], tickets: [],
  };
}

export function stockQty(state: State, itemId: string): number {
  return state.movements.reduce((total, row) => row.itemId === itemId
    ? total + (row.direction === 'in' ? row.qty : -row.qty) : total, 0);
}

export function reservedQty(state: State, itemId: string): number {
  return state.orders.reduce((total, order) => order.status === 'production'
    ? total + order.materials.reduce((qty, line) => line.itemId === itemId && !isIssued(line)
      ? qty + (line.qty - line.issuedQty) : qty, 0)
    : total, 0);
}

export function cashBalance(state: State, selectedAccount: Account): number {
  account(selectedAccount);
  return round(state.cash.reduce((total, row) => {
    if (row.direction === 'transfer') {
      return total - (row.account === selectedAccount ? row.amount : 0)
        + (row.toAccount === selectedAccount ? row.amount : 0);
    }
    return total + (row.account === selectedAccount ? (row.direction === 'in' ? row.amount : -row.amount) : 0);
  }, 0));
}

function sourceNet(state: State, source: CashSource, sourceId: string, incoming: boolean): number {
  return round(state.cash.reduce((total, row) => row.source === source && row.sourceId === sourceId
    ? total + (row.direction === (incoming ? 'in' : 'out') ? row.amount
      : row.direction === 'transfer' ? 0 : -row.amount)
    : total, 0));
}

export function orderPaid(state: State, orderId: string): number {
  return state.orders.some(row => row.id === orderId) ? orderLedger(state, orderId).paid : 0;
}

export function supplierStagePlan(task: RouteLine): number {
  if (task.executorKind !== 'supplier') return 0;
  return (task.supplierCost ?? 0) > 0 ? round(task.supplierCost!) : round(task.planned * task.rate);
}

export function supplierStageActual(task: RouteLine): number {
  if (task.executorKind !== 'supplier' || task.status !== 'completed') return 0;
  return (task.supplierCost ?? 0) > 0 ? round(task.supplierCost!) : round(task.completed * task.rate);
}

export function supplierStagePriced(task: RouteLine): boolean {
  return task.executorKind === 'supplier' && ((task.supplierCost ?? 0) > 0 || task.rate > 0);
}

export function stagePlanCost(task: RouteLine): number {
  return task.executorKind === 'supplier' ? supplierStagePlan(task) : round(task.planned * task.rate);
}

export function acceptedOutsourceCost(state: State, supplierId: string): number {
  return round(state.orders.reduce((total, order) => total + order.route.reduce((sum, task) =>
    task.executorKind === 'supplier' && task.supplierId === supplierId && task.status === 'completed'
      ? sum + supplierStageActual(task) : sum, 0), 0));
}

export function supplierDebt(state: State, supplierId: string): number {
  const purchases = new Set(state.purchases.filter(row => row.supplierId === supplierId).map(row => row.id));
  const received = state.movements.reduce((total, row) => row.source === 'purchase' && purchases.has(row.sourceId)
    ? total + round(row.qty * row.unitCost) * (row.direction === 'in' ? 1 : -1) : total, 0);
  return round(received + acceptedOutsourceCost(state, supplierId) - sourceNet(state, 'supplier', supplierId, false));
}

export function payrollDebt(state: State, employeeId: string): number {
  return salaryLedger(state, employeeId).owed;
}

export function estimatedCost(_state: State, order: Order): number {
  return round(order.materials.reduce((total, row) => total + round(row.qty * row.estimatedCost), 0)
    + order.route.reduce((total, row) => total + stagePlanCost(row), 0) + order.overhead);
}

function acceptedRouteCost(order: Order, lineId?: string): number {
  return round(order.route.reduce((sum, task) =>
    task.executorKind === 'supplier' && task.status === 'completed'
      && (lineId === undefined || task.lineId === lineId)
      ? sum + supplierStageActual(task) : sum, 0));
}

export function actualCost(state: State, order: Order): number {
  return round(order.materials.reduce((total, row) =>
    total + round(row.issuedQty * row.actualCost), 0)
    + state.payroll.reduce((total, row) => row.orderId === order.id && row.status === 'accepted'
      ? total + row.amount : total, 0)
    + acceptedRouteCost(order));
}

export function shippedQty(state: State, orderId: string): number {
  return state.shipments.reduce((total, row) => row.orderId === orderId && row.status !== 'cancelled'
    ? total + shipmentQty(row) : total, 0);
}

function customerAdvance(state: State, customerId: string): number {
  return customerLedger(state, customerId).advance;
}

function countsLine(order: Order, entry: ShipmentLine, line: OrderLine): boolean {
  return entry.lineId === line.id || (entry.lineId === undefined && order.lines.length === 1);
}

function qtyForLine(state: State, order: Order, line: OrderLine, statuses: Shipment['status'][]): number {
  return state.shipments.reduce((total, row) => {
    if (row.orderId !== order.id || row.kind !== 'order' || !statuses.includes(row.status)) return total;
    return total + row.lines.reduce((sum, entry) => countsLine(order, entry, line) ? sum + entry.qty : sum, 0);
  }, 0);
}

export function shippedForLine(state: State, order: Order, line: OrderLine): number {
  return qtyForLine(state, order, line, ['shipped', 'delivered']);
}

function deliveredForLine(state: State, order: Order, line: OrderLine): number {
  return qtyForLine(state, order, line, ['delivered']);
}

function orderShipmentLine(state: State, order: Order, line: OrderLine, beforeQty: number, qty: number): ShipmentLine {
  const materialTotal = round(lineMaterials(order, line.id).reduce((sum, row) => sum + round(row.issuedQty * row.actualCost), 0));
  const tasks = new Set(lineRoute(order, line.id).map(row => row.id));
  const laborTotal = round(state.payroll.reduce((sum, row) =>
    row.orderId === order.id && tasks.has(row.taskId) && row.status === 'accepted'
      ? sum + row.amount : sum, 0) + acceptedRouteCost(order, line.id));
  const costTotal = round(materialTotal + laborTotal);
  const slice = (total: number) => round(total * (beforeQty + qty) / line.qty) - round(total * beforeQty / line.qty);
  const material = slice(materialTotal);
  const cost = slice(costTotal);
  return {
    id: uuid(), itemId: null, lineId: line.id, description: `${order.number} · ${line.title}`, qty,
    salePrice: slice(line.total) / qty, unitCost: cost / qty,
    materialCost: material / qty, laborCost: round(cost - material) / qty,
  };
}

function stockShipmentLine(item: Item, qty: number): ShipmentLine {
  return {
    id: uuid(), itemId: item.id, description: item.name, qty,
    salePrice: item.salePrice, unitCost: item.cost, materialCost: item.materialCost, laborCost: item.laborCost,
  };
}

type ShipmentRequest = { qty?: number; lines?: { lineId: string; qty: number }[] };

function shipmentRequest(order: Order, command: ShipmentRequest): { lineId: string; qty: number }[] {
  const entries = command.lines ?? [{ lineId: order.lines[0]?.id ?? '', qty: command.qty ?? 0 }];
  check(entries.length > 0, 'Shipment requires order lines');
  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const line = orderLineOf(order, entry.lineId);
    check(line.status !== 'cancelled', 'Cancelled line cannot be shipped');
    const qty = quantity(entry.qty);
    grouped.set(line.id, round((grouped.get(line.id) ?? 0) + qty));
  }
  return [...grouped].map(([lineId, qty]) => ({ lineId, qty }));
}

function workContext(state: State, command: { orderId: string; taskId: string }, actor: Actor) {
  const order = find(state.orders, command.orderId, 'Order');
  check(order.status === 'production', 'Order is not in production');
  const task = find(order.route, command.taskId, 'Task');
  const line = orderLineOf(order, task.lineId);
  check(line.status === 'production', 'Order line is not in production');
  check(task.executorKind === 'employee' && task.employeeId !== null, 'Outsourced task is not available to workers');
  const operation = find(state.operations, task.operationId, 'Operation');
  const employee = find(state.employees, task.employeeId, 'Employee');
  check(actor.role === 'admin' || actor.id === task.employeeId, 'Worker is not assigned to this task');
  check(operation.employeeIds.includes(employee.id), 'Worker is not authorized for this operation');
  check(employee.active, 'Employee is inactive');
  check(lineMaterials(order, line.id).every(row => isIssued(row)), 'Materials must be issued before work');
  const tasks = lineRoute(order, line.id);
  const index = tasks.indexOf(task);
  check(tasks.slice(0, index).every(row => !exceeds(row.planned, row.completed)), 'Previous route stage is incomplete');
  return { order, task, operation, employee };
}

export function taskState(state: State, orderId: string, taskId: string): TaskStatus {
  const order = state.orders.find(row => row.id === orderId);
  return order?.route.find(row => row.id === taskId)?.status ?? 'assigned';
}

export function availableTask(state: State, orderId: string, taskId: string): boolean {
  const order = state.orders.find(row => row.id === orderId);
  if (!order || order.status !== 'production') return false;
  const index = order.route.findIndex(row => row.id === taskId);
  if (index < 0) return false;
  const task = order.route[index];
  if (task.executorKind !== 'employee' || !task.employeeId) return false;
  const line = order.lines.find(row => row.id === task.lineId);
  if (!line || line.status !== 'production') return false;
  if (lineMaterials(order, line.id).some(row => !isIssued(row))) return false;
  const operation = state.operations.find(row => row.id === task.operationId);
  const tasks = lineRoute(order, line.id);
  return !!operation && operation.employeeIds.includes(task.employeeId)
    && state.employees.some(row => row.id === task.employeeId && row.active)
    && tasks.slice(0, tasks.indexOf(task)).every(row => !exceeds(row.planned, row.completed))
    && task.status !== 'completed' && task.status !== 'submitted'
    && exceeds(task.planned, task.completed);
}

export type TaskBlockReason = 'materials' | 'previous-stage' | 'other';

export function taskBlockReason(state: State, orderId: string, taskId: string): TaskBlockReason | null {
  if (availableTask(state, orderId, taskId)) return null;
  const order = state.orders.find(row => row.id === orderId);
  const task = order?.route.find(row => row.id === taskId);
  if (!order || !task) return 'other';
  if (lineMaterials(order, task.lineId).some(row => !isIssued(row))) return 'materials';
  const tasks = lineRoute(order, task.lineId);
  if (tasks.slice(0, tasks.indexOf(task)).some(row => exceeds(row.planned, row.completed))) return 'previous-stage';
  return 'other';
}

function totalPrice(order: Order): number {
  return round(order.price);
}

function movement(state: State, row: Omit<StockMovement, 'id' | 'createdAt'>): void {
  quantity(row.qty);
  state.movements.push({ ...row, id: uuid(), createdAt: now() });
}

function nextCashNumber(state: State, direction: 'in' | 'out'): string {
  const count = state.cash.filter(row => row.direction === direction && row.number !== null).length + 1;
  return `${direction === 'in' ? 'PKO' : 'RKO'}-${String(count).padStart(4, '0')}`;
}

function postCash(state: State, row: Omit<CashEntry, 'id' | 'createdAt' | 'number'>): CashEntry {
  account(row.account);
  money(row.amount, true);
  if (row.direction === 'transfer') {
    check(row.toAccount !== null, 'Destination account is required');
    account(row.toAccount);
    check(row.account !== row.toAccount, 'Transfer accounts must differ');
  } else {
    check(row.direction === 'in' || row.direction === 'out', 'Invalid cash direction');
    check(row.toAccount === null, 'Only transfers have a destination account');
  }
  if (row.direction !== 'in') check(row.amount <= cashBalance(state, row.account), 'Insufficient account balance');
  const entry: CashEntry = {
    ...row, id: uuid(), createdAt: now(),
    number: row.direction === 'transfer' ? null : nextCashNumber(state, row.direction),
  };
  state.cash.push(entry);
  return entry;
}

function payment(state: State, source: 'supplier' | 'payroll', sourceId: string, amount: number, selectedAccount: Account,
  options?: {
    kind?: 'payroll' | 'advance';
    note?: string;
    allowPrepay?: boolean;
    category?: 'supplier' | 'outsourcing';
  }): void {
  const value = money(amount, true);
  account(selectedAccount);
  let payable: number;
  if (source === 'supplier') {
    find(state.suppliers, sourceId, 'Supplier');
    payable = supplierDebt(state, sourceId);
  } else {
    find(state.employees, sourceId, 'Employee');
    payable = payrollDebt(state, sourceId);
  }
  check(options?.allowPrepay || value <= payable, 'Payment exceeds payable');
  postCash(state, {
    direction: 'out', amount: value, account: selectedAccount, toAccount: null, source, sourceId, customerId: null,
    category: options?.category ?? (source === 'payroll' && options?.kind ? options.kind : source),
    note: options?.note ?? '', reversalOf: null,
  });
}

function customerPayment(state: State, customerId: string, amount: number, selectedAccount: Account): void {
  find(state.customers, customerId, 'Customer');
  const value = money(amount);
  account(selectedAccount);
  check(value > 0, 'Invalid amount');
  postCash(state, {
    direction: 'in', amount: value, account: selectedAccount, toAccount: null,
    source: 'sale', sourceId: customerId, customerId, category: 'sale', note: '', reversalOf: null,
  });
}

function ready(state: State, order: Order): void {
  if (order.status !== 'production') return;
  for (const line of activeLines(order)) {
    if (line.status !== 'production') continue;
    const tasks = lineRoute(order, line.id);
    if (!tasks.some(row => exceeds(row.planned, row.completed))
      && lineMaterials(order, line.id).every(row => isIssued(row))) {
      line.status = 'ready';
      if (order.kind === 'series') receiveSeriesOutput(state, order);
    }
  }
  syncOrder(order);
}

export function actualSeriesMaterialCost(state: State, order: Order): number {
  return round(order.materials.reduce((sum, line) => sum + round(line.issuedQty * line.actualCost), 0));
}

export function actualSeriesLaborCost(state: State, order: Order): number {
  return round(state.payroll
    .filter(row => row.orderId === order.id && row.status === 'accepted')
    .reduce((sum, entry) => sum + entry.amount, 0));
}

export function actualSeriesCost(state: State, order: Order): number {
  return round(actualSeriesMaterialCost(state, order) + actualSeriesLaborCost(state, order));
}

function receiveSeriesOutput(state: State, order: Order): void {
  if (state.movements.some(row => row.source === 'production' && row.sourceId === order.id)) return;
  const item = find(state.items, order.outputItemId ?? '', 'Item');
  const qty = quantity(order.qty);
  const labor = actualSeriesLaborCost(state, order);
  const total = actualSeriesCost(state, order);
  const before = stockQty(state, item.id);
  const after = before + qty;
  check(Number.isFinite(after), 'Stock quantity is too large');
  const cost = round((before * item.cost + total) / after);
  const laborCost = Math.min(cost, round((before * item.laborCost + labor) / after));
  item.cost = cost;
  item.laborCost = laborCost;
  item.materialCost = round(cost - laborCost);
  movement(state, {
    itemId: item.id, direction: 'in', qty, unitCost: round(total / qty),
    source: 'production', sourceId: order.id, note: '',
  });
}

function ticketText(value: unknown): string {
  check(typeof value === 'string', 'Ticket text is required');
  const body = value.trim();
  check(body.length > 0, 'Ticket text is required');
  check(body.length <= 2000, 'Ticket text is too long');
  return body;
}

function mutate(state: State, command: Command, actor: Actor): string {
  switch (command.type) {
    case 'customer.create': {
      const employeeId = command.employeeId ?? null;
      if (employeeId !== null) checkWorkerLink(state, employeeId);
      const row: Customer = { id: uuid(), name: named(state.customers, command.name), phone: command.phone, address: command.address, kind: customerKind(command.kind), employeeId, sellerId: null };
      if (actor.role === 'worker' && (actor.permissions ?? []).includes('customers.claim')) row.sellerId = actor.id;
      state.customers.push(row);
      return row.id;
    }
    case 'customer.claim': {
      const customer = state.customers.find(c => c.id === command.customerId);
      check(customer, 'Mijoz topilmadi');
      check(!customer.sellerId, 'Bu mijoz allaqachon biriktirilgan');
      customer.sellerId = actor.id; // actor.id = employeeId для worker
      return 'Mijoz sizga biriktirildi';
    }
    case 'customer.assign': {
      const customer = state.customers.find(c => c.id === command.customerId);
      check(customer, 'Mijoz topilmadi');
      check(command.sellerId === null || state.employees.some(e => e.id === command.sellerId && e.active), 'Faol xodimni tanlang');
      customer.sellerId = command.sellerId;
      return command.sellerId ? 'Mas’ul sotuvchi tayinlandi' : 'Mas’ul sotuvchi olib tashlandi';
    }
    case 'customer.link': {
      const customer = find(state.customers, command.customerId, 'Customer');
      const employeeId = command.employeeId ?? null;
      if (employeeId !== null) checkWorkerLink(state, employeeId, customer.id);
      customer.employeeId = employeeId;
      return customer.id;
    }
    case 'supplier.create': {
      const row = { id: uuid(), name: named(state.suppliers, command.name), phone: command.phone };
      state.suppliers.push(row);
      return row.id;
    }
    case 'employee.create': {
      const row = { id: uuid(), name: named(state.employees, command.name), active: true };
      state.employees.push(row);
      return row.id;
    }
    case 'employee.update': {
      const row = find(state.employees, command.employeeId, 'Employee');
      check(typeof command.active === 'boolean', 'Invalid active flag');
      row.name = named(state.employees.filter(employee => employee.id !== row.id), command.name);
      if (command.deactivatedAt !== undefined && command.deactivatedAt !== null) {
        check(/^\d{4}-\d{2}-\d{2}$/.test(command.deactivatedAt) && !Number.isNaN(Date.parse(`${command.deactivatedAt}T00:00:00Z`)), 'Invalid deactivation date');
      }
      row.deactivatedAt = command.active ? null : (command.deactivatedAt ?? row.deactivatedAt ?? now().slice(0, 10));
      row.active = command.active;
      return row.id;
    }
    case 'machine.create': {
      const row = {
        id: uuid(), name: named(state.machines, command.name),
        hourlyRevenueTarget: money(command.hourlyRevenueTarget), active: true,
      };
      state.machines.push(row);
      return row.id;
    }
    case 'machine.update': {
      const row = find(state.machines, command.machineId, 'Machine');
      check(typeof command.active === 'boolean', 'Invalid active flag');
      row.name = named(state.machines.filter(machine => machine.id !== row.id), command.name);
      row.hourlyRevenueTarget = money(command.hourlyRevenueTarget);
      row.active = command.active;
      return row.id;
    }
    case 'operation.create': {
      const row = { id: uuid(), ...operationValues(state, command) };
      state.operations.push(row);
      return row.id;
    }
    case 'operation.update': {
      const row = find(state.operations, command.operationId, 'Operation');
      Object.assign(row, operationValues(state, command, row.id));
      return row.id;
    }
    case 'item.create': {
      if (command.customerId !== null) find(state.customers, command.customerId, 'Customer');
      const name = named(state.items.filter(row => row.customerId === command.customerId), command.name);
      const kind = itemKind(command.kind);
      const cost = money(command.cost);
      const salePrice = money(command.salePrice ?? 0);
      const openQty = quantity(command.openQty ?? 0, true);
      check(command.customerId === null || cost === 0, 'Customer materials must have zero cost');
      check(command.customerId === null || openQty === 0, 'Customer materials cannot have opening stock');
      const row = {
        id: uuid(), name, unit: text(command.unit, 'Unit'), minQty: quantity(command.minQty, true),
        cost, customerId: command.customerId, kind, salePrice,
        lastPurchasePrice: 0, materialCost: cost, laborCost: 0, category: warehouseCategory(command.category),
        photo: itemPhoto(command.photo),
      };
      state.items.push(row);
      if (openQty > 0) movement(state, {
        itemId: row.id, direction: 'in', qty: openQty, unitCost: cost,
        source: 'inventory', sourceId: uuid(), note: 'Boshlang‘ich qoldiq',
      });
      return row.id;
    }
    case 'item.update': {
      const row = find(state.items, command.itemId, 'Item');
      row.name = named(state.items.filter(item => item.id !== row.id && item.customerId === row.customerId), command.name);
      row.unit = text(command.unit, 'Unit');
      row.minQty = quantity(command.minQty, true);
      row.salePrice = row.customerId === null ? money(command.salePrice) : 0;
      row.category = warehouseCategory(command.category);
      if (command.photo !== undefined) row.photo = itemPhoto(command.photo);
      return row.id;
    }
    case 'recipe.create': {
      const output = recipeOutput(state, command.outputItemId);
      const name = named(state.recipes, command.name);
      state.recipes.push({
        id: uuid(), outputItemId: output.id, name, active: true,
        versions: [{ id: uuid(), version: 1, components: componentValues(state, command.components), createdAt: now() }],
      });
      validateRecipeGraph(state);
      return state.recipes.at(-1)!.id;
    }
    case 'recipe.version.create': {
      const recipe = find(state.recipes, command.recipeId, 'Recipe');
      check(recipe.active, 'Recipe is inactive');
      recipeOutput(state, recipe.outputItemId);
      const components = componentValues(state, command.components);
      const version = recipe.versions.reduce((max, row) => Math.max(max, row.version), 0) + 1;
      recipe.versions.push({ id: uuid(), version, components, createdAt: now() });
      validateRecipeGraph(state);
      return recipe.id;
    }
    case 'customer.receive': {
      const item = find(state.items, command.itemId, 'Item');
      check(item.customerId !== null, 'Only customer materials may be received here');
      find(state.customers, item.customerId, 'Customer');
      movement(state, {
        itemId: item.id, direction: 'in', qty: quantity(command.qty), unitCost: 0,
        source: 'customer', sourceId: item.customerId, note: command.note,
      });
      return item.id;
    }
    case 'order.create': {
      const input = command.input;
      const orderCustomer = find(state.customers, input.customerId, 'Customer');
      if (actor.role === 'worker' && !orderCustomer.sellerId && (actor.permissions ?? []).includes('customers.claim')) {
        orderCustomer.sellerId = actor.id;
      }
      const overhead = money(input.overhead);
      const advance = money(input.advance);
      account(input.account);
      const order: Order = {
        id: uuid(), number: `ORD-${String(state.orders.length + 1).padStart(4, '0')}`,
        kind: 'product', customerId: input.customerId, title: '',
        outputItemId: null, recipeVersionId: null, substitutions: {},
        qty: 0, price: 0, overhead, markup: input.markup === undefined ? 0 : signedMoney(input.markup),
        dueDate: input.dueDate, createdAt: now(),
        status: 'draft', lines: [], materials: [], route: [],
      };
      if (input.lines !== undefined) {
        const built = buildLines(state, input.customerId, input.lines);
        check(input.kind === 'composite' || built.lines.length === 1, 'Invalid order kind');
        order.lines = built.lines;
        order.route = built.route;
        order.materials = built.lines.reduce((materials, line) =>
          mergeNormMaterials(materials, normMaterialLines(state, built.route, line.id)), built.materials);
        order.kind = built.lines.length === 1 ? built.lines[0].kind : 'composite';
        order.title = built.lines.map(line => line.title).join(' · ');
      } else {
        check(input.kind === 'product' || input.kind === 'service', 'Invalid order kind');
        const qty = quantity(input.qty!);
        const line: OrderLine = {
          id: uuid(), kind: input.kind, title: text(input.title!, 'Title'),
          qty, total: money(input.price!), status: 'draft',
        };
        order.lines = [line];
        order.title = line.title;
        order.route = routeValues(state, input.route ?? [], qty, line.id);
        order.materials = mergeNormMaterials(
          orderMaterials(state, input.materials ?? [], input.customerId, line.id),
          normMaterialLines(state, order.route, line.id));
      }
      syncOrder(order);
      check(advance <= order.price, 'Advance exceeds order price');
      estimatedCost(state, order);
      state.orders.push(order);
      if (advance > 0) customerPayment(state, input.customerId, advance, input.account);
      return order.id;
    }
    case 'order.update': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.kind !== 'series', 'Series orders follow their recipe');
      check(order.status === 'draft' || order.status === 'production' || order.status === 'ready', 'Order cannot be edited');
      find(state.customers, order.customerId, 'Customer');
      if (command.lines !== undefined) {
        revisionLines(state, order, command.lines);
        order.overhead = money(command.overhead);
        if (command.markup !== undefined) order.markup = signedMoney(command.markup);
        order.dueDate = command.dueDate;
        syncIdentity(order);
        syncOrder(order);
        estimatedCost(state, order);
        return order.id;
      }
      const line = order.lines[0];
      check(line !== undefined, 'Order line not found');
      check(activeLines(order).length === 1, 'Order positions require a line revision');
      const qty = quantity(command.qty!);
      check(!exceeds(shippedQty(state, order.id), qty), 'Quantity is below shipped quantity');
      const price = money(command.price!);
      const overhead = money(command.overhead);
      const title = text(command.title!, 'Title');
      const draft = order.status === 'draft';
      const materials = draft
        ? orderMaterials(state, command.materials ?? [], order.customerId, line.id)
        : revisionMaterials(state, order, command.materials ?? [], line.id);
      const previousRoute = lineRoute(order, line.id);
      const route = draft
        ? routeValues(state, command.route ?? [], qty, line.id)
        : routeRevision(state, order, command.route ?? [], qty, line.id);
      if (!draft) normDelta(state, line.id, materials, previousRoute, route);
      line.title = title;
      line.qty = qty;
      line.total = price;
      order.title = title;
      order.overhead = overhead;
      if (command.markup !== undefined) order.markup = signedMoney(command.markup);
      order.dueDate = command.dueDate;
      order.materials = materials;
      order.route = route;
      if (line.status === 'ready'
        && !(materials.every(row => isIssued(row)) && route.every(row => !exceeds(row.planned, row.completed)))) {
        line.status = 'production';
      }
      syncOrder(order);
      estimatedCost(state, order);
      return order.id;
    }
    case 'series.create': {
      const input: SeriesInput = command.input;
      const { recipe, version } = findRecipeVersion(state, input.recipeVersionId);
      check(recipe.active, 'Recipe is inactive');
      const output = recipeOutput(state, input.outputItemId);
      check(recipe.outputItemId === output.id, 'Recipe does not produce this item');
      quantity(input.qty);
      const substitutions = input.substitutions ?? {};
      for (const slot of Object.keys(substitutions)) {
        check(version.components.some(component => component.slot === slot), 'Unknown substitution slot');
      }
      const line: OrderLine = {
        id: uuid(), kind: 'product', title: `${recipe.name} · v${version.version}`,
        qty: input.qty, total: 0, status: 'draft',
      };
      const materials = version.components.map(component => {
        const chosen = substitutions[component.slot] ?? component.itemId;
        check(chosen, `Slot ${component.slot} requires a selected item`);
        check(chosen === component.itemId || component.allowedItemIds.includes(chosen), 'Substitution is not allowed for this slot');
        const item = find(state.items, chosen, 'Item');
        check(item.customerId === null, 'Customer materials cannot be used in recipes');
        const qty = component.qtyPerUnit * input.qty;
        round(qty * item.cost);
        return { id: uuid(), lineId: line.id, itemId: item.id, qty, estimatedCost: item.cost, issuedQty: 0, actualCost: 0 };
      });
      unique(materials.map(row => row.itemId), 'material');
      check(!input.route.some(row => row.executorKind === 'supplier'), 'Series production uses employees only');
      const route = routeValues(state, input.route, input.qty, line.id);
      const order: Order = {
        id: uuid(), number: `ORD-${String(state.orders.length + 1).padStart(4, '0')}`,
        kind: 'series', customerId: '', title: line.title,
        outputItemId: output.id, recipeVersionId: version.id, substitutions: { ...substitutions },
        qty: input.qty, price: 0, overhead: 0, dueDate: input.dueDate, createdAt: now(),
        status: 'draft', lines: [line], materials, route,
      };
      estimatedCost(state, order);
      state.orders.push(order);
      return order.id;
    }
    case 'order.launch': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.status === 'draft', 'Only draft orders can launch');
      if (order.kind !== 'series') find(state.customers, order.customerId, 'Customer');
      for (const line of order.lines) {
        const materials = lineMaterials(order, line.id);
        unique(materials.map(row => row.itemId), 'material');
        for (const row of materials) {
          const item = find(state.items, row.itemId, 'Item');
          quantity(row.qty);
          check(row.issuedQty === 0, 'Material already issued');
          check(item.customerId === null || item.customerId === order.customerId, 'Material belongs to another customer');
          check(!exceeds(row.qty, stockQty(state, item.id) - reservedQty(state, item.id)), 'Insufficient available stock');
        }
      }
      for (const task of order.route) {
        find(state.operations, task.operationId, 'Operation');
        if (task.executorKind === 'supplier') find(state.suppliers, task.supplierId!, 'Supplier');
        else check(find(state.employees, task.employeeId!, 'Employee').active, 'Employee is inactive');
      }
      order.status = 'production';
      for (const line of order.lines) if (line.status !== 'cancelled') line.status = 'production';
      ready(state, order);
      return order.id;
    }
    case 'order.issue': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.status === 'production', 'Only production orders can issue materials');
      const line = command.lineId === undefined ? undefined : orderLineOf(order, command.lineId);
      const pending = (line === undefined ? order.materials : lineMaterials(order, line.id)).filter(row => !isIssued(row));
      check(pending.length > 0, 'All materials already issued');
      for (const row of pending) {
        const item = find(state.items, row.itemId, 'Item');
        const delta = quantity(row.qty - row.issuedQty);
        check(item.customerId === null || item.customerId === order.customerId, 'Material belongs to another customer');
        check(!exceeds(reservedQty(state, item.id), stockQty(state, item.id)), 'Insufficient reserved stock');
        check(!exceeds(delta, stockQty(state, item.id)), 'Insufficient stock');
      }
      for (const row of pending) {
        const item = find(state.items, row.itemId, 'Item');
        const delta = quantity(row.qty - row.issuedQty);
        row.actualCost = item.customerId === null ? item.cost : 0;
        movement(state, {
          itemId: item.id, direction: 'out', qty: delta, unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: '',
        });
        row.issuedQty = row.qty;
      }
      ready(state, order);
      return order.id;
    }
    case 'order.cancel': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.status === 'draft' || order.status === 'production' || order.status === 'ready', 'Order cannot be cancelled');
      check(!state.shipments.some(row => row.orderId === order.id && row.status !== 'cancelled'), 'Shipped orders cannot be cancelled');
      check(!state.movements.some(row => row.source === 'production' && row.sourceId === order.id), 'Produced stock cannot be cancelled');
      for (const row of order.materials.filter(row => row.issuedQty > 0)) {
        find(state.items, row.itemId, 'Item');
        movement(state, {
          itemId: row.itemId, direction: 'in', qty: quantity(row.issuedQty), unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: 'Bekor qilingan buyurtma materiali qaytarildi',
        });
        row.issuedQty = 0;
        row.actualCost = 0;
      }
      for (const line of order.lines) line.status = 'cancelled';
      order.status = 'cancelled';
      return order.id;
    }
    case 'orderLine.cancel': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.kind !== 'series', 'Stock production has no order lines');
      check(order.status === 'draft' || order.status === 'production' || order.status === 'ready', 'Order cannot be edited');
      const line = orderLineOf(order, command.lineId);
      check(line.status === 'draft' || line.status === 'production' || line.status === 'ready', 'Delivered work cannot be cancelled');
      check(shippedForLine(state, order, line) === 0, 'Shipped line cannot be cancelled');
      check(!lineRoute(order, line.id).some(task =>
        task.executorKind === 'supplier' && task.status === 'completed'
      ), 'Accepted outsourced work cannot be cancelled');
      for (const row of lineMaterials(order, line.id).filter(row => row.issuedQty > 0)) {
        find(state.items, row.itemId, 'Item');
        movement(state, {
          itemId: row.itemId, direction: 'in', qty: quantity(row.issuedQty), unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: 'Bekor qilingan buyurtma materiali qaytarildi',
        });
      }
      const ids = new Set(lineMaterials(order, line.id).map(row => row.id));
      const taskIds = new Set(lineRoute(order, line.id).map(row => row.id));
      order.materials = order.materials.filter(row => !ids.has(row.id));
      order.route = order.route.filter(row => !taskIds.has(row.id));
      line.status = 'cancelled';
      syncOrder(order);
      syncIdentity(order);
      estimatedCost(state, order);
      return line.id;
    }
    case 'customer.pay':
      customerPayment(state, command.customerId, command.amount, command.account);
      return command.customerId;
    case 'work.accept': {
      const { task } = workContext(state, command, actor);
      check(task.status === 'assigned', 'Task is not awaiting acceptance');
      task.status = 'accepted';
      return task.id;
    }
    case 'work.start': {
      const { task } = workContext(state, command, actor);
      check(task.status === 'accepted', 'Task must be accepted before start');
      task.status = 'in_progress';
      return task.id;
    }
    case 'work.submit': {
      const { order, task, operation, employee } = workContext(state, command, actor);
      check(task.status === 'in_progress', 'Task must be started before submission');
      const qty = quantity(command.qty);
      check(!exceeds(qty, task.planned - task.completed), 'Report exceeds remaining quantity');
      check(!state.reports.some(row => row.orderId === order.id && row.taskId === task.id
        && row.employeeId === employee.id && row.status === 'submitted'), 'Report already submitted');
      const autoAccept = operation.autoAccept;
      const report: WorkReport = {
        id: uuid(), orderId: order.id, taskId: task.id, employeeId: employee.id, qty,
        status: autoAccept ? 'accepted' : 'submitted', note: command.note, createdAt: now(),
      };
      state.reports.push(report);
      if (autoAccept) {
        task.completed = Math.min(task.planned, task.completed + qty);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
      } else {
        task.status = 'submitted';
      }
      const amount = round(task.rate * (autoAccept ? task.completed : task.completed + qty));
      const payroll = state.payroll.find(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === employee.id);
      if (payroll) {
        // A row that already pays accepted work keeps its total until the owner reviews the new result.
        if (autoAccept || payroll.status !== 'accepted') {
          payroll.reportId = report.id;
          payroll.amount = amount;
          payroll.status = autoAccept ? 'accepted' : 'pending';
        }
      } else {
        state.payroll.push({
          id: uuid(), employeeId: employee.id, reportId: report.id, orderId: order.id,
          taskId: task.id, amount, status: autoAccept ? 'accepted' : 'pending', createdAt: now(),
        });
      }
      if (autoAccept) ready(state, order);
      return report.id;
    }
    case 'work.review': {
      check(typeof command.accept === 'boolean', 'Invalid review decision');
      check(!command.accept || (command.defectQty === undefined && command.reason === undefined && command.note === undefined), 'Review must be plain');
      const note = command.note === undefined ? '' : command.note.trim();
      if (!command.accept) {
        check(command.reason !== undefined && defectReasons.includes(command.reason), 'Defect reason is required');
        if (command.reason === 'other') check(note.length > 0 && note.length <= 500, 'Defect note is required');
        check(note.length <= 500, 'Defect note is too long');
      }
      const report = find(state.reports, command.reportId, 'Report');
      check(report.status === 'submitted', 'Report already reviewed');
      const order = find(state.orders, report.orderId, 'Order');
      const task = find(order.route, report.taskId, 'Task');
      const operation = find(state.operations, task.operationId, 'Operation');
      const employee = find(state.employees, report.employeeId, 'Employee');
      check(report.employeeId === task.employeeId, 'Report employee is not assigned');
      check(order.status === 'production' && order.materials.every(row => isIssued(row)), 'Materials must be issued before review');
      check(task.status === 'submitted', 'Task is not awaiting review');
      const payroll = state.payroll.find(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === task.employeeId);
      if (command.accept) {
        check(employee.active, 'Employee is inactive');
        check(operation.employeeIds.includes(employee.id), 'Worker is not authorized for this operation');
        const stages = lineRoute(order, task.lineId);
        check(stages.slice(0, stages.indexOf(task)).every(row => !exceeds(row.planned, row.completed)), 'Previous route stage is incomplete');
        check(!exceeds(report.qty, task.planned - task.completed), 'Report exceeds remaining quantity');
        report.status = 'accepted';
        task.completed = Math.min(task.planned, task.completed + report.qty);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
        const amount = round(task.rate * task.completed);
        if (payroll) {
          payroll.reportId = report.id;
          payroll.amount = amount;
          payroll.status = 'accepted';
        } else {
          state.payroll.push({
            id: uuid(), employeeId: task.employeeId, reportId: report.id, orderId: order.id,
            taskId: task.id, amount, status: 'accepted', createdAt: now(),
          });
        }
        ready(state, order);
        return report.id;
      }
      const rawDefect = command.defectQty === undefined ? report.qty : command.defectQty;
      check(typeof rawDefect === 'number' && Number.isFinite(rawDefect), 'Defect quantity is invalid');
      const defect = round(rawDefect);
      check(defect > 0, 'Nothing to reject');
      check(!exceeds(defect, report.qty), 'Defect quantity exceeds report');
      const good = round(report.qty - defect);
      state.defects.push({
        id: uuid(), reportId: report.id, orderId: order.id, lineId: task.lineId, taskId: task.id,
        employeeId: report.employeeId, operationId: task.operationId,
        qty: defect, reason: command.reason!, note, materials: defectMaterials(state, task, defect), createdAt: now(),
      });
      if (good > 0) {
        check(employee.active, 'Employee is inactive');
        check(operation.employeeIds.includes(employee.id), 'Worker is not authorized for this operation');
        const stages = lineRoute(order, task.lineId);
        check(stages.slice(0, stages.indexOf(task)).every(row => !exceeds(row.planned, row.completed)), 'Previous route stage is incomplete');
        check(!exceeds(good, task.planned - task.completed), 'Report exceeds remaining quantity');
        report.qty = good;
        report.status = 'accepted';
        task.completed = Math.min(task.planned, task.completed + good);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
        const amount = round(task.rate * task.completed);
        if (payroll) {
          payroll.reportId = report.id;
          payroll.amount = amount;
          payroll.status = 'accepted';
        } else {
          state.payroll.push({
            id: uuid(), employeeId: task.employeeId, reportId: report.id, orderId: order.id,
            taskId: task.id, amount, status: 'accepted', createdAt: now(),
          });
        }
        ready(state, order);
      } else {
        report.status = 'rejected';
        task.status = 'in_progress';
        if (payroll) {
          payroll.amount = round(task.rate * task.completed);
          if (payroll.status !== 'accepted') payroll.status = 'rejected';
        }
      }
      return report.id;
    }
    case 'outsource.accept': {
      const order = state.orders.find(row => row.route.some(task => task.id === command.taskId));
      check(order, 'Order not found');
      check(order.status === 'production', 'Order is not in production');
      const task = find(order.route, command.taskId, 'Task');
      const line = orderLineOf(order, task.lineId);
      check(line.status === 'production', 'Order line is not in production');
      check(task.executorKind === 'supplier' && task.supplierId !== null, 'Not an outsourced task');
      check(task.status === 'assigned' && task.completed === 0, 'Outsourced task is already accepted');
      check(supplierStagePriced(task), 'Supplier amount is required before acceptance');
      task.completed = task.planned;
      task.status = 'completed';
      ready(state, order);
      return task.id;
    }
    case 'purchase.create': {
      find(state.suppliers, command.supplierId, 'Supplier');
      check(command.lines.length > 0, 'Purchase requires lines');
      unique(command.lines.map(row => row.itemId), 'purchase item');
      const lines = command.lines.map(line => {
        const item = find(state.items, line.itemId, 'Item');
        check(item.customerId === null, 'Customer materials cannot be purchased');
        const qty = quantity(line.qty);
        const price = money(line.price);
        round(qty * price);
        return {
          id: uuid(), itemId: item.id, qty, price, received: 0,
          previousPurchasePrice: 0, newPurchasePrice: 0, previousAverageCost: 0, newAverageCost: 0,
        };
      });
      const row = {
        id: uuid(), number: `PUR-${String(state.purchases.length + 1).padStart(4, '0')}`,
        supplierId: command.supplierId, lines, createdAt: now(),
      };
      state.purchases.push(row);
      return row.id;
    }
    case 'purchase.receive': {
      const purchase = find(state.purchases, command.purchaseId, 'Purchase');
      find(state.suppliers, purchase.supplierId, 'Supplier');
      check(command.lines.length > 0, 'Receipt requires lines');
      unique(command.lines.map(row => row.lineId), 'receipt line');
      const receipts = command.lines.map(receipt => {
        const line = find(purchase.lines, receipt.lineId, 'Purchase line');
        const item = find(state.items, line.itemId, 'Item');
        check(item.customerId === null, 'Customer materials cannot be purchased');
        const qty = quantity(receipt.qty);
        check(!exceeds(qty, line.qty - line.received), 'Receipt exceeds remaining quantity');
        const before = stockQty(state, item.id);
        check(!exceeds(0, before), 'Stock cannot be negative');
        const after = before + qty;
        check(Number.isFinite(after), 'Stock quantity is too large');
        const cost = round((before * item.cost + qty * line.price) / after);
        round(qty * line.price);
        return { line, item, qty, cost };
      });
      for (const receipt of receipts) {
        const before = stockQty(state, receipt.item.id);
        const after = before + receipt.qty;
        const laborCost = Math.min(receipt.cost, round((before * receipt.item.laborCost) / after));
        receipt.line.previousPurchasePrice = receipt.item.lastPurchasePrice;
        receipt.line.newPurchasePrice = receipt.line.price;
        receipt.line.previousAverageCost = receipt.item.cost;
        receipt.line.newAverageCost = receipt.cost;
        receipt.item.cost = receipt.cost;
        receipt.item.laborCost = laborCost;
        receipt.item.materialCost = round(receipt.cost - laborCost);
        receipt.item.lastPurchasePrice = receipt.line.price;
        receipt.line.received = Math.min(receipt.line.qty, receipt.line.received + receipt.qty);
        movement(state, {
          itemId: receipt.item.id, direction: 'in', qty: receipt.qty, unitCost: receipt.line.price,
          source: 'purchase', sourceId: purchase.id, note: '',
        });
      }
      return purchase.id;
    }
    case 'supplier.pay': {
      if (command.orderId !== undefined) {
        const order = find(state.orders, command.orderId, 'Order');
        check(order.status !== 'cancelled', 'Cancelled order cannot be paid');
        check(order.route.some(task => task.executorKind === 'supplier'
          && task.supplierId === command.supplierId), 'Supplier is not assigned to this order');
      }
      payment(state, 'supplier', command.supplierId, command.amount, command.account, {
        allowPrepay: command.allowPrepay ?? false,
        note: command.note ?? '',
        category: command.category ?? 'supplier',
      });
      return command.supplierId;
    }
    case 'payroll.pay':
      payment(state, 'payroll', command.employeeId, command.amount, command.account);
      return command.employeeId;
    case 'salary.plan.set': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      const amount = money(command.amount);
      check(/^\d{4}-\d{2}$/.test(command.fromMonth) && !Number.isNaN(Date.parse(`${command.fromMonth}-01T00:00:00Z`)), 'Invalid salary plan month');
      const existing = state.salaryPlans.find(row => row.employeeId === employee.id && row.fromMonth === command.fromMonth);
      if (existing) Object.assign(existing, { amount });
      else state.salaryPlans.push({ id: uuid(), employeeId: employee.id, amount, fromMonth: command.fromMonth, createdAt: now() });
      return employee.id;
    }
    case 'salary.pay': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      check(command.kind === 'payroll' || command.kind === 'advance', 'Invalid salary payment kind');
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      payment(state, 'payroll', employee.id, command.amount, command.account,
        { kind: command.kind, note, allowPrepay: command.allowPrepay });
      return employee.id;
    }
    case 'expense.plan.set': {
      const title = command.title.trim();
      check(title.length > 0 && title.length <= 200, 'Expense title required');
      const amount = money(command.amount);
      check(/^\d{4}-\d{2}$/.test(command.fromMonth) && !Number.isNaN(Date.parse(`${command.fromMonth}-01T00:00:00Z`)), 'Invalid expense plan month');
      check(Number.isInteger(command.dueDay) && command.dueDay >= 1 && command.dueDay <= 31, 'Invalid expense due day');
      if (command.supplierId !== null) find(state.suppliers, command.supplierId, 'Supplier');
      const planId = command.planId ?? uuid();
      const existing = state.expensePlans.find(row => row.planId === planId && row.fromMonth === command.fromMonth);
      if (existing) {
        existing.title = title;
        existing.amount = amount;
        existing.dueDay = command.dueDay;
        existing.supplierId = command.supplierId;
      } else {
        state.expensePlans.push({ id: uuid(), planId, title, amount, fromMonth: command.fromMonth, dueDay: command.dueDay, supplierId: command.supplierId, createdAt: now() });
      }
      return planId;
    }
    case 'expense.pay': {
      check(state.expensePlans.some(row => row.planId === command.planId), 'Expense plan not found');
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      const value = money(command.amount, true);
      account(command.account);
      check(command.allowPrepay || value <= expenseLedger(state, command.planId).owed, 'Payment exceeds payable');
      postCash(state, {
        direction: 'out', amount: value, account: command.account, toAccount: null, source: 'expense',
        sourceId: command.planId, customerId: null, category: 'expense', note, reversalOf: null,
      });
      return command.planId;
    }
    case 'loan.set': {
      const title = command.title.trim();
      check(title.length > 0 && title.length <= 200, 'Loan title required');
      check(command.kind === 'loan' || command.kind === 'investment', 'Invalid loan kind');
      const amount = money(command.amount);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      const loanId = command.loanId ?? uuid();
      const existing = state.loans.find(row => row.id === loanId);
      if (existing) {
        existing.title = title;
        existing.kind = command.kind;
        existing.amount = amount;
        existing.note = note;
      } else {
        state.loans.push({ id: loanId, title, kind: command.kind, amount, note, createdAt: now() });
      }
      return loanId;
    }
    case 'loan.draw': {
      find(state.loans, command.loanId, 'Loan');
      const value = money(command.amount, true);
      account(command.account);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      check(value <= loanLedger(state, command.loanId).available, 'Amount exceeds loan balance');
      postCash(state, { direction: 'in', amount: value, account: command.account, toAccount: null, source: 'loan', sourceId: command.loanId, customerId: null, category: 'loan-draw', note, reversalOf: null });
      return command.loanId;
    }
    case 'loan.repay': {
      find(state.loans, command.loanId, 'Loan');
      const value = money(command.amount, true);
      account(command.account);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      check(value <= loanLedger(state, command.loanId).owed, 'Amount exceeds loan debt');
      postCash(state, { direction: 'out', amount: value, account: command.account, toAccount: null, source: 'loan', sourceId: command.loanId, customerId: null, category: 'loan-repay', note, reversalOf: null });
      return command.loanId;
    }
    case 'routeTemplate.create': {
      const row = { id: uuid(), ...routeTemplateValues(state, command), active: true };
      state.routeTemplates.push(row);
      return row.id;
    }
    case 'routeTemplate.update': {
      const row = find(state.routeTemplates, command.templateId, 'Route template');
      check(typeof command.active === 'boolean', 'Invalid active flag');
      const values = routeTemplateValues(state, command, row.id);
      row.name = values.name;
      row.kind = values.kind;
      row.stages = values.stages;
      row.active = command.active;
      return row.id;
    }
    case 'salary.deduct': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      const customer = state.customers.find(row => row.employeeId === employee.id);
      check(customer, 'Employee has no customer account');
      check(command.amount > 0, 'Amount must be positive');
      money(command.amount);
      check(command.note.length <= 200, 'Note is too long');
      check(command.amount <= customerLedger(state, customer.id).debt + 0.004, 'Amount exceeds customer debt');
      check(command.amount <= salaryLedger(state, employee.id).owed + 0.004, 'Amount exceeds salary debt');
      const row: WorkerDeduction = {
        id: uuid(), employeeId: employee.id, customerId: customer.id, amount: command.amount,
        direction: 'deduct', note: command.note, reversalOf: null, createdAt: now(),
      };
      state.workerDeductions.push(row);
      return row.id;
    }
    case 'salary.deduct.reverse': {
      const row = state.workerDeductions.find(entry => entry.id === command.deductionId && entry.direction === 'deduct');
      check(row, 'Deduction not found');
      check(!state.workerDeductions.some(entry => entry.reversalOf === row.id), 'Deduction already reversed');
      const refund: WorkerDeduction = {
        id: uuid(), employeeId: row.employeeId, customerId: row.customerId, amount: row.amount,
        direction: 'refund', note: '', reversalOf: row.id, createdAt: now(),
      };
      state.workerDeductions.push(refund);
      return refund.id;
    }
    case 'inventory.count': {
      const item = find(state.items, command.itemId, 'Item');
      if (item.customerId !== null) find(state.customers, item.customerId, 'Customer');
      const qty = quantity(command.qty, true);
      check(!exceeds(reservedQty(state, item.id), qty), 'Count cannot be below reserved stock');
      const delta = qty - stockQty(state, item.id);
      if (delta !== 0) movement(state, {
        itemId: item.id, direction: delta > 0 ? 'in' : 'out', qty: Math.abs(delta),
        unitCost: item.customerId === null ? item.cost : 0, source: 'inventory', sourceId: uuid(), note: command.note,
      });
      return item.id;
    }
    case 'cash.post': {
      const row = postCash(state, {
        direction: command.direction, amount: money(command.amount, true), account: command.account,
        toAccount: command.toAccount, source: command.direction === 'transfer' ? 'transfer' : 'manual',
        sourceId: null, customerId: null, category: command.category, note: command.note, reversalOf: null,
      });
      return row.id;
    }
    case 'cash.reverse': {
      const original = find(state.cash, command.entryId, 'Cash entry');
      check(original.reversalOf === null, 'Cannot reverse a reversal');
      check(!state.cash.some(row => row.reversalOf === original.id), 'Cash entry already reversed');
      if (original.source === 'sale' && original.customerId) find(state.customers, original.customerId, 'Customer');
      if (original.source === 'supplier') find(state.suppliers, original.sourceId ?? '', 'Supplier');
      if (original.source === 'payroll') find(state.employees, original.sourceId ?? '', 'Employee');
      if (original.source === 'expense') check(state.expensePlans.some(row => row.planId === original.sourceId), 'Expense plan not found');
      if (original.source === 'loan') find(state.loans, original.sourceId ?? '', 'Loan');
      postCash(state, {
        direction: original.direction === 'transfer' ? 'transfer' : original.direction === 'in' ? 'out' : 'in',
        amount: original.amount, account: original.direction === 'transfer' ? account(original.toAccount!) : original.account,
        toAccount: original.direction === 'transfer' ? original.account : null,
        source: original.source, sourceId: original.sourceId, customerId: original.customerId,
        category: original.category, note: command.note, reversalOf: original.id,
      });
      if (original.source === 'supplier') check(supplierDebt(state, original.sourceId!) >= 0, 'Negative supplier payable');
      if (original.source === 'payroll') check(payrollDebt(state, original.sourceId!) >= 0, 'Negative payroll payable');
      return original.id;
    }
    case 'shipment.create': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.kind !== 'series', 'Stock production is not shipped to a customer');
      find(state.customers, order.customerId, 'Customer');
      check(order.status === 'production' || order.status === 'ready' || order.status === 'shipped', 'Order is not ready to ship');
      const requested = shipmentRequest(order, command);
      for (const entry of requested) {
        const line = orderLineOf(order, entry.lineId);
        check(line.status === 'ready' || line.status === 'shipped', 'Order line is not ready to ship');
        check(lineMaterials(order, line.id).every(row => isIssued(row))
          && lineRoute(order, line.id).every(row => !exceeds(row.planned, row.completed)), 'Order production is incomplete');
        check(!exceeds(entry.qty, line.qty - shippedForLine(state, order, line)), 'Shipment exceeds remaining quantity');
      }
      check(typeof command.allowDebt === 'boolean', 'Invalid debt approval');
      check(command.allowDebt || orderPaid(state, order.id) >= totalPrice(order), 'Order has unpaid debt');
      const row: Shipment = {
        id: uuid(), orderId: order.id, customerId: order.customerId, kind: 'order',
        lines: requested.map(entry => {
          const line = orderLineOf(order, entry.lineId);
          return orderShipmentLine(state, order, line, shippedForLine(state, order, line), entry.qty);
        }),
        address: command.address,
        dueDate: command.dueDate, status: 'shipped', createdAt: now(), deliveredAt: null, reversalOf: null,
      };
      state.shipments.push(row);
      for (const entry of requested) orderLineOf(order, entry.lineId).status = 'shipped';
      syncOrder(order);
      return row.id;
    }
    case 'shipment.createStock': {
      const customer = find(state.customers, command.customerId, 'Customer');
      check(customer.kind === 'shop', 'Stock sales require a shop');
      check(Array.isArray(command.lines) && command.lines.length > 0, 'Shipment requires lines');
      unique(command.lines.map(row => row.itemId), 'shipment item');
      const requested = new Map<string, number>();
      const lines = command.lines.map(line => {
        const item = find(state.items, line.itemId, 'Item');
        check(item.customerId === null, 'Customer materials cannot be sold from stock');
        check(item.kind === 'finished', 'Only finished goods can be sold from stock');
        const qty = quantity(line.qty);
        const total = (requested.get(item.id) ?? 0) + qty;
        requested.set(item.id, total);
        check(!exceeds(total, stockQty(state, item.id) - reservedQty(state, item.id)), 'Insufficient stock');
        return stockShipmentLine(item, qty);
      });
      check(typeof command.allowDebt === 'boolean', 'Invalid debt approval');
      const total = round(lines.reduce((sum, line) => sum + line.qty * line.salePrice, 0));
      check(command.allowDebt || !exceeds(total, customerAdvance(state, customer.id)), 'Unpaid stock shipment');
      const row: Shipment = {
        id: uuid(), orderId: null, customerId: customer.id, kind: 'stock', lines,
        address: customer.address, dueDate: command.dueDate, status: 'shipped',
        createdAt: now(), deliveredAt: null, reversalOf: null,
      };
      for (const line of lines) movement(state, {
        itemId: line.itemId!, direction: 'out', qty: line.qty, unitCost: line.unitCost,
        source: 'sale', sourceId: row.id, note: '',
      });
      state.shipments.push(row);
      return row.id;
    }
    case 'shipment.reverse': {
      const shipment = find(state.shipments, command.shipmentId, 'Shipment');
      check(shipment.status !== 'cancelled', 'Shipment already reversed');
      check(shipment.kind === 'stock', 'Only stock sales can be reversed');
      for (const line of shipment.lines) movement(state, {
        itemId: line.itemId!, direction: 'in', qty: line.qty, unitCost: line.unitCost,
        source: 'sale', sourceId: shipment.id, note: 'Yuborish stornosi bo‘yicha qaytarish',
      });
      shipment.status = 'cancelled';
      return shipment.id;
    }
    case 'shipment.deliver': {
      const shipment = find(state.shipments, command.shipmentId, 'Shipment');
      check(shipment.status === 'shipped', 'Shipment already delivered');
      if (shipment.orderId) {
        const order = find(state.orders, shipment.orderId, 'Order');
        check(order.status === 'production' || order.status === 'ready' || order.status === 'shipped', 'Order is not shipped');
        shipment.status = 'delivered';
        shipment.deliveredAt = now();
        for (const line of order.lines) {
          if (line.status === 'shipped' && !exceeds(line.qty, deliveredForLine(state, order, line))) line.status = 'delivered';
        }
        syncOrder(order);
      } else {
        shipment.status = 'delivered';
        shipment.deliveredAt = now();
      }
      return shipment.id;
    }
    case 'ticket.create': {
      const body = ticketText(command.text);
      const context = normalizeTicketContext(command.context);
      const at = now();
      const role = actor.role === 'admin' ? 'admin' : 'worker';
      const row: SupportTicket = {
        id: uuid(), authorId: actor.id, authorName: actor.name, authorRole: role,
        status: 'open', createdAt: at, updatedAt: at, closedAt: null, closedByName: null,
        messages: [{ id: uuid(), authorId: actor.id, authorName: actor.name, authorRole: role, at, text: body, context }],
      };
      state.tickets.push(row);
      return row.id;
    }
    case 'ticket.reply': {
      const row = state.tickets.find(ticket => ticket.id === command.ticketId
        && (actor.role === 'admin' || ticket.authorId === actor.id));
      check(row, 'Ticket not found');
      const body = ticketText(command.text);
      check(row.messages.length < 200, 'Ticket is full');
      const at = now();
      row.messages.push({
        id: uuid(), authorId: actor.id, authorName: actor.name,
        authorRole: actor.role === 'admin' ? 'admin' : 'worker', at, text: body, context: null,
      });
      row.status = 'open';
      row.closedAt = null;
      row.closedByName = null;
      row.updatedAt = at;
      return row.id;
    }
    case 'ticket.close': {
      check(actor.role === 'admin', 'Administrator action required');
      const row = state.tickets.find(ticket => ticket.id === command.ticketId);
      check(row, 'Ticket not found');
      if (row.status === 'open') {
        row.status = 'closed';
        row.closedAt = now();
        row.closedByName = actor.name;
      }
      return row.id;
    }
    default:
      throw new Error('Unknown command');
  }
}

function authorize(state: State, actor: Actor, command: Command): void {
  if (actor.role === 'admin') return;
  if (actor.role === 'display') throw new Error('Ustaxona ekrani faqat kanbanni ko‘radi va amallarni bajara olmaydi.');
  if (WORKER_BASE.has(command.type)) return; // проверка «своего» этапа — в обработчиках work.*
  const perms = actor.permissions ?? [];
  const orderScoped = command.type === 'order.update' || command.type === 'orderLine.cancel'
    || command.type === 'order.cancel' || command.type === 'order.launch';
  if (orderScoped) {
    const orderId = (command as { orderId?: string }).orderId;
    const order = state.orders.find(o => o.id === orderId);
    const customer = order ? state.customers.find(c => c.id === order.customerId) : undefined;
    if (!canTouchOrder(actor, customer)) throw new Error('Faqat o‘z mijozlaringiz buyurtmalarini boshqarishingiz mumkin.');
    const extra = requiredPermission(command.type);
    if (extra && !perms.includes(extra)) throw new Error('Administrator action required');
    return;
  }
  const req = requiredPermission(command.type);
  if (!req || !perms.includes(req)) throw new Error('Administrator action required');
}

export function applyCommand(state: State, envelope: Envelope, actor: Actor): State {
  text(envelope.requestId, 'Request ID');
  check(actor.role === 'admin' || actor.role === 'worker', 'Invalid actor role');
  check(actor.companyId === state.companyId, 'Actor belongs to another company');
  text(actor.id, 'Actor ID');
  authorize(state, actor, envelope.command);
  // A retry keeps its original revision; acknowledge it before testing for a conflict.
  if (state.audit.some(row => row.id === envelope.requestId)) return state;
  check(Number.isSafeInteger(envelope.expectedRevision) && envelope.expectedRevision === state.revision, 'Revision conflict');
  const next = structuredClone(state);
  const entityId = mutate(next, envelope.command, actor);
  for (const item of next.items) {
    quantity(stockQty(next, item.id), true);
    round(stockQty(next, item.id) * item.cost);
    check(item.cost === round(item.materialCost + item.laborCost), 'Item cost components do not add up');
    check(item.lastPurchasePrice >= 0, 'Invalid purchase price history');
  }
  round(cashBalance(next, 'cash') + cashBalance(next, 'bank'));
  for (const employee of next.employees) round(next.payroll.filter(row => row.employeeId === employee.id).reduce((total, row) => total + row.amount, 0));
  for (const supplier of next.suppliers) {
    const ids = new Set(next.purchases.filter(row => row.supplierId === supplier.id).map(row => row.id));
    round(next.movements.filter(row => row.source === 'purchase' && ids.has(row.sourceId)).reduce((total, row) => total + round(row.qty * row.unitCost), 0));
  }
  for (const order of next.orders) { estimatedCost(next, order); round(actualCost(next, order) + order.overhead); }
  for (const purchase of next.purchases) round(purchase.lines.reduce((total, line) => total + round(line.qty * line.price), 0));
  check(Number.isSafeInteger(state.revision + 1), 'Revision is too large');
  next.revision = state.revision + 1;
  next.audit.push({
    id: envelope.requestId, actorId: actor.id, actorName: actor.name,
    action: envelope.command.type, entityId, createdAt: now(),
  });
  return next;
}
