/*
# Create DeFi Swarm tables (v4 - fixed alias columns)

1. New Tables
- `defi_swarms` — swarm clusters coordinating AI agents across DeFi protocols
- `defi_swarm_agents` — individual agents within swarms
2. Security
- RLS enabled, anon+authenticated full CRUD
*/

CREATE TABLE IF NOT EXISTS defi_swarms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  faction_id text NOT NULL,
  protocol text NOT NULL DEFAULT 'custom',
  chain text NOT NULL DEFAULT 'ethereum',
  agent_count int NOT NULL DEFAULT 0,
  active_agents int NOT NULL DEFAULT 0,
  total_tvl numeric NOT NULL DEFAULT 0,
  total_yield_24h numeric NOT NULL DEFAULT 0,
  total_yield_7d numeric NOT NULL DEFAULT 0,
  apy numeric NOT NULL DEFAULT 0,
  strategies text[] DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active',
  risk_level text NOT NULL DEFAULT 'medium',
  gas_efficiency numeric NOT NULL DEFAULT 0,
  rebalance_count int NOT NULL DEFAULT 0,
  last_rebalance_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE defi_swarms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_swarms" ON defi_swarms;
CREATE POLICY "anon_read_swarms" ON defi_swarms FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_swarms" ON defi_swarms;
CREATE POLICY "anon_insert_swarms" ON defi_swarms FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_swarms" ON defi_swarms;
CREATE POLICY "anon_update_swarms" ON defi_swarms FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_swarms" ON defi_swarms;
CREATE POLICY "anon_delete_swarms" ON defi_swarms FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS defi_swarm_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swarm_id uuid NOT NULL REFERENCES defi_swarms(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'yield_farmer',
  protocol text NOT NULL DEFAULT 'custom',
  pool_address text NOT NULL DEFAULT '',
  capital_allocated numeric NOT NULL DEFAULT 0,
  current_value numeric NOT NULL DEFAULT 0,
  yield_24h numeric NOT NULL DEFAULT 0,
  apy numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  last_action text NOT NULL DEFAULT '',
  last_action_at timestamptz,
  action_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE defi_swarm_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_agents" ON defi_swarm_agents;
CREATE POLICY "anon_read_agents" ON defi_swarm_agents FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_agents" ON defi_swarm_agents;
CREATE POLICY "anon_insert_agents" ON defi_swarm_agents FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_agents" ON defi_swarm_agents;
CREATE POLICY "anon_update_agents" ON defi_swarm_agents FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_agents" ON defi_swarm_agents;
CREATE POLICY "anon_delete_agents" ON defi_swarm_agents FOR DELETE
  TO anon, authenticated USING (true);

-- Seed 5 DeFi swarms
INSERT INTO defi_swarms (name, faction_id, protocol, chain, agent_count, active_agents, total_tvl, total_yield_24h, total_yield_7d, apy, strategies, status, risk_level, gas_efficiency, rebalance_count)
VALUES
  ('Liquid Swords Swarm', 'gza', 'uniswap_v3', 'arbitrum', 8, 7, 15420.50, 42.18, 287.34, 99.8, ARRAY['concentrated_liquidity','range_orders','arbitrage'], 'active', 'medium', 0.87, 14),
  ('Cuban Linx Yield Cooperative', 'raekwon', 'aave_v3', 'polygon', 6, 6, 8930.00, 18.42, 126.89, 75.3, ARRAY['lending','borrowing','flash_loans'], 'active', 'low', 0.94, 8),
  ('Tical Flash Swarm', 'methodman', 'compound_v3', 'base', 5, 4, 4250.75, 11.83, 78.45, 101.6, ARRAY['yield_farming','leverage','short_selling'], 'active', 'high', 0.79, 22),
  ('Supreme Clientele Pool', 'ghostface', 'curve', 'ethereum', 4, 4, 22100.00, 35.67, 243.12, 58.9, ARRAY['stable_swap','meta_pool','gauge_boosting'], 'active', 'low', 0.96, 6),
  ('Golden Arms Bridge Swarm', 'ugod', 'balancer', 'optimism', 7, 5, 6780.30, 14.92, 98.76, 80.3, ARRAY['weighted_pools','boosted_pools','vebal_locking'], 'rebalancing', 'medium', 0.82, 11)
ON CONFLICT DO NOTHING;

-- Seed agents — 13 columns: swarm_name, agent_name, role, protocol, pool, capital, value, yield, apy, status, action, actions, action_at
INSERT INTO defi_swarm_agents (swarm_id, name, role, protocol, pool_address, capital_allocated, current_value, yield_24h, apy, status, last_action, action_count, last_action_at)
SELECT s.id, v.agent_name, v.role, v.protocol, v.pool, v.capital::numeric, v.value::numeric, v.yield::numeric, v.apy::numeric, v.status, v.action, v.actions::int, v.action_at::timestamptz
FROM defi_swarms s
JOIN (VALUES
  ('Liquid Swords Swarm', 'Sentry-01', 'liquidity_provider', 'uniswap_v3', '0x88a6...3c4d', '3200.00', '3287.45', '8.42', '96.1', 'active', 'Rebalanced tick range around ETH price', '47', now() - interval '12 min'),
  ('Liquid Swords Swarm', 'Sentry-02', 'arbitrageur', 'uniswap_v3', '0x91b...7f2a', '2100.00', '2168.30', '6.18', '107.5', 'active', 'Arbitrage USDC/WETH vs Sushi 0.3% spread', '89', now() - interval '3 min'),
  ('Liquid Swords Swarm', 'Sentry-03', 'yield_farmer', 'uniswap_v3', '0xa23...9c1e', '2800.00', '2854.12', '7.34', '95.7', 'active', 'Compounded fees into position', '31', now() - interval '45 min'),
  ('Liquid Swords Swarm', 'Sentry-04', 'hedger', 'uniswap_v3', '0xb47...2d8f', '1850.00', '1892.67', '5.12', '101.0', 'active', 'Hedged delta with short ETHUSDT perp', '18', now() - interval '22 min'),
  ('Liquid Swords Swarm', 'Sentry-05', 'sentinel', 'uniswap_v3', '0xc59...4e1b', '1200.00', '1228.91', '3.87', '117.7', 'active', 'Monitoring pool volatility IV at 42%', '142', now() - interval '1 min'),
  ('Liquid Swords Swarm', 'Sentry-06', 'harvester', 'uniswap_v3', '0xd6a...5c3f', '2270.50', '2331.88', '6.91', '111.1', 'active', 'Harvested 12.4 USDC in swap fees', '56', now() - interval '8 min'),
  ('Liquid Swords Swarm', 'Sentry-07', 'liquidity_provider', 'uniswap_v3', '0xe7b...8d4c', '2000.00', '2041.55', '5.34', '97.4', 'idle', 'Waiting for optimal entry pool IV too low', '23', now() - interval '2 hours'),
  ('Liquid Swords Swarm', 'Sentry-08', 'arbitrageur', 'uniswap_v3', '0xf8c...9e5d', '0', '0', '0', '0', 'migrating', 'Migrating to new pool with better depth', '12', now() - interval '15 min'),
  ('Cuban Linx Yield Cooperative', 'Chef-01', 'yield_farmer', 'aave_v3', '0x1a2...b3c4', '1800.00', '1845.22', '3.81', '77.2', 'active', 'Supplied USDC at 4.2% borrow rate', '34', now() - interval '30 min'),
  ('Cuban Linx Yield Cooperative', 'Chef-02', 'yield_farmer', 'aave_v3', '0x2b3...c4d5', '1500.00', '1532.88', '3.14', '76.5', 'active', 'Borrowed ETH at 3.8% looping yield', '28', now() - interval '18 min'),
  ('Cuban Linx Yield Cooperative', 'Chef-03', 'yield_farmer', 'aave_v3', '0x3c4...d5e6', '1200.00', '1228.44', '2.56', '77.9', 'active', 'Flash loan repaid net 0.12% profit', '67', now() - interval '5 min'),
  ('Cuban Linx Yield Cooperative', 'Chef-04', 'yield_farmer', 'aave_v3', '0x4d5...e6f7', '1480.00', '1512.67', '3.02', '74.5', 'active', 'Rebalanced LTV from 68% to 65%', '19', now() - interval '1 hour'),
  ('Cuban Linx Yield Cooperative', 'Chef-05', 'sentinel', 'aave_v3', '0x5e6...f7a8', '1450.00', '1487.33', '2.89', '72.8', 'active', 'Monitoring health factor 1.42', '98', now() - interval '2 min'),
  ('Cuban Linx Yield Cooperative', 'Chef-06', 'harvester', 'aave_v3', '0x6f7...a8b9', '1500.00', '1536.91', '3.00', '73.1', 'active', 'Claimed stkAAVE rewards 0.34 AAVE', '15', now() - interval '4 hours'),
  ('Tical Flash Swarm', 'Meth-01', 'yield_farmer', 'compound_v3', '0x7a8...b9c0', '950.00', '972.18', '2.71', '104.3', 'active', 'Supplied USDC to cUSDCv3 market', '41', now() - interval '25 min'),
  ('Tical Flash Swarm', 'Meth-02', 'yield_farmer', 'compound_v3', '0x8b9...c0d1', '820.00', '841.55', '2.38', '105.9', 'active', 'Leveraged cETH loop 2.3x', '33', now() - interval '10 min'),
  ('Tical Flash Swarm', 'Meth-03', 'arbitrageur', 'compound_v3', '0x9c0...d1e2', '680.00', '698.22', '2.12', '113.8', 'active', 'Borrowed USDC at 3.2% farm at 5.1%', '52', now() - interval '7 min'),
  ('Tical Flash Swarm', 'Meth-04', 'hedger', 'compound_v3', '0xad1...e2f3', '550.00', '564.88', '1.87', '124.3', 'active', 'Hedged ETH exposure with perp short', '24', now() - interval '35 min'),
  ('Tical Flash Swarm', 'Meth-05', 'sentinel', 'compound_v3', '0xbe2...f3a4', '0', '0', '0', '0', 'error', 'Oracle price deviation >2% paused', '156', now() - interval '45 min'),
  ('Supreme Clientele Pool', 'Ghost-01', 'liquidity_provider', 'curve', '0xcf3...a4b5', '6800.00', '6942.18', '10.98', '58.9', 'active', 'Gauge boosted 2.5x CRV emissions', '12', now() - interval '1 hour'),
  ('Supreme Clientele Pool', 'Ghost-02', 'yield_farmer', 'curve', '0xd04...b5c6', '5500.00', '5618.44', '8.92', '59.2', 'active', 'Compounded CRV rewards into 3pool', '28', now() - interval '20 min'),
  ('Supreme Clientele Pool', 'Ghost-03', 'arbitrageur', 'curve', '0xe15...c6d7', '4800.00', '4902.67', '7.76', '59.0', 'active', 'Arbitrage 3pool vs StableSwap 0.04%', '43', now() - interval '14 min'),
  ('Supreme Clientele Pool', 'Ghost-04', 'sentinel', 'curve', '0xf26...d7e8', '5000.00', '5108.91', '8.01', '58.4', 'active', 'Monitoring pool balances all healthy', '87', now() - interval '3 min'),
  ('Golden Arms Bridge Swarm', 'Arms-01', 'liquidity_provider', 'balancer', '0xa37...e8f9', '1200.00', '1228.44', '2.71', '82.4', 'active', 'Added liquidity to 80/20 BAL/ETH pool', '18', now() - interval '40 min'),
  ('Golden Arms Bridge Swarm', 'Arms-02', 'yield_farmer', 'balancer', '0xb48...f9a0', '980.00', '1003.22', '2.18', '81.2', 'active', 'Locked veBAL for 1 year 2.1x boost', '9', now() - interval '2 hours'),
  ('Golden Arms Bridge Swarm', 'Arms-03', 'arbitrageur', 'balancer', '0xc59...a0b1', '850.00', '871.55', '1.98', '85.0', 'active', 'Cross-pool arbitrage BAL/WETH', '34', now() - interval '8 min'),
  ('Golden Arms Bridge Swarm', 'Arms-04', 'hedger', 'balancer', '0xd6a...b1c2', '720.00', '738.88', '1.67', '84.6', 'active', 'Hedged BAL exposure with perp', '16', now() - interval '28 min'),
  ('Golden Arms Bridge Swarm', 'Arms-05', 'harvester', 'balancer', '0xe7b...c2d3', '1030.30', '1055.91', '2.38', '84.3', 'active', 'Harvested BAL emissions 4.2 BAL', '22', now() - interval '50 min'),
  ('Golden Arms Bridge Swarm', 'Arms-06', 'sentinel', 'balancer', '0xf8c...d3e4', '0', '0', '0', '0', 'idle', 'Monitoring gas too high for harvest', '45', now() - interval '3 hours'),
  ('Golden Arms Bridge Swarm', 'Arms-07', 'liquidity_provider', 'balancer', '0xa9d...e4f5', '2000.00', '2048.33', '4.00', '73.1', 'rebalancing', 'Rebalancing pool weights 70/30 to 60/40', '13', now() - interval '6 min')
) AS v(swarm_name, agent_name, role, protocol, pool, capital, value, yield, apy, status, action, actions, action_at)
ON s.name = v.swarm_name
ON CONFLICT DO NOTHING;
