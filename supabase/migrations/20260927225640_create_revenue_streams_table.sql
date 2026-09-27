/*
# Create revenue projections table for billion-dollar roadmap

1. New Table
- `revenue_streams` — tracks each revenue stream with current and target metrics
  - `id` (uuid, primary key)
  - `name` (text, e.g. "Algorithmic Trading", "NFT Mint Revenue")
  - `category` (text: trading, defi, nft, saas, data, licensing)
  - `current_revenue` (numeric, current monthly revenue in USD)
  - `target_revenue` (numeric, target monthly revenue in USD)
  - `current_metric` (text, the key driver, e.g. "Daily P&L")
  - `current_value` (numeric, current value of that metric)
  - `target_value` (numeric, target value of that metric)
  - `unit` (text, e.g. "$/day", "trades/day", "TVL")
  - `growth_rate` (numeric, monthly growth rate needed, e.g. 2.5 = 250%)
  - `months_to_target` (int, estimated months to reach target)
  - `billion_share` (numeric, what % of $1B this stream needs to generate)
  - `status` (text: live, scaling, planned, conceptual)
  - `blockers` (text, what's preventing scaling)
  - `next_milestone` (text, next action needed)
  - `created_at` (timestamp)

2. Security
- RLS enabled, anon+authenticated full CRUD
*/

CREATE TABLE IF NOT EXISTS revenue_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'trading',
  current_revenue numeric NOT NULL DEFAULT 0,
  target_revenue numeric NOT NULL DEFAULT 0,
  current_metric text NOT NULL DEFAULT '',
  current_value numeric NOT NULL DEFAULT 0,
  target_value numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '$',
  growth_rate numeric NOT NULL DEFAULT 0,
  months_to_target int NOT NULL DEFAULT 0,
  billion_share numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'live',
  blockers text NOT NULL DEFAULT '',
  next_milestone text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE revenue_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_revenue" ON revenue_streams;
CREATE POLICY "anon_read_revenue" ON revenue_streams FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_revenue" ON revenue_streams;
CREATE POLICY "anon_insert_revenue" ON revenue_streams FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_revenue" ON revenue_streams;
CREATE POLICY "anon_update_revenue" ON revenue_streams FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_revenue" ON revenue_streams;
CREATE POLICY "anon_delete_revenue" ON revenue_streams FOR DELETE
  TO anon, authenticated USING (true);

-- Seed revenue streams with real current data and billion-dollar targets
INSERT INTO revenue_streams (name, category, current_revenue, target_revenue, current_metric, current_value, target_value, unit, growth_rate, months_to_target, billion_share, status, blockers, next_milestone)
VALUES
  ('Algorithmic Trading', 'trading', 4.30, 5000000, 'Daily P&L', 0.14, 166666, '$/day', 3.2, 24, 30, 'live', 'Only $22 capital, 33% win rate, single exchange (Binance.US), no live capital deployed', 'Scale to $100K capital, add 3 more exchanges, improve win rate to 55%+'),
  ('DeFi Yield Swarms', 'defi', 834.56, 2000000, 'Weekly Yield', 834.56, 666666, '$/week', 2.8, 18, 12, 'scaling', 'Simulated TVL ($57K), no real on-chain deposits, no wallet integration', 'Connect real wallets, deploy real capital to Aave/Compound/Curve pools'),
  ('NFT Mint Revenue', 'nft', 0, 1000000, 'Mints/Month', 0, 50000, 'mints/mo', 5.0, 18, 6, 'live', 'Zero mints, no wallet connect, no on-chain minting, no marketplace listing', 'Deploy NFTs on-chain (Polygon/Base), add wallet connect, list on OpenSea'),
  ('NFT Royalty Resales', 'nft', 0, 500000, 'Monthly Resales', 0, 25000, 'resales/mo', 0, 18, 3, 'conceptual', 'No on-chain NFTs, no royalty mechanism, no secondary market', 'Deploy with ERC-721 + royalty standard, integrate OpenSea/Magic Eden'),
  ('Trading Signal SaaS', 'saas', 0, 2000000, 'Subscribers', 0, 20000, 'subs/mo', 4.0, 18, 12, 'conceptual', 'No subscription product, no payment integration, no user accounts', 'Add Stripe subscriptions, build signal API + dashboard for subscribers'),
  ('DeFi Swarm API', 'saas', 0, 500000, 'API Calls/Month', 0, 50000000, 'calls/mo', 3.5, 18, 3, 'conceptual', 'No API product, no rate limiting, no billing', 'Package swarm intelligence as API, add Stripe metered billing'),
  ('Strategy Licensing', 'licensing', 0, 1000000, 'Licensees', 0, 500, 'licensees', 3.0, 24, 6, 'conceptual', 'Strategies not packaged, no legal framework, no distribution channel', 'Package top strategies as white-label, sell to hedge funds/funds'),
  ('Faction DAO Treasury', 'defi', 0, 500000, 'Treasury AUM', 0, 50000000, 'AUM', 0, 24, 3, 'conceptual', 'No DAO structure, no governance token, no community', 'Launch governance token, create DAO treasury, distribute yield to holders')
ON CONFLICT DO NOTHING;
