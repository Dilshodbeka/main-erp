import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as AppModule from './App';
import { CustomerCard } from './components/CustomerCard';
import { EmployeeEditor } from './components/QuickEditors';
import * as SalaryPanelModule from './components/SalaryPanel';
import { emptyState } from './domain';
import type { CashEntry, Command, State, WorkerDeduction } from './types';

type PaymentRows = (state: State, employeeId: string, month: string) => CashEntry[];
const paymentRows = (SalaryPanelModule as unknown as { salaryPaymentRows?: PaymentRows }).salaryPaymentRows!;

type DeductionRows = (state: State, employeeId: string, month: string) => WorkerDeduction[];
const deductionRows = (SalaryPanelModule as unknown as { salaryDeductionRows?: DeductionRows }).salaryDeductionRows!;

type PayFormProps = {
  employeeId: string;
  owed: number;
  busy: boolean;
  close: () => void;
  save: (command: Command) => Promise<void>;
};

function cash(id: string, note: string, createdAt: string): CashEntry {
  return {
    id, direction: 'out', amount: 100000, account: 'cash', toAccount: null,
    source: 'payroll', sourceId: 'e1', customerId: null, category: 'payroll',
    note, number: null, reversalOf: null, createdAt,
  };
}

function deductionRow(id: string, createdAt: string, amount = 100000): WorkerDeduction {
  return { id, employeeId: 'e1', customerId: 'c1', amount, direction: 'deduct', note: '', reversalOf: null, createdAt };
}

function renderPayForm(owed: number): string {
  const Form = (AppModule as unknown as { SalaryPayForm?: ComponentType<PayFormProps> }).SalaryPayForm;
  expect(Form).toBeTypeOf('function');
  return renderToStaticMarkup(createElement(Form!, {
    employeeId: 'e1', owed, busy: false, close: () => {}, save: async () => {},
  }));
}describe('salary UI regressions', () => {
  it('hides payments made before the plan start', () => {
    expect(paymentRows).toBeTypeOf('function');
    const state = emptyState();
    state.cash = [
      cash('old', 'Eski to‘lov', '2026-10-20T09:00:00.000Z'),
      cash('current', 'Joriy oy to‘lovi', '2026-11-05T09:00:00.000Z'),
    ];
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 1200000, fromMonth: '2026-11', createdAt: '2026-11-01T09:00:00.000Z' }];
    expect(paymentRows!(state, 'e1', '2026-11').map(row => row.id)).toEqual(['current']);
  });

  it('lists no payments when the plan is not set', () => {
    const state = emptyState();
    state.cash = [cash('current', 'Joriy oy to‘lovi', '2026-11-05T09:00:00.000Z')];
    expect(paymentRows!(state, 'e1', '2026-11')).toEqual([]);
  });

  it('shows a later payment under the month it closes through FIFO', () => {
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 2600000, fromMonth: '2026-10', createdAt: '2026-10-01T09:00:00.000Z' }];
    state.cash = [{ ...cash('advance', 'Oylikdan oldin avans', '2026-11-05T09:00:00.000Z'), amount: 1500000 }];
    expect(paymentRows(state, 'e1', '2026-10').map(row => ({ id: row.id, amount: row.amount })))
      .toEqual([{ id: 'advance', amount: 1500000 }]);
  });

  it('applies the full payment to the month it covers', () => {
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 1200000, fromMonth: '2026-11', createdAt: '2026-11-01T09:00:00.000Z' }];
    state.cash = [{ ...cash('payment', 'Oylik to‘lovi', '2026-11-10T09:00:00.000Z'), amount: 800000 }];
    expect(paymentRows(state, 'e1', '2026-11').map(row => ({ id: row.id, amount: row.amount })))
      .toEqual([{ id: 'payment', amount: 800000 }]);
  });

  it('does not give the amount input a negative default or limit', () => {
    const html = renderPayForm(-500000);
    expect(html).toContain('name="amount"');
    expect(html).not.toContain('value="-500000"');
    expect(html).not.toMatch(/name="amount"[^>]*max=/);
  });

  it('keeps the payable amount as the cap for a positive balance', () => {
    const html = renderPayForm(1200000);
    expect(html).toContain('max="1200000"');
    expect(html).toContain('value="1200000"');
  });

  it('renders the stored deactivation date for editing', () => {
    const html = renderToStaticMarkup(createElement(EmployeeEditor, {
      employee: { id: 'e1', name: 'Usta', active: false, deactivatedAt: '2026-11-15' },
      busy: false, close: () => {}, save: async () => {},
    }));
    expect(html).toContain('name="deactivatedAt"');
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-11-15"');
  });
});

describe('salaryDeductionRows', () => {
  it('hides deductions made before the plan start', () => {
    expect(deductionRows).toBeTypeOf('function');
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 1200000, fromMonth: '2026-11', createdAt: '2026-11-01T09:00:00.000Z' }];
    state.workerDeductions = [
      deductionRow('old', '2026-10-20T09:00:00.000Z'),
      deductionRow('current', '2026-11-05T09:00:00.000Z'),
    ];
    expect(deductionRows(state, 'e1', '2026-11').map(row => row.id)).toEqual(['current']);
  });

  it('shows a later deduction under the month it closes through FIFO', () => {
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 2600000, fromMonth: '2026-10', createdAt: '2026-10-01T09:00:00.000Z' }];
    state.workerDeductions = [deductionRow('deduction', '2026-11-05T09:00:00.000Z', 1500000)];
    expect(deductionRows(state, 'e1', '2026-10').map(row => ({ id: row.id, amount: row.amount })))
      .toEqual([{ id: 'deduction', amount: 1500000 }]);
  });

  it('applies the full deduction to the month it covers', () => {
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 1200000, fromMonth: '2026-11', createdAt: '2026-11-01T09:00:00.000Z' }];
    state.workerDeductions = [deductionRow('deduction', '2026-11-10T09:00:00.000Z', 800000)];
    expect(deductionRows(state, 'e1', '2026-11').map(row => ({ id: row.id, amount: row.amount })))
      .toEqual([{ id: 'deduction', amount: 800000 }]);
  });

  it('ignores refunded deductions and refund rows', () => {
    const state = emptyState();
    state.salaryPlans = [{ id: 'p1', employeeId: 'e1', amount: 1200000, fromMonth: '2026-11', createdAt: '2026-11-01T09:00:00.000Z' }];
    state.workerDeductions = [
      deductionRow('deduction', '2026-11-05T09:00:00.000Z'),
      { ...deductionRow('refund', '2026-11-06T09:00:00.000Z'), direction: 'refund', reversalOf: 'deduction' },
    ];
    expect(deductionRows(state, 'e1', '2026-11').map(row => row.id)).toEqual([]);
  });

  it('shows date and time for operations in the customer card', () => {
    const state = emptyState();
    state.customers = [{ id: 'c1', name: 'Aziz', phone: '', address: '', kind: 'customer', employeeId: null }];
    state.cash = [{
      id: 'p1', direction: 'in', amount: 500000, account: 'cash', toAccount: null,
      source: 'sale', sourceId: 'c1', customerId: 'c1', category: 'sale',
      note: '', number: null, reversalOf: null, createdAt: '2026-11-06T09:00:00',
    }];
    state.shipments = [{
      id: 's1', orderId: null, customerId: 'c1', kind: 'stock',
      lines: [{ id: 'l1', itemId: null, description: 'Material', qty: 2, salePrice: 250000, unitCost: 0, materialCost: 0, laborCost: 0, lineId: null }],
      address: '', dueDate: '2026-11-01', status: 'delivered', createdAt: '2026-11-06T09:00:00', deliveredAt: null, reversalOf: null,
    }];
    const markup = renderToStaticMarkup(createElement(CustomerCard, {
      state, customerId: 'c1', onOpenOrder: () => {},
    }));
    expect(markup).toContain('Sana / vaqt');
    expect(markup).toContain('06.11.2026 · 09:00');
  });
});
