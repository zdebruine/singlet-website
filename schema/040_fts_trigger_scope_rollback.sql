-- Rollback for 040: the unscoped triggers exactly as production had them before (AFTER UPDATE ON <table>, any column).
-- Apply only after the owner has approved the write (see CLAUDE.md, "D1 writes cost money").

DROP TRIGGER IF EXISTS gse_au;
CREATE TRIGGER gse_au AFTER UPDATE ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;

DROP TRIGGER IF EXISTS gsm_au;
CREATE TRIGGER gsm_au AFTER UPDATE ON gsm BEGIN
  INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease, old.characteristics);
  INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease, new.characteristics);
END;
