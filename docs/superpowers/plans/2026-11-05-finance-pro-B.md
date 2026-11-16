# Finance PRO B: «Xodim — mijoz sifatida» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работник покупает услуги/материалы как обычный клиент (карточка клиента связана с работником через `employeeId`), а владелец погашает долг работника безналичным удержанием из зарплаты — одной командой, которая одновременно уменьшает долг клиента и долг по зарплате.

**Architecture:** Derived-state, как у зарплаты и расходов. Удержание — факт в коллекции `workerDeductions` (направления `deduct`/`refund` + `reversalOf`, как у кассы). Движок `src/salary.ts` (`netted`) включает удержания в пул выплат, `src/receivables.ts` (`customerLedger`) — в пул оплат. Касса не трогается. Сервер зеркалит: колонка `employee_id` в `erp_customers`, таблица `erp_worker_deductions`, PL/pgSQL-правки `erp_salary_ledger`/`erp_customer_advance`/`erp_order_paid`, кейсы в `erp_execute`, секция в `erp_snapshot`, RLS.

**Tech Stack:** TypeScript strict, React 19, Vite 6, Vitest 3, Supabase/Postgres + PGlite-пробы.

**Spec:** docs/superpowers/specs/2026-11-05-finance-pro-B-design.md

## Global Constraints

- Рабочая папка НЕ Git-репозиторий: шагов «commit» нет, каждый таск заканчивается проверками (vitest / build / PGlite).
- TDD обязателен: сначала падающий тест (RED с ожидаемой причиной), затем минимальный код (GREEN). Код до теста — переписать.
- «Текущую систему не ломать»: после каждого таска — прицельный прогон; после UI-тасков дополнительно полный `npm test` и `npm run build`.
- Удалённые изменения (миграция живой БД, `npm run deploy`) вне плана — только по отдельному разрешению владельца (итоговый батч-запрос). Порядок выката: миграция базы (C → D → B) → публикация dist.
- UI-копии на узбекском (латиница), суммы в UZS; отчёты владельцу — по-русски с точными путями и проверками.
- Демо-проверка UI только с пустыми `VITE_SUPABASE_*` (без записи в живые данные).
- Команды `salary.deduct`, `salary.deduct.reverse`, `customer.link` — только админ: общий гейт в `applyCommand` (src/domain.ts L1361-1364) уже пропускает все команды кроме `work.accept`/`work.start`/`work.submit` — новых гейтов не добавлять.
- `State.version` остаётся 4. Новых Account-значений не вводить. Кассовый журнал удержания не трогают (безналичные).
- Ошибки домена/сервера: `Employee not found`, `Customer not found`, `Employee already has a customer account`, `Employee has no customer account`, `Amount exceeds customer debt`, `Amount exceeds salary debt`, `Deduction not found`, `Deduction already reversed`, `Amount must be positive`, `Invalid amount`, `Note is too long`.
- Новые коллекции в `State` — только через нормализацию `Array.isArray(source.X) ? source.X : []` в `src/migrations.ts`; в строгий массив `collections` НЕ добавлять (старые снимки не должны ломаться).

---

## Task 1: Типы и инфраструктура

**Files:**
- Modify: `src/types.ts` — `Customer.employeeId`, `WorkerDeduction`, `State.workerDeductions`, команды
- Modify: `src/domain.ts` — `emptyState()` += `workerDeductions: []`
- Modify: `src/migrations.ts` — lift `workerDeductions`, нормализация `employeeId`
- Modify: `src/sync.ts` — `arrays` += `'workerDeductions'`
- Modify: `supabase/functions/_shared/backup.ts` — `STATE_COLLECTIONS` += `workerDeductions: 'erp_worker_deductions'`
- Test: `src/migrations.test.ts`, `src/sync.test.ts`

**Interfaces:**
- Produces: `Customer { id, name, phone, address, kind, employeeId: string | null }`; `WorkerDeduction { id, employeeId, customerId, amount, direction: 'deduct' | 'refund', note, reversalOf: string | null, createdAt }`; `State.workerDeductions: WorkerDeduction[]`; команды с точными сигнатурами ниже.

- [ ] **Step 1: RED — тест лифта в migrations.test.ts**

В `src/migrations.test.ts` после теста loans добавить (касты нужны, пока типов нет — иначе tsc не скомпилирует RED):

```ts
it('adds workerDeductions and normalizes customer employeeId for old snapshots', () => {
  const snapshot = JSON.parse(JSON.stringify(emptyState())) as State & { workerDeductions?: unknown };
  delete snapshot.workerDeductions;
  const migrated = migrateState(snapshot);
  expect((migrated as State & { workerDeductions?: unknown }).workerDeductions).toEqual([]);
  expect((migrated.customers[0] as Customer & { employeeId?: unknown }).employeeId).toBeNull();
});
```

- [ ] **Step 2: RED — контракт снэпшота в sync.test.ts**

В `src/sync.test.ts` после describe `loans snapshot contract` добавить (образец тот же):

```ts
describe('workerDeductions snapshot contract', () => {
  it('keeps the cached snapshot when the server omits workerDeductions', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect((first.state as State & { workerDeductions?: unknown }).workerDeductions).toEqual([]);
    f.strip('workerDeductions');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without workerDeductions', async () => {
    const f = setup(); f.online(true); f.strip('workerDeductions');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`
Expected: FAIL — `migrated.workerDeductions` undefined, `employeeId` undefined.

- [ ] **Step 4: Write minimal implementation**

`src/types.ts`:
- В `Customer` (строка `export interface Customer { id: string; name: string; phone: string; address: string; kind: CustomerKind }`) добавить `employeeId: string | null;`.
- После `LoanRow` добавить:

```ts
export interface WorkerDeduction {
  id: string;
  employeeId: string;
  customerId: string;
  amount: number;
  direction: 'deduct' | 'refund';
  note: string;
  reversalOf: string | null;
  createdAt: string;
}
```

- В `State` после `loans: LoanRow[]` добавить `workerDeductions: WorkerDeduction[]`.
- В union `Command`:
  - в варианте `customer.create` добавить `employeeId?: string | null`:
    `| { type: 'customer.create'; name: string; phone: string; address: string; kind: CustomerKind; employeeId?: string | null }`
  - после `loan.repay` добавить:

```ts
  | { type: 'customer.link'; customerId: string; employeeId: string | null }
  | { type: 'salary.deduct'; employeeId: string; amount: number; note: string }
  | { type: 'salary.deduct.reverse'; deductionId: string }
```

`src/domain.ts` в `emptyState()` после `loans: [],` добавить `workerDeductions: [],`.

`src/migrations.ts`:
- В маппинге customers (строка `const customers = (source.customers as Customer[]).map(customer => ({ ...customer, kind: ... }))`) добавить в возвращаемый объект `employeeId: customer.employeeId ?? null,`.
- После строки `loans: Array.isArray(source.loans) ? source.loans : [],` добавить:

```ts
    workerDeductions: Array.isArray(source.workerDeductions) ? source.workerDeductions : [],
```

`src/sync.ts`: в массив `arrays` (L25) после `'loans'` добавить `'workerDeductions'`.

`supabase/functions/_shared/backup.ts`: в `STATE_COLLECTIONS` (L120-125) добавить `workerDeductions: 'erp_worker_deductions',` рядом с `loans`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Fix compile fallout**

Run: `npx tsc -b`
Expected: ошибки во всех местах, где `Customer` собирается литералом без `employeeId` (например, `src/receivables.test.ts` L26, возможные фикстуры в `src/statements.test.ts` / `src/analytics.test.ts` / `src/seed.ts` — если такие есть). В каждом литерале добавить `employeeId: null`. Повторять `npx tsc -b` до чистого выхода.

- [ ] **Step 7: Targeted regression**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts src/domain.test.ts src/receivables.test.ts src/salary.test.ts`
Expected: PASS (все существующие тесты зелёные).

---

## Task 2: Движок зарплаты — netted() и личный отчёт работника

**Files:**
- Modify: `src/salary.ts` — `netted()` включает удержания
- Modify: `src/statements.ts` — `salaryStatements`: удержания в `payments` и в `lastPaidAt`
- Test: `src/salary.test.ts`, `src/statements.test.ts`

**Interfaces:**
- Consumes: `State.workerDeductions` из Task 1.
- Produces: `salaryLedger().owed/paidTotal` учитывают удержания; `SalaryRow.payments` включает удержания как `PaymentRow { kind?: 'deduction' }`.

- [ ] **Step 1: RED — тесты движка в salary.test.ts**

В `src/salary.test.ts` после фикстур добавить хелпер и describe:

```ts
function deduction(amount: number, createdAt: string, direction: 'deduct' | 'refund' = 'deduct', reversalOf: string | null = null): WorkerDeduction {
  return { id: crypto.randomUUID(), employeeId: 'e1', customerId: 'c1', amount, direction, note: '', reversalOf, createdAt };
}

describe('worker deductions count as salary payments', () => {
  it('reduces owed and raises paidTotal like a cash payment', () => {
    const base = fixture({ salaryPlans: [plan(1200000, startMonth)] });
    expect(salaryLedger(base, 'e1', `${YEAR}-11-30T12:00:00.000Z`).owed).toBe(1200000);
    const withDeduction = fixture({
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [deduction(300000, `${YEAR}-11-10T09:00:00.000Z`)],
    });
    const ledger = salaryLedger(withDeduction, 'e1', `${YEAR}-11-30T12:00:00.000Z`);
    expect(ledger.owed).toBe(900000);
    expect(ledger.paidTotal).toBe(300000);
    expect(ledger.months[0].paid).toBe(300000);
  });

  it('reversing a deduction restores the balance', () => {
    const original = deduction(300000, `${YEAR}-11-10T09:00:00.000Z`);
    const state = fixture({
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [original, deduction(300000, `${YEAR}-11-12T09:00:00.000Z`, 'refund', original.id)],
    });
    expect(salaryLedger(state, 'e1', `${YEAR}-11-30T12:00:00.000Z`).owed).toBe(1200000);
  });

  it('a deduction before the plan boundary lands in carryOver', () => {
    const state = fixture({
      payroll: [entry(340000, `${YEAR}-10-05T09:00:00.000Z`)],
      salaryPlans: [plan(1200000, startMonth)],
      workerDeductions: [deduction(140000, `${YEAR}-10-20T09:00:00.000Z`)],
    });
    const ledger = salaryLedger(state, 'e1', `${YEAR}-11-30T12:00:00.000Z`);
    expect(ledger.carryOver).toBe(200000);
    expect(ledger.carryOverPaid).toBe(0);
    expect(ledger.owed).toBe(1400000);
  });
});
```

Дополнить импорт типов в `src/salary.test.ts`: `WorkerDeduction`.

- [ ] **Step 2: RED — тесты личного отчёта в statements.test.ts**

В `src/statements.test.ts` добавить (использовать существующий стиль фикстур этого файла):

```ts
it('includes worker deductions in the salary statement payments and paid total', () => {
  // состояние: работник e1, план оклада или начисленный payroll, кассовая выплата отсутствует,
  // удержание 300000 за текущий период
  // → row.paid = 300000, row.payments.length = 1, payments[0].kind === 'deduction'
});
```

Точная сборка состояния — по образцу существующих тестов файла (`salaryStatements(state, from, to)`; при необходимости поднять `emptyState()` и заполнить `employees`/`salaryPlans`/`workerDeductions` вручную).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/salary.test.ts src/statements.test.ts`
Expected: FAIL — `owed` не меняется от удержаний; `payments` пуст.

- [ ] **Step 4: Write minimal implementation**

`src/salary.ts` — заменить тело `netted` (L26-33):

```ts
function netted(state: State, employeeId: string, before?: string): number {
  const cashNet = state.cash.reduce((total, row) => {
    if (row.source !== 'payroll' || row.sourceId !== employeeId) return total;
    if (row.direction !== 'in' && row.direction !== 'out') return total;
    if (before && !(row.createdAt < before)) return total;
    return total + (row.direction === 'out' ? row.amount : -row.amount);
  }, 0);
  const deductionNet = state.workerDeductions.reduce((total, row) => {
    if (row.employeeId !== employeeId) return total;
    if (before && !(row.createdAt < before)) return total;
    return total + (row.direction === 'deduct' ? row.amount : -row.amount);
  }, 0);
  return round(cashNet + deductionNet);
}
```

`src/statements.ts`:
- В `PaymentRow` добавить `kind?: 'cash' | 'deduction';`.
- Добавить хелпер после `paymentRows`:

```ts
function deductionPaymentRows(state: State, employeeId: string, from: string, to: string): PaymentRow[] {
  return state.workerDeductions
    .filter(row => row.employeeId === employeeId && withinPeriod(row.createdAt, from, to))
    .map(row => ({
      id: row.id,
      date: row.createdAt,
      amount: round(row.direction === 'deduct' ? row.amount : -row.amount),
      account: 'cash',
      note: row.note,
      reversalOf: row.reversalOf,
      reversed: state.workerDeductions.some(reversal => reversal.reversalOf === row.id),
      kind: 'deduction',
    }));
}
```

- В `salaryStatements` заменить `const payments = paymentRows(state, match, false, from, to);` на:

```ts
const payments = [...paymentRows(state, match, false, from, to),
  ...deductionPaymentRows(state, employee.id, from, to)].sort(byDateDesc);
```

- `lastPaidAt` (L30-35): после вычисления кассовой даты добавить:

```ts
const lastDeductionAt = state.workerDeductions
  .filter(row => row.employeeId === employee.id && row.direction === 'deduct')
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? null;
```

и в возврате `salaryStatements` заменить `lastPaidAt: lastPaymentAt(state, match, false),` на `lastPaidAt: [lastPaymentAt(state, match, false), lastDeductionAt].filter(Boolean).sort().at(-1) ?? null,`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/salary.test.ts src/statements.test.ts`
Expected: PASS.

- [ ] **Step 6: Targeted regression**

Run: `npx vitest run src/salary.test.ts src/statements.test.ts src/domain.test.ts src/receivables.test.ts src/reports.test.ts`
Expected: PASS.

---

## Task 3: Реестр клиента — пул оплат с удержаниями

**Files:**
- Modify: `src/receivables.ts` — `customerLedger()`: пул оплат += нетто-удержания
- Test: `src/receivables.test.ts`

**Interfaces:**
- Consumes: `State.workerDeductions` из Task 1.

- [ ] **Step 1: RED — тесты реестра в receivables.test.ts**

В `src/receivables.test.ts` после describe `customer ledger` добавить:

```ts
describe('worker deductions in the customer ledger', () => {
  it('counts a deduction as a payment that closes debt FIFO', () => {
    const state = fixtureWithShipments([100000, 80000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push({
      id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 150000,
      direction: 'deduct', note: 'Material uchun', reversalOf: null, createdAt: '2026-10-15T00:00:00Z',
    });
    const ledger = customerLedger(state, 'customer-1');
    expect(ledger.shipments.map(row => row.outstanding)).toEqual([0, 30000]);
    expect(ledger.debt).toBe(30000);
    expect(ledger.paid).toBe(150000);
  });

  it('reversing a deduction restores the debt', () => {
    const state = fixtureWithShipments([100000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push(
      { id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 60000, direction: 'deduct', note: '', reversalOf: null, createdAt: '2026-10-15T00:00:00Z' },
      { id: 'ref-1', employeeId: 'e1', customerId: 'customer-1', amount: 60000, direction: 'refund', note: '', reversalOf: 'ded-1', createdAt: '2026-10-16T00:00:00Z' },
    );
    expect(customerLedger(state, 'customer-1').debt).toBe(100000);
  });

  it('a deduction beyond the debt lands in advance', () => {
    const state = fixtureWithShipments([50000]);
    state.customers[0].employeeId = 'e1';
    state.workerDeductions.push({
      id: 'ded-1', employeeId: 'e1', customerId: 'customer-1', amount: 70000,
      direction: 'deduct', note: '', reversalOf: null, createdAt: '2026-10-15T00:00:00Z',
    });
    expect(customerLedger(state, 'customer-1')).toMatchObject({ debt: 0, advance: 20000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/receivables.test.ts`
Expected: FAIL — удержания не влияют на `debt`/`paid`/`advance`.

- [ ] **Step 3: Write minimal implementation**

`src/receivables.ts` в `customerLedger` — после вычисления кассовых платежей (строки 23-25, где `const payments = state.cash...`) добавить:

```ts
  const deductionPayments = state.workerDeductions
    .filter(row => row.customerId === customerId)
    .reduce((total, row) => total + (row.direction === 'deduct' ? row.amount : -row.amount), 0);
  let available = Math.max(0, round(payments + deductionPayments));
```

(существующую строку `let available = Math.max(0, round(payments));` заменить на приведённую выше).
И в возврате `paid: Math.max(0, round(payments)),` заменить на `paid: Math.max(0, round(payments + deductionPayments)),`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/receivables.test.ts`
Expected: PASS.

- [ ] **Step 5: Targeted regression**

Run: `npx vitest run src/receivables.test.ts src/domain.test.ts src/analytics.test.ts src/documents.test.ts`
Expected: PASS.

---

## Task 4: Команды домена

**Files:**
- Modify: `src/domain.ts` — `customer.create` (employeeId), `customer.link`, `salary.deduct`, `salary.deduct.reverse`
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: команды из Task 1; `customerLedger`/`salaryLedger` уже импортированы в domain.ts.
- Produces: `salary.deduct` возвращает id удержания; `salary.deduct.reverse` — id сторно; `customer.link` — customerId.

- [ ] **Step 1: RED — тесты команд в domain.test.ts**

В `src/domain.test.ts` после тестов loans добавить describe (использовать существующие `run`/`atomic` и фикстуру):

```ts
describe('worker as customer', () => {
  it('customer.create links an employee and rejects a missing or taken employee', () => {
    const state = fixture();
    const employeeId = state.employees[0].id;
    const created = run(state, { type: 'customer.create', name: 'Usta hisobi', phone: '', address: '', kind: 'customer', employeeId });
    const row = state.customers.find(customer => customer.id === created)!;
    expect(row.employeeId).toBe(employeeId);
    atomic(state, { type: 'customer.create', name: 'Ghost', phone: '', address: '', kind: 'customer', employeeId: 'missing' });
    expect(() => run(state, { type: 'customer.create', name: 'Ghost', phone: '', address: '', kind: 'customer', employeeId }))
      .toThrow('Employee already has a customer account');
  });

  it('customer.link attaches and detaches the link', () => {
    const state = fixture();
    const customerId = state.customers[0].id;
    const employeeId = state.employees[0].id;
    const otherId = state.employees[1].id;
    expect(run(state, { type: 'customer.link', customerId, employeeId })).toBe(customerId);
    expect(state.customers[0].employeeId).toBe(employeeId);
    atomic(state, { type: 'customer.link', customerId, employeeId: otherId });
    atomic(state, { type: 'customer.link', customerId, employeeId: 'missing' });
    expect(() => run(state, { type: 'customer.link', customerId: 'missing', employeeId: null })).toThrow('Customer not found');
    expect(run(state, { type: 'customer.link', customerId, employeeId: null })).toBe(customerId);
    expect(state.customers[0].employeeId).toBeNull();
  });

  it('salary.deduct offsets both ledgers and enforces both caps', () => {
    const state = fixture();
    const employeeId = state.employees[0].id;
    const customerId = run(state, { type: 'customer.create', name: 'Usta hisobi', phone: '', address: '', kind: 'customer', employeeId });
    // долг клиента: отгрузка на 2000 (в фикстуре есть customerId и items)
    run(state, { type: 'shipment.createStock', customerId, lines: [{ itemId: state.items[0].id, qty: 1 }], dueDate: '2026-11-20', allowDebt: true });
    // note: stock-отгрузка может требовать остаток; если да — используем состояние из существующего теста отгрузок с долгом
    const debt = customerLedger(state, customerId).debt;
    expect(debt).toBeGreaterThan(0);
    // зарплатный долг: принятая работа (в фикстуре есть route/заказы) или salary plan
    const owedBefore = payrollDebt(state, employeeId);
    expect(owedBefore).toBeGreaterThan(0);
    const amount = Math.min(debt, owedBefore, 500);
    const deductionId = run(state, { type: 'salary.deduct', employeeId, amount, note: 'Material uchun' });
    expect(state.workerDeductions.find(row => row.id === deductionId)).toMatchObject({
      employeeId, customerId, amount, direction: 'deduct', reversalOf: null,
    });
    expect(customerLedger(state, customerId).debt).toBe(debt - amount);
    expect(payrollDebt(state, employeeId)).toBe(owedBefore - amount);
    atomic(state, { type: 'salary.deduct', employeeId, amount: debt + 1, note: '' });
    atomic(state, { type: 'salary.deduct', employeeId, amount: owedBefore + 1, note: '' });
  });

  it('salary.deduct rejects a worker without a customer account', () => {
    const state = fixture();
    atomic(state, { type: 'salary.deduct', employeeId: state.employees[0].id, amount: 100, note: '' });
  });

  it('salary.deduct.reverse restores both ledgers and cannot run twice', () => {
    // фикстура как выше: создать карточку, долг, удержание; затем
    const refundId = run(state, { type: 'salary.deduct.reverse', deductionId });
    expect(state.workerDeductions.find(row => row.id === refundId)).toMatchObject({
      direction: 'refund', reversalOf: deductionId, amount,
    });
    expect(customerLedger(state, customerId).debt).toBe(debt);
    expect(payrollDebt(state, employeeId)).toBe(owedBefore);
    atomic(state, { type: 'salary.deduct.reverse', deductionId });
    atomic(state, { type: 'salary.deduct.reverse', deductionId: 'missing' });
  });

  it('salary.deduct is admin-only', () => {
    const state = fixture();
    // worker-актор из фикстуры: run(state, command, worker) кидает 'Administrator action required'
  });
});
```

Примечание: если `shipment.createStock` в этой фикстуре требует остаток/`allowDebt` иначе, чем описано, — собрать долг тем же способом, что существующие тесты отгрузок в `domain.test.ts` (найти тест с `allowDebt` и переиспользовать его построение).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain.test.ts`
Expected: FAIL — `customer.create` с `employeeId` игнорирует поле; `customer.link`/`salary.deduct`/`salary.deduct.reverse` — unknown command.

- [ ] **Step 3: Write minimal implementation**

`src/domain.ts` — добавить хелпер рядом с `customerKind`:

```ts
function checkWorkerLink(state: State, employeeId: string, excludeCustomerId?: string): void {
  find(state.employees, employeeId, 'Employee');
  check(!state.customers.some(customer => customer.id !== excludeCustomerId && customer.employeeId === employeeId),
    'Employee already has a customer account');
}
```

Заменить case `customer.create` (L646-650):

```ts
    case 'customer.create': {
      const employeeId = command.employeeId ?? null;
      if (employeeId !== null) checkWorkerLink(state, employeeId);
      const row = { id: uuid(), name: named(state.customers, command.name), phone: command.phone, address: command.address, kind: customerKind(command.kind), employeeId };
      state.customers.push(row);
      return row.id;
    }
    case 'customer.link': {
      const customer = find(state.customers, command.customerId, 'Customer');
      const employeeId = command.employeeId ?? null;
      if (employeeId !== null) checkWorkerLink(state, employeeId, customer.id);
      customer.employeeId = employeeId;
      return customer.id;
    }
```

Добавить после `loan.repay` case-ы:

```ts
    case 'salary.deduct': {
      const employee = find(state.employees, command.employeeId, 'Employee');
      const customer = state.customers.find(row => row.employeeId === employee.id);
      check(customer, 'Employee has no customer account');
      check(command.amount > 0, 'Amount must be positive');
      money(command.amount);
      check(command.note.length <= 200, 'Note is too long');
      check(command.amount <= customerLedger(state, customer.id).debt + 0.004, 'Amount exceeds customer debt');
      check(command.amount <= salaryLedger(state, employee.id).owed + 0.004, 'Amount exceeds salary debt');
      const row: WorkerDeduction = {
        id: uuid(), employeeId: employee.id, customerId: customer.id, amount: command.amount,
        direction: 'deduct', note: command.note, reversalOf: null, createdAt: now(),
      };
      state.workerDeductions.push(row);
      return row.id;
    }
    case 'salary.deduct.reverse': {
      const row = state.workerDeductions.find(entry => entry.id === command.deductionId && entry.direction === 'deduct');
      check(row, 'Deduction not found');
      check(!state.workerDeductions.some(entry => entry.reversalOf === row.id), 'Deduction already reversed');
      const refund: WorkerDeduction = {
        id: uuid(), employeeId: row.employeeId, customerId: row.customerId, amount: row.amount,
        direction: 'refund', note: '', reversalOf: row.id, createdAt: now(),
      };
      state.workerDeductions.push(refund);
      return refund.id;
    }
```

Импорт `WorkerDeduction` в `src/domain.ts` добавить в существующий `import type` из `./types`.

Примечание про админ-гейт: ничего не добавлять — `applyCommand` (L1361-1364) уже требует admin для всех команд кроме `work.*`. RED-тест admin-gate должен это подтвердить.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: PASS (все файлы зелёные).

---

## Task 5: UI — панель зарплаты, модалка, бейджи, карточка клиента

**Files:**
- Modify: `src/components/SalaryPanel.tsx` — рефактор распределения, `salaryDeductionRows`, строки удержаний, кнопка `Ish haqidan ushlash`
- Modify: `src/App.tsx` — проп `onDeduct`, модалка `salaryDeduct` + `SalaryDeductForm` (рядом с `SalaryPayForm` L673), `modalTitle`
- Modify: `src/analytics.ts` — `CustomerDetail.deductions`
- Modify: `src/components/CustomerCard.tsx` — строки удержаний в «To‘lovlar tarixi», бейдж в subtle-note
- Modify: `src/components/CustomerPicker.tsx` — ` · Xodim` в строке выбора
- Modify: `src/components/FinanceStatements.tsx` — ветка `kind === 'deduction'` в `Payments` (L57-68), бейдж в списке клиентов (L227)
- Test: `src/salary-ui.test.tsx`

**Interfaces:**
- Produces: `salaryDeductionRows(state, employeeId, month, planStartMonth?)` → `WorkerDeduction[]` (копии с урезанными суммами по FIFO месяца).

- [ ] **Step 1: RED — тест salaryDeductionRows в salary-ui.test.tsx**

В `src/salary-ui.test.tsx` (стиль — как существующий тест `salaryPaymentRows`) добавить:

```ts
const deductionRows = (SalaryPanelModule as unknown as { salaryDeductionRows?: (state: State, employeeId: string, month: string | null, planStartMonth?: string) => WorkerDeduction[] }).salaryDeductionRows!;

describe('salaryDeductionRows', () => {
  it('splits deductions across months by FIFO like payments', () => {
    // состояние: план оклада 600000 на 2026-11, удержание 900000 в 2026-11 → месяцу 2026-11 достаётся 600000,
    // carryOver (accrued до плана) закрывается первым, остаток уходит в следующий месяц
    // при month = '2026-11' → rows.length === 1, amount === 600000
  });

  it('ignores refunded deductions and refunds', () => {
    // deduct + refund(reversalOf) → rows пусто
  });
});
```

Точные ожидания строить по тем же данным, что существующий тест распределения `salaryPaymentRows` (переиспользовать его фикстуру).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/salary-ui.test.tsx`
Expected: FAIL — `salaryDeductionRows` is not a function.

- [ ] **Step 3: Write minimal implementation — SalaryPanel.tsx**

1. Рефактор общего распределения (поведение `salaryPaymentRows` не меняется):

```ts
interface SalaryDisplayRow { id: string; createdAt: string; amount: number }

function allocateSalaryRows<T extends SalaryDisplayRow>(state: State, employeeId: string, month: string | null, planStartMonth: string | undefined, rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!month) {
    return sorted.filter(row => !planStartMonth || row.createdAt < `${planStartMonth}-01T00:00:00.000Z`).reverse();
  }
  const ledger = salaryLedger(state, employeeId);
  if (!ledger.months.length) {
    return sorted.filter(row => row.createdAt.slice(0, 7) === month).reverse();
  }
  const boundary = `${ledger.months[0].month}-01T00:00:00.000Z`;
  let carryOver = state.payroll.reduce((sum, row) => row.employeeId === employeeId
    && row.status === 'accepted' && row.createdAt < boundary ? sum + row.amount : sum, 0);
  const remaining = new Map(ledger.months.map(row => [row.month, row.obliged]));
  const allocated: T[] = [];
  for (const row of sorted) {
    let available = row.amount;
    const toCarryOver = Math.min(available, carryOver);
    carryOver -= toCarryOver;
    available -= toCarryOver;
    for (const obligation of ledger.months) {
      if (available <= 0) break;
      const amount = Math.min(available, remaining.get(obligation.month)!);
      remaining.set(obligation.month, remaining.get(obligation.month)! - amount);
      available -= amount;
      if (obligation.month === month && amount > 0) allocated.push({ ...row, amount } as T);
    }
  }
  return allocated.reverse();
}

export function salaryPaymentRows(state: State, employeeId: string, month: string | null, planStartMonth?: string): CashEntry[] {
  return allocateSalaryRows(state, employeeId, month, planStartMonth, state.cash
    .filter(row => row.source === 'payroll' && row.sourceId === employeeId && row.direction === 'out')
    .filter(row => !state.cash.some(reversal => reversal.reversalOf === row.id)));
}

export function salaryDeductionRows(state: State, employeeId: string, month: string | null, planStartMonth?: string): WorkerDeduction[] {
  return allocateSalaryRows(state, employeeId, month, planStartMonth, state.workerDeductions
    .filter(row => row.employeeId === employeeId && row.direction === 'deduct')
    .filter(row => !state.workerDeductions.some(reversal => reversal.reversalOf === row.id)));
}
```

(Старое тело `salaryPaymentRows` удаляется — его логика перенесена в `allocateSalaryRows` 1:1.)

2. Деталь месяца: после `<tbody>{payments.map(...)}` добавить строки удержаний:

```tsx
{deductions.map(row => <tr key={row.id}>
  <td data-label="Sana">{date(row.createdAt)}</td>
  <td data-label="Kategoriya">Ish haqidan ushlab qolindi</td>
  <td data-label="Izoh">{row.note || '—'}</td>
  <td data-label="Summa" className="right">{money(row.amount)}</td>
</tr>)}
```

где `const deductions = salaryDeductionRows(state, employee.id, month?.month ?? null, ledger.months[0]?.month);` рядом со строкой `const payments = ...` (L101). Условие пустоты таблицы (L111) заменить на `!payments.length && !deductions.length`.

3. Кнопка удержания в действиях строки (L88-91), между «Oylik belgilash» и «To‘lash»:

```tsx
<button className="secondary small" disabled={ledger.owed <= 0 || !state.customers.some(row => row.employeeId === employee.id)}
  onClick={() => onDeduct(employee.id)}>Ish haqidan ushlash</button>
```

Сигнатура компонента: `export default function SalaryPanel({ state, onPay, onPlan, onDeduct }: { state: State; onPay: (employeeId: string) => void; onPlan: (employeeId: string) => void; onDeduct: (employeeId: string) => void })`.

- [ ] **Step 4: App.tsx — проп, модалка, форма**

- L530: `onDeduct={id => show('salaryDeduct', id)}` в `<SalaryPanel ...>`.
- В `modalTitle` добавить case `'salaryDeduct': 'Ish haqidan ushlab qolish'` (найти функцию в App.tsx).
- После `SalaryPayForm` (L673-691) добавить компонент по образцу:

```tsx
export function SalaryDeductForm({ state, employeeId, busy, close, save }: { state: State; employeeId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void> }) {
  const employee = state.employees.find(row => row.id === employeeId);
  const customer = state.customers.find(row => row.employeeId === employeeId);
  const debt = customer ? customerLedger(state, customer.id).debt : 0;
  const owed = payrollDebt(state, employeeId);
  const payable = Math.min(debt, owed);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ type: 'salary.deduct', employeeId, amount: number(form, 'amount'), note: text(form, 'note') }); }}>
    <div className="form-body">
      <div className="payment-due"><small>Ushlash mumkin</small><strong>{money(payable)}</strong></div>
      <div className="settings-facts">
        <span>Xodim<b>{employee?.name}</b></span>
        <span>Mijoz hisobi<b>{customer?.name ?? '—'}</b></span>
        <span>Mijoz qarzi<b>{money(debt)}</b></span>
        <span>Ish haqi qoldig‘i<b>{money(owed)}</b></span>
      </div>
      <Amount name="amount" defaultValue={payable || undefined} max={payable || undefined} />
      <Field label="Izoh"><input name="note" maxLength={200} autoFocus /></Field>
      <p className="subtle-note">Summa naqd pulsiz: mijoz qarzi va ish haqi qarzi bir vaqtda kamayadi. Kassa o‘zgarmaydi.</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy || payable <= 0}>{busy ? 'Saqlanmoqda…' : 'Ushlab qolish'}</button></footer>
  </form>;
}
```

- Сторно: рядом со строками удержаний в детали месяца — кнопка-иконка «Storno» у строк удержаний, если у них нет сторно. Минимально: в SalaryPanel деталь месяца под таблицей для каждого не-сторнированного удержания месяца — кнопка `Storno` (secondary small), вызов `onReverseDeduction(row.id)` (новый проп SalaryPanel; App: `show('salaryDeductReverse', id)` и модалка-подтверждение, которая шлёт `{ type: 'salary.deduct.reverse', deductionId }` через существующий `submitSimple`-подобный путь с подтверждением «Storno qilish»). Если `SalaryPanel` не имеет доступа к кнопкам сторно без лишнего пропа — допустимо вынести строку сторно в ту же таблицу (колонка Amallar).
- Модалки в разметке App (рядом с L593-598): `{modal.type === 'salaryDeduct' && <SalaryDeductForm state={state} employeeId={modal.id!} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />}`; для reverse — `{modal.type === 'salaryDeductReverse' && (() => { const deduction = state.workerDeductions.find(row => row.id === modal.id); return deduction ? <Dialog ...>...кнопка, вызывающая run({ type: 'salary.deduct.reverse', deductionId: deduction.id })...</Dialog> : null; })()}` — текст: «Ushlab qolishni bekor qilish» / «Storno qilish» / «Bekor qilish».
- Импорт `customerLedger` в App.tsx уже есть (`payrollDebt` тоже — проверить; если нет, добавить).

- [ ] **Step 5: analytics.ts + CustomerCard.tsx — удержания в истории оплат**

`src/analytics.ts` в `CustomerDetail` добавить поле `deductions: WorkerDeduction[];` и в `customerDetail` (L176-189):

```ts
  const deductions = state.workerDeductions.filter(row => row.customerId === customerId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
```

и в return `deductions`. Импорт `WorkerDeduction` в type-import.

`src/components/CustomerCard.tsx`:
- В «To‘lovlar tarixi» объединить списки:

```tsx
const paymentRows = [
  ...detail.payments.map(row => ({ ...row, kind: 'cash' as const })),
  ...detail.deductions.map(row => ({ ...row, kind: 'deduction' as const })),
].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
```

- В `<tbody>`: ветка `row.kind === 'deduction'`:

```tsx
<tr key={row.id}>
  <td data-label="Sana">{date(row.createdAt)}</td>
  <td data-label="Kategoriya"><b>Ish haqidan ushlab qolindi</b>{row.note && <small>{row.note}</small>}</td>
  <td data-label="Hisob">—</td>
  <td data-label="Summa" className={`right ${row.direction === 'refund' ? 'debt' : 'positive'}`}>{row.direction === 'refund' ? '−' : '+'}{money(row.amount)}</td>
</tr>
```

- Empty-условие секции — по `paymentRows.length`.
- В subtle-note (L40): после `customerKindLabel(...)` добавить `{detail.customer.employeeId ? ' · Xodim' : ''}`.

- [ ] **Step 6: Бейджи «Xodim» в списках и выборе клиента**

- `src/components/CustomerPicker.tsx` L46 и L61: к строкам `{customerKindLabel(...)}` добавить `{customer.employeeId ? ' · Xodim' : ''}`.
- `src/components/FinanceStatements.tsx` L227: `<small>{customerKindLabel(row.kind)}{row.employeeId ? ' · Xodim' : ''}</small>`.
- Список клиентов в `src/App.tsx` (~L487): рядом с подписью kind добавить ` · Xodim` при `employeeId` (найти строку рендера клиентов в панели «Mijozlar»).

- [ ] **Step 7: Payments-рендер в FinanceStatements.tsx**

В `Payments` (L57-68) заменить ячейку Hisob:

```tsx
<td data-label="Hisob">{row.kind === 'deduction' ? 'Ish haqidan ushlab qolindi' : row.account === 'cash' ? 'Naqd pul' : 'Bank / karta'}</td>
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/salary-ui.test.tsx`
Expected: PASS.

- [ ] **Step 9: Full suite + build**

Run: `npm test`
Expected: PASS.
Run: `npm run build`
Expected: exit 0 (допустим только существующий warning о размере чанка).

---

## Task 6: Сервер — schema.sql, миграция, PGlite-зонды

**Files:**
- Modify: `supabase/schema.sql` — колонка+индекс, таблица, правки функций и кейсов, снимок, GRANT
- Create: `supabase/migrations/20261105_worker_deductions.sql`
- Create: `.validation-pglite-20261029/validate-worker-deductions.mjs`
- Modify: `.validation-pglite-20261029/validate.mjs`
- Test: запуск зондов

**Interfaces:**
- Consumes: поведение TS-домена из Task 4 (тексты ошибок должны совпадать с SQL дословно).

- [ ] **Step 1: schema.sql — таблицы и индексы**

После определения `erp_customers` (L15+) добавить (в разделе таблиц, рядом с `erp_loans`):

```sql
CREATE TABLE public.erp_worker_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  employee_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  amount numeric(14, 2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('deduct', 'refund')),
  note text NOT NULL DEFAULT '',
  reversal_of uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES public.erp_customers(company_id, id)
);

ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS employee_id uuid
  REFERENCES public.erp_employees(id);

CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_employee_idx
  ON public.erp_customers(company_id, employee_id) WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS erp_worker_deductions_company_idx
  ON public.erp_worker_deductions(company_id, employee_id, created_at);

ALTER TABLE public.erp_worker_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY erp_admin_read ON public.erp_worker_deductions FOR ALL
  USING (public.erp_is_admin()) WITH CHECK (public.erp_is_admin());
```

(свериться с образцом RLS у `erp_loans` — политики/GRANT по тому же шаблону).

- [ ] **Step 2: schema.sql — erp_salary_ledger**

В `erp_salary_ledger` (L1088+):
- В `DECLARE` добавить `v_deduct numeric := 0;`
- После SELECT `v_payments` (L1110-1112) добавить:

```sql
  SELECT coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0) INTO v_deduct
    FROM public.erp_worker_deductions
   WHERE company_id = p_company AND employee_id = p_employee;
  v_payments := round(v_payments + v_deduct, 2);
```

- После SELECT `v_paid_before` (L1131-1134) добавить:

```sql
  SELECT coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0) INTO v_deduct
    FROM public.erp_worker_deductions
   WHERE company_id = p_company AND employee_id = p_employee
     AND created_at < ((v_start || '-01')::timestamp AT TIME ZONE 'UTC');
  v_paid_before := round(v_paid_before + v_deduct, 2);
```

- [ ] **Step 3: schema.sql — erp_customer_advance и erp_order_paid**

В `erp_customer_advance` (L602-617) заменить SELECT `v_payments`:

```sql
  SELECT round(coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0)
    + coalesce((SELECT sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END)
      FROM public.erp_worker_deductions WHERE company_id = p_company_id AND customer_id = p_customer_id), 0), 2)
    INTO v_payments
    FROM public.erp_cash WHERE company_id = p_company_id AND source = 'sale' AND customer_id = p_customer_id;
```

В `erp_order_paid` (L619+) — та же замена в его SELECT `v_payments` (L626-627), с `customer_id = v_customer`.

- [ ] **Step 4: schema.sql — erp_execute кейсы**

- В `DECLARE` erp_execute добавить недостающие переменные (сверить с существующими; если `v_customer`/`v_amount` уже есть — не дублировать): `v_employee uuid; v_shipped numeric := 0; v_paid_by_cash numeric := 0; v_paid_by_deduct numeric := 0;`
- Case `customer.create` (L1569-1574) заменить:

```sql
    WHEN 'customer.create' THEN
      v_kind := coalesce(p_command ->> 'kind', 'customer');
      IF v_kind NOT IN ('customer', 'shop', 'service') THEN RAISE EXCEPTION 'Invalid customer kind' USING ERRCODE = '22023'; END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_190) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee := NULL;
      END IF;
      INSERT INTO public.erp_customers(company_id, name, phone, address, kind, employee_id) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true),
        public.erp_text(p_command -> 'address', 'address', true), v_kind, v_employee) RETURNING id INTO v_entity;
```

(внимание: в блоке выше `v_190` — опечатка-маркер; везде должно быть `v_employee`. При реализации использовать `v_employee`.)

- После case `loan.repay` добавить:

```sql
    WHEN 'customer.link' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_employee AND id <> v_entity) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee := NULL;
      END IF;
      UPDATE public.erp_customers SET employee_id = v_employee WHERE company_id = v_company AND id = v_entity;
    WHEN 'salary.deduct' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      SELECT id INTO v_customer FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_entity;
      IF v_customer IS NULL THEN RAISE EXCEPTION 'Employee has no customer account' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      IF v_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = '22023'; END IF;
      IF char_length(coalesce(p_command ->> 'note', '')) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      SELECT coalesce(sum(round(l.qty * l.sale_price, 2)), 0) INTO v_shipped
        FROM public.erp_shipments s
        JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
       WHERE s.company_id = v_company AND s.customer_id = v_customer AND s.status <> 'cancelled';
      SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0) INTO v_paid_by_cash
        FROM public.erp_cash WHERE company_id = v_company AND source = 'sale' AND customer_id = v_customer;
      SELECT coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0) INTO v_paid_by_deduct
        FROM public.erp_worker_deductions WHERE company_id = v_company AND customer_id = v_customer;
      IF v_amount > greatest(0, round(v_shipped - v_paid_by_cash - v_paid_by_deduct, 2)) THEN
        RAISE EXCEPTION 'Amount exceeds customer debt' USING ERRCODE = '22023';
      END IF;
      IF v_amount > (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds salary debt' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, created_at)
        VALUES (v_company, v_entity, v_customer, v_amount, 'deduct', btrim(coalesce(p_command ->> 'note', '')), CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
    WHEN 'salary.deduct.reverse' THEN
      v_entity := public.erp_uuid(p_command -> 'deductionId', 'deductionId');
      SELECT employee_id, customer_id, amount INTO v_employee, v_customer, v_amount
        FROM public.erp_worker_deductions
       WHERE company_id = v_company AND id = v_entity AND direction = 'deduct';
      IF NOT FOUND THEN RAISE EXCEPTION 'Deduction not found' USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_worker_deductions WHERE company_id = v_company AND reversal_of = v_entity) THEN
        RAISE EXCEPTION 'Deduction already reversed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, reversal_of, created_at)
        VALUES (v_company, v_employee, v_customer, v_amount, 'refund', '', v_entity, CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
```

- [ ] **Step 5: schema.sql — erp_snapshot**

- В секции `customers` снимка (L1261-1266): в `jsonb_build_object` добавить `'employeeId', c.employee_id,` (после `'kind', c.kind`).
- После секции `'loans'` (L1354-1356) добавить:

```sql
      'workerDeductions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'employeeId', d.employee_id,
        'customerId', d.customer_id, 'amount', d.amount, 'direction', d.direction,
        'note', d.note, 'reversalOf', d.reversal_of, 'createdAt', d.created_at) ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_worker_deductions d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id)),
```

- В `GRANT ... TO authenticated` (L2598) добавить `public.erp_worker_deductions` в список таблиц (по образцу остальных `erp_*`).

- [ ] **Step 6: Миграция supabase/migrations/20261105_worker_deductions.sql**

Создать идемпотентный файл по образцу `20261105_loans.sql`:
1. `ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.erp_employees(id);` + `CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_employee_idx ...`;
2. `CREATE TABLE IF NOT EXISTS public.erp_worker_deductions (...)` + индексы + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS`/`CREATE POLICY` (как в образце миграции loans);
3. DO-блок починки колонки (если старая таблица без неё) — не нужен, колонка добавляется ALTER'ом;
4. Полная замена функций `erp_snapshot()`, `erp_execute()`, `erp_salary_ledger()`, `erp_customer_advance()`, `erp_order_paid()` — `CREATE OR REPLACE FUNCTION` с телами, скопированными дословно из обновлённого `schema.sql` (техника C/D-миграций);
5. GRANT-ы как в schema.sql.

Применяется к живой базе только по отдельному разрешению.

- [ ] **Step 7: PGlite-зонд validate-worker-deductions.mjs**

Создать по образцу `validate-cd-order.mjs`:
- применить `schema.sql` + copySql + миграции C → D → B, затем их повторно (идемпотентность: `pass('C, D and B migrations apply twice each without errors (idempotent in live order)')`);
- bootstrap компании; создать работника, клиента с `employeeId` (customer.create с полем), план оклада, отгрузку с долгом;
- `salary.deduct` на сумму в пределах обоих потолков → сравнить `erp_salary_ledger(...)->>'owed'` с TS-ожиданием; проверить, что `erp_customer_advance`/долг клиента уменьшились на ту же сумму;
- отказ: `salary.deduct` сверх долга клиента → текст `Amount exceeds customer debt`; сверх зарплатного долга → `Amount exceeds salary debt`; без карточки → `Employee has no customer account`;
- `salary.deduct.reverse` → оба баланса восстановлены; повторный reverse → `Deduction already reversed`;
- круг `snapshot → дамп → восстановление` с удержаниями (в дампе таблица `erp_worker_deductions` покрывается каталогом `erp_backup_dump` автоматически);
- вывод: N PASS / 0 failures.

- [ ] **Step 8: validate.mjs**

- В список транспилируемых модулей добавить `workerDeductions` — нет, это коллекция State, не модуль: вместо этого добавить упражнения команд `customer.link` / `salary.deduct` / `salary.deduct.reverse` в существующую секцию упражнений validate.mjs (как для loan.*) и таблицу `erp_worker_deductions` в protections-список (счётчик 29 → 30).

- [ ] **Step 9: Run probes**

Run: `node .validation-pglite-20261029/validate-worker-deductions.mjs`
Expected: все PASS, 0 failures.
Run: `node .validation-pglite-20261029/validate.mjs`
Expected: 439+ PASS, счётчик команд вырос, protections 30.

- [ ] **Step 10: Полная проверка**

Run: `npm test` (все файлы), затем `npm run build` (exit 0).
Expected: PASS / exit 0.

---

## Task 7: Демо-сид и финальная проверка

**Files:**
- Modify: `src/seed.ts`
- Test: `npm test`, `npm run build`, браузер-проверка

- [ ] **Step 1: Демо-сид**

В `createDemo` после блока займов (L117-125) добавить:

```ts
  const workerCustomer = state.customers[2] ?? state.customers[0];
  // новая карточка для активного работника Yig‘uvchi:
  const workerCustomerId = (() => { run({ type: 'customer.create', name: 'Yig‘uvchi — shaxsiy hisob', phone: '', address: '', kind: 'customer', employeeId: state.employees[1].id }); return state.customers.at(-1)!.id; })();
  const workerShipmentId = crypto.randomUUID();
  state.shipments.push({
    id: workerShipmentId, orderId: null, customerId: workerCustomerId, kind: 'stock',
    lines: [{ id: crypto.randomUUID(), itemId: null, description: 'Ustaga material', qty: 1, salePrice: 800000, unitCost: 0, materialCost: 0, laborCost: 0 }],
    address: '', dueDate: dateOffset(2), status: 'delivered', createdAt: `${dateOffset(-8)}T10:00:00.000Z`, deliveredAt: `${dateOffset(-8)}T10:00:00.000Z`, reversalOf: null,
  });
  state.workerDeductions.push({
    id: crypto.randomUUID(), employeeId: state.employees[1].id, customerId: workerCustomerId, amount: 300000,
    direction: 'deduct', note: 'Material uchun ushlab qolindi', reversalOf: null, createdAt: `${dateOffset(-6)}T09:00:00.000Z`,
  });
```

Перед закреплением: проверить в демо-состоянии, что `payrollDebt(state, employees[1].id) >= 300000` (тест-гард ниже).

- [ ] **Step 2: Тест-гард демо-сида**

В `src/domain.test.ts` (или `src/seed`-тесте, если есть) добавить:

```ts
it('demo seed keeps the worker deduction within salary owed and customer debt', () => {
  const state = createDemo(admin);
  const worker = state.employees.find(row => row.name === 'Yig‘uvchi')!;
  const customer = state.customers.find(row => row.employeeId === worker.id)!;
  const deduction = state.workerDeductions.find(row => row.employeeId === worker.id)!;
  expect(customerLedger(state, customer.id).debt).toBeGreaterThanOrEqual(deduction.amount);
  expect(payrollDebt(state, worker.id)).toBeGreaterThanOrEqual(deduction.amount);
});
```

- [ ] **Step 3: Полный прогон**

Run: `npm test`
Expected: PASS (все файлы, включая новый гард).
Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Браузерная проверка (демо, пустые VITE_SUPABASE_*)**

1. `npm run dev` (или существующий способ запуска демо); удалить ключ `aliya-erp-demo-v1` из localStorage и перезагрузить (бекап-ключи `aliya-erp-backup:*` не трогать).
2. Панель «Oylik va qarzlar»: у «Yig‘uvchi» кнопка `Ish haqidan ushlash` активна; в детали месяца видна строка «Ish haqidan ushlab qolindi · 300 000»; «To‘langan» включает удержание.
3. Модалка `Ish haqidan ushlab qolish`: Mijoz hisobi = «Yig‘uvchi — shaxsiy hisob», Ish haqi qoldig‘i и Mijoz qarzi видны; ввести сумму в пределах потолка → сохранить → обе цифры (Qoldiq зарплаты и Qarz клиента) уменьшились на сумму.
4. Сторно: у строки удержания нажать Storno → подтвердить → обе цифры вернулись.
5. Карточка клиента «Yig‘uvchi — shaxsiy hisob»: в «To‘lovlar tarixi» строка удержания «+300 000», бейдж `Xodim`; список клиентов и выбор клиента в заявке показывают `Xodim`.
6. Отчёт работника (зайти под работником, если демо-режим позволяет): в «Ish haqi» период, в «To‘lovlar» — строка «Ish haqidan ushlab qolindi».
7. Ширина 390px: таблицы не ломаются (существующие `table-scroll cardable`).

- [ ] **Step 5: Итоговый отчёт**

Собрать отчёт владельцу (по-русски): что сделано в B, файлы, результаты `npm test` / `npm run build` / зондов, что осталось удалённым (миграции C → D → B и публикация dist) — это войдёт в единый запрос разрешения (#180) вместе с E.
