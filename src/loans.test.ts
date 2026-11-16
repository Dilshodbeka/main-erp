import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { loanLedger, loansAvailable, loansDebt } from './loans';
import type { CashEntry, LoanRow, State } from './types';

function loanRow(overrides: Partial<LoanRow> = {}): LoanRow {
  return { id: 'loan-1', title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '', createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function cashEntry(overrides: Partial<CashEntry> = {}): CashEntry {
  return { id: 'cash-1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', number: null, reversalOf: null, createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function state(loans: LoanRow[], cash: CashEntry[] = []): State {
  return { ...emptyState(), loans, cash };
}

describe('loanLedger', () => {
  it('computes a fresh loan as fully available and fully owed', () => {
    const ledger = loanLedger(state([loanRow()]), 'loan-1');
    expect(ledger).toMatchObject({ id: 'loan-1', title: 'Jasur aka', kind: 'loan', principal: 10_000_000, drawn: 0, available: 10_000_000, repaid: 0, owed: 10_000_000 });
  });

  it('reduces available when money is drawn and keeps owed at principal', () => {
    const ledger = loanLedger(state([loanRow()], [cashEntry({ amount: 6_000_000 })]), 'loan-1');
    expect(ledger.drawn).toBe(6_000_000);
    expect(ledger.available).toBe(4_000_000);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('reduces owed when repaid and keeps available at principal minus drawn', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
    ]), 'loan-1');
    expect(ledger.repaid).toBe(2_000_000);
    expect(ledger.owed).toBe(8_000_000);
    expect(ledger.available).toBe(4_000_000);
  });

  it('restores availability when a draw is reversed', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', direction: 'out', amount: 6_000_000, category: 'loan-draw', reversalOf: 'cash-1' }),
    ]), 'loan-1');
    expect(ledger.drawn).toBe(0);
    expect(ledger.available).toBe(10_000_000);
  });

  it('restores debt when a repayment is reversed', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
      cashEntry({ id: 'cash-2', direction: 'in', amount: 2_000_000, category: 'loan-repay', reversalOf: 'cash-1' }),
    ]), 'loan-1');
    expect(ledger.repaid).toBe(0);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('keeps drawn as the raw sum and floors only available when data overdraws', () => {
    const ledger = loanLedger(state([loanRow()], [cashEntry({ amount: 12_000_000 })]), 'loan-1');
    expect(ledger.drawn).toBe(12_000_000);
    expect(ledger.available).toBe(0);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('sums debt and availability across loans', () => {
    const loans = [
      loanRow(),
      loanRow({ id: 'loan-2', kind: 'investment', amount: 5_000_000 }),
    ];
    const s = state(loans, [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', sourceId: 'loan-2', amount: 5_000_000 }),
      cashEntry({ id: 'cash-3', direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
    ]);
    expect(loansDebt(s)).toBe(13_000_000);
    expect(loansAvailable(s)).toBe(4_000_000);
  });

  it('passes the kind through and tolerates a missing loan row', () => {
    expect(loanLedger(state([loanRow({ kind: 'investment' })]), 'loan-1').kind).toBe('investment');
    expect(loanLedger(state([]), 'missing')).toMatchObject({ id: 'missing', title: '', kind: 'loan', principal: 0, drawn: 0, available: 0, repaid: 0, owed: 0 });
  });
});
