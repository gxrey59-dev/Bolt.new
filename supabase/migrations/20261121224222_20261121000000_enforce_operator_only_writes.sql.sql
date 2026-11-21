/*
# Enforce operator-only writes across the trading schema

1. Problem
- The early migrations create INSERT/UPDATE/DELETE policies with `USING (true)` /
  `WITH CHECK (true)` for the anon and authenticated roles on the trading
  tables. Hardening applied to the live database over time never made it into
  the repo, so rebuilding the project from migrations would recreate those
  open write policies on money-moving tables (faction balances, strategy
  config, withdrawal config, open trades).

2. Changes
- Drop every policy named like `anon_insert_%`, `anon_update_%`,
  `anon_delete_%` — those are the permissive write policies from the early
  migrations.
- Drop any remaining INSERT/UPDATE/DELETE/ALL policy that does not check
  `is_app_operator()`.
- Recreate operator-gated write policies (INSERT/UPDATE/DELETE, TO
  authenticated, USING/WITH CHECK `is_app_operator()`) on every table that
  has browser-side write grants.
- Revoke leftover write grants from anon/authenticated on the Stripe tables —
  they have no write policies, so the grants are dead surface area.
- Revoke write grants on the `verified_live_factions` view.

3. Security
- Every write path through the Data API now requires the operator check.
- Public telemetry reads are unchanged.

4. Notes
- Refuses to run if `public.is_app_operator()` is missing, because that would
  silently lock every role out of writes.
- Idempotent: safe to run twice.
- Edge functions use the service role, which bypasses RLS; they are unaffected.
*/

DO $$
DECLARE
  t text;
  pol record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.proname = 'is_app_operator' AND n.nspname = 'public') THEN
    RAISE EXCEPTION 'public.is_app_operator() is missing; refusing to restrict writes';
  END IF;

  -- 1. Drop the permissive anon write policies from the early migrations.
  FOR pol IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname ~ '^anon_(insert|update|delete)_'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;

  -- 2. Drop any remaining non-SELECT policy that does not require the operator.
  FOR pol IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (qual IS NULL OR qual NOT LIKE '%is_app_operator()%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;

  -- 3. Recreate operator-gated write policies where browser-side write grants exist.
  FOR t IN
    SELECT table_name::text FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = t
        AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS "operator_write" ON %I', t);
      EXECUTE format('CREATE POLICY "operator_write" ON %I FOR INSERT TO authenticated WITH CHECK (is_app_operator())', t);
      EXECUTE format('CREATE POLICY "operator_update" ON %I FOR UPDATE TO authenticated USING (is_app_operator()) WITH CHECK (is_app_operator())', t);
      EXECUTE format('CREATE POLICY "operator_delete" ON %I FOR DELETE TO authenticated USING (is_app_operator())', t);
    END IF;
  END LOOP;

  -- 4. Revoke dead write grants on the Stripe tables (webhooks use the service role).
  REVOKE INSERT, UPDATE, DELETE ON stripe_customers, stripe_orders, stripe_subscriptions FROM anon, authenticated;

  -- 5. The verified_live_factions view must be read-only to browsers.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON verified_live_factions FROM anon, authenticated;
END $$;
