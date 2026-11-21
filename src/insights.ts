// Recommendations centre ("Tavsiyalar markazi"): looks at the whole ERP state and tells the owner
// where money is frozen, which order is about to miss its date, who is overloaded and who owes.
// Deterministic — every number comes from the records, nothing is guessed. Pure: the same code
// feeds the screen and the morning digest sent by the watcher.
import { actualCost, availableTask, estimatedCost, reservedQty, stockQty } from './domain';
import { directorConsole } from './console';
import { defectReasonLabels, formatDate, formatMoney, formatQty, unitText } from './i18n';
import { customerBalance } from './receivables';
import { supplyNeeds } from './supply';
import type { Order, RouteLine, State } from './types';
import { lastActivity } from './watch';

export type InsightPriority = 'critical' | 'growth' | 'attention';
export type InsightArea = 'stock' | 'production' | 'staff' | 'finance';

export interface InsightDetail { label: string; value: string }
export interface Insight {
  /** Stable id of the situation: the same problem keeps the same key between runs. */
  key: string;
  area: InsightArea;
  priority: InsightPriority;
  /** What is wrong and where. */
  title: string;
  /** The numbers behind it. */
  facts: string;
  /** The concrete next step. */
  advice: string;
  /** Money at stake in so‘m (0 when the situation has no direct sum). */
  effect: number;
  effectLabel: string;
  details: InsightDetail[];
  /** Where to act: a section route ("warehouse/taminot") and, when it is about one order, its id. */
  route: string;
  orderId?: string;
  /** Rows for "download the list" (dead stock): name, qty, unit, value, discounted price, days. */
  list?: (string | number)[][];
}

export interface InsightConfig {
  deadDays: number; deadMinValue: number; saleDiscount: number;
  runoutDays: number; stockDays: number;
  queueSize: number; overloadTasks: number;
  slowDropPercent: number; defectCount: number;
  lowMargin: number; targetMargin: number; overrunPercent: number; priceGrowthPercent: number;
  debtDays: number; debtCriticalDays: number; staleDraftDays: number;
}

export const INSIGHT_DEFAULTS: InsightConfig = {
  deadDays: 60, deadMinValue: 100_000, saleDiscount: 20,
  runoutDays: 7, stockDays: 14,
  queueSize: 3, overloadTasks: 4,
  slowDropPercent: 50, defectCount: 3,
  lowMargin: 10, targetMargin: 20, overrunPercent: 10, priceGrowthPercent: 10,
  debtDays: 14, debtCriticalDays: 30, staleDraftDays: 7,
};

/** Every text of the centre. Kept in one place so the Russian dictionary can be checked against it. */
export const INSIGHT_TEXTS = {
  frozen: 'Muzlagan pul', atRisk: 'Xavf ostida', toBuy: 'Xarid summasi', queued: 'Navbatdagi buyurtmalar', loss: 'Zarar',
  thinProfit: 'Foyda', extraCost: 'Ortiqcha xarajat', toCollect: 'Undirish mumkin', waitingSales: 'Kutilayotgan savdo',
  missing: 'Yetishmaydi', lost: 'Yo‘qotish', none: '',
  deadTitle: 'Harakatsiz zaxira: {0} ta pozitsiya',
  deadFacts: '{0} kundan ortiq sarf yo‘q va buyurtmalarga band qilinmagan. Jami {1} muzlab turibdi.',
  deadAdvice: '{0}% chegirma bilan sotilsa {1} qaytadi. Yoki shu materialni joriy buyurtmalarda ishlating, yoki yetkazib beruvchiga qaytaring.',
  deadDetail: '{0} {1} · {2} · {3} kun',
  needTitle: '{0} yetishmaydi',
  needFacts: 'Sehdagi {0} ta buyurtmaga {1} yetishmaydi. Eng yaqin muddat: {2}.',
  needAdvice: 'Bugun xarid qiling: taxminan {0}. Aks holda bu buyurtmalar to‘xtab qoladi.',
  runoutTitle: '{0} — zaxira {1} kunga yetadi',
  runoutFacts: 'Oxirgi 30 kunda kuniga o‘rtacha {0} sarflangan, bo‘sh qoldiq {1}.',
  runoutAdvice: '{0} kunlik zaxira uchun {1} xarid qiling: taxminan {2}.',
  lateTitle: '{0} — muddati {1} kun o‘tgan',
  lateFacts: 'Mijoz: {0}. To‘xtagan joyi: «{1}», {2}. Buyurtma summasi {3}.',
  lateFactsDone: 'Mijoz: {0}. Barcha bosqichlar tugagan, yuborish qolgan. Buyurtma summasi {1}.',
  lateAdvice: 'Bugun «{0}» bosqichini birinchi navbatga qo‘ying va mijozga yangi sanani ayting.',
  lateAdviceDone: 'Bugun yuboring va mijozga xabar bering.',
  riskTitle: '{0} — muddatga ulgurmaslik xavfi',
  riskFactsHours: 'Muddatgacha {0} kun, qolgan ish taxminan {1} soat ({2} ta bosqich). Hozir: «{3}», {4}.',
  riskFactsStages: 'Muddatgacha {0} kun, {1} ta bosqich qolgan. Hozir: «{2}», {3}.',
  riskFactsDraft: 'Muddatgacha {0} kun, buyurtma hali sehga tushirilmagan ({1} ta bosqich).',
  riskAdvice: '«{0}» bosqichini birinchi navbatga qo‘ying yoki ishni ikki kishiga bo‘ling.',
  riskAdviceDraft: 'Bugun sehga tushiring yoki mijoz bilan muddatni qayta kelishing.',
  queueTitle: '«{0}» bosqichida navbat: {1} ta topshiriq',
  queueFacts: 'Ijrochilar: {0}. Eng yaqin muddat: {1}.',
  queueFactsHours: 'Ijrochilar: {0}. Taxminan {1} soat ish. Eng yaqin muddat: {2}.',
  queueAdvice: 'Shu bosqichga yordamchi qo‘ying yoki muddati yaqin buyurtmalarni oldinga o‘tkazing.',
  loadTitle: '{0} ortiqcha yuklangan: {1} ta ochiq topshiriq',
  loadFactsHelper: '{0} bo‘sh va «{1}» ishini bajara oladi.',
  loadAdviceHelper: '{0} ta topshiriqni {1}ga o‘tkazing.',
  loadFactsNoHelper: '«{0}» ishini bajara oladigan bo‘sh xodim yo‘q.',
  loadAdviceNoHelper: 'Sozlamalarda «{0}» operatsiyasiga yana bir xodimga ruxsat bering.',
  slowTitle: '{0}: qabul qilingan ish {1}% kamaydi',
  slowFacts: 'Oxirgi 14 kunda {0}, undan oldingi 14 kunda {1}.',
  slowAdvice: 'Sababini aniqlang: material kutilyaptimi, dastgoh nosozmi yoki topshiriq yetishmayaptimi.',
  defectTitle: '{0}: 30 kunda {1} marta brak',
  defectFacts: 'Yo‘qotilgan material: {0}. Eng ko‘p sabab: {1}.',
  defectAdvice: 'Sababni ish joyida tekshiring; chizma va o‘lchovni ishni boshlashdan oldin nazorat qiling.',
  lossTitle: '{0} — zarar bilan ketmoqda',
  lossFacts: 'Narx {0}, xarajat {1}. Zarar: {2}.',
  lossAdvice: 'Narxni mijoz bilan qayta kelishing yoki ortiqcha xarajat sababini toping.',
  marginTitle: '{0} — marja {1}%',
  marginFacts: 'Narx {0}, xarajat {1}. Foyda atigi {2}.',
  marginAdvice: 'Keyingi shunday buyurtmada narxni kamida {0} qiling ({1}% marja).',
  overrunTitle: '{0} — xarajat rejadan {1} oshdi',
  overrunFacts: 'Reja {0}, fakt {1}.',
  overrunAdvice: 'Material sarfi va brakni tekshiring; narxni keyingi buyurtmalar uchun yangilang.',
  priceTitle: '{0} narxi {1}% oshdi',
  priceFacts: 'Oldin {0}, hozir {1}.',
  priceFactsDrafts: 'Oldin {0}, hozir {1}. Qoralamadagi {2} ta buyurtma eski narxda hisoblangan: farq {3}.',
  priceAdvice: 'Shu material ishlatiladigan mahsulot va xizmatlar narxini qayta hisoblang.',
  debtTitle: '{0} — qarz {1}',
  debtFacts: 'Eng eski qarz {0} kundan beri to‘lanmagan.',
  debtAdvice: 'Qarz hujjatini yuboring va to‘lov sanasini kelishing; to‘lamaguncha yangi buyurtmani avans bilan oling.',
  draftsTitle: '{0} ta buyurtma ishga tushmagan',
  draftsFacts: '{0} kundan ortiq qoralamada turibdi. Jami summa: {1}.',
  draftsAdvice: 'Mijozlar bilan bog‘laning: tasdiqlasa ishga tushiring, voz kechgan bo‘lsa bekor qiling.',
  readyTitle: '{0} ta buyurtma tayyor, yuborilmagan',
  readyFacts: 'Yuborilsa {0} tushum tan olinadi; mijozlardan {1} olinadi.',
  readyAdvice: 'Bugun yetkazib berishni rejalang va mijozlarga xabar bering.',
  gapTitle: 'Kassada pul yetmaydi: {0} kam',
  gapFacts: 'Kassa va bankda {0}. Majburiyatlar: yetkazib beruvchilar {1}, ish haqi {2}, oylik xarajatlar {3}.',
  gapAdvice: 'Mijozlardan {0} qarzni undiring va to‘lovlarni muddati bo‘yicha navbatga qo‘ying.',
  idle: '{0} kun harakatsiz', moving: 'ish ketmoqda', nobody: 'ijrochi tayinlanmagan',
  digestTitle: '🧭 <b>Ertalabki tavsiyalar</b>',
  digestEmpty: 'Bugun e’tibor talab qiladigan narsa yo‘q — hammasi rejada.',
  digestMore: '…va yana {0} ta — ilovada «Tavsiyalar» bo‘limida.',
} as const;

const T = INSIGHT_TEXTS;
export const fill = (template: string, ...values: (string | number)[]): string =>
  template.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));

const DAY = 86_400_000;
const round = (value: number): number => Math.round(value);
const daysSince = (iso: string, now: number): number => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY);
const qty = (value: number, unit: string): string => `${formatQty(Math.round(value * 100) / 100)} ${unitText(unit)}`;
const customerName = (state: State, order: Order): string =>
  order.kind === 'series' ? 'ombor seriyasi' : state.customers.find(row => row.id === order.customerId)?.name ?? '—';
const label = (order: Order): string => `${order.number} · ${order.title}`;

function executor(state: State, task: RouteLine): string {
  if (task.executorKind === 'supplier') return state.suppliers.find(row => row.id === task.supplierId)?.name ?? T.nobody;
  return state.employees.find(row => row.id === task.employeeId)?.name ?? T.nobody;
}

const openTask = (task: RouteLine): boolean => task.status !== 'completed' && task.completed < task.planned;

function taskHours(state: State, task: RouteLine): number {
  const minutes = task.standardMinutes ?? state.operations.find(row => row.id === task.operationId)?.standardMinutes ?? 0;
  return Math.max(0, task.planned - task.completed) * minutes / 60;
}

// ── Stock ────────────────────────────────────────────────────────────────────
function stockInsights(state: State, now: number, cfg: InsightConfig): Insight[] {
  const found: Insight[] = [];
  const lastOut = new Map<string, string>();
  const firstIn = new Map<string, string>();
  const spent30 = new Map<string, number>();
  for (const move of state.movements) {
    if (move.direction === 'out') {
      if ((lastOut.get(move.itemId) ?? '') < move.createdAt) lastOut.set(move.itemId, move.createdAt);
      if (move.source !== 'transfer' && move.source !== 'inventory' && now - Date.parse(move.createdAt) <= 30 * DAY) {
        spent30.set(move.itemId, (spent30.get(move.itemId) ?? 0) + move.qty);
      }
    } else if (!firstIn.has(move.itemId) || firstIn.get(move.itemId)! > move.createdAt) firstIn.set(move.itemId, move.createdAt);
  }
  // Materials already planned in active orders are not "dead" even if nothing was issued yet.
  const planned = new Set<string>();
  for (const order of state.orders) {
    if (order.status !== 'draft' && order.status !== 'production') continue;
    for (const line of order.materials) if (line.qty - line.issuedQty > 1e-9) planned.add(line.itemId);
  }

  const dead = state.items.flatMap(item => {
    if (item.customerId || planned.has(item.id)) return [];
    const stock = stockQty(state, item.id);
    const value = round(stock * item.cost);
    const since = lastOut.get(item.id) ?? firstIn.get(item.id);
    if (stock <= 0 || value < cfg.deadMinValue || !since) return [];
    const days = daysSince(since, now);
    return days >= cfg.deadDays ? [{ item, stock, value, days }] : [];
  }).sort((a, b) => b.value - a.value);
  if (dead.length) {
    const total = dead.reduce((sum, row) => sum + row.value, 0);
    const keep = (100 - cfg.saleDiscount) / 100;
    found.push({
      key: 'dead-stock', area: 'stock', priority: 'growth', effect: total, effectLabel: T.frozen,
      title: fill(T.deadTitle, dead.length),
      facts: fill(T.deadFacts, cfg.deadDays, formatMoney(total)),
      advice: fill(T.deadAdvice, cfg.saleDiscount, formatMoney(round(total * keep))),
      details: dead.slice(0, 8).map(row => ({ label: row.item.name, value: fill(T.deadDetail, formatQty(row.stock), unitText(row.item.unit), formatMoney(row.value), row.days) })),
      route: 'warehouse/qoldiqlar',
      list: dead.map(row => [row.item.name, row.stock, unitText(row.item.unit), row.value, round(row.value * keep), row.days]),
    });
  }

  const short = new Set<string>();
  for (const need of supplyNeeds(state)) {
    short.add(need.itemId);
    const orders = state.orders.filter(order => need.orders.some(row => row.id === order.id));
    found.push({
      key: `need:${need.itemId}`, area: 'stock', priority: 'critical',
      effect: round(orders.reduce((sum, order) => sum + order.price, 0)), effectLabel: T.atRisk,
      title: fill(T.needTitle, need.name),
      facts: fill(T.needFacts, need.orders.length, qty(need.short, need.unit), formatDate(need.orders[0].dueDate)),
      advice: fill(T.needAdvice, formatMoney(round(need.short * need.lastPurchasePrice))),
      details: need.orders.slice(0, 6).map(row => ({ label: row.number, value: qty(row.short, need.unit) })),
      route: 'warehouse/taminot',
    });
  }

  for (const item of state.items) {
    if (item.customerId || item.kind !== 'material' || short.has(item.id)) continue;
    const perDay = (spent30.get(item.id) ?? 0) / 30;
    if (perDay <= 0) continue;
    const free = stockQty(state, item.id) - reservedQty(state, item.id);
    if (free < 0) continue;
    const days = Math.floor(free / perDay);
    if (days > cfg.runoutDays) continue;
    const buy = Math.max(0, perDay * cfg.stockDays - free);
    const price = item.lastPurchasePrice || item.cost;
    found.push({
      key: `runout:${item.id}`, area: 'stock', priority: days <= 2 ? 'critical' : 'attention',
      effect: round(buy * price), effectLabel: T.toBuy,
      title: fill(T.runoutTitle, item.name, days),
      facts: fill(T.runoutFacts, qty(perDay, item.unit), qty(free, item.unit)),
      advice: fill(T.runoutAdvice, cfg.stockDays, qty(buy, item.unit), formatMoney(round(buy * price))),
      details: [], route: 'purchases/xaridlar',
    });
  }
  return found;
}

// ── Production ───────────────────────────────────────────────────────────────
function productionInsights(state: State, now: number, today: string): Insight[] {
  const found: Insight[] = [];
  const todayNumber = dayNumber(today);
  for (const order of state.orders) {
    if ((order.status !== 'production' && order.status !== 'draft') || !order.dueDate) continue;
    const left = dayNumber(order.dueDate) - todayNumber;
    const remaining = order.route.filter(openTask);
    const current = remaining[0];
    const idleDays = daysSince(lastActivity(state, order), now);
    const where = current ? `${executor(state, current)} · ${idleDays >= 1 ? fill(T.idle, idleDays) : T.moving}` : '';
    if (left < 0) {
      found.push({
        key: `late:${order.id}`, area: 'production', priority: 'critical', effect: round(order.price), effectLabel: T.atRisk,
        title: fill(T.lateTitle, label(order), -left),
        facts: current ? fill(T.lateFacts, customerName(state, order), current.name, where, formatMoney(order.price))
          : fill(T.lateFactsDone, customerName(state, order), formatMoney(order.price)),
        advice: current ? fill(T.lateAdvice, current.name) : T.lateAdviceDone,
        details: [], route: 'orders/buyurtmalar', orderId: order.id,
      });
      continue;
    }
    if (!remaining.length) continue;
    const hours = remaining.reduce((sum, task) => sum + taskHours(state, task), 0);
    // With time norms: the remaining hours must fit into the working days left (8 h a day).
    // Without norms: every remaining stage needs at least a day.
    const risky = hours > 0 ? hours > Math.max(left, 0.5) * 8 : remaining.length > left;
    const draftLate = order.status === 'draft' && left <= 2;
    if (!risky && !draftLate) continue;
    found.push({
      key: `risk:${order.id}`, area: 'production', priority: left <= 1 ? 'critical' : 'attention', effect: round(order.price), effectLabel: T.atRisk,
      title: fill(T.riskTitle, label(order)),
      facts: order.status === 'draft' ? fill(T.riskFactsDraft, left, remaining.length)
        : hours > 0 ? fill(T.riskFactsHours, left, Math.ceil(hours), remaining.length, current.name, where)
          : fill(T.riskFactsStages, left, remaining.length, current.name, where),
      advice: order.status === 'draft' ? T.riskAdviceDraft : fill(T.riskAdvice, current.name),
      details: [], route: 'orders/buyurtmalar', orderId: order.id,
    });
  }

  // A queue: several tasks of one operation whose turn has already come.
  const queues = new Map<string, { name: string; orders: Order[]; people: Set<string>; hours: number }>();
  for (const order of state.orders) {
    if (order.status !== 'production') continue;
    for (const task of order.route) {
      if (!openTask(task) || task.status === 'submitted' || !availableTask(state, order.id, task.id)) continue;
      const row = queues.get(task.operationId) ?? { name: task.name, orders: [], people: new Set<string>(), hours: 0 };
      row.orders.push(order);
      row.people.add(executor(state, task));
      row.hours += taskHours(state, task);
      queues.set(task.operationId, row);
    }
  }
  for (const [operationId, row] of queues) {
    if (row.orders.length < INSIGHT_DEFAULTS.queueSize) continue;
    const nearest = row.orders.map(order => order.dueDate).filter(Boolean).sort()[0] ?? today;
    const people = [...row.people].join(', ');
    found.push({
      key: `queue:${operationId}`, area: 'production', priority: 'attention',
      effect: round([...new Set(row.orders)].reduce((sum, order) => sum + order.price, 0)), effectLabel: T.queued,
      title: fill(T.queueTitle, row.name, row.orders.length),
      facts: row.hours > 0 ? fill(T.queueFactsHours, people, Math.ceil(row.hours), formatDate(nearest)) : fill(T.queueFacts, people, formatDate(nearest)),
      advice: T.queueAdvice,
      details: row.orders.slice(0, 6).map(order => ({ label: order.number, value: `${order.title} · ${formatDate(order.dueDate)}` })),
      route: 'production/doska',
    });
  }
  return found;
}

// ── Staff ────────────────────────────────────────────────────────────────────
function staffInsights(state: State, now: number, cfg: InsightConfig): Insight[] {
  const found: Insight[] = [];
  const active = state.employees.filter(row => row.active);
  const open = new Map<string, RouteLine[]>();
  for (const order of state.orders) {
    if (order.status !== 'production') continue;
    for (const task of order.route) {
      if (!openTask(task) || task.executorKind === 'supplier' || !task.employeeId) continue;
      open.set(task.employeeId, [...(open.get(task.employeeId) ?? []), task]);
    }
  }
  for (const employee of active) {
    const tasks = open.get(employee.id) ?? [];
    if (tasks.length < cfg.overloadTasks) continue;
    // Only tasks nobody has started yet can be handed over.
    const waiting = tasks.filter(task => task.status === 'assigned');
    let helper: { name: string; operation: string; count: number } | null = null;
    for (const other of active) {
      if (other.id === employee.id || (open.get(other.id) ?? []).length > 0) continue;
      const can = waiting.filter(task => state.operations.find(row => row.id === task.operationId)?.employeeIds.includes(other.id));
      if (can.length && (!helper || can.length > helper.count)) helper = { name: other.name, operation: can[0].name, count: can.length };
    }
    const busiest = [...tasks.reduce((map, task) => map.set(task.name, (map.get(task.name) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0];
    found.push({
      key: `load:${employee.id}`, area: 'staff', priority: 'attention', effect: 0, effectLabel: T.none,
      title: fill(T.loadTitle, employee.name, tasks.length),
      facts: helper ? fill(T.loadFactsHelper, helper.name, helper.operation) : fill(T.loadFactsNoHelper, busiest),
      advice: helper ? fill(T.loadAdviceHelper, Math.max(1, Math.ceil(helper.count / 2)), helper.name) : fill(T.loadAdviceNoHelper, busiest),
      details: [], route: 'production/doska',
    });
  }

  // Accepted work (at stage cost) in the last two weeks against the two weeks before.
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  for (const row of state.payroll) {
    if (row.status !== 'accepted') continue;
    const age = now - Date.parse(row.createdAt);
    if (age < 0 || age > 28 * DAY) continue;
    const bucket = age <= 14 * DAY ? recent : before;
    bucket.set(row.employeeId, (bucket.get(row.employeeId) ?? 0) + row.amount);
  }
  for (const employee of active) {
    const was = before.get(employee.id) ?? 0;
    const is = recent.get(employee.id) ?? 0;
    if (was <= 0 || is >= was * (100 - cfg.slowDropPercent) / 100) continue;
    found.push({
      key: `slow:${employee.id}`, area: 'staff', priority: 'attention', effect: round(was - is), effectLabel: T.none,
      title: fill(T.slowTitle, employee.name, Math.round((1 - is / was) * 100)),
      facts: fill(T.slowFacts, formatMoney(is), formatMoney(was)),
      advice: T.slowAdvice, details: [], route: 'people/xodimlar',
    });
  }

  const defects = new Map<string, { count: number; cost: number; reasons: Map<string, number> }>();
  for (const row of state.defects) {
    if (now - Date.parse(row.createdAt) > 30 * DAY) continue;
    const entry = defects.get(row.employeeId) ?? { count: 0, cost: 0, reasons: new Map<string, number>() };
    entry.count += 1;
    entry.cost += row.materials.reduce((sum, material) => sum + material.qty * (state.items.find(item => item.id === material.itemId)?.cost ?? 0), 0);
    entry.reasons.set(row.reason, (entry.reasons.get(row.reason) ?? 0) + 1);
    defects.set(row.employeeId, entry);
  }
  for (const [employeeId, entry] of defects) {
    const employee = state.employees.find(row => row.id === employeeId);
    if (!employee || entry.count < cfg.defectCount) continue;
    const reason = [...entry.reasons].sort((a, b) => b[1] - a[1])[0][0] as keyof typeof defectReasonLabels;
    found.push({
      key: `defect:${employeeId}`, area: 'staff', priority: 'attention', effect: round(entry.cost), effectLabel: T.lost,
      title: fill(T.defectTitle, employee.name, entry.count),
      facts: fill(T.defectFacts, formatMoney(round(entry.cost)), defectReasonLabels[reason] ?? reason),
      advice: T.defectAdvice, details: [], route: 'production/brak',
    });
  }
  return found;
}

// ── Finance ──────────────────────────────────────────────────────────────────
function financeInsights(state: State, now: number, nowIso: string, cfg: InsightConfig): Insight[] {
  const found: Insight[] = [];
  for (const order of state.orders) {
    if (order.kind === 'series' || !['draft', 'production', 'ready'].includes(order.status) || !(order.price > 0)) continue;
    const plan = estimatedCost(state, order);
    const fact = actualCost(state, order) + order.overhead;
    const cost = Math.max(plan, fact);
    const profit = order.price - cost;
    const margin = Math.round(profit / order.price * 100);
    const base = { area: 'finance' as const, details: [], route: 'orders/buyurtmalar', orderId: order.id };
    if (profit < 0) {
      found.push({ ...base, key: `margin:${order.id}`, priority: 'critical', effect: round(-profit), effectLabel: T.loss,
        title: fill(T.lossTitle, label(order)),
        facts: fill(T.lossFacts, formatMoney(order.price), formatMoney(cost), formatMoney(-profit)), advice: T.lossAdvice });
    } else if (margin < cfg.lowMargin) {
      found.push({ ...base, key: `margin:${order.id}`, priority: 'attention', effect: round(profit), effectLabel: T.thinProfit,
        title: fill(T.marginTitle, label(order), margin),
        facts: fill(T.marginFacts, formatMoney(order.price), formatMoney(cost), formatMoney(profit)),
        advice: fill(T.marginAdvice, formatMoney(round(cost / (1 - cfg.targetMargin / 100))), cfg.targetMargin) });
    } else if (plan > 0 && fact > plan * (1 + cfg.overrunPercent / 100)) {
      found.push({ ...base, key: `overrun:${order.id}`, priority: 'attention', effect: round(fact - plan), effectLabel: T.extraCost,
        title: fill(T.overrunTitle, label(order), formatMoney(fact - plan)),
        facts: fill(T.overrunFacts, formatMoney(plan), formatMoney(fact)), advice: T.overrunAdvice });
    }
  }

  // A purchase price that jumped: drafts were calculated with the old cost.
  const jumps = new Map<string, { before: number; after: number; at: string }>();
  for (const purchase of state.purchases) {
    if (now - Date.parse(purchase.createdAt) > 30 * DAY) continue;
    for (const line of purchase.lines) {
      if (!(line.received > 0) || !(line.previousPurchasePrice > 0)) continue;
      if (line.newPurchasePrice < line.previousPurchasePrice * (1 + cfg.priceGrowthPercent / 100)) continue;
      const known = jumps.get(line.itemId);
      if (!known || known.at < purchase.createdAt) jumps.set(line.itemId, { before: line.previousPurchasePrice, after: line.newPurchasePrice, at: purchase.createdAt });
    }
  }
  for (const [itemId, jump] of jumps) {
    const item = state.items.find(row => row.id === itemId);
    if (!item) continue;
    let extra = 0;
    const drafts = new Set<string>();
    for (const order of state.orders) {
      if (order.status !== 'draft') continue;
      for (const line of order.materials) {
        if (line.itemId !== itemId || line.estimatedCost >= item.cost) continue;
        extra += (item.cost - line.estimatedCost) * line.qty;
        drafts.add(order.id);
      }
    }
    found.push({
      key: `price:${itemId}`, area: 'finance', priority: 'attention', effect: round(extra), effectLabel: T.extraCost,
      title: fill(T.priceTitle, item.name, Math.round((jump.after / jump.before - 1) * 100)),
      facts: drafts.size ? fill(T.priceFactsDrafts, formatMoney(jump.before), formatMoney(jump.after), drafts.size, formatMoney(round(extra)))
        : fill(T.priceFacts, formatMoney(jump.before), formatMoney(jump.after)),
      advice: T.priceAdvice, details: [], route: 'purchases/narxlar',
    });
  }

  for (const customer of state.customers) {
    const balance = customerBalance(state, customer.id);
    if (!(balance.debt > 0)) continue;
    const oldest = balance.obligations.filter(row => row.outstanding > 0).map(row => row.createdAt).sort()[0];
    const days = oldest ? daysSince(oldest, now) : 0;
    if (days < cfg.debtDays) continue;
    found.push({
      key: `debt:${customer.id}`, area: 'finance', priority: days >= cfg.debtCriticalDays ? 'critical' : 'attention',
      effect: round(balance.debt), effectLabel: T.toCollect,
      title: fill(T.debtTitle, customer.name, formatMoney(balance.debt)),
      facts: fill(T.debtFacts, days), advice: T.debtAdvice, details: [], route: 'orders/mijozlar',
    });
  }

  const stale = state.orders.filter(order => order.status === 'draft' && order.kind !== 'series' && daysSince(order.createdAt, now) >= cfg.staleDraftDays);
  if (stale.length) {
    const total = stale.reduce((sum, order) => sum + order.price, 0);
    found.push({
      key: 'stale-drafts', area: 'finance', priority: 'growth', effect: round(total), effectLabel: T.waitingSales,
      title: fill(T.draftsTitle, stale.length), facts: fill(T.draftsFacts, cfg.staleDraftDays, formatMoney(total)), advice: T.draftsAdvice,
      details: stale.slice(0, 6).map(order => ({ label: order.number, value: `${order.title} · ${formatMoney(order.price)}` })),
      route: 'orders/buyurtmalar',
    });
  }

  const ready = state.orders.filter(order => order.status === 'ready' && order.kind !== 'series');
  if (ready.length) {
    const revenue = ready.reduce((sum, order) => sum + order.price, 0);
    const toCollect = ready.reduce((sum, order) => sum + Math.max(0, customerBalance(state, order.customerId).obligations.find(row => row.orderId === order.id)?.outstanding ?? 0), 0);
    found.push({
      key: 'ready-orders', area: 'finance', priority: 'growth', effect: round(revenue), effectLabel: T.waitingSales,
      title: fill(T.readyTitle, ready.length), facts: fill(T.readyFacts, formatMoney(revenue), formatMoney(toCollect)), advice: T.readyAdvice,
      details: ready.slice(0, 6).map(order => ({ label: order.number, value: `${order.title} · ${formatMoney(order.price)}` })),
      route: 'logistics',
    });
  }

  const money = directorConsole(state, nowIso);
  const due = money.payable.suppliers + money.payable.payroll + money.payable.expenses;
  if (due > money.balances.total && due > 0) {
    found.push({
      key: 'cash-gap', area: 'finance', priority: 'critical', effect: round(due - money.balances.total), effectLabel: T.missing,
      title: fill(T.gapTitle, formatMoney(due - money.balances.total)),
      facts: fill(T.gapFacts, formatMoney(money.balances.total), formatMoney(money.payable.suppliers), formatMoney(money.payable.payroll), formatMoney(money.payable.expenses)),
      advice: fill(T.gapAdvice, formatMoney(money.receivable.customers + money.receivable.shops)),
      details: [], route: 'cash/pult',
    });
  }
  return found;
}

const PRIORITY_ORDER: InsightPriority[] = ['critical', 'growth', 'attention'];

/** `nowIso` is the moment of the check; `today` the local calendar date (YYYY-MM-DD) used for due dates. */
export function buildInsights(state: State, nowIso: string, today: string, config: InsightConfig = INSIGHT_DEFAULTS): Insight[] {
  const now = Date.parse(nowIso);
  return [
    ...stockInsights(state, now, config),
    ...productionInsights(state, now, today),
    ...staffInsights(state, now, config),
    ...financeInsights(state, now, nowIso, config),
  ].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || b.effect - a.effect || a.key.localeCompare(b.key));
}

const cache = new WeakMap<State, { today: string; rows: Insight[] }>();

/** The centre for "now", computed once per state snapshot and calendar day (the screens re-render often). */
export function insightsFor(state: State, now: Date = new Date()): Insight[] {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const known = cache.get(state);
  if (known && known.today === today) return known.rows;
  const rows = buildInsights(state, now.toISOString(), today);
  cache.set(state, { today, rows });
  return rows;
}

// ── Reactions: "done" and "later" hide a card until a date; a problem that is still there comes back ──
export type InsightMarkStatus = 'done' | 'later';
export interface InsightMark { status: InsightMarkStatus; hiddenUntil: string }
export type InsightMarks = Record<string, InsightMark>;
export const DONE_DAYS = 7;
export const LATER_DAYS = 2;

export function markUntil(status: InsightMarkStatus, nowIso: string): string {
  return new Date(Date.parse(nowIso) + (status === 'done' ? DONE_DAYS : LATER_DAYS) * DAY).toISOString();
}

export const isHidden = (mark: InsightMark | undefined, nowIso: string): boolean => Boolean(mark && mark.hiddenUntil > nowIso);

export function visibleInsights(insights: Insight[], marks: InsightMarks, nowIso: string): Insight[] {
  return insights.filter(row => !isHidden(marks[row.key], nowIso));
}

export interface InsightSummary { critical: number; growth: number; attention: number; atRisk: number; toGain: number }

export function insightSummary(insights: Insight[]): InsightSummary {
  const count = (priority: InsightPriority) => insights.filter(row => row.priority === priority).length;
  const sum = (priority: InsightPriority) => insights.reduce((total, row) => row.priority === priority ? total + row.effect : total, 0);
  return { critical: count('critical'), growth: count('growth'), attention: count('attention'), atRisk: sum('critical'), toGain: sum('growth') };
}

/** Plain text of one card: for the order chat, the clipboard or a messenger. */
export function insightText(insight: Insight, translate: (text: string) => string = text => text): string {
  return [translate(insight.title), translate(insight.facts), `→ ${translate(insight.advice)}`].join('\n');
}

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const GROUPS: [InsightPriority, string][] = [['critical', '🔴 <b>Muhim</b>'], ['growth', '🟢 <b>Daromad nuqtasi</b>'], ['attention', '🟡 <b>E’tibor</b>']];

/** Morning digest for Telegram (HTML): the top cards of every priority. */
export function insightDigest(insights: Insight[], perGroup = 3): string {
  if (!insights.length) return `${T.digestTitle}\n\n${T.digestEmpty}`;
  const lines: string[] = [T.digestTitle];
  let shown = 0;
  for (const [priority, heading] of GROUPS) {
    const rows = insights.filter(row => row.priority === priority);
    if (!rows.length) continue;
    lines.push('', `${heading} · ${rows.length}`);
    for (const row of rows.slice(0, perGroup)) {
      lines.push(`• <b>${esc(row.title)}</b>`, `  ${esc(row.facts)}`, `  → ${esc(row.advice)}`);
      shown += 1;
    }
  }
  if (insights.length > shown) lines.push('', fill(T.digestMore, insights.length - shown));
  return lines.join('\n');
}
