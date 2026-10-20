/**
 * The attributes the bit index holds, shared by the builder (scripts/search-index/build-index.ts) and the
 * cohort resolver. No imports: the builder runs this file under plain `node`.
 *
 * `core` attributes are catalog facts (organism, QC tier, year, cell count), not extracted ones: they ignore the
 * `sources` gate. Numeric attributes are quantised into bins at build time; `edges[i]` is the lower bound of
 * bin i (the last bin is open-ended), and code 0 always means unknown.
 */

export type AttrKind = "cat" | "num";

export interface AttrSpec {
  key: string;
  kind: AttrKind;
  label: string;
  /** A sample can hold several values (layers present). No per-sample code column. */
  multi?: boolean;
  /** Catalog fact: always visible whatever `sources` says. */
  core?: boolean;
  /** Numeric: lower bin edges, ascending. */
  edges?: number[];
  unit?: string;
  /** Left out of the facet block (still filterable). */
  noFacet?: boolean;
}

/** Source tiers, in priority order. A fact row is stored in exactly one tier. */
export const TIERS = ["geo", "pipeline", "model_hi", "model_lo"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_BIT: Record<Tier, number> = { geo: 1, pipeline: 2, model_hi: 4, model_lo: 8 };
export const ALL_TIERS = 15;
/** Model facts at or above this confidence land in `model_hi`. */
export const MODEL_HI_CONFIDENCE = 0.8;

const YEARS = Array.from({ length: 24 }, (_, i) => 2009 + i);

export const ATTRS: AttrSpec[] = [
  { key: "organism", kind: "cat", label: "Organism", core: true },
  { key: "tissue_group", kind: "cat", label: "Tissue group" },
  { key: "tissue", kind: "cat", label: "Tissue" },
  { key: "disease_group", kind: "cat", label: "Disease group" },
  { key: "disease", kind: "cat", label: "Disease" },
  { key: "disease_state", kind: "cat", label: "Disease state" },
  { key: "sex", kind: "cat", label: "Sex (declared)" },
  { key: "sex_genetic", kind: "cat", label: "Sex (genetic)" },
  { key: "ancestry_genetic", kind: "cat", label: "Ancestry (genetic)" },
  { key: "life_stage", kind: "cat", label: "Life stage" },
  { key: "sample_type", kind: "cat", label: "Sample type" },
  { key: "chemistry", kind: "cat", label: "Chemistry" },
  { key: "nuclei", kind: "cat", label: "Cells or nuclei" },
  { key: "treatment_status", kind: "cat", label: "Treatment status" },
  { key: "layer", kind: "cat", label: "Layers in the file", multi: true, core: true },
  { key: "qc_tier", kind: "cat", label: "QC tier", core: true },
  { key: "pipeline_version", kind: "cat", label: "Pipeline version", core: true, noFacet: true },
  // Study-level catalog gates, the same rule as DOWNLOADABLE_SQL and sample_qc.usable.
  { key: "downloadable", kind: "cat", label: "In a downloadable study", core: true, noFacet: true },
  { key: "usable", kind: "cat", label: "Sample has a matrix and called cells", core: true, noFacet: true },
  { key: "year", kind: "num", label: "Year", core: true, edges: YEARS, unit: "year" },
  { key: "age", kind: "num", label: "Age", edges: [0, 1 / 12, 1, 3, 6, 12, 18, 25, 35, 45, 55, 65, 75, 85], unit: "year" },
  { key: "n_cells", kind: "num", label: "Cells called", core: true, edges: [0, 100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000], unit: "cells" },
];

export const ATTR_BY_KEY: Record<string, AttrSpec> = Object.fromEntries(ATTRS.map((a) => [a.key, a]));

/** Attributes whose mixed state in the result the scoping dialogue asks about when the query does not constrain them. */
export const AMBIGUITY_ATTRS = ["treatment_status", "disease_state", "nuclei", "life_stage", "sample_type", "sex"] as const;

/** Label for numeric bin `b` (0-based) given its attribute. */
export function binLabel(spec: AttrSpec, b: number): string {
  const e = spec.edges ?? [];
  const lo = e[b];
  const hi = e[b + 1];
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
  return hi == null ? `${fmt(lo)}+` : `${fmt(lo)}-${fmt(hi)}`;
}

/** Bin of value `x` (-1 when below the first edge). */
export function binOf(spec: AttrSpec, x: number): number {
  const e = spec.edges ?? [];
  let lo = 0;
  let hi = e.length - 1;
  if (!(x >= e[0])) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (e[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
