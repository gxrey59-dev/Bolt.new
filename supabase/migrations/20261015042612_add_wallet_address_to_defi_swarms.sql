ALTER TABLE defi_swarms ADD COLUMN IF NOT EXISTS wallet_address text DEFAULT '';
ALTER TABLE defi_swarm_agents ADD COLUMN IF NOT EXISTS wallet_address text DEFAULT '';

-- Connect the Cuban Linx Yield Cooperative (Aave V3 on Polygon) to the real wallet
UPDATE defi_swarms SET wallet_address = '0xb4d70fcFE953b9a563DD96Ee59D17082Db253098' WHERE protocol = 'aave_v3';
-- Also set it for the Aave agents
UPDATE defi_swarm_agents SET wallet_address = '0xb4d70fcFE953b9a563DD96Ee59D17082Db253098' WHERE protocol = 'aave_v3';
