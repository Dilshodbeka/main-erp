import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { watchRun } from './telegram-owner';
import { ago, dueFindings, isQuietHour, watchDigest, watchFindings } from './watch';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };
const run = (state: State, command: Command, actor = admin): State =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);

const HOUR = 3_600_000;
const later = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);

function virtualOrder(dueInDays = 10) {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Farrux', phone: '', address: 'Urganch', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Gigant', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Fayzullo' });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Kromka', unit: 'piece', salePrice: 3500, workerRate: 100, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'kromka 0.4', unit: 'm', minQty: 50, cost: 1, customerId: null });
  const itemId = state.items[0].id;
  state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId, qty: 100, price: 1 }] });
  const purchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 100 }] });
  const input = {
    kind: 'product', customerId: state.customers[0].id, title: 'TEST kromka', qty: 1, price: 35000, overhead: 0,
    dueDate: dayOf(later(dueInDays * 24)), materials: [{ itemId, qty: 10 }],
    route: [{ operationId: state.operations[0].id, employeeId, rate: 100 }], advance: 0, account: 'cash',
  } satisfies OrderInput;
  state = run(state, { type: 'order.create', input });
  const worker: Actor = { id: employeeId, name: 'Fayzullo', role: 'worker', companyId: state.companyId };
  return { state, orderId: state.orders[0].id, itemId, worker };
}

const keys = (state: State, hours: number) => watchFindings(state, later(hours), dayOf(later(hours))).map(row => row.key.split(':')[0]);

describe('watcher on a virtual order', () => {
  it('stays silent on a fresh draft and speaks once it has waited', () => {
    const v = virtualOrder();
    expect(keys(v.state, 0.5)).toEqual([]);
    expect(keys(v.state, 3)).toEqual(['draft']);
    const text = watchFindings(v.state, later(3), dayOf(later(3)))[0].text;
    expect(text).toContain('qoralama');
    expect(text).toContain('Farrux');
  });

  it('follows the order through the shop: materials, stalled stage, review, ready, transit, debt', () => {
    const v = virtualOrder();
    let state = run(v.state, { type: 'order.launch', orderId: v.orderId });
    expect(keys(state, 2)).toEqual(['issue']);

    state = run(state, { type: 'order.issue', orderId: v.orderId });
    expect(keys(state, 2)).toEqual([]);
    expect(keys(state, 30)).toEqual(['stalled']);
    expect(watchFindings(state, later(30), dayOf(later(30)))[0].text).toContain('Fayzullo');

    const taskId = state.orders[0].route[0].id;
    for (const type of ['work.accept', 'work.start'] as const) state = run(state, { type, orderId: v.orderId, taskId }, v.worker);
    state = run(state, { type: 'work.submit', orderId: v.orderId, taskId, qty: 1, note: '' }, v.worker);
    expect(keys(state, 2)).toEqual(['review']);

    state = run(state, { type: 'work.review', reportId: state.reports[0].id, accept: true });
    expect(state.orders[0].status).toBe('ready');
    expect(keys(state, 2)).toEqual([]);
    expect(keys(state, 30)).toEqual(['ready']);

    const lines = state.orders[0].lines.map(line => ({ lineId: line.id, qty: line.qty }));
    state = run(state, { type: 'shipment.create', orderId: v.orderId, address: 'Urganch', dueDate: dayOf(later(1)), allowDebt: true, lines });
    expect(keys(state, 2)).toEqual([]);
    expect(keys(state, 60)).toEqual(['transit']);

    state = run(state, { type: 'shipment.deliver', shipmentId: state.shipments[0].id });
    expect(keys(state, 24)).toEqual([]);
    const debt = watchFindings(state, later(24 * 9), dayOf(later(24 * 9)));
    expect(debt.map(row => row.key.split(':')[0])).toEqual(['debt']);
    expect(debt[0].text).toContain('35 000 so‘m');

    state = run(state, { type: 'customer.pay', customerId: state.customers[0].id, amount: 35000, account: 'cash' });
    expect(keys(state, 24 * 9)).toEqual([]);
  });

  it('warns the day before the deadline and when it is missed', () => {
    const v = virtualOrder(1);
    expect(keys(v.state, 0.5)).toEqual(['due']);
    expect(keys(v.state, 24 * 3)).toEqual(['overdue', 'draft']);
  });

  it('reports stock below the minimum', () => {
    const v = virtualOrder();
    const state = structuredClone(run(v.state, { type: 'order.launch', orderId: v.orderId }));
    expect(keys(state, 0.2)).toEqual([]);
    state.items.find(item => item.id === v.itemId)!.minQty = 500;
    const found = watchFindings(state, later(0.2), dayOf(later(0.2)));
    expect(found.map(row => row.key.split(':')[0])).toEqual(['stock']);
    expect(found[0].text).toContain('100 m qoldi');
  });
});

describe('watcher delivery rules', () => {
  const finding = (key: string, repeatHours = 24) => ({ key, group: 'orders' as const, text: key, repeatHours });
  it('announces once, then repeats only after the repeat window', () => {
    const now = new Date().toISOString();
    const all = [finding('a'), finding('b', 6)];
    expect(dueFindings(all, {}, now).map(row => row.key)).toEqual(['a', 'b']);
    const sevenHoursAgo = new Date(Date.now() - 7 * HOUR).toISOString();
    expect(dueFindings(all, { a: sevenHoursAgo, b: sevenHoursAgo }, now).map(row => row.key)).toEqual(['b']);
  });
  it('is quiet at night', () => {
    expect(isQuietHour(7)).toBe(true);
    expect(isQuietHour(8)).toBe(false);
    expect(isQuietHour(20)).toBe(false);
    expect(isQuietHour(21)).toBe(true);
  });
  it('a scheduled pass sends nothing at night and nothing twice', () => {
    const v = virtualOrder();
    const snapshot = { state: JSON.parse(JSON.stringify(v.state)) };
    const now = later(3);
    expect(watchRun(snapshot, {}, now, dayOf(now), 3).text).toBeNull();
    const first = watchRun(snapshot, {}, now, dayOf(now), 10);
    expect(first.text).toContain('qoralama');
    expect(first.sentKeys).toEqual(first.activeKeys);
    const sent = Object.fromEntries(first.sentKeys.map(key => [key, now]));
    expect(watchRun(snapshot, sent, later(4), dayOf(later(4)), 11).text).toBeNull();
  });
  it('formats time and the all-clear message', () => {
    expect(ago(0.4)).toBe('1 soatdan kam');
    expect(ago(5.9)).toBe('5 soat');
    expect(ago(49)).toBe('2 kun');
    expect(watchDigest([])).toContain('Hammasi joyida');
  });
});
