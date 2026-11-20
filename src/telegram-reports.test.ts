import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import type { CashEntry, State } from './types';
import {
  uzs, parseOwnerCommand, ownerMenuText, ownerReport,
  kassaReport, mijozQarzReport, taminotQarzReport, buyurtmalarReport, omborReport, OWNER_COMMANDS,
} from './telegram-reports';

function cash(partial: Partial<CashEntry>): CashEntry {
  return {
    id: Math.random().toString(36).slice(2), direction: 'in', amount: 0, account: 'cash',
    toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'manual',
    note: '', number: null, reversalOf: null, createdAt: '2026-11-20T09:00:00Z', ...partial,
  };
}

function fixture(): State {
  const state = emptyState();
  state.customers = [
    { id: 'c1', name: 'Alisher', phone: '', address: '', kind: 'customer', employeeId: null },
    { id: 'c2', name: 'Dilnoza', phone: '', address: '', kind: 'customer', employeeId: null },
  ];
  state.suppliers = [{ id: 's1', name: 'Gigant', phone: '' }];
  state.items = [
    { id: 'm1', name: 'LDSP', unit: 'list', minQty: 10, cost: 1000, customerId: null, kind: 'material', salePrice: 0, lastPurchasePrice: 1000, materialCost: 1000, laborCost: 0, category: null },
    { id: 'm2', name: 'Kromka', unit: 'm', minQty: 0, cost: 100, customerId: null, kind: 'material', salePrice: 0, lastPurchasePrice: 100, materialCost: 100, laborCost: 0, category: null },
  ];
  // 3 листа LDSP на складе при минимуме 10 — дефицит; кромка без минимума — не дефицит.
  state.movements = [
    { id: 'in1', itemId: 'm1', direction: 'in', qty: 3, unitCost: 1000, source: 'inventory', sourceId: '', note: '', createdAt: '2026-11-01T09:00:00Z' },
    { id: 'in2', itemId: 'm2', direction: 'in', qty: 500, unitCost: 100, source: 'inventory', sourceId: '', note: '', createdAt: '2026-11-01T09:00:00Z' },
  ];
  state.cash = [cash({ direction: 'in', amount: 200000, account: 'cash', source: 'manual' })];
  return state;
}

describe('uzs formatter', () => {
  it('groups thousands and appends so‘m', () => {
    expect(uzs(1234567)).toBe('1 234 567 so‘m');
    expect(uzs(0)).toBe('0 so‘m');
    expect(uzs(-5000)).toBe('-5 000 so‘m');
  });
});

describe('parseOwnerCommand', () => {
  it('maps commands, menu and unknown', () => {
    expect(parseOwnerCommand('/kassa')).toBe('kassa');
    expect(parseOwnerCommand('kassa')).toBe('kassa');
    expect(parseOwnerCommand('/start')).toBe('menu');
    expect(parseOwnerCommand('/menu')).toBe('menu');
    expect(parseOwnerCommand('/buyurtmalar extra')).toBe('buyurtmalar');
    expect(parseOwnerCommand('/salom')).toBeNull();
  });
  it('every command in the menu is parseable', () => {
    for (const row of OWNER_COMMANDS) expect(parseOwnerCommand(row.command)).toBe(row.key);
  });
});

describe('reports', () => {
  it('kassa shows cash balance', () => {
    const text = kassaReport(fixture());
    expect(text).toContain('200 000 so‘m');
    expect(text).toContain('Naqd pul');
  });

  it('ombor lists only items below minimum', () => {
    const text = omborReport(fixture());
    expect(text).toContain('LDSP');
    expect(text).not.toContain('Kromka');
  });

  it('empty debts say so', () => {
    expect(mijozQarzReport(fixture())).toContain('Qarzdor mijoz yoʻq');
    expect(taminotQarzReport(fixture())).toContain('Qarz yoʻq');
  });

  it('no active orders message', () => {
    expect(buyurtmalarReport(fixture())).toContain('Faol buyurtma yoʻq');
  });

  it('menu lists every command', () => {
    const menu = ownerMenuText();
    for (const row of OWNER_COMMANDS) expect(menu).toContain(row.command);
  });

  it('ownerReport routes every key without throwing', () => {
    const state = fixture();
    for (const row of OWNER_COMMANDS) expect(typeof ownerReport(state, row.key)).toBe('string');
  });
});
