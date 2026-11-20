-- Мгновенные уведомления: наблюдатель запускается сразу после важного действия в системе
-- (запуск заказа, выдача материалов, сдача и приёмка работы), не дожидаясь расписания.
-- Расписание каждые 15 минут (watch-cron.sql) остаётся — оно ловит «зависшие» ситуации по времени.
--
-- ПЕРЕД ЗАПУСКОМ замените ВАШ_СЕКРЕТ на значение секрета WATCH_SECRET (то же, что в watch-cron.sql).
-- Можно выполнять повторно.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.erp_watch_kick()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.action IN ('order.launch', 'order.issue', 'work.submit', 'work.review', 'assembly.complete', 'outsource.accept') THEN
    BEGIN
      PERFORM net.http_post(
        url := 'https://aqwtodiizpojsxeobqtd.supabase.co/functions/v1/erp-watch',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-secret', 'ВАШ_СЕКРЕТ'),
        body := '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- уведомление не должно мешать самой операции
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.erp_watch_kick() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS erp_watch_kick ON public.erp_audit;
CREATE TRIGGER erp_watch_kick AFTER INSERT ON public.erp_audit
  FOR EACH ROW EXECUTE FUNCTION public.erp_watch_kick();

SELECT tgname FROM pg_trigger WHERE tgname = 'erp_watch_kick';
