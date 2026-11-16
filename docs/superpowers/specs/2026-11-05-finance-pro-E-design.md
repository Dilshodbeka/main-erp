# Финансы PRO — под-проект E: «Direktor pulti» (пульт директора)

**Дата:** 2026-11-05
**Статус:** утверждён владельцем в порядке A → C → D → B → E («след этап го, по очереди все без остановки»)
**Владелец решений:** собственник бизнеса (Aliya ERP)
**Реализация:** локальная, по TDD; миграций живой базы E не требует — в общий пакет разрешений входит только публикация dist.

## Место в программе «Финансы PRO»

| Код | Под-проект | Состояние |
|---|---|---|
| A | Фиксированный оклад + авансы + помесячный баланс | готово, задеплоено |
| C | Расходы месяца (коммуналка, кухня/столовая, уличные/аутсорс-услуги) | готово локально; миграция и публикация — в общем пакете разрешений |
| D | Займы и инвестиции | готово локально; миграция и публикация — в общем пакете разрешений |
| B | Работник как клиент услуг и материалов, с погашением из зарплаты | готово локально; миграция и публикация — в общем пакете разрешений |
| **E** | **Пульт директора: где лежат деньги, что должно прийти, кому должны, будущие приходы и расходы** | этот документ |

## Решения, зафиксированные владельцем (по образцу A–D, без новых вопросов)

1. **Консоль только читает.** E не добавляет ни коллекций, ни команд, ни SQL:
   все числа выводятся из существующего состояния уже готовыми движками
   (`cashBalance`, `customerLedger`, `salaryLedger`/`payrollDebt`, `supplierDebt`,
   `expenseLedger`, `loanLedger`). Версия `State` не меняется, `schema.sql`,
   `erp_snapshot()`, `erp_execute()` и бэкап не затрагиваются — миграция живой базы
   для E не нужна.
2. **Четыре вопроса владельца — четыре блока.** Экран отвечает ровно на вопросы из
   описания программы: «Qayerda pul bor» (наличные, банк, итого), «Nima kelishi kerak»
   (долги клиентов и магазинов + сколько ещё можно взять по займам), «Kimga qarzdormiz»
   (зарплата, поставщики, расходы месяца, займы), «Kelgusi oylar» (план зарплат и
   расходов на 3 месяца вперёд, включая текущий).
3. **«Kelgusi oylar» переиспользует движки, а не пересчитывает.** Плановое обязательство
   месяца `m` для работника — последний месяц `salaryLedger(state, employeeId,
   m + '-01T00:00:00.000Z')` (поле `obliged`); для расхода — последний месяц
   `expenseLedger(state, planId, …)` (`obliged`). Так консоль никогда не разойдётся
   с панелями A и C, включая смену версии плана и деактивацию работника.
4. **Напоминания — блок «E’tibor talab qiladi».** Сюда достраиваются отложенные из
   C/D/B напоминания: расход с неоплаченным текущим месяцем (сортировка по `dueDay`,
   пометка «muddat o‘tgan», если день прошёл), заём с `owed > 0`, работник-клиент
   с долгом по `customerLedger` (связь `customer.employeeId`). Каждая строка — кнопка,
   ведущая в нужную модалку: `expensePay`, `loanRepay`, `customerCard`.
5. **Долг работника виден самому работнику.** В личном отчёте работника
   (`FinanceStatements`, вкладка зарплаты) — плашка-напоминание, если долг его
   клиентской карты больше нуля: «Sizning qarzingiz — {summa}. To‘lov ish haqidan
   ushlab qolinadi.» (закрывает отложенное из B). Только информация: погашает владелец
   командой «Ish haqidan ushlash».
6. **Только владелец.** Панель `pult` — admin-only через общий гейт секций; работник
   видит только свою плашку из решения 5.
7. **Виртуальное сальдо не выводится.** Консоль показывает фактические остатки счетов
   и выведенные долги; никакого «приход − расход = прибыль» — это уже «Moliyaviy
   natija» (`#/analytics/moliyaviy`). Приход/расход будущих месяцев показывается как
   план (`rejasi`), а не как деньги.

## Цель

Владелец одним взглядом видит: сколько денег лежит на счетах, сколько должно прийти
(клиенты, магазины, доступный остаток займов), кому должен он (зарплата, поставщики,
расходы месяца, займы), какие обязательства наступают в ближайшие месяцы и что требует
внимания прямо сейчас (просроченный день платежа, заём к возврату, долг работника).
Никакого ввода на этом экране нет — из любого числа ведёт кнопка в то место, где
делается действие.

## Архитектура

Расчёт — чистая функция над существующим состоянием. Новый модуль `src/console.ts`
импортирует `salaryLedger` (src/salary.ts), `expenseLedger`/`expensesDebt`
(src/expenses.ts), `loanLedger`/`loansDebt`/`loansAvailable` (src/loans.ts),
`customerLedger` (src/receivables.ts), `supplierDebt`/`cashBalance` (src/domain.ts).
Циклов нет: console.ts стоит «над» движками, движки его не импортируют.

## Модель данных

Изменений нет. `State` остаётся версии 4, коллекции те же. E не трогает
`src/types.ts`, `src/migrations.ts`, `src/sync.ts`, `src/seed.ts`.

## Расчёт: `src/console.ts`

```ts
export interface ConsoleReport {
  balances: { cash: number; bank: number; total: number };
  receivable: { customers: number; shops: number; loansAvailable: number };
  payable: { payroll: number; suppliers: number; expenses: number; loans: number; total: number };
  future: FutureMonth[];      // 3 месяца: текущий и два следующих
  attention: AttentionItem[];
}

export interface FutureMonth { month: string; salary: number; expenses: number; total: number }

export type AttentionKind = 'expense-due' | 'loan-owed' | 'worker-debt';

export interface AttentionItem {
  kind: AttentionKind;
  id: string;          // planId / loanId / customerId — для кнопки-перехода
  title: string;
  amount: number;
  hint: string;        // «…-kungacha to‘lash» / «Zaym qaytarilishi kerak» / «Xodimning material va xizmat qarzi»
  dueDay?: number;     // только expense-due
  passed?: boolean;    // только expense-due: день месяца уже прошёл
}

export function directorConsole(state: State, asOf?: string): ConsoleReport
export function workerCustomerDebt(state: State, employeeId: string): number
```

Правила:

1. **Балансы.** `cash = cashBalance(state, 'cash')`, `bank = cashBalance(state, 'bank')`,
   `total = cash + bank`. Округление — существующий `round()` (2 знака), как в
   `src/salary.ts`.
2. **К получению.** `customers = Σ customerLedger(state, c.id).debt` по клиентам
   `c.kind !== 'shop'`; `shops = Σ …` по `c.kind === 'shop'`; вместе они дают ровно
   метрику дашборда «Mijozlar qarzi». `loansAvailable = loansAvailable(state)` —
   сколько ещё можно получить по займам.
3. **Долги.** `payroll = Σ payrollDebt(state, id)` по всем работникам;
   `suppliers = Σ supplierDebt(state, id)` по всем поставщикам;
   `expenses = expensesDebt(state)`; `loans = loansDebt(state)`;
   `total = payroll + suppliers + expenses + loans` — ровно метрика кассы
   «Majburiyatlar».
4. **Будущие месяцы.** Месяцы `m` от текущего (`asOf ?? new Date().toISOString()`,
   срез 7 символов) плюс два следующих — всего 3. Для месяца `m`:
   `salary = Σ по работникам (salaryLedger(state, id, m + '-01T00:00:00.000Z')
   .months.at(-1)?.obliged ?? 0)`;
   `expenses = Σ по planId (expenseLedger(state, planId, …).months.at(-1)?.obliged ?? 0)`;
   `total = salary + expenses`.
5. **Внимание.** Сортируются: `expense-due` — сначала `passed`, затем по `dueDay`;
   `loan-owed` и `worker-debt` — по сумме убыванию.
   - `expense-due`: для каждого `planId` берётся `expenseLedger(state, planId)`;
     если у месяца `row.month === текущий месяц` выполняется `row.unpaid > 0.005` —
     строка `{ kind: 'expense-due', id: planId, title: ledger.title,
     amount: row.unpaid, dueDay: последняя версия плана.dueDay, passed: dueDay < день
     месяца из asOf, hint: dueDay + '-kungacha to‘lash' }`.
   - `loan-owed`: `loanLedger(state, id).owed > 0.005` → `{ kind: 'loan-owed',
     id, title, amount: owed, hint: kind === 'loan' ? 'Zaym qaytarilishi kerak' :
     'Investitsiya qaytarilishi kerak' }`.
   - `worker-debt`: клиенты с `c.employeeId !== null`, у которых
     `customerLedger(state, c.id).debt > 0.005` → `{ kind: 'worker-debt', id: c.id,
     title: имя работника из state.employees (fallback c.name), amount: debt,
     hint: 'Xodimning material va xizmat qarzi' }`.
6. **`workerCustomerDebt`** — долг клиентской карты работника: клиент
   `c.employeeId === employeeId`; карты нет → `0`; иначе `customerLedger(state,
   c.id).debt`. Используется плашкой решения 5 и тестами.

## Интерфейс

Новая панель в «Moliya va kassa» (`src/sections.ts`): `{ id: 'pult', title:
'Direktor pulti' }` — после `zaymlar`. Роут `#/cash/pult`.

`src/components/DirectorConsole.tsx`, props:
`{ state: State; onGo: (section: string, panel: string) => void; onPayExpense:
(planId: string) => void; onRepayLoan: (loanId: string) => void; onOpenCustomer:
(customerId: string) => void }`.

- Метрики (3): «Naqd pul», «Bank / karta», «Jami pul» (акцент). Подпись «Qayerda pul
  bor — faktik qoldiqlar».
- Блок «Nima kelishi kerak» (Section): строки-кнопки «Mijozlar qarzi» →
  `onGo('orders', 'mijozlar')`; «Do‘konlar qarzi» → `onGo('shops', 'hisob-kitob')`;
  «Zaymdan olish mumkin» → `onGo('cash', 'zaymlar')`; справа сумма `money()`.
- Блок «Kimga qarzdormiz» (Section): «Ish haqi» → `onGo('people', 'oylik')`;
  «Yetkazib beruvchilar» → `onGo('purchases', 'yetkazib-beruvchilar')`;
  «Oylik xarajatlar» → `onGo('cash', 'xarajatlar')`; «Zaymlar» → `onGo('cash',
  'zaymlar')`; внизу итог «Jami majburiyatlar».
- Section «Kelgusi oylar»: таблица `table-scroll cardable` с `data-label` (телефон —
  карточки): колонки «Oy» (месяц по-узбекски), «Ish haqi rejasi», «Xarajatlar rejasi»,
  «Jami» (справа). Подпись: план, а не деньги.
- Section «E’tibor talab qiladi»: список `attention`. Строка `expense-due` — кнопка
  «To‘lash» → `onPayExpense(id)`; `loan-owed` — «Qaytarish» → `onRepayLoan(id)`;
  `worker-debt` — «Karta» → `onOpenCustomer(id)`. Слева название, под ним hint
  (+ «muddat o‘tgan» красным, если `passed`), справа сумма. Пусто → `Empty` с текстом
  «E’tibor talab qiladigan narsa yo‘q».
- `App.tsx`: ветка `panel === 'pult'` внутри `current === 'cash'` — Title
  (eyebrow «MOLIYA / DIREKTOR PULTI», title «Pul qayerda, nima keladi va kimga
  qarzdormiz.», description «Bitta ekranda qoldiqlar, debitor va kreditor qarzlar,
  kelgusi oy rejalari va e’tibor ro‘yxati.») + `<DirectorConsole state={state}
  onGo={go} onPayExpense={id => show('expensePay', id)} onRepayLoan={id =>
  show('loanRepay', id)} onOpenCustomer={id => show('customerCard', id)} />`.
  Панель попадает в `sectionPanels` автоматически; на телефоне — в мобильный лист.
- `FinanceStatements.tsx`: для не-админа (`actor.role !== 'admin'`), если
  `workerCustomerDebt(state, actor.id) > 0`, вверху вкладки зарплаты — плашка:
  «Sizning qarzingiz — {money(workerCustomerDebt(state, actor.id))}. To‘lov ish
  haqidan ushlab qolinadi.» (класс `.attention`, существующая типографика).
- Текст интерфейса — узбекская латиница, валюта UZS. Словарь: `Direktor pulti`,
  `Naqd pul`, `Bank / karta`, `Jami pul`, `Nima kelishi kerak`, `Mijozlar qarzi`,
  `Do‘konlar qarzi`, `Zaymdan olish mumkin`, `Kimga qarzdormiz`, `Ish haqi`,
  `Yetkazib beruvchilar`, `Oylik xarajatlar`, `Zaymlar`, `Jami majburiyatlar`,
  `Kelgusi oylar`, `Ish haqi rejasi`, `Xarajatlar rejasi`, `E’tibor talab qiladi`,
  `To‘lash`, `Qaytarish`, `Karta`, `muddat o‘tgan`, `-kungacha to‘lash`,
  `E’tibor talab qiladigan narsa yo‘q`, `Sizning qarzingiz`, `To‘lov ish haqidan
  ushlab qolinadi`.

## Сервер и хранение

Изменений нет: `supabase/schema.sql`, `supabase/migrations/*`,
`supabase/functions/_shared/backup.ts`, `src/migrations.ts`, `src/sync.ts` не
затрагиваются. E не создаёт миграций — в общий пакет удалённых шагов (#180) входит
только публикация dist с новым экраном (после миграций C, D, B).

## Обработка ошибок

Ввода нет — ошибок пользователя нет. Движки уже отклоняют всё в своих модалках;
консоль только показывает их числа.

## Тесты

Порядок — сначала падающие тесты, потом домен/UI/SQL.

`src/console.test.ts` (RED до реализации):
1. балансы: касса, банк и сумма; о‘tkazma не двоит итог;
2. receivable: `customers` считает только `kind !== 'shop'`, `shops` — только
   `kind === 'shop'`, их сумма равна долгу по всем клиентам; `loansAvailable`
   передаёт движок D;
3. payable: зарплата + поставщики + расходы + займы, `total` — их сумма;
4. future: ровно 3 месяца от `asOf` (текущий + два), зарплата из плана работника
   (включая смену версии плана на втором месяце), расходы из плана, `total` — сумма;
5. future: работник без плана даёт 0; деактивированный работник в будущем месяце
   даёт 0;
6. attention `expense-due`: неоплаченный текущий месяц → строка с `dueDay` и
   `passed` при прошедшем дне; оплаченный месяц → строки нет;
7. attention `loan-owed`: `owed > 0` → строка; полностью возвращённый заём → нет;
8. attention `worker-debt`: клиент с `employeeId` и долгом → строка с именем
   работника; без долга или без `employeeId` → нет;
9. `workerCustomerDebt`: карты нет → 0; карта с долгом → долг;
10. пустое состояние: `emptyState()` → нули, `future` — 3 нулевых месяца,
    `attention` пуст.

`src/sections.test.ts`: `panelsFor('cash', true)` содержит `pult`;
`defaultPanel('cash', true)` остаётся `kassa`; `routeHash` для `pult` —
`#/cash/pult`.

`src/mobileCards.test.ts`: `'components/DirectorConsole.tsx'` добавлен в
`tableFiles` (таблица «Kelgusi oylar»: обёртка `table-scroll cardable`, все `td`
с `data-label`).

`src/salary-ui.test.tsx`: рендер `FinanceStatements` с работником и клиентской
картой с долгом содержит «Sizning qarzingiz»; без долга — не содержит.

Регрессия: весь набор (`npm test`), `npm run build`, PGlite-зонды без изменений
(прогон для чистоты). SQL-паритета нет — SQL не менялся.

## Критерии готовности

- Консоль сходится с существующими экранами: `balances.total` равен метрике
  дашборда «Kassa va hisoblarda»; `receivable.customers + receivable.shops` равны
  «Mijozlar qarzi» дашборда; `payable.total` равен «Majburiyatlar» кассы.
- Компания без данных даёт нули, три нулевых будущих месяца и пустой список
  внимания (регрессия).
- Ни одна коллекция, команда, снимок или миграция не изменены.
- На телефоне (≤700px) все таблицы — карточки без переполнения; экран доступен
  только владельцу, работник видит свою плашку долга.

## Вне рамок этого под-проекта

Автоплатёж и автоматическое закрытие месяца по расписанию; push/Telegram-уведомления
(Telegram для работников удалён владельцем — напоминания только внутри приложения);
прогноз прибыли и кэш-фло на дату; налоги; валюты кроме UZS; графики.

## Риски

1. **Расхождение консоли с панелями A/C/D/B** — исключается переиспользованием тех
   же движков; сходимость зафиксирована тестами и критериями готовности.
2. **Путаница «клиенты vs магазины»** в блоке «Nima kelishi kerak» — фиксируется
   разделением `kind !== 'shop'` / `kind === 'shop'`, сумма даёт метрику дашборда.
3. **Публикация dist раньше миграций C/D/B** — не влияет на E (E читает только
   существующие данные), но общий порядок пакета #180 сохраняется: сначала миграции
   живой базы, потом публикация.
