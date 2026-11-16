# Финансы PRO — под-проект B: «Xodim — mijoz sifatida» (работник как клиент)

**Дата:** 2026-11-05
**Статус:** утверждён владельцем в порядке A → C → D → B → E («след этап го, по очереди все без остановки»)
**Владелец решений:** собственник бизнеса (Aliya ERP)
**Реализация:** локальная, по TDD; миграция живой базы и публикация dist — отдельным разрешением.

## Место в программе «Финансы PRO»

| Код | Под-проект | Состояние |
|---|---|---|
| A | Фиксированный оклад + авансы + помесячный баланс | готово, задеплоено |
| C | Расходы месяца (коммуналка, кухня/столовая, уличные/аутсорс-услуги) | готово локально; миграция и публикация — в общем пакете разрешений |
| D | Займы и инвестиции от знакомых/внешних лиц | готово локально; миграция и публикация — в общем пакете разрешений |
| **B** | **Работник как клиент услуг и материалов, с погашением из зарплаты** | этот документ |
| E | Пульт директора | следующая спецификация |

## Решения, зафиксированные владельцем (по образцу A, C и D, без новых вопросов)

1. **Работник покупает как обычный клиент.** У работника появляется собственная карточка
   клиента (`Customer`), связанная с ним полем `employeeId`. Заказы и отгрузки на эту
   карточку создают долг в уже существующем клиентском реестре (`src/receivables.ts`) —
   нового реестра не вводится. Владелец видит покупку работника честно, как любого
   другого клиента.
2. **«Погасить из зарплаты» — безналичное удержание, а не проводка кассы.** Команда
   `salary.deduct` создаёт строку `WorkerDeduction` и больше ничего: деньги физически не
   движутся. Удержание одновременно считается **оплатой в реестре клиента** (уменьшает
   долг клиента) и **выплатой в зарплатном балансе** (уменьшает долг по зарплате).
   Кассовый журнал не меняется — там нет ни прихода, ни расхода.
3. **Сторно — по образцу кассы.** Коллекция удержаний хранит направление
   `'deduct' | 'refund'` и ссылку `reversalOf`; команда `salary.deduct.reverse` создаёт
   строку `refund` на всю сумму исходного удержания (частичное сторно не нужно, как и у
   `cash.reverse`). Сторно удержания возвращает и долг клиента, и долг по зарплате.
4. **Потолки с обеих сторон.** Удержать можно не больше, чем работник должен за
   покупки (`Amount exceeds customer debt`), и не больше, чем компания должна работнику
   по зарплате (`Amount exceeds salary debt`). Удержание на сумму больше зарплатного
   долга означало бы, что работнику «доплатили» покупкой — запрещено.
5. **Связь работник ↔ клиент.** Поле `employeeId` ставится при создании клиента
   (`customer.create` с новым необязательным полем) и может быть доставлено/снято на
   существующей карточке командой `customer.link`. Один клиент — максимум один работник,
   и наоборот (`Employee already has a customer account`). Связь не требует, чтобы
   работник был активен: уволенный работник с долгом — ровно тот случай, когда удержание
   из финального расчёта нужнее всего.
6. **Только владелец.** Команды `salary.deduct` и `salary.deduct.reverse` проходят общий
   admin-гейт. Работник видит удержания в своём зарплатном отчёте как строки выплат
   («Ish haqidan ushlab qolindi») и не может их создавать или отменять.
7. **Отчёты не искажаются.** Удержание не является кассовой операцией, поэтому
   `cashIn`/`cashOut` и аналитика кассы его не видят; балансы счетов не меняются.
   Обязательства при этом честные: долг клиента и долг по зарплате уменьшаются на одну и
   ту же сумму.

## Цель

Владелец заводит карточку клиента для работника один раз, продаёт ему услуги и
материалы как обычному клиенту, а при выдаче зарплаты удерживает долг одной командой.
Обе стороны расчёта (реестр клиента и зарплатный баланс) сходятся автоматически: сумма
удержаний видна и в карточке клиента, и в помесячной раскладке зарплаты.

## Архитектура

Расчёт остаётся чистым: удержания — это ещё одна коллекция фактов, а оба реестра
выводятся из неё вместе с кассой. Движок зарплаты (`src/salary.ts`) включает
удержания в пул выплат; реестр клиента (`src/receivables.ts`) включает их в пул оплат.
Новых модулей не появляется — правки точечные в существующих движках и домене.
Версия `State` остаётся `4`.

## Модель данных

```ts
// src/types.ts
export interface Customer {
  id: string; name: string; phone: string; address: string; kind: CustomerKind;
  employeeId: string | null;   // NEW: связь с работником (null — обычный клиент)
}

export interface WorkerDeduction {
  id: string;
  employeeId: string;       // чей работник
  customerId: string;       // какая карточка клиента (customer.employeeId === employeeId)
  amount: number;           // so‘m, 2 знака
  direction: 'deduct' | 'refund';
  note: string;
  reversalOf: string | null; // id исходного удержания для refund
  createdAt: string;         // ISO timestamp
}

export interface State {
  // существующие поля не меняются; добавляется ровно одна коллекция:
  workerDeductions: WorkerDeduction[];
}
```

Версия `State` остаётся `4`. Новая коллекция поднимается по образцу `loans`
(`Array.isArray(source.workerDeductions) ? source.workerDeductions : []`), а
`customer.employeeId` нормализуется как `customer.employeeId ?? null`. Старые снимки и
облачные копии не ломаются.

## Расчёт: интеграция в существующие движки

`src/salary.ts` — `netted(state, employeeId, before?)` (внутренняя функция):
- к кассовым выплатам (`source: 'payroll'`, `sourceId: employeeId`) добавляются
  удержания: `+ amount` для `direction: 'deduct'`, `− amount` для `'refund'`, где
  `employeeId` совпадает, а `createdAt < before` при заданном `before`.
- Всё остальное (`salaryLedger`, FIFO-распределение по месяцам, `payrollDebt`)
  не меняется: удержание автоматически уменьшает `owed` и увеличивает `paidTotal`
  ровно как выплата.

`src/receivables.ts` — `customerLedger(state, customerId)`:
- пул оплат = касса (`source: 'sale'`, `customerId`) + удержания по этой карточке
  (`+ amount` для `'deduct'`, `− amount` для `'refund'`), с тем же клампом
  `Math.max(0, …)`.
- FIFO-распределение по отгрузкам не меняется: удержание закрывает долг карточки как
  платёж. `orderLedger`/`orderPaid` и `customerAdvance` наследуют это автоматически.

Правила:
1. Сторно удержания (`refund`) симметрично возвращает долг клиента и долг по зарплате.
2. Компания без удержаний даёт ровно прежние числа (регрессия).

## Команды

```ts
| { type: 'customer.create'; name: string; phone: string; address: string; kind: CustomerKind; employeeId?: string | null }
| { type: 'customer.link'; customerId: string; employeeId: string | null }
| { type: 'salary.deduct'; employeeId: string; amount: number; note: string }
| { type: 'salary.deduct.reverse'; deductionId: string }
```

`customer.create` (расширение существующей команды)
- `employeeId` отсутствует или `null` → поведение как раньше.
- `employeeId` задан → работник существует (`Employee not found`); ни одна другая
  карточка не держит этого работника (`Employee already has a customer account`).
- Возвращает `id` карточки, как раньше.

`customer.link`
- `customerId` существует → иначе `Customer not found`;
- `employeeId` задан → работник существует (`Employee not found`) и не занят другой
  карточкой (`Employee already has a customer account`);
- ставит или снимает (`null`) связь на существующей карточке. Admin-only.

`salary.deduct`
- admin-гейт; `employeeId` существует → `Employee not found`;
- у работника есть связанная карточка → иначе `Employee has no customer account`;
- `amount > 0` (`Amount must be positive`), 2 знака (`Invalid amount`), `note` ≤ 200
  (`Note is too long`);
- `amount ≤ customerLedger(state, customerId).debt` → иначе `Amount exceeds customer debt`;
- `amount ≤ salaryLedger(state, employeeId).owed` → иначе `Amount exceeds salary debt`;
- создаёт `WorkerDeduction { direction: 'deduct', reversalOf: null }`.
- Возвращает `id` удержания (для идемпотентного retry по `requestId`).

`salary.deduct.reverse`
- admin-гейт; `deductionId` существует и имеет `direction: 'deduct'` → иначе
  `Deduction not found`;
- на него ещё нет сторно → иначе `Deduction already reversed`;
- создаёт `WorkerDeduction { direction: 'refund', reversalOf: deductionId,
  employeeId/customerId/amount — из исходной строки }`.

`cash.reverse` не трогает удержания (они безналичные); обратное тоже верно.

## Интерфейс

Панель «Oylik va qarzlar» (`src/components/SalaryPanel.tsx`):

- Строка работника: третья кнопка `Ish haqidan ushlash` (admin-only, `disabled`, если
  `salaryLedger.owed <= 0` или у работника нет карточки клиента).
- Помесячная раскладка (деталь месяца): строки удержаний показываются вместе с
  выплатами — категория «Ish haqidan ushlab qolindi», сторно — «Ushlab qolish bekor
  qilindi». Новая экспортируемая функция `salaryDeductionRows(state, employeeId,
  month | null, planStartMonth?)` повторяет FIFO-распределение `salaryPaymentRows`
  по суммам удержаний (общий расчёт — через существующий `salaryLedger`).
- Работник видит те же строки удержаний в своём зарплатном отчёте (тот же код
  рендера); кнопка удержания ему не показывается.

Модалка `salaryDeduct` (App.tsx, admin-only) — «Ish haqidan ushlab qolish»:
Xodim (readonly), Mijoz hisobi (имя карточки + qarzdorlik), Ish haqi qoldig‘i,
Summa (max = min(долг клиента, долг по зарплате)), Izoh. Вторая модалка не нужна:
сторно — отдельная кнопка/подтверждение рядом со строкой удержания в детали месяца.

Карточка клиента (`src/analytics.ts` → `customerStats`): список оплат дополняется
удержаниями («Ish haqidan ushlab qolindi»), а у карточек с `employeeId` — бейдж
`Xodim` рядом с именем (список клиентов, выбор клиента в заявке, карточка клиента).

Словарь (`src/i18n.ts`): `Ish haqidan ushlab qolish`, `Ish haqidan ushlab qolindi`,
`Ushlab qolish bekor qilindi`, `Xodim`, `Mijoz hisobi`, `Ish haqi qoldig‘i`.

## Сервер и хранение

- `supabase/schema.sql`:
  - `erp_customers` — колонка `employee_id uuid NULL` + уникальный частичный индекс
    `erp_customers_employee_idx ON (company_id, employee_id) WHERE employee_id IS NOT NULL`;
  - новая таблица `erp_worker_deductions(id uuid, company_id uuid, employee_id uuid,
    customer_id uuid, amount numeric, direction text CHECK (direction IN
    ('deduct','refund')), note text, reversal_of uuid, created_at timestamptz)` с
    внешними ключами на `erp_employees` и `erp_customers` и RLS-политикой
    `erp_admin` (как у остальных `erp_*`);
  - `erp_execute`: case `customer.create` читает `employeeId` (проверки существования
    работника и уникальности связи), новый case `customer.link`, новые case-ы
    `salary.deduct` (потолки: `erp_salary_ledger(...)->>'owed'` и долг клиента —
    отгрузки минус оплаты кассой и удержаниями) и `salary.deduct.reverse`;
  - `erp_salary_ledger`: `v_payments` и `v_paid_before` дополняются нетто-удержаниями
    (deduct +, refund −);
  - `erp_customer_advance` и `erp_order_paid`: пул оплат дополняется нетто-удержаниями;
  - `erp_snapshot()`: секция `workerDeductions` — admin получает все строки, работник —
    только свои (`employee_id` из его профиля); `customers` в снимке включают
    `employee_id`;
  - `erp_backup_dump()` — каталог-управляемый, покрывает `erp_worker_deductions`
    автоматически (менять не нужно).
- `supabase/migrations/20261105_worker_deductions.sql` — идемпотентная миграция
  (колонка + индекс + таблица + DO-блок полной замены `erp_snapshot()`,
  `erp_execute()`, `erp_salary_ledger()`, `erp_customer_advance()`,
  `erp_order_paid()` + GRANT). Применяется к живой базе только по отдельному
  разрешению, после миграций C и D.
- `supabase/functions/_shared/backup.ts` — `STATE_COLLECTIONS` +=
  `workerDeductions: 'erp_worker_deductions'`.
- `src/migrations.ts` — дефолт `[]` для коллекции и `employeeId ?? null` для
  клиентов; `src/sync.ts` — `workerDeductions` в список `verifiedSnapshot`.
- Порядок выката (после разрешения): **сначала миграция базы (C → D → B), потом
  публикация фронтенда** — иначе `verifiedSnapshot` отклонит облачные снимки.
- Демо-сид (`src/seed.ts`) — одна карточка клиента, связанная с работником, с долгом
  по отгрузке и одним удержанием на часть долга (числа сходятся с демо-кассой).

## Обработка ошибок

- `Employee not found`, `Customer not found`, `Employee already has a customer
  account`, `Employee has no customer account` — новые тексты;
- `Amount exceeds customer debt` / `Amount exceeds salary debt` — попадают в
  `translateError` через общий паттерн `/amount exceeds/` → «Summa qarz qoldig‘idan
  oshadi…» (существующая строка кассы переводится);
- `Deduction not found`, `Deduction already reversed`;
- `Amount must be positive`, `Invalid amount`, `Note is too long` — существующие
  валидации.

## Тесты

Порядок — сначала падающие тесты, потом домен/UI/SQL.

`src/salary.test.ts` (RED до реализации):
1. удержание 200 000 при долге по зарплате 1 000 000 → `owed` уменьшился на
   200 000, `paidTotal` вырос;
2. сторно удержания возвращает `owed` к исходному;
3. удержание учитывается в `netted` с фильтром `before` (попадает в нужный месяц);
4. работник без удержаний даёт прежние числа (регрессия).

`src/receivables.test.ts`:
1. удержание закрывает долг карточки клиента как платёж (FIFO по отгрузкам);
2. сторно удержания возвращает долг;
3. удержание сверх долга клиента уходит в аванс (пул оплат как у кассы);
4. карточка без удержаний даёт прежние числа.

`src/domain.test.ts`:
- `customer.create` с `employeeId` (создание, несуществующий работник, занятый
  работник, `employeeId: null` как раньше);
- `customer.link` (привязка, отвязка, занятость, несуществующие id, admin-гейт);
- `salary.deduct` (успех, admin-гейт, нет карточки, превышение долга клиента,
  превышение долга по зарплате, валидации, idempotent retry);
- `salary.deduct.reverse` (успех, не найдено, уже сторнировано, admin-гейт).

`src/i18n.test.ts`: новые строки словаря.

`src/salary-ui.test.tsx`: `salaryDeductionRows` — удержание попадает в свой месяц,
сторно вычитается, carry-over и месяцы распределяются как у выплат.

Регрессия: `src/migrations.test.ts` (снимок без `workerDeductions` и без
`employeeId` поднимается), `src/sync.test.ts`, `src/copy.test.ts` /
`src/backup.test.ts` (новая коллекция в копии), `src/sections.test.ts`.

SQL: PGlite-зонд `.validation-pglite-20261029/validate-worker-deductions.mjs` —
`erp_salary_ledger` против TS с удержаниями на одинаковых данных, круг
`snapshot → дамп → восстановление` с удержаниями, case-ы `salary.deduct` /
`salary.deduct.reverse` / `customer.link` и отказы (потолки, сторно). `validate.mjs`:
`workerDeductions` в транспилируемых модулях, упражнения новых команд, таблица
`erp_worker_deductions` в protections (счётчик 29 → 30).

Финал: `npm test`, `npm run build`, браузер на ширине телефона в демо-режиме (пустые
`VITE_SUPABASE_*`): создать/привязать карточку работника, удержать часть долга,
проверить обе стороны расчёта и сторно.

## Критерии готовности

- Удержание одной командой уменьшает долг карточки клиента и долг по зарплате на
  одну и ту же сумму; сторно возвращает оба.
- Потолки: нельзя удержать больше долга клиента или больше зарплатного долга.
- Касса, отчёты `cashIn`/`cashOut` и аналитика не видят удержаний; балансы счетов не
  меняются.
- Компания без удержаний даёт ровно прежние числа (регрессия).
- Работник видит удержания в своём зарплатном отчёте; команд удержания у него нет.
- Облачная копия содержит `workerDeductions` и `employee_id` клиентов и
  восстанавливается без потерь.

## Вне рамок этого под-проекта

Автоматическое удержание при начислении (удержание всегда явной командой владельца);
лимит покупок для работника в счёт зарплаты; продажа работнику со скидкой; напоминания
работнику о долге (появится в E).

## Риски

1. **Расхождение TS и SQL** — паритет держится PGlite-зондом.
2. **Двойной счёт удержания** (и в зарплате, и в клиенте) — осознанная механика,
   покрыта тестами обеих сторон и зондом.
3. **Перекладка связи работник ↔ клиент задним числом** — журнал амалов показывает.
4. **Миграция живой базы** — только после облачной копии, прогона зонда и отдельного
   разрешения.
