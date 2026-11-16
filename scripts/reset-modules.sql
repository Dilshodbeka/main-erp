-- Сброс модулей: Заказы, Производство, Касса, Продажи, Зарплаты, Склад, Отчёты
-- Оставляет: Клиенты, Сотрудники, Операции, Материалы, Поставщики, Настройки, Доступы

BEGIN;

-- 1. Отчёты и аудит
DELETE FROM erp_audit;

-- 2. Зарплаты и удержания
DELETE FROM erp_worker_deductions;
DELETE FROM erp_payroll;
DELETE FROM erp_salary_plans;
DELETE FROM erp_expense_plans;
DELETE FROM erp_loans;

-- 3. Касса
DELETE FROM erp_cash;

-- 4. Продажи и отгрузки (сначала строки, потом заголовки)
DELETE FROM erp_shipment_lines;
DELETE FROM erp_shipments;

-- 5. Производство и задачи
DELETE FROM erp_work_reports;
DELETE FROM erp_tasks;

-- 6. Закупки (сначала строки, потом заголовки)
DELETE FROM erp_purchase_lines;
DELETE FROM erp_purchases;

-- 7. Склад
DELETE FROM erp_stock_movements;

-- 8. Заказы (сначала материалы и позиции, потом заголовки)
DELETE FROM erp_order_materials;
DELETE FROM erp_order_items;
DELETE FROM erp_orders;

COMMIT;

-- Проверка: всё должно быть 0
SELECT 'orders' AS module, COUNT(*) AS remaining FROM erp_orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM erp_order_items
UNION ALL
SELECT 'order_materials', COUNT(*) FROM erp_order_materials
UNION ALL
SELECT 'tasks', COUNT(*) FROM erp_tasks
UNION ALL
SELECT 'cash', COUNT(*) FROM erp_cash
UNION ALL
SELECT 'shipments', COUNT(*) FROM erp_shipments
UNION ALL
SELECT 'payroll', COUNT(*) FROM erp_payroll
UNION ALL
SELECT 'stock', COUNT(*) FROM erp_stock_movements
UNION ALL
SELECT 'purchases', COUNT(*) FROM erp_purchases;
