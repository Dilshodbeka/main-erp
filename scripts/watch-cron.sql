-- Запуск наблюдателя по расписанию: каждые 15 минут база вызывает функцию erp-watch.
-- Перед запуском замените ДВА значения ниже:
--   1) ВАШ_СЕКРЕТ — то же слово, что вы записали в секрет функции WATCH_SECRET;
--   2) адрес проекта — уже подставлен для aqwtodiizpojsxeobqtd.
-- Выполнить один раз в Supabase → SQL Editor. Повторный запуск безопасен.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Снять прежнее расписание, если оно уже было
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'erp-watch';

SELECT cron.schedule(
  'erp-watch',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://aqwtodiizpojsxeobqtd.supabase.co/functions/v1/erp-watch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-watch-secret', 'ВАШ_СЕКРЕТ'),
    body := '{}'::jsonb
  );
  $job$
);

-- Проверка: должна быть одна строка erp-watch
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'erp-watch';
