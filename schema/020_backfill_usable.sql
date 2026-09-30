-- 020_backfill_usable.sql — RECORD of the one-off usable-sample backfill run
-- against production D1 (singlet-catalog) on 2026-09-30.
--
-- DO NOT re-run blindly. This file documents what was done; it is not a
-- migration. The live, incremental path is GET /api/ingest/refresh-next
-- (phase "usable flags", functions/_shared/catalog-refresh.ts: applyUsable),
-- which recomputes the same values study by study. If a bulk re-run is ever
-- needed, run it chunk by chunk from the D1 console, never as one statement:
-- json_each over every bundle_index row in one query exceeds D1's CPU limit.
--
-- Rule (must stay identical to applyUsable / matrixBytesByGsm / isUsable):
--   * bundle_index.entries is a JSON array of central-directory entries
--     [{p: path, n: method, c: compressed bytes, u: uncompressed, o: offset}].
--   * sample_qc.matrix_bytes = SUM(c) over entries whose path matches
--       ^samples/<GSM>/(any/sub/dirs/)?(exon|intron)_counts\.1pz$
--     for that row's gsm_id, in its own study's bundle; 0 when there is none.
--     (GLOB below is case-sensitive, like the JS regex.)
--   * sample_qc.usable = 1 when matrix_bytes > 400 (MIN_MATRIX_BYTES) AND
--     n_cells_called > 0, else 0 (NULL cells count as 0).
--   * gse_meta.n_usable_samples = COUNT of sample_qc rows with usable = 1.
--
-- Columns were created on demand by ensureCatalogColumns before this ran:
--   sample_qc.matrix_bytes INTEGER, sample_qc.usable INTEGER,
--   gse_meta.n_usable_samples INTEGER, gse_meta.reference_mismatch INTEGER.
--
-- Chunking: steps 1a–2 were run once per gse_id range, as string ranges on
-- the two leading digits ('GSE10' <= gse_id < 'GSE11', 'GSE11' .. 'GSE12', …,
-- 'GSE99' .. 'GSF'), which together cover every accession with two or more
-- digits. The literals below show one chunk; substitute each range in turn.

-- ── 1a. Reset matrix_bytes to 0 for indexed studies in the chunk ────────────
-- (applyUsable writes 0 for a sample with no matrix entry; step 1b only
-- touches samples that have at least one.)
UPDATE sample_qc
   SET matrix_bytes = 0
 WHERE gse_id >= 'GSE10' AND gse_id < 'GSE11'
   AND gse_id IN (SELECT gse_id FROM bundle_index WHERE gse_id >= 'GSE10' AND gse_id < 'GSE11');

-- ── 1b. Sum compressed exon + intron matrix bytes per sample ────────────────
UPDATE sample_qc
   SET matrix_bytes = mb.bytes
  FROM (
    SELECT i.gse_id AS gse_id,
           substr(json_extract(e.value, '$.p'), 9,
                  instr(substr(json_extract(e.value, '$.p'), 9), '/') - 1) AS gsm_id,
           SUM(COALESCE(json_extract(e.value, '$.c'), 0)) AS bytes
      FROM bundle_index i, json_each(i.entries) e
     WHERE i.gse_id >= 'GSE10' AND i.gse_id < 'GSE11'
       AND json_extract(e.value, '$.p') GLOB 'samples/GSM[0-9]*/*'
       AND (json_extract(e.value, '$.p') GLOB '*/exon_counts.1pz'
            OR json_extract(e.value, '$.p') GLOB '*/intron_counts.1pz')
     GROUP BY 1, 2
  ) AS mb
 WHERE sample_qc.gse_id = mb.gse_id
   AND sample_qc.gsm_id = mb.gsm_id;

-- ── 2. usable flag from matrix bytes + called cells ─────────────────────────
UPDATE sample_qc
   SET usable = CASE WHEN COALESCE(matrix_bytes, 0) > 400 AND COALESCE(n_cells_called, 0) > 0 THEN 1 ELSE 0 END
 WHERE gse_id >= 'GSE10' AND gse_id < 'GSE11'
   AND matrix_bytes IS NOT NULL;

-- ── 3. Per-study usable-sample count (after every chunk above) ──────────────
-- Same value recomputeMeta() writes. Studies with no assessed sample_qc rows
-- keep NULL, which search treats as "not yet assessed" (COALESCE(…, 1) in
-- DOWNLOADABLE_SQL) until refresh-next recomputes their gse_meta.
UPDATE gse_meta
   SET n_usable_samples = (SELECT COUNT(*) FROM sample_qc q WHERE q.gse_id = gse_meta.gse_id AND q.usable = 1)
 WHERE gse_id IN (SELECT DISTINCT gse_id FROM sample_qc WHERE usable IS NOT NULL);
