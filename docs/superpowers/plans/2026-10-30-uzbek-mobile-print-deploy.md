# Uzbek, Mobile, Print and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завершить узбекскую локализацию, мобильную навигацию, печатные документы, onboarding компаний и подготовку безопасной публикации на Vercel/Netlify с Supabase.

**Architecture:** Единый typed dictionary отделяет текст от бизнес-логики; печатные view models используют авторизованный snapshot. Адаптивная оболочка сохраняет один React-код для desktop/phone/TV, а static hosting передаёт только anon key и URL Supabase.

**Tech Stack:** React 19, TypeScript strict, CSS media/print, Vitest, Vite 6, Supabase Auth, Vercel/Netlify static SPA.

**Spec:** `docs/superpowers/specs/2026-10-30-production-erp-design.md`

## Global Constraints

- Завершены три предыдущих плана.
- Все пользовательские строки — o‘zbek tili, латиница; внутренние command/status IDs не переводятся.
- Маршрутный лист не содержит client prices/cost/payments; счёт-фактура доступен только admin.
- Телефон — адаптивный web, не native app; TV сохраняет read-only dark board.
- В браузере разрешены только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`; service-role key запрещён.
- Не выполнять remote SQL/deploy без отдельного подтверждения и доступов.
- Git не инициализировать; checkpoints через TaskUpdate.

---

### Task 1: Typed Uzbek localization

**Files:**
- Create: `src/i18n.ts`
- Create: `src/i18n.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/ui.tsx`
- Modify: `src/repository.ts`
- Modify: `src/sync.ts`
- Modify: `src/domain.ts`
- Modify: `src/seed.ts`
- Modify: `src/components/*.tsx`

**Interfaces:**
- Consumes: все видимые labels/errors/statuses.
- Produces: `t(key: MessageKey): string`; `formatMoney(value: number): string`; `formatQty(value: number): string`; `statusLabel(status)`; `unitLabel(unit)`.

- [x] **Step 1: Написать падающие тесты словаря и форматов**

```ts
import { describe, expect, it } from 'vitest';
import { formatMoney, messages, statusLabel, unitLabel } from './i18n';

describe('Uzbek localization', () => {
  it('uses Latin Uzbek and UZS', () => {
    expect(formatMoney(125000)).toContain('125');
    expect(formatMoney(125000)).toContain('so‘m');
    expect(statusLabel('production')).toBe('Ishlab chiqarishda');
    expect(unitLabel('squareMeter')).toBe('m²');
    for (const value of Object.values(messages)) expect(value).not.toMatch(/[А-Яа-яЁё]/);
  });
});
```

Добавить test coverage всех `TaskStatus`, `Order.kind`, `CashSource`, `ItemKind`, `OperationUnit`, `PayrollEntry.status`; formatting отрицательных денег и трёх decimal quantity.

- [x] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/i18n.test.ts`  
Expected: FAIL, модуль отсутствует.

- [x] **Step 3: Реализовать словарь и перевести видимые строки**

```ts
export const messages = {
  save: 'Saqlash', cancel: 'Bekor qilish', acceptTask: 'Qabul qilish',
  startTask: 'Boshlash', finishTask: 'Yakunlash', pending: 'Tekshiruvda',
  accepted: 'Qabul qilingan', rejected: 'Qaytarilgan', debt: 'Qarz',
  advance: 'Avans', revenue: 'Tushum', expense: 'Xarajat',
} as const;
export type MessageKey = keyof typeof messages;
export function t(key: MessageKey): string { return messages[key]; }
export function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(value)} so‘m`;
}
```

Словарь расширяется при переводе каждого компонента; `MessageKey` не допускает произвольные отсутствующие ключи. Domain/server stable IDs не меняются. Ошибки домена переводятся на узбекский; SQL сохраняет machine-readable `ERRCODE`, repository сопоставляет известные ошибки с Uzbek text. Демо-имена и seed переводятся без удаления журналов.

- [x] **Step 4: Проверить отсутствие пропущенных строк и регрессий**

Run: `npx tsc --noEmit && npm test -- --run`  
Expected: PASS. Дополнительно dedicated Grep по `[А-Яа-яЁё]` в `src/*.tsx`, `src/components/*.tsx`, `src/seed.ts`: пользовательских русских строк нет; допустимые технические комментарии не выводятся в UI.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 2: Маршрутный лист и счёт-фактура

**Files:**
- Create: `src/documents.ts`
- Create: `src/documents.test.ts`
- Create: `src/components/PrintDocument.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `Order`, `Shipment`, `Customer`, `orderLedger`, `i18n`.
- Produces: `routeSheet(state, orderId): RouteSheetModel`; `invoice(state, sourceId): InvoiceModel`; печатный component; test factory `invoiceFixture(): State` с заказом `order-1` на 250000, оплатой 100000 и одной операцией.

- [x] **Step 1: Написать падающие тесты безопасности документов**

```ts
it('keeps all money out of route sheet and includes invoice settlement', () => {
  const route = routeSheet(invoiceFixture(), 'order-1');
  expect(JSON.stringify(route)).not.toMatch(/salePrice|unitCost|price|paid|debt|cash/);
  expect(route.operations[0]).toMatchObject({ name: 'Kesish', qty: 5, workerName: 'Worker' });
  const invoice = invoice(invoiceFixture(), 'order-1');
  expect(invoice).toMatchObject({ total: 250000, paid: 100000, debt: 150000 });
});
```

Добавить online drawing label/link, recipe substitutions, VAT hidden when disabled, stock-sale invoice, worker/display authorization rejection перед построением invoice.

- [x] **Step 2: Запустить тест и подтвердить FAIL**

Run: `npx vitest run src/documents.test.ts`  
Expected: FAIL, модуль отсутствует.

- [x] **Step 3: Реализовать view models и print component**

```ts
export interface RouteSheetModel {
  number: string; title: string; dueDate: string; drawingUrl: string | null;
  substitutions: { slot: string; itemName: string }[];
  operations: { name: string; qty: number; unit: string; workerName: string; standardMinutes: number }[];
}
```

`PrintDocument` рендерит только переданную typed model; кнопка вызывает `window.print()`. CSS `@media print` скрывает `.app-sidebar`, `.mobile-nav`, `.no-print`, показывает `.print-root`, устанавливает белый фон и `A4` margins. Внешние URLs не загружаются автоматически; drawing печатается как текстовая ссылка.

- [x] **Step 4: Проверить браузерную печать**

Run: `npx tsc --noEmit && npm test -- --run && npm run build`  
Expected: PASS/build. В browser print preview проверить A4 route/invoice, отсутствие sidebar и цен на route, Uzbek labels и UZS на invoice. Worker не получает invoice button; TV не получает print controls.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 3: Мобильная оболочка и onboarding компании

**Files:**
- Create: `src/components/AppShell.tsx`
- Create: `src/components/MobileNav.tsx`
- Create: `src/components/CompanyOnboarding.tsx`
- Modify: `src/App.tsx`
- Modify: `src/repository.ts`
- Create: `src/repository.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `erp_bootstrap_company`, auth state, существующие pages.
- Produces: `bootstrapCompany(name: string, call?: typeof rpc): Promise<Snapshot>`; responsive shell и mobile navigation.

- [x] **Step 1: Написать failing repository contract test**

```ts
it('does not send a company id when bootstrapping a company', async () => {
  const calls: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const mockRpc = async (name: string, params?: Record<string, unknown>) => {
    calls.push({ name, params });
    return emptySnapshot();
  };
  await bootstrapCompany('My Company', mockRpc);
  expect(calls[0]).toEqual({ name: 'erp_bootstrap_company', params: { p_name: 'My Company' } });
  expect(calls[1]).toEqual({ name: 'erp_snapshot', params: undefined });
});
```

`emptySnapshot(): Snapshot` — локальный helper теста, возвращающий `{ state: emptyState(), actor: demoAdmin }`. `bootstrapCompany` вызывает `erp_bootstrap_company`, затем переданный или стандартный `rpc` для `erp_snapshot`.

Вынести injectable RPC wrapper только для теста, не ослабляя существующий TransportError mapping. Проверить duplicate profile/access/network classification.

- [x] **Step 2: Запустить contract test и подтвердить FAIL**

Run: `npx vitest run src/repository.test.ts -t "bootstrapping"`  
Expected: FAIL до добавления `bootstrapCompany`.

- [x] **Step 3: Реализовать onboarding и shell**

```ts
export async function bootstrapCompany(name: string, call: typeof rpc = rpc): Promise<Snapshot> {
  await call('erp_bootstrap_company', { p_name: name.trim() });
  return call('erp_snapshot');
}
```

`CompanyOnboarding` показывается аутентифицированному пользователю без профиля; роль и companyId не вводятся. `AppShell` хранит desktop sidebar и рендерит `MobileNav` до пяти основных разделов, остальные — в `Yana`. Использовать `min-height: 100dvh`, `padding-bottom: env(safe-area-inset-bottom)`, touch targets минимум 44px, sticky action bars только для форм. TV early return остаётся вне mobile shell.

- [x] **Step 4: Проверить размеры и полный auth path**

Run: `npx tsc --noEmit && npm test -- --run && npm run build`  
Expected: PASS/build. Browser: 390×844 и 360×800 — нет horizontal overflow, dialogs закрываются, клавиатура не скрывает primary save, tables имеют card layout. Desktop 1440×900 и TV 1920×1080 без регрессий. Cloud onboarding тестируется локально через PGlite contract; не утверждать real Supabase success без remote project.

- [x] **Step 5: Отметить checkpoint без Git commit**

### Task 4: Vercel/Netlify static deployment configuration

**Files:**
- Create: `vercel.json`
- Create: `public/_redirects`
- Create: `.env.example`
- Create: `docs/deployment.md`
- Modify: `package.json`
- Modify: `src/env.d.ts`

**Interfaces:**
- Consumes: Vite build `dist`, existing env access.
- Produces: SPA fallback/security headers и documented env contract.

- [x] **Step 1: Добавить failing config validation test**

```ts
it('keeps service role secrets out of public env example', async () => {
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  expect(env).toContain('VITE_SUPABASE_URL=');
  expect(env).toContain('VITE_SUPABASE_ANON_KEY=');
  expect(env).not.toMatch(/SERVICE_ROLE|SECRET|PASSWORD/i);
});
```

Создать `src/config.test.ts`; также парсить `vercel.json` и проверять rewrite `/(.*)` → `/index.html` и наличие `X-Content-Type-Options: nosniff`.

- [x] **Step 2: Запустить config test и подтвердить FAIL**

Run: `npx vitest run src/config.test.ts`  
Expected: FAIL, config files отсутствуют.

- [x] **Step 3: Создать конфигурацию**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
    ]
  }]
}
```

`.env.example` содержит только пустые `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. `public/_redirects` содержит `/* /index.html 200`. `docs/deployment.md` фиксирует build `npm run build`, output `dist`, Node 24, Supabase Auth redirect URLs и порядок: local SQL validation → authorized remote backup/apply → Auth users → hosting env → preview → production. Не помещать реальные ключи в файлы.

- [x] **Step 4: Проверить production preview**

Run: `npx tsc --noEmit && npm test -- --run && npm run build && npm run preview -- --host 127.0.0.1 --port 4173`  
Expected: build success; deep link при preview fallback обслуживает app, static assets загружаются, console не содержит missing env errors в demo mode.

- [x] **Step 5: Отметить checkpoint без deploy**

### Task 5: Сквозная проверка всей ERP

**Files:**
- Modify only for reproduced defects: relevant source/test files from previous plans.

**Interfaces:**
- Consumes: вся система.
- Produces: проверенный local candidate для authorized Supabase/Vercel deployment.

- [x] **Step 1: Запустить все автоматические проверки**

Run: `npx tsc --noEmit && npm test -- --run && node .validation-pglite-20261029/validate.mjs && npm run build`  
Expected: 0 TypeScript errors, 0 Vitest failures, 0 PGlite failures, successful build.

- [x] **Step 2: Проверить сквозные сценарии в браузере**

Admin создаёт две компании только в PGlite tests; в UI одна компания проходит: supplier purchase → recipe → blank series → finished series → shop shipment → advance/partial payment/debt → payroll acceptance/payment → weekly/monthly reports → route/invoice print. Отдельно worker mobile flow и TV board. Проверить offline queue: один requestId после reconnect не дублирует операцию; rejected stock conflict остаётся видимым.

- [x] **Step 3: Зафиксировать ограничения результата**

TaskUpdate: local implementation complete только при всех зелёных проверках. В отчёте явно указать: удалённый Supabase и hosting не изменялись; реальные multi-user Auth, backups и production deployment требуют следующего авторизованного этапа. Не обещать гарантированную прибыль или идеальную работу.

**Результат проверки 2026-10-30 (demo, браузер):**
- `tsc -b`: 0 ошибок; `vitest run`: 164/164; `npm run build`: успешно (предупреждение о чанке 561 kB); консоль браузера: 0 ошибок.
- PGlite: 357/357, 32 типа команд, 0 удалённых подключений.
- Сквозной сценарий: закупка (частичное/полное получение) → рецепт → серия заготовок → готовая серия → отгрузка магазину → аванс/частичная оплата/долг/полное закрытие → приёмка и оплата сдельной зарплаты → отчёты (день/7 дней/месяц/год/весь период) → маршрутный лист и счёт-фактура.
- Проверено: FIFO (5 000 000 аванса закрыли новую отгрузку 12 600 000, долг 7 600 000), полное погашение 25 600 000 = 25 600 000, зарплата 750 000 выплачена, счёт-фактура 16 000 000 / 5 000 000 / 11 000 000, маршрутный лист без цен и оплат, работник видит только 2 раздела без печати, ТВ-доска без денег и без кнопок печати.
- Ограничение: офлайн-очередь и конфликт ревизий проверены unit/SQL-тестами (`sync.test.ts`, `domain.test.ts`), но не против реального сервера Supabase; multi-user Auth, RLS-поведение и production deploy не проверялись.
