-- Уведомления на телефон и компьютер (Web Push) — бесплатно, без сторонних сервисов.
-- Устройство подписывается в приложении (боковое меню → «Уведомления»), наблюдатель erp-watch
-- отправляет владельцу то же, что в Telegram, а сотруднику — «у вас новое задание».
-- Командное ядро (erp_execute) не затрагивается. Идемпотентно — можно выполнять повторно.

BEGIN;

-- Ключи сервера (VAPID). Создаются функцией erp-watch при первом запуске; приложению виден только открытый ключ.
CREATE TABLE IF NOT EXISTS public.erp_push_keys (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_key text NOT NULL CHECK (length(public_key) BETWEEN 80 AND 100),
  private_key jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.erp_push_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_push_keys FROM anon, authenticated;

-- Подписки устройств. Адрес — только настоящие push-сервисы браузеров (Chrome/Яндекс/Edge, Firefox, Safari, Windows).
CREATE TABLE IF NOT EXISTS public.erp_push_subscriptions (
  endpoint text PRIMARY KEY CHECK (
    length(endpoint) BETWEEN 30 AND 1000
    AND endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.apple\.com)/'
  ),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
  auth text NOT NULL CHECK (length(auth) BETWEEN 16 AND 40),
  label text NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS erp_push_subscriptions_company ON public.erp_push_subscriptions(company_id);
CREATE INDEX IF NOT EXISTS erp_push_subscriptions_user ON public.erp_push_subscriptions(user_id);
ALTER TABLE public.erp_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_push_subscriptions FROM anon, authenticated;

-- Открытый ключ сервера: null, пока наблюдатель ещё ни разу не запускался.
CREATE OR REPLACE FUNCTION public.erp_push_public_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public_key FROM public.erp_push_keys LIMIT 1;
$$;

-- Подписать это устройство на уведомления текущего пользователя. Возвращает число его устройств.
CREATE OR REPLACE FUNCTION public.erp_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_count integer;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN RAISE EXCEPTION 'Account has not been linked to a company' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.erp_push_subscriptions(endpoint, company_id, user_id, p256dh, auth, label)
  VALUES (p_endpoint, v_company, auth.uid(), p_p256dh, p_auth, left(coalesce(p_label, ''), 120))
  ON CONFLICT (endpoint) DO UPDATE
    SET company_id = EXCLUDED.company_id, user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, label = EXCLUDED.label;
  -- Не больше 10 устройств на человека: самые старые подписки убираются.
  DELETE FROM public.erp_push_subscriptions WHERE user_id = auth.uid() AND endpoint IN (
    SELECT endpoint FROM public.erp_push_subscriptions WHERE user_id = auth.uid() ORDER BY created_at DESC OFFSET 10);
  SELECT count(*) INTO v_count FROM public.erp_push_subscriptions WHERE user_id = auth.uid();
  RETURN v_count;
END;
$$;

-- Отключить уведомления на устройстве (p_endpoint) или на всех своих устройствах (null).
CREATE OR REPLACE FUNCTION public.erp_push_unsubscribe(p_endpoint text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.erp_push_subscriptions WHERE user_id = auth.uid() AND (p_endpoint IS NULL OR endpoint = p_endpoint);
  SELECT count(*) INTO v_count FROM public.erp_push_subscriptions WHERE user_id = auth.uid();
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.erp_push_public_key(), public.erp_push_subscribe(text, text, text, text), public.erp_push_unsubscribe(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_push_public_key(), public.erp_push_subscribe(text, text, text, text), public.erp_push_unsubscribe(text) TO authenticated;

COMMIT;

-- Проверка: таблицы созданы; ключ появится после первого запуска наблюдателя.
SELECT (SELECT count(*) FROM public.erp_push_subscriptions) AS devices, public.erp_push_public_key() IS NOT NULL AS server_key_ready;
