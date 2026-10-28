-- 040: scope the full-text triggers on gse / gsm to the columns that are indexed.
--
-- gse_au and gsm_au fired on every UPDATE of any column and rewrote the row in fts_gse / fts_gsm (an FTS5 'delete' plus an
-- insert, a dozen or more D1 rows written). The pipeline updates bookkeeping columns far more often than text: r2_bundle_key,
-- r2_bundle_bytes, last_updated, status, n_cells, organism_primary, tissue_group, ... None of those are in the FTS index.
-- In the Sep 27 - Oct 26 2026 cycle D1 rows written cost $370 of a $429.74 usage bill; see docs/CLOUDFLARE_COST_PLAN.md.
--
-- `AFTER UPDATE OF <cols>` fires only when one of the listed columns appears in the SET clause (SQLite compares the column
-- list, not the values), so a text change still reindexes and a bookkeeping change does not. The bodies are unchanged.
-- INSERT and DELETE triggers (gse_ai, gse_ad, gsm_ai, gsm_ad) are not touched.
--
-- Apply once to production BEFORE merging, after the owner has approved the write estimate (CLAUDE.md, "D1 writes cost money"):
--   wrangler d1 execute singlet-catalog --remote --file=schema/040_fts_trigger_scope.sql
-- It is 4 DDL statements (about 8 rows written in sqlite_master). Rollback is schema/040_fts_trigger_scope_rollback.sql.

DROP TRIGGER IF EXISTS gse_au;
CREATE TRIGGER gse_au AFTER UPDATE OF id, title, abstract, organism ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;

DROP TRIGGER IF EXISTS gsm_au;
CREATE TRIGGER gsm_au AFTER UPDATE OF gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics ON gsm BEGIN
  INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease, old.characteristics);
  INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease, new.characteristics);
END;
