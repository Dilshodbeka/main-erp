import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { ownerPush, plainText, workerNotices } from './push-messages';
import { watchRun } from './telegram-owner';
import { allowedPushEndpoint } from './webpush';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };
const run = (state: State, command: Command, actor = admin): State =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A virtual order with one stage for Fayzullo: created as a draft, nothing launched yet. */
function virtualOrder() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Farrux', phone: '', address: 'Urganch', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Gigant', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Fayzullo' });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Kromka', unit: 'piece', salePrice: 3500, workerRate: 100, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'kromka 0.4', unit: 'm', minQty: 0, cost: 1, customerId: null });
  const itemId = state.items[0].id;
  state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId, qty: 100, price: 1 }] });
  const purchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 100 }] });
  const input = {
    kind: 'product', customerId: state.customers[0].id, title: 'TEST kromka', qty: 1, price: 35000, overhead: 0,
    dueDate: inDays(10), materials: [{ itemId, qty: 10 }],
    route: [{ operationId: state.operations[0].id, employeeId, rate: 100 }], advance: 0, account: 'cash',
  } satisfies OrderInput;
  state = run(state, { type: 'order.create', input });
  return { state, orderId: state.orders[0].id, employeeId };
}

describe('push notifications text', () => {
  it('turns Telegram HTML into plain text', () => {
    expect(plainText('⏰ <b>ORD-1</b> Stol &amp; stul · A&lt;B — muddati o‘tgan')).toBe('⏰ ORD-1 Stol & stul · A<B — muddati o‘tgan');
  });

  it('owner gets one notification with the first findings and a count of the rest', () => {
    expect(ownerPush([])).toBeNull();
    const row = (n: number) => ({ key: `draft:${n}`, group: 'orders' as const, repeatHours: 24, text: `📝 <b>ORD-${n}</b> qoralama` });
    expect(ownerPush([row(1)])).toEqual({ title: 'Nazorat: e’tibor bering', body: '📝 ORD-1 qoralama', url: '#/dashboard', tag: 'watch' });
    const many = ownerPush([1, 2, 3, 4, 5, 6].map(row))!;
    expect(many.title).toBe('Nazorat: 6 ta holat');
    expect(many.body.split('\n')).toHaveLength(5);
    expect(many.body).toContain('…va yana 2 ta');
  });
});

describe('worker task notifications on a virtual order', () => {
  it('nothing while the order is a draft or materials are not issued', () => {
    const v = virtualOrder();
    expect(workerNotices(v.state)).toEqual([]);
    const launched = run(v.state, { type: 'order.launch', orderId: v.orderId });
    expect(workerNotices(launched)).toEqual([]);
  });

  it('announces the open stage to its worker once, and stops after the worker accepts it', () => {
    const v = virtualOrder();
    let state = run(v.state, { type: 'order.launch', orderId: v.orderId });
    state = run(state, { type: 'order.issue', orderId: v.orderId });
    const notices = workerNotices(state);
    expect(notices).toHaveLength(1);
    expect(notices[0].employeeId).toBe(v.employeeId);
    expect(notices[0].message.title).toBe('Yangi topshiriq');
    expect(notices[0].message.body).toContain('Kromka');
    expect(notices[0].message.body).toContain('TEST kromka');

    const now = new Date().toISOString();
    const snapshot = { state };
    const first = watchRun(snapshot, {}, now, now.slice(0, 10), 10);
    expect(first.workers.map(row => row.key)).toEqual([notices[0].key]);
    expect(first.activeKeys).toContain(notices[0].key);
    // already announced → not repeated, but still active so the memory row is kept
    const again = watchRun(snapshot, { [notices[0].key]: now }, now, now.slice(0, 10), 10);
    expect(again.workers).toEqual([]);
    expect(again.activeKeys).toContain(notices[0].key);
    // night: nobody is woken up
    expect(watchRun(snapshot, {}, now, now.slice(0, 10), 23).workers).toEqual([]);

    const worker: Actor = { id: v.employeeId, name: 'Fayzullo', role: 'worker', companyId: state.companyId };
    const task = state.orders[0].route[0];
    state = run(state, { type: 'work.accept', orderId: v.orderId, taskId: task.id }, worker);
    expect(workerNotices(state)).toEqual([]);
  });
});

describe('push endpoint allow-list', () => {
  it('accepts browser push services only', () => {
    expect(allowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(allowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(allowedPushEndpoint('https://web.push.apple.com/QGk')).toBe(true);
    expect(allowedPushEndpoint('https://db5p.notify.windows.com/w/?token=1')).toBe(true);
    expect(allowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(allowedPushEndpoint('https://fcm.googleapis.com.evil.uz/x')).toBe(false);
    expect(allowedPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(allowedPushEndpoint('https://localhost:5432/')).toBe(false);
    expect(allowedPushEndpoint('not a url')).toBe(false);
  });
});
