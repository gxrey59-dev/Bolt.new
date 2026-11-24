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

## Trading engine audit — 2026-11-24 (read-only)

I checked the live state, the code and the scheduled jobs.

**State.** The engine is in paper mode with the kill switch off. Live capital is $27.80. From Sep 15 to Nov 19 it made 205 live trades: net −$0.54 on about $1,070 traded, 96 wins and 99 losses. Paper trading since Nov 12: 18 trades, +$1.32. None of the 224 trades has verified accounting.

**Safe.**
- Live mode is spot-only. A short signal only exits a long you already hold.
- Entries are claimed in the database before any order is sent, and ambiguous exchange errors keep the claim instead of retrying.
- Limits hold: 1 live position per pair, a 4-hour cooldown after each exit, the BTC trend filter, at most 3 open positions per faction, and a 10% daily-loss kill switch.
- Every control route requires an operator sign-in, and `/scan` requires the cron secret.
- Withdrawals are disarmed. Binance answered the last attempt with 401, so the API key has no withdrawal permission. No funds have ever been withdrawn; the 160,000 USDC row is a failed simulation record.

**Issues.**
1. **The SEIUSDT position is stuck "open".** Its close filled 137.1 of 137.2, leaving 0.1 SEI of dust. Every 30-second scan logged a refused close: 8,631 `audit_log` rows in 72 hours. No order was sent. Fixed in code by skipping trades flagged for reconciliation in the scan loop. The trade still needs manual reconciliation, and until then it blocks SEI entries.
2. **Positions are larger than configured.** `max_position_pct` is 10%, but the $6.05 exchange floor makes each live trade about 22% of a $27.80 balance.
3. **The `/transfer` endpoint accepts any destination address** from a signed-in operator. Turn on Binance.US address whitelisting, and keep the API key without withdrawal permission.
4. **Storage is growing.** `signals` is 712 MB with about 940k rows and `audit_log` is 70 MB, both growing every 30 seconds. Check your Supabase plan's disk limit, and add a retention job.
5. **The strategy has no edge yet.** It was break-even after fees over 205 live trades. Stay in paper mode until it shows a positive result over a meaningful sample.

## Paper mode audit — 2026-11-24

**Paper results were too optimistic.**
- Paper P&L was booked before fees; only live trades paid them.
- 14 of the 18 paper trades were shorts, which live spot trading can never take.
- Paper's +$1.32 therefore said nothing about live results. The live record is the honest one: 201 long trades at −0.08% per dollar traded.

**Fixed in code (`paper-parity.ts`, not yet deployed):**
- Paper trades now pay the same fees as live, plus an estimated 0.05% slippage per side (`PAPER_SLIPPAGE_RATE`).
- Paper is spot-only like live: short signals only exit longs.
- `GET /binance-feed/config` returns `liveReadiness`, which judges paper trades closed after `PAPER_PARITY_SINCE` (2026-11-24). They must clear four bars: at least 200 trades, profit factor ≥ 1.3, net return ≥ 0.15% per trade, and max drawdown ≤ 15% of capital. Older paper trades are excluded because they followed the old rules.

**What this means.** No strategy wins forever: markets change, and an edge decays. The readiness gate makes the go-live decision rest on evidence, not hope. Re-check it after a regime change, and drop back to paper if live results fall below the bars.

## Live-readiness verdict — 2026-11-24: NOT READY

**Method.** I backtested 3,000 hours of real Binance.US hourly candles (2026-07-21 to 2026-11-23) across the six enabled pairs.
- **Signal logic:** a PL/pgSQL port of the live engine's `calculateAllIndicators` + `analyzeConfluence` + `evaluateStrategies`. It matches the TypeScript bar for bar: identical MD5 fingerprints over 301 synthetic bars, 11 signals included.
- **Rules:** the live rules: longs only, BTC regime filter, 2% stop and 4% target, breakeven at +1.5%, 2% trailing stop from +3%, 24h max hold, bearish exit, 4h cooldown, $6.05 orders.
- **Fills:** at the next bar's open, so no look-ahead.

**Results.**

| Scenario | Trades | Net | Win % | Profit factor | Return per trade |
|---|---|---|---|---|---|
| Pessimistic (stop first, fee + slippage) | 62 | −$3.43 | 24.2% | 0.50 | −0.91% |
| Target first, fees only | 62 | −$3.05 | 24.2% | 0.53 | −0.81% |
| Target first, **no fees** | 62 | −$2.31 | 25.8% | 0.61 | −0.62% |
| No BTC filter | 93 | −$4.09 | 24.7% | 0.57 | −0.73% |

- Losses appear in every third of the period: −$1.77, −$1.01 and −$0.65.
- 42 of 62 exits were stops (−$6.37), against 11 targets (+$3.15).
- Only IMX was net positive (+$0.49).

**Verdict.** It fails every readiness bar. Because it loses even with zero costs, the entry signal has a negative edge: it buys after confluence has already formed, then gets stopped out on mean reversion. Changing parameters or costs will not fix it. It needs a different entry thesis, tested the same way before any live capital.

**Caveat.** The backtest makes fewer trades than live did (29 against 205 in the live window). Live re-evaluates every 30s against the ticker, and its pair list and rules changed over time. Both are clearly negative.

## New entry signals — backtest, 2026-11-24: none passes

**Method.** I committed to the method before seeing any results.
- Data: 4h Binance.US candles from 2025-07 to 2026-11, six pairs. That is a deep bear market: buy-and-hold lost 64.5% per coin in training and 17.7% in testing.
- Three theses with fixed parameters, all gated by the BTC 4h SMA50 regime filter.
- Costs: 0.15% per side. Orders: $6.05. Fills at the next open.
- Split: choose the winner on the first two-thirds (train), then judge it only on the last third (test).

| Strategy | Rule | Train | Test |
|---|---|---|---|
| A. Dip in uptrend | close > SMA100, RSI14 < 35. Exit at RSI > 55, after 48h, or on a 2×ATR stop | 46 trades, PF 2.66, +2.21%/trade | 34 trades, PF 0.83, −0.27%/trade |
| B. Breakout | close > 30-bar high. 3×ATR chandelier stop, 10-day max hold | 117 trades, PF 0.50 | 62 trades, PF 1.15, +0.35%/trade |
| C. Trend | close > rising SMA50. Exit below SMA50, 3×ATR stop | 212 trades, PF 0.35 | 96 trades, PF 0.78 |

**Verdict.**
- **A** won training and then failed on unseen data. It is regime-dependent, and its training edge did not survive.
- **B** lost in training. Its positive test result is not enough to select it: picking it after seeing the test would be hindsight, and PF 1.15 on 62 trades is below the bar anyway.
- **C** lost in both periods.
- No strategy clears readiness. Every strategy beat buy-and-hold by a wide margin, though, because the regime filter kept them in cash during the bear market.

**Next.** Do not tune these parameters against this data: that only fits noise. If you continue, forward-test A in paper mode as a pre-registered strategy and judge it only on new trades. Expect little: with $27.80 of capital and $6 orders, even a strong edge earns cents to a few dollars a month.
