import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const table = (name: string) => {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n);', start));
};

describe('defect and review SQL contract', () => {
  it('creates a defect journal with server-side guards', () => {
    const ddl = table('erp_defects');
    expect(ddl).toContain("reason text NOT NULL CHECK (reason IN ('quality', 'measurement', 'drawing', 'customer', 'other'))");
    expect(ddl).toContain("CHECK (length(note) <= 500 AND (reason <> 'other' OR btrim(note) <> ''))");
    expect(ddl).toContain('CHECK (qty > 0 AND qty <= 1000000000 AND qty = round(qty, 2))');
    expect(ddl).toContain("CHECK (jsonb_typeof(materials) = 'array')");
    expect(ddl).toContain('FOREIGN KEY (company_id, report_id) REFERENCES public.erp_work_reports(company_id, id)');
  });

  it('allows many reports per task but keeps payroll unique', () => {
    expect(table('erp_work_reports')).not.toContain('UNIQUE (company_id, order_id, task_id, employee_id)');
    expect(table('erp_payroll')).toContain('UNIQUE (company_id, order_id, task_id, employee_id)');
  });

  it('protects the journal with the admin read policy', () => {
    expect(schema).toContain("'erp_work_reports', 'erp_payroll', 'erp_defects', 'erp_salary_plans'");
  });

  it('snapshots defects for admins, defect reviewers and the involved worker', () => {
    expect(schema).toContain("'defects', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'reportId', d.report_id");
    expect(schema).toContain('FROM public.erp_defects d WHERE d.company_id = v_company AND (v_admin OR v_has_defects_view OR d.employee_id = v_profile.employee_id)');
    expect(schema).toContain("'materials', d.materials");
  });

  it('submits a new report row every time', () => {
    const submit = schema.slice(schema.indexOf("WHEN 'work.submit' THEN"), schema.indexOf("WHEN 'work.review' THEN\n"));
    expect(submit).toContain("RAISE EXCEPTION 'Report already submitted'");
    expect(submit).toContain('INSERT INTO public.erp_work_reports');
    expect(submit).not.toContain('SET qty = v_qty');
    expect(submit).toContain("IF v_payroll.status <> 'accepted' THEN");
  });

  it('reviews with a three-way split, defect journal and norm materials', () => {
    const review = schema.slice(schema.indexOf("WHEN 'work.review' THEN\n"), schema.indexOf("WHEN 'purchase.create' THEN\n"));
    for (const message of [
      'Review must be plain', 'Defect reason is required', 'Defect note is required',
      'Defect note is too long', 'Nothing to reject', 'Defect quantity exceeds report',
    ]) expect(review).toContain(`'${message}'`);
    expect(review).toContain('INSERT INTO public.erp_defects');
    expect(review).toContain("UPDATE public.erp_work_reports SET qty = v_good, status = 'accepted'");
    expect(review).toContain('jsonb_array_elements(v_operation.norms) WITH ORDINALITY');
  });
});
