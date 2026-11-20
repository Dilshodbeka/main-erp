-- Чат заказа, вторая очередь: системная карточка заказа, вложения (фото, файлы, голос, видео),
-- удаление чата при отмене заказа и вручную. Командное ядро (erp_execute) не затрагивается.
-- Идемпотентно — можно выполнять повторно.

BEGIN;

-- ── Типы сообщений и вложения ───────────────────────────────────────────────
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text';
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS file_mime text;
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS file_size integer;
-- Роль автора в этом заказе (этап: «Yig‘ish», «O‘lchov»…), показывается рядом с именем.
ALTER TABLE public.erp_order_messages ADD COLUMN IF NOT EXISTS author_title text NOT NULL DEFAULT '';

-- Прежние проверки автора не знали про системные сообщения: заменяем их именованными.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.erp_order_messages'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%author_kind%'
              AND conname NOT IN ('erp_order_messages_author_v2', 'erp_order_messages_profile_v2')
  LOOP
    EXECUTE format('ALTER TABLE public.erp_order_messages DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_order_messages_author_v2') THEN
    ALTER TABLE public.erp_order_messages ADD CONSTRAINT erp_order_messages_author_v2
      CHECK (author_kind IN ('admin', 'worker', 'client', 'system'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_order_messages_profile_v2') THEN
    ALTER TABLE public.erp_order_messages ADD CONSTRAINT erp_order_messages_profile_v2
      CHECK (author_kind IN ('client', 'system') OR author_profile_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'erp_order_messages_kind_v2') THEN
    ALTER TABLE public.erp_order_messages ADD CONSTRAINT erp_order_messages_kind_v2
      CHECK (kind IN ('system', 'text', 'image', 'file', 'voice', 'video')
        AND (kind = 'system') = (author_kind = 'system')
        AND ((kind IN ('system', 'text')) = (file_path IS NULL))
        AND (file_size IS NULL OR file_size BETWEEN 1 AND 52428800)
        AND (file_name IS NULL OR length(file_name) <= 200)
        AND length(author_title) <= 80);
  END IF;
END $$;

-- Вложение можно привязать только к файлу из папки этого же заказа.
CREATE OR REPLACE FUNCTION public.erp_order_message_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.file_path IS NOT NULL AND NEW.file_path NOT LIKE NEW.company_id::text || '/' || NEW.order_id::text || '/%' THEN
    RAISE EXCEPTION 'Attachment belongs to another order' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS erp_order_message_guard ON public.erp_order_messages;
CREATE TRIGGER erp_order_message_guard BEFORE INSERT ON public.erp_order_messages
  FOR EACH ROW EXECUTE FUNCTION public.erp_order_message_guard();

-- ── Системная карточка заказа ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.erp_order_card_text(p_order public.erp_orders)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.erp_customers%ROWTYPE; v_stages text; v_text text;
BEGIN
  SELECT * INTO c FROM public.erp_customers WHERE company_id = p_order.company_id AND id = p_order.customer_id;
  SELECT string_agg(t.name, ' → ' ORDER BY t.position, t.first_row) INTO v_stages
    FROM (SELECT name, min(position) AS position, min(ctid) AS first_row FROM public.erp_tasks
           WHERE company_id = p_order.company_id AND order_id = p_order.id GROUP BY name) t;
  v_text := '📋 Buyurtma ' || p_order.number || E'\n' || p_order.title || ' · ' || trim(to_char(p_order.qty, 'FM999999990.###'), '.') || ' dona';
  IF c.id IS NOT NULL THEN
    v_text := v_text || E'\nMijoz: ' || c.name || CASE WHEN c.phone <> '' THEN ' · ' || c.phone ELSE '' END;
    IF c.address <> '' THEN v_text := v_text || E'\nManzil: ' || c.address; END IF;
  END IF;
  IF p_order.due_date <> '' THEN v_text := v_text || E'\nMuddat: ' || p_order.due_date; END IF;
  v_text := v_text || E'\nSumma: ' || trim(to_char(p_order.price, 'FM999G999G999G999G990')) || ' so‘m';
  IF v_stages IS NOT NULL THEN v_text := v_text || E'\nBosqichlar: ' || v_stages; END IF;
  RETURN left(v_text, 4000);
END;
$$;

CREATE OR REPLACE FUNCTION public.erp_order_chat_system(p_order public.erp_orders, p_text text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.erp_order_messages(company_id, order_id, author_kind, author_name, text, channel, kind)
  VALUES (p_order.company_id, p_order.id, 'system', 'Tizim', p_text, 'app', 'system');
$$;

-- Создание заказа: карточка пишется в конце транзакции, когда этапы уже сохранены.
CREATE OR REPLACE FUNCTION public.erp_order_chat_on_create()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE o public.erp_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.erp_orders WHERE id = NEW.id;
  IF o.id IS NULL OR o.kind = 'series' OR o.status = 'cancelled' THEN RETURN NULL; END IF;
  PERFORM public.erp_order_chat_system(o, public.erp_order_card_text(o));
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS erp_order_chat_on_create ON public.erp_orders;
CREATE CONSTRAINT TRIGGER erp_order_chat_on_create AFTER INSERT ON public.erp_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.erp_order_chat_on_create();

-- Ключевые изменения: статус, срок, сумма. Отмена — чат удаляется вместе с сообщениями.
CREATE OR REPLACE FUNCTION public.erp_order_chat_on_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF NEW.kind = 'series' THEN RETURN NULL; END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    DELETE FROM public.erp_order_messages WHERE company_id = NEW.company_id AND order_id = NEW.id;
    DELETE FROM public.erp_order_chat_reads WHERE company_id = NEW.company_id AND order_id = NEW.id;
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_status := CASE NEW.status WHEN 'production' THEN 'Ishlab chiqarishda' WHEN 'ready' THEN 'Tayyor'
      WHEN 'shipped' THEN 'Yuborilgan' WHEN 'delivered' THEN 'Yetkazilgan' ELSE 'Qoralama' END;
    PERFORM public.erp_order_chat_system(NEW, '🔄 Holat: ' || v_status);
  END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.price IS DISTINCT FROM OLD.price OR NEW.title IS DISTINCT FROM OLD.title OR NEW.qty IS DISTINCT FROM OLD.qty THEN
    PERFORM public.erp_order_chat_system(NEW, '✏️ Buyurtma o‘zgardi' || E'\n' || public.erp_order_card_text(NEW));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS erp_order_chat_on_update ON public.erp_orders;
CREATE TRIGGER erp_order_chat_on_update AFTER UPDATE ON public.erp_orders
  FOR EACH ROW EXECUTE FUNCTION public.erp_order_chat_on_update();

-- Ручное удаление чата владельцем. Возвращает пути файлов, чтобы приложение очистило хранилище.
CREATE OR REPLACE FUNCTION public.erp_order_chat_delete(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_company uuid := public.erp_current_company_id(); v_files jsonb;
BEGIN
  IF v_company IS NULL OR NOT public.erp_is_admin() THEN RAISE EXCEPTION 'Administrator action required' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(file_path), '[]'::jsonb) INTO v_files FROM public.erp_order_messages
   WHERE company_id = v_company AND order_id = p_order_id AND file_path IS NOT NULL;
  DELETE FROM public.erp_order_messages WHERE company_id = v_company AND order_id = p_order_id;
  DELETE FROM public.erp_order_chat_reads WHERE company_id = v_company AND order_id = p_order_id;
  RETURN v_files;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_order_card_text(public.erp_orders), public.erp_order_chat_system(public.erp_orders, text),
  public.erp_order_chat_on_create(), public.erp_order_chat_on_update(), public.erp_order_message_guard(), public.erp_order_chat_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erp_order_chat_delete(uuid) TO authenticated;

COMMIT;

-- ── Хранилище вложений: закрытая папка «фирма/заказ/…», доступ только участникам заказа ──
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('order-chat', 'order-chat', false, 52428800)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;
  EXECUTE 'DROP POLICY IF EXISTS order_chat_files_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS order_chat_files_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS order_chat_files_delete ON storage.objects';
  EXECUTE $policy$CREATE POLICY order_chat_files_insert ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'order-chat'
      AND split_part(name, '/', 1) = public.erp_current_company_id()::text
      AND split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$'
      AND public.erp_order_chat_member(split_part(name, '/', 2)::uuid))$policy$;
  EXECUTE $policy$CREATE POLICY order_chat_files_select ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'order-chat'
      AND split_part(name, '/', 1) = public.erp_current_company_id()::text
      AND split_part(name, '/', 2) ~ '^[0-9a-f-]{36}$'
      AND public.erp_order_chat_member(split_part(name, '/', 2)::uuid))$policy$;
  EXECUTE $policy$CREATE POLICY order_chat_files_delete ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'order-chat' AND public.erp_is_admin()
      AND split_part(name, '/', 1) = public.erp_current_company_id()::text)$policy$;
END $$;

SELECT count(*) FILTER (WHERE kind = 'system') AS system_messages, count(*) AS all_messages FROM public.erp_order_messages;
