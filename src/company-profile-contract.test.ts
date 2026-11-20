import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261126_company_profile.sql', import.meta.url), 'utf8');

const body = (name: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = schema.indexOf('\n$$;', start);
  return schema.slice(start, end);
};

const companyTable = () => {
  const start = schema.indexOf('CREATE TABLE public.erp_companies (');
  return schema.slice(start, schema.indexOf(');', start));
};

describe('company profile sql contract', () => {
  it('keeps the contact phone of the company beside its name', () => {
    expect(companyTable()).toContain("phone text NOT NULL DEFAULT ''");
  });

  it('lets only the owner of that company rewrite the phone', () => {
    const fn = body('erp_company_profile_set');
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('public.erp_is_admin()');
    expect(fn).toContain('UPDATE public.erp_companies');
    expect(fn).toContain('id = public.erp_current_company_id()');
  });

  it('rejects a phone that is too long instead of storing junk', () => {
    expect(body('erp_company_profile_set')).toContain('ERRCODE = \'22023\'');
  });

  it('grants the rpc to authenticated and nothing to the public roles', () => {
    expect(schema).toContain('REVOKE ALL ON FUNCTION public.erp_company_profile_set(text) FROM PUBLIC, anon, authenticated;');
    expect(schema).toContain('GRANT EXECUTE ON FUNCTION public.erp_company_profile_set(text) TO authenticated;');
  });

  it('ships a migration that adds the column without touching the command engine', () => {
    expect(migration).toContain('ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT \'\'');
    expect(migration).toContain(body('erp_company_profile_set').replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
    expect(migration).not.toContain('erp_execute');
    expect(migration).not.toContain('erp_snapshot');
  });

  it('comments every preamble line so the SQL Editor can run the file', () => {
    const preamble = migration.slice(0, migration.indexOf('BEGIN;'));
    for (const line of preamble.split('\n')) expect(line.trimStart()).toMatch(/(^$)|(^--)/);
  });
});
