# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** После создания компании владелец видит мастер из четырёх шагов и может загрузить в свою облачную компанию образец данных (люди, материалы, операции, клиент и черновик заказа) либо перейти к ручному вводу.

**Architecture:** Чистый планировщик `src/setup.ts` возвращает следующую недостающую доменную команду по текущему состоянию. Модальный `SetupWizard` показывает прогресс и вызывает `runSetupDemo` в `App.tsx`, который выполняет команды последовательно с локальными `latest`/`nextActor` (как `runAll`). Никаких новых команд, таблиц и изменений схемы.

**Tech Stack:** React 19, TypeScript strict, Vitest 3 (node, без jsdom), PGlite.

**Spec:** `docs/superpowers/specs/2026-11-11-setup-wizard-design.md`

## Global Constraints

- Рабочая папка **не Git-репозиторий**: шагов `git commit` нет; вместо них — проверки `npx vitest run <файл>`, `npx tsc -b --pretty false`.
- `npm test` = `vitest run` (node-окружение, без jsdom): компонентные тесты только через `renderToStaticMarkup`, кликовые сценарии запрещены.
- UI — узбекская латиница, суммы в UZS; отчёт владельцу — на русском.
- Демо-загрузка в облаке — только онлайн; в демо-режиме приложения мастер не показывается.
- Демо не удаляет и не перезаписывает существующие записи; повторный запуск идемпотентен по нормализованному имени.
- Демо-заказ остаётся `draft`: `order.launch` не выполняется.
- Используются только существующие команды: `employee.create`, `item.create`, `operation.create`, `customer.create`, `order.create`.
- `src/types.ts`, `src/domain.ts`, `supabase/schema.sql`, миграции не меняются.
- Живой SQL и `npm run deploy` — только по отдельному разрешению владельца.
- Секреты только на сервере; в проектных файлах и чате — никогда.

---

## File Structure

- Create: `src/setup.ts` — шаги мастера и планировщик демо-команд.
- Create: `src/setup.test.ts` — unit-тесты планировщика (RED → GREEN).
- Create: `src/components/SetupWizard.tsx` — модальный мастер.
- Create: `src/setup-wizard.test.tsx` — статическая разметка компонента.
- Modify: `src/App.tsx` — `runSetupDemo`, `setupManual`, автооткрытие, карточка в Sozlamalar, рендер модалки, список исключений.
- Modify: `src/styles.css` — стили `.setup-*` (в конец файла).
- Create: `.validation-pglite-20261029/validate-setup-demo.mjs` — PGlite-паритет демо-сценария.

---

### Task 1: Планировщик `src/setup.ts`

**Files:**
- Create: `src/setup.ts`
- Test: `src/setup.test.ts`

**Interfaces:**
- Consumes: `Command`, `State` из `./types`; `dateOffset(days)` из `./seed`.
- Produces: `SetupStepId`, `SetupStep`, `setupSteps: SetupStep[]`, `nextDemoCommand(step, state): Command | null` — используется в Task 2 и Task 3.

- [ ] **Step 1: Написать падающий тест**

Создать `src/setup.test.ts` целиком:

```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { nextDemoCommand, setupSteps, type SetupStepId } from './setup';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'setup-admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
let seq = 0;
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: `setup-${++seq}`, expectedRevision: state.revision, command }, admin);

function runStep(step: SetupStepId, state: State): State {
  for (let i = 0; i < 32; i++) {
    const command = nextDemoCommand(step, state);
    if (!command) return state;
    state = run(state, command);
  }
  throw new Error(`Demo step ${step} did not settle`);
}

const done = (state: State) => setupSteps.map(step => [step.id, step.done(state)] as const);

describe('setup steps', () => {
  it('reports progress from the current state', () => {
    let state = emptyState();
    expect(done(state)).toEqual([['employees', false], ['materials', false], ['operations', false], ['order', false]]);
    state = run(state, { type: 'employee.create', name: 'Usta' });
    expect(done(state)[0]).toEqual(['employees', true]);
    expect(done(state)[1]).toEqual(['materials', false]);
    state = run(state, { type: 'item.create', name: 'Bo‘yoq', unit: 'litr', minQty: 0, cost: 0, customerId: null });
    expect(done(state)[1]).toEqual(['materials', true]);
    state = run(state, { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 100000, workerRate: 40000, standardMinutes: 0, machineId: null, employeeIds: [], active: true, autoAccept: true });
    expect(done(state)[2]).toEqual(['operations', true]);
    expect(done(state)[3]).toEqual(['order', false]);
  });

  it('counts only active workers, own materials and active operations', () => {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: 'Usta' });
    state = run(state, { type: 'employee.update', employeeId: state.employees[0].id, name: 'Usta', active: false });
    state = run(state, { type: 'customer.create', name: 'Mijoz', phone: '', address: '', kind: 'customer' });
    state = run(state, { type: 'item.create', name: 'Mijoz materiali', unit: 'dona', minQty: 0, cost: 0, customerId: state.customers[0].id });
    state = run(state, { type: 'operation.create', name: 'Kesish', unit: 'piece', salePrice: 10000, workerRate: 5000, standardMinutes: 0, machineId: null, employeeIds: [], active: false, autoAccept: true });
    expect(done(state)).toEqual([['employees', false], ['materials', false], ['operations', false], ['order', false]]);
  });
});

describe('demo planner', () => {
  it('creates two employees, then stops', () => {
    const state = runStep('employees', emptyState());
    expect(state.employees.map(row => row.name)).toEqual(['Sex ustasi', 'Yig‘uvchi']);
    expect(nextDemoCommand('employees', state)).toBeNull();
    expect(state.items).toHaveLength(0);
    expect(state.operations).toHaveLength(0);
  });

  it('recognizes an existing worker by normalized name', () => {
    let state = emptyState();
    state = run(state, { type: 'employee.create', name: '  sex USTASI ' });
    const next = nextDemoCommand('employees', state);
    expect(next).toEqual({ type: 'employee.create', name: 'Yig‘uvchi' });
  });

  it('creates exactly six materials without touching people or operations', () => {
    const state = runStep('materials', emptyState());
    expect(state.items.map(row => [row.name, row.unit, row.minQty, row.customerId, row.category])).toEqual([
      ['Fasad · eman', 'dona', 0, null, '01.07'],
      ['Fasad · oq', 'dona', 0, null, '01.07'],
      ['Poliuretan bo‘yoq · oq', 'litr', 5, null, '06.01'],
      ['Qotiruvchi', 'litr', 2, null, '06.04'],
      ['Erituvchi 646', 'litr', 2, null, '06.05'],
      ['Abraziv doira P120', 'dona', 20, null, '07.03'],
    ]);
    expect(state.employees).toHaveLength(0);
    expect(state.operations).toHaveLength(0);
  });

  it('creates prerequisites and both operations with norms', () => {
    const state = runStep('operations', emptyState());
    expect(state.employees).toHaveLength(2);
    expect(state.items).toHaveLength(6);
    expect(state.operations.map(row => row.name)).toEqual(['Jilolash', 'Bo‘yash']);
    const abrasive = state.items.find(row => row.name === 'Abraziv doira P120')!;
    const paint = state.items.find(row => row.name === 'Poliuretan bo‘yoq · oq')!;
    const hardener = state.items.find(row => row.name === 'Qotiruvchi')!;
    const jilolash = state.operations.find(row => row.name === 'Jilolash')!;
    const boyash = state.operations.find(row => row.name === 'Bo‘yash')!;
    expect(jilolash).toMatchObject({ unit: 'squareMeter', salePrice: 80000, workerRate: 30000, active: true, autoAccept: true });
    expect(jilolash.norms).toEqual([{ itemId: abrasive.id, qtyPerM2: 0.5 }]);
    expect(boyash).toMatchObject({ unit: 'squareMeter', salePrice: 150000, workerRate: 50000, active: true, autoAccept: true });
    expect(boyash.norms).toEqual([{ itemId: paint.id, qtyPerM2: 0.25 }, { itemId: hardener.id, qtyPerM2: 0.1 }]);
    expect(jilolash.employeeIds).toHaveLength(2);
    expect(nextDemoCommand('operations', state)).toBeNull();
  });

  it('builds the whole chain and a draft order from an empty company', () => {
    const state = runStep('order', emptyState());
    expect(state.employees).toHaveLength(2);
    expect(state.items).toHaveLength(6);
    expect(state.operations).toHaveLength(2);
    expect(state.customers.map(row => [row.name, row.phone, row.kind])).toEqual([['Aziza Karimova', '+998 90 123 45 67', 'customer']]);
    expect(state.orders).toHaveLength(1);
    expect(state.cash).toHaveLength(0);
    const order = state.orders[0];
    expect(order).toMatchObject({ status: 'draft', kind: 'service', title: 'Fasadlarni bo‘yash · 12 m²', qty: 1, price: 1800000, overhead: 100000 });
    expect(order.route.map(task => [task.name, task.planned, task.rate, task.status])).toEqual([
      ['Jilolash', 12, 30000, 'assigned'],
      ['Bo‘yash', 12, 50000, 'assigned'],
    ]);
    expect(order.materials).toHaveLength(3);
    const byName = Object.fromEntries(order.materials.map(line => [state.items.find(item => item.id === line.itemId)!.name, line]));
    expect(byName['Abraziv doira P120'].qty).toBe(6);
    expect(byName['Poliuretan bo‘yoq · oq'].qty).toBe(3);
    expect(byName['Qotiruvchi'].qty).toBeCloseTo(1.2, 8);
    expect(order.materials.every(line => line.issued === false)).toBe(true);
    expect(setupSteps.every(step => step.done(state))).toBe(true);
  });

  it('is idempotent on a repeated full run', () => {
    let state = runStep('order', emptyState());
    const counts = [state.employees.length, state.items.length, state.operations.length, state.customers.length, state.orders.length];
    for (const step of ['employees', 'materials', 'operations', 'order'] as SetupStepId[]) state = runStep(step, state);
    expect([state.employees.length, state.items.length, state.operations.length, state.customers.length, state.orders.length]).toEqual(counts);
    expect(nextDemoCommand('order', state)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/setup.test.ts`
Expected: FAIL — `Failed to resolve import "./setup"` (файла ещё нет).

- [ ] **Step 3: Написать минимальную реализацию**

Создать `src/setup.ts` целиком:

```ts
import { dateOffset } from './seed';
import type { Command, State } from './types';

export type SetupStepId = 'employees' | 'materials' | 'operations' | 'order';

export interface SetupStep {
  id: SetupStepId;
  title: string;
  description: string;
  done: (state: State) => boolean;
}

export const setupSteps: SetupStep[] = [
  { id: 'employees', title: 'Xodimlar', description: 'Sex ustasi va yig‘uvchi kabi ishchilarni qo‘shing.', done: state => state.employees.some(row => row.active) },
  { id: 'materials', title: 'Materiallar', description: 'Bo‘yoq, qotiruvchi, abraziv va fasad pozitsiyalarini kiriting.', done: state => state.items.some(row => row.customerId === null) },
  { id: 'operations', title: 'Operatsiyalar', description: 'Jilolash va bo‘yash kabi ish turlarini stavka va normalar bilan sozlang.', done: state => state.operations.some(row => row.active) },
  { id: 'order', title: 'Birinchi buyurtma', description: 'Mijoz va bo‘yash buyurtmasini yarating — tizim qanday ishlashini ko‘ring.', done: state => state.orders.length > 0 },
];

const demoEmployees = ['Sex ustasi', 'Yig‘uvchi'] as const;
const demoItems = [
  { name: 'Fasad · eman', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Fasad · oq', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Poliuretan bo‘yoq · oq', unit: 'litr', minQty: 5, category: '06.01' },
  { name: 'Qotiruvchi', unit: 'litr', minQty: 2, category: '06.04' },
  { name: 'Erituvchi 646', unit: 'litr', minQty: 2, category: '06.05' },
  { name: 'Abraziv doira P120', unit: 'dona', minQty: 20, category: '07.03' },
] as const;
const demoCustomer = { name: 'Aziza Karimova', phone: '+998 90 123 45 67', address: 'Toshkent, Navoiy ko‘chasi, 24' };
const demoOrderTitle = 'Fasadlarni bo‘yash · 12 m²';
const sameName = (left: string, right: string) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
const findEmployee = (state: State, name: string) => state.employees.find(row => sameName(row.name, name));
const findItem = (state: State, name: string) => state.items.find(row => row.customerId === null && sameName(row.name, name));
const findOperation = (state: State, name: string) => state.operations.find(row => row.active && sameName(row.name, name));

function nextEmployee(state: State): Command | null {
  const missing = demoEmployees.find(name => !findEmployee(state, name));
  return missing ? { type: 'employee.create', name: missing } : null;
}

function nextItem(state: State): Command | null {
  const missing = demoItems.find(row => !findItem(state, row.name));
  return missing ? { type: 'item.create', name: missing.name, unit: missing.unit, minQty: missing.minQty, cost: 0, customerId: null, category: missing.category } : null;
}

function nextOperation(state: State): Command | null {
  const prerequisite = nextEmployee(state) ?? nextItem(state);
  if (prerequisite) return prerequisite;
  const employeeIds = state.employees.filter(row => row.active).map(row => row.id);
  const abrasive = findItem(state, 'Abraziv doira P120')!;
  if (!findOperation(state, 'Jilolash')) {
    return { type: 'operation.create', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: abrasive.id, qtyPerM2: 0.5 }] };
  }
  const paint = findItem(state, 'Poliuretan bo‘yoq · oq')!;
  const hardener = findItem(state, 'Qotiruvchi')!;
  if (!findOperation(state, 'Bo‘yash')) {
    return { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: paint.id, qtyPerM2: 0.25 }, { itemId: hardener.id, qtyPerM2: 0.1 }] };
  }
  return null;
}

function nextOrder(state: State): Command | null {
  const prerequisite = nextEmployee(state) ?? nextItem(state) ?? nextOperation(state);
  if (prerequisite) return prerequisite;
  const customer = state.customers.find(row => sameName(row.name, demoCustomer.name));
  if (!customer) return { type: 'customer.create', ...demoCustomer, kind: 'customer' };
  if (state.orders.some(row => row.customerId === customer.id && sameName(row.title, demoOrderTitle))) return null;
  const jilolash = findOperation(state, 'Jilolash')!;
  const boyash = findOperation(state, 'Bo‘yash')!;
  const worker = state.employees.find(row => row.active)!;
  return {
    type: 'order.create',
    input: {
      kind: 'service', customerId: customer.id, overhead: 100000,
      dueDate: dateOffset(7), advance: 0, account: 'bank',
      lines: [{
        kind: 'service', title: demoOrderTitle, qty: 1, unitPrice: 1800000, materials: [],
        route: [
          { operationId: jilolash.id, employeeId: worker.id, rate: 30000, qty: 12 },
          { operationId: boyash.id, employeeId: worker.id, rate: 50000, qty: 12 },
        ],
      }],
    },
  };
}

export function nextDemoCommand(step: SetupStepId, state: State): Command | null {
  if (step === 'employees') return nextEmployee(state);
  if (step === 'materials') return nextItem(state);
  if (step === 'operations') return nextOperation(state);
  return nextOrder(state);
}
```

- [ ] **Step 4: Проверить GREEN и типы**

Run: `npx vitest run src/setup.test.ts`
Expected: PASS, все тесты зелёные.

Run: `npx tsc -b --pretty false`
Expected: exit 0, без вывода.

---

### Task 2: Компонент `SetupWizard` и CSS

**Files:**
- Create: `src/components/SetupWizard.tsx`
- Test: `src/setup-wizard.test.tsx`
- Modify: `src/styles.css` (в конец файла)

**Interfaces:**
- Consumes: `setupSteps`, `SetupStepId` из `../setup`; `Dialog` из `../ui`; `State` из `../types`.
- Produces: `SetupWizard` с props `{ state, busy, online, close, runDemo, manual }` — используется в Task 3.

- [ ] **Step 1: Написать падающий тест разметки**

Создать `src/setup-wizard.test.tsx` целиком:

```tsx
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyCommand, emptyState } from './domain';
import { DEMO_COMPANY_ID } from './migrations';
import { nextDemoCommand } from './setup';
import { SetupWizard } from './components/SetupWizard';
import type { Actor, Command, State } from './types';

const admin: Actor = { id: 'setup-admin', name: 'Egasi', role: 'admin', companyId: DEMO_COMPANY_ID };
let seq = 0;
const run = (state: State, command: Command) =>
  applyCommand(state, { requestId: `wizard-${++seq}`, expectedRevision: state.revision, command }, admin);

function completed(): State {
  let state = emptyState();
  for (let i = 0; i < 32; i++) {
    const command = nextDemoCommand('order', state);
    if (!command) return state;
    state = run(state, command);
  }
  throw new Error('Demo seed did not settle');
}

const render = (state: State, overrides: { busy?: boolean; online?: boolean } = {}) => renderToStaticMarkup(createElement(SetupWizard, {
  state, busy: false, online: true, close: () => {}, runDemo: async () => true, manual: () => {}, ...overrides,
}));

describe('SetupWizard', () => {
  it('renders four pending steps with both choices and zero progress', () => {
    const html = render(emptyState());
    expect(html).toContain('Boshlang‘ich sozlash');
    expect(html).toContain('0 / 4 qadam tayyor');
    for (const title of ['Xodimlar', 'Materiallar', 'Operatsiyalar', 'Birinchi buyurtma']) expect(html).toContain(title);
    expect(html.match(/Qo‘lda kiritish/g)).toHaveLength(4);
    expect(html.match(/Demodan olish/g)).toHaveLength(4);
    expect(html).not.toContain('Tayyor');
    expect(html).not.toContain('Oflayn rejimda demo yuklanmaydi');
    expect(html).toContain('Yopish');
  });

  it('marks completed steps and hides demo buttons', () => {
    const html = render(completed());
    expect(html).toContain('4 / 4 qadam tayyor');
    expect(html.match(/>Tayyor</g)).toHaveLength(4);
    expect(html).not.toContain('Demodan olish');
    expect(html).not.toContain('Qo‘lda kiritish');
  });

  it('disables every demo loader offline and explains why', () => {
    const html = render(emptyState(), { online: false });
    expect(html).toContain('Oflayn rejimda demo yuklanmaydi');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it('disables all step buttons while busy', () => {
    const html = render(emptyState(), { busy: true });
    expect(html.match(/disabled=""/g)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run src/setup-wizard.test.tsx`
Expected: FAIL — `Failed to resolve import "./components/SetupWizard"`.

- [ ] **Step 3: Написать компонент**

Создать `src/components/SetupWizard.tsx` целиком:

```tsx
import { useState } from 'react';
import { Check } from 'lucide-react';
import { setupSteps, type SetupStepId } from '../setup';
import { Dialog } from '../ui';
import type { State } from '../types';

export function SetupWizard({ state, busy, online, close, runDemo, manual }: {
  state: State;
  busy: boolean;
  online: boolean;
  close: () => void;
  runDemo: (step: SetupStepId) => Promise<boolean>;
  manual: (step: SetupStepId) => void;
}) {
  const [running, setRunning] = useState<SetupStepId | null>(null);
  const locked = busy || running !== null;
  const ready = setupSteps.filter(step => step.done(state)).length;
  return <Dialog title="Boshlang‘ich sozlash" subtitle="To‘rt qadamda ishlash uchun minimal ma’lumot. Har qadamni qo‘lda kiriting yoki demodan oling." close={() => { if (!locked) close(); }}>
    <div className="form-body">
      <div className="setup-progress">
        <div><b>{ready} / {setupSteps.length} qadam tayyor</b><small>{ready === setupSteps.length ? 'Asosiy sozlash tugallandi.' : 'Tartib muhim emas — xohlagan qadamdan boshlang.'}</small></div>
        <div className="setup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={setupSteps.length} aria-valuenow={ready}><i style={{ width: `${ready / setupSteps.length * 100}%` }} /></div>
      </div>
      {!online && <div className="warning">Oflayn rejimda demo yuklanmaydi. Avval internetga ulaning yoki ma’lumotni qo‘lda kiriting.</div>}
      <div className="setup-list">
        {setupSteps.map((step, index) => {
          const done = step.done(state);
          return <article className={`setup-step ${done ? 'done' : ''}`} key={step.id}>
            <span className="setup-number">{done ? <Check size={16} /> : index + 1}</span>
            <div className="setup-copy"><b>{step.title}</b><p>{step.description}</p></div>
            {done
              ? <span className="badge delivered">Tayyor</span>
              : <div className="setup-actions">
                  <button className="secondary small" type="button" disabled={locked} onClick={() => manual(step.id)}>Qo‘lda kiritish</button>
                  <button className="primary small" type="button" disabled={locked || !online} onClick={() => {
                    setRunning(step.id);
                    void runDemo(step.id).finally(() => setRunning(null));
                  }}>{running === step.id ? 'Yuklanmoqda…' : 'Demodan olish'}</button>
                </div>}
          </article>;
        })}
      </div>
      <p className="subtle-note">Demo faqat yetishmayotgan yozuvlarni qo‘shadi: mavjud ma’lumotlar o‘zgarmaydi, buyurtma esa sexga ishga tushirilmaydi.</p>
    </div>
    <footer className="form-footer"><button className="secondary" type="button" disabled={running !== null} onClick={close}>Yopish</button></footer>
  </Dialog>;
}
```

- [ ] **Step 4: Добавить стили**

Дописать в конец `src/styles.css`:

```css
.setup-progress{display:grid;gap:9px;padding:14px 16px;border-radius:14px;background:#f3f5f2}
.setup-progress>div:first-child{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap}
.setup-progress b{font-size:13px}
.setup-progress small{font-size:10px}
.setup-bar{height:6px;border-radius:999px;background:rgba(25,47,39,.08);overflow:hidden}
.setup-bar i{display:block;height:100%;border-radius:999px;background:#98b16c;transition:width .3s ease}
.setup-list{display:grid;gap:10px}
.setup-step{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:#fff}
.setup-step.done{background:rgba(33,76,60,.045)}
.setup-number{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#f1f4ea;color:#7c8c72;font-size:12px;font-weight:800}
.setup-step.done .setup-number{background:var(--green);color:#fff}
.setup-copy{min-width:0}
.setup-copy b{font-size:13px}
.setup-copy p{font-size:12px;line-height:1.6;color:var(--muted);margin-top:3px}
.setup-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
@media(max-width:640px){
  .setup-step{grid-template-columns:30px minmax(0,1fr)}
  .setup-step>.badge,.setup-actions{grid-column:1/-1;justify-self:start}
  .setup-actions{width:100%}
  .setup-actions button{flex:1}
}
```

- [ ] **Step 5: Проверить GREEN и типы**

Run: `npx vitest run src/setup-wizard.test.tsx`
Expected: PASS, 4 теста.

Run: `npx tsc -b --pretty false`
Expected: exit 0.

---

### Task 3: Интеграция в `src/App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `SetupWizard`, `nextDemoCommand`, `SetupStepId`, существующие `execute`, `readDemo`, `syncStatus`, `haptic`, `setModal`, `show`, `go`.
- Produces: автооткрытие мастера после bootstrap; `runSetupDemo`/`setupManual`; карточка в Sozlamalar; рендер модалки `setup`.

- [ ] **Step 1: Добавить импорты**

В `src/App.tsx` после строки `import { RouteTemplates } from './components/RouteTemplates';` вставить:

```ts
import { SetupWizard } from './components/SetupWizard';
```

После `import { dateOffset } from './seed';` вставить:

```ts
import { nextDemoCommand, type SetupStepId } from './setup';
```

- [ ] **Step 2: Добавить `runSetupDemo` после `runAll`**

Сразу после закрывающей `};` функции `runAll` (перед `const admin = actor.role === 'admin';`) вставить:

```ts
  const runSetupDemo = async (step: SetupStepId): Promise<boolean> => {
    if (!state || busyRef.current) return false;
    if (mode === 'cloud' && !syncStatus().online) {
      setNotice({ message: 'Demoni yuklash uchun internet aloqasi kerak.', error: true });
      return false;
    }
    busyRef.current = true; setBusy(true);
    haptic('tap');
    let latest = state;
    let nextActor = actor;
    let done = 0;
    try {
      for (let attempt = 0; attempt < 24; attempt++) {
        const command = nextDemoCommand(step, latest);
        if (!command) break;
        const result = await execute(latest, command, nextActor);
        latest = result.state;
        nextActor = result.actor;
        done++;
      }
      setState(latest);
      if (mode === 'cloud') setActor(nextActor);
      setSync(syncStatus());
      setNotice({ message: done > 0 ? `${done} ta demo yozuv qo‘shildi.` : 'Bu qadamning demo ma’lumotlari allaqachon yuklangan.', error: false });
      haptic('success');
      return true;
    } catch (e) {
      const message = errorText(e);
      if (done > 0) setState(latest);
      setNotice({ message, error: true });
      if (mode === 'demo') setState(readDemo()); else await load();
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };
```

- [ ] **Step 3: Добавить `setupManual` после объявления `show`**

Сразу после строки `const show = (type: string, id?: string) => setModal({ type, id });` вставить:

```ts
  const setupManual = (step: SetupStepId) => {
    setModal(null);
    if (step === 'employees') show('employee');
    else if (step === 'materials') show('item');
    else if (step === 'operations') go('settings', 'malumotnoma');
    else show('order');
  };
```

- [ ] **Step 4: Автооткрытие после создания компании**

В обработчике `CompanyOnboarding` (`onSubmit`) после `setLoginError('');` добавить:

```ts
      setModal({ type: 'setup' });
```

- [ ] **Step 5: Карточка в Sozlamalar → Ma’lumotnoma**

Заменить строку 596:

```tsx
      {panel === 'malumotnoma' && <div className="dashboard-grid"><CatalogSettings state={state} busy={busy} run={run} onAddEmployee={() => show('employee')} onEditEmployee={id => show('employeeEdit', id)} /><RouteTemplates state={state} busy={busy} run={run} /></div>}
```

на:

```tsx
      {panel === 'malumotnoma' && <>
      {mode === 'cloud' && admin && <Section title="Boshlang‘ich sozlash" hint="To‘rt qadam: xodimlar, materiallar, operatsiyalar va birinchi buyurtma"><div className="data-actions"><button className="secondary" onClick={() => show('setup')}>Sozlashni ochish</button><small>Demo faqat yetishmayotgan yozuvlarni qo‘shadi — mavjud ma’lumotlar saqlanadi.</small></div></Section>}
      <div className="dashboard-grid"><CatalogSettings state={state} busy={busy} run={run} onAddEmployee={() => show('employee')} onEditEmployee={id => show('employeeEdit', id)} /><RouteTemplates state={state} busy={busy} run={run} /></div>
      </>}
```

- [ ] **Step 6: Рендер модалки и исключение из общего Dialog**

Перед строкой `{modal?.type === 'route' && ...}` добавить:

```tsx
    {modal?.type === 'setup' && <SetupWizard state={state} busy={busy} online={sync.online} close={() => setModal(null)} runDemo={runSetupDemo} manual={setupManual} />}
```

В списке исключений общего `Dialog` (строка 628) добавить `'setup'` первым элементом массива:

```tsx
    {modal && !['setup', 'order', 'orderEdit', 'shipment', 'itemEdit', 'itemImport', 'employeeEdit', 'operationRate', 'purchase', 'stockSale', 'route', 'invoice', 'customerCard', 'cashBulk'].includes(modal.type) && <Dialog ...
```

- [ ] **Step 7: Проверить типы и все тесты**

Run: `npx tsc -b --pretty false`
Expected: exit 0.

Run: `npx vitest run src/setup.test.ts src/setup-wizard.test.tsx`
Expected: PASS.

---

### Task 4: PGlite-зонд демо-сценария

**Files:**
- Create: `.validation-pglite-20261029/validate-setup-demo.mjs`

**Interfaces:**
- Consumes: `supabase/schema.sql`, канонический шаблон `validate-route-templates.mjs`.
- Produces: PASS-строки паритета серверного домена с демо-сценарием.

- [ ] **Step 1: Написать зонд**

Создать `.validation-pglite-20261029/validate-setup-demo.mjs` целиком:

```js
// Setup wizard probe: the same demo chain as src/setup.ts, executed through
// erp_execute on the canonical schema, then checked via erp_snapshot.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);
const schema = await fs.readFile(new URL('supabase/schema.sql', root), 'utf8');

let passes = 0;
const pass = (name, details) => {
  passes++;
  console.log('PASS', name, details === undefined ? '' : JSON.stringify(details));
};

const db = new PGlite();
const adminId = crypto.randomUUID();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES ('${adminId}', 'setup@local.invalid', '{"name":"Owner"}'::jsonb);`);
await db.exec(schema);
pass('canonical schema applies for the setup demo probe');

async function as() {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [adminId]);
  await db.exec('SET ROLE authenticated');
}
async function owner(query, params = []) {
  await db.exec('RESET ROLE');
  return (await db.query(query, params)).rows;
}
async function one(query, params = []) {
  return (await owner(query, params))[0];
}
async function snapshotState() {
  await as();
  const rows = (await db.query('SELECT public.erp_snapshot() AS result')).rows;
  await db.exec('RESET ROLE');
  return rows[0].result.state;
}
async function execute(command) {
  const revision = Number((await one(`SELECT m.revision FROM public.erp_metadata m
    JOIN public.erp_profiles p ON p.company_id = m.company_id WHERE p.id = $1`, [adminId])).revision);
  await as();
  const result = (await db.query('SELECT public.erp_execute($1::uuid, $2::bigint, $3::jsonb) AS result',
    [crypto.randomUUID(), revision, JSON.stringify(command)])).rows[0].result;
  await db.exec('RESET ROLE');
  return result;
}

await as();
await db.query('SELECT public.erp_bootstrap_company($1)', ['Setup demo']);
await db.exec('RESET ROLE');

// Mirrors src/setup.ts; snapshots between commands provide server-side IDs.
const demoEmployees = ['Sex ustasi', 'Yig‘uvchi'];
const demoItems = [
  { name: 'Fasad · eman', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Fasad · oq', unit: 'dona', minQty: 0, category: '01.07' },
  { name: 'Poliuretan bo‘yoq · oq', unit: 'litr', minQty: 5, category: '06.01' },
  { name: 'Qotiruvchi', unit: 'litr', minQty: 2, category: '06.04' },
  { name: 'Erituvchi 646', unit: 'litr', minQty: 2, category: '06.05' },
  { name: 'Abraziv doira P120', unit: 'dona', minQty: 20, category: '07.03' },
];
const customerName = 'Aziza Karimova';
const orderTitle = 'Fasadlarni bo‘yash · 12 m²';
const same = (left, right) => left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
const employee = (state, name) => state.employees.find(row => same(row.name, name));
const item = (state, name) => state.items.find(row => row.customerId === null && same(row.name, name));
const operation = (state, name) => state.operations.find(row => row.active && same(row.name, name));

function nextCommand(step, state) {
  const nextEmployee = () => {
    const missing = demoEmployees.find(name => !employee(state, name));
    return missing ? { type: 'employee.create', name: missing } : null;
  };
  const nextItem = () => {
    const missing = demoItems.find(row => !item(state, row.name));
    return missing ? { type: 'item.create', name: missing.name, unit: missing.unit, minQty: missing.minQty, cost: 0, customerId: null, category: missing.category } : null;
  };
  const nextOperation = () => {
    const prerequisite = nextEmployee() ?? nextItem();
    if (prerequisite) return prerequisite;
    const employeeIds = state.employees.filter(row => row.active).map(row => row.id);
    if (!operation(state, 'Jilolash')) {
      return { type: 'operation.create', name: 'Jilolash', unit: 'squareMeter', salePrice: 80000, workerRate: 30000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: item(state, 'Abraziv doira P120').id, qtyPerM2: 0.5 }] };
    }
    if (!operation(state, 'Bo‘yash')) {
      return { type: 'operation.create', name: 'Bo‘yash', unit: 'squareMeter', salePrice: 150000, workerRate: 50000, standardMinutes: 0, machineId: null, employeeIds, active: true, autoAccept: true, norms: [{ itemId: item(state, 'Poliuretan bo‘yoq · oq').id, qtyPerM2: 0.25 }, { itemId: item(state, 'Qotiruvchi').id, qtyPerM2: 0.1 }] };
    }
    return null;
  };
  if (step === 'employees') return nextEmployee();
  if (step === 'materials') return nextItem();
  if (step === 'operations') return nextOperation();
  const prerequisite = nextEmployee() ?? nextItem() ?? nextOperation();
  if (prerequisite) return prerequisite;
  const customer = state.customers.find(row => same(row.name, customerName));
  if (!customer) return { type: 'customer.create', name: customerName, phone: '+998 90 123 45 67', address: 'Toshkent, Navoiy ko‘chasi, 24', kind: 'customer' };
  if (state.orders.some(row => row.customerId === customer.id && same(row.title, orderTitle))) return null;
  const worker = state.employees.find(row => row.active);
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  return {
    type: 'order.create',
    input: {
      kind: 'service', customerId: customer.id, overhead: 100000,
      dueDate, advance: 0, account: 'bank',
      lines: [{
        kind: 'service', title: orderTitle, qty: 1, unitPrice: 1800000, materials: [],
        route: [
          { operationId: operation(state, 'Jilolash').id, employeeId: worker.id, rate: 30000, qty: 12 },
          { operationId: operation(state, 'Bo‘yash').id, employeeId: worker.id, rate: 50000, qty: 12 },
        ],
      }],
    },
  };
}

async function runStep(step) {
  let done = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    const command = nextCommand(step, await snapshotState());
    if (!command) break;
    await execute(command);
    done++;
  }
  return done;
}

const orderStepCount = await runStep('order');
const state = await snapshotState();
assert.equal(orderStepCount, 12);
assert.equal(state.employees.length, 2);
assert.equal(state.items.length, 6);
assert.equal(state.operations.length, 2);
assert.equal(state.customers.length, 1);
assert.equal(state.orders.length, 1);
pass('order step creates 2 workers, 6 materials, 2 operations, a customer and an order');

const jilolash = state.operations.find(row => row.name === 'Jilolash');
const boyash = state.operations.find(row => row.name === 'Bo‘yash');
assert.deepEqual(jilolash.norms, [{ itemId: item(state, 'Abraziv doira P120').id, qtyPerM2: 0.5 }]);
assert.deepEqual(boyash.norms, [{ itemId: item(state, 'Poliuretan bo‘yoq · oq').id, qtyPerM2: 0.25 }, { itemId: item(state, 'Qotiruvchi').id, qtyPerM2: 0.1 }]);
pass('operations keep their norms through the server snapshot');

const order = state.orders[0];
assert.equal(order.status, 'draft');
assert.equal(order.kind, 'service');
assert.equal(order.price, 1800000);
assert.deepEqual(order.route.map(row => [row.name, row.planned, row.rate]), [['Jilolash', 12, 30000], ['Bo‘yash', 12, 50000]]);
const materialQty = Object.fromEntries(order.materials.map(line => [state.items.find(row => row.id === line.itemId).name, line.qty]));
assert.equal(materialQty['Abraziv doira P120'], 6);
assert.equal(materialQty['Poliuretan bo‘yoq · oq'], 3);
assert.ok(Math.abs(materialQty['Qotiruvchi'] - 1.2) < 1e-9);
assert.ok(order.materials.every(line => line.issued === false));
pass('order stays a draft with two 12 m² stages and norm materials 6 / 3 / 1.2');

const before = JSON.stringify([state.employees.length, state.items.length, state.operations.length, state.customers.length, state.orders.length]);
const repeats = [];
for (const step of ['employees', 'materials', 'operations', 'order']) repeats.push(await runStep(step));
const after = await snapshotState();
assert.deepEqual(repeats, [0, 0, 0, 0]);
assert.equal(JSON.stringify([after.employees.length, after.items.length, after.operations.length, after.customers.length, after.orders.length]), before);
pass('a repeated full run adds nothing', { passes, repeats });
```

- [ ] **Step 2: Запустить зонд**

Run: `node .validation-pglite-20261029/validate-setup-demo.mjs`
Expected: пять строк `PASS`, exit 0. Если PGlite-пакет не установлен в этой папке, сначала `npm install` внутри `.validation-pglite-20261029` (в репозиторий ничего не добавляется).

---

### Task 5: Финальная проверка

**Files:**
- No changes.

- [ ] **Step 1: Полный набор тестов**

Run: `npm test`
Expected: все файлы и тесты зелёные, 0 failed.

- [ ] **Step 2: Типы и сборка**

Run: `npx tsc -b --pretty false`
Expected: exit 0.

Run: `npm run build`
Expected: exit 0, `dist/` собран.

- [ ] **Step 3: Браузерный smoke демо-режима**

Run: `npm run dev` (в фоне), открыть `http://127.0.0.1:5173`.
Expected:
- вход «Egasi» работает, разделы открываются;
- Sozlamalar → Ma’lumotnoma показывает справочники и **не** показывает карточку «Boshlang‘ich sozlash» (демо-режим);
- в консоли нет новых ошибок.

Остановить dev-сервер. Облачный путь мастера (автооткрытие после создания компании, демо-загрузка в живую базу) **не проверяется** без отдельного разрешения владельца; он покрыт component-тестами и PGlite-зондом.

- [ ] **Step 4: Зафиксировать итог**

Отчёт владельцу на русском: что сделано, какие проверки пройдены с выводом, что облачный smoke и деплой требуют отдельного разрешения. Не выполнять `npm run deploy` и не менять живую базу.
