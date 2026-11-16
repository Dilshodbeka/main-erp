# Shops, Finance and Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Связать складские продажи магазинам, FIFO-оплаты, авансы, долги, кассу и периодическую отчётность в единый расчётный контур.

**Architecture:** Отгрузка признаёт выручку и себестоимость, а денежный журнал отдельно определяет оплату. Чистый ledger engine детерминированно проигрывает отгрузки, поступления и сторнирования по датам и ID, поэтому отчёты и UI используют один результат без отдельной таблицы ручных распределений.

**Tech Stack:** TypeScript strict, Vitest, React 19, Supabase/Postgres, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-30-production-erp-design.md`

## Global Constraints

- Завершены tenant/production-core и recipes/series/stock планы.
- Выручка признаётся при отгрузке, оплата не переносит выручку между периодами.
- Магазин — `Customer.kind === 'shop'`; количество магазинов не ограничено.
- Складская цена копируется из `Item.salePrice`; ручная цена строки запрещена.
- Оплаты распределяются FIFO, избыток становится авансом; новые отгрузки используют аванс до образования долга.
- Все деньги — целые UZS; интерфейс — узбекская латиница; remote changes запрещены без отдельного разрешения.
- Git не инициализировать; checkpoints через TaskUpdate.

---

### Task 1: Унифицированная отгрузка клиенту и магазину

**Files:**
- Modify: `src/types.ts`
- Modify: `src/migrations.ts`
- Modify: `src/domain.ts`
- Modify: `src/domain.test.ts`
- Create: `src/sales.ts`
- Create: `src/sales.test.ts`

**Interfaces:**
- Consumes: `finished` stock, customer orders, `stockQty`.
- Produces: `Customer.kind`; `customer.create` с `kind: 'customer' | 'shop'`; `ShipmentLine` с `materialCost/laborCost`; новый `Shipment`; `shipment.createStock`; `shipmentTotals(shipment)`; `salesCost(state, shipment)`; test factory `stockedFinishedItem(input: { qty: number; cost: number; materialCost: number; laborCost: number; salePrice: number }): State`.

- [x] **Step 1: Написать падающие тесты складской отгрузки**

```ts
it('ships finished stock at item price and fixes current cost', () => {
  let state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
  const shop = state.customers.find(c => c.kind === 'shop')!;
  const item = state.items.find(i => i.kind === 'finished')!;
  state = applyCommand(state, envelope({
    type: 'shipment.createStock', customerId: shop.id,
    lines: [{ itemId: item.id, qty: 2 }], dueDate: '2026-11-05', allowDebt: true,
  }), admin);
  const shipment = state.shipments[0];
  expect(shipment.lines[0]).toMatchObject({ qty: 2, salePrice: 50000, unitCost: 30000, materialCost: 25000, laborCost: 5000 });
  expect(shipmentTotals(shipment)).toEqual({ revenue: 100000, cost: 60000, materialCost: 50000, laborCost: 10000 });
  expect(stockQty(state, item.id)).toBe(8);
});
```

Добавить тесты: недостаток остатка; `blank|material` не продаются как finished; другая компания/неизвестный магазин; `allowDebt: false` без аванса; изменение `salePrice` после отгрузки не меняет её; сторнирование возвращает товар с исходной себестоимостью.

- [x] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/sales.test.ts -t "ships finished stock"`  
Expected: FAIL, модуль/команда отсутствуют.

- [x] **Step 3: Реализовать модель и команду**

```ts
export interface ShipmentLine {
  id: string; itemId: string | null; description: string;
  qty: number; salePrice: number; unitCost: number;
  materialCost: number; laborCost: number;
}
export interface Shipment {
  id: string; orderId: string | null; customerId: string;
  kind: 'order' | 'stock'; lines: ShipmentLine[]; address: string;
  dueDate: string; status: 'shipped' | 'delivered' | 'cancelled';
  createdAt: string; deliveredAt: string | null; reversalOf: string | null;
}
```

`customer.create` получает обязательный `kind`; миграция v1 присваивает существующим клиентам `kind: 'customer'`, seed добавляет один `shop`. `shipment.createStock` в одной доменной команде проверяет все строки, затем создаёт отрицательные movements и shipment. Цена берётся только из item. Клиентская order shipment мигрируется в одну строку с `itemId: null`, описанием заказа и пропорциональной себестоимостью по существующему правилу. `Shipment.customerId` всегда заполнен.

- [x] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS; старые delivered revenue cases дают тот же результат через новые lines.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 2: FIFO ledger, авансы и оплаты

**Files:**
- Create: `src/receivables.ts`
- Create: `src/receivables.test.ts`
- Modify: `src/types.ts`
- Modify: `src/domain.ts`
- Modify: `src/migrations.ts`

**Interfaces:**
- Consumes: `Shipment`, `CashEntry`, `Customer`.
- Produces: `CustomerLedger`; `customerLedger(state, customerId): CustomerLedger`; `orderLedger(state, orderId)`; `customer.pay`; `customerId` в CashEntry; test factory `fixtureWithShipments(totals: number[]): State`.

- [x] **Step 1: Написать падающие сценарии долга**

```ts
it('applies payments FIFO and keeps overpayment as advance', () => {
  const state = fixtureWithShipments([100000, 80000]);
  const customerId = state.customers[0].id;
  const paid = applyCommand(state, envelope({ type: 'customer.pay', customerId, amount: 150000, account: 'cash' }), admin);
  const ledger = customerLedger(paid, customerId);
  expect(ledger.shipments.map(s => s.outstanding)).toEqual([0, 30000]);
  expect(ledger.debt).toBe(30000);
  expect(ledger.advance).toBe(0);
  const advanced = applyCommand(paid, envelope({ type: 'customer.pay', customerId, amount: 50000, account: 'cash' }), admin);
  expect(customerLedger(advanced, customerId)).toMatchObject({ debt: 0, advance: 20000 });
});
```

Добавить: новая отгрузка использует аванс; cash reversal восстанавливает старший долг по FIFO; shipment reversal увеличивает аванс либо уменьшает распределение детерминированно; одинаковые createdAt упорядочиваются по id; cash balance и customer ledger не смешиваются.

- [x] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/receivables.test.ts`  
Expected: FAIL, ledger отсутствует.

- [x] **Step 3: Реализовать чистый ledger**

```ts
export interface LedgerShipment {
  shipmentId: string; total: number; paid: number; outstanding: number;
}
export interface CustomerLedger {
  customerId: string; shipped: number; paid: number;
  debt: number; advance: number; shipments: LedgerShipment[];
}
```

`customerLedger` сортирует активные отгрузки по `(createdAt,id)`, суммирует несторнированные поступления по `(createdAt,id)`, последовательно распределяет доступный аванс и оплаты. Сторнирование отгрузки исключает её total, но не удаляет денежную историю; избыток автоматически становится advance. `customer.pay` создаёт CashEntry с `source: 'sale'`, `sourceId: customerId`, `customerId`; `order.pay` удаляется из Command и все callers переводятся на customer command.

- [x] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS, включая advances, reversals и cash account balances.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 3: Периодические отчёты и магазинная аналитика

**Files:**
- Create: `src/reports.ts`
- Create: `src/reports.test.ts`
- Modify: `src/health.tsx`
- Modify: `src/health.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `customerLedger`, `ShipmentLine`, movements, cash, payroll, recipes, machines.
- Produces: `periodReport(state, from, to)`; `shopReport(state, shopId, from, to)`; `stockBalanceReport(state, from, to)`; `machineReport(state, from, to)`; test factory `reportFixture(): State`.

- [x] **Step 1: Написать падающие отчётные тесты**

```ts
it('separates revenue recognition from cash and reports shop gross profit', () => {
  const report = periodReport(reportFixture(), '2026-11-01', '2026-11-30');
  expect(report).toMatchObject({ revenue: 100000, cogs: 60000, grossProfit: 40000, cashIn: 50000 });
  const shop = shopReport(reportFixture(), 'shop-1', '2026-11-01', '2026-11-30');
  expect(shop).toMatchObject({ deliveredQty: 2, revenue: 100000, materialCost: 50000, laborCost: 10000, debt: 50000 });
  expect(report.seriesRevenue + report.customRevenue).toBe(report.revenue);
});
```

Добавить начальный/конечный stock, manufactured qty, pending/accepted/paid payroll, machine norm vs actual, recipe variance. Проверить: без заданного плана `lostRevenue: null`; с планом 150000 и фактом 100000 результат 50000; отрицательное lost revenue не показывается.

- [x] **Step 2: Запустить тесты и подтвердить FAIL**

Run: `npx vitest run src/reports.test.ts`  
Expected: FAIL, модуль отчётов отсутствует.

- [x] **Step 3: Реализовать общие селекторы**

```ts
export interface PeriodReport {
  revenue: number; cogs: number; grossProfit: number; cashIn: number; cashOut: number;
  customRevenue: number; seriesRevenue: number; debt: number; advances: number;
  payrollPending: number; payrollAccepted: number; payrollPaid: number;
}
```

Все функции принимают полузакрытый интервал `[from, toExclusive)` внутри, UI передаёт конец выбранного периода + 1 день. Revenue/cogs берутся из shipment lines, cash — из cash journal, stock — из movements, payroll — из status journals. `health.tsx` использует те же ledger и stock selectors, не повторяет формулы.

- [x] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS; сумма разделов равна общему отчёту, начальный остаток + движения = конечный.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 4: Supabase продажи, оплаты и отчётные снимки

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `.validation-pglite-20261029/validate.mjs`

**Interfaces:**
- Consumes: `shipment.createStock`, `customer.pay`, ledger/report semantics.
- Produces: shipment lines table, customer-scoped cash, stock sale command, tenant-safe financial snapshots.

- [x] **Step 1: Добавить падающие PGlite-проверки**

```js
result = await execute({ type: 'shipment.createStock', customerId: shop, lines: [{ itemId: finished, qty: 2 }], dueDate: '2026-11-05', allowDebt: true });
const shipmentId = result.state.shipments[0].id;
result = await execute({ type: 'customer.pay', customerId: shop, amount: 150000, account: 'cash' });
assert.equal(result.state.shipments.find(s => s.id === shipmentId).lines[0].salePrice, 50000);
await rejects('Worker cannot post customer payment', () => execute({ type: 'customer.pay', customerId: shop, amount: 1, account: 'cash' }, 'worker'), '42501');
async function executeAsCompanyB(command) {
  await asId(companyBUser);
  const current = (await db.query('SELECT public.erp_snapshot() AS result')).rows[0].result;
  return db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb) AS result', [
    crypto.randomUUID(), current.state.revision, JSON.stringify(command),
  ]);
}
await rejects('Company B cannot pay Company A customer', () => executeAsCompanyB({ type: 'customer.pay', customerId: shop, amount: 1, account: 'cash' }), '22023');
```

Добавить server-calculated expected ledger assertions через snapshot fixture, SQL reversal checks и worker redaction.

- [x] **Step 2: Запустить PGlite и подтвердить FAIL**

Run: `node .validation-pglite-20261029/validate.mjs`  
Expected: FAIL на shipment lines/customer.pay.

- [x] **Step 3: Реализовать SQL**

```sql
create table public.erp_shipment_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  shipment_id uuid not null, item_id uuid, description text not null,
  qty numeric not null check (qty > 0), sale_price bigint not null,
  unit_cost bigint not null,
  foreign key (company_id, shipment_id) references public.erp_shipments(company_id, id)
);
alter table public.erp_cash add column customer_id uuid;
create index erp_cash_customer_date on public.erp_cash(company_id, customer_id, created_at, id);
```

`erp_execute` выполняет stock checks и shipment + movements атомарно. Цена читается из `erp_items` внутри SQL; переданная клиентом цена игнорируется как отсутствующее поле команды. Snapshot admin получает журналы, worker/display — нет. Отчёты вычисляются на клиенте из авторизованного snapshot, без непроверенного service-role endpoint.

- [x] **Step 4: Запустить полную проверку**

Run: `node .validation-pglite-20261029/validate.mjs && npx tsc --noEmit && npm test -- --run`  
Expected: 0 failures; суммы SQL snapshot совпадают с domain fixtures.

- [x] **Step 5: Отметить checkpoint без remote apply**

### Task 5: Экраны магазина, долгов и отчётов

**Files:**
- Create: `src/components/StockSaleEditor.tsx`
- Create: `src/components/CustomerLedger.tsx`
- Create: `src/components/FinanceReports.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: все report selectors и финансовые команды предыдущих задач.
- Produces: admin-only магазинная отгрузка, карточка расчётов и weekly/monthly/yearly reports.

- [x] **Step 1: Написать падающий тест builder формы**

```ts
it('builds stock sale input without accepting a client price', () => {
  const state = stockedFinishedItem({ qty: 10, cost: 30000, materialCost: 25000, laborCost: 5000, salePrice: 50000 });
  const shop = state.customers.find(c => c.kind === 'shop')!;
  const item = state.items.find(i => i.kind === 'finished')!;
  const command = buildStockSaleInput(state, shop.id, [{ itemId: item.id, qty: 2 }]);
  expect(command).toEqual({ type: 'shipment.createStock', customerId: shop.id, lines: [{ itemId: item.id, qty: 2 }], dueDate: expect.any(String), allowDebt: true });
  expect(JSON.stringify(command)).not.toContain('salePrice');
});
```

- [x] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/sales.test.ts -t "builds stock sale input"`  
Expected: FAIL, `buildStockSaleInput` отсутствует.

- [x] **Step 3: Реализовать формы через команды без локального дублирования расчётов**

`buildStockSaleInput` создаётся в `src/sales.ts` и не принимает цену. `StockSaleEditor` получает `items.filter(kind === 'finished')` и shops, отправляет его результат. `CustomerLedger` получает результат `customerLedger` и отправляет `customer.pay`. `FinanceReports` получает typed report objects; ни один компонент не пересчитывает FIFO или среднюю себестоимость самостоятельно.

- [x] **Step 4: Проверить acceptance суммы и mobile permissions**

Создать партию 10 единиц cost 30000/price 50000, отгрузить 2, принять 50000, затем 50000. Ожидания: revenue 100000, materialCost 50000, laborCost 10000, после первой оплаты debt 50000/cashIn 50000, после второй debt 0, дополнительный платёж 20000 создаёт advance 20000. Сверить с `src/receivables.test.ts`. На 390×844 отгрузка, оплата, фильтр периода и карточки долга доступны без overflow. Worker не видит магазинные цены/долги/кассу; display не видит страницу магазинов.

- [x] **Step 5: Запустить финальные проверки и checkpoint**

Run: `npx tsc --noEmit && npm test -- --run && node .validation-pglite-20261029/validate.mjs && npm run build`  
Expected: все команды завершаются успешно. TaskUpdate: финансовый этап завершён; Git commit не создавать.
