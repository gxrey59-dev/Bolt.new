-- Re-enable autonomous trading cron (1 minute intervals)
SELECT cron.schedule(
  'binance-feed-scan',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bydbweyercozwdxcbase.supabase.co/functions/v1/binance-feed/scan',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
