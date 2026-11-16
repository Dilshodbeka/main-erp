import { customerLedger } from './receivables';
import { shipmentQty, shipmentTotals } from './sales';
import type { Item, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const roundQty = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;
// Date-only bounds are local calendar days; full timestamps keep their exact instant.
const timeOf = (value: string): number => new Date(value.length === 10 ? `${value}T00:00:00` : value).getTime();
const OPERATING_EXCLUDED = ['Boshlang‘ich qoldiq', 'Egasining mablag‘i', 'Boshqa tushum', 'Начальный остаток', 'Средства владельца', 'Прочее поступление'];

export function withinPeriod(value: string, from: string, to: string): boolean {
  const at = timeOf(value);
  return at >= timeOf(from) && at < timeOf(to);
}

function snapshotAt(state: State, to: string): State {
  const limit = timeOf(to);
  return {
    ...state,
    shipments: state.shipments.filter(row => timeOf(row.createdAt) < limit),
    cash: state.cash.filter(row => timeOf(row.createdAt) < limit),
  };
}

function shipmentRows(state: State, from: string, to: string, customerId?: string) {
  return state.shipments.filter(row => row.status !== 'cancelled'
    && (customerId === undefined || row.customerId === customerId)
    && withinPeriod(row.createdAt, from, to));
}

function cashRows(state: State, from: string, to: string) {
  return state.cash.filter(row => withinPeriod(row.createdAt, from, to));
}

export interface RecipeVariance {
  orderId: string; number: string; plannedMaterial: number; actualMaterial: number; variance: number;
}

function recipeVariance(state: State, from: string, to: string): RecipeVariance[] {
  return state.orders
    .filter(order => order.kind === 'series' && order.status !== 'cancelled'
      && order.materials.length > 0 && withinPeriod(order.createdAt, from, to))
    .map(order => {
      const plannedMaterial = round(order.materials.reduce((sum, line) => sum + line.qty * line.estimatedCost, 0));
      const actualMaterial = round(order.materials.reduce((sum, line) => sum + line.issuedQty * line.actualCost, 0));
      return { orderId: order.id, number: order.number, plannedMaterial, actualMaterial, variance: round(actualMaterial - plannedMaterial) };
    })
    .sort((left, right) => right.variance - left.variance || left.number.localeCompare(right.number));
}

export interface PeriodReport {
  from: string; to: string;
  shipments: number; deliveredQty: number;
  revenue: number; cogs: number; grossProfit: number; materialCost: number; laborCost: number;
  customRevenue: number; seriesRevenue: number;
  cashIn: number; cashOut: number; netCash: number;
  operating: number; profit: number;
  debt: number; advances: number;
  payrollPending: number; payrollAccepted: number; payrollPaid: number;
  recipeVariance: RecipeVariance[];
}

export function periodReport(state: State, from: string, to: string): PeriodReport {
  const shipments = shipmentRows(state, from, to);
  let revenue = 0, cogs = 0, materialCost = 0, laborCost = 0, customRevenue = 0, seriesRevenue = 0, deliveredQty = 0;
  for (const shipment of shipments) {
    const totals = shipmentTotals(shipment);
    revenue += totals.revenue;
    cogs += totals.cost;
    materialCost += totals.materialCost;
    laborCost += totals.laborCost;
    if (shipment.kind === 'order') customRevenue += totals.revenue;
    else seriesRevenue += totals.revenue;
    if (shipment.status === 'delivered') deliveredQty += shipmentQty(shipment);
  }
  const cash = cashRows(state, from, to);
  const cashIn = round(cash.reduce((sum, row) => sum + (row.direction === 'in' && row.source !== 'loan' ? row.amount : 0), 0));
  const cashOut = round(cash.reduce((sum, row) => sum + (row.direction === 'out' && row.source !== 'loan' ? row.amount : 0), 0));
  const operating = round(cash.reduce((sum, row) => {
    if (row.direction === 'transfer') return sum;
    if (row.source === 'expense') return sum + (row.direction === 'out' ? row.amount : -row.amount);
    if (row.source !== 'manual' || OPERATING_EXCLUDED.includes(row.category)) return sum;
    return sum + (row.direction === 'out' ? row.amount : -row.amount);
  }, 0));
  const payroll = state.payroll.filter(row => withinPeriod(row.createdAt, from, to));
  const payrollPending = round(payroll.reduce((sum, row) => sum + (row.status === 'pending' ? row.amount : 0), 0));
  const payrollAccepted = round(payroll.reduce((sum, row) => sum + (row.status === 'accepted' ? row.amount : 0), 0));
  const payrollPaid = round(cash.reduce((sum, row) => row.source === 'payroll'
    ? sum + (row.direction === 'out' ? row.amount : row.direction === 'in' ? -row.amount : 0) : sum, 0));
  const snapshot = snapshotAt(state, to);
  const ledgers = snapshot.customers.map(customer => customerLedger(snapshot, customer.id));
  const debt = round(ledgers.reduce((sum, ledger) => sum + ledger.debt, 0));
  const advances = round(ledgers.reduce((sum, ledger) => sum + ledger.advance, 0));
  const totalRevenue = round(revenue);
  const totalCogs = round(cogs);
  const grossProfit = round(totalRevenue - totalCogs);
  return {
    from, to, shipments: shipments.length, deliveredQty: roundQty(deliveredQty),
    revenue: totalRevenue, cogs: totalCogs, grossProfit,
    materialCost: round(materialCost), laborCost: round(laborCost),
    customRevenue: round(customRevenue), seriesRevenue: round(seriesRevenue),
    cashIn, cashOut, netCash: round(cashIn - cashOut),
    operating, profit: round(grossProfit - operating),
    debt, advances, payrollPending, payrollAccepted, payrollPaid,
    recipeVariance: recipeVariance(state, from, to),
  };
}

export interface ShopReport {
  shopId: string; name: string; shipments: number; deliveredQty: number;
  revenue: number; cost: number; materialCost: number; laborCost: number; grossProfit: number;
  paid: number; debt: number; advance: number;
}

export function shopReport(state: State, shopId: string, from: string, to: string): ShopReport {
  const shop = state.customers.find(row => row.id === shopId);
  const shipments = shipmentRows(state, from, to, shopId);
  let revenue = 0, cost = 0, materialCost = 0, laborCost = 0, deliveredQty = 0;
  for (const shipment of shipments) {
    const totals = shipmentTotals(shipment);
    revenue += totals.revenue;
    cost += totals.cost;
    materialCost += totals.materialCost;
    laborCost += totals.laborCost;
    if (shipment.status === 'delivered') deliveredQty += shipmentQty(shipment);
  }
  const ledger = customerLedger(snapshotAt(state, to), shopId);
  return {
    shopId, name: shop?.name ?? 'Do‘kon topilmadi',
    shipments: shipments.length, deliveredQty: roundQty(deliveredQty),
    revenue: round(revenue), cost: round(cost), materialCost: round(materialCost), laborCost: round(laborCost),
    grossProfit: round(revenue - cost),
    paid: ledger.paid, debt: ledger.debt, advance: ledger.advance,
  };
}

export interface StockBalanceRow {
  itemId: string; name: string; unit: string; kind: Item['kind'];
  opening: number; inbound: number; outbound: number; closing: number; manufactured: number;
  openingValue: number; closingValue: number;
}

export interface StockBalanceReport {
  rows: StockBalanceRow[]; openingValue: number; closingValue: number; manufactured: number;
}

export function stockBalanceReport(state: State, from: string, to: string): StockBalanceReport {
  const lower = timeOf(from);
  const upper = timeOf(to);
  const rows = state.items.map((item): StockBalanceRow => {
    let opening = 0, inbound = 0, outbound = 0, manufactured = 0;
    for (const movement of state.movements) {
      if (movement.itemId !== item.id) continue;
      const at = timeOf(movement.createdAt);
      if (at < lower) {
        opening += movement.direction === 'in' ? movement.qty : -movement.qty;
      } else if (at < upper) {
        if (movement.direction === 'in') {
          inbound += movement.qty;
          if (movement.source === 'production') manufactured += movement.qty;
        } else {
          outbound += movement.qty;
        }
      }
    }
    const openingQty = roundQty(opening);
    const inboundQty = roundQty(inbound);
    const outboundQty = roundQty(outbound);
    const closing = roundQty(openingQty + inboundQty - outboundQty);
    return {
      itemId: item.id, name: item.name, unit: item.unit, kind: item.kind,
      opening: openingQty, inbound: inboundQty, outbound: outboundQty, closing,
      manufactured: roundQty(manufactured),
      openingValue: round(openingQty * item.cost), closingValue: round(closing * item.cost),
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.itemId.localeCompare(right.itemId));
  return {
    rows,
    openingValue: round(rows.reduce((sum, row) => sum + row.openingValue, 0)),
    closingValue: round(rows.reduce((sum, row) => sum + row.closingValue, 0)),
    manufactured: roundQty(rows.reduce((sum, row) => sum + row.manufactured, 0)),
  };
}

export interface MachineReportRow {
  machineId: string; name: string; hourlyRevenueTarget: number;
  plannedHours: number; targetRevenue: number; actualRevenue: number; lostRevenue: number | null;
}

export interface MachineReport {
  rows: MachineReportRow[]; targetRevenue: number; actualRevenue: number; lostRevenue: number;
}

export function machineReport(state: State, from: string, to: string): MachineReport {
  const operations = new Map(state.operations.map(operation => [operation.id, operation]));
  const planned = state.orders.filter(order => order.status !== 'cancelled' && withinPeriod(order.createdAt, from, to));
  const accepted = state.reports.filter(report => report.status === 'accepted' && withinPeriod(report.createdAt, from, to));
  const rows = state.machines.map((machine): MachineReportRow => {
    let minutes = 0;
    for (const order of planned) {
      for (const task of order.route) {
        const operation = operations.get(task.operationId);
        if (!operation || operation.machineId !== machine.id) continue;
        minutes += (task.standardMinutes ?? operation.standardMinutes) * task.planned;
      }
    }
    const targetRevenue = round(minutes / 60 * machine.hourlyRevenueTarget);
    let actual = 0;
    for (const report of accepted) {
      const order = state.orders.find(row => row.id === report.orderId);
      const task = order?.route.find(row => row.id === report.taskId);
      const operation = task ? operations.get(task.operationId) : undefined;
      if (!task || !operation || operation.machineId !== machine.id) continue;
      actual += report.qty * (task.salePrice ?? operation.salePrice);
    }
    const actualRevenue = round(actual);
    const lostRevenue = machine.hourlyRevenueTarget <= 0 || targetRevenue <= 0
      ? null : Math.max(0, round(targetRevenue - actualRevenue));
    return {
      machineId: machine.id, name: machine.name, hourlyRevenueTarget: machine.hourlyRevenueTarget,
      plannedHours: round(minutes / 60), targetRevenue, actualRevenue, lostRevenue,
    };
  });
  return {
    rows,
    targetRevenue: round(rows.reduce((sum, row) => sum + row.targetRevenue, 0)),
    actualRevenue: round(rows.reduce((sum, row) => sum + row.actualRevenue, 0)),
    lostRevenue: round(rows.reduce((sum, row) => sum + (row.lostRevenue ?? 0), 0)),
  };
}
