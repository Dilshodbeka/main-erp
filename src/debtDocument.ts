import { customerBalance } from './receivables';
import type { CompanyProfile } from './company-profile';
import type { State } from './types';

export interface DebtDocumentRow {
  label: string; createdAt: string; total: number; paid: number; outstanding: number;
}

export interface DebtDocumentModel {
  customer: string; company: CompanyProfile; date: string;
  rows: DebtDocumentRow[]; contract: number; paid: number; debt: number;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function debtDocument(state: State, customerId: string, company: CompanyProfile, now: Date = new Date()): DebtDocumentModel | null {
  const customer = state.customers.find(row => row.id === customerId);
  if (!customer) return null;
  const balance = customerBalance(state, customerId);
  if (!balance.obligations.length) return null;
  return {
    customer: customer.name,
    company,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    rows: balance.obligations.map(row => ({
      label: row.label, createdAt: row.createdAt, total: row.total, paid: row.paid, outstanding: row.outstanding,
    })),
    contract: balance.contract,
    paid: balance.paid,
    debt: balance.debt,
  };
}

export function debtFileName(customerName: string): string {
  const family = customerName.trim().split(/[ \t\r\n]+/).filter(Boolean).at(-1) ?? 'Mijoz';
  // The apostrophe in O‘g‘iloy is punctuation, not a letter: drop it instead of turning it into a dash.
  const clean = family.replace(/[‘’']/g, '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  return `Qarz-haqida-${clean || 'Mijoz'}.png`;
}
