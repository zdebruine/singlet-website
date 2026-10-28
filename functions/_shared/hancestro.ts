/**
 * The genetic-ancestry groups the labeller calls (children of HANCESTRO:0004; Singlet-Bio/singlet docs/cell_annotation.md section 2)
 * and their names. One list for the catalog facts (./s1-labels) and the data Worker's cell index (workers/data/src/cidx.ts), whose
 * index directory carries no names for these terms.
 */
export const HANCESTRO_LABELS: Record<string, string> = {
  "HANCESTRO:0010": "African",
  "HANCESTRO:0014": "Hispanic or Latin American",
  "HANCESTRO:0009": "East Asian",
  "HANCESTRO:0005": "European",
  "HANCESTRO:0006": "South Asian",
  "HANCESTRO:0306": "admixed ancestry",
};
