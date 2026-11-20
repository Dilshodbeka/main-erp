-- Центр рекомендаций: память о том, какие рекомендации руководитель уже отработал или отложил.
-- Сами рекомендации считаются из данных учёта (src/insights.ts) — здесь только отметки:
-- «выполнено» прячет карточку на 7 дней, «позже» — на 2 дня; если проблема осталась, карточка вернётся.
-- Командное ядро (erp_execute) не затрагивается. Идемпотентно — можно выполнять повторно.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_insights (
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('done', 'later')),
  hidden_until timestamptz NOT NULL,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  priority text NOT NULL DEFAULT '' CHECK (priority IN ('', 'critical', 'growth', 'attention')),
  effect numeric NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (company_id, key)
);
ALTER TABLE public.erp_insights ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_insights FROM anon, authenticated;

-- Действующие отметки фирмы: { "ключ": { "status": "done", "hiddenUntil": "…" } }
CREATE OR REPLACE FUNCTION public.erp_insight_marks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_object_agg(key, jsonb_build_object('status', status, 'hiddenUntil', hidden_until))
                     FROM public.erp_insights WHERE company_id = v_company AND hidden_until > now()), '{}'::jsonb);
END;
$$;

-- Отметить рекомендацию ('done' | 'later') на p_days дней или снять отметку (p_status = null).
CREATE OR REPLACE FUNCTION public.erp_insight_mark(p_key text, p_status text, p_days integer, p_title text, p_priority text, p_effect numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL THEN
    DELETE FROM public.erp_insights WHERE company_id = v_company AND key = p_key;
  ELSE
    IF p_status NOT IN ('done', 'later') THEN RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023'; END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN RAISE EXCEPTION 'Days must be between 1 and 30' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.erp_insights(company_id, key, status, hidden_until, title, priority, effect, updated_by)
    VALUES (v_company, p_key, p_status, now() + make_interval(days => p_days), left(coalesce(p_title, ''), 300),
            CASE WHEN p_priority IN ('critical', 'growth', 'attention') THEN p_priority ELSE '' END, coalesce(p_effect, 0), auth.uid())
    ON CONFLICT (company_id, key) DO UPDATE
      SET status = EXCLUDED.status, hidden_until = EXCLUDED.hidden_until, title = EXCLUDED.title,
          priority = EXCLUDED.priority, effect = EXCLUDED.effect, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
  RETURN public.erp_insight_marks();
END;
$$;

REVOKE ALL ON FUNCTION public.erp_insight_marks(), public.erp_insight_mark(text, text, integer, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_insight_marks(), public.erp_insight_mark(text, text, integer, text, text, numeric) TO authenticated;

COMMIT;

SELECT count(*) AS marks FROM public.erp_insights;
