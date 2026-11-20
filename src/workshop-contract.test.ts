import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261121_workshops.sql', import.meta.url), 'utf8');
const execute = (() => {
  const start = schema.indexOf('CREATE FUNCTION public.erp_execute(');
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n$$;', start));
})();
const snapshot = (() => {
  const start = schema.indexOf('CREATE FUNCTION public.erp_snapshot(');
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n$$;', start));
})();

describe('workshop SQL contract', () => {
  it('creates the workshops catalog with a stable main workshop', () => {
    const start = schema.indexOf('CREATE TABLE public.erp_workshops (');
    expect(start).toBeGreaterThan(-1);
    const ddl = schema.slice(start, schema.indexOf('\n);', start));
    expect(ddl).toContain('PRIMARY KEY (company_id, id)');
    expect(ddl).toContain('UNIQUE (company_id, name)');
    expect(ddl).toContain('active boolean NOT NULL DEFAULT true');
    expect(schema).toContain(
      "INSERT INTO public.erp_workshops(company_id, id, name) VALUES (v_company, '00000000-0000-4000-8000-00000000b001', 'Asosiy ishlab chiqarish');",
    );
    expect(schema).toContain("'erp_warehouses', 'erp_workshops', 'erp_profiles'");
  });

  it('adds workshop_id to machines, operations and tasks', () => {
    expect(schema).toContain("workshop_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-00000000b001'");
    expect(schema).toContain('FOREIGN KEY (company_id, workshop_id) REFERENCES public.erp_workshops(company_id, id)');
    expect(schema).toContain('CREATE INDEX erp_tasks_workshop_idx ON public.erp_tasks(company_id, workshop_id);');
    expect(schema).toContain('CREATE INDEX erp_operations_workshop_idx ON public.erp_operations(company_id, workshop_id);');
    expect(schema).toContain('CREATE INDEX erp_machines_workshop_idx ON public.erp_machines(company_id, workshop_id);');
  });

  it('stamps the operation workshop on route insert and unchanged stages', () => {
    expect(schema).toContain('standard_minutes, planned, workshop_id,');
    expect(schema).toContain('v_operation.standard_minutes, v_stage, v_operation.workshop_id,');
    expect(schema).toContain('planned = v_stage, completed = 0, status = \'assigned\', workshop_id = v_operation.workshop_id');
  });

  it('keeps the started stage workshop when the route is revised', () => {
    const revise = schema.slice(schema.indexOf('CREATE FUNCTION public.erp_revise_route('));
    const started = revise.slice(revise.indexOf('IF v_started THEN'), revise.indexOf('ELSE\n        UPDATE public.erp_tasks'));
    expect(started).not.toContain('workshop_id');
  });

  it('emits workshops and workshop ids in the snapshot', () => {
    expect(snapshot).toContain("'workshops', (SELECT coalesce(jsonb_agg(");
    expect(snapshot).toContain('FROM public.erp_workshops w WHERE w.company_id = v_company');
    expect(snapshot).toContain("'workshopId', m.workshop_id");
    expect(snapshot).toContain("'workshopId', op.workshop_id");
    expect(snapshot).toContain("'workshopId', t.workshop_id");
    expect(snapshot).toContain("'workshopIds', v_profile.scope_workshop_ids");
  });

  it('scopes the TV snapshot by the workshop filter when it is set', () => {
    expect(snapshot).toContain('v_tv_scope := v_board AND cardinality(v_workshop_scope) > 0;');
    expect(snapshot).toContain('OR (v_board AND (NOT v_tv_scope OR t.workshop_id = ANY(v_workshop_scope)))');
    expect(snapshot).toContain('AND (v_admin OR (v_board AND NOT v_tv_scope) OR v_has_orders_view_all');
  });

  it('limits workshop chiefs to their own workshops', () => {
    expect(snapshot).toContain('OR (v_chief_scope AND (t.workshop_id = ANY(v_workshop_scope) OR t.employee_id = v_profile.employee_id))');
    expect(snapshot).toContain('OR (v_chief_scope AND op.workshop_id = ANY(v_workshop_scope))');
    expect(snapshot).toContain('OR (NOT v_chief_scope AND EXISTS (SELECT 1 FROM public.erp_tasks t WHERE t.company_id = op.company_id AND t.operation_id = op.id');
    expect(snapshot).toContain('OR (v_has_work_review AND NOT v_chief_scope) OR (v_has_production_view_all AND NOT v_chief_scope)');
    expect(snapshot).toContain('AND (v_admin OR (v_has_defects_view AND NOT v_chief_scope)');
    expect(snapshot).toContain('OR d.employee_id = v_profile.employee_id');
  });

  it('handles workshop lifecycle', () => {
    expect(execute).toContain("WHEN 'workshop.create' THEN");
    expect(execute).toContain("WHEN 'workshop.update' THEN");
    expect(execute).toContain("RAISE EXCEPTION 'Sex nomi allaqachon mavjud' USING ERRCODE = '23505';");
    expect(execute).toContain("RAISE EXCEPTION 'Kamida bitta faol sex qolishi kerak' USING ERRCODE = '23514';");
    expect(execute).toContain("RAISE EXCEPTION 'Workshop not found' USING ERRCODE = '22023';");
    expect(execute).toContain("RAISE EXCEPTION 'Sex nofaol' USING ERRCODE = '23514';");
  });

  it('validates the workshop on machine and operation writes', () => {
    const machine = execute.slice(execute.indexOf("WHEN 'machine.create' THEN"), execute.indexOf("WHEN 'operation.create' THEN"));
    expect(machine).toContain("ELSE '00000000-0000-4000-8000-00000000b001'::uuid END;");
    expect(machine).toContain('ELSE v_machine.workshop_id END;');
    expect(machine).toContain('workshop_id = v_ref WHERE id = v_entity;');
    const operation = execute.slice(execute.indexOf("WHEN 'operation.create' THEN"), execute.indexOf("WHEN 'item.create' THEN"));
    expect(operation).toContain('SELECT workshop_id INTO v_workshop FROM public.erp_operations');
    expect(operation).toContain("IF p_command ? 'workshopId' AND p_command -> 'workshopId' <> 'null'::jsonb THEN");
    expect(operation).toContain('norms = public.erp_norms(v_company, p_command -> \'norms\'), workshop_id = v_workshop WHERE id = v_entity;');
  });

  it('rejects foreign-workshop material issue and review for chiefs', () => {
    expect(execute).toContain("RAISE EXCEPTION 'Bu buyurtma boshqa sexga tegishli' USING ERRCODE = '42501';");
    expect(execute).toContain("RAISE EXCEPTION 'Bu bosqich boshqa sexga tegishli' USING ERRCODE = '42501';");
    expect(execute).toContain('v_workshop_scope := ARRAY(SELECT jsonb_array_elements_text(v_actor.scope_workshop_ids))::uuid[];');
  });

  it('ships an idempotent migration with the new functions', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.erp_workshops (');
    expect(migration).toContain("'Asosiy ishlab chiqarish' FROM public.erp_companies c");
    expect(migration).toContain('ON CONFLICT DO NOTHING;');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS workshop_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-00000000b001'");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_insert_route(');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_revise_route(');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_snapshot()');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_bootstrap_company(p_name text)');
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
