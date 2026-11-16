import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import {
  buildDiagnosticReport, clearDiagnostics, diagnosticChecks, diagnosticFileName, installDiagnostics,
  lastExportAt, LIMIT, listDiagnostics, markExported, recordDiagnostic, reminderDue,
  type DiagnosticStorage,
} from './diagnostics';
import type { Actor, CashEntry, Item, Order, State } from './types';

const admin: Actor = { id: 'u1', name: 'Egasi', role: 'admin', companyId: '12345678-0000-4000-8000-000000000001' };

function memory(): DiagnosticStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

function brokenState(): State {
  const state = emptyState();
  state.companyId = admin.companyId;
  state.revision = 7;
  state.customers = [{ id: 'c1', name: 'Aziza', phone: '+998901112233', address: 'Toshkent', kind: 'customer', employeeId: null }];
  state.suppliers = [{ id: 's1', name: 'Egger', phone: '' }];
  state.employees = [{ id: 'e1', name: 'Kamol', active: true }];
  state.items = [{ id: 'i1', name: 'LDSP', unit: 'list', kind: 'material', minQty: 0, cost: 1000, salePrice: 0, customerId: null, category: null } as Item];
  state.movements = [{
    id: 'm1', itemId: 'i1', direction: 'out', qty: 5, unitCost: 1000,
    source: 'order', sourceId: 'o1', note: '', createdAt: '2026-10-30T09:00:00.000Z',
  }, {
    id: 'm2', itemId: 'ghost', direction: 'in', qty: 1, unitCost: 0,
    source: 'purchase', sourceId: 'x', note: '', createdAt: '2026-10-30T09:00:00.000Z',
  }];
  state.orders = [{
    id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Shkaf', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 5000, overhead: 0, dueDate: '2026-11-09',
    createdAt: '2026-10-30T09:00:00.000Z', status: 'shipped',
    lines: [{ id: 'ol1', kind: 'product', title: 'Shkaf', qty: 1, total: 5000, status: 'shipped' }], materials: [],
    route: [{ id: 't1', lineId: 'ol1', operationId: 'op1', name: 'Kesish', executorKind: 'employee', employeeId: 'e1', supplierId: null, rate: 100, planned: 1, completed: 1, status: 'completed' }],
  } as Order, {
    id: 'o2', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Stol', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-09',
    createdAt: '2026-10-30T09:00:00.000Z', status: 'draft',
    lines: [{ id: 'ol2', kind: 'product', title: 'Stol', qty: 1, total: 1000, status: 'draft' }], materials: [], route: [],
  } as Order, {
    id: 'o3', number: 'ORD-0003', kind: 'series', customerId: '', title: 'Seriya', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 0, overhead: 0, dueDate: '2026-11-09',
    createdAt: '2026-10-30T09:00:00.000Z', status: 'draft',
    lines: [{ id: 'ol3', kind: 'product', title: 'Seriya', qty: 1, total: 0, status: 'draft' }], materials: [], route: [],
  } as Order];
  state.shipments = [{
    id: 'sh1', orderId: 'o1', customerId: 'c1', kind: 'order',
    lines: [{ id: 'l1', itemId: null, description: 'Shkaf', qty: 2, salePrice: 2500, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: '2026-11-01', status: 'delivered',
    createdAt: '2026-10-30T12:00:00.000Z', deliveredAt: '2026-10-31T12:00:00.000Z', reversalOf: null,
  }, {
    id: 'sh2', orderId: null, customerId: 'ghost', kind: 'stock', lines: [],
    address: '', dueDate: '2026-11-01', status: 'shipped',
    createdAt: '2026-10-30T12:00:00.000Z', deliveredAt: null, reversalOf: null,
  }];
  state.cash = [{
    id: 'k1', direction: 'in', amount: 5000, account: 'cash', toAccount: null, source: 'sale',
    sourceId: 'ghost', customerId: 'c1', category: 'sale', note: '', reversalOf: null,
    createdAt: '2026-10-30T12:00:00.000Z',
  } as CashEntry, {
    id: 'k2', direction: 'out', amount: 100, account: 'cash', toAccount: null, source: 'payroll',
    sourceId: 'e1', customerId: null, category: 'payroll', note: '', reversalOf: null,
    createdAt: '2026-10-30T13:00:00.000Z',
  } as CashEntry, {
    id: 'k3', direction: 'in', amount: 100, account: 'cash', toAccount: null, source: 'manual',
    sourceId: null, customerId: null, category: 'storno', note: '', reversalOf: 'ghost',
    createdAt: '2026-10-30T14:00:00.000Z',
  } as CashEntry];
  state.reports = [{
    id: 'r1', orderId: 'o1', taskId: 't1', employeeId: 'e1', qty: 1, status: 'accepted',
    note: '', createdAt: '2026-10-30T10:00:00.000Z',
  }, {
    id: 'r2', orderId: 'ghost', taskId: 't1', employeeId: 'e1', qty: 1, status: 'accepted',
    note: '', createdAt: '2026-10-30T10:00:00.000Z',
  }, {
    id: 'r3', orderId: 'o1', taskId: 'ghost', employeeId: 'e1', qty: 1, status: 'accepted',
    note: '', createdAt: '2026-10-30T10:00:00.000Z',
  }];
  state.payroll = [{
    id: 'p1', employeeId: 'e1', reportId: 'r1', orderId: 'o1', taskId: 't1', amount: 100,
    status: 'accepted', createdAt: '2026-10-30T10:00:00.000Z',
  }, {
    id: 'p2', employeeId: 'e1', reportId: 'ghost', orderId: 'o1', taskId: 't1', amount: 100,
    status: 'accepted', createdAt: '2026-10-30T10:00:00.000Z',
  }];
  return state;
}

const count = (state: State, id: string) => diagnosticChecks(state).find(check => check.id === id)?.count;

describe('diagnostic buffer', () => {
  it('keeps newest first and caps the list', () => {
    const storage = memory();
    for (let index = 1; index <= LIMIT + 5; index++) {
      recordDiagnostic(storage, {
        at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), kind: 'error', message: `xato ${index}`, detail: '',
      });
    }
    const rows = listDiagnostics(storage);
    expect(rows).toHaveLength(LIMIT);
    expect(rows[0].message).toBe(`xato ${LIMIT + 5}`);
  });

  it('records the same message once within ten minutes and again later', () => {
    const storage = memory();
    const base = new Date('2026-10-31T09:00:00.000Z');
    recordDiagnostic(storage, { at: base.toISOString(), kind: 'error', message: 'aloqa yo‘q', detail: '' });
    recordDiagnostic(storage, { at: new Date(base.getTime() + 60_000).toISOString(), kind: 'error', message: 'aloqa yo‘q', detail: '' });
    expect(listDiagnostics(storage)).toHaveLength(1);
    recordDiagnostic(storage, { at: new Date(base.getTime() + 11 * 60_000).toISOString(), kind: 'error', message: 'aloqa yo‘q', detail: '' });
    expect(listDiagnostics(storage)).toHaveLength(2);
  });

  it('captures window errors and unhandled rejections until removed', () => {
    const storage = memory();
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    };
    const stop = installDiagnostics(target, storage);
    listeners.get('error')?.({ message: 'Boom', filename: 'app.js', lineno: 10, colno: 2 });
    expect(listDiagnostics(storage)[0]).toMatchObject({ kind: 'error', message: 'Boom' });
    listeners.get('unhandledrejection')?.({ reason: new Error('Network down') });
    expect(listDiagnostics(storage)[0]).toMatchObject({ kind: 'rejection', message: 'Network down' });
    stop();
    expect(listeners.size).toBe(0);
  });

  it('clears stored errors', () => {
    const storage = memory();
    recordDiagnostic(storage, { at: new Date().toISOString(), kind: 'error', message: 'x', detail: '' });
    clearDiagnostics(storage);
    expect(listDiagnostics(storage)).toEqual([]);
  });
});

describe('weekly reminder', () => {
  it('is due when nothing was exported and after seven days', () => {
    const storage = memory();
    const now = new Date('2026-10-31T09:00:00.000Z');
    expect(reminderDue(storage, now)).toBe(true);
    markExported(storage, now.toISOString());
    expect(lastExportAt(storage)).toBe(now.toISOString());
    expect(reminderDue(storage, new Date('2026-11-06T09:00:00.000Z'))).toBe(false);
    expect(reminderDue(storage, new Date('2026-11-08T09:00:00.000Z'))).toBe(true);
  });
});

describe('data checks', () => {
  it('passes on an empty company', () => {
    expect(diagnosticChecks(emptyState()).every(check => check.count === 0)).toBe(true);
  });

  it('finds every kind of broken link', () => {
    const state = brokenState();
    expect(count(state, 'stock-negative')).toBe(1);
    expect(count(state, 'shipment-over')).toBe(1);
    expect(count(state, 'cash-links')).toBe(1);
    expect(count(state, 'cash-reversal')).toBe(1);
    expect(count(state, 'payroll-links')).toBe(1);
    expect(count(state, 'report-links')).toBe(2);
    expect(count(state, 'order-numbers')).toBe(1);
    expect(count(state, 'movement-items')).toBe(1);
    expect(count(state, 'shipment-customer')).toBe(1);
    expect(count(state, 'order-customer')).toBe(0);
  });
});

describe('report', () => {
  it('names the file by date', () => {
    expect(diagnosticFileName('2026-10-31T10:20:00.000Z')).toBe('aliya-diagnostics-2026-10-31.txt');
  });

  it('includes counts, checks and errors but no names, phones or amounts', () => {
    const state = brokenState();
    const report = buildDiagnosticReport({
      state, actor: admin, mode: 'cloud', build: 'build-123',
      entries: [
        { at: '2026-10-31T09:00:00.000Z', kind: 'error', message: 'Server bilan aloqa yo‘q', detail: 'snapshot' },
        { at: '2026-10-31T09:05:00.000Z', kind: 'error', message: 'Chegara 5000 dan oshdi', detail: 'hisob 998901112233' },
      ],
      sync: { online: false, pending: [{ status: 'rejected', type: 'work.submit', error: 'Konflikt' }] },
      at: '2026-10-31T10:20:00.000Z',
    });
    expect(report).toContain('ALIYA ERP');
    expect(report).toContain('Yig‘ilma: build-123');
    expect(report).toContain('Reviziya: 7');
    expect(report).toContain('[!]');
    expect(report).toContain('Server bilan aloqa yo‘q');
    expect(report).toContain('[rejected] work.submit: Konflikt');
    expect(report).toContain('[son]');
    expect(report).not.toContain('Aziza');
    expect(report).not.toContain('+998');
    expect(report).not.toContain('5000');
  });
});
