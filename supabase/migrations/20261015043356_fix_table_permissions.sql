-- Fix: grant anon role access to tables throwing 401 errors
GRANT SELECT ON public.sentiment TO anon, authenticated;
GRANT SELECT ON public.circuit_breakers TO anon, authenticated;
GRANT SELECT ON public.defi_swarms TO anon, authenticated;
GRANT SELECT ON public.defi_swarm_agents TO anon, authenticated;
