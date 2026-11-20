-- Наблюдатель (erp-watch): память о том, о каких ситуациях владельцу уже сообщили.
-- Без неё одно и то же напоминание приходило бы при каждом запуске по расписанию.
-- Идемпотентно: можно выполнять повторно.

CREATE TABLE IF NOT EXISTS public.erp_watch_sent (
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- Только серверная функция (service role): для пользователей приложения таблица закрыта.
ALTER TABLE public.erp_watch_sent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_watch_sent FROM anon, authenticated;
