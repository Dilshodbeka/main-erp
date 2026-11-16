import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { nextStep, pageGuide } from './guide';
import type { Actor, CashEntry, Item, Operation, Order, State } from './types';

const admin: Actor = { id: 'u1', name: 'Egasi', role: 'admin', companyId: 'c1' };
const worker: Actor = { id: 'e1', name: 'Kamol', role: 'worker', companyId: 'c1' };
const otherWorker: Actor = { id: 'e2', name: 'Dilnoza', role: 'worker', companyId: 'c1' };

function fixture(): State {
  const state = emptyState();
  state.customers = [{ id: 'c1', name: 'Aziza', phone: '', address: '', kind: 'customer', employeeId: null }];
  state.suppliers = [{ id: 's1', name: 'Egger', phone: '' }];
  state.employees = [{ id: 'e1', name: 'Kamol', active: true }];
  state.operations = [{
    id: 'op1', name: 'Kesish', unit: 'piece', salePrice: 1000, workerRate: 100, standardMinutes: 10,
    machineId: null, employeeIds: ['e1'], active: true, autoAccept: true,
  } as Operation];
  state.items = [{
    id: 'i1', name: 'LDSP', unit: 'list', kind: 'material', minQty: 0, cost: 1000,
    salePrice: 0, customerId: null, category: null,
  } as Item, {
    id: 'i2', name: 'Shkaf', unit: 'dona', kind: 'finished', minQty: 0, cost: 5000,
    salePrice: 9000, customerId: null, category: null,
  } as Item];
  state.orders = [{
    id: 'o1', number: 'ORD-0001', kind: 'product', customerId: 'c1', title: 'Shkaf', outputItemId: null,
    recipeVersionId: null, substitutions: {}, qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-09',
    createdAt: '2026-10-30T09:00:00.000Z', status: 'production',
    lines: [{ id: 'ol1', kind: 'product', title: 'Shkaf', qty: 1, total: 1000, status: 'production' }], materials: [],
    route: [{
      id: 't1', lineId: 'ol1', operationId: 'op1', name: 'Kesish', executorKind: 'employee', employeeId: 'e1',
      supplierId: null, rate: 100, salePrice: 1000,
      standardMinutes: 10, planned: 1, completed: 1, status: 'completed',
    }],
  } as Order];
  state.reports = [{
    id: 'r1', orderId: 'o1', taskId: 't1', employeeId: 'e1', qty: 1, status: 'accepted',
    note: '', createdAt: '2026-10-30T10:00:00.000Z',
  }];
  state.payroll = [{
    id: 'p1', employeeId: 'e1', reportId: 'r1', orderId: 'o1', taskId: 't1', amount: 100,
    status: 'accepted', createdAt: '2026-10-30T10:00:00.000Z',
  }];
  state.cash = [{
    id: 'k1', direction: 'out', amount: 100, account: 'cash', toAccount: null, source: 'payroll',
    sourceId: 'e1', customerId: null, category: 'Ish haqi', note: '', reversalOf: null,
    createdAt: '2026-10-30T11:00:00.000Z',
  } as CashEntry];
  state.shipments = [{
    id: 'sh1', orderId: 'o1', customerId: 'c1', kind: 'order',
    lines: [{ id: 'l1', itemId: null, description: 'Shkaf', qty: 1, salePrice: 1000, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: '2026-11-01', status: 'delivered',
    createdAt: '2026-10-30T12:00:00.000Z', deliveredAt: '2026-10-31T12:00:00.000Z', reversalOf: null,
  }];
  state.cash.push({
    id: 'k2', direction: 'in', amount: 1000, account: 'cash', toAccount: null, source: 'sale',
    sourceId: 'sh1', customerId: 'c1', category: 'Mijoz to‘lovi', note: '', number: null, reversalOf: null,
    createdAt: '2026-10-30T12:00:00.000Z',
  });
  return state;
}

describe('page guide', () => {
  it('starts an empty company with a customer and blocks the order step', () => {
    const guide = pageGuide(emptyState(), 'dashboard', admin);
    expect(nextStep(guide)?.id).toBe('customers');
    const order = guide.steps.find(step => step.id === 'order');
    expect(order?.done).toBe(false);
    expect(order?.blocked).toBe(true);
  });

  it('unblocks the order once customer, operations, employees and items exist', () => {
    const state = fixture();
    state.orders = [];
    state.reports = [];
    state.payroll = [];
    state.shipments = [];
    state.cash = [];
    const guide = pageGuide(state, 'dashboard', admin);
    const order = guide.steps.find(step => step.id === 'order');
    expect(order).toMatchObject({ done: false, blocked: false });
    expect(nextStep(guide)?.id).toBe('order');
  });

  it('marks the sales guide complete when an order is created and paid', () => {
    const guide = pageGuide(fixture(), 'orders', admin);
    expect(guide.steps.filter(step => !step.done)).toEqual([]);
    expect(nextStep(guide)).toBeNull();
  });

  it('keeps the shop stock sale blocked until a shop and finished goods exist', () => {
    const blocked = pageGuide(fixture(), 'shops', admin);
    expect(blocked.steps.find(step => step.id === 'stockSale')?.blocked).toBe(true);
    const state = fixture();
    state.customers[0].kind = 'shop';
    const ready = pageGuide(state, 'shops', admin);
    expect(ready.steps.find(step => step.id === 'stockSale')?.blocked).toBe(false);
  });

  it('shows a worker only their own tasks and results', () => {
    const state = fixture();
    const own = pageGuide(state, 'production', worker);
    expect(own.steps.find(step => step.id === 'assigned')?.done).toBe(true);
    expect(own.steps.find(step => step.id === 'submitted')?.done).toBe(true);

    const stranger = pageGuide(state, 'production', otherWorker);
    expect(stranger.steps.find(step => step.id === 'assigned')?.done).toBe(false);
    expect(nextStep(stranger)?.id).toBe('assigned');
  });

  it('keeps salary calculations out of the worker guide', () => {
    const guide = pageGuide(fixture(), 'people', worker);
    const text = [guide.purpose, guide.outcome, ...guide.steps.map(step => `${step.title} ${step.detail}`)].join(' ');
    expect(guide.page).toBe('production');
    expect(text).not.toContain('ish haqi');
    expect(text).not.toContain('stavka');
  });

  it('has a guide with steps and an outcome for every page', () => {
    const pages = ['dashboard', 'orders', 'history', 'shops', 'production', 'warehouse', 'series', 'purchases', 'people', 'logistics', 'cash', 'analytics', 'settings'];
    for (const page of pages) {
      const guide = pageGuide(fixture(), page, admin);
      expect(guide.steps.length, page).toBeGreaterThan(0);
      expect(guide.purpose.length, page).toBeGreaterThan(0);
      expect(guide.outcome.length, page).toBeGreaterThan(0);
      expect(guide.steps.every(step => step.title.length > 0 && step.detail.length > 0), page).toBe(true);
    }
  });
});
