
-- Enable pg_cron for autonomous 24/7 trading
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA extensions;

-- Schedule the strategy scan every 5 minutes via pg_net
-- The edge function handles kill switch checks, position management, and order execution
SELECT cron.schedule(
  'autonomous-strategy-scan',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/binance-feed/scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key', true),
        'apikey', current_setting('app.supabase_anon_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Schedule a position check every 2 minutes for faster stop-loss/take-profit execution
SELECT cron.schedule(
  'autonomous-position-check',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/binance-feed/scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key', true),
        'apikey', current_setting('app.supabase_anon_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);
