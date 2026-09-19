/*
# Wu-Tang Financial Weapon — Core Schema

1. Overview
- Single-tenant operations database for a multi-agent crypto trading engine.
- Tracks 9 Factions (~5,555 worker bots each, 50,000 total), 3 Manager Agents,
  1 Supreme Architect (The Abbot), C.R.E.A.M. profit sweeps, "Protect ya neck"
  circuit breakers, incoming trade signals, market sentiment overrides,
  round-robin bot rotation, and stress-test runs.
- No sign-in screen — the dashboard is a shared operations console. All
  policies are scoped to `anon, authenticated` so the anon-key frontend can
  read and write its own data.

2. New Tables
- `factions` — the 9 trading factions.
- `managers` — the 3 Manager Agents (GZA, Method, Raekwon) plus The Abbot.
- `signals` — incoming trade signals, batched in groups of 50.
- `sweeps` — C.R.E.A.M. profit-sweep events.
- `circuit_breakers` — "Protect ya neck" violations.
- `sentiment` — manual market-sentiment overrides.
- `stress_tests` — stress-test run records.
- `rotation_batches` — round-robin scheduler batches.
- `audit_log` — append-only event log.

3. Security
- RLS enabled on every table.
- All tables allow anon + authenticated CRUD (single-tenant shared console).
- `audit_log` update/delete restricted to authenticated only.
*/

-- FACTIONS
CREATE TABLE IF NOT EXISTS factions (
  id text PRIMARY KEY,
  name text NOT NULL,
  member_name text NOT NULL,
  persona text NOT NULL,
  bot_count integer NOT NULL DEFAULT 5555,
  allocated_capital numeric(18,2) NOT NULL DEFAULT 0,
  reserve_capital numeric(18,2) NOT NULL DEFAULT 0,
  active_capital numeric(18,2) NOT NULL DEFAULT 0,
  profit_today numeric(18,2) NOT NULL DEFAULT 0,
  profit_total numeric(18,2) NOT NULL DEFAULT 0,
  loss_today numeric(18,2) NOT NULL DEFAULT 0,
  trades_today integer NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  consecutive_losses integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  paused_until timestamptz,
  cooldown_until timestamptz,
  gas_threshold_gwei numeric(10,2),
  slippage_threshold numeric(5,4),
  profit_target_48h numeric(18,2),
  hold_hours integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE factions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_factions" ON factions;
CREATE POLICY "anon_select_factions" ON factions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_factions" ON factions;
CREATE POLICY "anon_insert_factions" ON factions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_factions" ON factions;
CREATE POLICY "anon_update_factions" ON factions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_factions" ON factions;
CREATE POLICY "anon_delete_factions" ON factions FOR DELETE TO anon, authenticated USING (true);

-- MANAGERS
CREATE TABLE IF NOT EXISTS managers (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  trigger_type text NOT NULL,
  status text NOT NULL DEFAULT 'online',
  health_score integer NOT NULL DEFAULT 100,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  temp_manager_bot_id text,
  promoted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE managers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_managers" ON managers;
CREATE POLICY "anon_select_managers" ON managers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_managers" ON managers;
CREATE POLICY "anon_insert_managers" ON managers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_managers" ON managers;
CREATE POLICY "anon_update_managers" ON managers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_managers" ON managers;
CREATE POLICY "anon_delete_managers" ON managers FOR DELETE TO anon, authenticated USING (true);

-- SIGNALS
CREATE TABLE IF NOT EXISTS signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id integer NOT NULL,
  faction_id text NOT NULL,
  signal_type text NOT NULL,
  token_symbol text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  latency_ms integer NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_signals" ON signals;
CREATE POLICY "anon_select_signals" ON signals FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_signals" ON signals;
CREATE POLICY "anon_insert_signals" ON signals FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_signals" ON signals;
CREATE POLICY "anon_update_signals" ON signals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_signals" ON signals;
CREATE POLICY "anon_delete_signals" ON signals FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_signals_batch ON signals(batch_id);
CREATE INDEX IF NOT EXISTS idx_signals_faction ON signals(faction_id);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at DESC);

-- SWEEPS
CREATE TABLE IF NOT EXISTS sweeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sweep_type text NOT NULL DEFAULT 'cream',
  amount_swept numeric(18,2) NOT NULL DEFAULT 0,
  bots_swept integer NOT NULL DEFAULT 0,
  rebalanced_amount numeric(18,2) NOT NULL DEFAULT 0,
  master_wallet_balance numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sweeps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_sweeps" ON sweeps;
CREATE POLICY "anon_select_sweeps" ON sweeps FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_sweeps" ON sweeps;
CREATE POLICY "anon_insert_sweeps" ON sweeps FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_sweeps" ON sweeps;
CREATE POLICY "anon_update_sweeps" ON sweeps FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_sweeps" ON sweeps;
CREATE POLICY "anon_delete_sweeps" ON sweeps FOR DELETE TO anon, authenticated USING (true);

-- CIRCUIT BREAKERS
CREATE TABLE IF NOT EXISTS circuit_breakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  faction_id text,
  trigger_type text NOT NULL DEFAULT 'webhook',
  loss_percent numeric(5,2) NOT NULL,
  threshold numeric(5,2) NOT NULL,
  time_window text NOT NULL,
  action_taken text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE circuit_breakers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_circuit_breakers" ON circuit_breakers;
CREATE POLICY "anon_select_circuit_breakers" ON circuit_breakers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_circuit_breakers" ON circuit_breakers;
CREATE POLICY "anon_insert_circuit_breakers" ON circuit_breakers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_circuit_breakers" ON circuit_breakers;
CREATE POLICY "anon_update_circuit_breakers" ON circuit_breakers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_circuit_breakers" ON circuit_breakers;
CREATE POLICY "anon_delete_circuit_breakers" ON circuit_breakers FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_cb_faction ON circuit_breakers(faction_id);
CREATE INDEX IF NOT EXISTS idx_cb_created ON circuit_breakers(created_at DESC);

-- SENTIMENT
CREATE TABLE IF NOT EXISTS sentiment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  label text NOT NULL,
  triggered_by text NOT NULL DEFAULT 'manual',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sentiment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_sentiment" ON sentiment;
CREATE POLICY "anon_select_sentiment" ON sentiment FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_sentiment" ON sentiment;
CREATE POLICY "anon_insert_sentiment" ON sentiment FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_sentiment" ON sentiment;
CREATE POLICY "anon_update_sentiment" ON sentiment FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_sentiment" ON sentiment;
CREATE POLICY "anon_delete_sentiment" ON sentiment FOR DELETE TO anon, authenticated USING (true);

-- STRESS TESTS
CREATE TABLE IF NOT EXISTS stress_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  signals_routed integer NOT NULL DEFAULT 0,
  duration_seconds integer NOT NULL DEFAULT 0,
  breakers_triggered integer NOT NULL DEFAULT 0,
  sweeps_executed integer NOT NULL DEFAULT 0,
  peak_latency_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE stress_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_stress_tests" ON stress_tests;
CREATE POLICY "anon_select_stress_tests" ON stress_tests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_stress_tests" ON stress_tests;
CREATE POLICY "anon_insert_stress_tests" ON stress_tests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_stress_tests" ON stress_tests;
CREATE POLICY "anon_update_stress_tests" ON stress_tests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_stress_tests" ON stress_tests;
CREATE POLICY "anon_delete_stress_tests" ON stress_tests FOR DELETE TO anon, authenticated USING (true);

-- ROTATION BATCHES
CREATE TABLE IF NOT EXISTS rotation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number integer NOT NULL,
  active_bots integer NOT NULL DEFAULT 500,
  total_bots integer NOT NULL DEFAULT 50000,
  faction_id text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  window_end timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rotation_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_rotation" ON rotation_batches;
CREATE POLICY "anon_select_rotation" ON rotation_batches FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_rotation" ON rotation_batches;
CREATE POLICY "anon_insert_rotation" ON rotation_batches FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_rotation" ON rotation_batches;
CREATE POLICY "anon_update_rotation" ON rotation_batches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_rotation" ON rotation_batches;
CREATE POLICY "anon_delete_rotation" ON rotation_batches FOR DELETE TO anon, authenticated USING (true);

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  entity_type text,
  entity_id text,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_audit" ON audit_log;
CREATE POLICY "anon_select_audit" ON audit_log FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_audit" ON audit_log;
CREATE POLICY "anon_insert_audit" ON audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_audit" ON audit_log;
CREATE POLICY "anon_update_audit" ON audit_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_audit" ON audit_log;
CREATE POLICY "anon_delete_audit" ON audit_log FOR DELETE TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);