-- Настройки фирмы для продажи системы разным производствам:
--  (1) отрасль и свой складской классификатор (названия групп и разделов);
--  (2) Timepay для любой фирмы: свой токен и слова, по которым в аккаунте Timepay находят её сотрудников.
-- Командное ядро не затрагивается. Идемпотентно.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_company_settings (
  company_id uuid PRIMARY KEY REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  industry text NOT NULL DEFAULT 'furniture' CHECK (industry IN ('furniture', 'general', 'sewing', 'metal', 'doors')),
  classifier jsonb CHECK (classifier IS NULL OR (jsonb_typeof(classifier) = 'array' AND pg_column_size(classifier) < 60000)),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- Токен Timepay хранится только на сервере: в браузер не отдаётся никогда.
CREATE TABLE IF NOT EXISTS public.erp_integrations (
  company_id uuid PRIMARY KEY REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  timepay_token text CHECK (timepay_token IS NULL OR length(timepay_token) BETWEEN 10 AND 400),
  timepay_words text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

ALTER TABLE public.erp_company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_company_settings, public.erp_integrations FROM anon, authenticated;

-- Отрасль и классификатор своей фирмы: читает любой её сотрудник.
CREATE OR REPLACE FUNCTION public.erp_company_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Account has not been linked to a company' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_build_object('industry', industry, 'classifier', classifier)
                     FROM public.erp_company_settings WHERE company_id = v_company), 'null'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_company_settings_set(p_industry text, p_classifier jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.erp_company_settings(company_id, industry, classifier)
  VALUES (v_company, p_industry, CASE WHEN p_classifier IS NULL OR jsonb_typeof(p_classifier) = 'null' THEN NULL ELSE p_classifier END)
  ON CONFLICT (company_id) DO UPDATE SET industry = EXCLUDED.industry, classifier = EXCLUDED.classifier, updated_at = now();
END;
$$;

-- Подключён ли Timepay: только признак и слова, сам токен не возвращается.
CREATE OR REPLACE FUNCTION public.erp_timepay_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_build_object('connected', timepay_token IS NOT NULL, 'words', to_jsonb(timepay_words))
                     FROM public.erp_integrations WHERE company_id = v_company),
                  jsonb_build_object('connected', false, 'words', '[]'::jsonb));
END;
$$;

-- p_token: NULL — оставить прежний, пустая строка — отключить, иначе — новый токен.
CREATE OR REPLACE FUNCTION public.erp_timepay_set(p_token text, p_words text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_words text[];
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(array_agg(left(lower(btrim(word)), 40)), '{}') INTO v_words
    FROM (SELECT word FROM unnest(coalesce(p_words, '{}')) AS word WHERE btrim(word) <> '' LIMIT 10) picked;
  INSERT INTO public.erp_integrations(company_id, timepay_token, timepay_words)
  VALUES (v_company, nullif(btrim(coalesce(p_token, '')), ''), v_words)
  ON CONFLICT (company_id) DO UPDATE SET
    timepay_token = CASE WHEN p_token IS NULL THEN public.erp_integrations.timepay_token ELSE nullif(btrim(p_token), '') END,
    timepay_words = EXCLUDED.timepay_words, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.erp_company_settings(), public.erp_company_settings_set(text, jsonb),
  public.erp_timepay_status(), public.erp_timepay_set(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_company_settings(), public.erp_company_settings_set(text, jsonb),
  public.erp_timepay_status(), public.erp_timepay_set(text, text[]) TO authenticated;

COMMIT;

SELECT (SELECT count(*) FROM public.erp_company_settings) AS company_settings, (SELECT count(*) FROM public.erp_integrations) AS integrations;
