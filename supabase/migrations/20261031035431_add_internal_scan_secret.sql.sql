/*
# Protect the strategy scan endpoint with a server-only secret

1. New Tables
- `internal_secrets`: server-only key/value store. `name` (text, primary key), `value` (text, random 256-bit hex), `created_at`.
  Holds the shared secret the scheduled scan job sends to the scan endpoint.

2. Security
- Row level security enabled on `internal_secrets` with no policies, so browser roles (anon, authenticated) cannot read or write it.
- Only the service role (used by server functions) is granted SELECT.

3. Scheduled job
- The `binance-feed-scan` job is rescheduled (same name, same every-minute cadence) so it reads the secret from `internal_secrets` and sends it in an `x-cron-secret` header.
- The secret is never written into the job text itself as a literal value.

4. Notes
- The scan endpoint will accept either this secret or a signed-in operator session.
- Existing secret row is kept if it already exists (ON CONFLICT DO NOTHING), so re-running this migration does not rotate the key.
*/

CREATE TABLE IF NOT EXISTS internal_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE internal_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON internal_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON internal_secrets TO service_role;

INSERT INTO internal_secrets (name, value)
VALUES ('scan_cron', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

SELECT cron.schedule(
  'binance-feed-scan',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://bydbweyercozwdxcbase.supabase.co/functions/v1/binance-feed/scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM internal_secrets WHERE name = 'scan_cron')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
