/*
# Restore public read access to dashboard telemetry tables

1. Problem
   - The 2026-11-07 security tightening revoked the anon role's privileges on nearly every table.
   - The public dashboard pages read some tables directly with the anon key:
     profit history, revenue streams, NFT collection, live trade history, sentiment, breakers.
   - With privileges revoked, those queries fail with "permission denied" and the page appears broken.

2. What this migration does (read-only)
   - Re-grants SELECT (read-only) to anon + authenticated on the tables the public pages read.
   - Adds SELECT policies (TO anon, authenticated, USING (true)) where only operator-only
     policies existed, so the anon role can actually read rows.
   - Writes stay operator-only everywhere: no INSERT/UPDATE/DELETE grants added for anon.

3. Tables re-opened for public read-only access
   - paper_trades, revenue_streams, sentiment, circuit_breakers, nft_collection,
     sweeps, signals, audit_log, factions, market_data

4. Security notes
   - All mutation paths (scan, withdraw, config) go through edge functions that validate
     operator identity server-side; this migration only restores read visibility.
*/

-- ── grants: read-only, both roles ─────────────────────────────────────
GRANT SELECT ON paper_trades, revenue_streams, sentiment, circuit_breakers,
  nft_collection, sweeps, signals, audit_log, factions, market_data
TO anon, authenticated;

-- ── policies: anon + authenticated read, writes unchanged ─────────────
DROP POLICY IF EXISTS "public_read_paper_trades" ON paper_trades;
CREATE POLICY "public_read_paper_trades" ON paper_trades FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_revenue_streams" ON revenue_streams;
CREATE POLICY "public_read_revenue_streams" ON revenue_streams FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_sentiment" ON sentiment;
CREATE POLICY "public_read_sentiment" ON sentiment FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_circuit_breakers" ON circuit_breakers;
CREATE POLICY "public_read_circuit_breakers" ON circuit_breakers FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_nft_collection" ON nft_collection;
CREATE POLICY "public_read_nft_collection" ON nft_collection FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_sweeps" ON sweeps;
CREATE POLICY "public_read_sweeps" ON sweeps FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_signals" ON signals;
CREATE POLICY "public_read_signals" ON signals FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_audit_log" ON audit_log;
CREATE POLICY "public_read_audit_log" ON audit_log FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_factions" ON factions;
CREATE POLICY "public_read_factions" ON factions FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_market_data" ON market_data;
CREATE POLICY "public_read_market_data" ON market_data FOR SELECT
  TO anon, authenticated USING (true);
