/*
# Revenue Sweep to Binance — Withdrawal Tables

1. New Tables
- `withdrawal_config` — single-row config table for the manual sweep flow.
  Stores destination Binance deposit address, preferred token/network,
  minimum threshold, and whether the sweep is armed.
- `withdrawals` — withdrawal request ledger. Each row is one sweep attempt
  with a two-step lifecycle: `pending` (prepared, awaiting review) →
  `confirmed` (user approved, edge function executing) → `completed` or
  `failed`.

2. Columns
- `withdrawal_config`:
  - `id` (int, PK, always 1 — singleton)
  - `destination_address` (text) — Binance deposit address to sweep to
  - `token` (text, default USDT) — asset to withdraw
  - `network` (text, default BSC) — blockchain network
  - `min_threshold` (numeric, default 1000) — minimum vault balance to allow a sweep
  - `armed` (boolean, default false) — master arm switch
  - `updated_at` (timestamptz)

- `withdrawals`:
  - `id` (uuid, PK)
  - `config_id` (int, FK → withdrawal_config)
  - `amount` (numeric) — amount being swept
  - `token` (text) — asset
  - `destination_address` (text) — where it's going
  - `network` (text) — blockchain network
  - `status` (text) — pending | confirmed | completed | failed | cancelled
  - `tx_hash` (text, nullable) — on-chain tx hash if completed
  - `error_message` (text, nullable) — failure reason if failed
  - `idempotency_key` (text, unique) — prevents duplicate sweeps
  - `created_at` (timestamptz)
  - `confirmed_at` (timestamptz, nullable)
  - `completed_at` (timestamptz, nullable)

3. Security
- RLS enabled on both tables.
- `anon, authenticated` CRUD on both (single-tenant shared console).
- Indexes on withdrawals status and created_at for history queries.
*/

-- WITHDRAWAL CONFIG (singleton row)
CREATE TABLE IF NOT EXISTS withdrawal_config (
  id integer PRIMARY KEY DEFAULT 1,
  destination_address text NOT NULL DEFAULT '',
  token text NOT NULL DEFAULT 'USDT',
  network text NOT NULL DEFAULT 'BSC',
  min_threshold numeric(18,2) NOT NULL DEFAULT 1000,
  armed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_config CHECK (id = 1)
);
ALTER TABLE withdrawal_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_wd_config" ON withdrawal_config;
CREATE POLICY "anon_select_wd_config" ON withdrawal_config FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_wd_config" ON withdrawal_config;
CREATE POLICY "anon_insert_wd_config" ON withdrawal_config FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_wd_config" ON withdrawal_config;
CREATE POLICY "anon_update_wd_config" ON withdrawal_config FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_wd_config" ON withdrawal_config;
CREATE POLICY "anon_delete_wd_config" ON withdrawal_config FOR DELETE
  TO anon, authenticated USING (true);

-- Seed the singleton row if it doesn't exist
INSERT INTO withdrawal_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- WITHDRAWALS LEDGER
CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id integer REFERENCES withdrawal_config(id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL DEFAULT 0,
  token text NOT NULL DEFAULT 'USDT',
  destination_address text NOT NULL DEFAULT '',
  network text NOT NULL DEFAULT 'BSC',
  status text NOT NULL DEFAULT 'pending',
  tx_hash text,
  error_message text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz
);
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_withdrawals" ON withdrawals;
CREATE POLICY "anon_select_withdrawals" ON withdrawals FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_withdrawals" ON withdrawals;
CREATE POLICY "anon_insert_withdrawals" ON withdrawals FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_withdrawals" ON withdrawals;
CREATE POLICY "anon_update_withdrawals" ON withdrawals FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_withdrawals" ON withdrawals;
CREATE POLICY "anon_delete_withdrawals" ON withdrawals FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_wd_created ON withdrawals(created_at DESC);
