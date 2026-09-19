/*
# Smarter Withdrawal Routing — Audit Trail

Tracks each AI routing decision for withdrawals:
- which strategy was chosen (direct, proxy, rapidapi-relay, retry-backoff)
- the AI model's reasoning
- which endpoints were attempted and their results
- latency and success/failure per attempt
*/

CREATE TABLE IF NOT EXISTS withdrawal_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id uuid REFERENCES withdrawals(id) ON DELETE CASCADE,
  strategy text NOT NULL DEFAULT 'direct',
  ai_model text,
  ai_reasoning text,
  endpoints_tried text[] NOT NULL DEFAULT '{}',
  endpoint_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  chosen_endpoint text,
  rapidapi_used boolean NOT NULL DEFAULT false,
  latency_ms integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE withdrawal_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_wd_routes" ON withdrawal_routes;
CREATE POLICY "anon_select_wd_routes" ON withdrawal_routes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_wd_routes" ON withdrawal_routes;
CREATE POLICY "anon_insert_wd_routes" ON withdrawal_routes FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_wd_routes" ON withdrawal_routes;
CREATE POLICY "anon_update_wd_routes" ON withdrawal_routes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_wd_routes" ON withdrawal_routes;
CREATE POLICY "anon_delete_wd_routes" ON withdrawal_routes FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_wd_routes_withdrawal ON withdrawal_routes(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_wd_routes_created ON withdrawal_routes(created_at DESC);
