# Oylik va qarzlar (Финансы PRO, под-проект A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Фиксированный оклад работника с авансами и помесячным балансом против кассы: видно, какой месяц закрыт, какой нет, сколько выдано вперёд и сколько компания должна.

**Architecture:** Чистый derived-движок `src/salary.ts` по событиям (`state.salaryPlans`, `state.payroll`, `state.cash`) строит помесячную сетку обязательств и FIFO-раскладку выплат — хранимых агрегатов нет ни в домене, ни в базе. `payrollDebt` становится тонким фасадом над ним, поэтому все шесть мест UI и отчёты обновляются сами. Postgres повторяет те же правила в `erp_salary_ledger()` и отклоняет платёж больше `owed` тем же текстом, что и TS.

**Tech Stack:** TypeScript strict, Vitest, React 19, Vite 6, Supabase/Postgres (PL/pgSQL), PGlite для зондов.

**Spec:** `docs/superpowers/specs/2026-11-05-salary-pro-design.md`

## Global Constraints

- Рабочая папка `C:\Users\abdul\Documents\Qoder\2026-10-29\dd682fe3` **не является Git-репозиторием**: шагов `git commit` в плане нет, каждый шаг заканчивается проверкой (`npx vitest run …`, `npm run build`, `node .validation-pglite-20261029/…`).
- Порядок всегда: сначала падающий тест (RED — увидеть текст ошибки), потом реализация (GREEN), потом проверка без предупреждений.
- `npm run deploy` (Cloudflare Worker `erp-tizim`) и применение миграции к живой базе Supabase **вне этого плана** — только по отдельному разрешению владельца. Задачи 7–9 готовят файлы и проверяют их изолированным PGlite-зондом.
- `State.version` остаётся `4`. `salaryPlans` — обязательное поле состояния (все состояния рождаются из `emptyState()`), `deactivatedAt` — необязательное (`?`), чтобы не трогать 21 литерал `Employee`.
- `src/salary.ts` импортирует только `type { State }` из `./types`. Импорта `./domain` быть не должно — `domain.ts` сам вызывает `salaryLedger`, получится цикл.
- Сдельные начисления после `startMonth` при наличии плана в долг не входят (правило 1 спецификации). Это не баг и «чинить» его не нужно.
- Текст интерфейса — узбекская латиница, валюта UZS. Словарь фиксирован: `Oylik`, `Hisoblangan`, `To‘langan`, `Qoldiq`, `Oldindan berilgan`, `O‘tgan qoldiq`, `Oylik belgilash`, `Avans berish`, `To‘liq to‘lov`, `Oldindan to‘lovga ruxsat`, `Ishdan chiqqan`, `to‘langan`, `qisman`, `to‘lanmagan`.
- В `src/i18n.ts` уже есть `messages.cashPayroll = 'Xodimga to‘lov'`; новые подписи категории adding делать константой в самом `i18n.ts`, а не через `messages`.
- `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` — единственные ключи в фронтенд-окружении. Никаких секретов в код, тесты и логи.
- Проверка UI — в демо-режиме (пустые `VITE_SUPABASE_*`), чтобы не писать в живые данные.

## File structure

| Файл | Ответственность |
| --- | --- |
| `src/types.ts` (modify) | `SalaryPlan`, `State.salaryPlans`, `Employee.deactivatedAt?`, два новых члена `Command` |
| `src/salary.ts` (create) | Чистый движок: помесячная сетка, FIFO, `SalaryLedger` |
| `src/salary.test.ts` (create) | Правила 1–6 и 8–10 спецификации, идентичность `Σ unpaid + (carryOver − carryOverPaid) = owed` |
| `src/domain.ts` (modify) | `emptyState()`, фасад `payrollDebt`, `payment()` с `options`, кейсы `salary.plan.set` / `salary.pay` / `employee.update` |
| `src/migrations.ts` (modify) | Дефолт `[]` для старой копии без поля |
| `src/sync.ts` (modify) | `verifiedSnapshot` требует `salaryPlans` от серверного снимка |
| `src/i18n.ts` (modify) | `cashCategoryLabel` — русский→узбекский перевод категории журнала, оба исторических написания |
| `src/sections.ts` (modify) | Панель `oylik` в «Xodimlar» (только admin) |
| `src/components/SalaryPanel.tsx` (create) | Метрики, карточки работников, полоса месяцев, проводка месяца |
| `src/App.tsx` (modify) | Рендер панели, модалки `salaryPlan` / `salaryPay`, журнал через `cashCategoryLabel` |
| `src/styles.css` (modify) | `.month-bar` — горизонтальная полоса чипов месяцев |
| `supabase/schema.sql` (modify) | `erp_salary_plans`, `deactivated_at`, RLS, секция снимка, кейсы `erp_execute`, `erp_salary_ledger()` |
| `supabase/migrations/20261105_salary_plans.sql` (create) | Идемпотентная миграция живой базы (готовится, применяется только с разрешения) |
| `supabase/functions/_shared/backup.ts` (modify) | `STATE_COLLECTIONS` += `salaryPlans` |
| `src/seed.ts` (modify) | Демо: планы, аванс, уволенный работник с остатком |
| `.validation-pglite-20261029/validate-salary-migration.mjs` (create) | Зонд миграции: TS против `erp_salary_ledger`, круг копия→восстановление |
| `.validation-pglite-20261029/validate.mjs` (modify) | Транспиляция `salary`, `salaryPlans` в `digest()` и в ожидании пустоты дисплея |
| Тесты, которые правятся, а не создаются | `src/migrations.test.ts`, `src/sync.test.ts`, `src/domain.test.ts`, `src/i18n.test.ts`, `src/sections.test.ts`, `src/mobileCards.test.ts`, `src/copy.test.ts` |

---

### Task 1: Типы и коллекция `salaryPlans` в обвязке

**Files:**
- Modify: `src/types.ts` (`Employee` L10, `State` L74-78, `Command` L96 и L121)
- Modify: `src/domain.ts:356-362` (`emptyState`)
- Modify: `src/migrations.ts:115-130`
- Modify: `src/sync.ts:25`
- Test: `src/migrations.test.ts`, `src/sync.test.ts`

**Interfaces:**
- Consumes: ничего нового.
- Produces: `SalaryPlan { id: string; employeeId: string; amount: number; fromMonth: string; createdAt: string }`, `State.salaryPlans: SalaryPlan[]`, `Employee.deactivatedAt?: string | null`, команды `{ type: 'salary.plan.set'; employeeId: string; amount: number; fromMonth: string }` и `{ type: 'salary.pay'; employeeId: string; amount: number; account: Account; kind: 'advance' | 'payroll'; note: string; allowPrepay: boolean }`. Кейсов `mutate()` здесь ещё нет — `default:` в `src/domain.ts:1243` бросает `Unknown command`, и это правильно до Задачи 4.

- [ ] **Step 1: RED — миграция старой копии**

Добавить в конец блока `describe('tenant state', …)` в `src/migrations.test.ts`:

```ts
  it('adds salaryPlans to a version 4 snapshot that predates salaries', () => {
    const { salaryPlans: _salaryPlans, ...withoutPlans } = JSON.parse(JSON.stringify(emptyState())) as State & { salaryPlans?: unknown };
    expect(withoutPlans.salaryPlans).toBeUndefined();
    const migrated = migrateState(withoutPlans);
    expect(migrated.salaryPlans).toEqual([]);
  });
```

`emptyState`, `migrateState`, `State` уже импортированы в этом файле (`src/migrations.test.ts:1-4`); если тип `& { salaryPlans?: unknown }` не даст собрать деструктуризацию, снять аннотацию и оставить `as State`.

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/migrations.test.ts`
Expected: FAIL — `expected undefined to deeply equal []`. Падает именно потому, что `migrateState` пока не знает про коллекцию, а не из-за опечатки.

- [ ] **Step 3: RED — серверный снимок без `salaryPlans`**

В `src/sync.test.ts` в `setup()` (рядом с `age:` и `worker:`, `src/sync.test.ts:45-52`) добавить хелпер:

```ts
    strip: (key: string) => { delete (server.state as unknown as Record<string, unknown>)[key]; },
```

Добавить в конец файла ещё один `describe`:

```ts
describe('salaryPlans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits salaryPlans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.salaryPlans).toEqual([]);
    f.strip('salaryPlans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without salaryPlans', async () => {
    const f = setup(); f.online(true); f.strip('salaryPlans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

Локальный кэш остаётся валидным (`emptyState()` даёт поле), отпадает только серверный снимок — иначе `submit` бросит из `cached()` и теста на очередь не получится.

- [ ] **Step 4: Запустить и увидеть падение**

Run: `npx vitest run src/sync.test.ts`
Expected: FAIL на обоих тестах — `salaryPlans` нет в списке `verifiedSnapshot`, поэтому сломанный серверный снимок принимается, а `pending` пустеет.

- [ ] **Step 5: GREEN — типы**

`src/types.ts`:

```ts
export interface Employee { id: string; name: string; active: boolean; deactivatedAt?: string | null }
```

После `PayrollEntry` (L61) добавить:

```ts
export interface SalaryPlan { id: string; employeeId: string; amount: number; fromMonth: string; createdAt: string }
```

В `State` (L74-78) после `payroll: PayrollEntry[];`:

```ts
  cash: CashEntry[]; reports: WorkReport[]; payroll: PayrollEntry[]; salaryPlans: SalaryPlan[]; shipments: Shipment[]; audit: AuditEntry[];
```

В `Command` — заменить L96 и добавить два члена сразу после `payroll.pay` (L121):

```ts
  | { type: 'employee.update'; employeeId: string; name: string; active: boolean; deactivatedAt?: string | null }
```

```ts
  | { type: 'salary.plan.set'; employeeId: string; amount: number; fromMonth: string }
  | { type: 'salary.pay'; employeeId: string; amount: number; account: Account; kind: 'advance' | 'payroll'; note: string; allowPrepay: boolean }
```

- [ ] **Step 6: GREEN — обвязка**

`src/domain.ts`, `emptyState()` — после `payroll: [],`:

```ts
    shipments: [], audit: [], salaryPlans: [],
```

`src/migrations.ts` — в возвращаемом объекте после `payroll,`:

```ts
    salaryPlans: Array.isArray(source.salaryPlans) ? source.salaryPlans : [],
```

Массив `collections` (`src/migrations.ts:7-10`) **не трогать**: живые снимки приходят без `salaryPlans` до миграции базы, и проверка `Array.isArray` там отклонила бы весь продакшн.

`src/sync.ts:25` — в конец массива `arrays`:

```ts
  const arrays: (keyof State)[] = ['customers', 'suppliers', 'employees', 'machines', 'operations', 'items', 'recipes', 'orders', 'purchases', 'movements', 'cash', 'reports', 'payroll', 'salaryPlans', 'shipments', 'audit'];
```

- [ ] **Step 7: Проверка**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts` → PASS, чисто, без предупреждений.
Run: `npm run build` → exit 0. Если `tsc` ругнется на литералы `State` без `salaryPlans`, искать не нужно — их нет, все состояния из `emptyState()`.

---

### Task 2: Движок `src/salary.ts`

**Files:**
- Create: `src/salary.ts`
- Test: `src/salary.test.ts`

**Interfaces:**
- Consumes: `State`, `SalaryPlan` из `./types` (Задача 1).
- Produces:
  ```ts
  export interface SalaryMonth { month: string; obliged: number; paid: number; unpaid: number }
  export interface SalaryLedger { employeeId: string; carryOver: number; carryOverPaid: number; months: SalaryMonth[]; prepaid: number; owed: number; paidTotal: number; plannedTotal: number }
  export function salaryLedger(state: State, employeeId: string, asOf?: string): SalaryLedger
  ```
  `asOf` — ISO-строка или `YYYY-MM`; горизонт = её месяц. Без аргумента — текущий месяц.

- [ ] **Step 1: RED — фикстуры и правила**

`src/salary.test.ts` — целиком:

```ts
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { salaryLedger } from './salary';
import type { CashEntry, PayrollEntry, SalaryPlan, State } from './types';

const YEAR = 2026;
const startMonth = `${YEAR}-11`;

function cash(direction: 'in' | 'out', amount: number, createdAt: string, id = crypto.randomUUID()): CashEntry {
  return { id, direction, amount, account: 'cash', toAccount: null, source: 'payroll', sourceId: 'e1',
    customerId: null, category: 'payroll', note: '', reversalOf: null, createdAt };
}

function entry(amount: number, createdAt: string, status: PayrollEntry['status'] = 'accepted'): PayrollEntry {
  return { id: crypto.randomUUID(), employeeId: 'e1', reportId: 'r', orderId: 'o', taskId: 't', amount, status, createdAt };
}

function plan(amount: number, fromMonth: string, createdAt = `${fromMonth}-01T00:00:00.000Z`): SalaryPlan {
  return { id: crypto.randomUUID(), employeeId: 'e1', amount, fromMonth, createdAt };
}

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  state.employees.push({ id: 'e1', name: 'Usta', active: true });
  for (const row of rows) Object.assign(state, row);
  return state;
}

describe('salary ledger without a plan', () => {
  it('reproduces the old piece-rate payable, negative balance included', () => {
    expect(salaryLedger(fixture({ payroll: [entry(1400000, `${YEAR}-10-05T09:00:00.000Z`)], cash: [cash('out', 200000, `${YEAR}-10-06T09:00:00.000Z`)] }), 'e1')
      .owed).toBe(1200000);
    expect(salaryLedger(fixture({ payroll: [entry(200000, `${YEAR}-10-05T09:00:00.000Z`)] }), 'e1').owed).toBe(200000);
    expect(salaryLedger(fixture({ payroll: [], cash: [cash('out', 500000, `${YEAR}-10-05T09:00:00.000Z`)] }), 'e1').owed).toBe(-500000);
    expect(salaryLedger(fixture({ payroll: [entry(300000, `${YEAR}-10-05T09:00:00.000Z`, 'pending')] }), 'e1').owed).toBe(0);
  });
});
```

Затем, в этом же файле, правила 2–6 и 8–10. Во всех этих тестах горизонт задаётся явно (`asOf = '2026-11-30T12:00:00.000Z'`), чтобы проверки не зависели от даты прогона:

Пункт 7 из списка спецификации («тот же платёж без флага → `Payment exceeds payable`») — это поведение команды, а не движка: `salaryLedger` никаких флагов не знает. Он проверяется в Задаче 4, шаг 2, и искать его здесь не нужно.

```ts
describe('salary ledger with a plan', () => {
  const asOf = `${YEAR}-11-30T12:00:00.000Z`;

  it('opens exactly one full month for a new plan', () => {
    const ledger = salaryLedger(fixture({ salaryPlans: [plan(1200000, startMonth)] }), 'e1', asOf);
    expect(ledger.carryOver).toBe(0);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1200000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('carries the pre-plan balance and closes it first', () => {
    const base = fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
    });
    expect(salaryLedger(base, 'e1', asOf).carryOver).toBe(340000);
    expect(salaryLedger(base, 'e1', asOf).owed).toBe(1540000);
    const paid = fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 800000, `${YEAR}-11-10T09:00:00.000Z`)],
    });
    const ledger = salaryLedger(paid, 'e1', asOf);
    expect(ledger.carryOverPaid).toBe(340000);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 460000, unpaid: 740000 }]);
    expect(ledger.owed).toBe(740000);
  });

  it('prorates only the month the worker left in', () => {
    const state = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    state.employees[0].deactivatedAt = `${YEAR}-11-15`;
    expect(salaryLedger(state, 'e1', asOf).months).toEqual([{ month: '2026-11', obliged: 600000, paid: 0, unpaid: 600000 }]);
  });

  it('keeps later months at zero after deactivation', () => {
    const state = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    state.employees[0].deactivatedAt = `${YEAR}-11-15`;
    state.payroll = [];
    expect(salaryLedger(state, 'e1', `${YEAR}-12-20T00:00:00.000Z`).months.map(m => m.obliged))
      .toEqual([600000, 0]);
  });

  it('charges the first plan month in full even when the ledger is read mid-month', () => {
    const ledger = salaryLedger(fixture({ salaryPlans: [plan(1200000, startMonth)] }), 'e1', `${YEAR}-11-20T00:00:00.000Z`);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
  });

  it('pushes the surplus into prepaid when the payment is allowed ahead', () => {
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 2000000, `${YEAR}-11-05T09:00:00.000Z`)],
    }), 'e1', asOf);
    expect(ledger.prepaid).toBe(800000);
    expect(ledger.owed).toBe(0);
    expect(ledger.paidTotal).toBe(2000000);
    expect(ledger.plannedTotal).toBe(1200000);
  });

  it('stacks plan versions by month, not by insertion order', () => {
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1500000, '2027-01'), plan(1200000, startMonth)],
    }), 'e1', '2027-01-31T00:00:00.000Z');
    expect(ledger.months.map(m => [m.month, m.obliged]))
      .toEqual([['2026-11', 1200000], ['2026-12', 1200000], ['2027-01', 1500000]]);
  });

  it('returns a reversed payment to the balance', () => {
    const paid = cash('out', 800000, `${YEAR}-11-05T09:00:00.000Z`, 'p1');
    const reversal = { ...cash('in', 800000, `${YEAR}-11-09T09:00:00.000Z`), reversalOf: 'p1' };
    const ledger = salaryLedger(fixture({
      salaryPlans: [plan(1200000, startMonth)],
      cash: [paid, reversal],
    }), 'e1', asOf);
    expect(ledger.paidTotal).toBe(0);
    expect(ledger.owed).toBe(1200000);
  });

  it('applies a payment made before the plan to carryOver, not to a plan month', () => {
    const ledger = salaryLedger(fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 200000, `${YEAR}-10-20T09:00:00.000Z`)],
    }), 'e1', asOf);
    expect(ledger.carryOver).toBe(140000);
    expect(ledger.months).toEqual([{ month: '2026-11', obliged: 1200000, paid: 0, unpaid: 1200000 }]);
    expect(ledger.owed).toBe(1340000);
  });

  it('keeps the FIFO split identical to the totals', () => {
    const ledger = salaryLedger(fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      cash: [cash('out', 900000, `${YEAR}-11-10T09:00:00.000Z`)],
    }), 'e1', asOf);
    const unpaid = ledger.months.reduce((sum, month) => sum + month.unpaid, 0);
    expect(unpaid + (ledger.carryOver - ledger.carryOverPaid)).toBe(ledger.owed);
    expect(ledger.owed).toBe(Math.max(0, ledger.plannedTotal - ledger.paidTotal));
    expect(ledger.prepaid).toBe(Math.max(0, ledger.paidTotal - ledger.plannedTotal));
  });
});
```

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/salary.test.ts`
Expected: FAIL — `Failed to resolve import "./salary"`. Это корректное падение «модуля нет», а не опечатка в тесте.

- [ ] **Step 3: GREEN — движок**

`src/salary.ts` — целиком:

```ts
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface SalaryMonth { month: string; obliged: number; paid: number; unpaid: number }

export interface SalaryLedger {
  employeeId: string;
  carryOver: number;
  carryOverPaid: number;
  months: SalaryMonth[];
  prepaid: number;
  owed: number;
  paidTotal: number;
  plannedTotal: number;
}

function netted(state: State, employeeId: string, before?: string): number {
  return round(state.cash.reduce((total, row) => {
    if (row.source !== 'payroll' || row.sourceId !== employeeId) return total;
    if (row.direction !== 'in' && row.direction !== 'out') return total;
    if (before && !(row.createdAt < before)) return total;
    return total + (row.direction === 'out' ? row.amount : -row.amount);
  }, 0));
}

export function salaryLedger(state: State, employeeId: string, asOf?: string): SalaryLedger {
  const versions = state.salaryPlans
    .filter(row => row.employeeId === employeeId)
    .sort((a, b) => a.fromMonth === b.fromMonth ? a.createdAt.localeCompare(b.createdAt) : a.fromMonth.localeCompare(b.fromMonth));
  const payments = netted(state, employeeId);

  if (!versions.length) {
    const total = round(state.payroll.reduce((sum, row) =>
      row.employeeId === employeeId && row.status === 'accepted' ? sum + row.amount : sum, 0));
    return { employeeId, carryOver: round(total - payments), carryOverPaid: 0, months: [], prepaid: 0,
      owed: round(total - payments), paidTotal: payments, plannedTotal: total };
  }

  const startMonth = versions[0].fromMonth;
  const boundary = `${startMonth}-01T00:00:00.000Z`;
  const accruedBefore = round(state.payroll.reduce((sum, row) => row.employeeId === employeeId
    && row.status === 'accepted' && row.createdAt < boundary ? sum + row.amount : sum, 0));
  const paidBefore = netted(state, employeeId, boundary);
  const carryOver = Math.max(0, round(accruedBefore - paidBefore));
  const pool = round(Math.max(0, paidBefore - accruedBefore) + (payments - paidBefore));

  const employee = state.employees.find(row => row.id === employeeId);
  const horizon = (asOf ?? new Date().toISOString()).slice(0, 7);
  const months: SalaryMonth[] = [];
  for (let month = startMonth; month <= horizon; month = nextMonth(month)) {
    const plan = versions.filter(row => row.fromMonth <= month).at(-1)!;
    const stopped = employee?.deactivatedAt ? employee.deactivatedAt.slice(0, 7) <= month : false;
    const activeDays = stopped
      ? (employee!.deactivatedAt!.slice(0, 7) === month ? Number(employee!.deactivatedAt!.slice(8, 10)) : 0)
      : daysInMonth(month);
    months.push({
      month,
      obliged: round(activeDays > 0 ? plan.amount * activeDays / daysInMonth(month) : 0),
      paid: 0,
      unpaid: 0,
    });
  }

  let available = pool;
  const carryOverPaid = Math.min(available, carryOver);
  available = round(available - carryOverPaid);
  for (const month of months) {
    month.paid = Math.min(month.obliged, available);
    available = round(available - month.paid);
    month.unpaid = round(month.obliged - month.paid);
  }

  return {
    employeeId,
    carryOver,
    carryOverPaid,
    months,
    prepaid: available,
    owed: round((carryOver - carryOverPaid) + months.reduce((sum, month) => sum + month.unpaid, 0)),
    paidTotal: payments,
    plannedTotal: round(accruedBefore + months.reduce((sum, month) => sum + month.obliged, 0)),
  };
}
```

Соответствие правилам, которые нельзя «улучшить» по ходу:
- в ветке без плана **нет отсечки по нулю** — `owed` бывает отрицательным, как сегодня в `payrollDebt`;
- `plannedTotal = accruedBefore + Σ obliged` (не `carryOver + Σ obliged` — вторая форма вычла бы платёж до `startMonth` дважды);
- `obliged` режется только по `deactivatedAt`; дата приёма не хранится, поэтому первый месяц плана всегда полный.

- [ ] **Step 4: Проверка**

Run: `npx vitest run src/salary.test.ts` → PASS.
Run: `npm test` → PASS, ни один существующий тест не изменился.

---

### Task 3: `payrollDebt` — фасад движка

**Files:**
- Modify: `src/domain.ts` (`payrollDebt` L404-407, импорт)
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `salaryLedger` из `./salary` (Задача 2), `state.salaryPlans` (Задача 1).
- Produces: `payrollDebt(state: State, employeeId: string): number` — то же имя и сигнатура; при наличии плана возвращает `owed` движка.

- [ ] **Step 1: RED**

В `src/domain.test.ts` добавить импорт движка рядом с остальными (`import { payrollDebt } from './domain';` уже есть):

```ts
import { salaryLedger } from './salary';
```

Затем тест в тот же `describe`, где уже есть проверки `payrollDebt`:

```ts
  it('reports the salary plan balance through payrollDebt once a plan exists', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 5))
      .toISOString().slice(0, 7);
    const state = emptyState();
    state.employees.push({ id: 'e1', name: 'Usta', active: true });
    state.payroll.push({ id: 'p1', employeeId: 'e1', reportId: 'r', orderId: 'o', taskId: 't',
      amount: 340000, status: 'accepted', createdAt: `${prevMonth}-05T09:00:00.000Z` });
    expect(payrollDebt(state, 'e1')).toBe(340000);

    state.salaryPlans.push({ id: 's1', employeeId: 'e1', amount: 1200000,
      fromMonth: thisMonth, createdAt: `${thisMonth}-01T00:00:00.000Z` });
    expect(payrollDebt(state, 'e1')).toBe(1540000);

    // Начисление текущего месяца при плане в долг не входит — правило 1 спецификации.
    state.payroll.push({ id: 'p2', employeeId: 'e1', reportId: 'r2', orderId: 'o', taskId: 't2',
      amount: 500000, status: 'accepted', createdAt: new Date().toISOString() });
    expect(payrollDebt(state, 'e1')).toBe(1540000);
    expect(payrollDebt(state, 'e1')).toBe(salaryLedger(state, 'e1').owed);
  });
```

Год и месяц берутся из системной даты, поэтому тест держится при любом дне прогона: план начинается в текущем месяце, горизонт без `asOf` — тот же текущий месяц, значит `obliged` всегда 1 200 000, а `accruedBefore` — всегда 340 000 из прошлого месяца.

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/domain.test.ts -t "reports the salary plan balance"`
Expected: FAIL — `expected 340000 to be 1540000` (старая формула не знает про план; она остаётся на 340 000 и после второго начисления, тогда как движок даёт те же 1 540 000).

- [ ] **Step 3: GREEN**

`src/domain.ts` — заменить тело `payrollDebt` и добавить импорт к остальным (файл уже импортирует `./receivables`, `./sales`, `./recipes` — стиль тот же):

```ts
import { salaryLedger } from './salary';
```

```ts
export function payrollDebt(state: State, employeeId: string): number {
  return salaryLedger(state, employeeId).owed;
}
```

- [ ] **Step 4: Проверка регрессии**

Run: `npm test`
Expected: PASS. Все прежние проверки `payrollDebt` (~30 в `src/domain.test.ts`), `src/statements.test.ts`, `src/reports.test.ts`, `src/history.test.ts`, `src/health.test.ts` — без изменения цифр: ни в одном фикстуре `salaryPlans` нет, работает ветка «плана нет».
Run: `npm run build` → exit 0.

---

### Task 4: Команды домена

**Files:**
- Modify: `src/domain.ts` (`payment()` L551-567, кейс `employee.update` L645-651, новые кейсы после `payroll.pay` L1113-1115, инвариант сторно L1151)
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `salaryLedger(...).owed` через `payrollDebt` (Задача 3).
- Produces: обработчики `salary.plan.set` (id возврата — `employeeId`) и `salary.pay` (id возврата — `employeeId`), `CashEntry { source: 'payroll', category: 'payroll' | 'advance', note }`, `employee.update` с `deactivatedAt`.

- [ ] **Step 1: RED — план**

```ts
  it('stacks salary plan versions and repairs the same month in place', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const nextMonth = new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)), 1)).toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'r1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'r2', expectedRevision: 1, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(1);
    state = applyCommand(state, { requestId: 'r3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1300000, fromMonth: thisMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(1);
    expect(state.salaryPlans[0].amount).toBe(1300000);
    state = applyCommand(state, { requestId: 'r4', expectedRevision: 3, command: { type: 'salary.plan.set', employeeId, amount: 1500000, fromMonth: nextMonth } }, admin);
    expect(state.salaryPlans).toHaveLength(2);
    expect(() => applyCommand(state, { requestId: 'r5', expectedRevision: 4, command: { type: 'salary.plan.set', employeeId, amount: 1000000, fromMonth: thisMonth + '-01' } }, admin))
      .toThrow('Invalid salary plan month');
    expect(() => applyCommand(state, { requestId: 'r6', expectedRevision: 4, command: { type: 'salary.plan.set', employeeId, amount: -1, fromMonth: nextMonth } }, admin))
      .toThrow('Invalid amount');
    expect(() => applyCommand(state, { requestId: 'r7', expectedRevision: 4, command: { type: 'salary.plan.set', employeeId: 'nobody', amount: 1000, fromMonth: nextMonth } }, admin))
      .toThrow('Employee not found');
  });
```

`admin` — уже определённый в `src/domain.test.ts` актёр роли `admin`; взять то же имя, которое используют соседние тесты.

- [ ] **Step 2: RED — выплата, флаг и роль**

```ts
  it('pays the plan balance, honours the prepay flag and rejects a worker', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    const worker: Actor = { id: 'worker-actor', name: 'Usta', role: 'worker', companyId: DEMO_COMPANY_ID };
    let state = emptyState();
    state = applyCommand(state, { requestId: 'p0', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'p1', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 5000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'p2', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);

    state = applyCommand(state, { requestId: 'p3', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 400000, account: 'cash', kind: 'advance', note: 'Dastlabki avans', allowPrepay: false } }, admin);
    const advance = state.cash.at(-1)!;
    expect(advance).toMatchObject({ direction: 'out', source: 'payroll', sourceId: employeeId, category: 'advance', note: 'Dastlabki avans' });
    expect(payrollDebt(state, employeeId)).toBe(800000);

    const same = applyCommand(state, { requestId: 'p3', expectedRevision: 3, command: { type: 'salary.pay', employeeId, amount: 999999, account: 'cash', kind: 'advance', note: 'boshqa', allowPrepay: false } }, admin);
    expect(same).toEqual(state);

    expect(() => applyCommand(state, { requestId: 'p4', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 9000000, account: 'cash', kind: 'payroll', note: '', allowPrepay: false } }, admin))
      .toThrow('Payment exceeds payable');
    expect(() => applyCommand(state, { requestId: 'p5', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 4700000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Insufficient account balance');
    expect(() => applyCommand(state, { requestId: 'p6', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 0, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin))
      .toThrow('Amount must be positive');

    state = applyCommand(state, { requestId: 'p7', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: 1000000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, admin);
    expect(salaryLedger(state, employeeId).prepaid).toBe(200000);
    expect(payrollDebt(state, employeeId)).toBe(0);

    expect(() => applyCommand(state, { requestId: 'p8', expectedRevision: 5, command: { type: 'salary.pay', employeeId, amount: 1000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true } }, worker))
      .toThrow('Administrator action required');
  });
```

Актёр `admin` объявлен на уровне файла (`src/domain.test.ts:11`); `worker` в этом файле создаётся только внутри тестов про задания, поэтому новый тест объявляет своего локально — роль `worker` для `salary.pay` обязана отклоняться гейтом `src/domain.ts:1253`, а его текст ошибки англоязычный: `Administrator action required`. Узбекская строка `Faqat sizning ishlab chiqarish topshiriqlaringiz mavjud.` относится к `src/sync.ts:77` и к домену отношения не имеет.

- [ ] **Step 3: RED — уволенный работник и сторно**

```ts
  it('records the leaving date, keeps the ex-worker payable and restores it on reversal', () => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    let state = emptyState();
    state = applyCommand(state, { requestId: 'd1', expectedRevision: 0, command: { type: 'employee.create', name: 'Usta' } }, admin);
    state = applyCommand(state, { requestId: 'd2', expectedRevision: 1, command: { type: 'cash.post', direction: 'in', amount: 3000000, account: 'cash', toAccount: null, category: 'Boshlang‘ich qoldiq', note: '' } }, admin);
    const employeeId = state.employees[0].id;
    state = applyCommand(state, { requestId: 'd3', expectedRevision: 2, command: { type: 'salary.plan.set', employeeId, amount: 1200000, fromMonth: thisMonth } }, admin);
    state = applyCommand(state, { requestId: 'd4', expectedRevision: 3, command: { type: 'employee.update', employeeId, name: 'Usta', active: false, deactivatedAt: `${thisMonth}-15` } }, admin);
    expect(state.employees[0]).toMatchObject({ active: false, deactivatedAt: `${thisMonth}-15` });

    // Число дней в месяце и день прогона меняют сумму, поэтому проверка — на интервале, а не на константе.
    const payable = payrollDebt(state, employeeId);
    expect(payable).toBeGreaterThan(0);
    expect(payable).toBeLessThanOrEqual(1200000);

    state = applyCommand(state, { requestId: 'd5', expectedRevision: 4, command: { type: 'salary.pay', employeeId, amount: payable, account: 'cash', kind: 'payroll', note: 'Ishdan chiqqanda qoldiq', allowPrepay: false } }, admin);
    expect(payrollDebt(state, employeeId)).toBe(0);

    const paymentId = state.cash.at(-1)!.id;
    state = applyCommand(state, { requestId: 'd6', expectedRevision: 5, command: { type: 'cash.reverse', entryId: paymentId, note: 'Notog‘ri to‘lov' } }, admin);
    expect(payrollDebt(state, employeeId)).toBe(payable);

    state = applyCommand(state, { requestId: 'd7', expectedRevision: 6, command: { type: 'employee.update', employeeId, name: 'Usta', active: true } }, admin);
    expect(state.employees[0].deactivatedAt).toBeNull();
    expect(() => applyCommand(state, { requestId: 'd8', expectedRevision: 7, command: { type: 'employee.update', employeeId, name: 'Usta', active: false, deactivatedAt: '2026-13-45' } }, admin))
      .toThrow('Invalid deactivation date');
  });
```

- [ ] **Step 4: Запустить и увидеть падение**

Run: `npx vitest run src/domain.test.ts -t "salary"` и `-t "leaving date"`
Expected: FAIL — `Unknown command` (шаги 1–2) и `expected undefined to match object` по `deactivatedAt` (шаг 3).

- [ ] **Step 5: GREEN — `payment()` с опциями**

Заменить `payment()` (`src/domain.ts:551-567`) целиком:

```ts
function payment(state: State, source: 'supplier' | 'payroll', sourceId: string, amount: number, selectedAccount: Account,
  options?: { kind?: 'payroll' | 'advance'; note?: string; allowPrepay?: boolean }): void {
  const value = money(amount, true);
  account(selectedAccount);
  let payable: number;
  if (source === 'supplier') {
    find(state.suppliers, sourceId, 'Supplier');
    payable = supplierDebt(state, sourceId);
  } else {
    find(state.employees, sourceId, 'Employee');
    payable = payrollDebt(state, sourceId);
  }
  check(options?.allowPrepay || value <= payable, 'Payment exceeds payable');
  postCash(state, {
    direction: 'out', amount: value, account: selectedAccount, toAccount: null, source, sourceId, customerId: null,
    category: source === 'payroll' && options?.kind ? options.kind : source, note: options?.note ?? '', reversalOf: null,
  });
}
```

`supplier.pay` и `payroll.pay` вызывают её без `options`, значит их `category` (`'supplier'` / `'payroll'`) и текст `Payment exceeds payable` не меняются — ни один существующий тест не краснеет.

- [ ] **Step 6: GREEN — кейсы**

Заменить кейс `employee.update` (`src/domain.ts:645-651`):

```ts
    case 'employee.update': {
      const row = find(state.employees, command.employeeId, 'Employee');
      check(typeof command.active === 'boolean', 'Invalid active flag');
      row.name = named(state.employees.filter(employee => employee.id !== row.id), command.name);
      if (command.deactivatedAt !== undefined && command.deactivatedAt !== null) {
        check(/^\d{4}-\d{2}-\d{2}$/.test(command.deactivatedAt) && !Number.isNaN(Date.parse(`${command.deactivatedAt}T00:00:00Z`)), 'Invalid deactivation date');
      }
      row.deactivatedAt = command.active ? null : (command.deactivatedAt ?? row.deactivatedAt ?? now().slice(0, 10));
      row.active = command.active;
      return row.id;
    }
```

Добавить два кейса сразу после `case 'payroll.pay'` (`src/domain.ts:1113-1115`):

```ts
    case 'salary.plan.set': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      const amount = money(command.amount);
      check(/^\d{4}-\d{2}$/.test(command.fromMonth) && !Number.isNaN(Date.parse(`${command.fromMonth}-01T00:00:00Z`)), 'Invalid salary plan month');
      const existing = state.salaryPlans.find(row => row.employeeId === employee.id && row.fromMonth === command.fromMonth);
      if (existing) existing.amount = amount;
      else state.salaryPlans.push({ id: uuid(), employeeId: employee.id, amount, fromMonth: command.fromMonth, createdAt: now() });
      return employee.id;
    }
    case 'salary.pay': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      check(command.kind === 'payroll' || command.kind === 'advance', 'Invalid salary payment kind');
      const note = command.note.trim();
      payment(state, 'payroll', employee.id, command.amount, command.account,
        { kind: command.kind, note, allowPrepay: command.allowPrepay });
      return employee.id;
    }
```

- [ ] **Step 7: Сверка инварианта сторно**

```ts
        check(payrollDebt(state, original.sourceId!) >= 0, 'Negative payroll payable');
```

Код правки не требует: `src/domain.ts:1151` уже вызывает `payrollDebt`, а та с Задачи 3 делегирует движку. Шаг — проверка, что сторно выплаты по плану возвращает долг ровно в том же размере; это делает `requestId: 'd6'` из шага 3.

Run: `npx vitest run src/domain.test.ts -t "leaving date"` → PASS.

Новый пост-инвариант в цикл `applyCommand` (`src/domain.ts:1259-1272`) **не добавлять**: движок фильтрует и планы, и выплаты по `employeeId`, поэтому осиротевший план безвреден, а дублирующая проверка только замедлит каждую команду.
- [ ] **Step 8: Проверка**

Run: `npx vitest run src/domain.test.ts` → PASS.
Run: `npm test` → PASS.
Run: `npm run build` → exit 0.

---

### Task 5: Категория кассы по-узбекски

**Files:**
- Modify: `src/i18n.ts` (после `cashSourceLabel`, L126-128)
- Modify: `src/App.tsx:534` (журнал)
- Test: `src/i18n.test.ts`

**Interfaces:**
- Consumes: `CashEntry.category` как есть из домена (`'payroll' | 'advance' | 'supplier' | 'sale' | 'manual' | 'transfer'`) и из `erp_execute` (`'Payroll payment' | 'Supplier payment' | 'sale'`).
- Produces: `export function cashCategoryLabel(category: string): string`.

- [ ] **Step 1: RED**

Добавить в `src/i18n.test.ts`:

```ts
  it('translates salary categories and both historical spellings', () => {
    expect(cashCategoryLabel('payroll')).toBe('Ish haqi');
    expect(cashCategoryLabel('Payroll payment')).toBe('Ish haqi');
    expect(cashCategoryLabel('advance')).toBe('Avans');
    expect(cashCategoryLabel('sale')).toBe('Mijoz to‘lovi');
    expect(cashCategoryLabel('supplier')).toBe('Yetkazib beruvchi');
    expect(cashCategoryLabel('Supplier payment')).toBe('Yetkazib beruvchi');
    expect(cashCategoryLabel('manual')).toBe('Qo‘lda kiritilgan');
    expect(cashCategoryLabel('transfer')).toBe('O‘tkazma');
    expect(cashCategoryLabel('Kommunal xizmatlar')).toBe('Kommunal xizmatlar');
  });
```

В импорте файла добавить `cashCategoryLabel`.

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/i18n.test.ts`
Expected: FAIL — `cashCategoryLabel is not exported` / `is not a function`.

- [ ] **Step 3: GREEN**

`src/i18n.ts` — после `cashSourceLabel`:

```ts
const cashCategories: Record<string, string> = {
  payroll: 'Ish haqi',
  'Payroll payment': 'Ish haqi',
  advance: 'Avans',
  sale: 'Mijoz to‘lovi',
  supplier: 'Yetkazib beruvchi',
  'Supplier payment': 'Yetkazib beruvchi',
  manual: 'Qo‘lda kiritilgan',
  transfer: 'O‘tkazma',
};

/** Журнал печатает category как есть: админские категории остаются текстом владельца, служебные — переводятся. */
export function cashCategoryLabel(category: string): string {
  return cashCategories[category] ?? category;
}
```

`'Customer payment'` как ключ не добавлять — в репозитории такого литерала нет (`erp_execute` для оплат клиента пишет `sale`).

- [ ] **Step 4: GREEN — журнал**

`src/App.tsx:534`, в строке журнала заменить `<b>{c.category}</b>` на `<b>{cashCategoryLabel(c.category)}</b>` и `aria-label={`Storno ${c.category} ${c.amount}`}` на `aria-label={`Storno ${cashCategoryLabel(c.category)} ${c.amount}`}`. В блок импортов из `./i18n` добавить `cashCategoryLabel`.

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/i18n.test.ts src/mobileCards.test.ts` → PASS.
Run: `npm test` → PASS.

---

### Task 6: Панель «Oylik va qarzlar» и модалки

**Files:**
- Create: `src/components/SalaryPanel.tsx`
- Modify: `src/sections.ts:16`
- Modify: `src/App.tsx` (импорты, рендер панели, `people`-карточки L519, `Kreditor qarzdorlik` L536, whitelist L580, `modalTitle` L597, две новые формы)
- Modify: `src/styles.css` (`.month-bar`)
- Test: `src/sections.test.ts`, `src/mobileCards.test.ts`, `src/mobileStyle.test.ts` (все три уже есть — правятся только `tableFiles` и ничего больше)

**Interfaces:**
- Consumes: `salaryLedger`, `payrollDebt`, `cashCategoryLabel`, `Command` из Задач 2–5.
- Produces: `export default function SalaryPanel({ state, onPay, onPlan }: { state: State; onPay: (employeeId: string) => void; onPlan: (employeeId: string) => void })`; панели `panel === 'oylik'`; модалки `salaryPlan` и `salaryPay` (посылают `salary.plan.set` и `salary.pay`).

- [ ] **Step 1: RED — панель есть только у admin**

В `src/sections.test.ts` добавить:

```ts
  it('offers the salary balance panel to the director only', () => {
    expect(panelsFor('people', true).map(panel => panel.id)).toContain('oylik');
    expect(panelsFor('people', false).map(panel => panel.id)).toEqual(['mening-hisobim']);
  });
```

Run: `npx vitest run src/sections.test.ts` → Expected: FAIL — массив без `oylik`.

- [ ] **Step 2: GREEN — реестр**

`src/sections.ts:16`, в конец массива `panels` раздела `people`:

```ts
{ id: 'xodimlar', title: 'Xodimlar' }, { id: 'stavkalar', title: 'Stavkalar' }, { id: 'ish-haqi', title: 'Ish haqi' }, { id: 'oylik', title: 'Oylik va qarzlar' }
```

- [ ] **Step 3: RED — карточка обязана стать картой телефона**

`src/mobileCards.test.ts:5-21`, в `tableFiles` добавить строку `'components/SalaryPanel.tsx'` (по алфавиту — перед `'components/SalesAnalytics.tsx'`).

Run: `npx vitest run src/mobileCards.test.ts`
Expected: FAIL — в новом файле нет ни одного `table-scroll`, либо обёртка без `cardable`, либо `<td>` без `data-label`.

- [ ] **Step 4: GREEN — компонент**

`src/components/SalaryPanel.tsx` — целиком:

```tsx
import { useMemo, useState } from 'react';
import { Wallet, CircleAlert } from 'lucide-react';
import { salaryLedger } from '../salary';
import { cashCategoryLabel } from '../i18n';
import { Empty, Metric, Section, Title, date, money } from '../ui';
import type { State } from '../types';

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} · ${month.slice(0, 4)}`;
}

export default function SalaryPanel({ state, onPay, onPlan }: { state: State; onPay: (employeeId: string) => void; onPlan: (employeeId: string) => void }) {
  const rows = useMemo(() => state.employees.map(employee => ({ employee, ledger: salaryLedger(state, employee.id) })), [state]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    planned: sum.planned + row.ledger.plannedTotal,
    paid: sum.paid + row.ledger.paidTotal,
    owed: sum.owed + row.ledger.owed,
    prepaid: sum.prepaid + row.ledger.prepaid,
  }), { planned: 0, paid: 0, owed: 0, prepaid: 0 }), [rows]);
  const [open, setOpen] = useState<string | null>(null);

  return <>
    <Title eyebrow="HR / OYLIK VA QARZLAR" title="Har bir oy alohida ko‘rinadi." description="Oylik, avans va qoldiq — xodimning kassa bilan hisob-kitobi. Plan oyidan keyin hisoblangan ish summasi qarzga qo‘shilmaydi." />
    <div className="metrics">
      <Metric label="Oylik hisoblangan" value={money(totals.planned)} detail="Barcha oyliklar va qabul qilingan ish" icon={Wallet} />
      <Metric label="To‘langan" value={money(totals.paid)} detail="Naqd va bank, stornolar chegirilgan" icon={Wallet} />
      <Metric label="Qoldiq" value={money(totals.owed)} detail="Kompaniya xodimga qarzdor" icon={CircleAlert} accent />
      <Metric label="Oldindan berilgan" value={money(totals.prepaid)} detail="Ochiq majburiyatlardan ortiqcha to‘lov" icon={Wallet} />
    </div>
    <Section title="Xodimlar bo‘yicha oyliklar" hint="Chipni bosing — oyning qaysi to‘lov bilan yopilgani ko‘rinadi">
      {!rows.length && <Empty text="Avval «Xodimlar» bo‘limida xodim yarating" />}
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Xodim</th><th>Oylar</th><th className="right">Hisoblangan</th><th className="right">To‘langan</th><th className="right">Qoldiq</th><th /></tr></thead>
        <tbody>{rows.map(({ employee, ledger }) => <tr key={employee.id}>
          <td data-label="Xodim"><b>{employee.name}</b><small>{employee.active ? 'Faol' : 'Ishdan chiqqan'}{!employee.active && ledger.owed > 0 ? ` · qoldiq ${money(ledger.owed)}` : ''}</small></td>
          <td data-label="Oylar"><div className="month-bar">{ledger.months.map(month => <button
            type="button" key={month.month} className={open === `${employee.id}:${month.month}` ? 'selected' : ''}
            onClick={() => setOpen(open === `${employee.id}:${month.month}` ? null : `${employee.id}:${month.month}`)}>
            <small>{monthLabel(month.month)}</small><b>{money(month.obliged)}</b>
            <em>{month.unpaid <= 0 && month.obliged > 0 ? 'to‘langan' : month.paid > 0 ? 'qisman' : 'to‘lanmagan'}</em>
          </button>)}{!ledger.months.length && <small className="muted">Oylik belgilanmagan</small>}{ledger.carryOver > 0 && <button
            type="button" className={open === `${employee.id}:carry` ? 'selected' : ''} onClick={() => setOpen(open === `${employee.id}:carry` ? null : `${employee.id}:carry`)}>
            <small>O‘tgan qoldiq</small><b>{money(ledger.carryOver)}</b><em>{ledger.carryOverPaid > 0 ? 'qisman' : 'to‘lanmagan'}</em>
          </button>}</div></td>
          <td data-label="Hisoblangan" className="right">{money(ledger.plannedTotal)}</td>
          <td data-label="To‘langan" className="right">{money(ledger.paidTotal)}</td>
          <td data-label="Qoldiq" className="right"><strong>{money(ledger.owed)}</strong>{ledger.prepaid > 0 && <small>Oldindan berilgan {money(ledger.prepaid)}</small>}</td>
          <td data-label="Amallar"><div className="button-group">
            <button className="secondary small" onClick={() => onPlan(employee.id)}>Oylik belgilash</button>
            <button className="primary" disabled={ledger.owed <= 0} onClick={() => onPay(employee.id)}>To‘lash</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.map(({ employee, ledger }) => {
        const key = open?.split(':')[0];
        const part = open?.split(':')[1];
        if (key !== employee.id || !part) return null;
        const month = part === 'carry' ? null : ledger.months.find(row => row.month === part);
        const obliged = month ? month.obliged : ledger.carryOver;
        const paid = month ? month.paid : ledger.carryOverPaid;
        const payments = state.cash
          .filter(row => row.source === 'payroll' && row.sourceId === employee.id && row.direction === 'out')
          .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id))
          .filter(row => !month || (row.createdAt.slice(0, 7) === month.month))
          .slice().reverse();
        return <Section key={`detail-${employee.id}`} title={`${employee.name} — ${part === 'carry' ? 'O‘tgan qoldiq' : monthLabel(month!.month)}`}
          hint={`Hisoblangan ${money(obliged)} · To‘langan ${money(paid)} · Qoldiq ${money(Math.max(0, obliged - paid))}`}>
          <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana</th><th>Kategoriya</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
            <tbody>{payments.map(row => <tr key={row.id}>
              <td data-label="Sana">{date(row.createdAt)}</td>
              <td data-label="Kategoriya">{cashCategoryLabel(row.category)}</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{money(row.amount)}</td>
            </tr>)}{!payments.length && <tr><td data-label="Xabar" colSpan={4}>Bu oy uchun to‘lov yozuvi yo‘q</td></tr>}</tbody>
          </table></div>
        </Section>;
      })}
    </Section>
  </>;
}
```

- [ ] **Step 5: GREEN — CSS полосы месяцев**

`src/styles.css` — в основной блок (рядом с `.period-bar`):

```css
.month-bar{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding:2px 0 6px}
.month-bar button{flex:0 0 auto;min-width:104px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:8px 11px;border:1px solid var(--border);border-radius:9px;background:#f6f8f2;color:#33472f}
.month-bar button.selected{border-color:var(--green);background:#eaf3e0}
.month-bar button small{font-size:11px;color:#6c7b6a}
.month-bar button b{font-size:13px;font-weight:800}
.month-bar button em{font-style:normal;font-size:11px;font-weight:700;color:#7d8b6d}
.month-bar .muted{align-self:center;font-size:11px}
```

Требования `src/mobileStyle.ts`, которые нельзя нарушать:
- `mobileTapTargetIssues` проверяет `min-height` только у правил, которые его объявляют, и требует `min-height:44px` у голого селектора `button` (он уже есть в телефонном блоке). Поэтому `.month-bar button` в основном блоке остаётся **без `min-height`**;
- `.month-bar button small` и `.month-bar button em` — 11px: `readabilityIssues` разрешает 11px, `tinyTextSelectors` требует ≥10px;
- `.month-bar button b` — 13px, как карточные значения в `mobileCards.test.ts`.

В телефонный блок `@media(max-width:700px)` (там, где лежит `.period-bar button{flex:1;font-size:10px;padding:8px}`) добавить:

```css
.month-bar button{min-height:44px;padding:8px 10px}
.month-bar button small{font-size:11px}
```

`min-height:44px` проходит проверку `px < 44 === false`, а `font-size:11px` не даёт базовому `font-size:10px` из общих телефонных правил утащить подпись ниже читаемого порога.

- [ ] **Step 6: GREEN — wiring в `App.tsx`**

1. Импорт: `import SalaryPanel from './components/SalaryPanel';` рядом с остальными компонентами; `cashCategoryLabel` уже добавлен в Задаче 5.
2. Рендер панели — вставить новой строкой сразу после блока `panel === 'ish-haqi'` (`src/App.tsx:521`, перед закрывающим `</>}` раздела `people` на L522):

```tsx
      {admin && panel === 'oylik' && <SalaryPanel state={state} onPlan={id => show('salaryPlan', id)} onPay={id => show('salaryPay', id)} />}
```

3. Карточка работника (`src/App.tsx:519`) — подписи и кнопка:

```tsx
old: <div><small>Hisoblangan</small><b>{money(earnings)}</b></div>
new: <div><small>{state.salaryPlans.some(plan => plan.employeeId === emp.id) ? 'Oylik' : 'Hisoblangan'}</small><b>{money(earnings)}</b></div>
```

```tsx
old: onClick={() => show('payrollPay', emp.id)}>To‘lash
new: onClick={() => show('salaryPay', emp.id)}>To‘lash
```

4. «Kreditor qarzdorlik» (`src/App.tsx:536`) — та же замена:

```tsx
old: onClick={() => show('payrollPay', s.id)}><div><b>{s.name}</b><small>Xodim</small>
new: onClick={() => show('salaryPay', s.id)}><div><b>{s.name}</b><small>Xodim</small>
```

5. Whitelist модалок (`src/App.tsx:580`) — `'cashBulk'` → `'cashBulk', 'salaryPlan', 'salaryPay'`.
6. `modalTitle` (`src/App.tsx:597`) — после `payrollPay: 'Xodimga to‘lov',`:

```ts
salaryPlan: 'Oylik belgilash', salaryPay: 'Xodimga oylik yoki avans',
```

7. Формы — добавить внутрь общего `<Dialog>` сразу после блока `['orderPay', 'supplierPay', 'payrollPay']` (L583):

```tsx
      {modal.type === 'salaryPlan' && <SalaryPlanForm state={state} employeeId={modal.id!} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
      {modal.type === 'salaryPay' && <SalaryPayForm employeeId={modal.id!} owed={payrollDebt(state, modal.id!)} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
```

8. Компоненты форм — в конец `App.tsx`, по образцу `CashForm` (L605):

```tsx
function SalaryPlanForm({ state, employeeId, busy, close, save }: { state: State; employeeId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const employee = state.employees.find(row => row.id === employeeId);
  const versions = state.salaryPlans.filter(row => row.employeeId === employeeId).slice().sort((a, b) => b.fromMonth.localeCompare(a.fromMonth));
  const [fromMonth, setFromMonth] = useState(new Date().toISOString().slice(0, 7));
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.plan.set', employeeId, amount: number(form, 'amount'), fromMonth }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{employee?.name}</small><strong>Oylik belgilash</strong></div>
      <Field label="Oy boshlanadi (YYYY-MM)"><input name="fromMonth" value={fromMonth} onChange={event => setFromMonth(event.target.value)} pattern="\d{4}-\d{2}" inputMode="numeric" required maxLength={7} autoFocus /></Field>
      <Amount label="Oylik, UZS" name="amount" />
      <p className="subtle-note">Bu oydan boshlab har oyga shu summa yoziladi. Bir oyga ikkinchi qiymat kiritilsa, eskisi almashtiriladi.</p>
      {!!versions.length && <div className="series-facts">{versions.map(row => <span key={row.id}>{row.fromMonth}<b>{money(row.amount)}</b><small>{date(row.createdAt)}</small></span>)}</div>}
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

function SalaryPayForm({ employeeId, owed, busy, close, save }: { employeeId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const [kind, setKind] = useState<'payroll' | 'advance'>('advance');
  const [allowPrepay, setAllowPrepay] = useState(false);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.pay', employeeId, amount: number(form, 'amount'), account: account(form), kind, note: text(form, 'note'), allowPrepay }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qoldiq</small><strong>{money(owed)}</strong></div>
      <div className="segmented">
        {(['advance', 'payroll'] as const).map(option => <button key={option} type="button" className={kind === option ? 'selected' : ''} onClick={() => setKind(option)}>{option === 'advance' ? 'Avans berish' : 'To‘liq to‘lov'}</button>)}
      </div>
      <Amount name="amount" defaultValue={owed || undefined} max={allowPrepay ? undefined : owed} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={500} /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Oldindan to‘lovga ruxsat</label>
      <p className="subtle-note">Ruxsat berilsa, ortiqcha summa keyingi oyga yoziladi. Naqd yoki bankdagi puldan oshib bo‘lmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}
```


- [ ] **Step 7: Проверка**

Run: `npx vitest run src/sections.test.ts src/mobileCards.test.ts src/mobileStyle.test.ts` → PASS (все три, включая `mobileTapTargetIssues(css)` = `[]`).
Run: `npm test` → PASS.
Run: `npm run build` → exit 0.

---

### Task 7: Сервер — таблицы, снимок, команды и `erp_salary_ledger()`

**Files:**
- Modify: `supabase/schema.sql` (DDL `erp_employees` L31-37, новая таблица после `erp_payroll` L291-300, индексы L375-382, DO-блок RLS L518-524, `erp_snapshot()` L1066-1068 и после `'payroll'` L1142-1144, `erp_execute` кейсы после `payroll.pay` L2030-2040 и `employee.update` L1362-1371)

**Interfaces:**
- Consumes: `erp_cash`, `erp_payroll`, `erp_paid()`, `erp_balance()`, `erp_uuid()`, `erp_money()`, `erp_account()`, `erp_text()` — существующие помощники.
- Produces: `public.erp_salary_plans`, `public.erp_employees.deactivated_at`, `public.erp_salary_ledger(uuid, uuid, date) → jsonb` с ключами `employeeId, carryOver, carryOverPaid, months, prepaid, owed, paidTotal, plannedTotal`, снимок с `salaryPlans`, кейсы `salary.plan.set` / `salary.pay`, `employee.update` с `deactivatedAt`.

- [ ] **Step 1: DDL**

После таблицы `erp_payroll`:

```sql
CREATE TABLE public.erp_salary_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  from_month text NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, employee_id, from_month),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id)
);
```

В `erp_employees` после `active boolean NOT NULL DEFAULT true,`:

```sql
  deactivated_at date,
```

Соглашение о деньгах — `numeric` + `CHECK (… = round(amount, 2))`, как во всех остальных `erp_*` таблицах (в спецификации уточняюще написано `numeric(14,2)`; `numeric(14,2)` не вмещает верхнюю границу `1000000000000`, которую использует домен, поэтому берёмян существующая форма).

В блок индексов:

```sql
CREATE INDEX erp_salary_plans_employee_idx ON public.erp_salary_plans(company_id, employee_id, from_month);
```

- [ ] **Step 2: RLS**

В массив DO-блока (`supabase/schema.sql:518-524`) после `'erp_payroll',`:

```sql
    'erp_work_reports', 'erp_payroll', 'erp_salary_plans', 'erp_shipments', 'erp_shipment_lines', 'erp_audit'
```

Без этого политика не создаётся, и `erp_snapshot()` не увидит ни одной строки.

- [ ] **Step 3: `erp_salary_ledger()`**

Вставить перед `erp_snapshot()`. Это тот же алгоритм, что `src/salary.ts`, — правила 1–6 без изменений:

```sql
CREATE FUNCTION public.erp_salary_ledger(p_company uuid, p_employee uuid, p_as_of date DEFAULT (CURRENT_DATE))
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_start text;
  v_payments numeric := 0;
  v_accrued numeric := 0;
  v_accrued_before numeric := 0;
  v_paid_before numeric := 0;
  v_carry_over numeric := 0;
  v_carry_paid numeric := 0;
  v_available numeric := 0;
  v_deactivated date;
  v_month date;
  v_days numeric;
  v_active numeric;
  v_rate numeric;
  v_obliged numeric;
  v_paid numeric;
  v_sum_obliged numeric := 0;
  v_sum_unpaid numeric := 0;
  v_months jsonb := '[]'::jsonb;
BEGIN
  SELECT round(coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END), 0), 2) INTO v_payments
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'payroll' AND source_id = p_employee AND direction IN ('in', 'out');

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_accrued
    FROM public.erp_payroll WHERE company_id = p_company AND employee_id = p_employee AND status = 'accepted';

  SELECT min(from_month) INTO v_start
    FROM public.erp_salary_plans WHERE company_id = p_company AND employee_id = p_employee;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('employeeId', p_employee::text, 'carryOver', round(v_accrued - v_payments, 2),
      'carryOverPaid', 0, 'months', '[]'::jsonb, 'prepaid', 0,
      'owed', round(v_accrued - v_payments, 2), 'paidTotal', v_payments, 'plannedTotal', v_accrued);
  END IF;

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_accrued_before
    FROM public.erp_payroll
   WHERE company_id = p_company AND employee_id = p_employee AND status = 'accepted'
     AND created_at < (v_start || '-01')::timestamptz;

  SELECT round(coalesce(sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END), 0), 2) INTO v_paid_before
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'payroll' AND source_id = p_employee AND direction IN ('in', 'out')
     AND created_at < (v_start || '-01')::timestamptz;

  v_carry_over := greatest(0, round(v_accrued_before - v_paid_before, 2));
  v_available := round(greatest(0, v_paid_before - v_accrued_before) + (v_payments - v_paid_before), 2);

  SELECT deactivated_at INTO v_deactivated
    FROM public.erp_employees WHERE company_id = p_company AND id = p_employee;

  v_carry_paid := least(v_available, v_carry_over);
  v_available := round(v_available - v_carry_paid, 2);

  FOR v_month IN
    SELECT generate_series((v_start || '-01')::date, date_trunc('month', p_as_of)::date, '1 month')::date
  LOOP
    SELECT amount INTO v_rate FROM public.erp_salary_plans
     WHERE company_id = p_company AND employee_id = p_employee AND from_month <= to_char(v_month, 'YYYY-MM')
     ORDER BY from_month DESC, created_at DESC, id DESC LIMIT 1;
    v_rate := coalesce(v_rate, 0);
    v_days := extract(day FROM last_day(v_month));
    IF v_deactivated IS NOT NULL AND to_char(v_deactivated, 'YYYY-MM') <= to_char(v_month, 'YYYY-MM') THEN
      v_active := CASE WHEN to_char(v_deactivated, 'YYYY-MM') = to_char(v_month, 'YYYY-MM')
                       THEN (v_deactivated - date_trunc('month', v_month)::date) + 1 ELSE 0 END;
    ELSE
      v_active := v_days;
    END IF;
    v_obliged := round(CASE WHEN v_active > 0 THEN v_rate * v_active / v_days ELSE 0 END, 2);
    v_paid := least(v_obliged, v_available);
    v_available := round(v_available - v_paid, 2);
    v_sum_obliged := round(v_sum_obliged + v_obliged, 2);
    v_sum_unpaid := round(v_sum_unpaid + (v_obliged - v_paid), 2);
    v_months := v_months || jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'obliged', v_obliged,
      'paid', v_paid, 'unpaid', round(v_obliged - v_paid, 2));
  END LOOP;

  RETURN jsonb_build_object('employeeId', p_employee::text, 'carryOver', v_carry_over, 'carryOverPaid', v_carry_paid,
    'months', v_months, 'prepaid', v_available,
    'owed', round(v_carry_over - v_carry_paid + v_sum_unpaid, 2),
    'paidTotal', v_payments, 'plannedTotal', round(v_accrued_before + v_sum_obliged, 2));
END;
$$;
```

Совпадение с TS проверяется зондом в Задаче 9, а не на слово. Округление: `round(numeric, 2)` в Postgres и `round()` в `src/salary.ts` оба «от нуля», поэтому копии сходятся; разнице в один день при `deactivated_at` в `generate_series` места нет.

- [ ] **Step 4: Снимок**

`'employees'` (`supabase/schema.sql:1066-1068`) — добавить поле:

```sql
      'employees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'active', e.active, 'deactivatedAt', e.deactivated_at) ORDER BY e.id), '[]'::jsonb)
        FROM public.erp_employees e WHERE e.company_id = v_company AND (v_admin OR v_board OR e.id = v_profile.employee_id)),
```

Секция `salaryPlans` — сразу после секции `'payroll'` (`supabase/schema.sql:1142-1144`), с тем же пропуском для работника, что и `payroll`:

```sql
      'salaryPlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'amount', p.amount,
        'fromMonth', p.from_month, 'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_salary_plans p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),
```

- [ ] **Step 5: `erp_execute`**

В `DECLARE` добавить `v_kind text; v_note text; v_allow_prepay boolean; v_owed numeric; v_active boolean;` (рядом с `v_amount`, `v_account`, `v_employee`).

`employee.update` (`supabase/schema.sql:1362-1371`) — обновлять и дату:

```sql
      v_active := public.erp_bool(p_command -> 'active', 'active');
      IF p_command ? 'deactivatedAt' AND btrim(p_command ->> 'deactivatedAt') <> ''
         AND (p_command ->> 'deactivatedAt') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        RAISE EXCEPTION 'Invalid deactivation date' USING ERRCODE = '22023';
      END IF;
      UPDATE public.erp_employees SET name = btrim(public.erp_text(p_command -> 'name', 'name')), active = v_active,
        deactivated_at = CASE WHEN v_active THEN NULL
          ELSE coalesce(NULLIF(btrim(coalesce(p_command ->> 'deactivatedAt', '')), '')::date, deactivated_at,
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) END
        WHERE company_id = v_company AND id = v_entity;
```

`public.erp_bool(p_command -> 'active', 'active')` и `btrim(public.erp_text(p_command -> 'name', 'name'))` — ровно те выражения, что стоят в текущем кейсе (`supabase/schema.sql:1365-1371`); `name` там без флага `true`, поэтому пустое имя по-прежнему отклоняется. Расхождение с доменом одно и оно безвредно: TS отсекает невозможный день (`2026-02-31`) через `Date.parse` с текстом `Invalid deactivation date`, а Postgres на таком значении выдаёт собственный `22007 date/time field value out of range`. Интерфейс дату руками не собирает, поэтому зонд в Задаче 9 невозможные дни не проверяет.

После кейса `payroll.pay`:

```sql
    WHEN 'salary.plan.set' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary plan month' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_salary_plans(company_id, employee_id, amount, from_month)
        VALUES (v_company, v_entity, v_amount, p_command ->> 'fromMonth')
      ON CONFLICT (company_id, employee_id, from_month) DO UPDATE SET amount = EXCLUDED.amount;
    WHEN 'salary.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_kind := public.erp_text(p_command -> 'kind', 'kind');
      IF v_kind NOT IN ('payroll', 'advance') THEN RAISE EXCEPTION 'Invalid salary payment kind' USING ERRCODE = '22023'; END IF;
      v_note := public.erp_text(p_command -> 'note', 'note', true);
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_owed := (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, v_kind, btrim(v_note));
```

Два места, где этот кейс строго соответствует домену:
- потолок по остатку счёта: TS делает это в `postCash` (`src/domain.ts:545`), а существующий `cash.post` в SQL его не проверяет — новый кейс обязан проверять, иначе аванс «вперёд» создаст деньги из ниоткуда;
- `category` = `v_kind` (`'payroll'` / `'advance'`) — ровно как в TS. Старый `payroll.pay` сохраняет `'Payroll payment'`, и `cashCategoryLabel` (Задача 5) понимает оба написания.

`ON CONFLICT (company_id, employee_id, from_month)` опирается на уникальный ключ, добавленный в шаге 1, — без него кейс падает с `42P10 no unique constraint matching`.

- [ ] **Step 6: Проверка синтаксиса изолированным PGlite**

Run: `node .validation-pglite-20261029/validate.mjs`
Expected: существующий зонд проходит (он читает `supabase/schema.sql` целиком) — если `erp_salary_ledger` или кейс с ошибкой, зонд упадёт на загрузке схемы. Ожидаемое падение до Задачи 9 — `salaryPlans` нет в `digest()` и в списке пустоты board-снимка: это фиксируется там, а не здесь.

---

### Task 8: Облачная копия не теряет оклады

**Files:**
- Modify: `supabase/functions/_shared/backup.ts:120-126`
- Test: `src/copy.test.ts`

**Interfaces:**
- Consumes: `playbackCopy`, `STATE_COLLECTIONS`, `CompanyCopy` — существующие.
- Produces: `salaryPlans ↔ erp_salary_plans` в списке коллекций.

- [ ] **Step 1: RED**

В `src/copy.test.ts`, внутрь `describe('company copy sandbox playback')` (L107) — рядом с проверкой на `played()` (L123):

```ts
  it('keeps salary plans in the copy and in playback', () => {
    const copy = played();
    copy.tables.erp_salary_plans = [{ company_id: COMPANY, id: 's1', employee_id: 'e1', amount: 1200000, from_month: '2026-11' }];
    copy.manifest = copyManifest(copy.tables);
    expect(copy.manifest.rows).toMatchObject({ erp_salary_plans: 1 });

    (copy.state as Record<string, unknown>).salaryPlans = [{ id: 's1' }];
    const result = playbackCopy(copy);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ erp_salary_plans: 1 });
  });
```

`played()` (L108-121) собирает копию через `copyOf()` и `copyManifest(copy.tables)`, поэтому новых помощников не нужно. Форма проверок повторяет L126: `manifest.rows` и `counts` ключуются **именами таблиц** (`erp_salary_plans`), а не полями состояния.

- [ ] **Step 2: Запустить и увидеть падение**

Run: `npx vitest run src/copy.test.ts`
Expected: FAIL — `counts` без `salaryPlans` / таблица не в списке строк: `STATE_COLLECTIONS` её не знает.

- [ ] **Step 3: GREEN**

`supabase/functions/_shared/backup.ts`, в `STATE_COLLECTIONS` после `payroll: 'erp_payroll',`:

```ts
  payroll: 'erp_payroll', salaryPlans: 'erp_salary_plans', shipments: 'erp_shipments', audit: 'erp_audit',
```

`COPY_VERSION` **не поднимать**: `playbackCopy` пропускает коллекцию, когда она пуста с обеих сторон, поэтому старые копии остаются валидными.

- [ ] **Step 4: Проверка**

Run: `npx vitest run src/copy.test.ts src/backup.test.ts src/cloudBackup.test.ts src/copyPanel.test.ts` → PASS.
Run: `npm test` → PASS.

---

### Task 9: Миграция живой базы и PGlite-зонд паритета

**Files:**
- Create: `supabase/migrations/20261105_salary_plans.sql`
- Create: `.validation-pglite-20261029/validate-salary-migration.mjs`
- Modify: `.validation-pglite-20261029/validate.mjs` (L12, `digest()` CTE L78-96, список пустоты board-снимка L317)

**Interfaces:**
- Consumes: `src/salary.ts` через транспиляцию (как `receivables`), `erp_salary_ledger` из схемы, `erp_snapshot`/`erp_execute` из `supabase/schema.sql`.
- Produces: применяемый файл миграции и запускаемый зонд. Живая база в этом плане не трогается.

- [ ] **Step 1: Зонд существующего набора — падает по умолчанию**

`node .validation-pglite-20261029/validate.mjs` после Задачи 7 покажет, что `salaryPlans` нет ни в `digest()`, ни в ожиданиях снимка. Исправить:

L12 — транспилируемые модули:

```js
const modules = ['migrations', 'recipes', 'sales', 'receivables', 'salary', 'domain'];
```

`digest()` (CTE L78-96) — после `'payroll',…`:

```js
    'salaryPlans',(SELECT jsonb_agg(t ORDER BY id) FROM public.erp_salary_plans t),
```

Список «работник ничего не должен видеть» (L302) **не трогать**: работник получает свои `salaryPlans`, как свои `payroll`.
Список «у дисплея пусто» (L317) — добавить `'salaryPlans'`.

Run: `node .validation-pglite-20261029/validate.mjs`
Expected: `SUMMARY {"passes":N,"failures":0,…}`.

- [ ] **Step 2: Миграция**

`supabase/migrations/20261105_salary_plans.sql` — конвенция как в `20261102_composite_order_positions.sql`: идемпотентный DDL + полная замена `erp_snapshot()` и `erp_execute()` из правленного `supabase/schema.sql` + `GRANT`.

```sql
BEGIN;

ALTER TABLE public.erp_employees ADD COLUMN IF NOT EXISTS deactivated_at date;

CREATE TABLE IF NOT EXISTS public.erp_salary_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  from_month text NOT NULL CHECK (from_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, employee_id, from_month),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id)
);
CREATE INDEX IF NOT EXISTS erp_salary_plans_employee_idx ON public.erp_salary_plans(company_id, employee_id, from_month);

ALTER TABLE public.erp_salary_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_salary_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_salary_plans TO authenticated;
DROP POLICY IF EXISTS erp_admin_read ON public.erp_salary_plans;
CREATE POLICY erp_admin_read ON public.erp_salary_plans FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

CREATE OR REPLACE FUNCTION public.erp_salary_ledger(p_company uuid, p_employee uuid, p_as_of date DEFAULT (CURRENT_DATE))
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
  … тело из Task 7 Step 3, слово в слово …
$$;

CREATE OR REPLACE FUNCTION public.erp_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
  … полный текст правленной функции из supabase/schema.sql …
$$;

CREATE OR REPLACE FUNCTION public.erp_execute(… существующая сигнатура …)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  … полный текст правленной функции из supabase/schema.sql …
$$;

GRANT EXECUTE ON FUNCTION public.erp_snapshot(), public.erp_execute(p_request jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.erp_salary_ledger(uuid, uuid, date) TO authenticated;

COMMIT;
```

`… полный текст …` — не плейсхолдер в смысле плана: перед запуском скопировать функции целиком из уже правленного `supabase/schema.sql` — `erp_snapshot()` (от строки `CREATE FUNCTION public.erp_snapshot()` до ближайшего `$$;`), `erp_execute()` (от `CREATE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)` до ближайшего `$$;`) и `erp_salary_ledger()` (блок Задачи 7, шаг 3). В `schema.sql` они объявлены через `CREATE FUNCTION`, в миграции — через `CREATE OR REPLACE FUNCTION`, как в `20261102_composite_order_positions.sql`; тела при этом слово в слово те же, иначе миграция откатит правки Задачи 7. Сигнатуру и `GRANT` для `erp_execute` взять из соседней миграции — аргументы функции менять нельзя.

- [ ] **Step 3: Зонд паритета и круга копии**

`.validation-pglite-20261029/validate-salary-migration.mjs` — по образцу `validate-composite-migration.mjs` (его заголовок L1-L38 даёт `as`, `owner`, `state`, `execute`), с кругом копии из `company-copy-probe.mjs` (его вызовы `erp_backup_dump`/`erp_backup_restore` уже работают). Дамп и восстановление определены не в `supabase/schema.sql`, а в `supabase/migrations/20261104_backup_dump_restore.sql` — поэтому зонд ставит три файла в порядке `schema.sql → 20261104 → 20261105`. `erp_backup_tables()` перечитывает каталог, так что `erp_salary_plans` попадает в копию сам: менять SQL копии не нужно, зонд только это проверяет.

```js
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import ts from '../node_modules/typescript/lib/typescript.js';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const copySql = await fs.readFile(new URL('supabase/migrations/20261104_backup_dump_restore.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261105_salary_plans.sql', root), 'utf8');

// salary.ts импортирует из './types' только типы, поэтому на выходе самодостаточный файл.
// types.mjs пишем «на всякий случай»: если транспилятор оставит импорт, он разрешится в пустой модуль.
const gen = new URL('.gen/', import.meta.url);
await fs.mkdir(gen, { recursive: true });
for (const name of ['types', 'salary']) {
  const source = await fs.readFile(new URL(`src/${name}.ts`, root), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from '\.\/([a-z]+)'/g, "from './$1.mjs'");
  await fs.writeFile(new URL(`${name}.mjs`, gen), compiled);
}
const { salaryLedger } = await import(new URL('salary.mjs', gen));

const iso = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
let passes = 0;
const pass = (name, details) => { passes++; console.log('PASS', name, details === undefined ? '' : JSON.stringify(details)); };

const db = new PGlite();
const adminId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)', [adminId, 'admin@local.invalid', JSON.stringify({ name: 'Owner' })]);
await db.exec(schema);
await db.exec(copySql);
await db.exec(migration);
pass('schema.sql, копия и миграция окладов ставятся в одном PGlite');

async function as() {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [adminId]);
  await db.exec('SET ROLE authenticated');
}
async function owner(query, params = []) { await db.exec('RESET ROLE'); return (await db.query(query, params)).rows; }
async function one(query, params = []) { return (await owner(query, params))[0]; }
async function snapshotState() {
  await as();
  const rows = (await db.query('SELECT public.erp_snapshot() AS result')).rows;
  await db.exec('RESET ROLE');
  return rows[0].result.state;
}
async function execute(command) {
  const revision = Number((await one('SELECT revision FROM public.erp_metadata')).revision);
  await as();
  const result = (await db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb) AS result',
    [crypto.randomUUID(), revision, JSON.stringify(command)])).rows[0].result;
  await db.exec('RESET ROLE');
  return result;
}
async function fingerprint() {
  return JSON.stringify(await one(`SELECT (SELECT count(*) FROM public.erp_orders) AS orders,
    (SELECT count(*) FROM public.erp_payroll) AS payroll, (SELECT count(*) FROM public.erp_cash) AS cash,
    (SELECT count(*) FROM public.erp_salary_plans) AS plans, (SELECT count(*) FROM public.erp_audit) AS audit,
    (SELECT revision FROM public.erp_metadata) AS revision`));
}
async function rejects(name, callback, code, message) {
  const before = await fingerprint();
  let error;
  try { await callback(); } catch (e) { error = e; }
  assert.ok(error, `Expected rejection: ${name}`);
  if (code) assert.equal(error.code, code, `${name}: ${error.message}`);
  if (message) assert.match(error.message, message, `${name}: ${error.message}`);
  assert.equal(await fingerprint(), before, `${name}: mutation leaked after a failed statement`);
  pass(name, { code: error.code });
}

// Компания и справочники, через которые пользователь реально создаёт начисления.
await as();
await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Oylik zondu']);
await db.exec('RESET ROLE');
const companyId = (await one('SELECT id FROM public.erp_companies LIMIT 1')).id;
let result = await execute({ type: 'customer.create', name: 'Buyer', phone: '', address: '', kind: 'customer' });
const customer = result.state.customers[0].id;
result = await execute({ type: 'supplier.create', name: 'Plank mill', phone: '' });
const supplier = result.state.suppliers[0].id;
result = await execute({ type: 'item.create', name: 'Board', unit: 'sheet', minQty: 0, cost: 10, customerId: null });
const board = result.state.items[0].id;
result = await execute({ type: 'machine.create', name: 'CNC', hourlyRevenueTarget: 200000 });
const machine = result.state.machines[0].id;
result = await execute({ type: 'purchase.create', supplierId: supplier, lines: [{ itemId: board, qty: 20, price: 10 }] });
const purchase = result.state.purchases[0];
await execute({ type: 'purchase.receive', purchaseId: purchase.id, lines: purchase.lines.map(line => ({ lineId: line.id, qty: line.qty })) });
await execute({ type: 'cash.post', direction: 'in', amount: 5000000, account: 'cash', toAccount: null, category: 'capital', note: '' });

const PLAN_MONTH = '2026-11';
const AS_OF = '2026-11-30';
const cases = [
  { name: 'plan only', plans: [[PLAN_MONTH, 1200000]], accruals: [], payments: [],
    expect: { carryOver: 0, carryOverPaid: 0, prepaid: 0, owed: 1200000 } },
  { name: 'carry-over accrual', plans: [[PLAN_MONTH, 1200000]], accruals: [['2026-10-05', 340000]], payments: [],
    expect: { carryOver: 340000, carryOverPaid: 0, prepaid: 0, owed: 1540000 } },
  { name: 'FIFO clears the oldest month', plans: [[PLAN_MONTH, 1200000]], accruals: [['2026-10-05', 340000]],
    payments: [['2026-11-10', 800000, false]],
    expect: { carryOver: 340000, carryOverPaid: 340000, prepaid: 0, owed: 740000 } },
  { name: 'deactivated mid-month', plans: [[PLAN_MONTH, 1200000]], accruals: [], payments: [], deactivatedAt: '2026-11-15',
    expect: { carryOver: 0, carryOverPaid: 0, prepaid: 0, owed: 600000 } },
  { name: 'overpayment becomes prepaid', plans: [[PLAN_MONTH, 1200000]], accruals: [],
    payments: [['2026-11-05', 2000000, true]],
    expect: { carryOver: 0, carryOverPaid: 0, prepaid: 800000, owed: 0 } },
  { name: 'payment before the plan', plans: [[PLAN_MONTH, 1200000]], accruals: [['2026-10-05', 340000]],
    payments: [['2026-10-20', 200000, false]],
    expect: { carryOver: 140000, carryOverPaid: 0, prepaid: 0, owed: 1340000 } },
];

// Один работник на кейс; этап с autoAccept, чтобы начисление рождалось приёмкой работы, а не ручным платёжом.
const employeeIds = [];
for (const testCase of cases) {
  result = await execute({ type: 'employee.create', name: testCase.name });
  employeeIds.push(result.state.employees.find(row => row.name === testCase.name).id);
}
result = await execute({
  type: 'operation.create', name: 'Cutting', unit: 'sheet', salePrice: 5, workerRate: 2, standardMinutes: 15,
  machineId: machine, employeeIds, active: true, autoAccept: true,
});
const cutting = result.state.operations[0].id;

// Приложение не умеет ставить дату назад, поэтому зонд сдвигает created_at владельцем —
// так же, как validate.mjs:1181 выставляет срок телеграм-кода.
async function accrue(employeeId, amount, createdAt) {
  const title = `Accrual ${createdAt} ${employeeId.slice(0, 8)}`;
  result = await execute({
    type: 'order.create', input: {
      kind: 'product', customerId: customer, title, qty: 1, price: 100000, overhead: 0, dueDate: '',
      materials: [{ itemId: board, qty: 1 }], route: [{ operationId: cutting, employeeId, rate: amount }], advance: 0, account: 'cash',
    },
  });
  const order = result.state.orders.find(row => row.title === title);
  await execute({ type: 'order.launch', orderId: order.id });
  await execute({ type: 'order.issue', orderId: order.id });
  await execute({ type: 'work.accept', orderId: order.id, taskId: order.route[0].id });
  await execute({ type: 'work.start', orderId: order.id, taskId: order.route[0].id });
  await execute({ type: 'work.submit', orderId: order.id, taskId: order.route[0].id, qty: 1, note: '' });
  await owner('UPDATE public.erp_payroll SET created_at = $1 WHERE company_id = $2 AND employee_id = $3 AND report_id IS NOT NULL',
    [`${createdAt}T09:00:00.000Z`, companyId, employeeId]);
}
async function pay(employeeId, amount, createdAt, allowPrepay) {
  const note = `zondi ${createdAt} ${employeeId.slice(0, 8)}`;
  await execute({ type: 'salary.pay', employeeId, amount, account: 'cash', kind: 'payroll', note, allowPrepay });
  await owner("UPDATE public.erp_cash SET created_at = $1, note = '' WHERE company_id = $2 AND note = $3",
    [`${createdAt}T09:00:00.000Z`, companyId, note]);
}

for (const [index, testCase] of cases.entries()) {
  const employeeId = employeeIds[index];
  if (testCase.deactivatedAt) {
    await execute({ type: 'employee.update', employeeId, name: testCase.name, active: false, deactivatedAt: testCase.deactivatedAt });
  }
  for (const [month, amount] of testCase.plans) await execute({ type: 'salary.plan.set', employeeId, amount, fromMonth: month });
  for (const [date, amount] of testCase.accruals) await accrue(employeeId, amount, date);
  for (const [date, amount, allowPrepay] of testCase.payments) await pay(employeeId, amount, date, allowPrepay);

  // Одна и та же строка на обоих сторонах: TS читает снимок, который отдал сервер.
  const state = await snapshotState();
  const ts = salaryLedger(state, employeeId, `${AS_OF}T23:59:59.000Z`);
  const got = (await db.query('SELECT public.erp_salary_ledger($1, $2, $3::date) AS ledger',
    [companyId, employeeId, AS_OF])).rows[0].ledger;
  for (const key of ['carryOver', 'carryOverPaid', 'prepaid', 'owed', 'paidTotal', 'plannedTotal']) {
    assert.equal(Number(got[key]), Number(ts[key]), `${testCase.name}: ${key}`);
  }
  for (const [key, value] of Object.entries(testCase.expect)) {
    assert.equal(Number(got[key]), value, `${testCase.name}: серверный ${key}`);
    assert.equal(ts[key], value, `${testCase.name}: доменный ${key}`);
  }
  assert.deepEqual(got.months.map(m => [m.month, Number(m.obliged), Number(m.paid), Number(m.unpaid)]),
    ts.months.map(m => [m.month, m.obliged, m.paid, m.unpaid]), testCase.name);
  pass(`паритет: ${testCase.name}`, { owed: Number(got.owed), months: got.months.length });
}

// Круг копии: план оклада обязан пережить дамп и восстановление.
const before = await snapshotState();
const revision = Number((await one('SELECT revision FROM public.erp_metadata WHERE company_id = $1', [companyId])).revision);
const dump = iso((await one('SELECT public.erp_backup_dump($1) AS j', [companyId])).j);
assert.ok(Array.isArray(dump.tables.erp_salary_plans), 'erp_backup_tables() не узнаёт новую таблицу');
assert.equal(dump.tables.erp_salary_plans.length, before.salaryPlans.length, 'в дамп попали не все оклады');
await owner('UPDATE public.erp_salary_plans SET amount = 1 WHERE company_id = $1', [companyId]);
const restored = iso((await one('SELECT public.erp_backup_restore($1::jsonb, $2::bigint) AS r', [JSON.stringify(dump), revision])).r);
assert.equal(Number(restored.revision), revision + 1, 'восстановление не подняло ревизию');
const after = await snapshotState();
assert.deepEqual(after.salaryPlans, before.salaryPlans, 'оклады пропали или испортились в круге копии');
pass('Круг копии сохраняет salaryPlans', { count: after.salaryPlans.length });

// Серверные потолки `salary.pay` считаются по CURRENT_DATE, поэтому суммы берутся из самого
// сервера, а не с клавиатуры: зонд остаётся прохожим в любом месяце.
async function owedOf(employeeId) {
  return Number((await owner("SELECT (public.erp_salary_ledger($1, $2) ->> 'owed')::numeric AS owed", [companyId, employeeId]))[0].owed);
}
async function cashBalance() {
  return Number((await owner("SELECT public.erp_balance($1, 'cash') AS balance", [companyId]))[0].balance);
}

await rejects('Salary plan month must be YYYY-MM', () => execute({ type: 'salary.plan.set', employeeId: employeeIds[0], amount: 1000, fromMonth: '2026-13' }), '22023', /Invalid salary plan month/);
await rejects('Salary plan needs a real employee', () => execute({ type: 'salary.plan.set', employeeId: crypto.randomUUID(), amount: 1000, fromMonth: PLAN_MONTH }), '22023', /Employee not found/);
await rejects('Deactivation date must be a real date', () => execute({ type: 'employee.update', employeeId: employeeIds[0], name: cases[0].name, active: false, deactivatedAt: 'nope' }), '22023', /Invalid deactivation date/);
await rejects('Advance over the balance needs the prepay flag', async () => {
  const limit = await owedOf(employeeIds[0]);
  await execute({ type: 'salary.pay', employeeId: employeeIds[0], amount: limit + 100000, account: 'cash', kind: 'payroll', note: '', allowPrepay: false });
}, '23514', /Payment exceeds payable/);
await rejects('Advance over the account balance is refused', async () => {
  const balance = await cashBalance();
  await execute({ type: 'salary.pay', employeeId: employeeIds[4], amount: balance + 100000, account: 'cash', kind: 'payroll', note: '', allowPrepay: true });
}, '23514', /Insufficient account balance/);

console.log('SUMMARY', JSON.stringify({ passes, failures: 0, remoteConnections: 0,
  limitations: ['Живая база не тронута: зонд работает в изолированном PGlite.',
    'created_at сдвинут владельцем, потому что приложение не умеет ставить дату назад.'] }));
```

Два последних отказа ровно те же, что в домене (Задача 4, шаг 2): сначала потолок `owed`, потом остаток счёта. Коды `23514` и `22023` — те же, что использует `rejects` в `validate.mjs`, поэтому текст ошибки — проверка, а не название кейса.

`carryOver` в ожиданиях — это остаток **до** первого месяца плана за вычетом выплат того же периода: в последнем кейсе 340 000 − 200 000 = 140 000, а не 340 000. Так же считает и `src/salary.ts` (Задача 2), и `erp_salary_ledger` (Задача 7) — расхождение здесь означало бы, что паритет держится на удаче.

- [ ] **Step 4: Проверка**

Run: `node .validation-pglite-20261029/validate-salary-migration.mjs`
Expected: все 6 паритетов + круг копии + отказа — `failures: 0`, `remoteConnections: 0`.

Run: `node .validation-pglite-20261029/validate.mjs` → `failures: 0`.

- [ ] **Step 5: Стоп-точка про удалённые изменения**

Ни `supabase db push`, ни `supabase link`, ни SQL в Dashboard, ни `npm run deploy` — только по отдельному разрешению владельца. Порядок выката, который потом обязан быть соблюдён: **сначала миграция живой базы, потом публикация фронтенда** (`verifiedSnapshot` из Задачи 1 иначе отклонит каждый облачный снимок).

---

### Task 10: Демо-данные и финальная проверка

**Files:**
- Modify: `src/seed.ts` (`createDemo` L93, хелперы L96-100)

**Interfaces:**
- Consumes: `salary.plan.set`, `salary.pay`, `employee.update` (Задача 4), панель (Задача 6).
- Produces: демо, где видно закрытый и открытый месяц, аванс и уволенного работника с остатком.

- [ ] **Step 1: Данные**

В `src/seed.ts` рядом с `dateOffset` добавить:

```ts
export function monthOffset(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
```

Перед `return state;` (`src/seed.ts:93`) — третьего работника добавлять **после** существующих, потому что `state.employees[0]` и `[1]` уже разложены по маршрутам (`src/seed.ts:60,69,86`), а `employeeIds` для операций снимается раньше (`src/seed.ts:15`):

```ts
  run({ type: 'employee.create', name: 'Bo‘yoqchi (ketgan)' });
  const leftName = state.employees.at(-1)!.name;
  run({ type: 'salary.plan.set', employeeId: state.employees[0].id, amount: 3200000, fromMonth: monthOffset(-1) });
  run({ type: 'salary.plan.set', employeeId: state.employees[1].id, amount: 2600000, fromMonth: monthOffset(-1) });
  run({ type: 'salary.pay', employeeId: state.employees[1].id, amount: 1500000, account: 'cash', kind: 'advance', note: 'Oylikdan oldin avans', allowPrepay: false });
  run({ type: 'salary.pay', employeeId: state.employees[0].id, amount: 1600000, account: 'cash', kind: 'payroll', note: 'Oltin oylik to‘lovi', allowPrepay: false });
  run({ type: 'employee.update', employeeId: state.employees.at(-1)!.id, name: leftName, active: false, deactivatedAt: `${monthOffset(-1)}-12` });
```

Суммы заведомо меньше кассы (`30 000 000` bank + `6 000 000` o‘tkazma → `6 000 000` naqd до выплат), и оба платежа проходят без `allowPrepay`. Уволенный работник получает плановый месяц только на 12 дней — у него остаётся непокрытый `owed`, и именно его видно с бейджем `Ishdan chiqqan`.

- [ ] **Step 2: Проверка домена на демо**

Run: `npx vitest run src/domain.test.ts src/work-view.test.ts src/repository.test.ts`
Expected: PASS — ни один из этих тестов не считает количество работников (`src/work-view.test.ts:20` фильтрует по `id`, а не по индексу).

- [ ] **Step 3: Полная проверка**

Run: `npm test` → PASS, вывод чистый (ни warning, ни unhandled).
Run: `npm run build` → exit 0.
Run: `node .validation-pglite-20261029/validate.mjs` → `failures: 0`.
Run: `node .validation-pglite-20261029/validate-salary-migration.mjs` → `failures: 0`.

- [ ] **Step 4: Телефон в демо-режиме**

Убедиться, что `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` пусты (иначе запись уйдёт в живые данные). Запустить: `npm run dev`.
В браузере на ширине 390px, профиль «Egasi (admin)», раздел «Xodimlar» → «Oylik va qarzlar» проверить и увидеть своими глазами:
1. четыре метрики с узбекскими подписями и суммами в `so'm`;
2. строку работника с полосой месяцев, прокручивающуюся пальцем: чип `noyabr · 2026`, сумма, `to‘langan` / `qisman` / `to‘lanmagan`; у уволенного — бейдж `Ishdan chiqqan · qoldiq …`;
3. тап по чипу 44px и выше — раскрывается проводка месяца с категорией `Ish haqi` / `Avans` (в кассовом журнале того же работника — тоже);
4. «Oylik belgilash» → месяц `YYYY-MM` + сумма → панель пересчиталась, долг изменился;
5. «To‘lash» → «Avans berish» / «To‘liq to‘lov», сумма, `Naqd pul` / `Bank / karta`, `Izoh`, чекбокс `Oldindan to‘lovga ruxsat`. Без флага сумма больше остатка отклоняется с текстом `Summa qarz qoldig‘idan oshadi…`; с флагом — проходит и уходит в `Oldindan berilgan`;
6. карточка работника в «Xodimlar» показывает `Oylik` вместо `Hisoblangan`, «Kreditor qarzdorlik» ведёт в `salaryPay`;
7. раздел «Moliya va kassa» → журнал: категории по-узбекски, стorno работает, долг возвращается;
8. переключить профиль на работника: панели «Oylik va qarzlar» нет, «Mening hisobim» считает как раньше.
Проверить, что `revision` в диагностике не изменился от простого просмотра и что консоль браузера чистая.

- [ ] **Step 5: Итог владельцу**

Отчёт на русском: что изменилось (пути к файлам), какие проверки пройдены и их вывод, что плановый долг сдельных начислений после `startMonth` намеренно не суммируется с окладом (правило 1 спецификации), и отдельным пунктом — что для живого клиента нужны два разрешения: миграция базы и публикация `dist`.
