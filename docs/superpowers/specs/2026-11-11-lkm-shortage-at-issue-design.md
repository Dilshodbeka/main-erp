# Нехватка ЛКМ при выдаче: точный дефицит вместо общей ошибки

**Дата:** 2026-11-11
**Статус:** архитектура одобрена владельцем в диалоге; документ ожидает ревью владельца
**Реализация:** не начата; живые SQL-изменения и deploy не входят в этот документ
**Часть дорожной карты:** Часть 4, под-проект «граничные случаи» (1-й из 3)

## 1. Цель и границы

Сейчас нехватка материала блокирует работу правильно, но объясняет её одной общей фразой: `order.launch`
проверяет `stock − reserved` ([src/domain.ts:1045](../../../src/domain.ts)), `order.issue` — фактический
остаток ([src/domain.ts:1067-1068](../../../src/domain.ts)), а пользователь получает
«Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.» ([src/i18n.ts:177](../../../src/i18n.ts)) — без имени
материала, без цифр и без указания, где смотреть. Для ЛКМ (краски, лаки, грунты, отвердители, растворители
из групп `06.*`, [src/warehouse.ts](../../../src/warehouse.ts)) это означает потерю времени: мастер не понимает,
какую именно банку дозаказать.

Цель: **та же жёсткая блокировка, но с точным дефицитом** — имя материала, «kerak / omborda / band /
yetishmaydi» — в трёх местах: редактор заказа (до сохранения), баннер производственной доски и серии,
текст ошибки.

Первая версия включает:

- новый чистый модуль `src/shortage.ts` — единственный расчёт дефицита, общий для домена и интерфейса;
- точный дефицит в редакторе заказа (`OrderEditor`) на строке материала и списком под заголовком «Materiallar»;
- список дефицита внутри производственного баннера и в карточке серии — рядом с существующей фразой
  «Materiallar band qilingan, lekin hali berilmagan» ([src/App.tsx:574](../../../src/App.tsx),
  [src/components/SeriesList.tsx:56](../../../src/components/SeriesList.tsx));
- переходы «Omborga» и «Xaridga» рядом с дефицитом;
- разделение общей i18n-строки на три конкретных текста;
- регрессионные тесты на неизменность доменных сообщений и контрактный тест на паритет с `supabase/schema.sql`.

Первая версия **не** включает:

- частичную выдачу и довыдачу остатка (потребовала бы `issuedQty` вместо `issued: boolean` + миграцию);
- разрешение отрицательного остатка (противоречит `Stock cannot be negative`, [src/domain.ts:1271](../../../src/domain.ts));
- автоматический черновик закупки `purchase.create` (требует выбора поставщика,
  [src/domain.ts:1238](../../../src/domain.ts), и создаёт записи с производственного экрана);
- предварительную фильтрацию поиска на складе по материалу;
- изменение норм, ставок и формулировок самих доменных исключений.

## 2. Согласованные правила (решения владельца)

1. **Жёсткая блокировка сохраняется.** При нехватке выдача невозможна; заказ ждёт пополнения склада.
2. **Точный дефицит показывается везде:** редактор заказа, баннер доски и серии, текст ошибки.
3. **Рядом с дефицитом — только информация и переходы** («Omborga», «Xaridga»); приложение ничего не создаёт
   автоматически.
4. **Блокируется и запуск, и выдача** — как сейчас; логика `order.launch` не смягчается.
5. **Сервер остаётся арбитром.** Кнопка «Sexga berish» не блокируется клиентской формулой: расчёт на клиенте
   объясняет ситуацию, решение принимает `applyCommand` / `erp_execute`. Это сохраняет корректность при гонке
   двух мастеров и не требует миграции.

## 3. Модель расчёта (`src/shortage.ts`)

Новый модуль, только чистые функции: ничего не знает о React, не изменяет `State`.

```ts
export type ShortageRow = {
  itemId: string;
  name: string;      // item.name
  unit: string;      // item.unit — отображается через unitText() из src/i18n.ts
  needed: number;    // сумма qty по НЕвыданным строкам материала (агрегат по itemId)
  stock: number;     // stockQty(state, itemId)        — src/domain.ts:470
  reserved: number;  // reservedQty без этого заказа   — src/domain.ts:475
  available: number; // stock - reservedExcept
  short: number;     // needed - available; в список попадают только строки, где он положительный
};

export function orderShortage(state: State, order: Order): ShortageRow[];
export function draftShortage(state: State, positions: DraftPosition[], excludeOrderId?: string | null): ShortageRow[];
```

Правила расчёта:

1. `reservedExcept(state, itemId, orderId)` = сумма `qty` невыданных строк всех заказов со статусом
   `production`, кроме `orderId`. Собственный заказ никогда не занимает материал против самого себя, поэтому
   цифра совпадает с тем, что мастер видит на складе. `reservedQty` в домене остаётся без изменений.
2. `short` считается через `exceeds()` с тем же epsilon в 8 ULP ([src/domain.ts:41](../../../src/domain.ts),
   который становится `export`), поэтому плавающий остаток вида `0.0000004 кг` дефицитом не считается и
   `short` равен ровно `0`.
3. Строки с `issued: true` в `needed` не входят.
4. Клиентские материалы (`item.customerId !== null`) **не** пропускаются: домен проверяет склад и для них
   ([src/domain.ts:1044](../../../src/domain.ts)).
5. Агрегация по `itemId` внутри заказа: один и тот же ЛКМ в двух позициях составного заказа даёт одну строку
   с суммарным `needed`. Это строже построчной проверки домена, поэтому дефицит в интерфейсе может оказаться
   больше формального построчного — намеренно: список показывает экономическую нехватку, а не прячет её.
6. Результат содержит **только дефицитные строки** (`exceeds(needed, available)` истинно); строки без
   дефицита в список не попадают вовсе, а не помечаются нулём. Внутри селектора округления нет —
   `needed`/`stock`/`reserved`/`short` отдаются «как есть», форматирование делает `num()` на рендере.
   Сортировка — по убыванию `short`, затем по имени (`localeCompare(..., 'uz')`).
7. Расчёт никогда не бросает исключение: позиция с `qty <= 0`, этап без операции, материал с пустым `itemId`
   пропускаются. Это обязательное требование — функция вызывается из рендера.
8. `draftShortage` считает `needed` так же, как `order.create` соберёт заказ: явные материалы позиции
   плюс `normMaterialLines(state, route, lineId)` ([src/domain.ts:306](../../../src/domain.ts)), слитые через
   `mergeNormMaterials` ([src/domain.ts:323](../../../src/domain.ts), который становится `export`). Поведение
   обеих функций не меняется — меняется только видимость.
   `PositionStage` адаптируется в форму, нужную `normMaterialLines` (`lineId`, `operationId`, `planned`).
   **Нормы домешиваются только черновику, который ещё не сохранён** (`excludeOrderId === null`):
   `order.create` ([src/domain.ts:924-925](../../../src/domain.ts), [938-940](../../../src/domain.ts)) запекает
   нормы в сохраняемые материалы, а `order.update`/`revisionLines`
   ([src/domain.ts:441-443](../../../src/domain.ts)) кладут в заказ ровно те строки, что прислал редактор, и
   нормы повторно не сливают. Значит для уже сохранённого заказа (`excludeOrderId` задан) материал позиции уже
   содержит норму, и второе сложение удвоило бы `needed` и разошлось бы с цифрами доски.
9. `DraftPosition` — структурный подтип `PositionDraft` (`id?`, `materials`, `route`): `shortage.ts` не
   импортирует слой редактора, а `PositionDraft` подходит под него без приведения типов.
   `excludeOrderId` — id редактируемого заказа: его собственная бронь не считается против самого себя,
   иначе при правке заказа в `production` дефицит удваивался бы (черновик уже содержит эти же строки).

## 4. Домен и тексты ошибок

1. **Строки исключений не меняются**: `'Insufficient available stock'`, `'Insufficient reserved stock'`,
   `'Insufficient stock'` ([src/domain.ts:1045](../../../src/domain.ts),
   [src/domain.ts:1067-1068](../../../src/domain.ts)). Благодаря этому зеркало в Postgres
   (`RAISE EXCEPTION 'Insufficient stock'`, `supabase/schema.sql:2912`; `'Insufficient stock for issue'`,
   `supabase/schema.sql:2272`) остаётся идентичным и **миграция не требуется**.
2. **Семантика проверки не меняется**: построчное сравнение в `order.launch` и `order.issue` остаётся
   построчным. Изменение на агрегат = изменение инварианта = миграция, вне рамок этого под-проекта.
3. `src/i18n.ts` — вместо одной строки `[/insufficient.*stock|below.*reserv|stock cannot/i, ...]`
   ([src/i18n.ts:177](../../../src/i18n.ts)) три записи, в таком порядке и **до** существующих
   `previous.*(route|stage)` и `already issued`:

```ts
[/insufficient available stock/i, 'Buyurtmani ishga tushirib bo‘lmaydi: bo‘sh material band qilinganlar hisobiga yetishmaydi. Ro‘yxatni «Ishlab chiqarish» bo‘limida ko‘ring.'],
[/insufficient reserved stock|insufficient stock for issue/i, 'Materiallarni berib bo‘lmaydi: omborda yetarli emas. Kerak va bor miqdor materiallar ro‘yxatida ko‘rsatilgan.'],
[/insufficient.*stock|below.*reserv|stock cannot/i, 'Bo‘sh material yetarli emas yoki qoldiq zaxiradan kam.'],
```

   Вторая запись покрывает обе выдачи материала: офлайн-текст `'Insufficient reserved stock'`
   ([src/domain.ts:1067](../../../src/domain.ts)) и его облачное зеркало `'Insufficient stock for issue'`
   (`supabase/schema.sql:2272`) — иначе в облачном режиме выдача получила бы общий текст. Голый
   `'Insufficient stock'` во вторую запись **не** входит: он принадлежит продаже из магазина
   (`shipment.create`, [src/domain.ts:1528](../../../src/domain.ts); `RAISE EXCEPTION 'Insufficient stock'`,
   `supabase/schema.sql:2912`), где списка материалов нет и ссылка на него вела бы в никуда, — он остаётся
   на общей подстраховке.

   Третья запись — исходная строка 177 без изменений, и она обязательна: у сервера есть сообщения, которых
   домен не бросает (`'Insufficient unreserved material stock'`, `supabase/schema.sql:2245`), и без
   подстраховки в облачном режиме пользователь увидел бы английский текст.

4. Тост об ошибке остаётся строкой из `errorText(e)` — структура в него не протаскивается. «Двух правд» нет,
   потому что текст указывает, где смотреть, а список над кнопкой считает тот же `orderShortage`.

## 5. Интерфейс

### 5.1 `src/components/ShortageNotice.tsx`

```ts
type Props = { rows: ShortageRow[]; onGo?: (section: string, panel?: string) => void };
```

- `rows.length === 0` → компонент рендерит `null` (никаких пустых рамок).
- Заголовок: `Materiallar yetishmaydi (N):`, где `N = rows.length`.
- Строка: `{name} · kerak {num(needed)} {unitText(unit)} · omborda {num(stock)} · band {num(reserved)} · yetishmaydi {num(short)}`.
- Два `GoButton` ([src/ui.tsx:53](../../../src/ui.tsx)): «Omborga» → `onGo('warehouse', 'tasniflagich')`,
  «Xaridga» → `onGo('purchases', 'xaridlar')` — реальные id разделов
  ([src/sections.ts:13-15](../../../src/sections.ts)).
- Числа через существующий `num()` ([src/ui.tsx](../../../src/ui.tsx)), единицы через `unitText()`.
- `GoButton` обязан рендерить `type="button"`: редактор заказа держит полосу внутри
  `<form onSubmit>` ([src/components/OrderEditor.tsx:63](../../../src/components/OrderEditor.tsx)), и кнопка без
  `type` отправляет форму, то есть сохраняет заказ — а ссылки по §2.3 ничего не создают. Это конвенция самого
  файла: соседние кнопки уже пишут `type="button"` явно.

### 5.2 Три точки применения

| Точка | Источник цифр | Что меняется |
|---|---|---|
| Редактор заказа | `draftShortage(state, positions)` | чип `yetishmaydi {n} {unit}` у строки материала ([src/components/OrderEditor.tsx:154-165](../../../src/components/OrderEditor.tsx)) + `ShortageNotice` под заголовком «Materiallar» |
| Доска производства | `orderShortage(state, order)` | `ShortageNotice` добавляется внутрь существующей полосы `material-warning` ([src/App.tsx:574](../../../src/App.tsx)); фактическая фраза «Materiallar band qilingan, lekin hali berilmagan» и кнопка «Sexga berish» остаются на месте |
| Список серий | `orderShortage(state, order)` | то же в карточке серии ([src/components/SeriesList.tsx:56](../../../src/components/SeriesList.tsx)) |

Полоса `material-warning` — flex-строка с `flex-wrap:wrap`, поэтому список дефицита занимает всю ширину
как вложенный flex-элемент (`.material-warning > .shortage{flex-basis:100%}`) и не ломет существующую
раскладку «текст … кнопка справа». При отсутствии дефицита `ShortageNotice` рендерит `null`, и полоса
выглядит ровно как сегодня.

Существующая подсказка «erkin {stock − reserved}» внутри `<option>`
([src/components/OrderEditor.tsx:160](../../../src/components/OrderEditor.tsx)) остаётся, но она исчезает после
выбора материала — чип виден всегда.

### 5.3 Прокидка навигации

`go(section, panel)` живёт в `App.tsx` ([src/App.tsx:358](../../../src/App.tsx)). Он уже передаётся в
производственную доску; в `OrderEditor` и `SeriesList` добавляется проп `onGo?`, который пробрасывается прямо в
`ShortageNotice`. Без `onGo` список дефицита рендерится, но ссылок нет — так существующие вызовы и SSR-тесты
не ломаются.

В редакторе заказа одной навигации мало: `go()` не трогает `modal`, поэтому переход остался бы под открытым
диалогом. Ссылка из диалога закрывает его перед переходом и объясняет это тостом
«Buyurtma saqlanmadi, tahrirlash yopildi.» — несохранённый черновик при этом гибнет ровно так же, как при
крестике диалога (`close={() => setModal(null)}`), нового способа потерять данные ссылка не вводит.

### 5.4 Стили

`src/styles.css`: `.shortage`, `.shortage-row`, `.shortage-chip` в спокойной палитре интерфейса (красный
только для числа `short`), плюс мобильный блок: шрифт не мельче 11px, зона нажатия ссылок не ниже 44px —
как в существующих мобильных правилах, на том же брейкпоинте `@media(max-width:700px)` (21 правило файла,
включая схлопывание сайдбара; новых брейкпоинтов не заводим).

Полоса `material-warning` уже задаёт `button{margin-left:auto}` всем кнопкам внутри — у ссылок дефицита это
вырвет их из строки, поэтому нужно `.material-warning .shortage-links button{margin-left:0}` (специфичнее
существующего правила, поэтому перебивает его).

## 6. Проверка

1. `src/shortage.test.ts` (чистые функции):
   - epsilon-остаток (`needed` = `available + 1e-9`) → `short` равен `0`, список пуст;
   - один ЛКМ в двух позициях составного заказа → одна строка с суммарным `needed`;
   - заказ в `production` не резервирует против самого себя (`reserved` исключает свой заказ);
   - сортировка по убыванию `short`;
   - `draftShortage` включает нормы `squareMeter`-операций так же, как их вольёт `order.create`;
   - ревизия сохранённого заказа не удваивает нормы: один и тот же черновик без `excludeOrderId` даёт
     `needed` = материал + норма, а с id сохранённого заказа — только материал (замок на правило п. 8);
   - пустой `itemId`, `qty = 0` и отсутствующая операция не бросают исключение.
2. `src/domain.test.ts` — регрессионный замок: при нехватке `order.launch` бросает ровно
   `'Insufficient available stock'`, `order.issue` — ровно `'Insufficient reserved stock'`; построчная
   семантика прежняя. Второй текст `order.issue` — `'Insufficient stock'`
   ([src/domain.ts:1068](../../../src/domain.ts)) — из JavaScript недостижим: `reservedQty` уже включает
   собственную невыданную строку заказа, поэтому проверка строки 1067 срабатывает раньше. Он остаётся
   зеркалом серверного `RAISE` и защищается контрактным тестом на текст (п. 5), а не исполняемым тестом.
   Достижимость 1067 проверяется реальным путём: заказ в `production`, у невыданной строки через
   `order.update` увеличить `qty` сверх остатка — `revisionMaterials`
   ([src/domain.ts:333](../../../src/domain.ts)) склад не проверяет.
3. `src/i18n.test.ts` — три новых маппинга; `Insufficient available stock` больше не даёт старый общий
   текст; `Insufficient reserved stock` и серверный `Insufficient stock for issue` дают текст выдачи, а
   голый `Insufficient stock` (продажа из магазина) остаётся на общем тексте.
4. `src/shortage-ui.test.tsx` (SSR через `renderToStaticMarkup`, jsdom в проекте нет):
   - редактор с дефицитом показывает «yetishmaydi» и обе ссылки;
   - без дефицита блок отсутствует в разметке;
   - `ShortageNotice` с `rows = []` не создаёт узел;
   - цифры в ряду проверены буквально (`kerak 13`, `omborda 10`, `band 0`, `yetishmaydi 3`) — список,
     печатающий только название, тест бы не забраковал;
   - в фикстуре два production-заказа по одному ЛКМ: карточка o1 обязана показать `band 2`, карточка o2 —
     `band 13`. Это единственный ассерт, который ловит забытый `excludeOrderId`: без него оба ряда дают
     `band 15`, и тест падает;
   - каждая ссылка в разметке имеет `type="button"` — гарантия, что клик по ней не отправляет форму заказа.
   `src/shortageStyle.test.ts` дополнительно держит `.material-warning .shortage-links button{margin-left:0}`
   и мобильное правило на `@media(max-width:700px)`.
5. Контрактный тест паритета: в `supabase/schema.sql` по-прежнему присутствуют
   `RAISE EXCEPTION 'Insufficient stock'` и `RAISE EXCEPTION 'Insufficient stock for issue'` —
   доказательство, что домен и сервер не разъехались.
6. Итоговые проверки (рабочая папка не Git-репозиторий, вместо коммитов):
   `npm test`, `npx tsc -b --pretty false`, `npm run build`, браузер в демо-режиме на 1280px и 390px с
   намеренно уменьшенным остатком ЛКМ. В управляемом браузере viewport отдаёт `innerWidth = 0`, поэтому
   живой раскладки на 1280px/390px измерить нельзя: в браузере проверяются текст, атрибуты и
   `getComputedStyle` отдельных узлов, а адаптивность держится на `src/shortageStyle.test.ts` и
   скан-тестах читаемости/тап-таргетов. Это ограничение надо называть прямо, а не выдавать за проверенное.
7. Живые SQL-изменения не требуются. Deploy — только по отдельному разрешению владельца.

## 7. Риски

| Риск | Оценка | Гашение |
|---|---|---|
| Клиентский агрегат строже серверной построчной проверки | интерфейс покажет дефицит там, где сервер формально пропустил | кнопка не блокируется по клиентской формуле; решение остаётся за доменом |
| Гонка двух мастеров | снимок устарел, цифры «плывут» | серверная проверка — backstop; текст ошибки ведёт на актуальный список |
| Расчёт в рендере бросает исключение | падение редактора на полупустом черновике | правило 3.7 + тест на пустые значения |
| Дублирование логики норм | редактор и `order.create` могут разойтись | переиспользование `normMaterialLines`/`mergeNormMaterials`, а не копия формулы |
