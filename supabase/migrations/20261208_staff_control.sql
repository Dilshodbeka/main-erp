-- Контроль прихода-ухода и KPI, запросы аванса через Telegram-бот.
-- Работник привязывает свой Telegram по ссылке из карточки; бот спрашивает об опоздании и раннем уходе,
-- директор подтверждает или отклоняет; система считает KPI месяца. Командное ядро не затрагивается.
-- Идемпотентно: можно запускать повторно.

BEGIN;

-- Правила KPI фирмы
CREATE TABLE IF NOT EXISTS public.erp_kpi_settings (
  company_id uuid PRIMARY KEY REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  base numeric NOT NULL DEFAULT 500000 CHECK (base BETWEEN 0 AND 1000000000),
  per_minute numeric NOT NULL DEFAULT 1000 CHECK (per_minute BETWEEN 0 AND 1000000),
  forgot_free integer NOT NULL DEFAULT 3 CHECK (forgot_free BETWEEN 0 AND 100),
  forgot_fine numeric NOT NULL DEFAULT 10000 CHECK (forgot_fine BETWEEN 0 AND 100000000),
  director_name text NOT NULL DEFAULT '' CHECK (length(director_name) <= 80),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- Telegram работника и его номер в Timepay (если имя в Timepay отличается)
CREATE TABLE IF NOT EXISTS public.erp_staff_links (
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  chat_id text UNIQUE,
  link_code text UNIQUE,
  link_expires_at timestamptz,
  timepay_id bigint,
  linked_at timestamptz,
  PRIMARY KEY (company_id, employee_id),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id) ON DELETE CASCADE
);

-- Случаи: опоздание (late), ранний уход (early), не отметил уход (no_out)
CREATE TABLE IF NOT EXISTS public.erp_attendance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  timepay_id bigint NOT NULL,
  employee_id uuid,
  employee_name text NOT NULL DEFAULT '',
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('late', 'early', 'no_out')),
  at_minutes integer NOT NULL DEFAULT 0,
  minutes integer NOT NULL DEFAULT 0 CHECK (minutes BETWEEN 0 AND 1440),
  final boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'claimed', 'approved', 'fined', 'warned')),
  claim text CHECK (claim IN ('leave', 'forgot', 'late')),
  fine numeric NOT NULL DEFAULT 0 CHECK (fine BETWEEN 0 AND 100000000),
  code text NOT NULL UNIQUE,
  pings integer NOT NULL DEFAULT 0,
  pinged_at timestamptz,
  escalated boolean NOT NULL DEFAULT false,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, timepay_id, work_date, kind)
);
CREATE INDEX IF NOT EXISTS erp_attendance_cases_month_idx ON public.erp_attendance_cases(company_id, work_date);

-- Запросы аванса
CREATE TABLE IF NOT EXISTS public.erp_advance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  employee_name text NOT NULL DEFAULT '',
  amount numeric NOT NULL CHECK (amount > 0 AND amount <= 1000000000000),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 300),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  account text CHECK (account IN ('cash', 'bank')),
  code text NOT NULL UNIQUE,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (company_id, employee_id) REFERENCES public.erp_employees(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS erp_advance_requests_company_idx ON public.erp_advance_requests(company_id, created_at);

-- Шаг диалога работника с ботом (ввод суммы и причины аванса)
CREATE TABLE IF NOT EXISTS public.erp_staff_dialogs (
  chat_id text PRIMARY KEY,
  step text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

-- Список сотрудников и графиков Timepay меняется редко: храним час, чтобы не запрашивать каждые 2 минуты
CREATE TABLE IF NOT EXISTS public.erp_timepay_cache (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

ALTER TABLE public.erp_kpi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_staff_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_attendance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_advance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_staff_dialogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_timepay_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_kpi_settings, public.erp_staff_links, public.erp_attendance_cases,
  public.erp_advance_requests, public.erp_staff_dialogs, public.erp_timepay_cache FROM anon, authenticated;

-- Всё для экрана «Davomat va KPI»: правила, привязки, случаи месяца, запросы аванса. Только владелец.
CREATE OR REPLACE FUNCTION public.erp_staff_overview(p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_from date;
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  IF p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Invalid month' USING ERRCODE = '22023'; END IF;
  v_from := (p_month || '-01')::date;
  RETURN jsonb_build_object(
    'settings', coalesce((SELECT jsonb_build_object('enabled', enabled, 'base', base, 'perMinute', per_minute,
        'forgotFree', forgot_free, 'forgotFine', forgot_fine, 'directorName', director_name)
      FROM public.erp_kpi_settings WHERE company_id = v_company), 'null'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('employeeId', employee_id, 'linked', chat_id IS NOT NULL, 'timepayId', timepay_id))
      FROM public.erp_staff_links WHERE company_id = v_company), '[]'::jsonb),
    'cases', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'timepayId', timepay_id, 'employeeId', employee_id,
        'name', employee_name, 'workDate', work_date, 'kind', kind, 'atMinutes', at_minutes, 'minutes', minutes, 'final', final,
        'status', status, 'claim', claim, 'fine', fine, 'code', code, 'pings', pings, 'escalated', escalated) ORDER BY work_date, created_at)
      FROM public.erp_attendance_cases WHERE company_id = v_company AND work_date >= v_from AND work_date < (v_from + interval '1 month')), '[]'::jsonb),
    'advances', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'employeeId', employee_id, 'name', employee_name, 'amount', amount,
        'reason', reason, 'status', status, 'account', account, 'createdAt', created_at) ORDER BY created_at DESC)
      FROM public.erp_advance_requests WHERE company_id = v_company AND created_at >= v_from - interval '1 month'), '[]'::jsonb));
END;
$$;

-- Правила KPI
CREATE OR REPLACE FUNCTION public.erp_kpi_settings_set(p_enabled boolean, p_base numeric, p_per_minute numeric,
  p_forgot_free integer, p_forgot_fine numeric, p_director_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.erp_kpi_settings(company_id, enabled, base, per_minute, forgot_free, forgot_fine, director_name)
  VALUES (v_company, p_enabled, p_base, p_per_minute, p_forgot_free, p_forgot_fine, left(btrim(coalesce(p_director_name, '')), 80))
  ON CONFLICT (company_id) DO UPDATE SET enabled = EXCLUDED.enabled, base = EXCLUDED.base, per_minute = EXCLUDED.per_minute,
    forgot_free = EXCLUDED.forgot_free, forgot_fine = EXCLUDED.forgot_fine, director_name = EXCLUDED.director_name, updated_at = now();
END;
$$;

-- Одноразовая ссылка для работника (7 дней). Возвращает код: ссылка = t.me/<бот>?start=<код>
CREATE OR REPLACE FUNCTION public.erp_staff_link_code(p_employee_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_code text;
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.erp_employees WHERE company_id = v_company AND id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = '22023';
  END IF;
  v_code := 'w' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.erp_staff_links(company_id, employee_id, link_code, link_expires_at)
  VALUES (v_company, p_employee_id, v_code, now() + interval '7 days')
  ON CONFLICT (company_id, employee_id) DO UPDATE SET link_code = EXCLUDED.link_code, link_expires_at = EXCLUDED.link_expires_at;
  RETURN v_code;
END;
$$;

-- Отвязать Telegram работника
CREATE OR REPLACE FUNCTION public.erp_staff_unlink(p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  UPDATE public.erp_staff_links SET chat_id = NULL, link_code = NULL, link_expires_at = NULL, linked_at = NULL
   WHERE company_id = v_company AND employee_id = p_employee_id;
END;
$$;

-- Решение владельца по случаю прямо из системы: true — уважительно, false — штраф
CREATE OR REPLACE FUNCTION public.erp_attendance_decide(p_case_id uuid, p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id();
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  UPDATE public.erp_attendance_cases
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'fined' END, fine = 0, decided_by = 'web', decided_at = now()
   WHERE company_id = v_company AND id = p_case_id AND kind IN ('late', 'early');
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = '22023'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.erp_staff_overview(text), public.erp_kpi_settings_set(boolean, numeric, numeric, integer, numeric, text),
  public.erp_staff_link_code(uuid), public.erp_staff_unlink(uuid), public.erp_attendance_decide(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_staff_overview(text), public.erp_kpi_settings_set(boolean, numeric, numeric, integer, numeric, text),
  public.erp_staff_link_code(uuid), public.erp_staff_unlink(uuid), public.erp_attendance_decide(uuid, boolean) TO authenticated;

COMMIT;

-- Проверка расписания (каждые 2 минуты с 08:00 до 23:59 по Ташкенту). Секрет берётся из уже
-- настроенного задания erp-watch, вводить его заново не нужно.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'erp-staff';
SELECT cron.schedule('erp-staff', '*/2 3-18 * * *',
         replace(command, '/functions/v1/erp-watch', '/functions/v1/erp-watch?staff=1'))
  FROM cron.job WHERE jobname = 'erp-watch';

SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('erp-watch', 'erp-staff');
