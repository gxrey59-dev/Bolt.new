import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'cloudflare', 'binance-proxy-worker.js');
const source = readFileSync(workerPath, 'utf8');

function makeRequest(headers = new Map(), pathname = '/api/v3/ticker/price') {
  return {
    method: 'GET',
    headers: { get: (k) => headers.get(k) ?? null },
    url: `https://proxy.example.test${pathname}?symbol=BTCUSDT`,
  };
}

test('proxy worker fails closed when PROXY_SECRET is not configured', async () => {
  const mod = await import(`file://${workerPath}?t=${Date.now()}-nocase`);
  const res = await mod.default.fetch(makeRequest(), {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'Proxy not configured');
});

test('proxy worker rejects a wrong secret with 403', async () => {
  const mod = await import(`file://${workerPath}?t=${Date.now()}-wrong`);
  const res = await mod.default.fetch(makeRequest(new Map([['X-Proxy-Secret', 'nope']])), { PROXY_SECRET: 's3cret' });
  assert.equal(res.status, 403);
});

test('proxy worker rejects a missing secret with 403 even when configured', async () => {
  const mod = await import(`file://${workerPath}?t=${Date.now()}-missing`);
  const res = await mod.default.fetch(makeRequest(), { PROXY_SECRET: 's3cret' });
  assert.equal(res.status, 403);
});

test('proxy worker only forwards /api/ and /sapi/ paths', async () => {
  assert.match(source, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /pathname\.startsWith\("\/sapi\/"\)/);
});

test('proxy worker secret comparison is constant-time', () => {
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /provided !== env\.PROXY_SECRET/);
});

test('proxy worker forwards only to Binance.US', () => {
  assert.match(source, /https:\/\/api\.binance\.us/);
  assert.doesNotMatch(source, /https:\/\/api\.binance\.com/);
});
