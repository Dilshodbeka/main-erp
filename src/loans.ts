import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export interface LoanLedger {
  id: string;
  title: string;
  kind: 'loan' | 'investment';
  principal: number;
  drawn: number;
  available: number;
  repaid: number;
  owed: number;
}

export function loanLedger(state: State, loanId: string): LoanLedger {
  const loan = state.loans.find(row => row.id === loanId);
  const sum = (category: string, direction: 'in' | 'out') => round(state.cash.reduce((total, row) =>
    row.source === 'loan' && row.sourceId === loanId && row.category === category && row.direction === direction
      ? total + row.amount : total, 0));
  const drawn = round(sum('loan-draw', 'in') - sum('loan-draw', 'out'));
  const repaid = round(sum('loan-repay', 'out') - sum('loan-repay', 'in'));
  const principal = round(loan?.amount ?? 0);
  return {
    id: loanId,
    title: loan?.title ?? '',
    kind: loan?.kind ?? 'loan',
    principal,
    drawn,
    available: Math.max(0, round(principal - drawn)),
    repaid,
    owed: Math.max(0, round(principal - repaid)),
  };
}

export function loansDebt(state: State): number {
  return round(state.loans.reduce((total, loan) => total + loanLedger(state, loan.id).owed, 0));
}

export function loansAvailable(state: State): number {
  return round(state.loans.reduce((total, loan) => total + loanLedger(state, loan.id).available, 0));
}
