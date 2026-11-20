-- Aliya ERP: чат по каждому заказу (#379/#415). Отдельная плоскость «прямые таблицы + RLS +
-- Realtime»: переписка не проходит через erp_execute и не попадает в офлайн-снимок. Участники —
-- владелец и исполнители заказа; клиент пишет через Telegram, входящие зеркалируются сюда.
-- Safe to run more than once. Existing data is untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('admin', 'worker', 'client')),
  author_profile_id uuid,
  author_name text NOT NULL CHECK (btrim(author_name) <> ''),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 4096),
  channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'telegram')),
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (company_id, id),
  CHECK (author_kind = 'client' OR author_profile_id IS NOT NULL),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id),
  FOREIGN KEY (author_profile_id) REFERENCES public.erp_profiles(id)
);
CREATE INDEX IF NOT EXISTS erp_order_messages_order_idx ON public.erp_order_messages(company_id, order_id, created_at);
CREATE TABLE IF NOT EXISTS public.erp_order_chat_reads (
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  order_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.erp_profiles(id),
  last_read_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (company_id, order_id, profile_id),
  FOREIGN KEY (company_id, order_id) REFERENCES public.erp_orders(company_id, id)
);

CREATE OR REPLACE FUNCTION public.erp_order_chat_member(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.erp_profiles p
    JOIN public.erp_orders o ON o.company_id = p.company_id AND o.id = p_order_id
    WHERE p.id = auth.uid()
      AND (p.role = 'admin' OR (p.employee_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.erp_tasks t
        WHERE t.company_id = o.company_id AND t.order_id = o.id
          AND (t.employee_id = p.employee_id
            OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.crew) c WHERE c = p.employee_id::text))))))
$$;
CREATE OR REPLACE FUNCTION public.erp_order_chat_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_object_agg(u.order_id, u.unread), '{}'::jsonb) FROM (
    SELECT m.order_id, count(*)::int AS unread
    FROM public.erp_order_messages m
    LEFT JOIN public.erp_order_chat_reads r
      ON r.company_id = m.company_id AND r.order_id = m.order_id AND r.profile_id = auth.uid()
    WHERE m.company_id = public.erp_current_company_id()
      AND public.erp_order_chat_member(m.order_id)
      AND m.author_profile_id IS DISTINCT FROM auth.uid()
      AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
    GROUP BY m.order_id
  ) u;
$$;
ALTER TABLE public.erp_order_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_order_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.erp_order_messages TO authenticated;
DROP POLICY IF EXISTS erp_order_messages_read ON public.erp_order_messages;
CREATE POLICY erp_order_messages_read ON public.erp_order_messages FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_order_chat_member(order_id));
DROP POLICY IF EXISTS erp_order_messages_write ON public.erp_order_messages;
CREATE POLICY erp_order_messages_write ON public.erp_order_messages FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.erp_current_company_id()
    AND public.erp_order_chat_member(order_id)
    AND channel = 'app'
    AND author_profile_id = auth.uid()
    AND author_kind = (SELECT role FROM public.erp_profiles WHERE id = auth.uid())
    AND author_name = (SELECT name FROM public.erp_profiles WHERE id = auth.uid())
  );
ALTER TABLE public.erp_order_chat_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_order_chat_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.erp_order_chat_reads TO authenticated;
DROP POLICY IF EXISTS erp_order_chat_reads_own ON public.erp_order_chat_reads;
CREATE POLICY erp_order_chat_reads_own ON public.erp_order_chat_reads FOR ALL TO authenticated
  USING (company_id = public.erp_current_company_id() AND profile_id = auth.uid() AND public.erp_order_chat_member(order_id))
  WITH CHECK (company_id = public.erp_current_company_id() AND profile_id = auth.uid() AND public.erp_order_chat_member(order_id));
ALTER TABLE public.erp_order_messages REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'erp_order_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_order_messages;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.erp_order_chat_member(uuid), public.erp_order_chat_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_order_chat_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.erp_order_chat_overview() TO authenticated;

COMMIT;
