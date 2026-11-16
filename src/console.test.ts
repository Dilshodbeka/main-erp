import { describe, expect, it } from 'vitest';
import { directorConsole, workerCustomerDebt } from './console';
import { emptyState, supplierDebt } from './domain';
import type {
  CashEntry, Customer, Employee, ExpensePlan, LoanRow, PayrollEntry, Purchase, PurchaseLine,
  SalaryPlan, Shipment, ShipmentLine, State, StockMovement,
} from './types';

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  for (const row of rows) Object.assign(state, row);
  return state;
}

const cashEntry = (partial: Partial<CashEntry> & Pick<CashEntry, 'amount' | 'direction'>): CashEntry => ({
  id: crypto.randomUUID(), account: 'cash', toAccount: null, source: 'manual', sourceId: null,
  customerId: null, category: 'manual', note: '', number: null, reversalOf: null,
  createdAt: '2026-11-01T00:00:00.000Z', ...partial,
});

const employee = (id: string, name: string, deactivatedAt: string | null = null): Employee =>
  ({ id, name, active: true, deactivatedAt });

const customer = (id: string, kind: Customer['kind'], employeeId: string | null = null): Customer =>
  ({ id, name: `Mijoz ${id}`, phone: '', address: '', kind, employeeId });

const line = (salePrice: number, qty = 1): ShipmentLine =>
  ({ id: crypto.randomUUID(), itemId: null, description: 'Tovar', qty, salePrice, unitCost: 0, materialCost: 0, laborCost: 0, lineId: null });

const shipment = (id: string, customerId: string, revenue: number): Shipment => ({
  id, orderId: null, customerId, kind: 'stock', lines: [line(revenue)], address: '', dueDate: '2026-11-01',
  status: 'delivered', createdAt: '2026-11-01T00:00:00.000Z', deliveredAt: null, reversalOf: null,
});

const salaryPlan = (employeeId: string, amount: number, fromMonth: string): SalaryPlan =>
  ({ id: crypto.randomUUID(), employeeId, amount, fromMonth, createdAt: `${fromMonth}-01T00:00:00.000Z` });

const expensePlan = (planId: string, title: string, amount: number, fromMonth: string, dueDay: number): ExpensePlan =>
  ({ id: crypto.randomUUID(), planId, title, amount, fromMonth, dueDay, supplierId: null, createdAt: `${fromMonth}-01T00:00:00.000Z` });

const loan = (id: string, title: string, amount: number, kind: LoanRow['kind'] = 'loan'): LoanRow =>
  ({ id, title, kind, amount, note: '', createdAt: '2026-11-01T00:00:00.000Z' });

const payroll = (id: string, employeeId: string, amount: number): PayrollEntry =>
  ({ id, employeeId, reportId: 'r1', orderId: 'o1', taskId: 't1', amount, status: 'accepted', createdAt: '2026-11-01T00:00:00.000Z' });

const purchaseLine = (id: string, qty: number, price: number, received: number): PurchaseLine =>
  ({ id, itemId: 'i1', qty, price, received, previousPurchasePrice: price, newPurchasePrice: price, previousAverageCost: price, newAverageCost: price });

const purchase = (id: string, supplierId: string, lines: PurchaseLine[]): Purchase =>
  ({ id, number: 'X-1', supplierId, lines, createdAt: '2026-11-01T00:00:00.000Z' });

const movement = (id: string, sourceId: string, qty: number, unitCost: number): StockMovement =>
  ({ id, itemId: 'i1', direction: 'in', qty, unitCost, source: 'purchase', sourceId, note: '', createdAt: '2026-11-01T00:00:00.000Z' });

describe('director console', () => {
  const asOf = '2026-11-10T12:00:00.000Z';

  it('sums cash and bank balances without double-counting transfers', () => {
    const state = fixture({ cash: [
      cashEntry({ direction: 'in', amount: 100000 }),
      cashEntry({ direction: 'in', amount: 250000, account: 'bank' }),
      cashEntry({ direction: 'transfer', amount: 50000, toAccount: 'bank' }),
    ] });
    expect(directorConsole(state, asOf).balances).toEqual({ cash: 50000, bank: 300000, total: 350000 });
  });

  it('splits receivable between customers and shops and passes the loans available engine through', () => {
    const state = fixture({
      customers: [customer('c1', 'customer'), customer('c2', 'shop'), customer('c3', 'service')],
      shipments: [shipment('s1', 'c1', 400000), shipment('s2', 'c2', 600000), shipment('s3', 'c3', 200000)],
      loans: [loan('l1', 'Bank krediti', 5000000)],
      cash: [cashEntry({ direction: 'in', amount: 3000000, source: 'loan', sourceId: 'l1', category: 'loan-draw' })],
    });
    const report = directorConsole(state, asOf);
    expect(report.receivable.customers).toBe(600000);
    expect(report.receivable.shops).toBe(600000);
    expect(report.receivable.customers + report.receivable.shops).toBe(1200000);
    expect(report.receivable.loansAvailable).toBe(2000000);
  });

  it('sums payroll, supplier, expense and loan debts into one payable total', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      salaryPlans: [salaryPlan('e1', 800000, '2026-11')],
      payroll: [payroll('p1', 'e1', 800000)],
      suppliers: [{ id: 's1', name: 'Yetkazib beruvchi', phone: '' }],
      purchases: [purchase('p1', 's1', [purchaseLine('l1', 2, 100000, 2)])],
      movements: [movement('m1', 'p1', 2, 100000)],
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 5)],
      loans: [loan('l1', 'Investitsiya', 4000000, 'investment')],
    });
    const report = directorConsole(state, asOf);
    expect(report.payable).toEqual({
      payroll: 800000, suppliers: 200000, expenses: 700000, loans: 4000000, total: 5700000,
    });
  });

  it('does not count accepted work records as payable salary', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      payroll: [payroll('p1', 'e1', 800000)],
    });
    expect(directorConsole(state, asOf).payable.payroll).toBe(0);
  });

  it('keeps a supplier advance out of the payable total', () => {
    const state = fixture({
      suppliers: [{ id: 's1', name: 'Pudratchi', phone: '' }],
      purchases: [purchase('p1', 's1', [purchaseLine('l1', 2, 100000, 2)])],
      movements: [movement('m1', 'p1', 2, 100000)],
      cash: [cashEntry({ direction: 'out', amount: 300000, source: 'supplier', sourceId: 's1', category: 'outsourcing' })],
    });
    expect(supplierDebt(state, 's1')).toBe(-100000);
    expect(directorConsole(state, asOf).payable).toEqual({ payroll: 0, suppliers: 0, expenses: 0, loans: 0, total: 0 });
  });

  it('projects three months of salary and expense plans including a plan version change', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      salaryPlans: [salaryPlan('e1', 1500000, '2026-11'), salaryPlan('e1', 1800000, '2027-01')],
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 5)],
    });
    expect(directorConsole(state, asOf).future).toEqual([
      { month: '2026-11', salary: 1500000, expenses: 700000, total: 2200000 },
      { month: '2026-12', salary: 1500000, expenses: 700000, total: 2200000 },
      { month: '2027-01', salary: 1800000, expenses: 700000, total: 2500000 },
    ]);
  });

  it('projects zero for plan-less and deactivated employees in later months', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz'), employee('e2', 'Botir', '2026-11-05')],
      salaryPlans: [salaryPlan('e2', 1500000, '2026-11')],
    });
    const future = directorConsole(state, asOf).future;
    expect(future[0].salary).toBeGreaterThan(0);
    expect(future[1].salary).toBe(0);
    expect(future[2].salary).toBe(0);
  });

  it('flags unpaid expense months with due day and passed marker, paid months stay silent', () => {
    const state = fixture({
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 3), expensePlan('x2', 'Internet', 200000, '2026-11', 25)],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'expense-due', id: 'x1', title: 'Ijara', amount: 700000, hint: '3-kungacha to‘lash', dueDay: 3, passed: true },
      { kind: 'expense-due', id: 'x2', title: 'Internet', amount: 200000, hint: '25-kungacha to‘lash', dueDay: 25, passed: false },
    ]);
    const paid = fixture({
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 3)],
      cash: [cashEntry({ direction: 'out', amount: 700000, source: 'expense', sourceId: 'x1', category: 'expense' })],
    });
    expect(directorConsole(paid, asOf).attention).toEqual([]);
  });

  it('flags loans with an outstanding balance, largest first, fully repaid stay silent', () => {
    const state = fixture({
      loans: [loan('l1', 'Kredit', 5000000), loan('l2', 'Investitsiya', 2000000, 'investment'), loan('l3', 'Kichik qarz', 3000000)],
      cash: [cashEntry({ direction: 'out', amount: 2000000, source: 'loan', sourceId: 'l2', category: 'loan-repay' })],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'loan-owed', id: 'l1', title: 'Kredit', amount: 5000000, hint: 'Zaym qaytarilishi kerak' },
      { kind: 'loan-owed', id: 'l3', title: 'Kichik qarz', amount: 3000000, hint: 'Zaym qaytarilishi kerak' },
    ]);
  });

  it('flags worker customers with debt using the employee name, others stay silent', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      customers: [customer('c1', 'customer', 'e1'), customer('c2', 'customer')],
      shipments: [shipment('s1', 'c1', 500000), shipment('s2', 'c2', 300000)],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'worker-debt', id: 'c1', title: 'Aziz', amount: 500000, hint: 'Xodimning material va xizmat qarzi' },
    ]);
  });

  it('returns the worker card debt or zero without a card', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      customers: [customer('c1', 'customer', 'e1')],
      shipments: [shipment('s1', 'c1', 500000)],
    });
    expect(workerCustomerDebt(state, 'e1')).toBe(500000);
    expect(workerCustomerDebt(state, 'nobody')).toBe(0);
  });

  it('handles an empty company with zero months and no attention', () => {
    const report = directorConsole(emptyState(), asOf);
    expect(report.balances).toEqual({ cash: 0, bank: 0, total: 0 });
    expect(report.receivable).toEqual({ customers: 0, shops: 0, loansAvailable: 0 });
    expect(report.payable).toEqual({ payroll: 0, suppliers: 0, expenses: 0, loans: 0, total: 0 });
    expect(report.future).toEqual([
      { month: '2026-11', salary: 0, expenses: 0, total: 0 },
      { month: '2026-12', salary: 0, expenses: 0, total: 0 },
      { month: '2027-01', salary: 0, expenses: 0, total: 0 },
    ]);
    expect(report.attention).toEqual([]);
  });
});
