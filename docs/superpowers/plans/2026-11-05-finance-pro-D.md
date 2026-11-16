# Finance PRO D: «Zaymlar va investitsiyalar» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Займы и инвестиции от знакомых/внешних лиц: каждая сумма — отдельная строка-счёт, «Pul olish» переводит в основной счёт, возвраты частичные, обязательства производные (нигде не хранятся).

**Architecture:** Derived-state, как у расходов. Движок `src/loans.ts` считает ledger из строки займа + кассовых записей с категориями `loan-draw`/`loan-repay`. Новый `source: 'loan'` исключается из операционных отчётов (periodReport cashIn/cashOut, аналитика cashByPeriod/cashByCategory), но остаётся в балансе кассы. Сервер зеркалит: таблица `erp_loans`, PL/pgSQL `erp_loan_ledger`, кейсы в `erp_execute`, секция в `erp_snapshot`, RLS — по образцу `erp_expense_plans`.

**Tech Stack:** TypeScript strict, React 19, Vite 6, Vitest 3, Supabase/Postgres + PGlite-пробы.

**Spec:** docs/superpowers/specs/2026-11-05-finance-pro-D-design.md

## Global Constraints

- Рабочая папка НЕ Git-репозиторий: шагов «commit» нет, каждый таск заканчивается проверками (vitest / build / PGlite).
- TDD обязателен: сначала падающий тест (RED с ожидаемой причиной), затем минимальный код (GREEN). Код до теста — переписать.
- «Текущую систему не ломать»: после каждого таска — прицельный прогон; после UI-тасков дополнительно полный `npm test` и `npm run build`.
- Удалённые изменения (миграция живой БД, `npm run deploy`) вне плана — только по отдельному разрешению владельца (итоговый батч-запрос).
- UI-копии на узбекском (латиница), суммы в UZS; отчёты владельцу — по-русски с точными путями и проверками.
- Демо-проверка UI только с пустыми `VITE_SUPABASE_*` (без записи в живые данные).
- Команды `loan.*` — только админ (существующий gate в `applyCommand`).
- `State.version` остаётся 4.
- Новых Account-значений не вводить: «внутренний счёт» займа — это сама строка займа.
- Ошибки домена/сервера: `Loan title required`, `Invalid loan kind`, `Invalid amount`, `Note is too long`, `Loan not found`, `Amount exceeds loan balance`, `Amount exceeds loan debt`, `Amount must be positive`, `Insufficient account balance`.

---

## Task 1: Типы и инфраструктура

**Files:**
- Modify: `src/types.ts` — `CashSource` += `'loan'`; новые `LoanKind`/`LoanRow`; `State.loans`; три команды в union
- Modify: `src/i18n.ts` — сообщение `cashLoan` и запись `cashSources.loan` (обязательно в одном изменении: `Record<CashSource, MessageKey>` исчерпывающий, иначе tsc падает)
- Modify: `src/domain.ts` — `emptyState()` += `loans: []`
- Modify: `src/migrations.ts` — lift `loans`
- Modify: `src/sync.ts` — `arrays` += `'loans'`
- Test: `src/migrations.test.ts`, `src/sync.test.ts`

**Interfaces:**
- Produces: `LoanRow { id, title, kind: 'loan'|'investment', amount, note, createdAt }`; `State.loans: LoanRow[]`; команды `loan.set` / `loan.draw` / `loan.repay` — точные сигнатуры ниже.

- [ ] **Step 1: RED — тест лифта в migrations.test.ts**

В `src/migrations.test.ts` после теста expensePlans добавить (касты типов нужны, пока `State.loans` не существует — иначе tsc не скомпилирует RED):

```ts
it('adds loans to a version 4 snapshot that predates loans', () => {
  const snapshot = JSON.parse(JSON.stringify(emptyState())) as State & { loans?: unknown };
  delete snapshot.loans;
  expect(snapshot.loans).toBeUndefined();
  const migrated = migrateState(snapshot);
  expect((migrated as State & { loans?: unknown }).loans).toEqual([]);
});
```

- [ ] **Step 2: RED — контракт снэпшота в sync.test.ts**

В `src/sync.test.ts` после describe `expensePlans snapshot contract` добавить:

```ts
describe('loans snapshot contract', () => {
  it('keeps the cached snapshot when the server omits loans', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect((first.state as State & { loans?: unknown }).loans).toEqual([]);
    f.strip('loans');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without loans', async () => {
    const f = setup(); f.online(true); f.strip('loans');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`
Expected: FAIL — `migrated.loans` is `undefined`, `first.state.loans` is `undefined`.

- [ ] **Step 4: Write minimal implementation**

`src/types.ts`:
- В `CashSource` (строка вида `export type CashSource = 'manual' | 'sale' | ...`) добавить `'loan'`.
- После `ExpensePlan` добавить:

```ts
export type LoanKind = 'loan' | 'investment';
export interface LoanRow {
  id: string;
  title: string;
  kind: LoanKind;
  amount: number;
  note: string;
  createdAt: string;
}
```

- В `State` после `expensePlans: ExpensePlan[]` добавить `loans: LoanRow[]`.
- В union `Command` после варианта `expense.pay` добавить:

```ts
  | { type: 'loan.set'; loanId: string | null; title: string; kind: LoanKind; amount: number; note: string }
  | { type: 'loan.draw'; loanId: string; amount: number; account: Account; note: string }
  | { type: 'loan.repay'; loanId: string; amount: number; account: Account; note: string }
```

`src/i18n.ts`:
- В `messages` после `cashExpense: 'Oylik xarajat to‘lovi',` добавить `cashLoan: 'Zaym operatsiyasi',`.
- В `cashSources` после `expense: 'cashExpense',` добавить `loan: 'cashLoan',`.

`src/domain.ts` в `emptyState()` после `expensePlans: [],` добавить `loans: [],`.

`src/migrations.ts` после строки `expensePlans: Array.isArray(source.expensePlans) ? source.expensePlans : [],` добавить:

```ts
  loans: Array.isArray(source.loans) ? source.loans : [],
```

`src/sync.ts` в массиве `arrays` после `'expensePlans'` добавить `'loans'`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor — убрать временные касты типов**

Заменить `(migrated as State & { loans?: unknown }).loans` на `migrated.loans`, `(first.state as State & { loans?: unknown }).loans` на `first.state.loans`; в migrations-тесте оставить `const snapshot = JSON.parse(JSON.stringify(emptyState())) as State & { loans?: unknown };` для `delete snapshot.loans` (без каста delete запрещён типизацией). Re-run: `npx vitest run src/migrations.test.ts src/sync.test.ts` — PASS.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: PASS — все существующие сьюты зелёные (добавление только расширяет типы).

---

## Task 2: Движок src/loans.ts

**Files:**
- Create: `src/loans.ts`
- Test: `src/loans.test.ts`

**Interfaces:**
- Produces: `loanLedger(state, loanId) → { id, title, kind, principal, drawn, available, repaid, owed }`, `loansDebt(state) → number`, `loansAvailable(state) → number`.
- Формулы: `drawn = Σ in('loan-draw') − Σ out('loan-draw')`; `repaid = Σ out('loan-repay') − Σ in('loan-repay')`; `available = max(0, principal − drawn)`; `owed = max(0, principal − repaid)`. Ruling: drawn НЕ клампится (домен не даёт перебрать), клампится только available.

- [ ] **Step 1: Write the failing test**

Create `src/loans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { loanLedger, loansAvailable, loansDebt } from './loans';
import type { CashEntry, LoanRow, State } from './types';

function loanRow(overrides: Partial<LoanRow> = {}): LoanRow {
  return { id: 'loan-1', title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '', createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function cashEntry(overrides: Partial<CashEntry> = {}): CashEntry {
  return { id: 'cash-1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', reversalOf: null, createdAt: '2026-11-01T00:00:00.000Z', ...overrides };
}

function state(loans: LoanRow[], cash: CashEntry[] = []): State {
  return { ...emptyState(), loans, cash };
}

describe('loanLedger', () => {
  it('computes a fresh loan as fully available and fully owed', () => {
    const ledger = loanLedger(state([loanRow()]), 'loan-1');
    expect(ledger).toMatchObject({ id: 'loan-1', title: 'Jasur aka', kind: 'loan', principal: 10_000_000, drawn: 0, available: 10_000_000, repaid: 0, owed: 10_000_000 });
  });

  it('reduces available when money is drawn and keeps owed at principal', () => {
    const ledger = loanLedger(state([loanRow()], [cashEntry({ amount: 6_000_000 })]), 'loan-1');
    expect(ledger.drawn).toBe(6_000_000);
    expect(ledger.available).toBe(4_000_000);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('reduces owed when repaid and keeps available at principal minus drawn', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
    ]), 'loan-1');
    expect(ledger.repaid).toBe(2_000_000);
    expect(ledger.owed).toBe(8_000_000);
    expect(ledger.available).toBe(4_000_000);
  });

  it('restores availability when a draw is reversed', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', direction: 'out', amount: 6_000_000, category: 'loan-draw', reversalOf: 'cash-1' }),
    ]), 'loan-1');
    expect(ledger.drawn).toBe(0);
    expect(ledger.available).toBe(10_000_000);
  });

  it('restores debt when a repayment is reversed', () => {
    const ledger = loanLedger(state([loanRow()], [
      cashEntry({ direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
      cashEntry({ id: 'cash-2', direction: 'in', amount: 2_000_000, category: 'loan-repay', reversalOf: 'cash-1' }),
    ]), 'loan-1');
    expect(ledger.repaid).toBe(0);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('keeps drawn as the raw sum and floors only available when data overdraws', () => {
    const ledger = loanLedger(state([loanRow()], [cashEntry({ amount: 12_000_000 })]), 'loan-1');
    expect(ledger.drawn).toBe(12_000_000);
    expect(ledger.available).toBe(0);
    expect(ledger.owed).toBe(10_000_000);
  });

  it('sums debt and availability across loans', () => {
    const loans = [
      loanRow(),
      loanRow({ id: 'loan-2', kind: 'investment', amount: 5_000_000 }),
    ];
    const s = state(loans, [
      cashEntry({ amount: 6_000_000 }),
      cashEntry({ id: 'cash-2', sourceId: 'loan-2', amount: 5_000_000 }),
      cashEntry({ id: 'cash-3', direction: 'out', amount: 2_000_000, category: 'loan-repay' }),
    ]);
    expect(loansDebt(s)).toBe(13_000_000);
    expect(loansAvailable(s)).toBe(4_000_000);
  });

  it('passes the kind through and tolerates a missing loan row', () => {
    expect(loanLedger(state([loanRow({ kind: 'investment' })]), 'loan-1').kind).toBe('investment');
    expect(loanLedger(state([]), 'missing')).toMatchObject({ id: 'missing', title: '', kind: 'loan', principal: 0, drawn: 0, available: 0, repaid: 0, owed: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/loans.test.ts`
Expected: FAIL — «Cannot find module './loans'».

- [ ] **Step 3: Write minimal implementation**

Create `src/loans.ts`. Обязательно по образцу `src/expenses.ts`: импортировать ТОЛЬКО `import type { State } from './types';` и объявить ЛОКАЛЬНУЮ `round` (иначе import-цикл с domain.ts):

```ts
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

export interface LoanLedger {
  id: string;
  title: string;
  kind: 'loan' | 'investment';
  principal: number;
  drawn: number;
  available: number;
  repaid: number;
  owed: number;
}

export function loanLedger(state: State, loanId: string): LoanLedger {
  const loan = state.loans.find(row => row.id === loanId);
  const sum = (category: string, direction: 'in' | 'out') => round(state.cash.reduce((total, row) =>
    row.source === 'loan' && row.sourceId === loanId && row.category === category && row.direction === direction
      ? total + row.amount : total, 0));
  const drawn = round(sum('loan-draw', 'in') - sum('loan-draw', 'out'));
  const repaid = round(sum('loan-repay', 'out') - sum('loan-repay', 'in'));
  const principal = round(loan?.amount ?? 0);
  return {
    id: loanId,
    title: loan?.title ?? '',
    kind: loan?.kind ?? 'loan',
    principal,
    drawn,
    available: Math.max(0, round(principal - drawn)),
    repaid,
    owed: Math.max(0, round(principal - repaid)),
  };
}

export function loansDebt(state: State): number {
  return round(state.loans.reduce((total, loan) => total + loanLedger(state, loan.id).owed, 0));
}

export function loansAvailable(state: State): number {
  return round(state.loans.reduce((total, loan) => total + loanLedger(state, loan.id).available, 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/loans.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

---

## Task 3: Команды домена loan.set / loan.draw / loan.repay + cash.reverse

**Files:**
- Modify: `src/domain.ts` — import движка; три case после `expense.pay`; проверка в `cash.reverse`
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `loanLedger` из Task 2; хелперы `check/money/text/find/account/postCash/now/uuid`.
- Produces: доменное поведение команд (валидация, проводки, стерно-проверка).

- [ ] **Step 1: Write the failing test**

В `src/domain.test.ts` добавить import `{ loanLedger } from './loans';` (в начало, к остальным импортам) и новый describe в конец файла:

```ts
describe('loan commands', () => {
  it('creates, draws and repays a loan with derived books', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    expect(s.loans).toHaveLength(1);
    expect(s.loans[0]).toMatchObject({ title: 'Jasur aka', kind: 'loan', amount: 10_000_000 });
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: 'Birinchi transh' });
    expect(loanLedger(s, loanId)).toMatchObject({ drawn: 6_000_000, available: 4_000_000 });
    expect(cashBalance(s, 'cash')).toBe(6_000_000);
    s = run(s, { type: 'loan.repay', loanId, amount: 2_000_000, account: 'cash', note: 'Qisman' });
    expect(loanLedger(s, loanId)).toMatchObject({ repaid: 2_000_000, owed: 8_000_000 });
    expect(cashBalance(s, 'cash')).toBe(4_000_000);
  });

  it('edits a loan in place and keeps its id and createdAt', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const { id, createdAt } = s.loans[0];
    s = run(s, { type: 'loan.set', loanId: id, title: 'Jasur aka (yangilangan)', kind: 'investment', amount: 12_000_000, note: 'Qo‘shimcha' });
    expect(s.loans).toHaveLength(1);
    expect(s.loans[0]).toMatchObject({ id, createdAt, title: 'Jasur aka (yangilangan)', kind: 'investment', amount: 12_000_000, note: 'Qo‘shimcha' });
  });

  it('validates the loan.set input', () => {
    const s = fixture().state;
    atomic(s, { type: 'loan.set', loanId: null, title: '   ', kind: 'loan', amount: 1000, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'grant' as never, amount: 1000, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'loan', amount: -1, note: '' });
    atomic(s, { type: 'loan.set', loanId: null, title: 'X', kind: 'loan', amount: 1000, note: 'x'.repeat(201) });
  });

  it('limits a draw to the available balance and validates the input', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    atomic(s, { type: 'loan.draw', loanId, amount: 10_000_001, account: 'cash', note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 0, account: 'cash', note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 1000, account: 'crypto' as never, note: '' });
    atomic(s, { type: 'loan.draw', loanId, amount: 1000, account: 'cash', note: 'x'.repeat(201) });
    atomic(s, { type: 'loan.draw', loanId: crypto.randomUUID(), amount: 1000, account: 'cash', note: '' });
    expect(cashBalance(s, 'cash')).toBe(0);
  });

  it('limits a repayment to the owed balance and the account balance', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    atomic(s, { type: 'loan.repay', loanId, amount: 1, account: 'cash', note: '' });
    s = run(s, { type: 'loan.draw', loanId, amount: 5_000_000, account: 'cash', note: '' });
    atomic(s, { type: 'loan.repay', loanId, amount: 10_000_001, account: 'cash', note: '' });
    atomic(s, { type: 'loan.repay', loanId, amount: 5_000_001, account: 'cash', note: '' });
  });

  it('reverses a draw and restores availability', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: '' });
    const entry = s.cash[0];
    s = run(s, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
    expect(loanLedger(s, loanId).drawn).toBe(0);
    expect(loanLedger(s, loanId).available).toBe(10_000_000);
  });

  it('refuses to reverse a loan entry after the loan was edited away', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    s = run(s, { type: 'loan.draw', loanId, amount: 6_000_000, account: 'cash', note: '' });
    const entry = s.cash[0];
    const reduced = { ...s, loans: [] };
    atomic(reduced, { type: 'cash.reverse', entryId: entry.id, note: 'Xato' });
  });

  it('applies a loan command exactly once per request id', () => {
    let s = fixture().state;
    s = run(s, { type: 'loan.set', loanId: null, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: '' });
    const loanId = s.loans[0].id;
    const requestId = crypto.randomUUID();
    s = applyCommand(s, { requestId, expectedRevision: s.revision, command: { type: 'loan.draw', loanId, amount: 4_000_000, account: 'cash', note: '' } }, admin);
    const cashCount = s.cash.length;
    const retried = applyCommand(s, { requestId, expectedRevision: s.revision, command: { type: 'loan.draw', loanId, amount: 4_000_000, account: 'cash', note: '' } }, admin);
    expect(retried.cash).toHaveLength(cashCount);
    expect(loanLedger(retried, loanId).drawn).toBe(4_000_000);
  });

  it('rejects loan commands from a worker', () => {
    const f = fixture();
    const command = { type: 'loan.set' as const, loanId: null, title: 'X', kind: 'loan' as const, amount: 1000, note: '' };
    expect(() => run(f.state, command, f.worker)).toThrow();
  });
});
```

Примечание: точную форму команды `cash.reverse` (имя поля `entryId` и опциональный `note`) сверить с существующими тестами домена перед запуском — если в домене команда называется иначе, поправить тест под фактическую сигнатуру, затем RED.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain.test.ts`
Expected: FAIL — `state.loans` is undefined / `'loan.set'` не обрабатывается.

- [ ] **Step 3: Write minimal implementation**

`src/domain.ts`:
- Импорт: рядом с импортами движков добавить `import { loanLedger } from './loans';`.
- После case `expense.pay` (перед `inventory.count`) добавить:

```ts
    case 'loan.set': {
      const title = command.title.trim();
      check(title.length > 0 && title.length <= 200, 'Loan title required');
      check(command.kind === 'loan' || command.kind === 'investment', 'Invalid loan kind');
      const amount = money(command.amount);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      const loanId = command.loanId ?? uuid();
      const existing = state.loans.find(row => row.id === loanId);
      if (existing) {
        existing.title = title;
        existing.kind = command.kind;
        existing.amount = amount;
        existing.note = note;
      } else {
        state.loans.push({ id: loanId, title, kind: command.kind, amount, note, createdAt: now() });
      }
      return loanId;
    }
    case 'loan.draw': {
      find(state.loans, command.loanId, 'Loan');
      const value = money(command.amount, true);
      account(command.account);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      check(value <= loanLedger(state, command.loanId).available, 'Amount exceeds loan balance');
      postCash(state, { direction: 'in', amount: value, account: command.account, toAccount: null, source: 'loan', sourceId: command.loanId, customerId: null, category: 'loan-draw', note, reversalOf: null });
      return command.loanId;
    }
    case 'loan.repay': {
      find(state.loans, command.loanId, 'Loan');
      const value = money(command.amount, true);
      account(command.account);
      const note = command.note.trim();
      check(note.length <= 200, 'Note is too long');
      check(value <= loanLedger(state, command.loanId).owed, 'Amount exceeds loan debt');
      postCash(state, { direction: 'out', amount: value, account: command.account, toAccount: null, source: 'loan', sourceId: command.loanId, customerId: null, category: 'loan-repay', note, reversalOf: null });
      return command.loanId;
    }
```

- В `cash.reverse` после существующих проверок источника добавить:

```ts
    if (original.source === 'loan') find(state.loans, original.sourceId ?? '', 'Loan');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

---

## Task 4: Исключения займов из отчётов и аналитики + категории кассы

**Files:**
- Modify: `src/i18n.ts` — `cashCategories` += `'loan-draw'` / `'loan-repay'`
- Modify: `src/reports.ts` — `cashIn`/`cashOut` исключают `source === 'loan'`
- Modify: `src/analytics.ts` — `cashByPeriod`/`cashByCategory` пропускают `source === 'loan'`
- Test: `src/i18n.test.ts`, `src/reports.test.ts`, `src/analytics.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/i18n.test.ts` — добавить в существующий describe категорий:

```ts
expect(cashCategoryLabel('loan-draw')).toBe('Zaym olindi');
expect(cashCategoryLabel('loan-repay')).toBe('Zaym qaytarildi');
```

`src/reports.test.ts` — добавить (точные имена функции отчёта и параметров сверить с существующими тестами файла):

```ts
it('excludes loan wires from operating income and spending but keeps them in the balance', () => {
  let s = emptyState();
  s = { ...s, cash: [
    { id: 'm1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'manual', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    { id: 'l1', direction: 'in', amount: 5_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    { id: 'l2', direction: 'out', amount: 1_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-repay', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
  ] as CashEntry[] };
  const report = periodReport(s, { from: '2026-11-01', to: '2026-11-30' });
  expect(report.cashIn).toBe(1_000);
  expect(report.cashOut).toBe(0);
  expect(cashBalance(s, 'cash')).toBe(5_000);
});
```

`src/analytics.test.ts` — добавить к существующим тестам `cashByPeriod`/`cashByCategory`:

```ts
it('skips loan wires in cash analytics', () => {
  const s = { ...emptyState(), cash: [
    { id: 'm1', direction: 'in', amount: 1_000, account: 'cash', toAccount: null, source: 'manual', sourceId: null, customerId: null, category: 'manual', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
    { id: 'l1', direction: 'in', amount: 5_000, account: 'cash', toAccount: null, source: 'loan', sourceId: 'loan-1', customerId: null, category: 'loan-draw', note: '', reversalOf: null, createdAt: '2026-11-05T09:00:00.000Z' },
  ] as CashEntry[] };
  const byPeriod = cashByPeriod(s, '2026-11-01', '2026-11-30');
  const byCategory = cashByCategory(s, '2026-11-01', '2026-11-30');
  // loan entry не должен попасть ни в один агрегат
  expect(Object.values(byPeriod).reduce((sum, row) => sum + row.in, 0)).toBe(1_000);
  expect(Object.values(byCategory).reduce((sum, row) => sum + row.in, 0)).toBe(1_000);
});
```

Точные сигнатуры `periodReport`/`cashByPeriod`/`cashByCategory` сверить с существующими вызовами в тестах перед запуском.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/i18n.test.ts src/reports.test.ts src/analytics.test.ts`
Expected: FAIL — категории не переводятся (`'loan-draw'` возвращается как есть), отчёты считают займовые проводки.

- [ ] **Step 3: Write minimal implementation**

`src/i18n.ts` в `cashCategories` добавить:

```ts
  'loan-draw': 'Zaym olindi',
  'loan-repay': 'Zaym qaytarildi',
```

`src/reports.ts`: в вычислениях `cashIn` и `cashOut` добавить условие `&& row.source !== 'loan'` к существующим фильтрам.

`src/analytics.ts`: в циклах `cashByPeriod` и `cashByCategory` заменить
`if (entry.direction === 'transfer') continue;`
на
`if (entry.direction === 'transfer' || entry.source === 'loan') continue;`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/i18n.test.ts src/reports.test.ts src/analytics.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

---

## Task 5: UI — LoansPanel, раздел «zaymlar», модалки и интеграция App

**Files:**
- Create: `src/components/LoansPanel.tsx`
- Modify: `src/sections.ts` — панель `zaymlar` в разделе «Moliya va kassa» после `xarajatlar`
- Modify: `src/App.tsx` — импорты; метрика Majburiyatlar; условие рендера панелей; карта источников журнала; список Kreditor qarzdorlik; модалки `loanSet`/`loanDraw`/`loanRepay` + три формы в конце файла
- Test: `src/mobileCards.test.ts`

- [ ] **Step 1: Write the failing test**

В `src/mobileCards.test.ts` в массив `tableFiles` после `'components/ExpensePanel.tsx',` добавить `'components/LoansPanel.tsx',`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/mobileCards.test.ts`
Expected: FAIL — файл не найден (ENOENT при чтении tableFiles).

- [ ] **Step 3: Write minimal implementation**

**`src/components/LoansPanel.tsx`** — по образцу ExpensePanel/SalaryPanel (те же классы, data-labels, chip-паттерн `month-bar` для раскрытия деталей):

```tsx
import { useMemo, useState } from 'react';
import { Wallet, CircleAlert } from 'lucide-react';
import { cashCategoryLabel } from '../i18n';
import { loanLedger, loansAvailable } from '../loans';
import { Empty, Metric, Section, Title, date, money } from '../ui';
import type { State } from '../types';

export default function LoansPanel({ state, onSet, onDraw, onRepay }: {
  state: State;
  onSet: (loanId: string | null) => void;
  onDraw: (loanId: string) => void;
  onRepay: (loanId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => state.loans
    .map(loan => ({ loan, ledger: loanLedger(state, loan.id) }))
    .slice().sort((a, b) => a.loan.createdAt.localeCompare(b.loan.createdAt)), [state]);
  const totals = useMemo(() => rows.reduce((sum, { ledger }) => ({
    principal: sum.principal + ledger.principal,
    drawn: sum.drawn + ledger.drawn,
    repaid: sum.repaid + ledger.repaid,
    owed: sum.owed + ledger.owed,
  }), { principal: 0, drawn: 0, repaid: 0, owed: 0 }), [rows]);
  const available = loansAvailable(state);

  return <>
    <Title eyebrow="MOLIYA / ZAYMLAR" title="Zaymlar va investitsiyalar." description="Tanishlardan olingan qarz yoki ulush pullari — olingani, qaytarilgani va qolgan qarzdorlik bilan. Har bir yozuv alohida hisob." />
    <div className="metrics">
      <Metric label="Jami summa" value={money(totals.principal)} detail="Barcha zaym va investitsiyalar" icon={Wallet} />
      <Metric label="Olingan" value={money(totals.drawn)} detail="Asosiy hisobga o‘tkazilgan" icon={Wallet} />
      <Metric label="Qaytarilgan" value={money(totals.repaid)} detail="Qisman yoki to‘liq" icon={Wallet} />
      <Metric label="Qarzdorlik" value={money(totals.owed)} detail={`Hozir olish mumkin: ${money(available)}`} icon={CircleAlert} accent />
    </div>
    <Section title="Zaymlar va investitsiyalar" hint="Chipni bosing — yozuv tarixi ko‘rinadi" action={<button className="primary" onClick={() => onSet(null)}>Yangi zaym</button>}>
      {!rows.length && <Empty text="Avval «Yangi zaym» tugmasini bosing" />}
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Nomi</th><th className="right">Olingan</th><th className="right">Mavjud</th><th className="right">Qaytarilgan</th><th className="right">Qarzdorlik</th><th /></tr></thead>
        <tbody>{rows.map(({ loan, ledger }) => <tr key={loan.id}>
          <td data-label="Nomi"><div className="month-bar"><button
            type="button" className={openId === loan.id ? 'selected' : ''}
            onClick={() => setOpenId(openId === loan.id ? null : loan.id)}>
            <small>{loan.kind === 'loan' ? 'Zaym' : 'Investitsiya'} · {money(loan.amount)}</small>
            <b>{loan.title}</b><em>{ledger.owed > 0 ? 'qarz' : 'yopilgan'}</em>
          </button></div></td>
          <td data-label="Olingan" className="right">{money(ledger.drawn)}</td>
          <td data-label="Mavjud" className="right">{money(ledger.available)}</td>
          <td data-label="Qaytarilgan" className="right">{money(ledger.repaid)}</td>
          <td data-label="Qarzdorlik" className="right"><strong>{money(ledger.owed)}</strong></td>
          <td data-label="Amallar"><div className="button-group">
            <button className="secondary small" onClick={() => onSet(loan.id)}>Tahrirlash</button>
            <button className="secondary small" disabled={ledger.available <= 0} onClick={() => onDraw(loan.id)}>Pul olish</button>
            <button className="primary" disabled={ledger.owed <= 0} onClick={() => onRepay(loan.id)}>Qaytarish</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {rows.map(({ loan, ledger }) => {
        if (openId !== loan.id) return null;
        const wires = state.cash
          .filter(row => row.source === 'loan' && row.sourceId === loan.id)
          .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return <Section key={`detail-${loan.id}`} title={loan.title}
          hint={`Olingan ${money(ledger.drawn)} · Qaytarilgan ${money(ledger.repaid)} · Qolgan qarz ${money(ledger.owed)}`}>
          <div className="table-scroll cardable"><table>
            <thead><tr><th>Sana</th><th>Kategoriya</th><th>Izoh</th><th className="right">Summa</th></tr></thead>
            <tbody>{wires.map(row => <tr key={row.id}>
              <td data-label="Sana">{date(row.createdAt)}</td>
              <td data-label="Kategoriya">{cashCategoryLabel(row.category)}</td>
              <td data-label="Izoh">{row.note || '—'}</td>
              <td data-label="Summa" className="right">{row.direction === 'in' ? '+' : '−'}{money(row.amount)}</td>
            </tr>)}{!wires.length && <tr><td data-label="Xabar" colSpan={4}>Hozircha o‘tkazmalar yo‘q</td></tr>}</tbody>
          </table></div>
        </Section>;
      })}
    </Section>
  </>;
}
```

**`src/sections.ts`** — в панелях раздела «Moliya va kassa» после `{ id: 'xarajatlar', title: 'Oylik xarajatlar' }` добавить `{ id: 'zaymlar', title: 'Zaymlar va investitsiyalar' }`.

**`src/App.tsx`:**
- Импорты: `import LoansPanel from './components/LoansPanel';` и `import { loanLedger, loansDebt } from './loans';`.
- Рядом с `const expensesTotal = expensesDebt(state);` добавить `const loansTotal = loansDebt(state);`.
- В условии Title финансовой секции: `panel !== 'xarajatlar'` → `panel !== 'xarajatlar' && panel !== 'zaymlar'`.
- В рендере панелей: `panel === 'xarajatlar' ? <ExpensePanel ... /> :` дополнить веткой
  `panel === 'zaymlar' ? <LoansPanel state={state} onSet={id => show('loanSet', id ?? undefined)} onDraw={id => show('loanDraw', id)} onRepay={id => show('loanRepay', id)} /> :`.
- Метрика Majburiyatlar: `value={money(supplierTotal + payrollTotal + expensesTotal)}` → `value={money(supplierTotal + payrollTotal + expensesTotal + loansTotal)}`, detail «Yetkazib beruvchilar, ish haqi va oylik xarajatlar» → «Yetkazib beruvchilar, ish haqi, oylik xarajatlar va zaymlar».
- Карта источников журнала кассы (inline-объект с `manual/sale/supplier/payroll/expense/transfer`) — добавить `loan: 'Zaym operatsiyasi'`.
- В списке «Kreditor qarzdorlik» (кнопки долгов) добавить:

```tsx
{state.loans.map(loan => {
  const ledger = loanLedger(state, loan.id);
  return ledger.owed > 0 ? <button key={loan.id} onClick={() => show('loanRepay', loan.id)}><div><b>{loan.title}</b><small>{loan.kind === 'loan' ? 'Zaym' : 'Investitsiya'}</small></div><strong>{money(ledger.owed)}</strong></button> : null;
})}
```

- После рендера модалки `expensePay` добавить:

```tsx
{modal.type === 'loanSet' && <LoanSetForm state={state} loanId={modal.id ?? null} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
{modal.type === 'loanDraw' && <LoanDrawForm loanId={modal.id!} available={loanLedger(state, modal.id!).available} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
{modal.type === 'loanRepay' && <LoanRepayForm loanId={modal.id!} owed={loanLedger(state, modal.id!).owed} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}
```

- В карту `modalTitle` добавить: `loanSet: 'Zaym yoki investitsiya', loanDraw: 'Zaym mablag‘ini olish', loanRepay: 'Zaymni qaytarish'`.
- Список исключений для широкого Dialog НЕ менять (loan-формы рендерятся в обычном Dialog, как salaryPlan/expensePlan).
- В конец App.tsx (после ExpensePayForm) добавить три формы:

```tsx
function LoanSetForm({ state, loanId, busy, close, save }: { state: State; loanId: string | null; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const loan = loanId ? state.loans.find(row => row.id === loanId) : null;
  const [kind, setKind] = useState<'loan' | 'investment'>(loan?.kind ?? 'loan');
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.set', loanId, title: text(form, 'title'), kind, amount: number(form, 'amount'), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{loanId ? 'Tahrirlash' : 'Yangi yozuv'}</small><strong>{loanId ? 'Zaymni tahrirlash' : 'Zaym yoki investitsiya'}</strong></div>
      <Field label="Nomi"><input name="title" maxLength={200} required autoFocus defaultValue={loan?.title} /></Field>
      <div className="segmented">
        {(['loan', 'investment'] as const).map(option => <button key={option} type="button" className={kind === option ? 'selected' : ''} onClick={() => setKind(option)}>{option === 'loan' ? 'Zaym' : 'Investitsiya'}</button>)}
      </div>
      <Amount name="amount" defaultValue={loan?.amount} />
      <Field label="Izoh"><input name="note" maxLength={200} defaultValue={loan?.note} /></Field>
      <p className="subtle-note">Summa — zaym yoki investitsiyaning to‘liq hajmi. Olingan va qaytarilgan pul alohida yoziladi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></footer>
  </form>;
}

function LoanDrawForm({ loanId, available, busy, close, save }: { loanId: string; available: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.draw', loanId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Olish mumkin</small><strong>{money(available)}</strong></div>
      <Amount name="amount" defaultValue={available || undefined} max={available || undefined} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <p className="subtle-note">Olingan summa tanlangan hisobga tushadi va zaymning olinishi sifatida yoziladi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Pul olish'}</button></footer>
  </form>;
}

function LoanRepayForm({ loanId, owed, busy, close, save }: { loanId: string; owed: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'loan.repay', loanId, amount: number(form, 'amount'), account: account(form), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Qarzdorlik</small><strong>{money(owed)}</strong></div>
      <Amount name="amount" defaultValue={owed || undefined} max={owed || undefined} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} /></Field>
      <p className="subtle-note">Qaytarilgan summa tanlangan hisobdan chiqadi va qarzdorlikni kamaytiradi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Qaytarish'}</button></footer>
  </form>;
}
```

Точные имена локальных переменных в App.tsx (`modal`, `setModal`, `show`, `busy`, `run`) сверить с текущим кодом перед правкой.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mobileCards.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and build**

Run: `npm test` — PASS. Run: `npm run build` — exit 0.

---

## Task 6: Сервер — erp_loans в schema.sql и validate.mjs

**Files:**
- Modify: `supabase/schema.sql` — CHECK'и erp_cash; таблица erp_loans; RLS; `erp_loan_ledger`; секция `loans` в erp_snapshot; кейсы в erp_execute; проверка в cash.reverse; GRANT/REVOKE
- Modify: `.validation-pglite-20261029/validate.mjs` — transpile `'loans'`; protections 28 → 29; упражнение loan-команд

- [ ] **Step 1: RED — расширить validate.mjs**

- В списке transpile (строка с `['migrations', 'recipes', 'sales', 'receivables', 'salary', 'expenses', 'domain']`) добавить `'loans'`.
- В проверке `protections.length` заменить `28` на `29`.
- После упражнения expense-команд (перед проверкой protections) добавить:

```js
{
  result = await execute({ type: 'loan.set', loanId: null, title: 'Zaym zondu', kind: 'loan', amount: 100, note: 'probe' });
  const loanId = result.state.loans[0].id;
  await execute({ type: 'loan.draw', loanId, amount: 60, account: 'cash', note: 'probe' });
  await execute({ type: 'loan.repay', loanId, amount: 20, account: 'cash', note: 'probe' });
  const ledger = iso((await one('SELECT public.erp_loan_ledger($1, $2) AS ledger', [companyId, loanId])).ledger);
  assert.equal(Number(ledger.drawn), 60);
  assert.equal(Number(ledger.repaid), 20);
  assert.equal(Number(ledger.owed), 80);
  assert.equal(Number(ledger.available), 40);
  pass('loan.set/draw/repay land in erp_loans with the expected ledger', { owed: Number(ledger.owed) });
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .validation-pglite-20261029/validate.mjs`
Expected: FAIL — `public.erp_loan_ledger` не существует / protections 28 ≠ 29.

- [ ] **Step 3: Write minimal implementation (schema.sql)**

1. **erp_cash source CHECK**: в список значений добавить `'loan'`.
2. **erp_cash shape CHECK**: в ветку `OR (source IN ('supplier', 'payroll', 'expense') AND ...)` добавить `'loan'` → `('supplier', 'payroll', 'expense', 'loan')`.
3. **Таблица** после `erp_expense_plans`:

```sql
CREATE TABLE public.erp_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('loan', 'investment')),
  amount numeric NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000 AND amount = round(amount, 2)),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id)
);
CREATE INDEX erp_loans_company_idx ON public.erp_loans(company_id);
```

4. **RLS DO-блок**: в массив имён таблиц добавить `'erp_loans'` (после `'erp_expense_plans'`).
5. **Функция** после `erp_expense_ledger`:

```sql
CREATE FUNCTION public.erp_loan_ledger(p_company uuid, p_loan uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_title text; v_kind text; v_amount numeric := 0; v_drawn numeric; v_repaid numeric;
BEGIN
  SELECT title, kind, amount INTO v_title, v_kind, v_amount
    FROM public.erp_loans WHERE company_id = p_company AND id = p_loan;
  v_title := coalesce(v_title, '');
  v_kind := coalesce(v_kind, 'loan');
  SELECT round(coalesce(sum(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0), 2) INTO v_drawn
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'loan' AND source_id = p_loan AND category = 'loan-draw' AND direction IN ('in', 'out');
  SELECT round(coalesce(sum(CASE direction WHEN 'out' THEN amount ELSE -amount END), 0), 2) INTO v_repaid
    FROM public.erp_cash
   WHERE company_id = p_company AND source = 'loan' AND source_id = p_loan AND category = 'loan-repay' AND direction IN ('in', 'out');
  RETURN jsonb_build_object('id', p_loan::text, 'title', v_title, 'kind', v_kind, 'principal', v_amount,
    'drawn', v_drawn, 'available', greatest(round(v_amount - v_drawn, 2), 0),
    'repaid', v_repaid, 'owed', greatest(round(v_amount - v_repaid, 2), 0));
END;
$$;
```

6. **erp_snapshot**: после секции `'expensePlans'` добавить (админ-условие `AND v_admin`, как у expensePlans):

```sql
  'loans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
    'amount', l.amount, 'note', l.note, 'createdAt', l.created_at) ORDER BY l.created_at, l.id), '[]'::jsonb)
    FROM public.erp_loans l WHERE l.company_id = v_company AND v_admin),
```

7. **erp_execute** — после case `expense.pay` (перед `inventory.count`) добавить три case. Имена хелперов (`erp_text`, `erp_money`, `erp_note`, `erp_uuid`, `erp_balance`) и переменных (`v_title`, `v_note`, `v_amount`, `v_account`, `v_entity`) сверить с существующими case `expense.*` и использовать те же:

```sql
  WHEN 'loan.set' THEN
    IF p_command -> 'loanId' IS NOT NULL AND p_command -> 'loanId' <> 'null'::jsonb THEN
      v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
    ELSE
      v_entity := gen_random_uuid();
    END IF;
    IF (p_command ->> 'kind') IS NULL OR (p_command ->> 'kind') NOT IN ('loan', 'investment') THEN
      RAISE EXCEPTION 'Invalid loan kind' USING ERRCODE = '22023';
    END IF;
    v_title := public.erp_text(p_command -> 'title', 'Loan title required');
    v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
    v_note := public.erp_note(p_command -> 'note', 'Note is too long');
    INSERT INTO public.erp_loans(company_id, id, title, kind, amount, note)
      VALUES (v_company, v_entity, v_title, p_command ->> 'kind', v_amount, v_note)
      ON CONFLICT (company_id, id) DO UPDATE
        SET title = EXCLUDED.title, kind = EXCLUDED.kind, amount = EXCLUDED.amount, note = EXCLUDED.note;
  WHEN 'loan.draw' THEN
    v_entity := public.erp_uuid(p_command -> 'loanId', 'Loan not found');
    v_amount := public.erp_money(p_command -> 'amount', 'amount');
    v_note := public.erp_note(p_command -> 'note', 'Note is too long');
    v_account := public.erp_account(p_command -> 'account');
    IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'available')::numeric THEN
      RAISE EXCEPTION 'Amount exceeds loan balance' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note)
      VALUES (v_company, 'in', v_amount, v_account, 'loan', v_entity, NULL, 'loan-draw', v_note);
  WHEN 'loan.repay' THEN
    v_entity := public.erp_uuid(p_command -> 'loanId', 'Loan not found');
    v_amount := public.erp_money(p_command -> 'amount', 'amount');
    v_note := public.erp_note(p_command -> 'note', 'Note is too long');
    v_account := public.erp_account(p_command -> 'account');
    IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
      RAISE EXCEPTION 'Amount exceeds loan debt' USING ERRCODE = '23514';
    END IF;
    IF v_amount > public.erp_balance(v_company, v_account) THEN
      RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note)
      VALUES (v_company, 'out', v_amount, v_account, 'loan', v_entity, NULL, 'loan-repay', v_note);
```

Точные имена хелперов сверить с кейсами expense в текущем schema.sql (например, uuid-хелпер может называться иначе, а erp_uuid может принимать другой второй аргумент) — при несовпадении адаптировать, сохранив сообщения об ошибках.

8. **cash.reverse в erp_execute**: в существующую цепочку проверок существования источника добавить условие займа:

```sql
  OR v_cash.source = 'loan' AND NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_cash.source_id)
```

9. **REVOKE/GRANT**: в оба списка после `public.erp_expense_ledger(...)` добавить `public.erp_loan_ledger(uuid, uuid)`.

- [ ] **Step 4: Run probe to verify it passes**

Run: `node .validation-pglite-20261029/validate.mjs`
Expected: PASS (protections 29, loan-упражнение зелёное, все существующие проверки зелёные).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

---

## Task 7: Облачная копия не теряет займы

**Files:**
- Modify: `supabase/functions/_shared/backup.ts` — `STATE_COLLECTIONS` += `loans: 'erp_loans'`
- Test: `src/copy.test.ts`

- [ ] **Step 1: Write the failing test**

В `src/copy.test.ts` по образцу теста expensePlans playback добавить:

```ts
it('keeps loans in the copy and in playback', async () => {
  const played = await playLoans();
  expect(played.ok).toBe(true);
  expect(played.counts).toMatchObject({ erp_loans: 1 });
});
```

(Хелпер `playLoans` построить по образцу существующего хелпера playback для expensePlans: `copy.tables.erp_loans = [{ company_id: COMPANY, id: 'l1', title: 'Jasur aka', kind: 'loan', amount: 10000000, note: 'Dastgoh uchun' }]`, `copy.manifest = copyManifest(copy.tables)`, `(copy.state as Record<string, unknown>).loans = [{ id: 'l1' }]`; точные имена хелперов сверить с файлом.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/copy.test.ts`
Expected: FAIL — `erp_loans` не в дампе/`counts.erp_loans` отсутствует.

- [ ] **Step 3: Write minimal implementation**

В `supabase/functions/_shared/backup.ts` в `STATE_COLLECTIONS` после `expensePlans: 'erp_expense_plans'` добавить `loans: 'erp_loans'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS.

---

## Task 8: Идемпотентная миграция supabase/migrations/20261105_loans.sql + PGlite-зонд

**Files:**
- Create: `supabase/migrations/20261105_loans.sql`
- Create: `.validation-pglite-20261029/validate-loans-migration.mjs`

- [ ] **Step 1: Write the migration**

Образец — `supabase/migrations/20261105_expense_plans.sql`. Структура: заголовочный комментарий → `BEGIN;` → DO-блок снятия старых CHECK'ов erp_cash → восстановление именованных CHECK'ов `erp_cash_source_allowed` / `erp_cash_shape` с новым значением 'loan' → `CREATE TABLE IF NOT EXISTS public.erp_loans` + индекс → самодостаточный RLS-блок (ENABLE ROW LEVEL SECURITY, REVOKE ALL, GRANT SELECT, DROP POLICY IF EXISTS erp_admin_read, CREATE POLICY erp_admin_read) → `CREATE OR REPLACE FUNCTION` ПОЛНЫЕ дословные копии ТЕКУЩИХ тел `erp_snapshot()` и `erp_execute()` ИЗ schema.sql, но С добавлениями займов из Task 6 → `CREATE OR REPLACE FUNCTION erp_loan_ledger` → REVOKE/GRANT хвост → `COMMIT;`.

Ключевые отличия от C-миграции:
- DO-блок снятия CHECK'ов: `pg_get_constraintdef(oid) LIKE '%source%' AND NOT LIKE '%direction%' AND NOT LIKE '%expense%' AND NOT LIKE '%loan%'`.
- Восстановленный `erp_cash_source_allowed` включает 'loan'; `erp_cash_shape` включает ветку `('supplier', 'payroll', 'expense', 'loan')`.
- Guard kind: `IF (p_command ->> 'kind') IS NULL OR (p_command ->> 'kind') NOT IN ('loan', 'investment') THEN` — NULL-проверка обязательна (ключ может отсутствовать).
- Миграция должна выполняться дважды подряд без ошибок (идемпотентность).

- [ ] **Step 2: Write the PGlite probe**

Создать `.validation-pglite-20261029/validate-loans-migration.mjs` по образцу `validate-expense-migration.mjs` (роли, auth.users, schema.sql, copySql, двойной `db.exec(migration)`):
- Основное упражнение: bootstrap-компания, cash.post 50 000 000, `loan.set` (zaym 1 000 000), `loan.draw` 600 000 (cash), `loan.repay` 200 000 (cash) → сверка `erp_loan_ledger` (drawn 600 000, repaid 200 000, owed 800 000, available 400 000) с TS `loanLedger` из транслированного `loans.mjs` (добавить `'loans'` в список transpile зонда).
- Rejections: `loan.set` с пустым title (`22023`, /Loan title required/), с плохим kind (`22023`, /Invalid loan kind/), с длинной заметкой (`22023`, /Note is too long/); `loan.draw` на несуществующий займ (`22023`, /Loan not found/), сверх available (`23514`, /Amount exceeds loan balance/); `loan.repay` сверх owed (`23514`, /Amount exceeds loan debt/), сверх баланса счёта (`23514`, /Insufficient account balance/).
- Копия: `erp_backup_dump` содержит `tables.erp_loans` с длиной, равной количеству займов в снимке; восстановление в свежую БД даёт идентичные `loans` и ledger.

- [ ] **Step 3: Run the probe**

Run: `node .validation-pglite-20261029/validate-loans-migration.mjs`
Expected: все PASS, SUMMARY failures: 0, remoteConnections: 0.

- [ ] **Step 4: Regression run of the main probe**

Run: `node .validation-pglite-20261029/validate.mjs`
Expected: PASS (схема не изменилась поведенчески для старых команд).

---

## Task 9: Демо-данные и финальная проверка

**Files:**
- Modify: `src/seed.ts`

- [ ] **Step 1: Добавить демо-займы в seed**

В `src/seed.ts` перед `return state;` (после expense-сидинга) добавить:

```ts
  const loanA = crypto.randomUUID();
  const loanB = crypto.randomUUID();
  state.loans.push(
    { id: loanA, title: 'Jasur aka', kind: 'loan', amount: 10_000_000, note: 'Dastgoh uchun', createdAt: demoNow },
    { id: loanB, title: 'Sardor — investitsiya', kind: 'investment', amount: 5_000_000, note: 'Yangi bo‘limga ulush', createdAt: demoNow },
  );
  state.cash.push(
    { id: crypto.randomUUID(), direction: 'in', amount: 6_000_000, account: 'cash', toAccount: null, source: 'loan', sourceId: loanA, customerId: null, category: 'loan-draw', note: 'Birinchi transh', reversalOf: null, createdAt: `${dateOffset(-12)}T09:00:00.000Z` },
    { id: crypto.randomUUID(), direction: 'out', amount: 2_000_000, account: 'cash', toAccount: null, source: 'loan', sourceId: loanA, customerId: null, category: 'loan-repay', note: 'Qisman qaytarish', reversalOf: null, createdAt: `${dateOffset(-3)}T09:00:00.000Z` },
    { id: crypto.randomUUID(), direction: 'in', amount: 5_000_000, account: 'bank', toAccount: null, source: 'loan', sourceId: loanB, customerId: null, category: 'loan-draw', note: 'Investitsiya tushumi', reversalOf: null, createdAt: `${dateOffset(-15)}T09:00:00.000Z` },
  );
```

(Имена локальных переменных `demoNow`, `dateOffset` сверить с файлом seed.ts.)

- [ ] **Step 2: Полный прогон тестов**

Run: `npm test`
Expected: PASS — все сьюты, включая демо-зависимые.

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: exit 0 (tsc -b + vite build).

- [ ] **Step 4: Браузерная демо-проверка**

Запустить dev-сервер с пустыми `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, в браузере (browser-use MCP) проверить:
- Раздел «Moliya va kassa» → «Zaymlar va investitsiyalar»: метрики Jami/Olingan/Qaytarilgan/Qarzdorlik, две демо-строки с корректными числами (Jasur aka: olingan 6m, mavjud 4m, qaytarilgan 2m, qarzdorlik 8m; Sardor: olingan 5m, qarzdorlik 0).
- Кнопка «Yangi zaym» открывает модалку, сохранение создаёт строку.
- «Pul olish» и «Qaytarish» на Jasur aka работают и меняют цифры.
- Ширина телефона (~390px): таблица превращается в карточки, ничего не обрезается.
- Журнал кассы: источник «Zaym operatsiyasi», категории «Zaym olindi» / «Zaym qaytarildi».
- Отчёт «Hisobotlar»: займовые проводки НЕ входят в tushum/xarajat, но кэш-баланс их учитывает; Majburiyatlar включает займы.

- [ ] **Step 5: Резюме владельцу**

По-русски: что сделано, файлы, результаты проверок, что осталось на удалённое разрешение (миграция живой БД `20261105_loans.sql`, затем публикация dist).
