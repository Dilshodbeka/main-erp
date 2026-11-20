-- Aliya ERP: телефон фирмы для блока отправителя на документах клиента (#406).
-- Название уже хранится в erp_companies, телефона не было; документ, который уходит
-- клиенту в Telegram, должен показывать, куда звонить по этому заказу.
-- Командное ядро не затрагивается: колонка и одна SECURITY DEFINER функция владельца.
-- Safe to run more than once. Existing data is untouched.

BEGIN;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION public.erp_company_profile_set(p_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_phone text := btrim(coalesce(p_phone, ''));
BEGIN
  IF NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  IF length(v_phone) > 40 THEN RAISE EXCEPTION 'Phone is too long' USING ERRCODE = '22023'; END IF;
  UPDATE public.erp_companies SET phone = v_phone WHERE id = public.erp_current_company_id();
  RETURN v_phone;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_company_profile_set(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_company_profile_set(text) TO authenticated;

COMMIT;
