# Маршрутизация: шаблоны «услуга» vs «под ключ» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать администратору именные шаблоны маршрутов (Xizmat / Pod klyuch) с применением в одну кнопку к позиции заказа, зеркально в офлайн-домене и в Supabase.

**Architecture:** Новая справочная коллекция `routeTemplates` рядом с операциями (не новый модуль). Применение — чистый хелпер слоя редактора `applyTemplate`, который копирует этапы в позицию; заказ хранит обычный маршрут без ссылки на шаблон. Домен (CRUD) и серверный `erp_execute` реализуют одинаковую валидацию; `erp_snapshot` сериализует шаблоны канонически (`jsonb_strip_nulls`), чтобы JSON совпадал с доменом.

**Tech Stack:** React 19 + TypeScript (strict), Vite 6, Vitest 3 (node env, без jsdom — UI-тесты через `renderToStaticMarkup`), PGlite для SQL-зондов, Supabase (plpgsql, RLS).

**Spec:** [docs/superpowers/specs/2026-11-10-routing-service-vs-full-design.md](../specs/2026-11-10-routing-service-vs-full-design.md)

## Global Constraints

- Рабочая папка **не Git-репозиторий**: никаких коммитов. Каждая задача заканчивается проверкой (`npm test` / `npx tsc -b --pretty false` / `npm run build`), а не коммитом.
- Команды: `npm test` (=`vitest run`), `npx vitest run src/<file>.test.ts` (точечно), `npx tsc -b --pretty false` (типы), `npm run build` (= `tsc -b && vite build`).
- UI-подписи — узбекская латиница, суммы UZS; `src/i18n.ts` не трогаем (строки инлайном, как в `CatalogSettings.tsx`).
- Версия `State` остаётся `4`; `routeTemplates` — опциональная коллекция с fallback `[]` (по образцу `loans`/`salaryPlans`).
- `routeTemplate.*` — только администратор: существующий role-gate в `applyCommand`/`erp_execute` уже отклоняет не-work команды работника (`'Administrator action required'` / `42501`), отдельного запрета не нужно.
- Паритет сериализации этапа: обе стороны опускают `null`-поля исполнителя и `undefined`/отсутствующую `rate`; `executorKind` присутствует всегда (по умолчанию `'employee'`).
- Применение миграции к живой базе и deploy — **вне этих задач**, только по отдельному разрешению владельца.
- Резервные копии и данные компании никогда не выводятся в чат.

---

### Task 1: Типы, fallback миграции и пустая коллекция

**Files:**
- Modify: `src/types.ts:84-111,179`
- Modify: `src/migrations.ts:1-3,135`
- Modify: `src/domain.ts:435`
- Test: `src/migrations.test.ts:189-194`

**Interfaces:**
- Consumes: существующие `ExecutorKind`, `OrderLineKind`, `State`, `Command`.
- Produces: типы `RouteTemplateStage`, `RouteTemplate`; поле `State.routeTemplates: RouteTemplate[]`; команды `routeTemplate.create` / `routeTemplate.update` (потребуются в T2 и далее); fallback `migrateState().routeTemplates`.

- [ ] **Step 1: RED — тест fallback в migrations.test.ts**

В `src/migrations.test.ts` после теста `adds loans…` (после строки 194) добавьте:

```ts
  it('adds routeTemplates to a version 4 snapshot that predates route templates', () => {
    const { routeTemplates: _routeTemplates, ...withoutTemplates } = JSON.parse(JSON.stringify(emptyState())) as State & { routeTemplates?: unknown };
    expect((withoutTemplates as Record<string, unknown>).routeTemplates).toBeUndefined();
    const migrated = migrateState(withoutTemplates);
    expect(migrated.routeTemplates).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/migrations.test.ts`
Expected: FAIL — TS-ошибка при сборке типов (у `emptyState()` ещё нет `routeTemplates`, и `migrateState` не возвращает поле), либо `expected [] to equal undefined`-класса. Если тест проходит — значит поле уже есть, не добавляйте его повторно.

- [ ] **Step 3: Добавить типы в src/types.ts**

После интерфейса `LoanRow` (строка 84) добавьте:

```ts
export interface RouteTemplateStage {
  operationId: string;
  rate?: number;
  executorKind?: ExecutorKind;
  employeeId?: string | null;
  supplierId?: string | null;
}
export interface RouteTemplate {
  id: string;
  name: string;
  kind: OrderLineKind;
  active: boolean;
  stages: RouteTemplateStage[];
}
```

В `State` (строка 110) после `loans: LoanRow[];` добавьте `routeTemplates: RouteTemplate[];`.

В union `Command` после `loan.repay` (строка 179) добавьте:

```ts
  | { type: 'routeTemplate.create'; name: string; kind: OrderLineKind; stages: RouteTemplateStage[] }
  | { type: 'routeTemplate.update'; templateId: string; name: string; kind: OrderLineKind; stages: RouteTemplateStage[]; active: boolean }
```

- [ ] **Step 4: fallback в src/migrations.ts**

В импорт типов (строки 1-3) добавьте `RouteTemplate` (между `Purchase,` и `Shipment,`). В возвращаемом объекте после `loans: Array.isArray(source.loans) ? source.loans : [],` (строка 135) добавьте:

```ts
    routeTemplates: Array.isArray(source.routeTemplates) ? source.routeTemplates as RouteTemplate[] : [],
```

- [ ] **Step 5: пустая коллекция в src/domain.ts**

В `emptyState()` (строка 435) измените строку на:

```ts
    shipments: [], audit: [], salaryPlans: [], expensePlans: [], loans: [], routeTemplates: [], workerDeductions: [],
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/migrations.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify types**

Run: `npx tsc -b --pretty false`
Expected: exit 0 (пусто). При ошибке — поправьте и перезапустите.

---

### Task 2: Домен — валидация шаблона и команды CRUD

**Files:**
- Modify: `src/domain.ts:8-13,245,1364`
- Test: `src/domain.test.ts`

**Interfaces:**
- Consumes: типы из T1; хелперы `find`, `check`, `money`, `named`, `orderLineKind`, `unique` (уже в domain.ts).
- Produces: локальные `routeTemplateStage(state, input)` и `routeTemplateValues(state, input, exclude?)` (не экспортируются); мутирующие case `routeTemplate.create`/`routeTemplate.update`. Поведение по валидации обязано совпасть с SQL из T6.

**Ruling (спец. §4.1 vs §2.5/§3.3):** этап-работник с пустым `employeeId` **разрешён** — исполнитель автоподставляется при применении (`applyTemplate`, T3). Этап-подрядчик (`executorKind='supplier'`) **требует** `supplierId`. Два исполнителя (заданы и `employeeId`, и `supplierId`) отклоняются. Пустой `executorKind` = `'employee'`.

- [ ] **Step 1: RED — тесты домена**

В `src/domain.test.ts` (fixture уже содержит `operationId`=Cut/`employeeIds:[employee0]`, `otherOperationId`=Assemble/`[employee1]`, `supplierId`, `employeeId`, `otherEmployeeId`, `worker`/`otherWorker`) добавьте новый `describe`:

```ts
describe('route templates', () => {
  it('creates an active template and defaults executorKind to employee', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId, rate: 5 }] });
    expect(state.routeTemplates).toHaveLength(1);
    expect(state.routeTemplates[0]).toMatchObject({ name: 'Paint', kind: 'service', active: true });
    expect(state.routeTemplates[0].stages).toEqual([{ operationId: f.operationId, executorKind: 'employee', rate: 5 }]);
  });

  it('keeps an explicit employee executor and no supplier', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId }] });
    expect(state.routeTemplates[0].stages[0].employeeId).toBe(f.employeeId);
    expect(state.routeTemplates[0].stages[0].supplierId).toBeUndefined();
  });

  it('keeps an explicit supplier executor', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Coat', kind: 'service', stages: [{ operationId: f.operationId, executorKind: 'supplier', supplierId: f.supplierId }] });
    expect(state.routeTemplates[0].stages[0].supplierId).toBe(f.supplierId);
  });

  it('rejects a duplicate name case-insensitively', () => {
    const f = fixture();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId }] });
    atomic(state, { type: 'routeTemplate.create', name: 'paint', kind: 'service', stages: [{ operationId: f.operationId }] });
  });

  it('rejects an empty stage list', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Empty', kind: 'service', stages: [] });
  });

  it('rejects an unknown or inactive operation', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: 'missing' }] });
    const inactive = run(f.state, { type: 'operation.update', operationId: f.operationId, name: 'Cut', unit: 'piece', salePrice: 2, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [f.employeeId], active: false, autoAccept: false });
    atomic(inactive, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId }] });
  });

  it('rejects a negative rate override', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, rate: -1 }] });
  });

  it('rejects an unauthorized or inactive employee', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.otherEmployeeId }] });
    const inactive = run(f.state, { type: 'employee.update', employeeId: f.employeeId, name: 'Cutter', active: false });
    atomic(inactive, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId }] });
  });

  it('rejects a supplier stage without a supplier and two executors at once', () => {
    const f = fixture();
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, executorKind: 'supplier' }] });
    atomic(f.state, { type: 'routeTemplate.create', name: 'Bad', kind: 'service', stages: [{ operationId: f.operationId, employeeId: f.employeeId, supplierId: f.supplierId }] });
  });

  it('updates a template and toggles active without hard delete', () => {
    const f = fixture();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'Paint', kind: 'service', stages: [{ operationId: f.operationId }] });
    const id = state.routeTemplates[0].id;
    state = run(state, { type: 'routeTemplate.update', templateId: id, name: 'Paint v2', kind: 'service', stages: [{ operationId: f.otherOperationId }], active: false });
    expect(state.routeTemplates).toHaveLength(1);
    expect(state.routeTemplates[0]).toMatchObject({ id, name: 'Paint v2', active: false });
    expect(state.routeTemplates[0].stages[0].operationId).toBe(f.otherOperationId);
  });

  it('rejects an update that collides with another template name', () => {
    const f = fixture();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'A', kind: 'service', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'B', kind: 'service', stages: [{ operationId: f.operationId }] });
    atomic(state, { type: 'routeTemplate.update', templateId: state.routeTemplates[0].id, name: 'B', kind: 'service', stages: [{ operationId: f.operationId }], active: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain.test.ts`
Expected: FAIL — `routeTemplate.create` отсутствует (switch не обрабатывает тип), тесты выбрасывают. Убедитесь, что падает именно по причине отсутствия команды, а не по опечатке.

- [ ] **Step 3: Хелперы валидации**

В импорт типов (строки 8-13) добавьте `RouteTemplate, RouteTemplateStage,` между `RouteLine,` и `SeriesInput,`. После `routeValues` (после строки 245) добавьте:

```ts
function routeTemplateStage(state: State, input: RouteTemplateStage): RouteTemplateStage {
  const operation = find(state.operations, input.operationId, 'Operation');
  check(operation.active, 'Operation is inactive');
  const executorKind = input.executorKind ?? 'employee';
  check(executorKind === 'employee' || executorKind === 'supplier', 'Invalid executor kind');
  const stage: RouteTemplateStage = { operationId: operation.id, executorKind };
  if (input.rate !== undefined) stage.rate = money(input.rate);
  if (executorKind === 'employee') {
    check(input.supplierId === undefined || input.supplierId === null, 'Employee stage requires no supplier');
    if (input.employeeId !== undefined && input.employeeId !== null) {
      const employee = find(state.employees, input.employeeId, 'Employee');
      check(employee.active, 'Employee is inactive');
      check(operation.employeeIds.includes(employee.id), 'Employee is not authorized for this operation');
      stage.employeeId = employee.id;
    }
  } else {
    check(input.employeeId === undefined || input.employeeId === null, 'Supplier stage requires no employee');
    check(input.supplierId !== undefined && input.supplierId !== null, 'Supplier stage requires a supplier');
    const supplier = find(state.suppliers, input.supplierId, 'Supplier');
    stage.supplierId = supplier.id;
  }
  return stage;
}

function routeTemplateValues(state: State, input: { name: string; kind: OrderLineKind; stages: RouteTemplateStage[] }, exclude = ''): Omit<RouteTemplate, 'id' | 'active'> {
  const name = named(state.routeTemplates.filter(row => row.id !== exclude), input.name);
  const kind = orderLineKind(input.kind);
  check(input.stages.length > 0, 'Template requires at least one stage');
  return { name, kind, stages: input.stages.map(stage => routeTemplateStage(state, stage)) };
}
```

- [ ] **Step 4: case в mutate**

После `case 'loan.repay'` (строка 1364) добавьте:

```ts
    case 'routeTemplate.create': {
      const row = { id: uuid(), ...routeTemplateValues(state, command), active: true };
      state.routeTemplates.push(row);
      return row.id;
    }
    case 'routeTemplate.update': {
      const row = find(state.routeTemplates, command.templateId, 'Route template');
      check(typeof command.active === 'boolean', 'Invalid active flag');
      const values = routeTemplateValues(state, command, row.id);
      row.name = values.name;
      row.kind = values.kind;
      row.stages = values.stages;
      row.active = command.active;
      return row.id;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS (все новые 11 тестов зелёные, остальные не сломаны).

- [ ] **Step 6: Verify types and full suite**

Run: `npx tsc -b --pretty false` затем `npm test`
Expected: exit 0 оба.

---

### Task 3: Хелпер применения в слое редактора

**Files:**
- Modify: `src/order-editor.ts:4,150-171`
- Test: `src/order-editor.test.ts`

**Interfaces:**
- Consumes: `RouteTemplate`, `RouteTemplateStage`, `PositionStage` (уже в файле); `State.operations/employees/routeTemplates`.
- Produces: `applicableTemplates(state, kind): RouteTemplate[]` (экспорт) и `applyTemplate(state, template, qty): PositionStage[]` (экспорт). Локальный `resolveTemplateEmployee` не экспортируется.

- [ ] **Step 1: RED — тесты редактора**

В `src/order-editor.test.ts` добавьте `applicableTemplates, applyTemplate,` в импорт из `'./order-editor'` (строки 5-18) и новый `describe`:

```ts
describe('route templates in the editor', () => {
  it('filters applicable templates by kind and active', () => {
    const f = base();
    let state = run(f.state, { type: 'routeTemplate.create', name: 'Service tpl', kind: 'service', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Product tpl', kind: 'product', stages: [{ operationId: f.operationId }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Hidden tpl', kind: 'service', stages: [{ operationId: f.operationId }] });
    const hidden = state.routeTemplates.find(t => t.name === 'Hidden tpl')!;
    state = run(state, { type: 'routeTemplate.update', templateId: hidden.id, name: hidden.name, kind: hidden.kind, stages: hidden.stages, active: false });
    expect(applicableTemplates(state, 'service').map(t => t.name)).toEqual(['Service tpl']);
  });

  it('applies a template with fallback rate, sale price and auto-resolved worker', () => {
    const f = base();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Cut only', kind: 'product', stages: [{ operationId: f.operationId }] });
    const stages = applyTemplate(state, state.routeTemplates[0], 4);
    expect(stages).toEqual([{ operationId: f.operationId, executorKind: 'employee', employeeId: f.employeeId, supplierId: null, rate: 2, salePrice: 5, qty: 4, locked: false, completed: 0 }]);
  });

  it('honors an explicit employee and a rate override', () => {
    const f = base();
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Cut rate', kind: 'product', stages: [{ operationId: f.operationId, employeeId: f.employeeId, rate: 9 }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 1);
    expect(stage.rate).toBe(9);
    expect(stage.employeeId).toBe(f.employeeId);
  });

  it('maps a supplier stage to supplierId with no employee and rate fallback', () => {
    const f = base();
    const supplierId = f.state.suppliers[0].id;
    const state = run(f.state, { type: 'routeTemplate.create', name: 'Outsource cut', kind: 'product', stages: [{ operationId: f.operationId, executorKind: 'supplier', supplierId }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 2);
    expect(stage.executorKind).toBe('supplier');
    expect(stage.supplierId).toBe(supplierId);
    expect(stage.employeeId).toBeNull();
    expect(stage.rate).toBe(2);
  });

  it('leaves the worker empty when more than one active authorized worker', () => {
    const f = base();
    let state = run(f.state, { type: 'operation.create', name: 'Both', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [f.employeeId, f.otherEmployeeId], active: true, autoAccept: false });
    const bothOp = state.operations.at(-1)!.id;
    state = run(state, { type: 'routeTemplate.create', name: 'Ambiguous', kind: 'product', stages: [{ operationId: bothOp }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 3);
    expect(stage.employeeId).toBeNull();
  });

  it('leaves the worker empty when the operation authorizes no one', () => {
    const f = base();
    let state = run(f.state, { type: 'operation.create', name: 'Machine only', unit: 'piece', salePrice: 1, workerRate: 1, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: false });
    const opId = state.operations.at(-1)!.id;
    state = run(state, { type: 'routeTemplate.create', name: 'None', kind: 'product', stages: [{ operationId: opId }] });
    const [stage] = applyTemplate(state, state.routeTemplates[0], 3);
    expect(stage.employeeId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/order-editor.test.ts`
Expected: FAIL — `applicableTemplates`/`applyTemplate` не экспортированы.

- [ ] **Step 3: Реализация**

В импорт типов `src/order-editor.ts:4` добавьте `RouteTemplate, RouteTemplateStage,`. После `positionIssue` (после строки 170) добавьте:

```ts
export function applicableTemplates(state: State, kind: OrderLineKind): RouteTemplate[] {
  return state.routeTemplates.filter(template => template.active && template.kind === kind);
}

function resolveTemplateEmployee(state: State, stage: RouteTemplateStage): string | null {
  if (stage.employeeId) return stage.employeeId;
  const operation = state.operations.find(row => row.id === stage.operationId);
  if (!operation) return null;
  const active = state.employees.filter(employee => employee.active && operation.employeeIds.includes(employee.id));
  return active.length === 1 ? active[0].id : null;
}

export function applyTemplate(state: State, template: RouteTemplate, qty: number): PositionStage[] {
  return template.stages.map(stage => {
    const operation = state.operations.find(row => row.id === stage.operationId);
    if (!operation) throw new Error('Operation not found');
    const executorKind = stage.executorKind ?? 'employee';
    return {
      operationId: operation.id,
      executorKind,
      employeeId: executorKind === 'employee' ? resolveTemplateEmployee(state, stage) : null,
      supplierId: executorKind === 'supplier' ? stage.supplierId ?? null : null,
      rate: stage.rate ?? operation.workerRate,
      salePrice: operation.salePrice,
      qty,
      locked: false,
      completed: 0,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/order-editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify types**

Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 4: Справочник «Marshrut shablonlari»

**Files:**
- Create: `src/components/RouteTemplates.tsx`
- Modify: `src/App.tsx:14,595`
- Test: `src/route-templates-ui.test.tsx` (создать; туда же пойдёт UI-тест T5)

**Interfaces:**
- Consumes: `Command`, `RouteTemplate`, `RouteTemplateStage`, `ExecutorKind`, `OrderLineKind`, `State`; UI-примитивы `Dialog, Empty, Field, Section` из `'../ui'`; иконки `lucide-react`.
- Produces: компонент `RouteTemplates({ state, busy, run })` (named export). Команды `routeTemplate.create`/`routeTemplate.update` строятся в `save`/`toggle`.

- [ ] **Step 1: Создать компонент**

Создайте `src/components/RouteTemplates.tsx`:

```tsx
import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { Dialog, Empty, Field, Section } from '../ui';
import type { Command, ExecutorKind, OrderLineKind, RouteTemplate, RouteTemplateStage, State } from '../types';

interface StageDraft {
  operationId: string;
  rate: number | null;
  executorKind: ExecutorKind;
  employeeId: string;
  supplierId: string;
}
interface TemplateDraft {
  id: string | null;
  name: string;
  kind: OrderLineKind;
  active: boolean;
  stages: StageDraft[];
}

const blankStage = (state: State): StageDraft => ({
  operationId: state.operations[0]?.id ?? '', rate: null, executorKind: 'employee', employeeId: '', supplierId: '',
});
const blankTemplate = (state: State): TemplateDraft => ({
  id: null, name: '', kind: 'service', active: true, stages: [blankStage(state)],
});
const templateDraft = (template: RouteTemplate): TemplateDraft => ({
  id: template.id, name: template.name, kind: template.kind, active: template.active,
  stages: template.stages.map(stage => ({
    operationId: stage.operationId,
    rate: stage.rate ?? null,
    executorKind: stage.executorKind ?? 'employee',
    employeeId: stage.employeeId ?? '',
    supplierId: stage.supplierId ?? '',
  })),
});

export function RouteTemplates({ state, busy, run }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const setStage = (index: number, changes: Partial<StageDraft>) => setDraft(draft
    ? { ...draft, stages: draft.stages.map((row, i) => i === index ? { ...row, ...changes } : row) }
    : draft);

  const save = async () => {
    if (!draft) return;
    const stages: RouteTemplateStage[] = draft.stages.map(stage => {
      const row: RouteTemplateStage = { operationId: stage.operationId, executorKind: stage.executorKind };
      if (stage.rate !== null) row.rate = stage.rate;
      if (stage.executorKind === 'employee') row.employeeId = stage.employeeId || null;
      else row.supplierId = stage.supplierId || null;
      return row;
    });
    const command: Command = draft.id
      ? { type: 'routeTemplate.update', templateId: draft.id, name: draft.name, kind: draft.kind, stages, active: draft.active }
      : { type: 'routeTemplate.create', name: draft.name, kind: draft.kind, stages };
    if (await run(command)) setDraft(null);
  };

  const toggle = async (template: RouteTemplate) => {
    const command: Command = { type: 'routeTemplate.update', templateId: template.id, name: template.name, kind: template.kind, stages: template.stages, active: !template.active };
    await run(command);
  };

  return <>
    <Section
      title="Marshrut shablonlari"
      hint="«Xizmat» (masalan, bo‘yash) va «Pod klyuch» zanjirlari. Buyurtma pozitsiyasiga bir amalda qo‘llanadi — stavka, mijoz narxi va ijrochi avtomat to‘ldiriladi."
      action={<button className="secondary small" onClick={() => setDraft(blankTemplate(state))}><Plus size={14} />Yangi shablon</button>}
    >
      <div className="catalog-machines">{state.routeTemplates.map(template => <article className="catalog-machine" key={template.id}>
        <header><b>{template.name}</b><span className={`task-status ${template.active ? 'completed' : 'rejected'}`}>{template.active ? 'Faol' : 'O‘chirilgan'}</span></header>
        <strong>{template.kind === 'service' ? 'Xizmat' : 'Mahsulot'}<small>{template.stages.length} bosqich</small></strong>
        <label className="check-field"><input type="checkbox" checked={template.active} disabled={busy} onChange={() => void toggle(template)} />Faol</label>
        <button className="text-button" onClick={() => setDraft(templateDraft(template))}><Pencil size={14} />Tahrirlash</button>
      </article>)}</div>
      {!state.routeTemplates.length && <Empty text="Buyurtmada tez to‘ldirish uchun marshrut shablonini qo‘shing." />}
    </Section>

    {draft && <Dialog title={draft.id ? 'Shablonni tahrirlash' : 'Yangi shablon'} subtitle="Bosqichlar tartibi buyurtmadagi marshrutga o‘tadi." close={() => { if (!busy) setDraft(null); }}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="form-body">
          <Field label="Shablon nomi"><input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={120} autoFocus /></Field>
          <Field label="Shablon turi"><select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as OrderLineKind })}><option value="service">Xizmat</option><option value="product">Mahsulot</option></select></Field>
          {draft.stages.map((stage, index) => <div className="editor-line route-editor" key={index}>
            <span className="route-index">{index + 1}</span>
            <select aria-label={`Shablon bosqich operatsiyasi ${index + 1}`} required value={stage.operationId} onChange={event => setStage(index, { operationId: event.target.value })}>
              <option value="">Bosqichni tanlang</option>{state.operations.map(op => <option key={op.id} value={op.id}>{op.name}</option>)}
            </select>
            <div className="route-executor">
              <select aria-label={`Shablon bosqich ijrochi turi ${index + 1}`} value={stage.executorKind} onChange={event => setStage(index, event.target.value === 'supplier'
                ? { executorKind: 'supplier', employeeId: '', supplierId: state.suppliers[0]?.id ?? '' }
                : { executorKind: 'employee', supplierId: '', employeeId: state.employees.find(emp => emp.active)?.id ?? '' })}>
                <option value="employee">Xodim</option>
                <option value="supplier">Pudratchi</option>
              </select>
              {stage.executorKind === 'employee'
                ? <select aria-label={`Shablon bosqich ijrochisi ${index + 1}`} value={stage.employeeId} onChange={event => setStage(index, { employeeId: event.target.value })}>
                  <option value="">Avtomatik tanlanadi</option>
                  {state.employees.filter(emp => emp.active).map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
                : <select aria-label={`Shablon bosqich pudratchisi ${index + 1}`} required value={stage.supplierId} onChange={event => setStage(index, { supplierId: event.target.value })}>
                  <option value="">Pudratchini tanlang</option>
                  {state.suppliers.map(sup => <option key={sup.id} value={sup.id}>{sup.name}</option>)}
                </select>}
            </div>
            <input aria-label={`Shablon bosqich stavkasi ${index + 1}`} type="number" min="0" step="0.01" placeholder="Avtomatik" value={stage.rate ?? ''} onChange={event => setStage(index, { rate: event.target.value === '' ? null : Number(event.target.value) })} />
            <button type="button" className="icon-button" aria-label={`Shablon bosqichini olib tashlash ${index + 1}`} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, i) => i !== index) })}><X size={16} /></button>
          </div>)}
          <button type="button" className="secondary small" onClick={() => setDraft({ ...draft, stages: [...draft.stages, blankStage(state)] })}><Plus size={14} />Bosqich</button>
          {draft.id && <label className="check-field"><input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />Shablon faol</label>}
        </div>
        <footer className="form-footer">
          <button type="button" className="secondary" onClick={() => setDraft(null)} disabled={busy}>Bekor qilish</button>
          <button className="primary" disabled={busy}>{draft.id ? 'Shablonni saqlash' : 'Shablon yaratish'}</button>
        </footer>
      </form>
    </Dialog>}
  </>;
}
```

- [ ] **Step 2: Подключить в App.tsx**

Добавьте импорт после `import { OrderEditor }` (строка 16):

```tsx
import { RouteTemplates } from './components/RouteTemplates';
```

Замените строку 595 (mount `CatalogSettings`) на:

```tsx
      {panel === 'malumotnoma' && <div className="dashboard-grid"><CatalogSettings state={state} busy={busy} run={run} onAddEmployee={() => show('employee')} onEditEmployee={id => show('employeeEdit', id)} /><RouteTemplates state={state} busy={busy} run={run} /></div>}
```

- [ ] **Step 3: RED — UI-тест справочника**

Создайте `src/route-templates-ui.test.tsx`:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { createDemo } from './seed';
import { RouteTemplates } from './components/RouteTemplates';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: emptyState().companyId };
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, admin);

describe('route templates catalog', () => {
  it('renders name, kind and stage count', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov xizmati', kind: 'service', stages: [{ operationId: state.operations[3].id }, { operationId: state.operations[4].id }] });
    const html = renderToStaticMarkup(createElement(RouteTemplates, { state, busy: false, run: async () => true }));
    expect(html).toContain('Marshrut shablonlari');
    expect(html).toContain('Yangi shablon');
    expect(html).toContain('Sinov xizmati');
    expect(html).toContain('Xizmat');
    expect(html).toContain('2 bosqich');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/route-templates-ui.test.tsx`
Expected: FAIL — модуль `./components/RouteTemplates` не существует. (Если вы уже создали файл в Step 1, тест упадёт по другой причине — проверьте, что `createDemo` без шаблонов и компонент рендерит только пустой список; всё равно убедитесь, что он падает до Step 1, иначе RED не доказан.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/route-templates-ui.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify types**

Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 5: Кнопка «Shablon» в редакторе заказа

**Files:**
- Modify: `src/components/OrderEditor.tsx:5-19,115-163`
- Test: `src/route-templates-ui.test.tsx` (добавить тест)

**Interfaces:**
- Consumes: `applicableTemplates`, `applyTemplate` из `../order-editor`; `position.kind`, `position.qty`, `onChange`.
- Produces: `<select aria-label="Shablon">` в шапке секции маршрута `PositionForm`; при выборе — `onChange({ route: applyTemplate(...) })` с подтверждением при непустом маршруте.

- [ ] **Step 1: Реализация**

В импорт из `'../order-editor'` (строки 5-19) добавьте `applicableTemplates, applyTemplate,` (алфавитно в начале списка). Внутри `PositionForm` перед `return` (после `moveStage`, строки 124-130) добавьте:

```tsx
  const applyShablon = (templateId: string) => {
    const template = state.routeTemplates.find(row => row.id === templateId);
    if (!template) return;
    if (position.route.length && !window.confirm('Joriy marshrut shablon marshrutiga almashtiriladi. Davom etasizmi?')) return;
    onChange({ route: applyTemplate(state, template, position.qty) });
  };
```

Замените шапку секции маршрута (строки 160-163) на:

```tsx
    <div className="form-section-title">
      <div><h3>Ishlab chiqarish marshrut</h3><small>Har bosqichda hajm alohida. Narx — operatsiya (stanok) bahosi: summa = narx × miqdor. Ijrochi stavkasi × miqdor to‘lanadi.</small></div>
      <div className="button-group">
        {applicableTemplates(state, position.kind).length > 0 && <select aria-label="Shablon" value="" onChange={event => { if (event.target.value) applyShablon(event.target.value); }}><option value="">Shablon…</option>{applicableTemplates(state, position.kind).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select>}
        <button type="button" className="secondary small" onClick={() => onChange({ route: [...position.route, { operationId: '', executorKind: 'employee', employeeId: state.employees[0]?.id || null, supplierId: null, rate: 0, salePrice: 0, qty: position.qty, locked: false, completed: 0 }] })}><Plus size={14} />Bosqich</button>
      </div>
    </div>
```

- [ ] **Step 2: RED — UI-тест фильтра по типу позиции**

Добавьте в `src/route-templates-ui.test.tsx` (в конец файла):

```tsx
import { OrderEditor } from './components/OrderEditor';
import type { Order } from './types';

const editorHtml = (state: State, orderId: string) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders.find(row => row.id === orderId)!, busy: false,
  close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

describe('order editor templates', () => {
  it('offers only templates matching the position kind', () => {
    let state = createDemo(admin);
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov xizmat', kind: 'service', stages: [{ operationId: state.operations[3].id }] });
    state = run(state, { type: 'routeTemplate.create', name: 'Sinov mahsulot', kind: 'product', stages: [{ operationId: state.operations[0].id }] });
    const order = state.orders.find(row => row.title === 'Mijozning 8 fasadini bo‘yash') as Order;
    const html = editorHtml(state, order.id);
    expect(html).toContain('Sinov xizmat');
    expect(html).not.toContain('Sinov mahsulot');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/route-templates-ui.test.tsx`
Expected: FAIL — `Sinov xizmat` не рендерится (select ещё отсутствует).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/route-templates-ui.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify types and full suite**

Run: `npx tsc -b --pretty false` затем `npm test`
Expected: exit 0 оба.

---

### Task 6: Сервер — schema.sql, генератор миграции, PGlite-зонд

**Files:**
- Modify: `supabase/schema.sql:350,589,1516,1698,2610,2870`
- Create: `.validation-pglite-20261029/generate-route-templates-migration.mjs`
- Create: `supabase/migrations/20261110_route_templates.sql` (генерируется)
- Create: `.validation-pglite-20261029/validate-route-templates.mjs`

**Interfaces:**
- Consumes: SQL-хелперы `erp_uuid`, `erp_text`, `erp_money`, `erp_bool`, `erp_array`; таблицы `erp_operations` (`active`, `employee_ids uuid[]`), `erp_employees`, `erp_suppliers`.
- Produces: таблица `erp_route_templates`, функция `erp_route_template_stage(uuid, jsonb)` (SECURITY DEFINER, REVOKE-only), `erp_snapshot` с ключом `routeTemplates`, ветки `routeTemplate.create/update` в `erp_execute`. Валидация обязана совпасть с доменом T2.

- [ ] **Step 1: Таблица в schema.sql**

После блока `erp_loans` (после строки 350) добавьте:

```sql
CREATE TABLE public.erp_route_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('product', 'service')),
  active boolean NOT NULL DEFAULT true,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id)
);
CREATE INDEX erp_route_templates_company_idx ON public.erp_route_templates(company_id);
CREATE UNIQUE INDEX erp_route_templates_name_idx ON public.erp_route_templates(company_id, lower(btrim(name)));
```

В RLS-массиве (строка 589) после `'erp_loans',` добавьте `'erp_route_templates',`.

- [ ] **Step 2: Хелпер канонизации этапа в schema.sql**

После `erp_norms` (после строки 866) добавьте:

```sql
CREATE FUNCTION public.erp_route_template_stage(p_company_id uuid, p_stage jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_operation public.erp_operations%ROWTYPE;
  v_kind text;
  v_rate numeric;
  v_employee_id uuid;
  v_supplier_id uuid;
BEGIN
  IF p_stage IS NULL OR jsonb_typeof(p_stage) <> 'object' THEN
    RAISE EXCEPTION 'stage must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_operation FROM public.erp_operations
    WHERE company_id = p_company_id AND id = public.erp_uuid(p_stage -> 'operationId', 'operationId');
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
  IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '22023'; END IF;
  v_kind := coalesce(p_stage ->> 'executorKind', 'employee');
  IF v_kind NOT IN ('employee', 'supplier') THEN RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023'; END IF;
  IF p_stage ? 'employeeId' AND p_stage -> 'employeeId' <> 'null'::jsonb THEN
    v_employee_id := public.erp_uuid(p_stage -> 'employeeId', 'employeeId');
  END IF;
  IF p_stage ? 'supplierId' AND p_stage -> 'supplierId' <> 'null'::jsonb THEN
    v_supplier_id := public.erp_uuid(p_stage -> 'supplierId', 'supplierId');
  END IF;
  IF v_kind = 'employee' THEN
    IF v_supplier_id IS NOT NULL THEN RAISE EXCEPTION 'Employee stage requires no supplier' USING ERRCODE = '22023'; END IF;
    IF v_employee_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee_id AND active) THEN
        RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee_id = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSE
    IF v_employee_id IS NOT NULL THEN RAISE EXCEPTION 'Supplier stage requires no employee' USING ERRCODE = '22023'; END IF;
    IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'Supplier stage requires a supplier' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier_id) THEN
      RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'operationId', v_operation.id::text,
    'executorKind', v_kind,
    'rate', CASE WHEN p_stage ? 'rate' THEN public.erp_money(p_stage -> 'rate', 'rate', true) END,
    'employeeId', CASE WHEN v_employee_id IS NOT NULL THEN v_employee_id::text END,
    'supplierId', CASE WHEN v_supplier_id IS NOT NULL THEN v_supplier_id::text END
  ));
END;
$$;
```

- [ ] **Step 3: Снимок в schema.sql**

После записи `'loans', …` (после строки 1516) добавьте:

```sql
      'routeTemplates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind,
        'active', t.active, 'stages', t.stages) ORDER BY t.created_at, t.id), '[]'::jsonb)
        FROM public.erp_route_templates t WHERE t.company_id = v_company AND v_admin),
```

- [ ] **Step 4: Ветки erp_execute в schema.sql**

В блоке `DECLARE` (после строки 1698, рядом с `v_active boolean;`) добавьте `v_stages jsonb;`.

После `WHEN 'loan.repay' THEN …` (после строки 2610) добавьте:

```sql
    WHEN 'routeTemplate.create' THEN
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_route_templates(company_id, id, name, kind, active, stages)
        VALUES (v_company, v_entity, v_title, v_kind, true, v_lines);
    WHEN 'routeTemplate.update' THEN
      v_entity := public.erp_uuid(p_command -> 'templateId', 'templateId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_route_templates WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Route template not found' USING ERRCODE = '22023';
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_active := public.erp_bool(p_command -> 'active');
      UPDATE public.erp_route_templates
        SET name = v_title, kind = v_kind, active = v_active, stages = v_lines
        WHERE company_id = v_company AND id = v_entity;
```

В хвостовом `REVOKE ALL ON FUNCTION` (строка 2870, в тот же список) добавьте `public.erp_route_template_stage(uuid, jsonb),`. Список `GRANT` (2879-2881) не меняется.

- [ ] **Step 5: Генератор миграции**

Создайте `.validation-pglite-20261029/generate-route-templates-migration.mjs` (клон `generate-operation-norms-migration.mjs`):

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261110_route_templates.sql', root);

const names = ['erp_route_template_stage', 'erp_snapshot', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}
require('CREATE TABLE public.erp_route_templates', 'erp_route_templates table');
require("'routeTemplates', (SELECT", 'snapshot routeTemplates');
require("WHEN 'routeTemplate.create' THEN", 'execute routeTemplate.create');
require('public.erp_route_template_stage(v_company', 'execute stage canonicalization');

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

const ddl = `-- Aliya ERP: route templates — «xizmat» vs «pod klyuch» stage chains applied in the order editor.
-- Safe to run more than once. Existing data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_route_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('product', 'service')),
  active boolean NOT NULL DEFAULT true,
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id)
);
CREATE INDEX IF NOT EXISTS erp_route_templates_company_idx ON public.erp_route_templates(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS erp_route_templates_name_idx ON public.erp_route_templates(company_id, lower(btrim(name)));
ALTER TABLE public.erp_route_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_route_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_route_templates TO authenticated;
DROP POLICY IF EXISTS erp_admin_read ON public.erp_route_templates;
CREATE POLICY erp_admin_read ON public.erp_route_templates FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_route_template_stage(uuid, jsonb) FROM PUBLIC, anon, authenticated;
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

- [ ] **Step 6: Сгенерировать миграцию**

Run: `node .validation-pglite-20261029/generate-route-templates-migration.mjs`
Expected: выводится `{"functions":3,"sha256":"…"}` и создаётся `supabase/migrations/20261110_route_templates.sql`.

- [ ] **Step 7: PGlite-зонд**

Создайте `.validation-pglite-20261029/validate-route-templates.mjs` (клон `validate-operation-norms.mjs`):

```js
// Route templates probe: CRUD, snapshot round-trip, stage canonicalization, admin-only
// management, tenant isolation, and validation parity with the domain.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261110_route_templates.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

const db = new PGlite();
const adminId = crypto.randomUUID();
const workerId = crypto.randomUUID();
const otherAdminId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
for (const [id, name] of [[adminId, 'Owner'], [workerId, 'Worker'], [otherAdminId, 'Other']]) {
  await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)',
    [id, `${name.toLowerCase()}@local.invalid`, JSON.stringify({ name })]);
}

await db.exec(schema);
await db.exec(migration);
await db.exec(migration);
pass('route-templates migration applies twice on top of the canonical schema (idempotent)');

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

await as(adminId);
const companyId = (await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Route templates'])).rows[0].id;
await db.exec('RESET ROLE');

await execute({ type: 'employee.create', name: 'Painter' });
await execute({ type: 'supplier.create', name: 'Contractor', phone: '' });
await execute({ type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 150000, workerRate: 50000,
  standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
const snap1 = (await snapshot(adminId)).state;
const employeeId = snap1.employees[0].id;
const supplierId = snap1.suppliers[0].id;
const paintOp = snap1.operations.find(o => o.name === 'Paint');
await execute({ type: 'operation.update', operationId: paintOp.id, name: 'Paint', unit: 'squareMeter',
  salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });

await execute({ type: 'routeTemplate.create', name: 'Paint service', kind: 'service',
  stages: [{ operationId: paintOp.id, executorKind: 'employee', employeeId }] });
const created = (await snapshot(adminId)).state.routeTemplates;
assert.equal(created.length, 1);
assert.equal(created[0].name, 'Paint service');
assert.equal(created[0].kind, 'service');
assert.equal(created[0].active, true);
assert.deepEqual(created[0].stages, [{ operationId: paintOp.id, executorKind: 'employee', employeeId }]);
pass('routeTemplate.create round-trips through the snapshot with canonicalized stages');

await execute({ type: 'routeTemplate.create', name: 'Outsourced coat', kind: 'service',
  stages: [{ operationId: paintOp.id, executorKind: 'supplier', supplierId, rate: 0 }] });
const outsourced = (await snapshot(adminId)).state.routeTemplates.find(t => t.name === 'Outsourced coat');
assert.deepEqual(outsourced.stages, [{ operationId: paintOp.id, executorKind: 'supplier', supplierId, rate: 0 }]);
pass('supplier stage keeps an explicit zero rate override');

const tpl = created[0];
await execute({ type: 'routeTemplate.update', templateId: tpl.id, name: 'Paint service v2', kind: 'service',
  stages: tpl.stages, active: false });
const updated = (await snapshot(adminId)).state.routeTemplates.find(t => t.id === tpl.id);
assert.equal(updated.name, 'Paint service v2');
assert.equal(updated.active, false);
pass('routeTemplate.update renames and deactivates');

async function rejects(command, label) {
  let threw = false;
  try { await execute(command); } catch { threw = true; }
  assert.ok(threw, label);
}
await rejects({ type: 'routeTemplate.create', name: 'Paint service v2', kind: 'service', stages: [{ operationId: paintOp.id }] }, 'duplicate name rejected');
await rejects({ type: 'routeTemplate.create', name: 'Empty', kind: 'service', stages: [] }, 'empty stages rejected');
await rejects({ type: 'routeTemplate.create', name: 'Bad kind', kind: 'weird', stages: [{ operationId: paintOp.id }] }, 'invalid kind rejected');
await rejects({ type: 'routeTemplate.create', name: 'Bad op', kind: 'service', stages: [{ operationId: crypto.randomUUID() }] }, 'unknown operation rejected');
await rejects({ type: 'routeTemplate.create', name: 'Two executors', kind: 'service', stages: [{ operationId: paintOp.id, executorKind: 'employee', employeeId, supplierId }] }, 'two executors rejected');
await rejects({ type: 'routeTemplate.create', name: 'No supplier', kind: 'service', stages: [{ operationId: paintOp.id, executorKind: 'supplier' }] }, 'supplier stage without supplier rejected');
pass('erp_execute rejects invalid templates like the domain');

await as(adminId);
await db.query('SELECT public.erp_link_worker($1,$2)', [workerId, employeeId]);
await db.exec('RESET ROLE');
let workerRejected = false;
try { await executeAs(workerId, { type: 'routeTemplate.create', name: 'Sneaky', kind: 'service', stages: [{ operationId: paintOp.id }] }); } catch { workerRejected = true; }
assert.ok(workerRejected, 'worker rejected from routeTemplate.create');
pass('worker role cannot manage route templates');

await as(otherAdminId);
const secondCompanyId = (await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Second'])).rows[0].id;
await db.exec('RESET ROLE');
assert.notEqual(secondCompanyId, companyId);
assert.deepEqual((await snapshot(otherAdminId)).state.routeTemplates, []);
pass('tenant isolation: a fresh company snapshot has no route templates');

console.log(`\n${passes} checks passed`);
```

- [ ] **Step 8: Запустить зонд**

Run: `node .validation-pglite-20261029/validate-route-templates.mjs`
Expected: выводится `PASS …` для каждого из 9 утверждений и `9 checks passed`; exit 0.

- [ ] **Step 9: Запустить существующий зонд норм (регрессия)**

Run: `node .validation-pglite-20261029/validate-operation-norms.mjs`
Expected: без изменений `… checks passed`; exit 0.

---

### Task 7: Демо-сид и финальная проверка

**Files:**
- Modify: `src/seed.ts:169`
- Test: `src/domain.test.ts` (добавить тест)

**Interfaces:**
- Consumes: `routeTemplate.create` (T2); операции `Jilolash`[3], `Bo‘yash`[4], `Kesish`[0], `Kromka`[1], `Yig‘ish va nazorat`[2]; работники `employees[0]`=Sex ustasi, `employees[1]`=Yig‘uvchi (оба активны).
- Produces: два демо-шаблона в `createDemo`.

- [ ] **Step 1: RED — тест сида**

В `src/domain.test.ts` (файл уже импортирует `createDemo`) добавьте в конец:

```ts
describe('route template demo seed', () => {
  it('seeds two templates: paint service and full kitchen', () => {
    const state = createDemo(admin);
    expect(state.routeTemplates.map(t => t.name)).toEqual(['Bo‘yash xizmati', 'Oshxona pod klyuch']);
    expect(state.routeTemplates[0]).toMatchObject({ kind: 'service', active: true });
    expect(state.routeTemplates[1]).toMatchObject({ kind: 'product', active: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain.test.ts`
Expected: FAIL — `state.routeTemplates` пуст.

- [ ] **Step 3: Сид в src/seed.ts**

Перед `return state;` (строка 169) добавьте:

```ts
  run({ type: 'routeTemplate.create', name: 'Bo‘yash xizmati', kind: 'service', stages: [
    { operationId: state.operations[3].id, employeeId: state.employees[1].id },
    { operationId: state.operations[4].id, employeeId: state.employees[1].id },
  ] });
  run({ type: 'routeTemplate.create', name: 'Oshxona pod klyuch', kind: 'product', stages: [
    { operationId: state.operations[0].id, employeeId: state.employees[0].id },
    { operationId: state.operations[1].id, employeeId: state.employees[0].id },
    { operationId: state.operations[2].id, employeeId: state.employees[1].id },
  ] });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Полная проверка**

Run: `npm test`, затем `npx tsc -b --pretty false`, затем `npm run build`, затем `node .validation-pglite-20261029/validate-route-templates.mjs` и `node .validation-pglite-20261029/validate-operation-norms.mjs`
Expected: все exit 0. UI-тесты (`route-templates-ui.test.tsx`, `outsource-ui.test.tsx`, `painting-ui.test.tsx`) зелёные.

- [ ] **Step 6: Браузерная проверка в демо**

Запустите `npm run dev` с **пустыми** `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (демо-режим, без записей в живую базу). Проверьте: в «Sozlamalar → Ma’lumotnoma» виден «Marshrut shablonlari» с двумя сид-шаблонами; в новом заказе-услуге кнопка «Shablon» предлагает «Bo‘yash xizmati», применение заполняет маршрут; при непустом маршруте запрашивается подтверждение; заказ сохраняется. Проверьте desktop и mobile (узкий вьюпорт).
Expected: этапы создаются, `positionIssue` не блокирует сохранение после применения.

---

## Self-Review

**Spec coverage:** §3.1 типы → T1; §3.2 команды → T1/T2; §3.3 applyTemplate → T3; §4.1 валидация → T2 (домен) + T6 (SQL); §4.2 паритет сохранения → существующие `routeValues` (не трогаем); §5.1 справочник → T4; §5.2 кнопка Shablon → T5; §6 Supabase/миграция/fallback → T6 + T1; §7 ошибки → тесты T2/T6; §8 проверка → тесты и зонды во всех задачах; §9 файлы → покрыто.

**Placeholder scan:** чисто — каждый шаг содержит конкретный код или команду.

**Type consistency:** `RouteTemplateStage`/`RouteTemplate` определён один раз (T1) и переиспользуется в T2-T7; `applyTemplate`/`applicableTemplates` экспортированы в T3 и импортируются в T5; `erp_route_template_stage(uuid, jsonb)` объявлен в T6 и вызывается в ветках `erp_execute`; ключ снимка `routeTemplates` совпадает с `State.routeTemplates`.
