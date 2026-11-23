import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const db = new PGlite();
// Minimal stand-ins for Supabase roles, auth.uid() and the billing helpers.
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.signals(id serial PRIMARY KEY, signal_type text NOT NULL);
  CREATE TABLE public.flags(subscriber boolean, operator boolean);
  INSERT INTO public.flags VALUES (false, false);
  CREATE FUNCTION public.has_active_signal_subscription() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT subscriber FROM public.flags';
  CREATE FUNCTION public.is_app_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT operator FROM public.flags';
  GRANT SELECT ON public.signals TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.has_active_signal_subscription(), public.is_app_operator() TO authenticated;
  INSERT INTO public.signals(signal_type) VALUES ('buy'),('sell'),('stake'),('whale'),('smart_money');
  -- Reproduce production: the open policy plus the subscriber policy.
  CREATE POLICY "public_read_signals" ON public.signals FOR SELECT TO anon, authenticated USING (true);
  CREATE POLICY "subscriber_premium_signals" ON public.signals FOR SELECT TO authenticated
    USING (signal_type IN ('whale','smart_money') AND public.has_active_signal_subscription());
  ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
`);

async function visible(role, { subscriber = false, operator = false } = {}) {
  await db.query('UPDATE public.flags SET subscriber=$1, operator=$2', [subscriber, operator]);
  await db.exec(`SET ROLE ${role}`);
  try {
    const { rows } = await db.query('SELECT signal_type FROM public.signals ORDER BY id');
    return rows.map(r => r.signal_type);
  } finally {
    await db.exec('RESET ROLE');
  }
}

test('before the fix, anonymous visitors can read premium signals', async () => {
  assert.ok((await visible('anon')).includes('whale'));
});

test('after the fix, premium rows require a subscription or operator role', async () => {
  await db.exec(await migration('20261123120000_enforce_signals_paywall.sql'));
  const publicFeed = ['buy', 'sell', 'stake'];
  assert.deepEqual(await visible('anon'), publicFeed);
  assert.deepEqual(await visible('authenticated'), publicFeed);
  assert.deepEqual(await visible('authenticated', { subscriber: true }), [...publicFeed, 'whale', 'smart_money']);
  assert.deepEqual(await visible('authenticated', { operator: true }), [...publicFeed, 'whale', 'smart_money']);
  // Flags never widen anonymous access.
  assert.deepEqual(await visible('anon', { subscriber: true, operator: true }), publicFeed);
});

test('the migration is safe to re-run', async () => {
  await db.exec(await migration('20261123120000_enforce_signals_paywall.sql'));
  assert.deepEqual(await visible('anon'), ['buy', 'sell', 'stake']);
});
