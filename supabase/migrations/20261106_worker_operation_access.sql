-- Aliya ERP: worker snapshot must authorize the worker for their own task operations.
-- Fixes 'Ochiq emas: administrator tekshirishi kerak' for workers on live data
-- (snapshot sent employeeIds = [] for workers, so availableTask always blocked).
-- Safe to run more than once.

BEGIN;

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
        'active', op.active, 'autoAccept', op.auto_accept) ORDER BY op.id), '[]'::jsonb)
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
        'dueDate', o.due_date, 'createdAt', o.created_at, 'status', o.status,
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'title', i.title,
          'qty', i.qty, 'total', CASE WHEN v_admin THEN i.total ELSE 0 END, 'status', i.status) ORDER BY i.position), '[]'::jsonb)
          FROM public.erp_order_items i WHERE i.company_id = o.company_id AND i.order_id = o.id),
        'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'lineId', m.line_id, 'itemId', m.item_id, 'qty', m.qty,
          'estimatedCost', CASE WHEN v_admin THEN m.estimated_cost ELSE 0 END, 'issued', m.issued,
          'actualCost', CASE WHEN v_admin THEN m.actual_cost ELSE 0 END) ORDER BY m.position, m.id), '[]'::jsonb)
          FROM public.erp_order_materials m WHERE m.company_id = o.company_id AND m.order_id = o.id),
        'route', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'lineId', t.line_id, 'operationId', t.operation_id, 'name', t.name,
          'employeeId', CASE WHEN v_admin OR v_board OR t.employee_id = v_profile.employee_id THEN t.employee_id::text ELSE '' END,
          'rate', CASE WHEN v_admin OR t.employee_id = v_profile.employee_id THEN t.rate ELSE 0 END,
          'salePrice', CASE WHEN v_admin THEN t.sale_price ELSE 0 END,
          'standardMinutes', t.standard_minutes,
          'planned', t.planned, 'completed', t.completed, 'status', t.status) ORDER BY t.position, t.id), '[]'::jsonb)
          FROM public.erp_tasks t WHERE t.company_id = o.company_id AND t.order_id = o.id)
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
        'note', CASE WHEN v_admin THEN c.note ELSE '' END, 'reversalOf', c.reversal_of, 'createdAt', c.created_at) ORDER BY c.created_at, c.id), '[]'::jsonb)
        FROM public.erp_cash c WHERE c.company_id = v_company AND (v_admin OR (c.source = 'payroll' AND c.source_id = v_profile.employee_id))),
      'reports', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'orderId', r.order_id, 'taskId', r.task_id, 'employeeId', r.employee_id,
        'qty', r.qty, 'status', r.status, 'note', r.note, 'createdAt', r.created_at) ORDER BY r.created_at, r.id), '[]'::jsonb)
        FROM public.erp_work_reports r WHERE r.company_id = v_company AND (v_admin OR v_board OR r.employee_id = v_profile.employee_id)),
      'payroll', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'reportId', p.report_id, 'orderId', p.order_id,
        'taskId', p.task_id, 'amount', p.amount, 'status', p.status, 'createdAt', p.created_at) ORDER BY p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_payroll p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),
      'salaryPlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'employeeId', p.employee_id, 'amount', p.amount,
        'fromMonth', p.from_month, 'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_salary_plans p WHERE p.company_id = v_company AND (v_admin OR p.employee_id = v_profile.employee_id)),
      'expensePlans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'planId', p.plan_id, 'title', p.title,
        'amount', p.amount, 'fromMonth', p.from_month, 'dueDay', p.due_day, 'supplierId', p.supplier_id,
        'createdAt', p.created_at) ORDER BY p.from_month, p.created_at, p.id), '[]'::jsonb)
        FROM public.erp_expense_plans p WHERE p.company_id = v_company AND v_admin),
      'loans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title, 'kind', l.kind,
        'amount', l.amount, 'note', l.note, 'createdAt', l.created_at) ORDER BY l.created_at, l.id), '[]'::jsonb)
        FROM public.erp_loans l WHERE l.company_id = v_company AND v_admin),
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

REVOKE ALL ON FUNCTION public.erp_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_snapshot() TO authenticated;

COMMIT;
