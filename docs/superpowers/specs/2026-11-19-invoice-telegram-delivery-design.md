# Фактура клиенту в Telegram — дизайн

**Дата:** 2026-11-19
**Задача:** #405…#411
**Статус:** утверждён владельцем («да сделай»); SQL-слой (#406) готов и проверен зондом, клиентская часть в работе
**Пакеты:** один выкатываемый кусок — миграция `20261126_company_profile.sql` (применяет владелец) + один `npm run deploy`

## 1. Задача

Сейчас после принятия заказа клиенту уходит **текст**: `notifyServiceCustomer` в
[src/App.tsx:290](../../../src/App.tsx) ловит `order.create`, и если клиент типа `service`, шлёт
`chatSendText` с текстом из [src/serviceNotify.ts](../../../src/serviceNotify.ts). Кнопка
«Qarz eslatmasi» в чате ([src/components/TelegramChat.tsx:135](../../../src/components/TelegramChat.tsx))
делает то же самое — шлёт строку с суммой долга.

Владелец хочет документ, а не сообщение:

1. клиенту уходит **HISOB-FAKTURA**, текстовые уведомления про текст убираются;
2. фактура отправляется **в момент принятия заказа в работу**, и на ней уже виден долг;
3. кнопка в чате тоже шлёт документ — общий долг по всем обязательствам, а не по одному заказу;
4. на документе есть **название фирмы и её телефон** (раньше клиентская фактура сознательно
   печаталась без реквизитов — это правило владелец отменил).

## 2. Решения владельца

| Вопрос | Решение |
|---|---|
| Формат документа | Картинка **PNG** (не PDF, новая зависимость не нужна) |
| Блок фирмы | Название + телефон. Без STIR, адреса и банковских реквизитов |
| Момент отправки | `order.launch` — заказ принят; **всем** клиентам, у которых есть Telegram-чат |
| Черновики | Не шлют ничего (#377: пустой черновик — не договор) |
| Текст вместо документа | Убрать полностью (`serviceNotify` удаляется) |

PNG выбран вместо PDF по двум причинам: в приложении нет ни одной библиотеки отрисовки, и
добавлять jsPDF/html2canvas нельзя — бандл и без того ~1,08 МБ (открытая задача #365); в PDF с
базовыми шрифтами узбекские буквосочетания с апострофом (`o‘`, `g‘`) рискуют превратиться в
знаки вопроса, а canvas рисует Unicode нативно.

## 3. Данные фирмы (#406)

В `erp_companies` была только `name`. Добавлена одна колонка и одна функция — командное ядро
(`erp_execute`, `erp_snapshot`) не тронуто вообще, поэтому радиус правки минимальный:

- `erp_companies.phone text NOT NULL DEFAULT ''`
- `erp_company_profile_set(p_phone text)` — `SECURITY DEFINER`: админ проверяется через
  `public.erp_is_admin()`, значение обрезается, длиннее 40 символов отклоняется с `22023`,
  запись идёт строго `WHERE id = public.erp_current_company_id()`.
- Ревизию команды функция **не увеличивает**: иначе следующая же команда клиента упёрлась бы в
  `Revision conflict`. Телефон — не часть `State`, он читается отдельно политикой
  `erp_company_read` (SELECT своей компании доступен любой роли).

Миграция: `supabase/migrations/20261126_company_profile.sql`. Контракт:
`src/company-profile-contract.test.ts`. Зонд:
`.validation-pglite-20261029/verify-company-profile-migration.mjs` — миграция применяется дважды,
админ сохраняет телефон, работник отклоняётся, слишком длинный отклоняется, строка читается
любой ролью своей компании, ревизия не двигается.

## 4. Чтение данных фирмы на клиенте (#407)

`src/company-profile.ts` — одна функция `loadCompanyProfile(companyId)`:

- в cloud-режиме — `supabase.from('erp_companies').select('name, phone').eq('id', companyId).single()`;
- в demo-режиме — имя берётся из состояния, телефон пуст;
- значение кэшируется в `localStorage` (`aliya-company-profile:<companyId>`), чтобы автостарт
  после `order.launch` не зависел от того, успеет ли запрос: кэш пишется при каждом чтении,
  а экран «Sozlamalar → Korxona va kirish» показывает телефон полем ввода с кнопкой сохранения
  через `erp_company_profile_set` и тут же обновляет кэш.

`InvoiceModel` ([src/documents.ts:30](../../../src/documents.ts)) получает
`company: { name: string; phone: string }`. Отрицательный тест
`documents.test.ts:182 «prints no enterprise name on a customer invoice»` переворачивается:
теперь модель **обязана** нести имя и телефон фирмы. Печать
([src/components/PrintDocument.tsx:67](../../../src/components/PrintDocument.tsx)) ставит блок
отправителя в шапку: название жирно, ниже телефон; если телефон не заполнен — только название.
Внутренний расчёт (`tannarx`) на документе не появляется (#404).

## 5. PNG-документ (#408)

`src/invoiceImage.ts` — два слоя, чтобы раскладка была тестируемой:

- `layoutInvoice(model, measure)` — чистая функция: принимает модель и функцию замера текста,
  возвращает строку примитивов (`text` / `rule` / `column`) со своими координатами и итоговую
  высоту. Разбивка длинных названий на строки и выбор ширины колонок — здесь же.
- `renderInvoicePng(model): Promise<Blob>` — тонкий адаптер: создаёт canvas
  (ширина 1240 px, ~2× для Retina), вызывает раскладку с `ctx.measureText`, рисует и отдаёт
  `canvas.toBlob('image/png')`.

jsdom canvas не растеризует, поэтому юнит-тесты (`src/invoiceImage.test.ts`) проверяют раскладку
на фиктивной функции замера: заголовок, блок фирмы, строки позиций/товаров, итоги «Jami /
To‘langan / Qarz», отсутствие наложений по Y. Сам PNG проверяется в браузере в демо-режиме.

## 6. Отправка (#409)

`src/invoiceSend.ts`:

```
sendInvoicePng(companyId, customerId, model, fileName)
  = chatSendFile(companyId, customerId, new File([blob], fileName, { type: 'image/png' }), '')
```

`chatSendFile` ([src/chat.ts:389](../../../src/chat.ts)) уже существует: грузит файл в bucket
`telegram-files` и вызывает Edge Function `telegram-send` c `send-file` → `sendDocument`.
Ни Edge Function, ни схема Telegram не меняются. Подпись (caption) пустая — весь смысл в
картинке.

Хук в `App.tsx` переписывается с `order.create` на `order.launch` и с текста на файл:

- сработал только если команда `order.launch`, актёр — `admin` (фактура и так «faqat egasiga
  ochiq»), у клиента есть `telegram_chat_id` (дешёвая проверка через `chatOverview`);
- черновики и серии не шлются: у `isAgreed` ровно эти статусы отсекаются, а долг появляется
  именно на launch;
- очередь (`syncStatus().pending.length > 0`) — не шлём, чтобы документ не ушёл раньше данных;
- любой сбой отправки — только плашка «Buyurtma ishga tushirildi. Hisob-faktura yuborilmadi: …»,
  заказ остаётся принятым. Отправка не откатывает команду и не попадает в офлайн-очередь.

Файл называется `Hisob-faktura-<nomer zakaza>.png` (латиница, без пробелов).

## 7. Кнопка долга (#410)

«Qarz eslatmasi» не может слать фактуру одного заказа: долг клиента — это сумма по всем
обязательствам. Кнопка строит документ **«QARZ HAQIDA»** из
`customerBalance(state, customerId).obligations` ([src/receivables.ts:23](../../../src/receivables.ts)):
строки «Buyurtma · Sana · Summa · To‘langan · Qolgan», итог «Jami qarz», блок фирмы и телефон.
Обязательств нет → кнопка неактивна. Файл: `Qarz-haqida-<familiya>.png`, подпись пустая.
`window.confirm` остаётся (владелец подтверждает, что напоминает про деньги), текст подтверждения
меняется с «xabar» на «hujjat».

## 8. Тесты

| Слой | Проверка |
|---|---|
| SQL-контракт | `src/company-profile-contract.test.ts` — колонка, `SECURITY DEFINER`, guard, `22023`, REVOKE/GRANT, преамбула миграции |
| PGlite | `verify-company-profile-migration.mjs` — миграция дважды, admin/worker, длина, чтение, ревизия |
| Модель | `documents.test.ts` — `company` с именем и телефоном; запрет `tannarx` остаётся |
| Раскладка | `invoiceImage.test.ts` — координаты, переносы, отсутствие наложений (фиктивный measure) |
| Отправка | `invoiceSend.test.ts` — имя файла, `image/png`, пустая caption, отсутствие сети в demo |
| Ручная | Браузер (demo): печать с блоком фирмы, генерация PNG, кнопка долга |

## 9. Порядок выката

1. Владелец применяет `20261126_company_profile.sql` в Supabase SQL Editor (по своему разрешению).
2. Владелец вводит телефон в Sozlamalar → Korxona va kirish.
3. `npm run deploy` — один раз, фронтенд.
4. Живой прогон: черновик → «Sexga ishga tushirish» → в чате клиента появляется PNG-фактура с
   названием и телефоном; «Qarz eslatmasi» → документ по общему долгу.
