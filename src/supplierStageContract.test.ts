import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

describe('supplier stage cost SQL contract', () => {
  it('stores a rounded supplier sum on tasks', () => {
    expect(schema).toContain('supplier_cost numeric NOT NULL DEFAULT 0');
    expect(schema).toContain('supplier_cost = round(supplier_cost, 2)');
  });

  it('keeps route money fields zero-friendly so a supplier stage can carry rate 0', () => {
    expect(schema).toContain("public.erp_money(v_line -> 'rate', 'route rate', true)");
    expect(schema).toContain("public.erp_money(l.value -> 'rate', 'route rate', true)");
    expect(schema).toContain("public.erp_money(v_line -> 'supplierCost', 'supplier cost', true)");
    expect(schema).not.toContain("public.erp_money(v_line -> 'rate', 'route rate', false)");
    expect(schema).not.toContain("public.erp_money(v_line -> 'supplierCost', 'supplier cost', false)");
  });

  it('uses the fixed sum in supplier debt, cash caps and shipment cost', () => {
    expect(schema).toContain('WHEN t.supplier_cost > 0 THEN round(t.supplier_cost, 2)');
    expect(schema.match(/WHEN t\.supplier_cost > 0 THEN round\(t\.supplier_cost, 2\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('blocks acceptance without a sum and snapshots it behind cost.view', () => {
    expect(schema).toContain("RAISE EXCEPTION 'Supplier amount is required before acceptance'");
    expect(schema).toContain("'supplierCost', CASE WHEN v_admin OR v_has_cost_view THEN t.supplier_cost ELSE 0 END");
  });

  it('ships the generated migration', () => {
    const migration = readFileSync(new URL('../supabase/migrations/20261114_supplier_stage_cost.sql', import.meta.url), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS supplier_cost');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_revise_route');
    expect(migration).toContain('COMMIT;');
  });
});
