# Единый баланс клиента (аванс/долг) — дизайн

**Дата:** 2026-11-19
**Задача:** #366
**Статус:** реализовано и проверено локально (движок, экраны, SQL, миграция, зонды); выкат — по отдельному разрешению владельца
**Пакеты:** один — движок + UI + SQL-паритет; выкатывается целиком (сначала SQL по разрешению, потом деплой)

> Ссылки на строки в §1 описывают код **до** правки; после T1 содержимое `src/receivables.ts` изменилось целиком.

## 1. Задача

В карточке клиента одновременно показывались два больших числа: «Qarz 19 800 000» и
«Avans 9 200 000» для одного и того же клиента. Причина найдена в коде, а не в данных:

- `customerLedger` ([src/receivables.ts:18-42](../../../src/receivables.ts)) строит пул оплат клиента
  и FIFO разливает его **по отгрузкам**. Если после всех отгрузок что-то осталось — это «Avans».
  Долг и аванс в этом движке одновременно возникнуть не могут.
- `orderLedger` ([src/receivables.ts:48-72](../../../src/receivables.ts)) тот же остаток аванса
  **ещё раз** раздаёт по заказам и уменьшает их долг.
- Плитка «Qarz» в карточке берётся не из первого движка, а из аналитики
  ([src/history.ts:53](../../../src/history.ts) → `orderProfit.debt` = `price − orderPaid`,
  [src/history.ts:28](../../../src/history.ts)), то есть из числа, в котором аванс **уже учтён**.
  Плитка «Avans» берётся из `customerLedger` — из числа **до** распределения.

Итог: одни и те же деньги показывались дважды — один раз они уже уменьшили долг, второй раз их
видно как аванс. Плюс основание у двух плиток разное: долг считался по договорам (включая
черновики), аванс — по отгрузкам.

Владелец хочет одно понятное число: сколько клиент должен или сколько за ним prepaid.

## 2. Решения владельца

| Вопрос | Решение |
|---|---|
| Основание единого баланса | Согласованный договор: сумма заказов, кроме `draft` и `cancelled` |
| Ручной переключатель «Avans sifatida qoldirish» | Не нужен. Аванс считается только автоматически |
| Привязка оплаты к заказу | Не выбирать: оплата всегда гасит самый старый открытый долг |

Из третьего решения следует важное следствие для магазина: отгрузка со склада без заказа
(`shipment.createStock`, `orderId === null`) тоже обязана создавать долг, иначе магазин сможет
выдать товар, и система не покажет никакого долга. Поэтому обязательство клиента — это
согласованный заказ **плюс** отгрузка со склада без заказа.

## 3. Правило расчёта

Единственный источник правды — файл `src/receivables.ts`. Ничего нового не хранится: баланс
выводится из заказов, отгрузок и кассы при каждом обращении, поэтому миграция данных не нужна.

```
pool(c)        = Σ оплат клиента (cash source='sale', приход минус расход)
               + Σ удержаний из зарплаты клиента (net)        , floor 0
obligations(c) = [ заказ  o | o.customerId = c, o.kind ≠ 'series',
                                 o.status ∉ {draft, cancelled} → total = o.price ]
               ∪ [ отгрузка s | s.customerId = c, s.orderId = null,
                                 s.status ≠ 'cancelled'        → total = shipmentTotals(s).revenue ]
               отсортированы по (createdAt, id)
```

Цены берутся как `order.price`: надценка/скидка уже внутри (`src/domain.ts:216-217`,
`src/order-editor.ts:149`), отдельно `markup` не прибавляется нигде.

Оплаты разливаются FIFO по этому списку: `paidᵢ = min(totalᵢ, остаток пула)`.

```
contract = Σ totalᵢ
debt     = Σ (totalᵢ − paidᵢ)        -- 0, если пула хватило на всё
advance  = остаток пула после списка -- 0, если есть долг
```

`debt` и `advance` по построению не могут быть больше нуля одновременно — это и есть то, что
просил владелец. Интерфейс никогда не показывает оба числа: второе всегда «—».

Роль отгрузок меняется: отгрузка **заказа** больше нигде не участвует в деньгах (её цена уже
лежит внутри `order.price`). Отгрузки остаются только как факт выдачи товара — для остатков,
себестоимости и справочной строки «отгружено / не отгружено» в карточке.

## 4. API движка

Файл `src/receivables.ts` сохраняет имя и обходится без алиасов старого API — все потребители
переводятся на новый за один заход.

```ts
export interface ObligationRow {
  id: string; kind: 'order' | 'stock'; orderId: string | null;
  label: string; createdAt: string;
  total: number; paid: number; outstanding: number;
}

export interface CustomerBalance {
  customerId: string;
  contract: number; paid: number; debt: number; advance: number;
  obligations: ObligationRow[];          // та же разбивка, что считает долг
}

export function isAgreed(order: Order): boolean;
export function customerBalance(state: State, customerId: string): CustomerBalance;
export function orderBalance(state: State, orderId: string): ObligationRow | null;
```

Реализация не носит `shipmentId` и справочную сумму `shipped`: у строки-обязательства уже есть
`id` и `orderId`, а объём отгруженного товара считается там, где он нужен (остатки склада), и в
баланс не входит. `isAgreed` вынесен наружу, потому что то же условие повторяется в `history.ts`,
`analytics.ts` и SQL.

`orderBalance` возвращает `null`, если заказ не входит в обязательства (черновик, отменённый,
серийный, без клиента) — потребители трактуют это как «долга по этому заказу нет».

Заменяются `customerLedger` и `orderLedger`; поля `shipped`/`shipments` старого вида исчезают.

## 5. Что меняется в коде

| Место | Сейчас | Станет |
|---|---|---|
| [src/receivables.ts:18-72](../../../src/receivables.ts) | два движка на отгрузках + перераспределение аванса | один движок на обязательствах, `customerBalance` + `orderBalance` |
| [src/history.ts:28](../../../src/history.ts) `orderProfit.debt` | `price − orderPaid`, черновики тоже | `orderBalance(order.id)?.outstanding ?? 0` |
| [src/history.ts:44-58](../../../src/history.ts) `customerAnalytics` | долг = Σ `orderProfit.debt` (включая черновики) | `paid`/`debt` из `customerBalance`, `revenue` — Σ цен согласованных заказов |
| [src/domain.ts:606-608](../../../src/domain.ts) `orderPaid` | `orderLedger().paid` | `orderBalance()?.paid ?? 0` |
| [src/domain.ts:670-672](../../../src/domain.ts) `customerAdvance` | остаток пула после отгрузок | `customerBalance().advance` (остаток после обязательств) |
| [src/domain.ts:1669](../../../src/domain.ts) `salary.deduct` | `amount ≤ debt + 0.004` | та же проверка, `debt` из нового движка |
| [src/domain.ts:1778](../../../src/domain.ts) `shipment.create` | блок, если `orderPaid < price` без галочки | без изменения формы: `orderBalance(order.id).outstanding > 0` требует `allowDebt` |
| [src/domain.ts:1811](../../../src/domain.ts) `shipment.createStock` | `total ≤ advance` | без изменения формы: `advance` = свободный остаток пула |
| [src/domain.ts:1115](../../../src/domain.ts) `order.create` | `advance ≤ order.price` | без изменений (основание то же: `price` включает markup) |
| [src/analytics.ts:181-196](../../../src/analytics.ts) `customerDetail` | `stats` + `ledger` из разных расчётов | один `balance`, плитки карточки берут из него |
| [src/components/CustomerCard.tsx:36-44](../../../src/components/CustomerCard.tsx) | 8 плиток, Qarz и Avans рядом | «Qarz» и «Avans» показывают «—» когда нулевые; добавляется плитка «Shartnoma» |
| [src/components/CustomerLedger.tsx:20-31](../../../src/components/CustomerLedger.tsx) | список отгрузок с их деньгами | список обязательств (`obligations`), «Shartnoma» вместо «Yuborilgan» |
| [src/documents.ts:115-134](../../../src/documents.ts) `orderInvoice` | `paid`/`debt` из `orderLedger` | из `orderBalance`; `subtotal`/`markup` не трогаем |
| [src/documents.ts:137-168](../../../src/documents.ts) `shipmentInvoice` | `paid`/`outstanding` конкретной отгрузки | `orderBalance(orderId)` для отгрузки заказа; для складской продажи — её строка обязательства |
| [src/console.ts:45-118](../../../src/console.ts), [src/quicksearch.ts:42-52](../../../src/quicksearch.ts), [src/reports.ts:91-133](../../../src/reports.ts), [src/statements.ts:67-77](../../../src/statements.ts), [src/health.tsx:68](../../../src/health.tsx), [src/App.tsx:297](../../../src/App.tsx), [src/App.tsx:549-550](../../../src/App.tsx), [src/components/WidgetBoard.tsx:34](../../../src/components/WidgetBoard.tsx) | `.debt` / `.advance` / `.shipments` старого вида | те же смыслы из `customerBalance`; `.shipments` → `.obligations` |
| [src/components/FinanceStatements.tsx:117-153](../../../src/components/FinanceStatements.tsx) | «Avanslar» как отдельный пул | остаётся, но теперь это genuinely предоплата; подпись «To‘lovdan ortiqcha qoldiq» сохраняется |

Тексты интерфейса (узбекская латиница):

- пояснение в редакторе отгрузки [src/components/ShipmentEditor.tsx:75](../../../src/components/ShipmentEditor.tsx)
  переформулируется: `Bu yerda pul olinmaydi. Qarz to‘lov bilan yopiladi: avval eng eski qarz,
  keyin yangi. To‘langan pul shartnoma summasidan ortiqcha bo‘lsa, avans bo‘lib qoladi.`
- в карточке клиента и панели магазина ноль показывается как `—`, а не как `0`, чтобы две
  взаимно исключающие величины нельзя было перепутать. Правило действует для карточки, строки заказа
  в ней и панели магазина; таблица отчёта за период (`src/components/FinanceStatements.tsx`) остаётся
  отчётом — там `0 so‘m` намеренно печатается как число, потому что нулевой период это факт, а не
  второе прочтение баланса.

Логика выбора не меняется: галочка «Qoplanmagan qarz bilan yuborishga ruxsat beraman» остаётся
как есть — она про разрешение отгрузить неоплаченное, а не про расчёт баланса.

## 6. SQL-паритет

`supabase/schema.sql` обязано давать те же числа, что фронтенд, иначе серверные guard-ы
расходятся с тем, что видит владелец:

| Место | Что сделано |
|---|---|
| [supabase/schema.sql:821-828](../../../supabase/schema.sql) `erp_customer_paid` | **новая** функция: пул клиента = касса `source='sale'` (приход минус расход) плюс удержания из зарплаты, с отсечкой снизу нулём — ровно как `pool` в движке |
| [supabase/schema.sql:830-844](../../../supabase/schema.sql) `erp_customer_obligations` | **новая** функция: один список обязательств (согласованные заказы + складские отгрузки без заказа) с `kind`, `total`, `created_at`; сортировка `(created_at, id)` |
| [supabase/schema.sql:846-849](../../../supabase/schema.sql) `erp_customer_debt` | переписана: `Σ obligations.total − erp_customer_paid`, а не сумма отгрузок |
| [supabase/schema.sql:852-855](../../../supabase/schema.sql) `erp_customer_advance` | переписана: пул минус **обязательства**, то есть остаток сверху, а не «остаток после отгрузок» |
| [supabase/schema.sql:858-875](../../../supabase/schema.sql) `erp_order_paid` | переписана: window-FIFO по `erp_customer_obligations`; двухступенчатого расчёта «сначала отгрузки, потом аванс» больше нет |
| [supabase/schema.sql:3334](../../../supabase/schema.sql) guard `salary.deduct` | своя shipment-сумма заменена на `erp_customer_debt` (+ допуск `0.004` как во фронтенде) |
| [supabase/schema.sql:3498](../../../supabase/schema.sql) guard `shipment.create` | остался `erp_order_paid < price`, но `price` включает markup и не зависит от объёма отгрузок |
| [supabase/schema.sql:3569-3570](../../../supabase/schema.sql) guard `shipment.createStock` | свободный аванс считается по тому же списку обязательств **без самой проверяемой отгрузки** (`WHERE o.id <> v_entity`) — иначе новая складская продажа попадала бы в долг сама себе и пропускала себя же |
| [supabase/schema.sql:3621](../../../supabase/schema.sql) список `REVOKE` | к старым функциям добавлены `erp_customer_paid` и `erp_customer_obligations`: обе SECURITY DEFINER и наружу не видны |

Миграция `supabase/migrations/20261124_customer_balance.sql`: `CREATE OR REPLACE` пяти функций
и `erp_execute` целиком (так сделано во всех предыдущих миграциях, например
`20261123_draft_orders.sql`), тела — слово в слово как в `schema.sql`; в конце тот же
`REVOKE`/`GRANT`-список. Номер даты — 20261124, а не 20261119, потому что 19-е слоты уже заняты
применёнными в облаке `20261119_warehouses.sql` и `20261120_supply.sql`; порядок применения
задаётся именем файла. Миграция идемпотентна, данных не трогает, и собирается скриптом
`.validation-pglite-20261029/generate-customer-balance-migration.mjs` из `schema.sql` — руками
её не правят.

Паритет проверяется контрактом на текст SQL (домашний приём: `src/warehouse-contract.test.ts`,
`src/supply-contract.test.ts`) — новый `src/balance-contract.test.ts` требует, чтобы тела
функций ссылались на `status NOT IN ('draft', 'cancelled')`, `order_id IS NULL` для складских
обязательств, `price` без прибавления `markup`, условие `o.id <> v_entity` в складском guard-е,
новый `REVOKE`-список и чтобы файл миграции совпадал с тем, что выдаёт генератор.

## 7. Тесты

RED писался до кода. Движок закрыт новым набором из 10 тестов в `src/receivables.test.ts`
(старый блок 47-169 заменён целиком) — по одному на каждое правило §3, имя теста = ссылка в файле:

| Правило | Тест |
|---|---|
| долг = Σ обязательств − пул, аванса при нехватке нет | `charges the agreed contract and shows only debt while money is short` |
| `debt` и `advance` не бывают больше нуля одновременно | `never reports debt and advance together` |
| черновик не создаёт долга и не входит в договор | `keeps a draft order out of the contract and out of the debt` |
| отменённый и серийный заказ вне обязательств | `ignores cancelled orders and series production` |
| складская отгрузка без заказа — обязательство | `treats a stock shipment without an order as an obligation` |
| оплата гасит самый старый долг | `applies a payment to the oldest obligation first` |
| отгрузка заказа больше не участвует в деньгах | `counts a shipment of an order once, through the order contract` |
| сторнированная оплата уходит из пула | `nets a reversed payment out of the pool` |
| удержания из зарплаты в пуле, пул не ниже нуля | `adds worker deductions to the pool and floors the pool at zero` |
| черновик даёт нулевой `orderBalance`, UI не может выдумать долг | `exposes per-order zero for a draft so the UI cannot invent debt` |

Экраны — `src/customer-balance-ui.test.tsx` (7 тестов, статический рендер настоящих компонентов без
Supabase): в реестре договор вместо отгруженных товаров (`shows the agreed contract instead of
shipped goods`), строка обязательства несёт свою сумму долга (`lists obligations with their own
outstanding amount` — `Shartnoma 30 000 000` и `20 800 000` из истории владельца), ноль аванса рядом
с живым долгом не печатается (`never prints a zero advance next to a live debt` — `<small>Avans</small><b>—</b>`),
закрытый баланс показывает `—` вместо `0 so‘m` (`prints a dash where the balance is settled`), карточка
клиента и панель называют одни и те же четыре числа (`keeps the card and the panel on the same four
numbers`), реестр объясняет FIFO словами клиента (`explains that a payment closes the oldest debt
first`), и та же черта стоит в строке заказа внутри карточки (`prints dashes in the order row of an
agreed-free draft` — черновик без согласования даёт `To‘langan —` и `Qarz —`, а не `0 so‘m`).

SQL-паритет — контракт на текст `src/balance-contract.test.ts` (9 тестов, см. §6): он привязывает
долг к согласованным заказам, берёт складские продажи без заказа, запрещает прибавлять `markup` к
`price`, держит аванс остатком сверху, требует FIFO по договору, проверяет `o.id <> v_entity` в
складском guard-е, потолок `salary.deduct` и новый `REVOKE`-список; последний тест сравнивает файл
миграции с тем, что выдаёт генератор, — правка миграции руками падает здесь.

Живой SQL проверен зондом `.validation-pglite-20261029/customer-balance-probe.mjs` (изолированный
PGlite, 8 проверок): черновик не заряжается, согласованный договор даёт ровно одну долг-строку без
аванса, переплата становится авансом, оплата закрывает самый старый долг, пара `(debt, advance)`
ни на одной живой комбинации не ненулевая одновременно, складская продажа магазину создаёт долг и
закрывается авансом, удержание не превышает долг, и набор обязательств = согласованные заказы +
складские отгрузки без заказа. Числа истории владельца в прогоне:
`{"debt":"20800000.00","advance":"0.00","paid":"9200000.00"}`.

Легаси-тесты, закреплявшие старую семантику, переведены на новый движок, а не ослаблены. Их было
ровно два файла (проверено по `git diff`): `src/domain.test.ts` — восемь участков, где `customerLedger`
и `orderPaid` держали «остаток после отгрузок» (аванс 100/1050 стал 50, потому что переплата теперь
считается сверху договора; `shipped: 2000, debt: 2000` стал `contract: 2300, debt: 2300`; фикстура
проверки `advance ≤ price` дополнена выдачей материала и `order.launch`, иначе черновик не создаёт
долга вообще); и `src/analytics.test.ts` — одна строка `detail.ledger` → `detail.balance`. Остальные
потребители (`console.test.ts`, `sales.test.ts`, `documents.test.ts`, `history.test.ts`,
`statement-ui.test.tsx`) правки не потребовали: их числа совпали с новым движком, что и показывает
зелёный полный прогон.

Главный доменный PGlite-зонд `.validation-pglite-20261029/validate.mjs` починен под уже вывезенные
пакеты (см. §9) и теперь доходит до конца: 452 PASS, 0 падений, и все 59 вариантов фронтенд-команд
исполнены в SQL (здесь или в трёх соседних зондах `access-permissions-probe.mjs`,
`warehouses-probe.mjs`, `workshops-probe.mjs` — новый незакрытый командой тип падает на этом гейте).

Итоговые гейты пакета (свежий прогон, все exit 0): `npx tsc -b`; `npx vitest run` — 93 файла,
1011 тестов; `npm run build`; плюс демо-прогон карточки клиента и панели «Kim, qancha va qachon» в
браузере (§8 в числах, §7 в тестовых именах).

## 8. Что увидит владелец после выката

- Клиент с заказом 30 000 000 и внесёнными 9 200 000: **Qarz 20 800 000, Avans —**. Раньше:
  «Qarz 19 800 000» и «Avans 9 200 000» рядом.
- Число «Qarz» по согласованным заказам остаётся тем же — меняется только то, что фиктивный
  аванс исчезает.
- У клиентов с черновиками долг уменьшается на сумму черновиков; запуск черновика в
  производство сразу добавляет его сумму в долг.
- «To‘langan» по-прежнему показывает все внесённые деньги, включая предоплату.
- Магазин: выданная со склада вещь без оплаты создаёт долг магазина, как и раньше.

## 9. Риски и как они закрыты

| Риск | Закрытие |
|---|---|
| Расхождение фронтенда и сервера в guard-ах (отгрузку пустит или не пустит) | один список обязательств в SQL и в TS + контрактный тест на текст SQL |
| Скрытое изменение суммы долга у живых клиентов | черновики — единственная категория, где долг уменьшается; это отдельный тест `keeps a draft order out of the contract and out of the debt` и явный пункт 8 |
| Отмена задним числом оплаченных заказов | заказ уходит из обязательств, оплата остаётся в пуле и становится авансом; тест `ignores cancelled orders and series production` |
| Выката без SQL | код и SQL расходятся до применения миграции; поэтому выкат — строго порядок: SQL (разрешение владельца) → деплой |
| Двойной markup в `price` (гипотеза из разведки) | **не подтвердилась**: `supabase/schema.sql:2491-2518` хранит `price = v_amount + v_markup`, а guard на L2527 сравнивает аванс с этим же значением; `src/domain.ts:1115` сравнивает с `order.price`. Основания совпадают, правки не требуется |
| Регрессия спряталась в легаси-зонде, который перестал доходить до конца | `validate.mjs` починен по факту, а не числами: каждая правка проверяет уже вывезенное правило — черновик без материалов и маршрута ловится на `order.launch` (23514), а не на создании (#377); складская предоплата в 700 у составного черновика лежит авансом клиента и становится долгом только после запуска (#366); работник не видит ни план оклада, ни выплатную строку кассы (`src/salary.ts:38-45`, `supabase/schema.sql:1873-1891` — #346 и #358) |
| Гейт «все команды покрыты в SQL» можно пройти молчанием | покрытие посчитано как объединение `validate.mjs` и трёх соседних зондов; единственная реально непокрытая команда (`customer.claim`) закрыта настоящим сценарием в `access-permissions-probe.mjs`, а не исключением из списка |
| Два исторических зонда (`combined-migrations-probe.mjs`, `validate-composite-migration.mjs`) падают и после этой работы | они прогоняют замороженную миграцию `20261102_composite_order_positions.sql` на реконструированной «до-составной» базе, поэтому проверяют исторический путь апгрейда, а не правила #366; сейчас обе падают на применении архивного тела к сегодняшней схеме (`permission denied for function erp_composite_order_position_stats`, exit 12 и exit 1). Это не гейты пакета и не след по #366 — запись здесь, чтобы следующий исполнитель не «починил» их ценой живой схемы |

## 10. Вне объёма

- Лимит кредита клиента (долг без потолка) — не вводился и не вводится.
- Ручная привязка оплаты к заказу и ручной режим «Avans sifatida qoldirish» — владелец
  отказался.
- Разбиение долга по отгрузкам внутри одного заказа — больше не нужно; при необходимости
  считается из `obligations` как справочная строка.
- Чат по заказам (#379) и сборка «Yig'ish» (#374) — отдельные задачи.
