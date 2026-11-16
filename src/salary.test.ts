import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { salaryLedger } from './salary';
import { createDemo } from './seed';
import type { Actor, CashEntry, Command, PayrollEntry, SalaryPlan, State, WorkerDeduction } from './types';

const YEAR = 2026;
const startMonth = `${YEAR}-11`;

function cash(direction: 'in' | 'out', amount: number, createdAt: string, id: string = crypto.randomUUID()): CashEntry {
  return { id, direction, amount, account: 'cash', toAccount: null, source: 'payroll', sourceId: 'e1',
    customerId: null, category: 'payroll', note: '', number: null, reversalOf: null, createdAt };
}

function entry(amount: number, createdAt: string, status: PayrollEntry['status'] = 'accepted'): PayrollEntry {
  return { id: crypto.randomUUID(), employeeId: 'e1', reportId: 'r', orderId: 'o', taskId: 't', amount, status, createdAt };
}

function plan(amount: number, fromMonth: string, createdAt = `${fromMonth}-01T00:00:00.000Z`): SalaryPlan {
  return { id: crypto.randomUUID(), employeeId: 'e1', amount, fromMonth, createdAt };
}

const admin: Actor = { id: 'admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);
}

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  state.employees.push({ id: 'e1', name: 'Usta', active: true });
  for (const row of rows) Object.assign(state, row);
  return state;
}

function deduction(amount: number, createdAt: string, direction: 'deduct' | 'refund' = 'deduct', reversalOf: string | null = null): WorkerDeduction {
  return { id: crypto.randomUUID(), employeeId: 'e1', customerId: 'c1', amount, direction, note: '', reversalOf, createdAt };
}

describe('salary ledger without a plan', () => {
  it('pays nothing: accepted work and payments are stage-cost records, not salary', () => {
    const ledger = salaryLedger(fixture({
      payroll: [entry(1400000, `${YEAR}-10-05T09:00:00.000Z`)],
      cash: [cash('out', 200000, `${YEAR}-10-06T09:00:00.000Z`)],
      workerDeductions: [deduction(100000, `${YEAR}-10-07T09:00:00.000Z`)],
    }), 'e1', `${YEAR}-11-30T12:00:00.000Z`);
    expect(ledger).toEqual({ employeeId: 'e1', months: [], prepaid: 0, owed: 0, paidTotal: 0, plannedTotal: 0 });
  });
});

describe('salary ledger with a plan', () => {
  const asOf = `${YEAR}-11-30T12:00:00.000Z`;

  it('opens exactly one full month for a new plan', () => {
    const ledger = salaryLedger(fixture({ salaryPlans: [plan(1200000, startMonth)] }), 'e1', asOf);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1200000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('ignores accepted work and payments made before the plan start', () => {
    const ledger = salaryLedger(fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 800000, `${YEAR}-10-20T09:00:00.000Z`)],
      workerDeductions: [deduction(140000, `${YEAR}-10-21T09:00:00.000Z`)],
    }), 'e1', asOf);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1200000);
    expect(ledger.paidTotal).toBe(0);
  });

  it('applies an in-plan payment to the month obligation', () => {
    const ledger = salaryLedger(fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 800000, `${YEAR}-11-10T09:00:00.000Z`)],
    }), 'e1', asOf);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 800000, unpaid: 400000 }]);
    expect(ledger.owed).toBe(400000);
  });

  it('prorates only the month the worker left in', () => {
    const state = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    state.employees[0].deactivatedAt = `${YEAR}-11-15`;
    expect(salaryLedger(state, 'e1', asOf).months).toEqual([{ month: '2026-11', obliged: 600000, paid: 0, unpaid: 600000 }]);
  });

  it('keeps later months at zero after deactivation', () => {
    const state = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    state.employees[0].deactivatedAt = `${YEAR}-11-15`;
    state.payroll = [];
    expect(salaryLedger(state, 'e1', `${YEAR}-12-20T00:00:00.000Z`).months.map(m => m.obliged))
      .toEqual([600000, 0]);
  });

  it('charges the first plan month in full even when the ledger is read mid-month', () => {
    const ledger = salaryLedger(fixture({ salaryPlans: [plan(1200000, startMonth)] }), 'e1', `${YEAR}-11-20T00:00:00.000Z`);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
  });

  it('pushes the surplus into prepaid when the payment is allowed ahead', () => {
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 2000000, `${YEAR}-11-05T09:00:00.000Z`)],
    }), 'e1', asOf);
    expect(ledger.prepaid).toBe(800000);
    expect(ledger.owed).toBe(0);
    expect(ledger.paidTotal).toBe(2000000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('stacks plan versions by month, not by insertion order', () => {
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1500000, '2027-01'), plan(1200000, startMonth)],
    }), 'e1', '2027-01-31T00:00:00.000Z');
    expect(ledger.months.map(m => [m.month, m.obliged]))
      .toEqual([['2026-11', 1200000], ['2026-12', 1200000], ['2027-01', 1500000]]);
  });

  it('returns a reversed payment to the balance', () => {
    const paid = cash('out', 800000, `${YEAR}-11-05T09:00:00.000Z`, 'p1');
    const reversal = { ...cash('in', 800000, `${YEAR}-11-09T09:00:00.000Z`), reversalOf: 'p1' };
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1200000, startMonth)],
      cash: [paid, reversal],
    }), 'e1', asOf);
    expect(ledger.paidTotal).toBe(0);
    expect(ledger.owed).toBe(1200000);
  });

  it('keeps the FIFO split identical to the totals', () => {
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 900000, `${YEAR}-11-10T09:00:00.000Z`)],
    }), 'e1', asOf);
    const unpaid = ledger.months.reduce((sum, month) => sum + month.unpaid, 0);
    expect(unpaid).toBe(ledger.owed);
    expect(ledger.owed).toBe(Math.max(0, ledger.plannedTotal - ledger.paidTotal));
    expect(ledger.prepaid).toBe(Math.max(0, ledger.paidTotal - ledger.plannedTotal));
  });
});

describe('worker deductions count as salary payments', () => {
  const asOf = `${YEAR}-11-30T12:00:00.000Z`;

  it('reduces owed and raises paidTotal like a cash payment', () => {
    const base = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    expect(salaryLedger(base, 'e1', asOf).owed).toBe(1200000);
    const withDeduction = fixture({
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [deduction(300000, `${YEAR}-11-10T09:00:00.000Z`)],
    });
    const ledger = salaryLedger(withDeduction, 'e1', asOf);
    expect(ledger.owed).toBe(900000);
    expect(ledger.paidTotal).toBe(300000);
    expect(ledger.months[0].paid).toBe(300000);
  });

  it('reversing a deduction restores the balance', () => {
    const original = deduction(300000, `${YEAR}-11-10T09:00:00.000Z`);
    const state = fixture({
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [original, deduction(300000, `${YEAR}-11-12T09:00:00.000Z`, 'refund', original.id)],
    });
    expect(salaryLedger(state, 'e1', asOf).owed).toBe(1200000);
  });

  it('ignores a deduction made before the plan boundary', () => {
    const state = fixture({
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [deduction(140000, `${YEAR}-10-20T09:00:00.000Z`)],
    });
    const ledger = salaryLedger(state, 'e1', asOf);
    expect(ledger.paidTotal).toBe(0);
    expect(ledger.owed).toBe(1200000);
  });
});

describe('salary demo data', () => {
  const actor: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

  it('shows a closed previous month, an open current month and an advance', () => {
    const state = createDemo(actor);
    const ledger = salaryLedger(state, state.employees[0].id);
    expect(ledger.months[0].unpaid).toBe(0);
    expect(ledger.months[1].unpaid).toBeGreaterThan(0);
    expect(state.cash.some(row => row.category === 'advance' && row.amount === 1500000)).toBe(true);
  });

  it('keeps a salary balance for a deactivated worker who had a plan', () => {
    const state = createDemo(actor);
    const employee = state.employees.at(-1)!;
    expect(employee.active).toBe(false);
    expect(employee.deactivatedAt).toMatch(/^\d{4}-\d{2}-12$/);
    expect(state.salaryPlans.some(row => row.employeeId === employee.id)).toBe(true);
    expect(salaryLedger(state, employee.id).owed).toBeGreaterThan(0);
  });
});

describe('salary plan command', () => {
  function withEmployee(): { state: State; employeeId: string } {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Usta' });
    return { state, employeeId: state.employees[0].id };
  }

  it('stores the fixed amount and replaces it on the next edit of the same month', () => {
    const { state: base, employeeId } = withEmployee();
    let state = run(base, { type: 'salary.plan.set', employeeId, amount: 900000, fromMonth: '2026-11' });
    expect(state.salaryPlans[0]).toMatchObject({ amount: 900000, fromMonth: '2026-11' });
    state = run(state, { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: '2026-11' });
    expect(state.salaryPlans).toHaveLength(1);
    expect(state.salaryPlans[0]).toMatchObject({ amount: 1200000, fromMonth: '2026-11' });
  });

  it('keeps one version per month', () => {
    const { state: base, employeeId } = withEmployee();
    let state = run(base, { type: 'salary.plan.set', employeeId, amount: 900000, fromMonth: '2026-11' });
    state = run(state, { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: '2026-12' });
    expect(state.salaryPlans).toHaveLength(2);
    expect(salaryLedger(state, employeeId, '2026-12-31T00:00:00.000Z').months.map(m => m.obliged))
      .toEqual([900000, 1200000]);
  });
});
