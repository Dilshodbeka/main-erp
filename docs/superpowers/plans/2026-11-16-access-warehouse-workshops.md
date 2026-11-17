# Права доступа, продавцы, склады и цеха — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить четыре независимо выкатываемых пакета (A→B→C→D): права/пресеты/продавцы, склады/дефицит/частичная выдача, снабжение, цеха — без изменения интерфейса при одном складе/одном цехе.

**Architecture:** Все изменения — аддитивные измерения и права поверх существующей офлайн-first модели «snapshot + команды». `State.version` остаётся `4`. Права проверяются в `applyCommand` (клиент) и `erp_execute` (сервер); маскировка данных — в `erp_snapshot`. Новые измерения (склад/цех) — коллекции с детерминированным основным id и дефолтной записью при пустом списке.

**Tech Stack:** React 19, TypeScript ~5.8, Vite 6, vitest 3, lucide-react, @supabase/supabase-js, Postgres (multi-tenant), PGlite (`@electric-sql/pglite`, throwaway для зондов).

**Spec:** `docs/superpowers/specs/2026-11-16-access-warehouse-workshops-design.md` — план аргументирует от спецификации; исполнитель читает оба документа.

## Global Constraints

- `State.version` остаётся `4` — все изменения аддитивные, старый snapshot/офлайн-очередь продолжают работать между применением SQL и деплоем.
- UI — узбекская латиница, суммы UZS. Отчёты и переписка с владельцем — на русском.
- Права проверяются на сервере (`erp_execute`, `erp_snapshot`), а не только в интерфейсе.
- Детерминированные id: основной склад `00000000-0000-4000-8000-00000000a001`, основной цех `00000000-0000-4000-8000-00000000b001` — одинаковы в SQL-миграции и клиентских константах `src/warehouse-default.ts` / `src/workshop-default.ts`.
- Пресет — только ярлык; после сохранения хранится итоговый массив `permissions`. Изменение пресета в будущем не переписывает профили.
- Один склад / один цех — ноль новых элементов интерфейса.
- Живой SQL (Supabase SQL Editor) и `npm run deploy` (Worker `erp-tizim`) — только по отдельному разрешению владельца, после готовности кода каждого пакета.
- Папка — git-репозиторий, но без git identity: **шагов commit нет**. Вместо них после каждого изменения — проверки: `npx tsc -b`, `npx vitest run`, `npm run build`, PGlite-зонд.
- TDD: каждый шаг домена — сначала падающий тест (RED), потом минимальная реализация (GREEN).
- `work.accept/start/submit` и `ticket.create/reply` — базовые действия любого `worker` (для своих этапов), не зависят от массива `permissions`.
- `Actor.id` для роли `worker` **уже равен** id сотрудника (`guide.ts:213` использует `task.employeeId === actor.id`). Это используется в `customer.claim` (sellerId = actor.id).

---

## Файловая структура

**Новые файлы:**
- `src/permissions.ts` — каталог прав, пресеты, карта «команда → гейт», `canTouchOrder`.
- `src/permissions.test.ts` — тесты прав/пресетов/продавца.
- `src/warehouse-default.ts` — id и запись «Asosiy ombor».
- `src/warehouse.test.ts` — тесты складов/перемещений/инвентаризации.
- `src/supply.ts` — сводная потребность (`SupplyNeed`).
- `src/supply.test.ts` — тесты потребности.
- `src/workshop-default.ts` — id и запись «Asosiy ishlab chiqarish».
- `src/workshop.test.ts` — тесты цехов.
- `src/access-contract.test.ts`, `src/warehouse-contract.test.ts`, `src/supply-contract.test.ts`, `src/workshop-contract.test.ts` — контрактные тесты SQL (паттерн `defectContract.test.ts`).
- `supabase/migrations/20261118_access_permissions.sql`, `20261119_warehouses.sql`, `20261120_supply.sql`, `20261121_workshops.sql`.
- `.validation-pglite-20261029/access-permissions-probe.mjs`, `warehouses-probe.mjs`, `supply-probe.mjs`, `workshops-probe.mjs`.

**Изменяемые файлы:**
- `src/types.ts` — поля Actor/Customer/StockMovement/Purchase/Order/Machine/Operation/RouteLine/State, команды `customer.claim`/`customer.assign`/`warehouse.transfer`.
- `src/domain.ts` — гейт прав, частичная выдача, перемещение, склад заказа/закупки/инвентаризации, цех этапа.
- `src/sync.ts` — `verifiedSnapshot` (нормализация массивов актора), `validate()` (убрать whitelist).
- `src/migrations.ts` — `migrateState` (нормализация sellerId/warehouseId/workshopId/warehouses/workshops/permissions).
- `src/access.ts`, `src/accessApi.ts` — пресеты/галочки/payload.
- `src/shortage.ts` — склад заказа + `suggestedFrom`.
- `src/components/AccessPanel.tsx`, `src/components/CustomerCard.tsx` (или аналог), `src/components/OrderEditor.tsx`, панели склада/настроек/закупок/сеха, `src/App.tsx` (навигация, табы, фильтры).
- `src/seed.ts` — демо-склад/цех/продавец.
- `supabase/schema.sql` — каноническая схема (все 4 пакета).

---

# Пакет A — права доступа и продавцы

## Task A1: Типы и каталог прав

**Files:**
- Create: `src/permissions.ts`
- Modify: `src/types.ts:8-9,159-163,186-247`
- Modify: `src/migrations.ts` (`migrateState`)
- Test: `src/permissions.test.ts`

**Interfaces:**
- Consumes: `Actor`, `Command`, `Customer`, `Role` из `src/types.ts`.
- Produces: `PERMISSION_KEYS`, `Permission`, `PRESETS`, `PresetKey`, `WORKER_BASE`, `GATE`, `Gate`, `canTouchOrder(actor, customer)`, `requiredPermission(type)`.

- [ ] **Step 1: Расширить типы (RED — пока только компиляция сломается позже, тип — не тест)**

В `src/types.ts`:

```ts
// Actor (строка 8)
export interface Actor {
  id: string; name: string; role: Role; companyId: string;
  permissions?: string[];      // пусто/undefined = права по роли (legacy worker)
  workshopIds?: string[];      // пусто = все цеха
  warehouseIds?: string[];     // пусто = все склады
}

// Customer (строка 9) — добавить поле
export interface Customer {
  id: string; name: string; phone: string; address: string; kind: CustomerKind; employeeId: string | null;
  sellerId: string | null;
}
```

В `Command` (после строки 187 `customer.create`) добавить две команды:

```ts
| { type: 'customer.claim'; customerId: string }
| { type: 'customer.assign'; customerId: string; sellerId: string | null }
```

- [ ] **Step 2: Написать `src/permissions.ts`**

```ts
import type { Command, Customer } from './types';

export const PERMISSION_KEYS = [
  'orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch',
  'orders.issue_materials', 'orders.cancel', 'customers.claim', 'customers.assign',
  'payments.customer', 'cash.view', 'cash.post', 'cash.reverse', 'purchases.view',
  'purchases.create', 'purchases.receive', 'suppliers.pay', 'warehouse.view', 'warehouse.count',
  'warehouse.transfer', 'cost.view', 'production.view_all', 'work.review', 'defects.view',
  'salaries.view', 'salaries.pay', 'reports.view', 'shipments.view', 'shipments.create',
  'shipments.deliver', 'settings.catalog', 'settings.access',
] as const;
export type Permission = (typeof PERMISSION_KEYS)[number];

export type PresetKey = 'Sotuvchi' | 'Katta sotuvchi' | 'Kassir' | 'Omborchi' | 'Ishlab chiqarish ustasi' | 'Sex boshlig‘i' | 'Yetkazib beruvchi';

export const PRESETS: Record<PresetKey, Permission[]> = {
  'Sotuvchi': ['orders.view_all', 'orders.create', 'orders.edit_own', 'orders.launch', 'customers.claim', 'payments.customer', 'shipments.view'],
  'Katta sotuvchi': ['orders.view_all', 'orders.create', 'orders.edit_own', 'orders.edit_all', 'orders.launch', 'orders.cancel', 'customers.claim', 'customers.assign', 'payments.customer', 'shipments.view', 'reports.view'],
  'Kassir': ['orders.view_all', 'cash.view', 'cash.post', 'payments.customer', 'reports.view'],
  'Omborchi': ['warehouse.view', 'warehouse.count', 'warehouse.transfer', 'orders.issue_materials', 'purchases.view', 'purchases.receive', 'settings.catalog'],
  'Ishlab chiqarish ustasi': [],
  'Sex boshlig‘i': ['production.view_all', 'work.review', 'defects.view', 'warehouse.view', 'orders.issue_materials'],
  'Yetkazib beruvchi': ['shipments.view', 'shipments.deliver', 'orders.view_all'],
};

// Базовые действия любого worker — не права каталога, разрешены всегда (для своих этапов).
export const WORKER_BASE: ReadonlySet<Command['type']> = new Set(['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply']);

export type Gate =
  | { kind: 'base' }                                  // worker base actions
  | { kind: 'ownership'; extra?: Permission }         // order-scoped: владение + опц. доп. право
  | { kind: 'permission'; key: Permission };

// Команды, отсутствующие в GATE, — admin-only (сохраняют прежнее поведение).
const GATE: Record<string, Gate> = {
  'customer.create': { kind: 'permission', key: 'orders.create' },
  'customer.claim': { kind: 'permission', key: 'customers.claim' },
  'customer.assign': { kind: 'permission', key: 'customers.assign' },
  'customer.pay': { kind: 'permission', key: 'payments.customer' },
  'order.create': { kind: 'permission', key: 'orders.create' },
  'series.create': { kind: 'permission', key: 'orders.create' },
  'order.update': { kind: 'ownership' },
  'orderLine.cancel': { kind: 'ownership' },
  'order.cancel': { kind: 'ownership', extra: 'orders.cancel' },
  'order.launch': { kind: 'ownership', extra: 'orders.launch' },
  'order.issue': { kind: 'permission', key: 'orders.issue_materials' },
  'purchase.create': { kind: 'permission', key: 'purchases.create' },
  'purchase.receive': { kind: 'permission', key: 'purchases.receive' },
  'supplier.pay': { kind: 'permission', key: 'suppliers.pay' },
  'inventory.count': { kind: 'permission', key: 'warehouse.count' },
  'warehouse.transfer': { kind: 'permission', key: 'warehouse.transfer' },
  'cash.post': { kind: 'permission', key: 'cash.post' },
  'cash.reverse': { kind: 'permission', key: 'cash.reverse' },
  'payroll.pay': { kind: 'permission', key: 'salaries.pay' },
  'salary.plan.set': { kind: 'permission', key: 'salaries.pay' },
  'salary.pay': { kind: 'permission', key: 'salaries.pay' },
  'shipment.create': { kind: 'permission', key: 'shipments.create' },
  'shipment.createStock': { kind: 'permission', key: 'shipments.create' },
  'shipment.deliver': { kind: 'permission', key: 'shipments.deliver' },
  'work.review': { kind: 'permission', key: 'work.review' },
  'machine.create': { kind: 'permission', key: 'settings.catalog' },
  'machine.update': { kind: 'permission', key: 'settings.catalog' },
  'operation.create': { kind: 'permission', key: 'settings.catalog' },
  'operation.update': { kind: 'permission', key: 'settings.catalog' },
  'item.create': { kind: 'permission', key: 'settings.catalog' },
  'item.update': { kind: 'permission', key: 'settings.catalog' },
  'recipe.create': { kind: 'permission', key: 'settings.catalog' },
  'recipe.version.create': { kind: 'permission', key: 'settings.catalog' },
  'routeTemplate.create': { kind: 'permission', key: 'settings.catalog' },
  'routeTemplate.update': { kind: 'permission', key: 'settings.catalog' },
};

export function requiredPermission(type: Command['type']): Permission | null {
  const gate = GATE[type];
  if (!gate) return null;
  if (gate.kind === 'permission') return gate.key;
  if (gate.kind === 'ownership' && gate.extra) return gate.extra;
  return null;
}

// Владение заказом: edit_all, либо edit_own + customer.sellerId === actor.id.
export function canTouchOrder(actor: { role: string; permissions?: string[] }, customer: Customer | undefined): boolean {
  if (actor.role === 'admin') return true;
  const perms = actor.permissions ?? [];
  if (perms.includes('orders.edit_all')) return true;
  return perms.includes('orders.edit_own') && customer?.sellerId === actor.id;
}
```

- [ ] **Step 3: Нормализовать `migrateState` в `src/migrations.ts`**

В `migrateState` (после существующей нормализации массивов) добавить:

```ts
for (const c of value.customers) if (c.sellerId === undefined) c.sellerId = null;
```

- [ ] **Step 4: Тесты `src/permissions.test.ts` (RED/GREEN для каталога)**

```ts
import { describe, expect, it } from 'vitest';
import { canTouchOrder, PRESETS, requiredPermission, WORKER_BASE } from './permissions';

describe('permissions catalog', () => {
  it('maps seller actions', () => {
    expect(requiredPermission('customer.create')).toBe('orders.create');
    expect(requiredPermission('cash.post')).toBe('cash.post');
    expect(requiredPermission('salary.pay')).toBe('salaries.pay');
    expect(requiredPermission('work.review')).toBe('work.review');
    expect(requiredPermission('employee.create')).toBeNull(); // admin-only
  });
  it('order-scoped extra permission', () => {
    expect(requiredPermission('order.cancel')).toBe('orders.cancel');
    expect(requiredPermission('order.launch')).toBe('orders.launch');
    expect(requiredPermission('order.update')).toBeNull(); // ownership only
  });
  it('worker base excludes catalog rights', () => {
    for (const t of ['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply']) expect(WORKER_BASE.has(t as never)).toBe(true);
    expect(WORKER_BASE.has('order.create')).toBe(false);
  });
  it('presets are disjoint sensible defaults', () => {
    expect(PRESETS['Ishlab chiqarish ustasi']).toEqual([]);
    expect(PRESETS['Sotuvchi']).toContain('orders.edit_own');
    expect(PRESETS['Sotuvchi']).not.toContain('orders.edit_all');
  });
});

describe('canTouchOrder', () => {
  const customer = (sellerId: string | null) => ({ sellerId } as never);
  it('admin always', () => expect(canTouchOrder({ role: 'admin' }, customer(null))).toBe(true));
  it('edit_all any', () => expect(canTouchOrder({ role: 'worker', permissions: ['orders.edit_all'] }, customer('x'))).toBe(true));
  it('edit_own own only', () => {
    expect(canTouchOrder({ role: 'worker', permissions: ['orders.edit_own'] }, customer('me'))).toBe(false);
    expect(canTouchOrder({ id: 'me', role: 'worker', permissions: ['orders.edit_own'] }, customer('me') as never)).toBe(true);
    expect(canTouchOrder({ id: 'me', role: 'worker', permissions: ['orders.edit_own'] }, customer('other') as never)).toBe(false);
  });
  it('no rights denies', () => expect(canTouchOrder({ role: 'worker' }, customer('me'))).toBe(false));
});
```

- [ ] **Step 5: Проверка**

Run: `npx tsc -b` и `npx vitest run src/permissions.test.ts`
Expected: компиляция и тесты зелёные. (Домен ещё не использует `canTouchOrder`/`requiredPermission` — отдельные модули, без регрессий.)

---

## Task A2: Домен — гейт прав, владение, customer.claim/assign

**Files:**
- Modify: `src/domain.ts:1779-1811` (applyCommand), `:892-899` (customer.create/link), `:768` (movement не трогаем), вставка новых обработчиков в `mutate`.
- Test: `src/domain.test.ts` (добавить describe) или новый `src/permissions.test.ts` (доменный блок).

**Interfaces:**
- Consumes: `canTouchOrder`, `WORKER_BASE`, `requiredPermission` из `src/permissions.ts`; `applyCommand` сигнатура.
- Produces: поведение `applyCommand` — бросает на отсутствии права; команды `customer.claim`, `customer.assign`; автозакрепление продавца при `order.create`/`series.create`.

- [ ] **Step 1: RED — доменный тест гейта и продавца**

Добавить в `src/domain.test.ts` (используя существующие хелперы `run`, `atomic`, `admin`, `fixture`):

```ts
describe('permissions gate', () => {
  const seller = (perms: string[]): Actor => ({ id: 'e1', name: 'Sotuvchi', role: 'worker', companyId: DEMO_COMPANY_ID, permissions: perms });
  it('worker without rights still does own work', () => {
    const f = fixture();
    const task = f.state.orders[0]?.route[0];
    expect(task).toBeTruthy();
    // worker with empty permissions can accept own task (base action)
    const s = run(f.state, { type: 'work.accept', orderId: f.state.orders[0].id, taskId: task!.id }, { id: task!.employeeId!, name: 'W', role: 'worker', companyId: f.state.companyId });
    expect(s.reports.length).toBeGreaterThan(0);
  });
  it('worker without rights cannot create customer', () => {
    const s = fixture().state;
    expect(() => run(s, { type: 'customer.create', name: 'X', phone: '', address: '', kind: 'customer' }, seller([]))).toThrow();
  });
  it('seller with orders.create creates customer and auto-claims it', () => {
    const s = fixture().state;
    const next = run(s, { type: 'customer.create', name: 'X', phone: '', address: '', kind: 'customer' }, seller(['orders.create']));
    expect(next.customers.at(-1)!.sellerId).toBe('e1');
  });
  it('seller edits own order, not others', () => {
    let s = fixture().state;
    s = run(s, { type: 'customer.create', name: 'Mine', phone: '', address: '', kind: 'customer' }, seller(['orders.create', 'orders.edit_own']));
    const mine = s.customers.at(-1)!;
    s = run(s, { type: 'order.create', input: { kind: 'product', customerId: mine.id, title: 'A', qty: 1, price: 10, overhead: 0, dueDate: '2026-12-01', advance: 0, account: 'cash', materials: [], route: [] } }, seller(['orders.create', 'orders.edit_own']));
    const order = s.orders.at(-1)!;
    // own order editable
    run(s, { type: 'order.update', orderId: order.id, title: 'A2', overhead: 0, dueDate: '2026-12-02' }, seller(['orders.create', 'orders.edit_own']));
    // other seller's order (claim by admin-assign) not editable
    const other = fixture().state;
    expect(() => run(other, { type: 'order.update', orderId: order.id, title: 'X', overhead: 0, dueDate: '2026-12-02' }, { id: 'e9', name: 'Other', role: 'worker', companyId: DEMO_COMPANY_ID, permissions: ['orders.edit_own'] })).toThrow();
  });
  it('customer.claim only when unassigned and has right', () => {
    let s = fixture().state;
    const c = s.customers[0];
    s = run(s, { type: 'customer.claim', customerId: c.id }, seller(['customers.claim']));
    expect(s.customers.find(x => x.id === c.id)!.sellerId).toBe('e1');
    expect(() => run(s, { type: 'customer.claim', customerId: c.id }, seller(['customers.claim']))).toThrow(); // already assigned
  });
  it('customer.assign requires right', () => {
    const s = fixture().state;
    expect(() => run(s, { type: 'customer.assign', customerId: s.customers[0].id, sellerId: 'e1' }, seller([]))).toThrow();
    const next = run(s, { type: 'customer.assign', customerId: s.customers[0].id, sellerId: 'e1' }, seller(['customers.assign']));
    expect(next.customers[0].sellerId).toBe('e1');
  });
});
```

- [ ] **Step 2: Run — RED**

Run: `npx vitest run src/domain.test.ts -t "permissions gate"`
Expected: FAIL (сейчас `worker` с любым массивом прав выбрасывает `Administrator action required`; `customer.claim`/`assign` не существуют).

- [ ] **Step 3: Реализовать гейт в `applyCommand`**

Заменить строку 1784 (`check(actor.role === 'admin' || [...], 'Administrator action required')`) на:

```ts
import { canTouchOrder, WORKER_BASE, requiredPermission } from './permissions';

function authorize(state: State, actor: Actor, command: Command): void {
  if (actor.role === 'admin') return;
  if (actor.role === 'display') throw new Error('Ustaxona ekrani faqat kanbanni ko‘radi va amallarni bajara olmaydi.');
  if (WORKER_BASE.has(command.type)) return; // проверка «своего» этапа — в обработчиках work.*
  const gate = commandType === 'order.update' || commandType === 'orderLine.cancel' || commandType === 'order.cancel' || commandType === 'order.launch';
  const perms = actor.permissions ?? [];
  if (gate) {
    const order = state.orders.find(o => o.id === (command as { orderId?: string }).orderId);
    const customer = order ? state.customers.find(c => c.id === order.customerId) : undefined;
    if (!canTouchOrder(actor, customer)) throw new Error('Faqat o‘z mijozlaringiz buyurtmalarini boshqarishingiz mumkin.');
    const extra = requiredPermission(command.type);
    if (extra && !perms.includes(extra)) throw new Error('Administrator action required');
    return;
  }
  const req = requiredPermission(command.type);
  if (!req || !perms.includes(req)) throw new Error('Administrator action required');
}
```

В начале `applyCommand` (сразу после `check(actor.companyId === state.companyId, ...)`, строка 1782) вызвать `authorize(state, actor, envelope.command);` и удалить старую проверку на строке 1784.

- [ ] **Step 4: Реализовать `customer.claim` / `customer.assign` и автозакрепление**

В `mutate(state, command, actor)` добавить case-ветки (в существующий `switch` по `command.type`):

```ts
case 'customer.claim': {
  const customer = state.customers.find(c => c.id === command.customerId);
  if (!customer) throw new Error('Mijoz topilmadi');
  if (customer.sellerId) throw new Error('Bu mijoz allaqachon biriktirilgan');
  customer.sellerId = actor.id; // actor.id = employeeId для worker
  return 'Mijoz sizga biriktirildi';
}
case 'customer.assign': {
  const customer = state.customers.find(c => c.id === command.customerId);
  if (!customer) throw new Error('Mijoz topilmadi');
  if (command.sellerId !== null && !state.employees.some(e => e.id === command.sellerId && e.active)) throw new Error('Faol xodimni tanlang');
  customer.sellerId = command.sellerId;
  return command.sellerId ? 'Mas’ul sotuvchi tayinlandi' : 'Mas’ul sotuvchi olib tashlandi';
}
```

В обработчике `customer.create` (строка ~892) после создания записи, если `actor.role === 'worker'` и есть право `customers.claim`, проставить `customer.sellerId = actor.id`. В `order.create`/`series.create` (обработчики, создающие заказ) — если у клиента `sellerId === null` и у актора есть `customers.claim`, проставить клиенту `sellerId = actor.id` (правило 4.4: «если у клиента нет ответственного, клиент автоматически закрепляется за ним при создании заказа»).

- [ ] **Step 5: Run — GREEN**

Run: `npx vitest run src/domain.test.ts`
Expected: новый describe зелёный; остальные 36 файлов без изменения ожиданий.

---

## Task A3: sync.ts — нормализация актора и снятие whitelist

**Files:**
- Modify: `src/sync.ts:22-34` (verifiedSnapshot), `:70-82` (validate).
- Test: `src/sync.test.ts` (добавить кейс).

**Interfaces:**
- Consumes: `applyCommand` с новым гейтом; поля `permissions` актора.
- Produces: `verifiedSnapshot` нормализует `permissions/workshopIds/warehouseIds` в массивы; `validate` больше не блокирует worker-команды по whitelist (гейт — в `applyCommand`).

- [ ] **Step 1: RED**

В `src/sync.test.ts` добавить:

```ts
it('accepts actor without permissions arrays', async () => {
  // verifiedSnapshot нормализует отсутствующие массивы в []
  const snap = await makeSync(state, { id: 'w', name: 'W', role: 'worker', companyId: state.companyId }).snapshot();
  expect(snap.actor.permissions).toEqual([]);
});
```

- [ ] **Step 2: Run — RED**

Run: `npx vitest run src/sync.test.ts`
Expected: FAIL (permissions undefined).

- [ ] **Step 3: Нормализация в `verifiedSnapshot`**

В `verifiedSnapshot` после проверки `actor.role` (строка ~30) добавить:

```ts
actor.permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
actor.workshopIds = Array.isArray(actor.workshopIds) ? actor.workshopIds : [];
actor.warehouseIds = Array.isArray(actor.warehouseIds) ? actor.warehouseIds : [];
```

- [ ] **Step 4: Убрать whitelist в `validate`**

Удалить строки 77-79 (`if (actor.role === 'worker' && ![...].includes(next.type)) { throw ... }`). Гейт прав теперь выполняет `applyCommand` внутри цикла `validate` (строка 80). Оставить проверку `display` (строка 71).

- [ ] **Step 5: Run — GREEN**

Run: `npx vitest run src/sync.test.ts src/domain.test.ts`
Expected: зелёные.

---

## Task A4: SQL — права, пресеты, продавец (схема + миграция)

**Files:**
- Modify: `supabase/schema.sql` (erp_profiles ~39-48, erp_snapshot ~1630-1783, erp_execute ~1865+ и whitelist ~1974-1976).
- Create: `supabase/migrations/20261118_access_permissions.sql`
- Test: `src/access-contract.test.ts`

**Interfaces:**
- Consumes: `PERMISSION_KEYS` (тот же список — в SQL как CHECK/белый список); имена таблиц из схемы.
- Produces: колонки `erp_profiles.permissions/scope_workshop_ids/scope_warehouse_ids`, `erp_customers.seller_id`, функция `erp_has_permission(profile, key)`, маскировка `erp_snapshot`, permission-гейт `erp_execute`.

- [ ] **Step 1: Колонки `erp_profiles` и `erp_customers`**

В `schema.sql` в блок `CREATE TABLE erp_profiles` (после строки ~48) добавить:

```sql
permissions jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(permissions) = 'array'),
scope_workshop_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(scope_workshop_ids) = 'array'),
scope_warehouse_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(scope_warehouse_ids) = 'array')
```

В `erp_customers` (после `employee_id`):

```sql
seller_id uuid,
FOREIGN KEY (company_id, seller_id) REFERENCES public.erp_employees(company_id, id)
```

- [ ] **Step 2: `erp_has_permission`**

```sql
CREATE OR REPLACE FUNCTION public.erp_has_permission(p_profile public.erp_profiles, p_key text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_profile.role = 'admin' OR COALESCE(p_profile.permissions ? p_key, false);
$$;
```

- [ ] **Step 3: Permission-гейт в `erp_execute`**

Заменить whitelist (строки ~1974-1976) на:

```sql
-- базовые действия worker всегда разрешены (для своих этапов)
IF v_actor.role = 'worker' AND v_type IN ('work.accept','work.start','work.submit','ticket.create','ticket.reply') THEN
  NULL; -- pass
ELSIF v_actor.role = 'worker' THEN
  -- право по карте команда → ключ
  IF NOT public.erp_has_permission(v_actor, v_req_permission) THEN
    RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
  END IF;
  -- владение для order-scoped команд
  IF v_type IN ('order.update','orderLine.cancel','order.cancel','order.launch') THEN
    IF NOT public.erp_can_touch_order(v_actor, v_order_customer_id) THEN
      RAISE EXCEPTION 'Faqat o‘z mijozlaringiz buyurtmalarini boshqarishingiz mumkin' USING ERRCODE = '42501';
    END IF;
  END IF;
ELSIF v_actor.role = 'display' THEN
  RAISE EXCEPTION 'Display is read-only' USING ERRCODE = '42501';
END IF;
```

`v_req_permission` вычисляется CASE-картой (зеркало `GATE`), а `v_order_customer_id` — `seller_id` клиента заказа (для order-scoped команд). Добавить вспомогательные SQL-функции:

```sql
CREATE OR REPLACE FUNCTION public.erp_command_permission(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type
    WHEN 'customer.create' THEN 'orders.create'
    WHEN 'customer.claim' THEN 'customers.claim'
    WHEN 'customer.assign' THEN 'customers.assign'
    WHEN 'customer.pay' THEN 'payments.customer'
    WHEN 'order.create' THEN 'orders.create'
    WHEN 'series.create' THEN 'orders.create'
    WHEN 'order.cancel' THEN 'orders.cancel'
    WHEN 'order.launch' THEN 'orders.launch'
    WHEN 'order.issue' THEN 'orders.issue_materials'
    WHEN 'purchase.create' THEN 'purchases.create'
    WHEN 'purchase.receive' THEN 'purchases.receive'
    WHEN 'supplier.pay' THEN 'suppliers.pay'
    WHEN 'inventory.count' THEN 'warehouse.count'
    WHEN 'warehouse.transfer' THEN 'warehouse.transfer'
    WHEN 'cash.post' THEN 'cash.post'
    WHEN 'cash.reverse' THEN 'cash.reverse'
    WHEN 'payroll.pay' THEN 'salaries.pay'
    WHEN 'salary.plan.set' THEN 'salaries.pay'
    WHEN 'salary.pay' THEN 'salaries.pay'
    WHEN 'shipment.create' THEN 'shipments.create'
    WHEN 'shipment.createStock' THEN 'shipments.create'
    WHEN 'shipment.deliver' THEN 'shipments.deliver'
    WHEN 'work.review' THEN 'work.review'
    WHEN 'machine.create' THEN 'settings.catalog'
    WHEN 'machine.update' THEN 'settings.catalog'
    WHEN 'operation.create' THEN 'settings.catalog'
    WHEN 'operation.update' THEN 'settings.catalog'
    WHEN 'item.create' THEN 'settings.catalog'
    WHEN 'item.update' THEN 'settings.catalog'
    WHEN 'recipe.create' THEN 'settings.catalog'
    WHEN 'recipe.version.create' THEN 'settings.catalog'
    WHEN 'routeTemplate.create' THEN 'settings.catalog'
    WHEN 'routeTemplate.update' THEN 'settings.catalog'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.erp_can_touch_order(p_profile public.erp_profiles, p_customer_seller_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_profile.role = 'admin'
      OR public.erp_has_permission(p_profile, 'orders.edit_all')
      OR (public.erp_has_permission(p_profile, 'orders.edit_own') AND p_customer_seller_id = p_profile.employee_id);
$$;
```

- [ ] **Step 4: Маскировка в `erp_snapshot`**

В `erp_snapshot` (для не-`admin`) реализовать правила 4.5:
- `suppliers`, `purchases`, `reports`, `payroll`, `salaryPlans`, `expensePlans`, `loans`, `workerDeductions` — только при соответствующем праве (`purchases.view`, `work.review`/`production.view_all` для reports, `salaries.view` для payroll/salaryPlans, `payments.customer` для видимых строк workerDeductions).
- `cash` — при `cash.view` все записи; иначе только `source='sale'` с `customer_id` из видимых клиентов.
- `movements` — всем кроме `display`; `unitCost` обнуляется без `cost.view`, `note` скрывается.
- Поля себестоимости (`items.cost/lastPurchasePrice/materialCost/laborCost`, `orders.price/overhead/markup`, `materials.estimatedCost/actualCost`, `tasks.rate/supplierCost/salePrice`) — только при `cost.view`.
- `customers`/`orders` — при `orders.view_all` все, иначе только заказы клиентов с `seller_id = v_profile.employee_id` плюс заказы со своими этапами.

Реализуется через `CASE WHEN public.erp_has_permission(v_profile, '...') THEN ... ELSE ... END` в каждом `SELECT` — по образцу существующего `v_admin`/`v_board` (строки 1630-1783). Конкретные места: `cash` (строка ~1729 фильтр `AND v_admin` для `movements`), массив `customers`, `orders`, `items`, `reports`, `payroll`, `salaryPlans`, `workerDeductions`.

- [ ] **Step 5: Миграция `20261118_access_permissions.sql`**

Тот же набор изменений, идемпотентно (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `CREATE INDEX IF NOT EXISTS`), плюс:

```sql
ALTER TABLE public.erp_profiles ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.erp_profiles ADD COLUMN IF NOT EXISTS scope_workshop_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.erp_profiles ADD COLUMN IF NOT EXISTS scope_warehouse_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_profiles_permissions_array') THEN
    ALTER TABLE public.erp_profiles ADD CONSTRAINT erp_profiles_permissions_array CHECK (jsonb_typeof(permissions) = 'array');
  END IF;
END $$;
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS seller_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_customers_seller_fk') THEN
    ALTER TABLE public.erp_customers ADD CONSTRAINT erp_customers_seller_fk FOREIGN KEY (company_id, seller_id) REFERENCES public.erp_employees(company_id, id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS erp_customers_seller_idx ON public.erp_customers(company_id, seller_id);
-- + CREATE OR REPLACE erp_has_permission / erp_command_permission / erp_can_touch_order
-- + CREATE OR REPLACE erp_snapshot / erp_execute (полные тела, идемпотентно)
```

- [ ] **Step 6: Контрактный тест `src/access-contract.test.ts`**

По образцу `defectContract.test.ts` (чтение `schema.sql` и проверка подстрок):

```ts
import { readFileSync } from 'node:fs';
const schema = readFileSync('supabase/schema.sql', 'utf8');
it('has permission columns and helper', () => {
  expect(schema).toContain('permissions jsonb NOT NULL DEFAULT');
  expect(schema).toContain('seller_id uuid');
  expect(schema).toContain('CREATE OR REPLACE FUNCTION public.erp_has_permission');
  expect(schema).toContain('p_profile.role = \'admin\' OR COALESCE(p_profile.permissions ? p_key, false)');
});
```

- [ ] **Step 7: Проверка**

Run: `npx tsc -b`, `npx vitest run src/access-contract.test.ts`
Expected: зелёные.

---

## Task A5: PGlite-зонд A

**Files:**
- Create: `.validation-pglite-20261029/access-permissions-probe.mjs`

**Interfaces:**
- Consumes: паттерн `.validation-pglite-20261029/combined-migrations-probe.mjs` (bootstrap схемы + применить `schema.sql` + миграцию + assert).
- Produces: вывод `OK` при наличии колонок/функций и корректной маскировке.

- [ ] **Step 1: Написать зонд**

```js
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
await db.exec(/* bootstrap roles + минимальные таблицы, необходимые erp_profiles/erp_customers/erp_employees */);
const schema = readFileSync('supabase/schema.sql', 'utf8');
await db.exec(schema);
await db.exec(readFileSync('supabase/migrations/20261118_access_permissions.sql', 'utf8'));

const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='erp_profiles' AND column_name IN ('permissions','scope_workshop_ids','scope_warehouse_ids')`);
assert(cols.rows.length === 3, 'erp_profiles columns missing');

const fn = await db.query(`SELECT pg_get_functiondef(oid) AS d FROM pg_proc WHERE proname='erp_has_permission'`);
assert(fn.rows[0].d.includes("permissions ? p_key"), 'erp_has_permission wrong');

// маскировка: worker без cash.view не получает cash-записи кроме sale
const masked = await db.query(`SELECT public.erp_snapshot('00000000-0000-4000-8000-0000000000c1', (SELECT ... FROM erp_profiles WHERE role='worker' LIMIT 1))`);
// assert cash only sale, unitCost zeroed, etc.
console.log('OK access-permissions-probe');
```

Зонд должен: (1) подтвердить 3 колонки и 1 колонку `seller_id`; (2) `erp_has_permission('admin')=true`, `worker` с ключом → true, без → false; (3) `erp_snapshot` для worker без `cost.view` отдаёт `unitCost = 0` и не отдаёт `cash` кроме sale. (Исполнитель уточняет точные id/строки под текущую схему из `combined-migrations-probe.mjs`.)

- [ ] **Step 2: Run**

Run: `node .validation-pglite-20261029/access-permissions-probe.mjs`
Expected: `OK access-permissions-probe`.

---

## Task A6: AccessPanel — пресеты и галочки

**Files:**
- Modify: `src/access.ts` (типы/валидация: добавить `permissions`, `scopeWorkshopIds`, `scopeWarehouseIds` в `AccessDraft`/`AccessAccount`).
- Modify: `src/accessApi.ts` (передавать `permissions`/scope в payload).
- Modify: `src/components/AccessPanel.tsx`.
- Test: `src/access.test.ts` (расширить).

**Interfaces:**
- Consumes: `PRESETS`, `PERMISSION_KEYS`, `PresetKey` из `src/permissions.ts`; `AccessAccount`/`AccessDraft` из `src/access.ts`.
- Produces: панель с выбором пресета и группами галочек; `createAccount`/`resetAccountPassword` отправляют `permissions`.

- [ ] **Step 1: RED — валидация пресета**

В `src/access.test.ts`:

```ts
it('applies preset permissions', () => {
  const draft = { ...baseDraft, preset: 'Sotuvchi' as const };
  const resolved = resolvePermissions(draft); // новая функция в access.ts
  expect(resolved).toEqual(PRESETS['Sotuvchi']);
});
```

- [ ] **Step 2: Реализовать `resolvePermissions` в `src/access.ts`**

```ts
import { PERMISSION_KEYS, PRESETS, type Permission, type PresetKey } from './permissions';

export function resolvePermissions(preset: PresetKey | '', overrides: Permission[]): Permission[] {
  if (!preset) return overrides.filter(p => PERMISSION_KEYS.includes(p as Permission));
  const base = PRESETS[preset];
  // галочки, включённые поверх пресета, добавляются; снятые — убираются
  const set = new Set<Permission>(base);
  for (const k of PRESETS[preset]) { if (!overrides.includes(k)) set.delete(k); }
  for (const k of overrides) if (PERMISSION_KEYS.includes(k as Permission)) set.add(k);
  return [...set];
}
```

(В UI переключение пресета заполняет галочки значениями пресета; пользователь может до-включать/снимать. `overrides` — итоговый набор выбранных галочек в форме.)

- [ ] **Step 3: Обновить `AccessDraft`/`AccessAccount`/`accessApi.ts`**

`AccessDraft` получает `preset: PresetKey | ''` и `permissions: Permission[]`. `createAccount` отправляет `permissions: resolvePermissions(...)`, `scopeWorkshopIds: []`, `scopeWarehouseIds: []`.

- [ ] **Step 4: UI `AccessPanel.tsx`**

В форму «Yangi kirish» (строки 138-156) добавить: выпадающий список пресета (`PRESETS`-ключи с подписями), затем группы галочек по разделам — «Savdo», «Kassa», «Ombor», «Ishlab chiqarish», «Hisobotlar», «Sozlamalar», каждая с ключами из каталога. В списке аккаунтов показать пресет/ключевые права строкой. Scope-поля (цеха/склады) скрыть до пакетов B/D (условие по `cloud`-наличию коллекций — фактически добавляются позже). Использовать существующие `Field`, `Section`, классы `form-grid`, `segmented`.

```tsx
<Field label="Preset">
  <select value={draft.preset} onChange={e => { const p = e.target.value as PresetKey | ''; setDraft({ ...draft, preset: p, permissions: p ? PRESETS[p] : draft.permissions }); }}>
    <option value="">Moslashtirilgan</option>
    {Object.keys(PRESETS).map(k => <option key={k} value={k}>{k}</option>)}
  </select>
</Field>
<div className="perm-groups">
  {PERMISSION_GROUPS.map(g => (
    <fieldset key={g.title}><legend>{g.title}</legend>
      {g.keys.map(key => (
        <label key={key}><input type="checkbox" checked={draft.permissions.includes(key)} onChange={...} />{PERMISSION_LABEL[key]}</label>
      ))}
    </fieldset>
  ))}
</div>
```

Добавить словарь `PERMISSION_LABEL: Record<Permission, string>` на узбекской латыни (например `orders.view_all` → «Barcha buyurtmalarni ko‘rish» и т. д.) и `PERMISSION_GROUPS`.

- [ ] **Step 5: Проверка**

Run: `npx tsc -b`, `npx vitest run src/access.test.ts`
Expected: зелёные.

---

## Task A7: UI — навигация по правам, «Mening mijozim», фильтр

**Files:**
- Modify: `src/App.tsx` (реестр разделов/навигации, ~90-92 задача), `src/components/CustomerCard.tsx` (или компонент списка клиентов), CRM-панель.
- Test: `src/guide.test.ts` (не менять; навигация — визуально в демо).

**Interfaces:**
- Consumes: `actor.permissions`, `state.customers[].sellerId`.
- Produces: скрытие разделов без прав; кнопка «Mening mijozim» у клиента без ответственного; фильтр «Mening mijozlarim».

- [ ] **Step 1: Навигация по правам**

В реестре разделов (App.tsx) обернуть пункты условиями: «Moliya»/касса — только с `cash.view`; «Ombor» — `warehouse.view`; «Xaridlar» — `purchases.view`; «Hisobotlar» — `reports.view`; «Sozlamalar» — `settings.catalog`/`settings.access`; «Savdo»/CRM — `orders.view_all` или `orders.create`. Для `worker` без продажных прав стартовая страница — личный терминал (текущее поведение).

```ts
const can = (key: Permission) => actor.role === 'admin' || (actor.permissions ?? []).includes(key);
```

- [ ] **Step 2: Кнопка «Mening mijozim» и ответственный в карточке**

В карточке клиента: показать ответственного (`state.employees.find(e => e.id === customer.sellerId)?.name`). Если `sellerId === null` и у актора есть `customers.claim` — кнопка:

```tsx
{customer.sellerId === null && can('customers.claim') && (
  <button className="secondary small" onClick={() => run({ type: 'customer.claim', customerId: customer.id })}>Mening mijozim</button>
)}
```

- [ ] **Step 3: Фильтр «Mening mijozlarim»**

В CRM для не-админа с `orders.edit_own` — фильтр, показывающий клиентов с `sellerId === actor.id`. При `orders.view_all` — фильтр не нужен (видит всех).

- [ ] **Step 4: Проверка в демо**

Run: `npx tsc -b`, `npm run build`; в демо-режиме проверить, что admin видит всё, а имитация продавца (временная подмена `demoAdmin` на worker с правами в localStorage) скрывает Moliya и показывает «Mening mijozim». (Полный облачный сценарий — у владельца после выката.)

---

## Task A8: Проверка пакета A

- [ ] **Step 1:** `npx tsc -b` — без ошибок.
- [ ] **Step 2:** `npx vitest run` — все 36+ файлов зелёные (существующие ожидания не менялись).
- [ ] **Step 3:** `npm run build` — exit 0.
- [ ] **Step 4:** Демо-сценарий A: admin создаёт продавца (в демо — только UI), продавец видит всех клиентов, не редактирует чужой заказ; работник без прав ведёт себя как раньше.
- [ ] **Step 5:** Сообщить владельцу на русском: пакет A готов; SQL `20261118_access_permissions.sql` и `npm run deploy` — ждут отдельного разрешения.

---

# Пакет B — склады и дефицит

## Task B1: Типы и дефолт склада

**Files:**
- Create: `src/warehouse-default.ts`
- Modify: `src/types.ts` (Warehouse, `warehouseId` на StockMovement/Purchase/Order, `source` + 'transfer', команда `warehouse.transfer`, `State.warehouses`)
- Modify: `src/migrations.ts` (`migrateState`)
- Modify: `src/sync.ts:25` (`verifiedSnapshot` — массив `warehouses`)
- Test: `src/warehouse.test.ts`

**Interfaces:**
- Consumes: `State`, `StockMovement`, `Purchase`, `Order`, `Command`.
- Produces: `Warehouse`, `MAIN_WAREHOUSE_ID`, `mainWarehouse()`, `warehouses` в `State`, `warehouse.transfer`.

- [ ] **Step 1: Типы**

```ts
// src/warehouse-default.ts
export const MAIN_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000a001';
export function mainWarehouse(): Warehouse { return { id: MAIN_WAREHOUSE_ID, name: 'Asosiy ombor', active: true }; }
```

В `types.ts`:

```ts
export interface Warehouse { id: string; name: string; active: boolean }
// StockMovement: + warehouseId: string; source: ... | 'transfer'
// Purchase: + warehouseId: string
// Order: + warehouseId: string
// State: + warehouses: Warehouse[]
// Command: + | { type: 'warehouse.transfer'; itemId: string; fromId: string; toId: string; qty: number; note: string }
```

- [ ] **Step 2: Нормализация**

`migrateState`: `state.warehouses ??= []`; если пусто — `state.warehouses = [mainWarehouse()]`; для каждого `movement/purchase/order` без `warehouseId` — `warehouseId = MAIN_WAREHOUSE_ID`.

`verifiedSnapshot` (sync.ts): добавить `'warehouses'` в список обязательных массивов (строка 25); если сервер вернул пустой — заполнить дефолтной записью (как в `migrateState`).

- [ ] **Step 3: RED — тест нормализации**

```ts
it('normalizes missing warehouses to main', () => {
  const s = migrateState({ ...baseState(), warehouses: undefined } as never);
  expect(s.warehouses.map(w => w.name)).toEqual(['Asosiy ombor']);
});
```

- [ ] **Step 4: Run — RED → GREEN, затем проверка**

Run: `npx vitest run src/warehouse.test.ts`, `npx tsc -b`
Expected: компиляция падает на всех местах использования `StockMovement` без `warehouseId` — это ожидаемо, чинится в B2.

---

## Task B2: Домен — склад в движениях, stockQty/reservedQty, inventory.count

**Files:**
- Modify: `src/domain.ts` (`movement` ~768, `stockQty` ~552, `reservedQty` ~557, `inventory.count` ~1604, все call-сайты `movement()`).
- Test: `src/warehouse.test.ts`

**Interfaces:**
- Consumes: `MAIN_WAREHOUSE_ID`, `mainWarehouse()`.
- Produces: `stockQty(state, itemId, warehouseId?)`, `reservedQty(state, itemId, warehouseId?)`; все движения несут `warehouseId`.

- [ ] **Step 1: Сигнатуры**

```ts
function stockQty(state: State, itemId: string, warehouseId?: string): number {
  return state.movements
    .filter(m => m.itemId === itemId && (!warehouseId || m.warehouseId === warehouseId))
    .reduce((sum, m) => sum + (m.direction === 'in' ? m.qty : -m.qty), 0);
}
function reservedQty(state: State, itemId: string, warehouseId?: string): number {
  // как сейчас, но с фильтром по warehouseId (резервы считаются по складу заказа)
}
```

- [ ] **Step 2: Проставить `warehouseId` во всех call-сайтах `movement()`**

Каждый вызов `movement(state, {...})` получает `warehouseId`:
- `item.create` (~969) — основной (открывающий остаток).
- `customer.receive` (~1009) — основной.
- `order.issue` (~1189) — `order.warehouseId`.
- `order.cancel` (~1205), `orderLine.cancel` (~1228) — `order.warehouseId`.
- `purchase.receive` (~1449) — `purchase.warehouseId`.
- `inventory.count` (~1610) — склад команды (`command.warehouseId ?? MAIN_WAREHOUSE_ID`).
- `receiveSeriesOutput` (~876) — `order.warehouseId`.
- `shipment.createStock` (~1697), `shipment.reverse` (~1708) — основной.

- [ ] **Step 3: `inventory.count` со складом**

Добавить `warehouseId?` в команду `inventory.count` (тип). Сверка/корректировка — по выбранному складу; нижняя граница — резерв этого склада (`reservedQty(state, itemId, warehouseId)`).

- [ ] **Step 4: RED/GREEN тесты**

```ts
it('stockQty per warehouse', () => {
  let s = baseState();
  s = run(s, { type: 'item.create', name: 'F', unit: 'm', minQty: 0, cost: 5, customerId: null });
  const item = s.items[0].id;
  s = run(s, { type: 'inventory.count', itemId: item, qty: 10, note: '' });
  expect(stockQty(s, item)).toBe(10);
  expect(stockQty(s, item, MAIN_WAREHOUSE_ID)).toBe(10);
  expect(stockQty(s, item, 'other')).toBe(0);
});
```

- [ ] **Step 5: Run — GREEN, регрессии**

Run: `npx vitest run src/warehouse.test.ts src/material-issue.test.ts src/domain.test.ts`
Expected: зелёные; `material-issue.test.ts` пока без изменений (частичная выдача — B3).

---

## Task B3: Домен — запуск без блокировки и частичная выдача

**Files:**
- Modify: `src/domain.ts` (`order.launch` ~1147-1159, `order.issue` ~1172-1195, `order.update` — блокировка склада).
- Modify: `src/shortage.ts` (склад заказа + `suggestedFrom`).
- Test: `src/material-issue.test.ts` (обновить), `src/warehouse.test.ts`.

**Interfaces:**
- Consumes: `stockQty`/`reservedQty` с warehouseId; `reservedExcept`/`orderShortage`.
- Produces: `order.launch` без проверки остатка; `order.issue` частичная (`take = min(qty-issuedQty, max(0, stock − резервы других заказов))`); `order.update` запрещает менять склад после первой выдачи.

- [ ] **Step 1: RED — частичная выдача**

В `src/warehouse.test.ts` (или `material-issue.test.ts`) — заказ с двумя материалами, в наличии только первый:

```ts
it('issue takes what is available, leaves the rest in deficit', () => {
  let s = paintWorld(2, 0); // материал1=2, материал2=0
  s = run(s, { type: 'order.create', input: createInput(s) });
  s = run(s, { type: 'order.launch', orderId: s.orders[0].id }); // не блокируется
  s = run(s, { type: 'order.issue', orderId: s.orders[0].id });
  const order = s.orders[0];
  expect(order.materials[0].issuedQty).toBe(2);
  expect(order.materials[1].issuedQty).toBe(0);
  expect(orderShortage(s, order).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run — RED**

Run: `npx vitest run src/warehouse.test.ts`
Expected: FAIL (сейчас `order.launch` бросает `Insufficient available stock`, `order.issue` — `Insufficient reserved stock`).

- [ ] **Step 3: Убрать блокировку в `order.launch`**

Удалить строку ~1159 (`check(!exceeds(row.qty, stockQty(...) - reservedQty(...)), 'Insufficient available stock')`). Оставить остальные проверки (черновик, уникальность материалов, не выдано, принадлежность материала, активность операции/исполнителя).

- [ ] **Step 4: Частичная выдача в `order.issue`**

Заменить all-or-nothing тело:

```ts
case 'order.issue': {
  const order = state.orders.find(o => o.id === command.orderId);
  if (!order || order.status !== 'production') throw new Error('Buyurtma ishlab chiqarishda emas');
  let anyIssued = false;
  for (const line of order.materials) {
    const remaining = line.qty - line.issuedQty;
    if (remaining <= 0) continue;
    const free = Math.max(0, stockQty(state, line.itemId, order.warehouseId) - reservedExcept(state, line.itemId, order.id, order.warehouseId));
    const take = Math.min(remaining, free);
    if (take <= 0) continue;
    line.issuedQty += take;
    line.actualCost += take * state.items.find(i => i.id === line.itemId)!.cost;
    movement(state, { itemId: line.itemId, direction: 'out', qty: take, unitCost: /* cost */, source: 'order', sourceId: order.id, warehouseId: order.warehouseId, note: '' });
    anyIssued = true;
  }
  if (!anyIssued) throw new Error('Omborda material yo‘q. Qoldiqni to‘ldiring');
  return 'Materiallar qisman berildi';
}
```

(Удалить проверку `Insufficient reserved stock`; `reservedExcept` получает параметр `warehouseId`.) Резерв «своего» заказа не мешает: `free = stock − резервы других заказов` (для этого `reservedExcept` уже исключает свой заказ — расширить его складом).

- [ ] **Step 5: Блокировка смены склада в `order.update`**

```ts
if (command.warehouseId && command.warehouseId !== order.warehouseId) {
  if (order.materials.some(m => m.issuedQty > 0)) throw new Error('Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi');
  order.warehouseId = command.warehouseId;
}
```

(Добавить `warehouseId?` в `order.update` и `OrderInput`.)

- [ ] **Step 6: `src/shortage.ts` — склад и `suggestedFrom`**

`orderShortage(state, order)` считает по `order.warehouseId`; каждая строка `ShortageRow` получает `suggestedFrom: { warehouseId: string; available: number }[]` — по всем активным складам, где свободно (`stock − резервы`) > 0. `draftShortage` — без изменений (склад ещё не выбран — считает по основному).

- [ ] **Step 7: Run — GREEN + регрессии**

Run: `npx vitest run src/material-issue.test.ts src/warehouse.test.ts src/shortage.test.ts src/domain.test.ts`
Expected: зелёные. Обновить ожидания `material-issue.test.ts` под частичную выдачу, **не меняя** доменные инварианты (резерв, себестоимость, возврат при отмене).

---

## Task B4: Домен — перемещение и склад закупки

**Files:**
- Modify: `src/domain.ts` (новый case `warehouse.transfer`; `purchase.create` ~1395 + `warehouseId?`; `purchase.receive` ~1417).
- Test: `src/warehouse.test.ts`

**Interfaces:**
- Consumes: `stockQty`/`reservedQty` по складу; средняя себестоимость `item.cost`.
- Produces: `warehouse.transfer` — два движения `source:'transfer'`; `purchase.create.warehouseId?`.

- [ ] **Step 1: RED**

```ts
it('transfer moves free stock between warehouses', () => {
  let s = twoWarehouses(10); // второй склад активен
  const item = s.items[0].id;
  const before = stockQty(s, item);
  s = run(s, { type: 'warehouse.transfer', itemId: item, fromId: MAIN_WAREHOUSE_ID, toId: 'wh2', qty: 4, note: '' });
  expect(stockQty(s, item)).toBe(before);            // сумма по компании не меняется
  expect(stockQty(s, item, 'wh2')).toBe(4);
  expect(stockQty(s, item, MAIN_WAREHOUSE_ID)).toBe(6);
  expect(s.items[0].cost).toBe(/* без изменений */);
});
it('transfer cannot eat another order reserve', () => { /* free stock insufficient -> throw */ });
```

- [ ] **Step 2: Run — RED**, затем реализация:

```ts
case 'warehouse.transfer': {
  const from = state.warehouses.find(w => w.id === command.fromId && w.active);
  const to = state.warehouses.find(w => w.id === command.toId && w.active);
  if (!from || !to) throw new Error('Ombor topilmadi');
  if (from.id === to.id) throw new Error('Omborlar bir xil');
  if (!(command.qty > 0)) throw new Error('Miqdor musbat bo‘lishi kerak');
  const item = state.items.find(i => i.id === command.itemId);
  if (!item) throw new Error('Material topilmadi');
  const free = stockQty(state, command.itemId, from.id) - reservedQty(state, command.itemId, from.id);
  if (command.qty > free) throw new Error('Omborda yetarli erkin qoldiq yo‘q');
  movement(state, { itemId: command.itemId, direction: 'out', qty: command.qty, unitCost: item.cost, source: 'transfer', sourceId: crypto.randomUUID(), warehouseId: from.id, note: command.note });
  movement(state, { itemId: command.itemId, direction: 'in', qty: command.qty, unitCost: item.cost, source: 'transfer', sourceId: crypto.randomUUID(), warehouseId: to.id, note: command.note });
  return 'Ko‘chirildi';
}
```

(Себестоимость позиции не меняется — она общая по компании.)

- [ ] **Step 3: `purchase.create`/`purchase.receive` со складом**

`purchase.create` принимает `warehouseId?` (по умолчанию основной); `purchase.receive` приходует в `purchase.warehouseId`.

- [ ] **Step 4: Run — GREEN**

Run: `npx vitest run src/warehouse.test.ts`
Expected: зелёные.

---

## Task B5: SQL — склады, частичная выдача, перемещение (схема + миграция)

**Files:**
- Modify: `supabase/schema.sql` (таблица `erp_warehouses`, `warehouse_id` в movements/purchases/orders, `erp_snapshot` массив `warehouses`, `erp_execute` частичная выдача + transfer).
- Create: `supabase/migrations/20261119_warehouses.sql`
- Test: `src/warehouse-contract.test.ts`

**Interfaces:**
- Consumes: `MAIN_WAREHOUSE_ID`; существующие процедуры `erp_snapshot`/`erp_execute`.
- Produces: таблица и колонки складов, частичная выдача и `warehouse.transfer` на сервере.

- [ ] **Step 1: Схема**

```sql
CREATE TABLE IF NOT EXISTS public.erp_warehouses (
  id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (company_id, id),
  UNIQUE (company_id, name)
);
ALTER TABLE public.erp_stock_movements ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.erp_purchases ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.erp_orders ADD COLUMN IF NOT EXISTS warehouse_id uuid;
-- FK к erp_warehouses, backfill основным складом компании, SET NOT NULL — в миграции
```

- [ ] **Step 2: Миграция `20261119_warehouses.sql`**

1. `CREATE TABLE IF NOT EXISTS erp_warehouses`.
2. Для каждой компании вставить `'00000000-0000-4000-8000-00000000a001'`/«Asosiy ombor», если нет ни одной.
3. `ADD COLUMN IF NOT EXISTS warehouse_id` для `erp_stock_movements`/`erp_purchases`/`erp_orders`; backfill основным складом компании; `SET NOT NULL`; FK.
4. Индексы `(company_id, warehouse_id)`.
5. `CREATE OR REPLACE erp_snapshot` (массив `warehouses`, поле `warehouseId` в movements/purchases/orders) и `erp_execute` (частичная выдача, `warehouse.transfer`, `warehouseId` в purchase/inventory).

- [ ] **Step 3: Контрактный тест** — как A4 Step 6, проверка подстрок `erp_warehouses`, `warehouse_id`, `'transfer'`.

- [ ] **Step 4: Проверка**

Run: `npx tsc -b`, `npx vitest run src/warehouse-contract.test.ts`

---

## Task B6: PGlite-зонд B

**Files:**
- Create: `.validation-pglite-20261029/warehouses-probe.mjs`

- [ ] **Step 1:** По образцу A5: применить `schema.sql` + `20261119_warehouses.sql`; assert: (1) `erp_warehouses` содержит «Asosiy ombor» с детерминированным id; (2) старые `erp_stock_movements` получили `warehouse_id` основного склада; (3) `erp_execute('warehouse.transfer')` пишет две строки `source='transfer'`; (4) `erp_execute('order.issue')` при частичном наличии пишет движение только на выданное.
- [ ] **Step 2:** Run — `node .validation-pglite-20261029/warehouses-probe.mjs` → `OK warehouses-probe`.

---

## Task B7: UI — селектор склада, «Omborlar», «Ko‘chirish», дефицит

**Files:**
- Modify: панель «Ombor» (остатки/анализ), `src/components/OrderEditor.tsx`, панель закупок, панель настроек («Omborlar»), компонент дефицита.
- Test: визуально в демо (браузер).

**Interfaces:**
- Consumes: `state.warehouses`, `warehouse.transfer`, `orderShortage().suggestedFrom`.
- Produces: селектор склада (показывается только при 2+ складах), панель «Omborlar», кнопка «Ko‘chirish» в дефиците, «Qaysi ombordan/omborga».

- [ ] **Step 1:** В «Ombor» — селектор склада (по умолчанию «Asosiy ombor»); остатки и анализ по выбранному складу. Пока склад один — селектор скрыт.
- [ ] **Step 2:** В `OrderEditor` — «Qaysi ombordan» (только для черновика; после первой выдачи поле заблокировано с подсказкой «Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi»).
- [ ] **Step 3:** В закупке — «Qaysi omborga».
- [ ] **Step 4:** В дефиците — строки `suggestedFrom` («Bor: Asosiy ombor — 2 litr») + кнопка «Ko‘chirish», открывающая форму перемещения с предзаполненным `fromId`.
- [ ] **Step 5:** В настройках — панель «Omborlar»: добавить/переименовать/отключить (нельзя удалить склад с движениями, нельзя отключить последний активный). Команды — через `warehouse.transfer`-стиль или новые `warehouse.*` CRUD-команды (решение: минимальный набор `warehouse.create/update`, admin-only, `settings.catalog`).

> Ruling: CRUD складов добавляется как admin-only команды `warehouse.create`/`warehouse.update` (вне спецификации 4.6, но необходим для панели «Omborlar»; интерфейс при одном складе их не показывает). Если владелец захочет — выносится отдельно.

- [ ] **Step 6:** Проверка в демо: с одним складом — ноль новых элементов; вручную добавить второй склад (через временную команду/локальное состояние) — появляются селекторы.

---

## Task B8: Проверка пакета B

- [ ] **Step 1:** `npx tsc -b`.
- [ ] **Step 2:** `npx vitest run` — зелёные (в т. ч. обновлённый `material-issue.test.ts`).
- [ ] **Step 3:** `npm run build`.
- [ ] **Step 4:** Демо-сценарий B (заказ с 3 материалами, 2 есть; запуск; частичная выдача; повторная выдача после прихода; перемещение; инвентаризация одного склада).
- [ ] **Step 5:** Отчёт владельцу; SQL и deploy — по отдельному разрешению.

---

# Пакет C — снабжение

## Task C1: Типы — `Purchase.orderId` и модуль `supply.ts`

**Files:**
- Create: `src/supply.ts`
- Modify: `src/types.ts` (`Purchase.orderId?: string | null`; `purchase.create` + `orderId?`).
- Modify: `src/migrations.ts` (нормализация `orderId`).

**Interfaces:**
- Consumes: `orderShortage`, `State`.
- Produces: `SupplyNeed`, `supplyNeeds(state): SupplyNeed[]`.

- [ ] **Step 1: RED**

```ts
it('supplyNeeds aggregates shortages by item+warehouse across production orders', () => {
  const s = /* два production-заказа с дефицитом одного материала */;
  const needs = supplyNeeds(s);
  expect(needs).toHaveLength(1);
  expect(needs[0].short).toBe(/* сумма дефицита */);
  expect(needs[0].orders.length).toBe(2);
});
```

- [ ] **Step 2: Реализация `src/supply.ts`**

```ts
export interface SupplyNeed {
  itemId: string; name: string; unit: string;
  warehouseId: string; short: number;
  orders: { id: string; number: string; dueDate: string; short: number }[];
  lastPurchasePrice: number;
}
export function supplyNeeds(state: State): SupplyNeed[] {
  const map = new Map<string, SupplyNeed>();
  for (const order of state.orders.filter(o => o.status === 'production')) {
    for (const row of orderShortage(state, order)) {
      const key = `${row.itemId}|${row.warehouseId ?? order.warehouseId}`;
      // group, sum short, push order ref
    }
  }
  // sort by short desc, then nearest dueDate
}
```

- [ ] **Step 3: `purchase.create` + `orderId?`**

Тип и обработчик принимают `orderId?`; проверка — заказ той же компании. `Purchase` получает `orderId: string | null` (только трассировка; на склад/резервы/деньги/себестоимость не влияет).

- [ ] **Step 4: Run — GREEN**

Run: `npx vitest run src/supply.test.ts`, `npx tsc -b`

---

## Task C2: SQL — `erp_purchases.order_id` (схема + миграция)

**Files:**
- Modify: `supabase/schema.sql`, Create: `supabase/migrations/20261120_supply.sql`
- Test: `src/supply-contract.test.ts`

- [ ] **Step 1:** `erp_purchases.order_id uuid` nullable + FK на заказ компании; `erp_snapshot` отдаёт `orderId`; `erp_execute('purchase.create')` принимает `orderId?`.
- [ ] **Step 2:** Миграция `20261120_supply.sql` (идемпотентно).
- [ ] **Step 3:** Контрактный тест.

---

## Task C3: PGlite-зонд C

- [ ] **Step 1:** `.validation-pglite-20261029/supply-probe.mjs` — `order_id` колонка; `purchase.create` с `orderId` пишет строку с FK; без `orderId` — NULL.
- [ ] **Step 2:** Run → `OK supply-probe`.

---

## Task C4: UI — «Ta’minot ehtiyoji» и закупка из дефицита

**Files:**
- Modify: панель «Ombor» (или «Xaridlar»), форма закупки.
- Test: визуально в демо.

**Interfaces:**
- Consumes: `supplyNeeds(state)`, существующая форма закупки.
- Produces: панель «Ta’minot ehtiyoji»; кнопка «Xarid qilish» открывает закупку с предзаполненными строками.

- [ ] **Step 1:** Разместить панель в разделе «Ombor» (решение: «Ombor», рядом с остатками; владелец указал «на этапе плана выбирается по месту»).
- [ ] **Step 2:** Строка панели: материал, склад, «yetishmaydi N», заказы, кнопка «Xarid qilish». Кнопка открывает форму закупки: `qty = short`, `price = lastPurchasePrice`, поставщик — последний, если есть, иначе обязательный выбор. Передать `orderId` для трассировки.
- [ ] **Step 3:** После приёма закупки строка дефицита уменьшается (естественно через `orderShortage`), выдача разблокируется.

---

## Task C5: Проверка пакета C

- [ ] **Step 1:** `npx tsc -b`, `npx vitest run`, `npm run build`.
- [ ] **Step 2:** Демо-сценарий C: сводная потребность по всем активным заказам; закупка из строки с верным количеством/складом; приём уменьшает дефицит; закупка без `orderId` работает как раньше.
- [ ] **Step 3:** Отчёт владельцу; SQL/deploy — по разрешению.

---

# Пакет D — цеха

## Task D1: Типы — `Workshop` и дефолт цеха

**Files:**
- Create: `src/workshop-default.ts`
- Modify: `src/types.ts` (Workshop; `workshopId` на Machine/Operation/RouteLine; `State.workshops`).
- Modify: `src/migrations.ts`, `src/sync.ts:25` (массив `workshops`).

**Interfaces:**
- Consumes: `State`.
- Produces: `Workshop`, `MAIN_WORKSHOP_ID = '00000000-0000-4000-8000-00000000b001'`, `mainWorkshop()`, `State.workshops`.

- [ ] **Step 1:** Типы и дефолт (по образцу B1). Нормализация: `workshops ??= [mainWorkshop()]`; `machine/operation/routeLine.workshopId ??= MAIN_WORKSHOP_ID`.
- [ ] **Step 2:** RED — тест нормализации `migrateState` заполняет `workshops` и `workshopId`.
- [ ] **Step 3:** Run → GREEN.

---

## Task D2: Домен — цех этапа и scope начальника цеха

**Files:**
- Modify: `src/domain.ts` (копирование `workshopId` из операции в `RouteLine` при `order.create`/`series.create`/`order.update`/шаблоне; `work.review` — проверка scope цехов).
- Test: `src/workshop.test.ts`

**Interfaces:**
- Consumes: `actor.workshopIds`, `Operation.workshopId`, `RouteLine.workshopId`.
- Produces: этап несёт цех операции на момент создания; перенос операции не переписывает историю; `work.review` начальником — только этапы его цехов.

- [ ] **Step 1: RED**

```ts
it('route line copies operation workshop at creation, not later', () => {
  // операция в цехе wh2; order.create -> RouteLine.workshopId = wh2
  // перенос операции в wh1 -> существующий RouteLine остаётся wh2
});
it('shop chief reviews only own workshop stage', () => {
  // work.review по этапу чужого цеха -> throw
});
```

- [ ] **Step 2: Реализация**

При построении `RouteLine` (в `order.create`/`series.create`/`order.update`/применении шаблона) — `workshopId = operation.workshopId`. В `work.review`: если `actor.role === 'worker'` и `actor.workshopIds` непустой — этап должен принадлежать одному из `workshopIds`, иначе ошибка. (Для admin — без ограничений; для исполнителя-работника — по-прежнему «свой этап».)

- [ ] **Step 3: Run — GREEN**

---

## Task D3: SQL — цеха, `workshop_id`, ТВ-scope (схема + миграция)

**Files:**
- Modify: `supabase/schema.sql`, Create: `supabase/migrations/20261121_workshops.sql`
- Test: `src/workshop-contract.test.ts`

- [ ] **Step 1:** `CREATE TABLE erp_workshops`; для каждой компании — «Asosiy ishlab chiqarish»; `workshop_id` в `erp_machines`/`erp_operations`/`erp_tasks`; backfill основным цехом; `SET NOT NULL`; FK.
- [ ] **Step 2:** `erp_snapshot`: массив `workshops`, поле `workshopId`; фильтрация ТВ по `scope_workshop_ids` (для `display`).
- [ ] **Step 3:** `erp_execute`: проверка scope для `work.review` и выдачи материалов начальником цеха.
- [ ] **Step 4:** Миграция + контрактный тест.

---

## Task D4: PGlite-зонд D

- [ ] **Step 1:** `.validation-pglite-20261029/workshops-probe.mjs` — таблица/«Asosiy ishlab chiqarish» с детерминированным id; backfill `workshop_id`; `erp_snapshot` для display с `scope_workshop_ids` отдаёт только заказы этих цехов.
- [ ] **Step 2:** Run → `OK workshops-probe`.

---

## Task D5: UI — табы «Sex», ТВ-scope, «Sexlar», начальник цеха

**Files:**
- Modify: экран «Sex» (канбан), панель настроек («Sexlar»), AccessPanel (scope цехов для display и Sex boshlig‘i).
- Test: визуально в демо.

- [ ] **Step 1:** Экран «Sex»: при 2+ цехах — табы «Barchasi» + по цеху; выбор в localStorage. Заказ виден в колонке цеха его текущего незавершённого этапа; заказ с этапами двух цехов — в обоих, но показывает только этапы своего цеха. Счётчики шапки — по выбранному цеху. В «Barchasi» карточка показывает цех у этапа.
- [ ] **Step 2:** AccessPanel: для `display` — мультивыбор цехов (`scopeWorkshopIds`); для пресета «Sex boshlig‘i» — обязательный мультивыбор цехов.
- [ ] **Step 3:** Панель «Sexlar» в настройках (добавить/переименовать/отключить; admin-only).
- [ ] **Step 4:** Проверка: при одном цехе — ноль изменений; с двумя — табы, разный набор этапов, начальник видит только свой цех.

---

## Task D6: Проверка пакета D

- [ ] **Step 1:** `npx tsc -b`, `npx vitest run`, `npm run build`.
- [ ] **Step 2:** Демо-сценарий D (два цеха, табы, начальник цеха, ТВ-scope, перенос операции не меняет запущенные заказы).
- [ ] **Step 3:** Итоговый отчёт владельцу на русском: все 4 пакета готовы; SQL `20261118–20261121` и `npm run deploy` — по отдельному разрешению на каждый пакет, в порядке A→B→C→D.

---

## Самопроверка плана (заполняется после написания)

- **Spec coverage:** 4.1 (A1/A4), 4.2 (A1/A2), 4.3 (A1/A6), 4.4 (A2/A7), 4.5 (A4), 4.6 (A2/A4), 4.7 (A6/A7), 4.8 (A4), 4.9 (A8); 5.1 (B1), 5.2 (B2/B3/B4), 5.3 (B5), 5.4 (B8); 6.1 (C1/C4), 6.2 (C1/C4), 6.3 (C2), 6.4 (C5); 7.1 (D1), 7.2 (D5), 7.3 (D3/D5), 7.4 (D2/D5), 7.5 (D3), 7.6 (D6); 8 (порядок выката — в Global Constraints и финальных шагах), 9 (B1/D1 normalize), 10 (зонды/контракты/демо), 11 (меры учтены в задачах), 12 (вне рамок — не реализуется).
- **Placeholder scan:** отсутствуют «TBD/TODO»; спорные места отмечены Ruling.
- **Type consistency:** `requiredPermission`/`GATE`/`canTouchOrder` (A1) используются в A2/A3/A4 с теми же именами; `MAIN_WAREHOUSE_ID`/`mainWarehouse` (B1) — в B2–B7; `SupplyNeed`/`supplyNeeds` (C1) — в C4; `MAIN_WORKSHOP_ID`/`mainWorkshop` (D1) — в D2–D5.
