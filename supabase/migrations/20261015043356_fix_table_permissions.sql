-- Fix: grant anon role access to tables throwing 401 errors
GRANT SELECT ON public.sentiment TO anon, authenticated;
GRANT SELECT ON public.circuit_breakers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defi_swarms TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defi_swarm_agents TO anon, authenticated;
GRANT SELECT ON public.defi_positions TO anon, authenticated;
GRANT SELECT ON public.defi_snapshots TO anon, authenticated;
GRANT SELECT ON public.defi_cashflows TO anon, authenticated;
GRANT SELECT ON public.defi_jobs TO anon, authenticated;
GRANT SELECT ON public.defi_worker_status TO anon, authenticated;
GRANT SELECT ON public.defi_yield_intervals TO anon, authenticated;
