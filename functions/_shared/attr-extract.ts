/**
 * Deterministic sample facts from GEO text (docs/SEARCH-ROADMAP.md 4.1, task T5 pre-pass).
 *
 * Reads the explicit `key: value` pairs in `gsm.characteristics` (and the `source` field for tissue) and
 * returns `sample_attr` rows with source = 'geo'. No model is involved and nothing is inferred: a row exists
 * only when a key the rules know names the attribute, and `evidence` is the exact text it was read from
 * (a substring of the characteristics string, the title or the source).
 *
 * A value the rules can map to a controlled form ("M" -> male, "untreated" -> none) is "placed" and gets
 * confidence 0.95. A value that is an explicit statement but not in a controlled list ("kidney cortex") is
 * kept verbatim at confidence 0.7 and also returned in `unplaced`, which scripts/enrich/extract-attrs.ts
 * writes to a per-study JSONL batch for the model pass (scripts/enrich/extract-sample-attrs.md).
 *
 * Pure functions, no I/O: used by the enrichment scripts, the card builder and the study page.
 */

export const EXTRACTOR_VERSION = "geo-rules-2026-10-28";

export const ATTRS = [
  "tissue",
  "sample_type",
  "cell_type_sorted",
  "disease",
  "disease_state",
  "treatment",
  "treatment_status",
  "timepoint",
  "genotype",
  "age",
  "life_stage",
  "sex",
  "ancestry",
  "donor",
] as const;
export type Attr = (typeof ATTRS)[number];

export interface AttrRow {
  gsm_id: string;
  gse_id: string;
  attr: Attr;
  value_raw: string;
  value_norm: string;
  value_num: number | null;
  unit: string | null;
  source: "geo";
  evidence: string;
  confidence: number;
  extractor_version: string;
}

export interface SampleText {
  gsm_id: string;
  gse_id: string;
  title?: string | null;
  source?: string | null;
  /** The "key: value ;; key: value" string (or a JSON object) as stored in gsm.characteristics. */
  characteristics?: unknown;
  organism_primary?: string | null;
}

export interface Unplaced {
  attr: Attr;
  key: string;
  value: string;
  evidence: string;
}

export interface Extraction {
  rows: AttrRow[];
  /** Explicit values the rules kept verbatim but could not map to a controlled form. */
  unplaced: Unplaced[];
  /** Characteristics keys no rule reads, with their values (for the model pass and the key report). */
  unmapped: { key: string; value: string; evidence: string }[];
}

// ── parsing ────────────────────────────────────────────────────────────────

export interface Pair {
  /** Lowercased key, `._-` as spaces. */
  key: string;
  value: string;
  /** The segment as written ("Tissue: Blood"), a substring of the stored string. */
  evidence: string;
}

const P_MISSING = new Set(["", "n/a", "na", "null", "unknown", "not applicable", "not available", "not determined", "-", "--", "nan", "?", "not specified", "unspecified", "not reported"]);

export function normKey(k: string): string {
  return k.trim().toLowerCase().replace(/[_.\-]+/g, " ").replace(/\s+/g, " ").replace(/:$/, "").trim();
}

/** Split a characteristics cell into pairs, keeping each segment's original text as evidence. */
export function parsePairs(raw: unknown): Pair[] {
  if (raw == null) return [];
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => ({ key: normKey(k), value: String(v).trim(), evidence: `${k}: ${String(v).trim()}` }));
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("{")) {
    try {
      return parsePairs(JSON.parse(text));
    } catch {
      /* fall through to the delimited form */
    }
  }
  const out: Pair[] = [];
  // Most records join pairs with ";;". Some write "tissue: lung; hashtag number: HT5; ..." with single semicolons; split those only
  // before something that looks like a key, so a value with its own ";" ("DM: no; HTN: no") stays in one piece under a ";;" record.
  const parts = text.includes(";;") ? text.split(";;") : text.split(/;\s*(?=[A-Za-z][^;:]{0,59}:\s)/);
  for (const part of parts) {
    const seg = part.trim();
    const idx = seg.indexOf(":");
    if (idx <= 0) continue;
    const key = normKey(seg.slice(0, idx));
    const value = seg.slice(idx + 1).trim().replace(/\s+/g, " ");
    if (key) out.push({ key, value, evidence: seg });
  }
  return out;
}

const clean = (v: string) => v.trim().replace(/\s+/g, " ").replace(/\.$/, "");
const lower = (v: string) => clean(v).toLowerCase();
const isMissing = (v: string) => P_MISSING.has(lower(v));

// ── lexicons ───────────────────────────────────────────────────────────────

/** canonical | synonyms. Exact match after lowercasing, dropping a trailing "tissue" and a plural "s". */
const TISSUES = `
blood|peripheral blood|whole blood|pbmc|pbmcs|peripheral blood mononuclear cells|peripheral blood mononuclear cell|pb
bone marrow|bm|bone marrow aspirate
cord blood|umbilical cord blood
spleen
thymus
lymph node|lymph nodes|peripheral lymph nodes|lymph node|lymphnode|mesenteric lymph node|inguinal lymph node|draining lymph node
tonsil
brain|whole brain|cerebrum
cortex|cerebral cortex|neocortex|prefrontal cortex|frontal cortex|visual cortex|motor cortex
hippocampus
cerebellum
hypothalamus
striatum|dorsal striatum
thalamus
midbrain
spinal cord
retina
eye|cornea|choroid
heart|cardiac|left ventricle|heart left ventricle|right ventricle|left atrium|right atrium|ventricle|atrium
aorta
artery|arteries
vein
lung|lungs|lung parenchyma|trachea|airway|bronchus|bronchoalveolar lavage|bal|bronchoalveolar lavage fluid|balf
nasal epithelium|nasal mucosa
liver
pancreas
pancreatic islet|islet|islets|pancreatic islets
kidney|kidney cortex|renal cortex|renal medulla|kidney medulla
bladder
stomach
small intestine|ileum|jejunum|duodenum
large intestine|colon|rectum|cecum|caecum|sigmoid colon
intestine|gut
esophagus|oesophagus
skin|epidermis|dermis
scalp
adipose|adipose tissue|fat|white adipose tissue|subcutaneous adipose tissue|visceral adipose tissue|brown adipose tissue|omentum|epididymal fat|perigonadal adipose tissue
skeletal muscle|muscle|quadriceps|tibialis anterior|gastrocnemius|soleus|diaphragm
bone|femur|tibia|cartilage|synovium|synovial tissue|joint
tooth|dental pulp|gingiva|oral mucosa|tongue|salivary gland
breast|mammary gland|mammary fat pad
prostate
testis|testes|testicle
ovary|ovaries
uterus|endometrium|myometrium|cervix|vagina|fallopian tube
placenta|decidua|chorionic villi
embryo|whole embryo
yolk sac
thyroid
adrenal gland|adrenal|adrenal cortex
pituitary|pituitary gland
inner ear|cochlea|utricle
fetal liver|fetal kidney|fetal lung|fetal brain|fetal heart
tumor|tumour
`;

const TISSUE_LEX = new Set(TISSUES.split("\n").flatMap((l) => l.split("|").map((x) => x.trim()).filter(Boolean)));
/** Spellings and plurals that become one label; every other recognised term is kept as written (lowercased). */
const TISSUE_SYN: Record<string, string> = {
  pbmcs: "pbmc", "peripheral blood mononuclear cells": "pbmc", "peripheral blood mononuclear cell": "pbmc",
  oesophagus: "esophagus", testes: "testis", testicle: "testis", ovaries: "ovary", arteries: "artery", lungs: "lung",
  tumour: "tumor", "lymph nodes": "lymph node", lymphnode: "lymph node", islets: "pancreatic islet", islet: "pancreatic islet", "pancreatic islets": "pancreatic islet",
};
const TISSUE_TERMS_BY_LEN = [...TISSUE_LEX].sort((a, b) => b.length - a.length);

function tissueKey(v: string): string {
  return lower(v)
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(human|mouse|murine|rat|mus musculus|homo sapiens|whole|fresh|frozen) /, "")
    .replace(/^(human|mouse|murine|rat) /, "")
    .trim();
}

export function normTissue(v: string): string | null {
  const k = tissueKey(v);
  const bare = k.replace(/ (tissue|tissues|sample|samples)$/, "");
  for (const c of [k, bare]) {
    const sg = c.replace(/s$/, "");
    const hit = TISSUE_LEX.has(c) ? c : TISSUE_LEX.has(sg) ? sg : null;
    if (hit) return TISSUE_SYN[hit] ?? TISSUE_SYN[c] ?? hit;
  }
  return null;
}

/** The single lexicon tissue named inside free text such as a source field ("Human blood cells"), else null. */
export function tissueInText(text: string): string | null {
  const t = ` ${lower(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  const found: string[] = [];
  for (const term of TISSUE_TERMS_BY_LEN) {
    if (term.length < 4 || term === "tumor" || term === "tumour") continue; // "pb", "bm", "fat" and "tumor" are too ambiguous in prose
    if (t.includes(` ${term} `) || t.includes(` ${term}s `)) found.push(TISSUE_SYN[term] ?? term);
  }
  // "kidney cortex" also names kidney: a term inside a longer match is the same tissue
  const keep = [...new Set(found)].filter((a) => !found.some((b) => b !== a && b.includes(a)));
  return keep.length === 1 ? keep[0] : null;
}

const CELL_TYPES = `
t cell|t cells|t lymphocyte|t lymphocytes|t-cell|t-cells
cd4 t cell|cd4+ t cell|cd4+ t cells|cd4 t cells|cd4+ t-cells|cd4+ t lymphocytes|cd4 t
cd8 t cell|cd8+ t cell|cd8+ t cells|cd8 t cells|cd8+ t-cells|cd8 t
regulatory t cell|treg|tregs|regulatory t cells
b cell|b cells|b lymphocyte|b lymphocytes|b-cell|b-cells
plasma cell|plasma cells
nk cell|nk cells|natural killer cell|natural killer cells
monocyte|monocytes|cd14+ monocytes
macrophage|macrophages|alveolar macrophage|alveolar macrophages
neutrophil|neutrophils
dendritic cell|dendritic cells|dc|dcs
mast cell|mast cells
eosinophil|eosinophils
microglia
astrocyte|astrocytes
oligodendrocyte|oligodendrocytes
neuron|neurons
fibroblast|fibroblasts
endothelial cell|endothelial cells
epithelial cell|epithelial cells|epithelia cell|epithelia cells
hepatocyte|hepatocytes
adipocyte|adipocytes
cardiomyocyte|cardiomyocytes
hematopoietic stem cell|hematopoietic stem cells|hsc|hscs|hspc|hspcs|cd34+ cells|cd34+
immune cell|immune cells|cd45+ cells|cd45+|leukocytes|leukocyte
pbmc|pbmcs|peripheral blood mononuclear cells
nuclei|all nuclei|single nuclei
`;
const CELL_LEX = (() => {
  const m = new Map<string, string>();
  for (const line of CELL_TYPES.split("\n")) {
    const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) if (!m.has(p)) m.set(p, parts[0]);
  }
  return m;
})();

const HEALTHY = new Set(["healthy", "healthy control", "healthy controls", "healthy donor", "healthy donors", "healthy volunteer", "normal", "control", "controls", "non-diseased", "nondiseased", "no disease", "none", "not diseased", "unaffected", "ctrl", "hc", "normal control", "health", "healthy individual", "healthy adult"]);

const DISEASES = `
alzheimer's disease|alzheimer disease|alzheimers disease|alzheimer's
parkinson's disease|parkinson disease|parkinsons disease|idiopathic parkinson's disease (ipd)|idiopathic parkinson's disease
covid-19|covid19|covid|sars-cov-2|sars-cov-2 infection|covid-19 patient
type 2 diabetes|t2d|t2dm|type ii diabetes|type 2 diabetes mellitus
type 1 diabetes|t1d|t1dm|type i diabetes
obesity
crohn's disease|crohn disease|crohns disease
ulcerative colitis
inflammatory bowel disease|ibd
rheumatoid arthritis
systemic lupus erythematosus|sle|lupus
multiple sclerosis
asthma
copd|chronic obstructive pulmonary disease
idiopathic pulmonary fibrosis|ipf|pulmonary fibrosis
cystic fibrosis
psoriasis
atopic dermatitis|eczema
sepsis
tuberculosis
hiv|hiv infection|hiv-1 infection
influenza|influenza infection
breast cancer
lung cancer
colorectal cancer|colon cancer
pancreatic cancer|pdac
prostate cancer
ovarian cancer
liver cancer|hepatocellular carcinoma|hcc
glioblastoma|gbm
melanoma
leukemia|leukaemia
lymphoma
cancer|tumor|tumour
`;
const DISEASE_LEX = (() => {
  const m = new Map<string, string>();
  for (const line of DISEASES.split("\n")) {
    const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) if (!m.has(p)) m.set(p, parts[0]);
  }
  return m;
})();

const UNTREATED = new Set(["none", "untreated", "no treatment", "no", "naive", "naïve", "unstimulated", "baseline", "not treated", "nil", "n/a none", "control untreated", "no drug", "non-treated", "nontreated", "untreated control"]);
const VEHICLE = new Set(["vehicle", "pbs", "dmso", "saline", "mock", "sham", "vehicle control", "water", "placebo", "mock infected", "mock-infected", "mock treated", "control vehicle", "veh", "nacl"]);

const ANCESTRY = new Map<string, string>([
  ["white", "white"], ["caucasian", "white"], ["european", "white"], ["european american", "white"], ["non-hispanic white", "white"],
  ["black", "black or african american"], ["african american", "black or african american"], ["african", "black or african american"], ["black or african american", "black or african american"],
  ["asian", "asian"], ["east asian", "asian"], ["chinese", "asian"], ["han chinese", "asian"], ["japanese", "asian"], ["korean", "asian"], ["south asian", "asian"],
  ["hispanic", "hispanic or latino"], ["latino", "hispanic or latino"], ["hispanic or latino", "hispanic or latino"], ["hispanic/latino", "hispanic or latino"],
]);

// ── key tables ─────────────────────────────────────────────────────────────

/** Normalised key (see normKey) -> attribute. Earlier entries win when a sample has several keys for one attribute. */
const KEY_RULES: { attr: Attr | "life_stage_or_age"; re: RegExp }[] = [
  { attr: "tissue", re: /^(tissue|tissue type|tissue source|tissue origin|tissue region|tissue sampled|source tissue|sample tissue|organ|organ type|tissue organ|tissue\/cell source|tissue\/cell type|anatomical site|anatomic site|anatomical region|body site|biopsy site|brain region|tissue site|region)$/ },
  { attr: "sample_type", re: /^(sample type|biomaterial type|material type|cell line|cell lines|cell line name|cell line source|cell type line)$/ },
  { attr: "cell_type_sorted", re: /^(cell type|celltype|cell types|cell population|sorted population|sorted cell type|sort|cell\/nuclei type|cell nuclei type|cell subtype|cell lineage|cell type sorted|facs population|facs gate|sorted by|cell fraction|cell subset)$/ },
  { attr: "disease", re: /^(disease|disease state|disease status|disease type|diagnosis|clinical diagnosis|health state|health status|covid status|covid 19 status|covid19 status|clinical status|pathology|disease condition|disease group status)$/ },
  { attr: "treatment", re: /^(treatment|treatments|treated with|agent|stimulation|stimulus|stimulated with|stimulation condition|drug|drug treatment|compound|perturbation|infection|infection status|exposure|diet|intervention|treatment group|treatment condition|vaccine|vaccination|inhibitor|medication|therapy)$/ },
  { attr: "timepoint", re: /^(time|time point|timepoint|time points|timepoints|days of differentiation|day of differentiation|induction day|treatment duration|treatment time|duration of treatment|div|dpi|hpi|dpt|day|days|hours|hour|time after .*|time post .*|days post .*|hours post .*|days after .*|hours after .*|days in vitro|differentiation day|differentiation time|time of collection|collection time|time since .*|stage day)$/ },
  { attr: "genotype", re: /^(genotype|genotype\/variation|strain|mouse strain|strain background|genetic background|background|mutation|genetic modification|transgene|knockout|variation|genotype\/strain|strain\/genotype)$/ },
  { attr: "age", re: /^(age|age at death|age of human|age at sampling|age at collection|donor age|age years|age yrs|age in years|age \(.*\)|age at surgery|age at biopsy|age weeks|age days|age months|mouse age|age of mice|age of donor)$/ },
  { attr: "life_stage_or_age", re: /^(developmental stage|dev stage|life stage|developmental age|stage of development|embryonic stage|gestational age|fetal age)$/ },
  { attr: "sex", re: /^(sex|gender|sex of donor|donor sex|sex of origin|sex \(.*\)|gender \(.*\)|sex gender|biological sex|donor gender|patient sex|patient gender)$/ },
  { attr: "ancestry", re: /^(race|ethnicity|ancestry|ethnic group|race\/ethnicity|donor ethnicity|self reported ethnicity|ethnic background|donor race|patient race|self reported race)$/ },
  { attr: "donor", re: /^(donor|donor id|donor name|donor number|subject|subject id|subject name|patient|patient id|patient number|patient name|individual|individual id|participant|participant id|animal id|animal|mouse id|mouse|case id|specimen donor)$/ },
];

const NONINFORMATIVE_CELL = /^(all( cells| nuclei)?|various|mixed( population)?|live( cells?)?|single cell suspension|single cells?|cells?|total( cells)?|whole|unsorted|unfractionated|bulk)$/i;

const FREE_MAX: Partial<Record<string, number>> = { tissue: 48, cell_type_sorted: 48, disease: 48, treatment: 48, genotype: 60, ancestry: 40, sample_type: 48 };

/** Keys that never carry biology; left out of the unmapped list (they would only add noise to the model batch). */
const NOISE_KEY_RE = /^(batch|lane|barcode|10x barcode|library|library type|library id|sample|sample id|sample name|name|id|index|run|well|hto|tag|link|lab|source|description|assay|genome build|cells loaded|pooled|experiment|replicate|rep|plate|chip|channel|sequencing batch|molecule subtype|subcellular fraction term name|biosample encode accession|processing batch|collection date|colon operation date|cdna|chemistry|platform|instrument|contact|submitter)$/;

// ── value normalisers ──────────────────────────────────────────────────────

type Placed = { norm: string; placed: boolean };

function normSex(v: string): string | null {
  const s = lower(v);
  if (/^(m|male|man|men|boy|♂|xy|male \(xy\)|males)$/.test(s)) return "male";
  if (/^(f|female|woman|women|girl|♀|xx|female \(xx\)|females)$/.test(s)) return "female";
  if (/^(mixed|both|male and female|female and male|male\/female|female\/male|pooled|mixed sex|male, female|female, male)$/.test(s)) return "mixed";
  return null;
}

function normDisease(v: string, key: string): Placed {
  const s = lower(v);
  if (/covid/.test(key)) {
    if (/^(positive|pos|infected|covid|covid 19|case|patient|severe|moderate|mild|critical)/.test(s)) return { norm: "covid-19", placed: true };
    if (/^(negative|neg|control|healthy|uninfected|non covid|noncovid)/.test(s)) return { norm: "healthy", placed: true };
  }
  if (HEALTHY.has(s)) return { norm: "healthy", placed: true };
  // A comorbidity checklist ("DM: no; HTN: no; CAD: no", ENCODE donors) with every answer "no" is a healthy donor, not a case.
  const checks = s.split(/\s*;\s*/).filter(Boolean);
  if (checks.length > 1 && checks.every((c) => /^[a-z0-9 /-]{1,30}:\s*(no|none|negative)$/.test(c))) return { norm: "healthy", placed: true };
  const hit = DISEASE_LEX.get(s) ?? DISEASE_LEX.get(s.replace(/\s*\([^)]*\)$/, ""));
  if (hit) return { norm: hit, placed: true };
  return { norm: clean(v), placed: false };
}

function normTreatment(v: string): { norm: string; status: "untreated" | "vehicle" | "treated"; placed: boolean } {
  const s = lower(v);
  if (UNTREATED.has(s)) return { norm: "none", status: "untreated", placed: true };
  if (VEHICLE.has(s)) return { norm: s === "pbs" ? "PBS" : s === "dmso" ? "DMSO" : s, status: "vehicle", placed: true };
  return { norm: clean(v), status: "treated", placed: false };
}

function normAncestry(v: string): Placed {
  const s = lower(v);
  const hit = ANCESTRY.get(s);
  return hit ? { norm: hit, placed: true } : { norm: clean(v), placed: false };
}

function normSampleType(v: string, key: string): Placed | null {
  const s = lower(v);
  if (/cell line/.test(key)) return { norm: "cell line", placed: true };
  if (/^(tissue|primary tissue|primary|biopsy|primary cells|primary cell)$/.test(s)) return { norm: "primary tissue", placed: true };
  if (/^(cell line|immortalized cell line)$/.test(s)) return { norm: "cell line", placed: true };
  if (/^(organoid|organoids)$/.test(s)) return { norm: "organoid", placed: true };
  if (/^(pdx|patient derived xenograft|patient-derived xenograft)$/.test(s)) return { norm: "pdx", placed: true };
  if (/^(ipsc|ipsc derived|ipsc-derived|ipsc derived cells)$/.test(s)) return { norm: "ipsc derived", placed: true };
  if (/^(tumor|tumour|cancer|malignant)$/.test(s)) return null; // a tumor/normal flag, handled as disease state
  return { norm: clean(v), placed: false };
}

const UNIT_ALIASES: Record<string, string> = {
  y: "years", yr: "years", yrs: "years", year: "years", years: "years", yo: "years", "y.o.": "years", "years old": "years", "year old": "years",
  mo: "months", mos: "months", month: "months", months: "months", m: "months",
  w: "weeks", wk: "weeks", wks: "weeks", week: "weeks", weeks: "weeks",
  d: "days", day: "days", days: "days", dpi: "days", div: "days", dpt: "days",
  h: "hours", hr: "hours", hrs: "hours", hour: "hours", hours: "hours", hpi: "hours",
  min: "minutes", mins: "minutes", minute: "minutes", minutes: "minutes",
  pcw: "pcw", gw: "pcw",
};
const UNIT_RE = "(years? old|y\\.o\\.|years?|yrs?|yo|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|pcw|gw|y|m|w|d|h)";

function unitFromKey(key: string): string | null {
  if (/\b(years?|yrs?)\b/.test(key)) return "years";
  if (/\bmonths?\b/.test(key)) return "months";
  if (/\bweeks?\b/.test(key)) return "weeks";
  if (/\b(days?|div|dpi|dpt)\b/.test(key)) return "days";
  if (/\b(hours?|hrs?|hpi)\b/.test(key)) return "hours";
  return null;
}

const NUM = "(\\d+(?:\\.\\d+)?)";

/** "1 day", "6 days". */
const withUnit = (num: string, unit: string) => `${num} ${Number(num) === 1 ? unit.replace(/s$/, "") : unit}`;

interface Parsed {
  norm: string;
  num: number;
  unit: string | null;
  confidence: number;
}

/** "8-12 weeks" -> 10 weeks (midpoint, norm keeps the range); "36" -> 36 years only for human donors. */
export function parseAge(value: string, key: string, organism: string | null): Parsed | null {
  const s = lower(value)
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/^(post ?natal|approximately|approx\.?|about|around|~)\s*/, "")
    .replace(/[-\s]*old$/, "")
    .replace(new RegExp(`^(${NUM})-(?=[a-z])`), "$1 ")
    .trim();
  let m = s.match(new RegExp(`^${NUM}\\s*(?:yrs?|years?)\\s*${NUM}\\s*(?:mos?|months?)$`));
  if (m) {
    const yrs = Math.round((Number(m[1]) + Number(m[2]) / 12) * 100) / 100;
    return { norm: `${m[1]} years ${m[2]} months`, num: yrs, unit: "years", confidence: 0.95 };
  }
  m = s.match(new RegExp(`^e\\s*${NUM}$`));
  if (m) return { norm: `E${m[1]}`, num: Number(m[1]), unit: "E-days", confidence: 0.95 };
  m = s.match(new RegExp(`^p\\s*${NUM}$`));
  if (m) return { norm: `P${m[1]}`, num: Number(m[1]), unit: "postnatal days", confidence: 0.95 };
  m = s.match(new RegExp(`^${NUM}\\s*(?:-|–|to)\\s*${NUM}[\\s-]*${UNIT_RE}?$`));
  if (m) {
    const unit = m[3] ? UNIT_ALIASES[m[3]] ?? null : unitFromKey(key);
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (b < a) return null;
    return { norm: `${m[1]}-${m[2]}${unit ? " " + unit : ""}`, num: Math.round(((a + b) / 2) * 100) / 100, unit, confidence: unit ? 0.95 : 0.7 };
  }
  m = s.match(new RegExp(`^${NUM}\\s*${UNIT_RE}?(?:\\s*old)?$`));
  if (m) {
    const unit = m[2] ? UNIT_ALIASES[m[2]] ?? null : unitFromKey(key);
    if (unit) return { norm: withUnit(m[1], unit), num: Number(m[1]), unit, confidence: 0.95 };
    // A bare number in a human donor's age field is years in every record we have seen; marked as assumed.
    if (organism === "Homo sapiens" && Number(m[1]) <= 110) return { norm: withUnit(m[1], "years"), num: Number(m[1]), unit: "years", confidence: 0.75 };
    return { norm: m[1], num: Number(m[1]), unit: null, confidence: 0.7 };
  }
  return null;
}

/** Time since a start point: "24 hours", "Day6", "Div35", "baseline". */
export function parseTimepoint(value: string, key: string): Parsed | null {
  const s = lower(value);
  if (/^(baseline|pre-?treatment|pre|before treatment|t0)$/.test(s)) return { norm: "baseline", num: 0, unit: null, confidence: 0.95 };
  let m = s.match(new RegExp(`^(day|d|week|wk|w|hour|hr|h|month|div)\\s*${NUM}$`));
  if (m) {
    const unit = UNIT_ALIASES[m[1]] ?? "days";
    return { norm: withUnit(m[2], unit), num: Number(m[2]), unit, confidence: 0.95 };
  }
  m = s.match(new RegExp(`(?:^|[^a-z0-9.])${NUM}\\s*${UNIT_RE}(?![a-z])`));
  if (m && UNIT_ALIASES[m[2]]) return { norm: withUnit(m[1], UNIT_ALIASES[m[2]]), num: Number(m[1]), unit: UNIT_ALIASES[m[2]], confidence: 0.9 };
  m = s.match(new RegExp(`^${NUM}$`));
  if (m) {
    const unit = unitFromKey(key);
    return { norm: unit ? withUnit(m[1], unit) : m[1], num: Number(m[1]), unit, confidence: unit ? 0.95 : 0.7 };
  }
  return null;
}

const WILD = /^(wild[ -]?type|wt|wildtype|\+\/\+|wt\/wt|control wt|wild type control)$/i;

// ── extraction ─────────────────────────────────────────────────────────────

/** Years for an age (for the life-stage rule only); null when the unit cannot be converted. */
function yearsOf(num: number, unit: string | null): number | null {
  switch (unit) {
    case "years": return num;
    case "months": return num / 12;
    case "weeks": return num / 52.18;
    case "days": return num / 365.25;
    default: return null;
  }
}

export function lifeStageFromHumanAge(years: number): string {
  if (years < 18) return "pediatric";
  if (years >= 65) return "aged";
  return "adult";
}

export function extractSampleAttrs(s: SampleText): Extraction {
  const rows: AttrRow[] = [];
  const unplaced: Unplaced[] = [];
  const unmapped: Extraction["unmapped"] = [];
  const have = new Set<string>();
  const organism = s.organism_primary ?? null;

  const push = (attr: Attr, p: { raw: string; norm: string; num?: number | null; unit?: string | null; evidence: string; confidence: number }, key: string, placed = true) => {
    if (have.has(attr)) return false;
    have.add(attr);
    rows.push({
      gsm_id: s.gsm_id,
      gse_id: s.gse_id,
      attr,
      value_raw: p.raw,
      value_norm: p.norm,
      value_num: p.num ?? null,
      unit: p.unit ?? null,
      source: "geo",
      evidence: p.evidence,
      confidence: p.confidence,
      extractor_version: EXTRACTOR_VERSION,
    });
    if (!placed) unplaced.push({ attr, key, value: p.raw, evidence: p.evidence });
    return true;
  };

  for (const pair of parsePairs(s.characteristics)) {
    const rule = KEY_RULES.find((r) => r.re.test(pair.key));
    const value = clean(pair.value);
    if (!rule) {
      if (value && !NOISE_KEY_RE.test(pair.key)) unmapped.push({ key: pair.key, value, evidence: pair.evidence });
      continue;
    }
    if (!value || value.length > 120) continue;
    const ev = pair.evidence;
    const attr = rule.attr;
    // A sentence in a label field is not a label: leave it for the model pass instead of repeating it in a card.
    const max = FREE_MAX[attr];
    if (max && value.length > max) {
      if (!isMissing(value)) unplaced.push({ attr: attr as Attr, key: pair.key, value, evidence: ev });
      continue;
    }

    if (attr === "tissue") {
      const s1 = lower(value);
      if (/^(tumou?r|cancer|malignant)$/.test(s1)) { push("disease_state", { raw: value, norm: "case", evidence: ev, confidence: 0.95 }, pair.key); continue; }
      if (/^(normal|adjacent normal|normal adjacent|non-?tumou?r|benign)$/.test(s1) && pair.key === "tissue type") { push("disease_state", { raw: value, norm: "control", evidence: ev, confidence: 0.95 }, pair.key); continue; }
      if (isMissing(value) || HEALTHY.has(s1) || UNTREATED.has(s1)) continue;
      const t = normTissue(value);
      // A bare "region" key often holds a sampling code ("region: R1" for tumour region 1), which the ontology pass then read as
      // rhombomere 1. Under that key only a value the lexicon knows is a tissue.
      if (pair.key === "region" && !t && !tissueInText(value)) {
        unplaced.push({ attr: "tissue", key: pair.key, value, evidence: ev });
        continue;
      }
      push("tissue", { raw: value, norm: t ?? clean(value), evidence: ev, confidence: t ? 0.95 : 0.7 }, pair.key, !!t);
    } else if (attr === "sample_type") {
      if (isMissing(value)) continue;
      if (/cell line/.test(pair.key)) {
        // Some submitters write the tissue or "primary" in the cell line field; that is not a cell line.
        if (normTissue(value) || tissueInText(value) || /^(primary|none|no|not applicable|n\/a|-)/i.test(value)) {
          unplaced.push({ attr: "sample_type", key: pair.key, value, evidence: ev });
          continue;
        }
        push("sample_type", { raw: value, norm: "cell line", evidence: ev, confidence: 0.95 }, pair.key);
        continue;
      }
      const st = normSampleType(value, pair.key);
      if (st === null) {
        const t = lower(value);
        push("disease_state", { raw: value, norm: /^(normal|benign)$/.test(t) ? "control" : "case", evidence: ev, confidence: 0.9 }, pair.key);
      } else push("sample_type", { raw: value, norm: st.norm, evidence: ev, confidence: st.placed ? 0.95 : 0.7 }, pair.key, st.placed);
    } else if (attr === "cell_type_sorted") {
      if (isMissing(value) || NONINFORMATIVE_CELL.test(value)) continue;
      const c = CELL_LEX.get(lower(value));
      push("cell_type_sorted", { raw: value, norm: c ?? clean(value), evidence: ev, confidence: c ? 0.95 : 0.7 }, pair.key, !!c);
    } else if (attr === "disease") {
      if (isMissing(value)) continue;
      const d = normDisease(value, pair.key);
      if (push("disease", { raw: value, norm: d.norm, evidence: ev, confidence: d.placed ? 0.95 : 0.7 }, pair.key, d.placed)) {
        push("disease_state", { raw: value, norm: d.norm === "healthy" ? "control" : "case", evidence: ev, confidence: d.placed ? 0.9 : 0.6 }, pair.key);
      }
    } else if (attr === "treatment") {
      if (!value || (isMissing(value) && lower(value) !== "none")) continue;
      const t = normTreatment(value);
      if (push("treatment", { raw: value, norm: t.norm, evidence: ev, confidence: t.placed ? 0.95 : 0.7 }, pair.key, t.placed)) {
        push("treatment_status", { raw: value, norm: t.status, evidence: ev, confidence: t.placed ? 0.95 : 0.7 }, pair.key);
      }
    } else if (attr === "timepoint") {
      const t = parseTimepoint(value, pair.key);
      if (t) push("timepoint", { raw: value, norm: t.norm, num: t.num, unit: t.unit, evidence: ev, confidence: t.confidence }, pair.key);
      else if (!isMissing(value)) unplaced.push({ attr: "timepoint", key: pair.key, value, evidence: ev });
    } else if (attr === "genotype") {
      if (isMissing(value)) continue;
      push("genotype", { raw: value, norm: WILD.test(value) ? "wild type" : value, evidence: ev, confidence: 0.95 }, pair.key);
    } else if (attr === "age") {
      const a = parseAge(value, pair.key, organism);
      if (!a) {
        if (!isMissing(value)) unplaced.push({ attr: "age", key: pair.key, value, evidence: ev });
        continue;
      }
      if (push("age", { raw: value, norm: a.norm, num: a.num, unit: a.unit, evidence: ev, confidence: a.confidence }, pair.key)) {
        if (a.unit === "E-days") push("life_stage", { raw: value, norm: "embryonic", evidence: ev, confidence: 0.9 }, pair.key);
        else if (organism === "Homo sapiens") {
          const y = yearsOf(a.num, a.unit);
          if (y != null) push("life_stage", { raw: value, norm: lifeStageFromHumanAge(y), evidence: ev, confidence: Math.min(a.confidence, 0.8) }, pair.key);
        }
      }
    } else if (attr === "life_stage_or_age") {
      if (isMissing(value)) continue;
      const v = lower(value);
      const ls = v.match(/^(embryonic|embryo|fetal|foetal|neonatal|newborn|neonate|pediatric|paediatric|child|juvenile|infant|adult|aged|elderly)$/);
      const e = v.match(new RegExp(`^e\\s*${NUM}$`));
      if (ls) {
        const map: Record<string, string> = { embryo: "embryonic", foetal: "fetal", newborn: "neonatal", neonate: "neonatal", paediatric: "pediatric", child: "pediatric", infant: "pediatric", juvenile: "pediatric", elderly: "aged" };
        push("life_stage", { raw: value, norm: map[ls[1]] ?? ls[1], evidence: ev, confidence: 0.95 }, pair.key);
      } else if (e) {
        push("age", { raw: value, norm: `E${e[1]}`, num: Number(e[1]), unit: "E-days", evidence: ev, confidence: 0.95 }, pair.key);
        push("life_stage", { raw: value, norm: "embryonic", evidence: ev, confidence: 0.9 }, pair.key);
      } else unplaced.push({ attr: "life_stage", key: pair.key, value, evidence: ev });
    } else if (attr === "sex") {
      if (isMissing(value)) continue;
      const sx = normSex(value);
      if (sx) push("sex", { raw: value, norm: sx, evidence: ev, confidence: 0.95 }, pair.key);
      else unplaced.push({ attr: "sex", key: pair.key, value, evidence: ev });
    } else if (attr === "ancestry") {
      if (isMissing(value)) continue;
      const a = normAncestry(value);
      push("ancestry", { raw: value, norm: a.norm, evidence: ev, confidence: a.placed ? 0.95 : 0.7 }, pair.key, a.placed);
    } else if (attr === "donor") {
      if (isMissing(value)) continue;
      push("donor", { raw: value, norm: value, evidence: ev, confidence: 0.95 }, pair.key);
    }
  }

  // The source field names the tissue in many records that have no tissue key ("Human blood cells ...").
  if (!have.has("tissue") && s.source) {
    const src = clean(s.source);
    if (src.length <= 60) {
      const t = tissueInText(src);
      if (t) push("tissue", { raw: src, norm: t, evidence: src, confidence: 0.8 }, "source");
    }
  }

  return { rows, unplaced, unmapped };
}

/** True when the evidence is exactly the text a row claims to come from. */
export function evidenceHolds(row: Pick<AttrRow, "evidence">, s: Pick<SampleText, "title" | "source" | "characteristics">): boolean {
  const ev = row.evidence;
  if (!ev) return false;
  const hay = [s.title ?? "", s.source ?? "", typeof s.characteristics === "string" ? s.characteristics : JSON.stringify(s.characteristics ?? "")];
  const flat = (t: string) => t.replace(/\s+/g, " ");
  return hay.some((h) => flat(h).includes(flat(ev)));
}
