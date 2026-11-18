-- Repair: the live erp_sync_identity lost the "no active positions" guard, so cancelling the
-- last position of a composite order ran UPDATE erp_orders SET title = NULL and aborted with
-- 23502 (null value in column "title"). This restores the canonical definition (identical to
-- supabase/schema.sql): when every position is cancelled the derived title is NULL and the
-- order header keeps its identity while erp_sync_order flips the status to cancelled.
-- Idempotent: plain CREATE OR REPLACE of a single function, safe to run any number of times.

CREATE OR REPLACE FUNCTION public.erp_sync_identity(p_company_id uuid, p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_kind text; v_title text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.erp_orders WHERE company_id = p_company_id AND id = p_order_id AND kind = 'series') THEN
    RETURN;
  END IF;
  SELECT CASE WHEN count(DISTINCT row.kind) = 1 THEN min(row.kind) ELSE 'composite' END,
    string_agg(row.title, ' · ' ORDER BY row.position) INTO v_kind, v_title
    FROM public.erp_order_items row
    WHERE row.company_id = p_company_id AND row.order_id = p_order_id AND row.status <> 'cancelled';
  IF v_title IS NULL THEN RETURN; END IF;
  UPDATE public.erp_orders SET kind = v_kind, title = v_title WHERE company_id = p_company_id AND id = p_order_id;
END;
$$;

-- Verification (run separately in the SQL editor, expect the guard line in the output):
-- SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'erp_sync_identity';
