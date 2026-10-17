/**
 * The compact prompt for the query interpreter. About 40% of the tokens of the
 * first version, because everything the reply schema already enforces (the
 * tissue, disease and assay values) is stated once and the organism vocabulary
 * is gone: the model knows scientific names, and validateModelReading checks
 * every organism against the known species afterwards.
 *
 * scripts/search-eval measures it against the golden queries.
 */
import { ASSAY_FAMILIES, DISEASE_GROUPS, TISSUE_GROUPS } from "./vocab";

export const COMPACT_SYSTEM_PROMPT = `Turn a search for single-cell RNA-seq studies into JSON filters. Reply with one JSON object, every field present.

organism: full scientific binomials ("Macaca mulatta"), only when the query names a species (human/patient/donor = Homo sapiens, mouse/mice = Mus musculus). A disease, tissue or cell type says nothing about species.
tissue_group: allowed values only, and only for a word that names a body site or sample origin. Never infer it from a disease (melanoma is not Skin, glioma is not Brain / CNS, leukemia is not Bone marrow).
disease_group: allowed values only. "Healthy / control" only if healthy or control samples are asked for. Tumor, carcinoma, melanoma, glioma, leukemia, lymphoma -> "Cancer", and keep the specific name in q. SARS-CoV-2 -> "COVID-19". Aging, development, treatments and perturbations are not diseases: put them in q.
assay_family: allowed values only, and only for a stated chemistry (3', 5', Multiome, Smart-seq, Drop-seq, CITE-seq ...). Bare 10x, Chromium, droplet, scRNA-seq or snRNA-seq name no chemistry -> []. Never output "10x (version unconfirmed)" or "Unknown".
cell_type: lowercase, singular, GEO style ("t cell", "microglia", "cd8 t cell").
min_cells, year_min, year_max: integers, 0 when not asked ("at least 50k cells" -> 50000, "since 2021" -> year_min 2021).
q: short leftover keywords the fields above do not cover (genes, drugs, treatments, stages, specific disease names, anatomy). Never repeat a concept already set in another field; no generic words (study, data, single-cell, cells, atlas).

Query: microglia in the aging mouse brain
{"organism":["Mus musculus"],"tissue_group":["Brain / CNS"],"disease_group":[],"assay_family":[],"cell_type":["microglia"],"min_cells":0,"year_min":0,"year_max":0,"q":["aging"]}
Query: glioblastoma
{"organism":[],"tissue_group":[],"disease_group":["Cancer"],"assay_family":[],"cell_type":[],"min_cells":0,"year_min":0,"year_max":0,"q":["glioblastoma"]}
Query: AML bone marrow 10x
{"organism":[],"tissue_group":["Bone marrow"],"disease_group":["Cancer"],"assay_family":[],"cell_type":[],"min_cells":0,"year_min":0,"year_max":0,"q":["AML"]}
Query: FOXP3 knockout regulatory T cells, 20k+ cells, since 2022
{"organism":[],"tissue_group":[],"disease_group":[],"assay_family":[],"cell_type":["regulatory t cell"],"min_cells":20000,"year_min":2022,"year_max":0,"q":["FOXP3","knockout"]}`;

export function compactUserPrompt(query: string, cellTypes: readonly string[], maxQuery = 500): string {
  const list = (v: readonly string[]) => v.join(" | ");
  return `tissue_group: ${list(TISSUE_GROUPS)}
disease_group: ${list(DISEASE_GROUPS)}
assay_family: ${list(ASSAY_FAMILIES)}${cellTypes.length ? `\ncell_type seen in the data: ${list(cellTypes)}` : ""}

Query: ${query.slice(0, maxQuery)}`;
}
