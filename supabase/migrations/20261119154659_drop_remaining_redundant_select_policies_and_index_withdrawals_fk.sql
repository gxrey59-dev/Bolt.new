-- Second pass on the advisor's permissive-policy findings.
-- nft_collection and sentiment each have an owner_read SELECT policy made
-- redundant by their public read policy (the owner_write ALL policy already
-- grants SELECT to operators, but read access for everyone is intentional on
-- these telemetry tables, so the operator-only duplicate is dropped).
-- withdrawal_config keeps its owner_write ALL policy (which covers SELECT);
-- its owner_read duplicate is dropped.
-- The remaining signals warning is about the subscriber_premium_signals policy
-- (whale / smart_money rows for paying subscribers), which is intentionally
-- distinct from the public read policy and stays.

DROP POLICY IF EXISTS "owner_read" ON public.nft_collection;
DROP POLICY IF EXISTS "owner_read" ON public.sentiment;
DROP POLICY IF EXISTS "owner_read" ON public.withdrawal_config;

-- Cover the last flagged foreign key (withdrawals -> withdrawal_config).
CREATE INDEX IF NOT EXISTS idx_withdrawals_config_id
  ON public.withdrawals (config_id);
