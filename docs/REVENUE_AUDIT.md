# Revenue audit — 2026-11-23

I checked the repository against the live `bolt-native-database` project using read-only queries. Nothing was written to the live database or to Stripe.

## Where revenue stands

| Metric | Live value |
| --- | --- |
| Signals Pro subscriptions | 0 |
| Completed collection sales / Stripe orders | 0 / 0 |
| Collection inventory sold | 0 of 3,200 |
| Pending reservations | 2 ($0.50 each, from 2026-11-07) |
| Premium (`whale` / `smart_money`) signal rows | 0 |

## Findings

1. **Signals Pro paywall was open (fixed in code).** `public_read_signals USING (true)` is still live next to `subscriber_premium_signals`. Postgres combines permissive policies with OR, so anyone could read premium rows. The fix is `20261123120000_enforce_signals_paywall.sql`, tested in `tests/signals-paywall.test.mjs`.
2. **Most of the collection could not be bought.** Prices are 0.15, 0.30 and 0.50, and checkout charges them as USD. Stripe refuses USD charges under $0.50, so 8 of the 9 items failed at checkout. Even at full sell-out the collection grosses about $455, and Stripe fees take most of that.
3. **Failed checkouts leaked stock (fixed in code).** The checkout function marked the session as created before calling Stripe. When Stripe refused the request, the reservation stayed pending forever and that unit was lost. Now a definitive Stripe refusal releases the reservation, and prices under $0.50 are refused before any stock is reserved. The UI shows "Coming soon" for those items instead of a buy button that cannot work.
4. **The webhook appears not to be receiving events.** Two reservations from 2026-11-07 have Checkout sessions that expired more than two weeks ago, yet they are still pending. A working `checkout.session.expired` delivery would have cancelled them. Check in the Stripe Dashboard that the endpoint, its event list and the signing secret are set up. Until this works, a real payment would never be fulfilled.
5. **Signals Pro sells a feed that is empty.** Nothing in the codebase produces `whale` or `smart_money` signals. `binance-feed` only emits `buy` and `sell`. Taking $29/mo for an empty feed invites refunds and chargebacks.
6. **The collection uses real artists' names.** Items are named after Wu-Tang Clan members and $uicideboy$. Selling them without a license carries right-of-publicity and trademark risk. Get a license or rename them before you sell.

## Owner decisions, in priority order

1. Apply the paywall migration, then deploy `stripe-checkout` together with the frontend.
2. Fix webhook delivery and test it with the Stripe CLI (`stripe trigger checkout.session.expired`). Then cancel or reconcile the two stale reservations.
3. Either build the premium signal producer or pause Signals Pro sales.
4. Reprice the collection in real USD, at $5 or more so Stripe fees don't eat the margin, and clear up licensing or rename the items.
5. Once there is real content and traffic, add an annual plan, `allow_promotion_codes`, and Stripe Tax.
