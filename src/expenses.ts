import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthOf = (value: string): string => value.slice(0, 7);

export interface ExpenseMonth { month: string; obliged: number; paid: number; unpaid: number }

export interface ExpenseLedger {
  planId: string;
  title: string;
  months: ExpenseMonth[];
  prepaid: number;
  owed: number;
  paidTotal: number;
  plannedTotal: number;
}

export function expenseLedger(state: State, planId: string, asOf?: string): ExpenseLedger {
  const versions = state.expensePlans
    .filter(row => row.planId === planId)
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth) || a.createdAt.localeCompare(b.createdAt));
  const paidTotal = round(state.cash.reduce((total, row) => {
    if (row.source !== 'expense' || row.sourceId !== planId) return total;
    if (row.direction === 'out') return total + row.amount;
    if (row.direction === 'in') return total - row.amount;
    return total;
  }, 0));
  if (!versions.length) {
    return { planId, title: '', months: [], prepaid: Math.max(0, paidTotal), owed: 0, paidTotal, plannedTotal: 0 };
  }
  const horizon = monthOf(asOf ?? new Date().toISOString());
  const months: ExpenseMonth[] = [];
  let month = versions[0].fromMonth;
  let amount = versions[0].amount;
  let cursor = 0;
  while (month <= horizon) {
    while (cursor + 1 < versions.length && versions[cursor + 1].fromMonth <= month) {
      cursor += 1;
      amount = versions[cursor].amount;
    }
    months.push({ month, obliged: round(amount), paid: 0, unpaid: round(amount) });
    month = nextMonth(month);
  }
  const plannedTotal = round(months.reduce((sum, row) => sum + row.obliged, 0));
  let pool = paidTotal;
  for (const row of months) {
    const paid = Math.min(Math.max(0, pool), row.unpaid);
    row.paid = round(paid);
    row.unpaid = round(row.unpaid - paid);
    pool = round(pool - paid);
  }
  const prepaid = Math.max(0, pool);
  const owed = Math.max(0, plannedTotal - paidTotal);
  return { planId, title: versions[versions.length - 1].title, months, prepaid, owed, paidTotal, plannedTotal };
}

export function expensesDebt(state: State): number {
  const ids = new Set(state.expensePlans.map(row => row.planId));
  return round([...ids].reduce((sum, id) => sum + expenseLedger(state, id).owed, 0));
}
