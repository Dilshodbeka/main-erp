// Watcher ("nazoratchi"): looks at an admin snapshot and lists what needs the owner's attention —
// orders stuck in a stage, missed dates, old debts, low stock, unreceived purchases.
// Pure: the Edge Function (erp-watch) runs it on a schedule and the owner bot shows it on demand.
import { stockQty } from './domain';
import { customerBalance } from './receivables';
import type { Order, State } from './types';

export type WatchGroup = 'staff' | 'orders' | 'production' | 'delivery' | 'money' | 'stock';

export interface Finding {
  /** Stable id of the situation: the same problem keeps the same key between runs. */
  key: string;
  group: WatchGroup;
  /** One line of Telegram HTML. */
  text: string;
  /** Hours to wait before reminding about the same situation again. */
  repeatHours: number;
}

export interface WatchConfig {
  draftHours: number;        // draft not launched
  issueHours: number;        // launched, materials still not handed to the shop
  stalledHours: number;      // in production with no accepted work
  reviewHours: number;       // submitted work waiting for acceptance
  readyHours: number;        // ready, not shipped
  transitHours: number;      // shipped, delivery not confirmed
  debtDays: number;          // unpaid obligation age
  purchaseDays: number;      // purchase not fully received
}

export const WATCH_DEFAULTS: WatchConfig = {
  draftHours: 2, issueHours: 1, stalledHours: 24, reviewHours: 0,
  readyHours: 24, transitHours: 48, debtDays: 7, purchaseDays: 3,
};

const HOUR = 3_600_000;
const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sum = (value: number): string => `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

/** 5 → "5 soat", 30 → "1 kun", 80 → "3 kun". */
export function ago(hours: number): string {
  if (hours < 1) return '1 soatdan kam';
  if (hours < 24) return `${Math.floor(hours)} soat`;
  return `${Math.floor(hours / 24)} kun`;
}

const hoursSince = (iso: string | null | undefined, now: number): number =>
  iso ? Math.max(0, (now - new Date(iso).getTime()) / HOUR) : 0;

function head(state: State, order: Order): string {
  const customer = order.kind === 'series' ? 'ombor seriyasi' : state.customers.find(row => row.id === order.customerId)?.name ?? '—';
  return `<b>${esc(order.number)}</b> ${esc(order.title)} · ${esc(customer)}`;
}

/** The last thing that happened on the shop floor for this order: launch, issue or a work report. */
export function lastActivity(state: State, order: Order): string {
  let latest = order.createdAt;
  for (const entry of state.audit) if (entry.entityId === order.id && entry.createdAt > latest) latest = entry.createdAt;
  for (const report of state.reports) if (report.orderId === order.id && report.createdAt > latest) latest = report.createdAt;
  for (const move of state.movements) if (move.sourceId === order.id && move.createdAt > latest) latest = move.createdAt;
  return latest;
}

function launchedAt(state: State, order: Order): string {
  const launch = state.audit.filter(entry => entry.entityId === order.id && entry.action === 'order.launch').map(entry => entry.createdAt).sort().at(-1);
  return launch ?? order.createdAt;
}

/**
 * `nowIso` is the moment of the check; `today` the local calendar date (YYYY-MM-DD) used for due dates.
 * Returns findings ordered by group, most urgent groups first.
 */
export function watchFindings(state: State, nowIso: string, today: string, config: WatchConfig = WATCH_DEFAULTS): Finding[] {
  const now = new Date(nowIso).getTime();
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 24 * HOUR).toISOString().slice(0, 10);
  const found: Finding[] = [];

  for (const order of state.orders) {
    if (order.status === 'cancelled' || order.status === 'delivered') continue;

    // Dates first: a missed or tomorrow's deadline matters whatever the stage is.
    if (order.status !== 'shipped' && order.dueDate) {
      if (order.dueDate < today) {
        found.push({ key: `overdue:${order.id}`, group: 'orders', repeatHours: 24, text: `⏰ ${head(state, order)} — muddati o‘tgan (${order.dueDate})` });
      } else if (order.dueDate === tomorrow && (order.status === 'draft' || order.status === 'production')) {
        found.push({ key: `due:${order.id}`, group: 'orders', repeatHours: 24, text: `📅 ${head(state, order)} — muddati ertaga, hali tayyor emas` });
      }
    }

    if (order.status === 'draft') {
      const waiting = hoursSince(order.createdAt, now);
      if (waiting >= config.draftHours) {
        found.push({ key: `draft:${order.id}`, group: 'orders', repeatHours: 24, text: `📝 ${head(state, order)} — ${ago(waiting)}dan beri qoralama, sexga yuborilmagan` });
      }
      continue;
    }

    if (order.status === 'production') {
      const pending = order.materials.filter(row => row.qty - row.issuedQty > 1e-9).length;
      const sinceLaunch = hoursSince(launchedAt(state, order), now);
      if (pending > 0 && sinceLaunch >= config.issueHours) {
        found.push({ key: `issue:${order.id}`, group: 'production', repeatHours: 12, text: `📦 ${head(state, order)} — materiallar sexga berilmagan (${pending} ta), ${ago(sinceLaunch)}` });
      }
      const idle = hoursSince(lastActivity(state, order), now);
      if (idle >= config.stalledHours) {
        const stage = order.route.find(task => task.completed < task.planned);
        const who = stage ? (stage.executorKind === 'supplier'
          ? state.suppliers.find(row => row.id === stage.supplierId)?.name
          : state.employees.find(row => row.id === stage.employeeId)?.name) : undefined;
        const where = stage ? ` — «${esc(stage.name)}»${who ? `, ${esc(who)}` : ''}` : '';
        found.push({ key: `stalled:${order.id}`, group: 'production', repeatHours: 24, text: `🐢 ${head(state, order)} — ${ago(idle)} harakat yo‘q${where}` });
      }
    }

    if (order.kind !== 'series' && order.lines.some(line => line.status === 'ready')) {
      const waiting = hoursSince(lastActivity(state, order), now);
      if (waiting >= config.readyHours) {
        found.push({ key: `ready:${order.id}`, group: 'delivery', repeatHours: 24, text: `✅ ${head(state, order)} — ${ago(waiting)}dan beri tayyor, yuborilmagan` });
      }
    }
  }

  for (const report of state.reports) {
    if (report.status !== 'submitted') continue;
    const waiting = hoursSince(report.createdAt, now);
    if (waiting < config.reviewHours) continue;
    const order = state.orders.find(row => row.id === report.orderId);
    if (!order || order.status === 'cancelled') continue;
    const who = state.employees.find(row => row.id === report.employeeId)?.name ?? '—';
    found.push({ key: `review:${report.id}`, group: 'production', repeatHours: 6, text: `🔎 ${head(state, order)} — ${esc(who)} topshirgan ish ${ago(waiting)}dan beri qabul kutmoqda` });
  }

  for (const shipment of state.shipments) {
    if (shipment.status !== 'shipped') continue;
    const waiting = hoursSince(shipment.createdAt, now);
    if (waiting < config.transitHours) continue;
    const order = shipment.orderId ? state.orders.find(row => row.id === shipment.orderId) : null;
    const customer = state.customers.find(row => row.id === shipment.customerId)?.name ?? '—';
    const label = order ? head(state, order) : `Ombordan sotuv · ${esc(customer)}`;
    found.push({ key: `transit:${shipment.id}`, group: 'delivery', repeatHours: 24, text: `🚚 ${label} — ${ago(waiting)}dan beri yo‘lda, yetkazish tasdiqlanmagan` });
  }

  for (const customer of state.customers) {
    const balance = customerBalance(state, customer.id);
    if (!(balance.debt > 0)) continue;
    const oldest = balance.obligations.filter(row => row.outstanding > 0).map(row => row.createdAt).sort()[0];
    const days = hoursSince(oldest, now) / 24;
    if (days < config.debtDays) continue;
    found.push({ key: `debt:${customer.id}`, group: 'money', repeatHours: 72, text: `💰 ${esc(customer.name)} — qarz <b>${sum(balance.debt)}</b>, ${Math.floor(days)} kundan beri` });
  }

  for (const purchase of state.purchases) {
    if (!purchase.lines.some(line => line.qty - line.received > 1e-9)) continue;
    const days = hoursSince(purchase.createdAt, now) / 24;
    if (days < config.purchaseDays) continue;
    const supplier = state.suppliers.find(row => row.id === purchase.supplierId)?.name ?? '—';
    found.push({ key: `purchase:${purchase.id}`, group: 'stock', repeatHours: 48, text: `🧾 <b>${esc(purchase.number)}</b> ${esc(supplier)} — ${Math.floor(days)} kundan beri to‘liq qabul qilinmagan` });
  }

  for (const item of state.items) {
    if (!(item.minQty > 0)) continue;
    const qty = stockQty(state, item.id);
    if (qty >= item.minQty) continue;
    found.push({ key: `stock:${item.id}`, group: 'stock', repeatHours: 72, text: `📉 ${esc(item.name)} — ${qty} ${esc(item.unit)} qoldi (me’yor ${item.minQty})` });
  }

  const order: WatchGroup[] = ['staff', 'orders', 'production', 'delivery', 'money', 'stock'];
  return found.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}

const GROUP_TITLE: Record<WatchGroup, string> = {
  staff: 'Xodimlar davomati', orders: 'Buyurtmalar', production: 'Sex', delivery: 'Yetkazish', money: 'Pul', stock: 'Ombor va ta’minot',
};

/** Telegram message for a set of findings; an empty set yields the "all clear" text. */
export function watchDigest(findings: Finding[], title = '🔔 <b>Nazorat</b>'): string {
  if (!findings.length) return `${title}\n\nHammasi joyida — e’tibor talab qiladigan narsa yo‘q.`;
  const lines: string[] = [title];
  for (const group of Object.keys(GROUP_TITLE) as WatchGroup[]) {
    const rows = findings.filter(row => row.group === group);
    if (!rows.length) continue;
    lines.push('', `<b>${GROUP_TITLE[group]}</b>`, ...rows.slice(0, 15).map(row => row.text));
    if (rows.length > 15) lines.push(`…va yana ${rows.length - 15} ta`);
  }
  return lines.join('\n');
}

/**
 * Which findings to send now. `sent` maps a key to the ISO time it was last sent.
 * A situation is announced once, then repeated only after its repeatHours.
 */
export function dueFindings(findings: Finding[], sent: Record<string, string>, nowIso: string): Finding[] {
  const now = new Date(nowIso).getTime();
  return findings.filter(row => {
    const last = sent[row.key];
    return !last || now - new Date(last).getTime() >= row.repeatHours * HOUR;
  });
}

/** Notifications go out only during the working day (local hour, 24h clock). */
export function isQuietHour(localHour: number, from = 8, to = 21): boolean {
  return localHour < from || localHour >= to;
}

