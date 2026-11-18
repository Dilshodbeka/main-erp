import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { DEMO_COMPANY_ID, migrateState } from './migrations';
import type { Customer, State } from './types';

describe('tenant state', () => {
  it('creates state bound to the demo company', () => {
    const state = emptyState();
    expect(state.version).toBe(4);
    expect(state.companyId).toBe(DEMO_COMPANY_ID);
  });

  it('migrates v1 without dropping journals', () => {
    const { companyId: _companyId, ...legacyState } = JSON.parse(JSON.stringify(emptyState())) as State;
    const legacy: unknown = { ...legacyState, version: 1 };
    const migrated = migrateState(legacy);
    expect(migrated.companyId).toBe(DEMO_COMPANY_ID);
    expect(migrated.movements).toEqual((legacy as State).movements);
    expect(migrated.cash).toEqual((legacy as State).cash);
  });

  it('expands legacy operations and adds the machine catalog', () => {
    const { companyId: _companyId, machines: _machines, ...legacyState } = JSON.parse(JSON.stringify(emptyState())) as State;
    const legacy: Record<string, unknown> = {
      ...legacyState,
      version: 1,
      employees: [{ id: 'employee', name: 'Worker', active: true }],
      operations: [{ id: 'operation', name: 'Cut', rate: 7 }],
    };
    const migrated = migrateState(legacy);
    expect(migrated.machines).toEqual([]);
    expect(migrated.operations[0]).toEqual({
      id: 'operation', name: 'Cut', unit: 'piece', salePrice: 7, workerRate: 7,
      standardMinutes: 0, machineId: null, employeeIds: ['employee'], active: true, autoAccept: true, norms: [],
      workshopId: '00000000-0000-4000-8000-00000000b001',
    });
  });

  it('keeps manual acceptance that a saved operation turned off', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as State;
    source.operations = [{
      id: 'operation', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000,
      standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false, norms: [],
    }];
    expect(migrateState(source).operations[0].autoAccept).toBe(false);
  });

  it('leaves a submitted report waiting for the owner when saved data is read back', () => {
    const saved: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      employees: [{ id: 'employee', name: 'Worker', active: true }],
      operations: [{
        id: 'operation', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000,
        standardMinutes: 0, machineId: null, employeeIds: ['employee'], active: true, autoAccept: false, norms: [],
      }],
      orders: [{
        id: 'order', number: 'ORD-0005', kind: 'service', customerId: 'customer', title: 'Fasadlarni bo‘yash',
        qty: 12, price: 960000, overhead: 0, dueDate: '2026-11-21', createdAt: '', status: 'production',
        materials: [],
        route: [{ id: 'task', operationId: 'operation', name: 'Jilolash', employeeId: 'employee', planned: 12, completed: 0, rate: 30000, status: 'submitted' }],
      }],
      reports: [{ id: 'report', orderId: 'order', taskId: 'task', employeeId: 'employee', qty: 12, status: 'submitted', note: '', createdAt: '2026-11-14T00:00:00Z' }],
      payroll: [{ id: 'pay', employeeId: 'employee', reportId: 'report', orderId: 'order', taskId: 'task', amount: 360000, status: 'pending', createdAt: '' }],
    };
    const migrated = migrateState(saved);
    expect(migrated.reports[0].status).toBe('submitted');
    expect(migrated.orders[0].route[0]).toMatchObject({ completed: 0, status: 'submitted' });
    expect(migrated.payroll[0]).toMatchObject({ status: 'pending' });
    expect(migrated.orders[0].status).toBe('production');
  });

  it('accepts results that were left waiting for manual review', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 2,
      employees: [{ id: 'employee', name: 'Worker', active: true }],
      operations: [{ id: 'operation', name: 'Cut', rate: 2, employeeIds: ['employee'] }],
      orders: [{
        id: 'order', number: 'ORD-0001', kind: 'product', customerId: 'customer', title: 'Kitchen',
        qty: 3, price: 100, overhead: 0, dueDate: '2026-11-05', createdAt: '',
        status: 'production', materials: [{ id: 'm', itemId: 'i', qty: 1, estimatedCost: 0, issued: true, actualCost: 0 }],
        route: [{ id: 'task', operationId: 'operation', name: 'Cut', employeeId: 'employee', planned: 3, completed: 0, rate: 2, status: 'submitted' }],
      }],
      reports: [{ id: 'report', orderId: 'order', taskId: 'task', employeeId: 'employee', qty: 3, status: 'submitted', note: '', createdAt: '2026-10-02T00:00:00Z' }],
      payroll: [{ id: 'pay', employeeId: 'employee', reportId: 'report', orderId: 'order', taskId: 'task', amount: 6, status: 'pending', createdAt: '' }],
    };
    const migrated = migrateState(legacy);
    expect(migrated.operations[0].autoAccept).toBe(true);
    expect(migrated.reports[0].status).toBe('accepted');
    expect(migrated.orders[0].route[0]).toMatchObject({ completed: 3, status: 'completed' });
    expect(migrated.payroll[0]).toMatchObject({ status: 'accepted', amount: 6 });
    expect(migrated.orders[0].status).toBe('ready');
  });

  it('migrates v2 items to typed rows with purchase price history', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 2,
      items: [{ id: 'item', name: 'LDSP', unit: 'sheet', minQty: 0, cost: 10, customerId: null }],
      purchases: [{
        id: 'purchase', number: 'PUR-0001', supplierId: 'supplier', createdAt: '',
        lines: [
          { id: 'first', itemId: 'item', qty: 5, price: 7, received: 5 },
          { id: 'second', itemId: 'item', qty: 5, price: 9, received: 2 },
          { id: 'unused', itemId: 'item', qty: 5, price: 15, received: 0 },
        ],
      }],
    };
    const migrated = migrateState(legacy);
    expect(migrated.version).toBe(4);
    expect(migrated.items[0]).toMatchObject({ kind: 'material', salePrice: 0, materialCost: 10, laborCost: 0, lastPurchasePrice: 9 });
    expect(migrated.purchases[0].lines[0]).toMatchObject({ previousPurchasePrice: 0, newPurchasePrice: 0, previousAverageCost: 0, newAverageCost: 0 });
  });

  it('normalizes customer kinds and expands legacy order shipments into lines', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 1,
      customers: [
        { id: 'customer', name: 'Клиент', phone: '', address: '' },
        { id: 'shop', name: 'Магазин', phone: '', address: '', kind: 'shop', employeeId: null },
      ],
      orders: [{
        id: 'order', number: 'ORD-0001', kind: 'product', customerId: 'customer', title: 'Кухня',
        qty: 2, price: 1000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z',
        status: 'delivered', materials: [{ id: 'm', itemId: 'i', qty: 1, estimatedCost: 100, issued: true, actualCost: 100 }], route: [],
      }],
      payroll: [{ id: 'p', employeeId: 'e', reportId: 'r', orderId: 'order', amount: 100, status: 'accepted', createdAt: '2026-10-02T00:00:00Z' }],
      shipments: [{ id: 'ship', orderId: 'order', qty: 2, address: 'Склад', driver: 'Водитель', dueDate: '2026-11-05', status: 'delivered', createdAt: '2026-10-03T00:00:00Z', deliveredAt: '2026-10-04T00:00:00Z' }],
    };
    const migrated = migrateState(legacy);
    expect(migrated.customers.map(customer => customer.kind)).toEqual(['customer', 'shop']);
    expect(migrated.shipments[0]).toMatchObject({
      orderId: 'order', customerId: 'customer', kind: 'order', address: 'Склад', status: 'delivered', reversalOf: null,
    });
    expect(migrated.shipments[0].lines).toHaveLength(1);
    expect(migrated.shipments[0].lines[0]).toMatchObject({
      itemId: null, qty: 2, salePrice: 500, unitCost: 100, materialCost: 50, laborCost: 50,
    });
  });

  it('expands every legacy order into one position that keeps its own rows', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 3,
      orders: [{
        id: 'order', number: 'ORD-0001', kind: 'product', customerId: 'customer', title: 'Кухня',
        outputItemId: null, recipeVersionId: null, substitutions: {},
        qty: 2, price: 1000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'shipped',
        materials: [{ id: 'm', itemId: 'i', qty: 1, estimatedCost: 100, issued: true, actualCost: 100 }],
        route: [{ id: 't', operationId: 'o', name: 'Cut', employeeId: 'e', rate: 2, planned: 2, completed: 2, status: 'completed' }],
      }],
    };
    const migrated = migrateState(legacy);
    expect(migrated.version).toBe(4);
    expect(migrated.orders[0].lines).toEqual([
      { id: expect.any(String), kind: 'product', title: 'Кухня', qty: 2, total: 1000, status: 'shipped' },
    ]);
    const lineId = migrated.orders[0].lines[0].id;
    expect(migrated.orders[0].materials[0].lineId).toBe(lineId);
    expect(migrated.orders[0].route[0].lineId).toBe(lineId);
    expect(migrateState(migrated).orders[0]).toEqual(migrated.orders[0]);
  });

  it('keeps already expanded shipments and fills their customer from the order', () => {
    const base = JSON.parse(JSON.stringify(emptyState())) as State;
    base.customers = [{ id: 'customer', name: 'Клиент', phone: '', address: '', kind: 'customer', employeeId: null }];
    base.orders = [{
      id: 'order', number: 'ORD-0001', kind: 'product', customerId: 'customer', title: 'Кухня',
      outputItemId: null, recipeVersionId: null, substitutions: {},
      qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
      lines: [{ id: 'line', kind: 'product', title: 'Кухня', qty: 1, total: 1000, status: 'delivered' }],
      materials: [], route: [],
    }];
    base.shipments = [{
      id: 'ship', orderId: 'order', customerId: '', kind: 'order',
      lines: [{ id: 'line', itemId: null, description: 'Кухня', qty: 1, salePrice: 1000, unitCost: 0, materialCost: 0, laborCost: 0 }],
      address: '', dueDate: '', status: 'delivered', createdAt: '', deliveredAt: null, reversalOf: null,
    }];
    const migrated = migrateState(base);
    expect(migrated.shipments[0].customerId).toBe('customer');
    expect(migrated.shipments[0].lines).toEqual(base.shipments[0].lines);
  });

  it('reassigns legacy order payments to the customer sale ledger', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 2,
      customers: [{ id: 'customer', name: 'Клиент', phone: '', address: '' }],
      orders: [{
        id: 'order', number: 'ORD-0001', kind: 'product', customerId: 'customer', title: 'Кухня',
        qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'draft',
        materials: [], route: [],
      }],
      cash: [
        { id: 'legacy', direction: 'in', amount: 300, account: 'cash', toAccount: null, source: 'order', sourceId: 'order', category: 'order', note: '', reversalOf: null, createdAt: '2026-10-02T00:00:00Z' },
        { id: 'manual', direction: 'in', amount: 100, account: 'cash', toAccount: null, source: 'manual', sourceId: null, category: '', note: '', reversalOf: null, createdAt: '2026-10-02T00:00:00Z' },
      ],
    };
    const migrated = migrateState(legacy);
    expect(migrated.cash[0]).toMatchObject({ source: 'sale', sourceId: 'order', customerId: 'customer' });
    expect(migrated.cash[1]).toMatchObject({ source: 'manual', customerId: null });
  });

  it('rejects malformed state', () => {
    expect(() => migrateState({ version: 2, cash: null })).toThrow('Ma’lumotlar formati noto‘g‘ri');
  });

  it('backfills cash entries without a document number to null and keeps existing numbers', () => {
    const legacy: Record<string, unknown> = {
      ...JSON.parse(JSON.stringify(emptyState())),
      version: 4,
      cash: [
        { id: 'a', direction: 'in', amount: 100, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: '', note: '', reversalOf: null, createdAt: '' },
        { id: 'b', direction: 'out', amount: 50, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: '', note: '', reversalOf: null, createdAt: '', number: 'RKO-0007' },
      ],
    };
    const migrated = migrateState(legacy);
    expect(migrated.cash[0].number).toBeNull();
    expect(migrated.cash[1].number).toBe('RKO-0007');
  });

  it('adds salaryPlans to a version 4 snapshot that predates salaries', () => {
    const { salaryPlans: _salaryPlans, ...withoutPlans } = JSON.parse(JSON.stringify(emptyState())) as State;
    expect((withoutPlans as Record<string, unknown>).salaryPlans).toBeUndefined();
    const migrated = migrateState(withoutPlans);
    expect(migrated.salaryPlans).toEqual([]);
  });

  it('adds expensePlans to a version 4 snapshot that predates monthly expenses', () => {
    const { expensePlans: _expensePlans, ...withoutPlans } = JSON.parse(JSON.stringify(emptyState())) as State & { expensePlans?: unknown };
    expect((withoutPlans as Record<string, unknown>).expensePlans).toBeUndefined();
    const migrated = migrateState(withoutPlans);
    expect(migrated.expensePlans).toEqual([]);
  });

  it('adds loans to a version 4 snapshot that predates loans', () => {
    const { loans: _loans, ...withoutLoans } = JSON.parse(JSON.stringify(emptyState())) as State & { loans?: unknown };
    expect((withoutLoans as Record<string, unknown>).loans).toBeUndefined();
    const migrated = migrateState(withoutLoans);
    expect(migrated.loans).toEqual([]);
  });

  it('adds routeTemplates to a version 4 snapshot that predates route templates', () => {
    const { routeTemplates: _routeTemplates, ...withoutTemplates } = JSON.parse(JSON.stringify(emptyState())) as State & { routeTemplates?: unknown };
    expect((withoutTemplates as Record<string, unknown>).routeTemplates).toBeUndefined();
    const migrated = migrateState(withoutTemplates);
    expect(migrated.routeTemplates).toEqual([]);
  });

  it('adds workerDeductions and normalizes customer employeeId for old snapshots', () => {
    const snapshot = JSON.parse(JSON.stringify(emptyState())) as Omit<State, 'workerDeductions'> & { workerDeductions?: unknown };
    delete snapshot.workerDeductions;
    snapshot.customers.push({ id: 'customer', name: 'Клиент', phone: '', address: '', kind: 'customer', employeeId: null } as Customer);
    const migrated = migrateState(snapshot);
    expect((migrated as State & { workerDeductions?: unknown }).workerDeductions).toEqual([]);
    expect((migrated.customers[0] as Customer & { employeeId?: unknown }).employeeId).toBeNull();
  });

  it('normalizes a legacy employee route without changing money or status', () => {
    const state = emptyState();
    state.orders = [{
      id: 'o1', number: 'ORD-0001', kind: 'service', customerId: 'c1', title: 'Kesish',
      outputItemId: null, recipeVersionId: null, substitutions: {}, qty: 2, price: 100000,
      overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-06T09:00:00.000Z', status: 'production',
      lines: [{ id: 'l1', kind: 'service', title: 'Kesish', qty: 2, total: 100000, status: 'production' }],
      materials: [],
      route: [{
        id: 't1', lineId: 'l1', operationId: 'op1', name: 'Kesish', employeeId: 'e1', rate: 5000,
        salePrice: 50000, standardMinutes: 15, planned: 2, completed: 0, status: 'assigned',
      }],
      drawingUrl: null,
    } as unknown as State['orders'][number]];

    const migrated = migrateState(JSON.parse(JSON.stringify(state)));
    expect(migrated.orders[0].route[0]).toMatchObject({
      executorKind: 'employee', employeeId: 'e1', supplierId: null,
      rate: 5000, salePrice: 50000, planned: 2, completed: 0, status: 'assigned',
    });
    expect(migrateState(migrated).orders[0]).toEqual(migrated.orders[0]);
  });
});

describe('support tickets collection', () => {
  it('fills tickets for snapshots saved before the support center', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete source.tickets;
    const migrated = migrateState(source);
    expect(migrated.tickets).toEqual([]);
  });
});

describe('defects collection', () => {
  it('fills defects for snapshots saved before the defect journal', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete source.defects;
    expect(migrateState(source).defects).toEqual([]);
  });
});
