import { cashCategoryLabel, unitLabel } from './i18n';
import { activeLines } from './domain';
import { customerBalance, orderBalance } from './receivables';
import { shipmentTotals } from './sales';
import { MAIN_WAREHOUSE_ID } from './warehouse-default';
import type { Actor, CashEntry, OrderLine, Shipment, State } from './types';
import type { CompanyProfile } from './company-profile';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export interface RouteSheetOperation {
  name: string; position: string; qty: number; unit: string; workerName: string; standardMinutes: number;
}

export interface RouteSheetModel {
  number: string; title: string; dueDate: string; customerName: string; drawingUrl: string | null;
  substitutions: { slot: string; itemName: string }[];
  operations: RouteSheetOperation[];
}

export type InvoiceGroup = 'material' | 'work' | 'other' | 'markup';

export interface InvoiceLine {
  group: InvoiceGroup; description: string; position: string | null; qty: number; unit: string; price: number; total: number;
}

export interface InvoicePosition {
  title: string; kind: OrderLine['kind']; qty: number; unitPrice: number; total: number;
}

export interface InvoiceModel {
  number: string; date: string; customer: string; address: string; company: CompanyProfile;
  positions: InvoicePosition[];
  lines: InvoiceLine[]; subtotal: number; markup: number;
  total: number; paid: number; debt: number; vat: number | null;
}

export interface CashReceiptModel {
  kind: 'in' | 'out';
  number: string;
  date: string;
  party: string;
  basis: string;
  account: string;
  amount: number;
  note: string;
  reversed: boolean;
}

export interface PurchaseReceiptLine {
  name: string; unit: string; qty: number; received: number; remaining: number; price: number; total: number;
}

export interface PurchaseReceiptModel {
  number: string; date: string; supplier: string; phone: string;
  warehouse: string; orderNumber: string | null;
  lines: PurchaseReceiptLine[]; receivedTotal: number; total: number;
}

export function routeSheet(state: State, orderId: string): RouteSheetModel {
  const order = state.orders.find(row => row.id === orderId);
  if (!order) throw new Error('Buyurtma topilmadi');
  const customer = state.customers.find(row => row.id === order.customerId);
  const substitutions = Object.entries(order.substitutions)
    .map(([slot, itemId]) => ({ slot, itemName: state.items.find(row => row.id === itemId)?.name ?? slot }))
    .sort((left, right) => left.slot.localeCompare(right.slot));
  const operations = order.route.map(task => {
    const operation = state.operations.find(row => row.id === task.operationId);
    return {
      name: task.name,
      position: order.lines.find(line => line.id === task.lineId)?.title ?? order.title,
      qty: round(task.planned),
      unit: operation ? unitLabel(operation.unit) : 'dona',
      workerName: task.executorKind === 'supplier'
        ? state.suppliers.find(row => row.id === task.supplierId)?.name ?? 'Pudratchi'
        : state.employees.find(row => row.id === task.employeeId)?.name ?? 'Xodim',
      standardMinutes: task.standardMinutes ?? operation?.standardMinutes ?? 0,
    };
  });
  return {
    number: order.number,
    title: order.title,
    dueDate: order.dueDate,
    customerName: customer?.name ?? (order.kind === 'series' ? 'Ombor seriyasi' : 'Mijoz topilmadi'),
    drawingUrl: order.drawingUrl ?? null,
    substitutions,
    operations,
  };
}

function orderInvoice(state: State, order: State['orders'][number], company: CompanyProfile): InvoiceModel {
  const customer = state.customers.find(row => row.id === order.customerId);
  const positions: InvoicePosition[] = [];
  for (const position of activeLines(order)) {
    positions.push({
      title: position.title, kind: position.kind, qty: round(position.qty),
      unitPrice: round(position.qty > 0 ? position.total / position.qty : position.total), total: round(position.total),
    });
  }
  const subtotal = round(positions.reduce((sum, position) => sum + position.total, 0));
  const markup = round(order.markup ?? 0);
  const total = round(subtotal + markup);
  const row = orderBalance(state, order.id);
  return {
    number: order.number,
    date: order.createdAt,
    customer: customer?.name ?? 'Mijoz topilmadi',
    address: customer?.address ?? '',
    company,
    positions,
    lines: [],
    subtotal,
    markup,
    total,
    paid: row?.paid ?? 0,
    debt: row?.outstanding ?? 0,
    vat: null,
  };
}

function shipmentInvoice(state: State, shipment: Shipment, company: CompanyProfile): InvoiceModel {
  const customer = state.customers.find(row => row.id === shipment.customerId);
  const obligations = customerBalance(state, shipment.customerId).obligations;
  const ledger = obligations.find(entry => entry.id === shipment.id) ?? (shipment.orderId ? obligations.find(entry => entry.orderId === shipment.orderId) : undefined);
  if (!ledger) throw new Error('Hujjat topilmadi');
  const lines: InvoiceLine[] = shipment.lines.map(line => ({
    group: 'other',
    description: line.description,
    position: null,
    qty: line.qty,
    unit: state.items.find(row => row.id === line.itemId)?.unit ?? 'dona',
    price: line.salePrice,
    total: round(line.qty * line.salePrice),
  }));
  const total = shipmentTotals(shipment).revenue;
  return {
    number: `OMB-${shipment.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    date: shipment.createdAt,
    customer: customer?.name ?? 'Mijoz topilmadi',
    address: customer?.address ?? '',
    company,
    positions: [],
    lines,
    subtotal: total,
    markup: 0,
    total,
    paid: ledger.paid,
    debt: ledger.outstanding,
    vat: null,
  };
}

export function invoice(state: State, sourceId: string, actor: Actor, company: CompanyProfile): InvoiceModel {
  if (actor.role !== 'admin') throw new Error('Hisob-faktura faqat egasiga ochiq');
  const order = state.orders.find(row => row.id === sourceId);
  if (order) {
    if (order.status === 'cancelled' || order.kind === 'series') throw new Error('Hujjat topilmadi');
    return orderInvoice(state, order, company);
  }
  const shipment = state.shipments.find(row => row.id === sourceId);
  if (!shipment || shipment.status === 'cancelled') throw new Error('Hujjat topilmadi');
  return shipmentInvoice(state, shipment, company);
}

function cashParty(state: State, entry: CashEntry): string {
  switch (entry.source) {
    case 'sale': return state.customers.find(row => row.id === entry.customerId)?.name ?? 'Mijoz / do‘kon';
    case 'supplier': return state.suppliers.find(row => row.id === entry.sourceId)?.name ?? 'Yetkazib beruvchi';
    case 'payroll': return state.employees.find(row => row.id === entry.sourceId)?.name ?? 'Xodim';
    case 'loan': return state.loans.find(row => row.id === entry.sourceId)?.title ?? 'Zaym';
    case 'expense': return state.expensePlans.find(row => row.planId === entry.sourceId)?.title ?? 'Oylik xarajat';
    default: return 'Qo‘lda kiritilgan';
  }
}

export function cashReceipt(state: State, entryId: string): CashReceiptModel {
  const entry = state.cash.find(row => row.id === entryId);
  if (!entry || entry.direction === 'transfer' || !entry.number) throw new Error('Hujjat topilmadi');
  return {
    kind: entry.direction,
    number: entry.number,
    date: entry.createdAt,
    party: cashParty(state, entry),
    basis: cashCategoryLabel(entry.category),
    account: entry.account === 'cash' ? 'Naqd pul' : 'Bank',
    amount: entry.amount,
    note: entry.note,
    reversed: entry.reversalOf !== null,
  };
}

export function purchaseReceipt(state: State, purchaseId: string): PurchaseReceiptModel {
  const purchase = state.purchases.find(row => row.id === purchaseId);
  if (!purchase) throw new Error('Hujjat topilmadi');
  const supplier = state.suppliers.find(row => row.id === purchase.supplierId);
  const warehouse = state.warehouses.find(row => row.id === (purchase.warehouseId || MAIN_WAREHOUSE_ID));
  const lines = purchase.lines.map(line => {
    const item = state.items.find(row => row.id === line.itemId);
    const price = round(line.price);
    const received = round(line.received);
    return {
      name: item?.name ?? 'Material',
      unit: item?.unit ?? 'dona',
      qty: round(line.qty),
      received,
      remaining: round(line.qty - line.received),
      price,
      total: round(line.qty * line.price),
    };
  });
  return {
    number: purchase.number,
    date: purchase.createdAt,
    supplier: supplier?.name ?? 'Yetkazib beruvchi',
    phone: supplier?.phone ?? '',
    warehouse: warehouse?.name ?? 'Asosiy ombor',
    orderNumber: purchase.orderId ? state.orders.find(row => row.id === purchase.orderId)?.number ?? null : null,
    lines,
    receivedTotal: round(lines.reduce((sum, line) => sum + line.received * line.price, 0)),
    total: round(lines.reduce((sum, line) => sum + line.qty * line.price, 0)),
  };
}
