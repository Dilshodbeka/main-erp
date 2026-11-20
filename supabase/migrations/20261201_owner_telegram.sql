-- Telegram-контроль для каждой фирмы: владелец сам привязывает свой Telegram к боту
-- (отчёты и уведомления наблюдателя), без правки секретов сервера.
-- В настройках он получает одноразовый код и пишет боту «/ulash КОД».
-- Ядро команд не затрагивается. Идемпотентно — можно выполнять повторно.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_owner_chats (
  telegram_chat_id text PRIMARY KEY CHECK (telegram_chat_id ~ '^-?[0-9]{5,20}$'),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.erp_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX IF NOT EXISTS erp_owner_chats_company_idx ON public.erp_owner_chats(company_id);

CREATE TABLE IF NOT EXISTS public.erp_owner_link_codes (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z2-9]{8}$'),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.erp_profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Обе таблицы читает и пишет только сервер (service role) и функции ниже.
ALTER TABLE public.erp_owner_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_owner_link_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_owner_chats, public.erp_owner_link_codes FROM anon, authenticated;

-- Владелец просит код: действует 15 минут, прежние коды этого владельца гасятся.
CREATE OR REPLACE FUNCTION public.erp_owner_link_code()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profile public.erp_profiles%ROWTYPE := public.erp_current_profile();
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  -- gen_random_uuid() is core PostgreSQL; pgcrypto lives outside this function's search_path.
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_expires timestamptz := now() + interval '15 minutes';
BEGIN
  IF v_profile.role <> 'admin' THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  FOR i IN 0..7 LOOP v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1); END LOOP;
  DELETE FROM public.erp_owner_link_codes WHERE profile_id = v_profile.id OR expires_at < now();
  INSERT INTO public.erp_owner_link_codes(code, company_id, profile_id, expires_at)
    VALUES (v_code, v_profile.company_id, v_profile.id, v_expires);
  RETURN jsonb_build_object('code', v_code, 'expiresAt', v_expires);
END;
$$;

-- Сколько чатов привязано к фирме (сами номера чатов наружу не отдаются).
CREATE OR REPLACE FUNCTION public.erp_owner_chats_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN public.erp_is_admin()
    THEN (SELECT count(*)::integer FROM public.erp_owner_chats WHERE company_id = public.erp_current_company_id())
    ELSE 0 END;
$$;

-- Отвязать все Telegram-чаты фирмы.
CREATE OR REPLACE FUNCTION public.erp_owner_chats_clear()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.erp_owner_chats WHERE company_id = public.erp_current_company_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.erp_owner_link_code(), public.erp_owner_chats_count(), public.erp_owner_chats_clear() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_owner_link_code(), public.erp_owner_chats_count(), public.erp_owner_chats_clear() TO authenticated;

COMMIT;
