-- Удаление тестовых данных проверки 20.11.2026: заказ «ТЕСТ кромка (Claude)» (ORD-0003),
-- клиент «ТЕСТ клиент (Claude)» и его оплата 35 000 (PKO-0002).
-- Использование: Supabase → SQL Editor → вставить весь файл → Run.
-- Всё в одной транзакции: при любой ошибке не меняется ничего. Обратного хода нет.
-- Результат: касса возвращается к 0, кромка 0.4 — к 1 000 м, долг клиентов — к 259 000.

BEGIN;

CREATE TEMP TABLE _t_customers ON COMMIT DROP AS
  SELECT id FROM public.erp_customers WHERE name = 'ТЕСТ клиент (Claude)';

CREATE TEMP TABLE _t_orders ON COMMIT DROP AS
  SELECT id FROM public.erp_orders
  WHERE customer_id IN (SELECT id FROM _t_customers) AND title = 'ТЕСТ кромка (Claude)';

CREATE TEMP TABLE _t_items ON COMMIT DROP AS
  SELECT id FROM public.erp_order_items WHERE order_id IN (SELECT id FROM _t_orders);

CREATE TEMP TABLE _t_ships ON COMMIT DROP AS
  SELECT id FROM public.erp_shipments WHERE order_id IN (SELECT id FROM _t_orders);

-- Чат заказа
DELETE FROM public.erp_order_chat_reads WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_order_messages   WHERE order_id IN (SELECT id FROM _t_orders);

-- Брак → себестоимость этапов → отчёты работ → задачи
DELETE FROM public.erp_defects      WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_payroll      WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_work_reports WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_tasks        WHERE order_id IN (SELECT id FROM _t_orders);

-- Отгрузка
DELETE FROM public.erp_shipment_lines
  WHERE shipment_id IN (SELECT id FROM _t_ships) OR line_id IN (SELECT id FROM _t_items);
DELETE FROM public.erp_shipments WHERE id IN (SELECT id FROM _t_ships);

-- Материалы и движения склада (10 м кромки возвращаются в остаток)
DELETE FROM public.erp_order_materials WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_stock_movements
  WHERE source IN ('order', 'production') AND source_id IN (SELECT id FROM _t_orders)
     OR source = 'sale' AND source_id IN (SELECT id FROM _t_ships);

-- Позиции и заказ
DELETE FROM public.erp_order_items WHERE order_id IN (SELECT id FROM _t_orders);
DELETE FROM public.erp_orders      WHERE id IN (SELECT id FROM _t_orders);

-- Оплата тестового клиента (сначала сторно-строки, если они есть)
DELETE FROM public.erp_cash
  WHERE customer_id IN (SELECT id FROM _t_customers) AND reversal_of IS NOT NULL;
DELETE FROM public.erp_cash WHERE customer_id IN (SELECT id FROM _t_customers);

-- Переписка и сам клиент
DELETE FROM public.erp_messages  WHERE client_id IN (SELECT id FROM _t_customers);
DELETE FROM public.erp_customers WHERE id IN (SELECT id FROM _t_customers);

COMMIT;

-- Проверка: обе цифры должны быть 0
SELECT
  (SELECT count(*) FROM public.erp_orders    WHERE title = 'ТЕСТ кромка (Claude)') AS test_orders_left,
  (SELECT count(*) FROM public.erp_customers WHERE name  = 'ТЕСТ клиент (Claude)') AS test_customers_left;
