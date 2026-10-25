-- 036_store_rename.sql — the per-sample format is called "store", not "v2": v2_study / v2_sample / v2_migration become
-- store_study / store_sample / store_migration, v2_migration.v2_bytes becomes store_bytes, and stored R2 keys move from the
-- v2/ prefix to store/ (sample objects .s2 -> .s1; ledger_key is left alone).
--
-- Apply BEFORE the code that reads store_* is live (the old code reads v2_*; the compatibility views at the end keep the old
-- names readable in the meantime):
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/036_store_rename.sql
-- `rev` values (a hash that covers the keys) are updated separately by the rekey step; the orchestrator supplies that SQL.
-- The three v2_* views at the end are dropped in the later cleanup, together with the v2/ R2 tree and the dual-read code.
DROP INDEX IF EXISTS idx_v2_sample_gsm;
DROP INDEX IF EXISTS idx_v2_migration_status;

ALTER TABLE v2_study RENAME TO store_study;
ALTER TABLE v2_sample RENAME TO store_sample;
ALTER TABLE v2_migration RENAME TO store_migration;
ALTER TABLE store_migration RENAME COLUMN v2_bytes TO store_bytes;

CREATE INDEX IF NOT EXISTS idx_store_sample_gsm ON store_sample (gsm_id);
CREATE INDEX IF NOT EXISTS idx_store_migration_status ON store_migration (status);

UPDATE store_study SET manifest_key = 'store/' || substr(manifest_key, 4) WHERE manifest_key LIKE 'v2/%';
UPDATE store_sample SET key = replace('store/' || substr(key, 4), '.s2', '.s1') WHERE key LIKE 'v2/%';

-- Compatibility views for readers still on the old names (dropped in the cleanup).
CREATE VIEW v2_study AS SELECT * FROM store_study;
CREATE VIEW v2_sample AS SELECT * FROM store_sample;
CREATE VIEW v2_migration AS SELECT *, store_bytes AS v2_bytes FROM store_migration;
