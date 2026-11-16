# Финансы PRO — под-проект E «Direktor pulti» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран владельца `#/cash/pult`, который одним взглядом показывает: остатки счетов, дебиторку (клиенты, магазины, доступный лимит займов), кредиторку (зарплата, поставщики, расходы, займы), план зарплат и расходов на 3 месяца вперёд и список «E’tibor talab qiladi» с кнопками-переходами; плюс плашка долга в личном отчёте работника.

**Architecture:** Чистая функция `directorConsole(state, asOf?)` над существующими движками (`cashBalance`, `customerLedger`, `payrollDebt`/`salaryLedger`, `supplierDebt`, `expenseLedger`/`expensesDebt`, `loanLedger`/`loansDebt`/`loansAvailable`). Новый модуль `src/console.ts` стоит «над» движками, циклов нет. UI — новый компонент `src/components/DirectorConsole.tsx`, панель `pult` в реестре `src/sections.ts`, ветка в `src/App.tsx`, плашка в `src/components/FinanceStatements.tsx`. Никаких коллекций, команд, SQL, миграций — State остаётся версии 4.

**Tech Stack:** React 19, TypeScript strict, Vite 6, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-11-05-finance-pro-E-design.md` — план реализует её разделы «Расчёт: src/console.ts» (правила 1–6), «Интерфейс» и «Тесты» (10 кейсов console.test.ts, sections.test.ts, mobileCards.test.ts, salary-ui.test.tsx).

## Global Constraints

- TDD-порядок: сначала падающие тесты (RED, смотреть провал), потом минимальный код (GREEN). План делится на пары RED→GREEN.
- E ничего не добавляет в модель данных: `src/types.ts`, `src/migrations.ts`, `src/sync.ts`, `src/seed.ts`, `supabase/schema.sql`, `supabase/migrations/*` НЕ затрагиваются. Никаких миграций живой базы.
- Рабочая папка не Git-репозиторий — шагов «commit» нет; каждый шаг заканчивается прогоном проверки.
- Удалённые шаги (деплой, Supabase) в E отсутствуют — публикация dist идёт в общем пакете разрешений #180, после миграций C/D/B.
- Текст интерфейса — узбекская латиница, валюта UZS, числа через `money()` из `src/ui.tsx`.
- Каждая таблица — обёртка `table-scroll cardable`, каждый `td` с `data-label` (тест `src/mobileCards.test.ts`).
- Панель `pult` — admin-only через общий гейт секций; плашка долга работника — только для не-админа.
- Telegram-код работников остаётся удалённым; напоминания только внутри приложения.
- Демо-проверка UI — с пустыми `VITE_SUPABASE_*` (запись в живую базу запрещена).
- Кодовая база дублирует хелпер `round()`/`nextMonth()` по модулям (см. src/salary.ts, src/expenses.ts) — повторить этот паттерн в `src/console.ts`.

---

### Task 1: RED — доменные тесты консоли `src/console.test.ts`

**Files:**
- Create: `src/console.test.ts`

**Interfaces:**
- Consumes: `emptyState()` из `./domain`; типы `State`, `CashEntry`, `Customer`, `Employee`, `ExpensePlan`, `LoanRow`, `SalaryPlan`, `Shipment`, `ShipmentLine`, `PayrollEntry`, `Purchase`, `PurchaseLine`, `StockMovement` из `./types`.
- Produces: контракт модуля `./console` (ещё не существует): `directorConsole(state, asOf?) → ConsoleReport`, `workerCustomerDebt(state, employeeId) → number`. Формы результата — как в спеце (раздел «Расчёт»).

- [ ] **Step 1: Создать файл теста**

Точное содержимое `src/console.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { directorConsole, workerCustomerDebt } from './console';
import { emptyState } from './domain';
import type {
  CashEntry, Customer, Employee, ExpensePlan, LoanRow, PayrollEntry, Purchase, PurchaseLine,
  SalaryPlan, Shipment, ShipmentLine, State, StockMovement,
} from './types';

function fixture(...rows: Array<Partial<State>>): State {
  const state = emptyState();
  for (const row of rows) Object.assign(state, row);
  return state;
}

const cashEntry = (partial: Partial<CashEntry> & Pick<CashEntry, 'amount' | 'direction'>): CashEntry => ({
  id: crypto.randomUUID(), account: 'cash', toAccount: null, source: 'manual', sourceId: null,
  customerId: null, category: 'manual', note: '', reversalOf: null,
  createdAt: '2026-11-01T00:00:00.000Z', ...partial,
});

const employee = (id: string, name: string, deactivatedAt: string | null = null): Employee =>
  ({ id, name, active: true, deactivatedAt });

const customer = (id: string, kind: Customer['kind'], employeeId: string | null = null): Customer =>
  ({ id, name: `Mijoz ${id}`, phone: '', address: '', kind, employeeId });

const line = (salePrice: number, qty = 1): ShipmentLine =>
  ({ id: crypto.randomUUID(), itemId: null, description: 'Tovar', qty, salePrice, unitCost: 0, materialCost: 0, laborCost: 0, lineId: null });

const shipment = (id: string, customerId: string, revenue: number): Shipment => ({
  id, orderId: null, customerId, kind: 'stock', lines: [line(revenue)], address: '', dueDate: '2026-11-01',
  status: 'delivered', createdAt: '2026-11-01T00:00:00.000Z', deliveredAt: null, reversalOf: null,
});

const salaryPlan = (employeeId: string, amount: number, fromMonth: string): SalaryPlan =>
  ({ id: crypto.randomUUID(), employeeId, amount, fromMonth, createdAt: `${fromMonth}-01T00:00:00.000Z` });

const expensePlan = (planId: string, title: string, amount: number, fromMonth: string, dueDay: number): ExpensePlan =>
  ({ id: crypto.randomUUID(), planId, title, amount, fromMonth, dueDay, supplierId: null, createdAt: `${fromMonth}-01T00:00:00.000Z` });

const loan = (id: string, title: string, amount: number, kind: LoanRow['kind'] = 'loan'): LoanRow =>
  ({ id, title, kind, amount, note: '', createdAt: '2026-11-01T00:00:00.000Z' });

const payroll = (id: string, employeeId: string, amount: number): PayrollEntry =>
  ({ id, employeeId, reportId: 'r1', orderId: 'o1', taskId: 't1', amount, status: 'accepted', createdAt: '2026-11-01T00:00:00.000Z' });

const purchaseLine = (id: string, qty: number, price: number, received: number): PurchaseLine =>
  ({ id, itemId: 'i1', qty, price, received, previousPurchasePrice: price, newPurchasePrice: price, previousAverageCost: price, newAverageCost: price });

const purchase = (id: string, supplierId: string, lines: PurchaseLine[]): Purchase =>
  ({ id, number: 'X-1', supplierId, lines, createdAt: '2026-11-01T00:00:00.000Z' });

const movement = (id: string, sourceId: string, qty: number, unitCost: number): StockMovement =>
  ({ id, itemId: 'i1', direction: 'in', qty, unitCost, source: 'purchase', sourceId, note: '', createdAt: '2026-11-01T00:00:00.000Z' });

describe('director console', () => {
  const asOf = '2026-11-10T12:00:00.000Z';

  it('sums cash and bank balances without double-counting transfers', () => {
    const state = fixture({ cash: [
      cashEntry({ direction: 'in', amount: 100000 }),
      cashEntry({ direction: 'in', amount: 250000, account: 'bank' }),
      cashEntry({ direction: 'transfer', amount: 50000, toAccount: 'bank' }),
    ] });
    expect(directorConsole(state, asOf).balances).toEqual({ cash: 50000, bank: 300000, total: 350000 });
  });

  it('splits receivable between customers and shops and passes the loans available engine through', () => {
    const state = fixture({
      customers: [customer('c1', 'customer'), customer('c2', 'shop'), customer('c3', 'service')],
      shipments: [shipment('s1', 'c1', 400000), shipment('s2', 'c2', 600000), shipment('s3', 'c3', 200000)],
      loans: [loan('l1', 'Bank krediti', 5000000)],
      cash: [cashEntry({ direction: 'in', amount: 3000000, source: 'loan', sourceId: 'l1', category: 'loan-draw' })],
    });
    const report = directorConsole(state, asOf);
    expect(report.receivable.customers).toBe(600000);
    expect(report.receivable.shops).toBe(600000);
    expect(report.receivable.customers + report.receivable.shops).toBe(1200000);
    expect(report.receivable.loansAvailable).toBe(2000000);
  });

  it('sums payroll, supplier, expense and loan debts into one payable total', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      payroll: [payroll('p1', 'e1', 800000)],
      suppliers: [{ id: 's1', name: 'Yetkazib beruvchi', phone: '' }],
      purchases: [purchase('p1', 's1', [purchaseLine('l1', 2, 100000, 2)])],
      movements: [movement('m1', 'p1', 2, 100000)],
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 5)],
      loans: [loan('l1', 'Investitsiya', 4000000, 'investment')],
    });
    const report = directorConsole(state, asOf);
    expect(report.payable).toEqual({
      payroll: 800000, suppliers: 200000, expenses: 700000, loans: 4000000, total: 5700000,
    });
  });

  it('projects three months of salary and expense plans including a plan version change', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      salaryPlans: [salaryPlan('e1', 1500000, '2026-11'), salaryPlan('e1', 1800000, '2027-01')],
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 5)],
    });
    expect(directorConsole(state, asOf).future).toEqual([
      { month: '2026-11', salary: 1500000, expenses: 700000, total: 2200000 },
      { month: '2026-12', salary: 1500000, expenses: 700000, total: 2200000 },
      { month: '2027-01', salary: 1800000, expenses: 700000, total: 2500000 },
    ]);
  });

  it('projects zero for plan-less and deactivated employees in later months', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz'), employee('e2', 'Botir', '2026-11-05')],
      salaryPlans: [salaryPlan('e2', 1500000, '2026-11')],
    });
    const future = directorConsole(state, asOf).future;
    expect(future[0].salary).toBeGreaterThan(0);
    expect(future[1].salary).toBe(0);
    expect(future[2].salary).toBe(0);
  });

  it('flags unpaid expense months with due day and passed marker, paid months stay silent', () => {
    const state = fixture({
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 3), expensePlan('x2', 'Internet', 200000, '2026-11', 25)],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'expense-due', id: 'x1', title: 'Ijara', amount: 700000, hint: '3-kungacha to‘lash', dueDay: 3, passed: true },
      { kind: 'expense-due', id: 'x2', title: 'Internet', amount: 200000, hint: '25-kungacha to‘lash', dueDay: 25, passed: false },
    ]);
    const paid = fixture({
      expensePlans: [expensePlan('x1', 'Ijara', 700000, '2026-11', 3)],
      cash: [cashEntry({ direction: 'out', amount: 700000, source: 'expense', sourceId: 'x1', category: 'expense' })],
    });
    expect(directorConsole(paid, asOf).attention).toEqual([]);
  });

  it('flags loans with an outstanding balance, largest first, fully repaid stay silent', () => {
    const state = fixture({
      loans: [loan('l1', 'Kredit', 5000000), loan('l2', 'Investitsiya', 2000000, 'investment'), loan('l3', 'Kichik qarz', 3000000)],
      cash: [cashEntry({ direction: 'out', amount: 2000000, source: 'loan', sourceId: 'l2', category: 'loan-repay' })],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'loan-owed', id: 'l1', title: 'Kredit', amount: 5000000, hint: 'Zaym qaytarilishi kerak' },
      { kind: 'loan-owed', id: 'l3', title: 'Kichik qarz', amount: 3000000, hint: 'Zaym qaytarilishi kerak' },
    ]);
  });

  it('flags worker customers with debt using the employee name, others stay silent', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      customers: [customer('c1', 'customer', 'e1'), customer('c2', 'customer')],
      shipments: [shipment('s1', 'c1', 500000), shipment('s2', 'c2', 300000)],
    });
    expect(directorConsole(state, asOf).attention).toEqual([
      { kind: 'worker-debt', id: 'c1', title: 'Aziz', amount: 500000, hint: 'Xodimning material va xizmat qarzi' },
    ]);
  });

  it('returns the worker card debt or zero without a card', () => {
    const state = fixture({
      employees: [employee('e1', 'Aziz')],
      customers: [customer('c1', 'customer', 'e1')],
      shipments: [shipment('s1', 'c1', 500000)],
    });
    expect(workerCustomerDebt(state, 'e1')).toBe(500000);
    expect(workerCustomerDebt(state, 'nobody')).toBe(0);
  });

  it('handles an empty company with zero months and no attention', () => {
    const report = directorConsole(emptyState(), asOf);
    expect(report.balances).toEqual({ cash: 0, bank: 0, total: 0 });
    expect(report.receivable).toEqual({ customers: 0, shops: 0, loansAvailable: 0 });
    expect(report.payable).toEqual({ payroll: 0, suppliers: 0, expenses: 0, loans: 0, total: 0 });
    expect(report.future).toEqual([
      { month: '2026-11', salary: 0, expenses: 0, total: 0 },
      { month: '2026-12', salary: 0, expenses: 0, total: 0 },
      { month: '2027-01', salary: 0, expenses: 0, total: 0 },
    ]);
    expect(report.attention).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают по нужной причине**

Run: `npx vitest run src/console.test.ts`
Expected: FAIL — `Failed to resolve import "./console"` (модуль не существует). Это правильный RED: тесты падают из-за отсутствия реализации, не из-за опечаток.

---

### Task 2: GREEN — модуль `src/console.ts`

**Files:**
- Create: `src/console.ts`

**Interfaces:**
- Consumes: `cashBalance`, `payrollDebt`, `supplierDebt` из `./domain`; `customerLedger` из `./receivables`; `salaryLedger` из `./salary`; `expenseLedger`, `expensesDebt` из `./expenses`; `loanLedger`, `loansDebt`, `loansAvailable` из `./loans`; типы из `./types`.
- Produces: `ConsoleReport`, `FutureMonth`, `AttentionKind`, `AttentionItem`, `directorConsole`, `workerCustomerDebt` — потребляются Task 3–4.

- [ ] **Step 1: Написать минимальную реализацию**

Точное содержимое `src/console.ts`:

```ts
import { cashBalance, payrollDebt, supplierDebt } from './domain';
import { expenseLedger, expensesDebt } from './expenses';
import { loanLedger, loansDebt, loansAvailable } from './loans';
import { customerLedger } from './receivables';
import { salaryLedger } from './salary';
import type { State } from './types';

const round = (value: number): number => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;

const nextMonth = (month: string): string => {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface ConsoleReport {
  balances: { cash: number; bank: number; total: number };
  receivable: { customers: number; shops: number; loansAvailable: number };
  payable: { payroll: number; suppliers: number; expenses: number; loans: number; total: number };
  future: FutureMonth[];
  attention: AttentionItem[];
}

export interface FutureMonth { month: string; salary: number; expenses: number; total: number }

export type AttentionKind = 'expense-due' | 'loan-owed' | 'worker-debt';

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  title: string;
  amount: number;
  hint: string;
  dueDay?: number;
  passed?: boolean;
}

export function directorConsole(state: State, asOf?: string): ConsoleReport {
  const iso = asOf ?? new Date().toISOString();
  const month = iso.slice(0, 7);
  const day = Number(iso.slice(8, 10));

  const cash = round(cashBalance(state, 'cash'));
  const bank = round(cashBalance(state, 'bank'));
  const customers = round(state.customers.filter(row => row.kind !== 'shop')
    .reduce((sum, row) => sum + customerLedger(state, row.id).debt, 0));
  const shops = round(state.customers.filter(row => row.kind === 'shop')
    .reduce((sum, row) => sum + customerLedger(state, row.id).debt, 0));
  const payroll = round(state.employees.reduce((sum, row) => sum + payrollDebt(state, row.id), 0));
  const suppliers = round(state.suppliers.reduce((sum, row) => sum + supplierDebt(state, row.id), 0));
  const expenses = round(expensesDebt(state));
  const loans = round(loansDebt(state));

  const future: FutureMonth[] = [];
  let cursor = month;
  for (let i = 0; i < 3; i++) {
    const at = `${cursor}-01T00:00:00.000Z`;
    const salary = round(state.employees.reduce((sum, row) =>
      sum + (salaryLedger(state, row.id, at).months.at(-1)?.obliged ?? 0), 0));
    const monthlyExpenses = round([...new Set(state.expensePlans.map(row => row.planId))]
      .reduce((sum, planId) => sum + (expenseLedger(state, planId, at).months.at(-1)?.obliged ?? 0), 0));
    future.push({ month: cursor, salary, expenses: monthlyExpenses, total: round(salary + monthlyExpenses) });
    cursor = nextMonth(cursor);
  }

  const attention: AttentionItem[] = [];
  for (const planId of [...new Set(state.expensePlans.map(row => row.planId))]) {
    const ledger = expenseLedger(state, planId, iso);
    const row = ledger.months.find(entry => entry.month === month);
    if (!row || row.unpaid <= 0.005) continue;
    const versions = state.expensePlans.filter(entry => entry.planId === planId)
      .sort((left, right) => left.fromMonth.localeCompare(right.fromMonth) || left.createdAt.localeCompare(right.createdAt));
    const dueDay = versions.at(-1)?.dueDay ?? 1;
    attention.push({
      kind: 'expense-due', id: planId, title: ledger.title, amount: round(row.unpaid),
      hint: `${dueDay}-kungacha to‘lash`, dueDay, passed: dueDay < day,
    });
  }
  for (const row of state.loans) {
    const ledger = loanLedger(state, row.id);
    if (ledger.owed <= 0.005) continue;
    attention.push({
      kind: 'loan-owed', id: row.id, title: row.title, amount: round(ledger.owed),
      hint: row.kind === 'loan' ? 'Zaym qaytarilishi kerak' : 'Investitsiya qaytarilishi kerak',
    });
  }
  for (const row of state.customers) {
    if (!row.employeeId) continue;
    const debt = round(customerLedger(state, row.id).debt);
    if (debt <= 0.005) continue;
    const owner = state.employees.find(entry => entry.id === row.employeeId);
    attention.push({
      kind: 'worker-debt', id: row.id, title: owner?.name ?? row.name, amount: debt,
      hint: 'Xodimning material va xizmat qarzi',
    });
  }
  attention.sort((left, right) => {
    const order: Record<AttentionKind, number> = { 'expense-due': 0, 'loan-owed': 1, 'worker-debt': 2 };
    if (order[left.kind] !== order[right.kind]) return order[left.kind] - order[right.kind];
    if (left.kind === 'expense-due') {
      if (left.passed !== right.passed) return left.passed ? -1 : 1;
      return (left.dueDay ?? 0) - (right.dueDay ?? 0);
    }
    return right.amount - left.amount;
  });

  return {
    balances: { cash, bank, total: round(cash + bank) },
    receivable: { customers, shops, loansAvailable: round(loansAvailable(state)) },
    payable: { payroll, suppliers, expenses, loans, total: round(payroll + suppliers + expenses + loans) },
    future,
    attention,
  };
}

export function workerCustomerDebt(state: State, employeeId: string): number {
  const customer = state.customers.find(row => row.employeeId === employeeId);
  if (!customer) return 0;
  return round(customerLedger(state, customer.id).debt);
}
```

- [ ] **Step 2: Запустить тесты — все должны пройти**

Run: `npx vitest run src/console.test.ts`
Expected: PASS — 10/10.

- [ ] **Step 3: Проверить, что ничего из существующего не сломано**

Run: `npx vitest run src/domain.test.ts src/salary.test.ts src/expenses.test.ts src/loans.test.ts src/receivables.test.ts`
Expected: PASS (модуль новый, существующие движки не менялись — контрольная прогонка).

---

### Task 3: RED — UI-тесты (sections, mobileCards, salary-ui)

**Files:**
- Modify: `src/sections.test.ts` — 2 новых кейса
- Modify: `src/mobileCards.test.ts` — строка в `tableFiles`
- Modify: `src/salary-ui.test.tsx` — 1 новый кейс рендера плашки

**Interfaces:**
- Consumes: `panelsFor`, `defaultPanel`, `routeHash` из `./sections`; `phoneRules`, `pixelValues` из `./mobileStyle`; `FinanceStatements` из `./components/FinanceStatements` (модуль уже импортирован namespace-ом `FinanceStatementsModule`); `renderToStaticMarkup`/`createElement` (уже импортированы).

- [ ] **Step 1: Добавить тесты панели в `src/sections.test.ts`**

В `describe('section panels', ...)` после кейса «adds the monthly expense panel…» добавить:

```ts
  it('adds the director console panel to the cash section', () => {
    expect(panelsFor('cash', true).map(panel => panel.id)).toContain('pult');
    expect(defaultPanel('cash', true)).toBe('kassa');
  });
```

В `describe('hash routes', ...)` после кейса «builds shareable hashes» добавить:

```ts
  it('builds the director console hash', () => {
    expect(routeHash({ section: 'cash', panel: 'pult' })).toBe('#/cash/pult');
  });
```

- [ ] **Step 2: Добавить строку в `src/mobileCards.test.ts`**

В массив `tableFiles` (после `'components/Diagnostics.tsx',` вставить по алфавиту между `'components/CustomerCard.tsx',` и `'components/Diagnostics.tsx',`):

```ts
  'components/DirectorConsole.tsx',
```

- [ ] **Step 3: Добавить кейс рендера плашки в `src/salary-ui.test.tsx`**

В конец `describe('salary UI regressions', ...)` добавить (импорт `FinanceStatements` берётся из уже существующего `FinanceStatementsModule`):

```ts
  it('shows the worker debt callout on the salary tab when the customer card owes money', () => {
    const state = emptyState();
    state.employees = [{ id: 'e1', name: 'Aziz', active: true }];
    state.customers = [{ id: 'c1', name: 'Aziz', phone: '', address: '', kind: 'customer', employeeId: 'e1' }];
    state.shipments = [{
      id: 's1', orderId: null, customerId: 'c1', kind: 'stock',
      lines: [{ id: 'l1', itemId: null, description: 'Material', qty: 2, salePrice: 250000, unitCost: 0, materialCost: 0, laborCost: 0, lineId: null }],
      address: '', dueDate: '2026-11-01', status: 'delivered', createdAt: '2026-11-01T00:00:00.000Z', deliveredAt: null, reversalOf: null,
    }];
    const markup = renderToStaticMarkup(createElement(FinanceStatementsModule.FinanceStatements, {
      state, actor: { id: 'e1', name: 'Aziz', role: 'worker', companyId: state.companyId }, search: '',
    }));
    expect(markup).toContain('Sizning qarzingiz');
    expect(markup).toContain('To‘lov ish haqidan ushlab qolinadi');

    const clean = emptyState();
    clean.employees = [{ id: 'e1', name: 'Aziz', active: true }];
    const cleanMarkup = renderToStaticMarkup(createElement(FinanceStatementsModule.FinanceStatements, {
      state: clean, actor: { id: 'e1', name: 'Aziz', role: 'worker', companyId: clean.companyId }, search: '',
    }));
    expect(cleanMarkup).not.toContain('Sizning qarzingiz');
  });
```

- [ ] **Step 4: Запустить и убедиться, что все три падают по нужной причине**

Run: `npx vitest run src/sections.test.ts src/mobileCards.test.ts src/salary-ui.test.tsx`
Expected: FAIL —
- sections.test.ts: «director console panel» — `toContain('pult')` не выполняется (панели нет в реестре); «director console hash» — `routeHash` вернёт `#/cash/pult` уже сейчас (это чистый роут) — этот кейс может пройти; важно, что панельный кейс падает.
- mobileCards.test.ts: `readFileSync(... 'components/DirectorConsole.tsx')` — ENOENT (файла нет).
- salary-ui.test.tsx: «Sizning qarzingiz» не найден в разметке (плашки нет).
Ожидаемая причина провала — отсутствие реализации, не опечатки.

---

### Task 4: GREEN — UI (sections, DirectorConsole, App, FinanceStatements, styles)

**Files:**
- Modify: `src/sections.ts` — панель `pult` в секции cash после `zaymlar`
- Create: `src/components/DirectorConsole.tsx`
- Modify: `src/App.tsx` — импорт, Title-условие, ветка `panel === 'pult'`
- Modify: `src/components/FinanceStatements.tsx` — импорт `CircleAlert` и `workerCustomerDebt`, плашка в вкладке salary
- Modify: `src/styles.css` — одно правило `.attention>.attention-note`

**Interfaces:**
- Consumes: `directorConsole` из `../console`; `Metric`, `Section`, `Empty`, `money` из `../ui`; `go`/`show` из App; `CircleAlert` из `lucide-react`.
- Produces: компонент `DirectorConsole` с props `{ state, onGo, onPayExpense, onRepayLoan, onOpenCustomer }` — потребляется App.tsx.

- [ ] **Step 1: Панель в реестре `src/sections.ts`**

Строку секции cash заменить:

```ts
  { id: 'cash', title: 'Moliya va kassa', panels: [{ id: 'kassa', title: 'Kassa' }, { id: 'xarajatlar', title: 'Oylik xarajatlar' }, { id: 'zaymlar', title: 'Zaymlar va investitsiyalar' }, { id: 'pult', title: 'Direktor pulti' }, { id: 'hisobotlar', title: 'Hisobotlar' }] },
```

- [ ] **Step 2: Компонент `src/components/DirectorConsole.tsx`**

Точное содержимое:

```tsx
import { Banknote, ChevronRight, CircleAlert, Layers, Wallet } from 'lucide-react';
import { directorConsole } from '../console';
import type { State } from '../types';
import { Empty, Metric, Section, money } from '../ui';

const monthLabel = (key: string): string =>
  new Date(`${key}-02T00:00:00`).toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' });

export function DirectorConsole({ state, onGo, onPayExpense, onRepayLoan, onOpenCustomer }: {
  state: State;
  onGo: (section: string, panel: string) => void;
  onPayExpense: (planId: string) => void;
  onRepayLoan: (loanId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const report = directorConsole(state);
  return <>
    <div className="metrics three">
      <Metric label="Naqd pul" value={money(report.balances.cash)} detail="Qayerda pul bor — faktik qoldiqlar" icon={Banknote} accent />
      <Metric label="Bank / karta" value={money(report.balances.bank)} detail="O‘tkazmalar foyda yaratmaydi" icon={Wallet} />
      <Metric label="Jami pul" value={money(report.balances.total)} detail="Naqd va bank hisoblari birga" icon={Layers} />
    </div>
    <div className="dashboard-grid">
      <Section title="Nima kelishi kerak" hint="Kimdan qancha pul kelishi kutilmoqda">
        <div className="debt-list">
          <button onClick={() => onGo('orders', 'mijozlar')}><div><b>Mijozlar qarzi</b><small>Oddiy mijozlar va xizmat buyurtmachilari</small></div><strong>{money(report.receivable.customers)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('shops', 'hisob-kitob')}><div><b>Do‘konlar qarzi</b><small>Do‘konlarga yuborilgan mahsulot</small></div><strong>{money(report.receivable.shops)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'zaymlar')}><div><b>Zaymdan olish mumkin</b><small>Ochilmagan zaym limiti</small></div><strong>{money(report.receivable.loansAvailable)}</strong><ChevronRight size={16} /></button>
        </div>
      </Section>
      <Section title="Kimga qarzdormiz" hint="Sizning majburiyatlaringiz — hammasi bitta summada">
        <div className="debt-list">
          <button onClick={() => onGo('people', 'oylik')}><div><b>Ish haqi</b><small>Xodimlarga to‘lanishi kerak</small></div><strong>{money(report.payable.payroll)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('purchases', 'yetkazib-beruvchilar')}><div><b>Yetkazib beruvchilar</b><small>Qabul qilingan materiallar uchun</small></div><strong>{money(report.payable.suppliers)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'xarajatlar')}><div><b>Oylik xarajatlar</b><small>Ijara, kommunal va boshqalar</small></div><strong>{money(report.payable.expenses)}</strong><ChevronRight size={16} /></button>
          <button onClick={() => onGo('cash', 'zaymlar')}><div><b>Zaymlar</b><small>Qaytarilishi kerak bo‘lgan summa</small></div><strong>{money(report.payable.loans)}</strong><ChevronRight size={16} /></button>
        </div>
        <div className="settings-facts"><span>Jami majburiyatlar<b>{money(report.payable.total)}</b></span></div>
      </Section>
    </div>
    <Section title="Kelgusi oylar" hint="Reja — hali pul emas, faqat majburiyatlarning ko‘rinishi">
      <div className="table-scroll cardable"><table>
        <thead><tr><th>Oy</th><th className="right">Ish haqi rejasi</th><th className="right">Xarajatlar rejasi</th><th className="right">Jami</th></tr></thead>
        <tbody>{report.future.map(row => <tr key={row.month}>
          <td data-label="Oy">{monthLabel(row.month)}</td>
          <td data-label="Ish haqi rejasi" className="right">{money(row.salary)}</td>
          <td data-label="Xarajatlar rejasi" className="right">{money(row.expenses)}</td>
          <td data-label="Jami" className="right"><b>{money(row.total)}</b></td>
        </tr>)}</tbody>
      </table></div>
    </Section>
    <Section title="E’tibor talab qiladi" hint="Hozir qaralishi kerak bo‘lgan to‘lovlar">
      {report.attention.length ? <div className="mini-cards">{report.attention.map(item => <article key={`${item.kind}-${item.id}`}>
        <div><b>{item.title}</b><small>{item.hint}{item.passed ? <em className="debt"> · muddat o‘tgan</em> : null}</small></div>
        <strong>{money(item.amount)}</strong>
        {item.kind === 'expense-due' && <button className="secondary small" onClick={() => onPayExpense(item.id)}>To‘lash</button>}
        {item.kind === 'loan-owed' && <button className="secondary small" onClick={() => onRepayLoan(item.id)}>Qaytarish</button>}
        {item.kind === 'worker-debt' && <button className="secondary small" onClick={() => onOpenCustomer(item.id)}>Karta</button>}
      </article>)}</div> : <Empty text="E’tibor talab qiladigan narsa yo‘q" />}
    </Section>
  </>;
}
```

- [ ] **Step 3: Интеграция в `src/App.tsx`**

1. Рядом с другими импортами компонентов (например, после `import { LoansPanel } ...`) добавить:

```ts
import { DirectorConsole } from './components/DirectorConsole';
```

2. В строке с Title секции cash (L540) расширить условие пропуска:

```tsx
{panel !== 'xarajatlar' && panel !== 'zaymlar' && panel !== 'pult' && <Title .../>}
```

3. В цепочке веток L541 добавить ветку `pult` перед финальным `<>` (kassa fallback):

```tsx
... : panel === 'pult' ? <>
  <Title eyebrow="MOLIYA / DIREKTOR PULTI" title="Pul qayerda, nima keladi va kimga qarzdormiz." description="Bitta ekranda qoldiqlar, debitor va kreditor qarzlar, kelgusi oy rejalari va e’tibor ro‘yxati." />
  <DirectorConsole state={state} onGo={go} onPayExpense={id => show('expensePay', id)} onRepayLoan={id => show('loanRepay', id)} onOpenCustomer={id => show('customerCard', id)} />
</> : <> ...
```

- [ ] **Step 4: Плашка долга работника в `src/components/FinanceStatements.tsx`**

1. Импорт: в строке `import { ChevronRight } from 'lucide-react';` → `import { ChevronRight, CircleAlert } from 'lucide-react';`
2. Добавить импорт модуля: `import { workerCustomerDebt } from '../console';`
3. После `const selectedSupplier = ...` (перед `const changeKind`) добавить:

```ts
  const workerDebt = admin ? 0 : workerCustomerDebt(state, actor.id);
```

4. В начало фрагмента `{activeTab === 'salary' && <>` (L197, перед `<div className="table-scroll cardable">`) вставить:

```tsx
      {!admin && workerDebt > 0 && <div className="attention">
        <div className="attention-note">
          <span className="attention-icon amber"><CircleAlert size={20} /></span>
          <div><b>Sizning qarzingiz — {money(workerDebt)}</b><small>To‘lov ish haqidan ushlab qolinadi.</small></div>
        </div>
      </div>}
```

- [ ] **Step 5: Одно CSS-правило в `src/styles.css`**

После строки `.attention>button>svg{...}` (рядом с блоком `.attention`) добавить строку:

```css
.attention>.attention-note{display:flex;align-items:center;gap:11px;padding:14px 0;border-top:1px solid #edf0e7}
```

(типографика `b`/`small` внутри `.attention` уже существует; `.attention-icon amber` существует; мобильный padding `.attention` уже переопределён в media-блоке)

- [ ] **Step 6: Запустить UI-тесты — все должны пройти**

Run: `npx vitest run src/sections.test.ts src/mobileCards.test.ts src/salary-ui.test.tsx`
Expected: PASS.

---

### Task 5: Полная проверка E

**Files:** нет (только проверки).

- [ ] **Step 1: Весь набор тестов**

Run: `npm test`
Expected: PASS — все файлы, включая новый `console.test.ts` (10 кейсов).

- [ ] **Step 2: Сборка**

Run: `npm run build`
Expected: exit 0 (допустимо известное предупреждение о размере чанка).

- [ ] **Step 3: PGlite-зонды (контрольный прогон, SQL не менялся)**

Run: в каталоге зондов (найти через `ls -d .validation-*`) `node validate.mjs` и `node validate-worker-deductions.mjs`
Expected: PASS по всем проверкам (448 + 13) — подтверждает, что SQL-паритет не тронут.

- [ ] **Step 4: Браузер, демо-режим (пустые `VITE_SUPABASE_*`)**

1. `npm run dev` (если ещё не запущен), открыть приложение, войти как «Egasi».
2. Перейти `#/cash/pult`: проверить заголовок «Pul qayerda, nima keladi va kimga qarzdormiz.», метрики «Naqd pul» / «Bank / karta» / «Jami pul», блоки «Nima kelishi kerak», «Kimga qarzdormiz», таблицу «Kelgusi oylar» (3 строки), блок «E’tibor talab qiladi» (в демо-сиде есть расходы и займы — строки с кнопками «To‘lash» / «Qaytarish»; при пустом списке — Empty).
3. Проверить переходы кнопок: «Mijozlar qarzi» → `#/orders/mijozlar`; «Do‘konlar qarzi» → `#/shops/hisob-kitob`; «Zaymdan olish mumkin» → `#/cash/zaymlar`; «Ish haqi» → `#/people/oylik`; «Yetkazib beruvchilar» → `#/purchases/yetkazib-beruvchilar`; «Oylik xarajatlar» → `#/cash/xarajatlar`.
4. Сходимость с дашбордом: «Jami pul» метрики пульта = метрика дашборда «Kassa va hisoblarda»; «Jami majburiyatlar» = метрика кассы «Majburiyatlar».
5. Мобильная карточка 390px: проверенным приёмом (клонировать `.table-scroll.cardable` таблицы «Kelgusi oylar» в контейнер `#m390` шириной 390px со скоупленным мобильным CSS `@media(max-width:700px)` cardable-блоком) убедиться: `scrollWidth <= 391`, `thead` скрыт, `td::before` выводит `data-label`.
6. Плашка работника: переключить демо-профиль на работника (Yig‘uvchi) → «Mening hisobim» — если у работника в демо-сиде есть клиентская карта с долгом, плашка «Sizning qarzingiz — …» видна; если долга нет — плашки нет (рендер покрыт salary-ui.test.tsx).

- [ ] **Step 5: Отчёт владельцу на русском**

Краткий отчёт: что появилось, файлы, результаты проверок, что удалённых шагов E не требует (публикация dist — в пакете #180 после миграций C/D/B).

---

## Self-Review

**Spec coverage:**
- Решение 1 (только чтение) — Task 2 не трогает типы/команды/SQL; Task 5 Step 3 подтверждает зондами.
- Решение 2 (четыре блока) — Task 4 Step 2.
- Решение 3 (движки для будущих месяцев) — Task 2 `future` через `salaryLedger`/`expenseLedger` с `asOf = m-01`.
- Решение 4 (E’tibor talab qiladi + кнопки) — Task 2 attention + Task 4 Step 2 кнопки `onPayExpense`/`onRepayLoan`/`onOpenCustomer`.
- Решение 5 (плашка работника) — Task 4 Step 4 + Task 3 Step 3.
- Решение 6 (admin-only) — панель в секции cash админского реестра, `panelsFor('cash', false)` не содержит pult автоматически; плашка — только `!admin`.
- Решение 7 (нет виртуального сальдо) — отчёта о прибыли в компоненте нет.
- Тесты спеки: 10 кейсов console.test.ts (Task 1), sections (Task 3 Step 1), mobileCards (Task 3 Step 2), salary-ui (Task 3 Step 3).
- Критерии готовности — Task 5 (сходимость с дашбордом в браузере, пустая компания в кейсе 10, 390px-карточка, admin-only).

**Placeholder scan:** нет TBD/TODO; весь код приведён дословно.

**Type consistency:** `directorConsole(state, asOf?)`/`workerCustomerDebt(state, employeeId)` в Task 2 совпадают с вызовами Task 1 и Task 3; props `DirectorConsole` в Task 4 Step 2 совпадают с передачей в Task 4 Step 3.
