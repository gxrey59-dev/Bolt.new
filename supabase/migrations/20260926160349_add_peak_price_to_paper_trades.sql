/*
# Add peak_price column to paper_trades

## Purpose
Track the highest price reached since trade entry so the bot never misses a sell-high opportunity.
Currently the bot only checks the candle close price every 2 minutes — if price spikes to the take-profit target mid-candle and drops back before the next scan, the sell is missed and profit is lost.

## Changes
- Add `peak_price` (numeric, nullable) to `paper_trades` — stores the highest intrabar price seen since the trade opened, used to detect take-profit hits that the 2-minute polling interval would otherwise miss.
- Add `peak_price_at` (timestamptz, nullable) — when the peak was recorded.
- Backfill existing open trades with their entry_price as the initial peak.

## Security
- No RLS changes. No new tables.
*/

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS peak_price numeric;
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS peak_price_at timestamptz;

-- Backfill open trades with entry price as initial peak
UPDATE paper_trades SET peak_price = entry_price, peak_price_at = opened_at
WHERE status = 'open' AND peak_price IS NULL;
