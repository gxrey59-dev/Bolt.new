/*
# Swarm wallet worker: auto-withdraw to cold storage with enforced limits

1. Modified Tables
- `defi_swarm_wallet` new columns:
  - `auto_withdraw_enabled` (boolean, default false) master switch for the sweep worker
  - `cold_address` (text, nullable) destination cold storage address on Polygon
  - `cold_address_set_at` (timestamptz) when the address was last changed; the worker waits 24h before sending to a new address
  - `keep_reserve_usd` (numeric, default 0) stablecoin amount that always stays in the swarm wallet
  - `last_run_at` (timestamptz), `last_run_result` (text) latest worker outcome for display

2. New Tables
- `defi_swarm_spends` ledger of every outgoing transfer the worker makes
  - `id`, `created_at`, `updated_at`
  - `kind` (e.g. 'sweep'), `token`, `token_address`, `amount_usd`, `amount_raw`
  - `to_address`, `tx_hash`, `status` (reserved | submitted | confirmed | failed), `error`

3. New Functions (service_role only)
- `reserve_swarm_spend(...)`: atomically locks the wallet row and records a spend ONLY if
  (a) it is within the per-action limit, (b) the rolling 24h total stays within the daily cap,
  and (c) no other spend is still in flight. Otherwise it raises an error and nothing is recorded.
- `get_swarm_wallet_key()`: returns the decrypted wallet key from Vault for the server worker.

4. Security
- RLS enabled on `defi_swarm_spends` with no browser policies or grants; only server functions access it.
- Both functions have EXECUTE revoked from PUBLIC, anon and authenticated.
- A new random `swarm_worker` secret authenticates the scheduled job.

5. Schedule
- `swarm-wallet-worker` runs every 10 minutes. It does nothing unless auto-withdraw is switched on.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'auto_withdraw_enabled') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN auto_withdraw_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'cold_address') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN cold_address text CHECK (cold_address IS NULL OR cold_address ~ '^0x[0-9a-fA-F]{40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'cold_address_set_at') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN cold_address_set_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'keep_reserve_usd') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN keep_reserve_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (keep_reserve_usd >= 0 AND keep_reserve_usd <= 1000000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'last_run_at') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN last_run_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'defi_swarm_wallet' AND column_name = 'last_run_result') THEN
    ALTER TABLE defi_swarm_wallet ADD COLUMN last_run_result text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS defi_swarm_spends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  token text NOT NULL,
  token_address text NOT NULL,
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  amount_raw text NOT NULL,
  to_address text NOT NULL CHECK (to_address ~ '^0x[0-9a-fA-F]{40}$'),
  tx_hash text,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'submitted', 'confirmed', 'failed')),
  error text
);

CREATE INDEX IF NOT EXISTS defi_swarm_spends_status_created_idx ON defi_swarm_spends (status, created_at DESC);

ALTER TABLE defi_swarm_spends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON defi_swarm_spends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON defi_swarm_spends TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_swarm_spend(
  p_kind text, p_token text, p_token_address text, p_amount_usd numeric, p_amount_raw text, p_to text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  w public.defi_swarm_wallet%ROWTYPE;
  spent numeric;
  new_id uuid;
BEGIN
  SELECT * INTO w FROM public.defi_swarm_wallet WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_wallet'; END IF;
  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_amount_usd > w.max_action_usd THEN RAISE EXCEPTION 'per_action_limit'; END IF;

  IF EXISTS (SELECT 1 FROM public.defi_swarm_spends WHERE status IN ('reserved', 'submitted')) THEN
    RAISE EXCEPTION 'spend_in_flight';
  END IF;

  SELECT COALESCE(SUM(amount_usd), 0) INTO spent
  FROM public.defi_swarm_spends
  WHERE status IN ('reserved', 'submitted', 'confirmed') AND created_at > now() - interval '24 hours';

  IF spent + p_amount_usd > w.daily_cap_usd THEN RAISE EXCEPTION 'daily_cap'; END IF;

  INSERT INTO public.defi_swarm_spends (kind, token, token_address, amount_usd, amount_raw, to_address)
  VALUES (p_kind, p_token, p_token_address, p_amount_usd, p_amount_raw, p_to)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_swarm_spend(text, text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_swarm_spend(text, text, text, numeric, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_swarm_wallet_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  k text;
BEGIN
  SELECT s.decrypted_secret INTO k
  FROM vault.decrypted_secrets s
  JOIN public.defi_swarm_wallet w ON w.vault_secret_id = s.id
  WHERE w.id = 1;
  RETURN k;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_swarm_wallet_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_swarm_wallet_key() TO service_role;

INSERT INTO internal_secrets (name, value)
VALUES ('swarm_worker', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('swarm-wallet-worker') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'swarm-wallet-worker');

SELECT cron.schedule(
  'swarm-wallet-worker',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bydbweyercozwdxcbase.supabase.co/functions/v1/swarm-wallet/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT value FROM internal_secrets WHERE name = 'swarm_worker')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
