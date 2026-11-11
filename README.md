# Wu-Tang Financial Weapon — revenue workspace

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-gxmkdxh3)

Trading operations, exchange reconciliation, revenue reporting, and paid digital products, built with React, Vite, Supabase Edge Functions, and Stripe.

## Run locally

Use Node.js 24 or later. Copy `.env.example` to `.env.local` and set the project's public Supabase URL/key. The public key enables sign-in; operator privileges are assigned server-side. Never put exchange keys, Stripe secrets, or a Supabase service-role key in a `VITE_` variable.

```bash
npm ci
npm run dev
```

Without a configured public key, the existing public telemetry service remains readable, and operator/account access shows a configuration message.

## Validation

```bash
npm run check
```

This runs frontend TypeScript, ESLint, unit and PostgreSQL transaction tests, and the production build. The test runner requires Node 24 and makes no live exchange or Stripe calls.

With Playwright and Chromium installed, start the dev server, then run the mocked browser checks:

```bash
APP_URL=http://127.0.0.1:5173 node scripts/browser-smoke.cjs
APP_URL=http://127.0.0.1:5173 node tests/browser/execution.cjs
APP_URL=http://127.0.0.1:5173 node tests/browser/live-trading.cjs
```

Set `CHROMIUM_PATH` if Chromium is installed elsewhere. Every external browser request is mocked. These checks cover layout, navigation, operator gating, missing quotes, failed closes, stale exchange data, and incomplete P&L; they do not establish live account balances or payment acceptance.

## Production

The existing site is published from `gh-pages`; Supabase functions and PostgreSQL cron jobs run independently of browser sessions. For GitHub Pages, build with `BASE_PATH=/Bolt.new/`.

This release changes backend contracts. Follow [RELEASE.md](docs/RELEASE.md) and [payment rollout instructions](docs/PAYMENTS_RELEASE.md) before publishing the frontend. The CI workflow validates changes and does not deploy or activate trading.
