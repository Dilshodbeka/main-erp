import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface SalaryMonth { month: string; obliged: number; paid: number; unpaid: number }

export interface SalaryLedger {
  employeeId: string;
  months: SalaryMonth[];
  prepaid: number;
  owed: number;
  paidTotal: number;
  plannedTotal: number;
}

function paidFrom(state: State, employeeId: string, boundary: string): number {
  const cashNet = state.cash.reduce((total, row) => {
    if (row.source !== 'payroll' || row.sourceId !== employeeId) return total;
    if (row.direction !== 'in' && row.direction !== 'out') return total;
    if (row.createdAt < boundary) return total;
    return total + (row.direction === 'out' ? row.amount : -row.amount);
  }, 0);
  const deductionNet = state.workerDeductions.reduce((total, row) => {
    if (row.employeeId !== employeeId || row.createdAt < boundary) return total;
    return total + (row.direction === 'deduct' ? row.amount : -row.amount);
  }, 0);
  return round(cashNet + deductionNet);
}

export function salaryLedger(state: State, employeeId: string, asOf?: string): SalaryLedger {
  const versions = state.salaryPlans
    .filter(row => row.employeeId === employeeId)
    .sort((a, b) => a.fromMonth === b.fromMonth ? a.createdAt.localeCompare(b.createdAt) : a.fromMonth.localeCompare(b.fromMonth));

  if (!versions.length) {
    return { employeeId, months: [], prepaid: 0, owed: 0, paidTotal: 0, plannedTotal: 0 };
  }

  const startMonth = versions[0].fromMonth;
  const boundary = `${startMonth}-01T00:00:00.000Z`;
  const payments = paidFrom(state, employeeId, boundary);
  const employee = state.employees.find(row => row.id === employeeId);
  const horizon = (asOf ?? new Date().toISOString()).slice(0, 7);
  const months: SalaryMonth[] = [];
  for (let month = startMonth; month <= horizon; month = nextMonth(month)) {
    const plan = versions.filter(row => row.fromMonth <= month).at(-1)!;
    const stopped = employee?.deactivatedAt ? employee.deactivatedAt.slice(0, 7) <= month : false;
    const activeDays = stopped
      ? (employee!.deactivatedAt!.slice(0, 7) === month ? Number(employee!.deactivatedAt!.slice(8, 10)) : 0)
      : daysInMonth(month);
    const fixed = round(activeDays > 0 ? plan.amount * activeDays / daysInMonth(month) : 0);
    months.push({ month, obliged: fixed, paid: 0, unpaid: 0 });
  }

  let available = Math.max(0, payments);
  for (const month of months) {
    month.paid = Math.min(month.obliged, available);
    available = round(available - month.paid);
    month.unpaid = round(month.obliged - month.paid);
  }

  return {
    employeeId,
    months,
    prepaid: available,
    owed: months.reduce((sum, month) => sum + month.unpaid, 0),
    paidTotal: payments,
    plannedTotal: months.reduce((sum, month) => sum + month.obliged, 0),
  };
}
