/*
# Reschedule autonomous trading scan to every 30 seconds

1. Purpose
- The trading scan job (`binance-feed-scan`) previously ran once per minute.
- Per operator request to run trading "double time", the job now runs every 30 seconds.

2. Changes
- Reschedules the existing `binance-feed-scan` cron job using `cron.schedule`,
  which automatically replaces any job with the same name (no duplicates created).
- All other jobs (harvest, swarm worker, snapshots) are untouched.

3. Notes
- Uses pg_cron interval string syntax ('30 seconds'), supported by the pg_cron extension.
- No data is modified; this only changes scheduling frequency.
*/

SELECT cron.schedule(
  'binance-feed-scan',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://bydbweyercozwdxcbase.supabase.co/functions/v1/binance-feed/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM internal_secrets WHERE name = 'scan_cron')
    ),
    body := '{}'::jsonb
  );
  $$
);
