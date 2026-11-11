/* Run with a dev server and Playwright installed: node scripts/browser-smoke.cjs.
   Every non-local request is intercepted; this suite never contacts live services. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(15_000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let offline = false;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
        let body = [];
        let status = 200;
        if (url.pathname.endsWith('/rpc/is_app_operator')) body = true;
        if (url.pathname.includes('/functions/v1/')) {
          if (offline) { status = 503; body = { error: 'Fixture outage' }; }
          else if (url.pathname.endsWith('/config')) body = { paperMode: false, killSwitch: false, liveCapital: 10, dailyLossAccumulator: 0.4, maxDailyLossPct: 5 };
          else if (url.pathname.endsWith('/positions')) body = { openPositions: [] };
          else if (url.pathname.endsWith('/dashboard-data')) body = { factions: [], signals: [], sweeps: [], breakers: [], sentiment: null, audit: [{ id: 'fixture', event_type: 'strategy_scan', message: 'Fixture scan: 0 positions opened.', created_at: new Date().toISOString() }] };
          else if (url.pathname.endsWith('/sprint-data')) body = { trades: [], truncated: false, refreshedAt: new Date().toISOString() };
        }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': 'Content-Range', 'Content-Range': '*/0' } });
      });
      await page.goto(process.env.APP_URL || 'http://127.0.0.1:5174');
      await page.getByText('Reporting', { exact: true }).waitFor();
      assert.ok(await page.getByRole('heading', { name: 'Every position. Every payment. A clearer picture.' }).isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.screenshot({ path: `/tmp/bolt-overview-${viewport.width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Open Live Execution' }).click();
      await page.getByRole('heading', { name: 'Operator access required' }).waitFor();
      await page.goBack();
      await page.getByText('Reporting', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Review revenue', exact: true }).click();
      await page.getByRole('heading', { name: 'Operator access required' }).waitFor();
      await page.evaluate(() => localStorage.setItem('sb-bydbweyercozwdxcbase-auth-token', JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: '00000000-0000-0000-0000-000000000001', email: 'operator@example.invalid' } })));
      await page.reload();
      await page.getByRole('heading', { name: 'Revenue Command Center' }).waitFor();
      await page.getByText('0 verified closed trades', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Overview', exact: true }).click();
      offline = true;
      await page.getByRole('button', { name: 'Refresh overview' }).click();
      await page.getByRole('alert').filter({ hasText: 'Recorded positions could not be refreshed' }).waitFor();
      assert.equal(await page.getByText('Reporting', { exact: true }).count(), 0);
      assert.equal(errors.length, 0, errors.join('\n'));
      await page.close();
      console.log(`PASS ${viewport.width}px: overview, mobile overflow, operator gate, browser back, revenue, outage state`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
