import { cashBalance, payrollDebt, supplierDebt } from './domain';
import { expenseLedger, expensesDebt } from './expenses';
import { loanLedger, loansDebt, loansAvailable } from './loans';
import { customerBalance } from './receivables';
import { salaryLedger } from './salary';
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface ConsoleReport {
  balances: { cash: number; bank: number; total: number };
  receivable: { customers: number; shops: number; loansAvailable: number };
  payable: { payroll: number; suppliers: number; expenses: number; loans: number; total: number };
  future: FutureMonth[];
  attention: AttentionItem[];
}

export interface FutureMonth { month: string; salary: number; expenses: number; total: number }

export type AttentionKind = 'expense-due' | 'loan-owed' | 'worker-debt';

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  title: string;
  amount: number;
  hint: string;
  dueDay?: number;
  passed?: boolean;
}

export function directorConsole(state: State, asOf?: string): ConsoleReport {
  const iso = asOf ?? new Date().toISOString();
  const month = iso.slice(0, 7);
  const day = Number(iso.slice(8, 10));

  const cash = round(cashBalance(state, 'cash'));
  const bank = round(cashBalance(state, 'bank'));
  const customers = round(state.customers.filter(row => row.kind !== 'shop')
    .reduce((sum, row) => sum + customerBalance(state, row.id).debt, 0));
  const shops = round(state.customers.filter(row => row.kind === 'shop')
    .reduce((sum, row) => sum + customerBalance(state, row.id).debt, 0));
  const payroll = round(state.employees.reduce((sum, row) => sum + payrollDebt(state, row.id), 0));
  const suppliers = round(state.suppliers.reduce((sum, row) => sum + Math.max(0, supplierDebt(state, row.id)), 0));
  const expenses = round(expensesDebt(state));
  const loans = round(loansDebt(state));

  const future: FutureMonth[] = [];
  let cursor = month;
  for (let i = 0; i < 3; i++) {
    const at = `${cursor}-01T00:00:00.000Z`;
    const salary = round(state.employees.reduce((sum, row) =>
      sum + (salaryLedger(state, row.id, at).months.at(-1)?.obliged ?? 0), 0));
    const monthlyExpenses = round([...new Set(state.expensePlans.map(row => row.planId))]
      .reduce((sum, planId) => sum + (expenseLedger(state, planId, at).months.at(-1)?.obliged ?? 0), 0));
    future.push({ month: cursor, salary, expenses: monthlyExpenses, total: round(salary + monthlyExpenses) });
    cursor = nextMonth(cursor);
  }

  const attention: AttentionItem[] = [];
  for (const planId of [...new Set(state.expensePlans.map(row => row.planId))]) {
    const ledger = expenseLedger(state, planId, iso);
    const row = ledger.months.find(entry => entry.month === month);
    if (!row || row.unpaid <= 0.005) continue;
    const versions = state.expensePlans.filter(entry => entry.planId === planId)
      .sort((left, right) => left.fromMonth.localeCompare(right.fromMonth) || left.createdAt.localeCompare(right.createdAt));
    const dueDay = versions.at(-1)?.dueDay ?? 1;
    attention.push({
      kind: 'expense-due', id: planId, title: ledger.title, amount: round(row.unpaid),
      hint: `${dueDay}-kungacha to‘lash`, dueDay, passed: dueDay < day,
    });
  }
  for (const row of state.loans) {
    const ledger = loanLedger(state, row.id);
    if (ledger.owed <= 0.005) continue;
    attention.push({
      kind: 'loan-owed', id: row.id, title: row.title, amount: round(ledger.owed),
      hint: row.kind === 'loan' ? 'Zaym qaytarilishi kerak' : 'Investitsiya qaytarilishi kerak',
    });
  }
  for (const row of state.customers) {
    if (!row.employeeId) continue;
    const debt = round(customerBalance(state, row.id).debt);
    if (debt <= 0.005) continue;
    const owner = state.employees.find(entry => entry.id === row.employeeId);
    attention.push({
      kind: 'worker-debt', id: row.id, title: owner?.name ?? row.name, amount: debt,
      hint: 'Xodimning material va xizmat qarzi',
    });
  }
  attention.sort((left, right) => {
    const order: Record<AttentionKind, number> = { 'expense-due': 0, 'loan-owed': 1, 'worker-debt': 2 };
    if (order[left.kind] !== order[right.kind]) return order[left.kind] - order[right.kind];
    if (left.kind === 'expense-due') {
      if (left.passed !== right.passed) return left.passed ? -1 : 1;
      return (left.dueDay ?? 0) - (right.dueDay ?? 0);
    }
    return right.amount - left.amount;
  });

  return {
    balances: { cash, bank, total: round(cash + bank) },
    receivable: { customers, shops, loansAvailable: round(loansAvailable(state)) },
    payable: { payroll, suppliers, expenses, loans, total: round(payroll + suppliers + expenses + loans) },
    future,
    attention,
  };
}

export function workerCustomerDebt(state: State, employeeId: string): number {
  const customer = state.customers.find(row => row.employeeId === employeeId);
  if (!customer) return 0;
  return round(customerBalance(state, customer.id).debt);
}
