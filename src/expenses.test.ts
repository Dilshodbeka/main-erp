import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { expenseLedger, expensesDebt } from './expenses';
import type { CashEntry, ExpensePlan, State } from './types';

const YEAR = 2026;
const startMonth = `${YEAR}-11`;

function cash(direction: 'in' | 'out', amount: number, createdAt: string, id = crypto.randomUUID()): CashEntry {
  return { id, direction, amount, account: 'cash', toAccount: null, source: 'expense', sourceId: 'p1',
    customerId: null, category: 'expense', note: '', number: null, reversalOf: null, createdAt };
}

function plan(amount: number, fromMonth: string, createdAt = `${fromMonth}-01T00:00:00.000Z`): ExpensePlan {
  return { id: crypto.randomUUID(), planId: 'p1', title: 'Ijara', amount, fromMonth, dueDay: 15, supplierId: null, createdAt };
}

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  for (const row of rows) Object.assign(state, row);
  return state;
}

describe('expense ledger', () => {
  const asOf = `${YEAR}-11-30T12:00:00.000Z`;

  it('returns an empty ledger without a plan', () => {
    const ledger = expenseLedger(fixture(), 'p1', asOf);
    expect(ledger).toEqual({ planId: 'p1', title: '', months: [], prepaid: 0, owed: 0, paidTotal: 0, plannedTotal: 0 });
  });

  it('opens one full month per calendar month, first month included in full', () => {
    const ledger = expenseLedger(fixture({ expensePlans: [plan(1200000, startMonth)] }), 'p1', asOf);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1200000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('charges the first plan month in full even when the ledger is read mid-month', () => {
    const ledger = expenseLedger(fixture({ expensePlans: [plan(1200000, startMonth)] }), 'p1', `${YEAR}-11-20T00:00:00.000Z`);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
  });

  it('stacks plan versions by month, not by insertion order', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1500000, '2027-01'), plan(1200000, startMonth)],
    }), 'p1', '2027-01-31T00:00:00.000Z');
    expect(ledger.months.map(m => [m.month, m.obliged]))
      .toEqual([['2026-11', 1200000], ['2026-12', 1200000], ['2027-01', 1500000]]);
  });

  it('applies payments FIFO across months and keeps the identity', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [cash('out', 1500000, `${YEAR}-11-10T09:00:00.000Z`)],
    }), 'p1', '2026-12-20T00:00:00.000Z');
    expect(ledger.months).toEqual([
      { month: '2026-11', obliged: 1200000, paid: 1200000, unpaid: 0 },
      { month: '2026-12', obliged: 1200000, paid: 300000, unpaid: 900000 },
    ]);
    expect(ledger.owed).toBe(900000);
    expect(ledger.prepaid).toBe(0);
  });

  it('pushes the surplus into prepaid when the payment exceeds plannedTotal', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [cash('out', 2000000, `${YEAR}-11-05T09:00:00.000Z`)],
    }), 'p1', asOf);
    expect(ledger.prepaid).toBe(800000);
    expect(ledger.owed).toBe(0);
    expect(ledger.paidTotal).toBe(2000000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('returns a reversed payment to the balance', () => {
    const paidId = crypto.randomUUID();
    const paid = cash('out', 800000, `${YEAR}-11-05T09:00:00.000Z`, paidId);
    const reversal = { ...cash('in', 800000, `${YEAR}-11-09T09:00:00.000Z`), reversalOf: paidId };
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [paid, reversal],
    }), 'p1', asOf);
    expect(ledger.paidTotal).toBe(0);
    expect(ledger.owed).toBe(1200000);
  });

  it('keeps the FIFO split identical to the totals', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth), plan(1300000, '2026-12')],
      cash: [cash('out', 900000, `${YEAR}-11-10T09:00:00.000Z`), cash('out', 400000, `${YEAR}-12-02T09:00:00.000Z`)],
    }), 'p1', '2026-12-20T00:00:00.000Z');
    const unpaid = ledger.months.reduce((sum, month) => sum + month.unpaid, 0);
    expect(unpaid).toBe(ledger.owed);
    expect(ledger.owed).toBe(Math.max(0, ledger.plannedTotal - ledger.paidTotal));
    expect(ledger.prepaid).toBe(Math.max(0, ledger.paidTotal - ledger.plannedTotal));
  });

  it('sums owed across all plans in expensesDebt', () => {
    const state = fixture({
      expensePlans: [plan(1200000, startMonth), { ...plan(500000, startMonth), planId: 'p2' }],
      cash: [cash('out', 300000, `${YEAR}-11-10T09:00:00.000Z`), { ...cash('out', 200000, `${YEAR}-11-10T09:00:00.000Z`), sourceId: 'p2' }],
    });
    expect(expensesDebt(state)).toBe(1200000);
  });

  it('uses the latest version title for display', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth), { ...plan(1300000, '2026-12'), title: 'Ijara ofis' }],
    }), 'p1', '2026-12-20T00:00:00.000Z');
    expect(ledger.title).toBe('Ijara ofis');
  });
});
