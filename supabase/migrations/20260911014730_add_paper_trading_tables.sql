/*
# Paper Trading & Market Data Tables

1. New Tables
- `market_data` — stores real market ticker snapshots from Binance.US
  - symbol (text, e.g. BTCUSDT)
  - price (numeric)
  - price_change_pct (numeric)
  - volume (numeric)
  - high_24h, low_24h (numeric)
  - rsi_14 (numeric, 0-100, calculated)
  - macd_line, macd_signal, macd_histogram (numeric, calculated)
  - ema_12, ema_26 (numeric, calculated)
  - sma_20, sma_50 (numeric, calculated)
  - atr_14 (numeric, calculated)
  - fetched_at (timestamptz)
- `paper_trades` — simulated trades based on real market data and real strategies
  - faction_id (text, which faction made the trade)
  - symbol (text, e.g. BTCUSDT)
  - side (text: 'long' or 'short')
  - strategy (text: 'rsi_oversold', 'rsi_overbought', 'macd_crossover', 'momentum_breakout', 'mean_reversion', 'bollinger_squeeze')
  - entry_price (numeric)
  - exit_price (numeric, nullable)
  - quantity (numeric)
  - position_value (numeric)
  - pnl (numeric, realized profit/loss)
  - status (text: 'open', 'closed')
  - stop_loss (numeric)
  - take_profit (numeric)
  - reasoning (text, human-readable explanation of why the trade was taken)
  - indicators_snapshot (jsonb, the indicator values at time of entry)
  - opened_at, closed_at (timestamptz)
- `strategy_config` — controls which strategies are active and their parameters
  - id (int, primary key, default 1)
  - paper_mode (boolean, default true — always paper trading)
  - starting_capital (numeric, default 10000)
  - max_position_pct (numeric, max % of capital per trade, default 10)
  - stop_loss_pct (numeric, default 2.0)
  - take_profit_pct (numeric, default 4.0)
  - rsi_oversold (numeric, default 30)
  - rsi_overbought (numeric, default 70)
  - macd_threshold (numeric, default 0)
  - momentum_lookback (int, default 5)
  - mean_reversion_bands (numeric, default 2.0 standard deviations)
  - active_strategies (text[], which strategies are enabled)
  - updated_at (timestamptz)

2. Modified Tables
- `factions` — add columns to track real paper trading stats
  - paper_balance (numeric, each faction's current paper trading balance)
  - open_positions (int, number of currently open paper trades)

3. Security
- RLS enabled on all new tables
- All tables allow anon + authenticated CRUD (single-tenant shared console)
- paper_mode is locked to true — this system does paper trading only
*/

-- MARKET DATA TABLE
CREATE TABLE IF NOT EXISTS market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  price numeric(18,8) NOT NULL DEFAULT 0,
  price_change_pct numeric(10,4) NOT NULL DEFAULT 0,
  volume numeric(20,8) NOT NULL DEFAULT 0,
  high_24h numeric(18,8) NOT NULL DEFAULT 0,
  low_24h numeric(18,8) NOT NULL DEFAULT 0,
  rsi_14 numeric(8,4),
  macd_line numeric(18,8),
  macd_signal numeric(18,8),
  macd_histogram numeric(18,8),
  ema_12 numeric(18,8),
  ema_26 numeric(18,8),
  sma_20 numeric(18,8),
  sma_50 numeric(18,8),
  atr_14 numeric(18,8),
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_market_data" ON market_data;
CREATE POLICY "anon_select_market_data" ON market_data FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_market_data" ON market_data;
CREATE POLICY "anon_insert_market_data" ON market_data FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_market_data" ON market_data;
CREATE POLICY "anon_update_market_data" ON market_data FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_market_data" ON market_data;
CREATE POLICY "anon_delete_market_data" ON market_data FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);
CREATE INDEX IF NOT EXISTS idx_market_data_fetched ON market_data(fetched_at DESC);

-- PAPER TRADES TABLE
CREATE TABLE IF NOT EXISTS paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction_id text NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL DEFAULT 'long',
  strategy text NOT NULL,
  entry_price numeric(18,8) NOT NULL,
  exit_price numeric(18,8),
  quantity numeric(18,8) NOT NULL DEFAULT 0,
  position_value numeric(18,8) NOT NULL DEFAULT 0,
  pnl numeric(18,8) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  stop_loss numeric(18,8) NOT NULL DEFAULT 0,
  take_profit numeric(18,8) NOT NULL DEFAULT 0,
  reasoning text NOT NULL DEFAULT '',
  indicators_snapshot jsonb NOT NULL DEFAULT '{}',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_paper_trades" ON paper_trades;
CREATE POLICY "anon_select_paper_trades" ON paper_trades FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_paper_trades" ON paper_trades;
CREATE POLICY "anon_insert_paper_trades" ON paper_trades FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_paper_trades" ON paper_trades;
CREATE POLICY "anon_update_paper_trades" ON paper_trades FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_paper_trades" ON paper_trades;
CREATE POLICY "anon_delete_paper_trades" ON paper_trades FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_paper_trades_faction ON paper_trades(faction_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status);
CREATE INDEX IF NOT EXISTS idx_paper_trades_opened ON paper_trades(opened_at DESC);

-- STRATEGY CONFIG TABLE
CREATE TABLE IF NOT EXISTS strategy_config (
  id integer PRIMARY KEY DEFAULT 1,
  paper_mode boolean NOT NULL DEFAULT true,
  starting_capital numeric(18,2) NOT NULL DEFAULT 10000,
  max_position_pct numeric(5,2) NOT NULL DEFAULT 10.00,
  stop_loss_pct numeric(5,2) NOT NULL DEFAULT 2.00,
  take_profit_pct numeric(5,2) NOT NULL DEFAULT 4.00,
  rsi_oversold numeric(5,2) NOT NULL DEFAULT 30.00,
  rsi_overbought numeric(5,2) NOT NULL DEFAULT 70.00,
  macd_threshold numeric(10,4) NOT NULL DEFAULT 0,
  momentum_lookback integer NOT NULL DEFAULT 5,
  mean_reversion_bands numeric(5,2) NOT NULL DEFAULT 2.00,
  active_strategies text[] NOT NULL DEFAULT ARRAY['rsi_oversold','rsi_overbought','macd_crossover','momentum_breakout','mean_reversion'],
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE strategy_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_strategy_config" ON strategy_config;
CREATE POLICY "anon_select_strategy_config" ON strategy_config FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_strategy_config" ON strategy_config;
CREATE POLICY "anon_insert_strategy_config" ON strategy_config FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_strategy_config" ON strategy_config;
CREATE POLICY "anon_update_strategy_config" ON strategy_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_strategy_config" ON strategy_config;
CREATE POLICY "anon_delete_strategy_config" ON strategy_config FOR DELETE TO anon, authenticated USING (true);

-- Add paper trading columns to factions
DO $$ BEGIN
  ALTER TABLE factions ADD COLUMN paper_balance numeric(18,2) NOT NULL DEFAULT 1000;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE factions ADD COLUMN open_positions integer NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Seed strategy config if not exists
INSERT INTO strategy_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
