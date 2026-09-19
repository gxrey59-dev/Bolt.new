/*
# Backtest Tables

1. New Tables
- `backtest_runs` — a single backtest simulation run
  - id (uuid, primary key)
  - label (text, e.g. "50-Year Monte Carlo RSI+MACD")
  - years (integer, how many years simulated)
  - iterations (integer, how many Monte Carlo paths)
  - starting_capital (numeric)
  - final_equity (numeric, ending portfolio value)
  - total_return_pct (numeric)
  - annualized_return_pct (numeric)
  - max_drawdown_pct (numeric)
  - sharpe_ratio (numeric)
  - sortino_ratio (numeric)
  - total_trades (integer)
  - winning_trades (integer)
  - losing_trades (integer)
  - win_rate (numeric)
  - avg_win (numeric)
  - avg_loss (numeric)
  - profit_factor (numeric)
  - best_trade_pct (numeric)
  - worst_trade_pct (numeric)
  - avg_hold_periods (numeric)
  - strategy_params (jsonb, the parameters used)
  - equity_curve (jsonb, array of {period, equity} points)
  - strategy_breakdown (jsonb, per-strategy stats)
  - status (text: 'running', 'completed', 'failed')
  - created_at (timestamptz)

- `backtest_trades` — individual simulated trades from a backtest run
  - id (uuid, primary key)
  - run_id (uuid, FK to backtest_runs)
  - iteration (integer, which Monte Carlo path)
  - symbol (text)
  - side (text: 'long' or 'short')
  - strategy (text)
  - entry_price (numeric)
  - exit_price (numeric)
  - pnl (numeric)
  - pnl_pct (numeric)
  - hold_periods (integer)
  - exit_reason (text: 'stop_loss', 'take_profit', 'signal_exit')
  - period (integer, when in the simulation the trade was opened)

2. Security
- RLS enabled on all new tables
- All tables allow anon + authenticated CRUD (single-tenant shared console)
*/

CREATE TABLE IF NOT EXISTS backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  years integer NOT NULL DEFAULT 50,
  iterations integer NOT NULL DEFAULT 1,
  starting_capital numeric(18,2) NOT NULL DEFAULT 10000,
  final_equity numeric(18,2) NOT NULL DEFAULT 0,
  total_return_pct numeric(10,4) NOT NULL DEFAULT 0,
  annualized_return_pct numeric(10,4) NOT NULL DEFAULT 0,
  max_drawdown_pct numeric(10,4) NOT NULL DEFAULT 0,
  sharpe_ratio numeric(10,4) NOT NULL DEFAULT 0,
  sortino_ratio numeric(10,4) NOT NULL DEFAULT 0,
  total_trades integer NOT NULL DEFAULT 0,
  winning_trades integer NOT NULL DEFAULT 0,
  losing_trades integer NOT NULL DEFAULT 0,
  win_rate numeric(5,2) NOT NULL DEFAULT 0,
  avg_win numeric(18,8) NOT NULL DEFAULT 0,
  avg_loss numeric(18,8) NOT NULL DEFAULT 0,
  profit_factor numeric(10,4) NOT NULL DEFAULT 0,
  best_trade_pct numeric(10,4) NOT NULL DEFAULT 0,
  worst_trade_pct numeric(10,4) NOT NULL DEFAULT 0,
  avg_hold_periods numeric(10,2) NOT NULL DEFAULT 0,
  strategy_params jsonb NOT NULL DEFAULT '{}',
  equity_curve jsonb NOT NULL DEFAULT '[]',
  strategy_breakdown jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_backtest_runs" ON backtest_runs;
CREATE POLICY "anon_select_backtest_runs" ON backtest_runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_backtest_runs" ON backtest_runs;
CREATE POLICY "anon_insert_backtest_runs" ON backtest_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_backtest_runs" ON backtest_runs;
CREATE POLICY "anon_update_backtest_runs" ON backtest_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_backtest_runs" ON backtest_runs;
CREATE POLICY "anon_delete_backtest_runs" ON backtest_runs FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  iteration integer NOT NULL DEFAULT 0,
  symbol text NOT NULL,
  side text NOT NULL DEFAULT 'long',
  strategy text NOT NULL,
  entry_price numeric(18,8) NOT NULL,
  exit_price numeric(18,8) NOT NULL,
  pnl numeric(18,8) NOT NULL DEFAULT 0,
  pnl_pct numeric(10,4) NOT NULL DEFAULT 0,
  hold_periods integer NOT NULL DEFAULT 0,
  exit_reason text NOT NULL DEFAULT 'signal_exit',
  period integer NOT NULL DEFAULT 0
);
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_backtest_trades" ON backtest_trades;
CREATE POLICY "anon_select_backtest_trades" ON backtest_trades FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_backtest_trades" ON backtest_trades;
CREATE POLICY "anon_insert_backtest_trades" ON backtest_trades FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_backtest_trades" ON backtest_trades;
CREATE POLICY "anon_update_backtest_trades" ON backtest_trades FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_backtest_trades" ON backtest_trades;
CREATE POLICY "anon_delete_backtest_trades" ON backtest_trades FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_backtest_trades_run ON backtest_trades(run_id);
