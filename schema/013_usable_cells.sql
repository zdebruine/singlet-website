-- gse_meta.n_usable_cells: cells called in a study's usable samples. Default
-- searches total their results from it (and n_usable_samples), the same basis as
-- /api/stats, so the numbers on the home page and in search agree.
--
-- The column is created on demand by ensureCatalogColumns (functions/_shared/
-- catalog-refresh.ts) the first time any request needs it, and refresh-next fills
-- it as it recomputes each study. Until every row is filled, search falls back to
-- the catalog count for cells. This backfill fills all rows at once; run it after
-- the column exists (any API request creates it), and re-run safely:
--   npx wrangler d1 execute singlet-catalog --remote --file=schema/013_usable_cells.sql
UPDATE gse_meta
   SET n_usable_cells = (SELECT COALESCE(SUM(q.n_cells_called), 0) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1)
 WHERE has_bundle = 1;
