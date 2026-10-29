/**
 * Structured sample type and disease facts from a sample's own GEO record (source and characteristics), following public conventions:
 *
 *   tissue_type        "tissue" | "organoid" | "primary cell culture" | "cell line"   CELLxGENE schema 7.0.0 `tissue_type`.
 *                      For a cell line CELLxGENE puts the Cellosaurus term in the tissue slot; here it is the separate `cell_line`
 *                      term (sample_term attr cell_line, CVCL_xxxx) and the UBERON tissue, when GEO names one, stays the tissue of
 *                      origin. For a primary cell culture CELLxGENE uses a CL term; that is the existing sorted cell type (CL).
 *   cell_line          Cellosaurus accession, only when the GEO "cell line" field names exactly one Cellosaurus line of the
 *                      sample's species by its identifier or an exact synonym (scripts/sample-type/cellosaurus_resolve.py).
 *   tumor_sample_type  "tumor" | "primary tumor" | "metastatic" | "recurrent tumor" | "adjacent normal": the GDC/TCGA `sample_type`
 *                      vocabulary (Primary Tumor, Metastatic, Recurrent Tumor, Solid Tissue Normal), for samples whose GEO fields
 *                      say so. The cancer itself is the MONDO disease term, the site the UBERON tissue term.
 *   sample_kind        the existing coarse kind (primary | cell_line | stem_cell | organoid | xenograft), kept and filled from the
 *                      same evidence. Xenografts (PDX / CDX) have no CELLxGENE tissue_type of their own: they are tissue.
 *   disease            MONDO term, or PATO:0000461 "normal" for an explicitly healthy donor (CELLxGENE `disease`), from disease-type
 *                      fields; generic fields (condition, group, phenotype, status) only when the value is a known disease or an
 *                      explicit "healthy" phrase. Infection status is a disease term too (COVID-19, HIV infection), as in CELLxGENE.
 *   donor_status       existing "healthy" | "diseased", derived from the disease term.
 *
 * Nothing is inferred from silence, from the sample title (often the series title) or from other samples of the study: every value
 * carries the GEO segment it came from as evidence, a substring of the stored text. Treatment, tumour grade and stage stay verbatim
 * sample_attr values (no standard vocabulary is applied to them).
 */
import { parsePairs, tissueInText, normTissue, type Pair } from "./attr-extract";

export const SAMPLE_TYPE_VERSION = "sample-type-2026-10-28";

export const TISSUE_TYPES = ["tissue", "organoid", "primary cell culture", "cell line"] as const;
export type TissueType = (typeof TISSUE_TYPES)[number];
export const TUMOR_SAMPLE_TYPES = ["tumor", "primary tumor", "metastatic", "recurrent tumor", "adjacent normal"] as const;
export type TumorSampleType = (typeof TUMOR_SAMPLE_TYPES)[number];

export interface CellLineHit {
  ac: string;
  name: string;
  /** Cellosaurus category, e.g. "Cancer cell line", "Induced pluripotent stem cell". */
  category: string | null;
}

export interface Fact {
  property: "tissue_type" | "tumor_sample_type" | "sample_kind";
  value: string;
  evidence: string;
  confidence: number;
}

export interface CellLineFact extends CellLineHit {
  raw: string;
  evidence: string;
}

export interface SampleTypeResult {
  facts: Fact[];
  cellLines: CellLineFact[];
}

export const LINE_KEYS = new Set(["cell line", "cell line name", "cellline", "cell lines", "parental cell line", "cell line background"]);
/** Fields that describe what the material is. */
const TYPE_KEYS = new Set([
  "source", "tissue", "tissue type", "sample type", "cell type", "cell line", "sample source", "biomaterial", "specimen", "specimen type",
  "material", "model", "culture", "culture type", "sample", "origin", "organ", "biosample type", "sample origin", "growth protocol",
]);
const TUMOR_KEYS = new Set(["source", "tissue", "tissue type", "sample type", "condition", "group", "disease state", "sample", "site", "specimen type", "tumor type", "tumour type", "sample site", "tissue status", "tumor status", "tumour status", "sample status", "lesion", "pathology", "tissue origin", "tissue source"]);

const ORGANOID = /\b(organoids?|assembloids?|gastruloids?|embryoid bod(?:y|ies)|tumou?roids?|enteroids?|colonoids?|blastoids?)\b/i;
const XENO = /\b(xenografts?|pdx|cdx|o-pdx|pdox|patient[- ]derived xenografts?)\b/i;
const STEM = /\b(h?ipscs?|i ?ps cells?|h?escs?|h?pscs?|pluripotent|embryonic stem)\b/i;
const DERIVED = /\b(derived|differentiated|differentiation)\b/i;
const CULTURE = /\b(primary (?:cell )?cultures?|cultured primary|primary cultured|in vitro cultured|ex vivo cultured|cultured (?:cells|fibroblasts|keratinocytes|hepatocytes|myoblasts|astrocytes|neurons|chondrocytes|osteoblasts|t cells|macrophages|monocytes))\b/i;
const CELL_LINE_WORD = /\bcell ?lines?\b/i;
/** A named line grown in an animal (syngeneic or xenografted tumour, transplant) and sampled from it: the sample is tissue. */
const IN_VIVO = /\b(tumou?rs?|xenografts?|allografts?|injected|implanted|transplanted|engrafted|orthotopic|subcutaneous(?:ly)?|in vivo|tumou?r[- ]bearing)\b/i;
const IN_VIVO_KEYS = new Set(["tissue", "source", "cell type", "treatment", "sample type", "tissue type", "in vitro or in vivo", "model", "condition", "group"]);

const lc = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function tumorType(v: string): TumorSampleType | null {
  const s = lc(v).replace(/[_]+/g, " ");
  if (/\bpre[- ]?metasta/.test(s) || /\bnon[- ]?metasta/.test(s)) return null;
  if (/^(adjacent|adjacent normal|normal adjacent|adjacent normal tissue|normal adjacent tissue|adjacent non[- ]?tumou?r|adjacent non[- ]?tumou?r tissue|adjacent tissue|para[- ]?tumou?r|para[- ]?tumou?r tissue|para[- ]?cancerous( tissue)?|peritumou?ral( tissue)?|non[- ]?tumou?r adjacent tissue|tumou?r[- ]adjacent normal( tissue)?|normal tissue adjacent to (the )?tumou?r|adjacent normal mucosa|matched normal adjacent tissue)$/.test(s)) return "adjacent normal";
  if (/^(metastas[ie]s|metastatic|metastatic (tumou?r|tissue|lesion|sample|site)|(lymph node|liver|brain|bone|lung|peritoneal|omental) metastas[ie]s|metastatic (lymph node|liver|brain|bone|lung))$/.test(s)) return "metastatic";
  if (/^(recurren(t|ce)|recurrent tumou?r|relapsed? tumou?r)$/.test(s)) return "recurrent tumor";
  if (/^primary tumou?r( tissue| sample)?$/.test(s)) return "primary tumor";
  if (/^(tumou?rs?|tumou?r tissue|tumou?r sample|tumou?r core|cancer tissue|cancerous tissue|malignant tissue|tumou?r region|tumou?r fraction)$/.test(s)) return "tumor";
  return null;
}

/**
 * Classify one sample. `lookupLine` resolves a "cell line" field value (raw, as written) to Cellosaurus, or null when the name is not
 * exactly one line of the sample's species.
 */
export function classifySampleType(
  s: { source?: string | null; characteristics?: unknown; organism_primary?: string | null },
  lookupLine: (raw: string) => CellLineHit | null
): SampleTypeResult {
  const pairs: Pair[] = parsePairs(s.characteristics);
  const src = (s.source ?? "").trim();
  if (src) pairs.push({ key: "source", value: src, evidence: src });
  const facts: Fact[] = [];
  const cellLines: CellLineFact[] = [];
  const typed = pairs.filter((p) => TYPE_KEYS.has(p.key) && p.value);

  const first = (re: RegExp) => typed.find((p) => re.test(p.value));
  for (const p of pairs) {
    if (!LINE_KEYS.has(p.key) || !p.value) continue;
    const hit = lookupLine(p.value);
    if (hit && !cellLines.some((c) => c.ac === hit.ac)) cellLines.push({ ...hit, raw: p.value, evidence: p.evidence });
  }

  // an "organoid" field with a value names one ("organoid: HEO"), like an organoid word under a type key
  const organoid = first(ORGANOID) ?? pairs.find((p) => /^organoids?( type| line| model)?$/.test(p.key) && p.value && !/^(no|none|n\/?a|false|0)$/i.test(p.value));
  // xenograft words are unambiguous under any key ("group: O-PDX")
  const xeno = pairs.find((p) => p.value && XENO.test(p.value));
  const stemDerived = typed.find((p) => STEM.test(p.value) && (DERIVED.test(p.value) || p.key === "cell line" || p.key === "cell type"));
  const culture = first(CULTURE);
  const lineWord = typed.find((p) => CELL_LINE_WORD.test(p.value) && !/\bprimary\b|\bnot? (a )?cell line\b|\bnon[- ]cell line\b/i.test(p.value));
  const stemLine = cellLines.find((c) => /stem cell/i.test(c.category ?? ""));

  let tt: { value: TissueType; ev: string; conf: number } | null = null;
  const lineInVivo =
    cellLines.length || lineWord ? pairs.find((p) => IN_VIVO_KEYS.has(p.key) && p.value && IN_VIVO.test(p.value) && !/\bin vitro\b/i.test(p.value) && !CELL_LINE_WORD.test(p.value)) : undefined;
  if (organoid) tt = { value: "organoid", ev: organoid.evidence, conf: 0.9 };
  else if (xeno) tt = { value: "tissue", ev: xeno.evidence, conf: 0.85 };
  else if (lineInVivo) tt = { value: "tissue", ev: lineInVivo.evidence, conf: 0.8 };
  else if (cellLines.length) tt = { value: "cell line", ev: cellLines[0].evidence, conf: 0.95 };
  else if (stemDerived) tt = { value: "cell line", ev: stemDerived.evidence, conf: 0.8 };
  else if (lineWord) tt = { value: "cell line", ev: lineWord.evidence, conf: 0.8 };
  else if (culture) tt = { value: "primary cell culture", ev: culture.evidence, conf: 0.85 };
  else {
    // Tissue only from an explicit tissue field, and only when nothing in the record says the material was cultured or derived.
    const anyCultureWord = pairs.some((p) => /\bcultur(e|ed|es|ing)\b|\bin vitro\b|\bdifferentiat/i.test(p.value));
    const tissuePair = pairs.find((p) => (p.key === "tissue" || p.key === "organ" || p.key === "source") && p.value && (normTissue(p.value) || tissueInText(p.value)));
    if (!anyCultureWord && tissuePair) tt = { value: "tissue", ev: tissuePair.evidence, conf: xeno ? 0.85 : 0.8 };
  }
  if (tt) facts.push({ property: "tissue_type", value: tt.value, evidence: tt.ev, confidence: tt.conf });

  // sample_kind, the existing coarse kind
  let kind: { value: string; ev: string; conf: number } | null = null;
  if (xeno) kind = { value: "xenograft", ev: xeno.evidence, conf: 0.9 };
  else if (organoid) kind = { value: "organoid", ev: organoid.evidence, conf: 0.9 };
  else if (lineInVivo) kind = null; // a line grown in an animal: neither a culture nor a xenograft unless it says so
  else if (stemLine) kind = { value: "stem_cell", ev: stemLine.evidence, conf: 0.9 };
  else if (stemDerived) kind = { value: "stem_cell", ev: stemDerived.evidence, conf: 0.8 };
  else if (cellLines.length || lineWord) kind = { value: "cell_line", ev: (cellLines[0]?.evidence ?? lineWord!.evidence), conf: cellLines.length ? 0.95 : 0.8 };
  else if (tt && (tt.value === "tissue" || tt.value === "primary cell culture")) kind = { value: "primary", ev: tt.ev, conf: 0.75 };
  if (kind) facts.push({ property: "sample_kind", value: kind.value, evidence: kind.ev, confidence: kind.conf });

  // tumour vs adjacent normal (GDC sample_type)
  if (tt?.value !== "cell line") {
    for (const p of pairs) {
      if (!TUMOR_KEYS.has(p.key) || !p.value) continue;
      const t = tumorType(p.value);
      if (t) {
        facts.push({ property: "tumor_sample_type", value: t, evidence: p.evidence, confidence: 0.9 });
        break;
      }
    }
  }
  return { facts, cellLines };
}

// ── disease ────────────────────────────────────────────────────────────────

/** Fields that name the donor's disease or health. */
export const DISEASE_KEYS = new Set([
  "disease", "disease state", "disease status", "diagnosis", "clinical diagnosis", "health state", "health status", "disease type",
  "pathology", "disease condition", "clinical status", "patient status", "donor status", "subject status", "subject group",
  "disease group", "covid status", "covid 19 status", "infection status", "infection", "clinical condition", "primary diagnosis",
  "patient diagnosis", "donor diagnosis", "histological diagnosis", "pathological diagnosis", "cancer type", "tumor type", "tumour type",
]);
/** Generic fields: read only for a known disease or an explicit healthy phrase. */
export const GENERIC_KEYS = new Set(["condition", "group", "phenotype", "status", "cohort", "patient group", "sample group", "subject", "donor", "individual", "patient", "category", "class"]);

/** Explicit healthy phrases (any of the keys above). */
const HEALTHY_ANY = /^(healthy|healthy (control|controls|donor|donors|volunteer|volunteers|individual|individuals|subject|subjects|adult|adults|human donor|control subject|participant)|normal (donor|donors|control|controls|individual|subject|volunteer)|non[- ]?diseased|no disease|unaffected|healthy non[- ].*disease)$/;
/** "control" / "normal" read as healthy only for human donors under a disease-type key (a mouse "control" is an experimental arm). */
const CONTROL_WORD = /^(control|controls|ctrl|normal|hc|nc)$/;

/** Unambiguous abbreviations and phrasings -> the MONDO label they name (the id is looked up in ontology_label, so ids are checked). */
export const DISEASE_ALIASES: Record<string, string> = {
  nsclc: "non-small cell lung carcinoma",
  ipf: "idiopathic pulmonary fibrosis",
  copd: "chronic obstructive pulmonary disease",
  sle: "systemic lupus erythematosus",
  "covid-19": "COVID-19",
  covid19: "COVID-19",
  covid: "COVID-19",
  "sars-cov-2 positive": "COVID-19",
  "sars-cov-2 infected": "COVID-19",
  "sars-cov-2 infection": "COVID-19",
  "covid-19 positive": "COVID-19",
  hiv: "HIV infectious disease",
  "hiv infected": "HIV infectious disease",
  "hiv infection": "HIV infectious disease",
  "hiv+": "HIV infectious disease",
  t1d: "type 1 diabetes mellitus",
  t2d: "type 2 diabetes mellitus",
  dm2: "type 2 diabetes mellitus",
  gbm: "glioblastoma",
  aml: "acute myeloid leukemia",
  "b-all": "B-cell acute lymphoblastic leukemia",
  "t-all": "T-cell acute lymphoblastic leukemia",
  cll: "chronic lymphocytic leukemia",
  cml: "chronic myelogenous leukemia",
  pdac: "pancreatic ductal adenocarcinoma",
  hcc: "hepatocellular carcinoma",
  crc: "colorectal cancer",
  hnscc: "head and neck squamous cell carcinoma",
  "hpv+ hnscc": "head and neck squamous cell carcinoma",
  ccrcc: "clear cell renal carcinoma",
  luad: "lung adenocarcinoma",
  lusc: "lung squamous cell carcinoma",
  "t-lgll": "T-cell large granular lymphocyte leukemia",
  "t-pll": "T-cell prolymphocytic leukemia",
  pmf: "primary myelofibrosis",
  "overt pmf": "primary myelofibrosis",
  oa: "osteoarthritis",
  dcm: "dilated cardiomyopathy",
  nash: "non-alcoholic steatohepatitis",
  mash: "non-alcoholic steatohepatitis",
  igan: "IgA glomerulonephritis",
  "iga nephropathy": "IgA glomerulonephritis",
  als: "amyotrophic lateral sclerosis",
  ms: "multiple sclerosis",
  "relapsing ms": "relapsing-remitting multiple sclerosis",
  ipd: "Parkinson disease",
  dipg: "diffuse intrinsic pontine glioma",
  pnh: "paroxysmal hemoglobinuria",
  jia: "juvenile idiopathic arthritis",
  ra: "rheumatoid arthritis",
  hs: "hidradenitis suppurativa",
  sfts: "severe fever with thrombocytopenia syndrome",
  "flua": "influenza",
  "influenza a": "influenza",
  "influenza a virus": "influenza",
  amd: "age related macular degeneration",
  "early amd": "age related macular degeneration",
  "atrophic amd": "age related macular degeneration",
  "neo amd": "age related macular degeneration",
  ltbi: "latent tuberculosis",
  tb: "tuberculosis",
  "active tb": "tuberculosis",
  sepsis: "sepsis",
  "sepsis acute": "sepsis",
};

/** A disease or health value with its key; null when this value says nothing usable. */
export function diseaseCandidate(p: Pair, organism: string | null | undefined): { kind: "healthy" | "disease"; text: string; confidence: number } | null {
  const isDiseaseKey = DISEASE_KEYS.has(p.key);
  const isGeneric = GENERIC_KEYS.has(p.key);
  if (!isDiseaseKey && !isGeneric) return null;
  const v = lc(p.value).replace(/\s*\.$/, "");
  if (!v || /^(n\/?a|na|none|unknown|not applicable|not available|-|nan)$/.test(v)) return null;
  if (HEALTHY_ANY.test(v)) return { kind: "healthy", text: v, confidence: 0.95 };
  if (CONTROL_WORD.test(v)) return isDiseaseKey && organism === "Homo sapiens" ? { kind: "healthy", text: v, confidence: 0.85 } : null;
  // "COVID-19 patient", "patient with Parkinson's disease (PD)", "severe COVID-19": the disease named, without the person or severity
  const t = v
    .replace(/^(patients? with|individuals? with|donors? with|subjects? with|diagnosed with)\s+/, "")
    .replace(/\s+(patients?|donors?|subjects?|cases?|individuals?|positive)$/, "")
    .replace(/^(severe|mild|moderate|critical|acute|active|established|newly diagnosed)\s+(?=covid|sepsis|tb\b)/, "")
    .replace(/\s*\(([^)]*)\)\s*$/, "")
    .trim();
  return { kind: "disease", text: t, confidence: isDiseaseKey ? 0.9 : 0.85 };
}
