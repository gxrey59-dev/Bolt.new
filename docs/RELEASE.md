# Revenue operations release

## Scope

- New responsive overview with independently refreshed position records, scanner activity, trading mode, and operator access.
- Actual exchange balances/open orders, discovered held/configured/traded pairs, bounded history batches, and closed-without-sell reconciliation candidates.
- Confirmed execution receipts, durable per-symbol entry claims with stable exchange client IDs, and per-trade compare-and-set claims before live exit submission. Failed or ambiguous exits remain open and require review.
- Missing quotes and failed reads display unavailable values. Partial realized proceeds are excluded from unrealized totals. Incomplete FIFO cost/fee accounting is excluded from reported realized subtotals.
- Verified revenue requires `accounting_verified=true`. Older book snapshots, transfers, planning targets, and verified trading P&L remain separately labeled.
- Transactional payment reservation/fulfillment, duplicate-event handling, persisted-before-ack webhooks, approved checkout redirects, and billing management.
- Sign-in lifecycle handling, clear access errors, browser navigation, automated tests and CI.

## Rollout order

1. Review the PR and migration `supabase/migrations/20261111185410_revenue_reliability.sql`. Test the migration against an isolated copy of the schema. It adds missing trade-verification columns without marking historical trades verified, service-role-only payment RPCs, and a billing-review table. The local PostgreSQL tests exercise this same migration.
2. Also review and test `20261111190059_subscription_checkout_claims.sql` and `20261111190113_live_entry_claims.sql`. Apply all three reviewed migrations in order to the intended project. No production SQL was applied during development.
3. Complete Stripe sandbox verification and configuration in [PAYMENTS_RELEASE.md](PAYMENTS_RELEASE.md). The collection feature records digital reservations; blockchain minting/delivery is not implemented.
4. Deploy the matching `binance-feed`, `binance-account`, `stripe-checkout`, `stripe-subscription-checkout`, and `stripe-webhook` functions, including relative helpers. Preserve each function's authentication configuration. The frontend now requires `/binance-account/overview` and explicit symbol batches for `/orders`; the daily report requires completeness metadata from `/sprint-data`.
5. Build the frontend with the correct public Supabase key and base path. Publish only after backend compatibility is verified. Configure approved checkout URLs for the actual Bolt/custom/GitHub Pages host.
6. Sign in as an authorized operator and inspect exchange balances, open orders, and reconciliation candidates. Check the historical AXS record against actual fills; never re-open or re-sell a record solely because its sell-order ID is missing.

## Evidence and remaining limits

Local checks cover frontend types/lint/build, pure financial calculations, PostgreSQL payment transactions, and mocked desktop/mobile browser flows. Deno checks the modified Edge Function entry points. These checks do not place trades, charge customers, or mutate the live database.

Validation completed on 2026-11-11: clean `npm ci`; `npm run check` (all nine test files passed); Deno 2.9.6 typechecks for all five changed handlers; mocked Chromium overview at 1440px and 390px, authenticated execution reconciliation, and trading failure flows. No browser page errors were observed. CI repeats the build, code, transaction, and backend type checks.

Live operator account verification, Stripe end-to-end sandbox checkout/webhook delivery, historical inventory/position reconciliation, and production deployment remain release steps. No claim of guaranteed revenue follows from these changes. Faction aggregate counters still use separate read/modify/write updates and are not a transactional financial ledger; use exchange fills and reconciled trade records as the source of truth.

Exchange execution and database persistence cannot be one transaction. Durable entry and exit claims block duplicate submissions; a lost tracking response never triggers a blind compensating sale; a crash or ambiguous exchange response leaves a reconciliation marker for operator review. This release does not change trading limits, strategy selection, withdrawal settings, or activate DeFi workers.

The security advisor also reports leaked-password protection disabled in the live Supabase Auth configuration. Review [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before a public signup campaign. Existing service-only RLS tables intentionally remain inaccessible to public clients.

## Rollback

Keep frontend and `binance-account` versions paired. A rollback must not clear reconciliation markers or invent exchange fills. The additive schema may remain in place. Preserve paid reservation/order records and review webhook retry failures before reverting payment handlers; replay only through idempotent fulfillment. Do not roll back by deleting customer or trade records.
