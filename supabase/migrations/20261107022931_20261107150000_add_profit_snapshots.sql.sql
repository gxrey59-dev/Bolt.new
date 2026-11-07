/*
# Add profit snapshots ledger for the Revenue Command Center

1. What this does
- Creates a `profit_snapshots` table that records one row per day with the
  money the app actually generated across three streams:
  - `trading_pnl` = realized live-trading profit/loss from `paper_trades`
  - `sweep_revenue` = value swept into the master wallet from `sweeps`
  - `nft_revenue` = mint revenue from `nft_collection`
- Backfills history from existing rows, then keeps it fresh daily with a
  scheduled job.

2. New Tables
- `profit_snapshots`
  - `day` (date, primary key) — the calendar day this row summarizes
  - `trading_pnl` (numeric) — realized live P&L closed that day
  - `sweep_revenue` (numeric) — USDT value swept that day
  - `nft_revenue` (numeric) — NFT mint revenue that day
  - `total_revenue` (numeric) — sum of the three above
  - `trade_count` (integer) — number of live trades closed that day
  - `created_at` / `updated_at` (timestamps)

3. Security
- Row Level Security is enabled on the new table.
- The public dashboard may only READ the aggregate ledger (no account or
  wallet details are in this table), so SELECT is granted to `anon` and
  `authenticated`.
- Writes happen only through a privileged snapshot function, never from the
  browser. The function is not callable by the public roles.
*/

CREATE TABLE IF NOT EXISTS profit_snapshots (
  day date PRIMARY KEY,
  trading_pnl numeric NOT NULL DEFAULT 0,
  sweep_revenue numeric NOT NULL DEFAULT 0,
  nft_revenue numeric NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  trade_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profit_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON profit_snapshots TO anon, authenticated;

DROP POLICY IF EXISTS "public_read_profit_snapshots" ON profit_snapshots;
CREATE POLICY "public_read_profit_snapshots" ON profit_snapshots FOR SELECT
  TO anon, authenticated
  USING (true);

-- Privileged snapshot writer. Cron and the backfill run this as the owner,
-- so it bypasses RLS while the browser cannot call it.
CREATE OR REPLACE FUNCTION public.capture_profit_snapshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
  WITH trading AS (
    SELECT closed_at::date AS day,
           COALESCE(sum(pnl), 0) AS trading_pnl,
           count(*) AS trade_count
    FROM paper_trades
    WHERE is_live = true
      AND status = 'closed'
      AND closed_at IS NOT NULL
    GROUP BY 1
  ),
  sweep_agg AS (
    SELECT created_at::date AS day,
           COALESCE(sum(amount_swept), 0) AS sweep_revenue
    FROM sweeps
    WHERE amount_swept IS NOT NULL
    GROUP BY 1
  ),
  nft_agg AS (
    SELECT COALESCE(minted_at, created_at)::date AS day,
           COALESCE(sum(mint_price * minted_count), 0) AS nft_revenue
    FROM nft_collection
    GROUP BY 1
  )
  INSERT INTO profit_snapshots
    (day, trading_pnl, sweep_revenue, nft_revenue, total_revenue, trade_count)
  SELECT
    COALESCE(t.day, s.day, n.day) AS day,
    COALESCE(t.trading_pnl, 0),
    COALESCE(s.sweep_revenue, 0),
    COALESCE(n.nft_revenue, 0),
    COALESCE(t.trading_pnl, 0)
      + COALESCE(s.sweep_revenue, 0)
      + COALESCE(n.nft_revenue, 0) AS total_revenue,
    COALESCE(t.trade_count, 0) AS trade_count
  FROM trading t
  FULL OUTER JOIN sweep_agg s ON s.day = t.day
  FULL OUTER JOIN nft_agg n ON n.day = COALESCE(t.day, s.day)
  ON CONFLICT (day) DO UPDATE SET
    trading_pnl = EXCLUDED.trading_pnl,
    sweep_revenue = EXCLUDED.sweep_revenue,
    nft_revenue = EXCLUDED.nft_revenue,
    total_revenue = EXCLUDED.total_revenue,
    trade_count = EXCLUDED.trade_count,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- The snapshot writer must not be reachable as a public RPC.
REVOKE EXECUTE ON FUNCTION public.capture_profit_snapshots() FROM PUBLIC, anon, authenticated;

-- Backfill history from data that already exists.
SELECT public.capture_profit_snapshots();

-- Refresh the ledger once a day shortly after midnight UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'profit-snapshot-daily') THEN
    PERFORM cron.unschedule('profit-snapshot-daily');
  END IF;
  PERFORM cron.schedule('profit-snapshot-daily', '5 0 * * *',
    'SELECT public.capture_profit_snapshots();'
  );
END
$$;
