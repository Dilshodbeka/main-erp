-- Aliya ERP: defect journal and three-way review — acceptance, partial and full defect.
-- Safe to run more than once. Existing data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  report_id uuid NOT NULL,
  order_id uuid NOT NULL,
  line_id uuid NOT NULL,
  task_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  qty numeric NOT NULL CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2)),
  reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> '')),
  materials jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(materials) = 'array'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id),
  FOREIGN KEY (company_id, task_id, order_id) REFERENCES public.erp_tasks(company_id, id, order_id),
  FOREIGN KEY (company_id, line_id) REFERENCES public.erp_order_items(company_id, id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id),
  FOREIGN KEY (company_id, operation_id) REFERENCES public.erp_operations(company_id, id)
);
CREATE INDEX IF NOT EXISTS erp_defects_order_idx ON public.erp_defects(company_id, order_id);
CREATE INDEX IF NOT EXISTS erp_defects_employee_idx ON public.erp_defects(company_id, employee_id, created_at);
-- The live database still carries one report per task; the journal needs every submission.
ALTER TABLE public.erp_work_reports DROP CONSTRAINT IF EXISTS erp_work_reports_company_id_order_id_task_id_employee_id_key;
ALTER TABLE public.erp_defects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_defects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_defects TO authenticated;
DROP POLICY IF EXISTS erp_admin_read ON public.erp_defects;
CREATE POLICY erp_admin_read ON public.erp_defects FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

CREATE OR REPLACE FUNCTION public.erp_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_revision bigint; v_profile public.erp_profiles%ROWTYPE; v_company uuid; v_admin boolean; v_board boolean;
BEGIN
  v_profile := public.erp_current_profile();
  v_company := v_profile.company_id;
  -- The shared lock keeps all snapshot arrays at one committed revision.
  SELECT revision INTO STRICT v_revision FROM public.erp_metadata WHERE company_id = v_company FOR SHARE;
  v_admin := v_profile.role = 'admin';
  v_board := v_profile.role = 'display';
  RETURN jsonb_build_object(
    'actor', jsonb_build_object('id', CASE WHEN v_profile.role = 'worker' THEN v_profile.employee_id ELSE v_profile.id END,
      'name', v_profile.name, 'role', v_profile.role, 'companyId', v_company),
    'state', jsonb_build_object(
      'version', 4, 'revision', v_revision, 'companyId', v_company,
      'customers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
        'phone', CASE WHEN v_admin THEN c.phone ELSE '' END, 'address', CASE WHEN v_admin THEN c.address ELSE '' END,
        'kind', c.kind, 'employeeId', c.employee_id) ORDER BY c.id), '[]'::jsonb)
        FROM public.erp_customers c WHERE c.company_id = v_company AND (v_admin OR v_board
          OR EXISTS (SELECT 1 FROM public.erp_orders o JOIN public.erp_tasks t ON t.company_id = o.company_id AND t.order_id = o.id
            WHERE o.company_id = v_company AND o.customer_id = c.id AND t.employee_id = v_profile.employee_id))),
      'suppliers', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'phone', s.phone) ORDER BY s.id), '[]'::jsonb)
        FROM public.erp_suppliers s WHERE s.company_id = v_company AND v_admin),
      'employees', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'active', e.active, 'deactivatedAt', e.deactivated_at) ORDER BY e.id), '[]'::jsonb)
        FROM public.erp_employees e WHERE e.company_id = v_company AND (v_admin OR v_board OR e.id = v_profile.employee_id)),
      'machines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
        'hourlyRevenueTarget', m.hourly_revenue_target, 'active', m.active) ORDER BY m.id), '[]'::jsonb)
        FROM public.erp_machines m WHERE m.company_id = v_company AND v_admin),
      'operations', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', op.id, 'name', op.name, 'unit', op.unit,
        'salePrice', CASE WHEN v_admin THEN op.sale_price ELSE 0 END,
        'workerRate', CASE WHEN v_admin THEN op.worker_rate ELSE 0 END,
        'standardMinutes', op.standard_minutes, 'machineId', op.machine_id,
        'employeeIds', CASE WHEN v_admin THEN to_jsonb(op.employee_ids)
          WHEN v_profile.role = 'worker' AND v_profile.employee_id = ANY(op.employee_ids) THEN to_jsonb(ARRAY[v_profile.employee_id])
          ELSE '[]'::jsonb END,
        'active', op.active, 'autoAccept', op.auto_accept,
        'norms', CASE WHEN v_admin THEN op.norms ELSE '[]'::jsonb END) ORDER BY op.id), '[]'::jsonb)
        FROM public.erp_operations op WHERE op.company_id = v_company AND (v_admin OR v_board
          OR EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = op.company_id AND t.operation_id = op.id
            AND EXISTS (SELECT 1 FROM public.erp_tasks own WHERE own.company_id = t.company_id AND own.order_id = t.order_id
              AND own.employee_id = v_profile.employee_id)))),
      'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit,
        'minQty', CASE WHEN v_admin THEN i.min_qty ELSE 0 END, 'cost', CASE WHEN v_admin THEN i.cost ELSE 0 END,
        'customerId', i.customer_id, 'kind', i.kind,
        'salePrice', CASE WHEN v_admin THEN i.sale_price ELSE 0 END,
        'lastPurchasePrice', CASE WHEN v_admin THEN i.last_purchase_price ELSE 0 END,
        'materialCost', CASE WHEN v_admin THEN i.material_cost ELSE 0 END,
        'laborCost', CASE WHEN v_admin THEN i.labor_cost ELSE 0 END,
        'category', i.category, 'photo', i.photo) ORDER BY i.id), '[]'::jsonb)
        FROM public.erp_items i WHERE i.company_id = v_company AND (v_admin
          OR EXISTS (SELECT 1 FROM public.erp_order_materials m JOIN public.erp_tasks t ON t.company_id = m.company_id AND t.order_id = m.order_id
            WHERE m.company_id = v_company AND m.item_id = i.id AND t.employee_id = v_profile.employee_id))),
      'recipes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'outputItemId', r.output_item_id,
        'active', r.active, 'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version,
          'createdAt', v.created_at, 'components', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'slot', c.slot,
            'itemId', c.item_id, 'allowedItemIds', to_jsonb(c.allowed_item_ids), 'qtyPerUnit', c.qty_per_unit) ORDER BY c.position), '[]'::jsonb)
            FROM public.erp_recipe_components c WHERE c.company_id = v.company_id AND c.version_id = v.id)
          ) ORDER BY v.version), '[]'::jsonb)
          FROM public.erp_recipe_versions v WHERE v.company_id = r.company_id AND v.recipe_id = r.id)
        ) ORDER BY r.id), '[]'::jsonb)
        FROM public.erp_recipes r WHERE r.company_id = v_company AND v_admin),
      'orders', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'number', o.number, 'kind', o.kind, 'customerId', coalesce(o.customer_id::text, ''), 'title', o.title,
        'outputItemId', CASE WHEN v_admin THEN o.output_item_id ELSE NULL END,
        'recipeVersionId', CASE WHEN v_admin THEN o.recipe_version_id ELSE NULL END,
        'substitutions', CASE WHEN v_admin THEN o.substitutions ELSE '{}'::jsonb END,
        'qty', o.qty, 'price', CASE WHEN v_admin THEN o.price ELSE 0 END, 'overhead', CASE WHEN v_admin THEN o.overhead ELSE 0 END,
        'markup', CASE WHEN v_admin THEN o.markup ELSE 0 END,
        'dueDate', o.due_date, 'createdAt', o.created_at, 'status', o.status,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title,
          'qty', i.qty, 'total', CASE WHEN v_admin THEN i.total ELSE 0 END, 'status', i.status) ORDER BY i.position), '[]'::jsonb)
          FROM public.erp_order_items i WHERE i.company_id = o.company_id AND i.order_id = o.id),
        'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lineId', m.line_id, 'itemId', m.item_id, 'qty', m.qty,
          'estimatedCost', CASE WHEN v_admin THEN m.estimated_cost ELSE 0 END, 'issued', m.issued,
          'actualCost', CASE WHEN v_admin THEN m.actual_cost ELSE 0 END) ORDER BY m.position, m.id), '[]'::jsonb)
          FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id),
        'route', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'lineId', t.line_id, 'operationId', t.operation_id, 'name', t.name,
          'executorKind', t.executor_kind,
          'employeeId', CASE WHEN v_admin OR v_board OR t.employee_id = v_profile.employee_id THEN t.employee_id::text ELSE '' END,
          'supplierId', CASE WHEN v_admin THEN t.supplier_id::text ELSE NULL END,
          'rate', CASE WHEN v_admin OR t.employee_id = v_profile.employee_id THEN t.rate ELSE 0 END,
          'supplierCost', CASE WHEN v_admin THEN t.supplier_cost ELSE 0 END,
          'salePrice', CASE WHEN v_admin THEN t.sale_price ELSE 0 END,
          'standardMinutes', t.standard_minutes,
          'planned', t.planned, 'completed', t.completed, 'status', t.status) ORDER BY t.position, t.id), '[]'::jsonb)
          FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id
            AND (v_admin OR v_board OR t.executor_kind = 'employee'))
        ) ORDER BY o.created_at, o.id), '[]'::jsonb) FROM public.erp_orders o
        WHERE o.company_id = v_company AND (v_admin OR v_board
          OR EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id AND t.employee_id = v_profile.employee_id))),
      'purchases', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'supplierId', p.supplier_id, 'createdAt', p.created_at,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'itemId', l.item_id, 'qty', l.qty, 'price', l.price, 'received', l.received,
          'previousPurchasePrice', l.previous_purchase_price, 'newPurchasePrice', l.new_purchase_price,
          'previousAverageCost', l.previous_average_cost, 'newAverageCost', l.new_average_cost) ORDER BY l.position), '[]'::jsonb)
          FROM public.erp_purchase_lines l WHERE l.company_id = p.company_id AND l.purchase_id = p.id)
        ) ORDER BY p.created_at, p.id), '[]'::jsonb) FROM public.erp_purchases p WHERE p.company_id = v_company AND v_admin),
      'movements', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'itemId', m.item_id, 'direction', m.direction, 'qty', m.qty,
        'unitCost', m.unit_cost, 'source', m.source, 'sourceId', m.source_id, 'note', m.note, 'createdAt', m.created_at) ORDER BY m.created_at, m.id), '[]'::jsonb)
        FROM public.erp_stock_movements m WHERE m.company_id = v_company AND v_admin),
      'cash', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'direction', c.direction, 'amount', c.amount, 'account', c.account,
        'toAccount', c.to_account, 'source', c.source, 'sourceId', c.source_id, 'customerId', c.customer_id, 'category', c.category,
        'note', CASE WHEN v_admin THEN c.note ELSE '' END, 'number', c.number, 'reversalOf', c.reversal_of, 'createdAt', c.created_at) ORDER BY c.created_at, c.id), '[]'::jsonb)
        FROM public.erp_cash c WHERE c.company_id = v_company AND (v_admin OR (c.source = 'payroll' AND c.source_id = v_profile.employee_id))),
      'reports', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'orderId', r.order_id, 'taskId', r.task_id, 'employeeId', r.employee_id,
        'qty', r.qty, 'status', r.status, 'note', r.note, 'createdAt', r.created_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
        FROM public.erp_work_reports r WHERE r.company_id = v_company AND (v_admin OR v_board OR r.employee_id = v_profile.employee_id)),
      'payroll', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'reportId', p.report_id, 'orderId', p.order_id,
        'taskId', p.task_id, 'amount', p.amount, 'status', p.status, 'createdAt', p.created_at) ORDER BY p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_payroll p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),
      'defects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reportId', d.report_id, 'orderId', d.order_id,
        'lineId', d.line_id, 'taskId', d.task_id, 'employeeId', d.employee_id, 'operationId', d.operation_id,
        'qty', d.qty, 'reason', d.reason, 'note', d.note, 'materials', d.materials, 'createdAt', d.created_at)
        ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id)),
      'salaryPlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'amount', p.amount,
        'mode', p.mode, 'fromMonth', p.from_month, 'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_salary_plans p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),
      'expensePlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'planId', p.plan_id, 'title', p.title,
        'amount', p.amount, 'fromMonth', p.from_month, 'dueDay', p.due_day, 'supplierId', p.supplier_id,
        'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_expense_plans p WHERE p.company_id = v_company AND v_admin),
      'loans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
        'amount', l.amount, 'note', l.note, 'createdAt', l.created_at) ORDER BY l.created_at, l.id), '[]'::jsonb)
        FROM public.erp_loans l WHERE l.company_id = v_company AND v_admin),
      'routeTemplates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind,
        'active', t.active, 'stages', t.stages) ORDER BY t.created_at, t.id), '[]'::jsonb)
        FROM public.erp_route_templates t WHERE t.company_id = v_company AND v_admin),
      'tickets', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'authorId', t.author_id, 'authorName', t.author_name,
        'authorRole', t.author_role, 'status', t.status, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'closedAt', t.closed_at, 'closedByName', t.closed_by_name, 'messages', t.messages) ORDER BY t.updated_at, t.id), '[]'::jsonb)
        FROM public.erp_support_tickets t WHERE t.company_id = v_company AND (v_admin OR t.author_id = v_profile.employee_id)),
      'workerDeductions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'employeeId', d.employee_id,
        'customerId', d.customer_id, 'amount', d.amount, 'direction', d.direction,
        'note', d.note, 'reversalOf', d.reversal_of, 'createdAt', d.created_at) ORDER BY d.created_at, d.id), '[]'::jsonb)
        FROM public.erp_worker_deductions d WHERE d.company_id = v_company AND (v_admin OR d.employee_id = v_profile.employee_id)),
      'shipments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'orderId', s.order_id, 'customerId', s.customer_id,
        'kind', s.kind, 'address', s.address, 'dueDate', s.due_date, 'status', s.status, 'createdAt', s.created_at,
        'deliveredAt', s.delivered_at, 'reversalOf', NULL,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'lineId', l.line_id, 'itemId', l.item_id, 'description', l.description,
          'qty', l.qty, 'salePrice', l.sale_price, 'unitCost', l.unit_cost,
          'materialCost', l.material_cost, 'laborCost', l.labor_cost) ORDER BY l.position, l.id), '[]'::jsonb)
          FROM public.erp_shipment_lines l WHERE l.company_id = s.company_id AND l.shipment_id = s.id)
        ) ORDER BY s.created_at, s.id), '[]'::jsonb)
        FROM public.erp_shipments s WHERE s.company_id = v_company AND v_admin),
      'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'actorId', a.actor_id, 'actorName', a.actor_name,
        'action', a.action, 'entityId', a.entity_id, 'createdAt', a.created_at) ORDER BY a.revision, a.id), '[]'::jsonb)
        FROM public.erp_audit a WHERE a.company_id = v_company AND v_admin)
    )
  );
END;
$$;
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
  v_salary_mode text;
  v_cost numeric;
  v_stock numeric;
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
  v_shipped numeric := 0;
  v_paid_by_cash numeric := 0;
  v_paid_by_deduct numeric := 0;
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
  IF v_actor.role = 'worker' AND v_type NOT IN ('work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply') THEN
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
      INSERT INTO public.erp_customers(company_id, name, phone, address, kind, employee_id) VALUES (v_company,
        btrim(public.erp_text(p_command -> 'name', 'name')), public.erp_text(p_command -> 'phone', 'phone', true),
        public.erp_text(p_command -> 'address', 'address', true), v_kind, v_employee_id) RETURNING id INTO v_entity;
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
      INSERT INTO public.erp_operations(company_id, name, unit, sale_price, worker_rate, standard_minutes, machine_id, employee_ids, active, auto_accept, norms)
        VALUES (v_company, btrim(public.erp_text(p_command -> 'name', 'name')), v_unit,
          public.erp_money(p_command -> 'salePrice', 'salePrice', true),
          public.erp_money(p_command -> 'workerRate', 'workerRate', true),
          public.erp_num(p_command -> 'standardMinutes', 'standardMinutes', true),
          v_ref, v_employee_ids, public.erp_bool(p_command -> 'active', 'active'),
          public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
          public.erp_norms(v_company, p_command -> 'norms')) RETURNING id INTO v_entity;
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
        auto_accept = public.erp_bool(p_command -> 'autoAccept', 'autoAccept'),
        norms = public.erp_norms(v_company, p_command -> 'norms') WHERE id = v_entity;
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
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_line_kind, v_customer, v_title, v_qty, round(v_amount + v_markup, 2),
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
        INSERT INTO public.erp_orders(company_id, number, kind, customer_id, title, qty, price, overhead, markup, due_date)
          VALUES (v_company, 'ORD-' || (SELECT lpad((count(*) + 1)::text, greatest(4, length((count(*) + 1)::text)), '0') FROM public.erp_orders WHERE company_id = v_company),
            v_kind, v_customer, v_title, v_qty, round(v_amount + v_markup, 2),
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
          v_pos_task := public.erp_revise_route(v_company, v_entity, v_line_id, v_qty,
            v_rec.definition -> 'route', v_pos_task);
          IF v_line_status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
              WHERE company_id = v_company AND line_id = v_line_id AND NOT issued)
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
        PERFORM public.erp_revise_route(v_company, v_entity, v_line_row.id, v_qty, p_command -> 'route', 0);
        IF v_line_row.status = 'ready' AND (EXISTS (SELECT 1 FROM public.erp_order_materials
            WHERE company_id = v_company AND line_id = v_line_row.id AND NOT issued)
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
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity AND item_id = v_chosen) THEN
          RAISE EXCEPTION 'Duplicate recipe component' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_order_materials(company_id, order_id, line_id, item_id, position, qty, estimated_cost)
          VALUES (v_company, v_entity, v_line_id, v_chosen, v_pos, v_qty * v_component.qty_per_unit, v_item.cost);
        v_pos := v_pos + 1;
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
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity LOOP
        IF v_material.qty > public.erp_stock_qty(v_company, v_material.item_id) - public.erp_reserved_qty(v_company, v_material.item_id) THEN
          RAISE EXCEPTION 'Insufficient unreserved material stock' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      UPDATE public.erp_orders SET status = 'production' WHERE company_id = v_company AND id = v_entity;
      UPDATE public.erp_order_items SET status = 'production'
        WHERE company_id = v_company AND order_id = v_entity AND status <> 'cancelled';
      PERFORM public.erp_ready(v_company, v_entity);
    WHEN 'order.issue' THEN
      v_entity := public.erp_uuid(p_command -> 'orderId', 'orderId');
      SELECT * INTO v_order FROM public.erp_orders WHERE company_id = v_company AND id = v_entity;
      IF NOT FOUND OR v_order.status <> 'production' THEN RAISE EXCEPTION 'Production order required' USING ERRCODE = '23514'; END IF;
      v_line_id := CASE WHEN p_command ? 'lineId' THEN public.erp_uuid(p_command -> 'lineId', 'lineId') ELSE NULL END;
      IF v_line_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.erp_order_items
        WHERE company_id = v_company AND order_id = v_entity AND id = v_line_id) THEN
        RAISE EXCEPTION 'Order line not found' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND NOT issued AND (v_line_id IS NULL OR line_id = v_line_id)) THEN
        RAISE EXCEPTION 'All materials already issued' USING ERRCODE = '23514';
      END IF;
      FOR v_material IN SELECT * FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_entity
        AND NOT issued AND (v_line_id IS NULL OR line_id = v_line_id) ORDER BY position LOOP
        SELECT * INTO STRICT v_item FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id;
        IF v_item.customer_id IS NOT NULL AND v_item.customer_id <> v_order.customer_id THEN
          RAISE EXCEPTION 'Material belongs to another customer' USING ERRCODE = '23514';
        END IF;
        IF v_material.qty > public.erp_stock_qty(v_company, v_item.id) - public.erp_reserved_qty(v_company, v_item.id, v_entity) THEN
          RAISE EXCEPTION 'Insufficient stock for issue' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_item.id, 'out', v_material.qty,
            CASE WHEN v_item.customer_id IS NULL THEN v_item.cost ELSE 0 END, 'order', v_entity, 'Production issue');
        UPDATE public.erp_order_materials SET issued = true,
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
        WHERE company_id = v_company AND order_id = v_entity AND issued ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
        UPDATE public.erp_order_materials SET issued = false, actual_cost = 0 WHERE id = v_material.id;
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
        WHERE company_id = v_company AND line_id = v_line_id AND issued ORDER BY position LOOP
        IF NOT EXISTS (SELECT 1 FROM public.erp_items WHERE company_id = v_company AND id = v_material.item_id) THEN
          RAISE EXCEPTION 'Material item not found' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.erp_stock_movements(company_id, item_id, direction, qty, unit_cost, source, source_id, note)
          VALUES (v_company, v_material.item_id, 'in', v_material.qty, v_material.actual_cost, 'order', v_entity,
            'Bekor qilingan buyurtma materiali qaytarildi');
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
      IF v_order.status <> 'production' OR EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND order_id = v_order.id AND NOT issued) THEN
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
      SELECT coalesce(sum(amount), 0) INTO v_cap FROM public.erp_payroll WHERE company_id = v_company AND employee_id = v_entity AND status = 'accepted';
      IF v_amount > v_cap - public.erp_paid(v_company, 'payroll', v_entity) THEN RAISE EXCEPTION 'Payment exceeds accrued payroll' USING ERRCODE = '23514'; END IF;
      INSERT INTO public.erp_cash(company_id, direction, amount, account, source, source_id, category, note, number)
        VALUES (v_company, 'out', v_amount, v_account, 'payroll', v_entity, 'Payroll payment', '', public.erp_cash_number(v_company, 'out'));
    WHEN 'salary.plan.set' THEN
      v_entity := public.erp_uuid(p_command -> 'employeeId', 'employeeId');
      IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = v_entity) THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
      END IF;
      v_amount := public.erp_money(p_command -> 'amount', 'amount', true);
      IF (p_command ->> 'fromMonth') IS NULL
        OR (p_command ->> 'fromMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
        RAISE EXCEPTION 'Invalid salary plan month' USING ERRCODE = '22023';
      END IF;
      v_salary_mode := coalesce(p_command ->> 'mode', 'fixed');
      IF v_salary_mode NOT IN ('piece', 'fixed', 'mixed') THEN
        RAISE EXCEPTION 'Invalid salary mode' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.erp_salary_plans(company_id, employee_id, amount, mode, from_month)
        VALUES (v_company, v_entity, v_amount, v_salary_mode, p_command ->> 'fromMonth')
      ON CONFLICT (company_id, employee_id, from_month) DO UPDATE
        SET amount = EXCLUDED.amount, mode = EXCLUDED.mode;
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
      SELECT coalesce(sum(round(l.qty * l.sale_price, 2)), 0) INTO v_shipped
        FROM public.erp_shipments s
        JOIN public.erp_shipment_lines l ON l.company_id = s.company_id AND l.shipment_id = s.id
       WHERE s.company_id = v_company AND s.customer_id = v_customer AND s.status <> 'cancelled';
      SELECT coalesce(sum(CASE direction WHEN 'in' THEN amount WHEN 'out' THEN -amount ELSE 0 END), 0) INTO v_paid_by_cash
        FROM public.erp_cash WHERE company_id = v_company AND source = 'sale' AND customer_id = v_customer;
      SELECT coalesce(sum(CASE WHEN direction = 'deduct' THEN amount ELSE -amount END), 0) INTO v_paid_by_deduct
        FROM public.erp_worker_deductions WHERE company_id = v_company AND customer_id = v_customer;
      IF v_amount > greatest(0, round(v_shipped - v_paid_by_cash - v_paid_by_deduct, 2)) THEN
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
        IF EXISTS (SELECT 1 FROM public.erp_order_materials WHERE company_id = v_company AND line_id = v_line_id AND NOT issued)
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
        SELECT round(coalesce(sum(round(m.qty * m.actual_cost, 2)), 0), 2) INTO v_material_total
          FROM public.erp_order_materials m WHERE m.company_id = v_company AND m.line_id = v_line_id AND m.issued;
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
REVOKE ALL ON FUNCTION public.erp_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_snapshot() TO authenticated;
REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;

COMMIT;
