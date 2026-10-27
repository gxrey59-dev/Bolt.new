# Bolt.new

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-gxmkdxh3)

## Run locally

```bash
npm ci
npm run dev
```

The app defaults to the existing Supabase backend. To use another project,
create a `.env` file containing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`.

## Production

The production build is published from the `gh-pages` branch. Supabase Edge
Functions and PostgreSQL cron jobs provide the always-on backend independently
of the browser session.
