import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as simulation from './simulation.ts';

function harness({ failHistory = false, failWrite = false } = {}) {
  let handler;
  const writes = [];
  const db = { from(table) {
    const chain = {
      insert(value) { writes.push({ table, op: 'insert', value }); return chain; },
      update(value) { writes.push({ table, op: 'update', value }); return chain; },
      select() { return chain; }, single() { return chain; }, eq() { return chain; },
      order() { return chain; }, limit() { return chain; },
      then(resolve) { return Promise.resolve({ data: { id: 'mock-run' }, error: failWrite ? { message: 'mock write failure' } : null }).then(resolve); },
    };
    return chain;
  } };
  const raw = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '');
  const source = ts.transpileModule(raw, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const fakeDeno = { env: { get: () => 'mock-only' }, serve(fn) { handler = fn; } };
  const fetch = async () => failHistory ? new Response('unavailable', { status: 503 }) : Response.json(
    Array.from({ length: 100 }, (_, i) => [i, '100', '101', '99', String(100 + Math.sin(i) * 5), '1000'])
  );
  new Function('createClient', 'Deno', 'fetch', ...Object.keys(simulation), source)(
    () => db, fakeDeno, fetch, ...Object.values(simulation)
  );
  return { handler, writes };
}
const request = body => new Request('https://local.test/backtest-engine/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('rejects invalid requests without persistent writes', async () => {
  for (const body of [{ iterations: 0 }, { years: -1 }, { symbols: [] }, { symbols: ['A?x=1'] }, { params: { feeBps: -1 } }]) {
    const h = harness();
    assert.equal((await h.handler(request(body))).status, 400);
    assert.equal(h.writes.length, 0);
  }
});
test('run route refuses GET', async () => {
  const h = harness();
  assert.equal((await h.handler(new Request('https://local.test/backtest-engine/run'))).status, 405);
  assert.equal(h.writes.length, 0);
});
test('calibration failure cannot create invented successful results', async () => {
  const h = harness({ failHistory: true });
  assert.equal((await h.handler(request({ years: 1, optimize: false }))).status, 500);
  assert.equal(h.writes.length, 0);
});
test('synthetic holdout disclosed and persisted separately from selected results', async () => {
  const h = harness();
  const res = await h.handler(request({ years: 1, iterations: 1, optimize: false, symbols: ['BTCUSDT'], params: { activeStrategies: [] } }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.validation.approvedForLive, false);
  assert.equal(data.validation.historicalOutOfSample, false);
  assert.equal(data.validation.result.totalTrades, 0);
  assert.equal(data.validation.result.netExpectancy, null);
  assert.equal(data.years, 1);
  const saved = h.writes.find(w => w.table === 'backtest_runs' && w.op === 'update');
  assert.deepEqual(saved.value.strategy_params.validation, data.validation);
});
test('persistence failure cannot report a completed run', async () => {
  const h = harness({ failWrite: true });
  const res = await h.handler(request({ years: 1, iterations: 1, optimize: false, symbols: ['BTCUSDT'] }));
  assert.equal(res.status, 500);
  assert.ok(!(await res.text()).includes('mock write failure'));
});
