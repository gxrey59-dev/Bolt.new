/*
# Add Kill Switch and Live Trading Support

1. Modified Tables
- `strategy_config`: Add kill switch columns and live trading config
  - `kill_switch` (boolean, default false) — when true, ALL trading halts immediately
  - `kill_switch_reason` (text, nullable) — why the switch was tripped
  - `kill_switch_tripped_at` (timestamptz, nullable) — when it was tripped
  - `max_daily_loss_pct` (numeric, default 10) — max % of capital lost in one day before auto-trip
  - `min_win_rate_threshold` (numeric, default 90) — only strategies with >= this win rate can trade
  - `live_capital` (numeric, default 5) — actual USD allocated for live trading
  - `daily_loss_accumulator` (numeric, default 0) — tracks cumulative loss for the day
  - `daily_loss_reset_at` (timestamptz, nullable) — when the accumulator last reset

- `paper_trades`: Add live trading tracking
  - `is_live` (boolean, default false) — true if this is a real Binance order
  - `binance_order_id` (text, nullable) — the actual exchange order ID
  - `binance_close_order_id` (text, nullable) — the exchange close order ID

2. Security
- No new tables. Existing RLS policies on strategy_config and paper_trades remain unchanged.
- The anon role already has full CRUD on both tables (single-tenant, no auth).

3. Notes
- The kill switch is a hard stop: when tripped, the scan endpoint refuses to open ANY new trades
  and immediately closes all open positions.
- The win rate gate checks each strategy's historical win rate from closed paper_trades.
  Strategies below the threshold are skipped entirely.
- max_daily_loss_pct triggers the kill switch automatically when cumulative daily losses exceed
  the threshold percentage of live_capital.
*/

DO $$ BEGIN
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS kill_switch boolean NOT NULL DEFAULT false;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS kill_switch_reason text;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS kill_switch_tripped_at timestamptz;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS max_daily_loss_pct numeric NOT NULL DEFAULT 10;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS min_win_rate_threshold numeric NOT NULL DEFAULT 90;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS live_capital numeric NOT NULL DEFAULT 5;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS daily_loss_accumulator numeric NOT NULL DEFAULT 0;
  ALTER TABLE strategy_config ADD COLUMN IF NOT EXISTS daily_loss_reset_at timestamptz;
END $$;

DO $$ BEGIN
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS binance_order_id text;
  ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS binance_close_order_id text;
END $$;
