# Аутсорс-услуги в заказе Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Назначать этап заказа работнику или внешнему подрядчику, принимать внешнюю работу, учитывать её в себестоимости и проводить авансы, частичные и полные оплаты через единый баланс поставщика и кассу.

**Architecture:** Существующие `Operation`, `Supplier` и маршрут заказа расширяются дискриминированным исполнителем `employee | supplier`; отдельной закупки услуги и склада услуг не появляется. Обязательство возникает из принятого внешнего этапа, деньги остаются в существующей кассе, а TypeScript и Postgres используют одинаковые формулы. Идемпотентная миграция генерируется из окончательных функций `supabase/schema.sql`, поэтому canonical schema и серверная миграция не расходятся.

**Tech Stack:** TypeScript strict, React 19, Vite 6, Vitest 3, Supabase/Postgres PL/pgSQL, PGlite, Node.js 24.

**Spec:** `docs/superpowers/specs/2026-11-06-outsourced-services-design.md`

## Global Constraints

- Рабочая папка `C:\Users\abdul\Documents\Qoder\2026-10-29\dd682fe3` **не является Git-репозиторием**: никаких веток и commit; каждая задача заканчивается свежей проверкой.
- Владелец ранее отклонил subagent-диспетчеризацию: выполнять inline через `superpowers:executing-plans`, не создавая implementer/reviewer-субагентов.
- Порядок обязателен: RED с наблюдаемой ожидаемой ошибкой → минимальный GREEN → focused-тесты → регрессии затронутых файлов. Не писать production-код до падающего теста.
- `State.version` остаётся `4`. Старые команды без `executorKind` означают `employee`; старые маршруты нормализуются в `executorKind: 'employee'`, `supplierId: null` без изменения денег и статусов.
- Уточнение утверждённого контракта: `supplier.pay` дополнительно получает `orderId?: string`. Его отправляет только форма оплаты из заказа; по нему домен и SQL запрещают новую оплату отменённого заказа и проверяют, что подрядчик действительно назначен на этот заказ.
- Внешний этап не создаёт `Item`, `Purchase`, `StockMovement`, резерв, списание, `WorkReport` или `PayrollEntry`. Серийное производство остаётся employee-only.
- Принятый внешний этап нельзя удалить отменой отдельной позиции: `orderLine.cancel` отклоняется, если в позиции есть завершённый supplier-этап. Отмена всего заказа по-прежнему сохраняет маршрут, обязательство, аванс и платежи.
- Интерфейс — узбекская латиница, суммы UZS. Новые подписи: `Xodim`, `Pudratchi`, `Ijrochi tannarxi, UZS`, `Ishni qabul qilish`, `Pudratchiga to‘lash`, `Avans to‘loviga ruxsat`, `Autsors xizmatiga to‘lov`.
- Не менять fixed-salary/`salaryLedger`, Telegram customers-only, существующие права worker/display и не начинать backlog #118, #55, #57, #114–#117.
- Во фронтенд-окружении допустимы только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`; секреты не попадают в код, тесты, план, логи и скриншоты.
- Браузерная проверка выполняется только в демо с пустыми `VITE_SUPABASE_*`. Live SQL и `npm run deploy` не входят в реализацию: каждый требует отдельного разрешения владельца после готовности и проверок.

## File structure

| Файл | Ответственность |
| --- | --- |
| `src/types.ts` (modify) | `ExecutorKind`, nullable executor-поля маршрута, backward-compatible input, `outsource.accept`, расширенный `supplier.pay` |
| `src/migrations.ts` (modify) | Нормализация старых маршрутов; исключение supplier-этапов из payroll-миграции; внешний labor в legacy shipments |
| `src/domain.ts` (modify) | Назначение/ревизия исполнителя, приёмка, баланс, оплата, себестоимость, shipment labor, worker/cancel guards |
| `src/order-editor.ts` (modify) | `PositionStage`, round-trip маршрута, executor validation; существующая плановая маржа |
| `src/components/OrderEditor.tsx` (modify) | Переключатель `Xodim / Pudratchi`, выбор подрядчика, нейтральные подписи стоимости |
| `src/components/CatalogSettings.tsx` (modify) | Чисто внешняя операция без работников, нейтральная подпись стоимости |
| `src/App.tsx` (modify) | Экспортируемая `SupplierPayForm` (долг/аванс, счёт, основание, явный prepay), модалки `supplierPay`/`outsourcePay`, кнопка приёмки, executor labels, creditor totals, карточка реестра |
| `src/work-view.ts` (modify) | `executorLabel(state, task)` — имя работника или подрядчика для любого этапа |
| `src/components/OrderPositions.tsx` (modify) | Тот же ярлык исполнителя в карточке позиции вместо `employeeName()` |
| `src/components/WidgetBoard.tsx` (modify) | Кредиторский итог виджета считается только положительным долгом |
| `src/console.ts` (modify) | `payable.suppliers` не уменьшают авансы подрядчикам |
| `src/components/FinanceStatements.tsx` (modify) | Колонка и сортировка `Xizmatlar`, аванс в карточке контрагента |
| `src/statements.ts` (modify) | Отдельная сумма принятых услуг и единый баланс контрагента |
| `src/documents.ts` (modify) | Имя подрядчика в маршрутном листе без раскрытия денег |
| `src/i18n.ts` (modify) | Узбекская категория `outsourcing` |
| `src/seed.ts` (modify) | Демо-подрядчик, внешняя операция и внешний этап; старые employee-команды остаются legacy-shaped |
| `supabase/schema.sql` (modify) | Executor DDL, snapshot, route commands, acceptance/payment/cancel, supplier cost, shipment labor, financial assertions |
| `.validation-pglite-20261029/generate-outsourced-services-migration.mjs` (create) | Извлечение окончательных SQL-функций из canonical schema и генерация idempotent migration |
| `supabase/migrations/20261106_outsourced_services.sql` (generated) | Один повторно применяемый пакет DDL + окончательные функции; live применяет только владелец |
| `.validation-pglite-20261029/validate-outsourced-services.mjs` (create) | PGlite: два применения, tenant/role guards, приёмка, аванс/долг/касса, готовность, snapshot, shipment cost |
| Тесты (modify/create) | `src/migrations.test.ts`, `src/domain.test.ts`, `src/order-editor.test.ts`, `src/statements.test.ts`, `src/documents.test.ts`, `src/sales.test.ts`, `src/i18n.test.ts`, `src/work-view.test.ts`, `src/console.test.ts`, `src/outsource-ui.test.tsx` (new) |

---

### Task 1: Типы исполнителя и нормализация старого состояния

**Files:**
- Modify: `src/types.ts`
- Modify: `src/migrations.ts`
- Test: `src/migrations.test.ts`
- Regression fixtures: `src/documents.test.ts`, `src/order-editor.test.ts` и другие литералы `RouteLine`, найденные `npx tsc -b --pretty false`

**Interfaces:**
- Consumes: текущие `State`, `RouteLine`, `OrderRouteInput`, `Command`.
- Produces:
  ```ts
  export type ExecutorKind = 'employee' | 'supplier';

  export interface RouteLine {
    id: string; lineId: string; operationId: string; name: string;
    executorKind: ExecutorKind;
    employeeId: string | null;
    supplierId: string | null;
    rate: number; salePrice?: number; standardMinutes?: number;
    planned: number; completed: number; status: TaskStatus;
  }

  export type OrderRouteInput = {
    operationId: string;
    executorKind?: ExecutorKind;
    employeeId?: string | null;
    supplierId?: string | null;
    rate: number;
    qty?: number;
    taskId?: string;
  };

  | { type: 'outsource.accept'; taskId: string }
  | {
      type: 'supplier.pay';
      supplierId: string;
      orderId?: string;
      amount: number;
      account: Account;
      allowPrepay?: boolean;
      note?: string;
      category?: 'supplier' | 'outsourcing';
    }
  ```
  У `SeriesInput` расширяется только поле `route` — с `{ operationId: string; employeeId: string; rate: number }[]`
  на существующий `OrderRouteInput[]` (`src/types.ts:40-44`), чтобы серия получала ту же проверку исполнителя,
  что и заказ. Остальные поля `SeriesInput` не менять; старые вызовы с `employeeId: string` остаются
  структурно совместимы. Поведение команд появляется в Tasks 2–4; до этого `Unknown command` для
  `outsource.accept` ожидаем.

- [ ] **Step 1: RED — старый route snapshot**

Добавить в `src/migrations.test.ts`:

```ts
it('normalizes a legacy employee route without changing money or status', () => {
  const state = emptyState();
  state.orders = [{
    id: 'o1', number: 'ORD-0001', kind: 'service', customerId: 'c1', title: 'Kesish',
    outputItemId: null, recipeVersionId: null, substitutions: {}, qty: 2, price: 100000,
    overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-06T09:00:00.000Z', status: 'production',
    lines: [{ id: 'l1', kind: 'service', title: 'Kesish', qty: 2, total: 100000, status: 'production' }],
    materials: [],
    route: [{
      id: 't1', lineId: 'l1', operationId: 'op1', name: 'Kesish', employeeId: 'e1', rate: 5000,
      salePrice: 50000, standardMinutes: 15, planned: 2, completed: 0, status: 'assigned',
    }],
    drawingUrl: null,
  } as unknown as State['orders'][number]];

  const migrated = migrateState(JSON.parse(JSON.stringify(state)));
  expect(migrated.orders[0].route[0]).toMatchObject({
    executorKind: 'employee', employeeId: 'e1', supplierId: null,
    rate: 5000, salePrice: 50000, planned: 2, completed: 0, status: 'assigned',
  });
  expect(migrateState(migrated).orders[0]).toEqual(migrated.orders[0]);
});
```

- [ ] **Step 2: Запустить RED**

Run: `npx vitest run src/migrations.test.ts`
Expected: FAIL — `executorKind` отсутствует и `supplierId` не равен `null`.

- [ ] **Step 3: GREEN — типы**

В `src/types.ts` внести ровно интерфейсы из блока **Produces**. Старый член `supplier.pay` заменить расширенным; `outsource.accept` поставить рядом с work-командами. В `SeriesInput` заменить `route: { operationId: string; employeeId: string; rate: number }[]` на `route: OrderRouteInput[]` (`src/types.ts:43`) — это единственное изменение серии. Не добавлять новый `CashSource` и не менять `State.version`.

- [ ] **Step 4: GREEN — миграция**

В `src/migrations.ts` заменить route normalization на:

```ts
const route = order.route.map(task => ({
  ...task,
  executorKind: task.executorKind ?? 'employee',
  employeeId: task.employeeId ?? null,
  supplierId: task.supplierId ?? null,
  status: task.status ?? (task.completed >= task.planned ? 'completed'
    : reports.some(row => row.taskId === task.id && row.status === 'submitted')
      ? 'submitted' : 'assigned'),
}));
```

В `acceptReportedWork()` перед созданием `PayrollEntry` оставить только внутренние этапы:

```ts
if (task.executorKind !== 'employee' || !task.employeeId) continue;
```

Это защита миграции уже существующего supplier snapshot, а не канал приёмки аутсорса.

- [ ] **Step 5: Привести typed fixtures к persisted-контракту**

Во всех старых `RouteLine`-литералах, которые `tsc` пометит после изменения типа, добавить:

```ts
executorKind: 'employee',
supplierId: null,
```

`employeeId` сохранить прежним. В `src/documents.test.ts` это оба этапа fixture; в `src/order-editor.test.ts` persisted routes получают те же поля, а `OrderRouteInput` без новых полей специально не менять — он проверяет backward compatibility.

Run: `npx tsc -b --pretty false`
Expected: exit 0; список литералов закрыт полностью, без подавления ошибок через `any`.

- [ ] **Step 6: Проверка**

Run: `npx vitest run src/migrations.test.ts src/documents.test.ts src/order-editor.test.ts`
Expected: PASS; деньги, статусы и idempotency сохранены.

---

### Task 2: Назначение и ревизия employee/supplier этапов

**Files:**
- Modify: `src/domain.ts`
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `ExecutorKind`, `OrderRouteInput` из Task 1; существующие `fixture()`, `run()`, `atomic()`, `production()`.
- Produces: внутренний нормализатор:
  ```ts
  function routeExecutor(
    state: State,
    operation: Operation,
    line: OrderRouteInput,
  ): Pick<RouteLine, 'executorKind' | 'employeeId' | 'supplierId'>
  ```
  Он используется и `routeValues()`, и `routeRevision()`; независимой второй валидации не создавать.
- Produces: исполнитель-осознанный шаг запуска. В `case 'order.launch'` (`src/domain.ts:913-916`) этап с
  `executorKind === 'supplier'` проверяется существованием `Supplier`, employee-этап сохраняет
  `check(... .active, 'Employee is inactive')` без изменений текста. Сервер правки не требует: неактивных
  работников в `supabase/schema.sql:2039-2042` ищут через `INNER JOIN public.erp_employees`, поэтому строки
  внешнего этапа (`employee_id IS NULL`) в проверку не попадают и запуск supplier-маршрута проходит уже
  сегодня — это подтвердит зонд Task 9, а не новая правка SQL.

- [ ] **Step 1: RED — внешний этап и инвариант одного исполнителя**

Добавить тесты в `src/domain.test.ts`, используя реальные поля `fixture()` и `f.input` как базу `OrderInput`:

```ts
it('creates an outsourced stage without an employee or stock activity', () => {
  const f = fixture();
  const state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000, qty: 2,
  }] } });
  const task = state.orders.at(-1)!.route[0];
  expect(task).toMatchObject({
    executorKind: 'supplier', employeeId: null, supplierId: f.supplierId,
    planned: 2, completed: 0, status: 'assigned', rate: 30000,
  });
  expect(state.movements).toEqual(f.state.movements);
  expect(state.payroll).toEqual([]);
});

it('rejects missing, double and unknown executors atomically', () => {
  const f = fixture();
  const base = { operationId: f.operationId, rate: 30000 };
  atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
    { ...base, executorKind: 'supplier', employeeId: null, supplierId: null },
  ] } });
  atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
    { ...base, executorKind: 'employee', employeeId: f.employeeId, supplierId: f.supplierId },
  ] } });
  atomic(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [
    { ...base, executorKind: 'supplier', employeeId: null, supplierId: crypto.randomUUID() },
  ] } });
});
```

- [ ] **Step 2: RED — legacy employee**

Добавить:

```ts
it('keeps legacy employee route commands authorized by the operation', () => {
  const f = fixture();
  const result = run(f.state, { type: 'order.create', input: f.input });
  expect(result.orders.at(-1)!.route[0]).toMatchObject({
    executorKind: 'employee', employeeId: f.employeeId, supplierId: null,
  });
});
```

- [ ] **Step 3: RED — запуск заказа с единственным внешним этапом**

Добавить:

```ts
it('launches an order whose only stage is outsourced', () => {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000,
  }] } });
  const orderId = state.orders.at(-1)!.id;
  state = run(state, { type: 'order.launch', orderId });
  expect(state.orders.at(-1)!.status).toBe('production');
  expect(state.orders.at(-1)!.route[0]).toMatchObject({ status: 'assigned', completed: 0 });
});
```

Этот RED отдельный, потому что падает он в другом месте: `order.launch` в `src/domain.ts:913-916` для каждого
этапа делает `find(state.employees, task.employeeId, 'Employee')`, а у внешнего этапа `employeeId === null`
→ `Employee not found` ещё до создания supplier-этапа в состоянии.

- [ ] **Step 4: Запустить RED**

Run: `npx vitest run src/domain.test.ts -t "outsourced stage|missing, double|legacy employee|launches an order"`
Expected: FAIL — сейчас supplier lookup трактуется как employee/operation authorization, persisted executor-поля отсутствуют, а `order.launch` отвергает маршрут без работника.

- [ ] **Step 5: GREEN — единый нормализатор**

Добавить в `src/domain.ts` перед `routeValues()`:

```ts
function routeExecutor(state: State, operation: Operation, line: OrderRouteInput):
  Pick<RouteLine, 'executorKind' | 'employeeId' | 'supplierId'> {
  const executorKind = line.executorKind ?? 'employee';
  const employeeId = line.employeeId ?? null;
  const supplierId = line.supplierId ?? null;
  if (executorKind === 'employee') {
    check(employeeId !== null && supplierId === null, 'Employee stage requires exactly one employee');
    const employee = find(state.employees, employeeId, 'Employee');
    check(employee.active, 'Employee is inactive');
    check(operation.employeeIds.includes(employee.id), 'Employee is not authorized for this operation');
    return { executorKind, employeeId: employee.id, supplierId: null };
  }
  check(executorKind === 'supplier', 'Invalid executor kind');
  check(employeeId === null && supplierId !== null, 'Supplier stage requires exactly one supplier');
  const supplier = find(state.suppliers, supplierId, 'Supplier');
  return { executorKind, employeeId: null, supplierId: supplier.id };
}
```

`find(state.suppliers, ...)` выполняет tenant isolation внутри текущего `State`; `Supplier.active` не выдумывать.

- [ ] **Step 6: GREEN — создание**

В `routeValues()` удалить employee-only lookup и в возвращаемый объект подставить:

```ts
const executor = routeExecutor(state, operation, line);
return {
  id: uuid(), lineId, operationId: operation.id, name: operation.name,
  ...executor,
  rate, salePrice: operation.salePrice, standardMinutes: operation.standardMinutes,
  planned: stageQty, completed: 0, status: 'assigned' as const,
};
```

Проверки активной операции, `money(line.rate)`, `quantity()` и `round(stageQty * rate)` оставить до return.

- [ ] **Step 7: GREEN — запуск**

В `case 'order.launch'` заменить employee-only цикл `src/domain.ts:913-916` на:

```ts
for (const task of order.route) {
  find(state.operations, task.operationId, 'Operation');
  if (task.executorKind === 'supplier') find(state.suppliers, task.supplierId, 'Supplier');
  else check(find(state.employees, task.employeeId, 'Employee').active, 'Employee is inactive');
}
```

У `Supplier` нет флага `active` (`src/types.ts:9`), поэтому внешнего исполнителя проверяют только на
принадлежность текущему тенанту; текст `Supplier not found` уже живёт в SQL (`supabase/schema.sql:2305`) и
повторяется без нового сообщения. Ветку `order.launch` в canonical schema НЕ править: её
`JOIN public.erp_employees` (`supabase/schema.sql:2039-2042`) внутренним join отбрасывает строки с
`employee_id IS NULL`, поэтому сервер принимает внешний этап уже сегодня — это подтвердит зонд Task 9, а не правка.

- [ ] **Step 8: Проверка**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS без skip; legacy employee routes, создание supplier stage и atomic executor validation зелёные. Ревизия supplier stage проверяется отдельным RED в Task 3 после появления `outsource.accept`.

---

### Task 3: Полная приёмка, готовность, worker exclusion и защита обязательства

**Files:**
- Modify: `src/domain.ts`
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: normalized `RouteLine` и `outsource.accept` из Tasks 1–2; `ready()`, `availableTask()`, `workContext()`, `orderLine.cancel`, `series.create` (`src/domain.ts:860-897`).
- Produces: команда `outsource.accept` полностью завершает один supplier-этап и вызывает существующий `ready(state, order)`; никаких новых коллекций. Серийный выпуск остаётся employee-only — `series.create` отвергает маршрут с `executorKind: 'supplier'`.

- [ ] **Step 1: RED — приёмка и готовность**

Добавить тест:

```ts
it('accepts the whole outsourced stage, updates readiness and creates no payroll or cash', () => {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000, qty: 2,
  }] } });
  const orderId = state.orders.at(-1)!.id;
  state = run(state, { type: 'order.launch', orderId });
  const taskId = state.orders.at(-1)!.route[0].id;
  const before = { payroll: state.payroll.length, cash: state.cash.length, movements: state.movements.length };
  state = run(state, { type: 'outsource.accept', taskId });
  const order = state.orders.at(-1)!;
  expect(order.route[0]).toMatchObject({ completed: 2, status: 'completed' });
  expect(order.lines[0].status).toBe('ready');
  expect(order.status).toBe('ready');
  expect({ payroll: state.payroll.length, cash: state.cash.length, movements: state.movements.length }).toEqual(before);
  atomic(state, { type: 'outsource.accept', taskId });
});
```

Run: `npx vitest run src/domain.test.ts -t "accepts the whole outsourced"`
Expected: FAIL — `Unknown command`.

- [ ] **Step 2: RED — замороженный внешний этап**

Добавить отдельный тест до реализации acceptance/revision:

```ts
it('does not reassign an accepted outsourced stage during route revision', () => {
  const f = fixture();
  let state = run(f.state, { type: 'supplier.create', name: 'Other supplier', phone: '' });
  const otherSupplierId = state.suppliers.at(-1)!.id;
  state = run(state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000,
  }] } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  atomic(state, { type: 'order.update', orderId: order.id, overhead: 0, dueDate: order.dueDate,
    lines: [{ id: order.lines[0].id, kind: 'product', title: order.lines[0].title, qty: order.lines[0].qty,
      unitPrice: order.lines[0].total / order.lines[0].qty, materials: [], route: [{ operationId: f.operationId,
        executorKind: 'supplier', employeeId: null, supplierId: otherSupplierId, rate: 30000,
        taskId: order.route[0].id }] }] });
});
```

Run после Step 6 acceptance, но до revision fix: `npx vitest run src/domain.test.ts -t "does not reassign"`
Expected: FAIL — started supplier task можно переназначить; именно этот failure закрывает Step 7 revision guard.

- [ ] **Step 3: RED — недопустимые приёмки и worker terminal**

Добавить:

```ts
it('rejects internal, cancelled and worker acceptance', () => {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: f.input });
  const internal = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: internal.id });
  atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id });
  atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id }, f.worker);
  state = run(state, { type: 'order.cancel', orderId: internal.id });
  atomic(state, { type: 'outsource.accept', taskId: internal.route[0].id });
});

it('never exposes an outsourced stage as worker work', () => {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000,
  }] } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  expect(availableTask(state, order.id, order.route[0].id)).toBe(false);
  atomic(state, { type: 'work.start', orderId: order.id, taskId: order.route[0].id }, f.worker);
});
```

Run: `npx vitest run src/domain.test.ts -t "rejects internal|never exposes"`
Expected: FAIL — внутренний task/worker path ещё не отличает supplier executor.

- [ ] **Step 4: RED — серия принимает только работников**

Спецификация запрещает внешние этапы в серийном производстве. Тест рядом с существующими series-тестами; фикстуры `seriesCatalog()` и `itemId()` уже в файле (`src/domain.test.ts:1184-1217`), `state.suppliers[0]` создаётся внутри `seriesCatalog()`.

```ts
it('rejects a contractor in a series route', () => {
  const state = seriesCatalog();
  const recipe = state.recipes.find(row => row.outputItemId === itemId(state, 'Shkaf'))!;
  atomic(state, { type: 'series.create', input: {
    outputItemId: recipe.outputItemId, recipeVersionId: recipe.versions[0].id, qty: 1,
    dueDate: '2026-11-12', substitutions: { Fasad: itemId(state, 'Fasad A') },
    route: [{ operationId: state.operations[0].id, executorKind: 'supplier', employeeId: null,
      supplierId: state.suppliers[0].id, rate: 30000 }],
  } });
});
```

Run: `npx vitest run src/domain.test.ts -t "rejects a contractor in a series"`
Expected: FAIL — после Task 2 `routeValues()` одинаково легализует supplier-строку и в `order.create`, и в `series.create`, поэтому команда проходит и `atomic()` не видит throw.

- [ ] **Step 5: RED — принятое обязательство переживает отмену заказа, но не отмену позиции**

Добавить:

```ts
it('keeps accepted work on order cancellation and blocks line cancellation', () => {
  const f = fixture();
  let state = run(f.state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 30000,
  }] } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  atomic(state, { type: 'orderLine.cancel', orderId: order.id, lineId: order.lines[0].id });
  state = run(state, { type: 'order.cancel', orderId: order.id });
  expect(state.orders.at(-1)!.route[0].status).toBe('completed');
  expect(state.orders.at(-1)!.route).toHaveLength(1);
});
```

- [ ] **Step 6: GREEN — команда**

Добавить case в `mutate()`:

```ts
case 'outsource.accept': {
  const order = state.orders.find(row => row.route.some(task => task.id === command.taskId));
  check(order, 'Order not found');
  check(order.status === 'production', 'Order is not in production');
  const task = find(order.route, command.taskId, 'Task');
  const line = orderLineOf(order, task.lineId);
  check(line.status === 'production', 'Order line is not in production');
  check(task.executorKind === 'supplier' && task.supplierId !== null, 'Not an outsourced task');
  check(task.status === 'assigned' && task.completed === 0, 'Outsourced task is already accepted');
  task.completed = task.planned;
  task.status = 'completed';
  ready(state, order);
  return task.id;
}
```

Существующая централизованная авторизация оставляет команду admin-only; worker case не добавлять.

- [ ] **Step 7: GREEN — ревизия**

В начале обработки каждой линии `routeRevision()` получить `const executor = routeExecutor(state, operation, line);`.

Для started task заменить сравнение на:

```ts
check(line.operationId === task.operationId
  && executor.executorKind === task.executorKind
  && executor.employeeId === task.employeeId
  && executor.supplierId === task.supplierId
  && money(line.rate) === task.rate, 'Started stage cannot be changed');
```

В update не started task вместе с `operationId/name/rate` записать:

```ts
Object.assign(task, executor);
```

В новые task копировать `...executor`, как в `routeValues()`. Started supplier task получает только разрешённые текущей ревизией `position/salePrice/standardMinutes/planned/status`; executor и rate не перезаписываются.

Run: `npx vitest run src/domain.test.ts -t "does not reassign"`
Expected: PASS — atomic rejection `Started stage cannot be changed`.

- [ ] **Step 8: GREEN — worker guards**

В `workContext()` до `find(state.employees, task.employeeId, ...)`:

```ts
check(task.executorKind === 'employee' && task.employeeId !== null, 'Outsourced task is not available to workers');
```

В `availableTask()` сразу после нахождения task:

```ts
if (task.executorKind !== 'employee' || !task.employeeId) return false;
```

Последующий `operation.employeeIds.includes(task.employeeId)` остается type-safe и относится только к внутреннему этапу.

- [ ] **Step 9: GREEN — cancel guard**

В `case 'orderLine.cancel'` до удаления route rows:

```ts
check(!lineRoute(order, line.id).some(task =>
  task.executorKind === 'supplier' && task.status === 'completed'
), 'Accepted outsourced work cannot be cancelled');
```

`order.cancel` не менять: он сохраняет маршрут и принятое обязательство.

- [ ] **Step 10: GREEN — series guard**

В `case 'series.create'` (`src/domain.ts:860-897`) сразу перед `const route = routeValues(...)`:

```ts
check(!input.route.some(row => row.executorKind === 'supplier'), 'Series production uses employees only');
```

Текст ошибки совпадает с SQL-гардом из Task 8 (`erp_insert_route`, ветка `IF (SELECT kind FROM public.erp_orders ...) = 'series'`), поэтому офлайн- и серверный отказ различаются только `translateError` в UI.

- [ ] **Step 11: Проверка**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS без skip для acceptance/revision/worker/cancel и всех прежних доменных сценариев.

---

### Task 4: Единый баланс, аванс, частичная оплата, касса и сторно

**Files:**
- Modify: `src/domain.ts`
- Test: `src/domain.test.ts`
- Test: `src/i18n.test.ts`
- Modify: `src/i18n.ts`

**Interfaces:**
- Consumes: completed supplier tasks, `supplier.pay` из Tasks 1–3, существующие `sourceNet()`, `postCash()`, `payment()`, `funds()`.
- Produces:
  ```ts
  export function acceptedOutsourceCost(state: State, supplierId: string): number
  ```
  `supplierDebt()` возвращает `receivedPurchaseCost + acceptedOutsourceCost - netSupplierCashPayments`; отрицательное значение — аванс. `payment()` получает optional category override, не меняя старые payroll defaults.

- [ ] **Step 1: RED — последовательность аванс → приёмка → остаток**

Добавить:

```ts
const outsourcedRoute = (operationId: string, supplierId: string) => [{
  operationId, executorKind: 'supplier' as const, employeeId: null, supplierId, rate: 250000, qty: 2,
}];

it('tracks advance, accepted outsourcing and remaining debt in one supplier balance', () => {
  const f = fixture();
  let state = funds(f.state, 1000000);
  state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 300000,
    account: 'cash', allowPrepay: true, note: 'Autsors avansi', category: 'outsourcing' });
  expect(supplierDebt(state, f.supplierId)).toBe(-300000);
  state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
    route: outsourcedRoute(f.operationId, f.supplierId) } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  expect(supplierDebt(state, f.supplierId)).toBe(-300000);
  state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  expect(supplierDebt(state, f.supplierId)).toBe(200000);
  state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
    amount: 200000, account: 'cash', note: `${order.number} · Autsors xizmati`, category: 'outsourcing' });
  expect(supplierDebt(state, f.supplierId)).toBe(0);
});
```

`outsourcedRoute()` — локальный helper рядом с `production()` в начале файла: `250000 × 2 = 500000`
принятой стоимости. `production()` возвращает `{ state, orderId, taskId, ...f }` и не переопределяет
`input`, поэтому база всегда `f.input`; новый production-helper не выдумывать.

Run: `npx vitest run src/domain.test.ts -t "tracks advance"`
Expected: FAIL — баланс не включает принятые услуги (получается `-300000`, а не `200000`), а новые options команды игнорируются.

- [ ] **Step 2: RED — лимиты, метаданные, отмена и основание**

Добавить тесты:

```ts
it('rejects overpayment without prepay and insufficient funds', () => {
  const f = fixture();
  atomic(f.state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 1000,
    account: 'cash', allowPrepay: false });
  const funded = funds(f.state, 1000);
  atomic(funded, { type: 'supplier.pay', supplierId: f.supplierId, amount: 1001,
    account: 'cash', allowPrepay: true });
});

it('keeps outsourcing payment metadata and reversal category inheritance', () => {
  const f = fixture();
  let state = funds(f.state, 500000);
  state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 100000,
    account: 'cash', allowPrepay: true, note: 'Metall uchun avans', category: 'outsourcing' });
  const entry = state.cash.at(-1)!;
  expect(entry).toMatchObject({ direction: 'out', source: 'supplier', sourceId: f.supplierId,
    category: 'outsourcing', note: 'Metall uchun avans' });
  state = run(state, { type: 'cash.reverse', entryId: entry.id, note: 'Avans bekor qilindi' });
  expect(state.cash.at(-1)).toMatchObject({ direction: 'in', source: 'supplier',
    sourceId: f.supplierId, category: 'outsourcing', note: 'Avans bekor qilindi', reversalOf: entry.id });
  expect(supplierDebt(state, f.supplierId)).toBe(0);
});

it('rejects order-originated payment for an unrelated or cancelled order', () => {
  const f = fixture();
  let state = funds(f.state, 500000);
  state = run(state, { type: 'supplier.create', name: 'Other supplier', phone: '' });
  const otherSupplierId = state.suppliers.at(-1)!.id;
  state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
    route: outsourcedRoute(f.operationId, f.supplierId) } });
  const order = state.orders.at(-1)!;
  atomic(state, { type: 'supplier.pay', supplierId: otherSupplierId, orderId: order.id,
    amount: 1000, account: 'cash', allowPrepay: true, category: 'outsourcing' });
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'order.cancel', orderId: order.id });
  atomic(state, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
    amount: 1000, account: 'cash', allowPrepay: true, category: 'outsourcing' });
});

it('keeps the accepted obligation and advance after cancelling the whole order', () => {
  const f = fixture();
  let state = funds(f.state, 1000000);
  state = run(state, { type: 'order.create', input: { ...f.input, materials: [],
    route: outsourcedRoute(f.operationId, f.supplierId) } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  state = run(state, { type: 'supplier.pay', supplierId: f.supplierId, amount: 100000,
    account: 'cash', allowPrepay: true, category: 'outsourcing' });
  state = run(state, { type: 'order.cancel', orderId: order.id });
  expect(supplierDebt(state, f.supplierId)).toBe(400000);
});
```

Реальная команда сторно — `{ type: 'cash.reverse'; entryId: string; note: string }`; она наследует
`source`, `sourceId` и `category`, а `note` берёт из команды сторно, поэтому ожидаемый `note` именно
новый, а не `entry.note`.

- [ ] **Step 3: RED — перевод категории**

В `src/i18n.test.ts`:

```ts
it('labels outsourcing cash category in Uzbek', () => {
  expect(cashCategoryLabel('outsourcing')).toBe('Autsors xizmatiga to‘lov');
});
```

Run: `npx vitest run src/domain.test.ts -t "overpayment|metadata|unrelated|obligation" && npx vitest run src/i18n.test.ts -t "outsourcing"`
Expected: FAIL по отсутствующим payment options/order guards и переводу; `keeps the accepted obligation` падает, пока `supplierDebt()` игнорирует принятые услуги.

- [ ] **Step 4: GREEN — стоимость и баланс**

В `src/domain.ts`:

```ts
export function acceptedOutsourceCost(state: State, supplierId: string): number {
  return round(state.orders.reduce((total, order) => total + order.route.reduce((sum, task) =>
    task.executorKind === 'supplier' && task.supplierId === supplierId && task.status === 'completed'
      ? sum + round(task.completed * task.rate) : sum, 0), 0));
}

export function supplierDebt(state: State, supplierId: string): number {
  const purchases = new Set(state.purchases.filter(row => row.supplierId === supplierId).map(row => row.id));
  const received = state.movements.reduce((total, row) => row.source === 'purchase' && purchases.has(row.sourceId)
    ? total + round(row.qty * row.unitCost) * (row.direction === 'in' ? 1 : -1) : total, 0);
  return round(received + acceptedOutsourceCost(state, supplierId) - sourceNet(state, 'supplier', supplierId, false));
}
```

Отменённые заказы специально не фильтровать.

- [ ] **Step 5: GREEN — оплата**

Расширить options существующего `payment()`:

```ts
options?: {
  kind?: 'payroll' | 'advance';
  note?: string;
  allowPrepay?: boolean;
  category?: 'supplier' | 'outsourcing';
}
```

Категория в `postCash()`:

```ts
category: options?.category ?? (source === 'payroll' && options?.kind ? options.kind : source),
```

Заменить `case 'supplier.pay'`:

```ts
case 'supplier.pay': {
  if (command.orderId !== undefined) {
    const order = find(state.orders, command.orderId, 'Order');
    check(order.status !== 'cancelled', 'Cancelled order cannot be paid');
    check(order.route.some(task => task.executorKind === 'supplier'
      && task.supplierId === command.supplierId), 'Supplier is not assigned to this order');
  }
  payment(state, 'supplier', command.supplierId, command.amount, command.account, {
    allowPrepay: command.allowPrepay ?? false,
    note: command.note ?? '',
    category: command.category ?? 'supplier',
  });
  return command.supplierId;
}
```

Существующие `money()`, payable cap и `postCash()` funds check остаются единственной реализацией лимитов. Старый `supplier.pay` без options сохраняет прежнюю категорию и запрет overpayment.

Асимметрия с сервером осознанная: `Invalid supplier payment category` существует только в SQL (Task 8), потому что
в домене `category` уже ограничена типом `'supplier' | 'outsourcing'` и невалидное значение туда не попадает;
дублировать проверку в `domain.ts` не нужно.

- [ ] **Step 6: GREEN — словарь**

В `src/i18n.ts` добавить mapping:

```ts
outsourcing: 'Autsors xizmatiga to‘lov',
```

- [ ] **Step 7: Проверка**

Run: `npx vitest run src/domain.test.ts src/i18n.test.ts`
Expected: PASS, включая Task 3 balance assertion, старые supplier payments, advances, reversal и salary tests.

---

### Task 5: Фактическая себестоимость, отгрузка, отчёт контрагента и маршрутный лист

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/migrations.ts`
- Modify: `src/statements.ts`
- Modify: `src/documents.ts`
- Test: `src/domain.test.ts`
- Test: `src/sales.test.ts`
- Test: `src/statements.test.ts`
- Test: `src/documents.test.ts`

**Interfaces:**
- Consumes: `acceptedOutsourceCost()` из Task 4, accepted route tasks, existing `actualCost()`, shipment labor and supplier statement APIs.
- Produces:
  ```ts
  export interface SupplierStatementRow {
    supplierId: string; name: string; purchases: number; receivedValue: number;
    outsourced: number; paid: number; debt: number; lastPaidAt: string | null;
    payments: PaymentRow[]; purchaseRows: PurchaseStatementRow[];
  }
  ```
  `outsourced` — только принятые услуги; `debt` остаётся единым. `ShipmentLine.laborCost` включает accepted internal payroll + accepted supplier route cost, но не payments.

- [ ] **Step 1: RED — фактическая себестоимость без двойного учёта**

Добавить в `src/domain.test.ts` два независимых теста (первый изолирует внешнюю работу, второй
доказывает, что материалы, внутренние начисления и аутсорс складываются по одному разу):

```ts
it('adds accepted outsourcing to actual cost once, not again when paid', () => {
  const f = fixture();
  let state = funds(f.state, 500000);
  state = run(state, { type: 'order.create', input: { ...f.input, materials: [], route: [{
    operationId: f.operationId, executorKind: 'supplier', employeeId: null,
    supplierId: f.supplierId, rate: 40000, qty: 2 }] } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  const accepted = run(state, { type: 'outsource.accept', taskId: order.route[0].id });
  expect(actualCost(accepted, accepted.orders.at(-1)!)).toBe(80000);
  const paid = run(accepted, { type: 'supplier.pay', supplierId: f.supplierId, orderId: order.id,
    amount: 80000, account: 'cash', category: 'outsourcing' });
  expect(actualCost(paid, paid.orders.at(-1)!)).toBe(80000);
  expect(paid.cash.filter(row => row.source === 'supplier')).toHaveLength(1);
});

it('sums issued materials, accepted internal work and accepted outsourcing', () => {
  const f = fixture();
  let state = receive(f.state, f.supplierId, f.itemId, 20, 5);
  state = run(state, { type: 'order.create', input: { ...f.input, route: [
    { operationId: f.operationId, employeeId: f.employeeId, rate: 2 },
    { operationId: f.otherOperationId, executorKind: 'supplier', employeeId: null,
      supplierId: f.supplierId, rate: 300 },
  ] } });
  const order = state.orders.at(-1)!;
  state = run(state, { type: 'order.launch', orderId: order.id });
  state = run(state, { type: 'order.issue', orderId: order.id });
  expect(estimatedCost(state, state.orders.at(-1)!)).toBe(50 + 20 + 3000);
  state = report(state, order.id, order.route[0].id, 10);
  state = run(state, { type: 'outsource.accept', taskId: order.route[1].id });
  expect(actualCost(state, state.orders.at(-1)!)).toBe(50 + 20 + 3000);
});
```

`estimatedCost()` уже включает `rate × planned` для любого этапа, поэтому плановая маржа не меняется;
`50` — выданный материал (`10 × 5`), `20` — принятная внутренняя работа (`10 × 2`), `3000` — принятый
аутсорс (`10 × 300`).

Run: `npx vitest run src/domain.test.ts -t "actual cost once|sums issued materials"`
Expected: FAIL — `actualCost` = `0` и `50 + 20` соответственно, внешний этап в стоимость не входит.

- [ ] **Step 2: RED — labor отгрузки**

В `src/sales.test.ts` использовать существующий `readyOrder(qty, price)` (линия `order-1-line`,
материал `300`), добавить completed supplier stage и отгрузить ровно **одну** единицу, потому что
`ShipmentLine.laborCost` хранит стоимость на единицу:

```ts
it('charges accepted outsourcing into shipment labor once per unit', () => {
  let state = readyOrder(1, 500000);
  state.orders[0].route = [{
    id: 'task-outsourced', lineId: 'order-1-line', operationId: 'operation-1', name: 'Metall ish',
    executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
    rate: 80000, planned: 1, completed: 1, status: 'completed',
  }];
  state = run(state, { type: 'shipment.create', orderId: 'order-1', qty: 1,
    address: 'Цех', dueDate: '2026-11-05', allowDebt: true });
  const shipment = state.shipments.at(-1)!;
  expect(shipment.lines[0]).toMatchObject({ qty: 1, materialCost: 300, laborCost: 80000 });
  expect(shipmentTotals(shipment)).toMatchObject({ materialCost: 300, laborCost: 80000 });
});
```

Run: `npx vitest run src/sales.test.ts -t "outsourcing into shipment labor"`
Expected: FAIL — stored `laborCost` = `0`, aggregate labor = `0` (labor только из payroll).

- [ ] **Step 3: RED — отчёт контрагента**

В `src/statements.test.ts` взять существующий `fixture()`, очистить материальные и денежные
коллекции и подставить один completed supplier stage — так проверка остаётся про строку отчёта, а не
про домен:

```ts
it('shows accepted services separately and keeps a service-only contractor visible', () => {
  const state = fixture();
  state.purchases = [];
  state.movements = [];
  state.payroll = [];
  state.reports = [];
  state.shipments = [];
  state.cash = [];
  state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
  state.orders[0].route = [{
    id: 'task-outsourced', lineId: 'order-1-line', operationId: 'operation-1', name: 'Metall ish',
    executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
    rate: 120000, planned: 1, completed: 1, status: 'completed',
  }];
  const rows = supplierStatements(state, '2026-10-01', '2026-11-01');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ supplierId: 'supplier-1', receivedValue: 0, outsourced: 120000, debt: 120000 });
  expect(rows[0].purchaseRows).toEqual([]);
});
```

`Supplier` не имеет поля `address` — ничего кроме `id`, `name`, `phone` в литерале не писать.
Заказ в этом `fixture()` записан через `as Order` и массива `lines` не имеет (`src/statements.test.ts:14-24`),
поэтому `lineId` здесь только непрозрачная метка этапа: строка отчёта контрагента группируется по
`supplierId`, а не по позиции, и править fixture ради `lines` не нужно.

Run: `npx vitest run src/statements.test.ts -t "service-only"`
Expected: FAIL — свойство `outsourced` отсутствует и единственная строка отсекается фильтром видимости.

- [ ] **Step 4: RED — подрядчик в маршрутном листе**

В `src/documents.test.ts` локально дополнить fixture подрядчиком и заменить этап на внешний;
существующий employee route-sheet тест остаётся untouched:

```ts
it('names the contractor in the route sheet and still hides all money', () => {
  const state = fixture();
  state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
  state.orders[0].route = [{
    id: 'task-1', lineId: 'order-line-1', operationId: 'operation-1', name: 'Metall ish',
    executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1',
    rate: 5000, standardMinutes: 15, planned: 5, completed: 5, status: 'completed',
  }];
  const route = routeSheet(state, 'order-1');
  expect(route.operations[0]).toMatchObject({ name: 'Metall ish', qty: 5, workerName: 'Metall usta' });
  expect(JSON.stringify(route)).not.toMatch(/salePrice|unitCost|"rate"|paid|debt|cash/);
});
```

Run: `npx vitest run src/documents.test.ts -t "names the contractor"`
Expected: FAIL — `workerName` = `Xodim`, потому что supplier stage ищется среди работников.

- [ ] **Step 5: GREEN — общая route cost**

В `src/domain.ts` рядом с `actualCost()`:

```ts
function acceptedRouteCost(order: Order, lineId?: string): number {
  return round(order.route.reduce((sum, task) =>
    task.executorKind === 'supplier' && task.status === 'completed'
      && (lineId === undefined || task.lineId === lineId)
      ? sum + round(task.completed * task.rate) : sum, 0));
}

export function actualCost(state: State, order: Order): number {
  return round(order.materials.reduce((total, row) =>
    total + (row.issued ? round(row.qty * row.actualCost) : 0), 0)
    + state.payroll.reduce((total, row) => row.orderId === order.id && row.status === 'accepted'
      ? total + row.amount : total, 0)
    + acceptedRouteCost(order));
}
```

В shipment creation:

```ts
const laborTotal = round(state.payroll.reduce((sum, row) =>
  row.orderId === order.id && tasks.has(row.taskId) && row.status === 'accepted'
    ? sum + row.amount : sum, 0) + acceptedRouteCost(order, line.id));
```

В `legacyShipmentLine()` в `src/migrations.ts` добавить такой же accepted supplier cost для той же line. Платежи в формулы не добавлять.

- [ ] **Step 6: GREEN — statement и document**

В `supplierStatements()` заполнить:

```ts
const outsourced = acceptedOutsourceCost(state, supplier.id);
```

Вернуть `outsourced`, сохранить `debt: supplierDebt(state, supplier.id)` и расширить visibility:

```ts
.filter(row => row.purchases > 0 || row.receivedValue !== 0 || row.outsourced !== 0
  || row.payments.length > 0 || row.debt !== 0);
```

В `routeSheet()`:

```ts
workerName: task.executorKind === 'supplier'
  ? state.suppliers.find(row => row.id === task.supplierId)?.name ?? 'Pudratchi'
  : state.employees.find(row => row.id === task.employeeId)?.name ?? 'Xodim'
```

- [ ] **Step 7: Проверка**

Run: `npx vitest run src/domain.test.ts src/sales.test.ts src/statements.test.ts src/documents.test.ts src/reports.test.ts src/migrations.test.ts`
Expected: PASS; period/shop reports наследуют stored shipment labor без новых формул, salary reports не содержат supplier cost.

---

### Task 6: Редактор заказа и каталог внешних услуг

**Files:**
- Modify: `src/order-editor.ts`
- Modify: `src/components/OrderEditor.tsx`
- Modify: `src/components/CatalogSettings.tsx`
- Modify: `src/components/QuickEditors.tsx` (label ставки)
- Modify: `src/App.tsx` (заголовок колонки «Bosqich stavkalari»)
- Test: `src/order-editor.test.ts`
- Test: `src/outsource-ui.test.tsx`

**Interfaces:**
- Consumes: `ExecutorKind`, normalized `RouteLine`, `OrderRouteInput`.
- Produces:
  ```ts
  export type PositionStage = {
    operationId: string;
    executorKind: ExecutorKind;
    employeeId: string | null;
    supplierId: string | null;
    rate: number;
    salePrice?: number;
    qty: number;
    taskId?: string;
    locked: boolean;
    completed: number;
  };
  ```
  `stageAmounts()` продолжает возвращать `{ price, worker }`; `worker` теперь нейтральная executor cost для обоих типов. Плановая формула `orderTotals()` не меняется.

- [ ] **Step 1: RED — round-trip supplier stage и validation**

В `src/order-editor.test.ts` добавить supplier в state и supplier task в order, затем:

```ts
it('round-trips an outsourced position stage', () => {
  const positions = positionsFromOrder(state, order);
  expect(positions[0].route[0]).toMatchObject({
    executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1', locked: false,
  });
  expect(positionLines(positions)[0].route[0]).toEqual({
    operationId: 'operation-1', executorKind: 'supplier', employeeId: null,
    supplierId: 'supplier-1', rate: 30000, qty: 2, taskId: 'task-1',
  });
});

it('requires the executor selected by executorKind', () => {
  const position = blankPosition();
  Object.assign(position, { title: 'Metall', qty: 1, unitPrice: 100000 });
  position.route = [{ operationId: 'operation-1', executorKind: 'supplier', employeeId: null,
    supplierId: null, rate: 30000, qty: 1, locked: false, completed: 0 }];
  expect(positionIssue([position])).toContain('ijrochi');
  position.route[0].supplierId = 'supplier-1';
  expect(positionIssue([position])).toBe('');
});
```

Старые exact-equality expectations employee stage обновить только добавлением `executorKind: 'employee'`, `supplierId: null`.

Run: `npx vitest run src/order-editor.test.ts`
Expected: FAIL — supplier identity теряется и validation требует employee.

- [ ] **Step 2: GREEN — pure editor model**

В `positionsFromOrder()` копировать `executorKind`, `employeeId`, `supplierId`; в `positionLines()` отправлять все три поля:

```ts
route: position.route.map(task => ({
  operationId: task.operationId,
  executorKind: task.executorKind,
  employeeId: task.employeeId,
  supplierId: task.supplierId,
  rate: task.rate,
  qty: task.qty,
  taskId: task.taskId,
})),
```

В `positionIssue()`:

```ts
if (!position.route.length || position.route.some(task => !task.operationId
  || (task.executorKind === 'employee' ? !task.employeeId || task.supplierId !== null
    : !task.supplierId || task.employeeId !== null))) {
  return `${label}: ijrochi bilan kamida bitta bosqich qo‘shing.`;
}
```

`duplicatePosition()` уже spread-копирует executor fields; оставить reset только `taskId/locked/completed`.

- [ ] **Step 3: RED — наблюдаемые UI-подписи и контролы исполнителя**

Создать `src/outsource-ui.test.tsx` в том же стиле, что `src/salary-ui.test.tsx`
(`renderToStaticMarkup(createElement(...))`). Оба теста проверяют отрендеренный HTML, а не исходник:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CatalogSettings } from './components/CatalogSettings';
import { OrderEditor } from './components/OrderEditor';
import { applyCommand, emptyState } from './domain';
import { createDemo } from './seed';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

const editorHtml = (state: State, orderId: string) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders.find(row => row.id === orderId)!, busy: false,
  close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

describe('outsourcing UI', () => {
  it('prices the executor, not the employee, in the operation list', () => {
    const html = renderToStaticMarkup(createElement(CatalogSettings, {
      state: createDemo(admin), busy: false, run: async () => true,
      onAddEmployee: () => {}, onEditEmployee: () => {},
    }));
    expect(html).toContain('ijrochiga');
    expect(html).not.toContain('xodimga');
  });

  it('renders executor kind and contractor picker for an outsourced stage', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'order.create', input: {
      kind: 'service', customerId: state.customers[0].id, title: 'Metall ish', qty: 1,
      price: 1200000, overhead: 0, dueDate: '2026-12-01', materials: [], advance: 0, account: 'cash',
      route: [{ operationId: state.operations[0].id, executorKind: 'supplier', employeeId: null,
        supplierId: state.suppliers[0].id, rate: 500000 }],
    } });
    const html = editorHtml(state, state.orders.at(-1)!.id);
    expect(html).toContain('Ijrochi turi 1');
    expect(html).toContain('<option value="employee">Xodim</option>');
    expect(html).toContain('<option value="supplier">Pudratchi</option>');
    expect(html).toContain('Pudratchi 1');
    expect(html).toContain('ijrochiga');
  });
});
```

`OrderEditor` с необязательным `order` всегда открывает первую позицию (`positionsFromOrder`,
`activeIndex = 0`), поэтому `.route-editor` попадает в статический markup без кликов.
`CatalogSettings` рендерит список операций сразу — строка `mijozga · … xodimga` видна до открытия dialog,
поэтому тест не является vacuous и не проверяет закрытую форму.

Run: `npx vitest run src/order-editor.test.ts src/outsource-ui.test.tsx`
Expected: FAIL — `xodimga`/`ishchiga` ещё в разметке, `Ijrochi turi 1` и `Pudratchi 1` отсутствуют,
supplier identity теряется в round-trip.

- [ ] **Step 4: GREEN — OrderEditor executor controls**

Новый stage:

```tsx
{
  operationId: '', executorKind: 'employee',
  employeeId: state.employees[0]?.id || null, supplierId: null,
  rate: 0, salePrice: 0, qty: position.qty, locked: false, completed: 0,
}
```

Перед executor select добавить:

```tsx
<select aria-label={`Ijrochi turi ${index + 1}`} value={task.executorKind}
  disabled={task.locked}
  onChange={event => setStage(index, event.target.value === 'supplier'
    ? { executorKind: 'supplier', employeeId: null, supplierId: state.suppliers[0]?.id ?? null }
    : { executorKind: 'employee', employeeId: state.employees[0]?.id ?? null, supplierId: null })}>
  <option value="employee">Xodim</option>
  <option value="supplier">Pudratchi</option>
</select>
```

Для employee оставить существующий employee select; для supplier рендерить:

```tsx
<select aria-label={`Pudratchi ${index + 1}`} required value={task.supplierId ?? ''}
  disabled={task.locked}
  onChange={event => setStage(index, { supplierId: event.target.value || null })}>
  <option value="">Pudratchini tanlang</option>
  {state.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
</select>
```

В `OrderEditor.tsx` заменить два `ishchiga` (`182`, `186`) на `ijrochiga` и оба `title` (`180`, `184`)
на нейтральные: `Narx — operatsiya (stanok) bahosi, mijoz fakturasiga shu tushadi. Stavka — ijrochiga to‘lanadigan qism.`
и `Summa = operatsiya narxi × bosqich miqdori; ostida ijrochiga to‘lanadigan summa`.
Заголовок секции (`160`) — `Ijrochi stavkasi × miqdor to‘lanadi.` вместо `Ishchiga stavka × miqdor to‘lanadi.`
Не менять quantity, salePrice, locks, reorder и totals.

- [ ] **Step 5: GREEN — CatalogSettings, быстрый редактор ставки и таблица ставок**

Точные правки подписи стоимости исполнителя:

```tsx
// src/components/CatalogSettings.tsx:83 — видимая строка списка операций
<div className="catalog-price"><b>{money(row.salePrice)}</b><small>mijozga · {money(row.workerRate)} ijrochiga</small></div>

// src/components/CatalogSettings.tsx:129 и src/components/QuickEditors.tsx:118 — label поля workerRate
<Field label="Ijrochi tannarxi, UZS">…</Field>

// src/App.tsx:529 — заголовок и data-label колонки «Xodimga stavka»
<th className="right">Ijrochi stavkasi</th>
<td data-label="Ijrochi stavkasi" className="right">…</td>
```

`src/i18n.ts:38` (`cashPayroll: 'Xodimga to‘lov'`), `src/guide.ts` и подпись источника кассы
`payroll: 'Xodimga to‘lov'` в `App.tsx:544` остаются как есть: они про работников, а не про ставку операции.

Save button в operation dialog ослабить, чтобы чисто внешняя операция без работников сохранялась:

```tsx
<button className="primary" disabled={busy}>
  {busy ? 'Saqlanmoqda…' : 'Operatsiyani saqlash'}
</button>
```

Домен по-прежнему запрещает назначить работника, которого нет в `operation.employeeIds` (Task 2),
поэтому снятие `!operation.employeeIds.length` не открывает новую дыру в авторизации.

- [ ] **Step 6: Проверка**

Run: `npx vitest run src/order-editor.test.ts src/outsource-ui.test.tsx src/copy.test.ts`
Expected: PASS без фиктивных assertions.
Run: `npm run build`
Expected: exit 0; nullable employeeId не оставляет unchecked UI access.

---

### Task 7: Приёмка внешнего этапа, оплата подрядчику, реестр и кредиторские итоги

**Files:**
- Modify: `src/work-view.ts` (`executorLabel()`)
- Modify: `src/App.tsx` (экспортируемая `SupplierPayForm`, модалки, кнопка приёмки, подписи исполнителя, creditor totals)
- Modify: `src/components/OrderPositions.tsx:17,34`
- Modify: `src/components/WidgetBoard.tsx:36`
- Modify: `src/console.ts:49`
- Modify: `src/components/FinanceStatements.tsx:20,105-110,177-181,259-268`
- Test: `src/work-view.test.ts`, `src/console.test.ts`, `src/outsource-ui.test.tsx`

**Interfaces:**
- Consumes: `supplierDebt()`, `acceptedOutsourceCost(state, supplierId)` (Task 4), `outsource.accept` (Task 3),
  расширенный `supplier.pay` (Task 4), `ExecutorKind` (Task 1), `cashCategoryLabel('outsourcing')` (Task 4).
- Produces:
  ```ts
  // src/work-view.ts
  export function executorLabel(state: State, task: RouteLine): string;

  // src/App.tsx — экспорт нужен только UI-тесту, ровно как SalaryPayForm (src/App.tsx:676)
  export function SupplierPayForm({
    supplierId, orderId, category, defaultNote, balance, busy, close, save,
  }: {
    supplierId: string;
    orderId: string | null;
    category: 'supplier' | 'outsourcing';
    defaultNote: string;
    balance: number;
    busy: boolean;
    close: () => void;
    save: (command: Command) => Promise<void>;
  });
  ```
  Modal state остаётся существующим `{ type: string; id?: string }`: новый тип `outsourcePay` несёт `task.id`,
  тип `supplierPay` продолжает нести `supplier.id`. Order, supplier и баланс выводятся из текущего `state`
  в момент рендера — новый глобальный store не создавать.

Форма живёт в `src/App.tsx`, а не в новом файле: `text()`, `number()`, `account()` — module-local хелперы
`src/App.tsx:104-106`, переключатель модалок и `modalTitle()` тоже там, и уже экспортируемые
`SalaryPayForm` / `ExpensePayForm` экспортированы именно ради `src/salary-ui.test.tsx`. Отдельный
`src/components/OutsourcePaymentForm.tsx` заставил бы дублировать эти три хелпера и обходную проводку.

- [ ] **Step 1: RED — подпись исполнителя и аванс вне кредиторского итога**

В `src/work-view.test.ts` дополнить существующий import и добавить тест (фикстура `demo()` уже есть в файле):

```ts
import { boardTaskLabels, boardTaskLabel, executorLabel, taskUnit, unitLabel, workHistoryRows, workTaskRows } from './work-view';
import type { Actor, Command, RouteLine, State, TaskStatus } from './types';

it('names the contractor of a supplier stage and the worker otherwise', () => {
  const { state, first } = demo();
  expect(executorLabel(state, first)).toBe(state.employees.find(row => row.id === first.employeeId)!.name);
  state.suppliers = [{ id: 'supplier-1', name: 'Metall usta', phone: '' }];
  const outsourced: RouteLine = { ...first, executorKind: 'supplier', employeeId: null, supplierId: 'supplier-1' };
  expect(executorLabel(state, outsourced)).toBe('Metall usta');
  expect(executorLabel(state, { ...outsourced, supplierId: 'removed' })).toBe('Pudratchi');
});
```

В `src/console.test.ts` — новый тест внутри существующего `describe('director console')`; хелперы
`fixture`, `purchase`, `purchaseLine`, `movement`, `cashEntry` и константа `asOf` в файле уже есть:

```ts
import { supplierDebt } from './domain';

it('keeps a supplier advance out of the payable total', () => {
  const state = fixture({
    suppliers: [{ id: 's1', name: 'Pudratchi', phone: '' }],
    purchases: [purchase('p1', 's1', [purchaseLine('l1', 2, 100000, 2)])],
    movements: [movement('m1', 'p1', 2, 100000)],
    cash: [cashEntry({ direction: 'out', amount: 300000, source: 'supplier', sourceId: 's1', category: 'outsourcing' })],
  });
  expect(supplierDebt(state, 's1')).toBe(-100000);
  expect(directorConsole(state, asOf).payable).toEqual({ payroll: 0, suppliers: 0, expenses: 0, loans: 0, total: 0 });
});
```

Run: `npx vitest run src/work-view.test.ts src/console.test.ts`
Expected: FAIL — `executorLabel` не экспортируется; `payable.suppliers` = `-100000` и `total` = `-100000`,
потому что аванс подрядчику сейчас вычитается из чужих долгов.

- [ ] **Step 2: GREEN — `executorLabel()` и все nullable call sites**

В `src/work-view.ts` рядом с `taskUnit()`:

```ts
export function executorLabel(state: State, task: RouteLine): string {
  return task.executorKind === 'supplier'
    ? state.suppliers.find(row => row.id === task.supplierId)?.name ?? 'Pudratchi'
    : state.employees.find(row => row.id === task.employeeId)?.name ?? 'Xodim';
}
```

Заменить `employeeName(t.employeeId)` на `executorLabel(state, t)` во всех местах, где аргумент — элемент
`order.route` (сигнатура `employeeName(id: string)` в `src/App.tsx:373` больше не принимает `string | null`):

| Место | Было | Стало |
| --- | --- | --- |
| `src/App.tsx:445` (TV-чипы) | `employeeName(t.employeeId).split(' ')[0]` | `executorLabel(state, t).split(' ')[0]` |
| `src/App.tsx:487` (kanban `stage-chip`) | `employeeName(t.employeeId)` | `executorLabel(state, t)` |
| `src/App.tsx:500` (совет прод. доски) | `{employeeName(t.employeeId)} · {money(t.rate)}…` | `{executorLabel(state, t)} · {money(t.rate)}…` |
| `src/components/OrderPositions.tsx:34` | `employeeName(task.employeeId)` | `executorLabel(state, task)` |

Не менять: `employeeName(p.employeeId)` в `src/App.tsx:528,530` — `PayrollEntry.employeeId` остаётся
`string`; ветка `modal.type === 'work'` (`src/App.tsx:607`) доступна только employee-этапам (Step 4).
Локальный хелпер `employeeName` в `src/components/OrderPositions.tsx:17` после замены удалить,
импортировать `executorLabel` из `../work-view`.

Run: `npx vitest run src/work-view.test.ts src/console.test.ts -t "contractor"`
Expected: FAIL остаётся только у console-теста (он правится в Step 5), work-view — PASS.

- [ ] **Step 3: RED — форма оплаты подрядчику**

В `src/outsource-ui.test.tsx` (создан в Task 6) дополнить imports и добавить рендер-хелпер по образцу
`src/salary-ui.test.tsx:41-47`:

```tsx
import * as AppModule from './App';
import { createElement, type ComponentType } from 'react';

type SupplierPayProps = {
  supplierId: string;
  orderId: string | null;
  category: 'supplier' | 'outsourcing';
  defaultNote: string;
  balance: number;
  busy: boolean;
  close: () => void;
  save: (command: Command) => Promise<void>;
};

function renderSupplierPay(props: Partial<SupplierPayProps> = {}): string {
  const Form = (AppModule as unknown as { SupplierPayForm?: ComponentType<SupplierPayProps> }).SupplierPayForm;
  expect(Form).toBeTypeOf('function');
  return renderToStaticMarkup(createElement(Form!, {
    supplierId: 's1', orderId: 'o1', category: 'outsourcing', defaultNote: 'ORD-0042 · Autsors xizmati',
    balance: 200000, busy: false, close: () => {}, save: async () => {}, ...props,
  }));
}
```

Тесты:

```tsx
it('caps an outsourcing payment at the accepted debt', () => {
  const html = renderSupplierPay();
  expect(html).toContain('Qarz');
  expect(html).toContain('max="200000"');
  expect(html).toContain('value="200000"');
  expect(html).toContain('ORD-0042 · Autsors xizmati');
  expect(html).toContain('Avans to‘loviga ruxsat');
});

it('drops the cap for an advance without a negative default', () => {
  const html = renderSupplierPay({ balance: -50000 });
  expect(html).toContain('Avans');
  expect(html).not.toMatch(/name="amount"[^>]*max=/);
  expect(html).not.toContain('value="-50000"');
});

it('labels a registry payment as a supplier payment', () => {
  const html = renderSupplierPay({ orderId: null, category: 'supplier', defaultNote: 'Metall usta · Xarid to‘lovi' });
  expect(html).toContain('Metall usta · Xarid to‘lovi');
});
```

Run: `npx vitest run src/outsource-ui.test.tsx -t "outsourcing payment"`
Expected: FAIL — `SupplierPayForm` не экспортируется из `./App`.

- [ ] **Step 4: GREEN — форма, модалки и кнопка приёмки**

Форма — копия структуры `SalaryPayForm` (`src/App.tsx:676-694`): `Amount`, `AccountField` и `note`
uncontrolled и читаются из `FormData`, контролируете только `allowPrepay`:

```tsx
export function SupplierPayForm({ supplierId, orderId, category, defaultNote, balance, busy, close, save }: {
  supplierId: string; orderId: string | null; category: 'supplier' | 'outsourcing'; defaultNote: string;
  balance: number; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [allowPrepay, setAllowPrepay] = useState(false);
  const payable = Math.max(0, balance);
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({
    type: 'supplier.pay', supplierId, ...(orderId ? { orderId } : {}), amount: number(form, 'amount'),
    account: account(form), allowPrepay, note: text(form, 'note'), category,
  }); }}>
    <div className="form-body">
      <div className="payment-due"><small>{balance >= 0 ? 'Qarz' : 'Avans'}</small><strong>{money(Math.abs(balance))}</strong></div>
      <Amount name="amount" defaultValue={payable || undefined} max={allowPrepay || payable <= 0 ? undefined : payable} />
      <AccountField />
      <Field label="Izoh"><input name="note" maxLength={200} defaultValue={defaultNote} required /></Field>
      <label className="check-field"><input type="checkbox" checked={allowPrepay} onChange={event => setAllowPrepay(event.target.checked)} />Avans to‘loviga ruxsat</label>
      <p className="subtle-note">{category === 'outsourcing'
        ? 'Qabul qilinmagan ish uchun to‘lov avans bo‘lib qoladi. Ruxsat berilsa, qarzdan ortiqcha summa ham yoziladi.'
        : 'Ruxsat berilsa, qabul qilingan xariddan ortiqcha summa avans bo‘lib qoladi.'}</p>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button><button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'To‘lovni o‘tkazish'}</button></footer>
  </form>;
}
```

`Amount` (`src/ui.tsx:51`) уже рендерит `name="amount" type="number" step="0.01" min="0.01" max defaultValue
required` — именно поэтому тесты смотрят на `max=` и `value=`, а новый input-разметок не изобретать.

Проводка модалок в `src/App.tsx`:

1. Ветка `salaryPay` (`:595`) — рядом добавить обе ветки оплаты подрядчику:

```tsx
{modal.type === 'supplierPay' && (() => { const supplier = state.suppliers.find(row => row.id === modal.id); return supplier
  ? <SupplierPayForm supplierId={supplier.id} orderId={null} category="supplier" defaultNote={`${supplier.name} · Xarid to‘lovi`}
    balance={supplierDebt(state, supplier.id)} busy={busy} close={() => setModal(null)}
    save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
{modal.type === 'outsourcePay' && (() => { const hit = state.orders.flatMap(row => row.route.map(task => ({ order: row, task })))
  .find(row => row.task.id === modal.id); return hit?.task.supplierId
  ? <SupplierPayForm supplierId={hit.task.supplierId} orderId={hit.order.id} category="outsourcing"
    defaultNote={`${hit.order.number} · Autsors xizmati`} balance={supplierDebt(state, hit.task.supplierId)}
    busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} /> : null; })()}
```

2. Из общей ветки `['orderPay', 'supplierPay', 'payrollPay']` (`:593`) убрать `supplierPay` из массива и из
   тернарника `amount` — иначе `modal.id` (supplier) попадёт в форму без `allowPrepay`/`category`.
3. `modalTitle` (`:616`) добавить `outsourcePay: 'Pudratchiga to‘lov'`. Общая `Dialog`-обёртка (`:590`)
   уже покрывает оба типа: ни `supplierPay`, ни `outsourcePay` в её стоп-списке не значатся.
4. Кнопки внешнего этапа — в карточке задания прод. доски (`:500`), где сейчас лежит `show('work', …)`:

```tsx
{t.executorKind === 'supplier'
  ? <div className="button-group">
    <button className="secondary" disabled={busy || t.status === 'completed' || t.completed < t.planned}
      onClick={() => void run({ type: 'outsource.accept', taskId: t.id })}>Ishni qabul qilish</button>
    <button className="secondary" disabled={busy || order.status === 'cancelled'}
      onClick={() => show('outsourcePay', t.id)}>Pudratchiga to‘lash</button>
  </div>
  : <button className="secondary" disabled={busy || !available || t.status !== 'in_progress'}
    onClick={() => show('work', `${o.id}:${t.id}`)}>{boardLabel}</button>}
```

`Ishni qabul qilish` недоступна до полной приёмки (`completed < planned`) — причину отклонения уже
возвращает домен (`outsource.accept` в Task 3); `boardLabel` — существующее тернарное выражение статуса.
Worker-терминал не меняется: `workTaskRows()` (`src/work-view.ts:45`) отбирает этапы по
`task.employeeId !== actor.id`, supplier-этап туда не попадает.

Run: `npx vitest run src/outsource-ui.test.tsx src/work-view.test.ts src/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: GREEN — реестр подрядчиков, колонка «Xizmatlar» и creditor totals**

`src/App.tsx:521` — карточка реестра остаётся трёхдетной (`div / strong / button`), новая строка уходит
внутрь существующего `div`, чтобы не ломать `mini-cards` раскладку; `disabled` с баланса снимается:

```tsx
{supplierRows.map(s => { const balance = supplierDebt(state, s.id); const services = acceptedOutsourceCost(state, s.id);
  return <article key={s.id}><div><b>{s.name}</b><small>{s.phone}</small>{services > 0 && <small>Xizmatlar: {money(services)}</small>}</div>
    <strong>{balance >= 0 ? money(balance) : `Avans ${money(-balance)}`}</strong>
    <button className="secondary" onClick={() => show('supplierPay', s.id)}>To‘lash</button></article>; })}
```

Кредиторские итоги считают только долг, аванс показывается в карточке:

```ts
// src/App.tsx:427, src/components/WidgetBoard.tsx:36, src/console.ts:49
const supplierTotal = state.suppliers.reduce((sum, supplier) => sum + Math.max(0, supplierDebt(state, supplier.id)), 0);
```

Метрики «Yetkazib beruvchilarga qarz» (`:519`), «Majburiyatlar» (`:543`) и список «Kreditor qarzdorlik»
(`:546`, уже фильтрует `> 0`) наследуют clamp из `:427` — отдельных правок не требуют. Итоги по
работникам (`payrollTotal`) не трогать: поведение окладов и авансов работников описано существующими
тестами и в этот план не входит.

`src/components/FinanceStatements.tsx` — колонка принятых услуг рядом с материалами:

```tsx
// :20
type SupplierSort = 'name' | 'received' | 'outsourced' | 'paid' | 'debt';

// :105-110, после 'received'
{ value: 'outsourced', label: 'Xizmatlar', get: row => row.outsourced },

// :177-181, в итоговую полосу вкладки
<span>Xizmatlar<b>{money(outsourced)}</b></span>
// рядом с :134-136
const outsourced = supplierRows.reduce((sum, row) => sum + row.outsourced, 0);

// :259 — <th className="right">Qabul qilingan</th> → сразу после него <th className="right">Xizmatlar</th>
// :263 — после cell «Qabul qilingan»:
<td data-label="Xizmatlar" className="right">{money(row.outsourced)}</td>
```

Run: `npx vitest run src/console.test.ts src/statements.test.ts src/salary-ui.test.tsx`
Expected: PASS — `payable.suppliers` = 0, `supplierStatements().outsourced` из Task 5 остаётся зелёным.

- [ ] **Step 6: Проверка**

Run: `npx tsc -b --pretty false`
Expected: exit 0. Это главная защита от пропущенного call site: `RouteLine.employeeId` теперь
`string | null`, и любой оставшийся `employeeName(task.employeeId)` не компилируется.
Run: `npx vitest run src/work-view.test.ts src/console.test.ts src/outsource-ui.test.tsx src/domain.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: exit 0.

Таблица `FinanceStatements` и карточка реестра открываются только после переключения вкладки и клика,
поэтому их визуальная проверка перенесена в браузерный сценарий Task 10; здесь проверяются чистые
функции (`executorLabel`, `directorConsole`, `SupplierPayForm` markup) и типы.

---

### Task 8: Canonical Supabase schema и генератор idempotent migration

**Files:**
- Modify: `supabase/schema.sql` (`erp_tasks` DDL 183–207; `erp_insert_route` 765–791; `erp_revise_route` 868–931;
  `erp_supplier_cost` 685–691; `erp_work_task` 1012–1045; `erp_assert_cash` 1046–1094; `erp_snapshot` route projection
  1356–1365; `erp_execute` — role gate 1593–1598, `series.create` 2034, `orderLine.cancel` 2107–2140, `work.accept`
  2150, `supplier.pay` 2300–2310, `shipment.create` 2593–2610)
- Create: `.validation-pglite-20261029/generate-outsourced-services-migration.mjs`
- Generate: `supabase/migrations/20261106_outsourced_services.sql`

**Interfaces:**
- Consumes: доменные правила Tasks 1–5 (те же строки ошибок) и существующие реальные helper'ы
  `erp_uuid(jsonb,text)`, `erp_bool(jsonb,text)`, `erp_money(jsonb,text,boolean)`, `erp_num(jsonb,text,boolean)`,
  `erp_array(jsonb,text,boolean)`, `erp_account(jsonb)`, `erp_balance(uuid,text)`, `erp_paid(uuid,text,uuid)`,
  `erp_ready(uuid,uuid)`, `erp_task_started(uuid,uuid,uuid)`, `erp_sync_order(uuid,uuid)`.
- Produces: колонки `executor_kind/supplier_id` + CHECK/FK; финальные тела
  `erp_insert_route`, `erp_revise_route`, `erp_supplier_cost`, `erp_work_task`, `erp_assert_cash`, `erp_snapshot`,
  `erp_execute`; генератор, который переносит ровно эти тела в migration и больше ничего не редактирует.

Новых DECLARE-переменных в `erp_execute` не нужно: блок 1500–1581 уже содержит `v_kind text`, `v_cap numeric`,
`v_id uuid`, `v_note text`, `v_allow_prepay boolean`, `v_order erp_orders%ROWTYPE`, `v_task erp_tasks%ROWTYPE`,
`v_line_id uuid`, `v_entity uuid`. В `erp_insert_route` и `erp_revise_route` добавить `v_kind text`,
`v_employee uuid`, `v_supplier uuid` в их собственные DECLARE-строки.

Role gate (1593–1598) не меняется: worker уже ограничен списком `work.accept|work.start|work.submit`, display
read-only, значит `outsource.accept` и `supplier.pay` остаются admin-only автоматически. Task 9 проверяет это
поведение, а не новую ветку.

- [ ] **Step 1: RED — генератор отказывается писать migration из старой canonical schema**

Создать `.validation-pglite-20261029/generate-outsourced-services-migration.mjs`:

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schemaPath = new URL('supabase/schema.sql', root);
const outputPath = new URL('supabase/migrations/20261106_outsourced_services.sql', root);
const schema = await fs.readFile(schemaPath, 'utf8');

const names = ['erp_insert_route', 'erp_revise_route', 'erp_supplier_cost', 'erp_work_task',
  'erp_assert_cash', 'erp_snapshot', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}

require("executor_kind text NOT NULL DEFAULT 'employee'", 'erp_tasks.executor_kind');
require('supplier_id uuid', 'erp_tasks.supplier_id');
require("WHEN 'outsource.accept' THEN", 'outsource.accept branch');
require("'Series production uses employees only'", 'series executor guard');
require("'Outsourced task is not available to workers'", 'worker executor guard');
require("'Accepted outsourced work cannot be cancelled'", 'cancel executor guard');
require("'Supplier is not assigned to this order'", 'order origin payment guard');
require("'Payment exceeds payable'", 'supplier payable cap');

function definition(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = schema.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated function ${name}`);
  const body = schema.slice(start, end + 4);
  if (body.slice(0, body.length - 4).includes('$$')) throw new Error(`Nested dollar quote in ${name}`);
  return body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

const ddl = `-- Aliya ERP: outsourced services — a route stage may be executed by a supplier instead of an employee.
-- Safe to run more than once. Existing rows keep executor_kind = 'employee'.

BEGIN;

ALTER TABLE public.erp_tasks
  ADD COLUMN IF NOT EXISTS executor_kind text NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.erp_tasks ALTER COLUMN employee_id DROP NOT NULL;

DO $ddl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_tasks_executor_kind_check') THEN
    ALTER TABLE public.erp_tasks ADD CONSTRAINT erp_tasks_executor_kind_check
      CHECK (executor_kind IN ('employee', 'supplier'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_tasks_executor_check') THEN
    ALTER TABLE public.erp_tasks ADD CONSTRAINT erp_tasks_executor_check CHECK (
      (executor_kind = 'employee' AND employee_id IS NOT NULL AND supplier_id IS NULL)
      OR (executor_kind = 'supplier' AND employee_id IS NULL AND supplier_id IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_tasks_supplier_fk') THEN
    ALTER TABLE public.erp_tasks ADD CONSTRAINT erp_tasks_supplier_fk
      FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id);
  END IF;
END
$ddl$;

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_snapshot() TO authenticated;
REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;

COMMIT;
`;

const sql = ddl + names.map(definition).join('\n') + '\n' + grants;
await fs.writeFile(outputPath, sql);
console.log(JSON.stringify({ functions: names.length, sha256: crypto.createHash('sha256').update(sql).digest('hex') }));
```

`REVOKE/GRANT` повторяются только для двух функций, которые перезаписываются: сигнатуры
`erp_snapshot()` и `erp_execute(uuid, bigint, jsonb)` не меняются, поэтому хвост canonical schema (2694–2713)
остаётся валидным, а `CREATE OR REPLACE FUNCTION` сбрасывает grants к `PUBLIC`-значениям по умолчанию.
Точная форма скопирована из `supabase/migrations/20261106_worker_operation_access.sql:142-143`.

Run: `node .validation-pglite-20261029/generate-outsourced-services-migration.mjs`
Expected: FAIL — `Canonical schema is missing erp_tasks.executor_kind`. Файл migration не создаётся.

- [ ] **Step 2: GREEN — DDL в canonical schema**

В `CREATE TABLE public.erp_tasks` (183–207) заменить `employee_id uuid NOT NULL,` на три строки:

```sql
  employee_id uuid,
  supplier_id uuid,
  executor_kind text NOT NULL DEFAULT 'employee',
```

Перед закрывающей скобкой таблицы, после существующих `UNIQUE`/`FOREIGN KEY`, добавить; все прежние ограничения,
включая `UNIQUE (company_id, id, order_id, employee_id)` и `CHECK (round(planned * rate, 2) <= 1000000000000)`,
остаются без изменений:

```sql
  CHECK (executor_kind IN ('employee', 'supplier')),
  CHECK ((executor_kind = 'employee' AND employee_id IS NOT NULL AND supplier_id IS NULL)
    OR (executor_kind = 'supplier' AND employee_id IS NULL AND supplier_id IS NOT NULL)),
  FOREIGN KEY (company_id, supplier_id) REFERENCES public.erp_suppliers(company_id, id)
```

`UNIQUE (company_id, id, order_id, employee_id)` сохраняет смысл: у Postgres NULL-значения в уникальном ключе не
столкиваются, поэтому набор supplier-строк constraint не нарушает.

- [ ] **Step 3: GREEN — `erp_insert_route` (765–791)**

Заменить функцию целиком: это единственный путь создания маршрута, его вызывают `order.create`, `order.update`
и `series.create` (2034).

```sql
CREATE FUNCTION public.erp_insert_route(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_qty numeric, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer; v_stage numeric; v_operation public.erp_operations%ROWTYPE;
  v_kind text; v_employee uuid; v_supplier uuid;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_tasks
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(coalesce(p_lines, '[]'::jsonb), 'route', true)) LOOP
    SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id
      AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
    IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
    -- Legacy payloads carry no executorKind and must keep behaving exactly like an employee stage.
    v_kind := coalesce(v_line ->> 'executorKind', 'employee');
    v_employee := CASE WHEN v_line ? 'employeeId' AND btrim(v_line ->> 'employeeId') <> ''
      THEN public.erp_uuid(v_line -> 'employeeId', 'employeeId') ELSE NULL END;
    v_supplier := CASE WHEN v_line ? 'supplierId' AND btrim(v_line ->> 'supplierId') <> ''
      THEN public.erp_uuid(v_line -> 'supplierId', 'supplierId') ELSE NULL END;
    IF v_kind = 'employee' THEN
      IF v_employee IS NULL OR v_supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Employee stage requires exactly one employee' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee AND active) THEN
        RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
      END IF;
    ELSIF v_kind = 'supplier' THEN
      IF v_employee IS NOT NULL OR v_supplier IS NULL THEN
        RAISE EXCEPTION 'Supplier stage requires exactly one supplier' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF (SELECT kind FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id) = 'series' THEN
        RAISE EXCEPTION 'Series production uses employees only' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023';
    END IF;
    -- A stage plans its own volume (sheets, metres, holes); older payloads fall back to the position quantity.
    v_stage := CASE WHEN v_line -> 'qty' IS NOT NULL THEN public.erp_num(v_line -> 'qty', 'stage qty') ELSE p_qty END;
    INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
      employee_id, supplier_id, rate, sale_price, standard_minutes, planned)
      VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
        v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true), v_operation.sale_price,
        v_operation.standard_minutes, v_stage);
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;
```

Разбор `btrim(... <> '')` — существующая конвенция проекта для optional uuid (см. 1618–1628, 2450–2452): она
одинаково принимает отсутствующий ключ и явный JSON `null`, поэтому домен Task 2 и сервер читают input
одинаково. Серия отсечена здесь, потому что `series.create` — единственный путь с `kind = 'series'`, а
`order.update` уже отвергает series-заказы (1866), так что `erp_revise_route` для серии недостижим.

- [ ] **Step 4: GREEN — `erp_revise_route` (868–931)**

Три правки, остальной текст не меняется.

1. DECLARE (870–871): добавить `v_kind text; v_employee uuid; v_supplier uuid;`.

2. Started-freeze сравнение (880–886) — три executor-поля вместо одного `employeeId`:

```sql
    IF v_started AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE l.value ? 'taskId' AND public.erp_uuid(l.value -> 'taskId', 'taskId') = v_task.id
        AND public.erp_uuid(l.value -> 'operationId', 'operationId') = v_task.operation_id
        AND coalesce(l.value ->> 'executorKind', 'employee') = v_task.executor_kind
        AND CASE WHEN l.value ? 'employeeId' AND btrim(l.value ->> 'employeeId') <> ''
          THEN public.erp_uuid(l.value -> 'employeeId', 'employeeId') ELSE NULL END IS NOT DISTINCT FROM v_task.employee_id
        AND CASE WHEN l.value ? 'supplierId' AND btrim(l.value ->> 'supplierId') <> ''
          THEN public.erp_uuid(l.value -> 'supplierId', 'supplierId') ELSE NULL END IS NOT DISTINCT FROM v_task.supplier_id
        AND public.erp_money(l.value -> 'rate', 'route rate', true) = v_task.rate) THEN
      RAISE EXCEPTION 'Started stage cannot be removed or changed' USING ERRCODE = '23514';
    END IF;
```

`IS NOT DISTINCT FROM` нужен именно здесь: `uuid = NULL` никогда не даёт true, поэтому started employee-этап,
переписанный на подрядчика (и наоборот), отклоняется, а unchanged started-этап проходит.

3. Тело цикла (897–925): заменить `v_id := public.erp_uuid(v_line -> 'employeeId', 'employeeId');` и две идущие
проверки на те же `v_kind`/`v_employee`/`v_supplier` разборы и `IF v_kind = 'employee' … ELSIF v_kind = 'supplier' …
ELSE` ветки из Step 3, с теми же строками ошибок (series-проверку здесь не дублировать — путь недостижим).
В `IF v_started THEN` UPDATE остаётся без executor-полей; в `ELSE` UPDATE и в INSERT записать все три поля:

```sql
        UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
          executor_kind = v_kind, employee_id = v_employee, supplier_id = v_supplier,
          rate = public.erp_money(v_line -> 'rate', 'route rate', true),
          sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes,
          planned = v_stage, completed = 0, status = 'assigned' WHERE company_id = p_company_id AND id = v_task.id;
      END IF;
    ELSE
      INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
        employee_id, supplier_id, rate, sale_price, standard_minutes, planned)
        VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
          v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true), v_operation.sale_price,
          v_operation.standard_minutes, v_stage);
```

`v_id` в функции остаётся: он нужен для `taskId`-разбора в 881, 891 и 907.

- [ ] **Step 5: GREEN — `erp_supplier_cost` (685–691)**

Заменить тело: приёмка аутсорса создаёт обязательство без purchase и без stock movement, поэтому стоимость
складывается из принятых товаров и принятых внешних работ.

```sql
CREATE FUNCTION public.erp_supplier_cost(p_company_id uuid, p_supplier_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Received goods and accepted outsourced work, each line rounded exactly like the frontend ledger.
  SELECT coalesce((SELECT sum(round(m.qty * m.unit_cost, 2))
    FROM public.erp_stock_movements m JOIN public.erp_purchases p ON p.company_id = m.company_id AND p.id = m.source_id
    WHERE m.company_id = p_company_id AND m.source = 'purchase' AND m.direction = 'in' AND p.supplier_id = p_supplier_id), 0)
    + coalesce((SELECT sum(round(t.completed * t.rate, 2)) FROM public.erp_tasks t
      WHERE t.company_id = p_company_id AND t.supplier_id = p_supplier_id
        AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0);
$$;
```

Отменённые заказы не исключаются: spec сохраняет принятое обязательство после `order.cancel`. `status = 'completed'`
а не `completed > 0`, поэтому `outsource.accept` — единственная точка, где обязательство возникает.

- [ ] **Step 6: GREEN — `erp_work_task` (1012–1045): внешний этап закрыт для цеха**

Существующая проверка `IF p_actor.role <> 'admin' AND v_task.employee_id <> p_actor.employee_id` (1022) пропускает
NULL: сравнение с NULL никогда не даёт true, поэтому worker получил бы доступ к supplier-этапу. Сразу после
`IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;` (1021) добавить:

```sql
  IF v_task.executor_kind <> 'employee' OR v_task.employee_id IS NULL THEN
    RAISE EXCEPTION 'Outsourced task is not available to workers' USING ERRCODE = '42501';
  END IF;
```

Следующие проверки (`Active employee not found`, `Employee is not authorized for this operation`) не меняются и
теперь всегда получают ненулевой `v_task.employee_id`.

- [ ] **Step 7: GREEN — `erp_execute`: `outsource.accept`, cancel, `supplier.pay`**

1. Новый branch сразу после `WHEN 'work.accept' THEN` блока (2150–2156):

```sql
    WHEN 'outsource.accept' THEN
      v_entity := public.erp_uuid(p_command -> 'taskId', 'taskId');
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_task.order_id FOR UPDATE;
      IF v_order.status <> 'production' THEN RAISE EXCEPTION 'Order is not in production' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND id = v_task.line_id AND status = 'production') THEN
        RAISE EXCEPTION 'Order line is not in production' USING ERRCODE = '23514';
      END IF;
      IF v_task.executor_kind <> 'supplier' OR v_task.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Not an outsourced task' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'assigned' OR v_task.completed <> 0 THEN
        RAISE EXCEPTION 'Outsourced task is already accepted' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_tasks SET completed = planned, status = 'completed'
        WHERE company_id = v_company AND id = v_task.id;
      PERFORM public.erp_ready(v_company, v_task.order_id);
```

Здесь сознательно не пишутся `erp_payroll`, `erp_stock_movements` и `erp_cash`: обязательство существует только как
`completed * rate` в `erp_supplier_cost` (Step 5). `erp_ready` (975–1011) проверяет `completed < planned` и выданные
материалы, поэтому готовность заказа меняется без правки самой функции, а series-приход склада внутри него защищён
Step 3.

2. `orderLine.cancel` (2107–2140): после проверки `Shipped line cannot be cancelled` (2122–2124) и до цикла
возврата материалов добавить:

```sql
      IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id
        AND executor_kind = 'supplier' AND status = 'completed') THEN
        RAISE EXCEPTION 'Accepted outsourced work cannot be cancelled' USING ERRCODE = '23514';
      END IF;
```

`order.cancel` не менять: он сохраняет маршруты, а вместе с ними принятое обязательство, авансы и оплаты.

3. `supplier.pay` (2300–2310) заменить целиком:

```sql
    WHEN 'supplier.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := CASE WHEN p_command ? 'allowPrepay' THEN public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay') ELSE false END;
      v_note := coalesce(p_command ->> 'note', '');
      v_kind := coalesce(p_command ->> 'category', 'supplier');
      IF v_kind NOT IN ('supplier', 'outsourcing') THEN
        RAISE EXCEPTION 'Invalid supplier payment category' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'orderId' AND btrim(p_command ->> 'orderId') <> '' THEN
        v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
        SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
        IF v_order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled order cannot be paid' USING ERRCODE = '23514'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_id
          AND executor_kind = 'supplier' AND supplier_id = v_entity) THEN
          RAISE EXCEPTION 'Supplier is not assigned to this order' USING ERRCODE = '23514';
        END IF;
      END IF;
      v_cap := public.erp_supplier_cost(v_company, v_entity) - public.erp_paid(v_company, 'supplier', v_entity);
      IF NOT v_allow_prepay AND v_amount > v_cap THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note)
        VALUES (v_company, 'out', v_amount, v_account, 'supplier', v_entity, v_kind, v_note);
```

`public.erp_bool` бросает `allowPrepay must be a boolean` на отсутствующем поле (проверено по телу helper'а),
поэтому флаг разбирается через `CASE WHEN p_command ? 'allowPrepay'`: закешированный старый бандл, который не шлёт
ни `allowPrepay`, ни `category`, ни `note`, сохраняет сегодняшнее поведение — cap без аванса и категория `supplier`.
Сообщение `Payment exceeds payable` уже используется в `salary.pay` (2348) и совпадает с доменом Task 4.
`erp_cash.source` остаётся `'supplier'`, поэтому `erp_paid`, сторно через `cash.reverse` и карточка
контрагента продолжают работать без изменений.

- [ ] **Step 8: GREEN — `erp_assert_cash` (1046–1094): аванс подрядчику и фактическая стоимость**

1. Аванс ломает текущий invariant `erp_paid BETWEEN 0 AND v.cap` (1069–1074): при `cap = 0` и оплате 300 000 до
приёмки проверка падает с `Invalid net payment for supplier …`. Расширить CASE, сохранив нижнюю границу 0:

```sql
    IF NOT (public.erp_paid(p_company_id, v.source, v.source_id) BETWEEN 0
      AND CASE WHEN v.source = 'supplier'
        OR (v.source = 'payroll' AND (
          EXISTS (SELECT 1 FROM public.erp_salary_plans p WHERE p.company_id = p_company_id AND p.employee_id = v.source_id)
          OR EXISTS (SELECT 1 FROM public.erp_cash c WHERE c.company_id = p_company_id AND c.source = 'payroll'
            AND c.source_id = v.source_id AND c.category IN ('payroll', 'advance'))
        )) THEN 1000000000000 ELSE v.cap END) THEN
      RAISE EXCEPTION 'Invalid net payment for % %', v.source, v.source_id USING ERRCODE = '23514';
    END IF;
```

Отрицательный net (возврат от подрядчика) по-прежнему запрещён, а `v.cap > 1000000000000` (1066–1068) остаётся:
`cap = erp_supplier_cost(...)` уже включает принятый аутсорс, отдельной правки не требует.

2. В aggregate-cost проверке (1087–1088) добавить принятый аутсорс к фактической стоимости, иначе потолок 1e12
считается без него:

```sql
    OR o.overhead + coalesce((SELECT sum(round(m.qty * m.actual_cost, 2)) FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id AND m.issued), 0)
      + coalesce((SELECT sum(p.amount) FROM public.erp_payroll p WHERE p.company_id = o.company_id AND p.order_id = o.id AND p.status = 'accepted'), 0)
      + coalesce((SELECT sum(round(t.completed * t.rate, 2)) FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0) > 1000000000000))
```

Плановая граница (1086) уже считает `planned * rate` по всем этапам, включая supplier-этапы, и остаётся без
изменений.

- [ ] **Step 9: GREEN — `erp_snapshot` route projection (1356–1365)**

Заменить агрегат маршрута: admin видит обоих исполнителей, цех — только свои этапы, доска — как и раньше без денег.

```sql
        'route', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'lineId', t.line_id, 'operationId', t.operation_id, 'name', t.name,
          'executorKind', t.executor_kind,
          'employeeId', CASE WHEN v_admin OR v_board OR t.employee_id = v_profile.employee_id THEN t.employee_id::text ELSE '' END,
          'supplierId', CASE WHEN v_admin THEN t.supplier_id::text ELSE NULL END,
          'rate', CASE WHEN v_admin OR t.employee_id = v_profile.employee_id THEN t.rate ELSE 0 END,
          'salePrice', CASE WHEN v_admin THEN t.sale_price ELSE 0 END,
          'standardMinutes', t.standard_minutes,
          'planned', t.planned, 'completed', t.completed, 'status', t.status) ORDER BY t.position, t.id), '[]'::jsonb)
          FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id
            AND (v_admin OR v_board OR t.executor_kind = 'employee'))
```

`jsonb_build_object` пишет JSON `null` при NULL-значении, поэтому админский снимок даёт ровно
`employeeId: null, supplierId: '<uuid>'`, и нормализация Task 1 читает его без эвристик. Видимость заказа для
worker (1364–1365) не меняется: `t.employee_id = v_profile.employee_id` на NULL ложен, значит заказ из одного
внешнего этапа в цех не попадает. Внешняя операция уже не отдаёт worker'у чужие `employeeIds` (1315).

- [ ] **Step 10: GREEN — labor в `shipment.create` (2593–2610)**

После payroll-суммы (2595–2597) добавить принятый аутсорс этой позиции, чтобы `erp_shipment_lines.labor_cost`
совпадал с `actualCost()` из Task 5:

```sql
        v_labor_total := round(v_labor_total + coalesce((SELECT sum(round(t.completed * t.rate, 2))
          FROM public.erp_tasks t WHERE t.company_id = v_company AND t.order_id = v_id AND t.line_id = v_line_id
            AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0), 2);
```

`v_cost_total`, `v_cost_slice`, `v_material_slice` и `INSERT INTO public.erp_shipment_lines(... labor_cost)`
(2598–2610) не менять: срез себестоимости уже делится на количество отгрузки.

- [ ] **Step 11: Генерация migration**

Run: `node .validation-pglite-20261029/generate-outsourced-services-migration.mjs`
Expected: exit 0, печать `{"functions":7,"sha256":"…"}`, создан `supabase/migrations/20261106_outsourced_services.sql`.

Run повторно:

```bash
node .validation-pglite-20261029/generate-outsourced-services-migration.mjs
```

Expected: тот же `sha256` — генерация детерминирована.

Run: `grep -c "CREATE OR REPLACE FUNCTION" supabase/migrations/20261106_outsourced_services.sql`
Expected: `7`.
Run: `grep -c "^BEGIN;" supabase/migrations/20261106_outsourced_services.sql; grep -c "^COMMIT;$" supabase/migrations/20261106_outsourced_services.sql`
Expected: `1` и `1`.
Run: `grep -cE "service_role|eyJ|postgres://|Bearer" supabase/migrations/20261106_outsourced_services.sql`
Expected: `0` — в файле нет secrets.

Против live Supabase на этом шаге не выполняется ничего: применение migration — отдельное разрешение владельца
(Task 10 Step 9).

---

### Task 9: PGlite parity — новый зонд аутсорса и регрессии существующих SQL-проверок

**Files:**
- Create: `.validation-pglite-20261029/validate-outsourced-services.mjs`
- Run existing: `.validation-pglite-20261029/validate-worker-operation-access.mjs`, `validate.mjs` и остальные
  `validate-*.mjs` из этого каталога

**Interfaces:**
- Consumes: canonical `supabase/schema.sql`, generated `supabase/migrations/20261106_outsourced_services.sql`
  (Task 8), реальные `erp_bootstrap_company(text)`, `erp_execute(uuid, bigint, jsonb)`, `erp_snapshot()`,
  `erp_link_worker(uuid, uuid)`, `erp_link_display(uuid, text)`, `erp_supplier_cost(uuid, uuid)`, `erp_paid(uuid, text, uuid)`.
- Produces: полностью изолированная in-memory база (без live connection): идемпотентность migration, роли,
  tenant-изоляция, money-инварианты и неизменность состояния после отклонённой команды.

Зонд — единственный способ увидеть supplier-маршрут на реальном SQL: в демо `employeeIds` заполнены, а
браузерный snapshot в demo-режиме не различает executor'ы, поэтому UI-проверка Task 10 его не заменяет.

- [ ] **Step 1: Написать зонд (пока migration не применена к живой базе)**

Создать `.validation-pglite-20261029/validate-outsourced-services.mjs` — bootstrap и helper'ы:

```js
// Outsourced services probe: a supplier may execute a route stage, the obligation appears only after
// full acceptance, advances need an explicit flag, and no fake stock, payroll or cash movement exists.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261106_outsourced_services.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

const db = new PGlite();
const adminId = crypto.randomUUID();
const workerId = crypto.randomUUID();
const displayId = crypto.randomUUID();
const otherId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
for (const [id, name] of [[adminId, 'Owner'], [workerId, 'Worker'], [displayId, 'Board'], [otherId, 'Other']]) {
  await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)',
    [id, `${name.toLowerCase()}@local.invalid`, JSON.stringify({ name })]);
}

await db.exec(schema);
await db.exec(migration);
await db.exec(migration);
pass('Outsourced services migration applies twice on top of the canonical schema (idempotent)');

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

let companyId;
async function fingerprint() {
  const rows = await owner(`SELECT (SELECT revision FROM public.erp_metadata WHERE company_id = $1) AS revision,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.position, t.id), '[]') FROM public.erp_tasks t WHERE t.company_id = $1) AS tasks,
    (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at, c.id), '[]') FROM public.erp_cash c WHERE c.company_id = $1) AS cash,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') FROM public.erp_payroll p WHERE p.company_id = $1) AS payroll,
    (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]') FROM public.erp_stock_movements m WHERE m.company_id = $1) AS movements,
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]') FROM public.erp_shipments s WHERE s.company_id = $1) AS shipments`,
    [companyId]);
  return JSON.stringify(rows[0]);
}
async function rejected(command, pattern, userId = adminId) {
  const before = await fingerprint();
  await assert.rejects(() => executeAs(userId, command), pattern);
  assert.equal(await fingerprint(), before, 'A rejected command must not change state');
}
// erp_paid is a net sum (out minus in), so cost minus paid is exactly the owner's debt view.
const debt = async (supplierId) => Number((await one(
  'SELECT public.erp_supplier_cost($1, $2) - public.erp_paid($1, $3, $2) AS debt',
  [companyId, supplierId, 'supplier'])).debt);
const cost = async (supplierId) => Number((await one('SELECT public.erp_supplier_cost($1, $2) AS cost',
  [companyId, supplierId])).cost);
```

Продолжение того же файла — сценарий. Писать сразу после helper'ов, один запуск на весь файл.

```js
await as(adminId);
companyId = (await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Outsourced services'])).rows[0].id;
await db.exec('RESET ROLE');

// 2 — legacy employee route without executorKind keeps launching and accepting for its own worker.
let result = await execute({ type: 'employee.create', name: 'Kamol' });
const employee = result.state.employees.find(row => row.name === 'Kamol').id;
result = await execute({ type: 'supplier.create', name: 'Pudratchi', phone: '' });
const supplier = result.state.suppliers.find(row => row.name === 'Pudratchi').id;
result = await execute({ type: 'customer.create', name: 'Buyurtmachi', phone: '', address: '', kind: 'shop' });
const customer = result.state.customers.find(row => row.name === 'Buyurtmachi').id;
result = await execute({ type: 'operation.create', name: 'Raskroy', unit: 'sheet', salePrice: 5, workerRate: 2,
  standardMinutes: 15, machineId: null, employeeIds: [employee], active: true, autoAccept: true });
const internal = result.state.operations.find(row => row.name === 'Raskroy').id;
result = await execute({ type: 'operation.create', name: 'Metall ish', unit: 'piece', salePrice: 900000,
  workerRate: 0, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
const external = result.state.operations.find(row => row.name === 'Metall ish').id;
await as(workerId);
await db.query('SELECT public.erp_link_worker($1,$2)', [workerId, employee]);
await db.exec('RESET ROLE');
await as(displayId);
await db.query('SELECT public.erp_link_display($1,$2)', [displayId, 'Ekran']);
await db.exec('RESET ROLE');
await execute({ type: 'cash.post', direction: 'in', amount: 1000000, account: 'cash', toAccount: null,
  category: 'Kassa kirimi', note: 'Zond uchun boshlangich mablag‘' });

const createOrder = (title, qty, rate) => execute({ type: 'order.create', input: { kind: 'product',
  customerId: customer, title, qty, price: 900000, overhead: 0, dueDate: '2026-11-20', materials: [],
  route: [{ operationId: external, executorKind: 'supplier', employeeId: null, supplierId: supplier, rate }],
  advance: 0, account: 'cash' } });

result = await execute({ type: 'order.create', input: { kind: 'product', customerId: customer, title: 'Shkaf',
  qty: 1, price: 100, overhead: 0, dueDate: '2026-11-20', materials: [],
  route: [{ operationId: internal, employeeId: employee, rate: 2 }], advance: 0, account: 'cash' } });
const legacyOrder = result.state.orders.find(row => row.title === 'Shkaf').id;
const legacyTask = result.state.orders.find(row => row.id === legacyOrder).route[0];
assert.equal(legacyTask.executorKind, 'employee');
assert.equal(legacyTask.employeeId, employee);
await execute({ type: 'order.launch', orderId: legacyOrder });
await executeAs(workerId, { type: 'work.accept', orderId: legacyOrder, taskId: legacyTask.id });
assert.equal((await snapshot(workerId)).state.orders.find(row => row.id === legacyOrder).route[0].status, 'accepted');
pass('Legacy employee route without executorKind still launches and is accepted by its own worker');

// 3 — supplier route creation.
result = await createOrder('Metall karish', 1, 500000);
const outsourceOrder = result.state.orders.find(row => row.title === 'Metall karish').id;
const outsourceLine = result.state.orders.find(row => row.id === outsourceOrder).lines[0].id;
const supplierTask = result.state.orders.find(row => row.id === outsourceOrder).route[0];
assert.equal(supplierTask.executorKind, 'supplier');
assert.equal(supplierTask.employeeId, null);
assert.equal(supplierTask.supplierId, supplier);
assert.equal(Number(supplierTask.completed), 0);
assert.equal(supplierTask.status, 'assigned');
assert.equal(Number((await snapshot(adminId)).state.orders.find(row => row.id === outsourceOrder).price), 900000);
pass('Supplier stage is created with employeeId null, completed 0 and status assigned', { task: supplierTask.id });

// 4 — rejected executor assignments, state unchanged.
await as(otherId);
await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Second tenant']);
await db.exec('RESET ROLE');
const foreign = (await executeAs(otherId, { type: 'supplier.create', name: 'Boshqa mijoz', phone: '' }))
  .state.suppliers[0].id;
await rejected({ type: 'order.create', input: { kind: 'product', customerId: customer, title: 'Chet',
  qty: 1, price: 10, overhead: 0, dueDate: '2026-11-20', materials: [],
  route: [{ operationId: external, executorKind: 'supplier', employeeId: null, supplierId: foreign, rate: 1 }],
  advance: 0, account: 'cash' } }, /Supplier not found/);
await rejected({ type: 'order.create', input: { kind: 'product', customerId: customer, title: 'Yoq',
  qty: 1, price: 10, overhead: 0, dueDate: '2026-11-20', materials: [],
  route: [{ operationId: external, executorKind: 'supplier', employeeId: null, supplierId: crypto.randomUUID(), rate: 1 }],
  advance: 0, account: 'cash' } }, /Supplier not found/);
await rejected({ type: 'order.create', input: { kind: 'product', customerId: customer, title: 'Ikkitalab',
  qty: 1, price: 10, overhead: 0, dueDate: '2026-11-20', materials: [],
  route: [{ operationId: internal, executorKind: 'employee', employeeId: employee, supplierId: supplier, rate: 2 }],
  advance: 0, account: 'cash' } }, /Employee stage requires exactly one employee/);
result = await execute({ type: 'item.create', name: 'Seriya paneli', unit: 'piece', minQty: 0, cost: 1000, customerId: null });
const panelItem = result.state.items.find(row => row.name === 'Seriya paneli').id;
result = await execute({ type: 'item.create', name: 'Seriya korpusi', unit: 'piece', minQty: 0, cost: 0,
  customerId: null, kind: 'blank' });
const panelOutput = result.state.items.find(row => row.name === 'Seriya korpusi').id;
result = await execute({ type: 'recipe.create', outputItemId: panelOutput, name: 'Seriya resepti',
  components: [{ slot: 'Panel', itemId: panelItem, allowedItemIds: [], qtyPerUnit: 1 }] });
const panelRecipe = result.state.recipes.find(row => row.name === 'Seriya resepti');
await rejected({ type: 'series.create', input: { outputItemId: panelOutput, recipeVersionId: panelRecipe.versions[0].id,
  qty: 1, dueDate: '2026-11-20', substitutions: {},
  route: [{ operationId: external, executorKind: 'supplier', employeeId: null, supplierId: supplier, rate: 1 }] } },
  /Series production uses employees only/);
assert.equal((await snapshot(adminId)).state.orders.filter(row => row.kind === 'series').length, 0,
  'Rejected series creation leaves no order, no material line and no reservation');
pass('Unknown, foreign, double-executor and series supplier stages are rejected without changing state');

// 5 — role gates and snapshot shapes.
await execute({ type: 'order.launch', orderId: outsourceOrder });
await rejected({ type: 'outsource.accept', taskId: supplierTask.id },
  /Workers may only perform their own assigned work/, workerId);
await rejected({ type: 'supplier.pay', supplierId: supplier, amount: 1, account: 'cash', allowPrepay: true, note: '' },
  /Workers may only perform their own assigned work/, workerId);
assert.equal((await snapshot(workerId)).state.orders.find(row => row.id === outsourceOrder), undefined,
  'An order whose only stage is outsourced must not reach the workshop');
const boardTask = (await snapshot(displayId)).state.orders.find(row => row.id === outsourceOrder)
  .route.find(row => row.id === supplierTask.id);
assert.equal(boardTask.supplierId, null);
assert.equal(Number(boardTask.rate), 0);
const adminTask = (await snapshot(adminId)).state.orders.find(row => row.id === outsourceOrder)
  .route.find(row => row.id === supplierTask.id);
assert.equal(adminTask.executorKind, 'supplier');
assert.equal(adminTask.employeeId, null);
assert.equal(adminTask.supplierId, supplier);
pass('Worker and board snapshots hide the supplier executor; the admin snapshot keeps it');

// 6 — advance before acceptance.
await execute({ type: 'supplier.pay', supplierId: supplier, orderId: outsourceOrder, amount: 300000,
  account: 'cash', allowPrepay: true, category: 'outsourcing', note: 'Metall uchun avans' });
assert.equal(await cost(supplier), 0);
assert.equal(await debt(supplier), -300000);
pass('Advance of 300000 is allowed explicitly and the counterparty balance is negative');

// 7 — payable cap, funds and command validation.
await rejected({ type: 'supplier.pay', supplierId: supplier, amount: 1, account: 'cash', note: '' },
  /Payment exceeds payable/);
await rejected({ type: 'supplier.pay', supplierId: supplier, amount: 900000, account: 'bank',
  allowPrepay: true, note: '' }, /Insufficient account balance/);
await rejected({ type: 'supplier.pay', supplierId: supplier, amount: 1, account: 'cash', category: 'loan', note: '' },
  /Invalid supplier payment category/);
const advanceEntry = (await snapshot(adminId)).state.cash.filter(row => row.source === 'supplier').at(-1);
assert.equal(advanceEntry.category, 'outsourcing');
assert.equal(advanceEntry.note, 'Metall uchun avans');
assert.equal(advanceEntry.sourceId, supplier);
assert.equal(advanceEntry.direction, 'out');
pass('Supplier payment keeps category, note and source in the cash journal');

// 8 — acceptance books the obligation and nothing else.
const beforeAccept = await snapshot(adminId);
result = await execute({ type: 'outsource.accept', taskId: supplierTask.id });
const after = result.state;
const acceptedTask = after.orders.find(row => row.id === outsourceOrder).route.find(row => row.id === supplierTask.id);
assert.equal(acceptedTask.status, 'completed');
assert.equal(Number(acceptedTask.completed), 1);
assert.equal(Number(acceptedTask.planned), 1);
assert.equal(after.payroll.filter(row => row.taskId === supplierTask.id).length, 0);
assert.equal(after.movements.filter(row => row.sourceId === supplierTask.id).length, 0);
assert.equal(after.cash.length, beforeAccept.state.cash.length, 'Acceptance must not post cash');
assert.equal(after.orders.find(row => row.id === outsourceOrder).lines[0].status, 'ready');
assert.equal(await cost(supplier), 500000);
pass('outsource.accept books 500000 as received cost, marks the line ready, writes no payroll, stock or cash');

// 9 — double acceptance and internal acceptance.
await rejected({ type: 'outsource.accept', taskId: supplierTask.id }, /Outsourced task is already accepted/);
await rejected({ type: 'outsource.accept', taskId: legacyTask.id }, /Not an outsourced task/);
pass('Double acceptance and accepting an internal stage are rejected');

// 10 — debt after acceptance, partial then full payment.
assert.equal(await debt(supplier), 200000);
await execute({ type: 'supplier.pay', supplierId: supplier, orderId: outsourceOrder, amount: 50000,
  account: 'cash', note: 'Qismiy to‘lov' });
assert.equal(await debt(supplier), 150000);
await execute({ type: 'supplier.pay', supplierId: supplier, orderId: outsourceOrder, amount: 150000,
  account: 'cash', note: 'Qoldiq to‘lov' });
assert.equal(await debt(supplier), 0);
const supplierCash = (await snapshot(adminId)).state.cash.filter(row => row.source === 'supplier');
assert.equal(supplierCash.length, 3);
assert.equal(supplierCash.reduce((sum, row) => sum + Number(row.amount), 0), 500000);
pass('Debt falls 200000 to 150000 to 0 through partial and full payment without prepay');

// 11 — cancellation keeps the accepted obligation.
await rejected({ type: 'orderLine.cancel', orderId: outsourceOrder, lineId: outsourceLine },
  /Accepted outsourced work cannot be cancelled/);
await execute({ type: 'order.cancel', orderId: outsourceOrder });
assert.equal(await cost(supplier), 500000);
assert.equal(await debt(supplier), 0);
await rejected({ type: 'supplier.pay', supplierId: supplier, orderId: outsourceOrder, amount: 1,
  account: 'cash', allowPrepay: true, note: '' }, /Cancelled order cannot be paid/);
pass('Whole-order cancellation keeps the accepted obligation and blocks a new order-origin payment');

// 12 — shipment carries the outsourced labor cost.
result = await createOrder('Garderob', 2, 500000);
const shipOrder = result.state.orders.find(row => row.title === 'Garderob').id;
const shipLine = result.state.orders.find(row => row.id === shipOrder).lines[0].id;
const shipTask = result.state.orders.find(row => row.id === shipOrder).route[0];
await execute({ type: 'order.launch', orderId: shipOrder });
await execute({ type: 'outsource.accept', taskId: shipTask.id });
assert.equal((await snapshot(adminId)).state.orders.find(row => row.id === shipOrder).status, 'ready');
await execute({ type: 'shipment.create', orderId: shipOrder, lines: [{ lineId: shipLine, qty: 2 }],
  address: '', allowDebt: true });
const shipped = await one(`SELECT round(coalesce(sum(l.labor_cost * l.qty), 0), 2) AS labor,
  round(coalesce(sum(l.material_cost * l.qty), 0), 2) AS material
  FROM public.erp_shipment_lines l JOIN public.erp_shipments s ON s.company_id = l.company_id AND s.id = l.shipment_id
  WHERE l.company_id = $1 AND s.order_id = $2`, [companyId, shipOrder]);
assert.equal(Number(shipped.labor), 1000000);
assert.equal(Number(shipped.material), 0);
assert.equal((await one('SELECT count(*)::int AS n FROM public.erp_payroll WHERE company_id = $1', [companyId])).n, 0);
assert.equal((await one('SELECT count(*)::int AS n FROM public.erp_stock_movements WHERE company_id = $1', [companyId])).n, 0);
assert.equal((await one('SELECT count(*)::int AS n FROM public.erp_cash WHERE company_id = $1 AND source = $2',
  [companyId, 'payroll'])).n, 0);
pass('Shipment stores the accepted external cost as labor and no payroll or stock row exists anywhere');

console.log(JSON.stringify({ passes }));
```

Блок `series` выше — единственная проверка, что серия остаётся employee-only на сервере; форма команды
совпадает с рабочим series-fixture из `.validation-pglite-20261029/validate.mjs:786-816`
(`outputItemId` + `recipeVersionId` + `substitutions` + `route`), поэтому ожидание здесь ровно одно —
`Series production uses employees only`. Проверку нельзя удалять: series + supplier — единственная комбинация,
которая могла бы создать фальшивый складской приход в `erp_ready`.

- [ ] **Step 2: Запустить новый зонд**

Run: `node .validation-pglite-20261029/validate-outsourced-services.mjs`
Expected: сначала FAIL на первом недостающем SQL-контракте — `Missing function erp_insert_route`, нет branch
`outsource.accept`, `Invalid net payment for supplier` на авансе и т. п. По конкретному первому failure вернуться в
Task 8, исправить canonical `supabase/schema.sql`, перегенерировать migration и повторить. Generated migration
вручную не править.

- [ ] **Step 3: GREEN — полный сценарий**

Run: `node .validation-pglite-20261029/validate-outsourced-services.mjs`
Expected: exit 0, ровно 12 строк `PASS` и последняя строка `{"passes":12}`. В stdout — имена проверок и нейтральные
uuid; ключей, connection strings и значений live-данных там быть не должно.

- [ ] **Step 4: Существующие PGlite регрессии**

Run по одному, начиная с:

```bash
node .validation-pglite-20261029/validate-worker-operation-access.mjs
node .validation-pglite-20261029/validate.mjs
```

Затем остальные файлы из `Glob .validation-pglite-20261029/validate-*.mjs`, кроме уже выполненных:
`validate-cd-order.mjs`, `validate-composite-migration.mjs`, `validate-expense-migration.mjs`,
`validate-loans-migration.mjs`, `validate-migration.mjs`, `validate-salary-migration.mjs`,
`validate-worker-deductions.mjs`.
Expected: exit 0 для каждого.

Если старый зонд падает из-за `employee_id NOT NULL` или employee-only route projection — это ожидаемое
последствие нового контракта: обновить только fixture зонда (там, где payload уже был employee-only, добавить
`executorKind: 'employee'`), сохранив все worker/tenant assertions. Бизнес-регрессию правкой теста не маскировать:
если падает `work.accept` собственного этапа работника или видимость чужого заказа, вернуться в Task 8 и исправить SQL.

- [ ] **Step 5: TS/SQL parity spot-check**

```bash
npx vitest run src/domain.test.ts
node .validation-pglite-20261029/validate-outsourced-services.mjs
```

Expected: для последовательности `advance 300000 → accept 500000 → pay 50000 → pay 150000` TypeScript
`supplierDebt()` и SQL `erp_supplier_cost - erp_paid` дают на каждом шаге `-300000`, `200000`, `150000`, `0`;
`actualCost()` в TS и агрегатная проверка внутри `erp_assert_cash` (schema.sql:1087) видят те же `500000`;
в кассе ровно три `out`-записи `source = 'supplier'` и ноль payroll-записей от supplier-этапа.

---

### Task 10: Демо, полный набор проверок и браузерные сценарии

**Files:**
- Modify: `src/seed.ts:4-138` — внутри существующего `createDemo(actor: Actor)`, между service-order блоком
  (`:65-74`) и `recipe.create` (`:75`)
- Test: `src/domain.test.ts` — `createDemo(admin)` уже импортируется и используется (`:118`, `:2058`),
  фикстура `admin` определена на `:14`
- Verify: `npm test`, `npx tsc -b --pretty false`, `npm run build`, генератор и оба PGlite-зонда
- No live changes: production deploy и live SQL остаются отдельными разрешениями (Step 9)

**Interfaces:**
- Consumes: все Tasks 1–9 — `OrderRouteInput { executorKind, employeeId, supplierId }` (Task 1),
  `outsource.accept` (Task 3), `supplier.pay` с `allowPrepay/note/category` (Task 4), `executorLabel()` (Task 7),
  подписи `Xodim / Pudratchi`, `Ishni qabul qilish`, `Pudratchiga to‘lash`, `Avans to‘loviga ruxsat`,
  `Autsors xizmatiga to‘lov`, колонка `Xizmatlar` (Tasks 6–7).
- Produces: демо с подрядчиком `Pudratchi Metall`, чисто внешней операцией `Metall ish` (`employeeIds: []`)
  и одним запущенным, но НЕ принятым внешним этапом `planned = 1`, `rate = 500000`. Старые employee-заказы
  seed остаются без `executorKind` — это и есть доказательство backward compatibility.

- [ ] **Step 1: RED — demo contract**

Добавить в `src/domain.test.ts` (рядом с существующим тестом `createDemo(admin)` на `:118`):

```ts
it('seeds one unaccepted outsourced stage without payroll or stock', () => {
  const state = createDemo(admin);
  const contractor = state.suppliers.find(row => row.name === 'Pudratchi Metall');
  expect(contractor).toBeDefined();
  const operation = state.operations.find(row => row.name === 'Metall ish');
  expect(operation).toMatchObject({ employeeIds: [], active: true, autoAccept: true });
  const task = state.orders.flatMap(order => order.route).find(row => row.executorKind === 'supplier');
  expect(task).toMatchObject({
    supplierId: contractor!.id, employeeId: null, status: 'assigned',
    completed: 0, planned: 1, rate: 500000,
  });
  const order = state.orders.find(row => row.route.some(stage => stage.id === task!.id))!;
  expect(order.status).toBe('production');
  expect(order.materials).toEqual([]);
  expect(state.payroll.some(row => row.taskId === task!.id)).toBe(false);
  expect(state.reports.some(row => row.taskId === task!.id)).toBe(false);
  expect(state.movements.some(row => row.sourceId === task!.id)).toBe(false);
  expect(state.cash.some(row => row.source === 'supplier' && row.category === 'outsourcing')).toBe(false);
});
```

`freshDemo()` из `src/repository.ts:126` в тесте не использовать: она пишет в `localStorage` и берёт lock —
тесту нужен чистый `createDemo(admin)`. Коллекции состояния называются `reports`, `payroll`, `movements`, `cash`
(`src/types.ts:104-108`), у `Supplier` поля `address` нет (`src/types.ts:9`).

Run: `npx vitest run src/domain.test.ts -t "seeds one unaccepted outsourced stage"`
Expected: FAIL — `Pudratchi Metall` ещё не seeded, `expect(contractor).toBeDefined()` не проходит.

- [ ] **Step 2: GREEN — минимальный demo seed**

В `src/seed.ts` после блока service-order (`:74`) и перед `recipe.create` (`:75`) добавить ровно эти строки
(команды, а не литералы состояния — как делает весь файл; id всегда брать из состояния, не хардкодить):

```ts
run({ type: 'supplier.create', name: 'Pudratchi Metall', phone: '+998 90 111 22 33' });
const contractorId = state.suppliers.at(-1)!.id;
run({ type: 'operation.create', name: 'Metall ish', unit: 'piece', salePrice: 900000, workerRate: 0,
  standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
const outsourcedOperationId = state.operations.at(-1)!.id;
run({ type: 'order.create', input: {
  kind: 'service', customerId: state.customers[1].id, title: 'Metall karishlar', qty: 1, price: 900000,
  overhead: 0, dueDate: dateOffset(6), advance: 0, account: 'cash', materials: [],
  route: [{ operationId: outsourcedOperationId, executorKind: 'supplier', employeeId: null, supplierId: contractorId, rate: 500000 }],
} });
const outsourced = state.orders.at(-1)!;
run({ type: 'order.launch', orderId: outsourced.id });
```

`order.issue` для этого заказа НЕ вызывать: `domain.ts:927` поднимает `All materials already issued` на пустом
списке материалов, а готовность внешнего этапа даёт `ready()` после приёмки. `workerRate: 0` и `employeeIds: []`
валидаторы проходят (`money()` допускает 0 — `domain.ts:29-34`; `unique([])` — `:67`), поэтому домен и SQL
(`erp_array` с `p_nonempty DEFAULT false` — schema.sql:529) принимают чисто внешнюю операцию без правок.

Демо остаётся одноподъёмным: ровно один supplier-этап и он не принят — сценарий A проходит «аванс → приёмка →
остаток», сценарий B создаёт второй заказ в браузере. Fake `purchase`, `movement`, `report`, `payroll` не добавлять.

Run: `npx vitest run src/domain.test.ts -t "seeds one unaccepted outsourced stage"`
Expected: PASS.

- [ ] **Step 3: Полная статическая проверка**

```bash
npm test
npx tsc -b --pretty false
npm run build
```

Expected: `npm test` — PASS всех файлов, 0 failed, новые RED не закоммичены как `skip`; `tsc` — exit 0;
`npm run build` — exit 0 без ошибок Vite/TypeScript.

- [ ] **Step 4: Генератор и PGlite-зонды после финального состояния кода**

```bash
node .validation-pglite-20261029/generate-outsourced-services-migration.mjs
node .validation-pglite-20261029/generate-outsourced-services-migration.mjs
node .validation-pglite-20261029/validate-outsourced-services.mjs
node .validation-pglite-20261029/validate-worker-operation-access.mjs
```

Expected: генератор дважды выдаёт одинаковый `sha256` и 7 функций; новый зонд печатает 12 `PASS` и
`{"passes":12}`; worker-зонд остаётся зелёным. Ничего из этого не отправляется в live Supabase.

- [ ] **Step 5: Изолированный демо-сервер**

Проверить, какие `.env*` файлы есть, не выводя значения:

```bash
ls -a | grep '^\.env' && grep -c "VITE_SUPABASE" .env.local
```

Запуск в demo-режиме (`repository.ts:9-11`: `supabase` создаётся только когда обе переменные непустые,
поэтому пустые значения из процесса перебивают `.env.local`):

```bash
VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev -- --host 127.0.0.1
```

В браузере открыть `http://127.0.0.1:5173`, войти владельцем демо (в левом нижнем углу `Chiqish` → профиль `Egasi`;
выбор запоминается в `localStorage` под `aliya-erp-demo-actor`). Прогон seed лежит в `localStorage` под ключом
`aliya-erp-demo-v1` (`repository.ts:8`, `:55-61`) и сам не перезаписывается: если запись старая, открыть
`Sozlamalar → раздел Ma’lumotlar va tarix → кнопка Faqat lokal demo ma’lumotlarni tozalash` и подтвердить
`Demo ma’lumotlarini tozalashni tasdiqlayman`. Убедиться в Network, что запросов к Supabase нет, и что карточка
`Pudratchi Metall` видна в `Ta’minot → Yetkazib beruvchilar`.

- [ ] **Step 6: Браузер — сценарий A «аванс → приёмка → остаток»**

На экране 1280 px, демо-заказ `Metall karishlar` (один внешний этап, `planned 1 × 500000`):

1. `Buyurtmalar` → открыть карточку заказа (или значок `Ochish ORD-…`). В маршруте этап помечен `Pudratchi`,
   исполнитель — `Pudratchi Metall`, `Ijrochi tannarxi, UZS` = 500 000. Материалов нет, поэтому
   `Materiallarni berish` не нажимать.
2. `Ishlab chiqarish` (панель `SEX / MONITORING`) → карточка этого заказа → `Pudratchiga to‘lash`
   (заголовок модалки `Pudratchiga to‘lov`). Оплатить 300 000, счёт `cash`, включить `Avans to‘loviga ruxsat`,
   изох `Metall karishlar · Autsors xizmati` не менять → `To‘lovni o‘tkazish`.
3. `Moliya va kassa → Kassa`: расход 300 000 с категорией `Autsors xizmatiga to‘lov`; в
   `Ta’minot → Yetkazib beruvchilar` карточка `Pudratchi Metall` показывает `Avans 300 000`
   (отрицательный баланс = наш аванс).
4. Этап всё ещё `assigned`, `completed 0`; заказ НЕ перешёл в `ready` из-за оплаты.
5. В карточке этапа нажать `Ishni qabul qilish`: этап становится принятым целиком, заказ — `ready`
   (материалов и других этапов нет). Начислений работникам (`Ish haqi hisob-kitoblari`) и движений склада
   по этому этапу не появилось.
6. Долг: принято 500 000 − аванс 300 000 = `Qarz` 200 000; фактическая себестоимость заказа выросла ровно
   на 500 000, а не на 200 000 и не на 800 000.
7. Снова `Pudratchiga to‘lash` → 200 000 БЕЗ `Avans to‘loviga ruxsat`; баланс подрядчика 0.
   Следующий платёж 1 000 без флага отклоняется (узел причины — `Payment exceeds payable`, в UI его узбекская
   версия из `translateError`).
8. `Marshrut varaqasi`: имя подрядчика видно, ставок и денег заказчика в маршрутном листе нет.

- [ ] **Step 7: Браузер — сценарий B «новый внешний заказ → приёмка → частичная → полная оплата»**

1. `Buyurtmalar → Buyurtma / xizmat`, вид позиции `Xizmat`: клиент, название `Garderob karishlari`, `qty 2`,
   цена 1 800 000, материалы не добавлять. В маршруте: `Ijrochi turi 1` = `Pudratchi`, `Pudratchi 1` =
   `Pudratchi Metall`, операция `Metall ish`, ставка 500 000, количество этапа 2. Сохранить — плановая маржа
   1 800 000 − 1 000 000.
2. `Sexga ishga tushirish`. Затем `Chiqish` → профиль работника: внешний этап в его списке
   (`SHAXSIY TERMINAL`) не появляется, внутренние этапы и порядок не изменились. Вернуться на `Egasi`.
3. Принять этап целиком (`Ishni qabul qilish`), потом `Yuborish` (модалка `Yuborish / natijani topshirish`,
   `lines: [{ qty: 2 }]`): труд в отгрузке 500 000 за единицу, второго увеличения себестоимости после
   оплаты нет.
4. Оплатить 400 000 → `Qarz` 600 000; добить 600 000 → баланс 0. Обе проводки в кассе с категорией
   `Autsors xizmatiga to‘lov` и номером заказа в изохе.
5. `Moliya va kassa → Hisobotlar`, вкладка контрагентов: колонка `Xizmatlar` стоит рядом с `Qabul qilingan`
   и отдельно от материалов; принятые услуги по подрядчику 1 500 000 (500 000 из A + 1 000 000 из B),
   оплаченное 1 500 000, долг 0.
6. Для принятого внешнего этапа попробовать отменить позицию (`orderLine.cancel` в редакторе заказа) —
   отклонение с узбекским текстом причины; затем отменить весь заказ (`Buyurtmani bekor qilish`) —
   обязательство 1 500 000 и все оплатные проводки сохраняются, а попытка оплаты с основанием именно
   на этот отменённый заказ отклоняется.

- [ ] **Step 8: Responsive и регрессии UI**

Повторить ключевые экраны/действия на 1100, 759, 390 и 320 px:

- `Ijrochi turi` + `Pudratchi` select не переполняют `.route-editor` (на мобильном этап сворачивается в карточку);
- `qty`, цена позиции, `Ijrochi tannarxi, UZS` и маржа читаемы, ничего не обрезано;
- `Ishni qabul qilish` и `Pudratchiga to‘lash` доступны без горизонтального overflow;
- модалка `SupplierPayForm` (долг/аванс, счёт, изох, флаг аванса) и касса не обрезаются;
- колонка `Xizmatlar` в реестре на узких экранах уходит в `data-label`-карточку, как остальные колонки;
- регрессии: обычный employee-заказ, worker-терминал, панель «Oylik va qarzlar», оплата поставщику за материал
  (`Yetkazib beruvchiga to‘lov`, без категории `outsourcing`) и клиентский Telegram ведут себя как до изменений.

Проверить console: нет React key/null-ошибок; сетевых записей в Supabase нет. Если размер или сценарий
автоматизацией недоступны, явно записать, что не проверено, — browser success по одному только build не заявлять.

- [ ] **Step 9: Финальный evidence checkpoint и два отдельных разрешения**

В отчёте владельцу зафиксировать: число test files/tests и 0 failed, `npm run build` exit 0, sha256 migration,
`{"passes":12}` нового зонда, результаты worker-зонда и остальных `validate-*.mjs`, проверенные браузерные
размеры и сценарии, путь `supabase/migrations/20261106_outsourced_services.sql`. Отдельно сказать, что прод-бандл
и live DB ещё не тронуты, и запросить два разрешения, не выполняя их заранее:

1. Применить migration владельцем через Supabase SQL Editor (свежая резервная копия → файл целиком →
   verification-запросы: колонки/CHECK/FK `executor_*`, наличие `outsource.accept` в `erp_execute`,
   повторное применение без ошибки, суммы и статусы старых employee-маршрутов не изменились).
2. После зелёной live-проверки — `npm run deploy` для Cloudflare Worker `erp-tizim`
   (проверка: новая версия + HTTP 200 нового JS bundle).

---

## Plan self-review

- **Spec coverage:** Tasks 1–2 покрывают модель/справочники, назначение, ревизию и исполнитель-осознанный запуск заказа; Task 3 — приёмку, готовность и отмены; Task 4 — аванс/долг/кассу/сторно; Task 5 — плановую и фактическую маржу, shipment, statement, route sheet; Tasks 6–7 — весь Uzbek UI; Tasks 8–9 — Supabase, snapshot, tenant/role guards, financial assertions и PGlite; Task 10 — demo, desktop/mobile и отдельные live gates.
- **Explicit exclusions:** нет частичной внешней приёмки, supplier stages в series, service purchase documents, fake stock, contractor Telegram, automatic payment reversals, нового payroll или изменения fixed salary.
- **Type consistency:** `ExecutorKind`, nullable `employeeId/supplierId`, `orderId?: string`, `category?: 'supplier' | 'outsourcing'`, `acceptedOutsourceCost()`, `SupplierStatementRow.outsourced` и `SupplierPayForm` используются под одними именами во всех задачах.
- **No placeholders:** каждый шаг содержит конкретный файл, код/assertion или команду с ожидаемым результатом. RED, который по архитектуре зависит от следующей задачи, явно активируется позже и не выдаётся за завершённый.
- **Remote safety:** generator и PGlite работают локально; live Supabase и Cloudflare остаются за отдельными разрешениями владельца.

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-11-06-outsourced-services.md`. Two execution options:**

**1. Inline Execution (recommended for this workspace)** — выполнить все задачи в текущей сессии через `superpowers:executing-plans`, с RED/GREEN и checkpoints; без subagents по предыдущему решению владельца.

**2. Subagent-Driven** — только если владелец отдельно отменит своё предыдущее запрещение subagents; свежий исполнитель на задачу и review между задачами через `superpowers:subagent-driven-development`.
