# Финансы PRO, под-проект C: «Oylik xarajatlar» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Повторяющиеся расходы месяца (коммуналка, кухня, уличные услуги) с помесячным FIFO-долгом «как по поставщикам», авансами вперёд и метрикой обязательств в кассе.

**Architecture:** Чистый derived-движок `src/expenses.ts` по коллекции `state.expensePlans` и кассовым записям `source: 'expense'` строит помесячную сетку обязательств и FIFO-раскладку платежей — хранимых агрегатов нет ни в домене, ни в базе. Команды `expense.plan.set` / `expense.pay` пишут только планы и обычные `CashEntry`; Postgres повторяет те же правила в `erp_expense_ledger()` и отклоняет платёж больше `owed` тем же текстом, что и TS.

**Tech Stack:** TypeScript strict, Vitest, React 19, Vite 6, Supabase/Postgres (PL/pgSQL), PGlite для зондов.

**Spec:** `docs/superpowers/specs/2026-11-05-finance-pro-C-design.md`

## Global Constraints

- Рабочая папка `C:\Users\abdul\Documents\Qoder\2026-10-29\dd682fe3` **не является Git-репозиторием**: шагов `git commit` в плане нет, каждый шаг заканчивается проверкой (`npx vitest run …`, `npm run build`, `node .validation-pglite-20261029/…`).
- Порядок всегда: сначала падающий тест (RED — увидеть текст ошибки), потом реализация (GREEN), потом проверка без предупреждений.
- `npm run deploy` (Cloudflare Worker `erp-tizim`) и применение миграции к живой базе Supabase **вне этого плана** — только по отдельному разрешению владельца. Задачи 6–8 готовят файлы и проверяют их изолированным PGlite-зондом.
- `State.version` остаётся `4`. `expensePlans` — обязательное поле состояния (все состояния рождаются из `emptyState()`).
- `src/expenses.ts` импортирует только `type { State }` из `./types`. Импорта `./domain` быть не должно — `domain.ts` сам вызывает `expenseLedger`, получится цикл.
- Текст интерфейса — узбекская латиница, валюта UZS. Словарь фиксирован: `Oylik reja`, `To‘langan`, `Qarzdorlik`, `Oldindan to‘langan`, `Oylik xarajat`, `Oylik xarajat to‘lovi`, `to‘langan`, `qisman`, `to‘lanmagan`, `har oy {dueDay}-kungacha`, `Oldindan to‘lovga ruxsat`.
- В `src/i18n.ts` уже есть `messages.cashSupplier` и т.п.; ключ для нового источника кассы (`cashExpense`) добавляется константой в самом `i18n.ts`.
- `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` — единственные ключи в фронтенд-окружении. Никаких секретов в код, тесты и логи.
- Проверка UI — в демо-режиме (пустые `VITE_SUPABASE_*`), чтобы не писать в живые данные.

## File structure

| Файл | Ответственность |
| --- | --- |
| `src/types.ts` (modify) | `CashSource` += `'expense'`, `ExpensePlan`, `State.expensePlans`, два новых члена `Command` |
| `src/expenses.ts` (create) | Чистый движок: помесячная сетка, FIFO, `ExpenseLedger`, `expensesDebt` |
| `src/expenses.test.ts` (create) | Правила 1–7 спецификации, идентичность `Σ unpaid = owed` |
| `src/domain.ts` (modify) | `emptyState()`, кейсы `expense.plan.set` / `expense.pay`, ветка `expense` в `cash.reverse` |
| `src/migrations.ts` (modify) | Дефолт `[]` для старой копии без поля |
| `src/sync.ts` (modify) | `verifiedSnapshot` требует `expensePlans` от серверного снимка |
| `src/i18n.ts` (modify) | `cashSources` += `expense` (обязательно для `Record<CashSource, …>`), `cashCategories` += `expense: 'Oylik xarajat'` |
| `src/reports.ts` (modify) | Операционные расходы считают `source === 'expense'` |
| `src/sections.ts` (modify) | Панель `xarajatlar` в «Moliya va kassa» |
| `src/components/ExpensePanel.tsx` (create) | Метрики, карточки планов, полоса месяцев, журнал проводки |
| `src/App.tsx` (modify) | Рендер панели, модалки `expensePlan` / `expensePay`, метрика Majburiyatlar, журнал и Kreditor qarzdorlik |
| `supabase/schema.sql` (modify) | `erp_expense_plans`, RLS, секция снимка, кейсы `erp_execute`, `erp_expense_ledger()` |
| `supabase/migrations/20261105_expense_plans.sql` (create) | Идемпотентная миграция живой базы (готовится, применяется только с разрешения) |
| `supabase/functions/_shared/backup.ts` (modify) | `STATE_COLLECTIONS` += `expensePlans` |
| `src/seed.ts` (modify) | Демо: три плана (закрытый, частично, в долгу) |
| `.validation-pglite-20261029/validate-expense-migration.mjs` (create) | Зонд миграции: TS против `erp_expense_ledger`, круг копия→восстановление |
| `.validation-pglite-20261029/validate.mjs` (modify) | Транспиляция `expenses` в `digest()` |
| Тесты, которые правятся, а не создаются | `src/migrations.test.ts`, `src/sync.test.ts`, `src/domain.test.ts`, `src/i18n.test.ts`, `src/reports.test.ts`, `src/sections.test.ts`, `src/mobileCards.test.ts`, `src/copy.test.ts` |

---

### Task 1: Типы и коллекция `expensePlans` в обвязке

**Files:**
- Modify: `src/types.ts` (L5 `CashSource`, после `SalaryPlan` L63, `State` L75-79, `Command` после `salary.pay`)
- Modify: `src/domain.ts:357-363` (`emptyState`)
- Modify: `src/migrations.ts:115-131`
- Modify: `src/sync.ts:25`
- Modify: `src/i18n.ts:35-43, 96-102` (`messages.cashExpense` + запись `cashSources`) — без этого `tsc` не соберётся: `cashSources` — `Record<CashSource, MessageKey>`
- Test: `src/migrations.test.ts`, `src/sync.test.ts`, `src/i18n.test.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces: `ExpensePlan { id: string; planId: string; title: string; amount: number; fromMonth: string; dueDay: number; supplierId: string | null; createdAt: string }`, `State.expensePlans: ExpensePlan[]`, `CashSource` с членом `'expense'`, команды `{ type: 'expense.plan.set'; planId: string | null; title: string; amount: number; fromMonth: string; dueDay: number; supplierId: string | null }` и `{ type: 'expense.pay'; planId: string; amount: number; account: Account; note: string; allowPrepay: boolean }`. Кейсов `mutate()` здесь ещё нет — `default:` в `src/domain.ts:1280` бросает `Unknown command`, и это правильно до Задачи 3.

- [ ] **Step 1: RED — миграция старой копии**

Добавить в конец блока `describe('tenant state', …)` в `src/migrations.test.ts` (рядом с тестом `salaryPlans` из под-проекта A):

```ts
  it('adds expensePlans to a version 4 snapshot that predates monthly expenses', () => {
    const { expensePlans: _expensePlans, ...withoutPlans } = JSON.parse(JSON.stringify(emptyState())) as State & { expensePlans?: unknown };
    expect(withoutPlans.expensePlans).toBeUndefined();
    const migrated = migrateState(withoutPlans);
    expect(migrated.expensePlans).toEqual([]);
  });
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/migrations.test.ts`
Expected: FAIL — `expected undefined to deeply equal []`.

- [ ] **Step 3: RED — серверный снимок без `expensePlans`**

В `src/sync.test.ts` хелпер `strip` уже есть (добавлен в под-проекте A, `src/sync.test.ts:45-52`). Добавить в конец файла `describe`:

```ts
describe('expensePlans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits expensePlans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.expensePlans).toEqual([]);
    f.strip('expensePlans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without expensePlans', async () => {
    const f = setup(); f.online(true); f.strip('expensePlans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

- [ ] **Step 4: Запустить и увидеть падение**

Run: `npx vitest run src/sync.test.ts`
Expected: FAIL на обоих тестах — `expensePlans` нет в списке `arrays` `verifiedSnapshot`, сломанный снимок принимается.

- [ ] **Step 5: RED — метка нового источника кассы**

В `src/i18n.test.ts:19` заменить строку `const sources: CashSource[] = ['manual', 'sale', 'supplier', 'payroll', 'transfer'];` на:

```ts
    const sources: CashSource[] = ['manual', 'sale', 'supplier', 'payroll', 'expense', 'transfer'];
```

Этот тест уже импортирует `CashSource` и `cashSourceLabel`. После замены прогон упадёт с ошибкой компиляции `"expense" is not assignable to type 'CashSource'` — это и есть ожидаемый RED этого шага.

Run: `npx vitest run src/i18n.test.ts`
Expected: FAIL с ошибкой типов о неизвестном члене `CashSource`.

- [ ] **Step 6: GREEN — типы**

`src/types.ts:5`:

```ts
export type CashSource = 'manual' | 'sale' | 'supplier' | 'payroll' | 'expense' | 'transfer';
```

После `SalaryPlan` (L63) добавить:

```ts
export interface ExpensePlan {
  id: string;        // версия-строка
  planId: string;    // группирует версии одного расхода
  title: string;
  amount: number;
  fromMonth: string; // 'YYYY-MM'
  dueDay: number;    // 1..31, информационный
  supplierId: string | null;
  createdAt: string;
}
```

В `State` (L75-79) после `salaryPlans: SalaryPlan[];`:

```ts
  cash: CashEntry[]; reports: WorkReport[]; payroll: PayrollEntry[]; salaryPlans: SalaryPlan[]; expensePlans: ExpensePlan[]; shipments: Shipment[]; audit: AuditEntry[];
```

В `Command` — сразу после `salary.pay` (L124):

```ts
  | { type: 'expense.plan.set'; planId: string | null; title: string; amount: number; fromMonth: string; dueDay: number; supplierId: string | null }
  | { type: 'expense.pay'; planId: string; amount: number; account: Account; note: string; allowPrepay: boolean }
```

- [ ] **Step 7: GREEN — обвязка**

`src/domain.ts`, `emptyState()` — после `salaryPlans: [],`:

```ts
    shipments: [], audit: [], salaryPlans: [], expensePlans: [],
```

`src/migrations.ts` — в возвращаемом объекте после `salaryPlans: Array.isArray(source.salaryPlans) ? source.salaryPlans : [],`:

```ts
    expensePlans: Array.isArray(source.expensePlans) ? source.expensePlans : [],
```

Массив `collections` (`src/migrations.ts:7-10`) **не трогать**: живые снимки приходят без `expensePlans` до миграции базы.

`src/sync.ts:25` — в конец массива `arrays` (после `'audit'`):

```ts
  const arrays: (keyof State)[] = ['customers', 'suppliers', 'employees', 'machines', 'operations', 'items', 'recipes', 'orders', 'purchases', 'movements', 'cash', 'reports', 'payroll', 'salaryPlans', 'expensePlans', 'shipments', 'audit'];
```

`src/i18n.ts` — в `messages` после `cashTransfer: 'Hisoblar o‘rtasida o‘tkazma',`:

```ts
  cashExpense: 'Oylik xarajat to‘lovi',
```

В `cashSources` (L96-102) после `payroll: 'cashPayroll',`:

```ts
  expense: 'cashExpense',
```

- [ ] **Step 8: Проверка**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts src/i18n.test.ts` → PASS, чисто, без предупреждений.
Run: `npm run build` → exit 0. Если `tsc` ругнётся на литералы `State` без `expensePlans`, искать не нужно — их нет, все состояния из `emptyState()`.

---

### Task 2: Движок `src/expenses.ts`

**Files:**
- Create: `src/expenses.ts`
- Test: `src/expenses.test.ts`

**Interfaces:**
- Consumes: `State`, `ExpensePlan` из `./types` (Задача 1).
- Produces:
  ```ts
  export interface ExpenseMonth { month: string; obliged: number; paid: number; unpaid: number }
  export interface ExpenseLedger { planId: string; title: string; months: ExpenseMonth[]; prepaid: number; owed: number; paidTotal: number; plannedTotal: number }
  export function expenseLedger(state: State, planId: string, asOf?: string): ExpenseLedger
  export function expensesDebt(state: State): number
  ```
  `asOf` — ISO-строка или `YYYY-MM`; горизонт = её месяц. Без аргумента — текущий месяц. `expensesDebt` — Σ `owed` по всем `planId` состояния.

- [ ] **Step 1: RED — правила движка**

`src/expenses.test.ts` — целиком:

```ts
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { expenseLedger, expensesDebt } from './expenses';
import type { CashEntry, ExpensePlan, State } from './types';

const YEAR = 2026;
const startMonth = `${YEAR}-11`;

function cash(direction: 'in' | 'out', amount: number, createdAt: string, id = crypto.randomUUID()): CashEntry {
  return { id, direction, amount, account: 'cash', toAccount: null, source: 'expense', sourceId: 'p1',
    customerId: null, category: 'expense', note: '', reversalOf: null, createdAt };
}

function plan(amount: number, fromMonth: string, createdAt = `${fromMonth}-01T00:00:00.000Z`): ExpensePlan {
  return { id: crypto.randomUUID(), planId: 'p1', title: 'Ijara', amount, fromMonth, dueDay: 15, supplierId: null, createdAt };
}

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  for (const row of rows) Object.assign(state, row);
  return state;
}

describe('expense ledger', () => {
  const asOf = `${YEAR}-11-30T12:00:00.000Z`;

  it('returns an empty ledger without a plan', () => {
    const ledger = expenseLedger(fixture(), 'p1', asOf);
    expect(ledger).toEqual({ planId: 'p1', title: '', months: [], prepaid: 0, owed: 0, paidTotal: 0, plannedTotal: 0 });
  });

  it('opens one full month per calendar month, first month included in full', () => {
    const ledger = expenseLedger(fixture({ expensePlans: [plan(1200000, startMonth)] }), 'p1', asOf);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1200000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('charges the first plan month in full even when the ledger is read mid-month', () => {
    const ledger = expenseLedger(fixture({ expensePlans: [plan(1200000, startMonth)] }), 'p1', `${YEAR}-11-20T00:00:00.000Z`);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
  });

  it('stacks plan versions by month, not by insertion order', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1500000, '2027-01'), plan(1200000, startMonth)],
    }), 'p1', '2027-01-31T00:00:00.000Z');
    expect(ledger.months.map(m => [m.month, m.obliged]))
      .toEqual([['2026-11', 1200000], ['2026-12', 1200000], ['2027-01', 1500000]]);
  });

  it('applies payments FIFO across months and keeps the identity', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [cash('out', 1500000, `${YEAR}-11-10T09:00:00.000Z`)],
    }), 'p1', '2026-12-20T00:00:00.000Z');
    expect(ledger.months).toEqual([
      { month: '2026-11', obliged: 1200000, paid: 1200000, unpaid: 0 },
      { month: '2026-12', obliged: 1200000, paid: 300000, unpaid: 900000 },
    ]);
    expect(ledger.owed).toBe(900000);
    expect(ledger.prepaid).toBe(0);
  });

  it('pushes the surplus into prepaid when the payment exceeds plannedTotal', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [cash('out', 2000000, `${YEAR}-11-05T09:00:00.000Z`)],
    }), 'p1', asOf);
    expect(ledger.prepaid).toBe(800000);
    expect(ledger.owed).toBe(0);
    expect(ledger.paidTotal).toBe(2000000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('returns a reversed payment to the balance', () => {
    const paid = cash('out', 800000, `${YEAR}-11-05T09:00:00.000Z`, 'c1');
    const reversal = { ...cash('in', 800000, `${YEAR}-11-09T09:00:00.000Z`), reversalOf: 'c1' };
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth)],
      cash: [paid, reversal],
    }), 'p1', asOf);
    expect(ledger.paidTotal).toBe(0);
    expect(ledger.owed).toBe(1200000);
  });

  it('keeps the FIFO split identical to the totals', () => {
    const ledger = expenseLedger(fixture({
      expensePlans: [plan(1200000, startMonth), plan(1300000, '2026-12')],
      cash: [cash('out', 900000, `${YEAR}-11-10T09:00:00.000Z`), cash('out', 400000, `${YEAR}-12-02T09:00:00.000Z`)],
    }), 'p1', '2026-12-20T00:00:00.000Z');
    const unpaid = ledger.months.reduce((sum, month) => sum + month.unpaid, 0);
    expect(unpaid).toBe(ledger.owed);
    expect(ledger.owed).toBe(Math.max(0, ledger.plannedTotal - ledger.paidTotal));
    expect(ledger.prepaid).toBe(Math.max(0, ledger.paidTotal - ledger.plannedTotal));
  });

  it('sums owed across all plans in expensesDebt', () => {
    const state = fixture({
      expensePlans: [plan(1200000, startMonth), { ...plan(500000, startMonth), planId: 'p2' }],
      cash: [cash('out', 300000, `${YEAR}-11-10T09:00:00.000Z`), { ...cash('out', 500000, `${YEAR}-11-10T09:00:00.000Z`), sourceId: 'p2' }],
    });
    expect(expensesDebt(state)).toBe(1200000);
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/expenses.test.ts`
Expected: FAIL — `Failed to resolve import "./expenses"`. Это корректное падение «модуля нет», а не опечатка в тесте.

- [ ] **Step 3: GREEN — движок**

`src/expenses.ts` — целиком:

```ts
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthOf = (value: string): string => value.slice(0, 7);

export interface ExpenseMonth { month: string; obliged: number; paid: number; unpaid: number }

export interface ExpenseLedger {
  planId: string;
  title: string;
  months: ExpenseMonth[];
  prepaid: number;
  owed: number;
  paidTotal: number;
  plannedTotal: number;
}

export function expenseLedger(state: State, planId: string, asOf?: string): ExpenseLedger {
  const versions = state.expensePlans
    .filter(row => row.planId === planId)
    .sort((a, b) => a.fromMonth.localeCompare(b.fromMonth) || a.createdAt.localeCompare(b.createdAt));
  const paidTotal = round(state.cash.reduce((total, row) => {
    if (row.source !== 'expense' || row.sourceId !== planId) return total;
    if (row.direction === 'out') return total + row.amount;
    if (row.direction === 'in') return total - row.amount;
    return total;
  }, 0));
  if (!versions.length) {
    return { planId, title: '', months: [], prepaid: Math.max(0, paidTotal), owed: 0, paidTotal, plannedTotal: 0 };
  }
  const horizon = monthOf(asOf ?? new Date().toISOString());
  const months: ExpenseMonth[] = [];
  let month = versions[0].fromMonth;
  let amount = versions[0].amount;
  let cursor = 0;
  while (month <= horizon) {
    while (cursor + 1 < versions.length && versions[cursor + 1].fromMonth <= month) {
      cursor += 1;
      amount = versions[cursor].amount;
    }
    months.push({ month, obliged: round(amount), paid: 0, unpaid: round(amount) });
    month = nextMonth(month);
  }
  const plannedTotal = round(months.reduce((sum, row) => sum + row.obliged, 0));
  let pool = paidTotal;
  for (const row of months) {
    const paid = Math.min(Math.max(0, pool), row.unpaid);
    row.paid = round(paid);
    row.unpaid = round(row.unpaid - paid);
    pool = round(pool - paid);
  }
  const prepaid = Math.max(0, pool);
  const owed = Math.max(0, plannedTotal - paidTotal);
  return { planId, title: versions[0].title, months, prepaid, owed, paidTotal, plannedTotal };
}

export function expensesDebt(state: State): number {
  const ids = new Set(state.expensePlans.map(row => row.planId));
  return round([...ids].reduce((sum, id) => sum + expenseLedger(state, id).owed, 0));
}
```

- [ ] **Step 4: Запустить и увидеть прохождение**

Run: `npx vitest run src/expenses.test.ts`
Expected: PASS, 9 тестов, чисто.
Run: `npx vitest run src/salary.test.ts` — регрессия движка окладов не тронута.
Run: `npm run build` → exit 0.

---

### Task 3: Команды домена

**Files:**
- Modify: `src/domain.ts` (import, кейсы после `salary.pay` L1151, ветка `expense` в `cash.reverse` L1176-1179)
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `expenseLedger` из `./expenses` (Задача 2), команды из Задачи 1.
- Produces: поведение команд `expense.plan.set` (создание, замена версии, валидация) и `expense.pay` (FIFO-лимит `owed`, флаг `allowPrepay`, остаток кассы, `note` ≤ 200), сторно кассовой записи `source: 'expense'`.

- [ ] **Step 1: RED — тесты команд**

В `src/domain.test.ts` добавить в конец файла:

```ts
describe('monthly expense plans', () => {
  const next = (state: State, command: Command): State => applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

  it('creates a plan and returns its planId', () => {
    let state = emptyState();
    state.revision = 1;
    const id = next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const row = state.expensePlans[0];
    expect(row.planId).toBe(id);
    expect(row.title).toBe('Ijara');
    expect(row.dueDay).toBe(15);
    expect(state.expensePlans).toHaveLength(1);
  });

  it('replaces a version of the same plan and month instead of stacking', () => {
    let state = emptyState();
    state.revision = 1;
    next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null });
    const row = state.expensePlans[0];
    next(state, { type: 'expense.plan.set', planId: row.planId, title: 'Ijara', amount: 1300000, fromMonth: '2026-11', dueDay: 10, supplierId: null });
    expect(state.expensePlans).toHaveLength(1);
    expect(state.expensePlans[0].amount).toBe(1300000);
    expect(state.expensePlans[0].dueDay).toBe(10);
  });

  it('rejects an invalid month, day, amount, title and unknown supplier', () => {
    let state = emptyState();
    state.revision = 1;
    expect(() => next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-13', dueDay: 15, supplierId: null }))
      .toThrow('Invalid expense plan month');
    expect(() => next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 0, supplierId: null }))
      .toThrow('Invalid expense due day');
    expect(() => next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: -5, fromMonth: '2026-11', dueDay: 15, supplierId: null }))
      .toThrow('Invalid amount');
    expect(() => next(state, { type: 'expense.plan.set', planId: null, title: '  ', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }))
      .toThrow('Expense title required');
    expect(() => next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: 'no-such-supplier' }))
      .toThrow('Supplier not found');
    expect(state.expensePlans).toHaveLength(0);
  });

  it('pays within owed and refuses overpayment without the flag', () => {
    let state = emptyState();
    state.revision = 1;
    const planId = next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }) as string;
    expect(() => next(state, { type: 'expense.pay', planId, amount: 1300000, account: 'cash', note: '', allowPrepay: false }))
      .toThrow('Payment exceeds payable');
    next(state, { type: 'expense.pay', planId, amount: 1200000, account: 'cash', note: 'noyabr', allowPrepay: false });
    const entry = state.cash[0];
    expect(entry.source).toBe('expense');
    expect(entry.sourceId).toBe(planId);
    expect(entry.category).toBe('expense');
    expect(entry.direction).toBe('out');
    expect(expenseLedger(state, planId).owed).toBe(0);
  });

  it('allows prepayment with the flag and pushes the surplus into prepaid', () => {
    let state = emptyState();
    state.revision = 1;
    const planId = next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }) as string;
    next(state, { type: 'expense.pay', planId, amount: 2000000, account: 'cash', note: 'ikki oy', allowPrepay: true });
    const ledger = expenseLedger(state, planId);
    expect(ledger.owed).toBe(0);
    expect(ledger.prepaid).toBe(800000);
  });

  it('rejects payments to a missing plan, an unknown account and a long note', () => {
    let state = emptyState();
    state.revision = 1;
    expect(() => next(state, { type: 'expense.pay', planId: 'no-plan', amount: 100, account: 'cash', note: '', allowPrepay: false }))
      .toThrow('Expense plan not found');
    const planId = next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }) as string;
    expect(() => next(state, { type: 'expense.pay', planId, amount: 100, account: 'wallet' as never, note: '', allowPrepay: false }))
      .toThrow('Invalid account');
    expect(() => next(state, { type: 'expense.pay', planId, amount: 100, account: 'cash', note: 'x'.repeat(201), allowPrepay: false }))
      .toThrow('Note is too long');
  });

  it('reverses an expense payment and returns the money to the balance', () => {
    let state = emptyState();
    state.revision = 1;
    const planId = next(state, { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null }) as string;
    next(state, { type: 'expense.pay', planId, amount: 500000, account: 'cash', note: '', allowPrepay: false });
    const entry = state.cash[0];
    next(state, { type: 'cash.reverse', entryId: entry.id, note: 'xato' });
    expect(expenseLedger(state, planId).paidTotal).toBe(0);
    expect(expenseLedger(state, planId).owed).toBe(1200000);
  });

  it('acknowledges an idempotent retry of the same request', () => {
    let state = emptyState();
    state.revision = 1;
    const envelope = { requestId: crypto.randomUUID(), expectedRevision: state.revision, command: { type: 'expense.plan.set', planId: null, title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null } as Command };
    const first = applyCommand(state, envelope, admin);
    const second = applyCommand(first, envelope, admin);
    expect(second.expensePlans).toHaveLength(1);
    expect(second.revision).toBe(first.revision);
  });
});
```

Импорты в шапке `src/domain.test.ts`: добавить `expenseLedger` в существующий import из `'./expenses'` (если модуль ещё не импортирован — добавить строку `import { expenseLedger } from './expenses';`). Проверить, что `admin`, `applyCommand`, `emptyState`, типы `Command`/`State` уже импортированы — они используются существующими тестами этого файла.

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/domain.test.ts`
Expected: FAIL — `Unknown command` на первом же кейсе `expense.plan.set`.

- [ ] **Step 3: GREEN — кейсы домена**

`src/domain.ts` — в импорты (L1-5) добавить `import { expenseLedger } from './expenses';`.

После кейса `salary.pay` (L1143-1151) добавить:

```ts
    case 'expense.plan.set': {
      const title = command.title.trim();
      check(title.length > 0 && title.length <= 200, 'Expense title required');
      const amount = money(command.amount);
      check(/^\d{4}-\d{2}$/.test(command.fromMonth) && !Number.isNaN(Date.parse(`${command.fromMonth}-01T00:00:00Z`)), 'Invalid expense plan month');
      check(Number.isInteger(command.dueDay) && command.dueDay >= 1 && command.dueDay <= 31, 'Invalid expense due day');
      if (command.supplierId !== null) find(state.suppliers, command.supplierId, 'Supplier');
      const planId = command.planId ?? uuid();
      const existing = state.expensePlans.find(row => row.planId === planId && row.fromMonth === command.fromMonth);
      if (existing) {
        existing.title = title;
        existing.amount = amount;
        existing.dueDay = command.dueDay;
        existing.supplierId = command.supplierId;
      } else {
        state.expensePlans.push({ id: uuid(), planId, title, amount, fromMonth: command.fromMonth, dueDay: command.dueDay, supplierId: command.supplierId, createdAt: now() });
      }
      return planId;
    }
    case 'expense.pay': {
      check(state.expensePlans.some(row => row.planId === command.planId), 'Expense plan not found');
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      const value = money(command.amount, true);
      account(command.account);
      check(command.allowPrepay || value <= expenseLedger(state, command.planId).owed, 'Payment exceeds payable');
      postCash(state, {
        direction: 'out', amount: value, account: command.account, toAccount: null, source: 'expense',
        sourceId: command.planId, customerId: null, category: 'expense', note, reversalOf: null,
      });
      return command.planId;
    }
```

В `cash.reverse` (L1176-1179), после строки `if (original.source === 'payroll') find(state.employees, original.sourceId ?? '', 'Employee');` добавить:

```ts
      if (original.source === 'expense') check(state.expensePlans.some(row => row.planId === original.sourceId), 'Expense plan not found');
```

Проверки отрицательного остатка после сторно для `expense` не нужно: `expenseLedger(...).owed` всегда `≥ 0` по построению (нет ветки «без плана» с отрицательным балансом, в отличие от `payrollDebt`).

- [ ] **Step 4: Запустить и увидеть прохождение**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS (новые 8 кейсов + существующие).
Run: `npx vitest run src/salary.test.ts src/expenses.test.ts` — регрессия.
Run: `npm run build` → exit 0.

---

### Task 4: Категория кассы и операционные расходы

**Files:**
- Modify: `src/i18n.ts:130-139` (`cashCategories`)
- Modify: `src/reports.ts:79-82` (операционные расходы)
- Test: `src/i18n.test.ts`, `src/reports.test.ts`

**Interfaces:**
- Consumes: `CashSource` с `'expense'` (Задача 1).
- Produces: `cashCategoryLabel('expense') === 'Oylik xarajat'`; `periodReport(...).operating` включает платежи `source: 'expense'` (out — плюс, in — минус) и не меняет цифры для остальных источников.

- [ ] **Step 1: RED — категория**

В `src/i18n.test.ts` в describe с `cashCategoryLabel` добавить:

```ts
  it('labels the monthly expense category in Uzbek', () => {
    expect(cashCategoryLabel('expense')).toBe('Oylik xarajat');
  });
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/i18n.test.ts`
Expected: FAIL — `expected 'expense' to be 'Oylik xarajat'` (сейчас функция возвращает вход как есть).

- [ ] **Step 3: RED — операционные расходы**

В `src/reports.test.ts` добавить:

```ts
describe('monthly expense payments in operating costs', () => {
  it('counts expense payments into operating and nets reversals', () => {
    const state = emptyState();
    state.revision = 1;
    state.cash = [
      { id: 'c1', direction: 'out', amount: 500000, account: 'cash', toAccount: null, source: 'expense', sourceId: 'p1', customerId: null, category: 'expense', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'c2', direction: 'in', amount: 200000, account: 'cash', toAccount: null, source: 'expense', sourceId: 'p1', customerId: null, category: 'expense', note: 'storno', reversalOf: 'c1', createdAt: '2026-11-06T09:00:00.000Z' },
    ];
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.operating).toBe(300000);
  });

  it('keeps payroll and supplier payments out of operating', () => {
    const state = emptyState();
    state.revision = 1;
    state.cash = [
      { id: 'c1', direction: 'out', amount: 700000, account: 'cash', toAccount: null, source: 'payroll', sourceId: 'e1', customerId: null, category: 'payroll', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
      { id: 'c2', direction: 'out', amount: 400000, account: 'cash', toAccount: null, source: 'supplier', sourceId: 's1', customerId: null, category: 'supplier', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    ];
    const report = periodReport(state, '2026-11-01', '2026-11-30');
    expect(report.operating).toBe(0);
  });
});
```

Проверить, что `emptyState` и `periodReport` уже импортированы в `src/reports.test.ts`; если нет — добавить импорты.

- [ ] **Step 4: Запустить и увидеть падение**

Run: `npx vitest run src/reports.test.ts`
Expected: FAIL — `operating` сейчас не видит `source: 'expense'`, будет `0` вместо `300000`.

- [ ] **Step 5: GREEN**

`src/i18n.ts`, `cashCategories` (L130-139) — после `transfer: 'O‘tkazma',`:

```ts
  expense: 'Oylik xarajat',
```

`src/reports.ts` L79-82 — заменить тело `operating`:

```ts
  const operating = round(cash.reduce((sum, row) => {
    if (row.direction === 'transfer') return sum;
    if (row.source === 'expense') return sum + (row.direction === 'out' ? row.amount : -row.amount);
    if (row.source !== 'manual' || OPERATING_EXCLUDED.includes(row.category)) return sum;
    return sum + (row.direction === 'out' ? row.amount : -row.amount);
  }, 0));
```

- [ ] **Step 6: Проверка**

Run: `npx vitest run src/i18n.test.ts src/reports.test.ts` → PASS.
Run: `npm run build` → exit 0.

---

### Task 5: Панель «Oylik xarajatlar» и модалки

**Files:**
- Modify: `src/sections.ts:18` (панель `xarajatlar`)
- Create: `src/components/ExpensePanel.tsx`
- Modify: `src/App.tsx` (import, метрика L536, панель в блоке `cash` L535-540, журнал L537, Kreditor qarzdorlik L539, модалки L583-588, `modalTitle` L602)
- Test: `src/sections.test.ts`, `src/mobileCards.test.ts`

**Interfaces:**
- Consumes: `expenseLedger`, `expensesDebt` из `./expenses`; `money`, `num`, `date`, `cashCategoryLabel`; `show`/`run`/`busy`/`state` из App.
- Produces: `ExpensePanel({ state, busy, run, show })` — метрики `Oylik reja` (Σ plannedTotal), `To‘langan` (Σ paidTotal), `Qarzdorlik` (Σ owed, accent), `Oldindan to‘langan` (Σ prepaid); карточки планов с чипами месяцев (`month-bar`/`month-chip`, классы из SalaryPanel) и кнопками «To‘lash» / «Tahrirlash»; журнал проводок выбранного плана таблицей `table-scroll cardable` с `data-label`.

- [ ] **Step 1: RED — маршрут панели**

В `src/sections.test.ts` — если есть describe про панели `cash`, добавить проверку (иначе добавить новый `it`):

```ts
  it('adds the monthly expense panel to the cash section', () => {
    const panels = panelsFor('cash', true);
    expect(panels.map(p => p.id)).toContain('xarajatlar');
    expect(defaultPanel('cash', true)).toBe('kassa');
  });
```

- [ ] **Step 2: RED — мобильный контракт журнала**

В `src/mobileCards.test.ts` найти массив `tableFiles` и добавить в него `'src/components/ExpensePanel.tsx'`.

Run: `npx vitest run src/sections.test.ts src/mobileCards.test.ts`
Expected: FAIL — в sections нет панели; в mobileCards файл не существует (тест падает на чтении файла).

- [ ] **Step 3: GREEN — панель**

`src/sections.ts:18`:

```ts
  { id: 'cash', title: 'Moliya va kassa', panels: [{ id: 'kassa', title: 'Kassa' }, { id: 'hisobotlar', title: 'Hisobotlar' }, { id: 'xarajatlar', title: 'Oylik xarajatlar' }] },
```

`src/components/ExpensePanel.tsx` — целиком (по образцу `SalaryPanel.tsx`):

```tsx
import { CircleAlert, Pencil, Plus, Wallet } from 'lucide-react';
import { expenseLedger } from '../expenses';
import { date, money, num } from '../i18n';
import type { State } from '../types';
import type { Command } from '../types';

interface Props {
  state: State;
  busy: boolean;
  run: (command: Command) => Promise<boolean>;
  show: (type: string, id?: string) => void;
}

const monthLabel = (month: string): string => new Date(`${month}-15T12:00:00`).toLocaleDateString('uz-UZ', { month: 'long' });

export function ExpensePanel({ state, busy, run, show }: Props) {
  const ids = [...new Set(state.expensePlans.map(row => row.planId))];
  const ledgers = ids.map(id => expenseLedger(state, id));
  const plannedTotal = ledgers.reduce((sum, row) => sum + row.plannedTotal, 0);
  const paidTotal = ledgers.reduce((sum, row) => sum + row.paidTotal, 0);
  const owedTotal = ledgers.reduce((sum, row) => sum + row.owed, 0);
  const prepaidTotal = ledgers.reduce((sum, row) => sum + row.prepaid, 0);
  return <div className="expense-panel">
    <div className="metrics three">
      <div className="metric"><div className="attention-icon green"><Wallet size={20} /></div><div><small>Oylik reja</small><b>{money(plannedTotal)}</b></div></div>
      <div className="metric"><div><small>To‘langan</small><b>{money(paidTotal)}</b></div></div>
      <div className="metric accent"><div className="attention-icon"><CircleAlert size={20} /></div><div><small>Qarzdorlik</small><b>{money(owedTotal)}</b></div></div>
      <div className="metric"><div><small>Oldindan to‘langan</small><b>{money(prepaidTotal)}</b></div></div>
    </div>
    <button className="primary" disabled={busy} onClick={() => show('expensePlan')}><Plus size={16} />Yangi oylik xarajat</button>
    <div className="mini-cards">
      {ledgers.map(ledger => {
        const plan = state.expensePlans.find(row => row.planId === ledger.planId);
        const supplier = plan?.supplierId ? state.suppliers.find(row => row.id === plan.supplierId) : undefined;
        return <article key={ledger.planId}>
          <div><b>{ledger.title}</b><small>{supplier ? `Yetkazib beruvchi: ${supplier.name} · ` : ''}har oy {plan?.dueDay ?? 15}-kungacha</small></div>
          <div className="month-bar">
            {ledger.months.map(month => <button key={month.month} className={`month-chip ${month.unpaid <= 0 ? 'paid' : month.paid > 0 ? 'partial' : ''}`} onClick={() => show('expenseMonth', `${ledger.planId}:${month.month}`)}>
              <small>{monthLabel(month.month)}</small><b>{money(month.obliged)}</b><span>{month.unpaid <= 0 ? 'to‘langan' : month.paid > 0 ? 'qisman' : 'to‘lanmagan'}</span>
            </button>)}
          </div>
          <div className="expense-foot"><span>{money(ledger.owed)} qarzdorlik</span><div className="button-group"><button className="secondary small" onClick={() => show('expensePlan', ledger.planId)}><Pencil size={14} />Tahrirlash</button><button className="primary small" disabled={busy || ledger.owed <= 0} onClick={() => show('expensePay', ledger.planId)}>To‘lash</button></div></div>
        </article>;
      })}
    </div>
    {!ledgers.length && <p className="kanban-empty">Oylik xarajatlar hali belgilanmagan</p>}
  </div>;
}
```

Заметки по разметке: `month-chip` высотой не меньше 44px — в `src/styles.css` уже есть `.month-bar`/`.month-chip` из SalaryPanel; если классы в SalaryPanel названы иначе, использовать его точные имена классов. Журнал проводки в модалке `expenseMonth` (App.tsx) — таблица:

```tsx
{modal.type === 'expenseMonth' && (() => {
  const [planId, month] = modal.id!.split(':');
  const ledger = expenseLedger(state, planId);
  const rows = state.cash.filter(c => c.source === 'expense' && c.sourceId === planId);
  return <Dialog title={`${ledger.title} · ${month}`} subtitle="Shu oyga taalluqli to‘lovlar va oylik majburiyat" close={() => setModal(null)}>
    <div className="form-body"><div className="table-scroll cardable"><table><thead><tr><th>Sana</th><th>Asos</th><th className="right">Summa</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td data-label="Sana">{date(c.createdAt)}{c.reversalOf ? ' · storno' : ''}</td><td data-label="Asos">{c.note}</td><td data-label="Summa" className="right">{c.direction === 'out' ? '−' : '+'}{money(c.amount)}</td></tr>)}</tbody></table></div>{!rows.length && <p className="subtle-note">Bu oy uchun to‘lov yozuvi yo‘q</p>}</div>
  </Dialog>;
})()}
```

- [ ] **Step 4: GREEN — интеграция в App**

`src/App.tsx`:

1. Импорт: `import { expensesDebt, expenseLedger } from './expenses';` и `import { ExpensePanel } from './components/ExpensePanel';`.
2. Рядом с `supplierTotal` (L421-422): `const expensesTotal = expensesDebt(state);`.
3. Метрика Majburiyatlar (L536): `value={money(supplierTotal + payrollTotal + expensesTotal)}` и `detail="Yetkazib beruvchilar, ish haqi va oylik xarajatlar"`.
4. В блоке `current === 'cash'` после строки с `panel === 'hisobotlar'` (L535) добавить перед `<>` кассы:
   ```tsx
   {panel === 'xarajatlar' && <ExpensePanel state={state} busy={busy} run={run} show={show} />}
   ```
   Точная вставка: `{panel === 'hisobotlar' ? <FinanceStatements …/> : panel === 'xarajatlar' ? <ExpensePanel …/> : <>…</>}` — аккуратно с вложенными тернарниками.
5. Журнал кассы (L537): в карту `source` добавить `expense: 'Oylik xarajat to‘lovi'`.
6. Kreditor qarzdorlik (L539): после списка работников добавить:
   ```tsx
   {[...new Set(state.expensePlans.map(p => p.planId))].map(planId => { const ledger = expenseLedger(state, planId); return ledger.owed > 0 ? <button key={planId} onClick={() => show('expensePay', planId)}><div><b>{ledger.title}</b><small>Oylik xarajat</small></div><strong>{money(ledger.owed)}</strong></button> : null; })}
   ```
7. Модалки: в whitelist L583 добавить `'expensePlan', 'expensePay', 'expenseMonth'`; в `modalTitle` L602 добавить `expensePlan: 'Oylik xarajat', expensePay: 'Xarajat to‘lash', expenseMonth: 'Oy bo‘yicha to‘lovlar'`.

8. Формы (после `SalaryPayForm`, L680):

```tsx
function ExpensePlanForm({ state, planId, busy, close, save }: { state: State; planId: string | null; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const versions = state.expensePlans.filter(row => row.planId === planId).slice().sort((a, b) => b.fromMonth.localeCompare(a.fromMonth));
  const latest = versions[0];
  const [fromMonth, setFromMonth] = useState(new Date().toISOString().slice(0, 7));
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'expense.plan.set', planId, title: text(form, 'title'), amount: number(form, 'amount'), fromMonth, dueDay: number(form, 'dueDay'), supplierId: text(form, 'supplierId') || null }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{planId ? 'Versiyani qo‘shish / tahrirlash' : 'Yangi xarajat'}</small><strong>Oylik xarajat</strong></div>
      <Field label="Xarajat nomi"><input name="title" required maxLength={200} defaultValue={latest?.title} autoFocus /></Field>
      <Field label="Oy boshlanadi (YYYY-MM)"><input name="fromMonth" value={fromMonth} onChange={event => setFromMonth(event.target.value)} pattern="\d{4}-\d{2}" inputMode="numeric" required maxLength={7} /></Field>
      <div className="form-grid">
        <Field label="To‘lash kuni (1–31)"><input name="dueDay" type="number" min={1} max={31} step={1} defaultValue={latest?.dueDay ?? 15} required /></Field>
        <Field label="Summa, UZS"><input name="amount" type="number" min="0" step="0.01" defaultValue={latest?.amount ?? 0} required /></Field>
      </div>
      <Field label="Yetkazib beruvchi (ixtiyoriy)"><select name="supplierId" defaultValue={latest?.supplierId ?? ''}><option value="">Yo‘q</option>{state.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <p className="subtle-note">Bu oydan boshlab har oyga shu summa yoziladi. Shu oy uchun yana qiymat kiritilsa, eskisi almashtiriladi.</p>
      {!!versions.length && <div className="series-facts">{versions.map(row => <span key={row.id}>{row.fromMonth}<b>{money(row.amount)}</b><small>{date(row.createdAt)}</small></span>)}</div>}
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

function ExpensePayForm({ planId, owed, busy, close, save }: { planId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const [allowPrepay, setAllowPrepay] = useState(false);
  const payable = Math.max(0, owed);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'expense.pay', planId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note'), allowPrepay }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qoldiq</small><strong>{money(payable)}</strong></div>
      <Amount name="amount" defaultValue={payable || undefined} max={allowPrepay || payable <= 0 ? undefined : payable} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Oldindan to‘lovga ruxsat</label>
      <p className="subtle-note">Ruxsat berilsa, ortiqcha summa keyingi oyga yoziladi. Naqd yoki bankdagi puldan oshib bo‘lmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}
```

Рендер модалок (после `salaryPay`, L588):

```tsx
      {modal.type === 'expensePlan' && <Dialog title="Oylik xarajat" subtitle="Har oy takrorlanadigan xarajat va uning to‘lash kuni" close={() => setModal(null)}><ExpensePlanForm state={state} planId={modal.id ?? null} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /></Dialog>}
      {modal.type === 'expensePay' && <Dialog title="Xarajat to‘lash" subtitle="To‘lov avval eng eski oyni yopadi, ortig‘i avans" close={() => setModal(null)}><ExpensePayForm planId={modal.id!} owed={expenseLedger(state, modal.id!).owed} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /></Dialog>}
```

Кнопка «Tahrirlash» в ExpensePanel вызывает `show('expensePlan', ledger.planId)` — modal.id передаётся в `planId`. Так как `expensePlan` вне whitelist с `Dialog`-обёрткой из whitelist-списка, форма рендерится в собственном `Dialog` (см. выше) — не забыть добавить `'expensePlan'` в whitelist L583, чтобы не сработал generic-`Dialog` L583.

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/sections.test.ts src/mobileCards.test.ts` → PASS.
Run: `npm run build` → exit 0.
Браузер: `npm run dev`, демо-режим, «Moliya va kassa» → «Oylik xarajatlar»: создать план, полоса месяцев, «To‘lash» (без флага отклоняет больше `owed`, с флагом — аванс), журнал кассы показывает «Oylik xarajat to‘lovi», Majburiyatlar вырос на сумму долга, Kreditor qarzdorlik содержит строку расхода. Проверить ширину 390px.

---

### Task 6: Сервер — таблица, снимок, кейсы, `erp_expense_ledger()`

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: структура `erp_cash`, конвенции `erp_*` таблиц (Задача A-T7 задала образец `erp_salary_plans`).
- Produces: таблица `erp_expense_plans`, индекс, RLS-включение в DO-блоке, секция `expensePlans` в `erp_snapshot()`, кейсы `expense.plan.set` / `expense.pay` в `erp_execute()`, ветка `expense` в `cash.reverse`, функция `erp_expense_ledger(uuid, uuid, date)`, GRANT/REVOKE.

- [ ] **Step 1: Таблица**

После `CREATE TABLE public.erp_salary_plans …` (L308-318) добавить:

```sql
CREATE TABLE public.erp_expense_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  from_month text NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  due_day integer NOT NULL DEFAULT 15 CHECK (due_day BETWEEN 1 AND 31),
  supplier_id uuid,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, plan_id, from_month),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id)
);
```

После `CREATE INDEX erp_salary_plans_employee_idx …` (L392):

```sql
CREATE INDEX erp_expense_plans_plan_idx ON public.erp_expense_plans(company_id, plan_id, from_month);
```

- [ ] **Step 2: RLS**

В DO-блок (L531-537) добавить `'erp_expense_plans'` в массив (после `'erp_salary_plans'`).

- [ ] **Step 3: Снимок**

В `erp_snapshot()` после секции `'salaryPlans', …` (L1249-1251) добавить:

```sql
      'expensePlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'planId', p.plan_id, 'title', p.title,
        'amount', p.amount, 'fromMonth', p.from_month, 'dueDay', p.due_day, 'supplierId', p.supplier_id,
        'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_expense_plans p WHERE p.company_id = v_company AND v_admin),
```

- [ ] **Step 4: Функция лида**

После `erp_salary_ledger` (L1062-1147) добавить:

```sql
CREATE FUNCTION public.erp_expense_ledger(p_company uuid, p_plan uuid, p_as_of date DEFAULT (CURRENT_DATE))
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_title text;
  v_start text;
  v_payments numeric := 0;
  v_month date;
  v_rate numeric;
  v_obliged numeric;
  v_paid numeric;
  v_available numeric := 0;
  v_sum_obliged numeric := 0;
  v_sum_unpaid numeric := 0;
  v_months jsonb := '[]'::jsonb;
BEGIN
  SELECT coalesce(min(from_month), '') INTO v_start
    FROM public.erp_expense_plans WHERE company_id = p_company AND plan_id = p_plan;
  SELECT round(coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END), 0), 2) INTO v_payments
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'expense' AND source_id = p_plan AND direction IN ('in', 'out');
  IF v_start = '' THEN
    RETURN jsonb_build_object('planId', p_plan::text, 'title', '', 'months', '[]'::jsonb,
      'prepaid', greatest(v_payments, 0), 'owed', 0, 'paidTotal', v_payments, 'plannedTotal', 0);
  END IF;
  SELECT title INTO v_title FROM public.erp_expense_plans
   WHERE company_id = p_company AND plan_id = p_plan ORDER BY from_month, created_at LIMIT 1;
  v_available := v_payments;
  FOR v_month IN
    SELECT generate_series((v_start || '-01')::date, date_trunc('month', p_as_of)::date, '1 month')::date
  LOOP
    SELECT amount INTO v_rate FROM public.erp_expense_plans
     WHERE company_id = p_company AND plan_id = p_plan AND from_month <= to_char(v_month, 'YYYY-MM')
     ORDER BY from_month DESC, created_at DESC, id DESC LIMIT 1;
    v_rate := coalesce(v_rate, 0);
    v_obliged := round(v_rate, 2);
    v_paid := least(v_obliged, greatest(v_available, 0));
    v_available := round(v_available - v_paid, 2);
    v_sum_obliged := round(v_sum_obliged + v_obliged, 2);
    v_sum_unpaid := round(v_sum_unpaid + (v_obliged - v_paid), 2);
    v_months := v_months || jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'obliged', v_obliged,
      'paid', v_paid, 'unpaid', round(v_obliged - v_paid, 2));
  END LOOP;
  RETURN jsonb_build_object('planId', p_plan::text, 'title', v_title, 'months', v_months,
    'prepaid', v_available, 'owed', v_sum_unpaid,
    'paidTotal', v_payments, 'plannedTotal', v_sum_obliged);
END;
$$;
```

- [ ] **Step 5: Кейсы `erp_execute`**

После кейса `salary.pay` (L2173-2189) добавить:

```sql
    WHEN 'expense.plan.set' THEN
      IF p_command -> 'planId' IS NOT NULL AND p_command -> 'planId' <> 'null'::jsonb THEN
        v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      ELSE
        v_entity := gen_random_uuid();
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'title', 'title', true));
      IF v_title = '' OR length(v_title) > 200 THEN RAISE EXCEPTION 'Expense title required' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF (p_command ->> 'fromMonth') IS NULL OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid expense plan month' USING ERRCODE = '22023';
      END IF;
      IF (p_command ->> 'dueDay') IS NULL OR (p_command ->> 'dueDay') !~ '^[0-9]+$'
        OR (p_command ->> 'dueDay')::int NOT BETWEEN 1 AND 31 THEN
        RAISE EXCEPTION 'Invalid expense due day' USING ERRCODE = '22023';
      END IF;
      IF p_command -> 'supplierId' IS NOT NULL AND p_command -> 'supplierId' <> 'null'::jsonb THEN
        v_ref := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_ref) THEN
          RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_ref := NULL;
      END IF;
      INSERT INTO public.erp_expense_plans(company_id, plan_id, title, amount, from_month, due_day, supplier_id)
        VALUES (v_company, v_entity, v_title, v_amount, p_command ->> 'fromMonth', (p_command ->> 'dueDay')::int, v_ref)
      ON CONFLICT (company_id, plan_id, from_month) DO UPDATE
        SET title = EXCLUDED.title, amount = EXCLUDED.amount, due_day = EXCLUDED.due_day, supplier_id = EXCLUDED.supplier_id;
    WHEN 'expense.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_entity) THEN
        RAISE EXCEPTION 'Expense plan not found' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      v_owed := (public.erp_expense_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note)
        VALUES (v_company, 'out', v_amount, v_account, 'expense', v_entity, 'expense', v_note);
```

В `cash.reverse` (L2222-2226) — в условие проверки источника добавить ветку:

```sql
        OR v_cash.source = 'expense' AND NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_cash.source_id)
```

(Проверка отрицательного остатка после сторно не нужна: `erp_expense_ledger` возвращает `owed ≥ 0` всегда.)

- [ ] **Step 6: Права**

В REVOKE-список (L2387) добавить `public.erp_expense_ledger(uuid, uuid, date),`; в GRANT-список (L2398) добавить `public.erp_expense_ledger(uuid, uuid, date)`.

- [ ] **Step 7: Проверка**

Run: `node .validation-pglite-20261029/validate.mjs` — существующий зонд (оклады и остальное) должен остаться зелёным; новый зонд придёт в Задаче 8.

---

### Task 7: Облачная копия не теряет расходы

**Files:**
- Modify: `supabase/functions/_shared/backup.ts:120-125` (`STATE_COLLECTIONS`)
- Test: `src/copy.test.ts`

**Interfaces:**
- Consumes: `STATE_COLLECTIONS` из `backup.ts`.
- Produces: `expensePlans: 'erp_expense_plans'` в коллекциях копии; таблица попадает в дамп автоматически (`erp_backup_tables()` собирает `erp_*`).

- [ ] **Step 1: RED**

В `src/copy.test.ts` найти проверку `salaryPlans` (из под-проекта A) и рядом добавить:

```ts
  it('keeps expensePlans in the cloud backup collections', () => {
    const state = emptyState();
    state.expensePlans = [{ id: 'e1', planId: 'p1', title: 'Ijara', amount: 1200000, fromMonth: '2026-11', dueDay: 15, supplierId: null, createdAt: '2026-11-05T09:00:00.000Z' }];
    const copy = exportBackup(state);
    expect(copy.expensePlans).toHaveLength(1);
    expect(copy.expensePlans[0].title).toBe('Ijara');
  });
```

Имя функции экспорта сверить с существующими тестами файла (`exportBackup` или аналог — использовать то же имя, что в соседнем тесте `salaryPlans`).

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/copy.test.ts`
Expected: FAIL — `expensePlans` отсутствует в копии (`undefined`).

- [ ] **Step 3: GREEN**

`supabase/functions/_shared/backup.ts` — в `STATE_COLLECTIONS` после `salaryPlans: 'erp_salary_plans',`:

```ts
  expensePlans: 'erp_expense_plans',
```

- [ ] **Step 4: Проверка**

Run: `npx vitest run src/copy.test.ts` → PASS.
Run: `npm run build` → exit 0.

---

### Task 8: Миграция живой базы и PGlite-зонд паритета

**Files:**
- Create: `supabase/migrations/20261105_expense_plans.sql`
- Create: `.validation-pglite-20261029/validate-expense-migration.mjs`
- Modify: `.validation-pglite-20261029/validate.mjs` (список транспилируемых модулей)

**Interfaces:**
- Consumes: изменения `supabase/schema.sql` из Задачи 6, `expenseLedger` из `./expenses`.
- Produces: идемпотентная миграция (DDL + полные копии `erp_snapshot()`/`erp_execute()` с новыми кейсами + `erp_expense_ledger` + GRANT), зонд, который гоняет TS против SQL на одинаковых данных и круг копия→восстановление.

- [ ] **Step 1: Миграция**

`supabase/migrations/20261105_expense_plans.sql` — по образцу `supabase/migrations/20261105_salary_plans.sql` (прочитать его перед написанием):

1. Шапка-комментарий с датой и назначением.
2. `CREATE TABLE IF NOT EXISTS public.erp_expense_plans (…)` — дословно из Задачи 6 (CHECK-и, UNIQUE-и, FK).
3. `CREATE INDEX IF NOT EXISTS erp_expense_plans_plan_idx …`.
4. DO-блок с `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` + `GRANT SELECT` + `CREATE POLICY erp_admin_read` для `erp_expense_plans` (самодостаточный, не зависящий от основного DO-блока — живая база его уже прогнала).
5. Полную копию `CREATE OR REPLACE FUNCTION public.erp_snapshot()` из текущего `supabase/schema.sql` с добавленной секцией `expensePlans` (из Задачи 6, Step 3).
6. Полную копию `CREATE OR REPLACE FUNCTION public.erp_execute(uuid, bigint, jsonb)` из текущего `supabase/schema.sql` с добавленными кейсами `expense.plan.set` / `expense.pay` и веткой `expense` в `cash.reverse` (из Задачи 6, Step 5). DECLARE-блок не менять: `v_title`, `v_note`, `v_allow_prepay`, `v_owed`, `v_ref` уже объявлены.
7. `CREATE OR REPLACE FUNCTION public.erp_expense_ledger(uuid, uuid, date)` — дословно из Задачи 6, Step 4.
8. `REVOKE … FROM PUBLIC, anon, authenticated;` + `GRANT EXECUTE … public.erp_expense_ledger(uuid, uuid, date) TO authenticated;` для новой функции (как в конце `schema.sql` L2382-2398).

- [ ] **Step 2: Зонд**

`.validation-pglite-20261029/validate-expense-migration.mjs` — по образцу `validate-salary-migration.mjs` (прочитать его перед написанием):

- Инициализация PGlite, выполнение `supabase/schema.sql`, затем `supabase/migrations/20261105_expense_plans.sql` (миграция идемпотентна — выполнить её **дважды** подряд и убедиться, что второй прогон не падает).
- Мок ролей/RLS как в зарплатном зонде (обработка `erp_current_profile` через временные функции или режим `SECURITY DEFINER`-подмены, как сделано в существующем зонде).
- `erp_bootstrap_company`, затем через `erp_execute`: `supplier.create` (для проверки привязки), `expense.plan.set` (два плана: «Ijara» 1 200 000 с `2026-11`, «Oshxona» 500 000 с `2026-11`), `expense.pay` 1 500 000 по первому с `allowPrepay: true` (аванс 300 000), `expense.pay` 500 000 по второму без флага.
- Паритет: для каждого `planId` сравнить `erp_expense_ledger(...)::jsonb` с TS `expenseLedger(состояние-из-снимка, planId)` по полям `months`, `prepaid`, `owed`, `paidTotal`, `plannedTotal` (собрать TS-состояние из `erp_snapshot()` — поля снимка совпадают с типами TS). Прогнать 6 наборов данных (разные суммы/месяцы/сторно).
- `rejects()`: `expense.plan.set` с `dueDay: 0` / `fromMonth: '2026-13'` / пустым title / чужим supplierId (коды 22023/23514), `expense.pay` без флага свыше `owed` (`Payment exceeds payable`, 23514), свыше остатка кассы (`Insufficient account balance`, 23514).
- Круг: `erp_backup_dump` → новая база → `erp_backup_restore` → `erp_snapshot()` содержит `expensePlans` той же длины; `erp_expense_ledger` даёт те же цифры.
- В конце — `console.log` одного сводного статуса (как в зарплатном зонде).

- [ ] **Step 3: Транспиляция**

`.validation-pglite-20261029/validate.mjs` — в список модулей для транспиляции добавить `'expenses'` (сейчас `['migrations', 'recipes', 'sales', 'receivables', 'salary', 'domain']`):

```js
const modules = ['migrations', 'recipes', 'sales', 'receivables', 'salary', 'expenses', 'domain'];
```

- [ ] **Step 4: Запуск**

Run: `node .validation-pglite-20261029/validate.mjs` → PASS, чисто.
Run: `node .validation-pglite-20261029/validate-expense-migration.mjs` → PASS (паритет на 6 наборах, rejects, двойной прогон миграции, круг копии).

---

### Task 9: Демо-данные и финальная проверка

**Files:**
- Modify: `src/seed.ts`
- Проверка: полный набор

**Interfaces:**
- Consumes: `monthOffset` из `src/seed.ts:103`.
- Produces: демо-состояние с тремя планами расходов и кассовыми записями `source: 'expense'`.

- [ ] **Step 1: Демо**

В `src/seed.ts` (в `createDemo`, после блока окладов под-проекта A) добавить:

```ts
  const expenseA = crypto.randomUUID();
  const expenseB = crypto.randomUUID();
  state.expensePlans.push(
    { id: crypto.randomUUID(), planId: expenseA, title: 'Ijara', amount: 3000000, fromMonth: monthOffset(-1), dueDay: 10, supplierId: null, createdAt: now },
    { id: crypto.randomUUID(), planId: expenseA, title: 'Ijara', amount: 3500000, fromMonth: monthOffset(0), dueDay: 10, supplierId: null, createdAt: now },
    { id: crypto.randomUUID(), planId: expenseB, title: 'Kommunal xizmatlar', amount: 800000, fromMonth: monthOffset(0), dueDay: 20, supplierId: null, createdAt: now },
  );
  const pay = (planId: string, amount: number, daysAgo: number, note: string) => state.cash.push({
    id: crypto.randomUUID(), direction: 'out', amount, account: 'cash', toAccount: null,
    source: 'expense', sourceId: planId, customerId: null, category: 'expense', note, reversalOf: null,
    createdAt: dateOffset(-daysAgo).toISOString(),
  });
  pay(expenseA, 3000000, 20, 'O‘tgan oy ijarasi');
  pay(expenseB, 400000, 5, 'Qisman to‘lov');
```

Имена локальных переменных сверить с текущим `createDemo` (`now`, `dateOffset` — проверить, как зовут переменную текущего времени в файле; использовать её точное имя). Итог в демо: «Ijara» — прошлый месяц закрыт, текущий в долгу; «Kommunal xizmatlar» — частично оплачен.

- [ ] **Step 2: Финальная проверка**

Run: `npx vitest run` → весь набор (включая 37 существующих файлов) PASS, без предупреждений.
Run: `npm run build` → exit 0.
Run: `node .validation-pglite-20261029/validate.mjs` → PASS.
Run: `node .validation-pglite-20261029/validate-expense-migration.mjs` → PASS.
Браузер в демо-режиме (пустые `VITE_SUPABASE_*`): «Moliya va kassa» → «Oylik xarajatlar» — карточки «Ijara» и «Kommunal xizmatlar» с чипами месяцев, метрики сходятся с кассой (`owed = max(0, plannedTotal − paidTotal)`, `Σ unpaid = owed`); журнал кассы показывает обе проводки как «Oylik xarajat to‘lovi»; ширина 390px без обрезанных таблиц.
