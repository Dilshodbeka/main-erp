import { describe, expect, it } from 'vitest';
import { applyCommand, cashBalance, emptyState, orderDebt, stockQty } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { ownerReply } from './telegram-owner';
import { orderCode } from './telegram-actions';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };
const TODAY = '2026-11-20';

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

/** What the Edge Function does: ask the bot, run the returned commands, then render the follow-up. */
function bot(state: State, input: string): { state: State; text: string } {
  const answer = ownerReply(input, { actor: admin, state: structuredClone(state) }, TODAY, true);
  let next = state;
  for (const command of answer.commands ?? []) next = run(next, command);
  const tail = answer.followUp ? `\n\n${ownerReply(answer.followUp, { actor: admin, state: structuredClone(next) }, TODAY, true).text}` : '';
  return { state: next, text: answer.text + tail };
}

/** Pulls the tappable confirm command out of a preview message. */
const confirmOf = (text: string): string => /\/ok_[a-z0-9_]+/.exec(text)![0];

function virtualOrder() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'TEST <mijoz>', phone: '', address: 'Urganch', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Gigant', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Fayzullo' });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Kromka', unit: 'piece', salePrice: 3500, workerRate: 100, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
  state = run(state, { type: 'item.create', name: 'kromka 0.4', unit: 'm', minQty: 0, cost: 1, customerId: null });
  const itemId = state.items[0].id;
  state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId, qty: 1000, price: 1 }] });
  const purchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: 1000 }] });
  const input = {
    kind: 'product', customerId: state.customers[0].id, title: 'TEST kromka', qty: 1, price: 35000, overhead: 0,
    dueDate: '2026-11-27', materials: [{ itemId, qty: 10 }],
    route: [{ operationId: state.operations[0].id, employeeId, rate: 100 }], advance: 0, account: 'cash',
  } satisfies OrderInput;
  state = run(state, { type: 'order.create', input });
  const order = state.orders[0];
  const worker: Actor = { id: employeeId, name: 'Fayzullo', role: 'worker', companyId: state.companyId };
  return { state, code: orderCode(order.number), orderId: order.id, itemId, worker };
}

describe('owner bot actions on a virtual order', () => {
  it('actions are off by default: the bot stays report-only', () => {
    const v = virtualOrder();
    const raw = { actor: admin, state: structuredClone(v.state) };
    expect(ownerReply(`/sehga_${v.code}`, raw, TODAY).text).toContain('tanilmadi');
    expect(ownerReply(`/ok_sehga_${v.code}_r${v.state.revision}`, raw, TODAY).commands).toBeUndefined();
    expect(ownerReply('/buyurtmalar', raw, TODAY).text).not.toContain('/b_');
  });

  it('lists the order and opens its card with the launch action', () => {
    const v = virtualOrder();
    expect(bot(v.state, '/buyurtmalar').text).toContain(`/b_${v.code}`);
    const card = bot(v.state, `/b_${v.code}`).text;
    expect(card).toContain(`/sehga_${v.code}`);
    expect(card).toContain('TEST &lt;mijoz&gt;');
    expect(card).not.toContain('/yuborish_');
  });

  it('a preview changes nothing; only the confirm runs the command', () => {
    const v = virtualOrder();
    const preview = bot(v.state, `/sehga_${v.code}`);
    expect(preview.state).toBe(v.state);
    expect(preview.state.orders[0].status).toBe('draft');
    const done = bot(v.state, confirmOf(preview.text));
    expect(done.state.orders[0].status).toBe('production');
  });

  it('walks launch → issue → work → ship → deliver → payment with correct stock, debt and cash', () => {
    const v = virtualOrder();
    let state = v.state;

    state = bot(state, confirmOf(bot(state, `/sehga_${v.code}`).text)).state;
    expect(stockQty(state, v.itemId)).toBe(1000);

    const issued = bot(state, confirmOf(bot(state, `/berish_${v.code}`).text));
    state = issued.state;
    expect(stockQty(state, v.itemId)).toBe(990);
    expect(issued.text).not.toContain('/berish_');

    const taskId = state.orders[0].route[0].id;
    state = run(state, { type: 'work.accept', orderId: v.orderId, taskId }, v.worker);
    state = run(state, { type: 'work.start', orderId: v.orderId, taskId }, v.worker);
    state = run(state, { type: 'work.submit', orderId: v.orderId, taskId, qty: 1, note: '' }, v.worker);
    expect(state.orders[0].status).toBe('ready');

    const shipPreview = bot(state, `/yuborish_${v.code}`).text;
    expect(shipPreview).toContain('qarz bilan yuboriladi');
    state = bot(state, confirmOf(shipPreview)).state;
    expect(state.orders[0].status).toBe('shipped');

    state = bot(state, confirmOf(bot(state, `/yetkazildi_${v.code}`).text)).state;
    expect(state.orders[0].status).toBe('delivered');
    expect(orderDebt(state, v.orderId)).toBe(35000);

    const payPreview = bot(state, `/naqd_${v.code}`).text;
    expect(payPreview).toContain('35 000 so‘m');
    const paid = bot(state, confirmOf(payPreview));
    state = paid.state;
    expect(cashBalance(state, 'cash')).toBe(35000);
    expect(orderDebt(state, v.orderId)).toBe(0);
    expect(paid.text).not.toContain('/tolov_');
  });

  it('a confirm cannot run twice: the second tap is rejected as stale', () => {
    const v = virtualOrder();
    let state = v.state;
    for (const step of ['sehga', 'berish']) state = bot(state, confirmOf(bot(state, `/${step}_${v.code}`).text)).state;
    const taskId = state.orders[0].route[0].id;
    for (const type of ['work.accept', 'work.start'] as const) state = run(state, { type, orderId: v.orderId, taskId }, v.worker);
    state = run(state, { type: 'work.submit', orderId: v.orderId, taskId, qty: 1, note: '' }, v.worker);
    const confirm = confirmOf(bot(state, `/bank_${v.code}`).text);
    const first = bot(state, confirm);
    expect(cashBalance(first.state, 'bank')).toBe(35000);
    const second = bot(first.state, confirm);
    expect(second.state).toBe(first.state);
    expect(second.text).toContain('oʻzgargan');
    expect(cashBalance(second.state, 'bank')).toBe(35000);
  });

  it('custom typed payment is previewed with the typed amount', () => {
    const v = virtualOrder();
    let state = bot(v.state, confirmOf(bot(v.state, `/sehga_${v.code}`).text)).state;
    const preview = bot(state, `tolov ${v.code} 20000 bank`).text;
    expect(preview).toContain('20 000 so‘m');
    expect(preview).toContain('Bank / karta');
    state = bot(state, confirmOf(preview)).state;
    expect(cashBalance(state, 'bank')).toBe(20000);
  });

  it('refuses actions that do not apply and unknown orders', () => {
    const v = virtualOrder();
    expect(bot(v.state, `/yuborish_${v.code}`).text).toContain('mavjud emas');
    expect(bot(v.state, '/b_ord9999').text).toContain('topilmadi');
    expect(bot(v.state, `/ok_sehga_${v.code}_r0`).text).toContain('oʻzgargan');
    expect(bot(v.state, '/bekor').text).toContain('Bekor qilindi');
  });
});
