/*
# Restrict anonymous audit log reads

1. Problem
- Anonymous visitors (the public anon key) could read every column of the audit log.
- Some audit rows store withdrawal destination addresses and exchange responses in their metadata.

2. Changes
- Remove table-wide read access from the anonymous role on the audit log.
- Grant anonymous read access only to the columns the public live execution feed uses: id, event_type, entity_type, entity_id, message, created_at.
- The metadata column is no longer readable anonymously.

3. Unchanged
- Signed-in operators keep full access through the existing authenticated grant and operator read policy.
- The existing public read policy stays in place; column grants now limit what it exposes.

4. Notes
- The public live execution feed reads only message, event_type and created_at, so it keeps working.
- Anonymous requests that select all columns will now be rejected, which is intended.
*/

REVOKE SELECT ON audit_log FROM anon;
GRANT SELECT (id, event_type, entity_type, entity_id, message, created_at) ON audit_log TO anon;
