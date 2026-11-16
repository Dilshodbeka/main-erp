# Центр поддержки: FAQ и переписка «работник ↔ админ» в Yordamchi

**Дата:** 2026-11-12
**Статус:** архитектура одобрена владельцем в диалоге; документ ожидает ревью владельца
**Реализация:** не начата; SQL-миграция к живой базе и deploy не входят в этот документ
**Часть дорожной карты:** Часть 4, последний под-проект «центр поддержки»

## 1. Цель и границы

Сейчас помощь внутри Aliya ERP заканчивается на вкладке «Qo‘llanma» в панели Yordamchi
([src/components/Guide.tsx:50](../../../src/components/Guide.tsx)): работник читает инструкцию, но если
что-то пошло не так — написать некому. Владелец получает вопрос в мессенджере без контекста («не
работает») и вынужден выяснять раздел, версию сборки и текст ошибки вручную.

Цель: **внутри Yordamchi появляется третья вкладка «Murojaat»** — короткий FAQ с поиском и переписка
работника с админом компании, где к первому сообщению автоматически прикладывается диагностика (раздел,
ревизия, сеть, очередь, версия сборки, последние ошибки) с маскировкой длинных чисел.

Первая версия включает:

- третью вкладку «Murojaat» рядом с «Qadamlar» и «Qo‘llanma»; при отсутствии пропа поддержки панель
  остаётся двухвкладочной, поэтому существующие SSR-тесты не меняются;
- статический FAQ из 8 вопросов-ответов на узбекской латыни с поиском (`src/support-faq.ts`, без БД);
- переписку работник ↔ админ: создание обращения, ответы, закрытие админом, повторное открытие ответом;
- авто-диагностику в первом сообщении: раздел, ревизия, `online/offline`, размер офлайн-очереди, версия
  сборки, до 5 последних записей журнала ошибок; цифры от 4 знаков маскируются (`[son]`);
- одну коллекцию `tickets` в `State`, одну таблицу `erp_support_tickets` и одну ветку снимка;
- серверную фильтрацию видимости: админ видит все обращения компании, работник — только свои;
- клиентские метки «прочитано» в `localStorage` без отдельной команды и без записей в аудите;
- контрактный тест паритета с `supabase/schema.sql` и PGlite-зонд равенства поведения домена и SQL.

Первая версия **не** включает:

- вложения, файлы и скриншоты (объём, вирусы, хранилище — отдельный под-проект);
- редактирование FAQ из интерфейса (вопросы меняются вместе с релизом);
- эскалацию вендору и внешнюю поддержку — админ компании отвечает сам;
- Telegram, push и email-уведомления (работничьи Telegram-уведомления удалены владельцем ранее);
- нумерацию обращений (`T-0001`), SLA, приоритеты, категории и теги;
- удаление и редактирование сообщений, удаление и архивацию обращений;
- пагинацию переписки — предел в 200 сообщений делает её ненужной;
- серверные отметки прочтения и счётчики непрочитанного;
- демо-сид обращений: демо стартует с пустой коллекцией, тесты создают обращения сами.

## 2. Согласованные правила (решения владельца)

1. **Аудитория — работник → админ компании.** Никакой внешней поддержки: FAQ и обращения живут внутри
   Aliya, офлайн-первый режим сохраняется.
2. **Место — третья вкладка «Murojaat» в Yordamchi**, рядом с «Qadamlar» и «Qo‘llanma».
3. **Форма — переписка работник ↔ админ.** Двусторонняя нить, статусы «Ochiq» / «Yopilgan»; работник
   видит только свои обращения, админ — все обращения компании.
4. **Вложение — текст + авто-диагностика.** Карточка окружения и последние записи журнала ошибок; файлов
   нет; длинные числа маскируются.
5. **FAQ — статический, в коде.** 6–8 вопросов рядом с «Qo‘llanma», с поиском; редактора FAQ нет.
6. **Модель данных — A: одна коллекция.** Одно обращение = одна запись с вложенным массивом сообщений:
   одна коллекция в снимке, одна таблица, одна миграция.

Правила, вытекающие из решений:

7. **Автор всегда берётся из сессии** (`actor` в домене, `erp_current_profile()` на сервере), а не из тела
   команды. Подставить чужое имя или роль в запросе нельзя.
8. **Закрывает только админ.** Ответ работника в закрытое обращение снова открывает его; отдельной кнопки
   «открыть» нет.
9. **«Yangi javob» — вычисляемый признак**, а не хранимое поле: для админа это открытые обращения, где
   последнее сообщение написал работник; для работника — обращение, последнее сообщение которого написал
   админ и которое работник ещё не открывал. Серверные read-receipts не хранятся.
10. **Команды идут обычным путём**: `applyCommand`/`erp_execute`, офлайн-очередь, ревизия и аудит. Команды
    `ticket.seen` нет: отметка прочтения — локальный индикатор, а не бизнес-событие.

## 3. Модель и команды

### 3.1 Типы (`src/types.ts`)

Типы добавляются рядом с `State` ([src/types.ts:121-125](../../../src/types.ts)); состояние получает
обязательное поле `tickets: SupportTicket[]`.

```ts
export type TicketRole = 'admin' | 'worker';
export type TicketStatus = 'open' | 'closed';

export type TicketContext = {
  page: string;                  // id раздела, 1–40 символов
  revision: number;              // безопасное целое ≥ 0
  sync: 'online' | 'offline';
  pending: number;               // 0–999
  build: string;                 // __BUILD_ID__, 1–60 символов
  errors: string[];              // ≤ 5 строк по ≤ 300 символов, цифры ≥ 4 маскированы
};

export type TicketMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  at: string;
  text: string;
  context: TicketContext | null; // только у первого сообщения
};

export type SupportTicket = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: TicketRole;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  messages: TicketMessage[];     // 1–200
};
```

### 3.2 Команды

В объединение `Command` ([src/types.ts:147-205](../../../src/types.ts)) добавляются три команды:

| Команда | Поля | Пишет |
|---|---|---|
| `ticket.create` | `text: string`, `context: TicketContext \| null` | обращение + первое сообщение |
| `ticket.reply` | `ticketId: string`, `text: string` | сообщение без контекста, `updatedAt`, при необходимости переоткрывает |
| `ticket.close` | `ticketId: string` | `status: 'closed'`, `closedAt`, `closedByName` |

`mutate` ([src/domain.ts:781](../../../src/domain.ts)) получает три ветки рядом с `routeTemplate.*`
(стиль — [src/domain.ts:1404-1418](../../../src/domain.ts)). Возвращаемое значение — id обращения, поэтому
существующий аудит автоматически получает `entityId` равным id обращения
([src/domain.ts:1607](../../../src/domain.ts)).

### 3.3 Валидация и точные тексты

Валидация одинакова в домене и SQL; тексты исключений совпадают побайтно, как у остальных команд.

| Правило | Точный текст |
|---|---|
| `text` не строка / после `trim()` пуст | `Ticket text is required` |
| `text` после `trim()` длиннее 2000 | `Ticket text is too long` |
| `ticketId` не найден или чужой для работника | `Ticket not found` |
| в обращении уже 200 сообщений | `Ticket is full` |
| `context` не `null` и нарушает любое из полей 3.1 | `Invalid ticket context` |

Правила применения:

1. `ticket.create`: сначала проверяется `text`, затем `context`; `context: null` допустим.
2. `ticket.reply`: сначала поиск обращения с проверкой владельца, затем `text`, затем лимит 200 сообщений.
3. `ticket.close`: только админ; работник получает `Administrator action required` на общем
   белом списке (п. 3.4), не доходя до ветки. Повторное закрытие — no-op по данным, но команда проходит
   обычный путь (ревизия и аудит).
4. `context` сохраняется только у первого сообщения; ответы всегда пишут `context: null`.
5. `display` не может выполнять команды вовсе: общий отказ `Invalid actor role`
   ([src/domain.ts:1582](../../../src/domain.ts)).

Новые тексты получают узбекские переводы в `errorMessages` ([src/i18n.ts:174](../../../src/i18n.ts)) и
вставляются **до** общих правил `/not assigned|administrator action|workers may only|…/`
([src/i18n.ts:190](../../../src/i18n.ts)) и `/fetch failed|…/`
([src/i18n.ts:202](../../../src/i18n.ts)):

| Серверный текст | Текст в интерфейсе |
|---|---|
| `Ticket text is required` | `Murojaat matnini kiriting.` |
| `Ticket text is too long` | `Murojaat matni 2000 belgidan oshmasligi kerak.` |
| `Ticket not found` | `Murojaat topilmadi. Sahifani yangilang va qayta urinib ko‘ring.` |
| `Ticket is full` | `Bu murojaatga boshqa xabar qo‘shilmaydi: 200 ta xabar chegarasiga yetdi. Yangi murojaat oching.` |
| `Invalid ticket context` | `Diagnostika ma’lumoti noto‘g‘ri. Sahifani yangilang va qayta yuboring.` |

### 3.4 Права и видимость

1. Белый список работника расширяется в двух местах одинаково:
   `['work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply']` —
   [src/domain.ts:1585](../../../src/domain.ts) и
   [supabase/schema.sql:1792-1793](../../../supabase/schema.sql). `ticket.close` в белый список не входит.
2. Домен `ticket.reply` и `ticket.close` ищет обращение по id; `ticket.reply` для работника дополнительно
   требует `ticket.authorId === actor.id`; чужое обращение даёт тот же `Ticket not found`, что и
   несуществующее.
3. В облаке снимок уже отфильтрован сервером (п. 5.3); в демо-режиме фильтрацию выполняет
   `visibleTickets(tickets, actor)` (п. 4.2), потому что localStorage демо общий.
4. `ticket.close` в домене дополнительно проверяет `actor.role === 'admin'` с текстом
   `Administrator action required` — защита от будущего расширения белого списка.

### 3.5 «Yangi javob» и метки прочтения

Чистые функции живут в `src/support.ts`:

```ts
export type SeenMap = Record<string, string>; // ticketId -> id последнего прочитанного сообщения

export function visibleTickets(tickets: SupportTicket[], actor: Actor): SupportTicket[];
export function sortedTickets(tickets: SupportTicket[]): SupportTicket[]; // updatedAt desc, затем id
export function lastMessage(ticket: SupportTicket): TicketMessage | null;
export function hasUnread(ticket: SupportTicket, actor: Actor, seen: SeenMap): boolean;
export function needsReply(ticket: SupportTicket): boolean;   // open && последнее сообщение работника
export function supportAlerts(tickets: SupportTicket[], actor: Actor, seen: SeenMap): number;
export function seenStorageKey(companyId: string, actorId: string): string;
export function readSeen(storage: Pick<Storage, 'getItem'>, key: string): SeenMap;
export function writeSeen(storage: Pick<Storage, 'setItem'>, key: string, seen: SeenMap): void;
```

Правила:

1. `visibleTickets`: админ — все; работник — только `authorId === actor.id`; `display` — пусто.
2. `hasUnread`: только для работника; истинно, если последнее сообщение написал админ и `seen[ticket.id]`
   не равен id этого сообщения. Метка ставится при открытии нити.
3. `needsReply`: `status === 'open'` и последнее сообщение написал работник. Для закрытых — ложно.
4. `supportAlerts`: работник — число `hasUnread`, админ — число `needsReply`, `display` — 0.
5. Ключ хранилища — `aliya-erp-support-seen:${companyId}:${actor.id}`; значение — JSON-объект `SeenMap`.
   Повреждённый JSON читается как `{}`. Очистка localStorage теряет только индикатор, не данные.
6. Отдельной команды `ticket.seen` нет: она бы писала аудит и ревизию на каждый просмотр.

## 4. Интерфейс

### 4.1 Третья вкладка в Yordamchi

`GuidePanel` ([src/components/Guide.tsx:50-64](../../../src/components/Guide.tsx)) получает необязательный
проп:

```tsx
export function GuidePanel({ guide, onAction, close, support }: {
  guide: PageGuide; onAction: (action: GuideAction) => void; close: () => void;
  support?: SupportProps;
})
```

- `tab: 'steps' | 'manual' | 'support'`; кнопка «Murojaat» с иконкой `MessageSquare` рендерится только
  при наличии `support`, поэтому старые вызовы и SSR-тесты остаются двухвкладочными.
- Счётчик `supportAlerts(...) > 0` показывается бейджем на кнопке вкладки и точкой на `GuideFab`.
- Подзаголовок диалога на вкладке поддержки: `Tez savollar va murojaatlar`.
- Остальные вкладки не меняются.

```ts
export interface SupportProps {
  tickets: SupportTicket[];   // уже отфильтрованные через visibleTickets
  actor: Actor;
  build: string;              // __BUILD_ID__
  page: string;               // текущий раздел (App: current)
  sync: 'online' | 'offline';
  pending: number;            // syncStatus().pending.length
  errors: string[];           // последние сообщения журнала диагностики
  seen: SeenMap;
  onSeen: (ticketId: string, messageId: string) => void;
  run: (command: Command) => Promise<boolean>;
}
```

Компонент — `SupportPanel` в новом файле `src/components/Support.tsx`; внутренние экраны (список, форма,
нить) переключаются локальным состоянием, дополнительных диалогов не заводят.

### 4.2 FAQ

Новый модуль `src/support-faq.ts`, только данные и чистый поиск:

```ts
export type SupportFaq = { id: string; question: string; answer: string };
export const supportFaq: SupportFaq[];                       // ровно 8 записей
export function searchFaq(query: string, items?: SupportFaq[]): SupportFaq[];
```

Ответы — 2–4 предложения, собранные из содержания `src/manual.ts` и только реальных названий кнопок
интерфейса. Вопросы:

1. Qanday qilib yangi buyurtma yarataman?
2. Sexda ishni qanday qabul qilaman?
3. Materialni omborga qanday qabul qilaman?
4. Kassaga to‘lovni qanday kiritaman?
5. Xodimga tizimga kirish huquqini qanday beraman?
6. Oylik va avans qanday hisoblanadi?
7. Oflayn rejimda nima ishlaydi?
8. Muammo bo‘lsa, kimga murojaat qilaman?

Поиск: `query.trim().toLocaleLowerCase('uz')`; пустой запрос возвращает все записи; совпадение — подстрока
в `question + ' ' + answer` без учёта регистра. Нет результатов — строка `Savol topilmadi.` Аккордеон
FAQ стоит вверху вкладки, над блоком обращений, и виден обеим ролям.

### 4.3 Работник

- Заголовок `Murojaatlar`, кнопка `Yangi murojaat`; пустой список: `Hozircha murojaatlar yo‘q. Muammo
  bo‘lsa, «Yangi murojaat» orqali yozing.`
- Список — только свои обращения, сортировка `sortedTickets`; строка: статус-чип `Ochiq`/`Yopilgan`,
  последнее сообщение, дата `dateTime(updatedAt)`, чип `Yangi javob` при `hasUnread`.
- Форма нового обращения: `Field`-textarea «Muammoni yozing» (счётчик длины не показывается, предел 2000),
  карточка «Avtomatik ma’lumot» (раздел, версия, `online/offline`, очередь, до 5 последних ошибок),
  кнопки `Yuborish` / `Bekor qilish`. `context` собирается `buildTicketContext` (п. 4.5).
- Нить: сообщения `authorName · dateTime(at)`, свои — класс `own`; у первого сообщения раскрывающийся
  блок `Diagnostika` с полями контекста. Внизу textarea `Javob yozing…` и `Yuborish`; для закрытого
  обращения — примечание `Murojaat yopilgan. Javob yozsangiz, u qayta ochiladi.`
- Открытие нити вызывает `onSeen(ticket.id, lastMessage.id)`, если последнее сообщение от админа.
- Кнопки закрытия у работника нет.

### 4.4 Админ

- Заголовок `Barcha murojaatlar`; фильтр `Ochiq` / `Yopilgan` / `Hammasi`, по умолчанию `Ochiq`.
- Строка списка: имя работника, статус, последнее сообщение, дата, чип `Yangi javob` при `needsReply`.
- Нить: те же сообщения и `Diagnostika`; внизу textarea ответа, кнопки `Yuborish` и `Yopish`
  (`Yopish` только для открытого обращения). Закрытое обращение показывает
  `Yopilgan: {closedByName} · {dateTime(closedAt)}`.
- Ответ и закрытие идут через `run(...)`; ошибки показывает существующий обработчик `apply`
  ([src/App.tsx:268-284](../../../src/App.tsx)), панель ничего не глотает.
- `display` видит только FAQ и строку `Bu ekranda murojaat yuborish o‘chirilgan.`

### 4.5 Сборка контекста

`src/support.ts` также экспортирует:

```ts
export interface TicketContextInput {
  page: string; revision: number; online: boolean; pending: number; build: string; errors: string[];
}
export function buildTicketContext(input: TicketContextInput): TicketContext;
export function normalizeTicketContext(value: unknown): TicketContext | null;
```

1. `buildTicketContext` подставляет `page: input.page || 'app'`, `sync: online ? 'online' : 'offline'`,
   обрезает `errors` до 5 записей и каждую до 300 символов, маскируя цифры от 4 знаков через `redact`
   ([src/diagnostics.ts:35](../../../src/diagnostics.ts) — добавляется `export`, поведение не меняется).
   Затем прогоняет результат через `normalizeTicketContext`.
2. `normalizeTicketContext` — единственный валидатор формы контекста; `null` пропускает, объект проверяет по
   границам 3.1: строки обрезает по краям (после чего они обязаны остаться в границах), числа принимает
   только числового типа — строки вида `"5"` отвергаются, `revision` обязан быть безопасным целым ≥ 0,
   `pending` — целым 0–999; при нарушении бросает `Error('Invalid ticket context')`. Домен вызывает его для
   `command.context`, поэтому клиент и сервер проверяют одно и то же.

### 4.6 Интеграция в App

`App.tsx`:

- состояние `supportSeen` инициализируется `readSeen(localStorage, seenStorageKey(actor.companyId, actor.id))`,
  пересчитывается при смене актора; `markSeen(ticketId, messageId)` обновляет состояние и `writeSeen`;
- `const supportTickets = visibleTickets(state.tickets, actor);`
- `const supportErrorMessages = () => listDiagnostics(localStorage).slice(-5).map(row => row.message);`
- `GuideFab` ([src/App.tsx:548](../../../src/App.tsx)) получает новый необязательный проп `alert?: boolean`
  (точка `.guide-dot`, `aria-label` не меняется); значение — `supportAlerts(supportTickets, actor, supportSeen) > 0`;
- `GuidePanel` ([src/App.tsx:549](../../../src/App.tsx)) получает `support` со всеми полями `SupportProps`;
  `page` — существующая переменная `current` ([src/App.tsx:433](../../../src/App.tsx)).

### 4.7 Стили

`src/styles.css`: новые классы `.guide-tab-badge`, `.guide-dot`, `.support-panel`, `.support-faq`,
`.support-search`, `.support-list`, `.support-row`, `.support-chip`, `.support-thread`, `.support-message`,
`.support-message.own`, `.support-compose`, `.support-context` в спокойной зелёной палитре интерфейса;
красный — только точка/бейдж непрочитанного. Мобильные правила добавляются в существующий
`@media(max-width:700px)` (без новых брейкпоинтов): сообщения на всю ширину, textarea не ниже 110px,
зоны нажатия кнопок не ниже 44px, шрифт не мельче 11px — как в действующих мобильных правилах.

## 5. Сервер и синхронизация

### 5.1 Таблица

В каноническом `supabase/schema.sql` после `erp_route_templates`
([supabase/schema.sql:352-363](../../../supabase/schema.sql)) добавляется таблица по тому же образцу:

```sql
CREATE TABLE public.erp_support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('admin', 'worker')),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  messages jsonb NOT NULL CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  closed_at timestamptz,
  closed_by_name text,
  UNIQUE (company_id, id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK ((status = 'closed') = (closed_by_name IS NOT NULL))
);
CREATE INDEX erp_support_tickets_company_idx ON public.erp_support_tickets(company_id);
CREATE INDEX erp_support_tickets_author_idx ON public.erp_support_tickets(company_id, author_id);
```

Внешнего ключа на `erp_employees` нет: автор-админ не является сотрудником, `author_id` — профиль админа
или `employee_id` работника, ровно как в аудите
([supabase/schema.sql:2961-2963](../../../supabase/schema.sql)). Сообщения хранятся в camelCase-форме
`TicketMessage`, поэтому снимок отдаёт их без преобразования.

### 5.2 RLS

Таблица добавляется в массив цикла RLS ([supabase/schema.sql:597-608](../../../supabase/schema.sql)):
`ENABLE ROW LEVEL SECURITY`, `REVOKE ALL`, `GRANT SELECT`, политика `erp_admin_read` — прямые чтения через
PostgREST остаются админскими; работник получает свои обращения только из `erp_snapshot` (SECURITY DEFINER).

### 5.3 Снимок

В `erp_snapshot`, сразу после `'routeTemplates'` ([supabase/schema.sql:1587-1589](../../../supabase/schema.sql)),
добавляется массив:

```sql
'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'authorId', t.author_id,
  'authorName', t.author_name, 'authorRole', t.author_role, 'status', t.status,
  'createdAt', t.created_at, 'updatedAt', t.updated_at, 'closedAt', t.closed_at,
  'closedByName', t.closed_by_name, 'messages', t.messages) ORDER BY t.updated_at, t.id), '[]'::jsonb)
  FROM public.erp_support_tickets t WHERE t.company_id = v_company
    AND (v_admin OR t.author_id = v_profile.employee_id)),
```

Фильтр повторяет `workerDeductions` ([supabase/schema.sql:1590-1593](../../../supabase/schema.sql)):
админ получает всё, работник — только `author_id = v_profile.employee_id`.

### 5.4 `erp_execute`

1. Белый список работника ([supabase/schema.sql:1792-1793](../../../supabase/schema.sql)) расширяется
   `ticket.create` и `ticket.reply`; `ticket.close` остаётся админским.
2. Новая IMMUTABLE-функция `public.erp_ticket_context(p_value jsonb) returns jsonb` рядом с хелперами
   ([supabase/schema.sql:496-560](../../../supabase/schema.sql)): `NULL`/`jsonb null` → `NULL`; иначе
   проверяет и нормализует поля по границам 3.1 и при нарушении бросает `Invalid ticket context`
   (`ERRCODE = '22023'`). Функция добавляется в финальный `REVOKE ALL ON FUNCTION`
   ([supabase/schema.sql:2968](../../../supabase/schema.sql)) — как остальные хелперы.
3. В `DECLARE` добавляются `v_ticket public.erp_support_tickets%ROWTYPE`, `v_context jsonb`,
   `v_author uuid`. `v_author` заполняется в ветках `ticket.create` и `ticket.reply` одной и той же
   CASE-формулой (профиль админа или `employee_id` работника).
4. Ветки `CASE` (стиль — `routeTemplate.*`, [supabase/schema.sql:2685-2713](../../../supabase/schema.sql)):
   - `ticket.create`: `text` через `erp_text(..., true)` + `btrim` + проверки `''`/`length > 2000`;
     `v_context := public.erp_ticket_context(p_command -> 'context')`;
     `v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END`;
     `v_entity := gen_random_uuid()`; вставка строки со статусом `open` и одним сообщением
     (`context` — `v_context`, `at` — `transaction_timestamp()`).
   - `ticket.reply`: `v_entity := erp_uuid(p_command -> 'ticketId', 'ticketId')`;
     `SELECT … FOR UPDATE`; не найдено или (не админ и `author_id <> v_author`) → `Ticket not found`;
     те же проверки текста; `jsonb_array_length(messages) >= 200` → `Ticket is full`; `UPDATE` с
     `messages || jsonb_build_array(...)`, `status = 'open'`, `closed_at = NULL`, `closed_by_name = NULL`,
     `updated_at = transaction_timestamp()`.
   - `ticket.close`: поиск `FOR UPDATE`; `Ticket not found`; если `open` — `UPDATE` на `closed`,
     `closed_at = transaction_timestamp()`, `closed_by_name = v_actor.name`; повторное закрытие ничего
     не меняет.
   - Порядок проверок совпадает с доменом: поиск → текст → лимит (для ответа), текст → контекст (для
     создания).
5. Аудит, ревизия и блокировка ревизии не меняются: `v_entity` — id обращения, `action` — тип команды.

### 5.5 Новая коллекция во фронтенде

| Файл | Изменение |
|---|---|
| `src/types.ts` | типы 3.1; `tickets: SupportTicket[]` в `State` |
| `src/domain.ts:464` | `tickets: []` в `emptyState()` ([src/domain.ts:462-464](../../../src/domain.ts)) |
| `src/migrations.ts` | `tickets: Array.isArray(source.tickets) ? source.tickets as SupportTicket[] : []` рядом с `routeTemplates` ([src/migrations.ts:137](../../../src/migrations.ts)); **в `collections` ([src/migrations.ts:7-10](../../../src/migrations.ts)) не добавлять** — иначе существующие снимки v4 без поля будут отвергнуты; версия остаётся 4 |
| `src/sync.ts:25` | `'tickets'` в список массивов `verifiedSnapshot` ([src/sync.ts:25](../../../src/sync.ts)) |

Каталог `src/seed.ts` не меняется: демо строится из `emptyState()` ([src/seed.ts:4-7](../../../src/seed.ts)),
коллекция появляется пустой автоматически.

### 5.6 Миграция и PGlite-зонд

- Генератор `.validation-pglite-20261029/generate-support-tickets-migration.mjs` по образцу
  `generate-route-templates-migration.mjs`: `require(...)` на таблицу, `'tickets', (SELECT`, три ветки
  `WHEN 'ticket.*' THEN`, фильтр `t.author_id = v_profile.employee_id`; копирует финальные тела
  `erp_ticket_context`, `erp_snapshot`, `erp_execute` из `supabase/schema.sql` в
  `supabase/migrations/20261112_support_tickets.sql` с `CREATE OR REPLACE FUNCTION`; DDL — с
  `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, повторный прогон безопасен.
- Зонд `.validation-pglite-20261029/validate-support-tickets.mjs` по образцу `validate-route-templates.mjs`:
  применяет `schema.sql` + миграцию (дважды — идемпотентность) и проверяет: создание работником,
  фильтрацию снимка (работник видит только своё, админ всё), ответ админа, `Ticket not found` на чужое
  обращение, отказ работнику на `ticket.close` (`Workers may only perform their own assigned work`),
  повторное закрытие, переоткрытие ответом, лимиты текста/контекста/200 сообщений, сохранение контекста
  в первом сообщении.
- Облачная копия не правится: `erp_backup_tables()` строит список таблиц по графу внешних ключей от
  `erp_companies` ([supabase/migrations/20261104_backup_dump_restore.sql](../../../supabase/migrations/20261104_backup_dump_restore.sql)),
  новая таблица попадает в дамп автоматически.

### 5.7 Порядок выката

1. SQL-миграция `20261112_support_tickets.sql` в живую базу — только по отдельному разрешению владельца.
2. Затем deploy фронтенда. Обратный порядок запрещён: `verifiedSnapshot` с `'tickets'` отвергнет старый
   облачный снимок.
3. После обновления у устройств с кэшем старше деплоя возможен один отказ «Server natijani to‘g‘ri snapshot
   bilan tasdiqlamadi…» — лечится одним онлайн-входом (кэш живёт не более 24 часов).
4. Откат фронтенда безопасен: таблица аддитивная, старый бандл её просто не читает.

## 6. Проверка

1. `src/domain.test.ts` — новый блок:
   - `ticket.create` берёт автора из актора, кладёт контекст только в первое сообщение, обрезает пробелы,
     пишет аудит с `entityId` = id обращения;
   - пустой и 2001-символьный текст — ровно `Ticket text is required` / `Ticket text is too long`;
   - `context` с нарушенным значением поля (например, `pending: 1000`) — `Invalid ticket context`,
     `context: null` проходит;
   - работник создаёт и отвечает на своё; ответ на чужое — `Ticket not found`; `ticket.close` работником —
     `Administrator action required`; `display` — `Invalid actor role`;
   - ответ админа в закрытое обращение переоткрывает его (`status: 'open'`, `closedAt: null`);
   - повторное закрытие — no-op, но команда возвращает id;
   - 200 сообщений — `Ticket is full`.
2. `src/support.test.ts` (чистые функции):
   - `buildTicketContext` маскирует `1234` → `[son]`, режет ошибки до 5×300, подставляет `app` для пустого
     раздела и `online/offline` из флага;
   - `normalizeTicketContext` принимает предельные значения (page 40 символов, build 60, pending 0 и 999,
     revision 9007199254740991, errors 5×300) и отвергает page 41, build 61, pending 1000, дробную и
     превышающую безопасное целое ревизию, 6 ошибок, строку ошибки в 301 символ и числовые поля-строки;
   - `visibleTickets` / `sortedTickets` / `lastMessage` / `hasUnread` / `needsReply` / `supportAlerts` на
     фикстуре из трёх обращений (своё непрочитанное, своё закрытое, чужое);
   - `readSeen`/`writeSeen` с фейковым storage, повреждённый JSON → `{}`;
   - `seenStorageKey` содержит companyId и actorId.
3. `src/support-faq.test.ts`: ровно 8 записей, уникальные id, непустые ответы; поиск по регистру и
   подстроке, пустой запрос — все, «zzz» — `[]`.
4. `src/support-ui.test.tsx` (SSR через `renderToStaticMarkup`, jsdom в проекте нет):
   - `GuidePanel` без пропа `support` — ровно две вкладки, слова «Murojaat» нет; с пропом — три вкладки и
     бейдж непрочитанного;
   - список работника показывает своё обращение с чипом `Yangi javob` и не показывает чужое;
   - список админа показывает оба обращения, фильтр по умолчанию скрывает закрытое;
   - нить рендерит сообщения, блок `Diagnostika` и примечание о переоткрытии для закрытого обращения;
   - FAQ рендерит все 8 вопросов; пустой список обращений даёт текст пустого состояния.
5. `src/ticketContract.test.ts` — паритет с `supabase/schema.sql`: есть `CREATE TABLE
   public.erp_support_tickets`, `'tickets', (SELECT`, фильтр `t.author_id = v_profile.employee_id`, три
   `WHEN 'ticket.*' THEN`, `erp_ticket_context`, точные `RAISE EXCEPTION` тексты из 3.3 и белый список
   работника с `ticket.create`/`ticket.reply` без `ticket.close`.
6. `src/i18n.test.ts` — пять новых маппингов из 3.3 дают узбекские тексты и не перехватываются общими
   правилами.
7. PGlite-зонд 5.6 зелёный; генератор миграции воспроизводит файл байт-в-байт (повторный прогон даёт тот же
   `sha256`).
8. Итоговые проверки (рабочая папка не Git-репозиторий, вместо коммитов): `npm test`,
   `npx tsc -b --pretty false`, `npm run build`, браузер в демо-режиме: работник создаёт обращение с
   карточкой диагностики, админ после переключения профиля видит его, отвечает, закрывает; FAQ фильтруется
   поиском; точка на `GuideFab` и бейдж вкладки появляются и исчезают после прочтения. В управляемом браузере
   viewport отдаёт `innerWidth = 0`, поэтому адаптивность держится на CSS-тестах и мобильных правилах
   4.7, а в браузере проверяются текст, атрибуты и `getComputedStyle` отдельных узлов — это ограничение
   называется прямо.
9. Живые SQL-изменения и deploy в этот документ не входят; выполняются только по отдельному разрешению
   владельца с именем `erp-tizim`.

## 7. Риски

| Риск | Оценка | Гашение |
|---|---|---|
| Старый облачный кэш без `tickets` | `verifiedSnapshot` отвергнет снимок, интерфейс покажет ошибку | порядок 5.7: миграция → deploy; один онлайн-вход; кэш ≤ 24 ч |
| Демо хранит все обращения в общем localStorage | работник в демо технически может увидеть чужие данные | демо — не продакшн-граница; облако фильтрует на сервере, PGlite-зонд доказывает |
| Рост снимка | 200 сообщений × 2000 символов ≈ 400 КБ на обращение | лимиты 3.3 и 200 сообщений; пагинация — вторая версия |
| Рассинхронизация домена и SQL | разные тексты/правила в офлайне и облаке | контрактный тест 6.5 + PGlite-зонд 5.6 |
| Потеря прочитанности при очистке localStorage | пропадут только чипы «Yangi javob» | индикатор не является данными; правило 3.5.5 |
| Шум аудита от переписки | каждая команда пишет запись аудита | принято: аудит — требование проекта; `ticket.seen` не существует |
| Подмена автора в запросе | чужое имя/роль в обращении | автор только из актора и `erp_current_profile()` (п. 2.7) |
| Закрытие работником | нарушение правила «закрывает админ» | белый список в двух местах + проверка в `mutate` + контрактный тест |
