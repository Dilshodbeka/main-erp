# Финансы PRO — под-проект D: «Zaymlar va investitsiyalar» (займы и инвестиции)

**Дата:** 2026-11-05
**Статус:** утверждён владельцем в порядке A → C → D → B → E («след этап го, по очереди все без остановки»)
**Владелец решений:** собственник бизнеса (Aliya ERP)
**Реализация:** локальная, по TDD; миграция живой базы и публикация dist — отдельным разрешением.

## Место в программе «Финансы PRO»

| Код | Под-проект | Состояние |
|---|---|---|
| A | Фиксированный оклад + авансы + помесячный баланс | готово, задеплоено |
| C | Расходы месяца (коммуналка, кухня/столовая, уличные/аутсорс-услуги) | готово локально; миграция и публикация — в общем пакете разрешений |
| **D** | **Займы и инвестиции от знакомых/внешних лиц: отдельный внутренний счёт, перевод в основной, частичные возвраты** | этот документ |
| B | Работник как клиент услуг и материалов, с погашением из зарплаты | следующая спецификация |
| E | Пульт директора | достраивается блоком после каждого шага |

## Решения, зафиксированные владельцем (по образцу A и C, без новых вопросов)

1. **Каждый заём или инвестиция — отдельная строка-счёт.** Владелец заводит строку
   («Jasur aka», «Sardor — investitsiya») с суммой (principal), от кого, типом
   (`loan` / `investment`) и заметкой. «Отдельный внутренний счёт» из описания программы
   реализуется именно так: у займа своя строка и свои остатки; нового значения `Account`
   не вводится — обязательства не хранятся, а выводятся из кассовых записей (тот же
   принцип, что `src/salary.ts` и `src/expenses.ts`). Тип влияет только на подпись
   («Zaym» / «Investitsiya»), механика одинаковая: деньги предстоит вернуть.
2. **Получение денег = «перевод в основной».** Команда `loan.draw` пишет приход на тот
   счёт, который укажет владелец (касса или банк). Заёмные деньги попадают в общий баланс
   кассы, но в доходе и расходах не учитываются (решение 6).
3. **Частичные возвраты — FIFO не нужен.** Долг займа = `principal − возвращено`; любой
   возврат уменьшает долг той же строки, как `supplierDebt`, но отдельной коллекцией:
   поставщики материалов и займы не смешиваются. Переплата сверх долга запрещена
   (`Amount exceeds loan debt`) — будущих месяцев у займа нет.
4. **Без удаления.** Ошибочная сумма или имя правятся той же строкой (`loan.set` с тем же
   id). Полностью возвращённый заём остаётся в списке с `owed = 0`. Перекладка задним
   числом — осознанно, журнал амалов показывает.
5. **Проводки кассы.** Получение — `CashEntry { direction: 'in', source: 'loan',
   sourceId: loanId, category: 'loan-draw', note }`; возврат — `{ direction: 'out',
   ..., category: 'loan-repay' }`. Два разных category нужны, чтобы сторно
   (`cash.reverse` копирует category и разворачивает direction) не спутало отменённое
   получение с настоящим возвратом. Журнал кассы показывает «Zaym olindi» /
   «Zaym qaytarildi».
6. **Заёмные деньги не доход и не расход.** `periodReport` (`cashIn`/`cashOut`),
   аналитика кассы `cashByPeriod`/`cashByCategory` исключают `source: 'loan'` — иначе
   взятые в долг 100 млн выглядели бы выручкой, а возврат — убытком. `operating`
   (`Umumiy xarajatlar`) уже не затронут: он считает только `manual`/`expense`.
   Баланс счёта (`erp_balance`, «Kassa va hisoblarda») при этом честный: заёмные деньги —
   реальные деньги на счету.
7. **Только владелец.** Команды `loan.*` проходят общий admin-гейт; работник и display
   их не видят.

## Цель

Владелец заводит займы и инвестиции один раз, видит по каждой строке: сколько
договорились (`principal`), сколько получено (`drawn`), сколько ещё можно получить
(`available`), сколько возвращено (`repaid`) и сколько должен сейчас (`owed`). Общая
сумма долгов по займам входит в «Majburiyatlar» и «Kreditor qarzdorlik» кассы, а сами
заёмные потоки не искажают отчёт о доходах и расходах.

## Архитектура

Расчёт — чистая функция, состояние — минимальное: обязательства **не хранятся**, а
выводятся из строк займов и кассовых записей (тот же принцип, что `src/salary.ts`,
`src/receivables.ts`, `src/expenses.ts`). Новый модуль `src/loans.ts` импортирует только
`type { State }` из `./types`.

## Модель данных

```ts
// src/types.ts
export type LoanKind = 'loan' | 'investment';

export interface LoanRow {
  id: string;           // id строки-счёта займа
  title: string;        // от кого: «Jasur aka»
  kind: LoanKind;       // 'loan' | 'investment' — только подпись
  amount: number;       // principal, so‘m, 2 знака
  note: string;         // условия, заметка владельца
  createdAt: string;    // ISO timestamp
}

export type CashSource = 'manual' | 'sale' | 'supplier' | 'payroll' | 'expense' | 'loan' | 'transfer';

export interface State {
  // существующие поля не меняются; добавляется ровно одна коллекция:
  loans: LoanRow[];
}
```

Версия `State` остаётся `4`. Новая коллекция поднимается по образцу `expensePlans`
(`Array.isArray(source.loans) ? source.loans : []`). Старые снимки и облачные копии не
ломаются.

## Расчёт: `src/loans.ts`

```ts
export interface LoanLedger {
  id: string;
  title: string;
  kind: LoanKind;
  principal: number;  // сумма по договорённости
  drawn: number;      // получено (сторно вычитается)
  available: number;  // сколько ещё можно получить
  repaid: number;     // возвращено (сторно вычитается)
  owed: number;       // qarzdorlik: principal − repaid
}
export function loanLedger(state: State, loanId: string): LoanLedger
export function loansDebt(state: State): number       // Σ owed по всем займам
export function loansAvailable(state: State): number  // Σ available по всем займам
```

Правила:

1. **Получено.** `drawn = Σ amount(source: 'loan', sourceId: loanId, category:
   'loan-draw', direction: 'in') − Σ amount(то же, direction: 'out')`. Сторно получения —
   отрицательный вклад.
2. **Возвращено.** `repaid = Σ amount(category: 'loan-repay', direction: 'out') −
   Σ amount(то же, direction: 'in')`. Сторно возврата — отрицательный вклад.
3. **Итоги.** `available = max(0, principal − drawn)`, `owed = max(0, principal − repaid)`.
4. **`loansDebt`** — сумма `owed` по всем займам (для «Majburiyatlar» и «Kreditor
   qarzdorlik»); **`loansAvailable`** — сумма `available` (для метрики панели).
5. **Округление.** Всё через существующий `round()` (2 знака), как в `src/salary.ts`.

## Команды

```ts
| { type: 'loan.set'; loanId: string | null; title: string; kind: LoanKind; amount: number; note: string }
| { type: 'loan.draw'; loanId: string; amount: number; account: Account; note: string }
| { type: 'loan.repay'; loanId: string; amount: number; account: Account; note: string }
```

`loan.set`
- `loanId: null` → новая строка займа (генерируется `id`).
- `loanId` есть → **заменяет** title, kind, amount, note той же строки — правка опечатки
  или суммы задним числом (решение 4).
- Валидация: `title` непустой после trim, ≤ 200 символов (`Loan title required`);
  `kind` — `'loan' | 'investment'` (`Invalid loan kind`); `amount` ≥ 0 с 2 знаками
  (`Invalid amount`); `note` ≤ 200 символов (`Note is too long`).
- Возвращаемый id — id строки займа (для идемпотентного retry по `requestId`).

`loan.draw`
- `loanId` существует → иначе `Loan not found`;
- `amount > 0` (`Amount must be positive`), `account` в `(cash, bank)`, `note` ≤ 200;
- `amount > available` отклоняется `Amount exceeds loan balance`;
- пишет `CashEntry { direction: 'in', source: 'loan', sourceId: loanId, category:
  'loan-draw', note }`.

`loan.repay`
- `loanId` существует → иначе `Loan not found`;
- `amount > 0`, `account` в `(cash, bank)`, `note` ≤ 200;
- `amount > owed` отклоняется `Amount exceeds loan debt`;
- потолок остатка счёта — как у всех: `Insufficient account balance`;
- пишет `CashEntry { direction: 'out', source: 'loan', sourceId: loanId, category:
  'loan-repay', note }`.

`cash.reverse` (src/domain.ts) дополнительно проверяет существование строки займа для
`source === 'loan'` (та же ветка-образец, что у `expense`).

Все команды — admin-only: общий гейт `src/domain.ts` не меняется.

## Интерфейс

Новая панель в «Moliya va kassa» (`src/sections.ts`): `{ id: 'zaymlar', title:
'Zaymlar va investitsiyalar' }` — после `xarajatlar`.

- Метрики: `Jami summa` (Σ principal), `Olingan` (Σ drawn), `Qaytarilgan` (Σ repaid),
  `Qarzdorlik` (Σ owed, акцент).
- Таблица строк займов (на телефоне — карточки через `table-scroll cardable` и
  `data-label`): имя + бейдж `Zaym` / `Investitsiya`, заметка, колонки «Olingan»,
  «Mavjud», «Qaytarilgan», «Qarzdorlik», кнопки «Pul olish» (disabled, если
  `available <= 0`), «Qaytarish» (disabled, если `owed <= 0`) и «Tahrirlash».
- Нажатие на строку раскрывает проводки займа: какие платежи пришли/ушли
  (Sana / Kategoriya / Izoh / Summa — как в SalaryPanel).
- Модалка `loanSet` — «Zaym yoki investitsiya» (новая или правка): Kimdan, Turi
  (Zaym / Investitsiya), Summa, Izoh.
- Модалка `loanDraw` — «Zaym mablag‘ini olish»: Mavjud qoldiq, сумма (max = available),
  Naqd pul / Bank, Izoh.
- Модалка `loanRepay` — «Zaymni qaytarish»: Qarzdorlik, сумма (max = owed),
  Naqd pul / Bank, Izoh.
- Журнал кассы: `cashCategoryLabel('loan-draw')` → «Zaym olindi»,
  `cashCategoryLabel('loan-repay')` → «Zaym qaytarildi»; строка «Asos» — мапа источника
  пополняется `loan: 'Zaym operatsiyasi'`.
- «Kreditor qarzdorlik» кассы: строки займов с `owed > 0` — кнопка ведёт в `loanRepay`.
- Метрика «Majburiyatlar» (`App.tsx`): `supplierTotal + payrollTotal + expensesTotal +
  loansDebt(state)`, подпись «Yetkazib beruvchilar, ish haqi, oylik xarajatlar va
  zaymlar».
- Отчёт `periodReport` (`src/reports.ts`): `cashIn` и `cashOut` не считают
  `source: 'loan'`; аналитика `src/analytics.ts` (`cashByPeriod`, `cashByCategory`)
  исключает `source: 'loan'` из обеих сторон.
- Текст интерфейса — узбекская латиница, валюта UZS. Словарь: `Zaymlar va
  investitsiyalar`, `Zaym`, `Investitsiya`, `Jami summa`, `Olingan`, `Mavjud`,
  `Qaytarilgan`, `Qarzdorlik`, `Zaym olindi`, `Zaym qaytarildi`, `Zaym operatsiyasi`,
  `Zaym yoki investitsiya`, `Zaym mablag‘ini olish`, `Zaymni qaytarish`, `Pul olish`,
  `Qaytarish`.

## Сервер и хранение

- `supabase/schema.sql` — таблица `erp_loans(id uuid, company_id, title text,
  kind text CHECK (kind IN ('loan', 'investment')), amount numeric, note text,
  created_at timestamptz)` с RLS-политикой `erp_admin_read` как у остальных `erp_*`;
  CHECK-ограничения `erp_cash` пополняются значением `'loan'` (список source и
  shape-ветка `OR (source = 'loan' AND source_id IS NOT NULL AND customer_id IS NULL)`);
  секция `loans` в `erp_snapshot()` **только для admin** (займы работнику не видны);
  case-ы `loan.set`, `loan.draw`, `loan.repay` в `erp_execute` (и проверка займа в
  `cash.reverse`); функция `erp_loan_ledger(company_id, loan_id) → jsonb`, повторяющая
  правила 1–3, — сервер отклоняет превышение `available`/`owed` теми же текстами, что
  и TS; список таблиц в `erp_backup_dump()` пополняется `erp_loans`.
- `supabase/migrations/20261105_loans.sql` — идемпотентная миграция (таблица + DO-блок
  починки CHECK-ов `erp_cash` с паттерном `NOT LIKE '%loan%'` + полная замена
  `erp_snapshot()` и `erp_execute()` + `erp_loan_ledger()` + GRANT). Применяется к живой
  базе только по отдельному разрешению.
- `supabase/functions/_shared/backup.ts` — `STATE_COLLECTIONS` += `loans: 'erp_loans'`.
- `src/migrations.ts` — дефолт `[]`; `src/sync.ts` — `loans` в список `verifiedSnapshot`.
- Порядок выката (после разрешения): **сначала миграция базы, потом публикация
  фронтенда** — иначе `verifiedSnapshot` отклонит облачные снимки.
- Демо-сид (`src/seed.ts`) — 2 строки: один заём частично получен и частично возвращён,
  одна инвестиция получена полностью.

## Обработка ошибок

- Пустой title → `Loan title required`; неверный kind → `Invalid loan kind`;
  отрицательная/трёхзначная сумма → `Invalid amount`; длинная заметка →
  `Note is too long`; неизвестный `loanId` → `Loan not found`.
- Получение сверх `available` → `Amount exceeds loan balance`; возврат сверх `owed` →
  `Amount exceeds loan debt` (новые тексты, в `translateError` попадают через общий
  паттерн `/amount exceeds/` → «Summa qarz qoldig‘idan oshadi…» — строка кассы уже
  переводится).
- Сторно (`cash.reverse`) автоматически уменьшает `drawn`/`repaid` и восстанавливает
  `available`/`owed`.

## Тесты

Порядок — сначала падающие тесты, потом домен/UI/SQL.

`src/loans.test.ts` (чистый движок, RED до реализации):
1. новый заём `10 000 000` без проводок → `principal 10 000 000`, `drawn 0`,
   `available 10 000 000`, `repaid 0`, `owed 10 000 000`;
2. получение `6 000 000` → `drawn 6 000 000`, `available 4 000 000`, `owed 10 000 000`;
3. возврат `2 000 000` → `repaid 2 000 000`, `owed 8 000 000`;
4. сторно получения возвращает `drawn`/`available` к исходным;
5. сторно возврата восстанавливает `owed`;
6. попытка получить больше principal в данных → `available = 0`, `drawn = principal`;
7. `loansDebt` — сумма `owed` по двум займам; `loansAvailable` — сумма `available`;
8. kind проходит в ledger (`investment`).

`src/domain.test.ts`: `loan.set` (создание, правка той же строки, пустой title,
неверный kind, невалидная сумма, длинная заметка), `loan.draw` (admin-гейт, потолок
`available`, валидации, idempotent retry), `loan.repay` (потолок `owed`, потолок остатка
счёта), сторно проводки займа, отсутствие двойного счёта.

`src/reports.test.ts`: проводки `source: 'loan'` не входят в `cashIn`/`cashOut`;
`manual`/`expense` считаются как раньше.

`src/analytics.test.ts`: `cashByPeriod`/`cashByCategory` не считают `source: 'loan'`.

Регрессия: `src/migrations.test.ts` (снимок без `loans` поднимается), `src/sync.test.ts`,
`src/i18n.test.ts` (`cashCategoryLabel('loan-draw')` → «Zaym olindi»,
`('loan-repay')` → «Zaym qaytarildi»), `src/sections.test.ts`, `src/mobileCards.test.ts`
(новый файл панели в `tableFiles`), `src/copy.test.ts` / `src/backup.test.ts` (новая
коллекция в копии).

SQL: PGlite-зонд `.validation-pglite-20261029/validate-loans-migration.mjs` —
`erp_loan_ledger` против TS на одинаковых наборах данных, круг
`snapshot → дамп → восстановление` с займами, `erp_execute` case-ы и отказы. `loans`
добавить в список транспилируемых модулей `validate.mjs`; в `validate.mjs` добавить
упражнения `loan.set`/`loan.draw`/`loan.repay`, таблицу `erp_loans` в protections
(счётчик 28 → 29).

Финал: `npm test`, `npm run build`, браузер на ширине телефона в демо-режиме (пустые
`VITE_SUPABASE_*`).

## Критерии готовности

- Остатки займа сходятся с кассой: `owed = max(0, principal − repaid)`,
  `available = max(0, principal − drawn)`.
- «Majburiyatlar» и «Kreditor qarzdorlik» включают Σ `owed` по займам.
- Заёмные проводки не меняют `cashIn`/`cashOut` отчёта и аналитику кассы; баланс счетов
  их учитывает.
- Компания без займов даёт ровно прежние числа (регрессия).
- Облачная копия содержит `loans` и восстанавливается без потерь.

## Вне рамок этого под-проекта

Проценты по займам (учитывается только principal); договоры и документы займа;
напоминания о возврате (появится в E); валюта кроме UZS.

## Риски

1. **Расхождение TS и SQL** — паритет держится PGlite-зондом.
2. **Перекладка остатков задним числом** при правке суммы — осознанно, журнал амалов
   показывает.
3. **Миграция живой базы** — только после облачной копии, прогона зонда и отдельного
   разрешения.
