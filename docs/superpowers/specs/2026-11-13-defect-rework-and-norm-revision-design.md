# Переделка брака при приёмке и ревизия норм после выдачи

**Дата:** 2026-11-13
**Статус:** архитектура одобрена владельцем в диалоге (секции 1–3 «ок», дефолт ручной приёмки для Jilolash и Bo‘yash подтверждён); документ ожидает ревью владельца
**Реализация:** не начата; миграция к живой базе и deploy вынесены в отдельный раздел и требуют отдельного разрешения
**Задачи дорожной карты:** #314 (переделка брака + защита сметы) и #315 (ревизия после выдачи + перенос нормы при ревизии)
**Связанные документы:** [нормы покраски](2026-11-09-painting-warehouse-economics-design.md), [ревизии заказа](2026-11-10-routing-service-vs-full-design.md), [дефицит ЛКМ при выдаче](2026-11-11-lkm-shortage-at-issue-design.md)

## 1. Цель и границы

Приёмка работы в системе существует, но недоступна человеку. Команда `work.review` с обоими
исходами написана в домене ([src/domain.ts:1231-1270](../../../src/domain.ts)) и полностью
отзеркалена в SQL ([supabase/schema.sql:2572-2618](../../../supabase/schema.sql)), отказ проверяется
тестами, но **ни один элемент интерфейса её не вызывает** — в [src/App.tsx:726](../../../src/App.tsx)
есть только `work.submit`. Хуже того, редактор ставки жёстко пишет `autoAccept: true`
([src/components/QuickEditors.tsx:120](../../../src/components/QuickEditors.tsx),
[src/components/CatalogSettings.tsx:54](../../../src/components/CatalogSettings.tsx)), то есть
ручной приёмки в продукте физически нет: начальное обещание терминала
«Egasi miqdorni tekshirib ishni qabul qiladi»
([src/components/WorkTasks.tsx:72](../../../src/components/WorkTasks.tsx)) не выполняется никем.

Второй разрыв — смета. Нормы (л/м²) превращаются в строки материалов только при создании заказа
([src/domain.ts:970-986](../../../src/domain.ts)). При ревизии работает `revisionMaterials`
([src/domain.ts:343-367](../../../src/domain.ts)), который берёт присланные строки как есть и нормы
не пересчитывает; об этом честно сказано в комментарии
[src/shortage.ts:64-65](../../../src/shortage.ts). Следствие: на уже выданном заказе меняют
12 м² на 20 м², а потребность в краске остаётся 3 литра — смета молча недосчитывает 2 литра, и
«защита сметы» исчезает ровно в тот момент, когда она нужнее всего.

Цель: **два законченных пакета, которые можно выкатывать независимо.**

**P1 — приёмка, брак, журнал.** Очередь приёмки на доске производства, одна модалка с количеством
брака и причиной, частичная приёмка (годное оплачивается сразу, бракованное возвращается работнику),
append-only журнал брака с оценкой сгоревших материалов, переключатель «принимает владелец» в
редакторе ставки.

**P2 — материалы с честной выдачей.** У строки материала появляется разделение «потребность» и
«выдано», ревизия пересобирает потребность по нормам и показывает только разницу к довыдаче,
выдача и возврат считают дельту, а не всю строку.

В оба пакета **не** входят:

- штрафы и удержания за брак (владелец выбрал «не платим, но не вычитаем»; удержания уже есть
  отдельным механизмом `salary.deduct`);
- возврат сгоревших материалов на склад — материал израсходован и остаётся в себестоимости;
- право приёмки у мастера цеха (владелец выбрал «только я»; ролевая модель `admin | worker | display`
  не меняется, сервер и так запрещает `work.review` работнику — [supabase/schema.sql:1924](../../../supabase/schema.sql));
- карта проверок, чек-листы качества, фото брака, нормо-часы на переделку;
- перерасчёт цены для клиента при браке или ревизии (цена заказа правится только явной ревизией);
- исправление ранее принятых (already accepted) исторических заказов и backfill журнала брака.

## 2. Согласованные правила (решения владельца)

| # | Правило | Источник |
|---|---|---|
| 1 | Брак виден **при приёмке**, а не после отгрузки | ответ на вопрос о тайминге |
| 2 | **За брак не платим.** При отказе начисления нет; при частичном отказе платим за годное | там же |
| 3 | На окладной схеме («Faqat oklad») брак на деньги не влияет — «переделать в моменте переделки» | там же; подтверждается [src/salary.ts:79](../../../src/salary.ts) |
| 4 | **Материал считается израсходованным**: ничего не возвращается на склад, выдача не откатывается, смета не удваивается | ответ о материалах |
| 5 | Механика — **ручная приёмка + кнопка «брак»**, а не сторно по уже принятому | выбор подхода |
| 6 | Отдельный учёт брака нужен, **без штрафов** (причина + количество + сгоревшие материалы) | выбор журнала |
| 7 | Приёмку делает **только владелец** | вопрос о праве приёмки |
| 8 | При ревизии в производстве — **довыдача разницы**: выданное остаётся фундаментом, смета следует новой норме, недостающее показывается как потребность | выбор по #315 |
| 9 | Для «Jilolash» и «Bo‘yash» приёмка **ручная** по умолчанию | подтверждение секции 2 |

## 3. Пакет P1 — приёмка, брак, журнал

### 3.1 Типы и команда

`src/types.ts`:

```ts
export type DefectReason = 'quality' | 'measurement' | 'drawing' | 'customer' | 'other';
export interface DefectMaterial { itemId: string; qty: number }
export interface DefectRow {
  id: string; reportId: string; orderId: string; lineId: string; taskId: string;
  employeeId: string; operationId: string; qty: number;
  reason: DefectReason; note: string; materials: DefectMaterial[]; createdAt: string;
}
```

`State` получает коллекцию `defects: DefectRow[]` рядом с `reports`, `version` остаётся 4 — новые
поля читаются через `migrations.ts` с дефолтом `[]` (по образцу `tickets`,
[src/migrations.ts:140](../../../src/migrations.ts)).

Команда расширяется в одну форму, обратная совместимость сохраняется опциональностью:

```ts
| { type: 'work.review'; reportId: string; accept: boolean;
    defectQty?: number; reason?: DefectReason; note?: string }
```

Валидация в домене:

- `accept === true` → `defectQty`, `reason`, `note` должны отсутствовать, иначе
  `Review must be plain`; существующие вызовы не затрагиваются;
- `accept === false` → `reason` обязателен (`Defect reason is required`), при `reason === 'other'`
  обязателен `note` (1…500 символов);
- `defectQty` по умолчанию равен `report.qty` (полный отказ = сегодняшнее поведение). При явном
  значении проверяется `0 < defectQty ≤ report.qty` и round-2; `defectQty === 0` вместе с
  `accept: false` запрещён (`Nothing to reject`) — иначе отказ парадоксально принял бы весь отчёт по
  правилам §3.2.

### 3.2 Семантика отказа и денежные инварианты

Все существующие guard'ы `work.review` остаются без изменений (материалы выданы, этап в
`submitted`, работник назначен и активен, предыдущий этап завершён, количество в остатке).

Ветка отказа становится трёхисходной (`good = report.qty − defectQty`):

- **`defectQty === report.qty` (полный отказ)** — сегодняшнее поведение без изменений:
  `report.status = 'rejected'`, `task.status = 'in_progress'`, `payroll.status = 'rejected'`
  если строка ещё не `accepted`; строка брака на всё количество.
- **`0 < defectQty < report.qty` (частичный)** — годное принимается по действующей accept-логике
  ([src/domain.ts:1243-1263](../../../src/domain.ts)), но `report.qty` перезаписывается принятым
  количеством (`report.qty := good`) и отчёт становится `accepted`; отклонённое количество живёт
  только в строке брака. Accept-логика сама оставит этап в `in_progress`, пока
  `completed < planned`, — остаток снова появится в терминале работника без специального кода.
- **`defectQty === 0` с `accept: false`** — запрещено валидацией §3.1.

Исходная сдача работником количества при этом не теряется: она восстановима как
`report.qty + Σ defect.qty` по тому же отчёту. Альтернатива «хранить `report.qty = 12` и отдельно
поле `rejectedQty`» отклонена, потому что добавила бы третье число в уже перегруженную строку
отчёта и потребовала бы править `Σ qty == completed` во всех существующих местах.

Инварианты, каждый из которых становится тестом:

1. `Σ qty принятых отчётов по этапу == task.completed`;
2. начисление по этапу никогда не больше `round(rate × task.planned)` — пересдача после брака
   удвоения дать не может, потому что guard `Report exceeds remaining quantity`
   ([src/domain.ts:1248](../../../src/domain.ts), [supabase/schema.sql:2599](../../../supabase/schema.sql)) считает от
   `planned − completed`;
3. полный отказ даёт нулевое начисление (`payroll.status === 'rejected'`), частичный —
   `rate × good`;
4. `ready()`, статус заказа и цена не меняются от факта брака;
5. ни одна ветка отказа не создаёт движение склада и не меняет выдачу (правило 4 из таблицы
   решений) — в P1 это проверка флага `issued`, в P2 — `issuedQty`.

### 3.3 Одна строка отчёта на сдачу (изменение `work.submit`)

Сейчас отчёт ищется как «единственный по (заказ, этап, работник)» и перезаписывается
([src/domain.ts:1196-1208](../../../src/domain.ts)). Для журнала и истории это непригодно:
пересдача после брака затрёт принятую строку. Правило меняется на

```ts
const report = state.reports.find(row =>
  row.orderId === order.id && row.taskId === task.id && row.employeeId === employee.id && row.status === 'submitted');
```

— переиспользуется только строка, всё ещё ждущая приёмки; принятая и отклонённая строки
неприкосновенны, новая сдача создаёт новую строку. Побочные эффекты, которые обязана подтянуть
реализация:

- `payroll` остаётся одна строка на (заказ, этап, работник) — сумма пересчитывается от
  `task.completed`, `reportId` указывает на последний принятый отчёт;
- [src/work-view.ts:75-90](../../../src/work-view.ts) (`workHistoryRows`) должен показывать
  `amount = report.status === 'accepted' ? round(report.qty * task.rate) : 0` вместо
  `payroll.amount` — иначе две строки истории одного этапа показывают одну и ту же полную сумму;
  в строку добавляется `status: report.status`, чтобы `rejected` был виден как `Brak`;
- [src/App.tsx:772](../../../src/App.tsx) (`employeeStats`) обязан суммировать `qty` всех принятых
  отчётов периода, а не брать `reports.find(...)?.qty` одной строки;
- тесты, предполагающие один отчёт на этап (`state.reports[0]` в доменных тестах), поправляются на
  `.at(-1)`/фильтр по статусу — это ожидается на красном прогоне.

### 3.4 Журнал брака

Новая коллекция `state.defects`, append-only, создаётся только веткой отказа при `defectQty > 0`.

`materials` считаются чистым помощником:

```ts
export function defectMaterials(state: State, task: RouteLine, qty: number): DefectMaterial[]
```

— берёт операцию этапа, и если `unit === 'squareMeter'` и `norms.length > 0`, возвращает
`norms.map(norm => ({ itemId: norm.itemId, qty: round(norm.qtyPerM2 * qty, 3) }))`, иначе `[]`.
Это информационная оценка (справка `Сгоревший материал` в журнале и в модалке), никаких движений
склада и никакого влияния на `estimatedCost`. Помощник строится на той же логике, что
`normMaterialLines` ([src/domain.ts:316-331](../../../src/domain.ts)), но с параметром количества
вместо `task.planned`; переиспользовать `normMaterialLines` нельзя — он теряет весь этап, если одна
норма указывает на удалённую номенклатуру (см. [src/shortage.ts:49-55](../../../src/shortage.ts)),
поэтому `defectMaterials` обязан пропускать неизвестный `itemId`, а не падать.

Доступ на чтение. Таблицы ERP работнику не читаются напрямую вообще: общий цикл RLS даёт
`SELECT` только админу (`erp_admin_read`, [supabase/schema.sql:690-705](../../../supabase/schema.sql)),
а данные работник получает фильтром внутри `erp_snapshot()`. Значит `erp_defects` добавляется в
тот же массив таблиц, а видимость «работник видит только свой брак» реализуется условием
`(v_admin OR employee_id = v_profile.employee_id)` в `jsonb_agg` снимка — по образцу
`reports` ([supabase/schema.sql:1693-1695](../../../supabase/schema.sql)) и
`workerDeductions` (:1716-1719).

### 3.5 Интерфейс

1. **Очередь.** На доске производства этап-сотрудник в статусе `submitted` рисуется
   заблокированной кнопкой «Qabulda» ([src/App.tsx:601](../../../src/App.tsx)). Становится активной
   `primary`-кнопкой «Qabul qilish» и открывает модалку `workReview` с id `${orderId}:${taskId}`
   (реестр типов и заголовков модалок — [src/App.tsx:735](../../../src/App.tsx)).
2. **Модалка приёмки.** Сверху факты: заказ и позиция, операция, работник, `Topshirilgan: 12 m²`,
   `Qolgan: …`, ставка и `Qabulda hisoblanadi: X so'm`, `Brakda sarflangan: Y so'm`.
   Поля: `Brak miqdori` (number, default 0, max = сдача), `Brak sababi` (select из пяти причин,
   обязателен при количестве > 0), `Izoh` (обязателен при причине `Boshqa`).
   Одна primary-кнопка меняет подпись: `Qabul qilish` (0), `Qabul 9 · Brak 3` (частично),
   `Hammasi brak — qayta ishlash` (равно сдаче). При нулевом браке команда — `{ accept: true }`
   без полей брака (валидация §3.1 иначе ответит `Review must be plain`); при любом браке —
   `accept: false` с `defectQty`, `reason` и, если нужно, `note`. Две кнопки сознательно не делаем.
3. **Бейдж раздела.** Для admin счётчик раздела `Ishlab chiqarish` становится
   `active.length + reviewCount` (сейчас `active.length`, [src/App.tsx:515](../../../src/App.tsx)),
   где `reviewCount` — число employee-этапов в статусе `submitted` в заказах `production`.
4. **Терминал работника.** Структура не меняется: сданный этап уже выпадает из списка
   (`workTaskRows` фильтрует `submitted`, [src/work-view.ts:60](../../../src/work-view.ts)) и сам
   возвращается после отказа, потому что `availableTask` пропускает `in_progress` с остатком
   ([src/domain.ts:683-684](../../../src/domain.ts)). Добавляется только подпись: если по этапу
   есть необработанная строка брака, в карточке — `Qayta ishlash · 3 m² (brak)`.
   `WorkTaskRow.defectQty` считается однозначно: сумма `qty` по строкам `defects` этого
   `(orderId, taskId, employeeId)`, где `task.status !== 'completed'` — после успешной пересдачи
   этап завершается и подпись исчезает сама, без нового флага в строке брака.
5. **Журнал.** В разделе `Ishlab chiqarish` появляется панель
   `{ id: 'brak', title: 'Brak tarixi' }` ([src/sections.ts:12](../../../src/sections.ts), panels
   пустые; доска продолжает рисоваться при `panel !== 'brak'`, существующие ссылки `section:panel`
   не ломаются). Фильтры: месяц и работник. Колонки: дата · заказ · операция · работник ·
   количество и единица · причина · сгоревшие материалы и их сумма. Сверху итоги: m² брака за
   месяц, сумма материалов, работник с наибольшим браком.
6. **Переключатель приёмки.** В `OperationRateEditor`
   ([src/components/QuickEditors.tsx:106-140](../../../src/components/QuickEditors.tsx)) и в
   каталоге ([src/components/CatalogSettings.tsx:54](../../../src/components/CatalogSettings.tsx))
   чекбокс «Natijani egasi qabul qiladi» пишет существующее поле `autoAccept` (в Checked →
   `autoAccept: false`). Захардкоженный `true` убирается из обеих форм.
7. **Дефолты.** `autoAccept: false` для «Jilolash» и «Bo‘yash» в `src/setup.ts:52,57` и
   `src/seed.ts:39-40`. Дефолт `autoAccept: true` для старых снимков в
   [src/migrations.ts:33](../../../src/migrations.ts) **не трогается** — он и означает «история
   работала без приёмки». Живые справочники не мигрируются — владелец переключает сам в «Stavkalar».

### 3.6 SQL-паритет P1

Канонический `supabase/schema.sql`, миграция генератором (не руками), имя
`supabase/migrations/20261115_defects.sql`:

1. `CREATE TABLE public.erp_defects (id uuid PK, company_id uuid NOT NULL, report_id uuid NOT NULL,
   order_id uuid NOT NULL, line_id uuid NOT NULL, task_id uuid NOT NULL, employee_id uuid NOT NULL,
   operation_id uuid NOT NULL, qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000),
   reason text NOT NULL CHECK (reason IN ('quality','measurement','drawing','customer','other')),
   note text NOT NULL DEFAULT '' CHECK (length(note) <= 500), materials jsonb NOT NULL DEFAULT '[]',
   created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (company_id, id))` +
   `CREATE INDEX erp_defects_order_idx ON public.erp_defects (company_id, order_id)` и
   `erp_defects_employee_idx ON public.erp_defects (company_id, employee_id, created_at)`.
   Колонки, FK-стиль и CHECK'и повторяют формат `erp_work_reports` — генератор миграции берёт их
   из канонической схемы, поэтому схема пишется первой.
2. RLS: `'erp_defects'` добавляется в массив общего цикла ([supabase/schema.sql:691-697](../../../supabase/schema.sql)) —
   включение RLS, `REVOKE ALL`, `GRANT SELECT`, политика `erp_admin_read`. Отдельных политик нет:
   запись идёт только через `erp_execute` (SECURITY DEFINER), чтение работником — только через
   `erp_snapshot`.
3. `erp_execute`, ветка `work.review` ([supabase/schema.sql:2572-2618](../../../supabase/schema.sql)):
   разобрать `defectQty` (`public.erp_num(p_command -> 'defectQty', …)` с default
   `v_report.qty`), `reason` (`public.erp_text`, обязателен при отказе), `note`; добавить guard'ы
   из §3.1 (`Nothing to reject`, `Review must be plain`);
   `v_good := v_report.qty - v_defect`.
   При `v_defect > 0` — `INSERT INTO public.erp_defects …` с `materials`, посчитанными по нормам
   операции: нормы лежат в `public.erp_operations.norms` (jsonb,
   [supabase/schema.sql:69](../../../supabase/schema.sql)) и разворачиваются
   `jsonb_array_elements(op.norms)` при `op.unit = 'squareMeter'` — тем же выражением, что в
   `erp_insert_norm_materials` ([supabase/schema.sql:1040-1062](../../../supabase/schema.sql)); при
   отсутствии норм `'[]'::jsonb`. При `v_good > 0` — принятая часть: `UPDATE erp_work_reports SET
   qty = v_good, status = 'accepted'`, `erp_tasks.completed = least(planned, completed + v_good)`
   со статусом по действующей accept-логике, сумма `round(rate × completed)` и `erp_payroll` как
   сейчас. При `v_good = 0` — `status = 'rejected'` и payroll-сторно как сейчас (schema.sql:2612-2617).
4. `v_report.status <> 'submitted'` остаётся единственным входным guard'ом — повторная приёмка
   той же строки невозможна и в SQL, и в домене.
5. `erp_snapshot`: каждая коллекция — отдельный `jsonb_agg`-подзапрос в общей цепочке
   `jsonb_build_object` ([supabase/schema.sql:1693-1715](../../../supabase/schema.sql)), поэтому
   добавляется ещё один элемент: `'defects', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id,
   'reportId', d.report_id, 'orderId', d.order_id, 'lineId', d.line_id, 'taskId', d.task_id,
   'employeeId', d.employee_id, 'operationId', d.operation_id, 'qty', d.qty, 'reason', d.reason,
   'note', d.note, 'materials', d.materials, 'createdAt', d.created_at) ORDER BY d.created_at, d.id), '[]'::jsonb)
   FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id))`.
   общего списка таблиц это не касается — там только RLS (п. 2).
6. Клиент: `defects` в список коллекций офлайн-синхронизации
   ([src/sync.ts:25](../../../src/sync.ts)), дефолт в [src/migrations.ts](../../../src/migrations.ts),
   whitelist команд не меняется (`work.review` уже админский — [supabase/schema.sql:1924](../../../supabase/schema.sql)).

## 4. Пакет P2 — `issuedQty` и пересчёт норм при ревизии

### 4.1 Модель материала

`erp_order_materials` имеет `UNIQUE (company_id, line_id, item_id)`
([supabase/schema.sql:176](../../../supabase/schema.sql)) — вторую строку «на разницу» для той же
краски на той же позиции завести нельзя, поэтому дельта выражается не новой строкой, а вторым
числом в существующей.

```ts
export interface MaterialLine {
  id: string; lineId: string; itemId: string;
  qty: number;        // потребность, следует нормам и явным строкам
  issuedQty: number;  // сколько реально ушло со склада, 0 ≤ issuedQty ≤ qty
  estimatedCost: number; actualCost: number;
}
export const isIssued = (line: MaterialLine): boolean => !exceeds(line.qty, line.issuedQty);
```

Поле `issued: boolean` **удаляется**, а не дублируется: два источника правды расходятся при
каждой следующей выдаче. 40 мест вне тестов читают `row.issued`
(`grep -rn "\.issued\b" src --include=*.ts --include=*.tsx | grep -v "\.test\.ts"` → 40 строк,
остальные 10 — в тестах); все переходят на `isIssued(row)`. В JSON снимка ключ `issued` продолжает
отдаваться как `m.issued_qty >= m.qty` на один релиз, чтобы уже опубликованный бандл не сломался до
деплоя нового.

### 4.2 Ревизия: дельта нормы поверх присланной потребности

Почему нельзя просто пересобрать норму: при `order.create` домен сам запекает нормы
(`mergeNormMaterials`, [src/domain.ts:970-986](../../../src/domain.ts)), поэтому строки сохранённого
заказа **уже содержат** норму. Редактор позиции при ревизии отправляет ровно эти строки
(`positionsFromOrder`, [src/order-editor.ts:80](../../../src/order-editor.ts)). Если сейчас же
добавить к ним полную норму нового маршрута, литры посчитаются дважды — это та самая ловушка, из-за
которой в виджете дефицита существует флаг `fromNorms === false`
([src/shortage.ts:40-66](../../../src/shortage.ts)).

Поэтому правило формулируется как **дельта**, а не как пересборка (ровно решение 8 — «довыдача
разницы»):

```
oldPlanned = lineRoute(order, lineId) ДО замены маршрута   // план позиции до ревизии
newPlanned = результат routeRevision для этой позиции      // план после ревизии
для каждой операции с unit === 'squareMeter' и нормами:
  delta = Σ qtyPerM2 × (newPlanned − oldPlanned)           // 0 у round-2 → строку не трогаем
  delta > 0: строка есть → row.qty = quantity(row.qty + delta)
             строки нет  → создать по образцу normMaterialLines (:324-327):
                           { id: uuid(), lineId, itemId, qty: delta, issuedQty: 0, estimatedCost: item.cost }
  delta < 0: row.qty = max(quantity(row.qty + delta), row.issuedQty)   // ниже выданного не уходим
```

Добавленный в ревизии этап даёт `oldPlanned = 0` → начисляется полная норма; удалённый этап даёт
отрицательную дельту, которая упирается в `issuedQty`. Явные строки, вписанные рукой, остаются как
есть: дельта трогает только те `itemId`, которые перечислены в нормах затронутых операций. Если
работник и сам поправил норму-строку в редакторе, дельта ложится поверх его числа — это осознанный
выбор в пользу «ничего не теряем».

`revisionMaterials` ([src/domain.ts:343-367](../../../src/domain.ts)) меняет только свою часть:
защита выданного. Сегодня она звучит как «выданная строка заморожена целиком»
(`Issued material quantity cannot change`, [src/domain.ts:349](../../../src/domain.ts),
[supabase/schema.sql:1089](../../../supabase/schema.sql)) и «выданную нельзя удалить»
(:348, [supabase/schema.sql:1085](../../../supabase/schema.sql)). После P2:

- строка с `existing.issuedQty > 0` принимает `qty = max(присланное, issuedQty)` вместо жёсткой
  ошибки: количество выданного остаётся фактом, потребность может только расти. Уменьшение ниже
  выданного больше не блокирует ревизию — лишний литр по-прежнему списан со склада и учтён в
  себестоимости через `issuedQty × actualCost`, а вернуть его можно только инвентаризацией;
- удаление строки с `issuedQty > 0` остаётся ошибкой `Issued material cannot be removed`;
- дельта норм применяется после этого шага и по той же формуле `max(…, issuedQty)`.

Это осознанный отказ от варианта «разрешить `issuedQty > qty`»: он честнее показывает перерасход
строкой сметы, но требует снять CHECK, добавить `Math.max(0, …)` в резерв и в дефицит и новую
подпись в редакторе — ради числа, которое ни один экран склада не запрашивает. Решение фиксируется
тестом 13 (§6) и риском в §8.

`normMaterialLines` бросает `Item not found` на норме с удалённой номенклатурой
([src/domain.ts:323](../../../src/domain.ts)), поэтому дельта считается по известным `itemId` —
фильтр тот же, что в [src/shortage.ts:49-55](../../../src/shortage.ts).

Итог для пользователя: выданное остаётся нижним пределом, смета следует новой норме, недостающее
автоматически попадает в потребность и в виджет дефицита
([src/shortage.ts:34,70](../../../src/shortage.ts)), а не исчезает. Вернуть излишек в склад —
только инвентаризацией (`inventory.count`, [src/types.ts:232](../../../src/types.ts)), не правкой
сметы.

`order.create` не меняется (нормы уже запекаются, [src/domain.ts:970-986](../../../src/domain.ts)).
Спецслучай `fromNorms === false` в `positionLines`/`draftShortage` остаётся нужным и после P2 — по
той же причине: для сохранённого заказа строки несут уже запечённую потребность.

### 4.3 Выдача, возврат, резерв, себестоимость

| Место | Сейчас | После P2 |
|---|---|---|
| `order.issue` ([src/domain.ts:1106-1129](../../../src/domain.ts)) | движение на `row.qty` для `!issued`, `issued = true` (:1125) | `delta = qty − issuedQty`, движение на `delta`, `issuedQty = qty`; проверка склада по `delta` |
| `reservedQty` ([src/domain.ts:496](../../../src/domain.ts), [src/shortage.ts:14](../../../src/shortage.ts)) | `!issued ? qty` | `qty − issuedQty` |
| дефицит ([src/shortage.ts:34,70](../../../src/shortage.ts)) | `!issued ? qty` | `qty − issuedQty` |
| `estimatedCost` / себестоимость позиции ([src/domain.ts:571,606](../../../src/domain.ts), [src/reports.ts:45](../../../src/reports.ts), [src/migrations.ts:174](../../../src/migrations.ts)) | `issued ? qty × actualCost` | `issuedQty × actualCost` |
| `order.cancel` / `orderLine.cancel` ([src/domain.ts:1135-1141,1158](../../../src/domain.ts)) | возврат `qty`, `issued = false` | возврат `issuedQty`, `issuedQty = 0` — сегодня строка выдаётся целиком, и возврат `qty` верен; после P2 появляется частичная выдача, и `qty` вернул бы на склад литры, которых там нет |
| guard `order.launch` ([src/domain.ts:1091](../../../src/domain.ts)) | `check(!row.issued, 'Material already issued')` | `check(!isIssued(row), …)` — в P2 `order.launch` идёт только из `draft`, где выдача невозможна, поэтому замена механическая и ничего не ослабляет (в SQL этого guard'а нет и раньше) |
| guard'ы статуса: `ready()`/ре-валидация `ready → production` ([src/domain.ts:466,1035](../../../src/domain.ts)), старт этапа (:656), доступность (:677,694), приёмка (:1240,1546) | `row.issued` / `!row.issued` | `isIssued(row)` / `!isIssued(row)` |
| модель черновика позиции: `PositionMaterial` [src/order-editor.ts:7](../../../src/order-editor.ts), `positionsFromOrder` (:89), `duplicatePosition` (:112), `DraftMaterial` [src/shortage.ts:8](../../../src/shortage.ts), `positionLines` (:43) | `issued: boolean` | `issuedQty: number` насквозь: без него черновик позиции снова требовал бы полную норму вместо разницы и `draftShortage` врал бы; клон строки в `duplicatePosition` обнуляет `issuedQty` |
| экраны ([src/components/OrderEditor.tsx:173,177-182](../../../src/components/OrderEditor.tsx), [src/components/OrderPositions.tsx:22,31](../../../src/components/OrderPositions.tsx), [src/components/SeriesList.tsx:41,62](../../../src/components/SeriesList.tsx)) | выданная строка заблокирована целиком: `disabled={row.issued}` на материале, количестве и удалении, подпись `Berilgan · qulflangan` | выбор материала и удаление остаются заблокированы при `issuedQty > 0`; количество становится редактируемым (итог округляется до `max(…, issuedQty)`), подпись — `Berilgan 3 · Kerak 5 l` |

### 4.4 SQL-паритет P2

Миграция `supabase/migrations/20261116_material_issued_qty.sql`:

1. `ALTER TABLE public.erp_order_materials ADD COLUMN issued_qty numeric NOT NULL DEFAULT 0;` +
   `CHECK (issued_qty >= 0 AND issued_qty <= qty AND issued_qty = round(issued_qty, 3))`, затем
   `UPDATE public.erp_order_materials SET issued_qty = qty WHERE issued;` и
   `ALTER TABLE … DROP COLUMN issued;`. Отдельно — `CHECK` на `qty` остаётся как есть.
2. Выдача — не отдельная функция, а цикл внутри ветки `order.issue` в `erp_execute`
   ([supabase/schema.sql:2389-2417](../../../supabase/schema.sql)): `NOT issued` →
   `issued_qty < qty`, движение `v_material.qty - v_material.issued_qty` в `erp_stock_movements`,
   guard склада сравнивает дельту с `erp_stock_qty − erp_reserved_qty` и сохраняет тексты
   `Insufficient stock for issue` (SQL) и `Insufficient reserved stock` / `Insufficient stock`
   (домен, [src/domain.ts:1115-1116](../../../src/domain.ts)), `SET issued_qty = qty,
   actual_cost = …`. `All materials already issued` ([src/domain.ts:1111](../../../src/domain.ts),
   schema.sql:2399) остаётся reachable: он срабатывает, когда дельты нет ни в одной строке.
3. Резерв: `erp_reserved_qty` ([src/domain.ts:496](../../../src/domain.ts) и его SQL-близнец) —
   `qty - issued_qty` вместо `CASE WHEN NOT issued THEN qty`.
4. `erp_revise_materials` ([supabase/schema.sql:1073-1104](../../../supabase/schema.sql)):
   `Issued material quantity cannot change` (schema.sql:1089) заменяется на
   `qty = greatest(v_new_qty, m.issued_qty)` — ошибки нет, как и в домене (§4.2);
   `Issued material cannot be removed` (schema.sql:1085) переписывается на
   `m.issued_qty = 0`. Комментарий-канон над функцией («issued rows freeze», schema.sql:1072)
   правится вместе с поведением.
5. Дельта норм — отдельным шагом ПОСЛЕ замены маршрута, в обоих движках одинаково. Порядок
   вызовов в `erp_execute` сейчас такой: `erp_revise_materials` (:2264) → `erp_revise_route` (:2266),
   то есть в момент правки материалов старые `planned` ещё лежат в `erp_tasks`, а новых ещё нет.
   Поэтому: до `erp_revise_route` собрать `v_old := jsonb_agg(jsonb_build_object('operationId', …,
   'planned', …))` по позиции, после — вызвать новую
   `erp_norm_delta(p_company_id, p_order_id, p_line_id, p_old jsonb, p_new jsonb)`, которая
   разворачивает `erp_operations.norms` (:69) для операций позиции и применяет формулу §4.2.
   В домене — та же последовательность: `oldPlanned` снимается в `revisionLines`
   ([src/domain.ts:462-465](../../../src/domain.ts)) до присваивания нового маршрута.
   `erp_insert_norm_materials` (:1033) для этого НЕ переиспользуется: он накапливает
   (`qty = qty + v_qty`, :1058) и рассчитан только на `order.create` (единственные вызовы —
   :2173, :2190).
6. `order.cancel` / `orderLine.cancel` (schema.sql:2418+, :2444+): возврат со склада
   `issued_qty`, а не `qty`, и `issued_qty = 0`.
7. `erp_snapshot`: `'issuedQty', m.issued_qty` плюс совместимый `'issued', m.issued_qty >= m.qty`.
8. Готовность и отчётность: `erp_ready`, `NOT issued` в ревизии (:2269, :2302), срез отгрузки и
   расчёт себестоимости — везде `issued` → `issued_qty >= qty`, `qty × actual_cost` →
   `issued_qty × actual_cost`.

## 5. Копирайт (узбекская латынь)

| Где | Текст |
|---|---|
| кнопка очереди | `Qabul qilish` |
| заголовок модалки | `Qabul — {amaliyot} · {buyurtma raqami}` |
| поле количества брака | `Brak miqdori` |
| причина | `Brak sababi` |
| подписи кнопки | `Qabul qilish` / `Qabul 9 · Brak 3` / `Hammasi brak — qayta ishlash` |
| сгоревшие материалы | `Brakda sarflangan material` |
| карточка работника | `Qayta ishlash · {miqdor} (brak)` |
| панель журнала | `Brak tarixi` |
| статус в истории работ | `Brak` для `rejected`; `Qabul qilingan` берётся из словаря ([src/i18n.ts:11](../../../src/i18n.ts)) |
| итоги журнала | `Brak (m²)` · `Material qiymati` · `Eng ko‘p brak` |
| чекбокс ставки | `Natijani egasi qabul qiladi` |
| hint чекбокса | `Yoqilmasa, natija topshirilganda darhol qabul qilinadi va ish haqi hisoblanadi.` |
| строка материала (P2) | `Berilgan {issuedQty} · Kerak {qty} {birligi}` |
| причины брака | `quality → Sifat nuqsoni`, `measurement → Noto‘g‘ri o‘lchov`, `drawing → Chizmadagi xato`, `customer → Mijoz topshirig‘i`, `other → Boshqa` |
| ошибка причины | `Defect reason is required` → `Brak sababini tanlang.` |
| ошибка plain-accept | `Review must be plain` → `Qabul qilishda brak maydonlari bo‘lishi mumkin emas.` |
| ошибка пустого брака | `Nothing to reject` → `Brak miqdori nolga teng bo‘lishi mumkin emas.` |

Все новые тексты — через `src/i18n.ts`: это таблица «регулярное выражение английского сообщения →
узбекская фраза», поэтому каждая новая ошибка домена получает в неё строку. Порядок важен —
частные тексты ставятся до общих (`/already (issued|reviewed|…)/`,
[src/i18n.ts:177,187](../../../src/i18n.ts)), иначе `Report already reviewed` съест новый
`Nothing to reject`. Метки причин брака — обычные строки словаря. Узбекская латынь, без кириллицы.

## 6. Тестирование (TDD, SSR-only)

Доменные RED→GREEN, `src/domain.test.ts` (P1):

1. `work.review { accept: false, defectQty = report.qty }` → `payroll.status 'rejected'`, сумма 0,
   этап `in_progress`, `defects.length === 1`;
2. частичный отказ 12/3 → `completed === 9`, `payroll.amount === round(rate × 9)`,
   `task.status 'in_progress'`, строка брака с `qty === 3`;
3. после частичного отказа пересдача 3 и её приёмка → `completed === 12`, сумма `rate × 12`,
   `Σ qty принятых отчётов === completed`;
4. попытка начислить больше `rate × planned` после брака отклоняется
   (`Report exceeds remaining quantity`);
5. `defectMaterials` по норме Bo‘yash (0.25 + 0.1 л/м²) на 3 м² даёт `0.75` и `0.3` литра,
   для операции без норм — `[]`;
6. `defectMaterials` на норме с удалённым `itemId` пропускает строку и не бросает (в отличие от
   `normMaterialLines`, [src/domain.ts:323](../../../src/domain.ts));
7. `reason` обязателен при отказе, `note` обязателен при `other`, `accept: true` с
   `defectQty` отклоняется, `accept: false` с `defectQty === 0` отклоняется;
8. `work.submit` после принятой части создаёт **новую** строку отчёта, принятая не перезаписана;
9. `workHistoryRows` даёт `amount = qty × rate` по строке и статус `Brak` для отклонённой;
10. ни одна ветка отказа не создаёт `movements` и не меняет `issuedQty`.

P2 (домен + склад):

11. ревизия 12→20 м² на выданном заказе: `qty === 5`, `issuedQty === 3`, резерв = 2,
    `ready()`/приёмка заблокированы, пока дельта не выдана;
12. `order.issue` выдаёт только 2 л одним движением, после чего `isIssued` истинно;
13. ревизия 12→4 м² при `issuedQty === 3`: строка округляется до `qty === 3`, ошибки нет,
    резерв `=== 0`;
14. повторная ревизия тех же 20 м² не меняет `qty` (идемпотентность дельты — защита от
    двойного счёта норм);
15. удаление строки с `issuedQty > 0` → `Issued material cannot be removed`;
16. `order.cancel` возвращает ровно `issuedQty`, а не `qty`;
17. себестоимость = `issuedQty × actualCost` в `estimatedCost`, отчёте периода и срезе отгрузки.

UI, SSR-only (`renderToStaticMarkup`, без `fireEvent`/jsdom):

18. доска: этап `submitted` рендерит активную кнопку `Qabul qilish`;
19. модалка: подпись кнопки меняется с `Brak miqdori`, select причин присутствует;
20. панель `Brak tarixi` рендерит строку журнала и итоги;
21. `OperationRateEditor` показывает чекбокс и сохраняет `autoAccept: false`;
22. P2: строка материала показывает `Berilgan 3 · Kerak 5`, поле количества активно при
    `issuedQty > 0`, выбор материала и удаление — нет.

Сервер:

23. контрактный тест `src/defectContract.test.ts` по образцу
    `src/supplierStageContract.test.ts` — строки `erp_defects`, guard'ы и тексты в
    `supabase/schema.sql` присутствуют;
24. PGlite-зонды `.validation-pglite-20261029/validate-defects.mjs` и
    `validate-material-issued-qty.mjs` по шаблону `validate-supplier-stage-cost.mjs`:
    схема + миграция дважды, одинаковая последовательность команд через домен и через
    `erp_execute`, сравнение `erp_snapshot` (включая `defects`, частичную приёмку, дельту нормы,
    возврат при отмене), видимость работника = только свои браки;
25. регрессии: `npx tsc -b`, `npx vitest run`, `npm run build` (порог предупреждения о chunk
    остаётся известным), демо-браузер: покрасочный заказ 12 м² → сдача → частичный брак → пересдача
    → приёмка → журнал; второй прогон — ревизия 12→20 м² на выданном заказе → довыдача 2 л.

## 7. Порядок выката

1. P1 реализуется и проверяется целиком (домен → UI → schema.sql → генератор миграции → зонд).
2. Владелец получает `20261115_defects.sql` для Supabase SQL Editor: preflight-запрос, бэкап,
   `Run`, затем проверка. Проверочный запрос пишется **только на одинарных кавычках** — запрос с
   `position("'supplierCost'" in …)` 2026-11-13 дал `ERROR 42703`, потому что Postgres читает
   токен с ведущей двойной кавычкой как идентификатор.
3. После «Success» владельца — deploy фронта (`npm run deploy`, Worker `erp-tizim`) и проверка
   живого бандла. Оба шага требуют отдельного явного разрешения.
4. P2 — тем же порядком, отдельным разрешением на SQL и на deploy. P1 не зависит от P2 и работает
   без него.
5. Откат: P1 — `DROP TABLE public.erp_defects` + восстановление прежних `CREATE OR REPLACE FUNCTION`
   из канонической схемы до миграции; данные отчётов и начислений не тронуты, поэтому откат
   безопасен. P2 — `ALTER TABLE erp_order_materials ADD COLUMN issued boolean` +
   `UPDATE … SET issued = issued_qty >= qty` + `DROP COLUMN issued_qty` и откат функций;
   выполняется только при отказе P2, поэтому заранее не готовится.

## 8. Риски и совместимость

- **Больше строк отчётов на этап.** Меняется правило переиспользования (§3.3); любое место,
  предполагавшее один отчёт на этап, обязано быть найдено тестами — `employeeStats`
  ([src/App.tsx:772](../../../src/App.tsx)) и `workHistoryRows` исправляются в том же пакете.
- **Снимок работника.** `defects` отдаётся фильтром `employee_id = v_profile.employee_id`; если
  забыть фильтр, работник увидит чужой брак — проверяется зондом, а не глазами.
- **P2 меняет контракт склада.** Удаление `issued` из domain-типов при сохранении ключа `issued` в
  JSON снимка даёт ровно один совместимый релиз; откат фронта без отката SQL невозможен, поэтому
  SQL P2 применяется последним шагом и только вместе с деплоем того же бандла.
- **Перерасход гасится округлением, а не ошибкой.** Ревизия вниз на выданной строке даёт
  `qty = issuedQty` молча (§4.2): смета больше не показывает, что нормы стало меньше, чем уже
  списано. Это принято сознательно (иначе ревизия после любой выдачи стала бы невозможной), и
  именно поэтому излишек возвращается в склад только `inventory.count`, а не правкой заказа.
  Если владелец захочет видеть перерасход — это отдельный бейдж в редакторе, а не снятие
  `CHECK (issued_qty <= qty)`.
- **Живые справочники не трогаем.** `autoAccept: false` для Jilolash/Bo‘yash действует только на
  новые демо-сиды и новый bootstrap; существующие операции включаются вручную.
- **Материалы не возвращаются.** Правило владельца №4 означает, что себестоимость брака остаётся в
  заказе; журнал показывает сумму сгоревшего, но не перекладывает её ни на кого.

## 9. Открытые вопросы

1. Нужна ли когда-нибудь приёмка «частично, но без возврата в работу» (брак засчитан, остаток
   просто урезан до `completed`)? Сегодня нет: `planned` — это обещание клиенту, и уменьшать его
   отказом нельзя. Если появится — отдельная команда `order.reduceStage`, не расширение отказа.
2. Показывать ли журнал брака работнику целиком (сейчас — только свои строки) или только свои +
   сумму по его этапам? Реализуем «только свои»; при смене нужна одна правка фильтра в снимке.
