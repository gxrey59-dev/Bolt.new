-- The signals table defined batch_id as integer, but the engine
-- generates UUID strings for batch IDs. Change the column to uuid
-- to match the actual data being inserted.

-- Clear any incompatible rows first (table is ephemeral simulation data).
DELETE FROM signals WHERE batch_id IS NOT NULL;

ALTER TABLE signals
  ALTER COLUMN batch_id TYPE uuid USING NULL;

-- Recreate the index with the new type.
DROP INDEX IF EXISTS idx_signals_batch;
CREATE INDEX idx_signals_batch ON signals(batch_id);
