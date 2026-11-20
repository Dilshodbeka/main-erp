-- Номер и дата чека (документа поставщика) у закупки. Хранятся рядом с закупкой, командное ядро
-- (erp_execute) не затрагивается. Идемпотентно — можно выполнять повторно.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_purchase_docs (
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL,
  doc_number text NOT NULL DEFAULT '' CHECK (length(doc_number) <= 60),
  doc_date date,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (company_id, purchase_id),
  FOREIGN KEY (company_id, purchase_id) REFERENCES public.erp_purchases(company_id, id) ON DELETE CASCADE
);
ALTER TABLE public.erp_purchase_docs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_purchase_docs FROM anon, authenticated;

-- Все документы фирмы: { "id закупки": { "number": "20307", "date": "2026-11-12" } }
CREATE OR REPLACE FUNCTION public.erp_purchase_docs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Account has not been linked to a company' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_object_agg(purchase_id, jsonb_build_object('number', doc_number, 'date', doc_date))
                     FROM public.erp_purchase_docs WHERE company_id = v_company), '{}'::jsonb);
END;
$$;

-- Записать или очистить (пустой номер и дата null) документ закупки: владелец или сотрудник с правом на закупки.
CREATE OR REPLACE FUNCTION public.erp_purchase_doc_set(p_purchase_id uuid, p_number text, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_profile public.erp_profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.erp_profiles WHERE id = auth.uid();
  IF v_company IS NULL OR NOT (v_profile.role = 'admin' OR v_profile.permissions ? 'purchases.create' OR v_profile.permissions ? 'purchases.receive') THEN
    RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_purchases WHERE company_id = v_company AND id = p_purchase_id) THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_number, '')) = '' AND p_date IS NULL THEN
    DELETE FROM public.erp_purchase_docs WHERE company_id = v_company AND purchase_id = p_purchase_id;
  ELSE
    INSERT INTO public.erp_purchase_docs(company_id, purchase_id, doc_number, doc_date, updated_by)
    VALUES (v_company, p_purchase_id, left(btrim(coalesce(p_number, '')), 60), p_date, auth.uid())
    ON CONFLICT (company_id, purchase_id) DO UPDATE
      SET doc_number = EXCLUDED.doc_number, doc_date = EXCLUDED.doc_date, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
  RETURN public.erp_purchase_docs();
END;
$$;

REVOKE ALL ON FUNCTION public.erp_purchase_docs(), public.erp_purchase_doc_set(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_purchase_docs(), public.erp_purchase_doc_set(uuid, text, date) TO authenticated;

COMMIT;

SELECT count(*) AS purchase_docs FROM public.erp_purchase_docs;
