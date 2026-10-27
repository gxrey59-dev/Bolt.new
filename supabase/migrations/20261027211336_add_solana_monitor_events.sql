/*
# Solana opportunity monitor events

Stores deduplicated smart-wallet observations and the outcome of forwarding
guarded signals to Chronos. Browser clients cannot read or write this table;
the public dashboard receives a redacted status view from the Edge Function.
*/

CREATE TABLE IF NOT EXISTS public.solana_monitor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  signature text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'helius',
  wallet text NOT NULL,
  token_mint text,
  usdc_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'observed',
  forwarded boolean NOT NULL DEFAULT false,
  chronos_status integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solana_monitor_events_type_check
    CHECK (event_type IN ('smart_money_swap', 'pool_impact', 'yield_rebalance')),
  CONSTRAINT solana_monitor_events_status_check
    CHECK (status IN ('observed', 'guarded', 'routed', 'rejected', 'failed')),
  CONSTRAINT solana_monitor_events_usdc_check CHECK (usdc_amount >= 0)
);

CREATE INDEX IF NOT EXISTS solana_monitor_events_created_idx
  ON public.solana_monitor_events (created_at DESC);
CREATE INDEX IF NOT EXISTS solana_monitor_events_wallet_idx
  ON public.solana_monitor_events (wallet, created_at DESC);

ALTER TABLE public.solana_monitor_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.solana_monitor_events FROM anon, authenticated;
