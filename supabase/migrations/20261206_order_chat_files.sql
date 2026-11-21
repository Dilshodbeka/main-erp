-- Чат заказа: при отмене заказа файлы чата (фото, голос, видео, документы) тоже удаляются.
-- Триггер отмены складывает пути файлов в очередь, наблюдатель erp-watch удаляет их из хранилища
-- (в течение 15 минут). Командное ядро (erp_execute) не затрагивается. Идемпотентно.

BEGIN;

CREATE TABLE IF NOT EXISTS public.erp_order_chat_trash (
  path text PRIMARY KEY CHECK (length(path) BETWEEN 3 AND 400),
  company_id uuid NOT NULL REFERENCES public.erp_companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE public.erp_order_chat_trash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_order_chat_trash FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.erp_order_chat_on_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF NEW.kind = 'series' THEN RETURN NULL; END IF;
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    INSERT INTO public.erp_order_chat_trash(path, company_id)
    SELECT file_path, company_id FROM public.erp_order_messages
     WHERE company_id = NEW.company_id AND order_id = NEW.id AND file_path IS NOT NULL
    ON CONFLICT (path) DO NOTHING;
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
REVOKE ALL ON FUNCTION public.erp_order_chat_on_update() FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT count(*) AS files_waiting_for_cleanup FROM public.erp_order_chat_trash;
