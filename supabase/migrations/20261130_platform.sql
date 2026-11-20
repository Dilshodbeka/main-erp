-- Платформа (продажа по подписке): тариф и пробный период фирмы, отключаемые модули,
-- админы платформы и панель управления фирмами.
-- Командное ядро (erp_execute) не затрагивается: колонки фирмы, один триггер на журнал
-- аудита и SECURITY DEFINER функции. Идемпотентно — можно выполнять повторно.
--
-- Существующие фирмы получают тариф 'lifetime' (без срока): для них ничего не меняется.
-- Новая фирма, созданная через регистрацию, получает 1 день пробного периода.

BEGIN;

-- ── Тариф и модули фирмы ────────────────────────────────────────────────────
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS paid_until timestamptz;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS disabled_modules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.erp_companies ADD COLUMN IF NOT EXISTS platform_note text NOT NULL DEFAULT '';

-- Фирмы, существовавшие до этой миграции, работают без срока.
UPDATE public.erp_companies SET plan = 'lifetime' WHERE plan IS NULL;
ALTER TABLE public.erp_companies ALTER COLUMN plan SET DEFAULT 'trial';
ALTER TABLE public.erp_companies ALTER COLUMN plan SET NOT NULL;
ALTER TABLE public.erp_companies ALTER COLUMN trial_ends_at SET DEFAULT (transaction_timestamp() + interval '1 day');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_companies_plan_check') THEN
    ALTER TABLE public.erp_companies ADD CONSTRAINT erp_companies_plan_check CHECK (plan IN ('trial', 'paid', 'lifetime'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_companies_modules_check') THEN
    ALTER TABLE public.erp_companies ADD CONSTRAINT erp_companies_modules_check CHECK (jsonb_typeof(disabled_modules) = 'array');
  END IF;
END $$;

-- ── Админы платформы (продавец системы) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.erp_platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_platform_admins FROM anon, authenticated;

-- Первый админ платформы — владелец самой старой фирмы (при первом запуске миграции).
INSERT INTO public.erp_platform_admins(user_id)
SELECT p.id FROM public.erp_profiles p
  JOIN public.erp_companies c ON c.id = p.company_id
 WHERE p.role = 'admin' AND NOT EXISTS (SELECT 1 FROM public.erp_platform_admins)
 ORDER BY c.created_at, p.id LIMIT 1
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.erp_is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.erp_platform_admins WHERE user_id = auth.uid());
$$;

-- ── Активна ли подписка ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_subscription_active(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT NOT c.blocked AND (
      c.plan = 'lifetime'
      OR greatest(coalesce(c.trial_ends_at, '-infinity'::timestamptz), coalesce(c.paid_until, '-infinity'::timestamptz)) > now()
    ) FROM public.erp_companies c WHERE c.id = p_company), false);
$$;

-- Каждая команда пишет строку в журнал аудита — здесь и стоит шлагбаум: при истёкшей
-- подписке запись отклоняется, данные остаются доступными для чтения.
CREATE OR REPLACE FUNCTION public.erp_audit_subscription_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.action <> 'company.bootstrap' AND NOT public.erp_subscription_active(NEW.company_id) THEN
    RAISE EXCEPTION 'Subscription expired' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS erp_audit_subscription_gate ON public.erp_audit;
CREATE TRIGGER erp_audit_subscription_gate BEFORE INSERT ON public.erp_audit
  FOR EACH ROW EXECUTE FUNCTION public.erp_audit_subscription_gate();

-- ── Что видит фирма о своей подписке ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_subscription()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); c public.erp_companies%ROWTYPE;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'Account has not been linked to a company' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.erp_companies WHERE id = v_company;
  RETURN jsonb_build_object(
    'plan', c.plan, 'trialEndsAt', c.trial_ends_at, 'paidUntil', c.paid_until, 'blocked', c.blocked,
    'active', public.erp_subscription_active(v_company),
    'disabledModules', c.disabled_modules,
    'platformAdmin', public.erp_is_platform_admin(),
    'now', now());
END;
$$;

-- ── Панель платформы: список фирм и управление ими ──────────────────────────
CREATE OR REPLACE FUNCTION public.erp_platform_companies()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.erp_is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'createdAt', c.created_at,
      'plan', c.plan, 'trialEndsAt', c.trial_ends_at, 'paidUntil', c.paid_until, 'blocked', c.blocked,
      'active', public.erp_subscription_active(c.id),
      'disabledModules', c.disabled_modules, 'note', c.platform_note,
      'users', (SELECT count(*) FROM public.erp_profiles p WHERE p.company_id = c.id),
      'orders', (SELECT count(*) FROM public.erp_orders o WHERE o.company_id = c.id),
      'lastActivity', (SELECT max(a.created_at) FROM public.erp_audit a WHERE a.company_id = c.id),
      'ownerEmail', (SELECT u.email FROM public.erp_profiles p JOIN auth.users u ON u.id = p.id
                      WHERE p.company_id = c.id AND p.role = 'admin' ORDER BY u.created_at LIMIT 1)
    ) ORDER BY c.created_at DESC) FROM public.erp_companies c), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_platform_company_set(
  p_company uuid, p_plan text, p_paid_until timestamptz, p_blocked boolean, p_disabled_modules jsonb, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.erp_is_platform_admin() THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
  IF p_plan NOT IN ('trial', 'paid', 'lifetime') THEN RAISE EXCEPTION 'Unknown plan' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(coalesce(p_disabled_modules, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Modules must be a list' USING ERRCODE = '22023'; END IF;
  IF length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023'; END IF;
  UPDATE public.erp_companies
     SET plan = p_plan, paid_until = p_paid_until, blocked = coalesce(p_blocked, false),
         disabled_modules = coalesce(p_disabled_modules, '[]'::jsonb), platform_note = coalesce(p_note, '')
   WHERE id = p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found' USING ERRCODE = '22023'; END IF;
  RETURN public.erp_platform_companies();
END;
$$;

REVOKE ALL ON FUNCTION public.erp_is_platform_admin(), public.erp_subscription_active(uuid), public.erp_audit_subscription_gate(),
  public.erp_subscription(), public.erp_platform_companies(),
  public.erp_platform_company_set(uuid, text, timestamptz, boolean, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_subscription(), public.erp_platform_companies(),
  public.erp_platform_company_set(uuid, text, timestamptz, boolean, jsonb, text) TO authenticated;

COMMIT;

-- Проверка: ваша фирма должна быть 'lifetime', админ платформы — один.
SELECT name, plan, trial_ends_at, paid_until FROM public.erp_companies ORDER BY created_at;
SELECT count(*) AS platform_admins FROM public.erp_platform_admins;
