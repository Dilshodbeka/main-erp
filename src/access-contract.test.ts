import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const table = (name: string) => {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n);', start));
};
const fn = (name: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = schema.indexOf('\n$$;', start);
  expect(end).toBeGreaterThan(-1);
  return schema.slice(start, end);
};
const execute = fn('erp_execute');

describe('access permissions SQL contract', () => {
  it('carries permissions and scopes on the profile', () => {
    const ddl = table('erp_profiles');
    expect(ddl).toContain("permissions jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(ddl).toContain("scope_workshop_ids jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(ddl).toContain("scope_warehouse_ids jsonb NOT NULL DEFAULT '[]'::jsonb");
  });

  it('adds a seller_id foreign key to customers', () => {
    expect(schema).toContain('ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS seller_id uuid;');
    expect(schema).toContain('erp_customers_seller_fk');
    expect(schema).toContain('erp_customers_seller_idx');
  });

  it('defines the three permission helpers', () => {
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.erp_has_permission(p_profile public.erp_profiles, p_key text)');
    expect(schema).toContain("SELECT p_profile.role = 'admin' OR COALESCE(p_profile.permissions ? p_key, false);");
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.erp_command_permission(p_type text)');
    expect(schema).toContain("WHEN 'customer.claim' THEN 'customers.claim'");
    expect(schema).toContain("WHEN 'customer.assign' THEN 'customers.assign'");
    expect(schema).toContain('CREATE OR REPLACE FUNCTION public.erp_can_touch_order(p_profile public.erp_profiles, p_customer_seller_id uuid)');
    expect(schema).toContain("OR public.erp_has_permission(p_profile, 'orders.edit_all')");
    expect(schema).toContain("OR (public.erp_has_permission(p_profile, 'orders.edit_own') AND p_customer_seller_id IS NOT NULL AND p_customer_seller_id = p_profile.employee_id)");
  });

  it('gates worker commands by permission with an ownership branch for orders', () => {
    const gate = execute.slice(execute.indexOf("IF v_actor.role = 'worker' THEN"), execute.indexOf("WHEN 'order.create' THEN"));
    expect(gate).toContain("'work.accept', 'work.start', 'work.submit', 'ticket.create', 'ticket.reply'");
    expect(gate).toContain("'order.update', 'orderLine.cancel', 'order.cancel', 'order.launch'");
    expect(gate).toContain("IF NOT public.erp_can_touch_order(v_actor, v_customer_seller_id) THEN");
    expect(gate).toContain("RAISE EXCEPTION 'You may only manage orders of your own customers' USING ERRCODE = '42501';");
    expect(gate).toContain("IF v_type = 'order.cancel' AND NOT public.erp_has_permission(v_actor, 'orders.cancel') THEN");
    expect(gate).toContain("IF v_type = 'order.launch' AND NOT public.erp_has_permission(v_actor, 'orders.launch') THEN");
    expect(gate).toContain('IF NOT public.erp_has_permission(v_actor, public.erp_command_permission(v_type)) THEN');
    expect(gate).toContain("RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';");
  });

  it('auto-claims and reassigns customers', () => {
    const create = execute.slice(execute.indexOf("WHEN 'customer.create' THEN"), execute.indexOf("WHEN 'customer.claim' THEN"));
    expect(create).toContain("CASE WHEN v_actor.role = 'worker' AND public.erp_has_permission(v_actor, 'customers.claim') THEN v_actor.employee_id ELSE NULL END");
    const claim = execute.slice(execute.indexOf("WHEN 'customer.claim' THEN"), execute.indexOf("WHEN 'customer.assign' THEN"));
    expect(claim).toContain("RAISE EXCEPTION 'Customer already assigned' USING ERRCODE = '22023';");
    expect(claim).toContain('UPDATE public.erp_customers SET seller_id = v_actor.employee_id');
    const assign = execute.slice(execute.indexOf("WHEN 'customer.assign' THEN"), execute.indexOf("WHEN 'supplier.create' THEN"));
    expect(assign).toContain("RAISE EXCEPTION 'Active employee not found' USING ERRCODE = '22023';");
    expect(assign).toContain('UPDATE public.erp_customers SET seller_id = v_ref');
  });

  it('resolves permission flags for snapshot masking', () => {
    for (const flag of [
      "v_has_purchases_view := public.erp_has_permission(v_profile, 'purchases.view');",
      "v_has_cost_view := public.erp_has_permission(v_profile, 'cost.view');",
      "v_has_cash_view := public.erp_has_permission(v_profile, 'cash.view');",
      "v_has_salaries_view := public.erp_has_permission(v_profile, 'salaries.view');",
      "v_has_orders_view_all := public.erp_has_permission(v_profile, 'orders.view_all');",
      "v_has_shipments_view := public.erp_has_permission(v_profile, 'shipments.view');",
      "v_has_work_review := public.erp_has_permission(v_profile, 'work.review');",
      "v_has_production_view_all := public.erp_has_permission(v_profile, 'production.view_all');",
      "v_has_defects_view := public.erp_has_permission(v_profile, 'defects.view');",
      "v_has_reports_view := public.erp_has_permission(v_profile, 'reports.view');",
    ]) expect(schema).toContain(flag);
  });

  it('masks supplier, material and movement costs from non-admins', () => {
    expect(schema).toContain('FROM public.erp_suppliers s WHERE s.company_id = v_company AND (v_admin OR v_has_purchases_view)');
    expect(schema).toContain("'cost', CASE WHEN v_admin OR v_has_cost_view THEN i.cost ELSE 0 END");
    expect(schema).toContain("'unitCost', CASE WHEN v_admin OR v_has_cost_view THEN m.unit_cost ELSE 0 END");
    expect(schema).toContain('FROM public.erp_purchases p WHERE p.company_id = v_company AND (v_admin OR v_has_purchases_view)');
  });

  it('keeps payroll, defects, loans and reports visible only to permitted viewers', () => {
    expect(schema).toContain('FROM public.erp_payroll p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view OR p.employee_id = v_profile.employee_id)');
    expect(schema).toContain('FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR v_has_defects_view OR d.employee_id = v_profile.employee_id)');
    expect(schema).toContain('FROM public.erp_salary_plans p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view)');
    expect(schema).toContain('FROM public.erp_expense_plans p WHERE p.company_id = v_company AND (v_admin OR v_has_salaries_view)');
    expect(schema).toContain('FROM public.erp_loans l WHERE l.company_id = v_company AND (v_admin OR v_has_reports_view)');
    expect(schema).toContain('FROM public.erp_shipments s WHERE s.company_id = v_company AND (v_admin OR v_has_shipments_view)');
  });

  it('emits sellerId and masks phone/address for order scoping', () => {
    expect(schema).toContain("'kind', c.kind, 'employeeId', c.employee_id, 'sellerId', c.seller_id");
    expect(schema).toContain("'phone', CASE WHEN v_admin OR v_has_orders_view_all THEN c.phone ELSE '' END");
    expect(schema).toContain("'address', CASE WHEN v_admin OR v_has_orders_view_all THEN c.address ELSE '' END");
    expect(schema).toContain("cc.seller_id = v_profile.employee_id");
  });
});
