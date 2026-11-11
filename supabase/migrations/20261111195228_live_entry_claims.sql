/*
# Live entry claims

1. New tables
- `live_entry_attempts`: records every attempt to open a real-money position before the
  order is sent, so two overlapping trading runs can never buy the same coin twice.
  Unknown exchange outcomes stay flagged for reconciliation; nothing expires automatically.

2. New server-only functions
- `claim_live_entry`, `settle_live_entry`.

3. Security
- RLS enabled, no policies; all privileges revoked from browser roles; server role only.
*/

CREATE TABLE IF NOT EXISTS public.live_entry_attempts (
  attempt_id uuid PRIMARY KEY,
  symbol text NOT NULL CHECK (symbol ~ '^[A-Z0-9]{2,30}$'),
  client_order_id text NOT NULL UNIQUE,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  state text NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed', 'reconciliation_required', 'tracked', 'rejected', 'compensated')),
  entry_order_id text,
  compensation_order_id text,
  trade_id uuid,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS live_entry_attempts_one_active_symbol
  ON public.live_entry_attempts (symbol)
  WHERE state IN ('claimed', 'reconciliation_required');
ALTER TABLE public.live_entry_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_entry_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.live_entry_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_live_entry(
  p_attempt_id uuid, p_symbol text, p_side text, p_quantity numeric
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE claimed uuid;
BEGIN
  INSERT INTO public.live_entry_attempts (attempt_id, symbol, client_order_id, side, requested_quantity)
  VALUES (p_attempt_id, p_symbol, 'e' || replace(p_attempt_id::text, '-', ''), p_side, p_quantity)
  ON CONFLICT DO NOTHING
  RETURNING attempt_id INTO claimed;
  IF claimed IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.paper_trades
    WHERE symbol = p_symbol AND is_live = true
      AND (status = 'open' OR (status = 'closed' AND closed_at > now() - interval '4 hours'))
  ) THEN
    UPDATE public.live_entry_attempts SET state = 'rejected',
      detail = 'Existing live position or existing four-hour cooldown', updated_at = now()
    WHERE attempt_id = p_attempt_id;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_live_entry(
  p_attempt_id uuid, p_state text, p_entry_order_id text DEFAULT NULL,
  p_trade_id uuid DEFAULT NULL, p_compensation_order_id text DEFAULT NULL, p_detail text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE changed uuid;
BEGIN
  IF p_state NOT IN ('reconciliation_required', 'tracked', 'rejected', 'compensated') THEN
    RAISE EXCEPTION 'invalid entry settlement state';
  END IF;
  IF p_state = 'tracked' AND NOT EXISTS (
    SELECT 1 FROM public.paper_trades t
    JOIN public.live_entry_attempts a ON a.attempt_id = p_attempt_id
    WHERE t.id = p_trade_id AND t.is_live = true AND t.symbol = a.symbol
      AND t.binance_order_id = p_entry_order_id AND p_entry_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'confirmed entry must have a matching tracked trade';
  END IF;
  IF p_state = 'compensated' AND (p_entry_order_id IS NULL OR p_compensation_order_id IS NULL) THEN
    RAISE EXCEPTION 'compensated entry requires both exchange order IDs';
  END IF;
  IF p_state = 'rejected' AND (p_entry_order_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.live_entry_attempts
    WHERE attempt_id = p_attempt_id AND (entry_order_id IS NOT NULL OR state = 'reconciliation_required')
  )) THEN
    RAISE EXCEPTION 'accepted exchange order cannot be released as a rejection';
  END IF;
  UPDATE public.live_entry_attempts
  SET state = p_state, entry_order_id = COALESCE(p_entry_order_id, entry_order_id),
      trade_id = COALESCE(p_trade_id, trade_id),
      compensation_order_id = COALESCE(p_compensation_order_id, compensation_order_id),
      detail = p_detail, updated_at = now()
  WHERE attempt_id = p_attempt_id AND state IN ('claimed', 'reconciliation_required')
  RETURNING attempt_id INTO changed;
  RETURN changed IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_live_entry(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_live_entry(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_live_entry(uuid, text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_live_entry(uuid, text, text, uuid, text, text) TO service_role;
