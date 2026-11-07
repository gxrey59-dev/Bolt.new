/*
# Tighten money-path table grants and mint function access

1. Summary
   Extra security for every place the app earns or moves money. This migration
   removes permissions that regular users and anonymous visitors never needed.
   No data is changed; only access rights are narrowed.

2. Functions
   - `increment_nft_minted_count(uuid)`: EXECUTE revoked from `authenticated`.
     This SECURITY DEFINER function is the payment webhook's oversell guard.
     It was callable by any signed-in user, who could inflate sold counts and
     freeze sales. Only the server's internal `service_role` may call it now.
     The public's default EXECUTE grant was already revoked in an earlier
     migration; this completes that for signed-in users too.

3. Tables (grants only; row level security and policies unchanged)
   - `nft_sales`: anonymous visitors lose every privilege (they could never
     act on rows — the only policy is buyer-scoped SELECT for signed-in users
     — but the grants themselves were indefensible). Signed-in users keep
     SELECT only, which is what the buyer purchase-history view needs. The
     Stripe webhook writes through `service_role`, which is untouched.
   - `profit_snapshots`: anonymous and signed-in users keep SELECT only (the
     public revenue chart needs it); all write privileges are revoked. The
     snapshot-writing cron job runs as `service_role`, which is untouched.

4. Deliberately unchanged
   - `nft_collection` and `withdrawal_config` keep their write grants for
     signed-in users because the writes are already gated by an
     `is_app_operator()` policy — only operators pass that check.
   - `revenue_streams` already grants SELECT only.
   - Tables with RLS enabled but no grants (app_operators, defi_swarm_* and
     friends) are unreachable by clients by design; edge functions use
     `service_role`.

5. Notes
   - Idempotent: re-running produces the same end state.
*/

REVOKE EXECUTE ON FUNCTION increment_nft_minted_count(uuid) FROM authenticated;

REVOKE ALL ON nft_sales FROM anon;
REVOKE ALL ON nft_sales FROM authenticated;
GRANT SELECT ON nft_sales TO authenticated;

REVOKE ALL ON profit_snapshots FROM anon;
REVOKE ALL ON profit_snapshots FROM authenticated;
GRANT SELECT ON profit_snapshots TO anon, authenticated;
