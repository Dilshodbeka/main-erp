# Tenant and Production Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить изоляцию компаний, справочники операций/станков и полный рабочий цикл заданий с контролируемыми сдельными начислениями.

**Architecture:** Домен остаётся командным и детерминированным; компания определяется серверным профилем, а не входом команды. React использует те же команды в demo и cloud, а Supabase повторяет проверки внутри транзакции.

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 6, Vitest 3, Supabase JS/Postgres/RLS, PGlite validation.

**Spec:** `docs/superpowers/specs/2026-10-30-production-erp-design.md`

## Global Constraints

- Интерфейс и новые сообщения — узбекский латинский алфавит; деньги — целые `so‘m` (UZS), количества — до трёх знаков.
- Все записи облачной базы принадлежат одной `company_id`; клиент не выбирает компанию внутри команды.
- `admin`, `worker`, `display` имеют ровно права из спецификации; `display` не исполняет команды.
- Повтор `requestId` и повторная сдача не дублируют начисления.
- Не изменять удалённые Supabase/Vercel/Netlify без отдельного разрешения.
- Каталог не является Git-репозиторием: не инициализировать Git и не создавать коммиты; checkpoint отмечается через TaskUpdate.
- После каждой задачи: `npx tsc --noEmit` и `npm test -- --run` должны проходить.

---

### Task 1: Идентичность компании и миграция состояния

**Files:**
- Modify: `src/types.ts`
- Create: `src/migrations.ts`
- Create: `src/migrations.test.ts`
- Modify: `src/repository.ts`
- Modify: `src/sync.ts`
- Modify: `src/seed.ts`
- Modify: `src/domain.test.ts`
- Modify: `src/sync.test.ts`

**Interfaces:**
- Consumes: существующие `Actor`, `State`, `Snapshot`, `createDemo`, `readDemo`.
- Produces: `DEMO_COMPANY_ID: string`; `Actor.companyId: string`; `State.companyId: string`; `State.version: 2`; `migrateState(value: unknown): State`.

- [ ] **Step 1: Написать падающие тесты миграции и компании**

```ts
import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID, migrateState } from './migrations';
import { emptyState } from './domain';
import type { State } from './types';

describe('tenant state', () => {
  it('creates state bound to the demo company', () => {
    const state = emptyState();
    expect(state.version).toBe(2);
    expect(state.companyId).toBe(DEMO_COMPANY_ID);
  });

  it('migrates v1 without dropping journals', () => {
    const legacy: unknown = JSON.parse(JSON.stringify({ ...emptyState(), version: 1 }));
    const migrated = migrateState(legacy);
    expect(migrated.companyId).toBe(DEMO_COMPANY_ID);
    expect(migrated.movements).toEqual((legacy as State).movements);
    expect(migrated.cash).toEqual((legacy as State).cash);
  });

  it('rejects malformed state', () => {
    expect(() => migrateState({ version: 2, cash: null })).toThrow('Ma’lumotlar formati noto‘g‘ri');
  });
});
```

- [ ] **Step 2: Запустить тест и подтвердить причину FAIL**

Run: `npx vitest run src/migrations.test.ts`  
Expected: FAIL, потому что `./migrations` ещё не существует.

- [ ] **Step 3: Реализовать типы и минимальную миграцию**

```ts
export const DEMO_COMPANY_ID = '00000000-0000-4000-8000-0000000000c1';

export function migrateState(value: unknown): State {
  if (!value || typeof value !== 'object') throw new Error('Ma’lumotlar formati noto‘g‘ri');
  const source = value as Record<string, unknown>;
  if (![1, 2].includes(Number(source.version)) || !Array.isArray(source.cash)) {
    throw new Error('Ma’lumotlar formati noto‘g‘ri');
  }
  return {
    ...source,
    version: 2,
    companyId: typeof source.companyId === 'string' ? source.companyId : DEMO_COMPANY_ID,
    machines: Array.isArray(source.machines) ? source.machines : [],
  } as State;
}
```

Добавить `companyId` в `Actor` и `State`, установить `version: 2`, задать демо-акторам `DEMO_COMPANY_ID`. `readDemo`, `emptyState`, `createDemo` и snapshot validation должны использовать `migrateState`; snapshot с другой компанией актора отклоняется.

- [ ] **Step 4: Обновить fixtures и проверить отсутствие регрессий**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: все существующие и новые тесты PASS; TypeScript не сообщает об отсутствующем `companyId`.

- [ ] **Step 5: Отметить checkpoint**

TaskUpdate: задача 1 завершена только после зелёных тестов; отдельный Git commit не создавать.

### Task 2: Справочники станков и операций

**Files:**
- Modify: `src/types.ts`
- Modify: `src/domain.ts`
- Modify: `src/domain.test.ts`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: `State.companyId`, `applyCommand`, администратор Task 1.
- Produces: `OperationUnit`; `Machine`; расширенный `Operation`; команды `machine.create`, `machine.update`, `operation.create`, `operation.update`.

- [ ] **Step 1: Написать падающий доменный тест**

```ts
it('stores machine economics and operation authorization', () => {
  let state = emptyState();
  state = applyCommand(state, envelope({
    type: 'machine.create', name: 'Format kesish', hourlyRevenueTarget: 200000,
  }), admin);
  const machine = state.machines[0];
  state = applyCommand(state, envelope({
    type: 'operation.create', name: 'Kesish', unit: 'sheet', salePrice: 50000,
    workerRate: 5000, standardMinutes: 15, machineId: machine.id,
    employeeIds: [state.employees[0].id], active: true,
  }), admin);
  expect(state.operations[0]).toMatchObject({
    unit: 'sheet', salePrice: 50000, workerRate: 5000,
    standardMinutes: 15, machineId: machine.id,
  });
});
```

Добавить тесты: отрицательная норма/цена отклоняется; неизвестный работник или станок отклоняется; работник не может менять справочник; неактивная операция недоступна новым заказам.

- [ ] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/domain.test.ts -t "machine economics"`  
Expected: FAIL из-за несоответствия новых команд типу `Command`.

- [ ] **Step 3: Добавить типы и команды**

```ts
export type OperationUnit = 'sheet' | 'meter' | 'squareMeter' | 'piece' | 'hole' | 'minute' | 'hour';
export interface Machine { id: string; name: string; hourlyRevenueTarget: number; active: boolean }
export interface Operation {
  id: string; name: string; unit: OperationUnit; salePrice: number; workerRate: number;
  standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean;
}
```

В `domain.ts` проверять деньги через единый `money`, минуты и объёмы через `quantity`, уникальность работников через `unique`; команды изменения справочников доступны только `admin`. Существующее `Operation.rate` мигрируется в `workerRate`, `salePrice` получает значение старого `rate`, `unit: 'piece'`, `standardMinutes: 0`, `employeeIds` содержит всех активных работников.

- [ ] **Step 4: Обновить демо-справочник и выполнить проверки**

Добавить станок с целью 200000 и операцию раскроя: 15 минут, цена 50000, расценка 5000.  
Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS, старые заказы сохраняют прежние зафиксированные расценки.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 3: Переходы заданий и статусы начислений

**Files:**
- Modify: `src/types.ts`
- Modify: `src/domain.ts`
- Modify: `src/domain.test.ts`
- Modify: `src/sync.ts`
- Modify: `src/sync.test.ts`

**Interfaces:**
- Consumes: `Operation.employeeIds`, `Operation.workerRate`, `Operation.standardMinutes`.
- Produces: `TaskStatus`; `work.accept`, `work.start`, обновлённые `work.submit`, `work.review`; `PayrollEntry.status`; `taskState(state, orderId, taskId): TaskStatus`.

- [ ] **Step 1: Написать падающие тесты полного цикла**

```ts
it('accrues pending once and makes it payable only after acceptance', () => {
  let state = launchedOrder();
  const { order, task, worker } = ownTask(state);
  state = applyCommand(state, envelope({ type: 'work.accept', orderId: order.id, taskId: task.id }), worker);
  state = applyCommand(state, envelope({ type: 'work.start', orderId: order.id, taskId: task.id }), worker);
  state = applyCommand(state, envelope({ type: 'work.submit', orderId: order.id, taskId: task.id, qty: task.planned, note: '' }), worker);
  expect(state.payroll).toHaveLength(1);
  expect(state.payroll[0].status).toBe('pending');
  expect(payrollDebt(state, worker.id)).toBe(0);
  const reportId = state.reports[0].id;
  state = applyCommand(state, envelope({ type: 'work.review', reportId, accept: true }), admin);
  expect(state.payroll[0].status).toBe('accepted');
  expect(payrollDebt(state, worker.id)).toBe(task.planned * task.rate);
});
```

В начале тестового файла определить использованные fixtures через существующий `createDemo`:

```ts
function launchedOrder(): State {
  let state = createDemo(admin);
  const candidate = state.orders.find(o => o.route.length > 0)!;
  if (candidate.status === 'draft') state = applyCommand(state, envelope({ type: 'order.launch', orderId: candidate.id }), admin);
  return state;
}
function ownTask(state: State) {
  const order = state.orders.find(o => o.status === 'production' && o.route.length > 0)!;
  const task = order.route[0];
  const worker: Actor = { id: task.employeeId, name: 'Worker', role: 'worker', companyId: state.companyId };
  return { order, task, worker };
}
```

Отдельные тесты: нельзя начать без принятия; нельзя сдать без старта; чужой/неактивный/недопущенный работник отклонён; следующий этап заблокирован; отклонение переводит начисление в `rejected`; повторная сдача использует ту же запись; повтор envelope не меняет состояние.

- [ ] **Step 2: Запустить тесты и подтвердить FAIL**

Run: `npx vitest run src/domain.test.ts -t "accrues pending"`  
Expected: FAIL из-за отсутствия `work.accept` и `PayrollEntry.status`.

- [ ] **Step 3: Реализовать конечный автомат**

```ts
const transitions: Partial<Record<Command['type'], TaskStatus>> = {
  'work.accept': 'accepted',
  'work.start': 'in_progress',
  'work.submit': 'submitted',
};
```

В `applyCommand` использовать явные проверки `assigned → accepted → in_progress → submitted → completed`; не хранить переход только в UI. `work.submit` создаёт отчёт и одно `pending`-начисление по ключу `(orderId, taskId, employeeId)`. `work.review(false)` возвращает задание `in_progress`, отчёт и начисление — `rejected`; повторная сдача обновляет тот же отчёт и начисление в `pending`. `payrollDebt` суммирует только `accepted` минус выплаты.

- [ ] **Step 4: Проверить домен и офлайн-валидацию**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: все переходы, повторные requestId и rejected queue cases PASS.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 4: Supabase multi-tenant schema и серверные переходы

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `.validation-pglite-20261029/validate.mjs`

**Interfaces:**
- Consumes: команды и статусы Tasks 1–3.
- Produces: `erp_companies`; `erp_profiles.company_id`; `erp_bootstrap_company(p_name text)`; tenant-scoped `erp_snapshot`/`erp_execute`; SQL parity для work transitions.

- [ ] **Step 1: Добавить падающие PGlite-проверки двух компаний**

```js
async function asId(userId, role = 'authenticated') {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`SET ROLE ${role}`);
}
const companyBUser = crypto.randomUUID();
await owner('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)', [companyBUser, 'company-b@local.invalid', '{}']);
await asId(companyBUser);
await db.query('SELECT public.erp_bootstrap_company($1)', ['Company B']);
await rejects(
  'Company B cannot read Company A order by foreign command',
  async () => {
    await asId(companyBUser);
    await db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb)', [crypto.randomUUID(), 0, JSON.stringify({ type: 'order.launch', orderId: order.id })]);
  },
  '22023'
);
await rejects(
  'Worker cannot accept own result',
  () => execute({ type: 'work.review', reportId, accept: true }, 'worker'),
  '42501'
);
await execute({ type: 'work.accept', orderId: order.id, taskId: task.id }, 'worker');
await execute({ type: 'work.start', orderId: order.id, taskId: task.id }, 'worker');
await execute({ type: 'work.submit', orderId: order.id, taskId: task.id, qty: 2, note: '' }, 'worker');
const once = await snapshot();
assert.equal(once.state.payroll.length, 1);
```

Добавить проверки: чужой `requestId` не возвращает данные другой компании; каждый журнал ограничен компанией; bootstrap второй компании не получает доступ к первой; worker/display не вызывают admin functions. Для выполнения от имени Company B использовать `asId(companyBUser)` перед `erp_snapshot` или прямым `erp_execute`; повторная сдача проверяется тем же `requestId`, а не новой командой с другим ID.

- [ ] **Step 2: Запустить PGlite и подтвердить FAIL**

Run: `node .validation-pglite-20261029/validate.mjs`  
Expected: FAIL на отсутствии `erp_companies` и `company_id`.

- [ ] **Step 3: Реализовать tenant scope и bootstrap**

```sql
create table public.erp_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  created_at timestamptz not null default now()
);
alter table public.erp_profiles add column company_id uuid not null references public.erp_companies(id);
create function public.erp_bootstrap_company(p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if exists (select 1 from public.erp_profiles where id = auth.uid()) then
    raise exception 'Profile already exists' using errcode = '22023';
  end if;
  insert into public.erp_companies(name) values (trim(p_name)) returning id into v_company;
  insert into public.erp_profiles(id, company_id, name, role)
  values (auth.uid(), v_company, 'Owner', 'admin');
  return v_company;
end;
$$;
```

Добавить `company_id uuid not null` ко всем бизнес-таблицам, составные внешние ключи `(company_id, id)`, индексы `(company_id, ...)`, RLS `company_id = erp_current_company_id()`. `erp_current_profile` выбирает профиль `auth.uid()`; все запросы snapshot/execute добавляют company predicate. Метаданные ревизии ведутся per company, идемпотентность — `(company_id, request_id)`.

Портировать переходы Task 3 в `erp_execute` с `for update` на документ/задание и уникальным индексом payroll `(company_id, order_id, task_id, employee_id)`. Все изменения одной команды остаются в транзакции.

- [ ] **Step 4: Прогнать полную SQL-проверку и фронтенд-тесты**

Run: `node .validation-pglite-20261029/validate.mjs && npx tsc --noEmit && npm test -- --run`  
Expected: все PGlite checks PASS, включая две компании; Vitest PASS.

- [ ] **Step 5: Отметить checkpoint без Git commit и без применения SQL remotely**

### Task 5: Административные и рабочие экраны производственного ядра

**Files:**
- Create: `src/work-view.ts`
- Create: `src/work-view.test.ts`
- Create: `src/components/WorkTasks.tsx`
- Create: `src/components/CatalogSettings.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: `applyCommand` через существующий `save`, `taskState`, `Operation`, `Machine`, `PayrollEntry.status`.
- Produces: `workTaskRows(state, actor): WorkTaskRow[]`; `workHistoryRows(state, actor): WorkHistoryRow[]`; `boardTaskLabel(status: TaskStatus): string`; управляемые компоненты `WorkTasks` и `CatalogSettings`.

- [ ] **Step 1: Написать падающие тесты view model**

```ts
it('shows own active tasks and removes submitted work without exposing sale prices', () => {
  const rows = workTaskRows(submittedState, worker);
  expect(rows).toHaveLength(0);
  const history = workHistoryRows(submittedState, worker);
  expect(history[0]).toMatchObject({ payrollStatus: 'pending' });
  expect(history[0]).not.toHaveProperty('salePrice');
});
```

Добавить случаи `accepted`, `in_progress`, rejected returned to work, следующий заблокированный этап и чужой работник.

- [ ] **Step 2: Запустить view tests и подтвердить FAIL**

Run: `npx vitest run src/work-view.test.ts`  
Expected: FAIL, модуль отсутствует.

- [ ] **Step 3: Реализовать view model и компоненты**

```ts
export interface WorkTaskRow {
  orderId: string; taskId: string; number: string; title: string;
  operationName: string; planned: number; completed: number; unit: OperationUnit;
  rate: number; status: TaskStatus; dueDate: string;
}
```

`WorkTasks` вызывает только `work.accept`, `work.start`, `work.submit` и показывает собственные `rate`, `pending/accepted/rejected`; не получает admin calculation props. `CatalogSettings` редактирует станки, операции, цены, нормы и допуски сотрудников через команды Task 2. Использовать реальные кнопки с disabled при `busy`, а не оптимистичные локальные переходы. Канбан и TV chips должны отображать состояния `assigned/accepted/in_progress/submitted/completed` через общий mapper без цен; `display` остаётся read-only.

- [ ] **Step 4: Проверить тесты, сборку и браузер**

Run: `npx tsc --noEmit && npm test -- --run && npm run build`  
Expected: PASS и успешный build.

Запустить `npm run dev -- --host 127.0.0.1 --port 5175`; в браузере выполнить admin launch → worker accept/start/finish → admin review → worker accepted earnings. Повторить на viewport 390×844: без горизонтального overflow, кнопки доступны, денежные данные клиента у работника отсутствуют. Проверить TV: только канбан, никаких новых admin controls.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 6: Регрессионный checkpoint первого этапа

**Files:**
- Modify only if a verified regression requires it: `src/*`, `supabase/schema.sql`, `.validation-pglite-20261029/validate.mjs`

**Interfaces:**
- Consumes: все предыдущие интерфейсы.
- Produces: зафиксированный рабочий baseline для следующего плана.

- [ ] **Step 1: Запустить статическую и unit-проверку**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: 0 TypeScript errors, 0 failed tests.

- [ ] **Step 2: Запустить SQL и production build**

Run: `node .validation-pglite-20261029/validate.mjs && npm run build`  
Expected: 0 PGlite failures, успешный Vite build.

- [ ] **Step 3: Зафиксировать результат и следующий план**

TaskUpdate: производственное ядро завершено; следующий документ — `docs/superpowers/plans/2026-10-30-recipes-series-stock.md`. Не заявлять о cloud production readiness: удалённый проект не применялся.
