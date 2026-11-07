/*
# Security audit fixes: gate public endpoints and tighten allowlist grants

1. Restrict the Bot Pair Allowlist table
- Revoke the INSERT and DELETE grant that `anon` and `authenticated` hold on
  `bot_pair_allowlist`. The original intent was read-only for the browser and
  operator-only updates, but a broad grant had given the anonymous browser role
  INSERT and DELETE. Table-level privileges cannot be revoked per-verb in a
  reversible single statement, so this migration drops the too-broad grants and
  re-grants only SELECT (anon + authenticated) and column-scoped UPDATE
  (authenticated). The service role retains the SELECT grant it already has.

2. No schema/RLS changes to data tables.

3. Security
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then re-grant SELECT to
  anon/authenticated and column-scoped UPDATE to authenticated on
  `bot_pair_allowlist`.
- Keeps RLS policies unchanged (they already gate writes behindis_app_operator()).
*/

REVOKE ALL ON public.bot_pair_allowlist FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.bot_pair_allowlist TO anon, authenticated;
GRANT UPDATE (enabled, updated_at) ON public.bot_pair_allowlist TO authenticated;
