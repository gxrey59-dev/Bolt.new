# Project memory

## Product intent & audience

- Multi-agent trading ecosystem orchestrating 50,000 worker bots across nine specialized factions.
- Centralized risk control with automated profit harvesting.
- Backend integrates with Binance via a Cloudflare Worker proxy relay.
- Audience: internal operators/admins managing bot fleet, risk, and revenue collection.

## Brand personality & voice

- Operator-facing: precise, security-conscious, procedural.
- Communication favors verified status and clear next steps over marketing tone.

## Visual design & UX direction

- Vite + React stack; Tailwind CSS for styling, Lucide React for icons.
- Import via `@/` path alias (maps to `src/`); avoid deep relative imports.
- Production-grade UI expected; avoid cookie-cutter templates.

## Decisions, constraints & rationale

- Secrets are stored server-side in Supabase `internal_secrets` table; only service role can read. Browser/anonymous roles have no access.
- Secret rotation replaces lost secrets with a fresh 256-bit (64-char) random value; old secret retired.
- Backend functions read `proxy_secret` from `internal_secrets`, with fallback to prior setting if row missing.
- Cloudflare Worker must have `PROXY_SECRET` set via `wrangler secret put` **before** deploy; hardened worker refuses to relay without it.
- Direct Binance route remains as fallback when proxy not configured, so nothing breaks mid-rotation.
- Secret values are never pasted in chat; operator retrieves via SQL Editor query.
- Project has 87 tests; type check and tests must pass before deploy.

## Open questions & assumptions

- Cloudflare side not yet configured; awaiting operator completion of `wrangler secret put` + `wrangler deploy`.
- Live relay check pending to confirm Supabase and Cloudflare secrets match.
- Assumption: operator has Supabase dashboard and Cloudflare CLI access to complete manual steps.