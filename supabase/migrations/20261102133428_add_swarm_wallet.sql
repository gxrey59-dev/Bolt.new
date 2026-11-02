/*
# Dedicated DeFi swarm wallet

1. New Tables
- `defi_swarm_wallet` (single row, id = 1)
  - `id` (smallint, primary key, always 1)
  - `address` (text, public EVM address of the swarm wallet)
  - `chain` (text, network the wallet is intended for, default 'polygon')
  - `vault_secret_id` (uuid, reference to the encrypted private key in Supabase Vault)
  - `max_action_usd` (numeric, largest single automated action allowed)
  - `daily_cap_usd` (numeric, total automated spend allowed per day)
  - `created_at`, `updated_at` (timestamps)

2. New Functions
- `store_swarm_wallet_key(p_secret text, p_name text)` stores a private key in Supabase Vault and returns its id.
  SECURITY DEFINER, callable ONLY by service_role (edge functions).

3. Security
- RLS enabled on `defi_swarm_wallet` with no anon/authenticated policies or grants:
  the browser can never read this table directly. Only the operator-gated edge function
  (service_role) reads and writes it.
- The private key is never stored in a public table; it lives encrypted in Vault.

4. Important Notes
1. Only one swarm wallet can exist (enforced by the id = 1 check).
2. Limits are validated server-side and by check constraints.
*/

CREATE TABLE IF NOT EXISTS defi_swarm_wallet (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  chain text NOT NULL DEFAULT 'polygon',
  vault_secret_id uuid NOT NULL,
  max_action_usd numeric(12,2) NOT NULL DEFAULT 25 CHECK (max_action_usd > 0 AND max_action_usd <= 100000),
  daily_cap_usd numeric(12,2) NOT NULL DEFAULT 100 CHECK (daily_cap_usd > 0 AND daily_cap_usd <= 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_action_usd <= daily_cap_usd)
);

ALTER TABLE defi_swarm_wallet ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON defi_swarm_wallet FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON defi_swarm_wallet TO service_role;

CREATE OR REPLACE FUNCTION public.store_swarm_wallet_key(p_secret text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN vault.create_secret(p_secret, p_name, 'DeFi swarm wallet private key');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.store_swarm_wallet_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_swarm_wallet_key(text, text) TO service_role;
