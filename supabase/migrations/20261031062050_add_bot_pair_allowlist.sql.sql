/*
# Add bot pair allowlist

1. New Tables
- `bot_pair_allowlist`: each row is a coin and faction combination the trading bots may open trades on.
  - `faction_id` (text, part of primary key): the faction (bot team) that may trade the coin.
  - `symbol` (text, part of primary key): the trading pair, e.g. BCHUSDT.
  - `enabled` (boolean): when false, the bot pauses that combination.
  - `updated_at` (timestamp).
- Seeded with the 10 coin and faction combinations that had positive realized results in live trading.

2. Security
- Row level security enabled.
- Anyone using the app (anon and signed-in) can read the list so the dashboard can display it.
- Only a signed-in app operator can change `enabled`. No insert or delete access is granted.
- The bot's server function uses the service role, which is granted read access.

3. Notes
- Any coin and faction combination not in the table, or marked disabled, is paused.
- Coins with no enabled combinations (e.g. LTCUSDT) are paused entirely.
*/

CREATE TABLE IF NOT EXISTS bot_pair_allowlist (
  faction_id text NOT NULL,
  symbol text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (faction_id, symbol)
);

ALTER TABLE bot_pair_allowlist ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON bot_pair_allowlist TO anon, authenticated, service_role;
GRANT UPDATE (enabled, updated_at) ON bot_pair_allowlist TO authenticated;

DROP POLICY IF EXISTS "anon_select_bot_pair_allowlist" ON bot_pair_allowlist;
CREATE POLICY "anon_select_bot_pair_allowlist" ON bot_pair_allowlist FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "operator_update_bot_pair_allowlist" ON bot_pair_allowlist;
CREATE POLICY "operator_update_bot_pair_allowlist" ON bot_pair_allowlist FOR UPDATE
  TO authenticated USING (public.is_app_operator()) WITH CHECK (public.is_app_operator());

INSERT INTO bot_pair_allowlist (faction_id, symbol, enabled) VALUES
  ('suicideboys', 'MANAUSDT', true),
  ('rza', 'SOLUSDT', true),
  ('inspectah', 'AVAXUSDT', true),
  ('ugod', 'BCHUSDT', true),
  ('gza', 'SEIUSDT', true),
  ('raekwon', 'DOGEUSDT', true),
  ('ugod', 'FILUSDT', true),
  ('raekwon', 'ATOMUSDT', true),
  ('ugod', 'DOTUSDT', true),
  ('mastakilla', 'AXSUSDT', true)
ON CONFLICT (faction_id, symbol) DO NOTHING;
