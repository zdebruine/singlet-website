/**
 * Study and sample search filters and facets on the structured sample type facts (./sample-type): tissue_type (CELLxGENE 7.0.0),
 * tumor_sample_type (GDC sample_type) from sample_property, and cell_line (Cellosaurus) from sample_term. A study matches when any of
 * its served samples does.
 */
import { sampleServedSql } from "./alpha";
import { TISSUE_TYPES, TUMOR_SAMPLE_TYPES } from "./sample-type";

export const TYPE_FILTERS = {
  tissue_type: { table: "property", values: TISSUE_TYPES },
  tumor_sample_type: { table: "property", values: TUMOR_SAMPLE_TYPES },
  cell_line: { table: "term", values: null },
} as const;
export type TypeFilterField = keyof typeof TYPE_FILTERS;
export const TYPE_FILTER_FIELDS = Object.keys(TYPE_FILTERS) as TypeFilterField[];

/** Lower-case enum values (underscores read as spaces), and Cellosaurus accessions in their CVCL_ form; anything else is dropped. */
export function normalizeTypeValues(field: TypeFilterField, values: string[]): string[] {
  const out = new Set<string>();
  const allowed = TYPE_FILTERS[field].values as readonly string[] | null;
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (allowed) {
      const e = v.toLowerCase().replace(/_/g, " ");
      if (allowed.includes(e)) out.add(e);
    } else {
      out.add(/^cvcl_/i.test(v) ? `CVCL_${v.slice(5).toUpperCase()}` : v.toLowerCase());
    }
  }
  return [...out];
}

/** The served samples (gsm_id, gse_id) carrying one of `vals` for the field. */
function samplesSql(field: TypeFilterField, vals: string[]): { sql: string; params: string[] } {
  const ph = vals.map(() => "?").join(", ");
  if (TYPE_FILTERS[field].table === "property") {
    return {
      sql: `SELECT tp.gsm_id, tp.gse_id FROM sample_property tp WHERE tp.property = '${field}' AND tp.value IN (${ph}) AND ${sampleServedSql("tp.gsm_id")}`,
      params: vals,
    };
  }
  // a cell line by accession, or by its Cellosaurus name or synonym
  return {
    sql: `SELECT tt.gsm_id, tt.gse_id FROM sample_term tt WHERE tt.attr = 'cell_line' AND (tt.term_id IN (${ph})
            OR tt.term_id IN (SELECT ol.term_id FROM ontology_label ol WHERE ol.ontology = 'Cellosaurus' AND ol.label_norm IN (${ph}))) AND ${sampleServedSql("tt.gsm_id")}`,
    params: [...vals, ...vals.map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())],
  };
}

export function typeStudyClause(field: TypeFilterField, vals: string[], gseCol: string): { sql: string; params: string[] } {
  const s = samplesSql(field, vals);
  return { sql: `${gseCol} IN (SELECT x.gse_id FROM (${s.sql}) x)`, params: s.params };
}

export function typeSampleClause(field: TypeFilterField, vals: string[], gsmCol: string): { sql: string; params: string[] } {
  const s = samplesSql(field, vals);
  return { sql: `${gsmCol} IN (SELECT x.gsm_id FROM (${s.sql}) x)`, params: s.params };
}

const FACET_LIMIT = 30;

/** One facet select over a base of studies (`gse_id`) or samples (`gsm_id`). */
export function typeFacetSelect(field: TypeFilterField, baseName: string, level: "gse" | "gsm"): string {
  const inBase = level === "gse" ? `x.gse_id IN (SELECT gse_id FROM ${baseName})` : `x.gsm_id IN (SELECT gsm_id FROM ${baseName})`;
  const count = level === "gse" ? "COUNT(DISTINCT x.gse_id)" : "COUNT(DISTINCT x.gsm_id)";
  if (TYPE_FILTERS[field].table === "property") {
    return `SELECT * FROM (SELECT '${field}' AS facet, x.value AS value, ${count} AS n FROM sample_property x
              WHERE x.property = '${field}' AND ${inBase} AND ${sampleServedSql("x.gsm_id")} GROUP BY x.value ORDER BY n DESC LIMIT ${FACET_LIMIT})`;
  }
  // the Cellosaurus name, which the filter also accepts (ontology_label), so a facet value can be sent back as is
  return `SELECT * FROM (SELECT '${field}' AS facet, COALESCE((SELECT ot.label FROM ontology_term ot WHERE ot.term_id = x.term_id), x.term_id) AS value,
            ${count} AS n FROM sample_term x
            WHERE x.attr = 'cell_line' AND ${inBase} AND ${sampleServedSql("x.gsm_id")} GROUP BY x.term_id ORDER BY n DESC LIMIT ${FACET_LIMIT})`;
}
