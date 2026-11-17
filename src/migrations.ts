import type {
  CashEntry, Customer, DefectRow, Employee, Item, Machine, MaterialLine, Operation, Order, OrderLine, PayrollEntry, Purchase, RouteTemplate, Shipment, ShipmentLine, State, StockMovement, SupportTicket, Warehouse, WorkReport,
} from './types';
import { MAIN_WAREHOUSE_ID, mainWarehouse } from './warehouse-default';

export const DEMO_COMPANY_ID = '00000000-0000-4000-8000-0000000000c1';

const collections = [
  'customers', 'suppliers', 'employees', 'operations', 'items', 'orders', 'purchases',
  'movements', 'cash', 'reports', 'payroll', 'shipments', 'audit',
] as const;

export function migrateState(value: unknown): State {
  if (!value || typeof value !== 'object') throw new Error('Ma’lumotlar formati noto‘g‘ri');
  const source = value as Record<string, unknown>;
  if (![1, 2, 3, 4].includes(Number(source.version))
    || !Number.isSafeInteger(source.revision)
    || collections.some(key => !Array.isArray(source[key]))) {
    throw new Error('Ma’lumotlar formati noto‘g‘ri');
  }
  const employees = source.employees as Employee[];
  const activeEmployees = employees.filter(employee => employee.active).map(employee => employee.id);
  const machines = Array.isArray(source.machines) ? source.machines as Machine[] : [];
  const operations = (source.operations as (Partial<Operation> & { rate?: number })[]).map(operation => ({
    id: operation.id!,
    name: operation.name!,
    unit: operation.unit ?? 'piece',
    salePrice: operation.salePrice ?? operation.rate ?? 0,
    workerRate: operation.workerRate ?? operation.rate ?? 0,
    standardMinutes: operation.standardMinutes ?? 0,
    machineId: operation.machineId ?? null,
    employeeIds: operation.employeeIds ?? activeEmployees,
    active: operation.active ?? true,
    autoAccept: operation.autoAccept ?? true,
    norms: Array.isArray(operation.norms) ? operation.norms : [],
  }));
  const reports = source.reports as WorkReport[];
  const customers = (source.customers as Customer[]).map(customer => ({
    ...customer,
    kind: customer.kind === 'shop' ? 'shop' as const : customer.kind === 'service' ? 'service' as const : 'customer' as const,
    employeeId: customer.employeeId ?? null,
    sellerId: customer.sellerId ?? null,
  }));
  const orders = (source.orders as Order[]).map(order => {
    const route = order.route.map(task => ({
      ...task,
      executorKind: task.executorKind ?? 'employee',
      employeeId: task.employeeId ?? null,
      supplierId: task.supplierId ?? null,
      status: task.status ?? (task.completed >= task.planned ? 'completed'
        : reports.some(row => row.taskId === task.id && row.status === 'submitted') ? 'submitted' : 'assigned'),
    }));
    const lines: OrderLine[] = Array.isArray(order.lines) && order.lines.length > 0
      ? order.lines.map(line => ({ ...line, status: line.status ?? order.status ?? 'draft' }))
      : [{
        id: crypto.randomUUID(),
        kind: order.kind === 'service' ? 'service' as const : 'product' as const,
        title: order.title ?? '', qty: order.qty ?? 0, total: order.price ?? 0,
        status: order.status ?? 'draft',
      }];
    const first = lines[0].id;
    return {
      ...order,
      outputItemId: order.outputItemId ?? null,
      warehouseId: order.warehouseId ?? MAIN_WAREHOUSE_ID,
      recipeVersionId: order.recipeVersionId ?? null,
      substitutions: order.substitutions ?? {},
      markup: order.markup ?? 0,
      lines,
      materials: (order.materials ?? []).map(row => {
        const legacy = row as MaterialLine & { issued?: boolean };
        const { issued: legacyIssued, ...rest } = legacy;
        return {
          ...rest,
          lineId: row.lineId ?? first,
          issuedQty: typeof legacy.issuedQty === 'number' ? legacy.issuedQty : legacyIssued ? row.qty : 0,
        };
      }),
      route: route.map(task => ({ ...task, lineId: task.lineId ?? first })),
    };
  });
  const payroll = (source.payroll as PayrollEntry[]).map(entry => ({
    ...entry,
    taskId: entry.taskId ?? reports.find(row => row.id === entry.reportId)?.taskId ?? '',
    status: entry.status ?? 'accepted',
  }));
  // Version 2 and older had no owner review queue, so their waiting results are accepted once.
  if (Number(source.version) <= 2) acceptReportedWork(orders, reports, payroll);
  for (const order of orders) if (order.lines.length === 1) order.lines[0].status = order.status;
  const purchases = (source.purchases as (Partial<Purchase> & { lines: Partial<Purchase['lines'][number]>[] })[]).map(purchase => ({
    ...purchase,
    warehouseId: purchase.warehouseId ?? MAIN_WAREHOUSE_ID,
    orderId: purchase.orderId ?? null,
    lines: purchase.lines.map(line => ({
      ...line,
      previousPurchasePrice: line.previousPurchasePrice ?? 0,
      newPurchasePrice: line.newPurchasePrice ?? 0,
      previousAverageCost: line.previousAverageCost ?? 0,
      newAverageCost: line.newAverageCost ?? 0,
    })),
  }));
  const shipments = (source.shipments as (Partial<Shipment> & { qty?: number; driver?: string })[]).map((shipment): Shipment => {
    const order = orders.find(row => row.id === shipment.orderId);
    const qty = shipment.qty ?? 0;
    const lines: ShipmentLine[] = Array.isArray(shipment.lines)
      ? shipment.lines.map(line => ({ ...line, itemId: line.itemId ?? null }))
      : qty > 0 && order ? [legacyShipmentLine(shipment.id ?? '', order, qty, payroll)] : [];
    return {
      id: shipment.id!, orderId: shipment.orderId ?? null,
      customerId: shipment.customerId || order?.customerId || '',
      kind: shipment.kind ?? (shipment.orderId ? 'order' : 'stock'), lines,
      address: shipment.address ?? '', dueDate: shipment.dueDate ?? '',
      status: shipment.status === 'delivered' ? 'delivered' : shipment.status === 'cancelled' ? 'cancelled' : 'shipped',
      createdAt: shipment.createdAt ?? '', deliveredAt: shipment.deliveredAt ?? null,
      reversalOf: shipment.reversalOf ?? null,
    };
  });
  const cash = (source.cash as (Omit<CashEntry, 'number'> & { source: string; number?: string | null })[]).map((entry): CashEntry => {
    const withNumber = { ...entry, number: typeof entry.number === 'string' && entry.number.length > 0 ? entry.number : null };
    if ((entry.source as string) === 'order') {
      const order = orders.find(row => row.id === entry.sourceId);
      return { ...withNumber, source: 'sale', customerId: entry.customerId ?? order?.customerId ?? null };
    }
    return { ...withNumber, customerId: entry.customerId ?? null };
  });
  const items = (source.items as (Partial<Item> & { cost?: number })[]).map(item => ({
    ...item,
    kind: item.kind ?? 'material',
    salePrice: item.salePrice ?? 0,
    materialCost: item.materialCost ?? item.cost ?? 0,
    laborCost: item.laborCost ?? 0,
    category: typeof item.category === 'string' && /^\d{2}\.\d{2}$/.test(item.category) ? item.category : null,
    lastPurchasePrice: item.lastPurchasePrice ?? lastPurchasePrice(purchases, item.id ?? ''),
    photo: typeof item.photo === 'string' ? item.photo : '',
  }));
  const warehouses = Array.isArray(source.warehouses) && source.warehouses.length > 0
    ? source.warehouses as Warehouse[] : [mainWarehouse()];
  const movements = (source.movements as StockMovement[]).map(row => ({ ...row, warehouseId: row.warehouseId ?? MAIN_WAREHOUSE_ID }));
  return {
    ...source,
    version: 4,
    companyId: typeof source.companyId === 'string' && source.companyId.length > 0
      ? source.companyId : DEMO_COMPANY_ID,
    customers,
    machines,
    operations,
    items,
    warehouses,
    movements,
    recipes: Array.isArray(source.recipes) ? source.recipes : [],
    orders,
    purchases,
    payroll,
    salaryPlans: Array.isArray(source.salaryPlans) ? source.salaryPlans : [],
    expensePlans: Array.isArray(source.expensePlans) ? source.expensePlans : [],
    loans: Array.isArray(source.loans) ? source.loans : [],
    routeTemplates: Array.isArray(source.routeTemplates) ? source.routeTemplates as RouteTemplate[] : [],
    workerDeductions: Array.isArray(source.workerDeductions) ? source.workerDeductions : [],
    tickets: Array.isArray(source.tickets) ? source.tickets as SupportTicket[] : [],
    defects: Array.isArray(source.defects) ? source.defects as DefectRow[] : [],
    cash,
    shipments,
  } as State;
}

function acceptReportedWork(orders: Order[], reports: WorkReport[], payroll: PayrollEntry[]): void {
  for (const report of reports) {
    if (report.status !== 'submitted') continue;
    report.status = 'accepted';
    const order = orders.find(row => row.id === report.orderId);
    const task = order?.route.find(row => row.id === report.taskId);
    if (!order || !task) continue;
    if (task.executorKind !== 'employee' || !task.employeeId) continue;
    task.completed = Math.min(task.planned, task.completed + report.qty);
    task.status = task.completed >= task.planned ? 'completed' : 'in_progress';
    const amount = Math.round(task.rate * task.completed * 100) / 100;
    const entry = payroll.find(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === task.employeeId);
    if (entry) {
      entry.reportId = report.id;
      entry.amount = amount;
      entry.status = 'accepted';
    } else {
      payroll.push({
        id: crypto.randomUUID(), employeeId: task.employeeId, reportId: report.id, orderId: order.id,
        taskId: task.id, amount, status: 'accepted', createdAt: report.createdAt,
      });
    }
    if (order.kind !== 'series' && order.materials.every(row => row.issuedQty >= row.qty)
      && order.route.every(row => row.completed >= row.planned)) order.status = 'ready';
  }
}

function legacyShipmentLine(shipmentId: string, order: Order, qty: number, payroll: PayrollEntry[]): ShipmentLine {
  const material = order.materials.reduce((sum, line) => sum + line.issuedQty * line.actualCost, 0);
  const outsourced = order.route.reduce((sum, row) =>
    row.executorKind === 'supplier' && row.status === 'completed' ? sum + row.completed * row.rate : sum, 0);
  const labor = payroll.reduce((sum, row) => row.orderId === order.id && row.status === 'accepted' ? sum + row.amount : sum, 0) + outsourced;
  const cost = material + labor;
  const perUnit = (total: number) => order.qty > 0 ? total / order.qty : 0;
  return {
    id: `${shipmentId}-line`, itemId: null, description: `${order.number} · ${order.title}`, qty,
    salePrice: perUnit(order.price), unitCost: perUnit(cost),
    materialCost: perUnit(material), laborCost: perUnit(labor),
  };
}

function lastPurchasePrice(purchases: Partial<Purchase>[], itemId: string): number {
  let price = 0;
  for (const purchase of purchases) {
    for (const line of purchase.lines ?? []) {
      if (line.itemId === itemId && (line.received ?? 0) > 0) price = line.price ?? 0;
    }
  }
  return price;
}
