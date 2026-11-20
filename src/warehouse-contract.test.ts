import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261119_warehouses.sql', import.meta.url), 'utf8');
const execute = (() => {
  const start = schema.indexOf('CREATE FUNCTION public.erp_execute(');
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf('\n$$;', start));
})();

describe('warehouse SQL contract', () => {
  it('creates the warehouses catalog with a stable main row', () => {
    const start = schema.indexOf('CREATE TABLE public.erp_warehouses (');
    expect(start).toBeGreaterThan(-1);
    const ddl = schema.slice(start, schema.indexOf('\n);', start));
    expect(ddl).toContain('PRIMARY KEY (company_id, id)');
    expect(ddl).toContain('UNIQUE (company_id, name)');
    expect(ddl).toContain('active boolean NOT NULL DEFAULT true');
    expect(schema).toContain("INSERT INTO public.erp_warehouses(company_id, id, name) VALUES (v_company, '00000000-0000-4000-8000-00000000a001', 'Asosiy ombor');");
  });

  it('adds warehouse_id to orders, purchases and stock movements', () => {
    expect(schema).toContain("warehouse_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-00000000a001'");
    expect(schema).toContain('FOREIGN KEY (company_id, warehouse_id) REFERENCES public.erp_warehouses(company_id, id)');
    expect(schema).toContain('CREATE INDEX erp_stock_warehouse_idx ON public.erp_stock_movements(company_id, warehouse_id);');
    expect(schema).toContain('CREATE INDEX erp_orders_warehouse_idx ON public.erp_orders(company_id, warehouse_id);');
    expect(schema).toContain('CREATE INDEX erp_purchases_warehouse_idx ON public.erp_purchases(company_id, warehouse_id);');
  });

  it('allows transfer movements', () => {
    expect(schema).toContain("source IN ('purchase', 'order', 'inventory', 'customer', 'production', 'sale', 'transfer')");
  });

  it('scopes stock and reservation helpers by an optional warehouse', () => {
    expect(schema).toContain('CREATE FUNCTION public.erp_stock_qty(p_company_id uuid, p_item_id uuid, p_warehouse_id uuid DEFAULT NULL)');
    expect(schema).toContain('AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id);');
    expect(schema).toContain('CREATE FUNCTION public.erp_reserved_qty(p_company_id uuid, p_item_id uuid, p_exclude_order uuid DEFAULT NULL, p_warehouse_id uuid DEFAULT NULL)');
    expect(schema).toContain('AND (p_warehouse_id IS NULL OR o.warehouse_id = p_warehouse_id);');
    expect(schema).toContain('public.erp_stock_qty(uuid, uuid, uuid), public.erp_reserved_qty(uuid, uuid, uuid, uuid)');
  });

  it('emits warehouses and warehouse ids in the snapshot', () => {
    expect(schema).toContain('FROM public.erp_warehouses w WHERE w.company_id = v_company');
    expect(schema).toContain("'warehouseId', o.warehouse_id");
    expect(schema).toContain("'warehouseId', p.warehouse_id");
    expect(schema).toContain("'warehouseId', m.warehouse_id");
  });

  it('validates a warehouse on order and purchase creation', () => {
    const create = execute.slice(execute.indexOf("WHEN 'order.create' THEN"), execute.indexOf("WHEN 'purchase.create' THEN"));
    expect(create).toContain("v_warehouse := CASE WHEN v_input ? 'warehouseId'");
    expect(create).toContain("RAISE EXCEPTION 'Warehouse not found' USING ERRCODE = '22023';");
    expect(create).toContain("RAISE EXCEPTION 'Ombor nofaol' USING ERRCODE = '23514';");
    expect(create).toContain('INSERT INTO public.erp_orders(company_id, number, kind, customer_id, warehouse_id, title, qty, price, overhead, markup, due_date, output_item_id)');
    const purchase = execute.slice(execute.indexOf("WHEN 'purchase.create' THEN"), execute.indexOf("WHEN 'purchase.receive' THEN"));
    expect(purchase).toContain('INSERT INTO public.erp_purchases(company_id, number, supplier_id, warehouse_id, order_id)');
    const receive = execute.slice(execute.indexOf("WHEN 'purchase.receive' THEN"), execute.indexOf("WHEN 'supplier.pay' THEN"));
    expect(receive).toContain("'Purchase receipt', v_purchase.warehouse_id");
  });

  it('locks the order warehouse once material is issued', () => {
    expect(execute).toContain("RAISE EXCEPTION 'Materiallar berilgan — omborni o‘zgartirib bo‘lmaydi' USING ERRCODE = '23514';");
  });

  it('issues partially from free stock instead of aborting on a deficit', () => {
    expect(execute).toContain('v_free := greatest(public.erp_stock_qty(v_company, v_item.id, v_order.warehouse_id)');
    expect(execute).toContain('v_take := least(v_qty, v_free);');
    expect(execute).toContain("RAISE EXCEPTION 'Omborda material yo‘q. Qoldiqni to‘ldiring' USING ERRCODE = '23514';");
    expect(execute).not.toContain('Insufficient unreserved material stock');
  });

  it('handles warehouse lifecycle and transfers', () => {
    expect(execute).toContain("WHEN 'warehouse.create' THEN");
    expect(execute).toContain("WHEN 'warehouse.update' THEN");
    expect(execute).toContain("RAISE EXCEPTION 'Name already exists' USING ERRCODE = '22023';");
    expect(execute).toContain("RAISE EXCEPTION 'Kamida bitta faol ombor qolishi kerak' USING ERRCODE = '23514';");
    const transfer = execute.slice(execute.indexOf("WHEN 'warehouse.transfer' THEN"), execute.indexOf("WHEN 'cash.post' THEN"));
    expect(transfer).toContain("RAISE EXCEPTION 'Omborlar bir xil bo‘lmasligi kerak' USING ERRCODE = '23514';");
    expect(transfer).toContain("RAISE EXCEPTION 'Omborda yetarli qoldiq yo‘q' USING ERRCODE = '23514';");
    expect(transfer).toContain("'transfer', v_ref, v_note, v_id");
    expect(transfer).toContain("'transfer', v_ref, v_note, v_warehouse");
  });

  it('ships an idempotent migration with the new functions', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.erp_warehouses (');
    expect(migration).toContain('ON CONFLICT DO NOTHING;');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS warehouse_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-00000000a001'");
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.erp_stock_qty(uuid, uuid);');
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.erp_reserved_qty(uuid, uuid, uuid);');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_stock_qty(p_company_id uuid, p_item_id uuid, p_warehouse_id uuid DEFAULT NULL)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_reserved_qty(p_company_id uuid, p_item_id uuid, p_exclude_order uuid DEFAULT NULL, p_warehouse_id uuid DEFAULT NULL)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_snapshot()');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.erp_execute(p_request_id uuid, p_expected_revision bigint, p_command jsonb)');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.erp_stock_qty(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;');
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});
