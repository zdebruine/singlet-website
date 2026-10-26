/**
 * Paged, read-only export of what the cohort bit index is built from (scripts/search-index/build-index.ts), served
 * by GET /api/ingest/export so the nightly Action needs the ingest token and nothing else.
 *
 *   samples      one row per processed sample, the flat shape build-index.ts --samples reads (keyset on gsm_id)
 *   studies      one row per study with the file layers its bundle holds (keyset on gse_id); the client adds `layer`
 *                to its samples, which keeps the per-study file listing out of the per-sample query
 *   sample_attr  extracted facts for the attributes the index has a column for (keyset on gsm_id, whole samples per page)
 *
 * Fields are the ones the index holds already: accession ids, catalog labels, QC tier and the downloadable flag.
 * Nothing private is exported. Each page is one D1 statement with two bound values.
 *
 * Research Alpha (./alpha): samples that are not part of the atlas and withheld studies are not exported, so the next
 * nightly build drops them from the cohort index; layers Alpha does not offer (mtDNA, doublets, the legacy sex call) are
 * not listed. Pipeline facts `sex_genetic` and `ancestry_genetic` (the s1 labeller's per-sample summaries, written to
 * sample_attr with source = pipeline) are exported, so the cohort index's existing attributes of those names fill in.
 */
import { sampleServedSql, studyServedSql } from "./alpha";

export const EXPORT_TABLES = ["samples", "studies", "sample_attr"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

export const EXPORT_DEFAULT_LIMIT = 1000;
export const EXPORT_MAX_LIMIT = 5000;

/** `downloadable` is the DOWNLOADABLE_SQL rule (search-core.ts) for the sample's study; `usable` and `qc_tier` come from sample_qc. */
const SAMPLES_SQL = `
SELECT
  s.gsm_id,
  s.gse_id,
  COALESCE(q.n_cells_called, 0)                              AS n_cells,
  s.organism_primary                                         AS organism,
  s.tissue_group,
  s.tissue,
  s.disease_group,
  s.disease,
  CASE WHEN LOWER(s.sex) IN ('male', 'female') THEN LOWER(s.sex) END AS sex,
  q.protocol                                                 AS chemistry,
  q.singlet_version                                          AS pipeline_version,
  CASE WHEN q.gsm_id IS NULL THEN NULL ELSE CAST(COALESCE(q.qc_tier, 0) AS TEXT) END AS qc_tier,
  CASE WHEN q.usable = 1 THEN '1' END                        AS usable,
  CASE WHEN m.has_bundle = 1 AND COALESCE(m.n_usable_samples, 1) > 0 AND COALESCE(m.reference_mismatch, 0) = 0 THEN '1' END AS downloadable,
  m.year
FROM gsm s
LEFT JOIN sample_qc q ON q.gsm_id = s.gsm_id
LEFT JOIN gse_meta m  ON m.gse_id = s.gse_id
WHERE s.status = 'DONE' AND s.gsm_id > ? AND ${sampleServedSql("s.gsm_id")} AND ${studyServedSql("s.gse_id")}
ORDER BY s.gsm_id
LIMIT ?`;

/** What each study's file holds (the per-study part of the old export-samples.sql). The legacy sex_call.json is not a layer in Alpha. */
const STUDIES_SQL = `
SELECT b.gse_id,
  TRIM(
    CASE WHEN b.entries LIKE '%exon_counts.1pz%'       THEN 'gene_counts|' ELSE '' END ||
    CASE WHEN b.entries LIKE '%intron_counts.1pz%'     THEN 'splicing|'    ELSE '' END ||
    CASE WHEN b.entries LIKE '%sj_counts.1pz%'         THEN 'junctions|'   ELSE '' END ||
    CASE WHEN b.entries LIKE '%vdj_gene_usage.1pz%'    THEN 'vdj|'         ELSE '' END ||
    CASE WHEN b.entries LIKE '%donor_assignments.tsv%' THEN 'donors|'      ELSE '' END,
    '|') AS layer
FROM bundle_index b
LEFT JOIN gse_meta m ON m.gse_id = b.gse_id
WHERE b.gse_id > ? AND ${studyServedSql("b.gse_id")}
ORDER BY b.gse_id
LIMIT ?`;

const ATTR_SQL = `
SELECT a.gsm_id, a.attr, a.value_norm, a.value_num, a.unit, a.source, a.confidence
FROM sample_attr a
JOIN gsm s ON s.gsm_id = a.gsm_id AND s.status = 'DONE' AND ${sampleServedSql("s.gsm_id")} AND ${studyServedSql("s.gse_id")}
WHERE a.attr IN ('tissue', 'disease', 'disease_state', 'sex', 'sex_genetic', 'ancestry_genetic', 'age', 'life_stage', 'sample_type', 'treatment_status')
  AND a.gsm_id > ?
ORDER BY a.gsm_id, a.attr, a.source, a.value_norm
LIMIT ?`;

const SAMPLE_COLUMNS = ["gsm_id", "gse_id", "n_cells", "organism", "tissue_group", "tissue", "disease_group", "disease", "sex", "chemistry", "pipeline_version", "qc_tier", "usable", "downloadable", "year"];
const ATTR_COLUMNS = ["gsm_id", "attr", "value_norm", "value_num", "unit", "source", "confidence"];

export interface ExportPage {
  table: ExportTable;
  columns: string[];
  rows: unknown[][];
  /** Pass as `after` for the next page; null when this was the last. */
  next: string | null;
}

export function parseExportLimit(raw: string | null): number | null {
  if (raw == null || raw === "") return EXPORT_DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= EXPORT_MAX_LIMIT ? n : null;
}

export async function exportPage(db: D1Database, table: ExportTable, after: string, limit: number): Promise<ExportPage> {
  const sql = table === "samples" ? SAMPLES_SQL : table === "studies" ? STUDIES_SQL : ATTR_SQL;
  const { results } = await db.prepare(sql).bind(after, limit).all<Record<string, unknown>>();
  let rows = results;
  const key = table === "studies" ? "gse_id" : "gsm_id";
  let next: string | null = null;
  if (rows.length === limit) {
    if (table === "sample_attr") {
      // The cursor is a sample, so a page ends on a sample boundary: drop the last sample's rows, the next page has them whole.
      const last = rows[rows.length - 1].gsm_id;
      const cut = rows.findIndex((r) => r.gsm_id === last);
      if (cut > 0) rows = rows.slice(0, cut);
    }
    next = String(rows[rows.length - 1][key]);
  }
  const columns = table === "samples" ? SAMPLE_COLUMNS : table === "studies" ? ["gse_id", "layer"] : ATTR_COLUMNS;
  return { table, columns, rows: rows.map((r) => columns.map((c) => r[c] ?? null)), next };
}
