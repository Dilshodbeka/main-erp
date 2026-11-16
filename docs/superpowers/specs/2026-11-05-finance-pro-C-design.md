# Финансы PRO — под-проект C: «Oylik xarajatlar» (расходы месяца)

**Дата:** 2026-11-05
**Статус:** утверждён владельцем в порядке A → C → D → B → E («след этап го, по очереди все без остановки»)
**Владелец решений:** собственник бизнеса (Aliya ERP)
**Реализация:** локальная, по TDD; миграция живой базы и публикация dist — отдельным разрешением.

## Место в программе «Финансы PRO»

| Код | Под-проект | Состояние |
|---|---|---|
| A | Фиксированный оклад + авансы + помесячный баланс | готово, задеплоено |
| **C** | **Расходы месяца (коммуналка, кухня/столовая, уличные/аутсорс-услуги) с муддатом и долгом «как по поставщикам»** | этот документ |
| D | Займы и инвестиции от знакомых/внешних лиц | следующая спецификация |
| B | Работник как клиент услуг и материалов, с погашением из зарплаты | после D |
| E | Пульт директора | достраивается блоком после каждого шага |

## Решения, зафиксированные владельцем (по образцу A, без новых вопросов)

1. **Каждый расход — отдельная строка плана.** Владелец заводит строку («Elektr energiyasi»,
   «Oshxona», «Hovli ishlari»), сумму в месяц и месяц старта. Расход повторяется каждый месяц сам.
2. **Запуск с выбранного месяца.** План действует с `fromMonth`; прошлые месяцы не создаются задним
   числом. Первый месяц плана — полный месяц, даже если план заведён в середине месяца (дата «начала
   расхода» не хранится — то же правило, что у окладов).
3. **Муддат = день месяца.** У строки есть `dueDay` (1–31): «har oy shu kungacha to‘lash kerak». На расчёт
   не влияет — это подсказка и сортировка списка, чтобы владелец видел, что платить раньше.
4. **Долг «как по поставщикам» — FIFO.** Каждый месяц создаёт обязательство на полную сумму. Любой
   платёж закрывает самый старый открытый месяц. Излишек становится `Oldindan to‘langan` и закрывает
   будущие месяцы, когда они наступят. Неоплаченные месяцы копятся в «Qarzdorlik» — точь-в-точь как
   `supplierDebt`, но отдельной коллекцией: поставщики материалов и коммуналка не смешиваются.
5. **Без удаления.** Ошибочная сумма правится той же строкой за тот же месяц; повышение суммы с месяца —
   новой версией. (То же решение, что в A.)
6. **Оплата — обычная кассовая проводка** `CashEntry { direction: 'out', source: 'expense',
   sourceId: planId, category: 'expense', note }`. Журнал кассы показывает её как «Oylik xarajat».
   Сторно возвращает долг автоматически.
7. **Расходы попадают в управленческий отчёт.** `periodReport` («Umumiy xarajatlar») считает оплаты
   `source: 'expense'` наравне с ручными расходами — иначе переезд коммуналки в новый модуль «потерял»
   бы её из отчёта.
8. **Только владелец.** Команды `expense.*` проходят общий admin-гейт; работник и display их не видят.

## Цель

Владелец заводит повторяющиеся расходы месяца один раз, видит помесячную сетку «оплачен / частично /
не оплачен», день платежа и сколько он должен по каждому расходу сейчас. Общая сумма долгов по
расходам входит в «Majburiyatlar» и «Kreditor qarzdorlik» кассы. Расходы, оплаченные через план,
попадают в «Umumiy xarajatlar» отчёта.

## Архитектура

Расчёт — чистая функция, состояние — минимальное: обязательства **не хранятся**, а выводятся из плана
и кассовых записей (тот же принцип, что `src/salary.ts` и `src/receivables.ts`). Новый модуль
`src/expenses.ts` импортирует только `type { State }` из `./types`.

## Модель данных

```ts
// src/types.ts
export interface ExpensePlan {
  id: string;             // id конкретной версии
  planId: string;         // id строки расхода; объединяет версии
  title: string;          // «Elektr energiyasi» — правится с любой версией
  amount: number;         // so‘m, 2 знака, сумма за месяц
  fromMonth: string;      // 'YYYY-MM' — с какого месяца действует
  dueDay: number;         // 1–31, справочно: день месяца, до которого платят
  supplierId: string | null; // необязательная привязка к справочнику поставщиков (телефон/имя)
  createdAt: string;      // ISO timestamp
}

export type CashSource = 'manual' | 'sale' | 'supplier' | 'payroll' | 'expense' | 'transfer';

export interface State {
  // существующие поля не меняются; добавляется ровно одна коллекция:
  expensePlans: ExpensePlan[];
}
```

Версия `State` остаётся `4`. Новая коллекция поднимается по образцу `salaryPlans`
(`Array.isArray(source.expensePlans) ? source.expensePlans : []`). Старые снимки и облачные копии не
ломаются.

## Расчёт: `src/expenses.ts`

```ts
export interface ExpenseMonth { month: string; obliged: number; paid: number; unpaid: number }
export interface ExpenseLedger {
  planId: string;
  title: string;          // из последней версии
  months: ExpenseMonth[];
  prepaid: number;        // oldindan to‘langan: излишек сверх открытых месяцев
  owed: number;           // qarzdorlik: сумма неоплаченных месяцев
  paidTotal: number;      // все платежи нетто (сторно вычитаются)
  plannedTotal: number;   // Σ obliged за все месяцы от fromMonth
}
export function expenseLedger(state: State, planId: string, asOf?: string): ExpenseLedger
export function expensesDebt(state: State): number  // Σ owed по всем строкам расходов
```

Правила:

1. **Версии.** Строки с одним `planId` сортируются по `fromMonth` (tiebreak — `createdAt`). Для каждого
   месяца от `min(fromMonth)` до месяца `asOf` (по умолчанию — текущий) включительно `obliged` =
   `amount` версии, действующей в этом месяце (`fromMonth <= месяц`). Месяц всегда полный — дни не
   считаются.
2. **Платежи.** `source: 'expense'`, `sourceId: planId`, направления `in`/`out` неттируются (сторно —
   отрицательный вклад), сортируются по `createdAt` и закрывают месяцы по порядку (FIFO). Остаток
   после последнего открытого месяца = `prepaid`.
3. **Итоги.** `owed = max(0, plannedTotal − paidTotal)`, `prepaid = max(0, paidTotal − plannedTotal)`,
   `Σ месячных unpaid = owed`. Переносного остатка нет: до `fromMonth` обязательств не существует.
4. **`expensesDebt`** — сумма `owed` по всем уникальным `planId` (для «Majburiyatlar»).
5. **Округление.** Всё через существующий `round()` (2 знака), как в `src/salary.ts`.

## Команды

```ts
| { type: 'expense.plan.set'; planId: string | null; title: string; amount: number; fromMonth: string; dueDay: number; supplierId: string | null }
| { type: 'expense.pay'; planId: string; amount: number; account: Account; note: string; allowPrepay: boolean }
```

`expense.plan.set`
- `planId: null` → новая строка расхода (генерируются и `id`, и `planId`).
- `planId` есть и версия с тем же `fromMonth` уже есть → **заменяет** её (title, amount, dueDay,
  supplierId) — правка опечатки или суммы задним числом.
- `planId` есть и `fromMonth` новый → новая версия (повышение суммы с месяца).
- Валидация: `title` непустой после trim, ≤ 200 символов; `amount` ≥ 0 с 2 знаками (`Invalid amount`);
  `fromMonth` — `YYYY-MM` (`Invalid expense plan month`); `dueDay` — целое 1–31 (`Invalid expense due day`);
  `supplierId` — `null` или существующий поставщик (`Supplier not found`).
- Возвращаемый id — `planId` (для идемпотентного retry по `requestId`).

`expense.pay`
- `planId` существует → иначе `Expense plan not found`;
- `amount > 0` (`Amount must be positive`), `account` в `(cash, bank)`, `note` ≤ 200 символов;
- без `allowPrepay` отклоняется `Payment exceeds payable`, если `amount > owed`; с флагом излишек
  уходит в `prepaid` (оплата будущего месяца вперёд, например аренда);
- потолок остатка счёта — как у всех: `Insufficient account balance`;
- пишет `CashEntry { direction: 'out', source: 'expense', sourceId: planId, category: 'expense', note }`.

Обе команды — admin-only: общий гейт `src/domain.ts` не меняется (работник может только
`work.accept` / `work.start` / `work.submit`).

## Интерфейс

Новая панель в «Moliya va kassa» (`src/sections.ts:18`): `{ id: 'xarajatlar', title: 'Oylik xarajatlar' }`.

- Метрики: `Oylik reja` (Σ plannedTotal), `To‘langan` (Σ paidTotal), `Qarzdorlik` (Σ owed, акцент),
  `Oldindan to‘langan` (Σ prepaid).
- Таблица строк расходов (на телефоне — карточки через `table-scroll cardable` и `data-label`):
  название, `har oy {dueDay}-kungacha`, поставщик (если указан), полоса месяцев `.month-bar` с чипами
  `to‘langan | qisman | to‘lanmagan`, колонки «To‘langan» и «Qarzdorlik», кнопки «Tahrirlash» и
  «To‘lash» (disabled, если `owed <= 0`).
- Нажатие на чип месяца раскрывает проводку: какие платежи закрыли этот месяц (Sana / Kategoriya /
  Izoh / Summa — как в SalaryPanel).
- Модалка `expensePlan` — «Oylik xarajat» (новая или правка): Nomi, `fromMonth` (`YYYY-MM`), `To‘lash
  kuni` (число 1–31), сумма, необязательный «Yetkazib beruvchi», список версий с датами.
- Модалка `expensePay` — «Oylik xarajat to‘lovi»: Qoldiq, сумма (max = owed без флага), Naqd pul /
  Bank / karta, Izoh, чекбокс `Oldindan to‘lovga ruxsat` с подписью, что излишек закроет следующий месяц.
- Журнал кассы: `category` `expense` печатается «Oylik xarajat» через `cashCategoryLabel`; строка
  «Asos» — «Oylik xarajat to‘lovi» (новая ветка в мапе источника).
- «Kreditor qarzdorlik» кассы: строки расходов с `owed > 0` — кнопка ведёт в `expensePay`.
- Метрика «Majburiyatlar» (`App.tsx:536`): `supplierTotal + payrollTotal + expensesDebt(state)`, подпись
  «Yetkazib beruvchilar, ish haqi va oylik xarajatlar».
- Отчёт «Umumiy xarajatlar» (`src/reports.ts:80`): оплаты `source: 'expense'` считаются операционным
  расходом так же, как `manual` (категории-исключения не затрагивают `expense`).
- Текст интерфейса — узбекская латиница, валюта UZS. Словарь: `Oylik xarajatlar`, `Oylik xarajat`,
  `Oylik reja`, `Qarzdorlik`, `Oldindan to‘langan`, `To‘lash kuni`, `har oy {n}-kungacha`,
  `Oylik xarajat to‘lovi`, `Oldindan to‘lovga ruxsat`.

## Сервер и хранение

- `supabase/schema.sql` — таблица `erp_expense_plans(id uuid, plan_id uuid, company_id, title text,
  amount numeric, from_month text, due_day int, supplier_id uuid null, created_at timestamptz)` с
  `UNIQUE (company_id, plan_id, from_month)`, RLS-политикой как у остальных `erp_*` и индексом
  `(company_id, plan_id, from_month)`; секция `expensePlans` в `erp_snapshot()` **только для admin**
  (расходы работнику не видны); case-ы `expense.plan.set` и `expense.pay` в `erp_execute`; функция
  `erp_expense_ledger(company_id, plan_id, as_of date) → jsonb`, повторяющая правила 1–5, — сервер
  отклоняет платёж больше `owed` тем же текстом, что и TS.
- `supabase/migrations/20261105_expense_plans.sql` — идемпотентная миграция (таблица + полная замена
  `erp_snapshot()` и `erp_execute()` + `erp_expense_ledger()` + GRANT). Применяется к живой базе только
  по отдельному разрешению.
- `supabase/functions/_shared/backup.ts` — `STATE_COLLECTIONS` += `expensePlans: 'erp_expense_plans'`.
- `src/migrations.ts` — дефолт `[]`; `src/sync.ts` — `expensePlans` в список `verifiedSnapshot`.
- Порядок выката (после разрешения): **сначала миграция базы, потом публикация фронтенда** — иначе
  `verifiedSnapshot` отклонит облачные снимки.
- Демо-сид (`src/seed.ts`) — 2–3 расхода: один закрытый, один частично, один с долгом.

## Обработка ошибок

- Невалидный `fromMonth` → `Invalid expense plan month`; `dueDay` вне 1–31 → `Invalid expense due day`;
  отрицательная/трёхзначная сумма → `Invalid amount`; пустой title → `Expense title required`;
  неизвестный `supplierId` → `Supplier not found`; неизвестный `planId` → `Expense plan not found`.
- Платёж больше `owed` без флага → `Payment exceeds payable` (существующий текст).
- Сторно оплаты (`cash.reverse`) автоматически возвращает сумму в `owed` и откатывает FIFO.

## Тесты

Порядок — сначала падающие тесты, потом домен/UI/SQL.

`src/expenses.test.ts` (чистый движок, RED до реализации):
1. новый план `600 000` с `2026-11` → один месяц, `owed = 600 000`, `plannedTotal = 600 000`;
2. два месяца горизонта → ноябрь и декабрь по сумме версии;
3. две версии (ноябрь `600 000`, январь `900 000`) → декабрь по старой, январь по новой;
4. платёж `400 000` закрывает ноябрь частично → `paid 400 000`, `unpaid 200 000`, `owed = 200 000`;
5. платёж больше `plannedTotal` → `prepaid = излишек`, `owed = 0`;
6. сторно возвращает платёж → `owed` восстанавливается;
7. идентичность: `Σ unpaid = owed`, `owed = max(0, plannedTotal − paidTotal)`;
8. `expensesDebt` — сумма по двум планам.

`src/domain.test.ts`: валидация `expense.plan.set` (замена версии того же месяца, новая версия,
невалидный месяц, dueDay, пустой title, неизвестный supplier), `expense.pay` (admin-гейт, потолок
`owed`, флаг prepay, idempotent retry), сторно, отсутствие двойного счёта.

`src/reports.test.ts`: оплата `source: 'expense'` входит в `operating`; `payroll`/`supplier` — нет.

Регрессия: `src/migrations.test.ts` (снимок без `expensePlans` поднимается), `src/sync.test.ts`,
`src/i18n.test.ts` (`cashCategoryLabel('expense')` → «Oylik xarajat»), `src/sections.test.ts`,
`src/mobileCards.test.ts` (новый файл панели в `tableFiles`), `src/copy.test.ts` / `src/backup.test.ts`
(новая коллекция в копии).

SQL: PGlite-зонд `.validation-pglite-20261029/validate-expense-migration.mjs` — `erp_expense_ledger`
против TS на одинаковых наборах данных, круг `snapshot → дамп → восстановление` с расходами,
`erp_execute` case-ы и отказы. `expenses` добавить в список транспилируемых модулей `validate.mjs:12`.

Финал: `npm test`, `npm run build`, браузер на ширине телефона в демо-режиме (пустые `VITE_SUPABASE_*`).

## Критерии готовности

- Помесячная сетка сходится с кассой: `owed = max(0, plannedTotal − paidTotal)`, `Σ unpaid = owed`.
- «Majburiyatlar» и «Kreditor qarzdorlik» включают Σ `owed` по расходам.
- «Umumiy xarajatlar» отчёта содержит оплаты через план расходов.
- Компания без планов расходов даёт ровно прежние числа (регрессия).
- Облачная копия содержит `expensePlans` и восстанавливается без потерь.

## Вне рамок этого под-проекта

Разовые (непериодические) расходы — остаются ручной кассовой проводкой; счёт-фактуры и акты;
автоплатёж по расписанию; напоминания о дне платежа (появится в E); налоги.

## Риски

1. **Расхождение TS и SQL** — паритет держится PGlite-зондом.
2. **Перекладка сетки задним числом** при правке суммы — осознанно, журнал амалов показывает.
3. **Миграция живой базы** — только после облачной копии, прогона зонда и отдельного разрешения.
