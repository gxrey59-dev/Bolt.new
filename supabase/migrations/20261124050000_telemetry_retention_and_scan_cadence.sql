/*
# Telemetry retention and a slower scan cadence

The engine wrote to `signals` and `audit_log` every 30 seconds, and the database
reached 908 MB. The app only ever reads the newest rows: the last 50 signals,
the last 50 audit entries, and the last 30 premium signals.

1. `prune_telemetry()` deletes, in bounded batches:
   - `signals` rows older than 30 days
   - `audit_log` rows older than 30 days of the noisy types `strategy_scan`,
     `live_close_failed` and `signal_batch` only.
   Money history (trade opens and closes, withdrawals, order failures,
   circuit breakers, kill-switch events) is never deleted.
2. An hourly cron job runs it. 50k rows per table per run clears the current
   backlog within about half a day, then stays cheap.
3. The scan moves from every 30 seconds to every 5 minutes. Signals use hourly
   candles, so entries are unchanged. Exits and stops are checked every 5
   minutes, which is fine in paper mode. Before going live, consider every
   minute so stops react faster.

DELETE does not return disk to the OS; autovacuum makes the space reusable,
so the database stops growing rather than shrinking.
*/

CREATE INDEX IF NOT EXISTS idx_signals_created_at ON public.signals (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at);

CREATE OR REPLACE FUNCTION public.prune_telemetry(p_batch integer DEFAULT 50000)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  signals_deleted integer;
  audit_deleted integer;
BEGIN
  DELETE FROM public.signals
  WHERE id IN (
    SELECT id FROM public.signals
    WHERE created_at < now() - interval '30 days'
    ORDER BY created_at
    LIMIT p_batch
  );
  GET DIAGNOSTICS signals_deleted = ROW_COUNT;

  DELETE FROM public.audit_log
  WHERE id IN (
    SELECT id FROM public.audit_log
    WHERE created_at < now() - interval '30 days'
      AND event_type IN ('strategy_scan', 'live_close_failed', 'signal_batch')
    ORDER BY created_at
    LIMIT p_batch
  );
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;

  RETURN jsonb_build_object('signals_deleted', signals_deleted, 'audit_deleted', audit_deleted);
END $$;

REVOKE ALL ON FUNCTION public.prune_telemetry(integer) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'prune-telemetry';
SELECT cron.schedule('prune-telemetry', '17 * * * *', 'SELECT public.prune_telemetry();');

SELECT cron.alter_job(jobid, schedule := '*/5 * * * *')
FROM cron.job WHERE jobname = 'binance-feed-scan';
