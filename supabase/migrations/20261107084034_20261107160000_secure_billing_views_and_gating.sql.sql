/*
# Secure billing views + signal subscriber gating

1. Security changes
- Revoke all privileges on the `stripe_user_orders` and `stripe_user_subscriptions`
  views from `anon` and `authenticated`. These are read-only owner-scoped views;
  only SELECT will be granted, and only to `authenticated`.
- Grant SELECT on both views to `authenticated` only. Anonymous visitors have no
  billing data, so `anon` gets nothing.
- Create `has_active_signal_subscription()` SECURITY DEFINER function: returns true
  only when the caller (via stripe_customers -> stripe_subscriptions) has a
  Stripe subscription whose status is one of the paying statuses and whose
  current period has not ended. Locked search_path. EXECUTE revoked from PUBLIC/anon,
  granted to authenticated. Used by RLS to gate premium signal rows.
- Enable RLS on `signals` (table previously world-readable to `anon`) and add:
  - SELECT policy for `anon, authenticated`: public signal types
    (`signal_type IN ('entry','exit')`) are visible to everyone, as before.
  - SELECT policy for `authenticated`: signed-in subscribers additionally see
    premium types (`'whale'`, `'smart_money'`) when
    `has_active_signal_subscription()` is true.
- Grant SELECT on `signals` to `anon, authenticated` explicitly (was implicit before).

2. Important notes
- The subscription gate is enforced in the database, not the frontend: a paying
  subscriber is whoever Stripe's webhook recorded an active subscription for.
- If the Stripe price tier changes later, the status list is the single knob.
- No data is modified; this migration only tightens access.
*/

REVOKE ALL ON stripe_user_orders FROM anon, authenticated;
REVOKE ALL ON stripe_user_subscriptions FROM anon, authenticated;

GRANT SELECT ON stripe_user_orders TO authenticated;
GRANT SELECT ON stripe_user_subscriptions TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_signal_subscription()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM stripe_subscriptions s
    JOIN stripe_customers c ON c.customer_id = s.customer_id
    WHERE c.user_id = auth.uid()
      AND c.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND s.status IN ('active', 'trialing', 'past_due')
      AND to_timestamp(s.current_period_end) > now()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_active_signal_subscription() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_signal_subscription() TO authenticated;

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_telemetry_signals" ON signals;
CREATE POLICY "public_telemetry_signals"
ON signals FOR SELECT
TO anon, authenticated
USING (signal_type IN ('entry', 'exit'));

DROP POLICY IF EXISTS "subscriber_premium_signals" ON signals;
CREATE POLICY "subscriber_premium_signals"
ON signals FOR SELECT
TO authenticated
USING (
  signal_type IN ('whale', 'smart_money')
  AND public.has_active_signal_subscription()
);

GRANT SELECT ON signals TO anon, authenticated;
