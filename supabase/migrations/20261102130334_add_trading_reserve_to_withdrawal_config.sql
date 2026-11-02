/*
# Add trading reserve to automatic withdrawal

1. Modified Tables
- `withdrawal_config`
  - `trading_reserve_usdt` (numeric, not null, default 10): USDT the automatic profit harvest always leaves in the
    Binance account so the trading bots can keep opening trades. The harvest only withdraws USDT above the larger of
    this value and `min_threshold`.

2. Security
- No policy or grant changes; existing access to `withdrawal_config` applies to the new column.

3. Important Notes
1. A live trade needs roughly 7.60 USDT of free balance (6.05 USDT minimum order size, capped at 80% of balance),
   so 10 USDT leaves room for one trade plus fees.
2. Existing row keeps all other settings unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'withdrawal_config' AND column_name = 'trading_reserve_usdt'
  ) THEN
    ALTER TABLE withdrawal_config ADD COLUMN trading_reserve_usdt numeric NOT NULL DEFAULT 10;
  END IF;
END $$;
