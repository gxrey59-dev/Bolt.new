# Payment reliability release

This branch prepares payment changes; it does not deploy them or change live billing.

## Required rollout order

1. Review and test `supabase/migrations/20261111195055_revenue_reliability.sql` and `supabase/migrations/20261111195226_subscription_checkout_claims.sql` in an isolated project, then apply both before deploying the revised Stripe functions. It adds service-role-only transactional reservation and fulfillment RPCs plus a billing review queue. No customer data is deleted or repriced.
2. Deploy `stripe-checkout`, `stripe-subscription-checkout`, and `stripe-webhook` together. Each folder carries its own copy of `policy.ts` because functions deploy independently; keep the three copies identical. The SDK is pinned to `stripe@23.0.0` with API version `2026-09-30.endive`; verify that version and its webhook object schema in the Stripe sandbox first.
3. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (a suitably scoped restricted key where supported), and `STRIPE_WEBHOOK_SECRET` as function secrets. Never put secret keys in Vite variables. `CHECKOUT_ALLOWED_URLS` is a comma-separated list of full approved app base URLs; its default is `https://gxrey59-dev.github.io/Bolt.new/`. Add the actual Bolt preview/custom domain explicitly for those checkouts to work.
4. Configure Stripe Customer Portal for subscription cancellation/payment updates. Subscribe the webhook to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `charge.dispute.created`, `charge.refunded`, and `radar.early_fraud_warning.created`. The webhook verifies signatures itself and must be reachable by Stripe without requiring a Supabase user JWT.
5. In the sandbox, complete card and delayed-payment checkouts; replay events; force a database error and verify Stripe receives a 500 then succeeds on retry; cancel a subscription and verify the app's entitlement ends at the recorded time. Verify Customer Portal and redirect paths on the published host.

## Changes

- Webhooks acknowledge only persisted work; unpaid checkout completion cannot grant a purchase.
- Inventory reservation uses a row lock before creating checkout. Fulfillment atomically records the sale/order and increments supply once, including duplicate deliveries.
- Server-owned price, currency, item and payment references must match before fulfillment.
- Missing subscriptions are cleared without dereferencing a missing record; current Stripe subscription item billing periods are synced.
- Redirects are restricted to configured app base URLs. Subscription checkout checks existing contracts; users can manage billing through Stripe's hosted portal.
- Returning from Checkout displays pending verification, not an invented payment success. Collection purchases are described as digital reservations: this repository has no blockchain mint or wallet delivery implementation.
- Refund/dispute/fraud events are recorded idempotently in `billing_review_events` for operator review; they do not automatically cancel contracts or issue refunds.

## Before launch

- Reconcile historical `nft_sales` and `minted_count`; previous duplicate webhooks may already have incremented inventory more than once. This change deliberately does not guess historical fulfillment.
- Inspect old pending reservations. Stock is released only on verified expiry/payment failure. Do not delete a reservation based on its age: delayed payments may remain payable. A failed/ambiguous Stripe create request can leave a reservation awaiting manual reconciliation.
- Add checkout abuse/rate limits and alerts for the billing review queue before a public campaign. Concurrent subscription sessions reuse one durable attempt and Stripe idempotency key; verify this across browser tabs in the Stripe sandbox. Ambiguous attempts remain held until reconciled.
- Confirm actual premium signal delivery and customer support/refund terms before taking subscriptions. Configure sales tax registrations and Stripe Tax as applicable; automatic tax has not been enabled by this change.
- Collection checkout records purchases and receipts only. On-chain issuance, token ownership and wallet delivery remain a separate release requirement if selling the product as an NFT.

## Local checks

`node --experimental-strip-types tests/payment-policy.test.mjs`

`node tests/payment-transaction.test.mjs`

The second suite uses PGlite (PostgreSQL in-process) and checks reservation exhaustion, price mismatch, duplicate fulfillment, session mismatch, RPC grants, risk-event idempotency, and transaction rollback after a failed order insert. It does not send Stripe requests or touch the live Supabase database.
