/**
 * Ontology-aware sample filters (schema/034_ontology.sql).
 *
 * `sample_term` holds one row per (sample, attribute, term) mapped from `sample_attr` by
 * scripts/ontology/ (docs/ONTOLOGY.md). `ontology_closure` lists every (term, ancestor) pair over is_a and
 * part_of, the term itself included, so a filter on an ancestor ("T cell", "lung") matches every sample mapped
 * to one of its descendants ("CD4-positive, alpha-beta T cell", "upper lobe of left lung"). `ontology_label`
 * resolves a filter value to terms: the id itself ("UBERON:0002048", "UBERON_0002048"), the primary label or an
 * exact synonym, case-insensitively.
 *
 * The same ontologies label cells (CL for cell type, HANCESTRO for inferred ancestry, PATO for sex), so
 * sample and cell filters take the same ids.
 */

/** Filter name (API parameter `<name>_term`, MCP argument of the same name) → sample_term.attr and ontologies. */
export const TERM_FILTERS = {
  tissue: { attr: "tissue", ontologies: ["UBERON"], label: "Tissue" },
  cell_type: { attr: "cell_type", ontologies: ["CL"], label: "Cell type" },
  development_stage: { attr: "development_stage", ontologies: ["HsapDv", "MmusDv"], label: "Developmental stage" },
  disease: { attr: "disease", ontologies: ["MONDO", "PATO"], label: "Disease" },
  ancestry: { attr: "ancestry", ontologies: ["HANCESTRO"], label: "Ancestry" },
  sex: { attr: "sex", ontologies: ["PATO"], label: "Sex" },
} as const;
export type TermFilter = keyof typeof TERM_FILTERS;
export const TERM_FILTER_NAMES = Object.keys(TERM_FILTERS) as TermFilter[];

/** Derived sample properties (schema/035 `sample_property`, scripts/ontology/properties.ts): parameter -> values. */
export const SAMPLE_PROPERTIES = {
  donor_status: ["healthy", "diseased"],
  perturbation: ["treated", "genetic", "control"],
  sample_kind: ["primary", "cell_line", "stem_cell", "organoid", "xenograft"],
} as const;
export type SampleProperty = keyof typeof SAMPLE_PROPERTIES;
export const SAMPLE_PROPERTY_NAMES = Object.keys(SAMPLE_PROPERTIES) as SampleProperty[];

/** `<col> IN (...)` over sample_property for one property; one bound parameter (a JSON array of values). */
export function propertyMatchSql(property: SampleProperty, col: "gsm_id" | "gse_id"): string {
  return `SELECT sp.${col} FROM sample_property sp WHERE sp.property = '${property}' AND sp.value IN (SELECT value FROM json_each(?))`;
}

/** One id and one label per filter, for tool descriptions and docs. */
export const TERM_EXAMPLES: Record<TermFilter, string> = {
  tissue: '"UBERON:0002048" or "lung"',
  cell_type: '"CL:0000084" or "T cell"',
  development_stage: '"HsapDv:0000258" or "adult stage"',
  disease: '"MONDO:0100096" or "COVID-19"; "PATO:0000461" (normal) for healthy',
  ancestry: '"HANCESTRO:0005" or "European ancestry"',
  sex: '"PATO:0000383" or "female"',
};

export const ONTOLOGY_PREFIXES = ["UBERON", "CL", "MONDO", "PATO", "HANCESTRO", "HsapDv", "MmusDv"] as const;

/** Lowercase, `_-,/()` and quotes to spaces, collapsed; the form `ontology_label.label_norm` stores. */
export function normLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['"`‘’]/g, "")
    .replace(/[_\-,/()[\]{};:+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "UBERON_0002048", "uberon:0002048", "http://purl.obolibrary.org/obo/UBERON_0002048" → "UBERON:0002048". */
export function canonicalTermId(v: string): string | null {
  const m = /(?:^|\/)([A-Za-z]+)[:_](\d{4,})\s*$/.exec(v.trim());
  if (!m) return null;
  const prefix = ONTOLOGY_PREFIXES.find((p) => p.toLowerCase() === m[1].toLowerCase());
  return prefix ? `${prefix}:${m[2]}` : null;
}

/** Lookup key for one filter value: a canonical id lowercased, or the normalised label. */
export function termKey(v: string): string {
  const id = canonicalTermId(v);
  return id ? id.toLowerCase() : normLabel(v);
}

export function termKeys(values: string[]): string[] {
  return [...new Set(values.map(termKey).filter(Boolean))];
}

/**
 * Subquery of the terms one filter value set selects: the matching terms and, unless `exact`, all their
 * descendants. One bound parameter (a JSON array of keys from `termKeys`).
 */
export function termIdsSql(filter: TermFilter, exact = false): string {
  const onto = TERM_FILTERS[filter].ontologies.map((o) => `'${o}'`).join(",");
  const roots = `SELECT l.term_id FROM ontology_label l WHERE l.label_norm IN (SELECT value FROM json_each(?)) AND l.ontology IN (${onto})`;
  return exact ? roots : `SELECT c.term_id FROM ontology_closure c WHERE c.ancestor_id IN (${roots})`;
}

/** `<col> IN (...)` over sample_term for one filter; `col` is `gsm_id` (sample level) or `gse_id` (study level). */
export function termMatchSql(filter: TermFilter, col: "gsm_id" | "gse_id", exact = false): string {
  return `SELECT st.${col} FROM sample_term st WHERE st.attr = '${TERM_FILTERS[filter].attr}' AND st.term_id IN (${termIdsSql(filter, exact)})`;
}
