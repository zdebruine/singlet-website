/**
 * The cell-search vocabulary: every filter cell search answers, at which level it applies, its ontology, and where its values come from.
 * GET /api/cells/fields serves this list with live coverage, so the vocabulary describes itself.
 */
export type FieldLevel = "cell" | "sample" | "study";
export type FieldKind = "ontology" | "enum" | "number" | "accession" | "boolean";

export interface FieldDef {
  name: string;
  level: FieldLevel;
  kind: FieldKind;
  ontology?: string[];
  /** enum values (fixed vocabularies) */
  values?: readonly string[];
  unit?: string;
  description: string;
  source: string;
  /** a per-cell numeric range that needs the cell index's row scan (counts from the data Worker; AND-only) */
  rowScan?: boolean;
  aliases?: string[];
}

export const FIELDS: FieldDef[] = [
  // ── per cell: the .s1 labeller's calls, from the atlas cell index summary
  {
    name: "cell_type",
    level: "cell",
    kind: "ontology",
    ontology: ["CL", "Cellosaurus"],
    description:
      "Cell Ontology cell type the .s1 labeller called for the cell; a term matches its descendants (T cell finds CD4 and CD8 T cells). Cells of a cell-line sample carry the line instead (Cellosaurus id and name, e.g. CVCL_0004 K-562), each line under CL:0000010 cultured cell: the labeller was trained on primary tissue and is unreliable on cultured lines.",
    source: "atlas cell index (cell_type, with each term's CL ancestors)",
    aliases: ["cell_type_label", "celltype"],
  },
  {
    name: "sex",
    level: "cell",
    kind: "enum",
    ontology: ["PATO"],
    values: ["female", "male", "ambiguous", "unknown"],
    description: "Chromosomal sex called per cell from XIST and chrY expression (PATO:0000383 female, PATO:0000384 male).",
    source: "atlas cell index (sex)",
    aliases: ["sex_genetic", "chromosomal_sex"],
  },
  {
    name: "ancestry",
    level: "cell",
    kind: "ontology",
    ontology: ["HANCESTRO"],
    description: "Genetic ancestry group inferred per cell (human donors with enough covered sites; HANCESTRO children of HANCESTRO:0004). Genotypes are never served.",
    source: "atlas cell index (ancestry)",
    aliases: ["ancestry_genetic", "genetic_ancestry"],
  },
  { name: "n_umi", level: "cell", kind: "number", unit: "UMIs", description: "UMIs of the cell (exon + intron).", source: "atlas cell index rows (data Worker row scan)", rowScan: true },
  { name: "n_genes", level: "cell", kind: "number", unit: "genes", description: "Genes detected in the cell (exon).", source: "atlas cell index rows (data Worker row scan)", rowScan: true },
  // ── per sample
  {
    name: "tissue",
    level: "sample",
    kind: "ontology",
    ontology: ["UBERON"],
    description: "Tissue of the sample (UBERON, mapped from GEO); a term matches its is_a and part_of descendants.",
    source: "D1 sample_term (attr tissue)",
  },
  {
    name: "disease",
    level: "sample",
    kind: "ontology",
    ontology: ["MONDO", "PATO"],
    description: "Disease of the donor (MONDO; PATO:0000461 normal for healthy donors), mapped from GEO.",
    source: "D1 sample_term (attr disease)",
  },
  {
    name: "development_stage",
    level: "sample",
    kind: "ontology",
    ontology: ["HsapDv", "MmusDv"],
    description: "Developmental stage of the donor (HsapDv human, MmusDv mouse), mapped from GEO age and life-stage fields.",
    source: "D1 sample_term (attr development_stage)",
    aliases: ["stage", "life_stage"],
  },
  { name: "age_years", level: "sample", kind: "number", unit: "years", description: "Donor age as written in GEO, converted to years.", source: "D1 sample_attr (attr age, source geo)", aliases: ["age"] },
  {
    name: "donor_sex",
    level: "sample",
    kind: "ontology",
    ontology: ["PATO"],
    description: "Sex the authors recorded for the sample in GEO (PATO). Per-cell chromosomal sex is `sex`.",
    source: "D1 sample_term (attr sex)",
    aliases: ["author_sex"],
  },
  {
    name: "donor_ancestry",
    level: "sample",
    kind: "ontology",
    ontology: ["HANCESTRO"],
    description: "Ancestry or ethnicity the authors recorded in GEO (HANCESTRO). Per-cell genetic ancestry is `ancestry`.",
    source: "D1 sample_term (attr ancestry)",
    aliases: ["author_ancestry"],
  },
  {
    name: "sorted_cell_type",
    level: "sample",
    kind: "ontology",
    ontology: ["CL"],
    description: "Cell population the authors sorted or enriched (GEO cell type field, CL).",
    source: "D1 sample_term (attr cell_type)",
    aliases: ["author_cell_type"],
  },
  { name: "organism", level: "sample", kind: "enum", description: "Primary organism of the sample (scientific name).", source: "D1 gsm.organism_primary" },
  { name: "assay", level: "sample", kind: "enum", description: "Assay family (10x 3', 10x 5', Smart-seq, ...).", source: "D1 gsm.assay_family", aliases: ["assay_family"] },
  { name: "chemistry", level: "sample", kind: "enum", description: "Chemistry the pipeline detected from the reads (10xv2, 10xv3, ...).", source: "D1 sample_qc.protocol", aliases: ["protocol"] },
  { name: "tissue_group", level: "sample", kind: "enum", description: "Coarse tissue group of the catalog search.", source: "D1 gsm.tissue_group" },
  { name: "disease_group", level: "sample", kind: "enum", description: "Coarse disease group of the catalog search.", source: "D1 gsm.disease_group" },
  { name: "donor_status", level: "sample", kind: "enum", values: ["healthy", "diseased"], description: "Healthy (disease PATO:0000461 normal, from explicit text such as \"healthy donor\") or diseased (a MONDO disease term) donor, as CELLxGENE's disease field. Never inferred from silence.", source: "D1 sample_property", aliases: ["disease_status"] },
  { name: "perturbation", level: "sample", kind: "enum", values: ["treated", "genetic", "control"], description: "Treated, genetically perturbed (KO, transgenic, CRISPR, RNAi) or control sample.", source: "D1 sample_property" },
  { name: "sample_kind", level: "sample", kind: "enum", values: ["primary", "cell_line", "stem_cell", "organoid", "xenograft"], description: "What the sample is (coarse; xenograft and stem-cell-derived are kinds of their own here).", source: "D1 sample_property" },
  { name: "tissue_type", level: "sample", kind: "enum", values: ["tissue", "organoid", "primary cell culture", "cell line"], description: "CELLxGENE schema 7.0.0 tissue_type, from the sample's own GEO fields: tissue (xenografts included), organoid, primary cell culture or cell line (stem-cell-derived cultures included). For an organoid the UBERON tissue is the tissue of origin; for a cell line see cell_line.", source: "D1 sample_property (GEO evidence)" },
  { name: "cell_line", level: "sample", kind: "ontology", ontology: ["Cellosaurus"], description: "Cellosaurus cell line (CVCL_xxxx) the GEO cell line field names: only exact identifier or synonym matches of the sample's species.", source: "D1 sample_term (attr cell_line)", aliases: ["cellosaurus"] },
  { name: "tumor_sample_type", level: "sample", kind: "enum", values: ["tumor", "primary tumor", "metastatic", "recurrent tumor", "adjacent normal"], description: "Tumour or adjacent normal tissue, in the GDC/TCGA sample_type vocabulary (adjacent normal = Solid Tissue Normal), when the sample's GEO fields say so. The cancer is the disease term, the site the tissue term.", source: "D1 sample_property (GEO evidence)", aliases: ["tumor_status", "sample_type_gdc"] },
  { name: "median_umi", level: "sample", kind: "number", unit: "UMIs", description: "Median UMIs per called cell of the sample.", source: "D1 sample_qc.median_umi" },
  { name: "median_genes", level: "sample", kind: "number", unit: "genes", description: "Median genes per called cell of the sample.", source: "D1 sample_qc.median_genes" },
  { name: "mito_fraction", level: "sample", kind: "number", unit: "fraction", description: "Median mitochondrial fraction of the sample's called cells (per-cell mt fraction is not in the cell index).", source: "D1 sample_qc.median_mito_fraction" },
  { name: "cells_called", level: "sample", kind: "number", unit: "cells", description: "Cells called in the sample.", source: "D1 sample_qc.n_cells_called" },
  { name: "mapping_rate", level: "sample", kind: "number", unit: "fraction", description: "Fraction of reads mapped.", source: "D1 sample_qc.mapping_rate" },
  { name: "qc", level: "sample", kind: "enum", values: ["pass", "low"], description: "QC tier of the sample: pass, or low (only searched with include_low_qc).", source: "D1 sample_qc.qc_tier" },
  { name: "sample", level: "sample", kind: "accession", description: "GEO sample accessions (GSM).", source: "D1 s1_sample", aliases: ["gsm", "gsm_id"] },
  // ── per study
  { name: "study", level: "study", kind: "accession", description: "GEO series accessions (GSE).", source: "D1 s1_sample", aliases: ["gse", "gse_id"] },
  { name: "year", level: "study", kind: "number", description: "Year the GEO series was submitted.", source: "D1 gse_meta.year" },
  { name: "has_publication", level: "study", kind: "boolean", description: "The series lists a PubMed id.", source: "D1 gse.pubmed_ids" },
];

/** Asked for, but not in the catalog today. */
export const UNAVAILABLE: { name: string; why: string }[] = [
  { name: "submitter", why: "GEO contact names are not in the catalog (D1 has no submitter column)." },
  { name: "sra_accession", why: "SRR run ids are stored per sample but not indexed; search by GSM/GSE." },
  { name: "mt_fraction (per cell)", why: "The cell index has no per-cell mitochondrial fraction; mito_fraction filters on the sample median." },
  { name: "tissue / disease / stage per cell", why: "These are sample facts: a cell inherits its sample's terms." },
];

const BY_NAME = new Map<string, FieldDef>();
for (const f of FIELDS) {
  BY_NAME.set(f.name, f);
  for (const a of f.aliases ?? []) BY_NAME.set(a, f);
}

export function fieldDef(name: string): FieldDef | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** Facets a cell answer breaks down by (all of the ontology and enum fields). */
export const FACET_FIELDS = FIELDS.filter((f) => f.kind === "ontology" || f.kind === "enum").map((f) => f.name);
