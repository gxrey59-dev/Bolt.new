import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

test('durable live-entry claims enforce settlement and permission rules in PostgreSQL', async (t) => {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.paper_trades (
      id uuid PRIMARY KEY, symbol text NOT NULL, is_live boolean NOT NULL,
      status text NOT NULL, closed_at timestamptz, binance_order_id text
    );
    GRANT SELECT ON public.paper_trades TO service_role;
  `);
  await db.exec(await readFile(new URL('../../migrations/20261111195228_live_entry_claims.sql', import.meta.url), 'utf8'));
  const claim = async (attempt: number, symbol: string) => {
    const result = await db.query<{ claimed: boolean }>('SELECT claim_live_entry($1, $2, $3, $4) AS claimed', [id(attempt), symbol, 'BUY', 2]);
    return result.rows[0].claimed;
  };
  const settle = async (attempt: number, state: string, order: string | null = null, trade: string | null = null, compensation: string | null = null) => {
    const result = await db.query<{ settled: boolean }>('SELECT settle_live_entry($1, $2, $3, $4, $5, $6) AS settled', [id(attempt), state, order, trade, compensation, 'test outcome']);
    return result.rows[0].settled;
  };
  try {
    await t.test('one unresolved attempt per symbol and stable persisted client ID', async () => {
      assert.equal(await claim(1, 'BTCUSDT'), true);
      assert.equal(await claim(2, 'BTCUSDT'), false);
      assert.equal(await claim(1, 'BTCUSDT'), false);
      const row = await db.query<{ client_order_id: string }>('SELECT client_order_id FROM live_entry_attempts WHERE attempt_id=$1', [id(1)]);
      assert.equal(row.rows[0].client_order_id, `e${id(1).replaceAll('-', '')}`);
    });
    await t.test('ambiguity keeps the symbol blocked across subsequent attempts', async () => {
      assert.equal(await settle(1, 'reconciliation_required', '123'), true);
      assert.equal(await claim(3, 'BTCUSDT'), false);
    });
    await t.test('known exchange order cannot be released as a rejected request', async () => {
      await assert.rejects(settle(1, 'rejected', '123'), /accepted exchange order/);
      await assert.rejects(settle(1, 'rejected'), /accepted exchange order/);
    });
    await t.test('definitive rejection frees a symbol for a fresh unique attempt', async () => {
      assert.equal(await claim(4, 'SOLUSDT'), true);
      assert.equal(await settle(4, 'rejected'), true);
      assert.equal(await claim(5, 'SOLUSDT'), true);
      assert.equal(await settle(4, 'rejected'), false);
    });
    await t.test('tracked settlement requires an existing matching live trade', async () => {
      await assert.rejects(settle(1, 'tracked', '123', id(100)), /matching tracked trade/);
      await db.query("INSERT INTO paper_trades(id,symbol,is_live,status,binance_order_id) VALUES($1,'BTCUSDT',true,'open','123')", [id(100)]);
      assert.equal(await settle(1, 'tracked', '123', id(100)), true);
      // A stale scanner cannot claim again after the first attempt becomes tracked.
      assert.equal(await claim(6, 'BTCUSDT'), false);
    });
    await t.test('existing four-hour pair cooldown remains enforced inside the claim', async () => {
      await db.query("UPDATE paper_trades SET status='closed',closed_at=now() WHERE id=$1", [id(100)]);
      assert.equal(await claim(7, 'BTCUSDT'), false);
      await db.query("UPDATE paper_trades SET closed_at=now()-interval '5 hours' WHERE id=$1", [id(100)]);
      assert.equal(await claim(8, 'BTCUSDT'), true);
    });
    await t.test('compensation needs both order IDs before releasing the claim', async () => {
      await assert.rejects(settle(5, 'compensated', '500'), /both exchange order IDs/);
      assert.equal(await settle(5, 'compensated', '500', null, '501'), true);
      assert.equal(await claim(9, 'SOLUSDT'), true);
    });
    await t.test('browser roles cannot access claims or call the functions', async () => {
      const result = await db.query<{ anon_select: boolean; auth_write: boolean; anon_claim: boolean; auth_settle: boolean; service_claim: boolean; definer: boolean }>(`
        SELECT
          has_table_privilege('anon','public.live_entry_attempts','SELECT') AS anon_select,
          has_table_privilege('authenticated','public.live_entry_attempts','UPDATE') AS auth_write,
          has_function_privilege('anon','public.claim_live_entry(uuid,text,text,numeric)','EXECUTE') AS anon_claim,
          has_function_privilege('authenticated','public.settle_live_entry(uuid,text,text,uuid,text,text)','EXECUTE') AS auth_settle,
          has_function_privilege('service_role','public.claim_live_entry(uuid,text,text,numeric)','EXECUTE') AS service_claim,
          (SELECT bool_or(prosecdef) FROM pg_proc WHERE proname IN ('claim_live_entry','settle_live_entry')) AS definer
      `);
      assert.deepEqual(result.rows[0], { anon_select: false, auth_write: false, anon_claim: false, auth_settle: false, service_claim: true, definer: false });
      await db.exec('SET ROLE service_role');
      assert.equal(await claim(10, 'ETHUSDT'), true);
      await db.exec('RESET ROLE');
    });
  } finally {
    await db.close();
  }
});
