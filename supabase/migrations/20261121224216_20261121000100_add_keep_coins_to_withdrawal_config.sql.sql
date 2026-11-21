/*
# Add keep_coins protected list to withdrawal_config

1. Problem
- The manual collect route and the harvest cron market-sell every non-USDT
  coin in the exchange account before withdrawing. Coins the operator wants
  to hold long-term (e.g. BTC, ETH) would be sold on every sweep.

2. Changes
- `withdrawal_config`: add `keep_coins text[] NOT NULL DEFAULT '{}'` — an
  operator-maintained list of coin symbols (e.g. ARRAY['BTC','ETH']) that
  the sweep and harvest paths must never sell.

3. Security
- No policy or grant changes; existing access to `withdrawal_config` applies
  to the new column (authenticated writes are operator-gated, public reads).

4. Notes
- Empty by default, so behaviour is unchanged until the operator sets it.
- Idempotent: safe to run twice.
*/

ALTER TABLE withdrawal_config ADD COLUMN IF NOT EXISTS keep_coins text[] NOT NULL DEFAULT '{}';
