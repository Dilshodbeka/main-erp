# Recipes, Series and Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить версионированные рецептуры, разрешённые замены, двухуровневый серийный выпуск, складскую себестоимость и историю закупочных цен.

**Architecture:** `series` расширяет существующий производственный документ и завершается одним складским приходом после приёмки всех работ. Все остатки выводятся из журнала; рецептура копируется в документ, поэтому последующие изменения справочника не меняют историю.

**Tech Stack:** TypeScript strict, Vitest, React 19, Supabase/Postgres RLS, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-30-production-erp-design.md`

## Global Constraints

- Завершён предыдущий план `2026-10-30-tenant-production-core.md`.
- Собственный и давальческий запасы разделены владельцем; отрицательный остаток запрещён для каждого владельца.
- Производственная себестоимость = собственные материалы + принятая сдельная оплата; давальческий материал и норматив станка не добавляются.
- Один `series` создаёт один полный производственный приход; частичный выпуск не создаётся.
- Деньги округляются до целого UZS, количества — до трёх знаков.
- Все новые подписи — узбекская латиница; удалённые системы не изменяются.
- Git не инициализировать; checkpoints фиксируются через TaskUpdate.

---

### Task 1: Типы номенклатуры и история закупочных цен

**Files:**
- Modify: `src/types.ts`
- Modify: `src/migrations.ts`
- Modify: `src/domain.ts`
- Modify: `src/domain.test.ts`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: `Item`, `PurchaseLine`, `purchase.receive`, `stockQty`.
- Produces: `ItemKind`; `Item.kind/salePrice/lastPurchasePrice/materialCost/laborCost`; четыре price-history поля `PurchaseLine`; test helper `receivePurchase(state, itemId, qty, price): State`.

- [ ] **Step 1: Написать падающий тест скользящей средней и последней цены**

```ts
it('keeps last purchase price separate from moving average cost', () => {
  let state = emptyState();
  state = applyCommand(state, envelope({ type: 'item.create', kind: 'material', name: 'LDSP', unit: 'sheet', minQty: 0, cost: 0, salePrice: 0, customerId: null }), admin);
  const itemId = state.items[0].id;
  state = receivePurchase(state, itemId, 10, 40000);
  state = receivePurchase(state, itemId, 10, 60000);
  expect(state.items[0].cost).toBe(50000);
  expect(state.items[0].lastPurchasePrice).toBe(60000);
  expect(state.purchases[1].lines[0]).toMatchObject({
    previousPurchasePrice: 40000, newPurchasePrice: 60000,
    previousAverageCost: 40000, newAverageCost: 50000,
  });
});
```

В начале тестового файла определить helper, используемый тестом:

```ts
function receivePurchase(state: State, itemId: string, qty: number, price: number): State {
  let next = state.suppliers.length > 0
    ? state
    : applyCommand(state, envelope({ type: 'supplier.create', name: 'Supplier', phone: '' }), admin);
  next = applyCommand(next, envelope({
    type: 'purchase.create', supplierId: next.suppliers[0].id,
    lines: [{ itemId, qty, price }],
  }), admin);
  const purchase = next.purchases.at(-1)!;
  return applyCommand(next, envelope({
    type: 'purchase.receive', purchaseId: purchase.id,
    lines: [{ lineId: purchase.lines[0].id, qty }],
  }), admin);
}
```

Добавить тесты давальческого прихода: `lastPurchasePrice` собственного товара не меняется, стоимость собственного склада не увеличивается, минус по владельцу запрещён. `materialCost` и `laborCost` обновлять раздельно: при закупке весь приход увеличивает materialCost, laborCost остаётся нулевым; их сумма должна совпадать с `cost`.

- [ ] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/domain.test.ts -t "last purchase price"`  
Expected: FAIL на новых полях команды и истории.

- [ ] **Step 3: Реализовать поля и расчёт**

```ts
export type ItemKind = 'material' | 'blank' | 'finished';
export interface PurchaseLine {
  id: string; itemId: string; qty: number; price: number; received: number;
  previousPurchasePrice: number; newPurchasePrice: number;
  previousAverageCost: number; newAverageCost: number;
}
```

При каждом частичном приходе рассчитывать историю от фактически принимаемого количества. `cost` обновлять по средней, `lastPurchasePrice` — ценой последнего прихода. `materialCost` и `laborCost` ведутся как раздельные средние компоненты, причём `cost === materialCost + laborCost` после каждой проводки. Миграция v1 заполняет `kind: 'material'`, `salePrice: 0`, `materialCost: cost`, `laborCost: 0`, `lastPurchasePrice` последней принятой закупочной ценой либо нулём.

- [ ] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS; прежние расчёты материалов используют `cost`, а не `lastPurchasePrice`.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 2: Версии рецептур и слоты замен

**Files:**
- Create: `src/recipes.ts`
- Create: `src/recipes.test.ts`
- Modify: `src/types.ts`
- Modify: `src/domain.ts`
- Modify: `src/migrations.ts`

**Interfaces:**
- Consumes: `ItemKind`, `Item`, команды admin.
- Produces: `Recipe`, `RecipeVersion`, `RecipeComponent`; `validateRecipeGraph(state): void`; `recipe.create`, `recipe.version.create`; test factories `catalogWithBlankAndFacade(): State` и `itemId(state: State, name: string): string`.

- [ ] **Step 1: Написать падающие тесты рецептур**

```ts
it('allows only listed substitutions and rejects recipe cycles', () => {
  let state = catalogWithBlankAndFacade();
  state = applyCommand(state, envelope({
    type: 'recipe.create', outputItemId: state.items.find(i => i.kind === 'finished')!.id,
    name: 'Shkaf', components: [
      { slot: 'Korpus', itemId: itemId(state, 'LDSP'), allowedItemIds: [], qtyPerUnit: 1 },
      { slot: 'Fasad', itemId: null, allowedItemIds: [itemId(state, 'Fasad A')], qtyPerUnit: 1 },
    ],
  }), admin);
  expect(state.recipes[0].versions[0].components).toHaveLength(2);
  expect(() => applyCommand(state, envelope({
    type: 'recipe.version.create', recipeId: state.recipes[0].id,
    components: [{ slot: 'Loop', itemId: state.recipes[0].outputItemId, allowedItemIds: [], qtyPerUnit: 1 }],
  }), admin)).toThrow('Retsept sikl hosil qilmoqda');
});
```

Добавить: пустой слот без разрешённых вариантов запрещён; нулевая/отрицательная норма запрещена; output должен быть `blank|finished`; component не может быть `finished`, если это создаёт недопустимую самозависимость; повторные slot names запрещены.

- [ ] **Step 2: Запустить тесты и подтвердить FAIL**

Run: `npx vitest run src/recipes.test.ts`  
Expected: FAIL, модуль рецептур отсутствует.

- [ ] **Step 3: Реализовать модель и проверку графа**

```ts
export interface RecipeComponent {
  id: string; slot: string; itemId: string | null;
  allowedItemIds: string[]; qtyPerUnit: number;
}
export interface RecipeVersion { id: string; version: number; components: RecipeComponent[]; createdAt: string }
export interface Recipe { id: string; outputItemId: string; name: string; versions: RecipeVersion[]; active: boolean }
```

`validateRecipeGraph` строит направленный граф output → component для основных и разрешённых вариантов и выполняет DFS с `visiting/visited`; любая повторная вершина `visiting` отклоняет команду. Версия immutable после использования в заказе; новая редакция создаётся только `recipe.version.create` с увеличением номера.

- [ ] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS, включая все предыдущие production-core tests.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 3: Серийный выпуск и производственный приход

**Files:**
- Modify: `src/types.ts`
- Modify: `src/domain.ts`
- Modify: `src/domain.test.ts`
- Modify: `src/recipes.ts`
- Modify: `src/migrations.ts`

**Interfaces:**
- Consumes: `RecipeVersion`, work completion и `accepted` payroll.
- Produces: `Order.kind: 'series'`; `outputItemId`, `recipeVersionId`, `substitutions`; `series.create`; production movement и `actualSeriesCost(state, order): number`; test factories `blankSeriesReady(): State`, `finishedSeriesReady(state: State, blankItemId: string): State`, `completeLastTask(state: State, order: Order): State`.

- [ ] **Step 1: Написать падающий двухуровневый тест**

```ts
it('receives a blank and carries its cost into the finished product', () => {
  let state = blankSeriesReady();
  const blankOrder = state.orders[0];
  state = completeLastTask(state, blankOrder);
  const blank = state.items.find(i => i.id === blankOrder.outputItemId)!;
  const expectedBlankCost = actualSeriesCost(state, blankOrder) / blankOrder.qty;
  expect(stockQty(state, blank.id)).toBe(blankOrder.qty);
  expect(blank.cost).toBe(expectedBlankCost);

  state = finishedSeriesReady(state, blank.id);
  const finishedOrder = state.orders.at(-1)!;
  state = completeLastTask(state, finishedOrder);
  const finished = state.items.find(i => i.id === finishedOrder.outputItemId)!;
  expect(stockQty(state, finished.id)).toBe(finishedOrder.qty);
  expect(actualSeriesCost(state, finishedOrder)).toBeGreaterThanOrEqual(expectedBlankCost);
});
```

Отдельно проверить: запрещён приход до принятия всех payroll; давальческий компонент не добавляет cost; повтор последнего `requestId` не создаёт второй приход; серия не появляется в client Kanban selector; отгрузка готового товара невозможна без остатка.

- [ ] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/domain.test.ts -t "receives a blank"`  
Expected: FAIL на `series` и `outputItemId`.

- [ ] **Step 3: Реализовать создание и завершение серии**

```ts
export interface Order {
  id: string; number: string; kind: 'product' | 'service' | 'series'; customerId: string;
  outputItemId: string | null; recipeVersionId: string | null;
  substitutions: Record<string, string>; title: string; qty: number; price: number;
  overhead: number; dueDate: string; createdAt: string; status: Status;
  materials: MaterialLine[]; route: RouteLine[];
}
```

`series.create` требует `customerId: ''`, выбирает активную версию, материализует компоненты в `MaterialLine[]` и подставляет только `allowedItemIds`. Для слота без выбора основной `itemId` обязателен. При последней приёмке существующий `ready()` вызывает единый `receiveSeriesOutput`: проверяет отсутствие предыдущего `movement.source === 'production' && sourceId === order.id`, рассчитывает cost и добавляет движение.

```ts
export function actualSeriesCost(state: State, order: Order): number {
  return money(actualSeriesMaterialCost(state, order) + actualSeriesLaborCost(state, order));
}
export function actualSeriesMaterialCost(state: State, order: Order): number {
  return money(order.materials.reduce((sum, line) => sum + line.actualCost, 0));
}
export function actualSeriesLaborCost(state: State, order: Order): number {
  return money(state.payroll
    .filter(p => p.orderId === order.id && p.status === 'accepted')
    .reduce((sum, entry) => sum + entry.amount, 0));
}
```

При производственном приходе обновлять средние `cost`, `materialCost`, `laborCost` выходной номенклатуры теми же тремя составляющими; для закупки laborCost равен нулю.

- [ ] **Step 4: Запустить проверки**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS, один производственный приход и сходимость стоимости двух уровней.

- [ ] **Step 5: Отметить checkpoint без Git commit**

### Task 4: SQL/RLS для рецептур, серий и склада

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `.validation-pglite-20261029/validate.mjs`

**Interfaces:**
- Consumes: все команды и поля Tasks 1–3.
- Produces: tenant-scoped recipes/version/component tables; series JSON fields; production stock receipt; purchase price history.

- [ ] **Step 1: Добавить падающие PGlite-проверки**

```js
result = await execute({ type: 'series.create', input: seriesInput }, 'admin');
const seriesId = result.state.orders.at(-1).id;
await rejects('Series has no client', () => execute({ type: 'order.pay', orderId: seriesId, amount: 1, account: 'cash' }), '22023');
await completeSeries(seriesId);
const first = await snapshot();
assert.equal(first.state.movements.filter(m => m.source === 'production' && m.sourceId === seriesId).length, 1);
await completeSeriesWithSameRequest(seriesId);
assert.equal((await snapshot()).state.movements.length, first.state.movements.length);
```

Проверить cross-company recipe/component references, отрицательный давальческий остаток, запрет ручной production movement, совпадение unit cost и принятого payroll.

- [ ] **Step 2: Запустить PGlite и подтвердить FAIL**

Run: `node .validation-pglite-20261029/validate.mjs`  
Expected: FAIL на отсутствующих recipe tables/series command.

- [ ] **Step 3: Реализовать SQL-модель и транзакции**

```sql
create table public.erp_recipes (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  output_item_id uuid not null, name text not null, active boolean not null default true,
  foreign key (company_id, output_item_id) references public.erp_items(company_id, id)
);
create table public.erp_recipe_versions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  recipe_id uuid not null, version integer not null, created_at timestamptz not null default now(),
  unique (company_id, recipe_id, version),
  foreign key (company_id, recipe_id) references public.erp_recipes(company_id, id)
);
create table public.erp_recipe_components (
  id uuid primary key default gen_random_uuid(), company_id uuid not null,
  version_id uuid not null, slot text not null, item_id uuid,
  allowed_item_ids uuid[] not null default '{}', qty_per_unit numeric not null check (qty_per_unit > 0),
  foreign key (company_id, version_id) references public.erp_recipe_versions(company_id, id)
);
```

Добавить RLS и company predicates. В `erp_execute` проверять цикл рецептуры через recursive CTE, выбор замены через `allowed_item_ids`, блокировать document rows `for update`, создавать production movement один раз. Purchase history сохраняется в `erp_purchase_lines`; worker/display snapshots не получают рецептурные себестоимости и закупочную историю.

- [ ] **Step 4: Запустить полную проверку**

Run: `node .validation-pglite-20261029/validate.mjs && npx tsc --noEmit && npm test -- --run`  
Expected: 0 failures, SQL и domain одинаково отклоняют недопустимые замены.

- [ ] **Step 5: Отметить checkpoint без remote apply и Git commit**

### Task 5: Экраны рецептур, серий и истории склада

**Files:**
- Create: `src/components/RecipeEditor.tsx`
- Create: `src/components/SeriesEditor.tsx`
- Create: `src/components/SeriesList.tsx`
- Create: `src/components/PurchasePriceHistory.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/seed.ts`

**Interfaces:**
- Consumes: `recipe.create`, `recipe.version.create`, `series.create`, существующие material issue/work commands.
- Produces: отдельный series route/page и reusable editors без собственной бизнес-логики.

- [ ] **Step 1: Добавить failing UI view tests для выбора замены**

```ts
it('builds series input with only allowed facade substitution', () => {
  const input = buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: facadeA.id }, route });
  expect(input.substitutions).toEqual({ Fasad: facadeA.id });
  expect(() => buildSeriesInput({ recipe, version, qty: 5, substitutions: { Fasad: forbidden.id }, route })).toThrow();
});
```

Поместить чистый `buildSeriesInput` в `src/recipes.ts` и тест в `src/recipes.test.ts`; компоненты только вызывают его.

- [ ] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/recipes.test.ts -t "builds series input"`  
Expected: FAIL до добавления builder.

- [ ] **Step 3: Реализовать экраны и mobile layout**

`RecipeEditor` управляет версиями и слотами; `SeriesEditor` показывает норму и фактические замены; `SeriesList` показывает статусы операций без Kanban и без client payment actions; `PurchasePriceHistory` показывает old/new purchase price и old/new average. Admin видит себестоимость, worker — только назначенные этапы. На телефоне таблицы превращаются в карточки через существующий responsive pattern, все формы имеют явные labels.

- [ ] **Step 4: Проверить полный путь в браузере**

Run: `npx tsc --noEmit && npm test -- --run && npm run build`  
Expected: PASS/build success.

В браузере создать LDSP → заготовку → шкаф с заменой фасада; завершить этапы; проверить остатки и unit cost; выполнить две закупки с разными ценами. На 390×844 проверить editors, отсутствие overflow и доступность сохранения. Worker и TV не должны показывать себестоимость.

- [ ] **Step 5: Отметить checkpoint и перейти к финансовому плану**
