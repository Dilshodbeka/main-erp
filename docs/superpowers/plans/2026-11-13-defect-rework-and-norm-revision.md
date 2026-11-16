# Брак, ручная приёмка и ревизия выдачи — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть edge cases #314/#315: ручная приёмка с частичным/полным браком и журналом брака (пакет P1), затем частичная выдача материалов и перенос норм при ревизии (пакет P2), сохраняя побайтовый паритет домена `src/domain.ts` и канонического `supabase/schema.sql`.

**Architecture:** P1 добавляет коллекцию `State.defects`, трёхвариантный `work.review` (`{accept:true}` / частичный брак / полный брак), журнал брака и UI-очередь приёмки. P2 заменяет булев `MaterialLine.issued` на числовой `issuedQty` с фасадом `isIssued(line)`, учит выдачу/резерв/возврат/себестоимость частичным количествам и применяет дельту норм ЛКМ при ревизии маршрута. Пакеты независимы: P1 выкатывается и живёт без P2.

**Tech Stack:** React 19, TypeScript strict, Vite 6, Vitest, PGlite, Postgres plpgsql (Supabase), Cloudflare Worker.

**Spec:** `docs/superpowers/specs/2026-11-13-defect-rework-and-norm-revision-design.md`

## Global Constraints

- Рабочая папка — **не Git-репозиторий**. Никаких `git`, веток и коммитов. Вместо коммитов после каждого шага: `npx tsc -b` и `npx vitest run <затронутые файлы>`; в конце пакета — полный `npx vitest run`, `npm run build` и PGlite-зонд.
- UI — узбекская латынь, деньги UZS. Отчёты владельцу — на русском.
- Живой SQL и деплой — **только по отдельному явному разрешению**. SQL владелец применяет сам через Supabase SQL Editor; проверочный SQL на живой базе — только одинарные кавычки (двойные кавычки дали `ERROR 42703` 2026-11-13). Деплой — `npm run deploy` (Worker `erp-tizim`).
- Порядок P1: сначала владелец применяет `supabase/migrations/20261115_defects.sql`, только после его «Success» деплоится фронтенд P1 — `verifiedSnapshot` (`src/sync.ts:25`) потребует массив `defects` в каждом снапшоте.
- P2: фронтенд и `supabase/migrations/20261116_material_issued_qty.sql` выкатываются вместе; порознь они несовместимы.
- Миграции генерируются только скриптами `.validation-pglite-20261029/generate-*.mjs` из канонического `supabase/schema.sql`; вручную файл миграции не редактируется. Зонд применяет `schema.sql` и миграцию дважды (идемпотентность).
- Компонентные тесты — только SSR: `renderToStaticMarkup(createElement(...))`. `fireEvent`, `userEvent`, jsdom запрещены.
- Округления: брак и деньги — 2 знака (`round` в `src/domain.ts:23`), количества норм ЛКМ — 3 знака (локальный `round3`). Сравнения количеств — через `exceeds` (`src/domain.ts:47`).
- Секреты только на сервере; никакие данные компаний и бэкапы не печатать.
- Не трогать Edge Functions, whitelist команд не меняется. Вне области: #313 (test-company cleanup), Telegram, чужие модули.

---

## Пакет P1 — брак, ручная приёмка, журнал

### Task 1: Типы, состояние и синхронизация брака

**Files:**
- Modify: `src/types.ts` (MaterialLine нет; добавляются `DefectReason`, `DefectMaterial`, `DefectRow`, `State.defects`, поля команды)
- Modify: `src/domain.ts` (`emptyState`, :481-487)
- Modify: `src/migrations.ts` (возврат состояния, :122-143)
- Modify: `src/sync.ts` (`arrays` в `verifiedSnapshot`, :25)
- Test: `src/migrations.test.ts`, `src/sync.test.ts`

**Interfaces:**
- Produces: `DefectReason = 'quality' | 'measurement' | 'drawing' | 'customer' | 'other'`; `DefectMaterial { itemId: string; qty: number }`; `DefectRow` (§3.1 спецификации); `State.defects: DefectRow[]`; `Command` вариант `{ type: 'work.review'; reportId: string; accept: boolean; defectQty?: number; reason?: DefectReason; note?: string }`.
- Потребляется задачами 2–9.

- [ ] **Step 1: Написать падающие тесты**

В конец `src/migrations.test.ts`:

```ts
describe('defects collection', () => {
  it('fills defects for snapshots saved before the defect journal', () => {
    const source = JSON.parse(JSON.stringify(emptyState())) as Record<string, unknown>;
    delete source.defects;
    expect(migrateState(source).defects).toEqual([]);
  });
});
```

В конец `src/sync.test.ts`:

```ts
describe('defects snapshot contract', () => {
  it('keeps the cached snapshot when the server omits defects', async () => {
    const f = setup(); f.online(true);
    const first = await f.engine().snapshot();
    expect(first.state.defects).toEqual([]);
    f.strip('defects');
    const after = await f.engine().snapshot();
    expect(after).toEqual(first);
  });

  it('leaves the command uncertain when the server confirms without defects', async () => {
    const f = setup(); f.online(true); f.strip('defects');
    const result = await f.engine().submit(f.server().state, receipt, actor);
    expect(result.queued).toBe(true);
    expect(f.cache().pending[0].status).toBe('uncertain');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts`
Expected: FAIL — `migrated.defects` равно `undefined`; в sync второй тест не получает `uncertain`.

- [ ] **Step 3: Добавить типы**

В `src/types.ts` после `WorkReport` (:63):

```ts
export type DefectReason = 'quality' | 'measurement' | 'drawing' | 'customer' | 'other';
export interface DefectMaterial { itemId: string; qty: number }
export interface DefectRow {
  id: string; reportId: string; orderId: string; lineId: string; taskId: string;
  employeeId: string; operationId: string; qty: number; reason: DefectReason;
  note: string; materials: DefectMaterial[]; createdAt: string;
}
```

В `State` рядом с `reports` добавить `defects: DefectRow[];`.

В `Command` заменить строку `work.review` (:205) на:

```ts
  | { type: 'work.review'; reportId: string; accept: boolean; defectQty?: number; reason?: DefectReason; note?: string }
```

- [ ] **Step 4: Провести состояние через домен, миграцию и синхронизацию**

`src/domain.ts`, `emptyState` (:481-487): после `reports: [],` поставить `defects: [],`.

`src/migrations.ts`: импортировать `DefectRow` и в возвращаемый объект после `tickets` добавить:

```ts
    defects: Array.isArray(source.defects) ? source.defects as DefectRow[] : [],
```

`src/sync.ts` (`verifiedSnapshot`, :25): в массив `arrays` добавить `'defects'` перед `'tickets'`.

- [ ] **Step 5: Исправить литералы `State` в тестах**

Run: `npx tsc -b`
Expected: ошибки о недостающем `defects` в литералах `State`. Добавить `defects: [],` в каждый такой литерал; известный адрес — `src/work-view.test.ts:126` (объект `state: State`).

- [ ] **Step 6: Зелёный прогон**

Run: `npx vitest run src/migrations.test.ts src/sync.test.ts && npx tsc -b`
Expected: PASS, exit 0.

---

### Task 2: `defectMaterials` — смета брака по нормам

**Files:**
- Modify: `src/domain.ts` (рядом с `areaMaterialCost`, :312)
- Test: `src/domain.test.ts`

**Interfaces:**
- Produces: `export function defectMaterials(state: State, task: RouteLine, qty: number): DefectMaterial[]` — только `unit === 'squareMeter'` и непустые `norms`; `qty` каждого материала `round3(norm.qtyPerM2 * qty)`; неизвестный `itemId` пропускается; движения склада не создаются.

- [ ] **Step 1: Написать падающие тесты**

В `src/domain.test.ts` расширить импорт из `./domain` (`defectMaterials`) и добавить блок:

```ts
describe('defect materials', () => {
  it('expands square-metre norms for the rejected quantity', () => {
    const f = production();
    f.state.operations[0].unit = 'squareMeter';
    f.state.operations[0].norms = [
      { itemId: f.itemId, qtyPerM2: 0.25 },
      { itemId: f.otherItemId, qtyPerM2: 0.1 },
    ];
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 3)).toEqual([
      { itemId: f.itemId, qty: 0.75 },
      { itemId: f.otherItemId, qty: 0.3 },
    ]);
  });

  it('skips a norm whose item was deleted', () => {
    const f = production();
    f.state.operations[0].unit = 'squareMeter';
    f.state.operations[0].norms = [
      { itemId: 'missing', qtyPerM2: 1 },
      { itemId: f.itemId, qtyPerM2: 0.25 },
    ];
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 2)).toEqual([{ itemId: f.itemId, qty: 0.5 }]);
  });

  it('returns nothing for piecework stages', () => {
    const f = production();
    expect(defectMaterials(f.state, f.state.orders[0].route[0], 2)).toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/domain.test.ts -t "defect materials"`
Expected: FAIL — `defectMaterials` не экспортирован.

- [ ] **Step 3: Реализовать**

В `src/domain.ts` рядом с `areaMaterialCost` (:312):

```ts
const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function defectMaterials(state: State, task: RouteLine, qty: number): DefectMaterial[] {
  const operation = state.operations.find(row => row.id === task.operationId);
  if (!operation || operation.unit !== 'squareMeter') return [];
  return operation.norms
    .filter(norm => state.items.some(item => item.id === norm.itemId))
    .map(norm => ({ itemId: norm.itemId, qty: round3(norm.qtyPerM2 * qty) }));
}
```

Добавить `DefectMaterial` в type-import из `./types` (:9-14).

- [ ] **Step 4: Зелёный прогон**

Run: `npx vitest run src/domain.test.ts -t "defect materials" && npx tsc -b`
Expected: 3 PASS, exit 0.

---

### Task 3: `work.submit` — каждое отправление это новая строка отчёта

**Files:**
- Modify: `src/domain.ts` (`work.submit`, :1190-1230)
- Test: `src/domain.test.ts`

**Interfaces:**
- Produces: `work.submit` больше не перезаписывает прежний отчёт; блокирует только фактически висящий `status === 'submitted'`; всегда `state.reports.push(...)`; `payroll.reportId` указывает на новый отчёт, сумма — на принятое `task.completed`.
- Потребляется задачей 4 (повторная отправка после брака) и задачей 5 (история).

- [ ] **Step 1: Написать падающий тест**

В `src/domain.test.ts`:

```ts
it('keeps every submission as its own report row', () => {
  const f = production();
  let state = startWork(f.state, f.orderId, f.taskId);
  state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: 'birinchi' });
  state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 4, reason: 'quality' });
  state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 6, note: 'ikkinchi' });
  expect(state.reports).toHaveLength(2);
  expect(state.reports[0]).toMatchObject({ qty: 4, status: 'rejected', note: 'birinchi' });
  expect(state.reports[1]).toMatchObject({ qty: 6, status: 'submitted', note: 'ikkinchi' });
  expect(state.payroll).toHaveLength(1);
  expect(state.payroll[0].reportId).toBe(state.reports[1].id);
  expect(state.payroll[0].amount).toBe(12);
});
```

- [ ] **Step 2: Убедиться, что тест красный**

Run: `npx vitest run src/domain.test.ts -t "keeps every submission"`
Expected: FAIL — длина `reports` равна 1 (перезапись), либо `work.review` без причины (появится после Task 4; на этом шаге тест падает именно на длине/`reportId`).

- [ ] **Step 3: Заменить блок `work.submit`**

В `src/domain.ts:1190-1230` заменить тело case на:

```ts
    case 'work.submit': {
      const { order, task, operation, employee } = workContext(state, command, actor);
      check(task.status === 'in_progress', 'Task must be started before submission');
      const qty = quantity(command.qty);
      check(!exceeds(qty, task.planned - task.completed), 'Report exceeds remaining quantity');
      check(!state.reports.some(row => row.orderId === order.id && row.taskId === task.id
        && row.employeeId === employee.id && row.status === 'submitted'), 'Report already submitted');
      const autoAccept = operation.autoAccept;
      const report: WorkReport = {
        id: uuid(), orderId: order.id, taskId: task.id, employeeId: employee.id, qty,
        status: autoAccept ? 'accepted' : 'submitted', note: command.note, createdAt: now(),
      };
      state.reports.push(report);
      if (autoAccept) {
        task.completed = Math.min(task.planned, task.completed + qty);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
      } else {
        task.status = 'submitted';
      }
      const amount = round(task.rate * (autoAccept ? task.completed : task.completed + qty));
      const payroll = state.payroll.find(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === employee.id);
      if (payroll) {
        payroll.reportId = report.id;
        payroll.amount = amount;
        if (autoAccept) payroll.status = 'accepted';
        else if (payroll.status !== 'accepted') payroll.status = 'pending';
      } else {
        state.payroll.push({
          id: uuid(), employeeId: employee.id, reportId: report.id, orderId: order.id,
          taskId: task.id, amount, status: autoAccept ? 'accepted' : 'pending', createdAt: now(),
        });
      }
      if (autoAccept) ready(state, order);
      return report.id;
    }
```

Добавить `WorkReport` в type-import из `./types`.

- [ ] **Step 4: Обновить тесты, полагавшиеся на перезапись**

Run: `npx vitest run src/domain.test.ts`
Expected: падения в тестах, где после повторной отправки ожидался один отчёт или `state.reports[0]`. Исправить: индексировать последний отчёт через `state.reports.at(-1)!`; там, где сценарий действительно отправляет дважды, ожидать две строки и `payroll.reportId === state.reports.at(-1)!.id`. Конкретные адреса: `src/domain.test.ts:857-937`, `:974`, `:982-1013`; `src/work-view.test.ts:57` (причину брака добавит Task 4).

- [ ] **Step 5: Зелёный прогон**

Run: `npx vitest run src/domain.test.ts && npx tsc -b`
Expected: PASS, exit 0.

---

### Task 4: Трёхвариантный `work.review` — приёмка, частичный и полный брак

**Files:**
- Modify: `src/domain.ts` (`work.review`, :1231-1270; импорт типов)
- Test: `src/domain.test.ts`, `src/work-view.test.ts`

**Interfaces:**
- Produces: `work.review` с `accept: false` требует `reason`; `other` требует `note` 1…500; `defectQty` по умолчанию равен `report.qty`; `0 < defectQty ≤ report.qty`; частичный брак принимает `good = round(report.qty − defect)` и пишет `report.qty = good`; полный брак возвращает задачу в `in_progress` и обнуляет непринятую сумму начисления; журнал `state.defects` пополняется всегда при `accept: false`.
- Потребляется задачами 5, 8, 9.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `src/domain.test.ts` блок:

```ts
describe('defect review', () => {
  it('records a defect and keeps work open on a full reject', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 10, note: '' });
    const report = state.reports.at(-1)!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 10, reason: 'quality' });
    expect(state.reports.at(-1)).toMatchObject({ id: report.id, status: 'rejected', qty: 10 });
    expect(state.orders[0].route[0]).toMatchObject({ status: 'in_progress', completed: 0 });
    expect(state.payroll[0]).toMatchObject({ status: 'rejected', amount: 0 });
    expect(state.defects).toEqual([expect.objectContaining({
      reportId: report.id, orderId: f.orderId, lineId: state.orders[0].lines[0].id,
      taskId: f.taskId, employeeId: f.employeeId, operationId: f.operationId,
      qty: 10, reason: 'quality', note: '', materials: [],
    })]);
  });

  it('accepts the good part and journals only the defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    const report = state.reports.at(-1)!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 3, reason: 'measurement' });
    expect(state.reports.at(-1)).toMatchObject({ id: report.id, status: 'accepted', qty: 9 });
    expect(state.orders[0].route[0]).toMatchObject({ completed: 9, status: 'in_progress' });
    expect(state.payroll[0]).toMatchObject({ status: 'accepted', amount: 18 });
    expect(state.defects[0]).toMatchObject({ qty: 3, reason: 'measurement', materials: [] });
  });

  it('lets the worker resubmit the remaining quantity after a partial defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 3, reason: 'measurement' });
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 3, note: '' });
    expect(state.reports).toHaveLength(2);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: true });
    expect(state.orders[0].route[0]).toMatchObject({ completed: 12, status: 'completed' });
    expect(state.payroll[0]).toMatchObject({ amount: 24, status: 'accepted' });
  });

  it('caps the next submission by the remaining quantity after a defect', () => {
    const f = production({ qty: 12 });
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 12, note: '' });
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 3, reason: 'measurement' });
    atomic(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: '' });
  });

  it('validates review decisions', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 4, note: '' });
    const reportId = state.reports.at(-1)!.id;
    atomic(state, { type: 'work.review', reportId, accept: true, reason: 'quality' });
    expect(() => run(state, { type: 'work.review', reportId, accept: true, reason: 'quality' })).toThrow('Review must be plain');
    expect(() => run(state, { type: 'work.review', reportId, accept: false })).toThrow('Defect reason is required');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'other' })).toThrow('Defect note is required');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'quality', defectQty: 0 })).toThrow('Nothing to reject');
    expect(() => run(state, { type: 'work.review', reportId, accept: false, reason: 'quality', defectQty: 5 })).toThrow('Defect quantity exceeds report');
    expect(state.defects).toEqual([]);
  });

  it('never moves stock or un-issues materials on reject', () => {
    const f = production();
    let state = startWork(f.state, f.orderId, f.taskId);
    state = run(state, { type: 'work.submit', orderId: f.orderId, taskId: f.taskId, qty: 10, note: '' });
    const movements = structuredClone(state.movements);
    const materials = structuredClone(state.orders[0].materials);
    state = run(state, { type: 'work.review', reportId: state.reports.at(-1)!.id, accept: false, defectQty: 10, reason: 'quality' });
    expect(state.movements).toEqual(movements);
    expect(state.orders[0].materials).toEqual(materials);
  });
});
```

В `src/work-view.test.ts:57` заменить `accept: false` на `accept: false, reason: 'quality'`.

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/domain.test.ts -t "defect review"`
Expected: FAIL — `accept: false` сегодня не создаёт `state.defects` и не принимает частичное количество.

- [ ] **Step 3: Реализовать**

Импортировать в `src/domain.ts` типы `DefectReason`, `WorkReport`. Рядом с `check` добавить:

```ts
const defectReasons: DefectReason[] = ['quality', 'measurement', 'drawing', 'customer', 'other'];
```

Заменить case `work.review` (:1231-1270) на:

```ts
    case 'work.review': {
      check(typeof command.accept === 'boolean', 'Invalid review decision');
      check(!command.accept || (command.defectQty === undefined && command.reason === undefined && command.note === undefined), 'Review must be plain');
      const note = command.note === undefined ? '' : command.note.trim();
      if (!command.accept) {
        check(command.reason !== undefined && defectReasons.includes(command.reason), 'Defect reason is required');
        if (command.reason === 'other') check(note.length > 0 && note.length <= 500, 'Defect note is required');
        check(note.length <= 500, 'Defect note is too long');
      }
      const report = find(state.reports, command.reportId, 'Report');
      check(report.status === 'submitted', 'Report already reviewed');
      const order = find(state.orders, report.orderId, 'Order');
      const task = find(order.route, report.taskId, 'Task');
      const operation = find(state.operations, task.operationId, 'Operation');
      const employee = find(state.employees, report.employeeId, 'Employee');
      check(report.employeeId === task.employeeId, 'Report employee is not assigned');
      check(order.status === 'production' && order.materials.every(row => row.issued), 'Materials must be issued before review');
      check(task.status === 'submitted', 'Task is not awaiting review');
      const payroll = state.payroll.find(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === task.employeeId);
      if (command.accept) {
        check(employee.active, 'Employee is inactive');
        check(operation.employeeIds.includes(employee.id), 'Worker is not authorized for this operation');
        const stages = lineRoute(order, task.lineId);
        check(stages.slice(0, stages.indexOf(task)).every(row => !exceeds(row.planned, row.completed)), 'Previous route stage is incomplete');
        check(!exceeds(report.qty, task.planned - task.completed), 'Report exceeds remaining quantity');
        report.status = 'accepted';
        task.completed = Math.min(task.planned, task.completed + report.qty);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
        const amount = round(task.rate * task.completed);
        if (payroll) {
          payroll.reportId = report.id;
          payroll.amount = amount;
          payroll.status = 'accepted';
        } else {
          state.payroll.push({
            id: uuid(), employeeId: task.employeeId, reportId: report.id, orderId: order.id,
            taskId: task.id, amount, status: 'accepted', createdAt: now(),
          });
        }
        ready(state, order);
        return report.id;
      }
      const rawDefect = command.defectQty === undefined ? report.qty : command.defectQty;
      check(typeof rawDefect === 'number' && Number.isFinite(rawDefect), 'Defect quantity is invalid');
      const defect = round(rawDefect);
      check(defect > 0, 'Nothing to reject');
      check(!exceeds(defect, report.qty), 'Defect quantity exceeds report');
      const good = round(report.qty - defect);
      state.defects.push({
        id: uuid(), reportId: report.id, orderId: order.id, lineId: task.lineId, taskId: task.id,
        employeeId: report.employeeId, operationId: task.operationId,
        qty: defect, reason: command.reason!, note, materials: defectMaterials(state, task, defect), createdAt: now(),
      });
      if (good > 0) {
        check(employee.active, 'Employee is inactive');
        check(operation.employeeIds.includes(employee.id), 'Worker is not authorized for this operation');
        const stages = lineRoute(order, task.lineId);
        check(stages.slice(0, stages.indexOf(task)).every(row => !exceeds(row.planned, row.completed)), 'Previous route stage is incomplete');
        check(!exceeds(good, task.planned - task.completed), 'Report exceeds remaining quantity');
        report.qty = good;
        report.status = 'accepted';
        task.completed = Math.min(task.planned, task.completed + good);
        task.status = !exceeds(task.planned, task.completed) ? 'completed' : 'in_progress';
        const amount = round(task.rate * task.completed);
        if (payroll) {
          payroll.reportId = report.id;
          payroll.amount = amount;
          payroll.status = 'accepted';
        } else {
          state.payroll.push({
            id: uuid(), employeeId: task.employeeId, reportId: report.id, orderId: order.id,
            taskId: task.id, amount, status: 'accepted', createdAt: now(),
          });
        }
        ready(state, order);
      } else {
        report.status = 'rejected';
        task.status = 'in_progress';
        if (payroll) {
          payroll.amount = round(task.rate * task.completed);
          if (payroll.status !== 'accepted') payroll.status = 'rejected';
        }
      }
      return report.id;
    }
```

- [ ] **Step 4: Зелёный прогон**

Run: `npx vitest run src/domain.test.ts src/work-view.test.ts && npx tsc -b`
Expected: PASS, exit 0.

---

### Task 5: История работы и дневная статистика без двойного учёта

**Files:**
- Modify: `src/work-view.ts` (`WorkHistoryRow`, :11-15; `workHistoryRows`, :75-90; новая `acceptedWorkQty`)
- Modify: `src/App.tsx` (`employeeStats`, :772)
- Test: `src/work-view.test.ts`

**Interfaces:**
- Produces: `WorkHistoryRow.status: 'submitted' | 'accepted' | 'rejected'`; `amount` = `report.status === 'accepted' ? round(report.qty * task.rate) : 0`; `export function acceptedWorkQty(state: State, employeeId: string, from: string, to: string): number` — сумма `qty` всех принятых отчётов в периоде (не через payroll, чтобы частичные приёмки не терялись).
- Потребляется задачей 9 (панель брака) и App.tsx.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `src/work-view.test.ts` (импортировать `acceptedWorkQty`):

```ts
it('shows no money for a rejected report and exposes the review status', () => {
  const { state, order, first, worker } = demo();
  for (const operation of state.operations) operation.autoAccept = false;
  let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 4, note: '' }, worker);
  next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 4, reason: 'quality' });
  expect(workHistoryRows(next, worker)[0]).toMatchObject({ qty: 4, amount: 0, status: 'rejected' });
});

it('sums accepted report quantities for the period instead of payroll rows', () => {
  const { state, order, first, worker } = demo();
  for (const operation of state.operations) operation.autoAccept = false;
  let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 6, note: '' }, worker);
  next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 2, reason: 'quality' });
  next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 2, note: '' }, worker);
  next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: true });
  expect(acceptedWorkQty(next, worker.id, '2000-01-01', '2100-01-01')).toBe(6);
});
```

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/work-view.test.ts`
Expected: FAIL — `status` отсутствует, `amount` берётся из payroll (12 вместо 0), `acceptedWorkQty` не экспортирована.

- [ ] **Step 3: Реализовать**

`src/work-view.ts`: добавить импорт `withinPeriod` из `./reports`; в `WorkHistoryRow` добавить `status: 'submitted' | 'accepted' | 'rejected';`; локальный `round` сверху файла; в `workHistoryRows` заменить `amount` на `report.status === 'accepted' ? round(report.qty * task.rate) : 0` и добавить `status: report.status`; добавить:

```ts
export function acceptedWorkQty(state: State, employeeId: string, from: string, to: string): number {
  return round(state.reports
    .filter(row => row.employeeId === employeeId && row.status === 'accepted' && withinPeriod(row.createdAt, from, to))
    .reduce((sum, row) => sum + row.qty, 0));
}
```

`src/App.tsx:772`: заменить `accepted: entries.reduce(...)` на `accepted: acceptedWorkQty(state, emp.id, range.from, range.to)`; добавить импорт из `./work-view`.

- [ ] **Step 4: Зелёный прогон**

Run: `npx vitest run src/work-view.test.ts && npx tsc -b`
Expected: PASS, exit 0.

### Task 6: Канонический SQL P1 — журнал брака, новый submit и трёхвариантный review

**Files:**
- Modify: `supabase/schema.sql` (DDL между `erp_payroll` и `erp_salary_plans`, :317-318; UNIQUE `erp_work_reports` :298; индексы после :476; RLS-массив :696; DECLARE после :1847; snapshot после :1698; `work.submit` :2531-2541; `work.review` :2572-2618)
- Test: `src/defectContract.test.ts`

**Interfaces:**
- Produces: таблица `public.erp_defects` (DDL ниже); ключ `defects` в `erp_snapshot()`; `erp_execute` принимает `work.review` с `defectQty`/`reason`/`note`, пишет журнал и расщепляет отчёт на `good`/`defect`.
- Потребляется задачами 7–9. Сообщения SQL и домена расходятся в одном месте намеренно: повторная приёмка в домене — `Report already reviewed`, в SQL — `Report is not awaiting review`; зонд проверяет только SQL.

- [ ] **Step 1: Написать падающий контрактный тест**

Создать `src/defectContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const table = (name: string) => {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n);', start));
};

describe('defect and review SQL contract', () => {
  it('creates a defect journal with server-side guards', () => {
    const ddl = table('erp_defects');
    expect(ddl).toContain("reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other'))");
    expect(ddl).toContain("CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> ''))");
    expect(ddl).toContain('CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2))');
    expect(ddl).toContain("CHECK (jsonb_typeof(materials) = 'array')");
    expect(ddl).toContain('FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id)');
  });

  it('allows many reports per task but keeps payroll unique', () => {
    expect(table('erp_work_reports')).not.toContain('UNIQUE (company_id, order_id, task_id, employee_id)');
    expect(table('erp_payroll')).toContain('UNIQUE (company_id, order_id, task_id, employee_id)');
  });

  it('protects the journal with the admin read policy', () => {
    expect(schema).toContain("'erp_work_reports', 'erp_payroll', 'erp_defects', 'erp_salary_plans'");
  });

  it('snapshots defects for admins and the involved worker', () => {
    expect(schema).toContain("'defects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reportId', d.report_id");
    expect(schema).toContain('FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id)');
    expect(schema).toContain("'materials', d.materials");
  });

  it('submits a new report row every time', () => {
    const submit = schema.slice(schema.indexOf("WHEN 'work.submit' THEN"), schema.indexOf("WHEN 'work.review' THEN"));
    expect(submit).toContain("RAISE EXCEPTION 'Report already submitted'");
    expect(submit).toContain('INSERT INTO public.erp_work_reports');
    expect(submit).not.toContain('SET qty = v_qty');
  });

  it('reviews with a three-way split, defect journal and norm materials', () => {
    const review = schema.slice(schema.indexOf("WHEN 'work.review' THEN"), schema.indexOf("WHEN 'purchase.create' THEN"));
    for (const message of [
      'Review must be plain', 'Defect reason is required', 'Defect note is required',
      'Defect note is too long', 'Nothing to reject', 'Defect quantity exceeds report',
    ]) expect(review).toContain(`'${message}'`);
    expect(review).toContain('INSERT INTO public.erp_defects');
    expect(review).toContain("UPDATE public.erp_work_reports SET qty = v_good, status = 'accepted'");
    expect(review).toContain('jsonb_array_elements(v_operation.norms) WITH ORDINALITY');
  });
});
```

- [ ] **Step 2: Убедиться, что тест красный**

Run: `npx vitest run src/defectContract.test.ts`
Expected: FAIL — таблицы `erp_defects` нет, текст `work.review` старый.

- [ ] **Step 3: Добавить DDL журнала**

Вставить между закрывающей `);` таблицы `erp_payroll` (строка 317) и `CREATE TABLE public.erp_salary_plans (` (строка 318):

```sql
CREATE TABLE public.erp_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  report_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2)),
  reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> '')),
  materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, operation_id) REFERENCES public.erp_operations(company_id, id)
);
```

- [ ] **Step 4: Снять уникальность одного отчёта на задачу**

В таблице `erp_work_reports` удалить строку `  UNIQUE (company_id, order_id, task_id, employee_id),` (:298). Контекст замены:

```sql
  UNIQUE (company_id, id, order_id, employee_id),
  UNIQUE (company_id, order_id, task_id, employee_id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
```

→

```sql
  UNIQUE (company_id, id, order_id, employee_id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
```

Уникальность `erp_payroll` (:313) **не трогать**: на неё опирается один расчёт на этап.

- [ ] **Step 5: Индексы**

После строки `CREATE INDEX erp_reports_task_idx ON public.erp_work_reports(company_id, task_id, status);` (:476) добавить:

```sql
CREATE INDEX erp_defects_order_idx ON public.erp_defects(company_id, order_id);
CREATE INDEX erp_defects_employee_idx ON public.erp_defects(company_id, employee_id, created_at);
```

- [ ] **Step 6: RLS-массив**

В `FOREACH t IN ARRAY ARRAY[...]` (:696) заменить `'erp_work_reports', 'erp_payroll', 'erp_salary_plans',` на `'erp_work_reports', 'erp_payroll', 'erp_defects', 'erp_salary_plans',`.

- [ ] **Step 7: Снимок**

После блока `'payroll', (... FROM public.erp_payroll p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),` (:1696-1698) и перед `'salaryPlans',` вставить:

```sql
      'defects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reportId', d.report_id, 'orderId', d.order_id,
        'lineId', d.line_id, 'taskId', d.task_id, 'employeeId', d.employee_id, 'operationId', d.operation_id,
        'qty', d.qty, 'reason', d.reason, 'note', d.note, 'materials', d.materials, 'createdAt', d.created_at)
        ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id)),
```

- [ ] **Step 8: Переменные `erp_execute`**

В DECLARE после `v_new_completed numeric;` (:1847) добавить:

```sql
  v_defect numeric;
  v_good numeric;
  v_reason text;
```

- [ ] **Step 9: Заменить тело `work.submit`**

Заменить блок с :2531 по :2541 (от `SELECT * INTO v_report FROM public.erp_work_reports` до `END IF;` перед `SELECT * INTO STRICT v_operation`) на:

```sql
      IF EXISTS (SELECT 1 FROM public.erp_work_reports
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id
          AND employee_id = v_task.employee_id AND status = 'submitted') THEN
        RAISE EXCEPTION 'Report already submitted' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_work_reports(company_id, order_id, task_id, employee_id, qty, note)
        VALUES (v_company, v_task.order_id, v_task.id, v_task.employee_id, v_qty, public.erp_text(p_command -> 'note', 'note', true))
        RETURNING * INTO v_report;
```

- [ ] **Step 10: Заменить тело `work.review`**

Заменить весь блок от `WHEN 'work.review' THEN` (:2572) до `END IF;` перед `WHEN 'purchase.create' THEN` (:2619) на:

```sql
    WHEN 'work.review' THEN
      v_entity := public.erp_uuid(p_command -> 'reportId', 'reportId');
      v_accept := public.erp_bool(p_command -> 'accept', 'accept');
      IF v_accept AND (p_command ? 'defectQty' OR p_command ? 'reason' OR p_command ? 'note') THEN
        RAISE EXCEPTION 'Review must be plain' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(coalesce(p_command ->> 'note', ''));
      IF NOT v_accept THEN
        v_reason := p_command ->> 'reason';
        IF v_reason IS NULL OR v_reason NOT IN ('quality', 'measurement', 'drawing', 'customer', 'other') THEN
          RAISE EXCEPTION 'Defect reason is required' USING ERRCODE = '23514';
        END IF;
        IF v_reason = 'other' AND v_note = '' THEN RAISE EXCEPTION 'Defect note is required' USING ERRCODE = '23514'; END IF;
        IF length(v_note) > 500 THEN RAISE EXCEPTION 'Defect note is too long' USING ERRCODE = '23514'; END IF;
      END IF;
      SELECT * INTO v_report FROM public.erp_work_reports WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_report.status <> 'submitted' THEN RAISE EXCEPTION 'Report is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_report.order_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_report.task_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      IF v_report.employee_id <> v_task.employee_id THEN RAISE EXCEPTION 'Report employee is not assigned' USING ERRCODE = '23514'; END IF;
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND NOT issued) THEN
        RAISE EXCEPTION 'Materials must be issued before review' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'submitted' THEN RAISE EXCEPTION 'Task is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      SELECT * INTO STRICT v_employee FROM public.erp_employees WHERE company_id = v_company AND id = v_report.employee_id;
      SELECT * INTO v_payroll FROM public.erp_payroll
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
      IF v_accept THEN
        v_good := v_report.qty;
      ELSE
        v_defect := round(CASE WHEN p_command ? 'defectQty' THEN public.erp_num(p_command -> 'defectQty', 'defectQty', true) ELSE v_report.qty END, 2);
        IF v_defect <= 0 THEN RAISE EXCEPTION 'Nothing to reject' USING ERRCODE = '23514'; END IF;
        IF v_defect > v_report.qty THEN RAISE EXCEPTION 'Defect quantity exceeds report' USING ERRCODE = '23514'; END IF;
        v_good := round(v_report.qty - v_defect, 2);
      END IF;
      IF v_good > 0 THEN
        IF NOT v_employee.active THEN RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023'; END IF;
        IF NOT (v_task.employee_id = ANY(v_operation.employee_ids)) THEN
          RAISE EXCEPTION 'Worker is not authorized for this operation' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_task.line_id
          AND position < v_task.position AND completed < planned) THEN
          RAISE EXCEPTION 'Previous route stage is incomplete' USING ERRCODE = '23514';
        END IF;
        IF v_good > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
        v_new_completed := least(v_task.planned, v_task.completed + v_good);
        UPDATE public.erp_work_reports SET qty = v_good, status = 'accepted' WHERE id = v_entity;
        UPDATE public.erp_tasks SET completed = v_new_completed,
          status = CASE WHEN v_new_completed >= v_task.planned THEN 'completed' ELSE 'in_progress' END WHERE id = v_task.id;
        v_amount := round(v_task.rate * v_new_completed, 2);
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET report_id = v_entity, amount = v_amount, status = 'accepted' WHERE id = v_payroll.id;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_entity, v_task.order_id, v_task.id, v_amount, 'accepted');
        END IF;
        PERFORM public.erp_ready(v_company, v_order.id);
      ELSE
        UPDATE public.erp_work_reports SET status = 'rejected' WHERE id = v_entity;
        UPDATE public.erp_tasks SET status = 'in_progress' WHERE id = v_task.id;
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET amount = round(v_task.rate * v_task.completed, 2),
            status = CASE WHEN v_payroll.status = 'accepted' THEN 'accepted' ELSE 'rejected' END WHERE id = v_payroll.id;
        END IF;
      END IF;
      IF NOT v_accept THEN
        INSERT INTO public.erp_defects(company_id, report_id, order_id, line_id, task_id, employee_id, operation_id, qty, reason, note, materials)
          VALUES (v_company, v_report.id, v_order.id, v_task.line_id, v_task.id, v_report.employee_id, v_task.operation_id,
            v_defect, v_reason, v_note,
            CASE WHEN v_operation.unit = 'squareMeter' AND jsonb_array_length(v_operation.norms) > 0 THEN (
              SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', n.value -> 'itemId',
                'qty', round(public.erp_num(n.value -> 'qtyPerM2', 'qtyPerM2') * v_defect, 3)) ORDER BY n.ord), '[]'::jsonb)
              FROM jsonb_array_elements(v_operation.norms) WITH ORDINALITY AS n(value, ord)
              WHERE EXISTS (SELECT 1 FROM public.erp_items i WHERE i.company_id = v_company AND i.id = public.erp_uuid(n.value -> 'itemId', 'itemId'))
            ) ELSE '[]'::jsonb END);
      END IF;
```

- [ ] **Step 11: Зелёный прогон**

Run: `npx vitest run src/defectContract.test.ts && npx tsc -b`
Expected: PASS, exit 0.

### Task 7: Генератор миграции `20261115_defects.sql` и PGlite-зонд

**Files:**
- Create: `.validation-pglite-20261029/generate-defects-migration.mjs`
- Generate: `supabase/migrations/20261115_defects.sql` (скрипт перезаписывает файл; вручную не редактируется)
- Create: `.validation-pglite-20261029/validate-defects.mjs`
- Test: сам зонд (PGlite)

**Interfaces:**
- Consumes: канонический `supabase/schema.sql` после Task 6 (`erp_defects`, удалённый UNIQUE, новый `work.submit`/`work.review`, ключ `defects` в снимке).
- Produces: `supabase/migrations/20261115_defects.sql` — единственный SQL-файл, который владелец применяет до выката P1-фронтенда; зонд доказывает идемпотентность, снятие старого UNIQUE и паритет поведения `work.submit`/`work.review`/снимка.

- [ ] **Step 1: Написать генератор**

Создать `.validation-pglite-20261029/generate-defects-migration.mjs`:

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261115_defects.sql', root);

const names = ['erp_snapshot', 'erp_execute'];

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}
require('CREATE TABLE public.erp_defects', 'erp_defects table');
require("'defects', (SELECT", 'snapshot defects');
require("WHEN 'work.review' THEN", 'execute work.review');
require("RAISE EXCEPTION 'Report already submitted'", 'submit blocks a second awaiting report');
require('INSERT INTO public.erp_defects', 'review writes the defect journal');
require("RAISE EXCEPTION 'Review must be plain'", 'plain review guard');
require('jsonb_array_elements(v_operation.norms) WITH ORDINALITY', 'defect norm materials');
require("'erp_work_reports', 'erp_payroll', 'erp_defects', 'erp_salary_plans'", 'journal RLS');

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

const ddl = `-- Aliya ERP: defect journal and three-way review — acceptance, partial and full defect.
-- Safe to run more than once. Existing data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  report_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2)),
  reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> '')),
  materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, operation_id) REFERENCES public.erp_operations(company_id, id)
);
CREATE INDEX IF NOT EXISTS erp_defects_order_idx ON public.erp_defects(company_id, order_id);
CREATE INDEX IF NOT EXISTS erp_defects_employee_idx ON public.erp_defects(company_id, employee_id, created_at);
-- The live database still carries one report per task; the journal needs every submission.
ALTER TABLE public.erp_work_reports DROP CONSTRAINT IF EXISTS erp_work_reports_company_id_order_id_task_id_employee_id_key;
ALTER TABLE public.erp_defects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_defects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_defects TO authenticated;
DROP POLICY IF EXISTS erp_admin_read ON public.erp_defects;
CREATE POLICY erp_admin_read ON public.erp_defects FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

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

- [ ] **Step 2: Сгенерировать миграцию**

Run: `node .validation-pglite-20261029/generate-defects-migration.mjs`
Expected: строка `{"functions":2,"sha256":"…"}`; файл `supabase/migrations/20261115_defects.sql` создан и содержит `DROP CONSTRAINT IF EXISTS erp_work_reports_company_id_order_id_task_id_employee_id_key`.

- [ ] **Step 3: Написать зонд**

Создать `.validation-pglite-20261029/validate-defects.mjs`:

```js
// Defect probe: one report per submission, three-way review, defect journal, norm materials,
// pay without the defect, worker visibility, and the live constraint upgrade.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261115_defects.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

const db = new PGlite();
const adminId = crypto.randomUUID();
const kamolId = crypto.randomUUID();
const azizId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
for (const [id, name] of [[adminId, 'Owner'], [kamolId, 'Kamol'], [azizId, 'Aziz']]) {
  await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)',
    [id, `${name.toLowerCase()}@local.invalid`, JSON.stringify({ name })]);
}

await db.exec(schema);
// The live database still carries one report per task; the journal needs every submission.
await db.exec('ALTER TABLE public.erp_work_reports ADD CONSTRAINT erp_work_reports_company_id_order_id_task_id_employee_id_key UNIQUE (company_id, order_id, task_id, employee_id)');
await db.exec(migration);
await db.exec(migration);

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
async function movements() {
  return Number((await one('SELECT count(*) AS n FROM public.erp_stock_movements')).n);
}

const uniques = await owner(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'public.erp_work_reports'::regclass AND contype = 'u' ORDER BY conname`);
assert.ok(!uniques.some(row => row.def === 'UNIQUE (company_id, order_id, task_id, employee_id)'), 'old reports unique survived');
const payrollUnique = await owner(`SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.erp_payroll'::regclass AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (company_id, order_id, task_id, employee_id)'`);
assert.equal(payrollUnique.length, 1, 'one pay row per stage must stay unique');
pass('defects migration applies twice and lifts the one-report-per-task constraint');

await as(adminId);
await db.query('SELECT public.erp_bootstrap_company($1) AS id', ['Brak']);
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

await execute({ type: 'item.create', name: 'Yog‘och', unit: 'dona', minQty: 0, cost: 5000, customerId: null, kind: 'material', salePrice: 0 });
await execute({ type: 'item.create', name: 'Bo‘yoq', unit: 'kg', minQty: 0, cost: 1000, customerId: null, kind: 'material', salePrice: 0 });
await execute({ type: 'item.create', name: 'Qotishma', unit: 'kg', minQty: 0, cost: 2000, customerId: null, kind: 'material', salePrice: 0 });
const items = (await snapshot(adminId)).state.items;
const woodId = items.find(row => row.name === 'Yog‘och').id;
const paintId = items.find(row => row.name === 'Bo‘yoq').id;
const hardenerId = items.find(row => row.name === 'Qotishma').id;
for (const itemId of [woodId, paintId, hardenerId]) {
  await execute({ type: 'inventory.count', itemId, qty: 100, note: 'Boshlang‘ich qoldiq' });
}
await execute({ type: 'customer.create', name: 'Mijoz', phone: '', address: '', kind: 'customer' });
const customerId = (await snapshot(adminId)).state.customers[0].id;
await execute({ type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 30, workerRate: 20,
  standardMinutes: 10, machineId: null, employeeIds: [kamolEmployeeId], active: true, autoAccept: false,
  norms: [{ itemId: paintId, qtyPerM2: 0.25 }, { itemId: hardenerId, qtyPerM2: 0.1 }] });
const operationId = (await snapshot(adminId)).state.operations[0].id;

await execute({ type: 'order.create', input: {
  kind: 'product', customerId, title: 'Stol', qty: 10, price: 1000, overhead: 0, advance: 0, account: 'cash',
  materials: [{ itemId: woodId, qty: 4 }],
  route: [{ operationId, employeeId: kamolEmployeeId, rate: 20 }],
} });
let state = (await snapshot(adminId)).state;
const firstOrderId = state.orders[0].id;
const firstTaskId = state.orders[0].route[0].id;
const firstOrder = () => state.orders.find(row => row.id === firstOrderId);
const qtyOf = (order, id) => order.materials.find(row => row.itemId === id).qty;
assert.equal(qtyOf(state.orders[0], woodId), 4);
assert.equal(qtyOf(state.orders[0], paintId), 2.5);
assert.equal(qtyOf(state.orders[0], hardenerId), 1);
await execute({ type: 'order.launch', orderId: firstOrderId });
await execute({ type: 'order.issue', orderId: firstOrderId });
state = (await snapshot(adminId)).state;
assert.equal(firstOrder().materials.filter(row => row.issued).length, 3);
assert.equal(await movements(), 6);
pass('square-metre norms merge into the issued list (three lines, six movements)');

await executeAs(kamolId, { type: 'work.accept', orderId: firstOrderId, taskId: firstTaskId });
await executeAs(kamolId, { type: 'work.start', orderId: firstOrderId, taskId: firstTaskId });
await executeAs(kamolId, { type: 'work.submit', orderId: firstOrderId, taskId: firstTaskId, qty: 10, note: 'Birinchi partiya' });
state = (await snapshot(adminId)).state;
const firstReportId = state.reports[0].id;
assert.equal(state.reports[0].status, 'submitted');
assert.equal(firstOrder().route[0].completed, 0);
assert.equal(state.payroll[0].amount, 200);
assert.equal(state.payroll[0].status, 'pending');
pass('manual acceptance keeps the submitted report and the pending pay');

await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: true, note: 'Ortiqcha' }, 'plain review with a note');
await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: false }, 'missing reason');
await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: false, reason: 'other' }, 'other without a note');
await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: false, reason: 'quality', note: 'x'.repeat(501) }, 'long note');
await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: false, defectQty: 0, reason: 'quality' }, 'zero defect');
await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: false, defectQty: 11, reason: 'quality' }, 'defect above report');
await rejects(kamolId, { type: 'work.review', reportId: firstReportId, accept: true }, 'worker review');
pass('invalid reviews and worker reviews are rejected');

await execute({ type: 'work.review', reportId: firstReportId, accept: false, defectQty: 3, reason: 'quality' });
state = (await snapshot(adminId)).state;
const acceptedReport = state.reports.find(row => row.id === firstReportId);
assert.equal(acceptedReport.qty, 7);
assert.equal(acceptedReport.status, 'accepted');
assert.equal(firstOrder().route[0].completed, 7);
assert.equal(firstOrder().route[0].status, 'in_progress');
assert.equal(state.payroll[0].amount, 140);
assert.equal(state.payroll[0].status, 'accepted');
const firstDefect = state.defects[0];
assert.equal(firstDefect.qty, 3);
assert.equal(firstDefect.reason, 'quality');
assert.equal(firstDefect.note, '');
assert.deepEqual(firstDefect.materials, [{ itemId: paintId, qty: 0.75 }, { itemId: hardenerId, qty: 0.3 }]);
assert.equal(await movements(), 6);
pass('a partial defect pays only the good seven and journals the norm materials');

assert.deepEqual((await snapshot(kamolId)).state.defects.map(row => row.id), [firstDefect.id]);
assert.deepEqual((await snapshot(azizId)).state.defects, []);
pass('only the involved worker sees the defect row');

await rejects(adminId, { type: 'work.review', reportId: firstReportId, accept: true }, 'second review');
pass('a finished report cannot be reviewed twice');

await executeAs(kamolId, { type: 'work.submit', orderId: firstOrderId, taskId: firstTaskId, qty: 3, note: 'Qayta ishlangan' });
state = (await snapshot(adminId)).state;
assert.equal(state.reports.length, 2);
const secondReport = state.reports.find(row => row.qty === 3);
assert.equal(secondReport.status, 'submitted');
assert.equal(firstOrder().route[0].status, 'submitted');
assert.equal(state.payroll[0].amount, 200);
assert.equal(state.payroll[0].status, 'accepted');
await execute({ type: 'work.review', reportId: secondReport.id, accept: true });
state = (await snapshot(adminId)).state;
assert.equal(state.reports.find(row => row.id === secondReport.id).status, 'accepted');
assert.equal(firstOrder().route[0].completed, 10);
assert.equal(firstOrder().route[0].status, 'completed');
assert.equal(state.payroll[0].amount, 200);
assert.equal(state.payroll[0].status, 'accepted');
assert.equal(await movements(), 6);
pass('the reworked three close the stage and one pay row stays at two hundred');

await execute({ type: 'order.create', input: {
  kind: 'product', customerId, title: 'Stul', qty: 2, price: 500, overhead: 0, advance: 0, account: 'cash',
  materials: [{ itemId: woodId, qty: 2 }],
  route: [{ operationId, employeeId: kamolEmployeeId, rate: 20 }],
} });
state = (await snapshot(adminId)).state;
const secondOrderId = state.orders.find(row => row.id !== firstOrderId).id;
const secondTaskId = state.orders.find(row => row.id === secondOrderId).route[0].id;
await execute({ type: 'order.launch', orderId: secondOrderId });
await execute({ type: 'order.issue', orderId: secondOrderId });
assert.equal(await movements(), 9);
await executeAs(kamolId, { type: 'work.accept', orderId: secondOrderId, taskId: secondTaskId });
await executeAs(kamolId, { type: 'work.start', orderId: secondOrderId, taskId: secondTaskId });
await executeAs(kamolId, { type: 'work.submit', orderId: secondOrderId, taskId: secondTaskId, qty: 2, note: 'Nuqsonli' });
await rejects(kamolId, { type: 'work.submit', orderId: secondOrderId, taskId: secondTaskId, qty: 2, note: 'Takror' }, 'second submit');
state = (await snapshot(adminId)).state;
const defectReport = state.reports.find(row => row.orderId === secondOrderId && row.status === 'submitted');
assert.equal(state.payroll.find(row => row.orderId === secondOrderId).amount, 40);
await execute({ type: 'work.review', reportId: defectReport.id, accept: false, reason: 'other', note: '  Rasm xatosi  ' });
state = (await snapshot(adminId)).state;
assert.equal(state.reports.find(row => row.id === defectReport.id).status, 'rejected');
assert.equal(state.orders.find(row => row.id === secondOrderId).route[0].status, 'in_progress');
assert.equal(state.payroll.find(row => row.orderId === secondOrderId).amount, 0);
assert.equal(state.payroll.find(row => row.orderId === secondOrderId).status, 'rejected');
const fullDefect = state.defects.find(row => row.qty === 2);
assert.equal(fullDefect.reason, 'other');
assert.equal(fullDefect.note, 'Rasm xatosi');
assert.deepEqual(fullDefect.materials, [{ itemId: paintId, qty: 0.5 }, { itemId: hardenerId, qty: 0.2 }]);
assert.equal(await movements(), 9);
pass('a full defect pays nothing, refuses a duplicate submit and journals the whole quantity');

// The live database does not have this table yet, so its own DDL is what creates it there.
// Rebuild the table from the migration alone and compare against the canonical shape.
// This destructive check must stay last — after it the table holds migration-only DDL.
const shape = async () => ({
  columns: await owner(`SELECT column_name, data_type, is_nullable, coalesce(column_default, '') AS d
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erp_defects'
    ORDER BY ordinal_position`),
  constraints: await owner(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'public.erp_defects'::regclass AND contype <> 'p' ORDER BY def`),
  indexes: await owner(`SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'erp_defects' ORDER BY indexdef`),
  policies: await owner(`SELECT policyname, cmd, permissive, roles, coalesce(qual, '') AS qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'erp_defects' ORDER BY policyname`),
  rls: await owner(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE oid = 'public.erp_defects'::regclass`),
  privileges: await owner(`SELECT grantee, privilege_type FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'erp_defects' ORDER BY grantee, privilege_type`),
});
const canonical = await shape();
assert.ok(Object.values(canonical).every(rows => rows.length), 'the canonical shape came back empty');
await db.exec('DROP TABLE public.erp_defects');
await db.exec(migration);
assert.deepEqual(await shape(), canonical);
pass('the migration DDL recreates the missing journal exactly as the canonical schema builds it');

console.log(`\n${passes} checks passed`);
```

- [ ] **Step 4: Прогнать зонд**

Run: `node .validation-pglite-20261029/validate-defects.mjs`
Expected: одиннадцать строк `PASS` и финал `11 checks passed`, exit 0. Ни одна проверка не падает; любые отличия паритета — стоп и разбор до продолжения.

- [ ] **Step 5: Контрольный прогон контрактного теста**

Run: `npx vitest run src/defectContract.test.ts && npx tsc -b`
Expected: PASS, exit 0.

### Task 8: UI приёмки — кнопка очереди, модалка `workReview`, бейдж, ярлык брака, переключатель приёмки

**Files:**
- Create: `src/components/TaskActionButton.tsx`, `src/components/WorkReview.tsx`, `src/workReview.test.tsx`
- Modify: `src/i18n.ts` (метки причин и новые ошибки), `src/work-view.ts` (`WorkTaskRow.defectQty`), `src/components/WorkTasks.tsx` (ярлык брака, статус истории), `src/App.tsx` (кнопка доски, бейдж, модалка, заголовок, note), `src/components/QuickEditors.tsx`, `src/components/CatalogSettings.tsx`
- Modify: `src/setup.ts:52,57`, `src/seed.ts:39-40` (`autoAccept: false` для Jilolash/Bo‘yash)
- Test: `src/workReview.test.tsx`, `src/work-view.test.ts`, `src/setup.test.ts:88,90`

**Interfaces:**
- Produces: `TaskActionButton` и `WorkReview` — именованные экспорты для SSR-тестов; `defectReasonLabels: Record<DefectReason, string>` и `defectReasonLabel(reason)` в `src/i18n.ts`; `WorkTaskRow.defectQty: number`; тип модалки `workReview` с id `${orderId}:${taskId}`; чекбокс «Natijani egasi qabul qiladi» в обеих формах операции; `autoAccept: false` по умолчанию для покрасочных операций.
- Потребляется задачей 9 (панель журнала использует те же метки причин).

- [ ] **Step 1: Написать падающие тесты**

Создать `src/workReview.test.tsx`:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './domain';
import { translateError } from './i18n';
import { DEMO_COMPANY_ID } from './migrations';
import { createDemo } from './seed';
import { OperationRateEditor } from './components/QuickEditors';
import { TaskActionButton } from './components/TaskActionButton';
import { WorkReview } from './components/WorkReview';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'demo-admin', name: 'Administrator', role: 'admin', companyId: DEMO_COMPANY_ID };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function submitted() {
  let state = createDemo(admin);
  for (const operation of state.operations) operation.autoAccept = false;
  const orderId = state.orders.find(row => row.status === 'production')!.id;
  const taskId = state.orders.find(row => row.id === orderId)!.route[0].id;
  state = run(state, { type: 'work.accept', orderId, taskId });
  state = run(state, { type: 'work.start', orderId, taskId });
  state = run(state, { type: 'work.submit', orderId, taskId, qty: 3, note: '' });
  const order = state.orders.find(row => row.id === orderId)!;
  return { state, order, task: order.route[0] };
}

describe('owner review UI', () => {
  it('ships painting operations with owner acceptance on', () => {
    const state = createDemo(admin);
    expect(state.operations.find(row => row.name === 'Jilolash')).toMatchObject({ autoAccept: false });
    expect(state.operations.find(row => row.name === 'Bo‘yash')).toMatchObject({ autoAccept: false });
  });

  it('turns the submitted stage into an active accept button', () => {
    const { task } = submitted();
    const html = renderToStaticMarkup(createElement(TaskActionButton, {
      task, busy: false, available: false, onReview: () => {}, onSubmit: () => {},
    }));
    expect(html).toContain('<button class="primary">Qabul qilish</button>');
    expect(html).not.toContain('disabled');
  });

  it('renders the review modal with defect fields and facts', () => {
    const { state, order, task } = submitted();
    const html = renderToStaticMarkup(createElement(WorkReview, {
      state, orderId: order.id, taskId: task.id, busy: false, close: () => {}, save: async () => {},
    }));
    expect(html).toContain(`Qabul — ${task.name} · ${order.number}`);
    for (const label of [
      'Topshirilgan', 'Qolgan', 'Qabulda hisoblanadi', 'Brakda sarflangan material',
      'Brak miqdori', 'Brak sababi', 'Sifat nuqsoni', 'Boshqa', 'Qabul qilish',
    ]) expect(html).toContain(label);
  });

  it('renders the manual acceptance switch for an operation', () => {
    const { state } = submitted();
    const jilolash = state.operations.find(row => row.name === 'Jilolash')!;
    const manual = renderToStaticMarkup(createElement(OperationRateEditor, {
      operation: jilolash, items: state.items, busy: false, close: () => {}, save: async () => {},
    }));
    expect(manual).toContain('Natijani egasi qabul qiladi');
    expect(manual).toContain('checked=""');
    const automatic = renderToStaticMarkup(createElement(OperationRateEditor, {
      operation: { ...jilolash, autoAccept: true }, items: state.items, busy: false, close: () => {}, save: async () => {},
    }));
    expect(automatic).not.toContain('checked');
  });

  it('translates the new defect errors', () => {
    expect(translateError('Defect reason is required')).toBe('Brak sababini tanlang.');
    expect(translateError('Review must be plain')).toBe('Qabul qilishda brak maydonlari bo‘lishi mumkin emas.');
    expect(translateError('Nothing to reject')).toBe('Brak miqdori nolga teng bo‘lishi mumkin emas.');
  });
});
```

Сохранение `autoAccept` через SSR не нажимается: тест фиксирует начальное состояние чекбокса, а сама запись проверяется браузерным прогоном в задаче 10.

В `src/work-view.test.ts` после теста про отклонённую работу добавить:

```ts
it('counts open defect quantity until the stage completes', () => {
  const { state, order, first, worker } = demo();
  for (const operation of state.operations) operation.autoAccept = false;
  let next = run(state, { type: 'work.accept', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.start', orderId: order.id, taskId: first.id }, worker);
  next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: first.planned, note: '' }, worker);
  next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: false, defectQty: 2, reason: 'quality' });
  expect(workTaskRows(next, worker)[0]).toMatchObject({ taskId: first.id, defectQty: 2 });
  next = run(next, { type: 'work.submit', orderId: order.id, taskId: first.id, qty: 2, note: '' }, worker);
  next = run(next, { type: 'work.review', reportId: next.reports.at(-1)!.id, accept: true });
  expect(workTaskRows(next, worker).some(row => row.taskId === first.id)).toBe(false);
  expect(workHistoryRows(next, worker).map(row => row.qty).sort((a, b) => a - b)).toEqual([2, first.planned - 2]);
});
```

В `src/work-view.test.ts:53` заменить устаревший комментарий:

```ts
    // Manual acceptance keeps the reject path reachable.
```

В `src/setup.test.ts:88,90` заменить ожидание `autoAccept: true` на `autoAccept: false` (мастер теперь создаёт покрасочные операции с приёмкой владельцем).

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/workReview.test.tsx src/work-view.test.ts src/setup.test.ts`
Expected: FAIL — нет `TaskActionButton`/`WorkReview`, у строки задачи нет `defectQty`, `Jilolash.autoAccept` ещё `true`, чекбокса приёмки нет.

- [ ] **Step 3: Тексты — метки причин и переводы ошибок**

В `src/i18n.ts` добавить `DefectReason` в type-import из `./types`; после `payrollStatusLabel` вставить:

```ts
export const defectReasonLabels: Record<DefectReason, string> = {
  quality: 'Sifat nuqsoni',
  measurement: 'Noto‘g‘ri o‘lchov',
  drawing: 'Chizmadagi xato',
  customer: 'Mijoz topshirig‘i',
  other: 'Boshqa',
};

export function defectReasonLabel(reason: DefectReason): string {
  return defectReasonLabels[reason];
}
```

В `errorMessages` сразу после строки `/payment exceeds|advance exceeds/` вставить блок (до `/report exceeds|remaining.*quantity/` и до общего `/already …/`):

```ts
  [/invalid review decision/i, 'Qabul qarori noto‘g‘ri.'],
  [/review must be plain/i, 'Qabul qilishda brak maydonlari bo‘lishi mumkin emas.'],
  [/defect reason is required/i, 'Brak sababini tanlang.'],
  [/defect note is required/i, '«Boshqa» sababi uchun izoh yozing.'],
  [/defect note is too long/i, 'Brak izohi 500 belgidan oshmasligi mumkin.'],
  [/defect quantity is invalid/i, 'Brak miqdorini kiriting.'],
  [/nothing to reject/i, 'Brak miqdori nolga teng bo‘lishi mumkin emas.'],
  [/defect quantity exceeds report/i, 'Brak miqdori topshirilgan miqdordan oshmasligi mumkin.'],
```

- [ ] **Step 4: `defectQty` в строке задачи и подписи в терминале**

`src/work-view.ts`: после импортов добавить `const round2 = (value: number): number => Math.round(value * 100) / 100;`; в `WorkTaskRow` после `completed: number;` добавить `defectQty: number;`; в цикле `workTaskRows` перед `rows.push` вычислить:

```ts
      const defectQty = task.status === 'completed' ? 0 : round2(state.defects
        .filter(row => row.orderId === order.id && row.taskId === task.id && row.employeeId === task.employeeId)
        .reduce((sum, row) => sum + row.qty, 0));
```

и добавить `defectQty,` в объект строки после `completed: task.completed,`.

`src/components/WorkTasks.tsx`:
- Убрать импорт `payrollStatusLabel` и тип `PayrollEntry`; в импорт из `../work-view` добавить `type WorkHistoryRow`.
- Заменить `payrollLabels` на:

```ts
const reviewLabels: Record<WorkHistoryRow['status'], string> = {
  submitted: 'Tekshiruvda',
  accepted: 'Qabul qilingan',
  rejected: 'Brak',
};
```

- В карточке после `subtle-note` добавить:

```tsx
            {row.defectQty > 0 && <p className="info-note">Qayta ishlash · {num(row.defectQty)} {unitLabel(row.unit)} (brak)</p>}
```

- В истории заменить `<span className={`task-status ${row.payrollStatus}`}>{payrollLabels[row.payrollStatus]}</span>` на `<span className={`task-status ${row.status}`}>{reviewLabels[row.status]}</span>`.

- [ ] **Step 5: Компоненты кнопки и модалки**

Создать `src/components/TaskActionButton.tsx`:

```tsx
import type { RouteLine } from '../types';

export function TaskActionButton({ task, busy, available, onReview, onSubmit }: {
  task: RouteLine; busy: boolean; available: boolean; onReview: () => void; onSubmit: () => void;
}) {
  if (task.status === 'completed') return <button className="secondary" disabled>Tayyor</button>;
  if (task.status === 'submitted') return <button className="primary" disabled={busy} onClick={onReview}>Qabul qilish</button>;
  return <button className="secondary" disabled={busy || !available || task.status !== 'in_progress'} onClick={onSubmit}>{task.status === 'in_progress' ? 'Natijani topshirish' : task.status === 'accepted' ? 'Xodim boshladi' : 'Bosqichni kutmoqda'}</button>;
}
```

Создать `src/components/WorkReview.tsx`:

```tsx
import { useState } from 'react';
import { defectMaterials } from '../domain';
import { defectReasonLabel } from '../i18n';
import { Dialog, Field, money, num } from '../ui';
import { executorLabel, taskUnit, unitLabel } from '../work-view';
import type { Command, DefectReason, State } from '../types';

const reasons: DefectReason[] = ['quality', 'measurement', 'drawing', 'customer', 'other'];
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function WorkReview({ state, orderId, taskId, busy, close, save }: {
  state: State; orderId: string; taskId: string; busy: boolean; close: () => void; save: (command: Command) => Promise<void>;
}) {
  const order = state.orders.find(row => row.id === orderId);
  const task = order?.route.find(row => row.id === taskId);
  const report = state.reports
    .filter(row => row.orderId === orderId && row.taskId === taskId && row.status === 'submitted')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const [defectQty, setDefectQty] = useState(0);
  const [reason, setReason] = useState<DefectReason>('quality');
  const [note, setNote] = useState('');
  if (!order || !task || !report) return null;
  const unit = taskUnit(state, task);
  const defect = Math.min(report.qty, Math.max(0, defectQty));
  const good = round2(report.qty - defect);
  const wasted = defect > 0
    ? defectMaterials(state, task, defect).reduce((sum, row) => sum + (state.items.find(item => item.id === row.itemId)?.cost ?? 0) * row.qty, 0)
    : 0;
  const cleanNote = note.trim();
  const blocked = defect > 0 && reason === 'other' && cleanNote.length === 0;
  const label = defect <= 0 ? 'Qabul qilish' : good > 0 ? `Qabul ${num(good)} · Brak ${num(defect)}` : 'Hammasi brak — qayta ishlash';
  const submit = () => {
    if (defect <= 0) return save({ type: 'work.review', reportId: report.id, accept: true });
    return save({ type: 'work.review', reportId: report.id, accept: false, defectQty: defect, reason, ...(cleanNote ? { note: cleanNote } : {}) });
  };
  return <Dialog title={`Qabul — ${task.name} · ${order.number}`} subtitle={`${order.title} · ${executorLabel(state, task)}`} close={() => { if (!busy) close(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="form-body">
        <div className="settings-facts">
          <span>Topshirilgan<b>{num(report.qty)} {unitLabel(unit)}</b></span>
          <span>Qolgan<b>{num(good)} {unitLabel(unit)}</b></span>
          <span>Stavka<b>{money(task.rate)} / {unitLabel(unit)}</b></span>
          <span>Qabulda hisoblanadi<b>{money(round2(task.rate * good))}</b></span>
          <span>Brakda sarflangan material<b>{money(wasted)}</b></span>
        </div>
        <Field label="Brak miqdori">
          <input type="number" min="0" max={report.qty} step="0.001" value={defectQty || ''} onChange={event => setDefectQty(Number(event.target.value))} autoFocus />
        </Field>
        <Field label="Brak sababi">
          <select value={reason} onChange={event => setReason(event.target.value as DefectReason)}>{reasons.map(row => <option key={row} value={row}>{defectReasonLabel(row)}</option>)}</select>
        </Field>
        <Field label="Izoh"><input maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder={reason === 'other' ? 'Sababni yozing — majburiy' : 'Ixtiyoriy'} /></Field>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" onClick={close} disabled={busy}>Bekor qilish</button>
        <button className="primary" disabled={busy || blocked}>{busy ? 'Saqlanmoqda…' : label}</button>
      </footer>
    </form>
  </Dialog>;
}
```

- [ ] **Step 6: Интеграция в `App.tsx`**

Добавить импорты рядом с `WorkTasks`:

```tsx
import { TaskActionButton } from './components/TaskActionButton';
import { WorkReview } from './components/WorkReview';
```

После `const active = …` (:496) добавить:

```ts
  const reviewCount = state.orders.filter(o => o.status === 'production')
    .reduce((sum, o) => sum + o.route.filter(t => t.executorKind === 'employee' && t.status === 'submitted').length, 0);
```

Заменить `const myTasks = admin ? active.length : workTaskRows(state, actor).length;` (:515) на:

```ts
  const myTasks = admin ? active.length + reviewCount : workTaskRows(state, actor).length;
```

В доске производства заменить кнопку сотрудника (:597-601) на:

```tsx
        : <TaskActionButton task={t} busy={busy} available={available} onReview={() => show('workReview', `${o.id}:${t.id}`)} onSubmit={() => show('work', `${o.id}:${t.id}`)} />}</article>; })}
```

В заголовке раздела заменить `qismiy bajarish va avtomatik qabul` на `qismiy bajarish va qabul` (:596).

В модалке `work` (:726) заменить безусловный note на:

```tsx
<div className="info-note">{state.operations.find(row => row.id === task.operationId)?.autoAccept ? 'Natija topshirilgan zahoti qabul qilinadi va stavka bo‘yicha ish haqi darhol hisoblanadi.' : 'Natija egasi tomonidan tekshiriladi. Ish haqi qabuldan keyin hisoblanadi.'}</div>
```

Добавить модалку рядом с остальными явными модалками (после строки `modal?.type === 'cashBulk'`):

```tsx
    {modal?.type === 'workReview' && (() => { const [orderId, taskId] = (modal.id ?? '').split(':'); return <WorkReview state={state} orderId={orderId} taskId={taskId} busy={busy} close={() => setModal(null)} save={async command => { if (await run(command)) setModal(null); }} />; })()}
```

В список исключений общего `Dialog` (:699) добавить `'workReview'` после `'cashBulk'`:

```tsx
    {modal && !['setup', 'order', 'orderEdit', 'shipment', 'itemEdit', 'itemImport', 'employeeEdit', 'operationRate', 'purchase', 'stockSale', 'route', 'invoice', 'customerCard', 'supplierCard', 'cashBulk', 'workReview'].includes(modal.type) && <Dialog title={modalTitle(modal.type)} subtitle="Amal hisobdagi bog‘langan o‘zgarishlar bilan birga saqlanadi." close={() => { if (!busy) setModal(null); }}>
```

В `modalTitle` после `work: 'Ish natijasini topshirish',` добавить `workReview: 'Natijani qabul qilish',`.

- [ ] **Step 7: Переключатель приёмки в обеих формах и дефолты**

`src/components/QuickEditors.tsx` (`OperationRateEditor`):
- После `const [standardMinutes, setStandardMinutes] = useState(operation.standardMinutes);` добавить `const [autoAccept, setAutoAccept] = useState(operation.autoAccept);`
- В `save` заменить `autoAccept: true,` на `autoAccept,`.
- Перед `<div className="info-note">` добавить:

```tsx
        <label className="check-field"><input type="checkbox" checked={!autoAccept} onChange={event => setAutoAccept(!event.target.checked)} />Natijani egasi qabul qiladi</label>
        <p className="subtle-note">Yoqilmasa, natija topshirilganda darhol qabul qilinadi va ish haqi hisoblanadi.</p>
```

`src/components/CatalogSettings.tsx`:
- В `OperationDraft` после `active: boolean;` добавить `autoAccept: boolean;`.
- В `blankOperation` и `operationDraft` добавить `autoAccept: true` / `autoAccept: operation.autoAccept` рядом с `active`.
- В `saveOperation` заменить `autoAccept: true,` на `autoAccept: operation.autoAccept,`.
- Перед строкой `<label className="check-field">…Operatsiya faol…` добавить такой же чекбокс и hint, но с `setOperation`:

```tsx
          <label className="check-field"><input type="checkbox" checked={!operation.autoAccept} onChange={event => setOperation({ ...operation, autoAccept: !event.target.checked })} />Natijani egasi qabul qiladi</label>
          <p className="subtle-note">Yoqilmasa, natija topshirilganda darhol qabul qilinadi va ish haqi hisoblanadi.</p>
```

- Заменить `info-note` в форме операции (строка :145) на `<div className="info-note">Vaqt normasi va dastgoh maqsadi pulni hisobdan chiqarmaydi.</div>`.

`src/setup.ts:52,57` и `src/seed.ts:39-40`: четыре литерала `autoAccept: true` в командах `operation.create` для «Jilolash» и «Bo‘yash» заменить на `autoAccept: false`. Остальные `autoAccept` не трогать; `src/migrations.ts:33` остаётся `true`.

- [ ] **Step 8: Зелёный прогон**

Run: `npx vitest run src/workReview.test.tsx src/work-view.test.ts src/setup.test.ts src/domain.test.ts && npx tsc -b`
Expected: PASS, exit 0. Если `checked=""` в SSR выводится иначе, зафиксировать фактический вид атрибута в тесте, не ослабляя проверку до простого наличия метки.

---

### Task 9: Журнал брака `Brak tarixi` и панели раздела

**Files:**
- Create: `src/defect-view.ts`, `src/components/DefectJournal.tsx`
- Modify: `src/sections.ts` (`production` panels и `panelsFor`), `src/App.tsx` (импорт, секция `production`)
- Test: `src/workReview.test.tsx` (SSR-тест 20), `src/sections.test.ts`

**Interfaces:**
- Produces: `defectMonths(state): string[]`, `defectJournalRows(state, month, employeeId): DefectJournalRow[]`, `defectTotals(rows): DefectTotals`, компонент `DefectJournal({ state })`; для admin панели `production` — `['doska', 'brak']` с дефолтом `doska`, для worker — `[]`.
- Consumes: `State.defects` (Task 1), `DefectReason`/`DefectRow` (Task 1), `defectReasonLabel` (Task 8), семантика `work.review` (Tasks 3–4).

**Отклонение от буквы спецификации (осознанное):** §3.5-5 называет только панель `brak`. `PanelBar` скрывает полосу при `panels.length < 2` (`src/components/PanelBar.tsx`), а `defaultPanel` берёт первую панель, поэтому одна `brak` сделала бы журнал видом по умолчанию и спрятала доску. Добавляются две панели: `doska` («Sex doskasi») первой и `brak` второй; worker получает `[]`, чтобы его терминал и старые хэши `#/production` не менялись (`normalizeRoute` для worker остаётся `panel: ''`, тест `sections.test.ts:67` не правится). Доска рисуется при `panel !== 'brak'`.

- [ ] **Step 1: Написать падающие тесты**

В конец `src/workReview.test.tsx` добавить импорт `import { DefectJournal } from './components/DefectJournal';` и блок:

```tsx
describe('defect journal', () => {
  function paintingRejected() {
    let state = createDemo(admin);
    const order = state.orders.find(row => row.title === 'Fasadlarni bo‘yash · 12 m²')!;
    const task = order.route[0];
    state = run(state, { type: 'order.launch', orderId: order.id });
    state = run(state, { type: 'order.issue', orderId: order.id });
    state = run(state, { type: 'work.accept', orderId: order.id, taskId: task.id });
    state = run(state, { type: 'work.start', orderId: order.id, taskId: task.id });
    state = run(state, { type: 'work.submit', orderId: order.id, taskId: task.id, qty: 12, note: '' });
    const report = state.reports.find(row => row.taskId === task.id && row.status === 'submitted')!;
    state = run(state, { type: 'work.review', reportId: report.id, accept: false, defectQty: 3, reason: 'quality' });
    return { state, order };
  }

  it('renders the defect journal row and totals', () => {
    const { state, order } = paintingRejected();
    const html = renderToStaticMarkup(createElement(DefectJournal, { state }));
    for (const text of [
      'Brak tarixi', order.number, 'Jilolash', 'Sex ustasi', '3 m²', 'Sifat nuqsoni',
      'Abraziv doira P120', 'Brak (m²)', 'Material qiymati', 'Eng ko‘p brak',
    ]) expect(html).toContain(text);
  });
});
```

В `src/sections.test.ts` в блок `section panels` добавить:

```ts
it('adds the defect journal panel for the director only', () => {
  expect(panelsFor('production', true).map(panel => panel.id)).toEqual(['doska', 'brak']);
  expect(defaultPanel('production', true)).toBe('doska');
  expect(panelsFor('production', false)).toEqual([]);
  expect(defaultPanel('production', false)).toBe('');
});
```

- [ ] **Step 2: Убедиться, что тесты красные**

Run: `npx vitest run src/workReview.test.tsx src/sections.test.ts`
Expected: FAIL — `./components/DefectJournal` не существует; `panelsFor('production', true)` возвращает `[]`.

- [ ] **Step 3: Построитель строк журнала**

Создать `src/defect-view.ts`:

```ts
import type { DefectReason, OperationUnit, State } from './types';

export interface DefectMaterialRow { itemId: string; name: string; qty: number; amount: number }

export interface DefectJournalRow {
  id: string; createdAt: string; month: string; orderNumber: string; orderTitle: string;
  operationName: string; employeeName: string; qty: number; unit: OperationUnit;
  reason: DefectReason; note: string; materials: DefectMaterialRow[]; materialCost: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function defectMonths(state: State): string[] {
  return [...new Set(state.defects.map(row => row.createdAt.slice(0, 7)))].sort((left, right) => right.localeCompare(left));
}

export function defectJournalRows(state: State, month: string, employeeId: string): DefectJournalRow[] {
  return state.defects
    .filter(row => (!month || row.createdAt.slice(0, 7) === month) && (!employeeId || row.employeeId === employeeId))
    .map(row => {
      const order = state.orders.find(entry => entry.id === row.orderId);
      const operation = state.operations.find(entry => entry.id === row.operationId);
      const materials = row.materials.map(material => {
        const item = state.items.find(entry => entry.id === material.itemId);
        return { itemId: material.itemId, name: item?.name ?? material.itemId, qty: material.qty, amount: round2(material.qty * (item?.cost ?? 0)) };
      });
      return {
        id: row.id, createdAt: row.createdAt, month: row.createdAt.slice(0, 7),
        orderNumber: order?.number ?? '—', orderTitle: order?.title ?? '',
        operationName: operation?.name ?? '—',
        employeeName: state.employees.find(entry => entry.id === row.employeeId)?.name ?? '—',
        qty: row.qty, unit: operation?.unit ?? 'piece', reason: row.reason, note: row.note,
        materials, materialCost: round2(materials.reduce((sum, material) => sum + material.amount, 0)),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id));
}

export interface DefectTotals { squareMeters: number; materialCost: number; top: { name: string; qty: number } | null }

export function defectTotals(rows: DefectJournalRow[]): DefectTotals {
  const square = rows.filter(row => row.unit === 'squareMeter');
  const byEmployee = new Map<string, number>();
  for (const row of square) byEmployee.set(row.employeeName, (byEmployee.get(row.employeeName) ?? 0) + row.qty);
  let top: { name: string; qty: number } | null = null;
  for (const [name, qty] of byEmployee) if (!top || qty > top.qty) top = { name, qty };
  return {
    squareMeters: round2(square.reduce((sum, row) => sum + row.qty, 0)),
    materialCost: round2(rows.reduce((sum, row) => sum + row.materialCost, 0)),
    top: top ? { name: top.name, qty: round2(top.qty) } : null,
  };
}
```

- [ ] **Step 4: Компонент журнала**

Создать `src/components/DefectJournal.tsx`:

```tsx
import { useState } from 'react';
import { CircleAlert, Package, Users } from 'lucide-react';
import { Empty, Metric, Section, dateTime, money, num } from '../ui';
import { defectReasonLabel } from '../i18n';
import { defectJournalRows, defectMonths, defectTotals } from '../defect-view';
import { unitLabel } from '../work-view';
import type { State } from '../types';

const monthLabel = (key: string): string =>
  new Date(`${key}-02T00:00:00`).toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' });

export function DefectJournal({ state }: { state: State }) {
  const months = defectMonths(state);
  const [month, setMonth] = useState(months[0] ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const rows = defectJournalRows(state, month, employeeId);
  const totals = defectTotals(rows);
  const workers = state.employees.filter(employee => state.defects.some(row => row.employeeId === employee.id));
  return <Section
    title="Brak tarixi"
    hint="O‘zgarmas jurnal: miqdor, sabab va materialning normadagi bahosi. Bu summa hech kimning ish haqidan ushlanmaydi."
    action={<div className="section-tools">
      <select aria-label="Brak oyi filtri" value={month} onChange={event => setMonth(event.target.value)}>
        <option value="">Barcha oylar</option>
        {months.map(entry => <option key={entry} value={entry}>{monthLabel(entry)}</option>)}
      </select>
      <select aria-label="Brak xodimi filtri" value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
        <option value="">Barcha xodimlar</option>
        {workers.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
      </select>
    </div>}
  >
    <div className="metrics three">
      <Metric label="Brak (m²)" value={`${num(totals.squareMeters)} m²`} detail="Faqat metr kvadratdagi bosqichlar" icon={CircleAlert} accent />
      <Metric label="Material qiymati" value={money(totals.materialCost)} detail="Norma bo‘yicha yo‘qotilgan material" icon={Package} />
      <Metric label="Eng ko‘p brak" value={totals.top?.name ?? '—'} detail={totals.top ? `${num(totals.top.qty)} m²` : 'Bu davrda brak yo‘q'} icon={Users} />
    </div>
    {rows.length
      ? <div className="table-scroll cardable"><table>
          <thead><tr><th>Sana</th><th>Buyurtma</th><th>Operatsiya</th><th>Xodim</th><th className="right">Miqdor</th><th>Sabab</th><th>Sarflangan material</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <td data-label="Sana">{dateTime(row.createdAt)}</td>
            <td data-label="Buyurtma"><b>{row.orderNumber}</b><small>{row.orderTitle}</small></td>
            <td data-label="Operatsiya">{row.operationName}</td>
            <td data-label="Xodim">{row.employeeName}</td>
            <td data-label="Miqdor" className="right"><b>{num(row.qty)} {unitLabel(row.unit)}</b></td>
            <td data-label="Sabab">{defectReasonLabel(row.reason)}{row.note && <small>{row.note}</small>}</td>
            <td data-label="Sarflangan material">{row.materials.length
              ? <>{row.materials.map(material => <small key={material.itemId}>{material.name} · {num(material.qty)}</small>)}<b>{money(row.materialCost)}</b></>
              : <span className="muted">—</span>}</td>
          </tr>)}</tbody>
        </table></div>
      : <Empty text="Bu davrda brak qayd etilmagan" />}
  </Section>;
}
```

- [ ] **Step 5: Панели раздела и рендер в App**

`src/sections.ts`:
- Перед `registry` добавить:

```ts
const productionPanels: Panel[] = [
  { id: 'doska', title: 'Sex doskasi' },
  { id: 'brak', title: 'Brak tarixi' },
];
```

- В строке `production` реестра (:12) заменить `panels: []` на `panels: productionPanels`.
- В `panelsFor` (:23-26) добавить вторую строку:

```ts
  if (sectionId === 'production' && !admin) return [];
```

`src/App.tsx`:
- После `import { WorkTasks } from './components/WorkTasks';` (:24) добавить `import { DefectJournal } from './components/DefectJournal';`.
- В секции `production` заменить `<Title ... />` (:596) на:

```tsx
      <Title eyebrow={panel === 'brak' ? 'SEX / BRAK' : admin ? 'SEX / MONITORING' : 'SHAXSIY TERMINAL'} title={panel === 'brak' ? 'Brak tarixi va yo‘qotilgan material.' : admin ? 'Materialdan natijagacha.' : `Sizning topshiriqlaringiz, ${actor.name}.`} description={panel === 'brak' ? 'Qayta ishlash talab qilgan miqdor, sabab va sarflangan materialning bahosi. Hech kimning ish haqidan ushlanmaydi.' : 'Ketma-ket bosqichlar, qismiy bajarish va qabul. Stavka mijoz narxiga teng emas.'} />
```

- В той же секции заменить начало доски `      {admin ? <div className="production-board">` на `      {panel !== 'brak' && <>{admin ? <div className="production-board">`.
- Заменить хвост `: <WorkTasks state={state} actor={actor} busy={busy} run={run} />}{admin && !state.orders.some(o => o.status === 'production') && <Empty text="Faol topshiriqlar yo‘q. CRMdan buyurtmani ishga tushiring." />}` на тот же хвост с закрытием фрагмента и новой строкой:

```tsx
        : <WorkTasks state={state} actor={actor} busy={busy} run={run} />}{admin && !state.orders.some(o => o.status === 'production') && <Empty text="Faol topshiriqlar yo‘q. CRMdan buyurtmani ishga tushiring." />}</>}
      {admin && panel === 'brak' && <DefectJournal state={state} />}
```

- [ ] **Step 6: Зелёный прогон**

Run: `npx vitest run src/workReview.test.tsx src/sections.test.ts && npx tsc -b`
Expected: PASS, exit 0.

### Task 10: Финальная проверка P1 и передача владельцу

**Files:**
- Create: нет
- Modify: нет
- Test: полный прогон существующих тестов, PGlite-зонд, демо-браузер

**Interfaces:**
- Consumes: всё, что создали задачи 1–9: `src/defect-view.ts`, `src/components/DefectJournal.tsx`, `supabase/migrations/20261115_defects.sql`, `.validation-pglite-20261029/validate-defects.mjs`.
- Produces: пакет передачи владельцу (файл миграции, preflight, проверочный SQL) и решение «P1 готов к выкату». Живой SQL и deploy в этой задаче **не выполняются** — только по отдельному явному разрешению владельца.

- [ ] **Step 1: Полный статический и тестовый прогон**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: exit 0; ни одного упавшего теста; сборка Vite завершается без предупреждений о неразрешённых импортах.

- [ ] **Step 2: PGlite-зонд паритета**

Run: `node .validation-pglite-20261029/validate-defects.mjs`
Expected: `PASS` по всем сценариям зонда: `schema.sql` + миграция применяются дважды (идемпотентность), старый UNIQUE снят, `work.submit`/`work.review` с браком и снимок с массивом `defects` совпадают с доменом.

- [ ] **Step 3: Демо-проверка в браузере**

Run: `npm run dev`
Сценарий (демо-режим, пустые `VITE_SUPABASE_*`):
1. Войти владельцем, открыть `Ishlab chiqarish` — появились две вкладки: `Sex doskasi` и `Brak tarixi`; по умолчанию открыта `Sex doskasi`, доска рисуется как раньше.
2. Открыть заказ «Fasadlarni bo‘yash · 12 m²», принять и начать «Jilolash», сдать 12 m².
3. В очереди приёмки открыть отчёт, оставить 9 m², брак 3 m², причина «Sifat nuqsoni», заметка — принять. В заказе осталось 3 m², в журнале появилась строка.
4. Пересдать оставшиеся 3 m², принять полностью — заказ уходит дальше по маршруту, брак в журнале не дублируется.
5. Открыть вкладку `Brak tarixi`: `Brak (m²)` = 3, `Eng ko‘p brak` = ваша фамилия, строка содержит `Jilolash`, `Sex ustasi`, `3 m²`, `Sifat nuqsoni`, `Abraziv doira P120`, `12 000 so‘m`; фильтры по месяцу и сотруднику работают.
6. Войти сотрудником: вкладок нет, терминал показывает прежние карточки; после ручной приёмки (`autoAccept: false`) в бригаде видна метка «Qayta ishlash · 3 m² (brak)» только у отправителя брака.

Expected: все пункты совпадают; ошибок в консоли браузера нет.

- [ ] **Step 4: Пакет передачи владельцу (без выполнения)**

Подготовить и передать владельцу:
- Файл: `supabase/migrations/20261115_defects.sql`.
- Preflight в Supabase SQL Editor (только одинарные кавычки):

```sql
select to_regclass('public.erp_defects') as defects_table,
       exists (
         select 1 from pg_constraint
         where conrelid = 'public.erp_work_reports'::regclass
           and conname = 'erp_work_reports_company_id_order_id_task_id_employee_id_key'
       ) as old_unique_present;
```

Expected: `defects_table` = null, `old_unique_present` = true — миграция ещё не применялась.
- Бэкап: Dashboard → Database → Backups (убедиться, что свежий ежедневный бэкап есть) перед `Run`.
- Применить миграцию в SQL Editor, дождаться `Success`.
- Проверочный SQL после `Run` (только одинарные кавычки):

```sql
select to_regclass('public.erp_defects') as defects_table;
select count(*) as defects_rows from public.erp_defects;
select position('defectQty' in pg_get_functiondef('public.erp_execute(uuid,bigint,jsonb)'::regprocedure)) > 0 as function_updated;
select exists (
  select 1 from pg_constraint
  where conrelid = 'public.erp_work_reports'::regclass
    and conname = 'erp_work_reports_company_id_order_id_task_id_employee_id_key'
) as old_unique_present;
select position('defects' in pg_get_functiondef('public.erp_snapshot()'::regprocedure)) > 0 as snapshot_has_defects;
```

Expected: `defects_table` = `erp_defects`; `defects_rows` = 0; `function_updated` = true; `old_unique_present` = false; `snapshot_has_defects` = true.

`erp_snapshot()` намеренно не вызывается из SQL Editor: функция первым делом требует `auth.uid()` и в редакторе без JWT падает с `Authentication required`. Проверяем определение функции, а не её вызов.
- Только после «Success» владельца и отдельного разрешения — deploy: `npm run deploy` (Worker `erp-tizim`), затем проверить живой бандл: вход, раздел `Ishlab chiqarish`, обе вкладки, пустой журнал, терминал сотрудника.
- Откат P1 (если понадобится): `drop table public.erp_defects;` + восстановление прежних `create or replace function` из канонической схемы до миграции; данные отчётов и начислений не трогаются.

- [ ] **Step 5: Зафиксировать готовность**

Отметить в отчёте владельцу (на русском): P1 реализован, все проверки зелёные, миграция и проверочный SQL готовы; живые SQL и deploy ждут отдельного разрешения. Задачи #314 переводятся в готовые к выкату, #315 остаётся в работе до P2.

---

## Пакет P2 — частичная выдача материалов и перенос норм при ревизии (#315)

P2 выкатывается отдельно от P1. Фронтенд P2 и SQL `20261116_material_issued_qty.sql` едут вместе: новый фронтенд читает `issuedQty` из снимка, старый SQL его не отдаёт. Миграция P1 `20261115_defects.sql` должна быть применена раньше P2 — обе меняют одни и те же функции.

### Task 11: P2 — тип `MaterialLine.issuedQty` и хелпер `isIssued`

**Files:**
- Modify: `src/types.ts:28`
- Modify: `src/domain.ts` (хелпер после `exceeds`, конструкторы `:304`, `:326`, `:365`, `:1065`, все чтения `issued`)
- Modify: `src/migrations.ts:42-70`, `:168`, `:174`
- Modify: `src/shortage.ts:8`, `:14`, `:34`, `:43`, `:70`
- Modify: `src/order-editor.ts:7`, `:89`, `:112`
- Modify: `src/reports.ts:45`, `src/guide.ts:114`, `src/health.tsx:47`
- Modify: `src/App.tsx:584`, `:597`, `:679`
- Modify: `src/components/OrderEditor.tsx:173-182`, `src/components/OrderPositions.tsx:22`, `:31`, `src/components/SeriesList.tsx:41`, `:60`, `:62`
- Test: Create `src/material-issued.test.ts`
- Test fixtures: `src/history.test.ts:20`, `src/health.test.ts:164,221`, `src/order-editor.test.ts:96,103,179,207`, `src/domain.test.ts:683,686,693,1549,1787,1788,1856,1939,1940,2107,2573`, `src/sales.test.ts:37`, `src/documents.test.ts:34,78`, `src/reports.test.ts:86`, `src/shortage.test.ts:19-20,82,116-117,129,139,152,162-163,176,213`, `src/shortage-ui.test.tsx:16,21`, `src/setup.test.ts:115`, `src/statements.test.ts:19`

**Interfaces:**
- Consumes: `exceeds(value, limit)` (`src/domain.ts:47`) — допуск уже учитывает погрешность арифметики.
- Produces: `MaterialLine { id; lineId; itemId; qty; issuedQty; estimatedCost; actualCost }`; `isIssued(row: { qty: number; issuedQty: number }): boolean`; `PositionMaterial { itemId: string; qty: number; issuedQty: number }`; `DraftMaterial { itemId: string; qty: number; issuedQty: number }`.

Этот шаг чисто механический: поведение остаётся прежним «выдано всё или ничего». Частичные строки появятся только в Task 12, а корректная выдача/отмена/резерв частичных строк — в Task 13. Не добавляйте частичную логику раньше времени.

- [ ] **Step 1: RED — тест на `isIssued`**

Создать `src/material-issued.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isIssued } from './domain';

describe('isIssued', () => {
  it('treats a fresh row as not issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 0 })).toBe(false);
  });

  it('treats a partially issued row as not issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 3 })).toBe(false);
  });

  it('treats a fully issued row as issued', () => {
    expect(isIssued({ qty: 5, issuedQty: 5 })).toBe(true);
  });

  it('tolerates sub-milli overshoot from quantity arithmetic', () => {
    expect(isIssued({ qty: 5, issuedQty: 5.0000001 })).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что RED**

Run: `npx vitest run src/material-issued.test.ts`
Expected: FAIL — `isIssued` не экспортируется (или `SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Тип и хелпер**

`src/types.ts:28` заменить строку целиком:

```ts
export interface MaterialLine { id: string; lineId: string; itemId: string; qty: number; issuedQty: number; estimatedCost: number; actualCost: number }
```

В `src/domain.ts` сразу после `exceeds` (`:49`) добавить:

```ts
export function isIssued(row: { qty: number; issuedQty: number }): boolean {
  return !exceeds(row.qty, row.issuedQty);
}
```

`isIssued` намеренно не использует `===`: `quantity()` не округляет нормы, и `5.0000001` из `qtyPerM2 × planned` должен считаться полной выдачей.

- [ ] **Step 4: Домен — конструкторы и чтения**

Замены в `src/domain.ts` (все — точное совпадение строки):

| Строка | Было | Стало |
|---|---|---|
| `:304` | `issued: false, actualCost: 0` | `issuedQty: 0, actualCost: 0` |
| `:326` | `estimatedCost: item.cost, issued: false, actualCost: 0` | `estimatedCost: item.cost, issuedQty: 0, actualCost: 0` |
| `:346` | `current.filter(row => row.issued)` | `current.filter(row => row.issuedQty > 0)` |
| `:353` | `if (existing?.issued) return existing;` | `if (existing && existing.issuedQty > 0) return existing;` |
| `:365` | `issued: false, actualCost: 0` | `issuedQty: 0, actualCost: 0` |
| `:466` | `rows.every(row => row.issued)` | `rows.every(row => isIssued(row))` |
| `:496` | `line.itemId === itemId && !line.issued ? qty + line.qty : qty` | `line.itemId === itemId && line.issuedQty < line.qty ? qty + line.qty : qty` |
| `:571` | `row.issued ? round(row.qty * row.actualCost) : 0` | `isIssued(row) ? round(row.qty * row.actualCost) : 0` |
| `:606` | `row.issued ? round(row.qty * row.actualCost) : 0` | `isIssued(row) ? round(row.qty * row.actualCost) : 0` |
| `:656` | `.every(row => row.issued)` | `.every(row => isIssued(row))` |
| `:677` | `.some(row => !row.issued)` | `.some(row => !isIssued(row))` |
| `:694` | `.some(row => !row.issued)` | `.some(row => !isIssued(row))` |
| `:776` | `.every(row => row.issued)` | `.every(row => isIssued(row))` |
| `:1035` | `materials.every(row => row.issued)` | `materials.every(row => isIssued(row))` |
| `:1065` | `issued: false, actualCost: 0` | `issuedQty: 0, actualCost: 0` |
| `:1091` | `check(!row.issued, 'Material already issued');` | `check(row.issuedQty === 0, 'Material already issued');` |
| `:1110` | `.filter(row => !row.issued)` | `.filter(row => !isIssued(row))` |
| `:1125` | `row.issued = true;` | `row.issuedQty = row.qty;` |
| `:1135` | `order.materials.filter(row => row.issued)` | `order.materials.filter(row => row.issuedQty > 0)` |
| `:1141` | `row.issued = false;` | `row.issuedQty = 0;` |
| `:1158` | `lineMaterials(order, line.id).filter(row => row.issued)` | `lineMaterials(order, line.id).filter(row => row.issuedQty > 0)` |
| `:1240` | `order.materials.every(row => row.issued)` | `order.materials.every(row => isIssued(row))` |
| `:1546` | `.every(row => row.issued)` | `.every(row => isIssued(row))` |

Важно: в `order.issue` движение склада по-прежнему создаётся на `row.qty` — на этом шаге частичной выдачи ещё нет. В `order.cancel`/`orderLine.cancel` возврат тоже на `row.qty`.

- [ ] **Step 5: Миграция кэша и снимков**

В `src/migrations.ts` в импорт типов (`:1-3`) добавить `MaterialLine`:

```ts
import type {
  CashEntry, Customer, Employee, Item, Machine, MaterialLine, Operation, Order, OrderLine, PayrollEntry, Purchase, RouteTemplate, Shipment, ShipmentLine, State, SupportTicket, WorkReport,
} from './types';
```

`:67` заменить:

```ts
      materials: (order.materials ?? []).map(row => {
        const legacy = row as MaterialLine & { issued?: boolean };
        const { issued: legacyIssued, ...rest } = legacy;
        return {
          ...rest,
          lineId: row.lineId ?? first,
          issuedQty: typeof legacy.issuedQty === 'number' ? legacy.issuedQty : legacyIssued ? row.qty : 0,
        };
      }),
```

`:168` — `order.materials.every(row => row.issued)` → `order.materials.every(row => row.issuedQty >= row.qty)`.

`:174` — `line.issued ? line.qty * line.actualCost : 0` → `line.issuedQty >= line.qty ? line.qty * line.actualCost : 0`.

`migrations.ts` не импортирует `isIssued` из `./domain`: `domain.ts` уже импортирует `DEMO_COMPANY_ID` из `./migrations`, обратный импорт создал бы цикл. Локальное сравнение `issuedQty >= qty` здесь и есть контракт бэкфилла.

- [ ] **Step 6: Черновики смет — `shortage.ts` и `order-editor.ts`**

`src/shortage.ts:8`:

```ts
export type DraftMaterial = { itemId: string; qty: number; issuedQty: number };
```

`:14` — `line.itemId === itemId && !line.issued ? qty + line.qty : qty` → `line.itemId === itemId && line.issuedQty < line.qty ? qty + line.qty : qty`.

`:34` — `if (line.issued || !line.itemId) continue;` → `if (line.issuedQty >= line.qty || !line.itemId) continue;`.

`:43` — `issued: row.issued` → `issuedQty: row.issuedQty`.

`:70` — `if (line.issued || !line.itemId) continue;` → `if (line.issuedQty >= line.qty || !line.itemId) continue;`.

`src/order-editor.ts:7`:

```ts
export type PositionMaterial = { itemId: string; qty: number; issuedQty: number };
```

`:89` — `issued: row.issued` → `issuedQty: row.issuedQty`.

`:112` — `materials: position.materials.map(row => ({ ...row, issued: false })),` → `materials: position.materials.map(row => ({ ...row, issuedQty: 0 })),`.

`positionLines` (`:155`) менять не нужно: в команду по-прежнему уходят только `{ itemId, qty }`.

- [ ] **Step 7: Чтения в компонентах и отчётах**

| Файл | Было | Стало |
|---|---|---|
| `src/reports.ts:45` | `line.issued ? line.qty * line.actualCost : 0` | `line.issuedQty >= line.qty ? line.qty * line.actualCost : 0` |
| `src/guide.ts:114` | `order.materials.every(line => line.issued)` | `order.materials.every(line => line.issuedQty >= line.qty)` |
| `src/health.tsx:47` | `order.materials.some(line => !line.issued)` | `order.materials.some(line => line.issuedQty < line.qty)` |
| `src/App.tsx:584` | `o.materials.some(m => !m.issued)` | `o.materials.some(m => m.issuedQty < m.qty)` |
| `src/App.tsx:597` | `o.materials.some(m => !m.issued)` | `o.materials.some(m => m.issuedQty < m.qty)` |
| `src/App.tsx:679` | `order.materials.some(m => !m.issued)` | `order.materials.some(m => m.issuedQty < m.qty)` |
| `src/components/OrderPositions.tsx:22` | `materials.some(row => !row.issued)` | `materials.some(row => row.issuedQty < row.qty)` |
| `src/components/OrderPositions.tsx:31` | `row.issued ? ' · berilgan'` | `row.issuedQty >= row.qty ? ' · berilgan'` |
| `src/components/SeriesList.tsx:41` | `order.materials.filter(line => line.issued).length` | `order.materials.filter(line => line.issuedQty >= line.qty).length` |
| `src/components/SeriesList.tsx:62` | `line.issued ? 'berilgan'` | `line.issuedQty >= line.qty ? 'berilgan'` |
| `src/components/OrderEditor.tsx:173` | `{ itemId: '', qty: 1, issued: false }` | `{ itemId: '', qty: 1, issuedQty: 0 }` |
| `src/components/OrderEditor.tsx:177` | `disabled={row.issued}` | `disabled={row.issuedQty > 0}` |
| `src/components/OrderEditor.tsx:180` | `disabled={row.issued}` | `disabled={row.issuedQty > 0}` |
| `src/components/OrderEditor.tsx:181` | `disabled={row.issued}` | `disabled={row.issuedQty > 0}` |
| `src/components/OrderEditor.tsx:182` | `{row.issued && ...}` | `{row.issuedQty > 0 && ...}` |

`SeriesList.tsx:60` условие `issued < order.materials.length` не меняется — `issued` уже посчитан по-новому.

- [ ] **Step 8: Фикстуры тестов**

Правило: `issued: false` → `issuedQty: 0`; `issued: true` → `issuedQty: <qty той же строки>`. Точные места:

- `src/history.test.ts:20` — `issuedQty: 2`.
- `src/health.test.ts:164` — `issuedQty: 5`; `:221` — `issuedQty: 0`.
- `src/order-editor.test.ts:96` — `{ itemId: fixture.itemId, qty: 3, issuedQty: 3 }`; `:103` — `issuedQty: 1`; `:179` — `issuedQty: 0`; `:207` — `{ itemId: '', qty: 2, issuedQty: 0 }`.
- `src/domain.test.ts`:
  - `:683` — `row => row.issuedQty === 0`;
  - `:686` — `row => row.issuedQty === row.qty`;
  - `:693` — `row => row.issuedQty === 0 && row.actualCost === 0`;
  - `:1549` — `issuedQty: 0`;
  - `:1787` — `issuedQty: 10`;
  - `:1788` — `issuedQty: 0`;
  - `:1856` — `row.issuedQty === 0 && row.actualCost === 0`;
  - `:1939` — `row.issuedQty === row.qty`;
  - `:1940` — `row.issuedQty < row.qty`;
  - `:2107` — `{ issuedQty: 3, qty: 3 }`;
  - `:2573` — `expect(paint.issuedQty).toBe(0);`.
- `src/sales.test.ts:37` — `issuedQty: 1`.
- `src/documents.test.ts:34` — `issuedQty: 2`; `:78` — `issuedQty: 0`.
- `src/reports.test.ts:86` — `issuedQty: 1`.
- `src/shortage.test.ts`:
  - `:19-20` хелпер — `function material(id: string, itemId: string, qty: number, issuedQty = 0, lineId = 'L1'): MaterialLine` и поле `issuedQty`;
  - `:82` — `.filter(line => line.issuedQty < line.qty)`;
  - `:116`, `:117`, `:129`, `:139`, `:152`, `:162`, `:163`, `:176` — `issuedQty: 0`;
  - `:213` — `.filter(row => row.itemId === paintId && row.issuedQty < row.qty)`.
- `src/shortage-ui.test.tsx:16,21` — `issuedQty: 0`.
- `src/setup.test.ts:115` — `line.issuedQty === 0`.
- `src/statements.test.ts:19` — `issuedQty: 2`.

`src/migrations.test.ts:47,92,116` не трогать: это намеренно старые JSON-снимки `Record<string, unknown>` с `issued: true`, они проверяют бэкфилл. `src/analytics.test.ts:76` и `src/analytics.ts:81` (`issuedQty` складской метрики) не связаны с `MaterialLine` — не трогать.

- [ ] **Step 9: GREEN — focused проверки**

Run: `npx vitest run src/material-issued.test.ts src/domain.test.ts src/migrations.test.ts src/shortage.test.ts src/order-editor.test.ts`
Expected: все зелёные, включая round-trip `migrateState(migrated)` в `migrations.test.ts`.

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 10: Гейт остатков старого поля**

Run: `rg -n "\.issued\b" src`
Expected: пусто.

Run: `rg -n "issued: (true|false)" src --glob '!src/migrations.test.ts'`
Expected: пусто (единственное легальное `issued:` — деструктуризация `{ issued: legacyIssued, ...rest }` в `src/migrations.ts`).

- [ ] **Step 11: Полный прогон**

Run: `npx vitest run`
Expected: все файлы и тесты зелёные; количество тестов выросло на 4.

---

### Task 12: P2 — частичная выдача в ревизии и перенос норм (`normDelta`)

**Files:**
- Modify: `src/domain.ts` (`round3`, `revisionMaterials:343-367`, `revisionLines:440-479`, `order.update:995-1041`)
- Test: Create `src/norm-delta.test.ts`
- Test: Modify `src/domain.test.ts:1796-1812` (снять ожидание отказа при уменьшении выданной строки)

**Interfaces:**
- Consumes: `isIssued` (Task 11), `lineMaterials`, `lineRoute`, `quantity`, `round`, `normMaterialLines`.
- Produces: `normDelta(state: State, lineId: string, materials: MaterialLine[], previous: RouteLine[], next: RouteLine[]): MaterialLine[]` — мутирует и возвращает переданный массив `materials`. `revisionMaterials` больше не бросает ошибку при уменьшении `qty` у выданной строки, а прижимает её к `issuedQty`.

- [ ] **Step 1: RED — тест на прижим выданной строки**

Создать `src/norm-delta.test.ts` (полный файл):

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState, reservedQty } from './domain';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'admin', name: 'Admin', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function paintWorld() {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Painter' });
  state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
  state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
  state = run(state, { type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: 100, note: '' });
  state = run(state, { type: 'inventory.count', itemId: state.items[1].id, qty: 100, note: '' });
  return state;
}

const createInput = (state: State, qty: number) => ({
  kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
  materials: [] as { itemId: string; qty: number }[],
  route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty }],
});

function updateCommand(state: State, overrides: Partial<Extract<Command, { type: 'order.update' }>> = {}): Extract<Command, { type: 'order.update' }> {
  const order = state.orders[0];
  return {
    type: 'order.update', orderId: order.id, title: order.title, qty: order.qty, price: order.price,
    overhead: order.overhead, dueDate: order.dueDate,
    materials: order.materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    route: order.route.map(task => ({
      operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id, qty: task.planned,
    })),
    ...overrides,
  };
}

function launched(qty: number) {
  let state = paintWorld();
  state = run(state, { type: 'order.create', input: createInput(state, qty) });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return { state, orderId };
}

describe('revision keeps issued quantities', () => {
  it('clamps a submitted quantity to what was already issued', () => {
    let { state, orderId } = launched(10);
    state = run(state, updateCommand(state, { materials: state.orders[0].materials.map(line => ({ itemId: line.itemId, qty: 1 })) }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.issuedQty).toBe(2);
    expect(paint.actualCost).toBe(100);
    expect(state.orders[0].status).toBe('production');
    expect(state.orders[0].id).toBe(orderId);
  });
});

describe('norm delta on revision', () => {
  it('grows norm materials by the stage delta and leaves issued quantity', () => {
    let { state } = launched(10);
    expect(state.orders[0].materials.find(row => row.itemId === state.items[0].id)!.qty).toBe(2);
    expect(state.orders[0].materials.find(row => row.itemId === state.items[1].id)!.qty).toBe(1);
    state = run(state, updateCommand(state, {
      qty: 1,
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
      materials: state.orders[0].materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    const hardener = state.orders[0].materials.find(row => row.itemId === state.items[1].id)!;
    expect(paint.qty).toBe(4);
    expect(paint.issuedQty).toBe(2);
    expect(hardener.qty).toBe(2);
    expect(hardener.issuedQty).toBe(1);
  });

  it('shrinks norm materials and clamps them at issued quantity', () => {
    let { state } = launched(10);
    state = run(state, updateCommand(state, {
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 4, taskId: state.orders[0].route[0].id }],
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === state.items[0].id)!;
    expect(paint.qty).toBe(2);
    expect(paint.issuedQty).toBe(2);
    expect(reservedQty(state, state.items[0].id)).toBe(0);
  });

  it('is idempotent when the same revision is submitted twice', () => {
    let { state } = launched(10);
    const route = [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }];
    state = run(state, updateCommand(state, { route }));
    const once = state.orders[0].materials.map(row => row.qty);
    state = run(state, updateCommand(state, { route }));
    expect(state.orders[0].materials.map(row => row.qty)).toEqual(once);
  });

  it('removes norm material when its stage is removed and nothing was issued', () => {
    let state = paintWorld();
    state = run(state, { type: 'order.create', input: createInput(state, 10) });
    const cut = state.operations[1];
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    expect(state.orders[0].materials).toHaveLength(2);
    state = run(state, updateCommand(state, {
      route: [{ operationId: cut.id, employeeId: state.employees[0].id, rate: 2, qty: 10 }],
    }));
    expect(state.orders[0].materials).toEqual([]);
  });

  it('stacks a hand-entered row with the norm delta', () => {
    let { state } = launched(10);
    const paintId = state.items[0].id;
    state = run(state, updateCommand(state, {
      route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
      materials: state.orders[0].materials.map(line => line.itemId === paintId ? { itemId: line.itemId, qty: 5 } : { itemId: line.itemId, qty: line.qty }),
    }));
    const paint = state.orders[0].materials.find(row => row.itemId === paintId)!;
    expect(paint.qty).toBe(7);
    expect(paint.issuedQty).toBe(2);
  });
});
```

- [ ] **Step 2: Убедиться, что RED**

Run: `npx vitest run src/norm-delta.test.ts`
Expected: FAIL — уменьшение выданной строки бросает `Issued material quantity cannot change`, роста по норме нет.

- [ ] **Step 3: `round3`**

В `src/domain.ts` сразу после `round` (`:28`) добавить:

```ts
function round3(value: number): number {
  check(Number.isFinite(value), 'Number is invalid');
  const rounded = Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}
```

`quantity()` не округляет, `round()` — денежное 2dp с лимитом 1e12; для норм нужен отдельный 3dp без денежного лимита.

- [ ] **Step 4: `revisionMaterials` — прижим вместо отказа**

`:343-367` заменить на:

```ts
function revisionMaterials(state: State, order: Order, lines: OrderMaterialInput[], lineId: string): MaterialLine[] {
  unique(lines.map(row => row.itemId), 'material');
  const current = lineMaterials(order, lineId);
  for (const line of current.filter(row => row.issuedQty > 0)) {
    const next = lines.find(row => row.itemId === line.itemId);
    check(next, 'Issued material cannot be removed');
  }
  return lines.map(line => {
    const existing = current.find(row => row.itemId === line.itemId);
    if (existing && existing.issuedQty > 0) {
      quantity(line.qty, true);
      existing.qty = quantity(Math.max(line.qty, existing.issuedQty));
      return existing;
    }
    const item = find(state.items, line.itemId, 'Item');
    check(item.customerId === null || item.customerId === order.customerId, 'Material belongs to another customer');
    if (item.customerId !== null) find(state.customers, item.customerId, 'Customer');
    const qty = quantity(line.qty);
    const estimatedCost = item.customerId === null ? item.cost : 0;
    round(qty * estimatedCost);
    if (existing) {
      existing.qty = qty;
      existing.estimatedCost = estimatedCost;
      return existing;
    }
    return { id: uuid(), lineId, itemId: item.id, qty, estimatedCost, issuedQty: 0, actualCost: 0 };
  });
}
```

`quantity(line.qty, true)` валидирует вход (включая отказ при отрицательном), а `quantity(Math.max(...))` уже не даст ноль, потому что `issuedQty > 0`.

- [ ] **Step 5: `normDelta`**

Сразу после `revisionCostKept` (`:379`) добавить:

```ts
export function normDelta(state: State, lineId: string, materials: MaterialLine[], previous: RouteLine[], next: RouteLine[]): MaterialLine[] {
  const plannedByOperation = (route: RouteLine[]): Map<string, number> => {
    const totals = new Map<string, number>();
    for (const task of route) {
      if (task.lineId !== lineId) continue;
      totals.set(task.operationId, (totals.get(task.operationId) ?? 0) + task.planned);
    }
    return totals;
  };
  const before = plannedByOperation(previous);
  const after = plannedByOperation(next);
  for (const operationId of new Set([...before.keys(), ...after.keys()])) {
    const operation = state.operations.find(row => row.id === operationId);
    if (!operation || operation.unit !== 'squareMeter' || operation.norms.length === 0) continue;
    const shift = (after.get(operationId) ?? 0) - (before.get(operationId) ?? 0);
    if (shift === 0) continue;
    for (const norm of operation.norms) {
      const item = state.items.find(row => row.id === norm.itemId);
      if (!item || item.customerId !== null) continue;
      const delta = round3(norm.qtyPerM2 * shift);
      if (delta === 0) continue;
      const existing = materials.find(row => row.lineId === lineId && row.itemId === item.id);
      if (existing) {
        const nextQty = round3(existing.qty + delta);
        if (nextQty <= 0 && existing.issuedQty === 0) {
          materials.splice(materials.indexOf(existing), 1);
          continue;
        }
        existing.qty = Math.max(nextQty, existing.issuedQty);
        continue;
      }
      if (delta > 0) {
        materials.push({
          id: uuid(), lineId, itemId: item.id, qty: quantity(delta),
          estimatedCost: item.cost, issuedQty: 0, actualCost: 0,
        });
      }
    }
  }
  return materials;
}
```

Три обязательных свойства:
1. Функция работает с уже собранным массивом новых строк, а не с `order.materials`: `revisionLines` перезапишет `order.materials` в конце (`:476`).
2. `previousRoute` снимается **до** `routeRevision`: `routeRevision` не мутирует `order.route`, но полагаться на это не нужно.
3. Отрицательная дельта не удаляет строку, у которой уже есть выдача, — она прижимается к `issuedQty`.

- [ ] **Step 6: Подключить дельту в `revisionLines`**

`:460-468` заменить на:

```ts
    const rows = draft
      ? orderMaterials(state, input.materials, order.customerId, current.id)
      : revisionMaterials(state, order, input.materials, current.id);
    const previousRoute = lineRoute(order, current.id);
    const tasks = draft
      ? routeValues(state, input.route, qty, current.id)
      : routeRevision(state, order, input.route, qty, current.id);
    if (!draft) normDelta(state, current.id, rows, previousRoute, tasks);
    if (current.status === 'ready' && !(rows.every(row => isIssued(row)) && tasks.every(row => !exceeds(row.planned, row.completed)))) {
      current.status = 'production';
    }
```

- [ ] **Step 7: Подключить дельту в legacy-ветке `order.update`**

`:1019-1024` заменить на:

```ts
      const materials = draft
        ? orderMaterials(state, command.materials ?? [], order.customerId, line.id)
        : revisionMaterials(state, order, command.materials ?? [], line.id);
      const previousRoute = lineRoute(order, line.id);
      const route = draft
        ? routeValues(state, command.route ?? [], qty, line.id)
        : routeRevision(state, order, command.route ?? [], qty, line.id);
      if (!draft) normDelta(state, line.id, materials, previousRoute, route);
```

`:1034-1035` уже обновлён в Task 11 на `isIssued(row)`.

- [ ] **Step 8: Обновить старый тест отказа**

В `src/domain.test.ts:1796-1812` тест «rejects quantity below accepted work, issued material changes and started stage changes» больше не должен ждать отказа на `materials: [{ itemId: f.itemId, qty: 8 }]`: теперь строка прижимается к выданному количеству. Удалить строку `:1802`:

```ts
    atomic(state, revised(state, f.orderId, { materials: [{ itemId: f.itemId, qty: 8 }] }));
```

Остальные четыре отказа (количество ниже принятого, удаление выданного, удаление начатого этапа, смена ставки начатого этапа) остаются. Переименовать тест в `'rejects quantity below accepted work, removal of issued material and started stage changes'`.

- [ ] **Step 9: GREEN**

Run: `npx vitest run src/norm-delta.test.ts src/domain.test.ts`
Expected: зелёные.

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 10: Полный прогон**

Run: `npx vitest run`
Expected: все тесты зелёные.

---

### Task 13: P2 — выдача, отмена, резерв и себестоимость по `issuedQty`

**Files:**
- Modify: `src/domain.ts` (`reservedQty:494-498`, `order.launch:1081-1105`, `order.issue:1106-1129`, `order.cancel:1130-1147`, `orderLine.cancel:1148-1174`, `actualCost:569-575`, `orderShipmentLine:605-620`, `actualSeriesMaterialCost:784-786`)
- Modify: `src/shortage.ts` (`reservedExcept:12-15`, `orderShortage:31-38`, `draftShortage:63-75`)
- Modify: `src/reports.ts:45`, `src/migrations.ts:174`
- Test: Create `src/material-issue.test.ts`

**Interfaces:**
- Consumes: `isIssued`, `quantity`, `exceeds`, `stockQty`, `lineMaterials`.
- Produces: частичная выдача. `order.issue` двигает склад только на `qty − issuedQty` и ставит `issuedQty = qty`; отмена возвращает ровно `issuedQty`; резерв и дефицит считаются по остатку; фактическая себестоимость — `issuedQty × actualCost`.
- Guard `ready`/`workContext`/`shipment.create` не меняются: заказ и этап по-прежнему требуют полной выдачи (`isIssued`).

- [ ] **Step 1: RED — тест на частичную выдачу**

Создать `src/material-issue.test.ts` (полный файл):

```ts
import { describe, expect, it } from 'vitest';
import { actualCost, actualSeriesMaterialCost, applyCommand, emptyState, reservedQty, stockQty } from './domain';
import { orderShortage } from './shortage';
import type { Actor, Command, MaterialLine, State } from './types';

const admin: Actor = { id: 'admin', name: 'Admin', role: 'admin', companyId: emptyState().companyId };

function run(state: State, command: Command, actor = admin): State {
  return applyCommand(state, { requestId: crypto.randomUUID(), expectedRevision: state.revision, command }, actor);
}

function paintWorld(paint: number, hardener: number) {
  let state = emptyState();
  state = run(state, { type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
  state = run(state, { type: 'employee.create', name: 'Painter' });
  state = run(state, { type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null });
  state = run(state, { type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null });
  const employeeId = state.employees[0].id;
  state = run(state, { type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true, norms: [{ itemId: state.items[0].id, qtyPerM2: 0.2 }, { itemId: state.items[1].id, qtyPerM2: 0.1 }] });
  state = run(state, { type: 'inventory.count', itemId: state.items[0].id, qty: paint, note: '' });
  state = run(state, { type: 'inventory.count', itemId: state.items[1].id, qty: hardener, note: '' });
  return state;
}

const createInput = (state: State) => ({
  kind: 'product' as const, customerId: state.customers[0].id, title: 'Facade', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash' as const,
  materials: [] as { itemId: string; qty: number }[],
  route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 10 }],
});

function updateCommand(state: State, overrides: Partial<Extract<Command, { type: 'order.update' }>> = {}): Extract<Command, { type: 'order.update' }> {
  const order = state.orders[0];
  return {
    type: 'order.update', orderId: order.id, title: order.title, qty: order.qty, price: order.price,
    overhead: order.overhead, dueDate: order.dueDate,
    materials: order.materials.map(line => ({ itemId: line.itemId, qty: line.qty })),
    route: order.route.map(task => ({
      operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id, qty: task.planned,
    })),
    ...overrides,
  };
}

function launched(paint = 100, hardener = 100) {
  let state = paintWorld(paint, hardener);
  state = run(state, { type: 'order.create', input: createInput(state) });
  const orderId = state.orders[0].id;
  state = run(state, { type: 'order.launch', orderId });
  state = run(state, { type: 'order.issue', orderId });
  return { state, orderId };
}

function grow(state: State): State {
  return run(state, updateCommand(state, {
    route: [{ operationId: state.operations[0].id, employeeId: state.employees[0].id, rate: 20, qty: 20, taskId: state.orders[0].route[0].id }],
  }));
}

const rowFor = (state: State, index: number) => state.orders[0].materials.find(row => row.itemId === state.items[index].id)!;

describe('partial material issue', () => {
  it('issues only the remaining quantity on the second call', () => {
    let { state, orderId } = launched();
    expect(rowFor(state, 0)).toMatchObject({ qty: 2, issuedQty: 2, actualCost: 100 });
    expect(rowFor(state, 1)).toMatchObject({ qty: 1, issuedQty: 1, actualCost: 200 });
    state = grow(state);
    expect(rowFor(state, 0)).toMatchObject({ qty: 4, issuedQty: 2 });
    expect(rowFor(state, 1)).toMatchObject({ qty: 2, issuedQty: 1 });
    expect(state.movements.filter(row => row.source === 'order').map(row => row.qty)).toEqual([2, 1]);
    state = run(state, { type: 'order.issue', orderId });
    expect(state.movements.filter(row => row.source === 'order').map(row => row.qty)).toEqual([2, 1, 2, 1]);
    expect(rowFor(state, 0).issuedQty).toBe(4);
    expect(rowFor(state, 1).issuedQty).toBe(2);
  });

  it('reserves and reports shortage only for the unissued remainder', () => {
    let { state } = launched(3, 10);
    state = grow(state);
    expect(reservedQty(state, state.items[0].id)).toBe(2);
    expect(reservedQty(state, state.items[1].id)).toBe(1);
    const shortage = orderShortage(state, state.orders[0]);
    expect(shortage).toHaveLength(1);
    expect(shortage[0]).toMatchObject({ itemId: state.items[0].id, needed: 2, short: 1 });
  });

  it('pays only for the issued part in actual cost', () => {
    let { state, orderId } = launched();
    state = grow(state);
    expect(actualCost(state, state.orders[0])).toBe(400);
    state = run(state, { type: 'order.issue', orderId });
    expect(actualCost(state, state.orders[0])).toBe(800);
  });

  it('returns only the issued quantity when the order is cancelled', () => {
    let { state, orderId } = launched();
    state = grow(state);
    state = run(state, { type: 'order.issue', orderId });
    expect(stockQty(state, state.items[0].id)).toBe(96);
    state = run(state, { type: 'order.cancel', orderId });
    expect(stockQty(state, state.items[0].id)).toBe(100);
    expect(rowFor(state, 0).issuedQty).toBe(0);
    expect(rowFor(state, 0).actualCost).toBe(0);
  });

  it('counts only issued material in the series material cost', () => {
    const { state } = launched();
    const line: MaterialLine = { id: 'line', lineId: 'l', itemId: 'i', qty: 10, issuedQty: 4, estimatedCost: 100, actualCost: 100 };
    const order = { ...state.orders[0], materials: [line] };
    expect(actualSeriesMaterialCost(state, order)).toBe(400);
  });
});
```

- [ ] **Step 2: Убедиться, что RED**

Run: `npx vitest run src/material-issue.test.ts`
Expected: FAIL — второй `order.issue` бросает `All materials already issued`; склад возвращается на `qty`, а не на `issuedQty`; резерв и себестоимость считают полную строку.

- [ ] **Step 3: Резерв — только остаток**

`src/domain.ts:494-498` заменить на:

```ts
export function reservedQty(state: State, itemId: string): number {
  return state.orders.reduce((total, order) => order.status === 'production'
    ? total + order.materials.reduce((qty, line) => line.itemId === itemId && !isIssued(line)
      ? qty + (line.qty - line.issuedQty) : qty, 0)
    : total, 0);
}
```

- [ ] **Step 4: `order.issue` — движение на дельту**

`:1106-1129` заменить на:

```ts
    case 'order.issue': {
      const order = find(state.orders, command.orderId, 'Order');
      check(order.status === 'production', 'Only production orders can issue materials');
      const line = command.lineId === undefined ? undefined : orderLineOf(order, command.lineId);
      const pending = (line === undefined ? order.materials : lineMaterials(order, line.id)).filter(row => !isIssued(row));
      check(pending.length > 0, 'All materials already issued');
      for (const row of pending) {
        const item = find(state.items, row.itemId, 'Item');
        const delta = quantity(row.qty - row.issuedQty);
        check(item.customerId === null || item.customerId === order.customerId, 'Material belongs to another customer');
        check(!exceeds(reservedQty(state, item.id), stockQty(state, item.id)), 'Insufficient reserved stock');
        check(!exceeds(delta, stockQty(state, item.id)), 'Insufficient stock');
      }
      for (const row of pending) {
        const item = find(state.items, row.itemId, 'Item');
        const delta = quantity(row.qty - row.issuedQty);
        row.actualCost = item.customerId === null ? item.cost : 0;
        movement(state, {
          itemId: item.id, direction: 'out', qty: delta, unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: '',
        });
        row.issuedQty = row.qty;
      }
      ready(state, order);
      return order.id;
    }
```

`quantity(row.qty - row.issuedQty)` без `allowZero` намеренно: `pending` уже отфильтрован по `!isIssued`, а строка с `issuedQty > qty` невозможна; ноль здесь означал бы испорченные данные и должен падать.

- [ ] **Step 5: Отмена — возврат ровно `issuedQty`**

`order.cancel`, `:1135-1143` заменить на:

```ts
      for (const row of order.materials.filter(row => row.issuedQty > 0)) {
        find(state.items, row.itemId, 'Item');
        movement(state, {
          itemId: row.itemId, direction: 'in', qty: quantity(row.issuedQty), unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: 'Bekor qilingan buyurtma materiali qaytarildi',
        });
        row.issuedQty = 0;
        row.actualCost = 0;
      }
```

`orderLine.cancel`, `:1158-1164` заменить на:

```ts
      for (const row of lineMaterials(order, line.id).filter(row => row.issuedQty > 0)) {
        find(state.items, row.itemId, 'Item');
        movement(state, {
          itemId: row.itemId, direction: 'in', qty: quantity(row.issuedQty), unitCost: row.actualCost,
          source: 'order', sourceId: order.id, note: 'Bekor qilingan buyurtma materiali qaytarildi',
        });
      }
```

- [ ] **Step 6: Себестоимость — `issuedQty × actualCost` без булева гейта**

`actualCost` (`:569-575`):

```ts
export function actualCost(state: State, order: Order): number {
  return round(order.materials.reduce((total, row) =>
    total + round(row.issuedQty * row.actualCost), 0)
    + state.payroll.reduce((total, row) => row.orderId === order.id && row.status === 'accepted'
      ? total + row.amount : total, 0)
    + acceptedRouteCost(order));
}
```

`orderShipmentLine` (`:606`):

```ts
  const materialTotal = round(lineMaterials(order, line.id).reduce((sum, row) => sum + round(row.issuedQty * row.actualCost), 0));
```

`actualSeriesMaterialCost` (`:784-786`):

```ts
export function actualSeriesMaterialCost(state: State, order: Order): number {
  return round(order.materials.reduce((sum, line) => sum + round(line.issuedQty * line.actualCost), 0));
}
```

`src/reports.ts:45`:

```ts
      const actualMaterial = round(order.materials.reduce((sum, line) => sum + line.issuedQty * line.actualCost, 0));
```

`src/migrations.ts:174`:

```ts
  const material = order.materials.reduce((sum, line) => sum + line.issuedQty * line.actualCost, 0);
```

`actualCost`/`orderShipmentLine` вызываются только на заказах в статусе production/ready, где `actualCost` уже проставлен; `issuedQty = 0` даёт ноль без гейта. `legacyShipmentLine` в миграции работает уже после бэкфилла `issuedQty`.

- [ ] **Step 7: Дефицит и резерв в черновиках**

`src/shortage.ts:14` — `line.itemId === itemId && line.issuedQty < line.qty ? qty + line.qty : qty` → `line.itemId === itemId && line.issuedQty < line.qty ? qty + (line.qty - line.issuedQty) : qty`.

`:31-38` — цикл `orderShortage` заменить на:

```ts
  for (const line of order.materials) {
    if (line.issuedQty >= line.qty || !line.itemId) continue;
    needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
  }
```

`:68-72` — цикл `draftShortage` заменить на:

```ts
    for (const line of positionLines(state, position, position.id ?? `draft-${index}`, fromNorms)) {
      if (line.issuedQty >= line.qty || !line.itemId) continue;
      needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + (line.qty - line.issuedQty));
    }
```

- [ ] **Step 8: GREEN**

Run: `npx vitest run src/material-issue.test.ts src/norm-delta.test.ts src/material-issued.test.ts src/domain.test.ts src/shortage.test.ts`
Expected: зелёные.

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 9: Полный прогон**

Run: `npx vitest run`
Expected: все тесты зелёные. Существующие тесты отгрузки и себестоимости не должны измениться: в них строки полностью выданы, `issuedQty = qty`.

---

### Task 14: P2 — канонический SQL: `issued_qty` и `erp_norm_delta`

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: канонический `supabase/schema.sql` после P1 (Task 6). Все номера строк ниже — ориентиры до P1; якорем служит точный текст фрагмента.
- Produces: колонка `erp_order_materials.issued_qty` с CHECK-ами; `erp_revise_materials` с прижимом к `issued_qty`; новая `erp_norm_delta(p_company_id, p_order_id, p_line_id, p_customer_id, p_before jsonb, p_after jsonb)`; `erp_execute` вызывает её после `erp_revise_route` в обеих ветках `order.update`; снимок отдаёт `issuedQty` и совместимый `issued`; все защиты «материал не выдан» читают `issued_qty < qty`; выдача/отмена/себестоимость считают по `issued_qty`.

- [ ] **Step 1: Колонка и CHECK-и таблицы материалов**

В `CREATE TABLE public.erp_order_materials` заменить:

```sql
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  estimated_cost numeric NOT NULL CHECK (estimated_cost BETWEEN 0 AND 1000000000000 AND estimated_cost = round(estimated_cost, 2)),
  issued boolean NOT NULL DEFAULT false,
  actual_cost numeric NOT NULL DEFAULT 0 CHECK (actual_cost BETWEEN 0 AND 1000000000000 AND actual_cost = round(actual_cost, 2)),
```

на:

```sql
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
  issued_qty numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL CHECK (estimated_cost BETWEEN 0 AND 1000000000000 AND estimated_cost = round(estimated_cost, 2)),
  actual_cost numeric NOT NULL DEFAULT 0 CHECK (actual_cost BETWEEN 0 AND 1000000000000 AND actual_cost = round(actual_cost, 2)),
```

и заменить:

```sql
  CHECK (issued OR actual_cost = 0),
```

на:

```sql
  CONSTRAINT erp_order_materials_issued_qty_check CHECK (issued_qty >= 0 AND issued_qty <= qty AND issued_qty = round(issued_qty, 3)),
  CONSTRAINT erp_order_materials_issued_actual_check CHECK (issued_qty > 0 OR actual_cost = 0),
```

`issued_qty = round(issued_qty, 3)` повторяет округление норм `round3`; проверка `issued_qty <= qty` не даёт выдать больше потребности. Имена CHECK-ов нужны миграции Task 15, чтобы снимать и ставить их повторно.

- [ ] **Step 2: `erp_reserved_qty` резервирует остаток**

Заменить:

```sql
  SELECT coalesce(sum(m.qty), 0) FROM public.erp_order_materials m
  JOIN public.erp_orders o ON o.company_id = m.company_id AND o.id = m.order_id
  WHERE m.company_id = p_company_id AND m.item_id = p_item_id AND NOT m.issued AND o.status = 'production'
```

на:

```sql
  SELECT coalesce(sum(m.qty - m.issued_qty), 0) FROM public.erp_order_materials m
  JOIN public.erp_orders o ON o.company_id = m.company_id AND o.id = m.order_id
  WHERE m.company_id = p_company_id AND m.item_id = p_item_id AND o.status = 'production'
```

- [ ] **Step 3: `erp_revise_materials` — прижим вместо отказа**

Заменить функцию целиком (от `CREATE FUNCTION public.erp_revise_materials(` до ближайшего `$$;`) на:

```sql
CREATE FUNCTION public.erp_revise_materials(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_customer_id uuid, p_items jsonb, p_pos integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer := p_pos; v_id uuid; v_item public.erp_items%ROWTYPE; v_material public.erp_order_materials%ROWTYPE;
BEGIN
  v_line := public.erp_array(coalesce(p_items, '[]'::jsonb), 'materials');
  IF (SELECT count(*) FROM jsonb_array_elements(v_line)) <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'itemId', 'itemId')) FROM jsonb_array_elements(v_line) l) THEN
    RAISE EXCEPTION 'Duplicate material' USING ERRCODE = '22023';
  END IF;
  FOR v_material IN SELECT * FROM public.erp_order_materials
    WHERE company_id = p_company_id AND line_id = p_line_id AND issued_qty > 0 LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = v_material.item_id) THEN
      RAISE EXCEPTION 'Issued material cannot be removed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  DELETE FROM public.erp_order_materials m WHERE m.company_id = p_company_id AND m.line_id = p_line_id AND m.issued_qty = 0
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = m.item_id);
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_line) LOOP
    v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
    SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
    IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> p_customer_id THEN
      RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_material FROM public.erp_order_materials
      WHERE company_id = p_company_id AND line_id = p_line_id AND item_id = v_id;
    IF FOUND THEN
      UPDATE public.erp_order_materials SET position = v_pos, line_id = p_line_id,
        qty = CASE WHEN v_material.issued_qty > 0
          THEN greatest(public.erp_num(v_line -> 'qty', 'material qty', true), v_material.issued_qty)
          ELSE public.erp_num(v_line -> 'qty', 'material qty') END,
        estimated_cost = CASE WHEN v_material.issued_qty > 0 THEN v_material.estimated_cost
          WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END
        WHERE company_id = p_company_id AND id = v_material.id;
    ELSE
      INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
        VALUES (p_company_id, p_order_id, p_line_id, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
          CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
    END IF;
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_pos;
END;
$$;
```

Отличие от старой версии только в трёх местах: цикл замороженных строк читает `issued_qty > 0`; проверка равенства количества удалена (вместо неё `greatest(..., issued_qty)`); `DELETE` удаляет только строки с нулевой выдачей.

- [ ] **Step 4: новая `erp_norm_delta`**

Перед строкой `-- Revision of one position's route: accepted or reported stages freeze, the rest is rebuilt in the submitted order.` вставить:

```sql
-- Paint norms follow the routed area: a revised stage quantity moves square-metre materials by the difference.
CREATE FUNCTION public.erp_norm_delta(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_customer_id uuid, p_before jsonb, p_after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_norm record; v_rule record; v_before numeric; v_after numeric; v_delta numeric; v_qty numeric;
  v_pos integer; v_found boolean; v_material public.erp_order_materials%ROWTYPE; v_item public.erp_items%ROWTYPE;
BEGIN
  FOR v_norm IN
    SELECT o.id AS operation_id, o.norms FROM public.erp_operations o
    WHERE o.company_id = p_company_id AND o.unit = 'squareMeter' AND jsonb_array_length(o.norms) > 0
      AND o.id IN (
        SELECT public.erp_uuid(value -> 'operationId', 'operationId') FROM jsonb_array_elements(coalesce(p_before, '[]'::jsonb))
        UNION
        SELECT public.erp_uuid(value -> 'operationId', 'operationId') FROM jsonb_array_elements(coalesce(p_after, '[]'::jsonb)))
  LOOP
    SELECT coalesce(sum(public.erp_num(value -> 'planned', 'planned')), 0) INTO v_before
      FROM jsonb_array_elements(coalesce(p_before, '[]'::jsonb))
      WHERE public.erp_uuid(value -> 'operationId', 'operationId') = v_norm.operation_id;
    SELECT coalesce(sum(public.erp_num(value -> 'planned', 'planned')), 0) INTO v_after
      FROM jsonb_array_elements(coalesce(p_after, '[]'::jsonb))
      WHERE public.erp_uuid(value -> 'operationId', 'operationId') = v_norm.operation_id;
    IF v_after = v_before THEN CONTINUE; END IF;
    FOR v_rule IN SELECT public.erp_uuid(value -> 'itemId', 'itemId') AS item_id,
        public.erp_num(value -> 'qtyPerM2', 'qtyPerM2') AS per_m2
      FROM jsonb_array_elements(v_norm.norms) LOOP
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = p_company_id AND id = v_rule.item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL THEN CONTINUE; END IF;
      v_delta := round(v_rule.per_m2 * (v_after - v_before), 3);
      IF v_delta = 0 THEN CONTINUE; END IF;
      SELECT * INTO v_material FROM public.erp_order_materials
        WHERE company_id = p_company_id AND line_id = p_line_id AND item_id = v_rule.item_id FOR UPDATE;
      v_found := FOUND;
      IF v_delta > 0 THEN
        IF v_found THEN
          UPDATE public.erp_order_materials SET qty = round(v_material.qty + v_delta, 3)
            WHERE company_id = p_company_id AND id = v_material.id;
        ELSE
          SELECT coalesce(max(position) + 1, 0) INTO v_pos
            FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = p_line_id;
          INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
            VALUES (p_company_id, p_order_id, p_line_id, v_rule.item_id, v_pos, v_delta, v_item.cost);
        END IF;
      ELSIF v_found THEN
        v_qty := greatest(v_material.issued_qty, round(v_material.qty + v_delta, 3));
        IF v_qty <= 0 THEN
          DELETE FROM public.erp_order_materials WHERE company_id = p_company_id AND id = v_material.id;
        ELSE
          UPDATE public.erp_order_materials SET qty = v_qty WHERE company_id = p_company_id AND id = v_material.id;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
```

Свойства, которые обязаны совпасть с TS `normDelta` (Task 12): операция без норм или не `squareMeter` пропускается; клиентский материал пропускается; отсутствующая номенклатура пропускается; строка удаляется только при `qty + delta <= 0` и `issued_qty = 0`; строка с выдачей прижимается к `issued_qty`; повторная та же ревизия даёт `v_after = v_before` и ничего не меняет; ручная правка строки складывается с дельтой.

- [ ] **Step 5: защиты готовности и приёмки**

Заменить в `erp_ready`:

```sql
    IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_line.id AND NOT issued) THEN
```

на:

```sql
    IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_line.id AND issued_qty < qty) THEN
```

и себестоимость серии:

```sql
      SELECT round(coalesce(sum(round(m.qty * m.actual_cost, 2)), 0), 2) INTO v_material
        FROM public.erp_order_materials m WHERE m.company_id = p_company_id AND m.order_id = p_order_id AND m.issued;
```

на:

```sql
      SELECT round(coalesce(sum(round(m.issued_qty * m.actual_cost, 2)), 0), 2) INTO v_material
        FROM public.erp_order_materials m WHERE m.company_id = p_company_id AND m.order_id = p_order_id AND m.issued_qty > 0;
```

В `erp_work_task` заменить:

```sql
  IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_task.line_id AND NOT issued) THEN
```

на:

```sql
  IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = p_company_id AND line_id = v_task.line_id AND issued_qty < qty) THEN
```

В `work.review` (тело после Task 6 P1) заменить:

```sql
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND NOT issued) THEN
```

на:

```sql
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND issued_qty < qty) THEN
```

- [ ] **Step 6: `erp_assert_cash` — фактическая себестоимость по выдаче**

Заменить:

```sql
    OR o.overhead + coalesce((SELECT sum(round(m.qty * m.actual_cost, 2)) FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id AND m.issued), 0)
```

на:

```sql
    OR o.overhead + coalesce((SELECT sum(round(m.issued_qty * m.actual_cost, 2)) FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id AND m.issued_qty > 0), 0)
```

- [ ] **Step 7: снимок**

В `erp_snapshot` заменить:

```sql
        'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lineId', m.line_id, 'itemId', m.item_id, 'qty', m.qty,
          'estimatedCost', CASE WHEN v_admin THEN m.estimated_cost ELSE 0 END, 'issued', m.issued,
          'actualCost', CASE WHEN v_admin THEN m.actual_cost ELSE 0 END) ORDER BY m.position, m.id), '[]'::jsonb)
```

на:

```sql
        'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lineId', m.line_id, 'itemId', m.item_id, 'qty', m.qty,
          'issuedQty', m.issued_qty,
          'estimatedCost', CASE WHEN v_admin THEN m.estimated_cost ELSE 0 END, 'issued', m.issued_qty >= m.qty,
          'actualCost', CASE WHEN v_admin THEN m.actual_cost ELSE 0 END) ORDER BY m.position, m.id), '[]'::jsonb)
```

`issued` остаётся в снимке один релиз как совместимый ключ (`issuedQty >= qty`); `migrateState` в Task 11 его игнорирует и берёт `issuedQty`.

- [ ] **Step 8: переменные `erp_execute`**

В блоке `DECLARE` после строки `  v_line_status text;` добавить:

```sql
  v_old_tasks jsonb;
  v_new_tasks jsonb;
```

- [ ] **Step 9: дельта в многострочной ветке `order.update`**

Заменить:

```sql
          v_pos_material := public.erp_revise_materials(v_company, v_entity, v_line_id, v_order.customer_id,
            v_rec.definition -> 'materials', v_pos_material);
          v_pos_task := public.erp_revise_route(v_company, v_entity, v_line_id, v_qty,
            v_rec.definition -> 'route', v_pos_task);
```

на:

```sql
          v_pos_material := public.erp_revise_materials(v_company, v_entity, v_line_id, v_order.customer_id,
            v_rec.definition -> 'materials', v_pos_material);
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
          v_pos_task := public.erp_revise_route(v_company, v_entity, v_line_id, v_qty,
            v_rec.definition -> 'route', v_pos_task);
          IF v_line_status <> 'draft' THEN
            SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
              INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
            PERFORM public.erp_norm_delta(v_company, v_entity, v_line_id, v_order.customer_id, v_old_tasks, v_new_tasks);
          END IF;
```

и в повторной проверке готовности заменить:

```sql
          IF v_line_status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
              WHERE company_id = v_company AND line_id = v_line_id AND NOT issued)
```

на:

```sql
          IF v_line_status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
              WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
```

Дельта обязана выполняться **до** этой проверки: положительная дельта создаёт невыданную строку, и готовая позиция должна вернуться в `production`.

- [ ] **Step 10: дельта в legacy-ветке `order.update`**

Заменить:

```sql
        PERFORM public.erp_revise_materials(v_company, v_entity, v_line_row.id, v_order.customer_id,
          p_command -> 'materials', 0);
        PERFORM public.erp_revise_route(v_company, v_entity, v_line_row.id, v_qty, p_command -> 'route', 0);
```

на:

```sql
        PERFORM public.erp_revise_materials(v_company, v_entity, v_line_row.id, v_order.customer_id,
          p_command -> 'materials', 0);
        SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
          INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
        PERFORM public.erp_revise_route(v_company, v_entity, v_line_row.id, v_qty, p_command -> 'route', 0);
        IF v_line_row.status <> 'draft' THEN
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
          PERFORM public.erp_norm_delta(v_company, v_entity, v_line_row.id, v_order.customer_id, v_old_tasks, v_new_tasks);
        END IF;
```

и в проверке готовности заменить:

```sql
        IF v_line_row.status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND line_id = v_line_row.id AND NOT issued)
```

на:

```sql
        IF v_line_row.status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND line_id = v_line_row.id AND issued_qty < qty)
```

В этой ветке `v_line_row.status` прочитан до правок; черновик остаётся черновиком, `production`/`ready` получают дельту.

- [ ] **Step 11: `order.issue` выдаёт остаток**

Заменить:

```sql
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND NOT issued AND (v_line_id IS NULL OR line_id = v_line_id)) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND NOT issued AND (v_line_id IS NULL OR line_id = v_line_id) ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_order.customer_id THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        IF v_material.qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id, v_entity) THEN
          RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_material.qty,
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'order', v_entity, 'Production issue');
        UPDATE public.erp_order_materials SET issued = true,
          actual_cost = CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END WHERE id = v_material.id;
      END LOOP;
```

на:

```sql
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id)) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id) ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_order.customer_id THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        v_qty := v_material.qty - v_material.issued_qty;
        IF v_qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id, v_entity) THEN
          RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_qty,
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'order', v_entity, 'Production issue');
        UPDATE public.erp_order_materials SET issued_qty = qty,
          actual_cost = CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END WHERE id = v_material.id;
      END LOOP;
```

`v_qty` уже объявлена в `erp_execute`.

- [ ] **Step 12: отмена заказа и позиции**

В `order.cancel` заменить:

```sql
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND order_id = v_entity AND issued ORDER BY position LOOP
```

на:

```sql
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND order_id = v_entity AND issued_qty > 0 ORDER BY position LOOP
```

затем в том же блоке:

```sql
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
        UPDATE public.erp_order_materials SET issued = false, actual_cost = 0 WHERE id = v_material.id;
```

на:

```sql
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
        UPDATE public.erp_order_materials SET issued_qty = 0, actual_cost = 0 WHERE id = v_material.id;
```

В `orderLine.cancel` заменить:

```sql
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND line_id = v_line_id AND issued ORDER BY position LOOP
```

на:

```sql
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND line_id = v_line_id AND issued_qty > 0 ORDER BY position LOOP
```

и в движении:

```sql
          VALUES (v_company, v_material.item_id, 'in', v_material.qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
```

на:

```sql
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
```

Строки позиции ниже всё равно удаляются целиком (`DELETE ... line_id = v_line_id`), поэтому обнулять `issued_qty` не нужно.

- [ ] **Step 13: отгрузка**

В `shipment.create` заменить:

```sql
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id AND NOT issued)
```

на:

```sql
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
```

и:

```sql
        SELECT round(coalesce(sum(round(m.qty * m.actual_cost, 2)), 0), 2) INTO v_material_total
          FROM public.erp_order_materials m WHERE m.company_id = v_company AND m.line_id = v_line_id AND m.issued;
```

на:

```sql
        SELECT round(coalesce(sum(round(m.issued_qty * m.actual_cost, 2)), 0), 2) INTO v_material_total
          FROM public.erp_order_materials m WHERE m.company_id = v_company AND m.line_id = v_line_id AND m.issued_qty > 0;
```

- [ ] **Step 14: права новой функции**

В блоке `REVOKE ALL ON FUNCTION` добавить `erp_norm_delta` рядом с `erp_revise_materials`:

```sql
  public.erp_insert_materials(uuid, uuid, uuid, uuid, jsonb), public.erp_revise_materials(uuid, uuid, uuid, uuid, jsonb, integer),
  public.erp_norm_delta(uuid, uuid, uuid, uuid, jsonb, jsonb),
```

В `GRANT EXECUTE ON FUNCTION` её не добавлять: вызывается только из `erp_execute`.

- [ ] **Step 15: статические ворота**

Run: `rg -n "NOT issued" supabase/schema.sql`
Expected: пусто.

Run: `rg -n "m\\.issued\\b" supabase/schema.sql`
Expected: пусто (`m.issued_qty` не совпадает из-за `\\b` перед `_`).

Run: `rg -n "issued = (true|false)|SET issued\\b" supabase/schema.sql`
Expected: пусто.

Run: `rg -n "issued_qty" supabase/schema.sql`
Expected: не меньше 25 строк.

Run: `rg -n "erp_norm_delta" supabase/schema.sql`
Expected: определение функции, строка REVOKE и два вызова в `erp_execute`.

SQL-паритет докажет PGlite-зонд Task 15: здесь нет способа выполнить plpgsql без него.

---

### Task 15: P2 — генератор миграции `issued_qty` и PGlite-зонд

**Files:**
- Create: `.validation-pglite-20261029/generate-material-issued-qty.mjs`
- Create: `supabase/migrations/20261116_material_issued_qty.sql` (только генератором)
- Create: `.validation-pglite-20261029/validate-material-issued-qty.mjs`

**Interfaces:**
- Consumes: канонический `supabase/schema.sql` после Task 14 — имена функций `erp_reserved_qty`, `erp_revise_materials`, `erp_norm_delta`, `erp_ready`, `erp_work_task`, `erp_assert_cash`, `erp_snapshot`, `erp_execute`; имена CHECK-ов `erp_order_materials_issued_qty_check`, `erp_order_materials_issued_actual_check`.
- Produces: единственный SQL-файл P2, который владелец применяет вместе с выкатом P2-фронтенда; зонд доказывает апгрейд живой булевой колонки, идемпотентность, частичную выдачу, перенос норм, резерв, себестоимость и возврат при отмене.

- [ ] **Step 1: генератор**

Создать `.validation-pglite-20261029/generate-material-issued-qty.mjs`:

```js
// Canonical supabase/schema.sql is the only source of truth. This generator copies the final
// function bodies into one idempotent migration; the migration itself is never edited by hand.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const outputPath = new URL('supabase/migrations/20261116_material_issued_qty.sql', root);

const names = ['erp_reserved_qty', 'erp_revise_materials', 'erp_norm_delta', 'erp_ready', 'erp_work_task', 'erp_assert_cash', 'erp_snapshot', 'erp_execute'];
const stale = /\bNOT issued\b|\bm\.issued\b|issued = (true|false)|SET issued\b/;

function require(text, label) {
  if (!schema.includes(text)) throw new Error(`Canonical schema is missing ${label}`);
}

require('issued_qty numeric NOT NULL DEFAULT 0', 'erp_order_materials.issued_qty column');
require('CONSTRAINT erp_order_materials_issued_qty_check', 'issued qty check');
require('CONSTRAINT erp_order_materials_issued_actual_check', 'issued cost check');
require('sum(m.qty - m.issued_qty)', 'reserve counts the remainder');
require('greatest(public.erp_num(v_line -> \'qty\', \'material qty\', true), v_material.issued_qty)', 'revision clamp');
require("'issuedQty', m.issued_qty", 'snapshot issuedQty');
require("'issued', m.issued_qty >= m.qty", 'snapshot compat issued flag');
require('PERFORM public.erp_norm_delta', 'revision calls the norm delta');
require("IF v_line_status <> 'draft' THEN", 'draft lines skip the norm delta');
require('round(m.issued_qty * m.actual_cost, 2)', 'costs count the issued quantity');

function definition(name) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  const end = schema.indexOf('\n$$;', start);
  if (end < 0) throw new Error(`Unterminated function ${name}`);
  const body = schema.slice(start, end + 4);
  const inner = body.slice(body.indexOf('$$') + 2, body.length - 4);
  if (inner.includes('$$')) throw new Error(`Nested dollar quote in ${name}`);
  if (stale.test(body)) throw new Error(`Function ${name} still uses the boolean issued column`);
  return body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

const ddl = `-- Aliya ERP: materials carry a numeric issued quantity (issued_qty) instead of a boolean flag.
-- Safe to run more than once. On the live database it backfills issued_qty = qty for issued rows,
-- keeps actual_cost and drops the old boolean column.

BEGIN;

ALTER TABLE public.erp_order_materials ADD COLUMN IF NOT EXISTS issued_qty numeric;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'erp_order_materials' AND column_name = 'issued') THEN
    UPDATE public.erp_order_materials SET issued_qty = qty WHERE issued;
  END IF;
END;
$$;
UPDATE public.erp_order_materials SET issued_qty = 0 WHERE issued_qty IS NULL;
ALTER TABLE public.erp_order_materials ALTER COLUMN issued_qty SET DEFAULT 0;
ALTER TABLE public.erp_order_materials ALTER COLUMN issued_qty SET NOT NULL;
ALTER TABLE public.erp_order_materials DROP COLUMN IF EXISTS issued;
ALTER TABLE public.erp_order_materials DROP CONSTRAINT IF EXISTS erp_order_materials_issued_qty_check;
ALTER TABLE public.erp_order_materials ADD CONSTRAINT erp_order_materials_issued_qty_check
  CHECK (issued_qty >= 0 AND issued_qty <= qty AND issued_qty = round(issued_qty, 3));
ALTER TABLE public.erp_order_materials DROP CONSTRAINT IF EXISTS erp_order_materials_issued_actual_check;
ALTER TABLE public.erp_order_materials ADD CONSTRAINT erp_order_materials_issued_actual_check
  CHECK (issued_qty > 0 OR actual_cost = 0);

`;

const grants = `REVOKE ALL ON FUNCTION public.erp_norm_delta(uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
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

- [ ] **Step 2: сгенерировать миграцию**

Run: `node .validation-pglite-20261029/generate-material-issued-qty.mjs`
Expected: `{"functions":8,"sha256":"…"}` и файл `supabase/migrations/20261116_material_issued_qty.sql`.

Run: `rg -n "ADD COLUMN IF NOT EXISTS issued_qty|DROP COLUMN IF EXISTS issued|erp_norm_delta|CREATE OR REPLACE FUNCTION public.erp_execute" supabase/migrations/20261116_material_issued_qty.sql`
Expected: DDL в начале, затем 8 функций, затем гранты; ни одной строки с `NOT issued`, `m.issued` или `issued = true`.

- [ ] **Step 3: зонд**

Создать `.validation-pglite-20261029/validate-material-issued-qty.mjs`:

```js
// Material issued quantities (P2): live-shape upgrade, migration idempotency, partial issue,
// reserve and cost arithmetic, norm delta on revision, cancel return and snapshot compatibility.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');
const migration = await fs.readFile(new URL('supabase/migrations/20261116_material_issued_qty.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

async function harness() {
  const db = new PGlite();
  const adminId = crypto.randomUUID();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;`);
  await db.query('INSERT INTO auth.users VALUES ($1, $2, $3::jsonb)',
    [adminId, 'owner@local.invalid', JSON.stringify({ name: 'Owner' })]);
  const as = async (userId = adminId) => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec('SET ROLE authenticated');
  };
  const owner = async (query, params = []) => {
    await db.exec('RESET ROLE');
    return (await db.query(query, params)).rows;
  };
  const one = async (query, params = []) => (await owner(query, params))[0];
  const snapshot = async () => {
    await as();
    const rows = (await db.query('SELECT public.erp_snapshot() AS result')).rows;
    await db.exec('RESET ROLE');
    return rows[0].result.state;
  };
  const execute = async command => {
    const companyId = (await one('SELECT company_id FROM public.erp_profiles WHERE id = $1', [adminId])).company_id;
    const revision = Number((await one('SELECT revision FROM public.erp_metadata WHERE company_id = $1', [companyId])).revision);
    await as();
    const result = (await db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb) AS result',
      [crypto.randomUUID(), revision, JSON.stringify(command)])).rows[0].result;
    await db.exec('RESET ROLE');
    return result;
  };
  const bootstrap = async name => {
    await as();
    await db.query('SELECT public.erp_bootstrap_company($1) AS id', [name]);
    await db.exec('RESET ROLE');
    return (await one('SELECT id FROM public.erp_companies LIMIT 1')).id;
  };
  return { db, adminId, as, owner, one, snapshot, execute, bootstrap };
}

const orderOf = (state, title) => state.orders.find(o => o.title === title);
const materialOf = (order, itemId) => order.materials.find(m => m.itemId === itemId);

const db1 = await harness();
await db1.db.exec(schema);
await db1.db.exec(migration);
await db1.db.exec(migration);
pass('material issued qty migration applies twice on top of the canonical schema (idempotent)');

const companyId = await db1.bootstrap('Issued qty');
const columns = await db1.owner(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'erp_order_materials' ORDER BY ordinal_position`);
assert.equal(columns.some(row => row.column_name === 'issued'), false);
const issuedColumn = columns.find(row => row.column_name === 'issued_qty');
assert.ok(issuedColumn, 'issued_qty column exists');
assert.equal(issuedColumn.data_type, 'numeric');
assert.equal(issuedColumn.is_nullable, 'NO');
assert.match(issuedColumn.column_default, /0/);
const checks = (await db1.owner(`SELECT conname FROM pg_constraint
  WHERE conrelid = 'public.erp_order_materials'::regclass`)).map(row => row.conname);
assert.ok(checks.includes('erp_order_materials_issued_qty_check'));
assert.ok(checks.includes('erp_order_materials_issued_actual_check'));
pass('erp_order_materials stores issued_qty numeric with named checks and no boolean column');

await db1.execute({ type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
await db1.execute({ type: 'employee.create', name: 'Painter' });
await db1.execute({ type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null, category: '06.01' });
await db1.execute({ type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null, category: '06.04' });
let state = await db1.snapshot();
const customerId = state.customers[0].id;
const employeeId = state.employees[0].id;
const paintId = state.items.find(item => item.name === 'Paint').id;
const hardenerId = state.items.find(item => item.name === 'Hardener').id;
await db1.execute({ type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20,
  standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true,
  norms: [{ itemId: paintId, qtyPerM2: 0.2 }, { itemId: hardenerId, qtyPerM2: 0.1 }] });
await db1.execute({ type: 'operation.create', name: 'Cut', unit: 'piece', salePrice: 5, workerRate: 2,
  standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true });
state = await db1.snapshot();
const paintOp = state.operations.find(operation => operation.name === 'Paint').id;
const cutOp = state.operations.find(operation => operation.name === 'Cut').id;
await db1.execute({ type: 'inventory.count', itemId: paintId, qty: 100, note: '' });
await db1.execute({ type: 'inventory.count', itemId: hardenerId, qty: 100, note: '' });
await db1.execute({ type: 'order.create', input: { kind: 'product', customerId, title: 'Facade', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [],
  route: [{ operationId: paintOp, employeeId, rate: 20, qty: 10 }] } });
let facade = orderOf(await db1.snapshot(), 'Facade');
await db1.execute({ type: 'order.launch', orderId: facade.id });
await db1.execute({ type: 'order.issue', orderId: facade.id });

const stockOf = async itemId => Number((await db1.one('SELECT public.erp_stock_qty($1, $2) AS qty', [companyId, itemId])).qty);
const reserveOf = async itemId => Number((await db1.one('SELECT public.erp_reserved_qty($1, $2) AS qty', [companyId, itemId])).qty);
const reviseFacade = (current, overrides = {}) => db1.execute({ type: 'order.update', orderId: orderOf(current, 'Facade').id,
  title: 'Facade', qty: 1, price: 1000, overhead: 0, dueDate: '2026-11-20',
  materials: orderOf(current, 'Facade').materials.map(row => ({ itemId: row.itemId, qty: row.qty })),
  route: [{ operationId: paintOp, employeeId, rate: 20, qty: 10 }], ...overrides });

state = await db1.snapshot();
facade = orderOf(state, 'Facade');
assert.deepEqual(
  { qty: materialOf(facade, paintId).qty, issuedQty: materialOf(facade, paintId).issuedQty, issued: materialOf(facade, paintId).issued },
  { qty: 2, issuedQty: 2, issued: true });
assert.equal(materialOf(facade, hardenerId).issuedQty, 1);
assert.equal(await stockOf(paintId), 98);
assert.equal(await stockOf(hardenerId), 99);
assert.equal(await reserveOf(paintId), 0);
const paintRow = await db1.one('SELECT estimated_cost, actual_cost FROM public.erp_order_materials WHERE company_id = $1 AND line_id = $2 AND item_id = $3',
  [companyId, facade.lines[0].id, paintId]);
assert.deepEqual([Number(paintRow.estimated_cost), Number(paintRow.actual_cost)], [100, 100]);
pass('order.issue stores the full quantity, actual cost and the compat snapshot flag');

let error;
try { await db1.execute({ type: 'order.issue', orderId: facade.id }); } catch (caught) { error = caught; }
assert.ok(error, 'second issue rejected');
assert.equal(error.code, '23514');
assert.match(error.message, /All materials already issued/);
pass('a fully issued order rejects a second issue');

await reviseFacade(state, { route: [{ operationId: paintOp, employeeId, rate: 20, qty: 20 }] });
state = await db1.snapshot();
facade = orderOf(state, 'Facade');
assert.deepEqual([materialOf(facade, paintId).qty, materialOf(facade, paintId).issuedQty, materialOf(facade, paintId).issued], [4, 2, false]);
assert.deepEqual([materialOf(facade, hardenerId).qty, materialOf(facade, hardenerId).issuedQty], [2, 1]);
assert.equal(await reserveOf(paintId), 2);
assert.equal(await reserveOf(hardenerId), 1);
assert.equal((await db1.one('SELECT status FROM public.erp_order_items WHERE company_id = $1 AND id = $2',
  [companyId, facade.lines[0].id])).status, 'production');
pass('route growth moves norm materials, keeps the issued quantity and reopens the line');

await db1.execute({ type: 'order.issue', orderId: facade.id });
state = await db1.snapshot();
facade = orderOf(state, 'Facade');
assert.deepEqual([materialOf(facade, paintId).issuedQty, materialOf(facade, hardenerId).issuedQty], [4, 2]);
assert.equal(materialOf(facade, paintId).issued, true);
assert.equal(await stockOf(paintId), 96);
assert.equal(await stockOf(hardenerId), 98);
pass('the second issue moves only the remaining delta');

await reviseFacade(state, { route: [{ operationId: paintOp, employeeId, rate: 20, qty: 4 }] });
state = await db1.snapshot();
facade = orderOf(state, 'Facade');
assert.deepEqual([materialOf(facade, paintId).qty, materialOf(facade, paintId).issuedQty], [4, 4]);
assert.deepEqual([materialOf(facade, hardenerId).qty, materialOf(facade, hardenerId).issuedQty], [2, 2]);
assert.equal(await reserveOf(paintId), 0);
pass('route shrink clamps norm materials at what was issued');

await reviseFacade(state, { route: [{ operationId: paintOp, employeeId, rate: 20, qty: 4 }] });
assert.equal(materialOf(orderOf(await db1.snapshot(), 'Facade'), paintId).qty, 4);
pass('repeating the same revision changes nothing');

await db1.execute({ type: 'order.create', input: { kind: 'product', customerId, title: 'Facade 2', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [],
  route: [{ operationId: paintOp, employeeId, rate: 20, qty: 10 }] } });
let second = orderOf(await db1.snapshot(), 'Facade 2');
await db1.execute({ type: 'order.launch', orderId: second.id });
assert.equal(orderOf(await db1.snapshot(), 'Facade 2').materials.length, 2);
await db1.execute({ type: 'order.update', orderId: second.id, title: 'Facade 2', qty: 1, price: 1000, overhead: 0,
  dueDate: '2026-11-20', materials: [], route: [{ operationId: cutOp, employeeId, rate: 2, qty: 10 }] });
second = orderOf(await db1.snapshot(), 'Facade 2');
assert.deepEqual(second.materials, []);
assert.equal((await db1.one('SELECT count(*)::int AS n FROM public.erp_order_materials WHERE company_id = $1 AND order_id = $2',
  [companyId, second.id])).n, 0);
pass('removing the routed stage removes its norm materials when nothing was issued');

await db1.execute({ type: 'item.create', name: 'Thinner', unit: 'litr', minQty: 0, cost: 50, customerId: null, category: '06.02' });
state = await db1.snapshot();
const thinnerId = state.items.find(item => item.name === 'Thinner').id;
await db1.execute({ type: 'operation.create', name: 'Lak', unit: 'squareMeter', salePrice: 10, workerRate: 5,
  standardMinutes: 0, machineId: null, employeeIds: [employeeId], active: true, autoAccept: true,
  norms: [{ itemId: thinnerId, qtyPerM2: 1 }] });
state = await db1.snapshot();
const lakOp = state.operations.find(operation => operation.name === 'Lak').id;
await db1.execute({ type: 'inventory.count', itemId: thinnerId, qty: 5, note: '' });
await db1.execute({ type: 'order.create', input: { kind: 'product', customerId, title: 'Lak order', qty: 1, price: 100,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [],
  route: [{ operationId: lakOp, employeeId, rate: 5, qty: 2 }] } });
const lakOrder = orderOf(await db1.snapshot(), 'Lak order');
await db1.execute({ type: 'order.launch', orderId: lakOrder.id });
await db1.execute({ type: 'inventory.count', itemId: thinnerId, qty: 0, note: '' });
error = undefined;
try { await db1.execute({ type: 'order.issue', orderId: lakOrder.id }); } catch (caught) { error = caught; }
assert.ok(error, 'issue rejected without stock');
assert.equal(error.code, '23514');
assert.match(error.message, /Insufficient stock for issue/);
assert.equal(Number((await db1.one('SELECT issued_qty FROM public.erp_order_materials WHERE company_id = $1 AND order_id = $2 AND item_id = $3',
  [companyId, lakOrder.id, thinnerId])).issued_qty), 0);
pass('issue stops when the remaining delta exceeds free stock');

state = await db1.snapshot();
await db1.execute({ type: 'order.cancel', orderId: orderOf(state, 'Facade').id });
state = await db1.snapshot();
facade = orderOf(state, 'Facade');
assert.equal(facade.status, 'cancelled');
assert.deepEqual([materialOf(facade, paintId).issuedQty, materialOf(facade, paintId).actualCost], [0, 0]);
assert.equal(await stockOf(paintId), 100);
assert.equal(await stockOf(hardenerId), 100);
pass('order.cancel returns the issued quantity and clears actual cost');

const db2 = await harness();
await db2.db.exec(schema);
await db2.db.exec(migration);
const oldCompanyId = await db2.bootstrap('Upgrade');
await db2.execute({ type: 'customer.create', name: 'Client', phone: '', address: '', kind: 'customer' });
await db2.execute({ type: 'employee.create', name: 'Painter' });
await db2.execute({ type: 'item.create', name: 'Paint', unit: 'litr', minQty: 0, cost: 100, customerId: null, category: '06.01' });
await db2.execute({ type: 'item.create', name: 'Hardener', unit: 'litr', minQty: 0, cost: 200, customerId: null, category: '06.04' });
state = await db2.snapshot();
const oldCustomerId = state.customers[0].id;
const oldEmployeeId = state.employees[0].id;
const oldPaintId = state.items.find(item => item.name === 'Paint').id;
await db2.execute({ type: 'operation.create', name: 'Paint', unit: 'squareMeter', salePrice: 50, workerRate: 20,
  standardMinutes: 0, machineId: null, employeeIds: [oldEmployeeId], active: true, autoAccept: true,
  norms: [{ itemId: oldPaintId, qtyPerM2: 0.2 }] });
state = await db2.snapshot();
const oldPaintOp = state.operations[0].id;
await db2.execute({ type: 'inventory.count', itemId: oldPaintId, qty: 100, note: '' });
await db2.execute({ type: 'order.create', input: { kind: 'product', customerId: oldCustomerId, title: 'Legacy', qty: 1, price: 1000,
  overhead: 0, dueDate: '2026-11-20', advance: 0, account: 'cash', materials: [],
  route: [{ operationId: oldPaintOp, employeeId: oldEmployeeId, rate: 20, qty: 10 }] } });
const legacyOrder = orderOf(await db2.snapshot(), 'Legacy');
await db2.execute({ type: 'order.launch', orderId: legacyOrder.id });
await db2.execute({ type: 'order.issue', orderId: legacyOrder.id });

// Rebuild the live pre-P2 table shape: boolean issued column instead of issued_qty.
await db2.db.exec(`ALTER TABLE public.erp_order_materials DROP COLUMN issued_qty;
ALTER TABLE public.erp_order_materials ADD COLUMN issued boolean NOT NULL DEFAULT false;
UPDATE public.erp_order_materials SET issued = true WHERE actual_cost > 0;`);
const legacyRows = await db2.owner('SELECT issued, qty, actual_cost FROM public.erp_order_materials ORDER BY position');
assert.deepEqual(legacyRows.map(row => [row.issued, Number(row.qty), Number(row.actual_cost)]), [[true, 2, 100]]);

await db2.db.exec(migration);
await db2.db.exec(migration);
const upgradedRows = await db2.owner('SELECT issued_qty, qty, actual_cost FROM public.erp_order_materials ORDER BY position');
assert.deepEqual(upgradedRows.map(row => [Number(row.issued_qty), Number(row.qty), Number(row.actual_cost)]), [[2, 2, 100]]);
const leftover = await db2.owner(`SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'erp_order_materials' AND column_name = 'issued'`);
assert.equal(leftover.length, 0);
pass('the migration backfills issued_qty from the live boolean column and drops it');

state = await db2.snapshot();
const upgraded = orderOf(state, 'Legacy');
assert.deepEqual([materialOf(upgraded, oldPaintId).issuedQty, materialOf(upgraded, oldPaintId).issued], [2, true]);
await db2.execute({ type: 'order.cancel', orderId: upgraded.id });
assert.equal(Number((await db2.one('SELECT public.erp_stock_qty($1, $2) AS qty', [oldCompanyId, oldPaintId])).qty), 100);
pass('the upgraded database snapshots and cancels with issued_qty');

console.log(`\n${passes} checks passed`);
```

- [ ] **Step 4: прогнать зонд**

Run: `node .validation-pglite-20261029/validate-material-issued-qty.mjs`
Expected: `13 checks passed`, exit 0.

Если падает `Function ... still uses the boolean issued column`, значит Task 14 оставил в одной из восьми функций `NOT issued` / `m.issued` / `issued = true|false` — исправить канонический SQL и перегенерировать миграцию.

---

### Task 16: P2 — частичная выдача в редакторе заказа и подписи

**Files:**
- Modify: `src/components/OrderEditor.tsx:173-184`
- Modify: `src/components/OrderPositions.tsx:31`
- Modify: `src/components/SeriesList.tsx:62`
- Test: Create `src/material-issued-ui.test.tsx`

**Interfaces:**
- Consumes: `MaterialLine.issuedQty` и `isIssued` (Task 11), `num` из `src/ui.tsx:7` (он же `formatQty`), `PositionMaterial.issuedQty` (Task 11).
- Produces: метка `Berilgan N · Kerak M` на частичной строке и `Berilgan N · to‘liq` на полной; `qisman berilgan · N / M` в карточке позиции и `qisman · N / M` в списке серий; поле количества остаётся редактируемым при `issuedQty > 0`, выбор материала и удаление — заблокированы.

Поле количества не прижимается в `onChange`: так же, как у количества позиции (`floor`), ограничение задаётся атрибутом `min`, а `revisionMaterials` (Task 12) молча поднимает `qty` до `issuedQty` — это принятое правило §4.2. Жёсткая ошибка в UI сделала бы поведение строже домена.

- [ ] **Step 1: RED — SSR-тест**

Создать `src/material-issued-ui.test.tsx`:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { OrderEditor } from './components/OrderEditor';
import { OrderPositions } from './components/OrderPositions';
import { SeriesList } from './components/SeriesList';
import type { Item, MaterialLine, Order, OrderLine, State } from './types';

const item = (id: string, name: string): Item => ({
  id, name, unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
  salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01',
});

function baseState(issuedQty: number, kind: Order['kind'] = 'product'): State {
  const line: OrderLine = { id: 'L1', kind: 'product', title: 'Lak', qty: 5, total: 1000, status: 'production' };
  const materials: MaterialLine[] = [
    { id: 'm1', lineId: 'L1', itemId: 'paint', qty: 5, issuedQty, estimatedCost: 50, actualCost: issuedQty * 10 },
    { id: 'm2', lineId: 'L1', itemId: 'hard', qty: 2, issuedQty: 2, estimatedCost: 20, actualCost: 20 },
  ];
  const order: Order = {
    id: 'o1', number: 'ORD-0001', kind, customerId: '', title: 'Lak', outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 5, price: 1000, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status: 'production', lines: [line], materials, route: [],
  };
  return { ...emptyState(), items: [item('paint', 'Bo‘yoq'), item('hard', 'Qotirgich')], orders: [order] };
}

const inputTag = (html: string, index: number) =>
  html.match(new RegExp(`<input[^>]*aria-label="Material miqdori ${index}"[^>]*>`))![0];

const editorHtml = (state: State) => renderToStaticMarkup(createElement(OrderEditor, {
  state, order: state.orders[0], busy: false, close: () => {}, save: async () => {}, createCustomer: async () => null,
}));

const positionsHtml = (state: State) => renderToStaticMarkup(createElement(OrderPositions, {
  state, order: state.orders[0], busy: false, onIssue: () => {}, onShip: () => {}, onCancel: () => {},
}));

const noop = async () => true;

describe('P2 partial issue in UI', () => {
  it('keeps quantity editable and locks item and delete on issued rows', () => {
    const html = editorHtml(baseState(3));
    const partial = inputTag(html, 1);
    expect(partial).toContain('min="3"');
    expect(partial).not.toContain('disabled');
    const full = inputTag(html, 2);
    expect(full).toContain('min="2"');
    expect(full).not.toContain('disabled');
    expect(html.match(/class="material-picker-static"/g)).toHaveLength(2);
    const deleteButtons = html.match(/<button[^>]*aria-label="Materialni olib tashlash \d"[^>]*>/g) ?? [];
    expect(deleteButtons).toHaveLength(2);
    for (const button of deleteButtons) expect(button).toContain('disabled');
    expect(html).toContain('Berilgan 3 · Kerak 5');
    expect(html).toContain('Berilgan 2 · to‘liq');
  });

  it('marks partial rows in the order card and keeps the issue button', () => {
    const html = positionsHtml(baseState(3));
    expect(html).toContain('qisman berilgan · 3 / 5');
    expect(html).toContain(' · berilgan');
    expect(html).toContain('Materiallarni berish');
  });

  it('marks partial rows in the series card', () => {
    const state = baseState(3, 'series');
    const html = renderToStaticMarkup(createElement(SeriesList, { state, busy: false, run: noop, onGo: () => {} }));
    expect(html).toContain('qisman · 3 / 5');
    expect(html).toContain('2 dan 1 berildi');
    expect(html).toContain('Sexga berish');
  });

  it('shows a full numeric label and lifts the minimum on a fully issued row', () => {
    const state = baseState(5);
    const editor = editorHtml(state);
    expect(inputTag(editor, 1)).toContain('min="5"');
    expect(editor).toContain('Berilgan 5 · to‘liq');
    const positions = positionsHtml(state);
    expect(positions).not.toContain('qisman');
    expect(positions).not.toContain('Materiallarni berish');
  });
});
```

- [ ] **Step 2: Убедиться, что RED**

Run: `npx vitest run src/material-issued-ui.test.tsx`
Expected: 4 упавших теста. Падения именно на новых метках (`Berilgan 3 · Kerak 5`, `qisman…`), `min="3"` и `disabled` у поля количества — не на импортах и не на синтаксисе.

- [ ] **Step 3: GREEN — редактор заказа**

В `src/components/OrderEditor.tsx` заменить блок материалов (`:173-184`) целиком:

```tsx
      <button type="button" className="secondary small" onClick={() => onChange({ materials: [...position.materials, { itemId: '', qty: 1, issuedQty: 0 }] })}><Plus size={14} />Qator</button>
    </div>
    <ShortageNotice rows={shortage} onGo={onGo} />
    {position.materials.map((row, index) => <div className="editor-line material-editor" key={index}>
      <MaterialPicker label={`Material ${index + 1}`} value={row.itemId} disabled={row.issuedQty > 0}
        groups={materialGroups(state, customerId, row.itemId, position.materials.map(material => material.itemId))}
        describe={describeMaterial} onChange={itemId => setMaterial(index, { itemId })} />
      <input aria-label={`Material miqdori ${index + 1}`} type="number" min={row.issuedQty > 0 ? row.issuedQty : 0.001} step="0.001" value={row.qty} required onChange={event => setMaterial(index, { qty: Number(event.target.value) })} />
      <button type="button" className="icon-button" aria-label={`Materialni olib tashlash ${index + 1}`} disabled={row.issuedQty > 0} onClick={() => onChange({ materials: position.materials.filter((_, i) => i !== index) })}><X size={17} /></button>
      {row.issuedQty > 0 && <small className="route-rate">{row.issuedQty >= row.qty ? `Berilgan ${num(row.issuedQty)} · to‘liq` : `Berilgan ${num(row.issuedQty)} · Kerak ${num(row.qty)}`}</small>}
      {shortageChip(row.itemId)}
    </div>)}
```

Единственное изменение по сравнению с Task 11 — с поля количества снят `disabled` и добавлен `min`; `num` уже импортирован из `../ui`.

- [ ] **Step 4: GREEN — подписи в карточке позиции и серии**

`src/components/OrderPositions.tsx:31` — строку материала заменить:

```tsx
        return <div className="position-row" key={row.id}><span>{item?.name}<em>{item?.customerId ? ' · mijozniki, qiymat 0' : ` · ${money(row.estimatedCost)} / dona`}</em></span><b>{num(row.qty)} {item?.unit}<em>{row.issuedQty >= row.qty ? ' · berilgan' : row.issuedQty > 0 ? ` · qisman berilgan · ${num(row.issuedQty)} / ${num(row.qty)}` : order.status === 'production' ? ' · band' : ' · berilmagan'}</em></b></div>;
```

`src/components/SeriesList.tsx:62` — `small` внутри `series-material-view`:

```tsx
    <div className="series-material-view">{order.materials.map(line => <span key={line.id}>{itemName(line.itemId)} <b>{num(line.qty)}</b> <small>{line.issuedQty >= line.qty ? 'berilgan' : line.issuedQty > 0 ? `qisman · ${num(line.issuedQty)} / ${num(line.qty)}` : order.status === 'draft' ? 'berilmagan' : 'band'}</small></span>)}</div>
```

Счётчик `issued` и условие полосы `issued < order.materials.length` (`SeriesList.tsx:41`, `:60`) не меняются: они уже считают только полностью выданные строки (Task 11), а кнопка `Sexga berish` при частичной выдаче должна оставаться.

- [ ] **Step 5: GREEN — focused и типы**

Run: `npx vitest run src/material-issued-ui.test.tsx`
Expected: 4 passed.

Run: `npx tsc -b`
Expected: exit 0.

Run: `npx vitest run`
Expected: все файлы зелёные; число тестов выросло на 4 относительно конца Task 15.

---

### Task 17: Финальная проверка P2 и передача владельцу

**Files:**
- Create: нет
- Modify: нет
- Test: полный прогон, два PGlite-зонда P1/P2, регрессионные зонды, демо-браузер

**Interfaces:**
- Consumes: всё из задач 11–16 и P1: `supabase/migrations/20261115_defects.sql`, `supabase/migrations/20261116_material_issued_qty.sql`, `.validation-pglite-20261029/validate-defects.mjs`, `.validation-pglite-20261029/validate-material-issued-qty.mjs`, `src/material-issued-ui.test.tsx`.
- Produces: пакет передачи владельцу для P2 и решение «P1+P2 готовы к выкату». Живой SQL и deploy в этой задаче **не выполняются** — только по отдельному явному разрешению владельца.

- [ ] **Step 1: Полный статический и тестовый прогон**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: exit 0; ни одного упавшего теста; Vite собирает бандл; известное предупреждение о размере chunk остаётся единственным.

- [ ] **Step 2: PGlite-зонды P1/P2 и регрессии**

Run: `node .validation-pglite-20261029/validate-material-issued-qty.mjs`
Expected: `13 checks passed`, exit 0.

Run: `node .validation-pglite-20261029/validate-defects.mjs`
Expected: `11 checks passed`, exit 0.

Run: `node .validation-pglite-20261029/validate-operation-norms.mjs`
Expected: все проверки зонда проходят, exit 0 — нормы при `order.create` не сломаны переписанным `erp_revise_materials`.

Run: `node .validation-pglite-20261029/validate-supplier-stage-cost.mjs`
Expected: все проверки зонда проходят, exit 0 — ревизия маршрута и сумма подрядчика не сломаны `erp_norm_delta`.

Любое расхождение паритета — стоп и разбор причины до продолжения; не «подправлять» ожидания зонда под фактический результат.

- [ ] **Step 3: Демо-проверка в браузере**

Run: `npm run dev` (демо-режим, пустые `VITE_SUPABASE_*`)
Сценарий:
1. Войти владельцем, `Ishlab chiqarish` → открыть «Fasadlarni bo‘yash · 12 m²» → `Sexga ishga tushirish` → `Materiallarni berish`. Все строки материалов помечены `Berilgan N · to‘liq`; для Bo‘yash: краска `Berilgan 3 · to‘liq`, отвердитель `Berilgan 1,2 · to‘liq`, абразив `Berilgan 6 · to‘liq`.
2. `Buyurtmani tahrirlash`: у этапа Bo‘yash поставить `20` вместо 12 и сохранить; у Jilolash количество не трогать. Ожидаемо: краска `Berilgan 3 · Kerak 5` (+0,25 × 8 = +2 л), отвердитель `Berilgan 1,2 · Kerak 2` (+0,1 × 8 = +0,8 л), абразив остался `Berilgan 6 · to‘liq`; карточка заказа показывает `qisman berilgan · 3 / 5`, кнопка `Materiallarni berish` снова видна.
3. Нажать `Materiallarni berish`: движения склада только на дельту (2 л и 0,8 л), строки становятся `to‘liq`, кнопка исчезает.
4. Снова открыть редактор и вернуть Bo‘yash к 12 м²: строки не уменьшаются ниже уже выданного (`qty` остаётся 5 и 2), ошибки нет — это правило §4.2; склад не возвращается сам.
5. Пересобрать заказ в 20 м², довыдать, провести этапы и принять; затем `Buyurtmani bekor qilish`: склад получает обратно ровно выданное (краска 7 л = 5 + 2, отвердитель 2,8 л = 2 + 0,8, абразив 6 л), строки обнулены.
6. Открыть `Ombor` → история движений: суммы и количества шагов 1/3/5 сходятся, двойных списаний нет.

Expected: все пункты совпадают; в консоли браузера нет ошибок. Если MCP-клик в демо-режиме не срабатывает, выполнять шаги через `evaluate_script` и сверять DOM-текст меток.

- [ ] **Step 4: Пакет передачи владельцу P2 (без выполнения)**

Подготовить и передать владельцу:
- Файл: `supabase/migrations/20261116_material_issued_qty.sql`.
- **Сначала P1:** миграция `20261115_defects.sql` (Task 10 Step 4) должна быть успешно применена и проверена — обе миграции переписывают одни и те же функции, P2 применяется второй.
- Preflight в Supabase SQL Editor (только одинарные кавычки):

```sql
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'erp_order_materials' and column_name = 'issued_qty'
) as issued_qty_present,
exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'erp_order_materials' and column_name = 'issued'
) as legacy_issued_present,
position('erp_norm_delta' in pg_get_functiondef('public.erp_execute(uuid,bigint,jsonb)'::regprocedure)) > 0 as delta_wired;
```

Expected: `issued_qty_present` = false, `legacy_issued_present` = true, `delta_wired` = false — P2 ещё не применялась.

- Бэкап: Dashboard → Database → Backups (свежий ежедневный бэкап) перед `Run`.
- Применить миграцию в SQL Editor, дождаться `Success`.
- Проверочный SQL после `Run` (только одинарные кавычки):

```sql
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'erp_order_materials' and column_name = 'issued_qty'
) as issued_qty_present;
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'erp_order_materials' and column_name = 'issued'
) as legacy_issued_present;
select count(*) as broken_rows from public.erp_order_materials where issued_qty < 0 or issued_qty > qty;
select position('issuedQty' in pg_get_functiondef('public.erp_snapshot()'::regprocedure)) > 0 as snapshot_has_issued_qty;
select position('erp_norm_delta' in pg_get_functiondef('public.erp_execute(uuid,bigint,jsonb)'::regprocedure)) > 0 as delta_wired;
select has_function_privilege('authenticated', 'public.erp_norm_delta(uuid,uuid,uuid,uuid,jsonb,jsonb)', 'execute') as delta_granted;
```

Expected: `issued_qty_present` = true; `legacy_issued_present` = false; `broken_rows` = 0; `snapshot_has_issued_qty` = true; `delta_wired` = true; `delta_granted` = false (`erp_norm_delta` — внутренний хелпер, не API).

`erp_snapshot()` здесь не вызывается по той же причине, что и в P1: в SQL Editor нет JWT и функция падает с `Authentication required`.

- **Порядок выката одного бандла.** План исполняется целиком, поэтому в дереве уже есть код P1 и P2 одновременно. Безопасная последовательность: P1 SQL → проверка → P2 SQL → проверка → один `npm run deploy` (Worker `erp-tizim`) по отдельному разрешению. Старый живой фронтенд переживает обе миграции: P1 добавляет только `defects` в снимок, а P2 сохраняет совместимый ключ `issued` на один релиз. Не деплоить между P1 и P2: бандл уже содержит P2, а P1-схема отклонит правку количества на выданной строке.
- Если владелец захочет выкатить P1 отдельно: до начала задач P2 сохранить `dist` после сборки Task 10 Step 1 в `dist-p1-20261115` и задеплоить его после P1 SQL; финальный `dist` — после P2 SQL.
- Откат P2 (только при отказе P2 и только по решению владельца):

```sql
alter table public.erp_order_materials add column if not exists issued boolean not null default false;
update public.erp_order_materials set issued = issued_qty >= qty;
alter table public.erp_order_materials drop column if exists issued_qty;
```

плюс восстановление прежних определений функций из канонической схемы до P2 и деплой предыдущего бандла. **Внимание:** откат не различает частичную выдачу; если в базе уже есть строки `issued_qty > 0 and issued_qty < qty`, отмена заказа вернёт на склад `qty` вместо фактически выданного `issued_qty`. Откатываться можно только когда частичных строк нет (проверить `select count(*) from public.erp_order_materials where issued_qty > 0 and issued_qty < qty;` = 0) или сначала выровнять склад через `inventory.count`.
- После deploy (по отдельному разрешению): живой прогон — вход владельцем, покрасочный заказ, выдача, ревизия 12→20 м², частичная метка, довыдача дельты, приёмка; терминал работника и журнал брака (P1) не сломаны.

- [ ] **Step 5: Зафиксировать готовность**

Отметить в отчёте владельцу (на русском): P1 и P2 реализованы, все тесты/типы/сборка/зонды зелёные; миграции `20261115_defects.sql` и `20261116_material_issued_qty.sql`, preflight и проверочный SQL готовы; живые SQL и deploy ждут отдельного разрешения. Задачи #314 и #315 переводятся в готовые к выкату.

---

## Итог плана

- P1 (#314) и P2 (#315) независимы по данным и выкатываются одним финальным бандлом после двух миграций; P1 SQL применяется первым.
- Все проверки — `npx tsc -b`, `npx vitest run`, `npm run build`, PGlite-зонды — заменяют коммиты: рабочая папка не Git-репозиторий.
- Живой SQL, бэкап и deploy выполняет владелец или исполнитель только по отдельному явному разрешению; секреты и данные компаний не печатаются.
