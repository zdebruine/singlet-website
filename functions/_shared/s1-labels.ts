/**
 * The .s1 per-cell labels as sample and study facts (schema/039; labeller and validation: Singlet-Bio/singlet docs/cell_annotation.md).
 *
 *   sample_cell_summary (per sample and exact label term: cells)  --labelFactsSql-->  sample_attr (source = 'pipeline')
 *                                                                  --studyLabelSql-->  study_label (per study, served samples only)
 *
 * Facts written per sample, from the cells the labeller called:
 *   sex_genetic       female / male (PATO:0000383 / PATO:0000384) for each sex held by at least SEX_MIN_SHARE of the sample's
 *                     sexed cells, when at least MIN_CELLS cells are sexed (a pool of donors of both sexes gets both);
 *   ancestry_genetic  each HANCESTRO group held by at least ANCESTRY_MIN_SHARE of the sample's cells with an ancestry call;
 *   cell_type         each CL term with at least CELL_TYPE_MIN_SHARE of the sample's typed cells (and CELL_TYPE_MIN_CELLS cells),
 *                     counting a cell for its own term and every ancestor in the labeller's vocabulary (ontology_closure restricted
 *                     to label_term), so a query for "T cell" finds samples whose cells are called CD4 or CD8 T cells.
 *                     A cell-line sample (CELL_LINE_SAMPLES) gets its line instead: the labeller was trained on primary tissue and
 *                     its calls on cultured lines are often wrong. The Cellosaurus line its GEO record names, and CL:0000010
 *                     "cultured cell" for every cell-line sample, so a query for "cultured cell" finds them all.
 * `value_num` is the share of the sample's labelled cells, `evidence` says "<n> of <m> cells", `extractor_version` names the labels'
 * model version. These are public cell metadata; only raw genotype inputs are private, and none reach the catalog.
 *
 * Every statement takes an explicit list of studies (literal, validated accessions) so a load is chunked by study.
 */
import { sampleServedSql } from "./alpha";
import { HANCESTRO_LABELS } from "./hancestro";

export const LABEL_ATTRS = ["sex_genetic", "ancestry_genetic", "cell_type"] as const;
export type LabelAttr = (typeof LABEL_ATTRS)[number];

export const MIN_CELLS = 20;
export const SEX_MIN_SHARE = 0.2;
export const ANCESTRY_MIN_SHARE = 0.2;
export const CELL_TYPE_MIN_SHARE = 0.05;
export const CELL_TYPE_MIN_CELLS = 10;

/** Samples whose cells are a cultured cell line: a Cellosaurus line in their GEO record, or CELLxGENE tissue_type "cell line". */
export const CELL_LINE_SAMPLES = `(SELECT gsm_id FROM sample_term WHERE attr = 'cell_line' UNION SELECT gsm_id FROM sample_property WHERE property = 'tissue_type' AND value = 'cell line')`;
export const CULTURED_CELL = "CL:0000010";

/** The cell type facts of the cell-line samples of these studies: their line (Cellosaurus) and CL:0000010 "cultured cell". */
export function cellLineFactsSql(ids: string): string {
  return `${INSERT_ATTR}
SELECT c.gsm_id, c.gse_id, 'cell_type', c.term, c.label, c.term, 1.0, 'pipeline', NULL, c.evidence, 's1-labels cell-line', ${NOW}
FROM (
  SELECT t.gsm_id, t.gse_id, t.term_id AS term, COALESCE(o.label, t.term_id) AS label, 'cell line named in the GEO record' AS evidence
  FROM sample_term t LEFT JOIN ontology_term o ON o.term_id = t.term_id
  WHERE t.attr = 'cell_line' AND t.gse_id IN (${ids})
  UNION
  SELECT g.gsm_id, g.gse_id, '${CULTURED_CELL}', 'cultured cell', 'a cell-line sample'
  FROM ${CELL_LINE_SAMPLES} l JOIN gsm g ON g.gsm_id = l.gsm_id
  WHERE g.gse_id IN (${ids})
) c
WHERE true -- an upsert after a subquery needs a WHERE (SQLite parsing ambiguity)
${UPSERT_ATTR};`;
}

export { HANCESTRO_LABELS };

const GSE_RE = /^GSE\d{1,12}$/;

function idList(gses: string[]): string {
  if (!gses.length) throw new Error("no studies");
  for (const g of gses) if (!GSE_RE.test(g)) throw new Error(`not a GSE accession: ${g}`);
  return [...new Set(gses)].map((g) => `'${g}'`).join(", ");
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
const ATTR_LIST = LABEL_ATTRS.map((a) => `'${a}'`).join(", ");
const INSERT_ATTR = `INSERT INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, ontology_id, value_num, source, confidence, evidence, extractor_version, updated_at)`;
const UPSERT_ATTR = `ON CONFLICT(gsm_id, attr, source, value_norm) DO UPDATE SET ontology_id = excluded.ontology_id, value_num = excluded.value_num,
  evidence = excluded.evidence, extractor_version = excluded.extractor_version, updated_at = excluded.updated_at`;

/**
 * The statements that replace the label facts of these studies' samples in sample_attr (one study chunk; run in order, or as one
 * atomic file). Reads sample_cell_summary, ontology_closure and ontology_term.
 */
export function labelFactsSql(gses: string[]): string[] {
  const ids = idList(gses);
  const hanc = Object.entries(HANCESTRO_LABELS)
    .map(([id, label]) => `WHEN '${id}' THEN '${label}'`)
    .join(" ");
  return [
    `DELETE FROM sample_attr WHERE source = 'pipeline' AND attr IN (${ATTR_LIST}) AND gse_id IN (${ids});`,
    // sex: items are PATO ids ("ambiguous" is not exported by the index build)
    `${INSERT_ATTR}
SELECT s.gsm_id, s.gse_id, 'sex_genetic', s.item,
  CASE s.item WHEN 'PATO:0000383' THEN 'female' ELSE 'male' END, s.item,
  ROUND(1.0 * s.n_cells / t.n, 4), 'pipeline', NULL, s.n_cells || ' of ' || t.n || ' sexed cells', 's1-labels ' || s.version, ${NOW}
FROM sample_cell_summary s
JOIN (SELECT gsm_id, SUM(n_cells) AS n FROM sample_cell_summary WHERE subject = 'sex' AND gse_id IN (${ids}) GROUP BY gsm_id) t ON t.gsm_id = s.gsm_id
WHERE s.subject = 'sex' AND s.gse_id IN (${ids}) AND s.item IN ('PATO:0000383', 'PATO:0000384')
  AND t.n >= ${MIN_CELLS} AND s.n_cells >= ${SEX_MIN_SHARE} * t.n
${UPSERT_ATTR};`,
    `${INSERT_ATTR}
SELECT s.gsm_id, s.gse_id, 'ancestry_genetic', s.item,
  CASE s.item ${hanc} ELSE COALESCE((SELECT NULLIF(label, term_id) FROM label_term l WHERE l.term_id = s.item), (SELECT label FROM ontology_term o WHERE o.term_id = s.item), s.item) END, s.item,
  ROUND(1.0 * s.n_cells / t.n, 4), 'pipeline', NULL, s.n_cells || ' of ' || t.n || ' cells with an ancestry call', 's1-labels ' || s.version, ${NOW}
FROM sample_cell_summary s
JOIN (SELECT gsm_id, SUM(n_cells) AS n FROM sample_cell_summary WHERE subject = 'ancestry' AND gse_id IN (${ids}) GROUP BY gsm_id) t ON t.gsm_id = s.gsm_id
WHERE s.subject = 'ancestry' AND s.gse_id IN (${ids}) AND t.n >= ${MIN_CELLS} AND s.n_cells >= ${ANCESTRY_MIN_SHARE} * t.n
${UPSERT_ATTR};`,
    // cell type: each call counts for its own term and every ancestor that is itself a call somewhere (the labeller's levels)
    `${INSERT_ATTR}
SELECT r.gsm_id, r.gse_id, 'cell_type', r.term,
  COALESCE((SELECT NULLIF(label, term_id) FROM label_term l WHERE l.term_id = r.term), (SELECT label FROM ontology_term o WHERE o.term_id = r.term), r.term), r.term,
  ROUND(1.0 * r.n / t.n, 4), 'pipeline', NULL, r.n || ' of ' || t.n || ' typed cells', 's1-labels ' || r.version, ${NOW}
FROM (
  SELECT s.gsm_id, s.gse_id, c.ancestor_id AS term, SUM(s.n_cells) AS n, MAX(s.version) AS version
  FROM sample_cell_summary s
  JOIN (SELECT term_id, ancestor_id FROM ontology_closure
          WHERE ancestor_id IN (SELECT term_id FROM label_term WHERE subject = 'cell_type')
        UNION SELECT DISTINCT item, item FROM sample_cell_summary WHERE subject = 'cell_type' AND gse_id IN (${ids})) c ON c.term_id = s.item
  WHERE s.subject = 'cell_type' AND s.gse_id IN (${ids}) AND s.gsm_id NOT IN ${CELL_LINE_SAMPLES}
  GROUP BY s.gsm_id, s.gse_id, c.ancestor_id
) r
JOIN (SELECT gsm_id, SUM(n_cells) AS n FROM sample_cell_summary WHERE subject = 'cell_type' AND gse_id IN (${ids}) GROUP BY gsm_id) t ON t.gsm_id = r.gsm_id
WHERE t.n >= ${MIN_CELLS} AND r.n >= ${CELL_TYPE_MIN_CELLS} AND r.n >= ${CELL_TYPE_MIN_SHARE} * t.n
${UPSERT_ATTR};`,
    cellLineFactsSql(ids),
  ];
}

/**
 * One-time fix of a loaded catalog (scripts/s1/cell-line-types.ts): every cell-line sample's labeller cell-type facts replaced by
 * its line (cellLineFactsSql), and the cell-type rows of its studies' study_label rebuilt. Idempotent.
 */
export function cellLineFixSql(): string[] {
  const studies = `SELECT gse_id FROM gsm WHERE gsm_id IN ${CELL_LINE_SAMPLES}`;
  return [
    `DELETE FROM sample_attr WHERE source = 'pipeline' AND attr = 'cell_type' AND gsm_id IN ${CELL_LINE_SAMPLES};`,
    cellLineFactsSql(studies),
    `DELETE FROM study_label WHERE attr = 'cell_type' AND gse_id IN (${studies});`,
    `INSERT INTO study_label (gse_id, attr, value, ontology_id, n_samples, updated_at)
SELECT a.gse_id, a.attr, a.value_norm, MAX(a.ontology_id), COUNT(DISTINCT a.gsm_id), ${NOW}
FROM sample_attr a
WHERE a.source = 'pipeline' AND a.attr = 'cell_type' AND a.gse_id IN (${studies}) AND ${sampleServedSql("a.gsm_id")}
GROUP BY a.gse_id, a.attr, a.value_norm;`,
  ];
}

/** The statements that rebuild study_label for these studies from their served samples' label facts. */
export function studyLabelSql(gses: string[]): string[] {
  const ids = idList(gses);
  return [
    `DELETE FROM study_label WHERE gse_id IN (${ids});`,
    `INSERT INTO study_label (gse_id, attr, value, ontology_id, n_samples, updated_at)
SELECT a.gse_id, a.attr, a.value_norm, MAX(a.ontology_id), COUNT(DISTINCT a.gsm_id), ${NOW}
FROM sample_attr a
WHERE a.source = 'pipeline' AND a.attr IN (${ATTR_LIST}) AND a.gse_id IN (${ids}) AND ${sampleServedSql("a.gsm_id")}
GROUP BY a.gse_id, a.attr, a.value_norm;`,
  ];
}

export interface CellLine {
  /** CVCL_xxxx, or CL:0000010 for a cell line the record does not name */
  id: string;
  label: string;
}

/** The cell line of each of these samples that is one (CELL_LINE_SAMPLES): the named Cellosaurus line first, else "cultured cell". */
export async function cellLinesOf(db: D1Database, gsms: string[]): Promise<Map<string, CellLine>> {
  const out = new Map<string, CellLine>();
  for (let i = 0; i < gsms.length; i += 90) {
    const chunk = gsms.slice(i, i + 90);
    const marks = chunk.map(() => "?").join(",");
    try {
      const rs = await db
        .prepare(
          `SELECT t.gsm_id, t.term_id AS id, COALESCE(o.label, t.term_id) AS label, 0 AS rank FROM sample_term t LEFT JOIN ontology_term o ON o.term_id = t.term_id
           WHERE t.attr = 'cell_line' AND t.gsm_id IN (${marks})
           UNION ALL SELECT gsm_id, '${CULTURED_CELL}', 'cultured cell', 1 FROM sample_property WHERE property = 'tissue_type' AND value = 'cell line' AND gsm_id IN (${marks})
           ORDER BY rank`
        )
        .bind(...chunk, ...chunk)
        .all<{ gsm_id: string; id: string; label: string }>();
      for (const r of rs.results ?? []) if (!out.has(r.gsm_id)) out.set(r.gsm_id, { id: r.id, label: r.label });
    } catch (e) {
      if (!/no such table/i.test(String(e))) throw e;
    }
  }
  return out;
}

// ── search ──────────────────────────────────────────────────────────────────

/** Search filter field -> sample_attr / study_label attribute. */
export const LABEL_FILTERS = { sex_genetic: "sex_genetic", ancestry_genetic: "ancestry_genetic", cell_type_label: "cell_type" } as const;
export type LabelFilterField = keyof typeof LABEL_FILTERS;
export const LABEL_FILTER_FIELDS = Object.keys(LABEL_FILTERS) as LabelFilterField[];

/** Values as they are matched: lower-case labels, and ontology ids in their canonical upper-case prefix form. */
export function normalizeLabelValues(values: string[]): string[] {
  const out = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    out.add(/^[a-z]+:\d+$/i.test(v) ? v.toUpperCase() : v.toLowerCase());
  }
  return [...out];
}

/**
 * SQL (and its params) matching rows of `table` (`a` alias with value column `valueCol`) for one label filter: a value matches the
 * stored label case-insensitively or the stored ontology id.
 */
export function labelMatchSql(alias: string, valueCol: string, values: string[]): { sql: string; params: string[] } {
  const marks = values.map(() => "?").join(",");
  return { sql: `(lower(${alias}.${valueCol}) IN (${marks}) OR ${alias}.ontology_id IN (${marks}))`, params: [...values, ...values] };
}
