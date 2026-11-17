import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261120_supply.sql', import.meta.url), 'utf8');
const execute = (() => {
  const start = schema.indexOf('CREATE FUNCTION public.erp_execute(');
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n$$;', start));
})();

describe('supply SQL contract', () => {
  it('adds a company-scoped order reference to purchases', () => {
    const start = schema.indexOf('CREATE TABLE public.erp_purchases (');
    expect(start).toBeGreaterThan(-1);
    const ddl = schema.slice(start, schema.indexOf('\n);', start));
    expect(ddl).toContain('order_id uuid,');
    expect(ddl).toContain('FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id)');
    expect(schema).toContain('CREATE INDEX erp_purchases_order_idx ON public.erp_purchases(company_id, order_id);');
  });

  it('emits orderId in the purchase snapshot', () => {
    expect(schema).toContain("'warehouseId', p.warehouse_id, 'orderId', p.order_id,");
  });

  it('validates the traced order on purchase creation', () => {
    const purchase = execute.slice(execute.indexOf("WHEN 'purchase.create' THEN"), execute.indexOf("WHEN 'purchase.receive' THEN"));
    expect(purchase).toContain("v_purchase_order := public.erp_uuid(p_command -> 'orderId', 'orderId');");
    expect(purchase).toContain("RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023';");
    expect(purchase).toContain('INSERT INTO public.erp_purchases(company_id, number, supplier_id, warehouse_id, order_id)');
  });

  it('ships an idempotent migration with the new functions', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS order_id uuid;');
    expect(migration).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_purchases_order_fk')");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS erp_purchases_order_idx');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_snapshot()');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)');
    expect(migration).toContain("'warehouseId', p.warehouse_id, 'orderId', p.order_id,");
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
