-- 038_s1_catalog.sql — the per-sample format is ".s1" (Singlet-Bio/singlet docs/format-s1.md, docs/s1-migration.md): the catalog
-- tables of schema/032 and 033 take the format's name, and the legacy-bundle retirement gets one switch.
--
--   v2_study / v2_sample / v2_migration  ->  s1_study / s1_sample / s1_migration, v2_migration.v2_bytes -> s1_bytes.
--   These are the tables and columns the transcode campaign's catalog SQL writes (scripts/s1_campaign.py catalog-sql: INSERT INTO
--   s1_sample ... ON CONFLICT(gse_id, rev, gsm_id); s1_study; s1_migration ... s1_bytes).
--
--   s1_flags  one row per serving switch. `legacy_bundles`:
--     'served'   (default) a study with a verified .s1 migration still offers its legacy data/<GSE>/<GSE>.singlet file;
--     'retired'  every study whose migration is `verified` is treated as `retired`: the catalog, API and MCP stop naming the legacy
--                URL, and the data-guard Worker answers 410 for data/<GSE>/* of those studies. Studies without a verified .s1
--                migration are not affected. Rollback = set it back to 'served' (no deploy).
--
-- Stored keys are not rewritten: rows written before this file name v2/ objects that exist in R2 (the data Worker still serves
-- v2/), and the campaign's catalog SQL replaces each study's rows with s1/ keys when its flip file is applied.
--
-- Apply BEFORE the code that reads s1_* is live (the deployed code reads v2_*; the compatibility views at the end keep those names
-- readable until the Pages deploy):
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/038_s1_catalog.sql
-- The v2_* views are dropped in the later cleanup, together with the v2/ R2 tree and the dual-read code.
DROP INDEX IF EXISTS idx_v2_sample_gsm;
DROP INDEX IF EXISTS idx_v2_migration_status;

ALTER TABLE v2_study RENAME TO s1_study;
ALTER TABLE v2_sample RENAME TO s1_sample;
ALTER TABLE v2_migration RENAME TO s1_migration;
ALTER TABLE s1_migration RENAME COLUMN v2_bytes TO s1_bytes;

CREATE INDEX IF NOT EXISTS idx_s1_sample_gsm ON s1_sample (gsm_id);
CREATE INDEX IF NOT EXISTS idx_s1_migration_status ON s1_migration (status);

CREATE TABLE IF NOT EXISTS s1_flags (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
INSERT OR IGNORE INTO s1_flags (name, value) VALUES ('legacy_bundles', 'served');

-- Compatibility views for readers still on the old names (dropped in the cleanup).
CREATE VIEW IF NOT EXISTS v2_study AS SELECT * FROM s1_study;
CREATE VIEW IF NOT EXISTS v2_sample AS SELECT * FROM s1_sample;
CREATE VIEW IF NOT EXISTS v2_migration AS SELECT *, s1_bytes AS v2_bytes FROM s1_migration;
