# Единый баланс клиента (#366) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один баланс клиента: долг = Σ согласованных обязательств минус деньги, реально отданные клиентом, аванс = остаток тех же денег; долг и аванс больше никогда не показываются одновременно.

**Architecture:** Движок `src/receivables.ts` переезжает с «FIFO по отгрузкам» на «FIFO по обязательствам»: обязательство — это согласованный заказ (`price`) или складская отгрузка без заказа. Один чистый расчёт `customerBalance()` становится единственным источником чисел; поверх него `orderBalance()` даёт срез по заказу. Сервер повторяет тот же алгоритм тремя SQL-функциями (`erp_customer_paid`, `erp_customer_obligations`, `erp_customer_debt`) + переписанными `erp_customer_advance`/`erp_order_paid`, поэтому фронт и `erp_execute` больше не расходятся. Новые колонки и таблицы не создаются — ничего кроме вычислений не меняется.

**Tech Stack:** TypeScript 5 + React 19 (Vite 6), vitest, Supabase Postgres (канонический `supabase/schema.sql`), PGlite для зондов, Cloudflare Worker `erp-tizim`.

**Spec:** `docs/superpowers/specs/2026-11-19-customer-single-balance-design.md` — спецификация утверждает правила; план ниже только исполняет её.

## Global Constraints

- Папка `C:\Users\abdul\Documents\Qoder\2026-10-29\dd682fe3` — git-репозиторий (`main`, remote `github.com/Dilshodbeka/main-erp`), но git identity нет: **шагов commit нет**. Вместо них после каждого изменения — проверки: `npx tsc -b`, `npx vitest run`, `npm run build`, PGlite-зонд.
- Живой SQL (Supabase SQL Editor) и `npm run deploy` (Worker `erp-tizim`) — **только по отдельному разрешению владельца**. Ни одна задача плана не применяет миграцию и не деплоит.
- TDD без исключений: сначала RED (убедиться, что тест падает по нужной причине), потом минимальный GREEN.
- Инвариант №1 этого плана: для одного клиента `debt > 0` и `advance > 0` невозможны одновременно. Ни один экран не имеет права показывать оба числа ненулевыми.
- База обязательства — согласованный договор: `kind <> 'series'` и `status NOT IN ('draft','cancelled')`; сумма — `order.price` **как есть**, без прибавления `markup` (markup уже внутри `price`).
- Ручного переключателя «Avans sifatida qoldirish» нет; оплата всегда автоматически закрывает самое старое обязательство (FIFO по `created_at, id`).
- Обязательствами считаются и складские отгрузки без заказа (`shipment.order_id IS NULL`, `status <> 'cancelled'`) — иначе магазин мог бы отпускать товар без долга.
- UI только на узбекской латинице (апостроф `‘`, как в существующих строках); отчёты владельцу — на русском.
- `money()` (`src/ui.tsx:6` → `src/i18n.ts:56`) печатает группы разрядов через U+00A0, а не обычный пробел: подстроки-числа в тестах сравнивать только после нормализации (`spaced()`), иначе тест падёт на верном выводе.
- Канонический SQL — `supabase/schema.sql`; файл миграции руками не правится, он генерируется скриптом из `.validation-pglite-20261029/`.
- Помощники-функции в SQL не должны стать публичным API: новый `erp_customer_paid`, `erp_customer_obligations`, `erp_customer_debt` добавляются в тот же `REVOKE ALL` список, что и остальные хелперы.

---

## Файловая структура

**Новые файлы**

| Файл | Ответственность |
|---|---|
| `src/balance-contract.test.ts` | Текстовый контракт: канонический `schema.sql` содержит те же правила, что и движок (фильтр статусов, `order_id IS NULL`, `price` без markup, толерантность удержания). |
| `.validation-pglite-20261029/generate-customer-balance-migration.mjs` | Собирает идемпотентную миграцию, копируя тела функций прямо из `supabase/schema.sql`. |
| `supabase/migrations/20261124_customer_balance.sql` | Результат генератора. Имя выбрано позже самого свежего применённого `20261123_draft_orders.sql`, чтобы не сталкиваться с `20261119_warehouses.sql`. |
| `.validation-pglite-20261029/customer-balance-probe.mjs` | Прогон сценариев владельца на живой схеме в PGlite: долг по согласованному договору, аванс только сверху, черновик не создаёт долга, FIFO по старому долгу, guard `salary.deduct`. |

**Изменяемые файлы**

| Файл | Что меняется |
|---|---|
| `src/receivables.ts` | Полная замена: `customerBalance` + `orderBalance` вместо `customerLedger` + `orderLedger`. |
| `src/domain.ts` | `orderPaid` через `orderBalance`; новый `orderDebt`; `customerAdvance` и оба guard-а через `customerBalance`. |
| `src/history.ts` | `orderProfit.paid/debt` из `orderBalance`; `customerAnalytics.paid/debt` из `customerBalance`. |
| `src/analytics.ts` | `CustomerDetail.ledger` → `balance: CustomerBalance`. |
| `src/documents.ts` | Фактура заказа и отгрузки читают `orderBalance`/`customerBalance`. |
| `src/console.ts`, `src/quicksearch.ts`, `src/health.tsx`, `src/reports.ts`, `src/statements.ts` | Переключение на новые имена полей (механически). |
| `src/App.tsx` | `orderDebt` вместо `o.price - orderPaid(...)`, `customerBalance` вместо `customerLedger`, плитки магазинов. |
| `src/components/CustomerCard.tsx` | Плитки «Shartnoma / To‘langan / Qarz / Avans» из одного баланса, ноль показывается как `—`. |
| `src/components/CustomerLedger.tsx` | Панель магазина: таблица обязательств вместо строк отгрузок, «Yuborilgan» → «Shartnoma». |
| `src/components/ShipmentEditor.tsx` | Уточняющий текст под галочкой `allowDebt`. |
| `supabase/schema.sql` | 3 новых функции, переписанные `erp_customer_advance` + `erp_order_paid`, guard `salary.deduct`, список `REVOKE`. |
| тесты | `src/receivables.test.ts` (переписать), плюс обновить падающие пины: `domain.test.ts`, `console.test.ts`, `sales.test.ts`, `documents.test.ts`, `history.test.ts`, `statements.test.ts`, `health.test.ts`, `mobileCards.test.ts`, `salary-ui.test.tsx`, `statement-ui.test.tsx`. |

---

## Задача T1: Движок `customerBalance` + все TS-потребители

**Files:**
- Modify: `src/receivables.ts` (полная замена)
- Modify: `src/domain.ts:606-608, 664-672, 1669, 1778, 1811`
- Modify: `src/history.ts:1, 27-28, 44-58`
- Modify: `src/analytics.ts:3, 175-179, 195`
- Modify: `src/documents.ts:3, 115, 126-127, 137-168`
- Modify: `src/console.ts:4, 45, 47, 88, 118`
- Modify: `src/quicksearch.ts:3, 42, 52`
- Modify: `src/health.tsx:3, 67-73`
- Modify: `src/reports.ts:1, 91-93, 127, 133`
- Modify: `src/statements.ts:2, 67, 73`
- Modify: `src/App.tsx:4, 297, 511, 549-554, 646, 707, 738, 763, 918`
- Modify: `src/components/CustomerCard.tsx:41`, `src/components/CustomerLedger.tsx:5, 26-31` (минимально, чтобы компилировалось; оформление — T2)
- Test: `src/receivables.test.ts`

**Interfaces:**
- Consumes: `shipmentTotals(shipment).revenue` из `src/sales.ts`; `State.orders`, `State.shipments`, `State.cash`, `State.workerDeductions` из `src/types.ts`.
- Produces:
  - `isAgreed(order: Order): boolean`
  - `interface ObligationRow { id: string; kind: 'order' | 'stock'; orderId: string | null; label: string; createdAt: string; total: number; paid: number; outstanding: number }`
  - `interface CustomerBalance { customerId: string; contract: number; paid: number; debt: number; advance: number; obligations: ObligationRow[] }`
  - `customerBalance(state: State, customerId: string): CustomerBalance`
  - `orderBalance(state: State, orderId: string): ObligationRow | null` — `null`, если заказа нет, он черновик/отменён/серийный или без клиента. Бросать исключение больше не нужно (проверено: ни один тест не ждёт `'Order not found'` из `receivables.ts`).
  - `orderDebt(state: State, order: Order): number` из `src/domain.ts` — 0 для черновика/отменённого/серийного.
  - Старые `customerLedger` / `orderLedger` / `CustomerLedger` / `OrderLedger` **удаляются полностью**, шимов нет.

- [ ] **Step 1: RED — переписать `src/receivables.test.ts` целиком**

Фикстуры оставляем те же (`emptyState`, `applyCommand`, `shipment()`, `order()`), только `order()` получает третий аргумент с overrides. Содержимое файла:

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { customerBalance, orderBalance } from './receivables';
import type { Actor, Command, Order, Shipment, State } from './types';

const admin: Actor = { id: 'admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

const pay = (customerId: string, amount: number): Command => ({ type: 'customer.pay', customerId, amount, account: 'cash' });

function shipment(id: string, total: number, createdAt: string, overrides: Partial<Shipment> = {}): Shipment {
  return {
    id, orderId: null, customerId: 'customer-1', kind: 'stock',
    lines: [{ id: `${id}-line`, itemId: 'item-1', description: '', qty: 1, salePrice: total, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: '2026-11-05', status: 'delivered', createdAt, deliveredAt: null, reversalOf: null,
    ...overrides,
  };
}

function order(id: string, price: number, overrides: Partial<Order> = {}): Order {
  return {
    id, number: id, kind: 'product', customerId: 'customer-1', title: 'Кухня',
    outputItemId: null, recipeVersionId: null, substitutions: {},
    qty: 1, price, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
    lines: [{ id: `${id}-line`, kind: 'product', title: 'Кухня', qty: 1, total: price, status: 'delivered' }],
    materials: [], route: [],
    ...overrides,
  };
}

function base(): State {
  const state = emptyState();
  state.customers.push({ id: 'customer-1', name: 'Alif', phone: '', address: '', kind: 'customer', employeeId: null });
  return state;
}

describe('single customer balance', () => {
  it('charges the agreed contract and shows only debt while money is short', () => {
    const state = base();
    state.orders.push(order('order-1', 30000000));
    const paid = run(state, pay('customer-1', 9200000));
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ contract: 30000000, paid: 9200000, debt: 20800000, advance: 0 });
  });

  it('never reports debt and advance together', () => {
    const state = base();
    state.orders.push(order('order-1', 30000000));
    const settled = run(state, pay('customer-1', 30000000));
    expect(customerBalance(settled, 'customer-1')).toMatchObject({ debt: 0, advance: 0 });
    const over = run(settled, pay('customer-1', 5000000));
    const balance = customerBalance(over, 'customer-1');
    expect(balance).toMatchObject({ debt: 0, advance: 5000000, paid: 35000000 });
    expect(balance.debt > 0 && balance.advance > 0).toBe(false);
  });

  it('keeps a draft order out of the contract and out of the debt', () => {
    const state = base();
    state.orders.push(order('order-1', 20000000, { status: 'draft' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 0, debt: 0, advance: 0 });
    const agreed = run(state, pay('customer-1', 5000000));
    expect(customerBalance(agreed, 'customer-1')).toMatchObject({ contract: 0, debt: 0, advance: 5000000 });
  });

  it('ignores cancelled orders and series production', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000, { status: 'cancelled' }));
    state.orders.push(order('order-2', 7000000, { kind: 'series' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 0, debt: 0 });
  });

  it('treats a stock shipment without an order as an obligation', () => {
    const state = base();
    state.shipments.push(shipment('stock-1', 4000000, '2026-10-05T00:00:00Z'));
    const balance = customerBalance(state, 'customer-1');
    expect(balance).toMatchObject({ contract: 4000000, debt: 4000000, advance: 0 });
    expect(balance.obligations[0]).toMatchObject({ kind: 'stock', id: 'stock-1', orderId: null });
  });

  it('applies a payment to the oldest obligation first', () => {
    const state = base();
    state.orders.push(order('order-old', 10000000, { createdAt: '2026-10-01T00:00:00Z' }));
    state.orders.push(order('order-new', 20000000, { createdAt: '2026-10-09T00:00:00Z' }));
    const paid = run(state, pay('customer-1', 12000000));
    expect(orderBalance(paid, 'order-old')).toMatchObject({ paid: 10000000, outstanding: 0 });
    expect(orderBalance(paid, 'order-new')).toMatchObject({ paid: 2000000, outstanding: 18000000 });
  });

  it('counts a shipment of an order once, through the order contract', () => {
    const state = base();
    state.orders.push(order('order-1', 6000000));
    state.shipments.push(shipment('shipment-1', 6000000, '2026-10-03T00:00:00Z', { orderId: 'order-1', kind: 'order' }));
    expect(customerBalance(state, 'customer-1')).toMatchObject({ contract: 6000000, debt: 6000000 });
  });

  it('nets a reversed payment out of the pool', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000));
    let paid = run(state, pay('customer-1', 10000000));
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ debt: 0, advance: 0 });
    const entry = paid.cash.find(row => row.source === 'sale' && row.customerId === 'customer-1')!;
    paid = run(paid, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
    expect(customerBalance(paid, 'customer-1')).toMatchObject({ paid: 0, debt: 10000000, advance: 0 });
  });

  it('adds worker deductions to the pool and floors the pool at zero', () => {
    const state = base();
    state.orders.push(order('order-1', 10000000));
    state.workerDeductions.push({ id: 'deduct-1', employeeId: 'employee-1', customerId: 'customer-1', amount: 4000000, direction: 'deduct', note: '', createdAt: '2026-10-04T00:00:00Z', reversalOf: null });
    expect(customerBalance(state, 'customer-1')).toMatchObject({ paid: 4000000, debt: 6000000, advance: 0 });
    const negative = base();
    negative.cash.push({ id: 'cash-1', number: null, direction: 'out', amount: 500000, account: 'cash', toAccount: null, category: 'To‘lov qaytarildi', note: '', source: 'sale', sourceId: null, customerId: 'customer-1', createdAt: '2026-10-04T00:00:00Z', reversalOf: null });
    expect(customerBalance(negative, 'customer-1')).toMatchObject({ paid: 0, debt: 0, advance: 0 });
  });

  it('exposes per-order zero for a draft so the UI cannot invent debt', () => {
    const state = base();
    state.orders.push(order('order-1', 15000000, { status: 'draft' }));
    expect(orderBalance(state, 'order-1')).toBeNull();
    expect(orderBalance(state, 'missing-order')).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают правильно**

Run: `npx vitest run src/receivables.test.ts`
Expected: FAIL на импорте — «Missing export customerBalance» (или «failed to resolve import … does not provide an export named 'customerBalance'»), а не молчаливый проход.

- [ ] **Step 3: GREEN — полная замена `src/receivables.ts`**

```ts
import { shipmentTotals } from './sales';
import type { Order, State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const byTime = (left: { createdAt: string; id: string }, right: { createdAt: string; id: string }): number =>
  left.createdAt === right.createdAt ? left.id.localeCompare(right.id) : left.createdAt.localeCompare(right.createdAt);

export interface ObligationRow {
  id: string; kind: 'order' | 'stock'; orderId: string | null; label: string;
  createdAt: string; total: number; paid: number; outstanding: number;
}

export interface CustomerBalance {
  customerId: string; contract: number; paid: number; debt: number; advance: number;
  obligations: ObligationRow[];
}

export function isAgreed(order: Order): boolean {
  return order.kind !== 'series' && order.status !== 'draft' && order.status !== 'cancelled';
}

export function customerBalance(state: State, customerId: string): CustomerBalance {
  const rows: Array<Omit<ObligationRow, 'paid' | 'outstanding'>> = [];
  for (const order of state.orders) {
    if (order.customerId !== customerId || !isAgreed(order)) continue;
    const total = round(order.price);
    if (total > 0) rows.push({ id: order.id, kind: 'order', orderId: order.id, label: `${order.number} · ${order.title}`, createdAt: order.createdAt, total });
  }
  for (const shipment of state.shipments) {
    if (shipment.customerId !== customerId || shipment.orderId !== null || shipment.status === 'cancelled') continue;
    const total = round(shipmentTotals(shipment).revenue);
    if (total > 0) rows.push({ id: shipment.id, kind: 'stock', orderId: null, label: 'Ombordan sotuv', createdAt: shipment.createdAt, total });
  }
  rows.sort(byTime);
  const payments = state.cash
    .filter(row => row.source === 'sale' && row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'out' ? -row.amount : row.direction === 'in' ? row.amount : 0), 0);
  const deductions = state.workerDeductions
    .filter(row => row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'deduct' ? row.amount : -row.amount), 0);
  const received = Math.max(0, round(payments + deductions));
  let pool = received;
  const obligations: ObligationRow[] = rows.map(row => {
    const paid = Math.min(row.total, pool);
    pool = round(pool - paid);
    return { ...row, paid, outstanding: round(row.total - paid) };
  });
  return {
    customerId,
    contract: round(obligations.reduce((sum, row) => sum + row.total, 0)),
    paid: received,
    debt: round(obligations.reduce((sum, row) => sum + row.outstanding, 0)),
    advance: Math.max(0, pool),
    obligations,
  };
}

export function orderBalance(state: State, orderId: string): ObligationRow | null {
  const order = state.orders.find(row => row.id === orderId);
  if (!order || !isAgreed(order)) return null;
  return customerBalance(state, order.customerId).obligations.find(row => row.orderId === orderId) ?? null;
}
```

- [ ] **Step 4: GREEN-проверка движка**

Run: `npx vitest run src/receivables.test.ts`
Expected: PASS, 10/10. Если `cash.reverse` в тесте №8 требует другой формы команды — свериться с `src/domain.ts` (`WHEN 'cash.reverse'`) и поправить **тест** только в части имени команды, числа оставить.

- [ ] **Step 5: Переключить доменные потребители**

`src/domain.ts`:

```ts
import { customerBalance, orderBalance } from './receivables';
```

```ts
export function orderPaid(state: State, orderId: string): number {
  return orderBalance(state, orderId)?.paid ?? 0;
}

export function orderDebt(state: State, order: Order): number {
  return orderBalance(state, order.id)?.outstanding ?? 0;
}
```

`customerAdvance` (сейчас строка 670-672) становится:

```ts
function customerAdvance(state: State, customerId: string): number {
  return customerBalance(state, customerId).advance;
}
```

guard удержания из оклада (строка 1669):

```ts
      check(command.amount <= customerBalance(state, customer.id).debt + 0.004, 'Amount exceeds customer debt');
```

Два gate'а отгрузки (1778 и 1811) остаются текстом как есть — они вызывают `orderPaid`/`customerAdvance`, смысл которых поменялся вместе с движком. `Order` уже импортирован в `domain.ts`; если тип не импортирован — добавить в существующий `import type { ... } from './types'`.

- [ ] **Step 6: Отчёты, документы, аналитика**

`src/history.ts` — импорт заменить на `import { actualCost, supplierDebt } from './domain'; import { customerBalance, orderBalance } from './receivables';`, затем:

```ts
    paid: orderBalance(state, order.id)?.paid ?? 0,
    debt: orderBalance(state, order.id)?.outstanding ?? 0,
```

В `customerAnalytics` внутри `state.customers.map(customer => { ... })` добавить первой строкой `const balance = customerBalance(state, customer.id);` и заменить два поля:

```ts
      paid: balance.paid,
      debt: balance.debt,
```

(`revenue`, `profit`, `orders`, `average`, `lastOrder` не трогаем — это экономика заказов, а не баланс.)

`src/analytics.ts`:

```ts
import { customerBalance, type CustomerBalance } from './receivables';
```

```ts
export interface CustomerDetail {
  customer: Customer; stats: CustomerAnalyticsRow; orders: OrderProfitRow[];
  payments: CashEntry[]; shipments: Shipment[]; balance: CustomerBalance;
  deductions: WorkerDeduction[];
}
```

и в `return { ... }` функции `customerDetail`: `balance: customerBalance(state, customerId)`.

`src/documents.ts` — импорт `import { customerBalance, orderBalance } from './receivables';`; в `orderInvoice` строку `const ledger = orderLedger(state, order.id);` и поля заменить на:

```ts
  const obligation = orderBalance(state, order.id);
  // ... в return:
    paid: obligation?.paid ?? 0,
    debt: obligation?.outstanding ?? 0,
```

В `shipmentInvoice` вместо поиска по `ledger.shipments`:

```ts
  const balance = customerBalance(state, shipment.customerId);
  const obligation = shipment.orderId
    ? balance.obligations.find(row => row.orderId === shipment.orderId)
    : balance.obligations.find(row => row.kind === 'stock' && row.id === shipment.id);
```

`paid/debt` в return: `obligation?.paid ?? 0` и `obligation?.outstanding ?? 0`. Проверка «Hujjat topilmadi» для отсутствующей отгрузки остаётся на строке выше (`if (!ledger)` убирается вместе со старым кодом).

`src/console.ts`: `import { customerBalance } from './receivables';` и четыре обращения `customerLedger(state, X.id).debt` → `customerBalance(state, X.id).debt`.

`src/quicksearch.ts`: `import { customerBalance, orderBalance } from './receivables';`, `debt: customerBalance(state, customer.id).debt`, `debt: orderBalance(state, order.id)?.outstanding ?? 0`.

`src/health.tsx`: `import { orderBalance } from './receivables';` и блок `receivableRows`:

```ts
  const receivableRows = state.orders.filter(order => order.status === 'delivered').flatMap(order => {
    const obligation = orderBalance(state, order.id);
    const debt = obligation?.outstanding ?? 0;
    const age = ageDays(order.createdAt, today);
    return debt > 0 ? [{
      order, paid: obligation?.paid ?? 0, debt, ageDays: age, ageBand: ageBand(age),
      customerName: state.customers.find(customer => customer.id === order.customerId)?.name ?? 'Buyurtmachi topilmadi',
    }] : [];
  })
```

`src/reports.ts`: `import { customerBalance } from './receivables';`

```ts
  const balances = snapshot.customers.map(customer => customerBalance(snapshot, customer.id));
  const debt = round(balances.reduce((sum, balance) => sum + balance.debt, 0));
  const advances = round(balances.reduce((sum, balance) => sum + balance.advance, 0));
```

и в `shopReport`:

```ts
  const balance = customerBalance(snapshotAt(state, to), shopId);
  return {
    // ...
    paid: balance.paid, debt: balance.debt, advance: balance.advance,
  };
```

`src/statements.ts`: `import { customerBalance } from './receivables';`, внутри `customerStatements` — `const balance = customerBalance(state, customer.id);` и `debt: balance.debt, advance: balance.advance,`.

- [ ] **Step 7: UI-компиляция (оформление — в T2)**

`src/App.tsx`:

```ts
import { customerBalance } from './receivables';
```

два глобальных замены по тексту файла (каждая встречается несколько раз, это и нужно):
`o.price - orderPaid(state, o.id)` → `orderDebt(state, o)` и
`order.price - orderPaid(state, order.id)` → `orderDebt(state, order)`;
в `import { ... } from './domain'` добавить `orderDebt`.

Плитки магазинов (строки 549-554) становятся:

```tsx
  const customerDebt = state.customers.reduce((sum, c) => sum + customerBalance(state, c.id).debt, 0);
  const stockSales = (customerId: string) => state.shipments
    .filter(s => s.customerId === customerId && s.orderId === null && s.status !== 'cancelled')
    .reduce((sum, s) => sum + shipmentTotals(s).revenue, 0);
  const shopRows = state.customers.filter(c => c.kind === 'shop').map(shop => ({
    shop,
    balance: customerBalance(state, shop.id),
    shipped: stockSales(shop.id),
    deliveries: state.shipments.filter(s => s.customerId === shop.id && s.status !== 'cancelled').length,
  }));
  const shopTotals = shopRows.reduce((totals, row) => ({
    shipped: totals.shipped + row.shipped, paid: totals.paid + row.balance.paid,
    debt: totals.debt + row.balance.debt, advance: totals.advance + row.balance.advance,
  }), { shipped: 0, paid: 0, debt: 0, advance: 0 });
```

`src/App.tsx:12` импортирует из `./sales` только `shipmentQty` — добавить `shipmentTotals` в этот же импорт. Локального `round` в `App.tsx` нет и он не нужен: `money()` округляет для отображения сам. В строке 646 `row.ledger.shipments.length` → `row.deliveries`; в 297 и 918 `customerLedger(...)` → `customerBalance(...)`.

`src/components/CustomerCard.tsx` (временная минимальная правка, dash — в T2):
`<span>Shartnoma summasi<b>{money(detail.stats.revenue)}</b></span>` → `<span>Shartnoma summasi<b>{money(detail.balance.contract)}</b></span>`,
`To‘langan`/`Qarz` → `detail.balance.paid` / `detail.balance.debt`,
`Avans` → `detail.balance.advance`.

`src/components/CustomerLedger.tsx`: импорт типа `import type { CustomerBalance } from '../receivables';`, проп `ledger: CustomerBalance`, а таблица строк временно на `ledger.obligations` с `row.id` вместо `row.shipmentId` и `row.label` вместо ветки `row.orderId ? … : …` (полный вид — T2).

- [ ] **Step 8: Типы зелёные**

Run: `npx tsc -b`
Expected: exit 0. Если осталось упоминание `CustomerLedger`/`OrderLedger` — найти `Grep` по `src/**` и заменить на новые имена; шимов не добавлять.

- [ ] **Step 9: Полный прогон и починка пинов**

Run: `npx vitest run`
Expected: часть старых проверок падает — это ожидаемое следствие смены правила. Правим **ожидания**, а не движок. Карта того, что менять:

| Файл | Что было | Что должно быть |
|---|---|---|
| `src/domain.test.ts` (~1242-1267, ~2040-2066, ~2502-2586) | аванс/долг по отгрузкам, `orderLedger`-распределение | `customerBalance`: долг = contract − pool; `salary.deduct` ограничен `balance.debt`; отгрузка со склада без `allowDebt` блокируется, пока есть незакрытый договор |
| `src/console.test.ts` (~68-114, ~157-186) | `debt` из shipment-FIFO | те же суммы, посчитанные от `order.price` согласованных заказов |
| `src/sales.test.ts` (~44-45, ~115-143) | `ledger.shipments[].outstanding` | `balance.obligations[].outstanding`; для отгрузки заказа обязательство = заказ |
| `src/documents.test.ts` | `invoice.paid/debt` по отгрузке | по обязательству того же заказа |
| `src/history.test.ts`, `src/statements.test.ts`, `src/health.test.ts` | суммы долга с учётом черновиков | черновик = 0 долга; `stats.paid` = полученные деньги целиком |
| `src/mobileCards.test.ts`, `src/salary-ui.test.tsx`, `src/statement-ui.test.tsx` | разметка `ledger-row` по отгрузкам | разметка по обязательствам (см. T2) |

Процедура: открыть падающий тест, пересчитать ожидаемое число по правилу спецификации (§3), поправить литерал, добавить комментарий-причину только если число неочевидно. Перепроверить: `npx vitest run` → все файлы зелёные (было 91 файл / 999 тестов — количество может вырасти за счёт нового контракта в T4).

- [ ] **Step 10: Сборка**

Run: `npm run build`
Expected: exit 0 (предупреждение о чанке >500 kB — известная задача #365, не регресс).

---

## Задача T2: Экраны — один баланс, ноль как «—»

**Files:**
- Modify: `src/components/CustomerLedger.tsx`
- Modify: `src/components/CustomerCard.tsx:34-44`
- Modify: `src/components/ShipmentEditor.tsx:74-79`
- Test: `src/customer-balance-ui.test.tsx` (новый), `src/mobileCards.test.ts` (пины)

**Interfaces:**
- Consumes: `CustomerBalance`, `ObligationRow` из `src/receivables.ts` (T1); props компонента `CustomerLedger` не меняются по имени (`customer`, `ledger`, `busy`, `run`), меняется только тип `ledger`.
- Produces: текст-контракт для тестов: плитки подписаны `Shartnoma`, `To‘langan`, `Qarz`, `Avans`; пустое обязательство показывает `—`; строка галочки `allowDebt` и подсказка о очереди долгов.

- [ ] **Step 1: RED — новый файл `src/customer-balance-ui.test.tsx`**

```tsx
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { CustomerLedger } from './components/CustomerLedger';
import { customerBalance } from './receivables';
import type { Actor, Customer, State } from './types';

const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: emptyState().companyId };
const ledgerSource = readFileSync(new URL('./components/CustomerLedger.tsx', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('./components/CustomerCard.tsx', import.meta.url), 'utf8');

// `money()` форматирует разряды через U+00A0, а не обычный пробел — подстроки сравниваем после нормализации.
const spaced = (value: string): string => value.replace(/\u00a0/g, ' ');

function shopState(withDebt: boolean): State {
  const state = emptyState();
  const customer: Customer = { id: 'shop-1', name: 'Chorzu', phone: '', address: '', kind: 'shop', employeeId: null };
  state.customers.push(customer);
  if (withDebt) {
    state.orders.push({
      id: 'order-1', number: 'ORD-0001', kind: 'product', customerId: 'shop-1', title: 'Kreslo',
      outputItemId: null, recipeVersionId: null, substitutions: {},
      qty: 1, price: 30000000, overhead: 0, dueDate: '2026-11-05', createdAt: '2026-10-01T00:00:00Z', status: 'delivered',
      lines: [{ id: 'line-1', kind: 'product', title: 'Kreslo', qty: 1, total: 30000000, status: 'delivered' }],
      materials: [], route: [],
    });
    return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'customer.pay', customerId: 'shop-1', amount: 9200000, account: 'cash' } }, admin);
  }
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'customer.pay', customerId: 'shop-1', amount: 1000000, account: 'cash' } }, admin);
}

function panel(state: State) {
  const customer = state.customers.find(row => row.id === 'shop-1')!;
  return renderToStaticMarkup(createElement(CustomerLedger, {
    customer, ledger: customerBalance(state, 'shop-1'), busy: false, run: async () => true,
  }));
}

describe('customer balance panels', () => {
  it('shows the agreed contract instead of shipped goods', () => {
    expect(panel(shopState(true))).toContain('Shartnoma');
    expect(ledgerSource).not.toContain('Yuborilgan');
  });

  it('lists obligations with their own outstanding amount', () => {
    const html = spaced(panel(shopState(true)));
    expect(html).toContain('ORD-0001 · Kreslo');
    expect(html).toContain('30 000 000');
    expect(html).toContain('20 800 000');
  });

  it('never prints a zero advance next to a live debt', () => {
    const html = panel(shopState(true));
    expect(html).not.toMatch(/>0 so‘m</);
    expect(html).toContain('<small>Avans</small><b>—</b>');
  });

  it('prints a dash where the balance is settled', () => {
    const html = panel(shopState(false));
    expect(html).toContain('<small>Qarz</small><b>—</b>');
    expect(html).not.toMatch(/>0 so‘m</);
  });

  it('keeps the card and the panel on the same four numbers', () => {
    for (const label of ['Shartnoma', 'To‘langan', 'Qarz', 'Avans']) {
      expect(cardSource).toContain(label);
    }
    expect(cardSource).toContain('detail.balance.contract');
    expect(cardSource).toContain('detail.balance.advance');
  });

  it('explains that a payment closes the oldest debt first', () => {
    expect(ledgerSource).toContain('eng eski');
  });
});
```

Run: `npx vitest run src/customer-balance-ui.test.tsx`
Expected: FAIL (плитка ещё «Yuborilgan», строк `obligations` нет, нули печатаются).

- [ ] **Step 2: GREEN — `src/components/CustomerLedger.tsx` целиком**

```tsx
import { useState, type FormEvent } from 'react';
import { Banknote, ChevronDown } from 'lucide-react';
import { date, money } from '../ui';
import type { Command, Customer } from '../types';
import type { CustomerBalance } from '../receivables';

const dash = (value: number): string => value > 0 ? money(value) : '—';

export function CustomerLedger({ customer, ledger, busy, run }: { customer: Customer; ledger: CustomerBalance; busy: boolean; run: (command: Command) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const account = (form.get('account') || 'cash') as 'cash' | 'bank';
    if (await run({ type: 'customer.pay', customerId: customer.id, amount: Number(form.get('amount') || 0), account })) setOpen(false);
  };
  return <article className="ledger-card">
    <div className="ledger-head">
      <div><h3>{customer.name}</h3><small>{customer.address || 'Manzil ko‘rsatilmagan'} · {customer.phone || 'Telefon ko‘rsatilmagan'}</small></div>
      <span className={`badge ${ledger.debt > 0 ? 'debt' : ledger.advance > 0 ? 'ready' : 'delivered'}`}><i />{ledger.debt > 0 ? 'Qarz bor' : ledger.advance > 0 ? 'Avans' : 'Hisob-kitob qilingan'}</span>
    </div>
    <div className="ledger-figures">
      <div><small>Shartnoma</small><b>{money(ledger.contract)}</b></div>
      <div><small>To‘langan</small><b>{dash(ledger.paid)}</b></div>
      <div><small>Qarz</small><b className={ledger.debt > 0 ? 'debt' : ''}>{dash(ledger.debt)}</b></div>
      <div><small>Avans</small><b>{dash(ledger.advance)}</b></div>
    </div>
    {ledger.obligations.length > 0 ? <div className="ledger-rows">{ledger.obligations.map(row => <div className="ledger-row" key={row.id}>
      <span>{date(row.createdAt)}<small>{row.label}</small></span>
      <span>{money(row.total)}</span>
      <span>to‘langan {money(row.paid)}</span>
      <b className={row.outstanding > 0 ? 'debt' : 'positive'}>{row.outstanding > 0 ? money(row.outstanding) : 'yopilgan'}</b>
    </div>)}</div> : <p className="subtle-note">Bu do‘konda hali tasdiqlangan buyurtma yoki ombor sotuvi yo‘q.</p>}
    <div className="ledger-pay">
      {open ? <form onSubmit={submit}>
        <div className="form-grid">
          <label className="field"><span>To‘lov summasi, UZS</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={ledger.debt > 0 ? ledger.debt : undefined} placeholder="Avans bilan ham mumkin" required /></label>
          <label className="field"><span>Hisob</span><select name="account"><option value="cash">Naqd pul</option><option value="bank">Bank / karta</option></select></label>
        </div>
        <div className="button-group"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>Bekor qilish</button><button className="primary" disabled={busy}><Banknote size={15} />{busy ? 'O‘tkazilmoqda…' : 'To‘lovni o‘tkazish'}</button></div>
        <p className="subtle-note">To‘lov avval eng eski qarzni yopadi; tasdiqlangan shartnomadan ortiqcha pul avans bo‘lib qoladi.</p>
      </form> : <button className="secondary" onClick={() => setOpen(true)} disabled={busy}><Banknote size={15} />To‘lov yoki avansni qabul qilish<ChevronDown size={14} /></button>}
    </div>
  </article>;
}
```

Замечания по мелочам, которые тест не видит, но владелец увидит: `yopilgan` ниже по стилю — если в `src/index.css` у класса `.ledger-row b.positive` уже есть зелёный цвет, надписи достаточно; менять CSS не нужно.

- [ ] **Step 3: GREEN — плитки карточки (`src/components/CustomerCard.tsx` 35-44)**

```tsx
    <div className="settings-facts">
      <span>Buyurtmalar<b>{detail.stats.orders}</b></span>
      <span>Shartnoma summasi<b>{money(detail.balance.contract)}</b></span>
      <span>O‘rtacha chek<b>{money(detail.stats.average)}</b></span>
      <span>To‘langan<b>{detail.balance.paid > 0 ? money(detail.balance.paid) : '—'}</b></span>
      <span>Qarz<b className={detail.balance.debt > 0 ? 'debt' : undefined}>{detail.balance.debt > 0 ? money(detail.balance.debt) : '—'}</b></span>
      <span>Avans<b>{detail.balance.advance > 0 ? money(detail.balance.advance) : '—'}</b></span>
      <span>Foyda<b>{money(detail.stats.profit)}</b></span>
      <span>Oxirgi buyurtma<b>{detail.stats.lastOrder ? dateTime(detail.stats.lastOrder) : '—'}</b></span>
    </div>
```

Столбец `Qarz` в таблице заказов карточки (`row.debt`, строка 65) уже приходит из `orderProfit`, который в T1 читает `orderBalance` — черновики сами собой дают `—`/0; менять ничего не нужно, только убедиться, что `money(row.debt)` для нуля даёт читаемое значение (в `src/ui.ts` `money(0)` → `0 so'm`). Если хочется строго `—`, обернуть: `{row.debt > 0 ? money(row.debt) : '—'}` — сделать это, чтобы колонка не намекала на долг черновика.

- [ ] **Step 4: GREEN — текст галочки в `src/components/ShipmentEditor.tsx`**

Строка 74-75: подпись галочки остаётся («Qoplanmagan qarz bilan yuborishga ruxsat beraman»), а пояснение под ней заменить на:

```tsx
        <p className="subtle-note">Qarz to‘lov bilan yopiladi: avval eng eski qarz, keyin yangi. To‘langan pul shartnoma summasidan ortiqcha bo‘lsa, avans bo‘lib qoladi.</p>
```

Оценку «Buyurtma bo‘yicha qolgan qarz» (76-79) оставить: `debt = order.price - orderPaid(state, order.id)` теперь корректен для согласованного заказа; для уверенности заменить расчёт на `orderDebt(state, order)`, а строку 38 привести к:

```tsx
  const debt = order ? orderDebt(state, order) : 0;
```

(импорт `orderDebt` из `../domain`, `orderPaid` из импорта убрать, если он больше не нужен в файле).

- [ ] **Step 5: UI-тесты зелёные**

Run: `npx vitest run src/customer-balance-ui.test.tsx src/mobileCards.test.ts src/salary-ui.test.tsx src/statement-ui.test.tsx`
Expected: PASS. Если `mobileCards.test.ts` ждёт старую разметку `ledger-row` по отгрузкам — обновить ожидаемую строку на `obligations`-вариант (метка `row.label`), не меняя компонент.

- [ ] **Step 6: Проверки**

Run: `npx tsc -b` → exit 0
Run: `npx vitest run` → все файлы зелёные
Run: `npm run build` → exit 0

---

## Задача T3: Сервер — те же правила в `supabase/schema.sql`

**Files:**
- Modify: `supabase/schema.sql:820-883` (три новых функции + переписать две), `:3345-3355` (guard удержания), `:3639` (список REVOKE), `:2131-2133` (объявления ставших ненужными переменных)

**Interfaces:**
- Consumes: таблицы `erp_orders`, `erp_shipments`, `erp_shipment_lines`, `erp_cash`, `erp_worker_deductions`.
- Produces: `erp_customer_paid(uuid, uuid) → numeric`, `erp_customer_obligations(uuid, uuid) → TABLE(id uuid, kind text, total numeric, created_at timestamptz)`, `erp_customer_debt(uuid, uuid) → numeric`, переписанные `erp_customer_advance(uuid, uuid)`, `erp_order_paid(uuid, uuid)`. Сигнатура `erp_customer_advance` не меняется — её вызывают gate отгрузки со склада (`:3588`) и старые verify-скрипты.

- [ ] **Step 1: Вставить три новых помощника прямо перед `erp_customer_advance` (строка 820)**

```sql
-- Money the customer actually handed over: cash-in minus reversals, plus salary deductions.
CREATE FUNCTION public.erp_customer_paid(p_company_id uuid, p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(greatest(
      coalesce((SELECT sum(CASE c.direction WHEN 'in' THEN c.amount WHEN 'out' THEN -c.amount ELSE 0 END)
        FROM public.erp_cash c WHERE c.company_id = p_company_id AND c.source = 'sale' AND c.customer_id = p_customer_id), 0)
    + coalesce((SELECT sum(CASE d.direction WHEN 'deduct' THEN d.amount ELSE -d.amount END)
        FROM public.erp_worker_deductions d WHERE d.company_id = p_company_id AND d.customer_id = p_customer_id), 0), 0), 2);
$$;
-- What the customer owes for: agreed orders at their contract price, plus stock sales with no order.
CREATE FUNCTION public.erp_customer_obligations(p_company_id uuid, p_customer_id uuid)
RETURNS TABLE(id uuid, kind text, total numeric, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, 'order'::text, round(o.price, 2), o.created_at
  FROM public.erp_orders o
  WHERE o.company_id = p_company_id AND o.customer_id = p_customer_id
    AND o.kind <> 'series' AND o.status NOT IN ('draft', 'cancelled')
  UNION ALL
  SELECT s.id, 'stock'::text, round(sum(l.qty * l.sale_price), 2), s.created_at
  FROM public.erp_shipments s
  JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
  WHERE s.company_id = p_company_id AND s.customer_id = p_customer_id
    AND s.order_id IS NULL AND s.status <> 'cancelled'
  GROUP BY s.id, s.created_at;
$$;
CREATE FUNCTION public.erp_customer_debt(p_company_id uuid, p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(greatest(coalesce(sum(o.total), 0) - public.erp_customer_paid(p_company_id, p_customer_id), 0), 2)
  FROM public.erp_customer_obligations(p_company_id, p_customer_id) o;
$$;
```

- [ ] **Step 2: Переписать `erp_customer_advance` (занимает строки 820-839 до вставки)** — всё тело целиком заменить на:

```sql
-- Anything paid above the agreed contract is advance; there is no other way to get advance.
CREATE FUNCTION public.erp_customer_advance(p_company_id uuid, p_customer_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(greatest(public.erp_customer_paid(p_company_id, p_customer_id)
    - coalesce((SELECT sum(o.total) FROM public.erp_customer_obligations(p_company_id, p_customer_id) o), 0), 0), 2);
$$;
```

- [ ] **Step 3: Переписать `erp_order_paid` (бывшие 840-883) — тело целиком**

```sql
-- Payment in contract order: oldest obligation first, so one order can never spend the same money twice.
CREATE FUNCTION public.erp_order_paid(p_company_id uuid, p_order_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_customer uuid; v_pool numeric; v_result numeric;
BEGIN
  SELECT customer_id INTO v_customer FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id;
  IF NOT FOUND OR v_customer IS NULL THEN RETURN 0; END IF;
  v_pool := public.erp_customer_paid(p_company_id, v_customer);
  SELECT coalesce(round(greatest(0, least(seq.total, v_pool - seq.prior)), 2), 0) INTO v_result
  FROM (
    SELECT o.id, o.total,
      coalesce(sum(o.total) OVER (ORDER BY o.created_at, o.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior
    FROM public.erp_customer_obligations(p_company_id, v_customer) o
  ) seq
  WHERE seq.id = p_order_id;
  RETURN coalesce(v_result, 0);
END;
$$;
```

- [ ] **Step 4: Guard `salary.deduct` (бывшие 3345-3355) — один запрос вместо трёх**

```sql
      IF v_amount > public.erp_customer_debt(v_company, v_customer) + 0.004 THEN
        RAISE EXCEPTION 'Amount exceeds customer debt' USING ERRCODE = '22023';
      END IF;
```

Три `SELECT ... INTO v_shipped / v_paid_by_cash / v_paid_by_deduct` над этим условием удалить. Проверить, что переменные больше нигде не нужны, и убрать их объявления (строки 2131-2133), иначе останется мёртвый код:

Run: `grep -n "v_shipped\|v_paid_by_cash\|v_paid_by_deduct" supabase/schema.sql`
Expected: до шага — 7 совпадений; после — 0.

- [ ] **Step 5: Права**

В блок `REVOKE ALL ON FUNCTION` (строка ~3639, в одну строку с `erp_customer_advance(uuid, uuid), erp_order_paid(uuid, uuid),`) добавить три новых хелпера:

```sql
  public.erp_customer_paid(uuid, uuid), public.erp_customer_obligations(uuid, uuid), public.erp_customer_debt(uuid, uuid), public.erp_customer_advance(uuid, uuid), public.erp_order_paid(uuid, uuid),
```

`GRANT EXECUTE ... TO authenticated` (строки 3650-3652) не трогаем: приложение вызывает только `erp_execute`/`erp_snapshot`, хелперы — внутренние.

- [ ] **Step 6: Проверка синтаксиса канонической схемы**

Run: `node .validation-pglite-20261029/verify-sql-probe.mjs` (если скрипт загружает схему) — иначе временный зонд:
```bash
node -e "import('@electric-sql/pglite').then(async ({PGlite})=>{const fs=await import('node:fs/promises');const db=new PGlite();await db.exec(\`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}'); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \\\$\\\$ SELECT null\\\\\\\$ \\\$\\\$\`);await db.exec(await fs.readFile('supabase/schema.sql','utf8'));console.log('schema loads')})" 
```
Expected: «schema loads» без ошибок. (Этот шаг дублируется полноценным зондом в T4 — здесь только быстрый smoke.)

---

## Задача T4: Миграция, контрактный тест и PGlite-зонд

**Files:**
- Create: `.validation-pglite-20261029/generate-customer-balance-migration.mjs`
- Create: `supabase/migrations/20261124_customer_balance.sql` (генерируется)
- Create: `src/balance-contract.test.ts`
- Create: `.validation-pglite-20261029/customer-balance-probe.mjs`

**Interfaces:**
- Consumes: готовый `supabase/schema.sql` (T3), `src/receivables.ts` (T1).
- Produces: файл миграции, применимый повторно; зелёный контрактный тест; зонд с строкой `OK customer-balance-probe {...}`.

- [ ] **Step 1: Генератор миграции — `generate-customer-balance-migration.mjs` целиком**

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261124_customer_balance.sql', root);

const names = ['erp_customer_paid', 'erp_customer_obligations', 'erp_customer_debt', 'erp_customer_advance', 'erp_order_paid', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}
require("AND o.kind <> 'series' AND o.status NOT IN ('draft', 'cancelled')", 'agreed-order filter');
require('AND s.order_id IS NULL AND s.status <> ', 'stock shipment obligation');
require('round(o.price, 2)', 'contract price without markup');
require('IF v_amount > public.erp_customer_debt(v_company, v_customer) + 0.004 THEN', 'salary deduct guard');
require('public.erp_customer_paid(uuid, uuid), public.erp_customer_obligations(uuid, uuid), public.erp_customer_debt(uuid, uuid)', 'helper revoke list');

function definition(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = schema.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated function ${name}`);
  const body = schema.slice(start, end + 4);
  const inner = body.slice(body.indexOf('$$') + 2, body.length - 4);
  if (inner.includes('$$')) throw new Error(`Nested dollar quote in ${name}`);
  return body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

const ddl = `-- Aliya ERP: единый баланс клиента (#366). Долг = согласованные заказы (erp_orders.price)
-- плюс складские отгрузки без заказа минус реально отданные деньги; аванс — только остаток сверху.
-- Черновик и отменённый заказ долга не создают. Safe to run more than once. Existing data is untouched.

BEGIN;

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_customer_paid(uuid, uuid), public.erp_customer_obligations(uuid, uuid), public.erp_customer_debt(uuid, uuid), public.erp_customer_advance(uuid, uuid), public.erp_order_paid(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;

COMMIT;
`;

const sql = ddl + names.map(definition).join('\n') + '\n' + grants;
await fs.writeFile(outputPath, sql);
console.log(JSON.stringify({ functions: names.length, sha256: crypto.createHash('sha256').update(sql).digest('hex') }));
```

Run: `node .validation-pglite-20261029/generate-customer-balance-migration.mjs`
Expected: JSON `{ functions: 6, sha256: … }`; в `supabase/migrations/20261124_customer_balance.sql` шесть `CREATE OR REPLACE FUNCTION`.

- [ ] **Step 2: RED — контрактный тест `src/balance-contract.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261124_customer_balance.sql', import.meta.url), 'utf8');
const body = (name: string) => schema.slice(schema.indexOf(`CREATE FUNCTION public.${name}(`));

describe('customer balance sql contract', () => {
  it('binds the debt to agreed orders only', () => {
    expect(schema).toContain("AND o.kind <> 'series' AND o.status NOT IN ('draft', 'cancelled')");
  });

  it('charges stock sales that belong to no order', () => {
    expect(schema).toContain('AND s.order_id IS NULL AND s.status <> ');
  });

  it('uses the contract price as is, without adding markup', () => {
    expect(body('erp_customer_obligations').slice(0, 1200)).toContain('round(o.price, 2)');
    expect(body('erp_customer_obligations')).not.toContain('o.markup');
  });

  it('keeps advance as the remainder above the contract', () => {
    expect(body('erp_customer_advance')).toContain('erp_customer_paid');
    expect(body('erp_customer_advance')).toContain('erp_customer_obligations');
  });

  it('pays orders in contract order, oldest first', () => {
    expect(body('erp_order_paid')).toContain('ORDER BY o.created_at, o.id');
    expect(body('erp_order_paid')).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
  });

  it('caps a salary deduction at the same debt the frontend shows', () => {
    expect(schema).toContain('IF v_amount > public.erp_customer_debt(v_company, v_customer) + 0.004 THEN');
  });

  it('hides the new helpers behind the same revoke list', () => {
    expect(schema).toContain('public.erp_customer_paid(uuid, uuid), public.erp_customer_obligations(uuid, uuid), public.erp_customer_debt(uuid, uuid)');
  });

  it('ships the migration with every changed body and no hand edits', () => {
    for (const name of ['erp_customer_paid', 'erp_customer_obligations', 'erp_customer_debt', 'erp_customer_advance', 'erp_order_paid', 'erp_execute']) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).not.toContain('DROP FUNCTION');
  });
});
```

Run: `npx vitest run src/balance-contract.test.ts`
Expected: PASS, если T3 и шаг 1 сделаны честно. Если падает — это сигнал, что схема и миграция разошлись: чинить **схему и перегенерировать**, а не тест.

- [ ] **Step 3: PGlite-зонд `customer-balance-probe.mjs`**

Каркас (роль `anon/authenticated/service_role`, стаб `auth.users`, `harness()` с `one/execute/snapshot/bootstrap`, `db.db.exec(schema)`, `pass()`, финальная строка `OK …`) брать из `.validation-pglite-20261029/draft-order-probe.mjs:1-60` без изменений; расхождения быть не должно — там уже есть `companyId` через `erp_profiles`. Идентификаторы в `SELECT` только параметрами `$1/$2` (plpgsql-переменная `v_company` вне тела функции не существует).

Сетап: `erp_bootstrap_company('Customer balance')` → `cash.post` (100 млн, capital) → `customer.create` «Mijoz» (`kind: 'customer'`) и «Chorzu» (`kind: 'shop'`) → `employee.create` «Kamol» → `operation.create` «Kesish» → `item.create` «LDSP» → `purchase.create` + `purchase.receive` (20 листов) —payloads дословно как в `draft-order-probe.mjs:64-86`. Дальше общий помощник:

```js
const companyId = (await db.one('SELECT company_id FROM public.erp_profiles LIMIT 1')).company_id; // того же профиля, что и в harness()
const balanceOf = customer => db.one(
  `SELECT public.erp_customer_debt($1, $2) AS debt,
          public.erp_customer_advance($1, $2) AS advance,
          public.erp_customer_paid($1, $2) AS paid`,
  [companyId, customer]);
const paidOf = order => db.one(`SELECT public.erp_order_paid($1, $2) AS paid`, [companyId, order]);
```

Сценарии (каждый заканчивается `pass('<что доказано>', <числа>)`):

```js
// 1) черновик не создаёт долга: order.create без запуска → status draft
const draftOrder = (await db.execute({ type: 'order.create', input: {
  kind: 'product', customerId: custId, title: 'Kreslo', qty: 1, price: 30000000,
  overhead: 0, dueDate: '', advance: 0, account: 'cash',
  lines: [{ kind: 'product', title: 'Kreslo', qty: 1, unitPrice: 30000000, materials: [], route: [] }],
} })).state.orders.at(-1);
assert.equal(draftOrder.status, 'draft');
assert.equal(Number((await balanceOf(custId)).debt), 0);
assert.equal(Number(await paidOf(draftOrder.id)).paid, 0);
pass('a draft order charges the customer nothing', { price: draftOrder.price });

// 2) согласованный договор: запуск делает заказ обязательством, оплата 9,2 млн → долг 20,8 млн, аванс 0
await db.execute({ type: 'order.update', orderId: draftOrder.id, overhead: 0, dueDate: '', lines: [
  { id: draftOrder.lines[0].id, kind: 'product', title: 'Kreslo', qty: 1, unitPrice: 30000000,
    materials: [{ itemId: item, qty: 2 }],
    route: [{ operationId: op, executorKind: 'employee', employeeId: emp, supplierId: null, rate: 50, qty: 1 }] },
] });
await db.execute({ type: 'order.launch', orderId: draftOrder.id });
await db.execute({ type: 'customer.pay', customerId: custId, amount: 9200000, account: 'cash' });
const agreed = await balanceOf(custId);
assert.equal(Number(agreed.debt), 20800000);
assert.equal(Number(agreed.advance), 0);
assert.equal(Number(agreed.paid), 9200000);
assert.equal(Number(await paidOf(draftOrder.id)).paid, 9200000);
pass('agreed contract keeps one debt and no advance', agreed);

// 3) оплата сверху договора → только аванс, долга нет
await db.execute({ type: 'customer.pay', customerId: custId, amount: 20800000, account: 'cash' });
const over = await balanceOf(custId);
assert.equal(Number(over.debt), 0);
assert.equal(Number(over.advance), 0);
await db.execute({ type: 'customer.pay', customerId: custId, amount: 5000000, account: 'cash' });
const advanced = await balanceOf(custId);
assert.equal(Number(advanced.debt), 0);
assert.equal(Number(advanced.advance), 5000000);
pass('payment above the contract lands as advance', advanced);

// 4) FIFO: старый долг закрывается первым (два согласованных заказа, частичная оплата)
// второй заказ 10 млн по той же схеме (create → update с этапом → launch), затем оплата 4 млн;
// ожидать: erp_order_paid(старый) = 4 000 000 (с учётом уже закрытого долга шага 3 — считать от
// остатка), erp_order_paid(новый) = 0; долг клиента = сумма остатков обоих заказов
const fifo = { old: Number(await paidOf(oldOrderId)), fresh: Number(await paidOf(newOrderId)) };
assert.equal(fifo.fresh, 0);
pass('a payment closes the oldest obligation first', fifo);

// 5) инвариант: долг и аванс одновременно нулевые или одно из них
const invariant = await db.one(
  `SELECT c.id, public.erp_customer_debt($1, c.id) AS debt, public.erp_customer_advance($1, c.id) AS advance
     FROM public.erp_customers c WHERE c.company_id = $1`, [companyId]);
assert.ok(Number(invariant.debt) <= 0 || Number(invariant.advance) <= 0);
pass('debt and advance never coexist', invariant);

// 6) складская отгрузка магазину без заказа = обязательство; без оплаты блокируется, с allowDebt — проходит
const stockLines = [{ itemId: item, qty: 4 }];
let blocked = '';
try {
  await db.execute({ type: 'shipment.createStock', customerId: shopId, lines: stockLines, dueDate: '', allowDebt: false });
} catch (error) { blocked = String(error); }
assert.match(blocked, /Unpaid stock shipment/, 'order-less stock sale needs accept-debt');
await db.execute({ type: 'shipment.createStock', customerId: shopId, lines: stockLines, dueDate: '', allowDebt: true });
const stock = await balanceOf(shopId);
const stockRow = (await db.snapshot()).shipments.at(-1);
const stockRevenue = stockRow.lines.reduce((sum, l) => sum + l.qty * l.salePrice, 0);
assert.equal(Number(stock.debt), stockRevenue);
assert.ok(stockRevenue > 0, 'цена продажи в отгрузке есть — иначе зонд ничего не доказывает');
pass('a stock sale to a shop creates debt', stock);

// 7) salary.deduct сверх erp_customer_debt отклоняется
let refused = '';
try { await db.execute({ type: 'salary.deduct', employeeId: emp, amount: 999000000, note: 'Xato' }); }
catch (error) { refused = String(error); }
assert.match(refused, /Amount exceeds customer debt|Advance exceeds order price/);
pass('a deduction cannot exceed the recorded customer debt', { refused: refused.slice(0, 120) });
```

Ожидаемое по шагу 6 читается из снимка (`qty * salePrice` строк последней отгрузки), а не пишется магическим числом — зонд переживёт смену демо-цен.

Сверка набора обязательств с данными (заменяет «посчитать тем же движком», которого в зонде нет):

```js
const snapshot = await db.snapshot();
const contract = snapshot.orders
  .filter(o => o.customerId === custId && o.kind !== 'series' && o.status !== 'draft' && o.status !== 'cancelled')
  .reduce((sum, o) => sum + o.price, 0);
const server = await db.one(
  `SELECT coalesce(sum(total), 0) AS total FROM public.erp_customer_obligations($1, $2)`, [companyId, custId]);
assert.equal(Number(server.total), Math.round((contract + stockExtrasFor(custId)) * 100) / 100);
pass('the obligation set matches the agreed orders plus order-less stock sales', server);
```

где `stockExtrasFor(customerId)` считает по снимку `shipments` с `orderId === null && status !== 'cancelled'` как `lines.qty * lines.salePrice`.

Run: `node .validation-pglite-20261029/customer-balance-probe.mjs`
Expected: семь `PASS …` и `OK customer-balance-probe {"passes":7,"failures":0,"remoteConnections":0}`.

- [ ] **Step 4: Регрессия легаси-зондов, которые читают долг**

Run: `node .validation-pglite-20261029/validate-worker-deductions.mjs && node .validation-pglite-20261029/draft-order-probe.mjs && node .validation-pglite-20261029/warehouses-probe.mjs`
Expected: все три `OK`. Если `validate-worker-deductions.mjs` падает — значит он ждал shipment-FIFO долга; пересчитать ожидаемое по правилу «договор минус оплата» и поправить **зонд** (он описывает правило, а не реализацию).

- [ ] **Step 5: Полный фронт**

Run: `npx tsc -b` → exit 0
Run: `npx vitest run` → все файлы зелёные (91+1 файл)
Run: `npm run build` → exit 0

---

## Задача T5: Итоговая проверка, демо-прогон и порядок выката

**Files:**
- Modify: `docs/superpowers/specs/2026-11-19-customer-single-balance-design.md` — если реализация разошлась с текстом, исправить спецификацию или код, но не оставлять расхождение.

**Interfaces:**
- Consumes: T1–T4.
- Produces: подтверждение владельцу + пакет выката (SQL → деплой), каждый шаг по отдельному разрешению.

- [ ] **Step 1: Чек-лист по спецификации**

Пройти §2–§9 спецификации строка за строкой и для каждого правила указать, где оно исполнено: движок (`src/receivables.ts`), экран (`CustomerCard.tsx` / `CustomerLedger.tsx`), SQL (`erp_customer_debt` / `erp_order_paid`), тест (имя теста). Ни одного правила без ссылки.

- [ ] **Step 2: Свежие доказательства**

Run: `npx tsc -b; npx vitest run; npm run build`
Run: `node .validation-pglite-20261029/customer-balance-probe.mjs`
Expected: exit 0 / все тесты зелёные / `OK customer-balance-probe`. Числа из вывода (файлы, тесты, размеры бандла) — в отчёт владельцу, без «должно быть».

- [ ] **Step 3: Демо-прогон в браузере (демо-режим, VITE_SUPABASE_* пустые)**

Run: `npm run dev` и открыть страницу клиентов.
Проверить три истории: (а) клиент с согласованным заказом 30 млн и оплатой 9,2 млн → плитки `Shartnoma 30 000 000`, `To‘langan 9 200 000`, `Qarz 20 800 000`, `Avans —`; (б) клиент-черновик без запуска → `Qarz —`; (в) магазин со складской продажей → одна долг-строка, после оплаты `Hisob-kitob qilingan`. Скриншоты могут не сняться (известное ограничение MCP/скринов) — тогда фиксировать числами из DOM через `evaluate_script`.

- [ ] **Step 4: Отчёт владельцу (русский) и пакет выката**

Отчёт: что изменилось в поведении, какие экраны, доказательство проверок, и то, что **ничего не опубликовано**.
Порядок выката — два шага, каждый требует отдельного разрешения:
1. SQL: `supabase/migrations/20261124_customer_balance.sql` в Supabase SQL Editor (владельцем), после — проверка
```sql
SELECT public.erp_customer_debt('_company', 'customer') AS debt,
       public.erp_customer_advance('company', 'customer') AS advance;
```
у двух реальных клиентов: `debt` и `advance` одновременно ненулевыми быть не должно.
2. Деплой фронта: `npm run deploy` (Worker `erp-tizim`) — только после применения SQL, иначе фронт покажет новые числа, а `erp_execute` будет стричь удержания по старому shipment-FIFO.

- [ ] **Step 5: Память**

Обновить `project-customer-advance-vs-debt.md`: переключатель «Avans sifatida qoldirish» отменён владельцем; база — согласованный договор; FIFO автоматический; гипотеза о двойном markup в `schema.sql:2527` не подтвердилась; статус — код готов локально, выкат по разрешению. Задачи трекера #366 и #391 закрыть после шага 4.
