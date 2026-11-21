// Owner bot, stage 2: order cards and actions (launch, issue materials, ship, deliver, take payment).
// Pure: turns one incoming text plus the admin snapshot into a reply and, for a confirmed action,
// the ERP commands to run. Every action is two steps — a preview with a tappable confirm command,
// then the confirm itself. The confirm carries the revision it was issued for, so a second tap or a
// stale message can never run the action twice.
import { applyCommand, orderDebt } from './domain';
import { customerBalance } from './receivables';
import { statusLabel, translateError } from './i18n';
import { esc, uzs } from './telegram-reports';
import type { Account, Actor, Command, Order, State } from './types';

export interface ActionPlan {
  text: string;
  /** Commands to run in order through erp_execute; absent for previews and cards. */
  commands?: Command[];
  /** Input to render after the commands succeed (usually the order card). */
  followUp?: string;
}

const ACTIVE = new Set(['draft', 'production', 'ready', 'shipped']);

/** "ORD-0003" → "ord0003": safe inside a Telegram /command. */
export function orderCode(number: string): string {
  return number.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findOrder(state: State, code: string): Order | null {
  return state.orders.find(order => orderCode(order.number) === code) ?? null;
}

function customerName(state: State, order: Order): string {
  return state.customers.find(row => row.id === order.customerId)?.name ?? '—';
}

function pendingMaterials(order: Order): number {
  return order.materials.filter(row => row.qty - row.issuedQty > 1e-9).length;
}

function readyLines(order: Order): { lineId: string; qty: number }[] {
  return order.lines.filter(line => line.status === 'ready').map(line => ({ lineId: line.id, qty: line.qty }));
}

function openShipments(state: State, order: Order) {
  return state.shipments.filter(row => row.orderId === order.id && row.status === 'shipped');
}

/** Runs the commands on a copy of the state; returns the Uzbek error text or null when they pass. */
function dryRun(state: State, actor: Actor, commands: Command[]): string | null {
  try {
    let next: State = structuredClone(state);
    commands.forEach((command, index) => {
      next = applyCommand(next, { requestId: `dry-${index}`, expectedRevision: next.revision, command }, actor);
    });
    return null;
  } catch (error) {
    return translateError(error instanceof Error ? error.message : String(error));
  }
}

export function ordersList(state: State): string {
  const rows = state.orders.filter(order => ACTIVE.has(order.status) && order.kind !== 'series')
    .sort((a, b) => a.number.localeCompare(b.number));
  if (!rows.length) return '🧾 <b>Buyurtmalar</b>\n\nFaol buyurtma yoʻq.';
  const lines = rows.slice(0, 40).map(order => {
    const debt = orderDebt(state, order.id);
    const tail = debt > 0 ? ` · qarz ${uzs(debt)}` : '';
    return `/b_${orderCode(order.number)} — ${esc(order.title)}\n   ${esc(customerName(state, order))} · ${statusLabel(order.status)} · ${uzs(order.price)}${tail}`;
  });
  const more = rows.length > 40 ? [`…va yana ${rows.length - 40} ta`] : [];
  return ['🧾 <b>Faol buyurtmalar</b>', 'Kartani ochish uchun buyruqni bosing:', '', ...lines, ...more].join('\n');
}

export function orderCard(state: State, order: Order): string {
  const code = orderCode(order.number);
  const debt = orderDebt(state, order.id);
  const stages = order.route.map(task => {
    const who = task.executorKind === 'supplier'
      ? state.suppliers.find(row => row.id === task.supplierId)?.name
      : state.employees.find(row => row.id === task.employeeId)?.name;
    const operation = state.operations.find(row => row.id === task.operationId)?.name ?? '—';
    return `• ${esc(operation)} — ${esc(who ?? '—')}: ${task.completed}/${task.planned}`;
  });
  const actions: string[] = [];
  if (order.status === 'draft') actions.push(`🚀 Sehga yuborish: /sehga_${code}`);
  if (order.status === 'production' && pendingMaterials(order) > 0) actions.push(`📦 Materiallarni sehga berish: /berish_${code}`);
  if (readyLines(order).length > 0 && order.kind !== 'series') actions.push(`🚚 Mijozga yuborish: /yuborish_${code}`);
  if (openShipments(state, order).length > 0) actions.push(`✅ Yetkazildi deb belgilash: /yetkazildi_${code}`);
  if (order.kind !== 'series' && customerBalance(state, order.customerId).debt > 0) actions.push(`💵 Toʻlov qabul qilish: /tolov_${code}`);
  return [
    `🧾 <b>${esc(order.number)}</b> — ${esc(order.title)}`,
    `Mijoz: ${esc(customerName(state, order))}`,
    `Holat: <b>${statusLabel(order.status)}</b>`,
    `Summa: ${uzs(order.price)} · qarz: ${uzs(debt)}`,
    ...(stages.length ? ['', 'Bosqichlar:', ...stages] : []),
    ...(actions.length ? ['', '<b>Amallar</b>', ...actions] : ['', 'Hozir bajariladigan amal yoʻq.']),
  ].join('\n');
}

const confirmLine = (command: string) => `\n\nTasdiqlash: ${command}\nBekor qilish: /bekor`;

function preview(state: State, actor: Actor, summary: string, commands: Command[], confirm: string): ActionPlan {
  const problem = dryRun(state, actor, commands);
  if (problem) return { text: `⚠️ Bajarib boʻlmaydi: ${esc(problem)}` };
  return { text: `${summary}${confirmLine(`${confirm}_r${state.revision}`)}` };
}

const STALE = '⚠️ Maʼlumot oʻzgargan yoki amal allaqachon bajarilgan. Kartani qayta oching.';

function commandsFor(state: State, order: Order, action: string, today: string): Command[] | null {
  switch (action) {
    case 'sehga': case 'sexga': return [{ type: 'order.launch', orderId: order.id }];
    case 'berish': return [{ type: 'order.issue', orderId: order.id }];
    case 'yuborish': {
      const lines = readyLines(order);
      if (!lines.length) return null;
      const address = state.customers.find(row => row.id === order.customerId)?.address ?? '';
      return [{ type: 'shipment.create', orderId: order.id, address, dueDate: today, allowDebt: true, lines }];
    }
    case 'yetkazildi': {
      const open = openShipments(state, order);
      return open.length ? open.map(row => ({ type: 'shipment.deliver' as const, shipmentId: row.id })) : null;
    }
    default: return null;
  }
}

function summaryFor(state: State, order: Order, action: string): string {
  const head = `<b>${esc(order.number)}</b> — ${esc(order.title)}`;
  switch (action) {
    case 'sehga': case 'sexga': return `🚀 Sehga yuborilsinmi?\n${head}\nMateriallar band qilinadi, bosqichlar ijrochilarga ochiladi.`;
    case 'berish': return `📦 Materiallar sehga berilsinmi?\n${head}\nBerilmagan pozitsiyalar: ${pendingMaterials(order)} ta — ombordan chiqim qilinadi.`;
    case 'yuborish': {
      const debt = orderDebt(state, order.id);
      const note = debt > 0 ? `\n⚠️ Toʻlanmagan qarz bilan yuboriladi: <b>${uzs(debt)}</b>` : '';
      return `🚚 Mijozga yuborilsinmi?\n${head}\nTayyor pozitsiyalar toʻliq yuboriladi.${note}`;
    }
    default: return `✅ Yetkazilgan deb belgilansinmi?\n${head}`;
  }
}

const ACCOUNT: Record<string, Account> = { n: 'cash', b: 'bank' };
const ACCOUNT_NAME: Record<Account, string> = { cash: 'Naqd pul', bank: 'Bank / karta' };

function paymentMenu(state: State, order: Order): ActionPlan {
  const code = orderCode(order.number);
  const debt = customerBalance(state, order.customerId).debt;
  if (!(debt > 0)) return { text: 'Bu mijozda qarz yoʻq.' };
  const whole = Math.round(debt);
  return {
    text: [
      `💵 <b>Toʻlov qabul qilish</b>`,
      `Mijoz: ${esc(customerName(state, order))}`,
      `Umumiy qarzi: <b>${uzs(debt)}</b>`,
      '',
      `Toʻliq, naqd: /naqd_${code}`,
      `Toʻliq, bank: /bank_${code}`,
      '',
      `Boshqa summa uchun yozing:\n<code>tolov ${code} ${whole} naqd</code>\n(summani oʻzgartiring; oxirida naqd yoki bank)`,
    ].join('\n'),
  };
}

function paymentPreview(state: State, actor: Actor, order: Order, amount: number, account: Account): ActionPlan {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { text: '⚠️ Summa notoʻgʻri.' };
  const code = orderCode(order.number);
  const debt = customerBalance(state, order.customerId).debt;
  const over = amount > debt ? `\nQarzdan ortigʻi (${uzs(amount - debt)}) avans boʻlib qoladi.` : '';
  const command: Command = { type: 'customer.pay', customerId: order.customerId, amount, account };
  return preview(state, actor,
    `💵 Toʻlov qabul qilinsinmi?\nMijoz: ${esc(customerName(state, order))}\nSumma: <b>${uzs(amount)}</b>\nHisob: ${ACCOUNT_NAME[account]}${over}`,
    [command], `/ok_t_${code}_${account === 'cash' ? 'n' : 'b'}_${amount}`);
}

/**
 * Returns null when the input is not an order command, so the caller can fall back to reports.
 * `today` is the local date (YYYY-MM-DD) used as the shipment date.
 */
export function planOwnerAction(input: string, state: State, actor: Actor, today: string): ActionPlan | null {
  const text = input.trim().toLowerCase();
  if (text === '/bekor') return { text: 'Bekor qilindi.' };
  if (text === '/buyurtmalar' || text === 'buyurtmalar') return { text: ordersList(state) };

  // Typed custom payment: "tolov ord0003 20000 naqd"
  const typed = /^tolov\s+([a-z0-9]+)\s+(\d{1,12})\s+(naqd|bank)$/.exec(text);
  if (typed) {
    const order = findOrder(state, typed[1]);
    if (!order) return { text: 'Buyurtma topilmadi.' };
    return paymentPreview(state, actor, order, Number(typed[2]), typed[3] === 'naqd' ? 'cash' : 'bank');
  }

  // Confirmed payment: /ok_t_<code>_<n|b>_<amount>_r<revision>
  const paid = /^\/ok_t_([a-z0-9]+)_([nb])_(\d{1,12})_r(\d+)$/.exec(text);
  if (paid) {
    const order = findOrder(state, paid[1]);
    if (!order) return { text: 'Buyurtma topilmadi.' };
    if (Number(paid[4]) !== state.revision) return { text: STALE };
    const command: Command = { type: 'customer.pay', customerId: order.customerId, amount: Number(paid[3]), account: ACCOUNT[paid[2]] };
    return { text: `✅ Toʻlov qabul qilindi: ${uzs(Number(paid[3]))}`, commands: [command], followUp: `/b_${paid[1]}` };
  }

  // Confirmed action: /ok_<action>_<code>_r<revision>
  const confirmed = /^\/ok_(sehga|sexga|berish|yuborish|yetkazildi)_([a-z0-9]+)_r(\d+)$/.exec(text);
  if (confirmed) {
    const order = findOrder(state, confirmed[2]);
    if (!order) return { text: 'Buyurtma topilmadi.' };
    if (Number(confirmed[3]) !== state.revision) return { text: STALE };
    const commands = commandsFor(state, order, confirmed[1], today);
    if (!commands) return { text: STALE };
    return { text: '✅ Bajarildi.', commands, followUp: `/b_${confirmed[2]}` };
  }

  const simple = /^\/(b|sehga|sexga|berish|yuborish|yetkazildi|tolov|naqd|bank)_([a-z0-9]+)$/.exec(text);
  if (!simple) return null;
  const order = findOrder(state, simple[2]);
  if (!order) return { text: 'Buyurtma topilmadi. Roʻyxat: /buyurtmalar' };
  const action = simple[1];
  if (action === 'b') return { text: orderCard(state, order) };
  if (action === 'tolov') return paymentMenu(state, order);
  if (action === 'naqd' || action === 'bank') {
    const debt = Math.round(customerBalance(state, order.customerId).debt);
    if (!(debt > 0)) return { text: 'Bu mijozda qarz yoʻq.' };
    return paymentPreview(state, actor, order, debt, action === 'naqd' ? 'cash' : 'bank');
  }
  const commands = commandsFor(state, order, action, today);
  if (!commands) return { text: '⚠️ Bu amal hozir bu buyurtma uchun mavjud emas.' };
  return preview(state, actor, summaryFor(state, order, action), commands, `/ok_${action}_${orderCode(order.number)}`);
}

