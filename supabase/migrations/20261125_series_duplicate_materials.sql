-- Aliya ERP: серия с одинаковым материалом в двух слотах рецепта (#402).
-- Строка erp_order_materials уникальна по позиции и материалу, поэтому второй слот
-- прибавляет количество к уже заведённой строке вместо ошибки Duplicate recipe component.
-- Safe to run more than once. Existing data is untouched.

BEGIN;
CREATE OR REPLACE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_revision bigint;
  v_actor public.erp_profiles%ROWTYPE;
  v_company uuid;
  v_prior public.erp_audit%ROWTYPE;
  v_type text;
  v_entity uuid;
  v_id uuid;
  v_ref uuid;
  v_customer uuid;
  v_customer_row public.erp_customers%ROWTYPE;
  v_input jsonb;
  v_line jsonb;
  v_pos integer;
  v_qty numeric;
  v_amount numeric;
  v_markup numeric;
  v_cost numeric;
  v_stock numeric;
  v_warehouse uuid;
  v_workshop uuid;
  v_purchase_order uuid;
  v_free numeric;
  v_take numeric;
  v_cap numeric;
  v_advance numeric;
  v_account text;
  v_to_account text;
  v_direction text;
  v_accept boolean;
  v_new_completed numeric;
  v_defect numeric;
  v_good numeric;
  v_reason text;
  v_unit text;
  v_kind text;
  v_category text;
  v_photo text;
  v_sale numeric;
  v_labor numeric;
  v_new_labor numeric;
  v_before numeric;
  v_total numeric;
  v_material_total numeric;
  v_labor_total numeric;
  v_cost_total numeric;
  v_sale_slice numeric;
  v_cost_slice numeric;
  v_material_slice numeric;
  v_version integer;
  v_output uuid;
  v_recipe public.erp_recipes%ROWTYPE;
  v_recipe_version public.erp_recipe_versions%ROWTYPE;
  v_component public.erp_recipe_components%ROWTYPE;
  v_subs jsonb;
  v_slot text;
  v_chosen uuid;
  v_employee_ids uuid[] := ARRAY[]::uuid[];
  v_order public.erp_orders%ROWTYPE;
  v_item public.erp_items%ROWTYPE;
  v_employee public.erp_employees%ROWTYPE;
  v_machine public.erp_machines%ROWTYPE;
  v_operation public.erp_operations%ROWTYPE;
  v_task public.erp_tasks%ROWTYPE;
  v_material public.erp_order_materials%ROWTYPE;
  v_purchase public.erp_purchases%ROWTYPE;
  v_purchase_line public.erp_purchase_lines%ROWTYPE;
  v_report public.erp_work_reports%ROWTYPE;
  v_payroll public.erp_payroll%ROWTYPE;
  v_cash public.erp_cash%ROWTYPE;
  v_shipment public.erp_shipments%ROWTYPE;
  v_lines jsonb;
  v_line_row public.erp_order_items%ROWTYPE;
  v_line_status text;
  v_old_tasks jsonb;
  v_new_tasks jsonb;
  v_title text;
  v_line_kind text;
  v_line_id uuid;
  v_rec record;
  v_pos_material integer;
  v_pos_task integer;
  v_ship_qty numeric;
  v_allow_debt boolean;
  v_note text;
  v_allow_prepay boolean;
  v_owed numeric;
  v_active boolean;
  v_stages jsonb;
  v_employee_id uuid;
  v_ticket public.erp_support_tickets%ROWTYPE;
  v_context jsonb;
  v_author uuid;
  v_text text;
  v_customer_seller_id uuid;
  v_workshop_scope uuid[];
BEGIN
  v_actor := public.erp_current_profile();
  v_company := v_actor.company_id;
  v_workshop_scope := ARRAY(SELECT jsonb_array_elements_text(v_actor.scope_workshop_ids))::uuid[];
  -- Serialize first: retries, stock reservations and money share one authority.
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_company FOR UPDATE;
  IF p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid request envelope' USING ERRCODE = '22023';
  END IF;
  IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' THEN
    RAISE EXCEPTION 'Command must be an object' USING ERRCODE = '22023';
  END IF;
  v_type := public.erp_text(p_command -> 'type', 'type');
  IF v_actor.role = 'display' THEN
    RAISE EXCEPTION 'Workshop display accounts are read-only' USING ERRCODE = '42501';
  END IF;
  IF v_actor.role = 'worker' THEN
    IF v_type IN ('work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply') THEN
      NULL; -- base actions: any worker may act on their own stages / tickets
    ELSIF v_type IN ('order.update', 'orderLine.cancel', 'order.cancel', 'order.launch') THEN
      SELECT cc.seller_id INTO v_customer_seller_id FROM public.erp_orders oo
        JOIN public.erp_customers cc ON cc.company_id = oo.company_id AND cc.id = oo.customer_id
        WHERE oo.company_id = v_company AND oo.id = public.erp_uuid(p_command -> 'orderId', 'orderId');
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF NOT public.erp_can_touch_order(v_actor, v_customer_seller_id) THEN
        RAISE EXCEPTION 'You may only manage orders of your own customers' USING ERRCODE = '42501';
      END IF;
      IF v_type = 'order.cancel' AND NOT public.erp_has_permission(v_actor, 'orders.cancel') THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
      IF v_type = 'order.launch' AND NOT public.erp_has_permission(v_actor, 'orders.launch') THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF NOT public.erp_has_permission(v_actor, public.erp_command_permission(v_type)) THEN
        RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  SELECT * INTO v_prior FROM public.erp_audit WHERE company_id = v_company AND request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.actor_user_id <> v_actor.id THEN
      RAISE EXCEPTION 'Request belongs to another account' USING ERRCODE = '42501';
    END IF;
    IF v_prior.command <> p_command OR v_prior.expected_revision <> p_expected_revision THEN
      RAISE EXCEPTION 'Request UUID reused with a different envelope' USING ERRCODE = '22023';
    END IF;
    RETURN public.erp_snapshot();
  END IF;
  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Revision conflict: expected %, current %', p_expected_revision, v_revision USING ERRCODE = '40001';
  END IF;
  IF v_revision = 9007199254740991 THEN RAISE EXCEPTION 'Revision exhausted' USING ERRCODE = '22003'; END IF;

  CASE v_type
    WHEN 'customer.create' THEN
      v_kind := coalesce(p_command ->> 'kind', 'customer');
      IF v_kind NOT IN ('customer', 'shop', 'service') THEN RAISE EXCEPTION 'Invalid customer kind' USING ERRCODE = '22023'; END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee_id := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee_id := NULL;
      END IF;
      INSERT INTO public.erp_customers(company_id, name, phone, address, kind, employee_id, seller_id) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true),
        public.erp_text(p_command -> 'address', 'address', true), v_kind, v_employee_id,
        CASE WHEN v_actor.role = 'worker' AND public.erp_has_permission(v_actor, 'customers.claim') THEN v_actor.employee_id ELSE NULL END)
        RETURNING id INTO v_entity;
    WHEN 'customer.claim' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF v_customer_row.seller_id IS NOT NULL THEN RAISE EXCEPTION 'Customer already assigned' USING ERRCODE = '22023'; END IF;
      UPDATE public.erp_customers SET seller_id = v_actor.employee_id WHERE company_id = v_company AND id = v_entity;
    WHEN 'customer.assign' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF p_command ? 'sellerId' AND p_command -> 'sellerId' <> 'null'::jsonb AND btrim(p_command ->> 'sellerId') <> '' THEN
        v_ref := public.erp_uuid(p_command -> 'sellerId', 'sellerId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_ref AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_ref := NULL;
      END IF;
      UPDATE public.erp_customers SET seller_id = v_ref WHERE company_id = v_company AND id = v_entity;
    WHEN 'supplier.create' THEN
      INSERT INTO public.erp_suppliers(company_id, name, phone) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true)) RETURNING id INTO v_entity;
    WHEN 'employee.create' THEN
      INSERT INTO public.erp_employees(company_id, name) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name'))) RETURNING id INTO v_entity;
    WHEN 'employee.update' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      IF p_command ? 'deactivatedAt' AND btrim(p_command ->> 'deactivatedAt') <> ''
         AND (p_command ->> 'deactivatedAt') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        RAISE EXCEPTION 'Invalid deactivation date' USING ERRCODE = '22023';
      END IF;
      UPDATE public.erp_employees SET name = btrim(public.erp_text(p_command -> 'name', 'name')), active = v_active,
        deactivated_at = CASE WHEN v_active THEN NULL
          ELSE coalesce(NULLIF(btrim(coalesce(p_command ->> 'deactivatedAt', '')), '')::date, deactivated_at,
            (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) END
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'workshop.create' THEN
      v_text := btrim(public.erp_text(p_command -> 'name', 'name'));
      IF EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND lower(name) = lower(v_text)) THEN
        RAISE EXCEPTION 'Sex nomi allaqachon mavjud' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.erp_workshops(company_id, name) VALUES (v_company, v_text) RETURNING id INTO v_entity;
    WHEN 'workshop.update' THEN
      v_entity := public.erp_uuid(p_command -> 'workshopId', 'workshopId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';
      END IF;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      IF NOT v_active AND NOT EXISTS (SELECT 1 FROM public.erp_workshops
        WHERE company_id = v_company AND id <> v_entity AND active) THEN
        RAISE EXCEPTION 'Kamida bitta faol sex qolishi kerak' USING ERRCODE = '23514';
      END IF;
      v_text := btrim(public.erp_text(p_command -> 'name', 'name'));
      IF EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id <> v_entity AND lower(name) = lower(v_text)) THEN
        RAISE EXCEPTION 'Sex nomi allaqachon mavjud' USING ERRCODE = '23505';
      END IF;
      UPDATE public.erp_workshops SET name = v_text, active = v_active WHERE company_id = v_company AND id = v_entity;
    WHEN 'machine.create' THEN
      v_ref := CASE WHEN p_command ? 'workshopId' AND p_command -> 'workshopId' <> 'null'::jsonb
        THEN public.erp_uuid(p_command -> 'workshopId', 'workshopId')
        ELSE '00000000-0000-4000-8000-00000000b001'::uuid END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_ref) THEN
        RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Sex nofaol' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_machines(company_id, name, hourly_revenue_target, workshop_id) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')),
        public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true), v_ref) RETURNING id INTO v_entity;
    WHEN 'machine.update' THEN
      v_entity := public.erp_uuid(p_command -> 'machineId', 'machineId');
      SELECT * INTO v_machine FROM public.erp_machines WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found' USING ERRCODE = '22023'; END IF;
      v_ref := CASE WHEN p_command ? 'workshopId' AND p_command -> 'workshopId' <> 'null'::jsonb
        THEN public.erp_uuid(p_command -> 'workshopId', 'workshopId') ELSE v_machine.workshop_id END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_ref) THEN
        RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Sex nofaol' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_machines SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        hourly_revenue_target = public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true),
        active = public.erp_bool(p_command -> 'active', 'active'), workshop_id = v_ref WHERE id = v_entity;
    WHEN 'operation.create' THEN
      v_unit := public.erp_unit(p_command -> 'unit');
      IF NOT (p_command ? 'machineId') THEN RAISE EXCEPTION 'machineId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_ref := CASE WHEN p_command -> 'machineId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'machineId', 'machineId') END;
      IF v_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_machines WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Active machine not found' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'employeeIds', 'employeeIds')) LOOP
        v_id := public.erp_uuid(v_line, 'employeeId');
        IF v_id = ANY(v_employee_ids) THEN RAISE EXCEPTION 'Duplicate employee' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_id AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
        v_employee_ids := v_employee_ids || v_id;
      END LOOP;
      v_workshop := CASE WHEN p_command ? 'workshopId' AND p_command -> 'workshopId' <> 'null'::jsonb
        THEN public.erp_uuid(p_command -> 'workshopId', 'workshopId')
        ELSE '00000000-0000-4000-8000-00000000b001'::uuid END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_workshop) THEN
        RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_workshop AND active) THEN
        RAISE EXCEPTION 'Sex nofaol' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_operations(company_id, name, unit, sale_price, worker_rate, standard_minutes, machine_id, employee_ids, active, auto_accept, norms, workshop_id)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), v_unit,
          public.erp_money(p_command -> 'salePrice', 'salePrice', true),
          public.erp_money(p_command -> 'workerRate', 'workerRate', true),
          public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
          v_ref, v_employee_ids, public.erp_bool(p_command -> 'active', 'active'),
          public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
          public.erp_norms(v_company, p_command -> 'norms'), v_workshop) RETURNING id INTO v_entity;
    WHEN 'operation.update' THEN
      v_entity := public.erp_uuid(p_command -> 'operationId', 'operationId');
      SELECT workshop_id INTO v_workshop FROM public.erp_operations WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023';
      END IF;
      v_unit := public.erp_unit(p_command -> 'unit');
      IF NOT (p_command ? 'machineId') THEN RAISE EXCEPTION 'machineId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_ref := CASE WHEN p_command -> 'machineId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'machineId', 'machineId') END;
      IF v_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_machines WHERE company_id = v_company AND id = v_ref AND active) THEN
        RAISE EXCEPTION 'Active machine not found' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'employeeIds', 'employeeIds')) LOOP
        v_id := public.erp_uuid(v_line, 'employeeId');
        IF v_id = ANY(v_employee_ids) THEN RAISE EXCEPTION 'Duplicate employee' USING ERRCODE = '22023'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_id AND active) THEN
          RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
        END IF;
        v_employee_ids := v_employee_ids || v_id;
      END LOOP;
      IF p_command ? 'workshopId' AND p_command -> 'workshopId' <> 'null'::jsonb THEN
        v_workshop := public.erp_uuid(p_command -> 'workshopId', 'workshopId');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_workshop) THEN
        RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_workshops WHERE company_id = v_company AND id = v_workshop AND active) THEN
        RAISE EXCEPTION 'Sex nofaol' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_operations SET name = btrim(public.erp_text(p_command -> 'name', 'name')), unit = v_unit,
        sale_price = public.erp_money(p_command -> 'salePrice', 'salePrice', true),
        worker_rate = public.erp_money(p_command -> 'workerRate', 'workerRate', true),
        standard_minutes = public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
        machine_id = v_ref, employee_ids = v_employee_ids,
        active = public.erp_bool(p_command -> 'active', 'active'),
        auto_accept = public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
        norms = public.erp_norms(v_company, p_command -> 'norms'), workshop_id = v_workshop WHERE id = v_entity;
    WHEN 'item.create' THEN
      IF NOT (p_command ? 'customerId') THEN RAISE EXCEPTION 'customerId is required (UUID or null)' USING ERRCODE = '22023'; END IF;
      v_customer := CASE WHEN p_command -> 'customerId' = 'null'::jsonb THEN NULL ELSE public.erp_uuid(p_command -> 'customerId', 'customerId') END;
      IF v_customer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      v_cost := public.erp_money(p_command -> 'cost', 'cost', true);
      v_kind := CASE WHEN p_command ? 'kind' THEN public.erp_text(p_command -> 'kind', 'kind') ELSE 'material' END;
      IF v_kind NOT IN ('material', 'blank', 'finished') THEN RAISE EXCEPTION 'Invalid item kind' USING ERRCODE = '22023'; END IF;
      v_sale := CASE WHEN p_command ? 'salePrice' THEN public.erp_money(p_command -> 'salePrice', 'salePrice', true) ELSE 0 END;
      v_category := CASE WHEN p_command ? 'category' AND p_command -> 'category' <> 'null'::jsonb
        THEN public.erp_text(p_command -> 'category', 'category') ELSE NULL END;
      IF v_category IS NOT NULL AND v_category !~ '^[0-9]{2}\.[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid warehouse category' USING ERRCODE = '22023';
      END IF;
      IF v_customer IS NOT NULL AND v_cost <> 0 THEN
        RAISE EXCEPTION 'Customer-owned material must have zero business cost' USING ERRCODE = '22023';
      END IF;
      v_photo := CASE WHEN p_command ? 'photo' THEN btrim(p_command ->> 'photo') ELSE '' END;
      IF length(v_photo) > 200000 OR (v_photo <> '' AND v_photo !~ '^(data:image/(png|jpeg|webp);base64,|https?://)') THEN
        RAISE EXCEPTION 'Invalid photo' USING ERRCODE = '22023';
      END IF;
      v_qty := CASE WHEN p_command ? 'openQty' THEN public.erp_num(p_command -> 'openQty', 'openQty', true) ELSE 0 END;
      IF v_customer IS NOT NULL AND v_qty > 0 THEN
        RAISE EXCEPTION 'Customer-owned material cannot have opening stock' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_items(company_id, name, unit, min_qty, cost, customer_id, kind, sale_price, last_purchase_price, material_cost, labor_cost, category, photo)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'unit', 'unit'),
        public.erp_num(p_command -> 'minQty', 'minQty', true), v_cost, v_customer, v_kind, v_sale, 0, v_cost, 0, v_category, v_photo) RETURNING id INTO v_entity;
      IF v_qty > 0 THEN
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_entity, 'in', v_qty, v_cost, 'inventory', v_entity, 'Boshlang‘ich qoldiq');
      END IF;
    WHEN 'item.update' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      v_category := CASE WHEN p_command ? 'category' AND p_command -> 'category' <> 'null'::jsonb
        THEN public.erp_text(p_command -> 'category', 'category') ELSE NULL END;
      IF v_category IS NOT NULL AND v_category !~ '^[0-9]{2}\.[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid warehouse category' USING ERRCODE = '22023';
      END IF;
      v_photo := CASE WHEN p_command ? 'photo' THEN btrim(p_command ->> 'photo') ELSE NULL END;
      IF v_photo IS NOT NULL AND (length(v_photo) > 200000 OR (v_photo <> '' AND v_photo !~ '^(data:image/(png|jpeg|webp);base64,|https?://)')) THEN
        RAISE EXCEPTION 'Invalid photo' USING ERRCODE = '22023';
      END IF;
      UPDATE public.erp_items SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        unit = public.erp_text(p_command -> 'unit', 'unit'),
        min_qty = public.erp_num(p_command -> 'minQty', 'minQty', true),
        sale_price = CASE WHEN v_item.customer_id IS NULL
          THEN public.erp_money(p_command -> 'salePrice', 'salePrice', true) ELSE 0 END,
        category = v_category,
        photo = coalesce(v_photo, photo)
        WHERE id = v_entity;
    WHEN 'recipe.create' THEN
      v_output := public.erp_uuid(p_command -> 'outputItemId', 'outputItemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_output;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_recipes(company_id, output_item_id, name)
        VALUES (v_company, v_output, btrim(public.erp_text(p_command -> 'name', 'name'))) RETURNING id INTO v_entity;
      INSERT INTO public.erp_recipe_versions(company_id, recipe_id, version)
        VALUES (v_company, v_entity, 1) RETURNING id INTO v_ref;
      PERFORM public.erp_insert_components(v_company, v_ref, p_command -> 'components');
      PERFORM public.erp_assert_recipes(v_company);
    WHEN 'recipe.version.create' THEN
      v_entity := public.erp_uuid(p_command -> 'recipeId', 'recipeId');
      SELECT * INTO v_recipe FROM public.erp_recipes WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found' USING ERRCODE = '22023'; END IF;
      IF NOT v_recipe.active THEN RAISE EXCEPTION 'Recipe is inactive' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_recipe.output_item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.erp_recipe_versions
        WHERE company_id = v_company AND recipe_id = v_entity;
      INSERT INTO public.erp_recipe_versions(company_id, recipe_id, version)
        VALUES (v_company, v_entity, v_version) RETURNING id INTO v_ref;
      PERFORM public.erp_insert_components(v_company, v_ref, p_command -> 'components');
      PERFORM public.erp_assert_recipes(v_company);
    WHEN 'customer.receive' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_item.customer_id IS NULL THEN RAISE EXCEPTION 'Customer-owned item required' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
        VALUES (v_company, v_item.id, 'in', v_qty, 0, 'customer', v_item.customer_id, public.erp_text(p_command -> 'note', 'note', true));
    WHEN 'order.create' THEN
      v_input := p_command -> 'input';
      IF v_input IS NULL OR jsonb_typeof(v_input) <> 'object' THEN RAISE EXCEPTION 'Order input required' USING ERRCODE = '22023'; END IF;
      v_customer := public.erp_uuid(v_input -> 'customerId', 'customerId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      v_kind := public.erp_text(v_input -> 'kind', 'kind');
      v_advance := public.erp_money(v_input -> 'advance', 'advance', true);
      v_account := public.erp_account(v_input -> 'account');
      v_markup := CASE WHEN v_input ? 'markup' THEN public.erp_signed_money(v_input -> 'markup', 'markup') ELSE 0 END;
      v_warehouse := CASE WHEN v_input ? 'warehouseId' AND v_input -> 'warehouseId' <> 'null'::jsonb
        THEN public.erp_uuid(v_input -> 'warehouseId', 'warehouseId')
        ELSE '00000000-0000-4000-8000-00000000a001'::uuid END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse AND active) THEN
        RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
      END IF;
      v_lines := v_input -> 'lines';
      IF v_lines IS NOT NULL THEN
        IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
          RAISE EXCEPTION 'Order requires lines' USING ERRCODE = '22023';
        END IF;
        IF v_kind <> 'composite' AND jsonb_array_length(v_lines) > 1 THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
        SELECT coalesce(sum(public.erp_num(l.value -> 'qty', 'position qty')), 0),
          round(coalesce(sum(round(public.erp_num(l.value -> 'qty', 'position qty')
            * public.erp_money(l.value -> 'unitPrice', 'unit price', true), 2)), 0), 2),
          string_agg(btrim(public.erp_text(l.value -> 'title', 'title')), ' · ' ORDER BY l.ordinality),
          CASE WHEN count(DISTINCT public.erp_text(l.value -> 'kind', 'position kind')) = 1
            THEN min(public.erp_text(l.value -> 'kind', 'position kind')) ELSE 'composite' END
          INTO v_qty, v_amount, v_title, v_line_kind
          FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality);
        IF v_line_kind NOT IN ('product', 'service', 'composite') THEN RAISE EXCEPTION 'Invalid position kind' USING ERRCODE = '22023'; END IF;
        IF v_amount + v_markup < 0 THEN RAISE EXCEPTION 'Markup exceeds order total' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, warehouse_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_line_kind, v_customer, v_warehouse, v_title, v_qty, round(v_amount + v_markup, 2),
            public.erp_money(v_input -> 'overhead', 'overhead', true), v_markup, public.erp_date(v_input -> 'dueDate')) RETURNING * INTO v_order;
        v_entity := v_order.id;
        INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
          SELECT v_company, v_entity, (l.ordinality - 1)::integer, public.erp_text(l.value -> 'kind', 'position kind'),
            btrim(public.erp_text(l.value -> 'title', 'title')), public.erp_num(l.value -> 'qty', 'position qty'),
            round(public.erp_num(l.value -> 'qty', 'position qty') * public.erp_money(l.value -> 'unitPrice', 'unit price', true), 2)
            FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality);
        FOR v_rec IN SELECT i.id AS line_id, i.qty AS line_qty, l.value AS definition
          FROM public.erp_order_items i
          JOIN jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality) ON l.ordinality = i.position + 1
          WHERE i.company_id = v_company AND i.order_id = v_entity ORDER BY i.position LOOP
          PERFORM public.erp_insert_materials(v_company, v_entity, v_rec.line_id, v_customer, v_rec.definition -> 'materials');
          PERFORM public.erp_insert_route(v_company, v_entity, v_rec.line_id, v_rec.line_qty, v_rec.definition -> 'route');
          PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_rec.line_id);
        END LOOP;
      ELSE
        IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
        v_qty := public.erp_num(v_input -> 'qty', 'qty');
        v_amount := public.erp_money(v_input -> 'price', 'price', true);
        v_title := public.erp_text(v_input -> 'title', 'title');
        IF v_amount + v_markup < 0 THEN RAISE EXCEPTION 'Markup exceeds order total' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, warehouse_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_kind, v_customer, v_warehouse, v_title, v_qty, round(v_amount + v_markup, 2),
            public.erp_money(v_input -> 'overhead', 'overhead', true), v_markup, public.erp_date(v_input -> 'dueDate')) RETURNING * INTO v_order;
        v_entity := v_order.id;
        INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
          VALUES (v_company, v_entity, 0, v_kind, v_title, v_qty, v_amount) RETURNING id INTO v_line_id;
        PERFORM public.erp_insert_materials(v_company, v_entity, v_line_id, v_customer, v_input -> 'materials');
        PERFORM public.erp_insert_route(v_company, v_entity, v_line_id, v_qty, v_input -> 'route');
        PERFORM public.erp_insert_norm_materials(v_company, v_entity, v_line_id);
      END IF;
      IF v_advance > round(v_amount + v_markup, 2) THEN RAISE EXCEPTION 'Advance exceeds order total' USING ERRCODE = '23514'; END IF;
      IF v_advance > 0 THEN
        INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
          VALUES (v_company, 'in', v_advance, v_account, 'sale', v_customer, v_customer, 'sale', '', public.erp_cash_number(v_company, 'in'));
      END IF;
    WHEN 'order.update' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Series orders follow their recipe' USING ERRCODE = '23514'; END IF;
      IF v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be edited' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_order.customer_id) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'warehouseId' AND p_command -> 'warehouseId' <> 'null'::jsonb THEN
        v_warehouse := public.erp_uuid(p_command -> 'warehouseId', 'warehouseId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse) THEN
          RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse AND active) THEN
          RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
        END IF;
        IF v_warehouse <> v_order.warehouse_id THEN
          IF EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND order_id = v_entity AND issued_qty > 0) THEN
            RAISE EXCEPTION 'Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi' USING ERRCODE = '23514';
          END IF;
          UPDATE public.erp_orders SET warehouse_id = v_warehouse WHERE company_id = v_company AND id = v_entity;
          v_order.warehouse_id := v_warehouse;
        END IF;
      END IF;
      v_lines := p_command -> 'lines';
      UPDATE public.erp_orders SET overhead = public.erp_money(p_command -> 'overhead', 'overhead', true),
        due_date = public.erp_date(p_command -> 'dueDate'),
        markup = CASE WHEN p_command ? 'markup' THEN public.erp_signed_money(p_command -> 'markup', 'markup') ELSE markup END
        WHERE company_id = v_company AND id = v_entity;
      IF p_command ? 'lines' THEN
        IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
          RAISE EXCEPTION 'Order requires lines' USING ERRCODE = '22023';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(v_lines) l WHERE l.value ? 'id')
          <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'id', 'id')) FROM jsonb_array_elements(v_lines) l WHERE l.value ? 'id') THEN
          RAISE EXCEPTION 'Duplicate order line' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_items i WHERE i.company_id = v_company AND i.order_id = v_entity
          AND i.status <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_lines) l
            WHERE l.value ? 'id' AND public.erp_uuid(l.value -> 'id', 'id') = i.id)) THEN
          RAISE EXCEPTION 'Order line cannot be removed' USING ERRCODE = '23514';
        END IF;
        UPDATE public.erp_order_items SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_order_materials SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_tasks SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        v_pos := 0;
        v_pos_material := 0;
        v_pos_task := 0;
        FOR v_rec IN SELECT l.value AS definition, l.ordinality FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS l(value, ordinality)
          ORDER BY l.ordinality LOOP
          v_line_kind := public.erp_text(v_rec.definition -> 'kind', 'position kind');
          IF v_line_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
          v_title := btrim(public.erp_text(v_rec.definition -> 'title', 'title'));
          v_qty := public.erp_num(v_rec.definition -> 'qty', 'position qty');
          v_amount := round(v_qty * public.erp_money(v_rec.definition -> 'unitPrice', 'unit price', true), 2);
          IF v_rec.definition ? 'id' THEN
            v_line_id := public.erp_uuid(v_rec.definition -> 'id', 'id');
            SELECT * INTO v_line_row FROM public.erp_order_items
              WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
            IF v_line_row.status = 'cancelled' THEN
              RAISE EXCEPTION 'Cancelled position cannot be revised' USING ERRCODE = '23514';
            END IF;
            v_line_status := v_line_row.status;
            IF public.erp_line_shipped(v_company, v_line_id) > v_qty THEN
              RAISE EXCEPTION 'Quantity is below shipped quantity' USING ERRCODE = '23514';
            END IF;
            UPDATE public.erp_order_items SET position = v_pos, kind = v_line_kind, title = v_title, qty = v_qty, total = v_amount
              WHERE company_id = v_company AND id = v_line_id;
          ELSE
            INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total, status)
              VALUES (v_company, v_entity, v_pos, v_line_kind, v_title, v_qty, v_amount,
                CASE WHEN v_order.status = 'draft' THEN 'draft' ELSE 'production' END)
              RETURNING id INTO v_line_id;
            v_line_status := CASE WHEN v_order.status = 'draft' THEN 'draft' ELSE 'production' END;
          END IF;
          IF v_line_status = 'draft' THEN
            DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id;
            DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id;
          END IF;
          v_pos_material := public.erp_revise_materials(v_company, v_entity, v_line_id, v_order.customer_id,
            v_rec.definition -> 'materials', v_pos_material);
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
          v_pos_task := public.erp_revise_route(v_company, v_entity, v_line_id, v_qty,
            v_rec.definition -> 'route', v_pos_task);
          IF v_line_status <> 'draft' THEN
            SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
              INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_id;
            PERFORM public.erp_norm_delta(v_company, v_entity, v_line_id, v_order.customer_id, v_old_tasks, v_new_tasks);
          END IF;
          IF v_line_status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
              WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
            OR EXISTS (SELECT 1 FROM public.erp_tasks
              WHERE company_id = v_company AND line_id = v_line_id AND completed < planned)) THEN
            UPDATE public.erp_order_items SET status = 'production' WHERE company_id = v_company AND id = v_line_id;
          END IF;
          v_pos := v_pos + 1;
        END LOOP;
        PERFORM public.erp_sync_identity(v_company, v_entity);
        PERFORM public.erp_sync_order(v_company, v_entity);
      ELSE
        IF (SELECT count(*) FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled') <> 1 THEN
          RAISE EXCEPTION 'Order positions require a line revision' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled'
          ORDER BY position FOR UPDATE;
        v_qty := public.erp_num(p_command -> 'qty', 'qty');
        v_amount := public.erp_money(p_command -> 'price', 'price', true);
        v_title := btrim(public.erp_text(p_command -> 'title', 'title'));
        IF public.erp_line_shipped(v_company, v_line_row.id) > v_qty THEN
          RAISE EXCEPTION 'Quantity is below shipped quantity' USING ERRCODE = '23514';
        END IF;
        UPDATE public.erp_order_materials SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        UPDATE public.erp_tasks SET position = position + 1000000 WHERE company_id = v_company AND order_id = v_entity;
        IF v_line_row.status = 'draft' THEN
          DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_row.id;
          DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_row.id;
        END IF;
        PERFORM public.erp_revise_materials(v_company, v_entity, v_line_row.id, v_order.customer_id,
          p_command -> 'materials', 0);
        SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
          INTO v_old_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
        PERFORM public.erp_revise_route(v_company, v_entity, v_line_row.id, v_qty, p_command -> 'route', 0);
        IF v_line_row.status <> 'draft' THEN
          SELECT coalesce(jsonb_agg(jsonb_build_object('operationId', t.operation_id, 'planned', t.planned)), '[]'::jsonb)
            INTO v_new_tasks FROM public.erp_tasks t WHERE t.company_id = v_company AND t.line_id = v_line_row.id;
          PERFORM public.erp_norm_delta(v_company, v_entity, v_line_row.id, v_order.customer_id, v_old_tasks, v_new_tasks);
        END IF;
        IF v_line_row.status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND line_id = v_line_row.id AND issued_qty < qty)
          OR EXISTS (SELECT 1 FROM public.erp_tasks
            WHERE company_id = v_company AND line_id = v_line_row.id AND completed < planned)) THEN
          UPDATE public.erp_order_items SET status = 'production' WHERE company_id = v_company AND id = v_line_row.id;
        END IF;
        UPDATE public.erp_order_items SET title = v_title, qty = v_qty, total = v_amount
          WHERE company_id = v_company AND id = v_line_row.id;
        PERFORM public.erp_sync_identity(v_company, v_entity);
        PERFORM public.erp_sync_order(v_company, v_entity);
      END IF;
    WHEN 'series.create' THEN
      v_input := p_command -> 'input';
      IF v_input IS NULL OR jsonb_typeof(v_input) <> 'object' THEN RAISE EXCEPTION 'Series input required' USING ERRCODE = '22023'; END IF;
      v_output := public.erp_uuid(v_input -> 'outputItemId', 'outputItemId');
      v_ref := public.erp_uuid(v_input -> 'recipeVersionId', 'recipeVersionId');
      SELECT * INTO v_recipe_version FROM public.erp_recipe_versions
        WHERE company_id = v_company AND id = v_ref FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe version not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_recipe FROM public.erp_recipes
        WHERE company_id = v_company AND id = v_recipe_version.recipe_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Recipe not found' USING ERRCODE = '22023'; END IF;
      IF NOT v_recipe.active THEN RAISE EXCEPTION 'Recipe is inactive' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_recipe.output_item_id;
      IF NOT FOUND OR v_item.customer_id IS NOT NULL OR v_item.kind NOT IN ('blank', 'finished') THEN
        RAISE EXCEPTION 'Recipe output must be a business-owned blank or finished item' USING ERRCODE = '22023';
      END IF;
      IF v_recipe.output_item_id <> v_output THEN RAISE EXCEPTION 'Recipe does not produce this item' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(v_input -> 'qty', 'qty');
      IF v_input -> 'substitutions' IS NOT NULL AND jsonb_typeof(v_input -> 'substitutions') <> 'object' THEN
        RAISE EXCEPTION 'substitutions must be an object' USING ERRCODE = '22023';
      END IF;
      v_subs := coalesce(v_input -> 'substitutions', '{}'::jsonb);
      FOR v_slot IN SELECT jsonb_object_keys(v_subs) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_recipe_components c
          WHERE c.company_id = v_company AND c.version_id = v_ref AND c.slot = v_slot) THEN
          RAISE EXCEPTION 'Unknown substitution slot' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, due_date,
        output_item_id, recipe_version_id, substitutions)
        VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
          'series', NULL, v_recipe.name || ' · v' || v_recipe_version.version, v_qty, 0, 0,
          public.erp_date(v_input -> 'dueDate'), v_output, v_ref, v_subs) RETURNING * INTO v_order;
      v_entity := v_order.id;
      INSERT INTO public.erp_order_items(company_id, order_id, position, kind, title, qty, total)
        VALUES (v_company, v_entity, 0, 'product', v_order.title, v_qty, 0) RETURNING id INTO v_line_id;
      v_pos := 0;
      FOR v_component IN SELECT * FROM public.erp_recipe_components
        WHERE company_id = v_company AND version_id = v_ref ORDER BY position LOOP
        IF v_subs ? v_component.slot THEN
          v_chosen := public.erp_uuid(v_subs -> v_component.slot, 'substitution');
        ELSE
          v_chosen := v_component.item_id;
        END IF;
        IF v_chosen IS NULL THEN RAISE EXCEPTION 'Every recipe slot requires a selected item' USING ERRCODE = '23514'; END IF;
        IF (v_component.item_id IS NULL AND NOT (v_chosen = ANY(v_component.allowed_item_ids)))
          OR (v_component.item_id IS NOT NULL AND v_chosen <> v_component.item_id AND NOT (v_chosen = ANY(v_component.allowed_item_ids))) THEN
          RAISE EXCEPTION 'Substitution is not allowed for this slot' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_chosen;
        IF NOT FOUND THEN RAISE EXCEPTION 'Recipe item not found' USING ERRCODE = '22023'; END IF;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Customer materials cannot be used in recipes' USING ERRCODE = '23514'; END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_materials
          WHERE company_id = v_company AND line_id = v_line_id AND item_id = v_chosen) THEN
          UPDATE public.erp_order_materials SET qty = qty + v_qty * v_component.qty_per_unit
            WHERE company_id = v_company AND line_id = v_line_id AND item_id = v_chosen;
        ELSE
          INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
            VALUES (v_company, v_entity, v_line_id, v_chosen, v_pos, v_qty * v_component.qty_per_unit, v_item.cost);
          v_pos := v_pos + 1;
        END IF;
      END LOOP;
      PERFORM public.erp_insert_route(v_company, v_entity, v_line_id, v_qty, v_input -> 'route');
    WHEN 'order.launch' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'draft' THEN RAISE EXCEPTION 'Only draft orders can launch' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_entity) OR EXISTS (
        SELECT 1 FROM public.erp_tasks t JOIN public.erp_employees e ON e.company_id = t.company_id AND e.id = t.employee_id
        WHERE t.company_id = v_company AND t.order_id = v_entity AND NOT e.active
      ) THEN RAISE EXCEPTION 'An active production route is required' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_orders SET status = 'production' WHERE company_id = v_company AND id = v_entity;
      UPDATE public.erp_order_items SET status = 'production'
        WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled';
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.issue' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'production' THEN RAISE EXCEPTION 'Production order required' USING ERRCODE = '23514'; END IF;
      IF v_actor.role = 'worker' AND cardinality(v_workshop_scope) > 0 AND NOT EXISTS (
        SELECT 1 FROM public.erp_tasks t WHERE t.company_id = v_company AND t.order_id = v_order.id
          AND t.workshop_id = ANY(v_workshop_scope)) THEN
        RAISE EXCEPTION 'Bu buyurtma boshqa sexga tegishli' USING ERRCODE = '42501';
      END IF;
      v_line_id := CASE WHEN p_command ? 'lineId' THEN public.erp_uuid(p_command -> 'lineId', 'lineId') ELSE NULL END;
      IF v_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id) THEN
        RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id)) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND issued_qty < qty AND (v_line_id IS NULL OR line_id = v_line_id) ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_order.customer_id THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        v_qty := v_material.qty - v_material.issued_qty;
        v_free := greatest(public.erp_stock_qty(v_company, v_item.id, v_order.warehouse_id)
          - public.erp_reserved_qty(v_company, v_item.id, v_entity, v_order.warehouse_id), 0);
        IF v_free <= 0 THEN RAISE EXCEPTION 'Omborda material yo‘q. Qoldiqni to‘ldiring' USING ERRCODE = '23514'; END IF;
        v_take := least(v_qty, v_free);
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
          VALUES (v_company, v_item.id, 'out', v_take,
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'order', v_entity, 'Production issue', v_order.warehouse_id);
        UPDATE public.erp_order_materials SET issued_qty = round(issued_qty + v_take, 3),
          actual_cost = CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END WHERE id = v_material.id;
      END LOOP;
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.cancel' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_shipments
        WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled') THEN
        RAISE EXCEPTION 'Shipped orders cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_stock_movements
        WHERE company_id = v_company AND source = 'production' AND source_id = v_entity) THEN
        RAISE EXCEPTION 'Produced stock cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND order_id = v_entity AND issued_qty > 0 ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi', v_order.warehouse_id);
        UPDATE public.erp_order_materials SET issued_qty = 0, actual_cost = 0 WHERE id = v_material.id;
      END LOOP;
      UPDATE public.erp_order_items SET status = 'cancelled' WHERE company_id = v_company AND order_id = v_entity;
      UPDATE public.erp_orders SET status = 'cancelled' WHERE company_id = v_company AND id = v_entity;
    WHEN 'orderLine.cancel' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      v_line_id := public.erp_uuid(p_command -> 'lineId', 'lineId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Stock production has no order lines' USING ERRCODE = '23514'; END IF;
      IF v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be edited' USING ERRCODE = '23514';
      END IF;
      SELECT * INTO v_line_row FROM public.erp_order_items
        WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
      IF v_line_row.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Delivered work cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF public.erp_line_shipped(v_company, v_line_id) > 0 THEN
        RAISE EXCEPTION 'Shipped line cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id
        AND executor_kind = 'supplier' AND status = 'completed') THEN
        RAISE EXCEPTION 'Accepted outsourced work cannot be cancelled' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials
        WHERE company_id = v_company AND line_id = v_line_id AND issued_qty > 0 ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
          VALUES (v_company, v_material.item_id, 'in', v_material.issued_qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi', v_order.warehouse_id);
      END LOOP;
      DELETE FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id;
      DELETE FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id
        AND NOT public.erp_task_started(v_company, v_entity, id);
      UPDATE public.erp_order_items SET status = 'cancelled' WHERE company_id = v_company AND id = v_line_id;
      PERFORM public.erp_sync_identity(v_company, v_entity);
      PERFORM public.erp_sync_order(v_company, v_entity);
      v_entity := v_line_id;
    WHEN 'customer.pay' THEN
      v_customer := public.erp_uuid(p_command -> 'customerId', 'customerId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'in', v_amount, v_account, 'sale', v_customer, v_customer, 'sale', '', public.erp_cash_number(v_company, 'in')) RETURNING id INTO v_entity;
    WHEN 'work.accept' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'assigned' THEN RAISE EXCEPTION 'Task is not awaiting acceptance' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_tasks SET status = 'accepted' WHERE id = v_task.id;
      v_entity := v_task.id;
    WHEN 'outsource.accept' THEN
      v_entity := public.erp_uuid(p_command -> 'taskId', 'taskId');
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_task.order_id FOR UPDATE;
      IF v_order.status <> 'production' THEN RAISE EXCEPTION 'Order is not in production' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND id = v_task.line_id AND status = 'production') THEN
        RAISE EXCEPTION 'Order line is not in production' USING ERRCODE = '23514';
      END IF;
      IF v_task.executor_kind <> 'supplier' OR v_task.supplier_id IS NULL THEN
        RAISE EXCEPTION 'Not an outsourced task' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'assigned' OR v_task.completed <> 0 THEN
        RAISE EXCEPTION 'Outsourced task is already accepted' USING ERRCODE = '23514';
      END IF;
      IF NOT (v_task.supplier_cost > 0 OR v_task.rate > 0) THEN
        RAISE EXCEPTION 'Supplier amount is required before acceptance' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_tasks SET completed = planned, status = 'completed'
        WHERE company_id = v_company AND id = v_task.id;
      PERFORM public.erp_ready(v_company, v_task.order_id);
    WHEN 'work.start' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'accepted' THEN RAISE EXCEPTION 'Task must be accepted before start' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_tasks SET status = 'in_progress' WHERE id = v_task.id;
      v_entity := v_task.id;
    WHEN 'work.submit' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'in_progress' THEN RAISE EXCEPTION 'Task must be started before submission' USING ERRCODE = '23514'; END IF;
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      IF v_qty > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_work_reports
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id
          AND employee_id = v_task.employee_id AND status = 'submitted') THEN
        RAISE EXCEPTION 'Report already submitted' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_work_reports(company_id, order_id, task_id, employee_id, qty, note)
        VALUES (v_company, v_task.order_id, v_task.id, v_task.employee_id, v_qty, public.erp_text(p_command -> 'note', 'note', true))
        RETURNING * INTO v_report;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      IF v_operation.auto_accept THEN
        v_new_completed := least(v_task.planned, v_task.completed + v_qty);
        UPDATE public.erp_work_reports SET status = 'accepted' WHERE id = v_report.id;
        UPDATE public.erp_tasks SET completed = v_new_completed,
          status = CASE WHEN v_new_completed >= v_task.planned THEN 'completed' ELSE 'in_progress' END WHERE id = v_task.id;
        v_amount := round(v_task.rate * v_new_completed, 2);
        SELECT * INTO v_payroll FROM public.erp_payroll
          WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET report_id = v_report.id, amount = v_amount, status = 'accepted' WHERE id = v_payroll.id;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_report.id, v_task.order_id, v_task.id, v_amount, 'accepted');
        END IF;
        PERFORM public.erp_ready(v_company, v_task.order_id);
      ELSE
        v_amount := round(v_task.rate * (v_task.completed + v_qty), 2);
        SELECT * INTO v_payroll FROM public.erp_payroll
          WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
        IF FOUND THEN
          IF v_payroll.status <> 'accepted' THEN
            UPDATE public.erp_payroll SET report_id = v_report.id, amount = v_amount, status = 'pending' WHERE id = v_payroll.id;
          END IF;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_report.id, v_task.order_id, v_task.id, v_amount, 'pending');
        END IF;
        UPDATE public.erp_tasks SET status = 'submitted' WHERE id = v_task.id;
      END IF;
      v_entity := v_report.id;
    WHEN 'work.review' THEN
      v_entity := public.erp_uuid(p_command -> 'reportId', 'reportId');
      v_accept := public.erp_bool(p_command -> 'accept', 'accept');
      IF v_accept AND (p_command ? 'defectQty' OR p_command ? 'reason' OR p_command ? 'note') THEN
        RAISE EXCEPTION 'Review must be plain' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(coalesce(p_command ->> 'note', ''));
      IF NOT v_accept THEN
        v_reason := p_command ->> 'reason';
        IF v_reason IS NULL OR v_reason NOT IN ('quality', 'measurement', 'drawing', 'customer', 'other') THEN
          RAISE EXCEPTION 'Defect reason is required' USING ERRCODE = '23514';
        END IF;
        IF v_reason = 'other' AND v_note = '' THEN RAISE EXCEPTION 'Defect note is required' USING ERRCODE = '23514'; END IF;
        IF length(v_note) > 500 THEN RAISE EXCEPTION 'Defect note is too long' USING ERRCODE = '23514'; END IF;
      END IF;
      SELECT * INTO v_report FROM public.erp_work_reports WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_report.status <> 'submitted' THEN RAISE EXCEPTION 'Report is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_report.order_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_report.task_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      IF v_report.employee_id <> v_task.employee_id THEN RAISE EXCEPTION 'Report employee is not assigned' USING ERRCODE = '23514'; END IF;
      IF v_actor.role = 'worker' AND cardinality(v_workshop_scope) > 0
         AND NOT (v_task.workshop_id = ANY(v_workshop_scope)) THEN
        RAISE EXCEPTION 'Bu bosqich boshqa sexga tegishli' USING ERRCODE = '42501';
      END IF;
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND issued_qty < qty) THEN
        RAISE EXCEPTION 'Materials must be issued before review' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'submitted' THEN RAISE EXCEPTION 'Task is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      SELECT * INTO STRICT v_employee FROM public.erp_employees WHERE company_id = v_company AND id = v_report.employee_id;
      SELECT * INTO v_payroll FROM public.erp_payroll
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
      IF v_accept THEN
        v_good := v_report.qty;
      ELSE
        v_defect := round(CASE WHEN p_command ? 'defectQty' THEN public.erp_num(p_command -> 'defectQty', 'defectQty', true) ELSE v_report.qty END, 2);
        IF v_defect <= 0 THEN RAISE EXCEPTION 'Nothing to reject' USING ERRCODE = '23514'; END IF;
        IF v_defect > v_report.qty THEN RAISE EXCEPTION 'Defect quantity exceeds report' USING ERRCODE = '23514'; END IF;
        v_good := round(v_report.qty - v_defect, 2);
      END IF;
      IF v_good > 0 THEN
        IF NOT v_employee.active THEN RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023'; END IF;
        IF NOT (v_task.employee_id = ANY(v_operation.employee_ids)) THEN
          RAISE EXCEPTION 'Worker is not authorized for this operation' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_task.line_id
          AND position < v_task.position AND completed < planned) THEN
          RAISE EXCEPTION 'Previous route stage is incomplete' USING ERRCODE = '23514';
        END IF;
        IF v_good > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
        v_new_completed := least(v_task.planned, v_task.completed + v_good);
        UPDATE public.erp_work_reports SET qty = v_good, status = 'accepted' WHERE id = v_entity;
        UPDATE public.erp_tasks SET completed = v_new_completed,
          status = CASE WHEN v_new_completed >= v_task.planned THEN 'completed' ELSE 'in_progress' END WHERE id = v_task.id;
        v_amount := round(v_task.rate * v_new_completed, 2);
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET report_id = v_entity, amount = v_amount, status = 'accepted' WHERE id = v_payroll.id;
        ELSE
          INSERT INTO public.erp_payroll(company_id, employee_id, report_id, order_id, task_id, amount, status)
            VALUES (v_company, v_task.employee_id, v_entity, v_task.order_id, v_task.id, v_amount, 'accepted');
        END IF;
        PERFORM public.erp_ready(v_company, v_order.id);
      ELSE
        UPDATE public.erp_work_reports SET status = 'rejected' WHERE id = v_entity;
        UPDATE public.erp_tasks SET status = 'in_progress' WHERE id = v_task.id;
        IF v_payroll.id IS NOT NULL THEN
          UPDATE public.erp_payroll SET amount = round(v_task.rate * v_task.completed, 2),
            status = CASE WHEN v_payroll.status = 'accepted' THEN 'accepted' ELSE 'rejected' END WHERE id = v_payroll.id;
        END IF;
      END IF;
      IF NOT v_accept THEN
        INSERT INTO public.erp_defects(company_id, report_id, order_id, line_id, task_id, employee_id, operation_id, qty, reason, note, materials)
          VALUES (v_company, v_report.id, v_order.id, v_task.line_id, v_task.id, v_report.employee_id, v_task.operation_id,
            v_defect, v_reason, v_note,
            CASE WHEN v_operation.unit = 'squareMeter' AND jsonb_array_length(v_operation.norms) > 0 THEN (
              SELECT coalesce(jsonb_agg(jsonb_build_object('itemId', n.value -> 'itemId',
                'qty', round(public.erp_num(n.value -> 'qtyPerM2', 'qtyPerM2') * v_defect, 3)) ORDER BY n.ord), '[]'::jsonb)
              FROM jsonb_array_elements(v_operation.norms) WITH ORDINALITY AS n(value, ord)
              WHERE EXISTS (SELECT 1 FROM public.erp_items i WHERE i.company_id = v_company AND i.id = public.erp_uuid(n.value -> 'itemId', 'itemId'))
            ) ELSE '[]'::jsonb END);
      END IF;
    WHEN 'purchase.create' THEN
      v_id := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_id) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      v_warehouse := CASE WHEN p_command ? 'warehouseId' AND p_command -> 'warehouseId' <> 'null'::jsonb
        THEN public.erp_uuid(p_command -> 'warehouseId', 'warehouseId')
        ELSE '00000000-0000-4000-8000-00000000a001'::uuid END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse AND active) THEN
        RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
      END IF;
      v_purchase_order := NULL;
      IF p_command ? 'orderId' AND p_command -> 'orderId' <> 'null'::jsonb THEN
        v_purchase_order := public.erp_uuid(p_command -> 'orderId', 'orderId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_orders WHERE company_id = v_company AND id = v_purchase_order) THEN
          RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023';
        END IF;
      END IF;
      INSERT INTO public.erp_purchases(company_id, number, supplier_id, warehouse_id, order_id)
        VALUES (v_company, 'PUR-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_purchases WHERE company_id = v_company), v_id, v_warehouse, v_purchase_order)
        RETURNING id INTO v_entity;
      v_pos := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'lines', 'lines', true)) LOOP
        v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND OR v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Purchases require business-owned items' USING ERRCODE = '23514'; END IF;
        INSERT INTO public.erp_purchase_lines(company_id, purchase_id, item_id, position, qty, price)
          VALUES (v_company, v_entity, v_id, v_pos, public.erp_num(v_line -> 'qty', 'purchase qty'), public.erp_money(v_line -> 'price', 'purchase price', true));
        v_pos := v_pos + 1;
      END LOOP;
    WHEN 'purchase.receive' THEN
      v_entity := public.erp_uuid(p_command -> 'purchaseId', 'purchaseId');
      SELECT * INTO v_purchase FROM public.erp_purchases WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '22023'; END IF;
      v_input := public.erp_array(p_command -> 'lines', 'lines', true);
      IF (SELECT count(*) <> count(DISTINCT public.erp_uuid(value -> 'lineId', 'lineId')) FROM jsonb_array_elements(v_input)) THEN
        RAISE EXCEPTION 'Duplicate receipt line' USING ERRCODE = '22023';
      END IF;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_input) LOOP
        v_id := public.erp_uuid(v_line -> 'lineId', 'lineId');
        v_qty := public.erp_num(v_line -> 'qty', 'received qty');
        SELECT * INTO v_purchase_line FROM public.erp_purchase_lines WHERE company_id = v_company AND id = v_id AND purchase_id = v_entity;
        IF NOT FOUND THEN RAISE EXCEPTION 'Line does not belong to purchase' USING ERRCODE = '22023'; END IF;
        IF v_qty > v_purchase_line.qty - v_purchase_line.received THEN RAISE EXCEPTION 'Receipt exceeds outstanding quantity' USING ERRCODE = '23514'; END IF;
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_purchase_line.item_id FOR UPDATE;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Cannot purchase customer-owned material' USING ERRCODE = '23514'; END IF;
        v_stock := public.erp_stock_qty(v_company, v_item.id);
        v_cost := round((v_stock * v_item.cost + v_qty * v_purchase_line.price) / (v_stock + v_qty), 2);
        v_new_labor := least(v_cost, round((v_stock * v_item.labor_cost) / (v_stock + v_qty), 2));
        UPDATE public.erp_items SET cost = v_cost, labor_cost = v_new_labor, material_cost = round(v_cost - v_new_labor, 2),
          last_purchase_price = v_purchase_line.price WHERE company_id = v_company AND id = v_item.id;
        UPDATE public.erp_purchase_lines SET received = received + v_qty,
          previous_purchase_price = v_item.last_purchase_price, new_purchase_price = v_purchase_line.price,
          previous_average_cost = v_item.cost, new_average_cost = v_cost WHERE id = v_id;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
          VALUES (v_company, v_item.id, 'in', v_qty, v_purchase_line.price, 'purchase', v_entity, 'Purchase receipt', v_purchase.warehouse_id);
      END LOOP;
    WHEN 'supplier.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := CASE WHEN p_command ? 'allowPrepay' THEN public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay') ELSE false END;
      v_note := coalesce(p_command ->> 'note', '');
      v_kind := coalesce(p_command ->> 'category', 'supplier');
      IF v_kind NOT IN ('supplier', 'outsourcing') THEN
        RAISE EXCEPTION 'Invalid supplier payment category' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'orderId' AND btrim(p_command ->> 'orderId') <> '' THEN
        v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
        SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
        IF v_order.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled order cannot be paid' USING ERRCODE = '23514'; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_id
          AND executor_kind = 'supplier' AND supplier_id = v_entity) THEN
          RAISE EXCEPTION 'Supplier is not assigned to this order' USING ERRCODE = '23514';
        END IF;
      END IF;
      v_cap := public.erp_supplier_cost(v_company, v_entity) - public.erp_paid(v_company, 'supplier', v_entity);
      IF NOT v_allow_prepay AND v_amount > v_cap THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'supplier', v_entity, v_kind, v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'payroll.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_owed := (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, 'Payroll payment', '', public.erp_cash_number(v_company, 'out'));
    WHEN 'salary.plan.set' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF p_command -> 'mode' IS NOT NULL AND p_command ->> 'mode' <> 'fixed' THEN
        RAISE EXCEPTION 'Workers are paid a fixed monthly salary only' USING ERRCODE = '23514';
      END IF;
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary plan month' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_salary_plans(company_id, employee_id, amount, mode, from_month)
        VALUES (v_company, v_entity, v_amount, 'fixed', p_command ->> 'fromMonth')
      ON CONFLICT (company_id, employee_id, from_month) DO UPDATE
        SET amount = EXCLUDED.amount, mode = 'fixed';
    WHEN 'salary.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_kind := public.erp_text(p_command -> 'kind', 'kind');
      IF v_kind NOT IN ('payroll', 'advance') THEN RAISE EXCEPTION 'Invalid salary payment kind' USING ERRCODE = '22023'; END IF;
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      v_owed := (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, v_kind, v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'expense.plan.set' THEN
      IF p_command -> 'planId' IS NOT NULL AND p_command -> 'planId' <> 'null'::jsonb THEN
        v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      ELSE
        v_entity := gen_random_uuid();
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'title', 'title', true));
      IF v_title = '' OR length(v_title) > 200 THEN RAISE EXCEPTION 'Expense title required' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid expense plan month' USING ERRCODE = '22023';
      END IF;
      IF (p_command ->> 'dueDay') IS NULL OR (p_command ->> 'dueDay') !~ '^[0-9]+$'
        OR (p_command ->> 'dueDay')::int NOT BETWEEN 1 AND 31 THEN
        RAISE EXCEPTION 'Invalid expense due day' USING ERRCODE = '22023';
      END IF;
      IF p_command -> 'supplierId' IS NOT NULL AND p_command -> 'supplierId' <> 'null'::jsonb THEN
        v_ref := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_ref) THEN
          RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_ref := NULL;
      END IF;
      INSERT INTO public.erp_expense_plans(company_id, plan_id, title, amount, from_month, due_day, supplier_id)
        VALUES (v_company, v_entity, v_title, v_amount, p_command ->> 'fromMonth', (p_command ->> 'dueDay')::int, v_ref)
      ON CONFLICT (company_id, plan_id, from_month) DO UPDATE
        SET title = EXCLUDED.title, amount = EXCLUDED.amount, due_day = EXCLUDED.due_day, supplier_id = EXCLUDED.supplier_id;
    WHEN 'expense.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'planId', 'planId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_entity) THEN
        RAISE EXCEPTION 'Expense plan not found' USING ERRCODE = '22023';
      END IF;
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      v_allow_prepay := public.erp_bool(p_command -> 'allowPrepay', 'allowPrepay');
      v_owed := (public.erp_expense_ledger(v_company, v_entity) ->> 'owed')::numeric;
      IF NOT v_allow_prepay AND v_amount > v_owed THEN RAISE EXCEPTION 'Payment exceeds payable' USING ERRCODE = '23514'; END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'expense', v_entity, 'expense', v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'loan.set' THEN
      IF p_command -> 'loanId' IS NOT NULL AND p_command -> 'loanId' <> 'null'::jsonb THEN
        v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      ELSE
        v_entity := gen_random_uuid();
      END IF;
      IF (p_command ->> 'kind') IS NULL OR (p_command ->> 'kind') NOT IN ('loan', 'investment') THEN
        RAISE EXCEPTION 'Invalid loan kind' USING ERRCODE = '22023';
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'title', 'title', true));
      IF v_title = '' OR length(v_title) > 200 THEN RAISE EXCEPTION 'Loan title required' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_loans(company_id, id, title, kind, amount, note)
        VALUES (v_company, v_entity, v_title, p_command ->> 'kind', v_amount, v_note)
        ON CONFLICT (company_id, id) DO UPDATE
          SET title = EXCLUDED.title, kind = EXCLUDED.kind, amount = EXCLUDED.amount, note = EXCLUDED.note;
    WHEN 'loan.draw' THEN
      v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Loan not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_account := public.erp_account(p_command -> 'account');
      IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'available')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds loan balance' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'in', v_amount, v_account, 'loan', v_entity, NULL, 'loan-draw', v_note, public.erp_cash_number(v_company, 'in'));
    WHEN 'loan.repay' THEN
      v_entity := public.erp_uuid(p_command -> 'loanId', 'loanId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Loan not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_note := btrim(public.erp_text(p_command -> 'note', 'note', true));
      IF length(v_note) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      v_account := public.erp_account(p_command -> 'account');
      IF v_amount > (public.erp_loan_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds loan debt' USING ERRCODE = '23514';
      END IF;
      IF v_amount > public.erp_balance(v_company, v_account) THEN
        RAISE EXCEPTION 'Insufficient account balance' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'loan', v_entity, NULL, 'loan-repay', v_note, public.erp_cash_number(v_company, 'out'));
    WHEN 'routeTemplate.create' THEN
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_route_templates(company_id, id, name, kind, active, stages)
        VALUES (v_company, v_entity, v_title, v_kind, true, v_lines);
    WHEN 'routeTemplate.update' THEN
      v_entity := public.erp_uuid(p_command -> 'templateId', 'templateId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_route_templates WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Route template not found' USING ERRCODE = '22023';
      END IF;
      v_title := btrim(public.erp_text(p_command -> 'name', 'name'));
      v_kind := p_command ->> 'kind';
      IF v_kind NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order line kind' USING ERRCODE = '22023'; END IF;
      v_stages := public.erp_array(p_command -> 'stages', 'stages', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_stages) LOOP
        v_lines := v_lines || jsonb_build_array(public.erp_route_template_stage(v_company, v_line));
      END LOOP;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      UPDATE public.erp_route_templates
        SET name = v_title, kind = v_kind, active = v_active, stages = v_lines
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'ticket.create' THEN
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      v_context := public.erp_ticket_context(p_command -> 'context');
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      v_entity := gen_random_uuid();
      INSERT INTO public.erp_support_tickets(company_id, id, author_id, author_name, author_role, status, messages)
        VALUES (v_company, v_entity, v_author, v_actor.name, CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END, 'open',
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author, 'authorName', v_actor.name,
            'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
            'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'text', v_text, 'context', v_context)));
    WHEN 'ticket.reply' THEN
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets
        WHERE company_id = v_company AND id = v_entity
          AND (v_actor.role = 'admin' OR author_id = v_actor.employee_id)
        FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      v_text := btrim(public.erp_text(p_command -> 'text', 'Ticket text', true));
      IF v_text = '' THEN RAISE EXCEPTION 'Ticket text is required' USING ERRCODE = '22023'; END IF;
      IF length(v_text) > 2000 THEN RAISE EXCEPTION 'Ticket text is too long' USING ERRCODE = '22023'; END IF;
      IF jsonb_array_length(v_ticket.messages) >= 200 THEN RAISE EXCEPTION 'Ticket is full' USING ERRCODE = '22023'; END IF;
      v_author := CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END;
      UPDATE public.erp_support_tickets
        SET messages = messages || jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'authorId', v_author,
              'authorName', v_actor.name, 'authorRole', CASE WHEN v_actor.role = 'admin' THEN 'admin' ELSE 'worker' END,
              'at', to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'text', v_text, 'context', NULL)),
            status = 'open', closed_at = NULL, closed_by_name = NULL, updated_at = transaction_timestamp()
        WHERE company_id = v_company AND id = v_entity;
    WHEN 'ticket.close' THEN
      IF v_actor.role <> 'admin' THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
      v_entity := public.erp_uuid(p_command -> 'ticketId', 'ticketId');
      SELECT * INTO v_ticket FROM public.erp_support_tickets WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '22023'; END IF;
      IF v_ticket.status = 'open' THEN
        UPDATE public.erp_support_tickets SET status = 'closed', closed_at = transaction_timestamp(), closed_by_name = v_actor.name
          WHERE company_id = v_company AND id = v_entity;
      END IF;
    WHEN 'customer.link' THEN
      v_entity := public.erp_uuid(p_command -> 'customerId', 'customerId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF p_command ? 'employeeId' AND btrim(p_command ->> 'employeeId') <> '' THEN
        v_employee_id := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
        IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_employee_id) THEN
          RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_employee_id AND id <> v_entity) THEN
          RAISE EXCEPTION 'Employee already has a customer account' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_employee_id := NULL;
      END IF;
      UPDATE public.erp_customers SET employee_id = v_employee_id WHERE company_id = v_company AND id = v_entity;
    WHEN 'salary.deduct' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      SELECT id INTO v_customer FROM public.erp_customers WHERE company_id = v_company AND employee_id = v_entity;
      IF v_customer IS NULL THEN RAISE EXCEPTION 'Employee has no customer account' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      IF v_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = '22023'; END IF;
      IF char_length(coalesce(p_command ->> 'note', '')) > 200 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
      IF v_amount > public.erp_customer_debt(v_company, v_customer) + 0.004 THEN
        RAISE EXCEPTION 'Amount exceeds customer debt' USING ERRCODE = '22023';
      END IF;
      IF v_amount > (public.erp_salary_ledger(v_company, v_entity) ->> 'owed')::numeric THEN
        RAISE EXCEPTION 'Amount exceeds salary debt' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, created_at)
        VALUES (v_company, v_entity, v_customer, v_amount, 'deduct', btrim(coalesce(p_command ->> 'note', '')), CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
    WHEN 'salary.deduct.reverse' THEN
      v_entity := public.erp_uuid(p_command -> 'deductionId', 'deductionId');
      SELECT employee_id, customer_id, amount INTO v_employee_id, v_customer, v_amount
        FROM public.erp_worker_deductions
       WHERE company_id = v_company AND id = v_entity AND direction = 'deduct';
      IF NOT FOUND THEN RAISE EXCEPTION 'Deduction not found' USING ERRCODE = '22023'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_worker_deductions WHERE company_id = v_company AND reversal_of = v_entity) THEN
        RAISE EXCEPTION 'Deduction already reversed' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_worker_deductions(company_id, employee_id, customer_id, amount, direction, note, reversal_of, created_at)
        VALUES (v_company, v_employee_id, v_customer, v_amount, 'refund', '', v_entity, CURRENT_TIMESTAMP)
        RETURNING id INTO v_entity;
    WHEN 'inventory.count' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      v_qty := public.erp_num(p_command -> 'qty', 'count qty', true);
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      PERFORM public.erp_text(p_command -> 'note', 'note', true);
      v_warehouse := CASE WHEN p_command ? 'warehouseId' AND p_command -> 'warehouseId' <> 'null'::jsonb
        THEN public.erp_uuid(p_command -> 'warehouseId', 'warehouseId')
        ELSE '00000000-0000-4000-8000-00000000a001'::uuid END;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse AND active) THEN
        RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
      END IF;
      IF v_qty < public.erp_reserved_qty(v_company, v_entity, NULL, v_warehouse) THEN RAISE EXCEPTION 'Count is below reserved quantity' USING ERRCODE = '23514'; END IF;
      v_stock := public.erp_stock_qty(v_company, v_entity, v_warehouse);
      IF v_qty <> v_stock THEN
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
          VALUES (v_company, v_entity, CASE WHEN v_qty > v_stock THEN 'in' ELSE 'out' END, abs(v_qty - v_stock),
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'inventory', v_entity, p_command ->> 'note', v_warehouse);
      END IF;
    WHEN 'warehouse.create' THEN
      v_text := btrim(public.erp_text(p_command -> 'name', 'name'));
      IF EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND lower(name) = lower(v_text)) THEN
        RAISE EXCEPTION 'Name already exists' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_warehouses(company_id, name) VALUES (v_company, v_text) RETURNING id INTO v_entity;
    WHEN 'warehouse.update' THEN
      v_entity := public.erp_uuid(p_command -> 'warehouseId', 'warehouseId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      v_text := btrim(public.erp_text(p_command -> 'name', 'name'));
      IF EXISTS (SELECT 1 FROM public.erp_warehouses
        WHERE company_id = v_company AND id <> v_entity AND lower(name) = lower(v_text)) THEN
        RAISE EXCEPTION 'Name already exists' USING ERRCODE = '22023';
      END IF;
      v_active := public.erp_bool(p_command -> 'active', 'active');
      IF NOT v_active AND NOT EXISTS (SELECT 1 FROM public.erp_warehouses
        WHERE company_id = v_company AND id <> v_entity AND active) THEN
        RAISE EXCEPTION 'Kamida bitta faol ombor qolishi kerak' USING ERRCODE = '23514';
      END IF;
      UPDATE public.erp_warehouses SET name = v_text, active = v_active WHERE company_id = v_company AND id = v_entity;
    WHEN 'warehouse.transfer' THEN
      v_id := public.erp_uuid(p_command -> 'fromId', 'fromId');
      v_warehouse := public.erp_uuid(p_command -> 'toId', 'toId');
      IF v_id = v_warehouse THEN RAISE EXCEPTION 'Omborlar bir xil bo‘lmasligi kerak' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_id) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_id AND active) THEN
        RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse) THEN
        RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_warehouses WHERE company_id = v_company AND id = v_warehouse AND active) THEN
        RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';
      END IF;
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      v_free := public.erp_stock_qty(v_company, v_entity, v_id) - public.erp_reserved_qty(v_company, v_entity, NULL, v_id);
      IF v_qty > v_free THEN RAISE EXCEPTION 'Omborda yetarli qoldiq yo‘q' USING ERRCODE = '23514'; END IF;
      v_ref := gen_random_uuid();
      v_note := public.erp_text(p_command -> 'note', 'note', true);
      v_cost := CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END;
      INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note, warehouse_id)
        VALUES (v_company, v_entity, 'out', v_qty, v_cost, 'transfer', v_ref, v_note, v_id),
               (v_company, v_entity, 'in', v_qty, v_cost, 'transfer', v_ref, v_note, v_warehouse);
      v_entity := v_ref;
    WHEN 'cash.post' THEN
      v_direction := public.erp_text(p_command -> 'direction', 'direction');
      IF v_direction NOT IN ('in', 'out', 'transfer') THEN RAISE EXCEPTION 'Invalid cash direction' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT (p_command ? 'toAccount') THEN RAISE EXCEPTION 'toAccount is required (account or null)' USING ERRCODE = '22023'; END IF;
      v_to_account := CASE WHEN p_command -> 'toAccount' = 'null'::jsonb THEN NULL ELSE public.erp_account(p_command -> 'toAccount') END;
      IF (v_direction = 'transfer' AND (v_to_account IS NULL OR v_to_account = v_account))
        OR (v_direction <> 'transfer' AND v_to_account IS NOT NULL) THEN RAISE EXCEPTION 'Invalid transfer accounts' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, category, note, number)
        VALUES (v_company, v_direction, v_amount, v_account, v_to_account, CASE WHEN v_direction = 'transfer' THEN 'transfer' ELSE 'manual' END,
          public.erp_text(p_command -> 'category', 'category', true), public.erp_text(p_command -> 'note', 'note', true),
          CASE WHEN v_direction = 'transfer' THEN NULL ELSE public.erp_cash_number(v_company, v_direction) END) RETURNING id INTO v_entity;
    WHEN 'cash.reverse' THEN
      v_id := public.erp_uuid(p_command -> 'entryId', 'entryId');
      SELECT * INTO v_cash FROM public.erp_cash WHERE company_id = v_company AND id = v_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cash entry not found' USING ERRCODE = '22023'; END IF;
      IF v_cash.reversal_of IS NOT NULL THEN RAISE EXCEPTION 'Cannot reverse a reversal' USING ERRCODE = '23514'; END IF;
      IF EXISTS (SELECT 1 FROM public.erp_cash WHERE company_id = v_company AND reversal_of = v_id) THEN
        RAISE EXCEPTION 'Cash entry already reversed' USING ERRCODE = '23505';
      END IF;
      IF v_cash.source = 'sale' AND NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_cash.customer_id)
        OR v_cash.source = 'supplier' AND NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_cash.source_id)
        OR v_cash.source = 'payroll' AND NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_cash.source_id)
        OR v_cash.source = 'expense' AND NOT EXISTS (SELECT 1 FROM public.erp_expense_plans WHERE company_id = v_company AND plan_id = v_cash.source_id)
        OR v_cash.source = 'loan' AND NOT EXISTS (SELECT 1 FROM public.erp_loans WHERE company_id = v_company AND id = v_cash.source_id) THEN
        RAISE EXCEPTION 'Cash source entity not found' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, source_id, customer_id, category, note, reversal_of, number)
        VALUES (v_company, CASE v_cash.direction WHEN 'in' THEN 'out' WHEN 'out' THEN 'in' ELSE 'transfer' END,
          v_cash.amount, CASE WHEN v_cash.direction = 'transfer' THEN v_cash.to_account ELSE v_cash.account END,
          CASE WHEN v_cash.direction = 'transfer' THEN v_cash.account ELSE NULL END,
          v_cash.source, v_cash.source_id, v_cash.customer_id, v_cash.category, public.erp_text(p_command -> 'note', 'note', true), v_id,
          CASE WHEN v_cash.direction = 'transfer' THEN NULL ELSE public.erp_cash_number(v_company, CASE v_cash.direction WHEN 'out' THEN 'in' ELSE 'out' END) END) RETURNING id INTO v_entity;
    WHEN 'shipment.create' THEN
      v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      -- Command shape is validated before production state is consulted.
      v_line := coalesce(p_command -> 'lines', jsonb_build_array(jsonb_build_object('lineId',
        (SELECT i.id FROM public.erp_order_items i WHERE i.company_id = v_company AND i.order_id = v_id
          ORDER BY i.position LIMIT 1), 'qty', coalesce(p_command -> 'qty', '0'::jsonb))));
      v_lines := (SELECT jsonb_agg(jsonb_build_object('lineId', g.line_id, 'qty', g.qty) ORDER BY g.ord)
        FROM (SELECT public.erp_uuid(l.value -> 'lineId', 'lineId') AS line_id, min(l.ordinality) AS ord,
          round(sum(public.erp_num(l.value -> 'qty', 'shipment qty')), 2) AS qty
          FROM jsonb_array_elements(public.erp_array(v_line, 'lines', true)) WITH ORDINALITY AS l(value, ordinality)
          GROUP BY 1) g);
      v_accept := public.erp_bool(p_command -> 'allowDebt', 'allowDebt');
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Stock production is not shipped to a customer' USING ERRCODE = '23514'; END IF;
      IF v_order.customer_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_order.customer_id) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      IF v_order.status NOT IN ('production', 'ready', 'shipped') THEN
        RAISE EXCEPTION 'Order is not ready to ship' USING ERRCODE = '23514';
      END IF;
      FOR v_rec IN SELECT l.value AS entry FROM jsonb_array_elements(v_lines) l LOOP
        v_line_id := public.erp_uuid(v_rec.entry -> 'lineId', 'lineId');
        SELECT * INTO v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_id AND id = v_line_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023'; END IF;
        IF v_line_row.status = 'cancelled' THEN RAISE EXCEPTION 'Cancelled line cannot be shipped' USING ERRCODE = '23514'; END IF;
        IF v_line_row.status NOT IN ('ready', 'shipped') THEN RAISE EXCEPTION 'Order line is not ready to ship' USING ERRCODE = '23514'; END IF;
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id AND issued_qty < qty)
          OR EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND line_id = v_line_id AND completed < planned) THEN
          RAISE EXCEPTION 'Order production is incomplete' USING ERRCODE = '23514';
        END IF;
        IF public.erp_num(v_rec.entry -> 'qty', 'shipment qty') > v_line_row.qty - public.erp_line_shipped(v_company, v_line_id) THEN
          RAISE EXCEPTION 'Shipment exceeds remaining quantity' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      IF NOT v_accept AND public.erp_order_paid(v_company, v_id) < v_order.price THEN
        RAISE EXCEPTION 'Order debt requires explicit allowDebt' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_shipments(company_id, order_id, customer_id, kind, address, due_date)
        VALUES (v_company, v_id, v_order.customer_id, 'order', public.erp_text(p_command -> 'address', 'address', true),
          public.erp_date(p_command -> 'dueDate')) RETURNING id INTO v_entity;
      v_pos := 0;
      FOR v_rec IN SELECT l.value AS entry FROM jsonb_array_elements(v_lines) l LOOP
        v_line_id := public.erp_uuid(v_rec.entry -> 'lineId', 'lineId');
        v_qty := public.erp_num(v_rec.entry -> 'qty', 'shipment qty');
        SELECT * INTO STRICT v_line_row FROM public.erp_order_items
          WHERE company_id = v_company AND order_id = v_id AND id = v_line_id;
        SELECT round(coalesce(sum(round(m.issued_qty * m.actual_cost, 2)), 0), 2) INTO v_material_total
          FROM public.erp_order_materials m WHERE m.company_id = v_company AND m.line_id = v_line_id AND m.issued_qty > 0;
        SELECT round(coalesce(sum(p.amount), 0), 2) INTO v_labor_total
          FROM public.erp_payroll p JOIN public.erp_tasks t ON t.company_id = p.company_id AND t.id = p.task_id
          WHERE p.company_id = v_company AND p.order_id = v_id AND p.status = 'accepted' AND t.line_id = v_line_id;
        v_labor_total := round(v_labor_total + coalesce((SELECT sum(CASE WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2) ELSE round(t.completed * t.rate, 2) END)
          FROM public.erp_tasks t WHERE t.company_id = v_company AND t.order_id = v_id AND t.line_id = v_line_id
            AND t.executor_kind = 'supplier' AND t.status = 'completed'), 0), 2);
        v_cost_total := round(v_material_total + v_labor_total, 2);
        v_before := public.erp_line_shipped(v_company, v_line_id);
        v_sale_slice := round(v_line_row.total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_line_row.total * v_before / v_line_row.qty, 2);
        v_cost_slice := round(v_cost_total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_cost_total * v_before / v_line_row.qty, 2);
        v_material_slice := round(v_material_total * (v_before + v_qty) / v_line_row.qty, 2)
          - round(v_material_total * v_before / v_line_row.qty, 2);
        INSERT INTO public.erp_shipment_lines(company_id, shipment_id, position, item_id, line_id, description, qty,
          sale_price, unit_cost, material_cost, labor_cost)
          VALUES (v_company, v_entity, v_pos, NULL, v_line_id, v_order.number || ' · ' || v_line_row.title, v_qty,
            round(v_sale_slice / v_qty, 6), round(v_cost_slice / v_qty, 6),
            round(v_material_slice / v_qty, 6), round((v_cost_slice - v_material_slice) / v_qty, 6));
        UPDATE public.erp_order_items SET status = 'shipped' WHERE company_id = v_company AND id = v_line_id;
        v_pos := v_pos + 1;
      END LOOP;
      PERFORM public.erp_sync_order(v_company, v_id);
    WHEN 'shipment.createStock' THEN
      v_customer := public.erp_uuid(p_command -> 'customerId', 'customerId');
      v_accept := public.erp_bool(p_command -> 'allowDebt', 'allowDebt');
      SELECT * INTO v_customer_row FROM public.erp_customers WHERE company_id = v_company AND id = v_customer;
      IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      IF v_customer_row.kind <> 'shop' THEN RAISE EXCEPTION 'Stock sales require a shop' USING ERRCODE = '23514'; END IF;
      v_input := public.erp_array(p_command -> 'lines', 'lines', true);
      IF jsonb_array_length(v_input) = 0 THEN RAISE EXCEPTION 'Shipment requires lines' USING ERRCODE = '22023'; END IF;
      IF (SELECT count(*) <> count(DISTINCT public.erp_uuid(value -> 'itemId', 'itemId')) FROM jsonb_array_elements(v_input)) THEN
        RAISE EXCEPTION 'Duplicate shipment item' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_shipments(company_id, customer_id, kind, address, due_date)
        VALUES (v_company, v_customer, 'stock', v_customer_row.address, public.erp_date(p_command -> 'dueDate')) RETURNING id INTO v_entity;
      v_pos := 0;
      v_total := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_input) LOOP
        v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
        v_qty := public.erp_num(v_line -> 'qty', 'shipment qty');
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
        IF v_item.customer_id IS NOT NULL THEN RAISE EXCEPTION 'Customer materials cannot be sold from stock' USING ERRCODE = '23514'; END IF;
        IF v_item.kind <> 'finished' THEN RAISE EXCEPTION 'Only finished goods can be sold from stock' USING ERRCODE = '23514'; END IF;
        IF v_qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id) THEN
          RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_shipment_lines(company_id, shipment_id, position, item_id, description, qty,
          sale_price, unit_cost, material_cost, labor_cost)
          VALUES (v_company, v_entity, v_pos, v_item.id, v_item.name, v_qty,
            v_item.sale_price, v_item.cost, v_item.material_cost, v_item.labor_cost);
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_qty, v_item.cost, 'sale', v_entity, '');
        v_total := round(v_total + round(v_qty * v_item.sale_price, 2), 2);
        v_pos := v_pos + 1;
      END LOOP;
      IF NOT v_accept AND v_total > greatest(public.erp_customer_paid(v_company, v_customer)
        - coalesce((SELECT sum(o.total) FROM public.erp_customer_obligations(v_company, v_customer) o WHERE o.id <> v_entity), 0), 0) THEN
        RAISE EXCEPTION 'Unpaid stock shipment' USING ERRCODE = '23514';
      END IF;
    WHEN 'shipment.reverse' THEN
      v_entity := public.erp_uuid(p_command -> 'shipmentId', 'shipmentId');
      SELECT * INTO v_shipment FROM public.erp_shipments WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = '22023'; END IF;
      IF v_shipment.status = 'cancelled' THEN RAISE EXCEPTION 'Shipment already reversed' USING ERRCODE = '23514'; END IF;
      IF v_shipment.kind <> 'stock' THEN RAISE EXCEPTION 'Only stock sales can be reversed' USING ERRCODE = '23514'; END IF;
      FOR v_line IN SELECT jsonb_build_object('itemId', l.item_id, 'qty', l.qty, 'unitCost', l.unit_cost) AS value
        FROM public.erp_shipment_lines l WHERE l.company_id = v_company AND l.shipment_id = v_entity ORDER BY l.position LOOP
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, public.erp_uuid(v_line -> 'itemId', 'itemId'), 'in', public.erp_num(v_line -> 'qty', 'qty'),
            public.erp_num(v_line -> 'unitCost', 'unitCost'), 'sale', v_entity, 'Возврат по сторно отгрузки');
      END LOOP;
      UPDATE public.erp_shipments SET status = 'cancelled' WHERE company_id = v_company AND id = v_entity;
    WHEN 'shipment.deliver' THEN
      v_entity := public.erp_uuid(p_command -> 'shipmentId', 'shipmentId');
      SELECT * INTO v_shipment FROM public.erp_shipments WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_shipment.status <> 'shipped' THEN RAISE EXCEPTION 'Undelivered shipment required' USING ERRCODE = '23514'; END IF;
      IF v_shipment.kind = 'order' THEN
        SELECT * INTO STRICT v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_shipment.order_id FOR UPDATE;
        IF v_order.status NOT IN ('production', 'ready', 'shipped') THEN RAISE EXCEPTION 'Order is not shipped' USING ERRCODE = '23514'; END IF;
      END IF;
      UPDATE public.erp_shipments SET status = 'delivered', delivered_at = transaction_timestamp() WHERE id = v_entity;
      IF v_shipment.kind = 'order' THEN
        UPDATE public.erp_order_items SET status = 'delivered'
          WHERE company_id = v_company AND order_id = v_order.id AND status = 'shipped'
            AND qty <= public.erp_line_shipped(v_company, id, true);
        PERFORM public.erp_sync_order(v_company, v_order.id);
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported command: %', v_type USING ERRCODE = '22023';
  END CASE;

  PERFORM public.erp_assert_stock(v_company);
  PERFORM public.erp_assert_cash(v_company);
  UPDATE public.erp_metadata SET revision = revision + 1 WHERE company_id = v_company;
  INSERT INTO public.erp_audit(company_id, request_id, actor_user_id, actor_id, actor_name, action, entity_id, command, expected_revision, revision)
    VALUES (v_company, p_request_id, v_actor.id, CASE WHEN v_actor.role = 'worker' THEN v_actor.employee_id ELSE v_actor.id END,
      v_actor.name, v_type, v_entity::text, p_command, p_expected_revision, v_revision + 1);
  RETURN public.erp_snapshot();
END;
$$;
REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;

COMMIT;
