/*
# Remove TRUNCATE from anonymous and signed-in roles on Stripe tables

1. Problem
- The stripe_customers, stripe_orders and stripe_subscriptions tables grant TRUNCATE to the anonymous and signed-in roles.
- TRUNCATE ignores row level security, so those roles could empty the tables without any policy check.

2. Changes
- Revoke TRUNCATE on the three Stripe tables from anon and authenticated.

3. Unchanged
- Row level security, existing read policies, and the service role used by payment webhooks are not changed.

4. Notes
- Remaining write grants (INSERT, UPDATE, DELETE) are still present but are blocked by row level security, since no write policies exist. They are left for a later cleanup.
*/

REVOKE TRUNCATE ON stripe_customers, stripe_orders, stripe_subscriptions FROM anon, authenticated;
