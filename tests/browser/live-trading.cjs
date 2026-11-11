// Run against the local Vite dev server: APP_URL=http://127.0.0.1:5176 node tests/browser/live-trading.cjs
// Every external request is intercepted; order requests never reach an exchange.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const appUrl = process.env.APP_URL || 'http://127.0.0.1:5176';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let positionsFailed = false;
    let closeCalls = 0;
    await page.addInitScript(() => {
      localStorage.setItem('sb-bydbweyercozwdxcbase-auth-token', JSON.stringify({
        access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '00000000-0000-0000-0000-000000000001', email: 'operator@example.invalid' },
      }));
    });
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === new URL(appUrl).origin) return route.continue();
      let body = {};
      let status = 200;
      if (url.pathname.endsWith('/rpc/is_app_operator')) body = true;
      else if (url.pathname.endsWith('/positions')) {
        if (positionsFailed) { status = 503; body = { error: 'Position database unavailable' }; }
        else body = { count: 1, openPositions: [{
          id: 'axs-position', symbol: 'AXSUSDT', faction_id: 'shaolin', side: 'long', strategy: 'mean_reversion',
          status: 'open', is_live: true, entry_price: 0.846, quantity: 6.82, remaining_quantity: 6.82,
          position_value: 5.77, stop_loss: 0.8, take_profit: 0.9, opened_at: new Date().toISOString(),
          current_price: null, unrealized_pnl: null, runner_pnl: null, pnl_pct: null, price_available: false,
          execution_error: closeCalls ? 'Exchange sale failed: insufficient balance' : null,
        }] };
      } else if (url.pathname.endsWith('/close-all')) {
        assert.equal(request.method(), 'POST');
        closeCalls++;
        body = { closedByRules: 0, forceClosed: 0, total: 0, failed: 1, remainingOpen: 1, complete: false,
          failures: [{ tradeId: 'axs-position', symbol: 'AXSUSDT', error: 'Exchange sale failed: insufficient balance' }] };
      } else if (url.pathname.endsWith('/config')) body = {
        paperMode: false, killSwitch: false, liveCapital: 6, dailyLossAccumulator: 0, maxDailyLossPct: 10,
        minWinRateThreshold: 30, stopLossPct: 1, takeProfitPct: 3, maxPositionPct: 10, strategyWinRates: {},
      };
      else if (url.pathname.endsWith('/account')) body = { ok: true, balances: [{ asset: 'USDT', free: 6, locked: 0 }], fetchedAt: new Date().toISOString() };
      else if (url.pathname.endsWith('/prices')) body = { tickers: [{ symbol: 'AXSUSDT', price: 0.846, priceChangePercent: 0, volume: 1, high: 0.9, low: 0.8 }] };
      else if (url.pathname.includes('/rest/v1/')) body = [];
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    });
    await page.goto(`${appUrl}/#live`);
    await page.getByText('Quote unavailable', { exact: true }).waitFor({ timeout: 15000 });
    await page.getByText('Some position quotes are unavailable.', { exact: false }).waitFor();
    assert.ok((await page.getByText('Unrealized', { exact: true }).locator('../..').innerText()).includes('—'));
    assert.equal(await page.getByText('Equity', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Close All', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Close All', exact: true }).click();
    await page.getByText('0 positions closed. 1 close failed; 1 remain open.', { exact: false }).waitFor();
    await page.getByText('Close needs attention:', { exact: false }).waitFor();
    assert.equal(closeCalls, 1);
    positionsFailed = true;
    await page.reload();
    await page.getByText('Position database unavailable', { exact: false }).waitFor();
    assert.equal(await page.getByText('Open positions could not be confirmed.', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Position count unavailable', { exact: true }).count(), 1);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: missing quotes withhold P&L, partial close stays visibly failed, failed positions fetch stays unknown, no browser errors, all exchange traffic mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
