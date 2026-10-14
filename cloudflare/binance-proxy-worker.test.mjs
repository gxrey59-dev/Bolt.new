import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './binance-proxy-worker.js';

test('forwards PUT and DELETE request bodies without changing signed bytes', async (t) => {
  for (const method of ['PUT', 'DELETE']) {
    const body = 'symbol=BTCUSD&timestamp=123&signature=abc';
    const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.binance.us/api/v3/order');
      assert.equal(options.method, method);
      assert.equal(options.body, body);
      assert.equal(options.headers.get('X-MBX-APIKEY'), 'mock-key');
      assert.equal(options.headers.has('X-Proxy-Secret'), false);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ ok: true });
    });
    const result = await worker.fetch(new Request('https://proxy.test/api/v3/order', {
      method, body, headers: { 'X-MBX-APIKEY': 'mock-key', 'X-Proxy-Secret': 'mock-secret' },
    }), { PROXY_SECRET: 'mock-secret' });
    assert.equal(result.status, 200);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('streams upstream body instead of eagerly buffering it', async (t) => {
  let buffered = false;
  t.mock.method(globalThis, 'fetch', async () => {
    const response = Response.json({ ok: true });
    response.text = async () => { buffered = true; throw new Error('buffered'); };
    return response;
  });
  const result = await worker.fetch(new Request('https://proxy.test/api/v3/time'), {});
  assert.equal(result.status, 200);
  assert.equal(buffered, false);
  assert.deepEqual(await result.json(), { ok: true });
});

test('handles upstream no-content status', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 204 }));
  const result = await worker.fetch(new Request('https://proxy.test/api/v3/time'), {});
  assert.equal(result.status, 204);
  assert.equal(await result.text(), '');
});

test('does not expose upstream exception text or signed URLs', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('signature=private-value'); });
  const result = await worker.fetch(new Request('https://proxy.test/api/v3/time'), {});
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes('private-value'), false);
});

test('secret guard and preflight never contact Binance', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected'); });
  assert.equal((await worker.fetch(new Request('https://proxy.test/api/v3/time'), { PROXY_SECRET: 'secret' })).status, 403);
  assert.equal((await worker.fetch(new Request('https://proxy.test/api/v3/time', { method: 'OPTIONS' }), {})).status, 200);
  assert.equal(mock.mock.callCount(), 0);
});

test('GET preserves query signature and does not invent a body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.binance.us/api/v3/account?timestamp=123&signature=abc');
    assert.equal(options.body, undefined);
    return Response.json({ ok: true });
  });
  assert.equal((await worker.fetch(new Request('https://proxy.test/api/v3/account?timestamp=123&signature=abc'), {})).status, 200);
});
