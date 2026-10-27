/* A transaction can be both a smart-wallet swap and a pool-impact event. */
ALTER TABLE public.solana_monitor_events
  DROP CONSTRAINT IF EXISTS solana_monitor_events_signature_key;

ALTER TABLE public.solana_monitor_events
  ADD CONSTRAINT solana_monitor_events_event_signature_wallet_key
  UNIQUE (event_type, signature, wallet);
