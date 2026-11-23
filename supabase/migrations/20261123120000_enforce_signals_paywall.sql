/*
# Enforce the Signals Pro paywall

`public_read_signals` (20261107152000) grants SELECT on every row with
USING (true). The later `subscriber_premium_signals` policy meant to limit
`whale` / `smart_money` rows to paying subscribers, but permissive policies
are OR-ed, so the unrestricted policy let anyone read premium rows.

1. Replace `public_read_signals` with a policy that shows every signal type
   except the premium ones. Today's public feed (buy, sell, arbitrage,
   liquidation, bridge, stake, unstake) is unchanged.
2. Keep `subscriber_premium_signals` (active subscribers see premium rows).
3. Add `operator_read_premium_signals` so operators keep full visibility.

No data is modified. The service role bypasses RLS, so the trading engine and
edge functions are unaffected.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.proname = 'is_app_operator' AND n.nspname = 'public') THEN
    RAISE EXCEPTION 'public.is_app_operator() is missing; refusing to change signal access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE p.proname = 'has_active_signal_subscription' AND n.nspname = 'public') THEN
    RAISE EXCEPTION 'public.has_active_signal_subscription() is missing; refusing to change signal access';
  END IF;
END $$;

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_signals" ON public.signals;
DROP POLICY IF EXISTS "public_telemetry_signals" ON public.signals;
CREATE POLICY "public_read_signals" ON public.signals FOR SELECT
  TO anon, authenticated
  USING (signal_type NOT IN ('whale', 'smart_money'));

DROP POLICY IF EXISTS "subscriber_premium_signals" ON public.signals;
CREATE POLICY "subscriber_premium_signals" ON public.signals FOR SELECT
  TO authenticated
  USING (signal_type IN ('whale', 'smart_money') AND (SELECT public.has_active_signal_subscription()));

DROP POLICY IF EXISTS "operator_read_premium_signals" ON public.signals;
CREATE POLICY "operator_read_premium_signals" ON public.signals FOR SELECT
  TO authenticated
  USING (signal_type IN ('whale', 'smart_money') AND (SELECT public.is_app_operator()));
