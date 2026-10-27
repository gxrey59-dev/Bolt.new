/*
# Fix DeFi Swarm read access and protect metrics

1. Purpose
- Keep DeFi Swarm monitoring publicly readable by the no-sign-in dashboard.
- Prevent browser clients from inserting, editing, or deleting swarm and agent records.

2. Modified Tables
- `defi_swarms`
  - Retains read access for dashboard viewers.
  - Removes INSERT, UPDATE, and DELETE privileges from `anon` and `authenticated`.
- `defi_swarm_agents`
  - Retains read access for dashboard viewers.
  - Removes INSERT, UPDATE, and DELETE privileges from `anon` and `authenticated`.

3. Security
- Adds explicit public read policies because RLS was enabled but anonymous SELECT had no matching policy.
- Server-side `service_role` access remains available for trusted data refreshes.
- No user accounts or ownership columns are introduced; these are intentionally shared monitoring tables.

4. Important Notes
- The dashboard only reads these tables directly, so no user-facing feature loses legitimate write functionality.
- Values such as TVL, APY, and yield can now only be changed by trusted server-side processes.
*/

REVOKE INSERT, UPDATE, DELETE ON public.defi_swarms FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.defi_swarm_agents FROM anon, authenticated;
GRANT SELECT ON public.defi_swarms TO anon, authenticated;
GRANT SELECT ON public.defi_swarm_agents TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_swarms" ON public.defi_swarms;
CREATE POLICY "public_read_swarms"
ON public.defi_swarms FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public_read_agents" ON public.defi_swarm_agents;
CREATE POLICY "public_read_agents"
ON public.defi_swarm_agents FOR SELECT
TO anon, authenticated
USING (true);