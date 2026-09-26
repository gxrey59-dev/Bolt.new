/*
# Add partial exit columns to paper_trades

## Purpose
Support progressive take-profit (scaling out). Instead of selling 100% at one target price,
the bot will sell 50% at the first take-profit target and let the remaining 50% ride with
a tighter trailing stop. This captures guaranteed profit at the target while letting winners
run for maximum upside — never losing a sell-high opportunity.

## Changes
- Add `partial_exit_price` (numeric, nullable) — price at which the first 50% was sold.
- Add `partial_exit_at` (timestamptz, nullable) — when the partial exit happened.
- Add `partial_exit_pnl` (numeric, default 0) — P&L realized from the partial exit.
- Add `remaining_quantity` (numeric, nullable) — quantity still open after partial exit.
- Backfill existing open trades: set remaining_quantity = quantity where it's null.

## Security
- No RLS changes. No new tables.
*/

ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_price numeric;
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_at timestamptz;
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS partial_exit_pnl numeric DEFAULT 0;
ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS remaining_quantity numeric;

UPDATE paper_trades SET remaining_quantity = quantity
WHERE status = 'open' AND remaining_quantity IS NULL;
