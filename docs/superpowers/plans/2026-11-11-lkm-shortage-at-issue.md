# Нехватка ЛКМ при выдаче — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** При нехватке материала (в первую очередь ЛКМ) приложение показывает точный дефицит — имя позиции и цифры «kerak / omborda / band / yetishmaydi» — в редакторе заказа, в баннере производственной доски и в карточке серии, а жёсткая блокировка `order.launch` / `order.issue` остаётся ровно прежней.

**Architecture:** Один чистый селектор `src/shortage.ts` считает дефицит по тем же правилам, что и домен (`stockQty`, резерв без собственного заказа, epsilon-сравнение `exceeds`), ничего не меняя в `State`. Домен и `erp_execute` остаются единственными арбитрами: тексты исключений не трогаются, кнопка «Sexga berish» по клиентской формуле не блокируется. UI — один компонент `ShortageNotice` в трёх точках + чип у строки материала; навигация «Omborga»/«Xaridga» прокидывается существующим `go(section, panel)`.

**Tech Stack:** React 19, TypeScript strict, Vite 6, Vitest 3 (окружение `node`, jsdom в проекте нет → компонентные тесты только через `renderToStaticMarkup`), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-11-lkm-shortage-at-issue-design.md` — утверждённый владельцем документ; план его реализует, при конфликте авторитет у спецификации.

## Global Constraints

- Рабочая папка **не Git-репозиторий**: шагов `git commit` нет; вместо них — проверки `npx vitest run <файл>`, `npx tsc -b --pretty false`, `npm run build`.
- `npm test` = `vitest run` (node, без jsdom): кликов, `fireEvent`, `userEvent` в тестах быть не должно.
- UI — узбекская латиница, суммы в UZS; отчёт владельцу — на русском.
- Строки исключений `src/domain.ts` (`'Insufficient available stock'`, `'Insufficient reserved stock'`, `'Insufficient stock'`) **не меняются** — на них держится зеркало в Postgres, поэтому **SQL-миграция не требуется и не выполняется**.
- `supabase/schema.sql` в этом под-проекте не редактируется: только читается контрактным тестом.
- Логика `order.launch` не смягчается; частичная выдача, отрицательный остаток, авто-черновик закупки — вне рамок (см. spec §1).
- Решение принимает домен: `ShortageNotice` ничего не отключает и не создаёт.
- Живой SQL и `npm run deploy` (Worker `erp-tizim`) — только по отдельному разрешению владельца.
- Секреты только на сервере; в проектных файлах и чате — никогда.

---

## File Structure

- Create: `src/shortage.ts` — чистый селектор дефицита: `ShortageRow`, `reservedExcept`, `orderShortage`, `draftShortage`.
- Create: `src/shortage.test.ts` — unit-тесты селектора + контрактный тест на тексты `supabase/schema.sql`.
- Modify: `src/domain.ts` — `export` у `exceeds` и `mergeNormMaterials` (поведение не меняется).
- Modify: `src/i18n.ts` — одна строка `errorMessages` → три (spec §4.3).
- Modify: `src/domain.test.ts` — регрессионный замок на тексты нехватки.
- Modify: `src/i18n.test.ts` — три новых маппинга.
- Create: `src/components/ShortageNotice.tsx` — список дефицита + переходы.
- Create: `src/shortage-ui.test.tsx` — SSR-тесты компонента и трёх точек.
- Create: `src/shortageStyle.test.ts` — CSS-замок раскладки полосы и чипа.
- Modify: `src/components/OrderEditor.tsx` — чип у строки материала, `ShortageNotice` под заголовком «Materiallar», пропсы `onGo`.
- Modify: `src/App.tsx` — `onGo` в редактор заказа (закрывает диалог перед переходом) и список серий, `ShortageNotice` в баннер доски.
- Modify: `src/ui.tsx` — `GoButton` получает `type="button"` (внутри `<form>` редактора кнопка без типа отправила бы форму и сохранила заказ).
- Modify: `src/components/SeriesList.tsx` — `ShortageNotice` в полосу `material-warning` карточки серии.
- Modify: `src/styles.css` — `.shortage*` (в конец файла).

Порядок задач: T1 → T2 → T3 → T4. T2 не зависит от T1 (домен и i18n не знают про селектор), но идёт после, чтобы к моменту UI проверка текстов уже была зафиксирована тестами.

---

### Task T1: Селектор `src/shortage.ts`

**Files:**
- Create: `src/shortage.ts`
- Create: `src/shortage.test.ts`
- Modify: `src/domain.ts:41` (`function exceeds` → `export function exceeds`), `src/domain.ts:323` (`function mergeNormMaterials` → `export function mergeNormMaterials`)
- Test: `src/shortage.test.ts`

**Interfaces:**
- Consumes: `stockQty` (`src/domain.ts:470`), `exceeds` (`src/domain.ts:41`), `normMaterialLines` (`src/domain.ts:306`), `mergeNormMaterials` (`src/domain.ts:323`); типы `MaterialLine`, `Order`, `RouteLine`, `State` из `./types`.
- Produces: `ShortageRow`, `DraftMaterial`, `DraftStage`, `DraftPosition`, `reservedExcept(state, itemId, excludeOrderId): number`, `orderShortage(state, order): ShortageRow[]`, `draftShortage(state, positions, excludeOrderId?): ShortageRow[]` — используются в Task T3 (`ShortageNotice`, `OrderEditor`, `App.tsx`, `SeriesList`).

- [ ] **Step 1: Написать падающий тест**

Создать `src/shortage.test.ts` целиком. Тесты строят `State` literals-ами (доменные команды не нужны — селектор читает только `items`, `movements`, `orders`, `operations`):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { draftShortage, orderShortage, reservedExcept } from './shortage';
import type { PositionDraft } from './order-editor';
import type { Item, MaterialLine, Operation, Order, State, Status, StockMovement } from './types';

function item(id: string, over: Partial<Item> = {}): Item {
  return { id, name: `Pozitsiya ${id}`, unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01', ...over };
}

function stock(itemId: string, qty: number): StockMovement {
  return { id: `mv-${itemId}`, itemId, direction: 'in', qty, unitCost: 10, source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-11-01T00:00:00.000Z' };
}

function material(id: string, itemId: string, qty: number, issued = false, lineId = 'L1'): MaterialLine {
  return { id, lineId, itemId, qty, estimatedCost: 0, issued, actualCost: 0 };
}

function order(id: string, status: Status, materials: MaterialLine[], over: Partial<Order> = {}): Order {
  return { id, number: `ORD-${id}`, kind: 'product', customerId: 'c1', title: id, outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 1, price: 0, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status, lines: [], materials, route: [], ...over };
}

function world(over: Partial<State> = {}): State {
  return { ...emptyState(), items: [item('paint'), item('thinner', { name: 'Erituvchi 646', category: '06.05' })], ...over };
}

const paintOperation = (norms: { itemId: string; qtyPerM2: number }[]): Operation => ({
  id: 'opPaint', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 50, workerRate: 20, standardMinutes: 0,
  machineId: null, employeeIds: [], active: true, autoAccept: true, norms,
});

describe('orderShortage', () => {
  it('не считает дефицитом превышение в пределах допуска домена', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 10 + Number.EPSILON * 40)])],
    });
    expect(orderShortage(state, state.orders[0])).toEqual([]);
  });

  it('отдаёт одну строку с точными цифрами', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 6)]), order('B', 'production', [material('m2', 'paint', 8)])],
    });
    const rows = orderShortage(state, state.orders[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'paint', name: 'Pozitsiya paint', needed: 6, stock: 10, reserved: 8, available: 2, short: 4 });
  });

  it('не резервирует материал против самого себя и вычитает чужие заказы', () => {
    const state = world({ movements: [stock('paint', 10)], orders: [order('A', 'production', [material('m1', 'paint', 6)]), order('B', 'production', [material('m2', 'paint', 3)])] });
    expect(reservedExcept(state, 'paint', 'A')).toBe(3);
    expect(reservedExcept(state, 'paint', null)).toBe(9);
    expect(orderShortage(state, state.orders.find(o => o.id === 'A')!)).toEqual([]);
  });

  it('складывает один материал по всем позициям и игнорирует выданное', () => {
    const state = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 4, false, 'L1'), material('m2', 'paint', 5, false, 'L2'), material('m3', 'paint', 9, true, 'L3')])],
    });
    expect(orderShortage(state, state.orders[0])).toEqual([]);
    const deficit = world({
      movements: [stock('paint', 10)],
      orders: [order('A', 'production', [material('m1', 'paint', 8, false, 'L1'), material('m2', 'paint', 5, false, 'L2'), material('m3', 'paint', 9, true, 'L3')])],
    });
    expect(orderShortage(deficit, deficit.orders[0])).toEqual([
      { itemId: 'paint', name: 'Pozitsiya paint', unit: 'l', needed: 13, stock: 10, reserved: 0, available: 10, short: 3 },
    ]);
  });

  it('сортирует по убыванию дефицита', () => {
    const state = world({
      movements: [stock('paint', 1), stock('thinner', 1)],
      orders: [order('A', 'production', [material('m1', 'paint', 4), material('m2', 'thinner', 8)])],
    });
    expect(orderShortage(state, state.orders[0]).map(row => row.itemId)).toEqual(['thinner', 'paint']);
  });
});

describe('draftShortage', () => {
  it('агрегирует один материал из двух позиций черновика', () => {
    const positions: PositionDraft[] = [
      { kind: 'product', title: 'A', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 4, issued: false }], route: [] },
      { kind: 'product', title: 'B', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 7, issued: false }], route: [] },
    ];
    const state = world({ movements: [stock('paint', 10)] });
    const rows = draftShortage(state, positions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ needed: 11, stock: 10, reserved: 0, short: 1 });
  });

  it('учитывает нормы m² ровно так же, как order.create, и сливает их с явной строкой', () => {
    const state = world({ movements: [stock('paint', 0)], operations: [paintOperation([{ itemId: 'paint', qtyPerM2: 0.25 }])] });
    const positions: PositionDraft[] = [{
      kind: 'product', title: 'Fasad', qty: 4, unitPrice: 0, floor: 0,
      materials: [{ itemId: 'paint', qty: 0.5, issued: false }],
      route: [{ operationId: 'opPaint', executorKind: 'employee', employeeId: null, supplierId: null, rate: 0, salePrice: 0, qty: 4, locked: false, completed: 0 }],
    }];
    const rows = draftShortage(state, positions);
    expect(rows).toHaveLength(1);
    expect(rows[0].needed).toBeCloseTo(1.5, 10);
  });

  it('исключает бронь редактируемого заказа', () => {
    const state = world({ movements: [stock('paint', 10)], orders: [order('A', 'production', [material('m1', 'paint', 6)])] });
    const positions: PositionDraft[] = [{ kind: 'product', title: 'A', qty: 1, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 8, issued: false }], route: [] }];
    expect(draftShortage(state, positions, 'A')).toEqual([]);
    expect(draftShortage(state, positions).map(row => row.short)).toEqual([4]);
  });

  it('не бросает на пустом и полузаполненном черновике', () => {
    const state = world({ movements: [stock('paint', 1)], operations: [paintOperation([{ itemId: 'ghost', qtyPerM2: 1 }])] });
    const positions = [
      { kind: 'product' as const, title: '', qty: 0, unitPrice: 0, floor: 0, materials: [{ itemId: '', qty: 5, issued: false }, { itemId: 'paint', qty: 0, issued: false }], route: [{ operationId: '', executorKind: 'employee' as const, employeeId: null, supplierId: null, rate: 0, qty: 2, locked: false, completed: 0 }] },
      { id: 'L2', kind: 'product' as const, title: '', qty: 2, unitPrice: 0, floor: 0, materials: [{ itemId: 'paint', qty: 1, issued: false }], route: [{ operationId: 'opPaint', executorKind: 'employee' as const, employeeId: null, supplierId: null, rate: 0, qty: 2, locked: false, completed: 0 }] },
    ];
    expect(() => draftShortage(state, positions)).not.toThrow();
    expect(draftShortage(state, positions)).toEqual([]);
  });
});

describe('паритет с сервером', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

  it('доменные тексты нехватки по-прежнему зеркалятся в erp_execute', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '23514';");
    expect(sql).toContain("RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';");
    expect(sql).toContain("RAISE EXCEPTION 'Insufficient unreserved material stock' USING ERRCODE = '23514';");
    expect(sql).toContain("RAISE EXCEPTION 'Stock cannot be negative or below production reservations' USING ERRCODE = '23514';");
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/shortage.test.ts`
Expected: FAIL `Cannot find module './shortage'` (модуль ещё не создан) — это правильный RED.

- [ ] **Step 3: Написать реализацию**

Создать `src/shortage.ts` целиком:

```ts
import { exceeds, mergeNormMaterials, normMaterialLines, stockQty } from './domain';
import type { MaterialLine, Order, RouteLine, State } from './types';

export type ShortageRow = {
  itemId: string; name: string; unit: string;
  needed: number; stock: number; reserved: number; available: number; short: number;
};
export type DraftMaterial = { itemId: string; qty: number; issued: boolean };
export type DraftStage = { operationId: string; qty: number };
export type DraftPosition = { id?: string; materials: DraftMaterial[]; route: DraftStage[] };

export function reservedExcept(state: State, itemId: string, excludeOrderId: string | null): number {
  return state.orders.reduce((total, order) => order.id === excludeOrderId || order.status !== 'production' ? total
    : total + order.materials.reduce((qty, line) => line.itemId === itemId && !line.issued ? qty + line.qty : qty, 0), 0);
}

function collect(state: State, needed: Map<string, number>, excludeOrderId: string | null): ShortageRow[] {
  const rows: ShortageRow[] = [];
  for (const [itemId, qty] of needed) {
    const item = state.items.find(row => row.id === itemId);
    if (!item) continue;
    const stock = stockQty(state, itemId);
    const reserved = reservedExcept(state, itemId, excludeOrderId);
    const available = stock - reserved;
    if (!exceeds(qty, available)) continue;
    rows.push({ itemId, name: item.name, unit: item.unit, needed: qty, stock, reserved, available, short: qty - available });
  }
  return rows.sort((left, right) => right.short - left.short || left.name.localeCompare(right.name, 'uz'));
}

export function orderShortage(state: State, order: Order): ShortageRow[] {
  const needed = new Map<string, number>();
  for (const line of order.materials) {
    if (line.issued || !line.itemId) continue;
    needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + line.qty);
  }
  return collect(state, needed, order.id);
}

function positionLines(state: State, position: DraftPosition, lineId: string, fromNorms: boolean): MaterialLine[] {
  const explicit: MaterialLine[] = position.materials
    .filter(row => row.itemId && row.qty > 0)
    .map((row, index) => ({ id: `${lineId}-m${index}`, lineId, itemId: row.itemId, qty: row.qty, estimatedCost: 0, issued: row.issued, actualCost: 0 }));
  if (!fromNorms) return explicit;
  const tasks: RouteLine[] = position.route
    .filter(stage => stage.operationId && stage.qty > 0)
    .map((stage, index) => ({ id: `${lineId}-r${index}`, lineId, operationId: stage.operationId, name: '', executorKind: 'employee',
      employeeId: null, supplierId: null, rate: 0, planned: stage.qty, completed: 0, status: 'assigned' }));
  // normMaterialLines теряет весь этап, когда одна норма ссылается на удалённую номенклатуру
  const known = new Set(state.items.map(row => row.id));
  const normState: State = { ...state, operations: state.operations.map(row => ({ ...row, norms: row.norms.filter(norm => known.has(norm.itemId)) })) };
  const normLines: MaterialLine[] = [];
  for (const task of tasks) {
    try {
      normLines.push(...normMaterialLines(normState, [task], lineId));
    } catch {
      continue;
    }
  }
  return mergeNormMaterials(explicit, normLines);
}

export function draftShortage(state: State, positions: DraftPosition[], excludeOrderId: string | null = null): ShortageRow[] {
  // order.create запекает m²-нормы в сохраняемые материалы; ревизия хранит присланные строки как есть,
  // поэтому черновику сохранённого заказа нормы нельзя добавлять второй раз.
  const fromNorms = excludeOrderId === null;
  const needed = new Map<string, number>();
  positions.forEach((position, index) => {
    for (const line of positionLines(state, position, position.id ?? `draft-${index}`, fromNorms)) {
      if (line.issued || !line.itemId) continue;
      needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + line.qty);
    }
  });
  return collect(state, needed, excludeOrderId);
}
```

Модифицировать `src/domain.ts` — только ключевое слово `export`, тела функций не трогаются:

```ts
export function exceeds(value: number, limit: number): boolean {
```
```ts
export function mergeNormMaterials(materials: MaterialLine[], normLines: MaterialLine[]): MaterialLine[] {
```

- [ ] **Step 4: Убедиться, что тест проходит**

Run: `npx vitest run src/shortage.test.ts`
Expected: PASS, все 10 тестов зелёные.

Если падает `orderShortage ... reservedExcept === 9`: в тесте `world()` создаёт заказы со `lines: []`, а `reservedQty`/`reservedExcept` читают `order.materials` напрямую — проверьте, что в `order()` передаётся статус `'production'`.

- [ ] **Step 5: Типы и регресс домена**

Run: `npx tsc -b --pretty false`
Expected: без ошибок (експорт `exceeds` не должен сломать `noUnusedLocals`: функция используется внутри домена).
Run: `npx vitest run src/domain.test.ts`
Expected: PASS — поведение домена не менялось.

---

### Task T2: Тексты ошибок и регрессионный замок домена

**Files:**
- Modify: `src/i18n.ts:177` (одна запись `errorMessages` → три)
- Modify: `src/i18n.test.ts` (новые проверки `translateError`)
- Modify: `src/domain.test.ts` (два теста-замка)

**Interfaces:**
- Consumes: ничего из T1 — домен и i18n живут независимо.
- Produces: `translateError('Insufficient available stock')` и `translateError('Insufficient reserved stock')` возвращают разные узбекские тексты; доменные строки зафиксированы тестами. Используется в T3 косвенно (тост об ошибке).

- [ ] **Step 1: Написать падающие тесты**

В конец `src/i18n.test.ts` добавить блок (файл уже импортирует `translateError`):

```ts
describe('нехватка материала', () => {
  it('различает запуск и выдачу', () => {
    expect(translateError('Insufficient available stock')).toBe('Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.');
    expect(translateError('Insufficient reserved stock')).toBe('Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.');
    expect(translateError('Insufficient stock for issue')).toBe('Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.');
    expect(translateError('Insufficient stock')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
  });

  it('сохраняет подстраховку для серверных текстов', () => {
    expect(translateError('Insufficient unreserved material stock')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
    expect(translateError('Stock cannot be negative or below production reservations')).toBe('Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.');
  });
});
```

В `src/domain.test.ts` — рядом с существующими тестами нехватки (после `fixture`/`receive`/`production` helpers, строки 33-88) добавить блок. Обе ветки уже проверены на текущем домене — сообщение должно совпасть буквально:

```ts
describe('замок: доменные тексты нехватки', () => {
  it('order.launch бросает ровно Insufficient available stock', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 4, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 10 }] } });
    const orderId = state.orders[0].id;
    expect(() => run(state, { type: 'order.launch', orderId })).toThrow('Insufficient available stock');
  });

  it('order.issue бросает ровно Insufficient reserved stock, когда резерв превысил остаток', () => {
    const f = fixture();
    let state = receive(f.state, f.supplierId, f.itemId, 10, 5);
    state = run(state, { type: 'order.create', input: { ...f.input, materials: [{ itemId: f.itemId, qty: 4 }] } });
    const orderId = state.orders[0].id;
    state = run(state, { type: 'order.launch', orderId });
    const order = state.orders[0];
    const route = order.route.map(task => ({ operationId: task.operationId, employeeId: task.employeeId, rate: task.rate, taskId: task.id }));
    state = run(state, { type: 'order.update', orderId, title: order.title, qty: order.qty, price: order.price, overhead: order.overhead, dueDate: order.dueDate, materials: [{ itemId: f.itemId, qty: 50 }], route });
    expect(() => run(state, { type: 'order.issue', orderId })).toThrow('Insufficient reserved stock');
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают по нужной причине**

Run: `npx vitest run src/i18n.test.ts src/domain.test.ts`
Expected: i18n-блок FAIL (все три сообщения сегодня дают одну общую фразу); domain-блок PASS — он и должен пройти сразу, это замок, а не новое поведение. Если domain-блок падает с другим сообщением — читать stack и чинить **тест**, а не домен.

- [ ] **Step 3: Разделить строку i18n**

В `src/i18n.ts` заменить единственную запись 177 на три (порядок важен: конкретные — до `previous.*(route|stage)` и `already issued`):

```ts
  [/insufficient available stock/i, 'Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.'],
  [/insufficient reserved stock|insufficient stock for issue/i, 'Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.'],
  [/insufficient.*stock|below.*reserv|stock cannot/i, 'Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.'],
```

Третья запись — исходная строка 177 без изменений: у `erp_execute` есть сообщения, которых домен не бросает (`'Insufficient unreserved material stock'`), и без подстраховки в облачном режиме пользователь увидел бы английский текст.

- [ ] **Step 4: Прогон**

Run: `npx vitest run src/i18n.test.ts src/domain.test.ts`
Expected: PASS.
Run: `npx vitest run` (вся сюита)
Expected: PASS — ни один существующий тест не зависел от старой фразы (проверено поиском `zaxiradan kam` по `src/`: единственное вхождение — сам `src/i18n.ts`).

- [ ] **Step 5: Типы**

Run: `npx tsc -b --pretty false`
Expected: без ошибок.

---

### Task T3: `ShortageNotice` и три точки интерфейса

**Files:**
- Create: `src/components/ShortageNotice.tsx`
- Create: `src/shortage-ui.test.tsx`
- Create: `src/shortageStyle.test.ts`
- Modify: `src/components/OrderEditor.tsx` (props 30-37, `PositionForm` 117-122, вызов 93, полоса 150-166)
- Modify: `src/App.tsx` (баннер 574, вызов `SeriesList` 591, вызовы `OrderEditor` 665-666)
- Modify: `src/components/SeriesList.tsx` (props 11-13, `SeriesCard` 33-35, полоса 56)
- Modify: `src/styles.css` (блок `.shortage*` в конец файла)

**Interfaces:**
- Consumes: `ShortageRow`, `orderShortage`, `draftShortage` из T1; `num` (`src/ui.tsx:7`), `GoButton` (`src/ui.tsx:53`), `unitText` (`src/i18n.ts:170`); `go(section, target?)` (`src/App.tsx:358`); id разделов `warehouse`/`tasniflagich`, `purchases`/`xaridlar` (`src/sections.ts:13,15`).
- Produces: `ShortageNotice({ rows, onGo })`; проп `onGo?: (section: string, panel?: string) => void` у `OrderEditor` и `SeriesList`.

- [ ] **Step 1: Написать падающие SSR-тесты**

Создать `src/shortage-ui.test.tsx` целиком:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyState } from './domain';
import { ShortageNotice } from './components/ShortageNotice';
import { OrderEditor } from './components/OrderEditor';
import { SeriesList } from './components/SeriesList';
import type { Item, MaterialLine, Order, OrderLine, State, StockMovement } from './types';

const row = { itemId: 'paint', name: 'Poliuretan bo‘yoq', unit: 'l', needed: 13, stock: 10, reserved: 0, available: 10, short: 3 };

function baseState(): State {
  const item: Item = { id: 'paint', name: 'Poliuretan bo‘yoq', unit: 'l', minQty: 0, cost: 10, customerId: null, kind: 'material',
    salePrice: 0, lastPurchasePrice: 0, materialCost: 0, laborCost: 0, category: '06.01' };
  const movement: StockMovement = { id: 'mv1', itemId: 'paint', direction: 'in', qty: 10, unitCost: 10, source: 'purchase', sourceId: 'p1', note: '', createdAt: '2026-11-01T00:00:00.000Z' };
  const material: MaterialLine = { id: 'm1', lineId: 'L1', itemId: 'paint', qty: 13, estimatedCost: 130, issued: false, actualCost: 0 };
  const line: OrderLine = { id: 'L1', kind: 'product', title: 'Qora lak', qty: 4, total: 0, status: 'production' };
  const order: Order = { id: 'o1', number: 'ORD-0001', kind: 'series', customerId: '', title: 'Qora lak', outputItemId: null, recipeVersionId: null,
    substitutions: {}, qty: 4, price: 0, overhead: 0, dueDate: '2026-11-20', createdAt: '2026-11-01T00:00:00.000Z',
    status: 'production', lines: [line], materials: [material], route: [] };
  return { ...emptyState(), items: [item], movements: [movement], orders: [order] };
}

const noop = async () => true;

describe('ShortageNotice', () => {
  it('рендерит null без дефицита', () => {
    expect(renderToStaticMarkup(createElement(ShortageNotice, { rows: [] }))).toBe('');
  });

  it('показывает цифры и обе ссылки', () => {
    const html = renderToStaticMarkup(createElement(ShortageNotice, { rows: [row], onGo: () => {} }));
    expect(html).toContain('Materiallar yetishmaydi (1):');
    expect(html).toContain('Poliuretan bo‘yoq');
    expect(html).toContain('kerak');
    expect(html).toContain('yetishmaydi');
    expect(html).toContain('Omborga');
    expect(html).toContain('Xaridga');
  });

  it('без onGo не оставляет ссылок', () => {
    const html = renderToStaticMarkup(createElement(ShortageNotice, { rows: [row] }));
    expect(html).toContain('yetishmaydi');
    expect(html).not.toContain('Omborga');
  });
});

describe('точки применения', () => {
  it('редактор заказа с дефицитом показывает список и обе ссылки', () => {
    const state = baseState();
    const html = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(html).toContain('Materiallar yetishmaydi (1):');
    expect(html).toContain('Omborga');
    expect(html).toContain('Xaridga');
  });

  it('список серий показывает дефицит в полосе material-warning', () => {
    const html = renderToStaticMarkup(createElement(SeriesList, { state: baseState(), busy: false, run: noop, onGo: () => {} }));
    expect(html).toContain('material-warning');
    expect(html).toContain('Materiallar yetishmaydi (1):');
  });

  it('без дефицита блока нет, полоса остаётся', () => {
    const state = { ...baseState(), movements: [{ ...baseState().movements[0], qty: 40 }] };
    const editor = renderToStaticMarkup(createElement(OrderEditor, {
      state, order: state.orders[0], busy: false, close: () => {}, save: async () => {},
      createCustomer: async () => null, onGo: () => {},
    }));
    expect(editor).not.toContain('Materiallar yetishmaydi');
    const series = renderToStaticMarkup(createElement(SeriesList, { state, busy: false, run: noop, onGo: () => {} }));
    expect(series).toContain('material-warning');
    expect(series).not.toContain('Materiallar yetishmaydi');
  });
});
```

Фикстура `baseState()` содержит `OrderLine` (`lines: [line]`): `OrderEditor` строит черновик через `positionsFromOrder`, который перебирает `order.lines`, — без строки позиций не будет и дефицит не появится (проверено прогоном SSR-рендера на этой фикстуре).

> **Дополнение после ревью T3 (полный текст — в `.superpowers/sdd/2026-11-11-lkm-shortage-at-issue/task-T3-fix1-brief.md`).**
> Блок выше остаётся верным по форме, но ревью показало, что он недостаточно строг. Добавляются:
> (а) в `baseState()` второй `kind: 'series'`, `status: 'production'` заказ `o2` с тем же ЛКМ и `qty: 2` —
> только тогда ассерт на `band 2` (o1) и `band 13` (o2) ловит забытый `excludeOrderId`, без него оба ряда дают
> `band 15`;
> (б) буквальные цифры в ряду дефицита (`kerak 13`, `omborda 10`, `band 0`, `yetishmaydi <i>3</i>`) — список
> только с названием теста бы не забраковали;
> (в) `type="button"` на каждой ссылке из SSR-разметки notice — иначе клик «Omborga» внутри `<form>` редактора
> сохраняет заказ;
> (г) мобильное правило переезжает на `@media(max-width:700px)` (конвенция файла), дубль `font-size:11px` у чипа
> в media убирается, и добавляется `.material-warning .shortage-links button{margin-left:0}`;
> (д) чип в редакторе читает `yetishmaydi`, как везде, а не `etishmaydi`.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run src/shortage-ui.test.tsx`
Expected: FAIL `Cannot find module './components/ShortageNotice'`.

- [ ] **Step 3: Компонент**

Создать `src/components/ShortageNotice.tsx` целиком:

```tsx
import { CircleAlert } from 'lucide-react';
import { unitText } from '../i18n';
import { GoButton, num } from '../ui';
import type { ShortageRow } from '../shortage';

export function ShortageNotice({ rows, onGo }: { rows: ShortageRow[]; onGo?: (section: string, panel?: string) => void }) {
  if (!rows.length) return null;
  return <div className="shortage">
    <b><CircleAlert size={14} />Materiallar yetishmaydi ({rows.length}):</b>
    {rows.map(row => <span className="shortage-row" key={row.itemId}>{row.name} · kerak {num(row.needed)} {unitText(row.unit)} · omborda {num(row.stock)} · band {num(row.reserved)} · yetishmaydi <i>{num(row.short)}</i></span>)}
    {onGo && <span className="shortage-links"><GoButton onClick={() => onGo('warehouse', 'tasniflagich')}>Omborga</GoButton><GoButton onClick={() => onGo('purchases', 'xaridlar')}>Xaridga</GoButton></span>}
  </div>;
}
```

`CircleAlert` уже используется в проекте (`src/App.tsx`), `AlertTriangle` — нет.

- [ ] **Step 4: Редактор заказа**

`src/components/OrderEditor.tsx`:

4a. Импорты — добавить в блок `import { useState } ...` после строки 3 (`import { reservedQty, stockQty } from '../domain';` не трогаем):

```tsx
import { draftShortage, type ShortageRow } from '../shortage';
import { unitText } from '../i18n';
import { ShortageNotice } from './ShortageNotice';
```

4b. Props (`src/components/OrderEditor.tsx:30-37`) — добавить `onGo`:

```tsx
export function OrderEditor({ state, order, close, save, busy, createCustomer, onGo }: {
  state: State;
  order?: Order;
  close: () => void;
  save: (command: Command) => Promise<void>;
  busy: boolean;
  createCustomer: (draft: CustomerDraft) => Promise<string | null>;
  onGo?: (section: string, panel?: string) => void;
}) {
```

4c. После `const totals = orderTotals(state, positions, overhead);` (строка 46) — одна строка:

```tsx
  const shortage = draftShortage(state, positions, order?.id ?? null);
```

4d. Вызов `PositionForm` (строка 93) — передать список и навигацию:

```tsx
            ? <PositionForm state={state} position={current} customerId={customerId} onChange={changes => patch(active, changes)} shortage={shortage} onGo={onGo} />
```

4e. `PositionForm` (строки 117-122) — расширить пропсы и завести карту дефицита:

```tsx
function PositionForm({ state, position, customerId, onChange, shortage, onGo }: {
  state: State;
  position: PositionDraft;
  customerId: string;
  onChange: (changes: Partial<PositionDraft>) => void;
  shortage: ShortageRow[];
  onGo?: (section: string, panel?: string) => void;
}) {
  const floor = position.floor;
  const shortByItem = new Map(shortage.map(row => [row.itemId, row]));
  const shortageChip = (itemId: string) => {
    const row = shortByItem.get(itemId);
    return row ? <small className="shortage-chip">yetishmaydi {num(row.short)} {unitText(row.unit)}</small> : null;
  };
```

4f. Полоса под заголовком «Materiallar»: сразу после закрывающего `</div>` блока `form-section-title` (строка 153) вставить:

```tsx
    <ShortageNotice rows={shortage} onGo={onGo} />
```

4g. Чип у строки материала: последним ребёнком `div.editor-line.material-editor`, сразу после `{row.issued && <small className="route-rate">Berilgan · qulflangan</small>}` (строка 165):

```tsx
      {shortageChip(row.itemId)}
```

- [ ] **Step 5: Доска производства и серии**

`src/App.tsx`:

5a. Импорты — рядом с остальными компонентами (строка 17 импортирует `OrderEditor`):

```tsx
import { ShortageNotice } from './components/ShortageNotice';
import { orderShortage } from './shortage';
```

5b. Баннер (строка 574) — внутрь существующей полосы, после кнопки «Sexga berish». Заменяемый фрагмент:

```tsx
{admin && o.materials.some(m => !m.issued) && <div className="material-warning"><Package size={17} />Materiallar band qilingan, lekin hali berilmagan<button disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: o.id })}>Sexga berish</button></div>}
```

на:

```tsx
{admin && o.materials.some(m => !m.issued) && <div className="material-warning"><Package size={17} />Materiallar band qilingan, lekin hali berilmagan<button disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: o.id })}>Sexga berish</button><ShortageNotice rows={orderShortage(state, o)} onGo={go} /></div>}
```

Фраза и кнопка остаются: при отсутствии дефицита полоса выглядит ровно как сегодня (`ShortageNotice` рендерит `null`).

5c. `SeriesList` (строка 591) — добавить проп:

```tsx
      {panel === 'seriyalar' && <SeriesList state={state} busy={busy} run={run} onGo={go} />}
```

5d. Вызовы `OrderEditor` (строки 665 и 666) — добавить в оба
`onGo={(section, target) => { setModal(null); setNotice({ message: 'Buyurtma saqlanmadi, tahrirlash yopildi.', error: false }); go(section, target); }}`.
Просто `onGo={go}` недостаточно: `go()` не закрывает `modal`, и переход остался бы под диалогом.

`src/components/SeriesList.tsx`:

5e. Импорты:

```tsx
import { orderShortage } from '../shortage';
import { ShortageNotice } from './ShortageNotice';
```

5f. Props (строки 11-13 и вызов `SeriesCard` строка 27):

```tsx
export function SeriesList({ state, busy, run, onGo }: {
  state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
  onGo?: (section: string, panel?: string) => void;
}) {
```

```tsx
      <div className="series-list">{series.map(order => <SeriesCard key={order.id} order={order} state={state} busy={busy} run={run} onGo={onGo} itemName={id => item(id)?.name ?? 'Mahsulot'} />)}</div>
```

5g. `SeriesCard` (строки 33-36) — проп и полоса (строка 56):

```tsx
function SeriesCard({ order, state, busy, run, onGo, itemName }: {
  order: Order; state: State; busy: boolean; run: (command: Command) => Promise<boolean>;
  itemName: (id: string | null) => string;
  onGo?: (section: string, panel?: string) => void;
}) {
```

```tsx
    {order.status === 'production' && issued < order.materials.length && <div className="material-warning"><Package size={17} />Materiallar band qilindi: {order.materials.length} dan {issued} berildi<button disabled={busy} onClick={() => void run({ type: 'order.issue', orderId: order.id })}>Sexga berish</button><ShortageNotice rows={orderShortage(state, order)} onGo={onGo} /></div>}
```

- [ ] **Step 6: Стили**

Добавить в конец `src/styles.css` (одной строкой-блоком, как остальные правила файла):

```css
.shortage{display:grid;gap:4px;width:100%;font-size:11px;line-height:1.55;color:#8a4f45}
.shortage>b{display:flex;align-items:center;gap:5px;color:var(--red)}
.shortage-row{display:flex;flex-wrap:wrap;gap:4px}
.shortage-row i{font-style:normal;font-weight:800;color:var(--red)}
.shortage-links{display:flex;flex-wrap:wrap;gap:12px;margin-top:2px}
.shortage-links .text-button{padding:2px 0}
.shortage-chip{grid-column:1 / -1;justify-self:start;font-size:11px;font-weight:700;color:var(--red)}
.material-warning>.shortage{flex-basis:100%}
.material-warning .shortage-links button{margin-left:0}
@media(max-width:700px){.shortage-links .text-button{min-height:44px;display:inline-flex;align-items:center}}
```

`margin-left:0` обязателен: существующее правило `.material-warning button{margin-left:auto}` иначе выносит
обе ссылки дефицита вправо. Брейкпоинт — общий для файла (`@media(max-width:700px)`, 21 правило), а шрифт
чипа задаётся один раз в базовом правиле.

- [ ] **Step 7: CSS-замок**

Создать `src/shortageStyle.test.ts` целиком (по образцу `src/orderEditorStyle.test.ts`):

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssRules } from './mobileStyle';

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const rules = cssRules(css);

function ruleAt(selector: string, media = '') {
  return [...rules].reverse().find(rule => rule.media === media && rule.selector.split(',').map(token => token.trim()).includes(selector));
}

describe('shortage notice layout', () => {
  it('keeps the deficit list readable inside the production band', () => {
    expect(ruleAt('.shortage')?.body).toContain('font-size:11px');
    expect(ruleAt('.shortage')?.body).toContain('width:100%');
  });

  it('makes the list a full-width child of the wrapped material band', () => {
    expect(ruleAt('.material-warning>.shortage')?.body).toContain('flex-basis:100%');
  });

  it('spans the material chip across the editor row tracks', () => {
    expect(ruleAt('.shortage-chip')?.body).toContain('grid-column:1 / -1');
  });

  it('keeps the navigation links a phone-height tap target', () => {
    expect(ruleAt('.shortage-links .text-button', '@media(max-width:700px)')?.body).toContain('min-height:44px');
  });

  it('stops the band rule from pushing the deficit links to the right edge', () => {
    expect(ruleAt('.material-warning .shortage-links button')?.body).toContain('margin-left:0');
  });
});
```

- [ ] **Step 8: Прогон**

Run: `npx vitest run src/shortage-ui.test.tsx src/shortageStyle.test.ts`
Expected: PASS.
Run: `npx tsc -b --pretty false`
Expected: без ошибок. Если Vitest ругнётся на `.tsx`-тест — не нужно: `painting-ui.test.tsx` и `outsource-ui.test.tsx` уже работают.

---

### Task T4: Паритет, полная проверка и браузер

**Files:**
- Modify: только тесты, если прогон найдёт расхождение.
- Read: `docs/superpowers/specs/2026-11-11-lkm-shortage-at-issue-design.md` §6 — чек-лист проверки.

**Interfaces:**
- Consumes: всё из T1-T3.
- Produces: подтверждённая готовность к запросу на деплой.

- [ ] **Step 1: Чек-лист спецификации**

Пройти §6 спецификации построчно и отметить, каким тестом закрыт каждый пункт:

| Пункт §6 | Закрыт |
|---|---|
| 1. epsilon, агрегация, self-reservation, сортировка, нормы, отсутствие исключений | `src/shortage.test.ts` (T1) |
| 2. регрессионный замок домена | `src/domain.test.ts` (T2) |
| 3. три новых маппинга | `src/i18n.test.ts` (T2) |
| 4. SSR: список, отсутствие блока, `rows = []` | `src/shortage-ui.test.tsx` (T3) |
| 5. контракт `supabase/schema.sql` | `src/shortage.test.ts`, блок «паритет с сервером» (T1) |
| 6. `npm test`, `tsc -b`, `build`, браузер | шаги 2-4 этой задачи |
| 7. живых SQL-изменений нет | подтверждено: `supabase/schema.sql` и `supabase/migrations/` не менялись (`git` нет — проверить временем изменения файлов) |

- [ ] **Step 2: Полная сюита и сборка**

Run: `npm test`
Expected: PASS, 56 файлов (было 53 + `shortage.test.ts` + `shortage-ui.test.tsx` + `shortageStyle.test.ts`), тестов ≥ 680 (было 656 + 10 в T1 + 4 в T2 + 10 в T3).
Run: `npx tsc -b --pretty false`
Expected: exit 0.
Run: `npm run build`
Expected: exit 0, `dist/` собран.

- [ ] **Step 3: Браузер в демо-режиме**

`npm run dev`, открыть `http://127.0.0.1:5173`, войти как администратор в демо-данных.

Сценарий дефицита (данные сида: `Poliuretan bo‘yoq · oq` 06.01, норма `Bo‘yash` = 0.25 л/м², `Qotiruvchi` = 0.1 л/м²):

1. Ombor → Tasniflagich: уменьшить остаток краски быстрым редактированием (`inventory.count`).
   **План был неверен:** домен это запрещает — `inventory.count` не даёт опустить остаток ниже брони
   активных заказов («Qoldiqni faol buyurtmalar bandidan pastga tushirib bo'lmaydi»,
   [src/App.tsx:702](../../../src/App.tsx)). Дефицит в браузере создаётся правкой заказа: в существующем
   `production`-заказе поднять miqdor позиции так, чтобы нормы перевалили за остаток.
2. Биржа → Yangi buyurtma → позиция `kind: product`, miqdor `4` m², marshrut — операция `Bo‘yash` (m²), quantity 4. Требуемые нормой 1 л > 0,5 л.
   Expected: под заголовком «Materiallar» полоса «Materiallar yetishmaydi (1):» с цифрами `kerak 1 · omborda 0,5 · band 0 · yetishmaydi 0,5`, чип у строки (если краска указана явно), ссылки «Omborga»/«Xaridga».
2a. Ревизия сохранённого заказа (замок паритета из спеки §3.8): открыть «Tahrirlash» у заказа, у которого
   материалы уже содержат запечённые нормы, и сравнить цифры.
   Expected: полоса редактора показывает **те же** `kerak`/`yetishmaydi`, что и полоса на доске. Если
   редактор больше — нормы посчитаны дважды (см. fix-round T4).
3. Нажать «Omborga» → Expected: переход в Ombor/Tasniflagich (роль worker без доступа к разделу falls back на ближайший разрешённый — не падает).
4. Сохранить заказ → «Sexga ishga tushirish».
   Expected: тост `Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.`
5. Пополнить склад (Xarid → qabul) до 5 л, запустить заказ. На Sex (production) у карточки в полосе «Materiallar band qilingan, lekin hali berilmagan» Expected: список дефицита **отсутствует** (`rows = []`), полоса выглядит как до правки.
6. Сократить остаток ниже требуемого, нажать «Sexga berish».
   Expected: тост `Materiallarni berib bo‘lmaydi: omborda yetarli emas. …` и список дефицита в той же полосе.
7. Разрешения 1280px и 390px: полоса переносится (`flex-wrap`), кнопка «Sexga berish» остаётся справа, чип и ссылки читаемы, шрифт ≥ 11px, зона нажатия ссылок ≥ 44px.
   **Фактически проверено иначе:** управляемый браузер сообщает `innerWidth = clientWidth = 0`, сменить
   viewport нельзя, поэтому живая раскладка на 1280px/390px **не измерена**. В браузере прочитаны
   `getComputedStyle` отдельных узлов (`min-height:44px`, `font-size:11px`, `margin-left:0px`,
   `flex-basis:100%`, `grid-column: 1 .. -1`), а перенос и адаптив закрыты тестами
   `src/shortageStyle.test.ts` + скан-тестами читаемости/тап-таргетов.

Ограничения демо-проверки (см. память проекта): клик MCP иногда не срабатывает — использовать `evaluate_script`; скриншоты падают с `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE` — читать DOM (`take_snapshot`), состояние React перечитывать отдельным вызовом. Если браузер недоступен, сказать об этом прямо вместо утверждения о проверке.

- [ ] **Step 4: Отчёт владельцу**

На русском: что изменилось (селектор + три точки + тексты), какие проверки прогнаны с цифрами (тесты/файлы, `tsc`, `build`, браузер), что миграция не требуется, и отдельный вопрос на разрешение деплоя в `erp-tizim`.

- [ ] **Step 5: Деплой — только по разрешению**

После явного «да, erp-tizim»: `npm run deploy` (build + `rm dist/_redirects` + `wrangler deploy`), затем проверить `https://erp-tizim.doybek5557.workers.dev`. Без разрешения — ничего удалённого не выполняется.
