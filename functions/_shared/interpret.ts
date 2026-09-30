/**
 * Query interpretation for /api/nl-search and the MCP server, on Cloudflare.
 *
 *   1. `parseQuery` — a deterministic vocabulary parse that always runs and
 *      needs no model. Organism comes from explicit species words only
 *      ("mouse", "mice", "murine", "human", "patients", "zebrafish", …),
 *      tissue from explicit anatomical words, disease and assay from the same
 *      D1 `vocab_rules` that built the normalised columns (applied at word
 *      boundaries, with a query-safe policy: study-design words, aging and
 *      perturbations are not diseases, and a disease never implies a tissue —
 *      "melanoma" is Cancer, not Skin). Cell types come from a curated list
 *      plus the catalog's own top cell_type values; "at least N cells" and
 *      year ranges are read literally. Leftover meaningful words become `q`.
 *   2. Only when the parse leaves real ambiguity (several plain words it could
 *      not place) is a model asked, once per normalised query: its validated
 *      answer is cached in D1 `interpret_cache` (fronted by the Cache API), so
 *      a repeat costs nobody anything. A fresh call spends one unit of the
 *      caller's daily "search" budget. Budget spent, no model configured, or a
 *      model error → the vocabulary parse is the answer.
 *
 * The model's answer is validated against the vocabulary and merged into the
 * parse: the parse's organism always wins (organism is a hard filter, so a
 * species is never taken from a model unless the query names it), and the
 * model may only add facets the parse missed, each grounded in a word of the
 * query.
 */
import type { AppEnv, WaitUntil } from "./env";
import type { Identity } from "./identity";
import { consume, quotaMessage, type Quota } from "./quota";
import { aiConfigured, modelLabel, runJson } from "./ai";
import { nowIso } from "./session";
import { cellTypeVocab } from "./facets-core";
import type { Ctx } from "./search-core";
import {
  ASSAY_FAMILIES,
  DISEASE_GROUPS,
  ORGANISM_COMMON,
  TISSUE_GROUPS,
  canonicalGroup,
  organismToScientific,
  organismVocabForModel,
  resolveGroup,
  type GroupField,
  type VocabRule,
} from "./vocab";

/** Bump whenever the parser policy, the prompt or its pinned examples change, so cached readings expire at once. */
export const INTERPRET_RULES_VERSION = "12-cf1";

export type InterpretEnv = Pick<
  AppEnv,
  | "DB"
  | "AI"
  | "AI_MODEL"
  | "AI_GATEWAY_ID"
  | "ANTHROPIC_API_KEY"
  | "ANTHROPIC_MODEL"
  | "AI_LIMIT_SEARCH_ANON"
  | "AI_LIMIT_SEARCH_USER"
  | "AI_LIMIT_EXPLAIN_ANON"
  | "AI_LIMIT_EXPLAIN_USER"
>;

const INTERPRET_TIMEOUT_MS = 8000;
const INTERPRET_MAX_TOKENS = 500;
const CELL_TYPE_VOCAB_LIMIT = 200;
const INTERPRET_CACHE_URL = "https://singlet.bio/__internal/interpret";
const EDGE_CACHE_TTL = 3600;
const D1_CACHE_MAX_AGE_MS = 30 * 86_400_000;
const MAX_QUERY_CHARS = 500;
const MAX_TOKENS = 40;

export interface Interpreted {
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  year_min: number | null;
  year_max: number | null;
  q: string[];
}

export const emptyInterpreted = (): Interpreted => ({
  organism: [],
  tissue_group: [],
  disease_group: [],
  assay_family: [],
  cell_type: [],
  min_cells: null,
  year_min: null,
  year_max: null,
  q: [],
});

/** Shape any object into the interpretation contract (no vocabulary checks). */
export function coerceInterpreted(raw: unknown): Interpreted {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : typeof v === "string" && v.trim()
        ? [v.trim()]
        : [];
  const int = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
    if (typeof v === "string" && v.trim()) {
      const n = parseInt(v.replace(/[,_\s]/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  return {
    organism: arr(obj.organism),
    tissue_group: arr(obj.tissue_group ?? obj.tissue),
    disease_group: arr(obj.disease_group ?? obj.disease),
    assay_family: arr(obj.assay_family ?? obj.protocol),
    cell_type: arr(obj.cell_type),
    min_cells: int(obj.min_cells),
    year_min: int(obj.year_min),
    year_max: int(obj.year_max),
    q: arr(obj.q),
  };
}

/** True when nothing at all was read from the query (not even keywords). */
export function isEmptyInterpretation(i: Interpreted): boolean {
  return (
    !i.organism.length &&
    !i.tissue_group.length &&
    !i.disease_group.length &&
    !i.assay_family.length &&
    !i.cell_type.length &&
    i.min_cells == null &&
    i.year_min == null &&
    i.year_max == null &&
    !i.q.length
  );
}

/** Cache key form of a query. */
export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

// ── Vocabulary policy for free-text queries ─────────────────────────────────
//
// vocab_rules were written for GEO field values ("Cell type: CD4+ T cells"),
// where substring matching is safe. A typed question is not a field value, so
// rules are applied at word starts, and the entries below that would misread
// ordinary query words are left out.

/** Species words that are too ambiguous in free text ("CAT" is a gene, "mm" a unit or mm10). */
const ORGANISM_DENY = new Set(["hs", "mm", "cho", "cat"]);

/** Tissue groups that are not anatomy: set by diseases, sorting or mixtures, never by a query word. */
const TISSUE_SKIP = new Set(["Tumor (site unspecified)", "Multiple / mixed", "Immune cells (sorted)", "Other"]);

/** Tissue patterns that name a disease — never evidence of a site, even for the model. */
const TISSUE_DISEASE_PATTERNS = new Set([
  "glioma", "glioblastoma", "glioblatoma", "gbm", "medulloblastoma", "ependymoma", "schwannoma", "hnscc",
  "wound", "blister", "biopsy", "ascites",
]);

/**
 * Tissue patterns the parser does not use on its own: cell types (the cell-type
 * pass reads those), sample handling, and words that are ambiguous in a query.
 * The model may still cite a cell-type word as evidence ("neurons" → Brain / CNS).
 */
const TISSUE_PARSE_DENY = new Set([
  ...TISSUE_DISEASE_PATTERNS,
  "neuron", "neural", "astrocyte", "oligodendro", "microglia", "glial", "melanocyte", "keratin", "adipocyte",
  "fibroblast", "myoblast", "satellite", "chondro", "osteo", "endotheli", "trophoblast", "oocyte", "sperm",
  "germ cell", "hair cell", "hspc", "cd34", "hematopoietic", "haematopoietic", "mononuclear", "leukocyte",
  "leucocyte", "plasma", "ganglion", "culture", "differentiated", "differentiation", "engineered", "car product",
  "car-t", "car t", "xenograft", "pdx", "cdx", "cell pellet", "head", "tail", "sigma", "all", "tissue", "mixed",
  "various", "multiple", "n.a",
]);

/** Short tissue patterns that must match a whole word ("colon" ≠ "colonization", "sinus" ≠ "sinusoidal"). */
const WHOLE_WORD_TISSUE: ReadonlySet<string> = new Set(["colon", "sinus", "plant", "joint", "crypt", "lens", "root", "shoot"]);
const NO_WHOLE_WORD: ReadonlySet<string> = new Set<string>();

/** Disease groups a query word never sets. */
const DISEASE_SKIP = new Set(["Other / unspecified"]);

/** The only "Healthy / control" patterns that are an explicit ask for healthy samples. */
const HEALTHY_OK = new Set(["healthy", "healthy donor", "healthy control", "healthy controls", "non-diseased", "no disease", "non-disease"]);

/** Disease patterns that are study-design words, perturbations, aging, or ambiguous abbreviations in free text. */
const DISEASE_DENY = new Set([
  "no", "na", "n", "n/a", "none", "ct", "hc", "nc", "ctrl", "wt", "naive", "normal", "normal control", "control",
  "controls", "vehicle", "sham", "untreated", "uninfected", "uninfected control", "benign", "asymptomatic",
  "wild type", "wildtype", "wild-type",
  "mm", "load", "psc", "ssc", "amd", "anca",
  "aged", "aging", "ageing", "old", "elderly", "recipient",
  "knockout", "knock-out", "transgenic", "mutant", "mutation", "carrier", "deficiency",
]);

/** Disease groups precise enough that the matched word adds nothing as a keyword. */
const EXACT_DISEASE = new Set(["COVID-19", "Alzheimer's disease", "Parkinson's disease", "Healthy / control"]);

/** Words that only name a broad disease group; other disease words ("melanoma", "AML") also stay in q. */
const GENERIC_DISEASE_WORDS = new Set([
  "cancer", "cancers", "tumor", "tumors", "tumour", "tumours", "carcinoma", "carcinomas", "malignancy", "malignancies",
  "malignant", "neoplasm", "neoplasms", "neoplasia", "neoplastic", "oncology", "oncologic", "infection", "infections",
  "infected", "infectious", "inflammation", "inflammatory", "autoimmune", "autoimmunity", "metabolic",
]);

/** Assay families a query never sets: a bare "10x" says nothing about chemistry. */
const ASSAY_SKIP = new Set(["10x (version unconfirmed)", "Unknown", "Not single-cell RNA"]);
/** Protocol patterns that must match a whole word ("plate" ≠ "platelet"). */
const WHOLE_WORD_PROTOCOL = new Set(["plate"]);

/** Multi-word keywords kept together in q before any facet pass can split them. */
const KEYWORD_PHRASES = new Set([
  "high fat diet", "high fat", "western diet", "cell cycle", "cell death", "cell fate", "cell state", "wild type",
  "knock out", "single nucleus", "single nuclei", "gene regulatory network",
]);

/** Curated cell types (singular, lowercase) — the spellings GEO annotations use. */
const CELL_TYPES = [
  "t cell", "b cell", "nk cell", "nkt cell", "cd4 t cell", "cd8 t cell", "regulatory t cell", "treg", "helper t cell",
  "cytotoxic t cell", "memory t cell", "naive t cell", "effector t cell", "exhausted t cell", "gamma delta t cell",
  "mait cell", "tfh cell", "th17 cell", "car t cell", "tumor infiltrating lymphocyte", "lymphocyte", "plasma cell",
  "memory b cell", "germinal center b cell", "plasmablast", "macrophage", "tumor associated macrophage", "monocyte",
  "dendritic cell", "plasmacytoid dendritic cell", "neutrophil", "eosinophil", "basophil", "mast cell",
  "innate lymphoid cell", "platelet", "megakaryocyte", "erythrocyte", "erythroid cell", "red blood cell",
  "immune cell", "myeloid cell", "hematopoietic stem cell", "hematopoietic progenitor", "progenitor cell",
  "stem cell", "mesenchymal stem cell", "embryonic stem cell", "microglia", "astrocyte", "oligodendrocyte",
  "oligodendrocyte precursor cell", "neuron", "interneuron", "excitatory neuron", "inhibitory neuron",
  "motor neuron", "dopaminergic neuron", "sensory neuron", "radial glia", "neural progenitor", "neural stem cell",
  "schwann cell", "ependymal cell", "pericyte", "endothelial cell", "smooth muscle cell", "fibroblast",
  "cancer associated fibroblast", "myofibroblast", "cardiomyocyte", "hepatocyte", "cholangiocyte", "kupffer cell",
  "hepatic stellate cell", "stellate cell", "epithelial cell", "keratinocyte", "melanocyte", "adipocyte",
  "preadipocyte", "chondrocyte", "osteoblast", "osteoclast", "myoblast", "satellite cell", "muscle stem cell",
  "podocyte", "beta cell", "alpha cell", "acinar cell", "ductal cell", "islet cell", "enterocyte", "goblet cell",
  "paneth cell", "tuft cell", "enteroendocrine cell", "intestinal stem cell", "at1 cell", "at2 cell",
  "alveolar epithelial cell", "club cell", "ciliated cell", "basal cell", "secretory cell", "trophoblast", "oocyte",
  "spermatocyte", "spermatogonia", "sertoli cell", "leydig cell", "granulosa cell", "germ cell", "hair cell",
  "retinal ganglion cell", "photoreceptor", "muller glia",
];

/** Cell-type words that on their own name no cell type. */
const CELL_NOISE = new Set([
  "cell", "single cell", "whole cell", "total cell", "live cell", "living cell", "all cell", "mixed cell", "sorted cell",
  "unsorted cell", "cancer cell", "tumor cell", "tumour cell", "bulk cell", "primary cell", "cultured cell", "dissociated cell",
  "viable cell", "na cell", "other cell", "unknown cell", "blood cell",
]);

/** A catalog cell_type value is used only when it ends like a cell type. */
const CELL_HEAD_RE =
  /(cell|cyte|blast|phage|glia|neuron|progenitor|treg|pericyte|photoreceptor|platelet|neutrophil|eosinophil|basophil|spermatogonia|spermatid|myotube|myofiber)$/;

/** Plural forms that are already the base form. */
const NO_SINGULAR = new Set(["microglia", "glia", "nuclei", "bacteria", "villi", "status", "virus", "corpus", "plus", "spermatogonia"]);

/** Same list as search-core's FTS stopwords, plus question words. */
const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "for", "to", "from", "with", "and", "or", "by", "is", "are", "was",
  "were", "be", "as", "that", "this", "these", "those", "into", "its", "their", "using", "via", "vs", "versus",
  "about", "over", "under", "after", "before", "during", "between", "within", "without", "show", "find", "me",
  "all", "any", "some", "studies", "study", "datasets", "dataset", "data",
  "i", "we", "my", "our", "it", "which", "what", "where", "when", "how", "who", "does", "do", "did", "can", "could",
  "would", "should", "there", "here", "have", "has", "had", "not", "but", "than", "then", "also", "such", "like",
  "please", "want", "need", "looking", "look", "search", "list", "give", "get", "related", "relating", "involving",
  "based", "derived", "different", "various", "several", "many", "much", "more", "most", "other", "new", "recent",
  "latest", "compared", "comparing", "comparison", "etc", "best", "good", "top", "available", "studying",
  "investigating", "examining", "exploring", "understanding", "role", "roles", "effect", "effects", "impact",
]);

/** Words that say "single-cell data" and nothing about which data. */
const GENERIC_WORDS = new Set([
  "cell", "cells", "single", "single-cell", "singlecell", "sc", "scrna", "scrna-seq", "scrnaseq", "sc-rna-seq",
  "rna", "rna-seq", "rnaseq", "seq", "sequencing", "sequenced", "sample", "samples", "atlas", "atlases", "profiling",
  "profile", "profiles", "profiled", "transcriptome", "transcriptomes", "transcriptomic", "transcriptomics",
  "analysis", "analyses", "10x", "10x-genomics", "chromium", "droplet", "genomics", "gene", "genes", "expression",
  "disease", "diseases", "tissue", "tissues", "type", "types", "level", "levels", "cohort", "cohorts", "experiment",
  "experiments", "public", "geo", "model", "models", "thousand", "million", "v1", "v2", "v3", "v4",
]);

/** Plain words that are fine as keywords without a model reading them. */
const KNOWN_KEYWORDS = new Set([
  "aging", "ageing", "aged", "old", "young", "elderly", "juvenile", "adult", "adults", "neonatal", "neonate",
  "newborn", "infant", "pediatric", "paediatric", "child", "children", "fetal", "embryonic", "postnatal", "knockout",
  "ko", "wildtype", "wt", "mutant", "transgenic", "deficient", "deficiency", "treatment", "treated", "untreated",
  "stimulation", "stimulated", "lps", "drug", "drugs", "vaccine", "vaccination", "exercise", "diet", "fasting",
  "sex", "male", "female", "circadian", "sleep", "stress", "hypoxia", "development", "developmental", "developing",
  "regeneration", "repair", "differentiation", "reprogramming", "perturbation", "crispr", "screen", "lineage",
  "tracing", "trajectory", "velocity", "chromatin", "splicing", "isoform", "tcr", "bcr", "clonotype", "clonal",
  "doublet", "ambient", "xenograft", "pdx", "metastasis", "progression", "resistance", "response", "responder",
  "responders", "immunotherapy", "chemotherapy", "radiation", "checkpoint", "healthy", "control", "controls",
  "normal", "injury", "transplant", "nuclei", "nucleus", "sorted", "organoid", "organoids", "primary", "human",
  "mouse",
]);

/** Evidence that the query states an assay chemistry or platform (guards model-supplied assay families). */
const ASSAY_HINT_RE =
  /(\b[35]\s?(?:'|prime\b|p\b)|multiome|atac|smart|plate-?based|drop-?seq|indrop|in-drop|visium|spatial|xenium|merfish|slide-?seq|stereo-?seq|cite-?seq|rhapsody|seq-?well|microwell|split-?seq|\bparse\b|evercode|sci-?rna|cel-?seq|mars-?seq|icell8|dnbelab|v\(d\)j|\bvdj\b)/i;

// ── Tokens ──────────────────────────────────────────────────────────────────

interface Tok {
  /** As typed, edge punctuation trimmed ("FOXP3", "tumor-infiltrating", "5'"). */
  raw: string;
  /** Lowercase matching form; "+" and non-prime trailing quotes dropped ("cd8+" → "cd8"). */
  key: string;
  pos: number;
  used: boolean;
  /** Consumed as a modifier of a disease/cell phrase, still readable as anatomy ("pulmonary fibrosis"). */
  tissueOk: boolean;
}

const TOKEN_RE = /[\p{L}\p{N}](?:[\p{L}\p{N}+'.\/-]*[\p{L}\p{N}+'])?/gu;

/** Unify quotes and dashes, drop possessive 's ("Alzheimer's" → "Alzheimer"). */
function prepare(q: string): string {
  return q
    .slice(0, MAX_QUERY_CHARS)
    .replace(/[‘’′´`]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/(\p{L})'s\b/gu, "$1");
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    let raw = m[0];
    if (raw.endsWith("'") && !/\d'$/.test(raw)) raw = raw.replace(/'+$/, "");
    const key = raw.toLowerCase().replace(/\++$/, "");
    if (!key) continue;
    out.push({ raw, key, pos: out.length, used: false, tissueOk: false });
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

function isUpper(raw: string): boolean {
  return /\p{Lu}/u.test(raw) && raw === raw.toUpperCase();
}

function singular(w: string): string {
  if (w === "cells") return "cell";
  if (NO_SINGULAR.has(w) || w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is|as)$/.test(w)) return w;
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** "CD8+ T-cells" → "cd8 t cell". */
function cellPhrase(words: string[]): string {
  return words
    .flatMap((w) => w.toLowerCase().replace(/\+/g, "").split(/[\s-]+/))
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

/**
 * Visit every n-gram (longest first, left to right) whose tokens are all
 * available. The visitor consumes tokens by setting `used`, which removes them
 * from every later (shorter) n-gram.
 */
function scan(toks: Tok[], maxN: number, available: (t: Tok) => boolean, visit: (span: Tok[]) => void): void {
  for (let n = Math.min(maxN, toks.length); n >= 1; n--) {
    for (let i = 0; i + n <= toks.length; i++) {
      const span = toks.slice(i, i + n);
      if (span.every(available)) visit(span);
    }
  }
}

const free = (t: Tok): boolean => !t.used;

/**
 * vocab_rules semantics adapted to typed text. `exact` compares the whole
 * n-gram. `contains` matches at a word start: every pattern word but the last
 * must equal the query word, and the last query word must start with the last
 * pattern word ("hippocamp" → "hippocampal"). Patterns of ≤ 3 letters, and the
 * listed whole-word ones, must equal the word (plural allowed). Two-letter
 * codes and "all" only count when typed in capitals ("AD", "PD", "ALL").
 */
function ruleMatches(r: VocabRule, span: Tok[], wholeWord: ReadonlySet<string>): boolean {
  const p = r.pattern.trim();
  if (!p) return false;
  const pw = p.split(/\s+/);
  if (pw.length !== span.length) return false;
  const words = span.map((t) => t.key);
  if ((p.length <= 2 || p === "all") && !span.every((t) => isUpper(t.raw))) return false;
  if (r.match_type === "exact") return words.join(" ") === p;
  for (let i = 0; i < pw.length - 1; i++) if (words[i] !== pw[i]) return false;
  const last = words[words.length - 1];
  const plast = pw[pw.length - 1];
  if (plast.length <= 3 || wholeWord.has(plast)) {
    return last === plast || last === `${plast}s` || last === `${plast}es` || (wholeWord.has(plast) && last === `${plast}ic`);
  }
  return last.startsWith(plast);
}

function protocolMatches(r: VocabRule, joined: string, compact: string): boolean {
  const p = r.pattern.trim();
  if (!p) return false;
  const pc = p.replace(/[\s_-]+/g, "");
  if (r.match_type === "exact" || pc.length < 4 || WHOLE_WORD_PROTOCOL.has(pc)) return joined === p || compact === pc;
  return compact.startsWith(pc);
}

function pushUnique(list: string[], value: string): void {
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
}

function uniqCi(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) pushUnique(out, v);
  return out;
}

function speciesFor(phrase: string): string | null {
  if (ORGANISM_DENY.has(phrase)) return null;
  const sci = organismToScientific(phrase);
  // organismToScientific capitalises any "genus species"-looking pair; only known species count here.
  return sci && ORGANISM_COMMON[sci.toLowerCase()] ? sci : null;
}

/** Catalog cell_type values that read as cell types, in `cellPhrase` form. */
function cellVocabulary(extra: readonly string[]): Set<string> {
  const set = new Set(CELL_TYPES);
  for (const v of extra) {
    const phrase = cellPhrase([v]);
    if (!phrase || phrase.length > 40 || phrase.split(" ").length > 4) continue;
    if (CELL_NOISE.has(phrase) || !CELL_HEAD_RE.test(phrase) || /^\d/.test(phrase)) continue;
    set.add(phrase);
  }
  for (const n of CELL_NOISE) set.delete(n);
  return set;
}

// ── Numbers: "at least 20k cells", "since 2021", "2019–2022" ────────────────

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const UNIT = String.raw`\s*(k|m|thousand|million)?`;
const CELLS = String.raw`(?:cells?|nuclei)\b`;
const MIN_CELLS_RES = [
  new RegExp(String.raw`(?:\bat\s+least|\bminimum(?:\s+of)?|\bmin\.?|\bmore\s+than|\bover|\babove|\bgreater\s+than|>=?|≥)\s*${NUM}${UNIT}\s*\+?\s*${CELLS}`, "i"),
  new RegExp(String.raw`\b${NUM}${UNIT}\s*\+\s*${CELLS}`, "i"),
  new RegExp(String.raw`\b${NUM}${UNIT}\s*${CELLS}\s+or\s+more\b`, "i"),
];
const YEAR = String.raw`((?:19|20)\d{2})`;
const YEAR_RANGE_RE = new RegExp(String.raw`\b(?:between\s+|from\s+)?${YEAR}\s*(?:-|to|until|through|thru|and)\s*${YEAR}\b`, "i");
const YEAR_FROM_RE = new RegExp(String.raw`\b(since|after|from|starting(?:\s+in)?|post)\s+${YEAR}\b`, "i");
const YEAR_TO_RE = new RegExp(String.raw`\b(before|until|till|through|thru|up\s+to|prior\s+to|pre)\s+${YEAR}\b`, "i");
const YEAR_OPEN_RE = new RegExp(String.raw`\b${YEAR}\s*(\+|or\s+later|and\s+later|onwards?|or\s+newer|or\s+earlier|and\s+earlier|or\s+before)`, "i");
const YEAR_IN_RE = new RegExp(String.raw`\b(?:published\s+)?in\s+${YEAR}\b`, "i");
const LAST_YEARS_RE = /\b(?:last|past)\s+(\d{1,2})\s+years?\b/i;

function countValue(num: string, unit: string | undefined): number | null {
  const n = parseFloat(num.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = (unit ?? "").toLowerCase();
  const mult = u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "million" ? 1e6 : 1;
  const v = Math.round(n * mult);
  return v >= 1 && v <= 1e9 ? v : null;
}

function blank(text: string, m: RegExpExecArray): string {
  return text.slice(0, m.index) + " ".repeat(m[0].length) + text.slice(m.index + m[0].length);
}

interface Numbers {
  text: string;
  min_cells: number | null;
  year_min: number | null;
  year_max: number | null;
}

/** Read cell-count and year constraints, blanking what was read so it never reaches q. */
function takeNumbers(input: string, nowYear: number): Numbers {
  const out: Numbers = { text: input, min_cells: null, year_min: null, year_max: null };
  const okYear = (y: number) => y >= 1990 && y <= nowYear + 1;

  for (const re of MIN_CELLS_RES) {
    const m = re.exec(out.text);
    const v = m ? countValue(m[1], m[2]) : null;
    if (m && v != null) {
      out.min_cells = v;
      out.text = blank(out.text, m);
      break;
    }
  }

  let m = YEAR_RANGE_RE.exec(out.text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (okYear(a) && okYear(b)) {
      out.year_min = Math.min(a, b);
      out.year_max = Math.max(a, b);
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null) {
    m = YEAR_FROM_RE.exec(out.text);
    if (m) {
      const y = Number(m[2]);
      const word = m[1].toLowerCase();
      if (okYear(y)) {
        out.year_min = word === "after" || word === "post" ? y + 1 : y;
        out.text = blank(out.text, m);
      }
    }
  }
  if (out.year_max == null) {
    m = YEAR_TO_RE.exec(out.text);
    if (m) {
      const y = Number(m[2]);
      const word = m[1].toLowerCase();
      if (okYear(y)) {
        out.year_max = word === "before" || word === "pre" || word.startsWith("prior") ? y - 1 : y;
        out.text = blank(out.text, m);
      }
    }
  }
  if (out.year_min == null && out.year_max == null) {
    m = YEAR_OPEN_RE.exec(out.text);
    if (m && okYear(Number(m[1]))) {
      const y = Number(m[1]);
      if (/earlier|before/i.test(m[2])) out.year_max = y;
      else out.year_min = y;
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null && out.year_max == null) {
    m = YEAR_IN_RE.exec(out.text);
    if (m && okYear(Number(m[1]))) {
      out.year_min = Number(m[1]);
      out.year_max = Number(m[1]);
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min == null) {
    m = LAST_YEARS_RE.exec(out.text);
    const n = m ? Number(m[1]) : 0;
    if (m && n >= 1 && n <= 30) {
      out.year_min = nowYear - n + 1;
      out.text = blank(out.text, m);
    }
  }
  if (out.year_min != null && out.year_max != null && out.year_min > out.year_max) {
    out.year_min = null;
    out.year_max = null;
  }
  return out;
}

// ── The deterministic parse ─────────────────────────────────────────────────

export interface ParseVocab {
  rules: VocabRule[];
  /** Top catalog cell_type values (facets-core cellTypeVocab). */
  cellTypes?: readonly string[];
}

export interface ParseResult {
  interpreted: Interpreted;
  /** q entries worth keeping whatever a model says: gene symbols, compounds, disease names, fixed phrases. */
  keep: string[];
  /** Leftover plain words the vocabulary could not place. */
  unplaced: string[];
  /** True when a model reading could plausibly add something the vocabulary missed. */
  ambiguous: boolean;
}

/** A residual word that is fine as a plain keyword: symbols, compounds, numbers, known terms. */
function isSimpleKeyword(raw: string, key: string): boolean {
  return /\d/.test(raw) || raw.includes("-") || /^\p{Lu}[\p{Lu}\d]{1,9}$/u.test(raw) || KNOWN_KEYWORDS.has(key) || key.length <= 2;
}

/**
 * Read a query with the vocabulary alone. Pure: no I/O, no model, no clock
 * unless `nowYear` is omitted ("last 3 years").
 */
export function parseQuery(query: string, vocab: ParseVocab, nowYear = new Date().getUTCFullYear()): ParseResult {
  const res = emptyInterpreted();
  const nums = takeNumbers(prepare(query), nowYear);
  res.min_cells = nums.min_cells;
  res.year_min = nums.year_min;
  res.year_max = nums.year_max;
  const toks = tokenize(nums.text);

  /** q contributions that are not leftover tokens, keyed by position. */
  const echoes: { pos: number; text: string }[] = [];
  const echo = (span: Tok[]) => echoes.push({ pos: span[0].pos, text: span.map((t) => t.raw).join(" ") });
  const consume = (span: Tok[]) => {
    for (const t of span) {
      t.used = true;
      t.tissueOk = false;
    }
  };

  // 1. Fixed keyword phrases, so no facet pass can split them.
  scan(toks, 3, free, (span) => {
    if (span.length < 2) return;
    if (KEYWORD_PHRASES.has(span.map((t) => t.key).join(" ")) || KEYWORD_PHRASES.has(cellPhrase(span.map((t) => t.key)))) {
      echo(span);
      consume(span);
    }
  });

  // 2. Organism — explicit species words only.
  scan(toks, 3, free, (span) => {
    const phrase = span.map((t) => t.key).join(" ");
    let sci = speciesFor(phrase);
    if (!sci && span.length === 1 && phrase.length > 4 && phrase.endsWith("s")) sci = speciesFor(phrase.slice(0, -1));
    if (!sci) return;
    pushUnique(res.organism, sci);
    consume(span);
  });

  // 3. Assay — a stated chemistry ("10x 5'", "3 prime") or a named platform.
  const chem = (span: Tok[]): "3" | "5" | null => {
    const k = span.map((t) => t.key);
    const one = k.length === 1 ? /^([35])(?:'|p|prime|-prime)$/.exec(k[0]) : null;
    if (one) return one[1] === "3" ? "3" : "5";
    if (k.length === 2 && (k[0] === "3" || k[0] === "5") && k[1] === "prime") return k[0] === "3" ? "3" : "5";
    return null;
  };
  scan(toks, 2, free, (span) => {
    const c = chem(span);
    if (!c) return;
    pushUnique(res.assay_family, c === "3" ? "10x 3'" : "10x 5'");
    consume(span);
    for (const t of toks) if (!t.used && (t.key === "10x" || t.key === "chromium")) consume([t]);
  });
  const protocolRules = vocab.rules.filter((r) => r.field === "protocol" && !ASSAY_SKIP.has(r.grp));
  scan(toks, 3, free, (span) => {
    const joined = span.map((t) => t.key).join(" ");
    const compact = joined.replace(/[\s_-]+/g, "");
    let grp = canonicalGroup("assay_family", joined);
    if (!grp) grp = protocolRules.find((r) => protocolMatches(r, joined, compact))?.grp ?? null;
    if (!grp || ASSAY_SKIP.has(grp)) return;
    pushUnique(res.assay_family, grp);
    consume(span);
  });

  // 4. Cell types, before tissue and disease so "hepatocytes" or "microglia"
  //    are cell types rather than anatomy. Modifiers of a multi-word cell type
  //    stay readable as anatomy ("muscle stem cells" → Muscle).
  const cells = cellVocabulary(vocab.cellTypes ?? []);
  scan(toks, 4, free, (span) => {
    const phrase = cellPhrase(span.map((t) => t.key));
    if (!phrase || CELL_NOISE.has(phrase) || !cells.has(phrase)) return;
    pushUnique(res.cell_type, phrase);
    span.forEach((t, i) => {
      t.used = true;
      t.tissueOk = i < span.length - 1;
    });
  });

  // 5. Disease. Broad groups keep the specific word in q ("melanoma", "AML").
  //    Words before the head of a multi-word disease stay readable as anatomy
  //    ("pulmonary fibrosis" → Lung); a one-word disease never implies a site.
  const diseaseRules = vocab.rules.filter((r) => {
    const p = r.pattern.trim();
    if (r.field !== "disease" || !p || DISEASE_SKIP.has(r.grp)) return false;
    if (r.grp === "Healthy / control") return HEALTHY_OK.has(p);
    return !DISEASE_DENY.has(p);
  });
  scan(toks, 4, free, (span) => {
    const phrase = span.map((t) => t.key).join(" ");
    let grp = canonicalGroup("disease_group", phrase);
    if (!grp) grp = diseaseRules.find((r) => ruleMatches(r, span, NO_WHOLE_WORD))?.grp ?? null;
    if (!grp || DISEASE_SKIP.has(grp)) return;
    pushUnique(res.disease_group, grp);
    if (!EXACT_DISEASE.has(grp) && !(span.length === 1 && GENERIC_DISEASE_WORDS.has(span[0].key))) echo(span);
    span.forEach((t, i) => {
      t.used = true;
      t.tissueOk = i < span.length - 1;
    });
  });

  // 6. Tissue — explicit anatomical words only.
  const tissueRules = vocab.rules.filter((r) => r.field === "tissue" && !TISSUE_SKIP.has(r.grp) && !TISSUE_PARSE_DENY.has(r.pattern.trim()));
  scan(toks, 4, (t) => !t.used || t.tissueOk, (span) => {
    const phrase = span.map((t) => t.key).join(" ");
    let grp = canonicalGroup("tissue_group", phrase);
    if (!grp) grp = tissueRules.find((r) => ruleMatches(r, span, WHOLE_WORD_TISSUE))?.grp ?? null;
    if (!grp || TISSUE_SKIP.has(grp)) return;
    pushUnique(res.tissue_group, grp);
    consume(span);
  });

  // 7. Whatever is left and meaningful becomes q, in query order.
  const leftovers = toks.filter(
    (t) => !t.used && !STOPWORDS.has(t.key) && !GENERIC_WORDS.has(t.key) && !/^\d+(?:[.,]\d+)?[km]?$/.test(t.key),
  );
  const ordered = [...echoes, ...leftovers.map((t) => ({ pos: t.pos, text: t.raw }))].sort((a, b) => a.pos - b.pos);
  res.q = uniqCi(ordered.map((e) => e.text));

  const unplaced = leftovers.filter((t) => !isSimpleKeyword(t.raw, t.key)).map((t) => t.raw);
  const keep = uniqCi([...echoes.map((e) => e.text), ...leftovers.filter((t) => isSimpleKeyword(t.raw, t.key)).map((t) => t.raw)]);
  const structured =
    res.organism.length > 0 ||
    res.tissue_group.length > 0 ||
    res.disease_group.length > 0 ||
    res.assay_family.length > 0 ||
    res.cell_type.length > 0 ||
    res.min_cells != null ||
    res.year_min != null ||
    res.year_max != null;
  const content = toks.filter((t) => !STOPWORDS.has(t.key) && !GENERIC_WORDS.has(t.key)).length;
  const ambiguous = unplaced.length >= 3 || (unplaced.length >= 2 && !structured && content >= 3);
  return { interpreted: res, keep, unplaced, ambiguous };
}

// ── The model ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You translate a plain-English search for single-cell RNA-seq studies into strict JSON filters for a catalog.

The catalog has these filter fields:
- "organism": array of SCIENTIFIC names (e.g. "Mus musculus"). Choose from the organism vocabulary, which lists "Common name (Scientific name)". Always answer with the scientific name only. "human", "patient", "donor" → "Homo sapiens"; "mouse", "mice", "murine" → "Mus musculus".
- "tissue_group": array of EXACT strings from the tissue_group vocabulary (anatomical site / sample origin). Set it ONLY from words in the query that name a body site or sample origin (brain, cortex, lung, PBMC, blood, bone marrow, skin, organoid, cell line …). Never infer a tissue from a disease: "melanoma" does not mean "Skin", "glioma" does not mean "Brain / CNS", "leukemia" does not mean "Bone marrow".
- "disease_group": array of EXACT strings from the disease_group vocabulary. Use "Healthy / control" only when the user explicitly asks for healthy or control samples.
- "assay_family": array of EXACT strings from the assay_family vocabulary (10x 3', 10x 5', Smart-seq / plate-based, …).
- "cell_type": array of short lowercase cell-type terms as they would appear in GEO sample annotations ("microglia", "t cell", "cd8 t cell", "hepatocyte", "cardiomyocyte"). Prefer spellings that occur in the cell_type vocabulary when the concept matches; otherwise use the common lowercase form. Singular, no plural.
- "min_cells": integer minimum cell count per study if the user asks for one ("at least 50k cells" → 50000), else 0.
- "year_min" / "year_max": integers if the user constrains the year ("since 2021" → year_min 2021), else 0.
- "q": array of RESIDUAL keywords that are not captured by the fields above — genes, proteins, drugs, treatments, perturbations, techniques, phenotypes, developmental stages, specific disease names, authors, consortium names. Each entry is one short term or phrase. Do NOT repeat concepts already captured by other fields (never put "mouse", "brain", "microglia", "covid" in q if you set organism/tissue_group/cell_type/disease_group for them). Do not include generic words (study, dataset, data, single-cell, scRNA-seq, sequencing, samples, cells, atlas, profiling).

Rules:
- Every field must be present. Empty arrays and 0 are fine.
- Use ONLY vocabulary strings for organism, tissue_group, disease_group and assay_family. If nothing fits, leave the array empty and put the concept in q.
- Interpret common synonyms: PBMC/blood/leukocytes → "Blood / PBMC"; cortex/hippocampus/CNS → "Brain / CNS"; lung/airway/bronchial → "Lung / airway"; colon/ileum/intestinal → "Gut / intestine"; tumour/tumor/carcinoma/melanoma/glioma/leukemia/lymphoma → disease_group "Cancer", and keep the specific cancer name (melanoma, AML, glioblastoma …) in q; SARS-CoV-2 → "COVID-19"; AD → "Alzheimer's disease"; injury/transplant → "Injury / transplant / aging"; aging, aged, old vs young, development stages, treatments and perturbations are NOT diseases — put them in q (e.g. "aging"); 10x/Chromium (unspecified chemistry) → leave assay_family empty; "10x 3 prime" → "10x 3'"; Smart-seq2/plate → "Smart-seq / plate-based"; organoids → tissue_group "Organoid"; embryo/fetal/developing → "Embryo / development".
- Never guess a species. Set organism ONLY when the query names one (human, patient, donor, mouse, mice, murine, rat, zebrafish, …). A disease, tissue or cell type alone says nothing about species — leave organism empty.
- Never guess an assay chemistry. Bare "10x", "Chromium" or "droplet" → assay_family empty. Only a stated chemistry (3', 5', v2/v3 with prime, Multiome, Smart-seq2, Drop-seq, …) sets assay_family.
- Output STRICT JSON only — no prose, no markdown fences.

Examples:
Query: microglia in the aging mouse brain
{"organism":["Mus musculus"],"tissue_group":["Brain / CNS"],"disease_group":[],"assay_family":[],"cell_type":["microglia"],"min_cells":0,"year_min":0,"year_max":0,"q":["aging"]}
Query: human PBMC COVID-19 10x 5'
{"organism":["Homo sapiens"],"tissue_group":["Blood / PBMC"],"disease_group":["COVID-19"],"assay_family":["10x 5'"],"cell_type":[],"min_cells":0,"year_min":0,"year_max":0,"q":[]}
Query: AML bone marrow 10x
{"organism":[],"tissue_group":["Bone marrow"],"disease_group":["Cancer"],"assay_family":[],"cell_type":[],"min_cells":0,"year_min":0,"year_max":0,"q":["AML"]}
Query: tumor-infiltrating T cells in melanoma
{"organism":[],"tissue_group":[],"disease_group":["Cancer"],"assay_family":[],"cell_type":["t cell"],"min_cells":0,"year_min":0,"year_max":0,"q":["tumor-infiltrating","melanoma"]}
Query: FOXP3 knockout regulatory T cells with at least 20k cells since 2022
{"organism":[],"tissue_group":[],"disease_group":[],"assay_family":[],"cell_type":["regulatory t cell"],"min_cells":20000,"year_min":2022,"year_max":0,"q":["FOXP3","knockout"]}`;

const stringArray = { type: "array", items: { type: "string" } };
const enumArray = (values: readonly string[]) => ({ type: "array", items: { type: "string", enum: [...values] } });

/** Reply schema. Integers use 0 for "not set": nullable types are not portable across providers. */
export const INTERPRET_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    organism: stringArray,
    tissue_group: enumArray(TISSUE_GROUPS),
    disease_group: enumArray(DISEASE_GROUPS),
    assay_family: enumArray(ASSAY_FAMILIES),
    cell_type: stringArray,
    min_cells: { type: "integer" },
    year_min: { type: "integer" },
    year_max: { type: "integer" },
    q: stringArray,
  },
  required: ["organism", "tissue_group", "disease_group", "assay_family", "cell_type", "min_cells", "year_min", "year_max", "q"],
  additionalProperties: false,
};

function userPrompt(query: string, cellTypes: readonly string[]): string {
  const vocab: [string, readonly string[]][] = [
    ["organism", organismVocabForModel()],
    ["tissue_group", TISSUE_GROUPS],
    ["disease_group", DISEASE_GROUPS],
    ["assay_family", ASSAY_FAMILIES],
    ["cell_type", cellTypes.slice(0, CELL_TYPE_VOCAB_LIMIT)],
  ];
  const text = vocab.map(([f, values]) => `${f}: ${values.length ? values.join(" | ") : "(none)"}`).join("\n\n");
  return `Vocabulary (allowed values per field, separated by " | "):\n\n${text}\n\nQuery: ${query.slice(0, MAX_QUERY_CHARS)}\n\nReturn the JSON now.`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Mouse (Mus musculus)", "mouse" or "Mus musculus" → "Mus musculus" (known species only). */
function unwrapOrganism(v: string): string | null {
  const m = /\(([^)]+)\)\s*$/.exec(v);
  return speciesFor((m ? m[1] : v).trim().toLowerCase()) ?? speciesFor(v.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase());
}

/** A species the query itself names (scientific name, genus or common name). */
function namesSpecies(sci: string, query: string): boolean {
  const common = ORGANISM_COMMON[sci.toLowerCase()] ?? "";
  const words = [sci, common, sci.split(" ")[0]].map((w) => w.toLowerCase()).filter((w) => w.length > 3);
  return words.some((w) => new RegExp(`\\b${escapeRe(w)}`, "i").test(query));
}

/** Tissue groups some query word points at — anatomy or a cell type, never a disease. */
function tissueEvidence(query: string, rules: VocabRule[]): Set<string> {
  const toks = tokenize(prepare(query));
  const found = new Set<string>();
  const evidenceRules = rules.filter((r) => r.field === "tissue" && !TISSUE_SKIP.has(r.grp) && !TISSUE_DISEASE_PATTERNS.has(r.pattern.trim()));
  scan(toks, 4, () => true, (span) => {
    const phrase = span.map((t) => t.key).join(" ");
    const grp = canonicalGroup("tissue_group", phrase) ?? evidenceRules.find((r) => ruleMatches(r, span, WHOLE_WORD_TISSUE))?.grp ?? null;
    if (grp && !TISSUE_SKIP.has(grp)) found.add(grp);
  });
  return found;
}

function canonicalOrSynonym(rules: VocabRule[], field: GroupField, value: string): string | null {
  return canonicalGroup(field, value) ?? resolveGroup(rules, field, value);
}

/**
 * Keep only what the vocabulary recognises and the query supports. The model
 * is told the same rules; this makes them hold even when it ignores them.
 */
export function validateModelReading(raw: unknown, query: string, rules: VocabRule[], nowYear = new Date().getUTCFullYear()): Interpreted {
  const c = coerceInterpreted(raw);
  const evidence = tissueEvidence(query, rules);

  const organism = uniqCi(
    c.organism.map(unwrapOrganism).filter((s): s is string => s !== null && namesSpecies(s, query)),
  );
  const tissue_group = uniqCi(
    c.tissue_group
      .map((v) => canonicalOrSynonym(rules, "tissue_group", v))
      .filter((g): g is string => g !== null && !TISSUE_SKIP.has(g) && evidence.has(g)),
  );
  const disease_group = uniqCi(
    c.disease_group
      .map((v) => canonicalOrSynonym(rules, "disease_group", v))
      .filter((g): g is string => {
        if (g === null || DISEASE_SKIP.has(g)) return false;
        if (g === "Healthy / control") return /\b(healthy|controls?|normal|non-diseased|unaffected)\b/i.test(query);
        if (g === "Injury / transplant / aging") return /\b(injur|transplant|trauma|wound|burn|surg|graft|lesion)/i.test(query);
        return true;
      }),
  );
  const assay_family = ASSAY_HINT_RE.test(query)
    ? uniqCi(
        c.assay_family
          .map((v) => canonicalGroup("assay_family", v))
          .filter((g): g is string => g !== null && !ASSAY_SKIP.has(g)),
      )
    : [];
  const cell_type = uniqCi(
    c.cell_type.map((v) => cellPhrase([v])).filter((v) => v.length > 1 && v.length <= 60 && !CELL_NOISE.has(v)),
  ).slice(0, 6);

  const okYear = (y: number | null): number | null => (y != null && y >= 1990 && y <= nowYear + 1 ? y : null);
  let year_min = okYear(c.year_min);
  let year_max = okYear(c.year_max);
  if (year_min != null && year_max != null && year_min > year_max) {
    year_min = null;
    year_max = null;
  }
  const min_cells = c.min_cells != null && c.min_cells > 0 && c.min_cells <= 1e9 ? c.min_cells : null;

  const q = uniqCi(
    c.q
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 0 && s.length <= 60 && !GENERIC_WORDS.has(s.toLowerCase()) && !STOPWORDS.has(s.toLowerCase())),
  ).slice(0, 8);

  return { organism, tissue_group, disease_group, assay_family, cell_type, min_cells, year_min, year_max, q };
}

/**
 * Parse + model. The parse's organism always wins; list facets are unioned
 * (parse first); numbers come from the parse when it read any. The model's q
 * replaces the parse's leftovers (it reads them better), but symbols, compound
 * words, disease names and fixed phrases the parse found are always kept.
 */
export function mergeReadings(parsed: ParseResult, model: Interpreted): Interpreted {
  const det = parsed.interpreted;
  const merged: Interpreted = {
    organism: det.organism.length ? det.organism : model.organism,
    tissue_group: uniqCi([...det.tissue_group, ...model.tissue_group]),
    disease_group: uniqCi([...det.disease_group, ...model.disease_group]),
    assay_family: uniqCi([...det.assay_family, ...model.assay_family]),
    cell_type: uniqCi([...det.cell_type, ...model.cell_type]),
    min_cells: det.min_cells ?? model.min_cells,
    year_min: det.year_min ?? model.year_min,
    year_max: det.year_max ?? model.year_max,
    q: [],
  };
  if (merged.year_min != null && merged.year_max != null && merged.year_min > merged.year_max) {
    merged.year_min = det.year_min;
    merged.year_max = det.year_max;
  }
  const captured = new Set(
    [
      ...merged.cell_type,
      ...merged.tissue_group,
      ...merged.disease_group,
      ...merged.organism,
      ...merged.organism.map((o) => ORGANISM_COMMON[o.toLowerCase()] ?? ""),
    ]
      .filter(Boolean)
      .map((s) => s.toLowerCase()),
  );
  merged.q = uniqCi([...model.q.filter((s) => !captured.has(s.toLowerCase())), ...parsed.keep]);
  return merged;
}

// ── Caches: Cache API (per colo, 1 h) in front of D1 interpret_cache ────────

interface CachedReading {
  reading: Interpreted;
  model: string | null;
}

function edgeCache(): Cache | null {
  try {
    return (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    return null;
  }
}

const edgeKey = (qn: string) => `${INTERPRET_CACHE_URL}?v=${encodeURIComponent(INTERPRET_RULES_VERSION)}&q=${encodeURIComponent(qn)}`;

function edgeResponse(c: CachedReading): Response {
  return new Response(JSON.stringify(c), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${EDGE_CACHE_TTL}` },
  });
}

async function readCache(db: D1Database, waitUntil: WaitUntil, qn: string): Promise<CachedReading | null> {
  const cache = edgeCache();
  if (cache) {
    try {
      const hit = await cache.match(edgeKey(qn));
      if (hit) {
        const c = (await hit.json()) as { reading?: unknown; model?: unknown };
        return { reading: coerceInterpreted(c.reading), model: typeof c.model === "string" ? c.model : null };
      }
    } catch {
      /* fall through to D1 */
    }
  }
  try {
    const row = await db
      .prepare(`SELECT model, json FROM interpret_cache WHERE qnorm = ?1 AND rules_version = ?2 AND created_at > ?3`)
      .bind(qn, INTERPRET_RULES_VERSION, nowIso(Date.now() - D1_CACHE_MAX_AGE_MS))
      .first<{ model: string | null; json: string }>();
    if (!row) return null;
    const c: CachedReading = { reading: coerceInterpreted(JSON.parse(row.json)), model: row.model ?? null };
    if (cache) waitUntil(cache.put(edgeKey(qn), edgeResponse(c)).catch(() => undefined));
    return c;
  } catch {
    // Missing table or a D1 hiccup: behave as a miss.
    return null;
  }
}

function writeCache(db: D1Database, waitUntil: WaitUntil, qn: string, c: CachedReading): void {
  waitUntil(
    db
      .prepare(`INSERT OR REPLACE INTO interpret_cache (qnorm, rules_version, model, json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(qn, INTERPRET_RULES_VERSION, c.model, JSON.stringify(c.reading), nowIso())
      .run()
      .catch((e) => console.warn("[interpret] cache write failed:", String(e))),
  );
  const cache = edgeCache();
  if (cache) waitUntil(cache.put(edgeKey(qn), edgeResponse(c)).catch(() => undefined));
}

// ── Entry point ─────────────────────────────────────────────────────────────

export interface InterpretOutcome {
  interpreted: Interpreted;
  /** Who produced the reading: the vocabulary alone, a cached model reading, or a fresh model call. */
  source: "vocabulary" | "cache" | "model";
  /** Model label when a model reading (fresh or cached) was merged in. */
  model?: string;
  /** The caller's budget after a fresh (charged) model call. */
  quota?: Quota;
  /** Budget spent: the model was skipped and the vocabulary reading is the answer. */
  quotaExceeded?: { quota: Quota; message: string };
  /** The model was wanted but failed; the answer is vocabulary-only and must not be edge-cached. */
  degraded?: boolean;
}

/**
 * Interpret a natural-language query for `identity`. Never throws for model
 * or cache trouble — the vocabulary reading is always available.
 */
export async function interpretQuery(env: InterpretEnv, ctx: Ctx, identity: Identity, query: string): Promise<InterpretOutcome> {
  const cellTypes = await cellTypeVocab(ctx, CELL_TYPE_VOCAB_LIMIT).catch(() => [] as string[]);
  const parsed = parseQuery(query, { rules: ctx.rules, cellTypes });
  if (!parsed.ambiguous) return { interpreted: parsed.interpreted, source: "vocabulary" };

  const qn = normalizeQuery(query);
  const cached = await readCache(env.DB, ctx.waitUntil, qn);
  if (cached) {
    return { interpreted: mergeReadings(parsed, cached.reading), source: "cache", ...(cached.model ? { model: cached.model } : {}) };
  }

  if (!aiConfigured(env)) return { interpreted: parsed.interpreted, source: "vocabulary" };

  const quota = await consume(env.DB, env, identity, "search");
  if (quota.exceeded) {
    return {
      interpreted: parsed.interpreted,
      source: "vocabulary",
      quotaExceeded: { quota, message: quotaMessage(env, quota, "AI searches") },
    };
  }

  try {
    const raw = await runJson(env, {
      system: SYSTEM_PROMPT,
      user: userPrompt(query, cellTypes),
      schema: INTERPRET_SCHEMA,
      maxTokens: INTERPRET_MAX_TOKENS,
      timeoutMs: INTERPRET_TIMEOUT_MS,
    });
    const reading = validateModelReading(raw, query, ctx.rules);
    const model = modelLabel(env);
    writeCache(env.DB, ctx.waitUntil, qn, { reading, model });
    return { interpreted: mergeReadings(parsed, reading), source: "model", quota, ...(model ? { model } : {}) };
  } catch (e) {
    console.warn("[interpret] model reading failed, using the vocabulary reading:", String(e).slice(0, 300));
    return { interpreted: parsed.interpreted, source: "vocabulary", quota, degraded: true };
  }
}
