-- Aliya ERP: third customer kind (xizmat buyurtmachisi). Idempotent.
-- Apply after a backup; safe to run more than once.

begin;

alter table public.erp_customers drop constraint if exists erp_customers_kind_check;
alter table public.erp_customers add constraint erp_customers_kind_check check (kind in ('customer', 'shop', 'service'));

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
  v_cost numeric;
  v_stock numeric;
  v_cap numeric;
  v_advance numeric;
  v_account text;
  v_to_account text;
  v_direction text;
  v_accept boolean;
  v_new_completed numeric;
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
BEGIN
  v_actor := public.erp_current_profile();
  v_company := v_actor.company_id;
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
  IF v_actor.role = 'worker' AND v_type NOT IN ('work.accept', 'work.start', 'work.submit') THEN
    RAISE EXCEPTION 'Workers may only perform their own assigned work' USING ERRCODE = '42501';
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
      INSERT INTO public.erp_customers(company_id, name, phone, address, kind) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true),
        public.erp_text(p_command -> 'address', 'address', true), v_kind) RETURNING id INTO v_entity;
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
      UPDATE public.erp_employees SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        active = public.erp_bool(p_command -> 'active', 'active') WHERE id = v_entity;
    WHEN 'machine.create' THEN
      INSERT INTO public.erp_machines(company_id, name, hourly_revenue_target) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')),
        public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true)) RETURNING id INTO v_entity;
    WHEN 'machine.update' THEN
      v_entity := public.erp_uuid(p_command -> 'machineId', 'machineId');
      SELECT * INTO v_machine FROM public.erp_machines WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found' USING ERRCODE = '22023'; END IF;
      UPDATE public.erp_machines SET name = btrim(public.erp_text(p_command -> 'name', 'name')),
        hourly_revenue_target = public.erp_money(p_command -> 'hourlyRevenueTarget', 'hourlyRevenueTarget', true),
        active = public.erp_bool(p_command -> 'active', 'active') WHERE id = v_entity;
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
      INSERT INTO public.erp_operations(company_id, name, unit, sale_price, worker_rate, standard_minutes, machine_id, employee_ids, active, auto_accept)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), v_unit,
          public.erp_money(p_command -> 'salePrice', 'salePrice', true),
          public.erp_money(p_command -> 'workerRate', 'workerRate', true),
          public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
          v_ref, v_employee_ids, public.erp_bool(p_command -> 'active', 'active'),
          public.erp_bool(p_command -> 'autoAccept', 'autoAccept')) RETURNING id INTO v_entity;
    WHEN 'operation.update' THEN
      v_entity := public.erp_uuid(p_command -> 'operationId', 'operationId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_operations WHERE company_id = v_company AND id = v_entity) THEN
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
      UPDATE public.erp_operations SET name = btrim(public.erp_text(p_command -> 'name', 'name')), unit = v_unit,
        sale_price = public.erp_money(p_command -> 'salePrice', 'salePrice', true),
        worker_rate = public.erp_money(p_command -> 'workerRate', 'workerRate', true),
        standard_minutes = public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
        machine_id = v_ref, employee_ids = v_employee_ids,
        active = public.erp_bool(p_command -> 'active', 'active'),
        auto_accept = public.erp_bool(p_command -> 'autoAccept', 'autoAccept') WHERE id = v_entity;
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
      IF public.erp_text(v_input -> 'kind', 'kind') NOT IN ('product', 'service') THEN RAISE EXCEPTION 'Invalid order kind' USING ERRCODE = '22023'; END IF;
      v_qty := public.erp_num(v_input -> 'qty', 'qty');
      v_amount := public.erp_money(v_input -> 'price', 'price', true);
      v_advance := public.erp_money(v_input -> 'advance', 'advance', true);
      v_account := public.erp_account(v_input -> 'account');
      IF v_advance > v_amount THEN RAISE EXCEPTION 'Advance exceeds order total' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, due_date)
        VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
          v_input ->> 'kind', v_customer, public.erp_text(v_input -> 'title', 'title'), v_qty, v_amount,
          public.erp_money(v_input -> 'overhead', 'overhead', true), public.erp_date(v_input -> 'dueDate')) RETURNING * INTO v_order;
      v_entity := v_order.id;
      v_pos := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(v_input -> 'materials', 'materials')) LOOP
        v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
        SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_customer THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_order_materials(company_id, order_id, item_id, position, qty, estimated_cost)
          VALUES (v_company, v_entity, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
        v_pos := v_pos + 1;
      END LOOP;
      v_pos := 0;
      PERFORM public.erp_insert_route(v_company, v_entity, v_qty, v_input -> 'route');
      IF v_advance > 0 THEN
        INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note)
          VALUES (v_company, 'in', v_advance, v_account, 'sale', v_customer, v_customer, 'sale', '');
      END IF;
    WHEN 'order.update' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Series orders follow their recipe' USING ERRCODE = '23514'; END IF;
      IF v_order.status NOT IN ('draft', 'production', 'ready') THEN
        RAISE EXCEPTION 'Order cannot be edited' USING ERRCODE = '23514';
      END IF;
      v_qty := public.erp_num(p_command -> 'qty', 'qty');
      SELECT coalesce(max(completed), 0) INTO v_stock
        FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_entity;
      SELECT coalesce(sum(l.qty), 0) INTO v_cap
        FROM public.erp_shipment_lines l
        JOIN public.erp_shipments s ON s.company_id = l.company_id AND s.id = l.shipment_id
        WHERE l.company_id = v_company AND s.order_id = v_entity AND s.status <> 'cancelled';
      IF v_qty < v_stock THEN RAISE EXCEPTION 'Quantity is below accepted work' USING ERRCODE = '23514'; END IF;
      IF v_qty < v_cap THEN RAISE EXCEPTION 'Quantity is below shipped quantity' USING ERRCODE = '23514'; END IF;
      v_amount := public.erp_money(p_command -> 'price', 'price', true);
      v_customer := v_order.customer_id;
      UPDATE public.erp_orders SET title = btrim(public.erp_text(p_command -> 'title', 'title')), qty = v_qty,
        price = v_amount, overhead = public.erp_money(p_command -> 'overhead', 'overhead', true),
        due_date = public.erp_date(p_command -> 'dueDate') WHERE id = v_entity;
      IF v_order.status = 'draft' THEN
        DELETE FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity;
        v_pos := 0;
        FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) LOOP
          v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
          SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
          IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_customer THEN
            RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
          END IF;
          INSERT INTO public.erp_order_materials(company_id, order_id, item_id, position, qty, estimated_cost)
            VALUES (v_company, v_entity, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
              CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
          v_pos := v_pos + 1;
        END LOOP;
        DELETE FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_entity;
        PERFORM public.erp_insert_route(v_company, v_entity, v_qty, p_command -> 'route');
      ELSE
        -- Revision of a launched order: merge, freezing issued materials and started stages.
        IF (SELECT count(*) FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) l)
          <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'itemId', 'itemId'))
            FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) l) THEN
          RAISE EXCEPTION 'Duplicate material' USING ERRCODE = '22023';
        END IF;
        IF (SELECT count(*) FROM jsonb_array_elements(public.erp_array(p_command -> 'route', 'route', true)) l
            WHERE l.value ? 'taskId')
          <> (SELECT count(DISTINCT public.erp_uuid(l.value -> 'taskId', 'taskId'))
            FROM jsonb_array_elements(public.erp_array(p_command -> 'route', 'route', true)) l
            WHERE l.value ? 'taskId') THEN
          RAISE EXCEPTION 'Duplicate task' USING ERRCODE = '22023';
        END IF;
        FOR v_material IN SELECT * FROM public.erp_order_materials
          WHERE company_id = v_company AND order_id = v_entity AND issued LOOP
          IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) l
            WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = v_material.item_id
              AND public.erp_num(l.value -> 'qty', 'material qty') = v_material.qty) THEN
            RAISE EXCEPTION 'Issued material cannot be removed or changed' USING ERRCODE = '23514';
          END IF;
        END LOOP;
        FOR v_task IN SELECT * FROM public.erp_tasks
          WHERE company_id = v_company AND order_id = v_entity LOOP
          IF v_task.status <> 'assigned' OR v_task.completed > 0
            OR EXISTS (SELECT 1 FROM public.erp_work_reports r
              WHERE r.company_id = v_company AND r.order_id = v_entity AND r.task_id = v_task.id) THEN
            IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.erp_array(p_command -> 'route', 'route', true)) l
              WHERE CASE WHEN l.value ? 'taskId' THEN public.erp_uuid(l.value -> 'taskId', 'taskId') = v_task.id ELSE false END
                AND public.erp_uuid(l.value -> 'operationId', 'operationId') = v_task.operation_id
                AND public.erp_uuid(l.value -> 'employeeId', 'employeeId') = v_task.employee_id
                AND public.erp_money(l.value -> 'rate', 'route rate', true) = v_task.rate) THEN
              RAISE EXCEPTION 'Started stage cannot be removed or changed' USING ERRCODE = '23514';
            END IF;
          END IF;
        END LOOP;
        UPDATE public.erp_order_materials SET position = position + 1000000
          WHERE company_id = v_company AND order_id = v_entity;
        DELETE FROM public.erp_order_materials m
          WHERE m.company_id = v_company AND m.order_id = v_entity AND NOT m.issued
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) l
              WHERE public.erp_uuid(l.value -> 'itemId', 'itemId') = m.item_id);
        v_pos := 0;
        FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'materials', 'materials')) LOOP
          v_id := public.erp_uuid(v_line -> 'itemId', 'itemId');
          SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023'; END IF;
          IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_customer THEN
            RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
          END IF;
          SELECT * INTO v_material FROM public.erp_order_materials
            WHERE company_id = v_company AND order_id = v_entity AND item_id = v_id;
          IF FOUND THEN
            UPDATE public.erp_order_materials SET position = v_pos,
              qty = CASE WHEN v_material.issued THEN v_material.qty ELSE public.erp_num(v_line -> 'qty', 'material qty') END,
              estimated_cost = CASE WHEN v_material.issued THEN v_material.estimated_cost
                WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END
              WHERE id = v_material.id;
          ELSE
            INSERT INTO public.erp_order_materials(company_id, order_id, item_id, position, qty, estimated_cost)
              VALUES (v_company, v_entity, v_id, v_pos, public.erp_num(v_line -> 'qty', 'material qty'),
                CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END);
          END IF;
          v_pos := v_pos + 1;
        END LOOP;
        UPDATE public.erp_tasks SET position = position + 1000000
          WHERE company_id = v_company AND order_id = v_entity;
        DELETE FROM public.erp_tasks t
          WHERE t.company_id = v_company AND t.order_id = v_entity
            AND NOT (t.status <> 'assigned' OR t.completed > 0
              OR EXISTS (SELECT 1 FROM public.erp_work_reports r WHERE r.company_id = v_company AND r.task_id = t.id))
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.erp_array(p_command -> 'route', 'route', true)) l
              WHERE CASE WHEN l.value ? 'taskId' THEN public.erp_uuid(l.value -> 'taskId', 'taskId') = t.id ELSE false END);
        v_pos := 0;
        FOR v_line IN SELECT value FROM jsonb_array_elements(public.erp_array(p_command -> 'route', 'route', true)) LOOP
          SELECT * INTO v_operation FROM public.erp_operations WHERE company_id = v_company
            AND id = public.erp_uuid(v_line -> 'operationId', 'operationId');
          IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE = '22023'; END IF;
          IF NOT v_operation.active THEN RAISE EXCEPTION 'Operation is inactive' USING ERRCODE = '23514'; END IF;
          v_id := public.erp_uuid(v_line -> 'employeeId', 'employeeId');
          IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_id AND active) THEN
            RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';
          END IF;
          IF NOT (v_id = ANY(v_operation.employee_ids)) THEN
            RAISE EXCEPTION 'Employee is not authorized for this operation' USING ERRCODE = '23514';
          END IF;
          IF v_line ? 'taskId' THEN
            SELECT * INTO v_task FROM public.erp_tasks
              WHERE company_id = v_company AND id = public.erp_uuid(v_line -> 'taskId', 'taskId') AND order_id = v_entity FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
            IF v_task.status <> 'assigned' OR v_task.completed > 0
              OR EXISTS (SELECT 1 FROM public.erp_work_reports r
                WHERE r.company_id = v_company AND r.order_id = v_entity AND r.task_id = v_task.id) THEN
              UPDATE public.erp_tasks SET position = v_pos, name = v_operation.name,
                sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes, planned = v_qty,
                status = CASE WHEN v_task.status = 'completed' AND v_task.completed < v_qty THEN 'in_progress' ELSE v_task.status END
                WHERE id = v_task.id;
            ELSE
              UPDATE public.erp_tasks SET position = v_pos, operation_id = v_operation.id, name = v_operation.name,
                employee_id = v_id, rate = public.erp_money(v_line -> 'rate', 'route rate', true),
                sale_price = v_operation.sale_price, standard_minutes = v_operation.standard_minutes,
                planned = v_qty, completed = 0, status = 'assigned' WHERE id = v_task.id;
            END IF;
          ELSE
            INSERT INTO public.erp_tasks(company_id, order_id, position, operation_id, name, employee_id, rate, sale_price, standard_minutes, planned)
              VALUES (v_company, v_entity, v_pos, v_operation.id, v_operation.name, v_id,
                public.erp_money(v_line -> 'rate', 'route rate', true), v_operation.sale_price, v_operation.standard_minutes, v_qty);
          END IF;
          v_pos := v_pos + 1;
        END LOOP;
        IF v_order.status = 'ready' AND (
          EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND order_id = v_entity AND NOT issued)
          OR EXISTS (SELECT 1 FROM public.erp_tasks
            WHERE company_id = v_company AND order_id = v_entity AND completed < planned)) THEN
          UPDATE public.erp_orders SET status = 'production' WHERE company_id = v_company AND id = v_entity;
        END IF;
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
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity AND item_id = v_chosen) THEN
          RAISE EXCEPTION 'Duplicate recipe component' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_order_materials(company_id, order_id, item_id, position, qty, estimated_cost)
          VALUES (v_company, v_entity, v_chosen, v_pos, v_qty * v_component.qty_per_unit, v_item.cost);
        v_pos := v_pos + 1;
      END LOOP;
      PERFORM public.erp_insert_route(v_company, v_entity, v_qty, v_input -> 'route');
    WHEN 'order.launch' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'draft' THEN RAISE EXCEPTION 'Only draft orders can launch' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_entity) OR EXISTS (
        SELECT 1 FROM public.erp_tasks t JOIN public.erp_employees e ON e.company_id = t.company_id AND e.id = t.employee_id
        WHERE t.company_id = v_company AND t.order_id = v_entity AND NOT e.active
      ) THEN RAISE EXCEPTION 'An active production route is required' USING ERRCODE = '23514'; END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity LOOP
        IF v_material.qty > public.erp_stock_qty(v_company, v_material.item_id) - public.erp_reserved_qty(v_company, v_material.item_id) THEN
          RAISE EXCEPTION 'Insufficient unreserved material stock' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      UPDATE public.erp_orders SET status = 'production' WHERE company_id = v_company AND id = v_entity;
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.issue' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'production' THEN RAISE EXCEPTION 'Production order required' USING ERRCODE = '23514'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity AND NOT issued) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity AND issued) THEN
        RAISE EXCEPTION 'Materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_material.qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id, v_entity) THEN
          RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_material.qty, v_item.cost, 'order', v_entity, 'Production issue');
        UPDATE public.erp_order_materials SET issued = true, actual_cost = v_item.cost WHERE id = v_material.id;
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
        WHERE company_id = v_company AND order_id = v_entity AND issued ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
        UPDATE public.erp_order_materials SET issued = false, actual_cost = 0 WHERE id = v_material.id;
      END LOOP;
      UPDATE public.erp_orders SET status = 'cancelled' WHERE company_id = v_company AND id = v_entity;
    WHEN 'customer.pay' THEN
      v_customer := public.erp_uuid(p_command -> 'customerId', 'customerId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_customers WHERE company_id = v_company AND id = v_customer) THEN
        RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, customer_id, category, note)
        VALUES (v_company, 'in', v_amount, v_account, 'sale', v_customer, v_customer, 'sale', '') RETURNING id INTO v_entity;
    WHEN 'work.accept' THEN
      v_task := public.erp_work_task(v_company, v_actor, public.erp_uuid(p_command -> 'orderId', 'orderId'),
        public.erp_uuid(p_command -> 'taskId', 'taskId'));
      IF v_task.status <> 'assigned' THEN RAISE EXCEPTION 'Task is not awaiting acceptance' USING ERRCODE = '23514'; END IF;
      UPDATE public.erp_tasks SET status = 'accepted' WHERE id = v_task.id;
      v_entity := v_task.id;
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
      SELECT * INTO v_report FROM public.erp_work_reports
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
      IF FOUND THEN
        IF v_report.status = 'submitted' THEN RAISE EXCEPTION 'Report already submitted' USING ERRCODE = '23514'; END IF;
        UPDATE public.erp_work_reports SET qty = v_qty, note = public.erp_text(p_command -> 'note', 'note', true), status = 'submitted'
          WHERE id = v_report.id RETURNING * INTO v_report;
      ELSE
        INSERT INTO public.erp_work_reports(company_id, order_id, task_id, employee_id, qty, note)
          VALUES (v_company, v_task.order_id, v_task.id, v_task.employee_id, v_qty, public.erp_text(p_command -> 'note', 'note', true))
          RETURNING * INTO v_report;
      END IF;
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
          UPDATE public.erp_payroll SET report_id = v_report.id, amount = v_amount,
            status = CASE WHEN v_payroll.status = 'accepted' THEN 'accepted' ELSE 'pending' END WHERE id = v_payroll.id;
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
      SELECT * INTO v_report FROM public.erp_work_reports WHERE company_id = v_company AND id = v_entity FOR UPDATE;
      IF NOT FOUND OR v_report.status <> 'submitted' THEN RAISE EXCEPTION 'Report is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_report.order_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
      SELECT * INTO v_task FROM public.erp_tasks WHERE company_id = v_company AND id = v_report.task_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Task not found' USING ERRCODE = '22023'; END IF;
      IF v_report.employee_id <> v_task.employee_id THEN RAISE EXCEPTION 'Report employee is not assigned' USING ERRCODE = '23514'; END IF;
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND NOT issued) THEN
        RAISE EXCEPTION 'Materials must be issued before review' USING ERRCODE = '23514';
      END IF;
      IF v_task.status <> 'submitted' THEN RAISE EXCEPTION 'Task is not awaiting review' USING ERRCODE = '23514'; END IF;
      SELECT * INTO STRICT v_operation FROM public.erp_operations WHERE company_id = v_company AND id = v_task.operation_id;
      SELECT * INTO STRICT v_employee FROM public.erp_employees WHERE company_id = v_company AND id = v_report.employee_id;
      SELECT * INTO v_payroll FROM public.erp_payroll
        WHERE company_id = v_company AND order_id = v_task.order_id AND task_id = v_task.id AND employee_id = v_task.employee_id FOR UPDATE;
      IF v_accept THEN
        IF NOT v_employee.active THEN RAISE EXCEPTION 'Employee is inactive' USING ERRCODE = '22023'; END IF;
        IF NOT (v_task.employee_id = ANY(v_operation.employee_ids)) THEN
          RAISE EXCEPTION 'Worker is not authorized for this operation' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM public.erp_tasks WHERE company_id = v_company AND order_id = v_order.id
          AND position < v_task.position AND completed < planned) THEN
          RAISE EXCEPTION 'Previous route stage is incomplete' USING ERRCODE = '23514';
        END IF;
        IF v_report.qty > v_task.planned - v_task.completed THEN RAISE EXCEPTION 'Report exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
        v_new_completed := least(v_task.planned, v_task.completed + v_report.qty);
        UPDATE public.erp_work_reports SET status = 'accepted' WHERE id = v_entity;
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
        IF v_payroll.id IS NOT NULL AND v_payroll.status <> 'accepted' THEN
          UPDATE public.erp_payroll SET status = 'rejected' WHERE id = v_payroll.id;
        END IF;
      END IF;
    WHEN 'purchase.create' THEN
      v_id := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_id) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_purchases(company_id, number, supplier_id)
        VALUES (v_company, 'PUR-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_purchases WHERE company_id = v_company), v_id)
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
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'in', v_qty, v_purchase_line.price, 'purchase', v_entity, 'Purchase receipt');
      END LOOP;
    WHEN 'supplier.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'supplierId', 'supplierId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_suppliers WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Supplier not found' USING ERRCODE = '22023';
      END IF;
      v_cap := public.erp_supplier_cost(v_company, v_entity);
      IF v_amount > v_cap - public.erp_paid(v_company, 'supplier', v_entity) THEN RAISE EXCEPTION 'Payment exceeds received supplier cost' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note)
        VALUES (v_company, 'out', v_amount, v_account, 'supplier', v_entity, 'Supplier payment', '');
    WHEN 'payroll.pay' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      SELECT coalesce(sum(amount), 0) INTO v_cap FROM public.erp_payroll WHERE company_id = v_company AND employee_id = v_entity AND status = 'accepted';
      IF v_amount > v_cap - public.erp_paid(v_company, 'payroll', v_entity) THEN RAISE EXCEPTION 'Payment exceeds accrued payroll' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, 'Payroll payment', '');
    WHEN 'inventory.count' THEN
      v_entity := public.erp_uuid(p_command -> 'itemId', 'itemId');
      v_qty := public.erp_num(p_command -> 'qty', 'count qty', true);
      SELECT * INTO v_item FROM public.erp_items WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Item not found' USING ERRCODE = '22023'; END IF;
      PERFORM public.erp_text(p_command -> 'note', 'note', true);
      IF v_qty < public.erp_reserved_qty(v_company, v_entity) THEN RAISE EXCEPTION 'Count is below reserved quantity' USING ERRCODE = '23514'; END IF;
      v_stock := public.erp_stock_qty(v_company, v_entity);
      IF v_qty <> v_stock THEN
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_entity, CASE WHEN v_qty > v_stock THEN 'in' ELSE 'out' END, abs(v_qty - v_stock), v_item.cost, 'inventory', v_entity, p_command ->> 'note');
      END IF;
    WHEN 'cash.post' THEN
      v_direction := public.erp_text(p_command -> 'direction', 'direction');
      IF v_direction NOT IN ('in', 'out', 'transfer') THEN RAISE EXCEPTION 'Invalid cash direction' USING ERRCODE = '22023'; END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount');
      v_account := public.erp_account(p_command -> 'account');
      IF NOT (p_command ? 'toAccount') THEN RAISE EXCEPTION 'toAccount is required (account or null)' USING ERRCODE = '22023'; END IF;
      v_to_account := CASE WHEN p_command -> 'toAccount' = 'null'::jsonb THEN NULL ELSE public.erp_account(p_command -> 'toAccount') END;
      IF (v_direction = 'transfer' AND (v_to_account IS NULL OR v_to_account = v_account))
        OR (v_direction <> 'transfer' AND v_to_account IS NOT NULL) THEN RAISE EXCEPTION 'Invalid transfer accounts' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, category, note)
        VALUES (v_company, v_direction, v_amount, v_account, v_to_account, CASE WHEN v_direction = 'transfer' THEN 'transfer' ELSE 'manual' END,
          public.erp_text(p_command -> 'category', 'category', true), public.erp_text(p_command -> 'note', 'note', true)) RETURNING id INTO v_entity;
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
        OR v_cash.source = 'payroll' AND NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_cash.source_id) THEN
        RAISE EXCEPTION 'Cash source entity not found' USING ERRCODE = '23514';
      END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, to_account, source, source_id, customer_id, category, note, reversal_of)
        VALUES (v_company, CASE v_cash.direction WHEN 'in' THEN 'out' WHEN 'out' THEN 'in' ELSE 'transfer' END,
          v_cash.amount, CASE WHEN v_cash.direction = 'transfer' THEN v_cash.to_account ELSE v_cash.account END,
          CASE WHEN v_cash.direction = 'transfer' THEN v_cash.account ELSE NULL END,
          v_cash.source, v_cash.source_id, v_cash.customer_id, v_cash.category, public.erp_text(p_command -> 'note', 'note', true), v_id) RETURNING id INTO v_entity;
    WHEN 'shipment.create' THEN
      v_id := public.erp_uuid(p_command -> 'orderId', 'orderId');
      v_qty := public.erp_num(p_command -> 'qty', 'shipment qty');
      v_accept := public.erp_bool(p_command -> 'allowDebt', 'allowDebt');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_id;
      IF NOT FOUND OR v_order.status NOT IN ('ready', 'shipped') THEN RAISE EXCEPTION 'Ready order required for shipment' USING ERRCODE = '23514'; END IF;
      IF v_order.kind = 'series' THEN RAISE EXCEPTION 'Stock production is not shipped to a customer' USING ERRCODE = '23514'; END IF;
      IF v_order.customer_id IS NULL THEN RAISE EXCEPTION 'Customer not found' USING ERRCODE = '22023'; END IF;
      SELECT coalesce(sum(l.qty), 0) INTO v_before
        FROM public.erp_shipment_lines l JOIN public.erp_shipments s ON s.company_id = l.company_id AND s.id = l.shipment_id
        WHERE s.company_id = v_company AND s.order_id = v_id AND s.status <> 'cancelled';
      IF v_qty > v_order.qty - v_before THEN RAISE EXCEPTION 'Shipment exceeds remaining quantity' USING ERRCODE = '23514'; END IF;
      IF NOT v_accept AND public.erp_order_paid(v_company, v_id) < v_order.price THEN RAISE EXCEPTION 'Order debt requires explicit allowDebt' USING ERRCODE = '23514'; END IF;
      SELECT coalesce(sum(round(m.qty * m.actual_cost, 2)), 0) INTO v_material_total
        FROM public.erp_order_materials m
        WHERE m.company_id = v_company AND m.order_id = v_id AND m.issued;
      SELECT coalesce(sum(p.amount), 0) INTO v_labor_total
        FROM public.erp_payroll p
        WHERE p.company_id = v_company AND p.order_id = v_id AND p.status = 'accepted';
      v_cost_total := round(v_material_total + v_labor_total, 2);
      v_sale_slice := round(v_order.price * (v_before + v_qty) / v_order.qty, 2) - round(v_order.price * v_before / v_order.qty, 2);
      v_cost_slice := round(v_cost_total * (v_before + v_qty) / v_order.qty, 2) - round(v_cost_total * v_before / v_order.qty, 2);
      v_material_slice := round(v_material_total * (v_before + v_qty) / v_order.qty, 2) - round(v_material_total * v_before / v_order.qty, 2);
      INSERT INTO public.erp_shipments(company_id, order_id, customer_id, kind, address, due_date)
        VALUES (v_company, v_id, v_order.customer_id, 'order', public.erp_text(p_command -> 'address', 'address', true),
          public.erp_date(p_command -> 'dueDate')) RETURNING id INTO v_entity;
      INSERT INTO public.erp_shipment_lines(company_id, shipment_id, position, item_id, description, qty,
        sale_price, unit_cost, material_cost, labor_cost)
        VALUES (v_company, v_entity, 0, NULL, v_order.number || ' · ' || v_order.title, v_qty,
          round(v_sale_slice / v_qty, 6), round(v_cost_slice / v_qty, 6),
          round(v_material_slice / v_qty, 6), round((v_cost_slice - v_material_slice) / v_qty, 6));
      UPDATE public.erp_orders SET status = 'shipped' WHERE company_id = v_company AND id = v_id;
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
      IF NOT v_accept AND v_total > public.erp_customer_advance(v_company, v_customer) THEN
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
      SELECT * INTO v_shipment FROM public.erp_shipments WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_shipment.status <> 'shipped' THEN RAISE EXCEPTION 'Undelivered shipment required' USING ERRCODE = '23514'; END IF;
      IF v_shipment.kind = 'order' THEN
        SELECT * INTO STRICT v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_shipment.order_id;
        IF v_order.status <> 'shipped' THEN RAISE EXCEPTION 'Order is not shipped' USING ERRCODE = '23514'; END IF;
      END IF;
      UPDATE public.erp_shipments SET status = 'delivered', delivered_at = transaction_timestamp() WHERE id = v_entity;
      IF v_shipment.kind = 'order' THEN
        SELECT coalesce(sum(l.qty), 0) INTO v_qty
          FROM public.erp_shipment_lines l JOIN public.erp_shipments s ON s.company_id = l.company_id AND s.id = l.shipment_id
          WHERE s.company_id = v_company AND s.order_id = v_order.id AND s.status = 'delivered';
        UPDATE public.erp_orders SET status = CASE WHEN v_qty >= v_order.qty THEN 'delivered' ELSE 'shipped' END
          WHERE company_id = v_company AND id = v_order.id;
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

commit;
