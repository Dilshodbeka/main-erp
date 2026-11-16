# Pudratchi xizmati: фиксированная сумма этапа вместо оплаты по ставке

**Дата:** 2026-11-13
**Статус:** модель согласована владельцем в диалоге («Да, реализуй так»); документ ожидает ревью владельца
**Реализация:** не начата; SQL-миграция к живой базе и deploy не входят в этот документ
**Связанные документы:** [маршрутизация услуги vs полного заказа](2026-11-10-routing-service-vs-full-design.md)

## 1. Цель и границы

Сейчас аутсорс-этап маршрута оплачивается как работа сотрудника: `ставка × количество`. Владелец
выбирает подрядчика (pudratchi), но реальную сумму узнаёт у него в Telegram уже после работы — и она
не выводится из количества и ставки. Из-за этого:

- долг перед подрядчиком и себестоимость заказа показывают выдуманную сумму;
- в редакторе заказа нет места, куда руками вписать «сколько я отправил за этот заказ»;
- разница «плановая ставка × qty» и «фактическая сумма из переписки» нигде не фиксируется.

Цель: **у аутсорс-этапа появляется одно ручное поле «Pudratchi summasi» в редакторе заказа**. Владелец
вписывает сумму, которую согласовал с подрядчиком (пока нет справочника цен — вручную, позже справочник
сможет предзаполнять это же поле). Сумма видна сразу в заказе, попадает в себестоимость, долг
подрядчику, отчёты и отгрузки. Подрядчик больше **не** получает `ставка × qty`, как работник.

Первая версия включает:

- `supplierCost?: number` в `RouteLine` / `OrderRouteInput` и колонку `erp_tasks.supplier_cost`;
- поле «Pudratchi summasi» в строке аутсорс-этапа редактора заказа (появляется сразу после выбора
  типа исполнителя «Pudratchi»; сохраняется и без суммы);
- фиксированная сумма участвует в себестоимости, долге подрядчику, реестре подрядчиков, карточке
  подрядчика, отчётах и себестоимости отгрузки;
- запрет приёмки (`outsource.accept`) аутсорс-этапа без суммы — с понятным сообщением в UI;
- оплата подрядчику остаётся отдельным кассовым расходом; форма оплаты предзаполняет сумму этапа;
- обратная совместимость: у старых заказов `supplierCost = 0`, и всё считается по-прежнему
  (`плановая × ставка` / `завершённые × ставка`), пока владелец не откроет заказ и не впишет сумму;
- паритет домена и SQL (миграция `20261114_supplier_stage_cost.sql`), PGlite-зонд.

Первая версия **не** включает:

- справочник цен подрядчиков (отдельный под-проект; поле `supplierCost` станет точкой интеграции);
- авторасчёт суммы по нормативам/материалам подрядчика;
- чаевые, бонусы, штрафы и корректировки суммы после завершения этапа;
- частичную оплату этапа как отдельную сущность — оплата идёт общим кассовым расходом подрядчику;
- изменение ролей/прав: сумму редактирует тот же круг, кто сейчас редактирует маршрут.

## 2. Согласованные правила (решения владельца)

1. **Сумма вводится в заказе, после выбора подрядчика.** Одно поле «Pudratchi summasi» в строке
   этапа; «сумма заказа на месте должна быть ясной».
2. **Сумма ручная.** Владелец пишет сумму из переписки с подрядчиком; справочника пока нет.
3. **Подрядчику не платим как работнику.** Никакого `ставка × qty` для аутсорс-этапа: оплата — это
   ровно вписанная фиксированная сумма.
4. **Сохранение без суммы разрешено.** Заказ можно создать/сохранить, пока сумма ещё не согласована;
   приёмка этапа без суммы запрещена.
5. **Оплата — отдельный кассовый расход** (как сейчас): сумма расхода предзаполняется суммой этапа,
   остаётся редактируемой; аванс подрядчику разрешён без привязки к долгу.

Правила, вытекающие из решений:

6. **Ставка аутсорс-этапа равна нулю.** Поле `rate` у подрядных этапов больше не участвует в деньгах
   (ни план, ни факт). Для старых записей с `rate > 0` и `supplierCost = 0` работает fallback
   `planned × rate` (план) и `completed × rate` (факт), чтобы история не поехала.
7. **Зафиксированный этап нельзя переоценить.** Если этап уже начат/завершён, сумма заморожена
   (правило текущего guard «Started stage cannot be changed» распространяется и на сумму).
8. **Назначенный, но не начатый этап редактируется свободно** — сумма уточняется, пока подрядчик не
   приступил.
9. **Приёмка требует сумму**: `supplierCost > 0` (или legacy `rate > 0`). Сообщение:
   `Supplier amount is required before acceptance`.
10. **Видимость суммы — админская.** `erp_snapshot` отдаёт `supplierCost` только админу (как `rate`),
    работнику — 0.

## 3. Домен

### 3.1 Типы

```ts
// src/types.ts
export type RouteLine = {
  // ...
  rate: number;
  supplierCost?: number; // фиксированная сумма подрядчику, только executorKind === 'supplier'
};

export type OrderRouteInput = {
  // ...
  rate: number;
  supplierCost?: number;
};
```

`routeValues` нормализует: сотрудник → `supplierCost: 0`; подрядчик → `money(line.supplierCost ?? 0)`.
Сумма валидируется как деньги (`money`) и не может быть отрицательной.

### 3.2 Чистые помощники (новые экспорты `src/domain.ts`)

```ts
export function supplierStagePlan(task: RouteLine): number {
  if (task.executorKind !== 'supplier') return 0;
  return (task.supplierCost ?? 0) > 0 ? round(task.supplierCost!) : round(task.planned * task.rate);
}

export function supplierStageActual(task: RouteLine): number {
  if (task.executorKind !== 'supplier' || task.status !== 'completed') return 0;
  return (task.supplierCost ?? 0) > 0 ? round(task.supplierCost!) : round(task.completed * task.rate);
}

export function supplierStagePriced(task: RouteLine): boolean {
  return task.executorKind === 'supplier' && ((task.supplierCost ?? 0) > 0 || task.rate > 0);
}
```

Все расчёты текущего кода переходят на них:

| Место | Было | Стало |
|---|---|---|
| `estimatedCost` | `planned × rate` | сотрудники: `planned × rate`; подрядчики: `supplierStagePlan` |
| `acceptedRouteCost` | `completed × rate` | сотрудники: `completed × rate`; подрядчики: `supplierStageActual` |
| `acceptedOutsourceCost` | Σ `completed × rate` | Σ `supplierStageActual` |
| `supplierDebt` | из `acceptedOutsourceCost` | без изменений формулы |
| `orderShipmentLine` / cost slice | через `acceptedRouteCost` | следует автоматически |
| `positionCost` / `orderTotals` в редакторе | Σ `rate × planned` | сотрудники: `rate × qty`; подрядчики: `supplierCost` |

### 3.3 Ревизия маршрута

`routeRevision` добавляет в guard начатого этапа сравнение `supplierCost`:

```ts
check(money(line.rate) === task.rate && money(line.supplierCost ?? 0) === (task.supplierCost ?? 0),
  'Started stage cannot be changed');
```

Ветка начатого этапа по-прежнему сохраняет `completed` / `status`, а теперь и `supplierCost`.

### 3.4 Приёмка аутсорса

`outsource.accept` перед обновлением:

```ts
check(supplierStagePriced(task), 'Supplier amount is required before acceptance');
```

## 4. Редактор заказа

- `PositionStage.supplierCost: number`; `positionsFromOrder` заполняет
  `task.supplierCost ?? (task.executorKind === 'supplier' ? round(task.planned * task.rate) : 0)` —
  старый заказ при открытии показывает привычную сумму и нормализуется при сохранении без изменения долга.
- `positionLines` добавляет `supplierCost` **только** для подрядных этапов; у сотрудников поле не
  появляется (существующие exact-equality тесты не ломаются).
- `stageAmounts` сохраняет форму `{ price, worker }`, но для подрядчика `worker = 0`: UI читает сумму
  этапа напрямую из `task.supplierCost`.
- `applyTemplate` для подрядчика: `rate: 0`, `supplierCost: 0` (шаблон не должен подтягивать
  `operation.workerRate` — это и есть «оплата как работнику»).
- Смена типа исполнителя: сотрудник → `supplierCost: 0`, подрядчик → `rate: 0, supplierCost: 0`
  (или сохранённая сумма при повторном выборе).
- В строке этапа при «Pudratchi» вместо пары «ставка / к оплате» показывается одно поле
  `Pudratchi summasi` (number, min 0, step 0.01, блокируется для `locked`) и справочная оценка
  материалов по нормам, если она есть. Подпись суммы этапа — `pudratchiga`.
- Подсказка над маршрутом объясняет: сумма подрядчика фиксированная и вводится вручную, а не
  `ставка × количество`.

## 5. Производство и деньги (App / карточка подрядчика)

- Доска производства: у подрядного этапа вместо `rate / единица` — `summa ...` или
  `summa kiritilmagan`.
- `OutsourceStageActions`: «Ishni qabul qilish» заблокирована, пока `!supplierStagePriced(task)`,
  с подсказкой «Avval pudratchi summasini kiriting».
- Реестр/карточка подрядчика: факт услуги — `supplierStageActual`, план — `supplierStagePlan`
  (карточка `supplier-card.ts`: строка услуги = фактическая фиксированная сумма).
- Drawer заказа (админ): отдельная строка «Pudratchi xizmati, reja» через `supplierStagePlan`;
  строка «Ish haqi, reja» считает только сотрудников.
- Модалка оплаты подрядчику (`SupplierPayForm`): новый необязательный проп `suggested`; сумма
  инициализируется `payable > 0 ? min(payable, suggested ?? payable) : 0`; аванс (`payable <= 0`)
  не предзаполняется отрицательным числом. Поле остаётся редактируемым.
- `defaultNote` оплаты включает номер заказа и название этапа.

## 6. SQL-паритет

Миграция `supabase/migrations/20261114_supplier_stage_cost.sql` (идемпотентная, полные
`CREATE OR REPLACE FUNCTION`):

1. `erp_tasks.supplier_cost numeric NOT NULL DEFAULT 0 CHECK (0..1e12, round 2)`.
2. `erp_insert_route`: пишет `supplier_cost` из `supplierCost` только для `supplier`, иначе 0.
3. `erp_revise_route`: guard начатого этапа сравнивает `supplier_cost`; UPDATE начатого этапа не
   трогает `supplier_cost`; для не начатого — пишет; INSERT — пишет.
4. `erp_supplier_cost`: `sum(CASE WHEN t.supplier_cost > 0 THEN t.supplier_cost ELSE round(t.completed * t.rate, 2) END)`.
5. `erp_assert_cash`: обе суммы по заказу (плановая и фактическая) используют тот же CASE.
6. `erp_snapshot`: в JSON маршрута `'supplierCost', CASE WHEN v_admin THEN t.supplier_cost ELSE 0 END`.
7. `outsource.accept`: до UPDATE — `IF NOT (v_task.supplier_cost > 0 OR v_task.rate > 0) THEN RAISE EXCEPTION 'Supplier amount is required before acceptance' USING ERRCODE = '23514'; END IF;`.
8. Срез себестоимости отгрузки: `sum(CASE WHEN t.supplier_cost > 0 THEN t.supplier_cost ELSE round(t.completed * t.rate, 2) END)`.

Проверка: PGlite-зонд `validate-supplier-stage-cost.mjs` по шаблону
`.validation-pglite-20261029/validate-order-markup-salary-modes.mjs`: схема + миграция дважды,
создание заказа с подрядным этапом, приёмка без суммы (reject), с суммой (ok), снимок отдаёт
`supplierCost` админу и 0 работнику, отгрузка даёт фиксированную себестоимость, legacy-этап с
`rate > 0` считается как раньше.

## 7. Копирайт (узбекская латынь)

| Ключ | Текст |
|---|---|
| метка поля | `Pudratchi summasi` |
| подпись суммы этапа | `pudratchiga` |
| доска без суммы | `summa kiritilmagan` |
| подсказка маршрута | `Pudratchi summasi qo‘lda kiritiladi va stavkaga bog‘liq emas.` |
| ошибка приёмки | `Autsors bosqichini qabul qilishdan oldin pudratchi summasini buyurtmada kiriting.` |
| hint действия | `Avval pudratchi summasini kiriting` |

`i18n.ts`: `[/supplier amount is required/i, 'Autsors bosqichini qabul qilishdan oldin pudratchi summasini buyurtmada kiriting.']`.

## 8. Тестирование (TDD, SSR-only)

1. **RED домен**: хелперы `supplierStagePlan/Actual/Priced`; `estimatedCost` / `acceptedRouteCost` с
   фиксированной суммой и legacy fallback; guard приёмки; заморозка суммы начатого этапа.
2. **RED модель редактора**: `positionsFromOrder` предзаполняет legacy-сумму; `positionLines` пишет
   `supplierCost` только подрядчику; `stageAmounts.worker = 0`; `orderTotals`/`positionCost` на
   фиксированной сумме; `applyTemplate` не подтягивает `workerRate`.
3. **RED UI (SSR)**: поле `Pudratchi summasi` N появляется после выбора подрядчика; доска показывает
   `summa ...` / `summa kiritilmagan`; кнопка приёмки disabled без суммы; форма оплаты предзаполняет
   сумму этапа и не показывает отрицательный дефолт для аванса.
4. **SQL**: контрактный тест на присутствие `supplier_cost` в схеме/снимке + PGlite-зонд.
5. **Регресс**: старые exact-equality тесты `order-editor.test.ts` для сотрудников не меняются;
   демо-сид переводится на `supplierCost: 500000, rate: 0` — тест демо обновляется осознанно.

Проверки вместо коммитов (папка не Git): `npx vitest run`, `npx tsc -b`, `npm run build`.

## 9. Риски и совместимость

- **Старые заказы** с `rate > 0` живут на fallback бессрочно; при открытии редактор показывает
  `planned × rate` и при сохранении переносит её в `supplierCost` — долг не меняется.
- **Замороженная сумма**: после старта этапа сумму изменить нельзя; ошибка понятна владельцу.
- **Переходный период**: подрядчик без суммы виден на доске как `summa kiritilmagan`; приёмка
  заблокирована, но заказ сохраняется и запускается.
- **Оплата не блокируется суммой**: владелец может заплатить больше/меньше — это кассовый факт,
  сумма этапа остаётся учётной.

## 10. Открытые вопросы

Нет. Спорные точки (место ввода, ручной ввод, отсутствие оплаты по ставке) закрыты владельцем.
