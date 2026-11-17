export type Role = 'admin' | 'worker' | 'display';
export type Account = 'cash' | 'bank';
export type Status = 'draft' | 'production' | 'ready' | 'shipped' | 'delivered' | 'cancelled';
export type TaskStatus = 'assigned' | 'accepted' | 'in_progress' | 'submitted' | 'completed';
export type ExecutorKind = 'employee' | 'supplier';
export type CashSource = 'manual' | 'sale' | 'supplier' | 'payroll' | 'expense' | 'transfer' | 'loan';
export type CustomerKind = 'customer' | 'shop' | 'service';
export interface Actor {
  id: string; name: string; role: Role; companyId: string;
  permissions?: string[];      // пусто/undefined = права по роли (legacy worker)
  workshopIds?: string[];      // пусто = все цеха
  warehouseIds?: string[];     // пусто = все склады
}
export interface Customer { id: string; name: string; phone: string; address: string; kind: CustomerKind; employeeId: string | null; sellerId?: string | null }
export interface Supplier { id: string; name: string; phone: string }
export interface Warehouse { id: string; name: string; active: boolean }
export interface Employee { id: string; name: string; active: boolean; deactivatedAt?: string | null }
export type OperationUnit = 'sheet' | 'meter' | 'squareMeter' | 'piece' | 'hole' | 'minute' | 'hour';
export interface Machine { id: string; name: string; hourlyRevenueTarget: number; active: boolean }
export interface OperationNorm { itemId: string; qtyPerM2: number }
export interface Operation {
  id: string; name: string; unit: OperationUnit; salePrice: number; workerRate: number;
  standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean;
  norms: OperationNorm[];
}
export type ItemKind = 'material' | 'blank' | 'finished';
export interface Item {
  id: string; name: string; unit: string; minQty: number; cost: number; customerId: string | null;
  kind: ItemKind; salePrice: number; lastPurchasePrice: number; materialCost: number; laborCost: number;
  category: string | null; photo?: string;
}
export type OrderLineKind = 'product' | 'service';
export interface OrderLine { id: string; kind: OrderLineKind; title: string; qty: number; total: number; status: Status }
export interface MaterialLine { id: string; lineId: string; itemId: string; qty: number; issuedQty: number; estimatedCost: number; actualCost: number }
export interface RecipeComponent {
  id: string; slot: string; itemId: string | null;
  allowedItemIds: string[]; qtyPerUnit: number;
}
export type RecipeComponentInput = Omit<RecipeComponent, 'id'>;
export interface RecipeVersion { id: string; version: number; components: RecipeComponent[]; createdAt: string }
export interface Recipe { id: string; outputItemId: string; name: string; versions: RecipeVersion[]; active: boolean }
export interface RouteLine { id: string; lineId: string; operationId: string; name: string; executorKind: ExecutorKind; employeeId: string | null; supplierId: string | null; rate: number; supplierCost?: number; salePrice?: number; standardMinutes?: number; planned: number; completed: number; status: TaskStatus }
export interface Order {
  id: string; number: string; kind: 'product' | 'service' | 'series' | 'composite'; customerId: string; title: string;
  outputItemId: string | null; recipeVersionId: string | null; substitutions: Record<string, string>;
  qty: number; price: number; overhead: number; markup?: number; dueDate: string; createdAt: string;
  status: Status; lines: OrderLine[]; materials: MaterialLine[]; route: RouteLine[]; drawingUrl?: string | null;
  warehouseId?: string;
}
export interface SeriesInput {
  outputItemId: string; recipeVersionId: string; qty: number; dueDate: string;
  substitutions: Record<string, string>;
  route: OrderRouteInput[];
}
export interface PurchaseLine {
  id: string; itemId: string; qty: number; price: number; received: number;
  previousPurchasePrice: number; newPurchasePrice: number;
  previousAverageCost: number; newAverageCost: number;
}
export interface Purchase { id: string; number: string; supplierId: string; lines: PurchaseLine[]; createdAt: string; warehouseId?: string; orderId?: string | null }
export interface StockMovement {
  id: string; itemId: string; direction: 'in' | 'out'; qty: number; unitCost: number;
  source: 'purchase' | 'order' | 'inventory' | 'customer' | 'production' | 'sale' | 'transfer'; sourceId: string; note: string; createdAt: string;
  warehouseId?: string;
}
export interface CashEntry {
  id: string; direction: 'in' | 'out' | 'transfer'; amount: number; account: Account;
  toAccount: Account | null; source: CashSource; sourceId: string | null; customerId: string | null;
  category: string; note: string; number: string | null; reversalOf: string | null; createdAt: string;
}
export interface WorkReport { id: string; orderId: string; taskId: string; employeeId: string; qty: number; status: 'submitted' | 'accepted' | 'rejected'; note: string; createdAt: string }
export type DefectReason = 'quality' | 'measurement' | 'drawing' | 'customer' | 'other';
export interface DefectMaterial { itemId: string; qty: number }
export interface DefectRow {
  id: string; reportId: string; orderId: string; lineId: string; taskId: string;
  employeeId: string; operationId: string; qty: number; reason: DefectReason;
  note: string; materials: DefectMaterial[]; createdAt: string;
}
export interface PayrollEntry { id: string; employeeId: string; reportId: string; orderId: string; taskId: string; amount: number; status: 'pending' | 'accepted' | 'rejected'; createdAt: string }
export interface SalaryPlan { id: string; employeeId: string; amount: number; fromMonth: string; createdAt: string }
export interface ExpensePlan {
  id: string;        // версия-строка
  planId: string;    // группирует версии одного расхода
  title: string;
  amount: number;
  fromMonth: string; // 'YYYY-MM'
  dueDay: number;    // 1..31, информационный
  supplierId: string | null;
  createdAt: string;
}
export type LoanKind = 'loan' | 'investment';
export interface LoanRow {
  id: string;
  title: string;
  kind: LoanKind;
  amount: number;
  note: string;
  createdAt: string;
}
export interface RouteTemplateStage {
  operationId: string;
  rate?: number;
  executorKind?: ExecutorKind;
  employeeId?: string | null;
  supplierId?: string | null;
}
export interface RouteTemplate {
  id: string;
  name: string;
  kind: OrderLineKind;
  active: boolean;
  stages: RouteTemplateStage[];
}
export interface WorkerDeduction {
  id: string;
  employeeId: string;
  customerId: string;
  amount: number;
  direction: 'deduct' | 'refund';
  note: string;
  reversalOf: string | null;
  createdAt: string;
}
export interface ShipmentLine {
  id: string; itemId: string | null; description: string;
  qty: number; salePrice: number; unitCost: number; materialCost: number; laborCost: number;
  lineId?: string | null;
}
export interface Shipment {
  id: string; orderId: string | null; customerId: string; kind: 'order' | 'stock';
  lines: ShipmentLine[]; address: string; dueDate: string;
  status: 'shipped' | 'delivered' | 'cancelled';
  createdAt: string; deliveredAt: string | null; reversalOf: string | null;
}
export interface AuditEntry { id: string; actorId: string; actorName: string; action: string; entityId: string; createdAt: string }
export type TicketRole = 'worker' | 'admin';
export type TicketStatus = 'open' | 'closed';
export interface TicketContext {
  page: string;
  revision: number;
  sync: 'online' | 'offline';
  pending: number;
  build: string;
  errors: string[];
}
export interface TicketMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  at: string;
  text: string;
  context: TicketContext | null;
}
export interface SupportTicket {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  messages: TicketMessage[];
}
export interface State {
  version: 4; revision: number; companyId: string; customers: Customer[]; suppliers: Supplier[]; employees: Employee[];
  machines: Machine[]; operations: Operation[]; items: Item[]; recipes: Recipe[]; orders: Order[]; purchases: Purchase[]; movements: StockMovement[];
  warehouses: Warehouse[];
  cash: CashEntry[]; reports: WorkReport[]; defects: DefectRow[]; payroll: PayrollEntry[]; salaryPlans: SalaryPlan[]; expensePlans: ExpensePlan[]; loans: LoanRow[]; routeTemplates: RouteTemplate[]; workerDeductions: WorkerDeduction[]; shipments: Shipment[]; tickets: SupportTicket[]; audit: AuditEntry[];
}
export type OrderMaterialInput = { itemId: string; qty: number };
export type OrderRouteInput = {
  operationId: string;
  executorKind?: ExecutorKind;
  employeeId?: string | null;
  supplierId?: string | null;
  rate: number;
  supplierCost?: number;
  qty?: number;
  taskId?: string;
};
export interface OrderLineInput {
  id?: string; kind: OrderLineKind; title: string; qty: number; unitPrice: number;
  materials: OrderMaterialInput[]; route: OrderRouteInput[];
}
export interface OrderInput {
  kind: Order['kind']; customerId: string; overhead: number; markup?: number; dueDate: string;
  advance: number; account: Account;
  title?: string; qty?: number; price?: number;
  materials?: OrderMaterialInput[]; route?: OrderRouteInput[];
  lines?: OrderLineInput[];
  warehouseId?: string;
}
export type Command =
  | { type: 'customer.create'; name: string; phone: string; address: string; kind: CustomerKind; employeeId?: string | null }
  | { type: 'customer.claim'; customerId: string }
  | { type: 'customer.assign'; customerId: string; sellerId: string | null }
  | { type: 'supplier.create'; name: string; phone: string }
  | { type: 'employee.create'; name: string }
  | { type: 'employee.update'; employeeId: string; name: string; active: boolean; deactivatedAt?: string | null }
  | { type: 'machine.create'; name: string; hourlyRevenueTarget: number }
  | { type: 'machine.update'; machineId: string; name: string; hourlyRevenueTarget: number; active: boolean }
  | { type: 'operation.create'; name: string; unit: OperationUnit; salePrice: number; workerRate: number; standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean; norms?: OperationNorm[] }
  | { type: 'operation.update'; operationId: string; name: string; unit: OperationUnit; salePrice: number; workerRate: number; standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean; norms?: OperationNorm[] }
  | { type: 'item.create'; name: string; unit: string; minQty: number; cost: number; customerId: string | null; kind?: ItemKind; salePrice?: number; category?: string | null; openQty?: number; photo?: string }
  | { type: 'item.update'; itemId: string; name: string; unit: string; minQty: number; salePrice: number; category: string | null; photo?: string }
  | { type: 'recipe.create'; outputItemId: string; name: string; components: RecipeComponentInput[] }
  | { type: 'recipe.version.create'; recipeId: string; components: RecipeComponentInput[] }
  | { type: 'customer.receive'; itemId: string; qty: number; note: string }
  | { type: 'order.create'; input: OrderInput }
  | { type: 'order.update'; orderId: string; title?: string; qty?: number; price?: number; overhead: number; markup?: number; dueDate: string; materials?: OrderMaterialInput[]; route?: OrderRouteInput[]; lines?: OrderLineInput[]; warehouseId?: string }
  | { type: 'series.create'; input: SeriesInput }
  | { type: 'order.launch'; orderId: string }
  | { type: 'order.issue'; orderId: string; lineId?: string }
  | { type: 'order.cancel'; orderId: string }
  | { type: 'orderLine.cancel'; orderId: string; lineId: string }
  | { type: 'customer.pay'; customerId: string; amount: number; account: Account }
  | { type: 'work.accept'; orderId: string; taskId: string }
  | { type: 'work.start'; orderId: string; taskId: string }
  | { type: 'work.submit'; orderId: string; taskId: string; qty: number; note: string }
  | { type: 'work.review'; reportId: string; accept: boolean; defectQty?: number; reason?: DefectReason; note?: string }
  | { type: 'outsource.accept'; taskId: string }
  | { type: 'purchase.create'; supplierId: string; lines: { itemId: string; qty: number; price: number }[]; warehouseId?: string; orderId?: string | null }
  | { type: 'purchase.receive'; purchaseId: string; lines: { lineId: string; qty: number }[] }
  | {
      type: 'supplier.pay';
      supplierId: string;
      orderId?: string;
      amount: number;
      account: Account;
      allowPrepay?: boolean;
      note?: string;
      category?: 'supplier' | 'outsourcing';
    }
  | { type: 'payroll.pay'; employeeId: string; amount: number; account: Account }
  | { type: 'salary.plan.set'; employeeId: string; amount: number; fromMonth: string }
  | { type: 'salary.pay'; employeeId: string; amount: number; account: Account; kind: 'advance' | 'payroll'; note: string; allowPrepay: boolean }
  | { type: 'expense.plan.set'; planId: string | null; title: string; amount: number; fromMonth: string; dueDay: number; supplierId: string | null }
  | { type: 'expense.pay'; planId: string; amount: number; account: Account; note: string; allowPrepay: boolean }
  | { type: 'loan.set'; loanId: string | null; title: string; kind: LoanKind; amount: number; note: string }
  | { type: 'loan.draw'; loanId: string; amount: number; account: Account; note: string }
  | { type: 'loan.repay'; loanId: string; amount: number; account: Account; note: string }
  | { type: 'routeTemplate.create'; name: string; kind: OrderLineKind; stages: RouteTemplateStage[] }
  | { type: 'routeTemplate.update'; templateId: string; name: string; kind: OrderLineKind; stages: RouteTemplateStage[]; active: boolean }
  | { type: 'customer.link'; customerId: string; employeeId: string | null }
  | { type: 'salary.deduct'; employeeId: string; amount: number; note: string }
  | { type: 'salary.deduct.reverse'; deductionId: string }
  | { type: 'inventory.count'; itemId: string; qty: number; note: string; warehouseId?: string }
  | { type: 'warehouse.create'; name: string }
  | { type: 'warehouse.update'; warehouseId: string; name: string; active: boolean }
  | { type: 'warehouse.transfer'; itemId: string; fromId: string; toId: string; qty: number; note: string }
  | { type: 'cash.post'; direction: 'in' | 'out' | 'transfer'; amount: number; account: Account; toAccount: Account | null; category: string; note: string }
  | { type: 'cash.reverse'; entryId: string; note: string }
  | { type: 'shipment.create'; orderId: string; qty?: number; address: string; dueDate: string; allowDebt: boolean; lines?: { lineId: string; qty: number }[] }
  | { type: 'shipment.createStock'; customerId: string; lines: { itemId: string; qty: number }[]; dueDate: string; allowDebt: boolean }
  | { type: 'shipment.reverse'; shipmentId: string }
  | { type: 'shipment.deliver'; shipmentId: string }
  | { type: 'ticket.create'; text: string; context: TicketContext | null }
  | { type: 'ticket.reply'; ticketId: string; text: string }
  | { type: 'ticket.close'; ticketId: string };
export interface Envelope { requestId: string; expectedRevision: number; command: Command }
