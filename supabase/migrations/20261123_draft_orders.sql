-- Feature #377: draft orders may be created and kept without any production stages.
-- The owner needs to save a client quote before agreeing on the process route, so creation
-- (erp_insert_route) must not demand a non-empty route, and revision (erp_revise_route) must
-- demand it only for positions that already left draft status. Launch still requires at least
-- one task overall ("An active production route is required" in the order.launch branch).
-- Bodies below are identical to supabase/schema.sql. Idempotent: plain CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.erp_insert_route(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_qty numeric, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer; v_stage numeric; v_operation public.erp_operations%ROWTYPE;
  v_kind text; v_employee uuid; v_supplier uuid;
BEGIN
  SELECT coalesce(max(position), -1) + 1 INTO v_pos FROM public.erp_tasks
    WHERE company_id = p_company_id AND order_id = p_order_id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(coalesce(p_lines, '[]'::jsonb), 'route')) LOOP
    SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id
      AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
    IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
    -- Legacy payloads carry no executorKind and must keep behaving exactly like an employee stage.
    v_kind := coalesce(v_line ->> 'executorKind', 'employee');
    v_employee := CASE WHEN v_line ? 'employeeId' AND btrim(v_line ->> 'employeeId') <> ''
      THEN public.erp_uuid(v_line -> 'employeeId', 'employeeId') ELSE NULL END;
    v_supplier := CASE WHEN v_line ? 'supplierId' AND btrim(v_line ->> 'supplierId') <> ''
      THEN public.erp_uuid(v_line -> 'supplierId', 'supplierId') ELSE NULL END;
    IF v_kind = 'employee' THEN
      IF v_employee IS NULL OR v_supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Employee stage requires exactly one employee' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee AND active) THEN
        RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
      END IF;
    ELSIF v_kind = 'supplier' THEN
      IF v_employee IS NOT NULL OR v_supplier IS NULL THEN
        RAISE EXCEPTION 'Supplier stage requires exactly one supplier' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF (SELECT kind FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id) = 'series' THEN
        RAISE EXCEPTION 'Series production uses employees only' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023';
    END IF;
    -- A stage plans its own volume (sheets, metres, holes); older payloads fall back to the position quantity.
    v_stage := CASE WHEN v_line -> 'qty' IS NOT NULL THEN public.erp_num(v_line -> 'qty', 'stage qty') ELSE p_qty END;
    INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
      employee_id, supplier_id, rate, supplier_cost, sale_price, standard_minutes, planned, workshop_id)
      VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
        v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true),
        CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
          THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
        v_operation.sale_price, v_operation.standard_minutes, v_stage, v_operation.workshop_id);
    v_pos := v_pos + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_revise_route(p_company_id uuid, p_order_id uuid, p_line_id uuid, p_qty numeric, p_lines jsonb, p_pos integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_line jsonb; v_pos integer := p_pos; v_id uuid; v_started boolean; v_stage numeric;
  v_kind text; v_employee uuid; v_supplier uuid;
  v_operation public.erp_operations%ROWTYPE; v_task public.erp_tasks%ROWTYPE;
BEGIN
  v_line := public.erp_array(coalesce(p_lines, '[]'::jsonb), 'route');
  -- Draft positions may sit without stages; a live position must keep its route.
  IF jsonb_array_length(v_line) = 0 AND EXISTS (SELECT 1 FROM public.erp_order_items
    WHERE company_id = p_company_id AND id = p_line_id AND status <> 'draft') THEN
    RAISE EXCEPTION 'Order requires a production route' USING ERRCODE = '23514';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_line) l WHERE l.value ? 'taskId')
    <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'taskId', 'taskId')) FROM jsonb_array_elements(v_line) l WHERE l.value ? 'taskId') THEN
    RAISE EXCEPTION 'Duplicate task' USING ERRCODE = '22023';
  END IF;
  FOR v_task IN SELECT * FROM public.erp_tasks WHERE company_id = p_company_id AND line_id = p_line_id LOOP
    v_started := public.erp_task_started(p_company_id, p_order_id, v_task.id);
    IF v_started AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE l.value ? 'taskId' AND public.erp_uuid(l.value -> 'taskId', 'taskId') = v_task.id
        AND public.erp_uuid(l.value -> 'operationId', 'operationId') = v_task.operation_id
        AND coalesce(l.value ->> 'executorKind', 'employee') = v_task.executor_kind
        AND CASE WHEN l.value ? 'employeeId' AND btrim(l.value ->> 'employeeId') <> ''
          THEN public.erp_uuid(l.value -> 'employeeId', 'employeeId') ELSE NULL END IS NOT DISTINCT FROM v_task.employee_id
        AND CASE WHEN l.value ? 'supplierId' AND btrim(l.value ->> 'supplierId') <> ''
          THEN public.erp_uuid(l.value -> 'supplierId', 'supplierId') ELSE NULL END IS NOT DISTINCT FROM v_task.supplier_id
        AND public.erp_money(l.value -> 'rate', 'route rate', true) = v_task.rate
        AND (v_task.executor_kind <> 'supplier' OR CASE WHEN v_task.supplier_cost > 0
          THEN CASE WHEN l.value ? 'supplierCost'
            THEN public.erp_money(l.value -> 'supplierCost', 'supplier cost', true) = v_task.supplier_cost
            ELSE false END
          ELSE CASE WHEN l.value ? 'supplierCost'
            THEN public.erp_money(l.value -> 'supplierCost', 'supplier cost', true) IN (0, round(v_task.planned * v_task.rate, 2))
            ELSE true END
        END)) THEN
      RAISE EXCEPTION 'Started stage cannot be removed or changed' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  DELETE FROM public.erp_tasks t WHERE t.company_id = p_company_id AND t.line_id = p_line_id
    AND NOT public.erp_task_started(p_company_id, p_order_id, t.id)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_line) l
      WHERE l.value ? 'taskId' AND public.erp_uuid(l.value -> 'taskId', 'taskId') = t.id);
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_line) LOOP
    SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = p_company_id
      AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
    IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
    IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
    v_kind := coalesce(v_line ->> 'executorKind', 'employee');
    v_employee := CASE WHEN v_line ? 'employeeId' AND btrim(v_line ->> 'employeeId') <> ''
      THEN public.erp_uuid(v_line -> 'employeeId', 'employeeId') ELSE NULL END;
    v_supplier := CASE WHEN v_line ? 'supplierId' AND btrim(v_line ->> 'supplierId') <> ''
      THEN public.erp_uuid(v_line -> 'supplierId', 'supplierId') ELSE NULL END;
    IF v_kind = 'employee' THEN
      IF v_employee IS NULL OR v_supplier IS NOT NULL THEN
        RAISE EXCEPTION 'Employee stage requires exactly one employee' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = p_company_id AND id = v_employee AND active) THEN
        RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
      END IF;
      IF NOT (v_employee = ANY(v_operation.employee_ids)) THEN
        RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
      END IF;
    ELSIF v_kind = 'supplier' THEN
      IF v_employee IS NOT NULL OR v_supplier IS NULL THEN
        RAISE EXCEPTION 'Supplier stage requires exactly one supplier' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = p_company_id AND id = v_supplier) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Invalid executor kind' USING ERRCODE = '22023';
    END IF;
    v_stage := CASE WHEN v_line -> 'qty' IS NOT NULL THEN public.erp_num(v_line -> 'qty', 'stage qty') ELSE p_qty END;
    IF v_line ? 'taskId' THEN
      SELECT * INTO v_task FROM public.erp_tasks
        WHERE company_id = p_company_id AND line_id = p_line_id AND id = public.erp_uuid(v_line -> 'taskId', 'taskId') FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      v_started := public.erp_task_started(p_company_id, p_order_id, v_task.id);
      IF v_started THEN
        IF v_task.completed > v_stage THEN RAISE EXCEPTION 'Stage quantity is below accepted work' USING ERRCODE = '23514'; END IF;
        UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
          sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes, planned = v_stage,
          status = CASE WHEN v_task.status = 'completed' AND v_task.completed < v_stage THEN 'in_progress' ELSE v_task.status END
          WHERE company_id = p_company_id AND id = v_task.id;
      ELSE
        UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
          executor_kind = v_kind, employee_id = v_employee, supplier_id = v_supplier,
          rate = public.erp_money(v_line -> 'rate', 'route rate', true),
          supplier_cost = CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
            THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
          sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes,
          planned = v_stage, completed = 0, status = 'assigned', workshop_id = v_operation.workshop_id
          WHERE company_id = p_company_id AND id = v_task.id;
      END IF;
    ELSE
      INSERT INTO public.erp_tasks(company_id, order_id, line_id, position, operation_id, name, executor_kind,
        employee_id, supplier_id, rate, supplier_cost, sale_price, standard_minutes, planned, workshop_id)
        VALUES (p_company_id, p_order_id, p_line_id, v_pos, v_operation.id, v_operation.name, v_kind, v_employee,
          v_supplier, public.erp_money(v_line -> 'rate', 'route rate', true),
          CASE WHEN v_kind = 'supplier' AND v_line ? 'supplierCost'
            THEN public.erp_money(v_line -> 'supplierCost', 'supplier cost', true) ELSE 0 END,
          v_operation.sale_price, v_operation.standard_minutes, v_stage, v_operation.workshop_id);
    END IF;
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_pos;
END;
$$;

-- Verification (run separately in the SQL editor):
-- SELECT p.proname, prosrc LIKE '%''route'', true%' AS still_requires_nonempty
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('erp_insert_route', 'erp_revise_route');
-- Expected: two rows, both still_requires_nonempty = false.
