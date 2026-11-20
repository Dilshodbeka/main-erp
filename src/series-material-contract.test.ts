import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261125_series_duplicate_materials.sql', import.meta.url), 'utf8');

const body = (name: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = schema.indexOf('\n$$;', start);
  return schema.slice(start, end);
};

describe('series duplicate material sql contract', () => {
  it('adds the quantity of a material two recipe slots picked, instead of rejecting it', () => {
    expect(body('erp_execute')).toContain('UPDATE public.erp_order_materials SET qty = qty + v_qty * v_component.qty_per_unit');
    expect(body('erp_execute')).not.toContain("'Duplicate recipe component'");
  });

  it('ships the migration with the changed body and no hand edits', () => {
    expect(migration).not.toContain('DROP FUNCTION');
    expect(migration).not.toContain("'Duplicate recipe component'");
    expect(migration).toContain(body('erp_execute').replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  });

  it('keeps the execute function callable only through the api role', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.erp_execute(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.erp_execute(uuid, bigint, jsonb) TO authenticated;');
  });

  it('comments every preamble line so the SQL Editor can run the file', () => {
    const preamble = migration.slice(0, migration.indexOf('BEGIN;'));
    for (const line of preamble.split('\n')) expect(line.trimStart()).toMatch(/(^$)|(^--)/);
  });
});
