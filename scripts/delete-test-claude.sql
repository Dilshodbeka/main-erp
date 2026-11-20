-- Удаление тестовых данных проверки 20.11.2026: заказ «ТЕСТ кромка (Claude)» (ORD-0003),
-- клиент «ТЕСТ клиент (Claude)» и его оплата 35 000 (PKO-0002).
-- Использование: Supabase → SQL Editor → вставить весь файл → Run.
-- Один блок = одна транзакция: при любой ошибке не меняется ничего. Обратного хода нет.
-- Результат: касса возвращается к 0, кромка 0.4 — к 1 000 м, долг клиентов — к 259 000.

DO $$
DECLARE
  v_customers uuid[];
  v_orders    uuid[];
  v_items     uuid[];
  v_ships     uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_customers
    FROM public.erp_customers WHERE name = 'ТЕСТ клиент (Claude)';
  SELECT coalesce(array_agg(id), '{}') INTO v_orders
    FROM public.erp_orders WHERE customer_id = ANY(v_customers) AND title = 'ТЕСТ кромка (Claude)';
  SELECT coalesce(array_agg(id), '{}') INTO v_items
    FROM public.erp_order_items WHERE order_id = ANY(v_orders);
  SELECT coalesce(array_agg(id), '{}') INTO v_ships
    FROM public.erp_shipments WHERE order_id = ANY(v_orders);

  -- Чат заказа
  DELETE FROM public.erp_order_chat_reads WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_order_messages   WHERE order_id = ANY(v_orders);

  -- Брак → себестоимость этапов → отчёты работ → задачи
  DELETE FROM public.erp_defects      WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_payroll      WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_work_reports WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_tasks        WHERE order_id = ANY(v_orders);

  -- Отгрузка
  DELETE FROM public.erp_shipment_lines WHERE shipment_id = ANY(v_ships) OR line_id = ANY(v_items);
  DELETE FROM public.erp_shipments      WHERE id = ANY(v_ships);

  -- Материалы и движения склада (10 м кромки возвращаются в остаток)
  DELETE FROM public.erp_order_materials WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_stock_movements
    WHERE (source IN ('order', 'production') AND source_id = ANY(v_orders))
       OR (source = 'sale' AND source_id = ANY(v_ships));

  -- Позиции и заказ
  DELETE FROM public.erp_order_items WHERE order_id = ANY(v_orders);
  DELETE FROM public.erp_orders      WHERE id = ANY(v_orders);

  -- Оплата тестового клиента (сначала сторно-строки, если они есть)
  DELETE FROM public.erp_cash WHERE customer_id = ANY(v_customers) AND reversal_of IS NOT NULL;
  DELETE FROM public.erp_cash WHERE customer_id = ANY(v_customers);

  -- Переписка и сам клиент
  DELETE FROM public.erp_messages  WHERE client_id = ANY(v_customers);
  DELETE FROM public.erp_customers WHERE id = ANY(v_customers);

  RAISE NOTICE 'Удалено: заказов %, клиентов %', cardinality(v_orders), cardinality(v_customers);
END $$;

-- Проверка: обе цифры должны быть 0
SELECT
  (SELECT count(*) FROM public.erp_orders    WHERE title = 'ТЕСТ кромка (Claude)') AS test_orders_left,
  (SELECT count(*) FROM public.erp_customers WHERE name  = 'ТЕСТ клиент (Claude)') AS test_customers_left;
