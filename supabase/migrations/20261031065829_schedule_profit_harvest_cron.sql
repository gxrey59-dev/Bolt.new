SELECT cron.unschedule('binance-harvest') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'binance-harvest');

SELECT cron.schedule(
  'binance-harvest',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bydbweyercozwdxcbase.supabase.co/functions/v1/binance-withdraw/harvest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM internal_secrets WHERE name = 'harvest_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);
