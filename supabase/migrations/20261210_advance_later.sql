-- Аванс «одобряю, выдам позже»: статус promised. Касса не меняется, пока деньги реально не выданы.
-- Выдача из системы (экран «Davomat va KPI») отмечает запрос выданным. Идемпотентно.

BEGIN;

ALTER TABLE public.erp_advance_requests DROP CONSTRAINT IF EXISTS erp_advance_requests_status_check;
ALTER TABLE public.erp_advance_requests ADD CONSTRAINT erp_advance_requests_status_check
  CHECK (status IN ('pending', 'promised', 'approved', 'rejected'));

-- Решение по запросу из системы: promised / approved (с кассой cash|bank) / rejected.
CREATE OR REPLACE FUNCTION public.erp_advance_mark(p_id uuid, p_status text, p_account text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('promised', 'approved', 'rejected') OR (p_status = 'approved' AND coalesce(p_account, '') NOT IN ('cash', 'bank')) THEN
    RAISE EXCEPTION 'Invalid advance decision' USING ERRCODE = '22023';
  END IF;
  UPDATE public.erp_advance_requests
     SET status = p_status, account = CASE WHEN p_status = 'approved' THEN p_account ELSE account END, decided_by = 'web', decided_at = now()
   WHERE company_id = v_company AND id = p_id
     AND (status = 'pending' OR (status = 'promised' AND p_status IN ('approved', 'rejected')));
  IF NOT FOUND THEN RAISE EXCEPTION 'Advance request is already decided' USING ERRCODE = '23514'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.erp_advance_mark(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_advance_mark(uuid, text, text) TO authenticated;

COMMIT;
