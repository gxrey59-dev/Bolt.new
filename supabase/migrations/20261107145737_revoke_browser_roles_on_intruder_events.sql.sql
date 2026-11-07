/*
# Lock down intruder_events from all browser roles

1. Summary
- The Supabase platform's default table privileges had granted anon and
  authenticated every verb on the new `intruder_events` table, including
  TRUNCATE, which bypasses row-level security and would let anyone wipe the
  intrusion log. This migration revokes every privilege from anon,
  authenticated, and the public role so ONLY service_role can touch the table.

2. Security changes
- REVOKE ALL on `intruder_events` FROM anon, authenticated, PUBLIC.
- service_role keeps full access (it is the only writer/reader, from server code).
- Row level security stays enabled with zero policies: deny-by-default.

3. Notes
- The edge functions that write intrusion events use the service role key, so
  they are unaffected. No browser path can read, write, or truncate the log.
*/

REVOKE ALL ON intruder_events FROM anon;
REVOKE ALL ON intruder_events FROM authenticated;
REVOKE ALL ON intruder_events FROM PUBLIC;
