-- 031_bundle_index_identity.sql — identity of the object each bundle_index row was read from.
--
-- bundle_index caches a study's zip central directory (entry names, sizes, local-header offsets). The object
-- under data/<GSE>/<GSE>.singlet is overwritten in place by repacks and by the 2026-10 restricted-sidecar
-- migration, which leaves the cached offsets pointing into a different file (docs/v2-migration.md, D13).
-- These columns record which object the offsets belong to:
--
--   etag           strong ETag of the object when the central directory was read, quoted as HTTP sends it.
--                  Ranged reads send it as If-Match, so an overwritten object answers 412 instead of other bytes.
--   last_modified  Last-Modified of that object (HTTP date), for people reading the table.
--   verified_at    when the offsets were last read from the object (ISO 8601, same as indexed_at).
--
-- Rows written before this file stay NULL in the new columns until the study is re-indexed; every read and
-- write in functions/_shared/bundle-reader.ts tolerates their absence, and the zip local-header check
-- (signature and entry name at the offset) needs no column at all. A missing column is remembered for a minute
-- and then tried again, so applying this file takes effect without a redeploy.
--
-- Apply BEFORE merging the code that fills the columns (it works either way, but until the columns exist the
-- If-Match half of the guard is off):
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/031_bundle_index_identity.sql
--
-- The ALTERs fail with "duplicate column name" on a second run; that is harmless. A fresh table created by
-- bundle-reader.ts already has the columns. Do not backfill with json_each over bundle_index (see
-- 020_backfill_usable.sql): the repair of stale rows re-reads each central directory, 25 studies per call.
ALTER TABLE bundle_index ADD COLUMN etag TEXT;
ALTER TABLE bundle_index ADD COLUMN last_modified TEXT;
ALTER TABLE bundle_index ADD COLUMN verified_at TEXT;
