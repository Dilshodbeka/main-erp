import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261124_customer_balance.sql', import.meta.url), 'utf8');
const body = (name: string) => {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = schema.indexOf('\n$$;', start);
  return schema.slice(start, end);
};

describe('customer balance sql contract', () => {
  it('binds the debt to agreed orders only', () => {
    expect(schema).toContain("AND o.kind <> 'series' AND o.status NOT IN ('draft', 'cancelled')");
  });

  it('charges stock sales that belong to no order', () => {
    expect(schema).toContain('AND s.order_id IS NULL AND s.status <> ');
  });

  it('uses the contract price as is, without adding markup', () => {
    expect(body('erp_customer_obligations').slice(0, 1200)).toContain('round(o.price, 2)');
    expect(body('erp_customer_obligations')).not.toContain('o.markup');
  });

  it('keeps advance as the remainder above the contract', () => {
    expect(body('erp_customer_advance')).toContain('erp_customer_paid');
    expect(body('erp_customer_advance')).toContain('erp_customer_obligations');
  });

  it('pays orders in contract order, oldest first', () => {
    expect(body('erp_order_paid')).toContain('ORDER BY o.created_at, o.id');
    expect(body('erp_order_paid')).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
  });

  it('measures the free advance before the stock sale it is checking', () => {
    expect(body('erp_execute')).toContain('FROM public.erp_customer_obligations(v_company, v_customer) o WHERE o.id <> v_entity');
  });

  it('caps a salary deduction at the same debt the frontend shows', () => {
    expect(schema).toContain('IF v_amount > public.erp_customer_debt(v_company, v_customer) + 0.004 THEN');
  });

  it('hides the new helpers behind the same revoke list', () => {
    expect(schema).toContain('public.erp_customer_paid(uuid, uuid), public.erp_customer_obligations(uuid, uuid), public.erp_customer_debt(uuid, uuid)');
  });

  it('ships the migration with every changed body and no hand edits', () => {
    for (const name of ['erp_customer_paid', 'erp_customer_obligations', 'erp_customer_debt', 'erp_customer_advance', 'erp_order_paid', 'erp_execute']) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).not.toContain('DROP FUNCTION');
  });
});
