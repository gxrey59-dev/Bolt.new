-- Consolidate redundant permissive SELECT policies on dashboard telemetry tables.
-- The 2026-11-07 telemetry migration added public USING (true) read policies to
-- tables that already had an operator-only owner_read SELECT policy. The public
-- policy is a strict superset, so the operator-only one is dead weight that the
-- row-level-security planner still evaluates for every authenticated scan
-- (these tables are read by the trading engine on every 30s cron tick).

DROP POLICY IF EXISTS "owner_read" ON public.paper_trades;
DROP POLICY IF EXISTS "owner_read" ON public.audit_log;
DROP POLICY IF EXISTS "owner_read" ON public.factions;
DROP POLICY IF EXISTS "owner_read" ON public.market_data;
DROP POLICY IF EXISTS "owner_read" ON public.signals;
DROP POLICY IF EXISTS "owner_read" ON public.circuit_breakers;
DROP POLICY IF EXISTS "owner_read" ON public.defi_swarm_agents;
DROP POLICY IF EXISTS "owner_read" ON public.defi_swarms;
DROP POLICY IF EXISTS "owner_read" ON public.revenue_streams;
DROP POLICY IF EXISTS "owner_read" ON public.sweeps;
DROP POLICY IF EXISTS "owner_read" ON public.sentiment;
DROP POLICY IF EXISTS "owner_read" ON public.nft_collection;

-- public_telemetry_signals is also a subset of public_read_signals (USING true).
DROP POLICY IF EXISTS "public_telemetry_signals" ON public.signals;

-- Cover the foreign keys flagged by the performance advisor. Both columns are
-- join and cascade paths; without an index every delete or join on the parent
-- does a sequential scan of the child table.
CREATE INDEX IF NOT EXISTS idx_defi_cashflows_job_id
  ON public.defi_cashflows (job_id);

CREATE INDEX IF NOT EXISTS idx_defi_swarm_agents_swarm_id
  ON public.defi_swarm_agents (swarm_id);
