import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { createDemo } from './seed';
import {
  buildInsights, fill, INSIGHT_TEXTS, insightDigest, insightSummary, insightText, isHidden, markUntil, visibleInsights,
  type Insight,
} from './insights';
import { createTranslator } from './translate';
import ru from './locales/ru.json';
import type { Actor, Command, OrderInput, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };
const run = (state: State, command: Command, actor = admin): State =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);
const check = (state: State, days = 0): Insight[] => buildInsights(state, at(days), dayOf(at(days)));
const find = (rows: Insight[], prefix: string) => rows.find(row => row.key.startsWith(prefix));

/** A small virtual workshop: a client, two workers, one operation, one material on stock. */
function workshop(options: { stock?: number; cost?: number; minutes?: number } = {}) {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Farrux', phone: '', address: 'Urganch', kind: 'customer' });
  state = run(state, { type: 'supplier.create', name: 'Gigant', phone: '' });
  state = run(state, { type: 'employee.create', name: 'Fayzullo' });
  state = run(state, { type: 'employee.create', name: 'Sardor' });
  const [fayzullo, sardor] = state.employees.map(row => row.id);
  state = run(state, { type: 'operation.create', name: 'Kromka', unit: 'piece', salePrice: 3500, workerRate: 1000, standardMinutes: options.minutes ?? 0, machineId: null, employeeIds: [fayzullo, sardor], active: true, autoAccept: false });
  state = run(state, { type: 'item.create', name: 'LDSP oq', unit: 'list', minQty: 0, cost: 0, customerId: null });
  const itemId = state.items[0].id;
  state = run(state, { type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [{ itemId, qty: options.stock ?? 100, price: options.cost ?? 50_000 }] });
  const purchase = state.purchases.at(-1)!;
  state = run(state, { type: 'purchase.receive', purchaseId: purchase.id, lines: [{ lineId: purchase.lines[0].id, qty: options.stock ?? 100 }] });
  const order = (over: Partial<OrderInput> & { stages?: number; employeeId?: string } = {}): OrderInput => ({
    kind: 'product', customerId: state.customers[0].id, title: 'TEST shkaf', qty: 1, price: 1_000_000, overhead: 0,
    dueDate: dayOf(at(20)), materials: [{ itemId, qty: 2 }],
    route: Array.from({ length: over.stages ?? 1 }, () => ({ operationId: state.operations[0].id, employeeId: over.employeeId ?? fayzullo, rate: 1000 })),
    advance: 0, account: 'cash', ...over,
  });
  return { state, itemId, fayzullo, sardor, order };
}

/** Creates, launches and issues materials for an order; returns the new state and the order id. */
function inProduction(state: State, input: OrderInput): { state: State; orderId: string } {
  let next = run(state, { type: 'order.create', input });
  const orderId = next.orders.at(-1)!.id;
  next = run(next, { type: 'order.launch', orderId });
  next = run(next, { type: 'order.issue', orderId });
  return { state: next, orderId };
}

describe('stock: frozen money', () => {
  it('a material nobody touches for two months becomes "dead stock" with its value and a sale estimate', () => {
    const w = workshop({ stock: 100, cost: 50_000 });
    expect(find(check(w.state, 30), 'dead-stock')).toBeUndefined();
    const dead = find(check(w.state, 70), 'dead-stock')!;
    expect(dead.priority).toBe('growth');
    expect(dead.effect).toBe(5_000_000);
    expect(dead.title).toBe('Harakatsiz zaxira: 1 ta pozitsiya');
    expect(dead.advice).toContain('20% chegirma');
    expect(dead.advice).toMatch(/4\D000\D000 so‘m/);
    expect(dead.list).toEqual([['LDSP oq', 100, 'list', 5_000_000, 4_000_000, 70]]);
  });

  it('a material planned in an active order is not dead', () => {
    const w = workshop();
    const state = run(w.state, { type: 'order.create', input: w.order() });
    expect(find(check(state, 70), 'dead-stock')).toBeUndefined();
  });

  it('small leftovers are ignored', () => {
    const w = workshop({ stock: 1, cost: 20_000 });
    expect(find(check(w.state, 90), 'dead-stock')).toBeUndefined();
  });

  it('warns when a material that is being spent will run out within a week', () => {
    const w = workshop({ stock: 12, cost: 50_000 });
    const { state } = inProduction(w.state, w.order({ materials: [{ itemId: w.itemId, qty: 10 }] }));
    const row = find(check(state, 1), 'runout:')!; // 10 spent in 30 days → 0.33 a day, 2 left → 6 days
    expect(row.title).toBe('LDSP oq — zaxira 6 kunga yetadi');
    expect(row.priority).toBe('attention');
    expect(row.advice).toContain('14 kunlik zaxira');
    expect(row.effect).toBeGreaterThan(0);
  });

  it('a shortage for orders already in the shop is critical', () => {
    const w = workshop({ stock: 10 });
    let state = run(w.state, { type: 'order.create', input: w.order({ materials: [{ itemId: w.itemId, qty: 8 }] }) });
    state = run(state, { type: 'order.launch', orderId: state.orders[0].id });
    // The sheets were damaged after the launch: stock is now below what the order needs.
    const damaged: State = { ...state, movements: [...state.movements, { id: 'm-x', itemId: w.itemId, direction: 'out', qty: 6, unitCost: 50_000, source: 'inventory', sourceId: 'x', note: '', createdAt: at(0) }] };
    const need = find(check(damaged), 'need:')!;
    expect(need.priority).toBe('critical');
    expect(need.title).toBe('LDSP oq yetishmaydi');
    expect(need.facts).toContain('4 list');
    expect(need.effect).toBe(1_000_000);
    expect(find(check(damaged), 'runout:')).toBeUndefined(); // one card per material
  });
});

describe('production: dates and queues', () => {
  it('an order past its date is critical and names the stage and the person', () => {
    const w = workshop();
    const { state } = inProduction(w.state, w.order({ dueDate: dayOf(at(2)) }));
    expect(find(check(state, 0), 'late:')).toBeUndefined();
    const late = find(check(state, 5), 'late:')!;
    expect(late.priority).toBe('critical');
    expect(late.title).toContain('muddati 3 kun o‘tgan');
    expect(late.facts).toContain('«Kromka»');
    expect(late.facts).toContain('Fayzullo');
    expect(late.effect).toBe(1_000_000);
    expect(late.orderId).toBe(state.orders[0].id);
  });

  it('warns before the date is missed: more stages left than days', () => {
    const w = workshop();
    const { state } = inProduction(w.state, w.order({ dueDate: dayOf(at(2)), stages: 3 }));
    const risk = find(check(state, 0), 'risk:')!;
    expect(risk.title).toContain('muddatga ulgurmaslik xavfi');
    expect(risk.facts).toContain('3 ta bosqich qolgan');
    expect(find(check(inProduction(w.state, w.order({ dueDate: dayOf(at(10)), stages: 3 })).state, 0), 'risk:')).toBeUndefined();
  });

  it('with time norms the remaining hours are compared with the working days left', () => {
    const w = workshop({ minutes: 600 }); // 10 hours per piece
    const { state } = inProduction(w.state, w.order({ dueDate: dayOf(at(2)), stages: 2 })); // 20 h of work, 16 h left
    const risk = find(check(state, 0), 'risk:')!;
    expect(risk.facts).toContain('taxminan 20 soat');
    const calm = inProduction(w.state, w.order({ dueDate: dayOf(at(4)), stages: 2 })); // 32 h left
    expect(find(check(calm.state, 0), 'risk:')).toBeUndefined();
  });

  it('a draft that is due in two days is a risk on its own', () => {
    const w = workshop();
    const state = run(w.state, { type: 'order.create', input: w.order({ dueDate: dayOf(at(2)) }) });
    expect(find(check(state, 0), 'risk:')!.advice).toBe(INSIGHT_TEXTS.riskAdviceDraft);
  });

  it('three open tasks of one operation are a queue', () => {
    const w = workshop();
    let state = w.state;
    for (let index = 0; index < 3; index++) state = inProduction(state, w.order()).state;
    const queue = find(check(state, 0), 'queue:')!;
    expect(queue.title).toBe('«Kromka» bosqichida navbat: 3 ta topshiriq');
    expect(queue.facts).toContain('Fayzullo');
    expect(queue.effect).toBe(3_000_000);
    expect(queue.details).toHaveLength(3);
  });
});

describe('staff: load', () => {
  it('suggests moving tasks from an overloaded worker to a free one who may do the operation', () => {
    const w = workshop();
    let state = w.state;
    for (let index = 0; index < 4; index++) state = inProduction(state, w.order()).state;
    const load = find(check(state, 0), 'load:')!;
    expect(load.title).toBe('Fayzullo ortiqcha yuklangan: 4 ta ochiq topshiriq');
    expect(load.facts).toBe('Sardor bo‘sh va «Kromka» ishini bajara oladi.');
    expect(load.advice).toBe('2 ta topshiriqni Sardorga o‘tkazing.');
  });

  it('says so when nobody free may do that work', () => {
    const w = workshop();
    let state = run(w.state, { type: 'operation.update', operationId: w.state.operations[0].id, name: 'Kromka', unit: 'piece', salePrice: 3500, workerRate: 1000, standardMinutes: 0, machineId: null, employeeIds: [w.fayzullo], active: true, autoAccept: false });
    for (let index = 0; index < 4; index++) state = inProduction(state, w.order()).state;
    const load = find(check(state, 0), 'load:')!;
    expect(load.facts).toBe('«Kromka» ishini bajara oladigan bo‘sh xodim yo‘q.');
    expect(load.advice).toContain('yana bir xodimga ruxsat bering');
  });
});

describe('finance: margin and debts', () => {
  it('an order priced below its cost is a critical loss', () => {
    const w = workshop({ cost: 50_000 });
    const state = run(w.state, { type: 'order.create', input: w.order({ price: 60_000, materials: [{ itemId: w.itemId, qty: 2 }] }) });
    const loss = find(check(state, 0), 'margin:')!; // cost: 2 × 50 000 + 1 000 = 101 000
    expect(loss.priority).toBe('critical');
    expect(loss.title).toContain('zarar bilan ketmoqda');
    expect(loss.effect).toBe(41_000);
  });

  it('a thin margin gets a target price', () => {
    const w = workshop({ cost: 50_000 });
    const state = run(w.state, { type: 'order.create', input: w.order({ price: 105_000, materials: [{ itemId: w.itemId, qty: 2 }] }) });
    const thin = find(check(state, 0), 'margin:')!;
    expect(thin.priority).toBe('attention');
    expect(thin.title).toContain('marja 4%');
    expect(thin.advice).toMatch(/126\D250 so‘m/); // 101 000 / 0.8
  });

  it('a healthy order is not mentioned', () => {
    const w = workshop();
    const state = run(w.state, { type: 'order.create', input: w.order() });
    expect(find(check(state, 0), 'margin:')).toBeUndefined();
    expect(find(check(state, 0), 'overrun:')).toBeUndefined();
  });

  it('old drafts are money waiting for a call', () => {
    const w = workshop();
    const state = run(w.state, { type: 'order.create', input: w.order() });
    expect(find(check(state, 3), 'stale-drafts')).toBeUndefined();
    const stale = find(check(state, 8), 'stale-drafts')!;
    expect(stale.priority).toBe('growth');
    expect(stale.effect).toBe(1_000_000);
  });

  it('demo company: debts age into attention and then critical', () => {
    const demo = createDemo(admin);
    const soon = check(demo, 15).filter(row => row.key.startsWith('debt:'));
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.every(row => row.effect > 0)).toBe(true);
    const later = check(demo, 45).filter(row => row.key.startsWith('debt:'));
    expect(later.some(row => row.priority === 'critical')).toBe(true);
  });
});

describe('the centre as a whole', () => {
  const demo = createDemo(admin);

  it('sorts critical first, then growth, then attention; bigger money first', () => {
    const rows = check(demo, 45);
    const order = ['critical', 'growth', 'attention'];
    for (let index = 1; index < rows.length; index++) {
      const a = rows[index - 1], b = rows[index];
      expect(order.indexOf(a.priority)).toBeLessThanOrEqual(order.indexOf(b.priority));
      if (a.priority === b.priority) expect(a.effect).toBeGreaterThanOrEqual(b.effect);
    }
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
    const summary = insightSummary(rows);
    expect(summary.critical + summary.growth + summary.attention).toBe(rows.length);
  });

  it('an empty company has nothing to say', () => {
    expect(check(emptyState(), 100)).toEqual([]);
    expect(insightDigest([])).toContain('hammasi rejada');
  });

  it('"done" hides a card for a week, "later" for two days; then a problem that stayed comes back', () => {
    const rows = check(demo, 45);
    const key = rows[0].key;
    const now = at(45);
    const done = { [key]: { status: 'done' as const, hiddenUntil: markUntil('done', now) } };
    expect(visibleInsights(rows, done, now).some(row => row.key === key)).toBe(false);
    expect(visibleInsights(rows, done, at(45 + 6)).some(row => row.key === key)).toBe(false);
    expect(visibleInsights(rows, done, at(45 + 8)).some(row => row.key === key)).toBe(true);
    const later = { status: 'later' as const, hiddenUntil: markUntil('later', now) };
    expect(isHidden(later, at(46))).toBe(true);
    expect(isHidden(later, at(48))).toBe(false);
  });

  it('builds a morning digest for Telegram with the top cards of each priority', () => {
    const rows = check(demo, 45);
    const text = insightDigest(rows, 2);
    expect(text).toContain('Ertalabki tavsiyalar');
    expect(text).toContain('🔴');
    expect(text).toContain('→ ');
    expect(text.length).toBeLessThan(3800);
    expect(text).not.toMatch(/<(?!\/?b>)/); // only <b> tags: names with < or & are escaped
  });

  it('every text of the centre has a Russian translation, with real values filled in', () => {
    const translate = createTranslator(ru as Record<string, string>);
    const missing = Object.entries(INSIGHT_TEXTS)
      .filter(([name, text]) => text && !name.startsWith('digest'))
      .filter(([, text]) => translate(fill(text, 'A1', 'B2', 'C3', 'D4', 'E5', 'F6')) === null)
      .map(([name]) => name);
    expect(missing).toEqual([]);
    const card = check(demo, 45)[0];
    const russian = insightText(card, text => translate(text) ?? text);
    expect(russian).toMatch(/[а-яё]{4,}/);
    expect(russian).not.toMatch(/so‘m|kundan|buyurtma /);
  });
});

describe('morning digest through the watcher', () => {
  it('is sent once on a working morning, skips handled cards and stays quiet at night', async () => {
    const { watchRun } = await import('./telegram-owner');
    const w = workshop();
    const state = run(w.state, { type: 'order.create', input: w.order({ price: 60_000 }) }); // a loss-making draft
    const now = at(0), today = dayOf(now), snapshot = { state };
    const morning = watchRun(snapshot, {}, now, today, 9);
    expect(morning.digest?.key).toBe(`digest:${today}`);
    expect(morning.digest?.text).toContain('zarar bilan ketmoqda');
    expect(morning.digest?.push.url).toBe('#/advisor');
    expect(morning.activeKeys).toContain(`digest:${today}`);
    expect(watchRun(snapshot, { [`digest:${today}`]: now }, now, today, 10).digest).toBeNull(); // already sent today
    expect(watchRun(snapshot, {}, now, today, 15).digest).toBeNull();                           // not a morning
    expect(watchRun(snapshot, {}, now, today, 23).digest).toBeNull();                           // night
    const handled = buildInsights(state, now, today).map(row => row.key);
    expect(watchRun(snapshot, {}, now, today, 9, null, handled).digest).toBeNull();             // everything handled
  });
});
