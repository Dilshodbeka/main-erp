-- Telegram chat module for Aliya ERP.
-- Run after supabase/schema.sql. Safe to re-run: columns, indexes, policies and
-- constraints are recreated deterministically, and Supabase-only blocks are
-- skipped on hosts without the storage schema or the realtime publication.

BEGIN;

-- Chat metadata lives on the customer row; it is intentionally not part of the
-- event-sourced erp_snapshot payload.
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS telegram_chat_id text;
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS telegram_link_code text;
ALTER TABLE public.erp_customers ADD COLUMN IF NOT EXISTS telegram_link_expires_at timestamptz;

ALTER TABLE public.erp_customers DROP CONSTRAINT IF EXISTS erp_customers_telegram_chat_id_check;
ALTER TABLE public.erp_customers ADD CONSTRAINT erp_customers_telegram_chat_id_check
  CHECK (telegram_chat_id IS NULL OR telegram_chat_id ~ '^-?[0-9]{5,20}$');

ALTER TABLE public.erp_customers DROP CONSTRAINT IF EXISTS erp_customers_telegram_link_code_check;
ALTER TABLE public.erp_customers ADD CONSTRAINT erp_customers_telegram_link_code_check
  CHECK (telegram_link_code IS NULL OR telegram_link_code ~ '^[A-Za-z0-9_-]{16,64}$');

ALTER TABLE public.erp_customers DROP CONSTRAINT IF EXISTS erp_customers_telegram_link_state_check;
ALTER TABLE public.erp_customers ADD CONSTRAINT erp_customers_telegram_link_state_check
  CHECK (telegram_link_expires_at IS NULL OR telegram_link_code IS NOT NULL);

-- A Telegram account is globally unique: a chat can never be claimed by two
-- companies, otherwise /start routing would leak a conversation across tenants.
CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_telegram_chat_id_key
  ON public.erp_customers (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS erp_customers_telegram_link_code_key
  ON public.erp_customers (telegram_link_code) WHERE telegram_link_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_customers_telegram_chat_company_idx
  ON public.erp_customers (company_id) WHERE telegram_chat_id IS NOT NULL;

-- Workers never use Telegram: the bot is for customers only, and a worker sees their
-- orders in the app. Anything an earlier build staged for a worker is dropped here,
-- so re-running this script on a live database leaves no residue behind.
DROP TRIGGER IF EXISTS erp_notify_task ON public.erp_tasks;
DROP TRIGGER IF EXISTS erp_notify_order ON public.erp_orders;
DROP TRIGGER IF EXISTS erp_notify_line ON public.erp_order_items;
DROP FUNCTION IF EXISTS public.erp_notify_task_change();
DROP FUNCTION IF EXISTS public.erp_notify_order_change();
DROP FUNCTION IF EXISTS public.erp_notify_line_change();
DROP FUNCTION IF EXISTS public.erp_notify(uuid, uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.erp_notify(uuid, uuid, uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.erp_notify_task_payload(public.erp_tasks, numeric);
DROP FUNCTION IF EXISTS public.erp_notify_cancel_payload(uuid, uuid, text);
DROP TABLE IF EXISTS public.erp_notifications;

ALTER TABLE public.erp_employees DROP CONSTRAINT IF EXISTS erp_employees_telegram_chat_id_check;
ALTER TABLE public.erp_employees DROP CONSTRAINT IF EXISTS erp_employees_telegram_link_code_check;
ALTER TABLE public.erp_employees DROP CONSTRAINT IF EXISTS erp_employees_telegram_link_state_check;
ALTER TABLE public.erp_employees DROP COLUMN IF EXISTS telegram_chat_id;
ALTER TABLE public.erp_employees DROP COLUMN IF EXISTS telegram_link_code;
ALTER TABLE public.erp_employees DROP COLUMN IF EXISTS telegram_link_expires_at;

CREATE TABLE IF NOT EXISTS public.erp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id),
  client_id uuid NOT NULL,
  telegram_chat_id text NOT NULL CHECK (telegram_chat_id ~ '^-?[0-9]{5,20}$'),
  sender text NOT NULL CHECK (sender IN ('client', 'operator')),
  text text NOT NULL DEFAULT '' CHECK (char_length(text) <= 4096),
  file_url text CHECK (file_url IS NULL OR char_length(file_url) <= 2048),
  file_type text CHECK (file_type IS NULL OR file_type IN ('text', 'document', 'photo', 'voice')),
  file_name text CHECK (file_name IS NULL OR char_length(file_name) BETWEEN 1 AND 200),
  file_size bigint CHECK (file_size IS NULL OR (file_size BETWEEN 0 AND 20971520)),
  storage_path text CHECK (storage_path IS NULL OR char_length(storage_path) <= 512),
  telegram_message_id bigint CHECK (telegram_message_id IS NULL OR telegram_message_id > 0),
  telegram_update_id bigint CHECK (telegram_update_id IS NULL OR telegram_update_id > 0),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT erp_messages_content_check CHECK (text <> '' OR file_type IS NOT NULL),
  CONSTRAINT erp_messages_customer_fk FOREIGN KEY (company_id, client_id)
    REFERENCES public.erp_customers (company_id, id) ON DELETE CASCADE,
  UNIQUE (company_id, id)
);

-- Telegram update ids are bot-global; a unique partial index makes webhook
-- retries idempotent without inventing a second delivery ledger.
CREATE UNIQUE INDEX IF NOT EXISTS erp_messages_update_key
  ON public.erp_messages (telegram_update_id) WHERE telegram_update_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_messages_thread_idx
  ON public.erp_messages (company_id, client_id, created_at, id);
CREATE INDEX IF NOT EXISTS erp_messages_unread_idx
  ON public.erp_messages (company_id, client_id) WHERE NOT is_read;

ALTER TABLE public.erp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.erp_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.erp_messages TO authenticated;
GRANT ALL ON TABLE public.erp_messages TO service_role;

DROP POLICY IF EXISTS erp_messages_admin_read ON public.erp_messages;
CREATE POLICY erp_messages_admin_read ON public.erp_messages
  FOR SELECT TO authenticated
  USING (company_id = public.erp_current_company_id() AND public.erp_is_admin());

-- Supabase-only: stream INSERTs to open admin chat drawers.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'erp_messages'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.erp_messages';
  END IF;
END;
$$;

-- Supabase-only: private bucket for drawings and documents. Inbound uploads use
-- the service role; outbound uploads are accepted only from an admin of the
-- company that owns the first path segment.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('telegram-files', 'telegram-files', false, 20971520)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;
  EXECUTE 'DROP POLICY IF EXISTS telegram_files_admin_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS telegram_files_admin_select ON storage.objects';
  EXECUTE $policy$CREATE POLICY telegram_files_admin_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'telegram-files'
      AND public.erp_is_admin()
      AND split_part(name, '/', 1) = public.erp_current_company_id()::text
    )$policy$;
  EXECUTE $policy$CREATE POLICY telegram_files_admin_select ON storage.objects FOR SELECT TO authenticated
    USING (
      bucket_id = 'telegram-files'
      AND public.erp_is_admin()
      AND split_part(name, '/', 1) = public.erp_current_company_id()::text
    )$policy$;
END;
$$;

COMMIT;
