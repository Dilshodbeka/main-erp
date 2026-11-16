# Покраска/шлифовка + склад + экономика — план реализации (Часть 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (владелец запретил субагентов — только inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить учёт покрасочных/шлифовальных операций с нормами материалов на 1 м², авторасчёт себестоимости и категорию склада ЛКМ/химия — аддитивно, без изменения существующих заказов без норм.

**Architecture:** Подход A — нормы хранятся на операции (`Operation.norms`), при создании несерийного заказа сливаются в обычные `MaterialLine` (стартовая смета). Существующие формулы `estimatedCost`/`actualCost` не меняются: краска/абразивы становятся обычными материалами. Сервер хранит нормы в jsonb-колонке `erp_operations.norms` (без новых таблиц) и повторяет слияние в `erp_execute`.

**Tech Stack:** React 19 + TypeScript strict, Vite 6, Vitest 3 (node-окружение, без jsdom; UI-тесты через `renderToStaticMarkup`), Supabase Postgres + PGlite-зонды, Cloudflare Worker.

**Spec:** `docs/superpowers/specs/2026-11-09-painting-warehouse-economics-design.md`

## Global Constraints

- Не Git-репозиторий: без веток и коммитов; каждый шаг завершается проверкой (команды ниже).
- Без субагентов: реализация inline, TDD (RED → GREEN). Сначала тест, watching fail, затем минимальный код.
- UI — узбекская латиница, суммы в UZS; отчёты владельцу и этот план — на русском.
- Деплой (`npm run deploy`) и любые удалённые изменения — только по отдельному разрешению владельца. В этом плане деплоя нет.
- Миграция применяется владельцем через Supabase SQL Editor ДО деплоя фронтенда: колонка `norms` с `DEFAULT '[]'`回填няет существующие операции, поэтому облачный снимок всегда несёт `norms`.
- Нормы аддитивны: дефолт — пустой массив; поведение заказов без норм не меняется. Серийные заказы нормы не получают.
- Без новых таблиц БД: нормы — jsonb-колонка `erp_operations.norms`.
- Команды проверки (из корня `C:\Users\abdul\Documents\Qoder\2026-10-29\dd682fe3`):
  -Focused: `npx vitest run <file>`
  - Типы: `npx tsc -b --pretty false`
  - Весь набор: `npm test`
  - Сборка: `npm run build`
  - PGlite-зонд: `node .validation-pglite-20261029/<probe>.mjs`

## File Structure

- `src/types.ts` — `OperationNorm`, `Operation.norms`, `norms?` в командах operation.create/update.
- `src/domain.ts` — валидация норм в `operationValues`; чистые `areaMaterialCost`/`areaLaborCost`/`normMaterialLines`; приватный `mergeNormMaterials`; слияние в `order.create` (обе ветки).
- `src/migrations.ts` — дефолт `norms: []` при миграции операций.
- `src/warehouse.ts` — группа `06 «Bo‘yoq va kimyo»`.
- `src/components/QuickEditors.tsx` — секция норм в `OperationRateEditor` (для `squareMeter`).
- `src/order-editor.ts` — `stageNormEstimate` (плановая смета материалов нормы для этапа).
- `src/components/OrderEditor.tsx` — подсказка сметы нормы под суммой этапа.
- `src/seed.ts` — материалы ЛКМ/абразивы, операции Bo‘yash/Jilolash с нормами, демо-заказ покраски.
- `supabase/schema.sql` — колонка `norms`, `erp_insert_norm_materials`, снимок, `erp_execute`, grant-блок.
- `.validation-pglite-20261029/generate-operation-norms-migration.mjs` — генератор идемпотентной миграции из canonical schema.
- `supabase/migrations/20261109_operation_norms.sql` — сгенерированная миграция (не правится вручную).
- `.validation-pglite-20261029/validate-operation-norms.mjs` — PGlite-зонд паритета клиент/сервер.
- Тесты: `src/domain.test.ts`, `src/migrations.test.ts`, `src/warehouse.test.ts` (новый), `src/painting-ui.test.tsx` (новый), `src/order-editor.test.ts`.

---

### Task 1: Типы, дефолт миграции, валидация норм

**Files:**
- Modify: `src/types.ts:14-17` (Operation), `src/types.ts:138-139` (команды)
- Modify: `src/migrations.ts:23-34` (operations mapping)
- Modify: `src/domain.ts:119-138` (operationValues)
- Test: `src/domain.test.ts`, `src/migrations.test.ts:32-35`

**Interfaces:**
- Produces: `OperationNorm { itemId: string; qtyPerM2: number }`; `Operation.norms: OperationNorm[]`; `operationValues` возвращает `norms`.

- [ ] **Step 1: RED — тест валидации норм (domain.test.ts)**

Добавить в `src/domain.test.ts` новый `describe` (импорты `applyCommand`, `emptyState` уже есть; добавить `OperationNorm` в импорт типов не нужно — используем литералы):

```ts
describe('operation norms', () => {
  function normFixture() {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Client paint', unit: 'litr', minQty: 0, cost: 0, customerId: state.customers[0].id });
    return state;
  }
  const base = (state: State) => ({
    name: 'Paint', unit: 'squareMeter' as const, salePrice: 50, workerRate: 20, standardMinutes: 0,
    machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true,
  });

  it('defaults norms to an empty array when omitted', () => {
    const state = normFixture();
    const next = run(state, { type: 'operation.create', ...base(state) });
    expect(next.operations[0].norms).toEqual([]);
  });

  it('stores valid norms', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    const next = run(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }] });
    expect(next.operations[0].norms).toEqual([{ itemId, qtyPerM2: 0.2 }]);
  });

  it('rejects duplicate norm items', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }, { itemId, qtyPerM2: 0.3 }] });
  });

  it('rejects an unknown norm item', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: 'missing', qtyPerM2: 0.2 }] });
  });

  it('rejects a customer-owned norm item', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: state.items[1].id, qtyPerM2: 0.2 }] });
  });

  it('rejects non-positive qtyPerM2', () => {
    const state = normFixture();
    atomic(state, { type: 'operation.create', ...base(state), norms: [{ itemId: state.items[0].id, qtyPerM2: 0 }] });
  });

  it('updates norms on operation.update', () => {
    const state = normFixture();
    const itemId = state.items[0].id;
    let next = run(state, { type: 'operation.create', ...base(state), norms: [{ itemId, qtyPerM2: 0.2 }] });
    next = run(next, { type: 'operation.update', operationId: next.operations[0].id, ...base(next), norms: [{ itemId, qtyPerM2: 0.5 }] });
    expect(next.operations[0].norms).toEqual([{ itemId, qtyPerM2: 0.5 }]);
  });
});
```

- [ ] **Step 2: RED — запустить, убедиться в падении**

Run: `npx vitest run src/domain.test.ts -t "operation norms"`
Expected: FAIL — `next.operations[0].norms` undefined / команда не принимает `norms` (TypeScript-ошибка компиляции теста допустима как RED: поле отсутствует).

- [ ] **Step 3: GREEN — типы (types.ts)**

В `src/types.ts` перед `export interface Operation` (строка 14) добавить:

```ts
export interface OperationNorm { itemId: string; qtyPerM2: number }
```

В `Operation` (строки 14-17) добавить поле `norms`:

```ts
export interface Operation {
  id: string; name: string; unit: OperationUnit; salePrice: number; workerRate: number;
  standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean;
  norms: OperationNorm[];
}
```

В командах (строки 138-139) добавить `norms?: OperationNorm[]` в конец обеих:

```ts
  | { type: 'operation.create'; name: string; unit: OperationUnit; salePrice: number; workerRate: number; standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean; norms?: OperationNorm[] }
  | { type: 'operation.update'; operationId: string; name: string; unit: OperationUnit; salePrice: number; workerRate: number; standardMinutes: number; machineId: string | null; employeeIds: string[]; active: boolean; autoAccept: boolean; norms?: OperationNorm[] }
```

- [ ] **Step 4: GREEN — валидация в operationValues (domain.ts)**

В импорте типов `src/domain.ts:8-13` добавить `OperationNorm`. Заменить функцию `operationValues` (строки 119-138) на:

```ts
type OperationValuesInput = Omit<Operation, 'id' | 'norms'> & { norms?: OperationNorm[] };

function operationValues(state: State, input: OperationValuesInput, exclude = ''): Omit<Operation, 'id'> {
  const name = named(state.operations.filter(row => row.id !== exclude), input.name);
  const unit = operationUnit(input.unit);
  const salePrice = money(input.salePrice);
  const workerRate = money(input.workerRate);
  const standardMinutes = quantity(input.standardMinutes, true);
  check(typeof input.active === 'boolean', 'Invalid active flag');
  check(typeof input.autoAccept === 'boolean', 'Invalid auto accept flag');
  let machineId: string | null = null;
  if (input.machineId !== null) {
    const machine = find(state.machines, input.machineId, 'Machine');
    check(machine.active, 'Machine is inactive');
    machineId = machine.id;
  }
  unique(input.employeeIds, 'employee');
  for (const id of input.employeeIds) check(find(state.employees, id, 'Employee').active, 'Employee is inactive');
  const norms = (input.norms ?? []).map(norm => {
    const item = find(state.items, norm.itemId, 'Item');
    check(item.customerId === null, 'Norm material must be a business item');
    return { itemId: item.id, qtyPerM2: quantity(norm.qtyPerM2) };
  });
  unique(norms.map(norm => norm.itemId), 'norm item');
  return {
    name, unit, salePrice, workerRate, standardMinutes, machineId,
    employeeIds: [...input.employeeIds], active: input.active, autoAccept: input.autoAccept, norms,
  };
}
```

Обработчики `operation.create`/`operation.update` (строки 751-760) не меняются — они передают `command` целиком в `operationValues`, который теперь читает `norms`.

- [ ] **Step 5: GREEN — дефолт миграции (migrations.ts)**

В `src/migrations.ts` operations mapping (строки 23-34) добавить строку `norms` перед закрывающей `}))`:

```ts
    active: operation.active ?? true,
    autoAccept: true,
    norms: Array.isArray(operation.norms) ? operation.norms : [],
  }));
```

- [ ] **Step 6: GREEN — обновить ожидание migrations.test.ts**

В `src/migrations.test.ts:32-35` тест «expands legacy operations…» ожидает объект операции. Добавить `norms: []` в ожидаемый объект:

```ts
    expect(migrated.operations[0]).toEqual({
      id: 'operation', name: 'Cut', unit: 'piece', salePrice: 7, workerRate: 7,
      standardMinutes: 0, machineId: null, employeeIds: ['employee'], active: true, autoAccept: true, norms: [],
    });
```

- [ ] **Step 7: Проверка**

Run: `npx vitest run src/domain.test.ts src/migrations.test.ts`
Expected: PASS (все тесты, включая новые «operation norms»).
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 2: Чистые расчёты и слияние норм в order.create

**Files:**
- Modify: `src/domain.ts` (новые функции + order.create строки 836-855)
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: `Operation.norms` (Task 1), `RouteLine`, `MaterialLine`.
- Produces: `areaMaterialCost(norms: OperationNorm[], area: number, getCost: (itemId: string) => number): number`; `areaLaborCost(rate: number, area: number): number`; `normMaterialLines(state: State, route: RouteLine[], lineId: string): MaterialLine[]`.

- [ ] **Step 1: RED — тесты расчётов и слияния (domain.test.ts)**

Добавить в импорт из `./domain` имена `areaMaterialCost, areaLaborCost, normMaterialLines`. Добавить `describe`:

```ts
describe('area cost helpers', () => {
  it('areaLaborCost rounds rate × area', () => {
    expect(areaLaborCost(20, 3)).toBe(60);
    expect(areaLaborCost(0.333, 3)).toBe(1);
  });
  it('areaMaterialCost sums rounded norm × area × cost', () => {
    const norms = [{ itemId: 'a', qtyPerM2: 0.2 }, { itemId: 'b', qtyPerM2: 0.1 }];
    expect(areaMaterialCost(norms, 10, id => (id === 'a' ? 100 : 50))).toBe(250);
  });
});

describe('norm materials on order creation', () => {
  function paintFixture() {
    let state = emptyState();
    state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
    const employeeId = state.employees[0].id;
    state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
    state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
    return state;
  }
  const paintInput = (state: State) => ({
    kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
    overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
    materials: [], route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 10 }],
  });

  it('adds norm materials for a squareMeter stage', () => {
    const state = paintFixture();
    const next = run(state, { type: 'order.create', input: paintInput(state) });
    const order = next.orders[0];
    const paint = order.materials.find(row => row.itemId === state.items[0].id)!;
    const hardener = order.materials.find(row => row.itemId === state.items[1].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.estimatedCost).toBe(100);
    expect(paint.issued).toBe(false);
    expect(hardener.qty).toBe(1);
    expect(estimatedCost(next, order)).toBe(2 * 100 + 1 * 200 + 10 * 20);
  });

  it('sums a norm item already present in manual materials', () => {
    const state = paintFixture();
    const input = paintInput(state);
    input.materials = [{ itemId: state.items[0].id, qty: 3 }];
    const next = run(state, { type: 'order.create', input });
    const paint = next.orders[0].materials.filter(row => row.itemId === state.items[0].id);
    expect(paint).toHaveLength(1);
    expect(paint[0].qty).toBe(5);
  });

  it('does not add norm materials for non-squareMeter stages', () => {
    const state = paintFixture();
    const input = paintInput(state);
    input.route = [{ operationId: state.operations[1].id, employeeId: state.employees[0].id, rate: 2, qty: 10 }];
    const next = run(state, { type: 'order.create', input });
    expect(next.orders[0].materials).toEqual([]);
  });

  it('normMaterialLines returns lines only for squareMeter tasks of the line', () => {
    const state = paintFixture();
    const next = run(state, { type: 'order.create', input: paintInput(state) });
    const order = next.orders[0];
    const lines = normMaterialLines(next, order.route, order.lines[0].id);
    expect(lines.map(row => row.itemId).sort()).toEqual([state.items[0].id, state.items[1].id].sort());
  });
});
```

- [ ] **Step 2: RED — запустить**

Run: `npx vitest run src/domain.test.ts -t "area cost helpers"` и `-t "norm materials"`
Expected: FAIL — `areaMaterialCost is not a function` / материалы норм отсутствуют.

- [ ] **Step 3: GREEN — чистые функции и слияние (domain.ts)**

Добавить после `orderMaterials` (строка 256) следующие функции:

```ts
export function areaLaborCost(rate: number, area: number): number {
  return round(rate * area);
}

export function areaMaterialCost(norms: OperationNorm[], area: number, getCost: (itemId: string) => number): number {
  return round(norms.reduce((total, norm) => total + round(norm.qtyPerM2 * area * getCost(norm.itemId)), 0));
}

export function normMaterialLines(state: State, route: RouteLine[], lineId: string): MaterialLine[] {
  const lines: MaterialLine[] = [];
  for (const task of route) {
    if (task.lineId !== lineId) continue;
    const operation = state.operations.find(row => row.id === task.operationId);
    if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) continue;
    for (const norm of operation.norms) {
      const item = find(state.items, norm.itemId, 'Item');
      lines.push({
        id: uuid(), lineId, itemId: item.id, qty: quantity(norm.qtyPerM2 * task.planned),
        estimatedCost: item.cost, issued: false, actualCost: 0,
      });
    }
  }
  return lines;
}

function mergeNormMaterials(materials: MaterialLine[], normLines: MaterialLine[]): MaterialLine[] {
  const result = materials.map(row => ({ ...row }));
  for (const norm of normLines) {
    const existing = result.find(row => row.itemId === norm.itemId && row.lineId === norm.lineId);
    if (existing) existing.qty = quantity(existing.qty + norm.qty);
    else result.push(norm);
  }
  return result;
}
```

- [ ] **Step 4: GREEN — слияние в order.create (domain.ts)**

В обработчике `order.create`multi-line ветка (строки 839-841) заменить присваивание materials:

```ts
        order.lines = built.lines;
        order.materials = built.materials;
        order.route = built.route;
```

на:

```ts
        order.lines = built.lines;
        order.route = built.route;
        order.materials = built.lines.reduce((materials, line) =>
          mergeNormMaterials(materials, normMaterialLines(state, built.route, line.id)), built.materials);
```

В single-line ветке (строки 853-854) заменить:

```ts
        order.materials = orderMaterials(state, input.materials ?? [], input.customerId, line.id);
        order.route = routeValues(state, input.route ?? [], qty, line.id);
```

на:

```ts
        order.route = routeValues(state, input.route ?? [], qty, line.id);
        order.materials = mergeNormMaterials(
          orderMaterials(state, input.materials ?? [], input.customerId, line.id),
          normMaterialLines(state, order.route, line.id));
```

`order.update`/`revisionLines`/`series.create` не трогаем — нормы не пересчитываются на ревизиях и не сливаются в серии.

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS (весь файл, включая регрессии существующих заказов).
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 3: Склад — группа 06 «Bo‘yoq va kimyo»

**Files:**
- Modify: `src/warehouse.ts:48-58` (вставка перед группой 07)
- Test: `src/warehouse.test.ts` (новый)

**Interfaces:**
- Produces: `warehouseGroups` содержит группу `06`; `categoryCodes` включает `06.01`–`06.06`; `categoryGroupName('06.01') === 'Bo‘yoq va kimyo'`.

- [ ] **Step 1: RED — тест (warehouse.test.ts, новый файл)**

```ts
import { describe, expect, it } from 'vitest';
import { categoryCodes, categoryGroupName, categoryLabel, isCategoryCode, warehouseGroups } from './warehouse';

describe('paint warehouse group', () => {
  it('adds group 06 with six leaves', () => {
    const group = warehouseGroups.find(row => row.code === '06');
    expect(group?.name).toBe('Bo‘yoq va kimyo');
    expect(group?.children.map(leaf => leaf.code)).toEqual(['06.01', '06.02', '06.03', '06.04', '06.05', '06.06']);
  });
  it('recognizes the new codes', () => {
    expect(isCategoryCode('06.01')).toBe(true);
    expect(categoryCodes).toContain('06.06');
    expect(categoryGroupName('06.02')).toBe('Bo‘yoq va kimyo');
    expect(categoryLabel('06.01')).toBe('06.01 · Bo‘yoq');
  });
  it('keeps abrasives in group 07', () => {
    expect(categoryGroupName('07.03')).toBe('Sarf materiallari');
    expect(categoryLabel('07.03')).toBe('07.03 · Abrazivlar');
  });
});
```

- [ ] **Step 2: RED — запустить**

Run: `npx vitest run src/warehouse.test.ts`
Expected: FAIL — группа 06 отсутствует.

- [ ] **Step 3: GREEN — добавить группу (warehouse.ts)**

В `src/warehouse.ts` перед блоком `{ code: '07', … }` (строка 49) вставить:

```ts
  {
    code: '06', name: 'Bo‘yoq va kimyo', children: [
      { code: '06.01', name: 'Bo‘yoq' },
      { code: '06.02', name: 'Lak' },
      { code: '06.03', name: 'Grunt' },
      { code: '06.04', name: 'Qotiruvchi' },
      { code: '06.05', name: 'Erituvchi' },
      { code: '06.06', name: 'Shpaklyovka' },
    ],
  },
```

- [ ] **Step 4: Проверка**

Run: `npx vitest run src/warehouse.test.ts`
Expected: PASS.
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 4: UI — нормы в OperationRateEditor

**Files:**
- Modify: `src/components/QuickEditors.tsx:104-130` (OperationRateEditor)
- Test: `src/painting-ui.test.tsx` (новый)

**Interfaces:**
- Consumes: `Operation.norms`, `OperationNorm`, `warehouseGroups`/`state.items` для выбора материала.
- Produces: для `unit === 'squareMeter'` редактор рендерит строки норм и сохраняет `norms` в `operation.update`.

Примечание: `OperationRateEditor` получает только `operation`, без `state`. Для выбора материала нужен список items. Чтобы не менять сигнатуру во всех местах вызова, добавляем необязательный prop `items?: Item[]` (дефолт `[]`); вызывающий компонент передаёт `state.items`. Места вызова обновляем в этом шаге.

- [ ] **Step 1: RED — UI-тест (painting-ui.test.tsx, новый файл)**

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OperationRateEditor } from './components/QuickEditors';
import type { Item, Operation } from './types';

const items: Item[] = [{
  id: 'paint', name: 'Bo‘yoq', unit: 'litr', minQty: 0, cost: 100, customerId: null,
  kind: 'material', salePrice: 0, lastPurchasePrice: 0, materialCost: 100, laborCost: 0, category: '06.01',
}];

function render(operation: Operation): string {
  return renderToStaticMarkup(createElement(OperationRateEditor, {
    operation, items, busy: false, close: () => {}, save: async () => {},
  }));
}

const squareMeter: Operation = {
  id: 'op', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0,
  machineId: null, employeeIds: ['e1'], active: true, autoAccept: true,
  norms: [{ itemId: 'paint', qtyPerM2: 0.2 }],
};

describe('operation norms editor', () => {
  it('shows the norms section for a squareMeter operation', () => {
    const html = render(squareMeter);
    expect(html).toContain('Norma');
    expect(html).toContain('value="0.2"');
    expect(html).toContain('Bo‘yoq');
  });
  it('hides the norms section for a piece operation', () => {
    const html = render({ ...squareMeter, unit: 'piece', norms: [] });
    expect(html).not.toContain('1 m² uchun norma');
  });
});
```

- [ ] **Step 2: RED — запустить**

Run: `npx vitest run src/painting-ui.test.tsx`
Expected: FAIL — секция норм не рендерится (и prop `items` не объявлен → TS-ошибка как RED).

- [ ] **Step 3: GREEN — добавить секцию норм (QuickEditors.tsx)**

В импорте типов `src/components/QuickEditors.tsx:7` уже есть `Item, Operation`. Заменить `OperationRateEditor` (строки 104-130) на:

```tsx
export function OperationRateEditor({ operation, items = [], busy, close, save }: {
  operation: Operation; items?: Item[]; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const [workerRate, setWorkerRate] = useState(operation.workerRate);
  const [salePrice, setSalePrice] = useState(operation.salePrice);
  const [standardMinutes, setStandardMinutes] = useState(operation.standardMinutes);
  const [norms, setNorms] = useState(operation.norms);
  const byArea = operation.unit === 'squareMeter';
  const setNorm = (index: number, patch: Partial<{ itemId: string; qtyPerM2: number }>) =>
    setNorms(norms.map((norm, i) => (i === index ? { ...norm, ...patch } : norm)));
  return <Dialog title={`${operation.name} · stavka`} subtitle="Yangi stavka keyingi buyurtmalarga qo‘llanadi. Mavjud marshrutlarda stavka qotib qolgan." close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save({
      type: 'operation.update', operationId: operation.id, name: operation.name, unit: operation.unit,
      salePrice, workerRate, standardMinutes, machineId: operation.machineId, employeeIds: operation.employeeIds, active: operation.active,
      autoAccept: true, norms: byArea ? norms.filter(norm => norm.itemId) : operation.norms,
    }); }}>
      <div className="form-body">
        <div className="form-grid">
          <Field label="Ijrochi tannarxi, UZS"><input type="number" min="0" step="0.01" value={workerRate || ''} onChange={event => setWorkerRate(Number(event.target.value))} required autoFocus /></Field>
          <Field label="Mijoz uchun birlik narxi, UZS"><input type="number" min="0" step="0.01" value={salePrice || ''} onChange={event => setSalePrice(Number(event.target.value))} required /></Field>
          <Field label="Vaqt normasi, daqiqa"><input type="number" min="0" step="0.1" value={standardMinutes || ''} onChange={event => setStandardMinutes(Number(event.target.value))} required /></Field>
        </div>
        {byArea && <div className="field"><span>1 m² uchun norma</span>
          {norms.map((norm, index) => <div className="editor-line" key={index}>
            <select aria-label={`Norma materiali ${index + 1}`} value={norm.itemId} onChange={event => setNorm(index, { itemId: event.target.value })}>
              <option value="">Materialni tanlang</option>
              {items.filter(item => item.customerId === null && item.kind !== 'finished').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input aria-label={`Norma sarfi ${index + 1}`} type="number" min="0.001" step="0.001" value={norm.qtyPerM2} required onChange={event => setNorm(index, { qtyPerM2: Number(event.target.value) })} />
            <button type="button" className="icon-button" aria-label={`Normani olib tashlash ${index + 1}`} onClick={() => setNorms(norms.filter((_, i) => i !== index))}><X size={17} /></button>
          </div>)}
          <button type="button" className="secondary small" onClick={() => setNorms([...norms, { itemId: '', qtyPerM2: 0 }])}><ImagePlus size={14} />Norma qo‘shish</button>
          <small>Norma × maydon buyurtma smetasiga material qatori bo‘lib tushadi. Haqiqiy sarfni ishchi tahrirlaydi.</small>
        </div>}
        <div className="info-note">{operationUnits.find(([key]) => key === operation.unit)?.[1] ?? operation.unit} birligi uchun. Summa = stavka × qabul qilingan miqdor.</div>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy}>{busy ? 'Saqlanmoqda…' : 'Stavkani saqlash'}</button>
      </footer>
    </form>
  </Dialog>;
}
```

- [ ] **Step 4: GREEN — передать items в местах вызова**

Найти все вызовы `OperationRateEditor`:

Run (поиск): `Grep pattern="OperationRateEditor" glob="src/**/*.tsx" output_mode="content" -n`

В каждом вызове добавить prop `items={state.items}` (рядом с `operation={…}`). Ожидаемое место — `src/components/CatalogSettings.tsx` (или аналогичный экран справочника операций). Если вызов использует другое имя состояния, передать соответствующий массив items.

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/painting-ui.test.tsx`
Expected: PASS.
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 5: Разбивка себестоимости нормы в редакторе заказа

**Files:**
- Modify: `src/order-editor.ts:105-107` (после stageAmounts)
- Modify: `src/components/OrderEditor.tsx:14` (импорт), `:201-204` (подсказка)
- Test: `src/order-editor.test.ts`

**Interfaces:**
- Consumes: `areaMaterialCost` (Task 2), `PositionStage`, `State`.
- Produces: `stageNormEstimate(state: State, stage: PositionStage): number | null` — плановая смета материалов нормы для этапа `squareMeter`, иначе `null`.

- [ ] **Step 1: RED — тест (order-editor.test.ts)**

Добавить `stageNormEstimate` в импорт из `./order-editor` (строки 5-17). Добавить тест в существующий `describe` (или новый):

```ts
describe('stageNormEstimate', () => {
  function paintState() {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Painter' });
    state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
    state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }] });
    state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [state.employees[0].id], active: true, autoAccept: true });
    return state;
  }
  const stage = (state: State, operationId: string) => ({
    operationId, executorKind: 'employee' as const, employeeId: state.employees[0].id, supplierId: null,
    rate: 20, qty: 10, locked: false, completed: 0,
  });

  it('estimates norm material cost for a squareMeter stage', () => {
    const state = paintState();
    expect(stageNormEstimate(state, stage(state, state.operations[0].id))).toBe(200);
  });
  it('returns null for a non-squareMeter stage', () => {
    const state = paintState();
    expect(stageNormEstimate(state, stage(state, state.operations[1].id))).toBeNull();
  });
});
```

- [ ] **Step 2: RED — запустить**

Run: `npx vitest run src/order-editor.test.ts -t "stageNormEstimate"`
Expected: FAIL — `stageNormEstimate is not a function`.

- [ ] **Step 3: GREEN — helper (order-editor.ts)**

В `src/order-editor.ts:1` добавить `areaMaterialCost` в импорт из `./domain`:

```ts
import { areaMaterialCost, lineMaterials, lineRoute, shippedForLine, startedTask } from './domain';
```

После `stageAmounts` (строка 107) добавить:

```ts
export function stageNormEstimate(state: State, stage: PositionStage): number | null {
  const operation = state.operations.find(row => row.id === stage.operationId);
  if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) return null;
  return areaMaterialCost(operation.norms, stage.qty, itemId => state.items.find(item => item.id === itemId)?.cost ?? 0);
}
```

- [ ] **Step 4: GREEN — подсказка в OrderEditor.tsx**

В `src/components/OrderEditor.tsx:14` добавить `stageNormEstimate` в импорт из `../order-editor`. После блока `<b className="route-amount" …>…</b>` (строки 201-204) добавить:

```tsx
      {(() => {
        const estimate = stageNormEstimate(state, task);
        return estimate === null ? null : <small className="route-rate" title="Norma bo‘yicha material smetasi: norma × maydon × o‘rtacha tannarx">material ≈ {money(estimate)}</small>;
      })()}
```

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/order-editor.test.ts`
Expected: PASS.
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 6: Демо-данные

**Files:**
- Modify: `src/seed.ts:19-20` (операции), после строки 28 (материалы), конец createDemo (демо-заказ)
- Test: `src/domain.test.ts` (регрессия createDemo) — существующие тесты, использующие createDemo, должны остаться зелёными.

**Interfaces:**
- Consumes: команды `item.create`, `operation.create` с `norms`, `order.create`.
- Produces: демо содержит материалы ЛКМ/абразивы, операции Bo‘yash/Jilolash (`squareMeter` + нормы), заказ покраски.

- [ ] **Step 1: Materialien — добавить материалы ЛКМ/абразивы (seed.ts)**

После строки 28 (`Fasad · oq`) добавить:

```ts
  run({ type: 'item.create', name: 'Poliuretan bo‘yoq · oq', unit: 'litr', minQty: 5, cost: 0, customerId: null, category: '06.01' });
  run({ type: 'item.create', name: 'Akril lak', unit: 'litr', minQty: 3, cost: 0, customerId: null, category: '06.02' });
  run({ type: 'item.create', name: 'Qotiruvchi', unit: 'litr', minQty: 2, cost: 0, customerId: null, category: '06.04' });
  run({ type: 'item.create', name: 'Erituvchi 646', unit: 'litr', minQty: 2, cost: 0, customerId: null, category: '06.05' });
  run({ type: 'item.create', name: 'Abraziv doira P120', unit: 'dona', minQty: 20, cost: 0, customerId: null, category: '07.03' });
```

Запомнить индексы: после добавления `state.items[8]` = bo‘yoq, `[9]` = lak, `[10]` = qotiruvchi, `[11]` = erituvchi, `[12]` = abraziv. Добавить после строки 32:

```ts
  const paintItem = state.items[8].id;
  const hardenerItem = state.items[10].id;
  const abrasiveItem = state.items[12].id;
```

- [ ] **Step 2:Operation — перевести Bo‘yash/Jilolash на squareMeter с нормами (seed.ts)**

Заменить строки 19-20 на:

```ts
  run({ type: 'operation.create', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: abrasiveItem, qtyPerM2: 0.5 }] });
  run({ type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: paintItem, qtyPerM2: 0.25 }, { itemId: hardenerItem, qtyPerM2: 0.1 }] });
```

ВАЖНО: `abrasiveItem`/`paintItem`/`hardenerItem` объявлены в Step 1 ПОСЛЕ операций в текущем порядке файла. Чтобы нормы ссылались на существующие items, перенести создание материалов ЛКМ (Step 1) ВЫШЕ операций Bo‘yash/Jilolash, либо объявить переменные после материалов и использовать их в операциях. Порядок в файле: сначала все `item.create`, затем `operation.create` для Jilolash/Bo‘yash. Операции Kesish/Kromka/Yig‘ish (строки 16-18) остаются до материалов как есть — они без норм. Переместить строки 19-20 (Jilolash/Bo‘yash) ниже блока материалов и объявления переменных.

- [ ] **Step 3: Stock — закупка материалов ЛКМ (seed.ts)**

В существующий первый `purchase.create` (строки 35-39) добавить строки материалов ЛКМ, чтобы склад имел краску/абразивы для выдачи:

```ts
  run({ type: 'purchase.create', supplierId: state.suppliers[0].id, lines: [
    { itemId: state.items[0].id, qty: 20, price: 550000 },
    { itemId: state.items[1].id, qty: 120, price: 12000 },
    { itemId: state.items[2].id, qty: 40, price: 45000 },
    { itemId: paintItem, qty: 20, price: 120000 },
    { itemId: hardenerItem, qty: 10, price: 180000 },
    { itemId: abrasiveItem, qty: 100, price: 8000 },
  ] });
```

- [ ] **Step 4: Order — демо-заказ покраски (seed.ts)**

В конец `createDemo` (перед `return state;`) добавить заказ на покраску фасадов:

```ts
  run({ type: 'order.create', input: {
    kind: 'service', customerId: state.customers[1].id, title: 'Fasadlarni bo‘yash · 12 m²', qty: 1, price: 1800000,
    overhead: 100000, dueDate: dateOffset(7), advance: 0, account: 'bank',
    materials: [],
    route: [
      { operationId: state.operations[3].id, employeeId: state.employees[0].id, rate: 30000, qty: 12 },
      { operationId: state.operations[4].id, employeeId: state.employees[0].id, rate: 50000, qty: 12 },
    ],
  } });
```

(`state.operations[3]` = Jilolash, `[4]` = Bo‘yash после перестановки; проверить индексы по фактическому порядку.)

- [ ] **Step 5: Проверка**

Run: `npx vitest run src/domain.test.ts src/order-editor.test.ts src/outsource-ui.test.tsx`
Expected: PASS (createDemo используется во многих тестах — регрессии зелёные).
Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 7: Сервер — schema.sql и генератор миграции

**Files:**
- Modify: `supabase/schema.sql:57-71` (колонка), `:1375-1386` (снимок), `:1732-1779` (operation.create/update), `:1908`/`:1923` (order.create), после `erp_insert_materials` (новая функция), `:2813-2818` (grant-блок)
- Create: `.validation-pglite-20261029/generate-operation-norms-migration.mjs`
- Create (генерируется): `supabase/migrations/20261109_operation_norms.sql`

**Interfaces:**
- Consumes: canonical schema.sql.
- Produces: `erp_operations.norms jsonb`; `erp_insert_norm_materials(uuid, uuid, uuid)`; обновлённые `erp_snapshot`/`erp_execute`; идемпотентная миграция.

- [ ] **Step 1: Колонка norms (schema.sql)**

В `CREATE TABLE public.erp_operations` (строки 57-71) добавить строку перед `UNIQUE (company_id, id)`:

```sql
  norms jsonb NOT NULL DEFAULT '[]'::jsonb,
```

- [ ] **Step 2: Функция слияния норм (schema.sql)**

После `erp_insert_materials` (завершается строка 845 `$$;`) добавить:

```sql
CREATE FUNCTION public.erp_insert_norm_materials(p_company_id uuid, p_order_id uuid, p_line_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_task record; v_norm jsonb; v_item public.erp_items%ROWTYPE; v_pos integer;
  v_qty numeric; v_item_id uuid; v_existing public.erp_order_materials%ROWTYPE;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_order_materials
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_task IN SELECT t.planned AS area, op.norms AS norms
    FROM public.erp_tasks t JOIN public.erp_operations op
      ON op.company_id = t.company_id AND op.id = t.operation_id
    WHERE t.company_id = p_company_id AND t.order_id = p_order_id AND t.line_id = p_line_id
      AND op.unit = 'squareMeter' AND jsonb_array_length(op.norms) > 0 LOOP
    FOR v_norm IN SELECT value FROM jsonb_array_elements(v_task.norms) LOOP
      v_item_id := public.erp_uuid(v_norm -> 'itemId', 'norm itemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_item_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Norm item not found' USING ERRCODE = '22023'; END IF;
      IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Norm material must be a business item' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(v_norm -> 'qtyPerM2', 'qtyPerM2') * v_task.area;
      SELECT * INTO v_existing FROM public.erp_order_materials
        WHERE company_id = p_company_id AND order_id = p_order_id AND line_id = p_line_id AND item_id = v_item_id;
      IF FOUND THEN
        UPDATE public.erp_order_materials SET qty = qty + v_qty
          WHERE company_id = p_company_id AND id = v_existing.id;
      ELSE
        INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
          VALUES (p_company_id, p_order_id, p_line_id, v_item_id, v_pos, v_qty, v_item.cost);
        v_pos := v_pos + 1;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
```

- [ ] **Step 3: Снимок — сериализация норм (schema.sql)**

В `erp_snapshot` operations jsonb_build_object (строки 1375-1382) заменить строку `'active', op.active, 'autoAccept', op.auto_accept)` на:

```sql
        'active', op.active, 'autoAccept', op.auto_accept,
        'norms', CASE WHEN v_admin THEN op.norms ELSE '[]'::jsonb END) ORDER BY op.id), '[]'::jsonb)
```

(убрать прежний `ORDER BY op.id), '[]'::jsonb)` с строки 1382, чтобы не задвоить).

- [ ] **Step 4: erp_execute — operation.create/update хранят нормы (schema.sql)**

В ветке `operation.create` после `INSERT INTO public.erp_operations … RETURNING id INTO v_entity;` (строка 1753) добавить вызов helper для норм. Проще: хранить нормы прямо в INSERT. Заменить INSERT (строки 1747-1753) на:

```sql
      INSERT INTO public.erp_operations(company_id, name, unit, sale_price, worker_rate, standard_minutes, machine_id, employee_ids, active, auto_accept, norms)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), v_unit,
          public.erp_money(p_command -> 'salePrice', 'salePrice', true),
          public.erp_money(p_command -> 'workerRate', 'workerRate', true),
          public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
          v_ref, v_employee_ids, public.erp_bool(p_command -> 'active', 'active'),
          public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
          public.erp_norms(v_company, p_command -> 'norms')) RETURNING id INTO v_entity;
```

В ветке `operation.update` UPDATE (строки 1773-1779) добавить `norms = public.erp_norms(v_company, p_command -> 'norms')`:

```sql
      UPDATE public.erp_operations SET name = btrim(public.erp_text(p_command -> 'name', 'name')), unit = v_unit,
        sale_price = public.erp_money(p_command -> 'salePrice', 'salePrice', true),
        worker_rate = public.erp_money(p_command -> 'workerRate', 'workerRate', true),
        standard_minutes = public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
        machine_id = v_ref, employee_ids = v_employee_ids,
        active = public.erp_bool(p_command -> 'active', 'active'),
        auto_accept = public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
        norms = public.erp_norms(v_company, p_command -> 'norms') WHERE id = v_entity;
```

- [ ] **Step 5: Helper валидации норм erp_norms (schema.sql)**

Перед `erp_insert_norm_materials` добавить функцию, возвращающую проверенный jsonb норм (дефолт `[]`):

```sql
CREATE FUNCTION public.erp_norms(p_company_id uuid, p_norms jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_norm jsonb; v_item public.erp_items%ROWTYPE; v_seen uuid[] := ARRAY[]::uuid[];
  v_id uuid; v_qty numeric; v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_norms IS NULL OR p_norms = 'null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  FOR v_norm IN SELECT value FROM jsonb_array_elements(public.erp_array(p_norms, 'norms')) LOOP
    v_id := public.erp_uuid(v_norm -> 'itemId', 'norm itemId');
    IF v_id = ANY(v_seen) THEN RAISE EXCEPTION 'Duplicate norm item' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Norm item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Norm material must be a business item' USING ERRCODE = '23514'; END IF;
    v_qty := public.erp_num(v_norm -> 'qtyPerM2', 'qtyPerM2');
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023'; END IF;
    v_seen := v_seen || v_id;
    v_result := v_result || jsonb_build_array(jsonb_build_object('itemId', v_id, 'qtyPerM2', v_qty));
  END LOOP;
  RETURN v_result;
END;
$$;
```

- [ ] **Step 6: order.create — слияние норм после маршрута (schema.sql)**

В multi-line ветке после `PERFORM public.erp_insert_route(…v_rec…)` (строка 1908) добавить:

```sql
          PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_rec.line_id);
```

В single-line ветке после `PERFORM public.erp_insert_route(…v_line_id…)` (строка 1923) добавить:

```sql
        PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_line_id);
```

`series.create` (строка 2102) НЕ трогаем — серии нормы не получают.

- [ ] **Step 7: Grant-блок (schema.sql)**

В REVOKE-список (строки 2813-2818) добавить `public.erp_norms(uuid, jsonb), public.erp_insert_norm_materials(uuid, uuid, uuid),` рядом с другими internal helpers. В GRANT EXECUTE internal-блока (после строки 2821, где перечисляются helpers) добавить эти две функции. Точное место: найти GRANT-блок, который грантит `erp_insert_materials` и другие helpers authenticated, и добавить туда обе новые функции.

- [ ] **Step 8: Генератор миграции (новый файл)**

Создать `.validation-pglite-20261029/generate-operation-norms-migration.mjs` по образцу `generate-outsourced-services-migration.mjs`:

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261109_operation_norms.sql', root);

const names = ['erp_norms', 'erp_insert_norm_materials', 'erp_snapshot', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}
require("norms jsonb NOT NULL DEFAULT '[]'::jsonb", 'erp_operations.norms');
require("'norms', CASE WHEN v_admin THEN op.norms", 'snapshot norms');
require('public.erp_norms(v_company, p_command', 'execute norms validation');
require('PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_line_id)', 'order.create norm merge');

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

const ddl = `-- Aliya ERP: operation norms — painting/sanding materials per 1 m² merged into order estimates.
-- Safe to run more than once. Existing operations keep norms = '[]'.

BEGIN;

ALTER TABLE public.erp_operations ADD COLUMN IF NOT EXISTS norms jsonb NOT NULL DEFAULT '[]'::jsonb;

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_norms(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_norms(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.erp_insert_norm_materials(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_insert_norm_materials(uuid, uuid, uuid) TO authenticated;
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

- [ ] **Step 9: Сгенерировать миграцию**

Run: `node .validation-pglite-20261029/generate-operation-norms-migration.mjs`
Expected: вывод `{"functions":4,"sha256":"…"}`, файл `supabase/migrations/20261109_operation_norms.sql` создан.

- [ ] **Step 10: Проверка**

Run: `npx tsc -b --pretty false`
Expected: exit 0 (schema.sql не влияет на TS, но проверяемWhole).
Примечание: SQL-корректность проверяется PGlite-зондом в Task 8. Миграция НЕ применяется к живой базе в этом плане — только по отдельному разрешению владельца.

---

### Task 8: PGlite-зонд паритета клиент/сервер

**Files:**
- Create: `.validation-pglite-20261029/validate-operation-norms.mjs`

**Interfaces:**
- Consumes: `supabase/schema.sql`, `supabase/migrations/20261109_operation_norms.sql`.
- Produces: зонд, проверяющий идемпотентность миграции, хранение норм, слияние в материалы, паритет с клиентом.

- [ ] **Step 1: Написать зонд (по образцу validate-outsourced-services.mjs)**

Создать `.validation-pglite-20261029/validate-operation-norms.mjs`. Скаффолдинг (роли, auth, `as`/`owner`/`one`/`snapshot`/`executeAs`/`execute`) скопировать из `validate-outsourced-services.mjs` (строки 1-65). Затем:

```js
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261109_operation_norms.sql', root), 'utf8');
// … (скаффолдинг ролей и db.exec(schema) как в образце) …
await db.exec(schema);
await db.exec(migration);
await db.exec(migration);
pass('Operation norms migration applies twice on top of the canonical schema (idempotent)');

// bootstrap company + admin profile (скопировать паттерн из образца: erp_bootstrap_company)
const boot = await execute({ type: 'cash.post', direction: 'in', amount: 1000000, account: 'bank', toAccount: null, category: 'Test', note: '' });
companyId = boot.state.companyId;

// employee + items + squareMeter operation with norms
await execute({ type: 'employee.create', name: 'Painter' });
await execute({ type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null, category: '06.01' });
await execute({ type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null, category: '06.04' });
const snap1 = await snapshot(adminId);
const employeeId = snap1.state.employees[0].id;
const paintId = snap1.state.items.find(i => i.name === 'Paint').id;
const hardenerId = snap1.state.items.find(i => i.name === 'Hardener').id;
await execute({ type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: paintId, qtyPerM2: 0.2 }, { itemId: hardenerId, qtyPerM2: 0.1 }] });
const snap2 = await snapshot(adminId);
const operation = snap2.state.operations.find(o => o.name === 'Paint');
assert.deepEqual(operation.norms, [{ itemId: paintId, qtyPerM2: 0.2 }, { itemId: hardenerId, qtyPerM2: 0.1 }]);
pass('erp_snapshot serializes operation norms for admin');

// customer + order with a 10 m² painting stage
await execute({ type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
const snap3 = await snapshot(adminId);
const customerId = snap3.state.customers[0].id;
await execute({ type: 'order.create', input: { kind: 'product', customerId, title: 'Facade', qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [], route: [{ operationId: operation.id, employeeId, rate: 20, qty: 10 }] } });
const materials = await owner(`SELECT item_id, qty, estimated_cost FROM public.erp_order_materials WHERE company_id = $1 ORDER BY position`, [companyId]);
const paint = materials.find(m => m.item_id === paintId);
const hardener = materials.find(m => m.item_id === hardenerId);
assert.equal(Number(paint.qty), 2);
assert.equal(Number(paint.estimated_cost), 100);
assert.equal(Number(hardener.qty), 1);
pass('order.create merges norm materials (qty = qtyPerM2 × area, estimated_cost = item.cost)');

// duplicate item sums with manual materials
await execute({ type: 'order.create', input: { kind: 'product', customerId, title: 'Facade 2', qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [{ itemId: paintId, qty: 3 }], route: [{ operationId: operation.id, employeeId, rate: 20, qty: 10 }] } });
const order2 = (await snapshot(adminId)).state.orders.find(o => o.title === 'Facade 2');
const paintLines = order2.materials.filter(m => m.itemId === paintId);
assert.equal(paintLines.length, 1);
assert.equal(Number(paintLines[0].qty), 5);
pass('norm item already in manual materials is summed into one line');

// validation rejections
async function rejects(command, label) {
  let threw = false;
  try { await execute(command); } catch { threw = true; }
  assert.ok(threw, label);
}
await rejects({ type: 'operation.create', name: 'Bad', unit: 'squareMeter', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: paintId, qtyPerM2: 0.2 }, { itemId: paintId, qtyPerM2: 0.3 }] }, 'duplicate norm item rejected');
await rejects({ type: 'operation.create', name: 'Bad2', unit: 'squareMeter', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: paintId, qtyPerM2: 0 }] }, 'zero qtyPerM2 rejected');
pass('erp_norms rejects duplicate items and non-positive qtyPerM2');

// worker snapshot hides norms
const workerProfile = await one(`SELECT id FROM public.erp_profiles WHERE company_id = $1 AND role = 'worker' LIMIT 1`, [companyId]);
if (workerProfile) {
  const workerSnap = await snapshot(workerProfile.id);
  const workerOp = workerSnap.state.operations.find(o => o.id === operation.id);
  if (workerOp) assert.deepEqual(workerOp.norms, []);
  pass('worker snapshot hides norms');
}

console.log(`\n${passes} checks passed`);
```

ВАЖНО: точный скаффолдинг bootstrap-компании и профилей взять из `validate-outsourced-services.mjs` (строки после 65) — там создаётся компания через `erp_bootstrap_company` и профили admin/worker. Адаптировать под зонд норм. `companyId` должен быть присвоен после bootstrap.

- [ ] **Step 2: Запустить зонд**

Run: `node .validation-pglite-20261029/validate-operation-norms.mjs`
Expected: все `PASS …`, финал `N checks passed`, exit 0.

- [ ] **Step 3: Регрессия существующих зондов**

Run: `node .validation-pglite-20261029/validate-outsourced-services.mjs`
Expected: exit 0 (изменения erp_execute не сломали аутсорс).
Run: `node .validation-pglite-20261029/combined-migrations-probe.mjs`
Expected: exit 0 (все миграции применяются вместе идемпотентно).

---

### Task 9: Финальная проверка и браузерный демо-сценарий

**Files:** нет изменений (только проверка).

- [ ] **Step 1: Полный набор тестов**

Run: `npm test`
Expected: PASS — все файлы, 0 failures.

- [ ] **Step 2: Типы**

Run: `npx tsc -b --pretty false`
Expected: exit 0.

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: exit 0, `dist/` собран.

- [ ] **Step 4: Браузерный демо-сценарий (без деплоя)**

Запустить preview с пустыми VITE_SUPABASE_* (демо-режим, без записи в живую базу):

Run: `npm run preview` (или `npm run dev`), открыть в браузере.

Проверить в демо-режиме:
1. Справочник операций → Bo‘yash (`squareMeter`) → редактор ставки показывает секцию норм (Bo‘yoq 0.25, Qotiruvchi 0.1).
2. Склад → категория `06 · Bo‘yoq va kimyo` видна в дереве; абразивы в `07.03`.
3. Демо-заказ «Fasadlarni bo‘yash · 12 m²» → смета включает материалы норм (краска 3 л, отвердитель 1.2 л, абразивы 6 шт) и ЗП маляра/шлифовщика; под этапом видна подсказка `material ≈ …`.
4. Изменить фактическое количество краски в ревизии материалов → выдать материалы (`order.issue`) → `actualCost` отражает фактический расход.
5. Создать новый заказ с этапом покраски N м² → материалы нормы появляются автоматически.

Если in-app браузер узкий/скриншоты падают (известное ограничение) — проверить через `evaluate_script` ширины и наличие элементов, либо честно отметить, что браузерная проверка ограничена.

- [ ] **Step 5: Итог владельцу (на русском)**

Сообщить: что реализовано, результаты проверок (тесты/типы/сборка/зонды), что миграция `supabase/migrations/20261109_operation_norms.sql` готова к применению владельцем через Supabase SQL Editor, и что деплой фронтенда — только после отдельного разрешения и ПОСЛЕ применения миграции. Не деплоить без разрешения.

---

## Self-Review (выполнено при написании)

- **Покрытие спецификации:** типы/валидация (T1), расчёты+слияние (T2), склад 06 (T3), UI норм (T4), разбивка себестоимости (T5), демо (T6), сервер+миграция (T7), PGlite-паритет (T8), финальная проверка+браузер (T9). Серийные заказы не трогаются (T2 Step 4, T7 Step 6). Формулы estimatedCost/actualCost не меняются. Все требования	spec покрыты.
- **Плейсхолдеры:** отсутствуют — каждый шаг содержит точный код или точную команду.
- **Согласованность типов:** `OperationNorm`/`Operation.norms` (T1) используются в T2/T4/T5/T7; `areaMaterialCost` (T2) используется в T5; `stageNormEstimate` (T5) рендерится в OrderEditor; `erp_norms`/`erp_insert_norm_materials` (T7) проверяются зондом (T8). Имена согласованы.
- **Известный риск порядка (T6):** операции Bo‘yash/Jilolash ссылаются на items, созданные позже в текущем файле — Step 2 явно требует переставить порядок. Исполнитель должен проверить индексы operations/items по фактическому порядку.