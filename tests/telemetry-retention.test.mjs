import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA cron;
  CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
    'INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid';
  CREATE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE sql AS
    'DELETE FROM cron.job WHERE jobid = id RETURNING true';
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text) RETURNS void LANGUAGE sql AS
    'UPDATE cron.job SET schedule = alter_job.schedule WHERE jobid = job_id';
  INSERT INTO cron.job(jobname, schedule, command) VALUES ('binance-feed-scan', '30 seconds', 'scan');
  CREATE TABLE public.signals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), signal_type text, created_at timestamptz);
  CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, created_at timestamptz);
  INSERT INTO public.signals(signal_type, created_at)
    SELECT 'buy', now() - (i || ' days')::interval FROM generate_series(1, 60) i WHERE i <> 30;
  INSERT INTO public.audit_log(event_type, created_at)
    SELECT e, now() - interval '45 days' FROM unnest(ARRAY['strategy_scan','live_close_failed','signal_batch',
      'live_trade_open','live_trade_close','withdrawal_failed','live_order_failed','kill_switch_tripped','circuit_breaker']) e;
  INSERT INTO public.audit_log(event_type, created_at) VALUES ('strategy_scan', now() - interval '2 days');
`);
const migration = await readFile(new URL('../supabase/migrations/20261124050000_telemetry_retention_and_scan_cadence.sql', import.meta.url), 'utf8');
await db.exec(migration);

const count = async q => (await db.query(q)).rows[0].n;

test('pruning removes only telemetry older than 30 days', async () => {
  const { rows } = await db.query('SELECT public.prune_telemetry() AS r');
  assert.deepEqual(rows[0].r, { signals_deleted: 30, audit_deleted: 3 });
  assert.equal(await count("SELECT count(*)::int n FROM signals WHERE created_at < now() - interval '30 days'"), 0);
  assert.equal(await count('SELECT count(*)::int n FROM signals'), 29);
});

test('money and safety history is never deleted, and recent noise stays', async () => {
  const { rows } = await db.query('SELECT event_type FROM audit_log ORDER BY event_type');
  assert.deepEqual(rows.map(r => r.event_type), ['circuit_breaker', 'kill_switch_tripped', 'live_order_failed',
    'live_trade_close', 'live_trade_open', 'strategy_scan', 'withdrawal_failed']);
});

test('batches are bounded', async () => {
  await db.exec(`INSERT INTO signals(signal_type, created_at) SELECT 'sell', now() - interval '40 days' FROM generate_series(1, 25)`);
  assert.equal((await db.query('SELECT public.prune_telemetry(10) AS r')).rows[0].r.signals_deleted, 10);
});

test('scan moves to every 5 minutes and pruning runs hourly', async () => {
  const { rows } = await db.query('SELECT jobname, schedule FROM cron.job ORDER BY jobname');
  assert.deepEqual(rows, [
    { jobname: 'binance-feed-scan', schedule: '*/5 * * * *' },
    { jobname: 'prune-telemetry', schedule: '17 * * * *' },
  ]);
});

test('browser roles cannot run the pruning function', async () => {
  const { rows } = await db.query("SELECT has_function_privilege('anon','public.prune_telemetry(integer)','EXECUTE') a, has_function_privilege('authenticated','public.prune_telemetry(integer)','EXECUTE') b");
  assert.deepEqual(rows[0], { a: false, b: false });
});

test('re-running the migration does not duplicate the job', async () => {
  await db.exec(migration);
  assert.equal(await count("SELECT count(*)::int n FROM cron.job WHERE jobname = 'prune-telemetry'"), 1);
});
