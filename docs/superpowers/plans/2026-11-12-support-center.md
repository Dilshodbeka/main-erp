# Support Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работник и владелец переписываются по проблеме внутри «Yordamchi» (третья вкладка «Murojaat»), сообщение работника несёт авто-диагностику, а над мурожаатами виден статический FAQ с поиском.

**Architecture:** Одна новая коллекция `tickets` в существующем снапшоте и движке команд. Чистые модули `src/support.ts` (контекст, видимость, непрочитанное, счётчики) и `src/support-faq.ts` (FAQ + поиск) не знают о React. Команды `ticket.create`, `ticket.reply`, `ticket.close` живут в домене и в `erp_execute` с байт-идентичными текстами ошибок. Компонент `Support.tsx` рендерится третьей вкладкой `GuidePanel`; `App` передаёт тикеты, seen-метки (localStorage, без новой команды) и диагностику.

**Tech Stack:** React 19, TypeScript strict, Vitest 3 (node/SSR), PGlite (только в `.validation-pglite-20261029`), PostgreSQL/Supabase.

**Spec:** `docs/superpowers/specs/2026-11-12-support-center-design.md`

## Global Constraints

- Рабочая папка — **не Git-репозиторий**: никаких `git`-команд и коммитов. Вместо шагов commit — проверки `npx vitest run <файл>`, `npx tsc -b --pretty false`, `npm test`, `npm run build`.
- **Никаких удалённых изменений, живого SQL и деплоя** без отдельного явного разрешения владельца с упоминанием `erp-tizim`. Живой SQL владелец применяет сам через Supabase SQL Editor.
- Секреты только на сервере; в файлах проекта и в чате — никогда. Не печатать данные компаний и бэкапов.
- UI — узбекская латиница, суммы UZS; отчёт владельцу — на русском.
- UI-тесты только SSR: `renderToStaticMarkup(createElement(...))`. `fireEvent`, `userEvent`, jsdom запрещены во всём проекте.
- Доменные тексты ошибок байт-в-байт совпадают с `RAISE EXCEPTION` в `schema.sql`; контрактный тест это фиксирует.
- `State.version` остаётся `4`; массив `collections` в `src/migrations.ts:7-10` не меняется — `tickets` добавляется только fallback-ом (как `routeTemplates`).
- Никаких новых npm-зависимостей.
- Демо-режим (без Supabase) полностью работает: тикеты живут в памяти, seen-метки — в localStorage.
- Диагностика в контексте редактируется (маска 4+ цифр) до обрезки до 300 символов.

## Отклонения от спецификации (обоснованные)

1. `SupportProps` получает обязательное `revision: number` — спецификация §4.1 его не перечисляет, но `TicketContext` (§3.1) требует; `App` передаёт `state.revision`.
2. `src/sync.ts:77` — **третий** whitelist ролей (офлайн-проекция), помимо домена и SQL; расширяется теми же `ticket.create`/`ticket.reply`.
3. `SupportProps` экспортируется из `Support.tsx`; `Guide.tsx` импортирует тип.
4. `ticket.close` не меняет `updatedAt`: закрытие не является сообщением, тесты сравнивают `updatedAt` с `lastMessage.at`.
5. `pending` в `SupportProps` — число `sync.pending.length`, а не массив (в `syncStatus()` это `Pending[]`).
6. `buildTicketContext` маскирует цифры **до** обрезки ошибки до 300 символов (защита от длинных числовых хвостов).
7. `src/work-view.test.ts:122-140` — единственный полный литерал `State` вне фабрик; получает `tickets: []`. `src/sync.test.ts` worker-фикстура получает один тикет для проверки whitelist.
8. SQL `erp_text(..., true)` для не-строки бросает `Ticket text must be a string` — расхождение с доменом `Ticket text is required`; контракт и зонд проверяют только пустую строку и превышение длины.
9. `SupportPanel` сам применяет `visibleTickets` к переданным тикетам (App тоже передаёт видимые) — двойная фильтрация безвредна и позволяет SSR-тестам передавать смешанный набор.

---

## File Structure

- Create: `src/support.ts` — контекст, видимость, непрочитанное, storage-метки.
- Create: `src/support.test.ts` — unit-тесты модуля.
- Create: `src/support-faq.ts` — 8 вопросов и поиск.
- Create: `src/support-faq.test.ts` — тесты FAQ.
- Create: `src/components/Support.tsx` — панель, список, тред, новая мурожаат, FAQ.
- Create: `src/support-ui.test.tsx` — SSR-разметка.
- Create: `src/ticketContract.test.ts` — контракт `schema.sql` ↔ домен.
- Create: `supabase/migrations/20261112_support_tickets.sql` — генерируемая идемпотентная миграция.
- Create: `.validation-pglite-20261029/generate-support-tickets-migration.mjs` — генератор миграции.
- Create: `.validation-pglite-20261029/validate-support-tickets.mjs` — PGlite-зонд паритета.
- Modify: `src/types.ts`, `src/domain.ts`, `src/migrations.ts`, `src/sync.ts`, `src/i18n.ts`, `src/diagnostics.ts`, `src/components/Guide.tsx`, `src/App.tsx`, `src/styles.css`, `supabase/schema.sql`.
- Modify tests: `src/migrations.test.ts`, `src/sync.test.ts`, `src/work-view.test.ts`, `src/domain.test.ts`, `src/i18n.test.ts`.

---

### Task 1: Коллекция `tickets` в типах, миграции, синхронизации

**Files:**
- Modify: `src/types.ts`
- Modify: `src/domain.ts:462-468`
- Modify: `src/migrations.ts:1-3,137-138`
- Modify: `src/sync.ts:25`
- Modify: `src/work-view.test.ts:122-140`
- Test: `src/migrations.test.ts` (в конец файла)
- Test: `src/sync.test.ts` (в конец файла)

**Interfaces:**
- Consumes: ничего.
- Produces: `TicketRole`, `TicketStatus`, `TicketContext`, `TicketMessage`, `SupportTicket`, `State.tickets: SupportTicket[]` — используются всеми последующими задачами.

- [ ] **Step 1: Добавить типы и коллекцию (RED-основа)**

В `src/types.ts` после `AuditEntry` (строка 120) и перед `State` вставить:

```ts
export type TicketRole = 'worker' | 'admin';
export type TicketStatus = 'open' | 'closed';
export interface TicketContext {
  page: string;
  revision: number;
  sync: 'online' | 'offline';
  pending: number;
  build: string;
  errors: string[];
}
export interface TicketMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  at: string;
  text: string;
  context: TicketContext | null;
}
export interface SupportTicket {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  messages: TicketMessage[];
}
```

В `State` (строка 124, конец строки `... shipments: Shipment[]; audit: AuditEntry[];`) добавить `tickets` перед `audit`:

```ts
  cash: CashEntry[]; reports: WorkReport[]; payroll: PayrollEntry[]; salaryPlans: SalaryPlan[]; expensePlans: ExpensePlan[]; loans: LoanRow[]; routeTemplates: RouteTemplate[]; workerDeductions: WorkerDeduction[]; shipments: Shipment[]; tickets: SupportTicket[]; audit: AuditEntry[];
```

- [ ] **Step 2: `emptyState`**

В `src/domain.ts` заменить конец объекта `emptyState` (строка 466):

```ts
    shipments: [], audit: [], salaryPlans: [], expensePlans: [], loans: [], routeTemplates: [], workerDeductions: [], tickets: [],
```

- [ ] **Step 3: Fallback миграции**

В `src/migrations.ts` добавить `SupportTicket` в существующий `import type {...} from './types'` (строка 2) и после `workerDeductions` (строка 138) добавить:

```ts
    tickets: Array.isArray(source.tickets) ? source.tickets as SupportTicket[] : [],
```

**Не добавлять** `'tickets'` в `collections` (строки 7-10): старые снапшоты должны проходить миграцию.

- [ ] **Step 4: Валидация снапшота**

В `src/sync.ts` в массив `arrays` (строка 25) добавить `'tickets'` между `'shipments'` и `'audit'`:

```ts
  const arrays: (keyof State)[] = ['customers', 'suppliers', 'employees', 'machines', 'operations', 'items', 'recipes', 'orders', 'purchases', 'movements', 'cash', 'reports', 'payroll', 'salaryPlans', 'expensePlans', 'loans', 'workerDeductions', 'shipments', 'tickets', 'audit'];
```

- [ ] **Step 5: Литерал State в тесте**

В `src/work-view.test.ts` в литерале `State` (строка 125) добавить `tickets: []` перед `audit: []`:

```ts
      salaryPlans: [], expensePlans: [], loans: [], routeTemplates: [], workerDeductions: [], shipments: [], tickets: [], audit: [],
```

- [ ] **Step 6: RED-тест миграции**

В конец `src/migrations.test.ts` добавить (импорты `describe`, `expect`, `it`, `emptyState`, `migrateState` уже есть):

```ts
describe('support tickets collection', () => {
  it('fills tickets for snapshots saved before the support center', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete source.tickets;
    const migrated = migrateState(source);
    expect(migrated.tickets).toEqual([]);
  });
});
```

- [ ] **Step 7: RED-тест синхронизации**

В конец `src/sync.test.ts` добавить:

```ts
describe('tickets snapshot contract', () => {
  it('keeps the cached snapshot when the server omits tickets', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.tickets).toEqual([]);
    f.strip('tickets');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without tickets', async () => {
    const f = setup(); f.online(true); f.strip('tickets');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

- [ ] **Step 8: Убедиться, что тесты падают**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`

Expected: FAIL — `migrated.tickets` равно `undefined`, `first.state.tickets` равно `undefined`, второй тест получает `queued === false`.

- [ ] **Step 9: GREEN и типы**

Тесты должны пройти после шагов 1-5 (код уже добавлен). Run:

`npx vitest run src/migrations.test.ts src/sync.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0. Если `tsc` найдёт ещё один полный литерал `State`, добавьте в него `tickets: []` рядом с `shipments`.

---

### Task 2: Модуль `src/support.ts`

**Files:**
- Create: `src/support.ts`
- Create: `src/support.test.ts`
- Modify: `src/diagnostics.ts:35` (`const redact` → `export const redact`)

**Interfaces:**
- Consumes: `Actor`, `SupportTicket`, `TicketContext`, `TicketMessage` из `./types`; `redact` из `./diagnostics`.
- Produces: `SeenMap`, `SeenStorage`, `PAGE_MAX`, `BUILD_MAX`, `PENDING_MAX`, `ERROR_MAX`, `ERRORS_MAX`, `normalizeTicketContext(value): TicketContext | null`, `buildTicketContext(input): TicketContext`, `visibleTickets`, `sortedTickets`, `lastMessage`, `hasUnread`, `needsReply`, `supportAlerts(tickets, actor, seen): number`, `seenStorageKey`, `readSeen`, `writeSeen` — используются Task 4, 7, 8.

- [ ] **Step 1: Экспортировать `redact`**

В `src/diagnostics.ts:35` заменить:

```ts
export const redact = (value: string) => value.replace(/\d{4,}/g, '[son]');
```

- [ ] **Step 2: Написать падающий тест**

Создать `src/support.test.ts` целиком:

```ts
import { describe, expect, it } from 'vitest';
import { DEMO_COMPANY_ID } from './migrations';
import {
  BUILD_MAX, ERROR_MAX, ERRORS_MAX, PAGE_MAX, PENDING_MAX, buildTicketContext, hasUnread, lastMessage,
  needsReply, normalizeTicketContext, readSeen, seenStorageKey, sortedTickets, supportAlerts, visibleTickets, writeSeen,
} from './support';
import type { Actor, SupportTicket, TicketRole, TicketStatus } from './types';

const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const worker: Actor = { id: 'worker-1', name: 'Kamol', role: 'worker', companyId: DEMO_COMPANY_ID };
const other: Actor = { id: 'worker-2', name: 'Aziz', role: 'worker', companyId: DEMO_COMPANY_ID };

function message(id: string, role: TicketRole, actorId: string, at: string) {
  return { id, authorId: actorId, authorName: actorId, authorRole: role, at, text: 'Xabar', context: null };
}

function ticket(id: string, authorId: string, lastRole: TicketRole, updatedAt: string, status: TicketStatus = 'open'): SupportTicket {
  return {
    id, authorId, authorName: authorId, authorRole: 'worker', status, createdAt: updatedAt, updatedAt,
    closedAt: status === 'closed' ? updatedAt : null, closedByName: status === 'closed' ? 'Egasi' : null,
    messages: [message(`${id}-m1`, 'worker', authorId, updatedAt), message(`${id}-m2`, lastRole, lastRole === 'admin' ? admin.id : authorId, updatedAt)],
  };
}

const valid = {
  page: 'orders', revision: 12, sync: 'offline' as const, pending: 2, build: 'dev-42', errors: ['Xato 1234'],
};

describe('ticket context', () => {
  it('accepts boundaries and returns a trimmed fresh object', () => {
    const input = {
      page: ' orders ', revision: 0, sync: 'offline' as const, pending: PENDING_MAX,
      build: ` ${'b'.repeat(BUILD_MAX - 2)} `, errors: Array.from({ length: ERRORS_MAX }, () => 'x'.repeat(ERROR_MAX)),
    };
    const context = normalizeTicketContext(input)!;
    expect(context).toEqual({
      page: 'orders', revision: 0, sync: 'offline', pending: PENDING_MAX,
      build: 'b'.repeat(BUILD_MAX - 2), errors: Array.from({ length: ERRORS_MAX }, () => 'x'.repeat(ERROR_MAX)),
    });
    expect(context).not.toBe(input);
  });

  it('accepts the maximum safe revision and an empty error string', () => {
    expect(normalizeTicketContext({ ...valid, revision: Number.MAX_SAFE_INTEGER, errors: [''] })).toMatchObject({
      revision: Number.MAX_SAFE_INTEGER, errors: [''],
    });
  });

  it('treats null and undefined as no context', () => {
    expect(normalizeTicketContext(null)).toBeNull();
    expect(normalizeTicketContext(undefined)).toBeNull();
  });

  it('rejects every malformed field with the contract error', () => {
    const cases: unknown[] = [
      { ...valid, page: '' },
      { ...valid, page: 'p'.repeat(PAGE_MAX + 1) },
      { ...valid, page: 5 },
      { ...valid, revision: -1 },
      { ...valid, revision: 1.5 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, revision: '5' },
      { ...valid, sync: 'later' },
      { ...valid, pending: -1 },
      { ...valid, pending: PENDING_MAX + 1 },
      { ...valid, pending: 1.5 },
      { ...valid, build: '' },
      { ...valid, build: 'b'.repeat(BUILD_MAX + 1) },
      { ...valid, errors: ['x'.repeat(ERROR_MAX + 1)] },
      { ...valid, errors: Array.from({ length: ERRORS_MAX + 1 }, () => 'x') },
      { ...valid, errors: [5] },
      { ...valid, errors: 'Xato' },
      { ...valid, errors: undefined },
      'strong',
      ['errors'],
      { ...valid, page: undefined },
      { page: 'orders', revision: 0, sync: 'offline', pending: 0, build: 'dev' },
    ];
    for (const value of cases) expect(() => normalizeTicketContext(value)).toThrow('Invalid ticket context');
  });

  it('masks diagnostics and clamps them to the last five, 300 characters each', () => {
    const context = buildTicketContext({
      page: '', revision: 3, online: false, pending: 4, build: 'dev',
      errors: ['1', '2', '3', '4', '5', 'Xato 1234', 'y'.repeat(400)],
    });
    expect(context.page).toBe('app');
    expect(context.sync).toBe('offline');
    expect(context.pending).toBe(4);
    expect(context.errors).toHaveLength(5);
    expect(context.errors[0]).toBe('3');
    expect(context.errors[3]).toBe('Xato [son]');
    expect(context.errors[4]).toBe('y'.repeat(ERROR_MAX));
  });

  it('marks the connection when online', () => {
    expect(buildTicketContext({ page: 'cash', revision: 1, online: true, pending: 0, build: 'dev', errors: [] }).sync).toBe('online');
  });
});

describe('ticket visibility and alerts', () => {
  const ownUnread = ticket('t-own-unread', worker.id, 'admin', '2026-11-12T10:00:00.000Z');
  const ownClosed = ticket('t-own-closed', worker.id, 'worker', '2026-11-12T09:00:00.000Z', 'closed');
  const foreign = ticket('t-foreign', other.id, 'worker', '2026-11-12T11:00:00.000Z');

  it('shows workers only their own tickets and the owner everything', () => {
    expect(visibleTickets([ownUnread, ownClosed, foreign], worker).map(row => row.id)).toEqual(['t-own-unread', 't-own-closed']);
    expect(visibleTickets([ownUnread, ownClosed, foreign], admin)).toHaveLength(3);
    expect(visibleTickets([ownUnread], { ...worker, role: 'display' })).toEqual([]);
  });

  it('sorts by the latest update, then id', () => {
    expect(sortedTickets([ownClosed, foreign, ownUnread]).map(row => row.id)).toEqual(['t-foreign', 't-own-unread', 't-own-closed']);
    const tieA = { ...ownUnread, id: 'a' };
    const tieB = { ...ownUnread, id: 'b' };
    expect(sortedTickets([tieB, tieA]).map(row => row.id)).toEqual(['a', 'b']);
  });

  it('reads the last message and unread state', () => {
    expect(lastMessage(ownUnread)?.id).toBe('t-own-unread-m2');
    expect(lastMessage({ ...ownUnread, messages: [] })).toBeNull();
    expect(hasUnread(ownUnread, worker, {})).toBe(true);
    expect(hasUnread(ownUnread, worker, { 't-own-unread': 't-own-unread-m2' })).toBe(false);
    expect(hasUnread(ownUnread, admin, {})).toBe(false);
    expect(hasUnread(ownClosed, worker, {})).toBe(false);
  });

  it('counts owner replies and worker messages needing an answer', () => {
    expect(needsReply(ownClosed)).toBe(false);
    expect(needsReply(foreign)).toBe(true);
    expect(needsReply(ownUnread)).toBe(false);
    expect(supportAlerts([ownUnread, ownClosed, foreign], worker, {})).toBe(1);
    expect(supportAlerts([ownUnread, ownClosed, foreign], worker, { 't-own-unread': 't-own-unread-m2' })).toBe(0);
    expect(supportAlerts([ownUnread, ownClosed, foreign], admin, {})).toBe(1);
    expect(supportAlerts([ownUnread], { ...worker, role: 'display' }, {})).toBe(0);
  });
});

describe('seen storage', () => {
  function storage(initial: string | null = null) {
    let value = initial;
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next; },
      value: () => value,
    };
  }

  it('builds a per-company, per-actor key', () => {
    expect(seenStorageKey(DEMO_COMPANY_ID, worker.id)).toBe(`aliya-erp-support-seen:${DEMO_COMPANY_ID}:${worker.id}`);
  });

  it('round-trips and survives broken JSON', () => {
    const store = storage();
    writeSeen(store, 'key', { 't-1': 'm-1' });
    expect(readSeen(store, 'key')).toEqual({ 't-1': 'm-1' });
    expect(readSeen(storage('{oops'), 'key')).toEqual({});
    expect(readSeen(storage('["t-1"]'), 'key')).toEqual({});
    expect(readSeen(storage('{"t-1":5,"t-2":"m-2"}'), 'key')).toEqual({ 't-2': 'm-2' });
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npx vitest run src/support.test.ts`

Expected: FAIL — модуль `./support` не найден.

- [ ] **Step 4: Реализовать `src/support.ts`**

Создать файл целиком:

```ts
import type { Actor, SupportTicket, TicketContext, TicketMessage } from './types';
import { redact } from './diagnostics';

export type SeenMap = Record<string, string>;
export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const PAGE_MAX = 40;
export const BUILD_MAX = 60;
export const PENDING_MAX = 999;
export const ERROR_MAX = 300;
export const ERRORS_MAX = 5;
const REVISION_MAX = Number.MAX_SAFE_INTEGER;

function invalid(): never {
  throw new Error('Invalid ticket context');
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (text.length < 1 || text.length > max) invalid();
  return text;
}

function errorText(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (text.length > ERROR_MAX) invalid();
  return text;
}

export function normalizeTicketContext(value: unknown): TicketContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const page = requiredText(row.page, PAGE_MAX);
  const revision = boundedInteger(row.revision, 0, REVISION_MAX);
  const sync = row.sync === 'online' ? 'online' : row.sync === 'offline' ? 'offline' : invalid();
  const pending = boundedInteger(row.pending, 0, PENDING_MAX);
  const build = requiredText(row.build, BUILD_MAX);
  if (!Array.isArray(row.errors) || row.errors.length > ERRORS_MAX) invalid();
  const errors = row.errors.map(errorText);
  return { page, revision, sync, pending, build, errors };
}

export function buildTicketContext(input: {
  page: string; revision: number; online: boolean; pending: number; build: string; errors: string[];
}): TicketContext {
  const errors = input.errors.slice(-ERRORS_MAX).map(error => redact(String(error ?? '').trim()).slice(0, ERROR_MAX));
  return normalizeTicketContext({
    page: String(input.page ?? '').trim() || 'app',
    revision: input.revision,
    sync: input.online ? 'online' : 'offline',
    pending: input.pending,
    build: input.build,
    errors,
  }) as TicketContext;
}

export function visibleTickets(tickets: SupportTicket[], actor: Actor): SupportTicket[] {
  if (actor.role === 'admin') return tickets;
  if (actor.role === 'worker') return tickets.filter(ticket => ticket.authorId === actor.id);
  return [];
}

export function sortedTickets(tickets: SupportTicket[]): SupportTicket[] {
  return [...tickets].sort((left, right) => left.updatedAt === right.updatedAt
    ? left.id.localeCompare(right.id)
    : right.updatedAt.localeCompare(left.updatedAt));
}

export function lastMessage(ticket: SupportTicket): TicketMessage | null {
  return ticket.messages[ticket.messages.length - 1] ?? null;
}

export function hasUnread(ticket: SupportTicket, actor: Actor, seen: SeenMap): boolean {
  if (actor.role !== 'worker') return false;
  const last = lastMessage(ticket);
  return !!last && last.authorRole === 'admin' && seen[ticket.id] !== last.id;
}

export function needsReply(ticket: SupportTicket): boolean {
  return ticket.status === 'open' && lastMessage(ticket)?.authorRole === 'worker';
}

export function supportAlerts(tickets: SupportTicket[], actor: Actor, seen: SeenMap): number {
  if (actor.role === 'worker') return tickets.filter(ticket => hasUnread(ticket, actor, seen)).length;
  if (actor.role === 'admin') return tickets.filter(needsReply).length;
  return 0;
}

export function seenStorageKey(companyId: string, actorId: string): string {
  return `aliya-erp-support-seen:${companyId}:${actorId}`;
}

export function readSeen(storage: Pick<SeenStorage, 'getItem'>, key: string): SeenMap {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

export function writeSeen(storage: Pick<SeenStorage, 'setItem'>, key: string, seen: SeenMap): void {
  try {
    storage.setItem(key, JSON.stringify(seen));
  } catch {
    return;
  }
}
```

- [ ] **Step 5: GREEN и типы**

Run: `npx vitest run src/support.test.ts`

Expected: PASS (все тесты, включая границы и маскирование).

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 3: `src/support-faq.ts`

**Files:**
- Create: `src/support-faq.ts`
- Test: `src/support-faq.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `SupportFaq`, `supportFaq: SupportFaq[]`, `searchFaq(query, items?)` — используется Task 7.

- [ ] **Step 1: Написать падающий тест**

Создать `src/support-faq.test.ts` целиком:

```ts
import { describe, expect, it } from 'vitest';
import { searchFaq, supportFaq } from './support-faq';

describe('support FAQ', () => {
  it('ships exactly eight non-empty questions in Latin Uzbek', () => {
    expect(supportFaq).toHaveLength(8);
    expect(new Set(supportFaq.map(item => item.id)).size).toBe(8);
    for (const item of supportFaq) {
      expect(item.question.trim()).not.toBe('');
      expect(item.answer.trim()).not.toBe('');
      expect(`${item.question} ${item.answer}`).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('keeps the approved question wording', () => {
    expect(supportFaq.map(item => item.question)).toEqual([
      'Qanday qilib yangi buyurtma yarataman?',
      'Sexda ishni qanday qabul qilaman?',
      'Materialni omborga qanday qabul qilaman?',
      'Kassaga to‘lovni qanday kiritaman?',
      'Xodimga tizimga kirish huquqini qanday beraman?',
      'Oylik va avans qanday hisoblanadi?',
      'Oflayn rejimda nima ishlaydi?',
      'Muammo bo‘lsa, kimga murojaat qilaman?',
    ]);
  });

  it('searches by case-insensitive substring of question and answer', () => {
    expect(searchFaq('BUYURTMA').map(item => item.id)).toEqual(['new-order']);
    expect(searchFaq('oflayn').map(item => item.id)).toEqual(['offline']);
    expect(searchFaq('  avans  ').map(item => item.id)).toEqual(['salary-advance']);
    expect(searchFaq('')).toBe(supportFaq);
    expect(searchFaq('   ')).toBe(supportFaq);
    expect(searchFaq('zzz')).toEqual([]);
  });

  it('accepts a custom list', () => {
    const items = [{ id: 'one', question: 'Savol', answer: 'Javob' }];
    expect(searchFaq('javob', items)).toEqual(items);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/support-faq.test.ts`

Expected: FAIL — модуль `./support-faq` не найден.

- [ ] **Step 3: Реализовать**

Создать `src/support-faq.ts` целиком:

```ts
export interface SupportFaq {
  id: string;
  question: string;
  answer: string;
}

export const supportFaq: SupportFaq[] = [
  {
    id: 'new-order',
    question: 'Qanday qilib yangi buyurtma yarataman?',
    answer: '«Savdo va CRM» bo‘limida «Buyurtma qabul qilish» tugmasini bosing, mijozni tanlang va pozitsiyani to‘ldiring. Saqlangandan so‘ng buyurtmani «Sexga ishga tushirish» orqali ishlab chiqarishga bering.',
  },
  {
    id: 'accept-work',
    question: 'Sexda ishni qanday qabul qilaman?',
    answer: '«Ishlab chiqarish» bo‘limida o‘z topshirig‘ingizni toping va «Topshiriqni qabul qilish» tugmasini bosing. Ish tugagach «Natijani topshirish» orqali miqdorni yuboring.',
  },
  {
    id: 'receive-material',
    question: 'Materialni omborga qanday qabul qilaman?',
    answer: '«Ta’minot» bo‘limida xaridni ochib «Qabul qilish» tugmasini bosing va kelgan miqdorni kiriting. Qoldiq va o‘rtacha tannarx avtomatik yangilanadi.',
  },
  {
    id: 'customer-payment',
    question: 'Kassaga to‘lovni qanday kiritaman?',
    answer: '«Moliya va kassa» bo‘limida «Kirim» tugmasini bosing, mijozni va hisobni tanlang. Saqlangach chek raqami avtomatik beriladi va qarz qoldig‘i kamayadi.',
  },
  {
    id: 'worker-access',
    question: 'Xodimga tizimga kirish huquqini qanday beraman?',
    answer: '«Sozlamalar» → «Kirish» bo‘limida «Yangi kirish» tugmasini bosing va xodimni tanlang. Email va parolni xodimning o‘ziga bering — huquqlar rol bo‘yicha cheklanadi.',
  },
  {
    id: 'salary-advance',
    question: 'Oylik va avans qanday hisoblanadi?',
    answer: '«Oylik va qarzlar» bo‘limida oylik reja va avanslar bir joyda ko‘rinadi. Avans to‘langanda qoldiq shu yerda kamayadi, yakuniy oylik reja asosida hisoblanadi.',
  },
  {
    id: 'offline',
    question: 'Oflayn rejimda nima ishlaydi?',
    answer: 'Oflayn rejimda amallar «Oflayn navbat» ga saqlanadi va internet qaytgach yuboriladi. Kesh 24 soatgacha amal qiladi; shundan keyin yangilash uchun internetga ulaning.',
  },
  {
    id: 'support-contact',
    question: 'Muammo bo‘lsa, kimga murojaat qilaman?',
    answer: '«Yordamchi» → «Murojaat» bo‘limida «Yangi murojaat» tugmasini bosing va muammoni yozing. Diagnostika ma’lumoti avtomatik qo‘shiladi, javobni shu yerda ko‘rasiz.',
  },
];

export function searchFaq(query: string, items: SupportFaq[] = supportFaq): SupportFaq[] {
  const needle = query.toLocaleLowerCase('uz').trim();
  if (!needle) return items;
  return items.filter(item => `${item.question} ${item.answer}`.toLocaleLowerCase('uz').includes(needle));
}
```

- [ ] **Step 4: GREEN и типы**

Run: `npx vitest run src/support-faq.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 4: Команды домена, i18n и три whitelist

**Files:**
- Modify: `src/types.ts:147-205` (`Command`)
- Modify: `src/domain.ts` (импорты, helper, `mutate`, whitelist :1585)
- Modify: `src/sync.ts:77`
- Modify: `src/i18n.ts:189-190`
- Test: `src/domain.test.ts` (в конец файла)
- Test: `src/sync.test.ts` (`worker()` :47-53 + новый тест)
- Test: `src/i18n.test.ts` (в конец файла)

**Interfaces:**
- Consumes: `SupportTicket`, `TicketContext` из Task 1; `normalizeTicketContext` из Task 2.
- Produces: команды `ticket.create {text, context: TicketContext | null}`, `ticket.reply {ticketId, text}`, `ticket.close {ticketId}` — используются Task 7 и 8.

- [ ] **Step 1: Расширить `Command`**

В `src/types.ts` заменить последнюю строку union (205):

```ts
  | { type: 'shipment.deliver'; shipmentId: string }
  | { type: 'ticket.create'; text: string; context: TicketContext | null }
  | { type: 'ticket.reply'; ticketId: string; text: string }
  | { type: 'ticket.close'; ticketId: string };
```

- [ ] **Step 2: RED-тесты домена**

В конец `src/domain.test.ts` добавить (хелперы `run`, `atomic`, `fixture`, `admin` уже есть; добавить `import type { SupportTicket } from './types'` к существующему type-импорту):

```ts
describe('support tickets', () => {
  const context = { page: 'orders', revision: 0, sync: 'offline' as const, pending: 2, build: 'test', errors: ['Xato 1234'] };

  it('creates a ticket authored by the actor with context only on the first message', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: '  Ombor xatosi  ', context }, worker);
    const row = created.tickets[0];
    expect(created.audit.at(-1)).toMatchObject({ action: 'ticket.create', entityId: row.id, actorId: worker.id });
    expect(row).toMatchObject({
      authorId: worker.id, authorName: worker.name, authorRole: 'worker',
      status: 'open', closedAt: null, closedByName: null,
    });
    expect(row.messages).toHaveLength(1);
    expect(row.messages[0]).toMatchObject({ authorId: worker.id, text: 'Ombor xatosi', context });
    expect(row.messages[0].context).not.toBe(context);
    expect(row.createdAt).toBe(row.updatedAt);
    expect(row.messages[0].at).toBe(row.createdAt);

    const replied = run(created, { type: 'ticket.reply', ticketId: row.id, text: 'Javob' }, admin);
    expect(replied.tickets[0].messages[1]).toMatchObject({ authorRole: 'admin', text: 'Javob', context: null });
    expect(replied.audit.at(-1)).toMatchObject({ action: 'ticket.reply', entityId: row.id });
  });

  it('accepts an owner-created ticket without context', () => {
    const { state } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Eslatma', context: null });
    expect(created.tickets[0]).toMatchObject({ authorRole: 'admin', authorId: admin.id });
    expect(created.tickets[0].messages[0].context).toBeNull();
  });

  it('rejects empty, long and malformed input without mutating state', () => {
    const { state, worker } = fixture();
    atomic(state, { type: 'ticket.create', text: '   ', context: null }, worker);
    expect(() => run(state, { type: 'ticket.create', text: 'x'.repeat(2001), context: null }, worker)).toThrow('Ticket text is too long');
    expect(() => run(state, { type: 'ticket.create', text: 'x', context: { ...context, pending: 1000 } }, worker)).toThrow('Invalid ticket context');
    expect(() => run(state, { type: 'ticket.reply', ticketId: 'missing', text: 'x' }, worker)).toThrow('Ticket not found');
  });

  it('lets a worker reply only to their own ticket and never close it', () => {
    const { state, worker, otherWorker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const id = created.tickets[0].id;
    const replied = run(created, { type: 'ticket.reply', ticketId: id, text: 'Qo‘shimcha' }, worker);
    expect(replied.tickets[0].messages).toHaveLength(2);
    expect(() => run(created, { type: 'ticket.reply', ticketId: id, text: 'Begona' }, otherWorker)).toThrow('Ticket not found');
    expect(() => run(created, { type: 'ticket.close', ticketId: id }, worker)).toThrow('Administrator action required');
  });

  it('closes once, keeps updatedAt, and reopens on a reply', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const id = created.tickets[0].id;
    const closed = run(created, { type: 'ticket.close', ticketId: id }, admin);
    expect(closed.tickets[0]).toMatchObject({ status: 'closed', closedByName: admin.name });
    expect(closed.tickets[0].closedAt).toBeTruthy();
    expect(closed.tickets[0].updatedAt).toBe(created.tickets[0].updatedAt);
    expect(closed.audit.at(-1)).toMatchObject({ action: 'ticket.close', entityId: id });

    const again = run(closed, { type: 'ticket.close', ticketId: id }, admin);
    expect(again.tickets[0].updatedAt).toBe(created.tickets[0].updatedAt);
    expect(again.tickets[0].closedAt).toBe(closed.tickets[0].closedAt);

    const reopened = run(closed, { type: 'ticket.reply', ticketId: id, text: 'Yana savol' }, worker);
    expect(reopened.tickets[0]).toMatchObject({ status: 'open', closedAt: null, closedByName: null });
    expect(reopened.tickets[0].updatedAt).toBe(reopened.tickets[0].messages.at(-1)!.at);
  });

  it('rejects the 201st message', () => {
    const { state, worker } = fixture();
    const created = run(state, { type: 'ticket.create', text: 'Savol', context: null }, worker);
    const full = structuredClone(created);
    const row = full.tickets[0];
    const at = row.createdAt;
    row.messages = Array.from({ length: 200 }, (_, index): SupportTicket['messages'][number] => ({
      id: `m-${index}`, authorId: worker.id, authorName: worker.name, authorRole: 'worker', at, text: 'x', context: null,
    }));
    expect(() => run(full, { type: 'ticket.reply', ticketId: row.id, text: 'y' }, worker)).toThrow('Ticket is full');
  });

  it('rejects display accounts', () => {
    const { state } = fixture();
    const display: Actor = { id: 'tv', name: 'TV', role: 'display', companyId: state.companyId };
    expect(() => run(state, { type: 'ticket.create', text: 'x', context: null }, display)).toThrow('Invalid actor role');
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npx vitest run src/domain.test.ts`

Expected: FAIL — `Unknown command` / нет `state.tickets`.

- [ ] **Step 4: Реализовать домен**

В `src/domain.ts`:

1. В `import type {...} from './types'` добавить `SupportTicket`; добавить импорт `import { normalizeTicketContext } from './support';`.
2. Перед `function mutate` (строка 781) добавить helper:

```ts
function ticketText(value: unknown): string {
  check(typeof value === 'string', 'Ticket text is required');
  const body = value.trim();
  check(body.length > 0, 'Ticket text is required');
  check(body.length <= 2000, 'Ticket text is too long');
  return body;
}
```

3. В `mutate`, после ветки `shipment.deliver` (перед `default:` на строке 1575), добавить:

```ts
    case 'ticket.create': {
      const body = ticketText(command.text);
      const context = normalizeTicketContext(command.context);
      const at = now();
      const role = actor.role === 'admin' ? 'admin' : 'worker';
      const row: SupportTicket = {
        id: uuid(), authorId: actor.id, authorName: actor.name, authorRole: role,
        status: 'open', createdAt: at, updatedAt: at, closedAt: null, closedByName: null,
        messages: [{ id: uuid(), authorId: actor.id, authorName: actor.name, authorRole: role, at, text: body, context }],
      };
      state.tickets.push(row);
      return row.id;
    }
    case 'ticket.reply': {
      const row = state.tickets.find(ticket => ticket.id === command.ticketId
        && (actor.role === 'admin' || ticket.authorId === actor.id));
      check(row, 'Ticket not found');
      const body = ticketText(command.text);
      check(row.messages.length < 200, 'Ticket is full');
      const at = now();
      row.messages.push({
        id: uuid(), authorId: actor.id, authorName: actor.name,
        authorRole: actor.role === 'admin' ? 'admin' : 'worker', at, text: body, context: null,
      });
      row.status = 'open';
      row.closedAt = null;
      row.closedByName = null;
      row.updatedAt = at;
      return row.id;
    }
    case 'ticket.close': {
      check(actor.role === 'admin', 'Administrator action required');
      const row = state.tickets.find(ticket => ticket.id === command.ticketId);
      check(row, 'Ticket not found');
      if (row.status === 'open') {
        row.status = 'closed';
        row.closedAt = now();
        row.closedByName = actor.name;
      }
      return row.id;
    }
```

4. В `applyCommand` (строка 1585) расширить whitelist:

```ts
  check(actor.role === 'admin' || ['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply'].includes(envelope.command.type), 'Administrator action required');
```

- [ ] **Step 5: Третий whitelist в `src/sync.ts`**

Строку 77 заменить на:

```ts
      if (actor.role === 'worker' && !['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply'].includes(next.type)) {
```

- [ ] **Step 6: Тексты i18n**

В `src/i18n.ts` между строками 189 и 190 вставить:

```ts
  [/ticket text is required/i, 'Murojaat matnini kiriting.'],
  [/ticket text is too long/i, 'Murojaat matni 2000 belgidan oshmasligi kerak.'],
  [/ticket not found/i, 'Murojaat topilmadi. Sahifani yangilang va qayta urinib ko‘ring.'],
  [/ticket is full/i, 'Bu murojaatga boshqa xabar qo‘shilmaydi: 200 ta xabar chegarasiga yetdi. Yangi murojaat oching.'],
  [/invalid ticket context/i, 'Diagnostika ma’lumoti noto‘g‘ri. Sahifani yangilang va qayta yuboring.'],
```

- [ ] **Step 7: Тест i18n**

В конец `src/i18n.test.ts` добавить:

```ts
describe('support error translations', () => {
  it('maps every ticket contract error to Uzbek', () => {
    expect(translateError('Ticket text is required')).toBe('Murojaat matnini kiriting.');
    expect(translateError('Ticket text is too long')).toBe('Murojaat matni 2000 belgidan oshmasligi kerak.');
    expect(translateError('Ticket not found')).toBe('Murojaat topilmadi. Sahifani yangilang va qayta urinib ko‘ring.');
    expect(translateError('Ticket is full')).toBe('Bu murojaatga boshqa xabar qo‘shilmaydi: 200 ta xabar chegarasiga yetdi. Yangi murojaat oching.');
    expect(translateError('Invalid ticket context')).toBe('Diagnostika ma’lumoti noto‘g‘ri. Sahifani yangilang va qayta yuboring.');
  });
});
```

- [ ] **Step 8: Тест офлайн-whitelist**

В `src/sync.test.ts` в фабрику `worker()` (перед `persisted.snapshot = ...`, строка 52) добавить тикет:

```ts
      state.tickets.push({
        id: 'ticket', authorId: 'worker', authorName: 'Работник', authorRole: 'worker', status: 'open',
        createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T08:00:00.000Z', closedAt: null, closedByName: null,
        messages: [{
          id: 'ticket-message', authorId: 'worker', authorName: 'Работник', authorRole: 'worker',
          at: '2026-11-12T08:00:00.000Z', text: 'Savol', context: null,
        }],
      });
```

После describe `tickets snapshot contract` из Task 1 добавить:

```ts
describe('worker ticket permissions', () => {
  it('allows a reply to the own ticket but rejects closing', async () => {
    const f = setup(); f.worker(); f.online(false);
    const snapshot = await f.engine().snapshot();
    await expect(f.engine().submit(snapshot.state, { type: 'ticket.close', ticketId: 'ticket' }, snapshot.actor))
      .rejects.toThrow('Faqat sizning');
    const queued = await f.engine().submit(snapshot.state, { type: 'ticket.reply', ticketId: 'ticket', text: 'Qo‘shimcha' }, snapshot.actor);
    expect(queued.queued).toBe(true);
  });
});
```

- [ ] **Step 9: GREEN и типы**

Run: `npx vitest run src/domain.test.ts src/i18n.test.ts src/sync.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 5: Канонический SQL и контрактный тест

**Files:**
- Modify: `supabase/schema.sql` (таблица, RLS-цикл, снимок, helper, `erp_execute`, REVOKE)
- Test: `src/ticketContract.test.ts`

**Interfaces:**
- Consumes: тексты ошибок и семантика Task 4.
- Produces: канонические DDL/функции для Task 6 (генератор миграции и PGlite-зонд).

- [ ] **Step 1: Написать падающий контрактный тест**

Создать `src/ticketContract.test.ts` целиком:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

describe('support tickets SQL contract', () => {
  it('ships one tenant-scoped collection with a read policy', () => {
    expect(schema).toContain('CREATE TABLE public.erp_support_tickets');
    expect(schema).toContain("CHECK (author_role IN ('admin', 'worker'))");
    expect(schema).toContain("CHECK (status IN ('open', 'closed'))");
    expect(schema).toContain("'erp_shipment_lines', 'erp_support_tickets', 'erp_audit'");
  });

  it('snapshots tickets for the author and the owner only', () => {
    expect(schema).toContain("'tickets', (SELECT");
    expect(schema).toContain('FROM public.erp_support_tickets t WHERE t.company_id = v_company AND (v_admin OR t.author_id = v_profile.employee_id)');
    expect(schema).toContain('ORDER BY t.updated_at, t.id');
  });

  it('lets workers create and reply but not close', () => {
    expect(schema).toContain("IF v_actor.role = 'worker' AND v_type NOT IN ('work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply') THEN");
    expect(schema).toContain("WHEN 'ticket.close' THEN");
    expect(schema).toContain("IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator action required'");
  });

  it('raises byte-identical domain errors', () => {
    expect(schema).toContain("RAISE EXCEPTION 'Ticket text is required'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket text is too long'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket not found'");
    expect(schema).toContain("RAISE EXCEPTION 'Ticket is full'");
    expect(schema).toContain("RAISE EXCEPTION 'Invalid ticket context'");
  });

  it('validates context through an immutable helper', () => {
    expect(schema).toContain('CREATE FUNCTION public.erp_ticket_context(p_value jsonb)');
    expect(schema).toContain("jsonb_typeof(p_value -> 'revision') IS DISTINCT FROM 'number'");
    expect(schema).toContain('public.erp_ticket_context(jsonb)');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/ticketContract.test.ts`

Expected: FAIL — строк в схеме ещё нет.

- [ ] **Step 3: Таблица**

В `supabase/schema.sql` после индексов `erp_route_templates` (строка 363) и перед `CREATE TABLE public.erp_worker_deductions` вставить:

```sql
CREATE TABLE public.erp_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('admin', 'worker')),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  UNIQUE (company_id, id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK ((status = 'closed') = (closed_by_name IS NOT NULL))
);
CREATE INDEX erp_support_tickets_company_idx ON public.erp_support_tickets(company_id);
CREATE INDEX erp_support_tickets_author_idx ON public.erp_support_tickets(company_id, author_id);
```

- [ ] **Step 4: RLS-цикл**

Строку 602 заменить на (добавлен `'erp_support_tickets'` перед `'erp_audit'`):

```sql
    'erp_work_reports', 'erp_payroll', 'erp_salary_plans', 'erp_expense_plans', 'erp_loans', 'erp_route_templates', 'erp_worker_deductions', 'erp_shipments', 'erp_shipment_lines', 'erp_support_tickets', 'erp_audit'
```

- [ ] **Step 5: Снимок**

После блока `routeTemplates` (строки 1587-1589) и перед `workerDeductions` (1590) вставить:

```sql
      'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'authorId', t.author_id, 'authorName', t.author_name,
        'authorRole', t.author_role, 'status', t.status, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'closedAt', t.closed_at, 'closedByName', t.closed_by_name, 'messages', t.messages) ORDER BY t.updated_at, t.id), '[]'::jsonb)
        FROM public.erp_support_tickets t WHERE t.company_id = v_company AND (v_admin OR t.author_id = v_profile.employee_id)),
```

- [ ] **Step 6: Helper `erp_ticket_context`**

После `erp_unit` (строка 570, перед `CREATE FUNCTION public.erp_current_profile`) вставить:

```sql
CREATE FUNCTION public.erp_ticket_context(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_page text;
  v_revision numeric;
  v_sync text;
  v_pending numeric;
  v_build text;
  v_error jsonb;
  v_text text;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'object' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'page') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_page := btrim(p_value ->> 'page');
  IF v_page = '' OR length(v_page) > 40 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_revision := (p_value ->> 'revision')::numeric;
  IF v_revision <> trunc(v_revision) OR v_revision < 0 OR v_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'sync') IS DISTINCT FROM 'string' OR (p_value ->> 'sync') NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_sync := p_value ->> 'sync';
  IF jsonb_typeof(p_value -> 'pending') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_pending := (p_value ->> 'pending')::numeric;
  IF v_pending <> trunc(v_pending) OR v_pending < 0 OR v_pending > 999 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_value -> 'build') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  v_build := btrim(p_value ->> 'build');
  IF v_build = '' OR length(v_build) > 60 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_value -> 'errors') IS DISTINCT FROM 'array' OR jsonb_array_length(p_value -> 'errors') > 5 THEN
    RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
  END IF;
  FOR v_error IN SELECT value FROM jsonb_array_elements(p_value -> 'errors') LOOP
    IF jsonb_typeof(v_error) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023';
    END IF;
    v_text := btrim(v_error #>> '{}');
    IF length(v_text) > 300 THEN RAISE EXCEPTION 'Invalid ticket context' USING ERRCODE = '22023'; END IF;
    v_result := v_result || jsonb_build_array(v_text);
  END LOOP;
  RETURN jsonb_build_object('page', v_page, 'revision', v_revision, 'sync', v_sync,
    'pending', v_pending, 'build', v_build, 'errors', v_result);
END;
$$;
```

- [ ] **Step 7: `erp_execute` — DECLARE и whitelist**

В `DECLARE` после `v_employee_id uuid;` (строка 1773) добавить:

```sql
  v_ticket public.erp_support_tickets%ROWTYPE;
  v_context jsonb;
  v_author uuid;
  v_text text;
```

Строку 1792 заменить на:

```sql
  IF v_actor.role = 'worker' AND v_type NOT IN ('work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply') THEN
```

- [ ] **Step 8: `erp_execute` — три ветки**

После `routeTemplate.update` (строка 2713) и перед `WHEN 'customer.link' THEN` (2714) вставить:

```sql
    WHEN 'ticket.create' THEN
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      v_context := public.erp_ticket_context(p_command -> 'context');
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_support_tickets(company_id, id, author_id, author_name, author_role, status, messages)
        VALUES (v_company, v_entity, v_author, v_actor.name, CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END, 'open',
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author, 'authorName', v_actor.name,
            'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
            'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'text', v_text, 'context', v_context)));
    WHEN 'ticket.reply' THEN
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets
        WHERE company_id = v_company AND id = v_entity
          AND (v_actor.role = 'admin' OR author_id = v_actor.employee_id)
        FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      IF jsonb_array_length(v_ticket.messages) >= 200 THEN RAISE EXCEPTION 'Ticket is full' USING ERRCODE = '22023'; END IF;
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      UPDATE public.erp_support_tickets
        SET messages = messages || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author,
              'authorName', v_actor.name, 'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
              'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'text', v_text, 'context', NULL)),
            status = 'open', closed_at = NULL, closed_by_name = NULL, updated_at = transaction_timestamp()
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'ticket.close' THEN
      IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      IF v_ticket.status = 'open' THEN
        UPDATE public.erp_support_tickets SET status = 'closed', closed_at = transaction_timestamp(), closed_by_name = v_actor.name
          WHERE company_id = v_company AND id = v_entity;
      END IF;
```

- [ ] **Step 9: REVOKE**

В список REVOKE (строка 2971, рядом с `public.erp_unit(jsonb)`) добавить `public.erp_ticket_context(jsonb)`:

```sql
  public.erp_bool(jsonb, text), public.erp_account(jsonb), public.erp_date(jsonb), public.erp_array(jsonb, text, boolean), public.erp_unit(jsonb), public.erp_ticket_context(jsonb),
```

Функцию **не** добавлять в GRANT.

- [ ] **Step 10: GREEN и типы**

Run: `npx vitest run src/ticketContract.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 6: Генератор миграции и PGlite-зонд

**Files:**
- Create: `.validation-pglite-20261029/generate-support-tickets-migration.mjs`
- Create: `supabase/migrations/20261112_support_tickets.sql` (генерируется)
- Create: `.validation-pglite-20261029/validate-support-tickets.mjs`

**Interfaces:**
- Consumes: `schema.sql` из Task 5.
- Produces: идемпотентную миграцию для владельца (живое применение — только по отдельному разрешению).

- [ ] **Step 1: Генератор**

Создать `.validation-pglite-20261029/generate-support-tickets-migration.mjs` целиком:

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261112_support_tickets.sql', root);

const names = ['erp_ticket_context', 'erp_snapshot', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}
require('CREATE TABLE public.erp_support_tickets', 'erp_support_tickets table');
require("'tickets', (SELECT", 'snapshot tickets');
require("WHEN 'ticket.create' THEN", 'execute ticket.create');
require("WHEN 'ticket.reply' THEN", 'execute ticket.reply');
require("WHEN 'ticket.close' THEN", 'execute ticket.close');
require("public.erp_ticket_context(p_command -> 'context')", 'execute context validation');
require('t.author_id = v_profile.employee_id', 'ticket snapshot visibility');

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

const ddl = `-- Aliya ERP: support center — one ticket collection with worker <-> owner threads.
-- Safe to run more than once. Existing data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('admin', 'worker')),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  UNIQUE (company_id, id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK ((status = 'closed') = (closed_by_name IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS erp_support_tickets_company_idx ON public.erp_support_tickets(company_id);
CREATE INDEX IF NOT EXISTS erp_support_tickets_author_idx ON public.erp_support_tickets(company_id, author_id);
ALTER TABLE public.erp_support_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_support_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_support_tickets TO authenticated;
DROP POLICY IF EXISTS erp_admin_read ON public.erp_support_tickets;
CREATE POLICY erp_admin_read ON public.erp_support_tickets FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_ticket_context(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.erp_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_snapshot() TO authenticated;
REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;

COMMIT;
`;

const sql = ddl + names.map(definition).join('\n') + '\n' + grants;
await fs.writeFile(outputPath, sql);
console.log(JSON.stringify({ functions: names.length, sha256: crypto.createHash('sha256').update(sql).digest('hex') }));
```

- [ ] **Step 2: Сгенерировать миграцию дважды**

Run: `node .validation-pglite-20261029/generate-support-tickets-migration.mjs`

Expected: JSON с `{"functions":3,"sha256":"..."}`; файл `supabase/migrations/20261112_support_tickets.sql` создан.

Run ту же команду ещё раз.

Expected: тот же `sha256` — генерация детерминирована.

- [ ] **Step 3: PGlite-зонд**

Создать `.validation-pglite-20261029/validate-support-tickets.mjs` целиком:

```js
// Support center probe: one ticket collection, worker/owner visibility, reply/close semantics,
// context validation parity, the 200-message ceiling, and tenant isolation.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261112_support_tickets.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

const db = new PGlite();
const adminId = crypto.randomUUID();
const kamolId = crypto.randomUUID();
const azizId = crypto.randomUUID();
const otherAdminId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
for (const [id, name] of [[adminId, 'Owner'], [kamolId, 'Kamol'], [azizId, 'Aziz'], [otherAdminId, 'Other']]) {
  await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)',
    [id, `${name.toLowerCase()}@local.invalid`, JSON.stringify({ name })]);
}

await db.exec(schema);
await db.exec(migration);
await db.exec(migration);
pass('support-tickets migration applies twice on top of the canonical schema (idempotent)');

async function as(userId = adminId) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec('SET ROLE authenticated');
}
async function owner(query, params = []) {
  await db.exec('RESET ROLE');
  return (await db.query(query, params)).rows;
}
async function one(query, params = []) {
  return (await owner(query, params))[0];
}
async function snapshot(userId) {
  await as(userId);
  const rows = (await db.query('SELECT public.erp_snapshot() AS result')).rows;
  await db.exec('RESET ROLE');
  return rows[0].result;
}
async function executeAs(userId, command) {
  const revision = Number((await one(`SELECT m.revision FROM public.erp_metadata m
    JOIN public.erp_profiles p ON p.company_id = m.company_id WHERE p.id = $1`, [userId])).revision);
  await as(userId);
  const result = (await db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb) AS result',
    [crypto.randomUUID(), revision, JSON.stringify(command)])).rows[0].result;
  await db.exec('RESET ROLE');
  return result;
}
const execute = (command) => executeAs(adminId, command);
async function rejects(userId, command, label) {
  let threw = false;
  try { await executeAs(userId, command); } catch { threw = true; }
  assert.ok(threw, label);
}

await as(adminId);
const companyId = (await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Support'])).rows[0].id;
await db.exec('RESET ROLE');

await execute({ type: 'employee.create', name: 'Kamol' });
await execute({ type: 'employee.create', name: 'Aziz' });
const staff = (await snapshot(adminId)).state.employees;
const kamolEmployeeId = staff.find(row => row.name === 'Kamol').id;
const azizEmployeeId = staff.find(row => row.name === 'Aziz').id;
await as(adminId);
await db.query('SELECT public.erp_link_worker($1,$2)', [kamolId, kamolEmployeeId]);
await db.query('SELECT public.erp_link_worker($1,$2)', [azizId, azizEmployeeId]);
await db.exec('RESET ROLE');
pass('two workers linked to their employee rows');

const context = { page: ' orders ', revision: 0, sync: 'offline', pending: 2, build: 'probe', errors: ['Xato 1234', ''] };
await executeAs(kamolId, { type: 'ticket.create', text: '  Ombor xatosi  ', context });
const created = (await snapshot(adminId)).state.tickets;
assert.equal(created.length, 1);
assert.equal(created[0].authorId, kamolEmployeeId);
assert.equal(created[0].authorName, 'Kamol');
assert.equal(created[0].authorRole, 'worker');
assert.equal(created[0].status, 'open');
assert.equal(created[0].messages.length, 1);
assert.equal(created[0].messages[0].text, 'Ombor xatosi');
assert.deepEqual(created[0].messages[0].context, {
  page: 'orders', revision: 0, sync: 'offline', pending: 2, build: 'probe', errors: ['Xato 1234', ''],
});
pass('worker ticket round-trips through the snapshot with a normalized context');

const ticketId = created[0].id;
assert.deepEqual((await snapshot(kamolId)).state.tickets.map(row => row.id), [ticketId]);
assert.deepEqual((await snapshot(azizId)).state.tickets, []);
pass('worker sees only their own tickets');

await execute({ type: 'ticket.reply', ticketId, text: 'Javob' });
const answered = (await snapshot(kamolId)).state.tickets[0];
assert.equal(answered.messages.length, 2);
assert.equal(answered.messages[1].authorRole, 'admin');
assert.equal(answered.messages[1].context, null);
pass('owner reply appends without a context');

await rejects(azizId, { type: 'ticket.reply', ticketId, text: 'Begona' }, 'foreign reply rejected');
await rejects(kamolId, { type: 'ticket.close', ticketId }, 'worker close rejected');
pass('workers cannot reach foreign tickets or close their own');

await execute({ type: 'ticket.close', ticketId });
let closed = (await snapshot(adminId)).state.tickets[0];
assert.equal(closed.status, 'closed');
assert.equal(closed.closedByName, 'Owner');
assert.ok(closed.closedAt);
const closedAt = closed.closedAt;
await execute({ type: 'ticket.close', ticketId });
closed = (await snapshot(adminId)).state.tickets[0];
assert.equal(closed.closedAt, closedAt);
pass('close is admin-only and idempotent');

await executeAs(kamolId, { type: 'ticket.reply', ticketId, text: 'Yana savol' });
const reopened = (await snapshot(adminId)).state.tickets[0];
assert.equal(reopened.status, 'open');
assert.equal(reopened.closedAt, null);
assert.equal(reopened.closedByName, null);
pass('worker reply reopens a closed ticket');

await rejects(kamolId, { type: 'ticket.create', text: '   ', context: null }, 'empty text rejected');
await rejects(kamolId, { type: 'ticket.create', text: 'x'.repeat(2001), context: null }, 'long text rejected');
await rejects(kamolId, { type: 'ticket.create', text: 'x', context: { ...context, page: 'p'.repeat(41) } }, 'page limit');
await rejects(kamolId, { type: 'ticket.create', text: 'x', context: { ...context, pending: 1000 } }, 'pending limit');
await rejects(kamolId, { type: 'ticket.create', text: 'x', context: { ...context, errors: ['a', 'b', 'c', 'd', 'e', 'f'] } }, 'errors limit');
await rejects(kamolId, { type: 'ticket.create', text: 'x', context: { ...context, revision: 1.5 } }, 'revision integer');
pass('erp_execute rejects invalid text and contexts like the domain');

await executeAs(kamolId, { type: 'ticket.create', text: 'Kontekstsiz', context: null });
const noContext = (await snapshot(kamolId)).state.tickets.find(row => row.messages[0].text === 'Kontekstsiz');
assert.equal(noContext.messages[0].context, null);
pass('context:null is accepted');

await execute({ type: 'ticket.create', text: 'Egasidan', context: null });
assert.deepEqual((await snapshot(kamolId)).state.tickets.filter(row => row.messages[0].text === 'Egasidan'), []);
pass('owner-created tickets stay invisible to workers');

const fullId = crypto.randomUUID();
await owner(`INSERT INTO public.erp_support_tickets(company_id, id, author_id, author_name, author_role, status, messages)
  VALUES ($1, $2, $3, 'Kamol', 'worker', 'open', (SELECT jsonb_agg(jsonb_build_object(
    'id', gen_random_uuid(), 'authorId', $3::uuid, 'authorName', 'Kamol', 'authorRole', 'worker',
    'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'text', 'x', 'context', NULL)) FROM generate_series(1, 200)))`, [companyId, fullId, kamolEmployeeId]);
await rejects(kamolId, { type: 'ticket.reply', ticketId: fullId, text: 'y' }, '201st message rejected');
pass('the 200-message ceiling is enforced in SQL');

await as(otherAdminId);
const secondCompanyId = (await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Second'])).rows[0].id;
await db.exec('RESET ROLE');
assert.notEqual(secondCompanyId, companyId);
assert.deepEqual((await snapshot(otherAdminId)).state.tickets, []);
pass('tenant isolation: a fresh company snapshot has no tickets');

console.log(`\n${passes} checks passed`);
```

- [ ] **Step 4: Прогнать зонд**

Run: `node .validation-pglite-20261029/validate-support-tickets.mjs`

Expected: все `PASS`, последняя строка `12 checks passed` (количество может быть больше, если добавите проверки; главное — нет `AssertionError`).

- [ ] **Step 5: Контракт и типы**

Run: `npx vitest run src/ticketContract.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 7: Компонент `Support.tsx`, третья вкладка, CSS, SSR-тесты

**Files:**
- Create: `src/components/Support.tsx`
- Modify: `src/components/Guide.tsx`
- Modify: `src/styles.css:437-438`
- Test: `src/support-ui.test.tsx`

**Interfaces:**
- Consumes: `SupportProps` (ниже), `visibleTickets`, `sortedTickets`, `lastMessage`, `hasUnread`, `needsReply`, `supportAlerts`, `buildTicketContext` из Task 2; `supportFaq`, `searchFaq` из Task 3; команды из Task 4; `Empty`, `dateTime` из `../ui`.
- Produces: `SupportProps` (с `revision`), `SupportPanel`, `SupportList`, `SupportThread`, `SupportNew`, `SupportQuestions`; `GuidePanel` принимает `support?: SupportProps`; `GuideFab` принимает `alert?: boolean` — используется Task 8.

- [ ] **Step 1: Написать падающий SSR-тест**

Создать `src/support-ui.test.tsx` целиком:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuideFab, GuidePanel } from './components/Guide';
import { SupportList, SupportPanel, SupportQuestions, SupportThread, type SupportProps } from './components/Support';
import type { PageGuide } from './guide';
import { DEMO_COMPANY_ID } from './migrations';
import { supportFaq } from './support-faq';
import type { Actor, Command, SupportTicket } from './types';

const worker: Actor = { id: 'worker-1', name: 'Kamol', role: 'worker', companyId: DEMO_COMPANY_ID };
const admin: Actor = { id: 'owner', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
const display: Actor = { id: 'tv', name: 'TV', role: 'display', companyId: DEMO_COMPANY_ID };

function ticket(id: string, authorId: string, lastRole: 'worker' | 'admin', status: 'open' | 'closed' = 'open', text = 'Savol'): SupportTicket {
  return {
    id, authorId, authorName: authorId === worker.id ? worker.name : 'Xodim', authorRole: 'worker', status,
    createdAt: '2026-11-12T08:00:00.000Z', updatedAt: '2026-11-12T09:00:00.000Z',
    closedAt: status === 'closed' ? '2026-11-12T09:30:00.000Z' : null,
    closedByName: status === 'closed' ? admin.name : null,
    messages: [
      { id: `${id}-m1`, authorId, authorName: 'Xodim', authorRole: 'worker', at: '2026-11-12T08:00:00.000Z', text, context: { page: 'orders', revision: 4, sync: 'offline', pending: 2, build: 'dev', errors: ['Xato [son]'] } },
      { id: `${id}-m2`, authorId: lastRole === 'admin' ? admin.id : authorId, authorName: lastRole === 'admin' ? admin.name : 'Xodim', authorRole: lastRole, at: '2026-11-12T09:00:00.000Z', text: 'Javob', context: null },
    ],
  };
}

const ownUnread = ticket('t-own', worker.id, 'admin');
const foreign = ticket('t-foreign', 'worker-2', 'worker');
const closed = ticket('t-closed', worker.id, 'worker', 'closed');

function props(actor: Actor, tickets: SupportTicket[] = [ownUnread, foreign, closed]): SupportProps {
  return {
    tickets, actor, build: 'dev', page: 'dashboard', revision: 7, sync: 'online', pending: 1,
    errors: ['Xato 1234'], seen: {}, onSeen: () => {}, run: async (_command: Command) => true,
  };
}

const guide = {
  page: 'dashboard', title: 'Umumiy ko‘rinish', purpose: 'Buyurtma bering', outcome: 'Tayyor',
  steps: [],
} as unknown as PageGuide;

describe('Support panel SSR', () => {
  it('renders eight FAQ questions for everyone', () => {
    const html = renderToStaticMarkup(createElement(SupportQuestions, {}));
    expect(supportFaq).toHaveLength(8);
    for (const item of supportFaq) expect(html).toContain(item.question);
  });

  it('hides foreign tickets from a worker and shows the unread marker', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: props(worker) }));
    expect(html).toContain('Murojaatlar');
    expect(html).toContain('Yangi murojaat');
    expect(html).toContain('t-own');
    expect(html).not.toContain('t-foreign');
    expect(html).toContain('Yangi javob');
  });

  it('defaults the owner list to open tickets and offers all filters', () => {
    const list = renderToStaticMarkup(createElement(SupportList, {
      tickets: [ownUnread, foreign, closed], actor: admin, filter: 'open', seen: {},
      onFilter: () => {}, onOpen: () => {}, onCreate: () => {},
    }));
    expect(list).toContain('Barcha murojaatlar');
    expect(list).toContain('Ochiq');
    expect(list).toContain('Yopilgan');
    expect(list).toContain('Hammasi');
    expect(list).toContain('t-own');
    expect(list).toContain('t-foreign');
    expect(list).not.toContain('t-closed');
  });

  it('shows an empty worker list with the approved copy', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: { ...props(worker), tickets: [] } }));
    expect(html).toContain('Hozircha murojaatlar yo‘q. Muammo bo‘lsa, «Yangi murojaat» orqali yozing.');
  });

  it('renders an open thread with diagnostics and the owner close button', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: ownUnread, actor: admin, onBack: () => {}, run: async () => true,
    }));
    expect(html).toContain('Diagnostika');
    expect(html).toContain('Xato [son]');
    expect(html).toContain('Javob yozing…');
    expect(html).toContain('>Yopish<');
    expect(html).not.toContain('Murojaat yopilgan.');
  });

  it('renders the closed note and reopen hint without the close button', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: { ...ownUnread, status: 'closed', closedAt: '2026-11-12T09:30:00.000Z', closedByName: admin.name },
      actor: admin, onBack: () => {}, run: async () => true,
    }));
    expect(html).toContain('Yopilgan: Egasi');
    expect(html).toContain('Murojaat yopilgan. Javob yozsangiz, u qayta ochiladi.');
    expect(html).not.toContain('>Yopish<');
  });

  it('never offers close to a worker', () => {
    const html = renderToStaticMarkup(createElement(SupportThread, {
      ticket: ownUnread, actor: worker, onBack: () => {}, run: async () => true,
    }));
    expect(html).not.toContain('>Yopish<');
  });

  it('keeps the display screen read-only', () => {
    const html = renderToStaticMarkup(createElement(SupportPanel, { support: props(display) }));
    expect(html).toContain('Bu ekranda murojaat yuborish o‘chirilgan.');
    expect(html).not.toContain('support-compose');
  });
});

describe('Guide integration SSR', () => {
  it('keeps two tabs without support', () => {
    const html = renderToStaticMarkup(createElement(GuidePanel, { guide, onAction: () => {}, close: () => {} }));
    expect(html).toContain('Qadamlar');
    expect(html).toContain('Qo‘llanma');
    expect(html).not.toContain('Murojaat');
  });

  it('adds the third tab with an alert badge', () => {
    const html = renderToStaticMarkup(createElement(GuidePanel, {
      guide, onAction: () => {}, close: () => {}, support: props(worker),
    }));
    expect(html).toContain('Murojaat');
    expect(html).toContain('guide-tab-badge');
  });

  it('marks the assistant button with an alert dot', () => {
    const lit = renderToStaticMarkup(createElement(GuideFab, { remaining: 0, alert: true, onClick: () => {} }));
    expect(lit).toContain('guide-dot');
    const quiet = renderToStaticMarkup(createElement(GuideFab, { remaining: 0, onClick: () => {} }));
    expect(quiet).not.toContain('guide-dot');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/support-ui.test.tsx`

Expected: FAIL — модуль `./components/Support` не найден.

- [ ] **Step 3: Реализовать `src/components/Support.tsx`**

Создать файл целиком:

```tsx
import { useState } from 'react';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import type { Actor, Command, SupportTicket, TicketContext, TicketStatus } from '../types';
import { Empty, dateTime } from '../ui';
import { searchFaq } from '../support-faq';
import {
  buildTicketContext, hasUnread, lastMessage, needsReply, sortedTickets, visibleTickets, type SeenMap,
} from '../support';

export interface SupportProps {
  tickets: SupportTicket[];
  actor: Actor;
  build: string;
  page: string;
  revision: number;
  sync: 'online' | 'offline';
  pending: number;
  errors: string[];
  seen: SeenMap;
  onSeen: (ticketId: string, messageId: string) => void;
  run: (command: Command) => Promise<boolean>;
}

type TicketFilter = 'open' | 'closed' | 'all';
const statusLabel: Record<TicketStatus, string> = { open: 'Ochiq', closed: 'Yopilgan' };

export function SupportQuestions() {
  const [query, setQuery] = useState('');
  const rows = searchFaq(query);
  return <section className="support-faq">
    <header><h3>Tez savollar</h3><p>Javobni qidiring yoki ro‘yxatdan tanlang.</p></header>
    <input className="support-search" value={query} placeholder="Savol qidirish…" aria-label="Savol qidirish" onChange={event => setQuery(event.target.value)} />
    {rows.length
      ? rows.map(item => <details key={item.id}><summary>{item.question}</summary><p>{item.answer}</p></details>)
      : <p className="support-faq-empty">Savol topilmadi.</p>}
  </section>;
}

function ContextCard({ context }: { context: TicketContext }) {
  return <dl>
    <dt>Bo‘lim</dt><dd>{context.page}</dd>
    <dt>Reviziya</dt><dd>{context.revision}</dd>
    <dt>Aloqa</dt><dd>{context.sync === 'online' ? 'Onlayn' : 'Oflayn'}</dd>
    <dt>Navbat</dt><dd>{context.pending}</dd>
    <dt>Yig‘ilma</dt><dd>{context.build}</dd>
    <dt>Xatolar</dt><dd>{context.errors.length ? context.errors.join(' · ') : 'Yo‘q'}</dd>
  </dl>;
}

function MessageRow({ message, own }: { message: SupportTicket['messages'][number]; own: boolean }) {
  return <article className={`support-message ${own ? 'own' : ''}`}>
    <header><b>{message.authorName}</b><time>{dateTime(message.at)}</time></header>
    <p>{message.text}</p>
    {message.context && <details className="support-context"><summary>Diagnostika</summary><ContextCard context={message.context} /></details>}
  </article>;
}

export function SupportList({ tickets, actor, filter, seen, onFilter, onOpen, onCreate }: {
  tickets: SupportTicket[];
  actor: Actor;
  filter: TicketFilter;
  seen: SeenMap;
  onFilter: (value: TicketFilter) => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const rows = sortedTickets(tickets).filter(ticket => filter === 'all' || ticket.status === filter);
  const filters: TicketFilter[] = actor.role === 'admin' ? ['open', 'closed', 'all'] : ['open', 'closed'];
  const filterLabel: Record<TicketFilter, string> = { open: 'Ochiq', closed: 'Yopilgan', all: 'Hammasi' };
  return <section className="support-list">
    <div className="support-list-head">
      <h3>{actor.role === 'admin' ? 'Barcha murojaatlar' : 'Murojaatlar'}</h3>
      {actor.role === 'worker' && <button className="primary small" onClick={onCreate}><MessageSquare size={15} />Yangi murojaat</button>}
    </div>
    <div className="support-filters">
      {filters.map(value => <button key={value} className={`support-chip ${filter === value ? 'active' : ''}`}
        aria-pressed={filter === value} onClick={() => onFilter(value)}>{filterLabel[value]}</button>)}
    </div>
    {rows.length === 0
      ? <Empty text={actor.role === 'worker'
        ? 'Hozircha murojaatlar yo‘q. Muammo bo‘lsa, «Yangi murojaat» orqali yozing.'
        : 'Hozircha murojaatlar yo‘q.'} />
      : rows.map(ticket => {
        const last = lastMessage(ticket);
        const unread = hasUnread(ticket, actor, seen);
        const answer = actor.role === 'admin' ? needsReply(ticket) : unread;
        return <button key={ticket.id} className="support-row" data-id={ticket.id} onClick={() => onOpen(ticket.id)}>
          <b>{actor.role === 'admin' ? ticket.authorName : ticket.messages[0].text.slice(0, 60)}
            <span className={`support-status ${ticket.status}`}>{statusLabel[ticket.status]}</span>
            {answer && <span className="support-unread">Yangi javob</span>}
          </b>
          <time>{dateTime(ticket.updatedAt)}</time>
          <small>{last?.text ?? ''}</small>
        </button>;
      })}
  </section>;
}

export function SupportThread({ ticket, actor, onBack, run }: {
  ticket: SupportTicket;
  actor: Actor;
  onBack: () => void;
  run: (command: Command) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await run({ type: 'ticket.reply', ticketId: ticket.id, text });
    setBusy(false);
    if (done) setText('');
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    await run({ type: 'ticket.close', ticketId: ticket.id });
    setBusy(false);
  };
  return <section className="support-thread">
    <div className="support-thread-head">
      <button className="text-button" onClick={onBack}><ArrowLeft size={15} />Ortga</button>
      <div className="support-thread-actions">
        <span className={`support-status ${ticket.status}`}>{statusLabel[ticket.status]}</span>
        {actor.role === 'admin' && ticket.status === 'open' && <button className="secondary small" disabled={busy} onClick={close}>Yopish</button>}
      </div>
    </div>
    {ticket.status === 'closed' && ticket.closedAt && <p className="support-closed-note">Yopilgan: {ticket.closedByName} · {dateTime(ticket.closedAt)}</p>}
    <div className="support-messages">
      {ticket.messages.map(message => <MessageRow key={message.id} message={message} own={message.authorId === actor.id} />)}
    </div>
    {ticket.status === 'closed' && <p className="support-closed-note">Murojaat yopilgan. Javob yozsangiz, u qayta ochiladi.</p>}
    <div className="support-compose">
      <textarea value={text} maxLength={2000} placeholder="Javob yozing…" aria-label="Javob yozing"
        onChange={event => setText(event.target.value)} />
      <div className="support-actions">
        <button className="primary" disabled={busy || !text.trim()} onClick={submit}><Send size={15} />Yuborish</button>
      </div>
    </div>
  </section>;
}

export function SupportNew({ support, onCancel, onCreated }: {
  support: SupportProps;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const context = buildTicketContext({
    page: support.page, revision: support.revision, online: support.sync === 'online',
    pending: support.pending, build: support.build, errors: support.errors,
  });
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const done = await support.run({ type: 'ticket.create', text, context });
    setBusy(false);
    if (done) { setText(''); onCreated(); }
  };
  return <section className="support-compose">
    <h3>Yangi murojaat</h3>
    <textarea value={text} maxLength={2000} placeholder="Muammoni yozing" aria-label="Muammoni yozing"
      onChange={event => setText(event.target.value)} />
    <details className="support-context"><summary>Avtomatik ma’lumot</summary><ContextCard context={context} /></details>
    <div className="support-actions">
      <button className="primary" disabled={busy || !text.trim()} onClick={submit}><Send size={15} />Yuborish</button>
      <button className="secondary" disabled={busy} onClick={onCancel}>Bekor qilish</button>
    </div>
  </section>;
}

export function SupportPanel({ support }: { support: SupportProps }) {
  const [view, setView] = useState<'list' | 'new' | 'thread'>('list');
  const [ticketId, setTicketId] = useState('');
  const [filter, setFilter] = useState<TicketFilter>('open');
  const tickets = visibleTickets(support.tickets, support.actor);
  const open = (id: string) => {
    const ticket = tickets.find(row => row.id === id);
    const last = ticket ? lastMessage(ticket) : null;
    if (support.actor.role === 'worker' && ticket && last?.authorRole === 'admin') support.onSeen(ticket.id, last.id);
    setTicketId(id);
    setView('thread');
  };
  const ticket = tickets.find(row => row.id === ticketId);
  return <div className="support-panel">
    <SupportQuestions />
    {support.actor.role === 'display'
      ? <p className="info-note">Bu ekranda murojaat yuborish o‘chirilgan.</p>
      : view === 'new'
        ? <SupportNew support={support} onCancel={() => setView('list')} onCreated={() => setView('list')} />
        : view === 'thread' && ticket
          ? <SupportThread ticket={ticket} actor={support.actor} onBack={() => setView('list')} run={support.run} />
          : <SupportList tickets={tickets} actor={support.actor} filter={filter} seen={support.seen}
            onFilter={setFilter} onOpen={open} onCreate={() => setView('new')} />}
  </div>;
}
```

- [ ] **Step 4: Третья вкладка в `Guide.tsx`**

1. Импорты: добавить `MessageSquare` в lucide-импорт (строка 2) и:

```ts
import { supportAlerts } from '../support';
import { SupportPanel, type SupportProps } from './Support';
```

2. `GuideFab` (строка 26) заменить на:

```tsx
export function GuideFab({ remaining, alert = false, onClick }: { remaining: number; alert?: boolean; onClick: () => void }) {
  return <button className="guide-fab" onClick={onClick} aria-label="Yordamchi: keyingi qadam va qo‘llanma">
    <HelpCircle size={20} /><span>Yordamchi</span>{remaining > 0 && <b>{remaining}</b>}
    {alert && <i className="guide-dot" aria-hidden="true" />}
  </button>;
}
```

3. `GuidePanel` (строки 50-85) заменить целиком на:

```tsx
export function GuidePanel({ guide, onAction, close, support }: {
  guide: PageGuide; onAction: (action: GuideAction) => void; close: () => void; support?: SupportProps;
}) {
  const [tab, setTab] = useState<'steps' | 'manual' | 'support'>('steps');
  const pending = guide.steps.filter(step => !step.done).length;
  const firstPending = guide.steps.findIndex(step => !step.done);
  const alerts = support ? supportAlerts(support.tickets, support.actor, support.seen) : 0;
  return <Dialog
    title={`Yordamchi · ${guide.title}`}
    subtitle={tab === 'steps' ? guide.purpose : tab === 'manual' ? 'Bo‘yash, mijoz fasadlari va LKM normalari bo‘yicha amaliy qo‘llanma.' : 'Tez savollar va murojaatlar'}
    close={close} wide>
    <div className="guide-tabs" role="tablist" aria-label="Yordamchi bo‘limlari">
      <button role="tab" aria-selected={tab === 'steps'} onClick={() => setTab('steps')}><Check size={15} />Qadamlar</button>
      <button role="tab" aria-selected={tab === 'manual'} onClick={() => setTab('manual')}><BookOpen size={15} />Qo‘llanma</button>
      {support && <button role="tab" aria-selected={tab === 'support'} onClick={() => setTab('support')}>
        <MessageSquare size={15} />Murojaat{alerts > 0 && <span className="guide-tab-badge">{alerts}</span>}
      </button>}
    </div>
    {tab === 'support' && support
      ? <SupportPanel support={support} />
      : tab === 'steps'
        ? <div className="guide-panel">
          <div className="guide-progress">{pending ? `${pending} qadam qoldi` : 'Hamma qadam bajarilgan'} · {guide.steps.length - pending}/{guide.steps.length} tayyor</div>
          <ol className="guide-steps">{guide.steps.map((step, index) => {
            const action = step.action;
            const isNext = index === firstPending;
            return <li key={step.id} className={`guide-step ${step.done ? 'done' : isNext ? 'next' : ''}`}>
              <span className="guide-marker">{step.done ? <Check size={15} /> : index + 1}</span>
              <div className="guide-step-body">
                <b>{step.title}</b>
                <small>{step.detail}</small>
                {!step.done && step.blocked && <small className="guide-blocked">Avval yuqoridagi qadamlar bajarilishi kerak</small>}
                {!step.done && action && <button className="secondary small" disabled={step.blocked} onClick={() => onAction(action)}>{action.label}</button>}
              </div>
            </li>;
          })}</ol>
          <div className="info-note">{guide.outcome}</div>
          <p className="subtle-note">Qadamlar hisobdagi ma’lumotga qarab avtomatik belgilanadi: yangi yozuv qo‘shilsa, ro‘yxat yangilanadi.</p>
        </div>
        : <ManualPanel />}
  </Dialog>;
}
```

- [ ] **Step 5: CSS**

После строки 437 (`.manual-section .info-note...`) и перед `@media(max-width:700px)` (438) вставить блок:

```css
.guide-dot{position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:var(--red);border:2px solid #fff}
.guide-fab{position:relative}
.guide-tab-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--red);color:#fff;font-size:10px;font-weight:800;display:grid;place-items:center}
.support-panel{display:flex;flex-direction:column;gap:16px;padding:18px 20px 22px}
.support-faq{display:flex;flex-direction:column;gap:10px}
.support-faq h3{font-size:14px}
.support-faq header p{font-size:11px;line-height:1.6;color:var(--muted)}
.support-search{min-height:44px;border:1px solid var(--border);border-radius:12px;padding:10px 12px;font:inherit;font-size:13px;background:#fff}
.support-faq details{border:1px solid var(--border);border-radius:12px;background:#fff;padding:10px 12px}
.support-faq summary{cursor:pointer;font-size:13px;font-weight:700;line-height:1.5;min-height:24px}
.support-faq details p{margin-top:8px;font-size:12px;line-height:1.7;color:#4d5d52}
.support-faq-empty{font-size:12px;color:var(--muted);padding:6px 2px}
.support-list{display:flex;flex-direction:column;gap:10px}
.support-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.support-list-head h3{font-size:14px}
.support-filters{display:flex;gap:6px;flex-wrap:wrap}
.support-chip{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:#fff;font:inherit;font-size:11px;font-weight:700;color:var(--muted)}
.support-chip.active{background:#f8fbe8;border-color:#cfe0a5;color:var(--green)}
.support-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;width:100%;text-align:left;padding:12px;border:1px solid var(--border);border-radius:12px;background:#fff;font:inherit;cursor:pointer}
.support-row:hover{border-color:#cfe0a5;background:#fbfcf7}
.support-row b{font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.support-row small{grid-column:1 / -1;display:block;font-size:11px;line-height:1.6;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.support-row time{font-size:11px;color:var(--muted);white-space:nowrap}
.support-status{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--green)}
.support-status.closed{color:var(--muted)}
.support-unread{font-size:10px;font-weight:800;color:var(--red)}
.support-thread{display:flex;flex-direction:column;gap:12px}
.support-thread-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.support-thread-head h3{font-size:14px}
.support-thread-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.support-messages{display:flex;flex-direction:column;gap:10px}
.support-message{padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:#fff}
.support-message.own{background:#f8fbe8;border-color:#cfe0a5}
.support-message header{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted);margin-bottom:4px}
.support-message header b{font-size:11px;color:var(--green)}
.support-message p{font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.support-message .support-context{margin-top:8px}
.support-context summary{cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);min-height:24px;list-style:none}
.support-context dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;margin-top:6px;font-size:11px}
.support-context dt{color:var(--muted);font-weight:700}
.support-context dd{margin:0;word-break:break-word}
.support-compose{display:flex;flex-direction:column;gap:8px}
.support-compose h3{font-size:14px}
.support-compose textarea{min-height:110px;border:1px solid var(--border);border-radius:12px;padding:10px 12px;font:inherit;font-size:13px;resize:vertical;background:#fff}
.support-compose .support-actions{display:flex;gap:8px;flex-wrap:wrap}
.support-compose .support-actions button{min-height:44px}
.support-closed-note{font-size:11px;line-height:1.6;color:var(--muted)}
```

Строку 438 — в конец существующего единственного `@media(max-width:700px)` блока, перед закрывающей `}`, добавить:

```css
.support-panel{padding:14px 14px 18px}.support-faq summary,.support-row b{font-size:12px}.support-row small,.support-message p{font-size:11px}
```

- [ ] **Step 6: GREEN и типы**

Run: `npx vitest run src/support-ui.test.tsx src/support.test.ts src/support-faq.test.ts`

Expected: PASS.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

---

### Task 8: Интеграция в `App.tsx`

**Files:**
- Modify: `src/App.tsx` (импорты, состояние, derived, GuideFab, GuidePanel)

**Interfaces:**
- Consumes: `SupportProps`, `readSeen`, `seenStorageKey`, `visibleTickets`, `supportAlerts`, `writeSeen`, `listDiagnostics`, `SeenMap`.
- Produces: рабочую вкладку в приложении (демо и облако).

- [ ] **Step 1: Импорты**

Добавить рядом с существующими (строки 49-54):

```ts
import { listDiagnostics, recordDiagnostic, reminderDue } from './diagnostics';
import { readSeen, seenStorageKey, supportAlerts, visibleTickets, writeSeen, type SeenMap } from './support';
```

(заменить существующую строку 54 `import { recordDiagnostic, reminderDue } from './diagnostics';` на строку с `listDiagnostics`).

- [ ] **Step 2: Состояние**

После `const [sync, setSync] = useState(syncStatus);` (строка 148) добавить:

```ts
  const [supportSeen, setSupportSeen] = useState<SeenMap>(() => readSeen(localStorage, seenStorageKey(actor.companyId, actor.id)));
```

После блока эффектов (например, сразу после `const apply`-объявлений не нужно; эффект можно добавить рядом с другими `useEffect` до `return`). Добавить перед `const apply` (строка 264):

```ts
  useEffect(() => {
    setSupportSeen(readSeen(localStorage, seenStorageKey(actor.companyId, actor.id)));
  }, [actor.companyId, actor.id]);
  const markSeen = (ticketId: string, messageId: string) => {
    if (supportSeen[ticketId] === messageId) return;
    const next = { ...supportSeen, [ticketId]: messageId };
    setSupportSeen(next);
    writeSeen(localStorage, seenStorageKey(actor.companyId, actor.id), next);
  };
```

- [ ] **Step 3: Derived**

После `const guide = pageGuide(state, current, actor);` (строка 433) добавить:

```ts
  const supportTickets = visibleTickets(state.tickets, actor);
  const supportAlertCount = supportAlerts(supportTickets, actor, supportSeen);
  const supportErrors = () => listDiagnostics(localStorage).slice(-5).map(row => row.message);
```

- [ ] **Step 4: Overlay**

Строки 547-550 заменить на:

```tsx
    overlays={<>
      <GuideFab remaining={pendingGuideSteps} alert={supportAlertCount > 0} onClick={() => setGuideOpen(true)} />
      {guideOpen && <GuidePanel guide={guide} onAction={runGuide} close={() => setGuideOpen(false)} support={{
        tickets: supportTickets, actor, build: __BUILD_ID__, page: current, revision: state.revision,
        sync: sync.online ? 'online' : 'offline', pending: sync.pending.length,
        errors: supportErrors(), seen: supportSeen, onSeen: markSeen, run,
      }} />}
    </>}
```

- [ ] **Step 5: Проверки**

Run: `npx tsc -b --pretty false`

Expected: exit 0.

Run: `npm test`

Expected: PASS — все существующие и новые тесты.

---

### Task 9: Финальная проверка, демо-браузер и порядок выката

**Files:**
- Нет новых файлов; проверяются все изменения Tasks 1-8.

**Interfaces:**
- Consumes: всё выше.
- Produces: доказательства готовности и точный порядок выката для владельца.

- [ ] **Step 1: Полный прогон**

Run: `npm test`

Expected: PASS, 0 failures.

Run: `npx tsc -b --pretty false`

Expected: exit 0.

- [ ] **Step 2: Генератор и зонд**

Run: `node .validation-pglite-20261029/generate-support-tickets-migration.mjs`

Run ту же команду ещё раз.

Expected: одинаковый `sha256` в обоих запусках.

Run: `node .validation-pglite-20261029/validate-support-tickets.mjs`

Expected: все `PASS`, финальная строка `N checks passed`.

- [ ] **Step 3: Сборка**

Run: `npm run build`

Expected: exit 0, `dist/` обновлён.

- [ ] **Step 4: Демо-браузер (`npm run dev`, http://127.0.0.1:5173)**

Проверить вручную (MCP-клики могут не срабатывать в демо — тогда используйте `evaluate_script`; `window.innerWidth` в MCP может быть 0 — задавайте ширину через устройство/скрипт):

1. Войти как работник → «Yordamchi» → вкладка «Murojaat» → «Yangi murojaat»: отправить текст, раскрыть «Avtomatik ma’lumot», убедиться, что цифры в ошибках замаскированы.
2. Войти как владелец → вкладка «Murojaat»: мурожаат виден, «Yangi javob», ответить, закрыть. На иконке «Yordamchi» появляется красная точка, у вкладки — счётчик.
3. Вернуться работником: видна «Yangi javob», открыть — метка исчезает; ответить на закрытый — мурожаат снова `Ochiq`.
4. FAQ: поиск «avans» и «zzz» (пусто → `Savol topilmadi.`).
5. Экран TV (`display`): FAQ виден, есть `Bu ekranda murojaat yuborish o‘chirilgan.`, кнопок создания нет.
6. Ширины 390 и 320 px: вкладки не переполняются, textarea ≥110 px, кнопки ≥44 px.

- [ ] **Step 5: Порядок выката (только по отдельному разрешению владельца с `erp-tizim`)**

1. Владелец применяет `supabase/migrations/20261112_support_tickets.sql` в Supabase SQL Editor (миграция идемпотентна; схема сначала, фронтенд потом).
2. Проверка на живой базе: `SELECT to_regclass('public.erp_support_tickets');` — не NULL; повторный запуск миграции не падает.
3. Затем `npm run deploy` (Worker `erp-tizim`).
4. После обновления — один онлайн-вход в облако (прогрев кеша ≤24 ч), затем сценарий работник → владелец.
5. Откат фронтенда безопасен: старая версия игнорирует `tickets`; таблицу не удалять.

Никаких удалённых действий в рамках этого плана не выполнять.
