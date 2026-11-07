/*
# Intruder scanner: denied-access event log

1. Summary
- Adds a `intruder_events` table that records every denied access attempt on the
  app's protected server routes (bad sign-in token, non-operator account, wrong
  cron secret). An operator-only dashboard panel reads and summarizes it.

2. New Tables
- `intruder_events`
  - `id` (uuid, primary key, auto)
  - `occurred_at` (timestamptz, default now)
  - `function_name` (text) — which server function rejected the request
  - `route` (text) — which route within that function
  - `method` (text) — HTTP method
  - `client_ip` (text, nullable) — requester IP as seen by the edge
  - `reason` (text) — machine-readable denial reason
  - `detail` (text, nullable) — short human-readable note (never includes tokens)

3. Security
- RLS is ENABLED and intentionally NO policies exist: no browser role can read
  or write this table through the Data API at all (deny-by-default).
- Only `service_role` (server-side functions) may INSERT. Nothing is granted to
  anon or authenticated. Reads happen only inside server functions running with
  the service role.

4. Notes
- `client_ip` is stored for operator-facing intrusion review only.
- No secrets or tokens are ever written to this table.
*/

CREATE TABLE IF NOT EXISTS intruder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  function_name text NOT NULL,
  route text NOT NULL,
  method text NOT NULL,
  client_ip text,
  reason text NOT NULL,
  detail text
);

ALTER TABLE intruder_events ENABLE ROW LEVEL SECURITY;

GRANT INSERT ON intruder_events TO service_role;
