-- Удаление выбранных заказов вместе со всем, что на них ссылается (FK-граф erp_orders).
-- Использование: Supabase SQL Editor, двумя шагами.
--
-- ШАГ 1 — посмотреть список заказов и скопировать id нужных:
--   SELECT id, title, status, price, created_at::date AS created
--     FROM erp_orders ORDER BY created_at DESC;
-- (можно отфильтровать: WHERE status = 'draft' или title ILIKE '%тест%')
--
-- ШАГ 2 — вставить эти id в массив ниже и выполнить весь скрипт целиком.
-- Идемпотентен: повторный запуск ничего не ломает. Обратного хода нет —
-- перед запуском скачайте erp_orders через Table Editor → Download CSV.

BEGIN;

CREATE TEMP TABLE _del_orders ON COMMIT DROP AS
  SELECT id FROM public.erp_orders
  WHERE id IN (
    -- === ВСТАВЬТЕ СЮДА id ЗАКАЗОВ, ЧЕРЕЗ ЗАПЯТУЮ ===
    '00000000-0000-0000-0000-000000000000'
  );

CREATE TEMP TABLE _del_items ON COMMIT DROP AS
  SELECT i.id FROM public.erp_order_items i
  WHERE i.order_id IN (SELECT id FROM _del_orders);

CREATE TEMP TABLE _del_ships ON COMMIT DROP AS
  SELECT s.id FROM public.erp_shipments s
  WHERE s.order_id IN (SELECT id FROM _del_orders);

-- Дети сначала: брак → зарплата → отчёты работ → задачи
DELETE FROM public.erp_defects        WHERE order_id IN (SELECT id FROM _del_orders);
DELETE FROM public.erp_payroll        WHERE order_id IN (SELECT id FROM _del_orders);
DELETE FROM public.erp_work_reports   WHERE order_id IN (SELECT id FROM _del_orders);
DELETE FROM public.erp_tasks          WHERE order_id IN (SELECT id FROM _del_orders);

-- Отгрузки по заказу
DELETE FROM public.erp_shipment_lines
  WHERE shipment_id IN (SELECT id FROM _del_ships)
     OR line_id     IN (SELECT id FROM _del_items);
DELETE FROM public.erp_shipments      WHERE id IN (SELECT id FROM _del_ships);

-- Материалы заказа
DELETE FROM public.erp_order_materials WHERE order_id IN (SELECT id FROM _del_orders);

-- Движения склада, созданные этими заказами: выдача ('order'), выпуск готового
-- ('production'), продажа ('sale' по отгрузке) — остатки материалов возвращаются.
DELETE FROM public.erp_stock_movements
  WHERE source = 'order'      AND source_id IN (SELECT id FROM _del_orders)
     OR source = 'production' AND source_id IN (SELECT id FROM _del_orders)
     OR source = 'sale'       AND source_id IN (SELECT id FROM _del_ships);

-- Закупки, привязанные к заказу, остаются — только отвязываем
UPDATE public.erp_purchases SET order_id = NULL
  WHERE order_id IN (SELECT id FROM _del_orders);

-- Позиции и шапка заказа
DELETE FROM public.erp_order_items WHERE order_id IN (SELECT id FROM _del_orders);
DELETE FROM public.erp_orders      WHERE id          IN (SELECT id FROM _del_orders);

COMMIT;

-- Проверка: удалённых больше нет, счётчик заказов
SELECT count(*) AS orders_left FROM public.erp_orders;

-- Что НЕ трогается скриптом (скажите, если нужно и это):
--  * Кассовые оплаты/авансы клиента (erp_cash) — останутся на балансе клиента;
--  * Усреднённая себестоимость erp_items после выпуска готового не откатывается.
