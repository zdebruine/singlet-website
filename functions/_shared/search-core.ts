/**
 * Shared search core for /api/search, /api/facets and /api/nl-search.
 *
 * Semantics (fixed, never silently relaxed):
 *   AND across filter groups, OR within a group.
 *   Study level (gse): a study matches a group if ANY of its samples does
 *   (`gse_meta` JSON arrays); it matches `q` if `fts_gse` (title/abstract)
 *   matches OR any of its samples' `fts_gsm` rows match.
 *   Sample level (gsm): the same filters applied directly to `gsm` columns.
 *
 * All SQL is parameterised. Long id lists are passed as ONE JSON-array bound
 * parameter and expanded with `json_each(?)` so we never approach D1's
 * 100-bound-parameter limit.
 */
import { safeList } from "./json";
import { parseCharacteristics, summarizeConditions, type ConditionSummary } from "./conditions";
import { isSuspectCellCount, isSuspectStudyCells } from "./suspect-cells";
import {
  canonicalGroup,
  organismToCommon,
  organismToScientific,
  resolveGroup,
  type GroupField,
  type VocabRule,
} from "./vocab";

// ── Types ───────────────────────────────────────────────────────────────────

export type Level = "gse" | "gsm";
export type Sort = "relevance" | "cells" | "samples" | "year" | "accession" | "file_cells" | "file_size" | "alphabetical";
export const SORTS: readonly Sort[] = ["relevance", "cells", "samples", "year", "accession", "file_cells", "file_size", "alphabetical"];

export const ARRAY_FILTER_FIELDS = ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"] as const;
export type ArrayFilterField = (typeof ARRAY_FILTER_FIELDS)[number];

export interface SearchFilters {
  q: string;
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  has_bundle: boolean | null;
  year_min: number | null;
  year_max: number | null;
  min_file_samples: number | null;
  min_file_cells: number | null;
  reference_build: string[];
  protocol: string[];
  has_pubmed: boolean | null;
  max_file_bytes: number | null;
  has_conditions: boolean | null;
  match_mode: Partial<Record<ArrayFilterField | "reference_build" | "protocol", "any" | "all">>;
}

export interface SoftSignals {
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  q: string[];
}

export interface SearchParams extends SearchFilters {
  level: Level;
  sort: Sort;
  page: number; // 1-based
  limit: number;
  format: "json" | "accessions";
}

export interface FilterMatch {
  field: string;
  value: string;
  n_samples?: number;
}

export interface TextMatch {
  field: "title" | "abstract" | "characteristics" | "source" | "cell_type" | "tissue" | "sample_title" | "accession";
  term: string;
  n_samples: number;
}

export interface MatchInfo {
  filters: FilterMatch[];
  text: TextMatch[];
  facets: { key: string; label: string; status: "hit" | "partial" | "miss"; detail: string }[];
  keywords: { term: string; hits: string[] }[];
  score: number;
}

export interface StudyRow {
  gse_id: string;
  title: string | null;
  abstract: string | null;
  organism_primary: string | null;
  organism_label: string;
  organisms: string[];
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  tissues_raw: string[];
  cell_types_raw: string[];
  n_done: number;
  n_total: number;
  n_failed: number;
  n_cells: number;
  suspect_cells: boolean;
  has_bundle: boolean;
  bundle_bytes: number | null;
  bundle_key: string | null;
  bundle_n_samples: number | null;
  file_cells: number | null;
  reference_build: string | null;
  year: number | null;
  n_conditions: number;
  conditions: ConditionSummary["conditions"];
  conditions_label: string;
  match: MatchInfo;
  why: string;
  score: number | null;
}

export interface SampleRow {
  gsm_id: string;
  gse_id: string;
  study_title: string | null;
  organism: string | null;
  organism_primary: string | null;
  organism_label: string;
  protocol: string | null;
  assay_family: string | null;
  tissue: string | null;
  tissue_group: string | null;
  cell_type: string | null;
  disease: string | null;
  disease_group: string | null;
  sex: string | null;
  n_cells: number | null;
  suspect_cells: boolean;
  status: string;
  status_code: string;
  failure_category: string | null;
  title: string | null;
  source: string | null;
  characteristics: Record<string, string>;
  has_bundle: boolean;
  year: number | null;
  score: number | null;
}

export interface SearchTotals {
  studies: number | null;
  samples: number | null;
  cells: number | null;
}

export interface SearchResult<T> {
  total: number;
  totals: SearchTotals;
  page: number;
  limit: number;
  data: T[];
  accessions: string[];
  /** Present when `q` contained GEO accessions and the query short-circuited. */
  accession_lookup?: string[];
  /** True when no study matched every word, so results match ANY of the words instead. */
  any_word?: boolean;
  groups?: { full: number; partial: number };
}

export interface Ctx {
  db: D1Database;
  rules: VocabRule[];
  waitUntil: (p: Promise<unknown>) => void;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_EXPORT = 5000;
/** Per-sample cap applied when ranking by cells so plate-protocol artifacts don't dominate. */
const CAP_CELLS_PER_SAMPLE = 250_000;
const CAPPED_STUDY_CELLS = `MIN(m.n_cells, ${CAP_CELLS_PER_SAMPLE} * MAX(m.n_done, 1))`;
const MAX_TERMS = 6;
const RANKED_CANDIDATE_LIMIT = 200;
const ABSTRACT_CHARS = 300;
const CONDITIONS_TTL_MS = 7 * 24 * 3600 * 1000;
const CONDITIONS_SAMPLE_CAP = 300;

/**
 * bm25 column weights, applied through the FTS5 `rank` configuration so the
 * score can be aggregated (bm25() itself may not appear inside GROUP BY).
 * fts_gse columns: id, title, abstract, organism.
 * fts_gsm columns: gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics.
 */
const RANK_GSE = "rank MATCH 'bm25(0.0, 10.0, 1.0, 0.0)'";
const RANK_GSM = "rank MATCH 'bm25(0.0, 0.0, 1.0, 3.0, 3.0, 5.0, 0.0, 3.0, 2.0)'";

const STOPWORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "for", "to", "from", "with", "and", "or", "by", "is", "are", "was",
  "were", "be", "as", "that", "this", "these", "those", "into", "its", "their", "using", "via", "vs", "versus",
  "about", "over", "under", "after", "before", "during", "between", "within", "without", "show", "find", "me",
  "all", "any", "some", "studies", "study", "datasets", "dataset", "data",
]);

/**
 * Keyword synonyms: a query word on the left also matches any word on the
 * right (OR within the term, still AND across terms). Covers the spelling and
 * phrasing variants GEO submitters actually use — "aging" studies are titled
 * "young and old mice", "tumor" vs "tumour", "KO" vs "knockout" — so a plain
 * English query doesn't silently miss half the catalog. Keep this list short
 * and literal; it is not a thesaurus.
 */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  aging: ["aging", "ageing", "aged", "old", "age", "elderly"],
  ageing: ["aging", "ageing", "aged", "old", "age", "elderly"],
  aged: ["aged", "aging", "ageing", "old", "age"],
  old: ["old", "aged", "aging", "ageing"],
  young: ["young", "juvenile", "adolescent"],
  tumor: ["tumor", "tumour", "tumors", "tumours"],
  tumour: ["tumor", "tumour", "tumors", "tumours"],
  tumors: ["tumor", "tumour", "tumors", "tumours"],
  cancer: ["cancer", "carcinoma", "tumor", "tumour", "malignant"],
  knockout: ["knockout", "ko", "null", "deficient"],
  ko: ["ko", "knockout"],
  wildtype: ["wildtype", "wt", "wild type"],
  wt: ["wt", "wildtype", "wild type"],
  fetal: ["fetal", "foetal", "fetus", "foetus", "embryonic"],
  foetal: ["fetal", "foetal", "fetus", "foetus", "embryonic"],
  leukemia: ["leukemia", "leukaemia"],
  leukaemia: ["leukemia", "leukaemia"],
  hematopoietic: ["hematopoietic", "haematopoietic"],
  haematopoietic: ["hematopoietic", "haematopoietic"],
  esophagus: ["esophagus", "oesophagus", "esophageal", "oesophageal"],
  oesophagus: ["esophagus", "oesophagus", "esophageal", "oesophageal"],
  pediatric: ["pediatric", "paediatric", "children", "child"],
  paediatric: ["pediatric", "paediatric", "children", "child"],
  infant: ["infant", "neonatal", "neonate", "newborn"],
  neonatal: ["neonatal", "neonate", "newborn", "infant"],
  covid: ["covid", "sars cov 2", "coronavirus"],
  obese: ["obese", "obesity", "high fat diet", "hfd"],
  obesity: ["obese", "obesity", "high fat diet", "hfd"],
  hfd: ["hfd", "high fat diet"],
  diabetic: ["diabetic", "diabetes", "db db", "stz"],
  diabetes: ["diabetic", "diabetes", "db db", "stz"],
  stroke: ["stroke", "ischemia", "ischaemia", "mcao"],
  ischemia: ["ischemia", "ischaemia", "ischemic", "ischaemic"],
  sepsis: ["sepsis", "septic", "lps", "endotoxin"],
  lps: ["lps", "lipopolysaccharide", "endotoxin"],
  fibrosis: ["fibrosis", "fibrotic", "bleomycin", "ccl4"],
  scrnaseq: ["scrnaseq", "scrna seq", "single cell rna seq"],
  snrnaseq: ["snrnaseq", "snrna seq", "single nucleus", "single nuclei", "nuclei"],
  nuclei: ["nuclei", "nucleus", "snrna seq", "snrnaseq"],
  organoid: ["organoid", "organoids", "spheroid", "spheroids"],
  organoids: ["organoid", "organoids", "spheroid", "spheroids"],
  ad: ["ad", "alzheimer", "alzheimers", "alzheimer disease"],
  alzheimer: ["alzheimer", "alzheimers", "alzheimer disease", "ad"],
  pbmc: ["pbmc", "pbmcs", "peripheral blood mononuclear cell", "peripheral blood mononuclear cells"],
  "t cell": ["t cell", "t cells", "t-cell", "t-cells", "lymphocyte"],
  xenograft: ["xenograft", "pdx", "xenografts"],
  pdx: ["pdx", "xenograft"],
  metastasis: ["metastasis", "metastases", "metastatic"],
  metastatic: ["metastasis", "metastases", "metastatic"],
};

const GSM_FIELD_LABEL: Record<string, string> = {
  characteristics: "their GEO characteristics",
  source: "their source field",
  cell_type: "their cell type",
  tissue: "their tissue field",
  sample_title: "their sample titles",
};

/** Plain-words failure reasons for the sample `status` string. */
const FAILURE_WORDS: Record<string, string> = {
  fail_download: "download failed",
  fail_no_r2: "no read 2 file",
  fail_protocol_detect: "protocol not recognised",
  fail_simpleaf_permit: "barcode whitelist mismatch",
  fail_simpleaf_map: "mapping step failed",
  fail_simpleaf_timeout: "mapping timed out",
  fail_simpleaf_other: "mapping error",
  fail_low_mapping: "low mapping rate",
  fail_qc_few_cells: "too few cells",
  fail_qc_low_genes: "too few genes per cell",
  fail_qc_other: "failed QC",
  skip_plate_based: "plate-based library skipped",
};

export function failureWords(category: string | null | undefined): string {
  if (!category) return "processing failed";
  return FAILURE_WORDS[category] ?? category.replace(/^fail_/, "").replace(/_/g, " ");
}

export function statusText(status: string | null | undefined, failureCategory: string | null | undefined): string {
  switch (status) {
    case "DONE":
      return "processed";
    case "DONE_QC_WARN":
      return "processed (QC warning)";
    case "FAIL":
    case "HARD_FAIL":
      return `failed: ${failureWords(failureCategory)}`;
    default:
      return (status ?? "unknown").toLowerCase();
  }
}

// ── Param parsing / normalisation ───────────────────────────────────────────

function multi(url: URL, key: string): string[] {
  const out: string[] = [];
  for (const v of url.searchParams.getAll(key)) {
    const t = v.trim();
    if (t) out.push(t);
  }
  return out;
}

function intOrNull(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function emptyFilters(): SearchFilters {
  return {
    q: "",
    organism: [],
    tissue_group: [],
    disease_group: [],
    assay_family: [],
    cell_type: [],
    min_cells: null,
    has_bundle: null,
    year_min: null,
    year_max: null,
    min_file_samples: null,
    min_file_cells: null,
    reference_build: [],
    protocol: [],
    has_pubmed: null,
    max_file_bytes: null,
    has_conditions: null,
    match_mode: {},
  };
}

export function parseSearchParams(url: URL): SearchParams {
  const level: Level = url.searchParams.get("level") === "gsm" ? "gsm" : "gse";
  const sortRaw = url.searchParams.get("sort") ?? "relevance";
  const sort: Sort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as Sort) : "relevance";
  const page = Math.max(1, intOrNull(url.searchParams.get("page")) ?? 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, intOrNull(url.searchParams.get("limit")) ?? DEFAULT_LIMIT));
  const hb = url.searchParams.get("has_bundle");
  const has_bundle = hb == null || hb === "" ? true : hb === "1" || hb === "true";
  const bool = (key: string): boolean | null => {
    const value = url.searchParams.get(key);
    return value == null || value === "" ? null : value === "1" || value === "true";
  };
  const mode: SearchFilters["match_mode"] = {};
  for (const field of [...ARRAY_FILTER_FIELDS, "reference_build", "protocol"] as const) {
    if (url.searchParams.get(`${field}_mode`) === "all") mode[field] = "all";
  }
  return {
    q: (url.searchParams.get("q") ?? "").trim(),
    organism: multi(url, "organism"),
    tissue_group: multi(url, "tissue_group"),
    disease_group: multi(url, "disease_group"),
    assay_family: multi(url, "assay_family"),
    cell_type: multi(url, "cell_type"),
    min_cells: intOrNull(url.searchParams.get("min_cells")),
    has_bundle,
    year_min: intOrNull(url.searchParams.get("year_min")),
    year_max: intOrNull(url.searchParams.get("year_max")),
    min_file_samples: intOrNull(url.searchParams.get("min_file_samples")),
    min_file_cells: intOrNull(url.searchParams.get("min_file_cells")),
    reference_build: multi(url, "reference_build"),
    protocol: multi(url, "protocol"),
    has_pubmed: bool("has_pubmed"),
    max_file_bytes: intOrNull(url.searchParams.get("max_file_bytes")),
    has_conditions: bool("has_conditions"),
    match_mode: mode,
    level,
    sort,
    page,
    limit,
    format: url.searchParams.get("format") === "accessions" ? "accessions" : "json",
  };
}

/**
 * Map user/model-supplied values onto the stored vocabulary: organism aliases →
 * scientific names, group synonyms → canonical group names. Unresolvable
 * values are kept verbatim (they will simply match nothing) so the caller can
 * report them; `dropped` lists them.
 */
export function normalizeFilters<T extends SearchFilters>(f: T, rules: VocabRule[]): { filters: T; dropped: FilterMatch[] } {
  const dropped: FilterMatch[] = [];
  const uniq = (xs: string[]) => [...new Set(xs)];

  const organism = uniq(
    f.organism.map((v) => {
      const sci = organismToScientific(v);
      if (!sci) dropped.push({ field: "organism", value: v });
      return sci ?? v;
    })
  );
  const group = (field: GroupField, vals: string[]) =>
    uniq(
      vals.map((v) => {
        const g = resolveGroup(rules, field, v);
        if (!g) dropped.push({ field, value: v });
        return g ?? v;
      })
    );

  return {
    filters: {
      ...f,
      organism,
      tissue_group: group("tissue_group", f.tissue_group),
      disease_group: group("disease_group", f.disease_group),
      assay_family: group("assay_family", f.assay_family),
      cell_type: uniq(f.cell_type.map((v) => v.trim().toLowerCase()).filter(Boolean)),
    },
    dropped,
  };
}

/** Stable, sorted query string for cache keys. */
export function canonicalQuery(p: SearchParams | (SearchFilters & Partial<SearchParams>)): string {
  const sp = new URLSearchParams();
  const add = (k: string, vals: string[]) => [...vals].sort().forEach((v) => sp.append(k, v));
  if (p.q) sp.set("q", p.q.toLowerCase().replace(/\s+/g, " "));
  add("organism", p.organism);
  add("tissue_group", p.tissue_group);
  add("disease_group", p.disease_group);
  add("assay_family", p.assay_family);
  add("cell_type", p.cell_type);
  add("reference_build", p.reference_build);
  add("protocol", p.protocol);
  if (p.min_cells != null) sp.set("min_cells", String(p.min_cells));
  if (p.has_bundle != null) sp.set("has_bundle", p.has_bundle ? "1" : "0");
  if (p.year_min != null) sp.set("year_min", String(p.year_min));
  if (p.year_max != null) sp.set("year_max", String(p.year_max));
  if (p.min_file_samples != null) sp.set("min_file_samples", String(p.min_file_samples));
  if (p.min_file_cells != null) sp.set("min_file_cells", String(p.min_file_cells));
  if (p.has_pubmed != null) sp.set("has_pubmed", p.has_pubmed ? "1" : "0");
  if (p.max_file_bytes != null) sp.set("max_file_bytes", String(p.max_file_bytes));
  if (p.has_conditions != null) sp.set("has_conditions", p.has_conditions ? "1" : "0");
  for (const [field, mode] of Object.entries(p.match_mode)) if (mode === "all") sp.set(`${field}_mode`, "all");
  if (p.level) sp.set("level", p.level);
  if (p.sort) sp.set("sort", p.sort);
  if (p.page) sp.set("page", String(p.page));
  if (p.limit) sp.set("limit", String(p.limit));
  if (p.format && p.format !== "json") sp.set("format", p.format);
  sp.sort();
  return sp.toString();
}

export function hasAnyFilter(f: SearchFilters): boolean {
  return (
    f.organism.length > 0 ||
    f.tissue_group.length > 0 ||
    f.disease_group.length > 0 ||
    f.assay_family.length > 0 ||
    f.cell_type.length > 0 ||
    f.min_cells != null ||
    f.year_min != null ||
    f.year_max != null
    || f.min_file_samples != null || f.min_file_cells != null || f.reference_build.length > 0 || f.protocol.length > 0
    || f.has_pubmed != null || f.max_file_bytes != null || f.has_conditions != null
  );
}

// ── FTS helpers ─────────────────────────────────────────────────────────────

export interface FtsTerms {
  /** Display/substring forms, lowercased ("t cell", "microglia"). */
  terms: string[];
  /** FTS5 MATCH expression with AND semantics (null when no usable terms). */
  and: string | null;
  /** FTS5 MATCH expression with OR semantics. */
  or: string | null;
}

/** GEO accessions mentioned in free text. */
export function extractAccessions(q: string): { gse: string[]; gsm: string[] } {
  const gse = new Set<string>();
  const gsm = new Set<string>();
  for (const m of q.matchAll(/\b(GSE|GSM)(\d{3,})\b/gi)) {
    const acc = (m[1] + m[2]).toUpperCase();
    if (acc.startsWith("GSE")) gse.add(acc);
    else gsm.add(acc);
  }
  return { gse: [...gse], gsm: [...gsm] };
}

/** One FTS5 phrase token: quoted, prefix-matched when long enough. */
function ftsPhrase(term: string): string {
  const words = term.split(" ");
  const last = words[words.length - 1];
  const prefix = last.length >= 4 && !/^\d+$/.test(last);
  return `"${term.replace(/"/g, '""')}"${prefix ? "*" : ""}`;
}

/**
 * One query term as an FTS5 expression. Terms with known synonyms become an
 * OR-group ("aging" → ("aging"* OR "aged"* OR "old" …)) so that AND across
 * terms still holds while spelling/phrasing variants are tolerated.
 */
function ftsTerm(term: string): string {
  const syn = KEYWORD_SYNONYMS[term];
  if (!syn) return ftsPhrase(term);
  const alts = [...new Set([term, ...syn])].map(ftsPhrase);
  return alts.length > 1 ? `(${alts.join(" OR ")})` : alts[0];
}

/** Every word form a term expands to (lowercase), for substring highlighting. */
export function termVariants(term: string): string[] {
  const syn = KEYWORD_SYNONYMS[term];
  return syn ? [...new Set([term, ...syn])] : [term];
}

/**
 * Turn free text into safe FTS5 terms. Punctuation is stripped, stopwords
 * dropped, hyphenated words become phrases ("covid-19" → "covid 19"), and a
 * single letter followed by cell/cells is kept as a phrase ("t cells").
 */
export function tokenizeQuery(q: string): FtsTerms {
  const cleaned = q
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { terms: [], and: null, or: null };

  const raw = cleaned.split(" ").filter(Boolean);
  const terms: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let w = raw[i].replace(/^-+|-+$/g, "");
    if (!w) continue;
    if (w.includes("-")) {
      w = w.split("-").filter(Boolean).join(" ");
    }
    if (STOPWORDS.has(w)) continue;
    const next = raw[i + 1];
    if (w.length === 1 && next && /^cells?$/.test(next)) {
      terms.push(`${w} cell`);
      i++;
      continue;
    }
    if (w.length === 1) continue;
    terms.push(w);
    if (terms.length >= MAX_TERMS) break;
  }
  const uniq = [...new Set(terms)];
  if (!uniq.length) return { terms: [], and: null, or: null };
  const phrases = uniq.map(ftsTerm);
  return { terms: uniq, and: phrases.join(" AND "), or: phrases.join(" OR ") };
}

/**
 * FTS5 expression restricted to the sample columns that carry cell identity:
 * `cell_type`, GEO `source` (source_name — "sorted microglia from cortex") and
 * the raw `characteristics` string. OR within the group. Study titles are
 * deliberately excluded so "Cell type: microglia" stays a sample-level claim.
 */
export function cellTypeMatch(cellTypes: string[]): string | null {
  const parts = cellTypes.map((c) => tokenizeQuery(c)).filter((t) => t.and);
  if (!parts.length) return null;
  const inner = parts.map((t) => (t.terms.length > 1 ? `(${t.and})` : t.and!)).join(" OR ");
  return `{cell_type source characteristics} : (${inner})`;
}

function jsonArray(values: string[]): string {
  return JSON.stringify(values);
}

// ── WHERE builders ──────────────────────────────────────────────────────────

export interface Built {
  clauses: string[];
  params: (string | number)[];
}

export interface StudyWhereOpts {
  /** Facet field whose own constraint should be skipped (contextual facet counts). */
  exclude?: ArrayFilterField | "year" | "min_cells" | "q";
  /** Restrict to these gse_ids (JSON array string is built here). */
  gseIds?: string[] | null;
}

/** WHERE clauses on `gse_meta m` for the structured filters (not `q`). */
export function buildStudyWhere(f: SearchFilters, opts: StudyWhereOpts = {}): Built {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const ex = opts.exclude;

  const arr = (field: ArrayFilterField, col: string) => {
    const vals = f[field];
    if (!vals.length || ex === field) return;
    clauses.push(f.match_mode[field] === "all"
      ? `(SELECT COUNT(DISTINCT je.value) FROM json_each(m.${col}) je WHERE je.value IN (${vals.map(() => "?").join(",")})) = ${vals.length}`
      : `EXISTS (SELECT 1 FROM json_each(m.${col}) je WHERE je.value IN (${vals.map(() => "?").join(",")}))`);
    params.push(...vals);
  };
  arr("organism", "organisms");
  arr("tissue_group", "tissue_groups");
  arr("disease_group", "disease_groups");
  arr("assay_family", "assay_families");

  if (f.cell_type.length && ex !== "cell_type") {
    const match = cellTypeMatch(f.cell_type);
    if (match) {
      clauses.push(`m.gse_id IN (SELECT gse_id FROM fts_gsm WHERE fts_gsm MATCH ?)`);
      params.push(match);
    } else {
      clauses.push("0");
    }
  }
  if (f.min_cells != null && ex !== "min_cells") {
    clauses.push("m.n_cells >= ?");
    params.push(f.min_cells);
  }
  if (f.has_bundle === true) clauses.push("m.has_bundle = 1");
  if (f.year_min != null && ex !== "year") {
    clauses.push("m.year >= ?");
    params.push(f.year_min);
  }
  if (f.year_max != null && ex !== "year") {
    clauses.push("m.year <= ?");
    params.push(f.year_max);
  }
  if (f.min_file_samples != null) {
    clauses.push("COALESCE((SELECT b.n_gsms_in_bundle FROM bundle_manifest b WHERE b.gse_id = m.gse_id), 0) >= ?");
    params.push(f.min_file_samples);
  }
  if (f.min_file_cells != null) {
    clauses.push("COALESCE((SELECT SUM(q.n_cells_called) FROM sample_qc q WHERE q.gse_id = m.gse_id), 0) >= ?");
    params.push(f.min_file_cells);
  }
  const multiExists = (values: string[], mode: "any" | "all" | undefined, sql: string) => {
    if (!values.length) return;
    clauses.push(mode === "all"
      ? `(SELECT COUNT(DISTINCT value) FROM (${sql})) = ${values.length}`
      : `EXISTS (SELECT 1 FROM (${sql}))`);
    params.push(jsonArray(values));
  };
  multiExists(f.reference_build, f.match_mode.reference_build,
    "SELECT b.reference_build AS value FROM bundle_manifest b WHERE b.gse_id = m.gse_id AND b.reference_build IN (SELECT value FROM json_each(?))");
  const protocolExpr = `CASE
    WHEN lower(q.protocol) LIKE '%multiome%' OR lower(q.protocol) LIKE '%atac%' THEN 'multiome'
    WHEN lower(q.protocol) LIKE '%5%prime%' OR lower(q.protocol) LIKE '%5''%' THEN '10x 5'''
    WHEN lower(q.protocol) LIKE '%v2%' THEN '10xv2'
    WHEN lower(q.protocol) LIKE '%v3%' THEN '10xv3'
    ELSE 'other' END`;
  multiExists(f.protocol, f.match_mode.protocol,
    `SELECT ${protocolExpr} AS value FROM sample_qc q WHERE q.gse_id = m.gse_id AND ${protocolExpr} IN (SELECT value FROM json_each(?))`);
  if (f.has_pubmed === true) clauses.push("EXISTS (SELECT 1 FROM gse gx WHERE gx.id = m.gse_id AND gx.pubmed_ids IS NOT NULL AND gx.pubmed_ids NOT IN ('', '[]'))");
  if (f.max_file_bytes != null) {
    clauses.push("EXISTS (SELECT 1 FROM gse gx WHERE gx.id = m.gse_id AND gx.r2_bundle_bytes <= ?)");
    params.push(f.max_file_bytes);
  }
  if (f.has_conditions === true) clauses.push("m.n_conditions >= 1");
  if (opts.gseIds) {
    clauses.push("m.gse_id IN (SELECT value FROM json_each(?))");
    params.push(jsonArray(opts.gseIds));
  }
  return { clauses, params };
}

/** WHERE clauses on `gsm s` (joined to `gse_meta m`) for sample-level queries. */
export function buildSampleWhere(f: SearchFilters, opts: StudyWhereOpts = {}): Built {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const ex = opts.exclude;

  const col = (field: ArrayFilterField, c: string) => {
    const vals = f[field];
    if (!vals.length || ex === field) return;
    clauses.push(`s.${c} IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  };
  col("organism", "organism_primary");
  col("tissue_group", "tissue_group");
  col("disease_group", "disease_group");
  col("assay_family", "assay_family");

  if (f.cell_type.length && ex !== "cell_type") {
    const match = cellTypeMatch(f.cell_type);
    if (match) {
      clauses.push(`s.gsm_id IN (SELECT gsm_id FROM fts_gsm WHERE fts_gsm MATCH ?)`);
      params.push(match);
    } else {
      clauses.push("0");
    }
  }
  if (f.min_cells != null && ex !== "min_cells") {
    clauses.push("s.n_cells >= ?");
    params.push(f.min_cells);
  }
  if (f.has_bundle === true) clauses.push("m.has_bundle = 1");
  if (f.year_min != null && ex !== "year") {
    clauses.push("m.year >= ?");
    params.push(f.year_min);
  }
  if (f.year_max != null && ex !== "year") {
    clauses.push("m.year <= ?");
    params.push(f.year_max);
  }
  if (opts.gseIds) {
    clauses.push("s.gse_id IN (SELECT value FROM json_each(?))");
    params.push(jsonArray(opts.gseIds));
  }
  return { clauses, params };
}

// ── Text hits (q) ───────────────────────────────────────────────────────────

const HITS_CTE = `
  fg AS (SELECT id AS gse_id, rank AS s FROM fts_gse WHERE fts_gse MATCH ? AND ${RANK_GSE}),
  fs AS (SELECT gse_id, MIN(rank) AS s, COUNT(*) AS n
           FROM fts_gsm WHERE fts_gsm MATCH ? AND ${RANK_GSM}
          GROUP BY gse_id),
  hits AS (
    SELECT gse_id, MIN(s_gse) AS s_gse, MIN(s_gsm) AS s_gsm, MAX(n_match) AS n_match FROM (
      SELECT gse_id, s AS s_gse, NULL AS s_gsm, NULL AS n_match FROM fg
      UNION ALL
      SELECT gse_id, NULL, s, n FROM fs
    ) GROUP BY gse_id
  )`;

/**
 * Study ids matching a free-text query (title/abstract OR any sample field).
 * Used by /api/facets so the FTS work happens once per request.
 */
export async function studyHitIds(db: D1Database, match: string): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT id AS gse_id FROM fts_gse WHERE fts_gse MATCH ?1
       UNION
       SELECT DISTINCT gse_id FROM fts_gsm WHERE fts_gsm MATCH ?1`
    )
    .bind(match)
    .all<{ gse_id: string }>();
  return res.results.map((r) => r.gse_id);
}

// ── Study search ────────────────────────────────────────────────────────────

interface StudyDbRow {
  gse_id: string;
  organism_primary: string | null;
  organisms: string | null;
  tissue_groups: string | null;
  disease_groups: string | null;
  assay_families: string | null;
  tissues_raw: string | null;
  cell_types_raw: string | null;
  n_conditions: number | null;
  n_done: number | null;
  n_total: number | null;
  n_cells: number | null;
  has_bundle: number | null;
  year: number | null;
  title: string | null;
  abstract: string | null;
  r2_bundle_bytes: number | null;
  r2_bundle_key: string | null;
  bundle_n_samples: number | null;
  file_cells: number | null;
  reference_build: string | null;
  n_gsm_failed: number | null;
  s_gse: number | null;
  s_gsm: number | null;
  n_match: number | null;
  score: number | null;
  _total: number;
  _samples: number | null;
  _cells: number | null;
}

const STUDY_SELECT = `
  m.gse_id, m.organism_primary, m.organisms, m.tissue_groups, m.disease_groups, m.assay_families,
  m.tissues_raw, m.cell_types_raw, m.n_conditions, m.n_done, m.n_total, m.n_cells, m.has_bundle, m.year,
  g.title, g.abstract, g.r2_bundle_bytes, g.r2_bundle_key, g.n_gsm_failed,
  (SELECT b.n_gsms_in_bundle FROM bundle_manifest b WHERE b.gse_id = m.gse_id) AS bundle_n_samples,
  (SELECT b.reference_build FROM bundle_manifest b WHERE b.gse_id = m.gse_id) AS reference_build,
  (SELECT SUM(q.n_cells_called) FROM sample_qc q WHERE q.gse_id = m.gse_id) AS file_cells`;

function studyOrder(sort: Sort, hasQ: boolean): string {
  switch (sort) {
    case "cells":
      return "m.n_cells DESC, m.gse_id DESC";
    case "samples":
      return "m.n_done DESC, m.n_cells DESC";
    case "year":
      return "m.year DESC NULLS LAST, m.n_cells DESC";
    case "accession":
      return "CAST(substr(m.gse_id, 4) AS INTEGER) DESC";
    default:
      return hasQ
        ? `score ASC, ${CAPPED_STUDY_CELLS} DESC`
        : `m.has_bundle DESC, ${CAPPED_STUDY_CELLS} DESC, m.gse_id DESC`;
  }
}

interface StudyQueryPlan {
  sql: string;
  params: (string | number)[];
  countSql: string;
  countParams: (string | number)[];
  match: string | null;
  terms: string[];
  accessionLookup: string[] | null;
}

/**
 * Build the paged study query. `matchOverride` lets the caller force the OR
 * form of the FTS expression (fallback when AND finds nothing).
 */
export function planStudyQuery(p: SearchParams, matchOverride?: string | null): StudyQueryPlan {
  const acc = p.q ? extractAccessions(p.q) : { gse: [], gsm: [] };
  const fts = p.q ? tokenizeQuery(p.q) : { terms: [], and: null, or: null };
  const isAccession = acc.gse.length > 0 || acc.gsm.length > 0;
  const match = isAccession ? null : matchOverride !== undefined ? matchOverride : fts.and;

  const where = buildStudyWhere(isAccession ? { ...p, has_bundle: null } : p);
  const clauses = [...where.clauses];
  const params: (string | number)[] = [];
  let cte = "";
  let scoreExpr = "NULL";
  let join = "";

  if (isAccession) {
    // Direct lookup — other filters are ignored on purpose (an accession is an exact ask).
    const gseIds = [...acc.gse];
    const lookup = [`m.gse_id IN (SELECT value FROM json_each(?))`];
    params.push(jsonArray(gseIds));
    if (acc.gsm.length) {
      lookup.push(`m.gse_id IN (SELECT gse_id FROM gsm WHERE gsm_id IN (SELECT value FROM json_each(?)))`);
      params.push(jsonArray(acc.gsm));
    }
    clauses.length = 0;
    clauses.push(`(${lookup.join(" OR ")})`);
  } else if (match) {
    cte = `WITH ${HITS_CTE}`;
    params.push(match, match);
    join = "JOIN hits h ON h.gse_id = m.gse_id";
    scoreExpr = "3.0 * COALESCE(h.s_gse, 0) + COALESCE(h.s_gsm, 0) - 2.0 * COALESCE(h.n_match, 0) / MAX(m.n_total, 1)";
  } else if (p.q && !fts.terms.length) {
    // Query was only stopwords/punctuation: nothing can match by text.
    clauses.push("0");
  }
  params.push(...where.params);

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const hitCols = match ? "h.s_gse, h.s_gsm, h.n_match," : "NULL AS s_gse, NULL AS s_gsm, NULL AS n_match,";
  const sql = `${cte}
    SELECT ${STUDY_SELECT}, ${hitCols} ${scoreExpr} AS score,
           COUNT(*) OVER () AS _total, SUM(m.n_done) OVER () AS _samples, SUM(m.n_cells) OVER () AS _cells
      FROM gse_meta m
      ${join}
      LEFT JOIN gse g ON g.id = m.gse_id
      ${whereSql}
     ORDER BY ${studyOrder(p.sort, !!match)}
     LIMIT ? OFFSET ?`;
  const countSql = `${cte}
    SELECT COUNT(*) AS n, SUM(m.n_done) AS samples, SUM(m.n_cells) AS cells
      FROM gse_meta m ${join} ${whereSql}`;

  return {
    sql,
    params: [...params, p.limit, (p.page - 1) * p.limit],
    countSql,
    countParams: params,
    match,
    terms: fts.terms,
    accessionLookup: isAccession ? [...acc.gse, ...acc.gsm] : null,
  };
}

export function truncateAbstract(a: string | null): string | null {
  if (!a) return null;
  return a.length > ABSTRACT_CHARS ? a.slice(0, ABSTRACT_CHARS).trimEnd() + "…" : a;
}

function shapeStudy(r: StudyDbRow): StudyRow {
  const nDone = Number(r.n_done ?? 0);
  // `gse_meta.n_total` is rolled up from `gsm`; `gse.n_gsm_failed` comes from
  // the pipeline ledger and can include samples that never reached `gsm`.
  // Keep the pair self-consistent so the UI never shows "11 / 11 · 19 failed".
  const nFailed = Math.max(0, Number(r.n_gsm_failed ?? 0));
  const nTotal = Math.max(Number(r.n_total ?? 0), nDone + nFailed);
  const nCells = Number(r.n_cells ?? 0);
  const assay = safeList(r.assay_families);
  return {
    gse_id: r.gse_id,
    title: r.title,
    abstract: r.abstract,
    organism_primary: r.organism_primary,
    organism_label: organismToCommon(r.organism_primary),
    organisms: safeList(r.organisms),
    tissue_groups: safeList(r.tissue_groups),
    disease_groups: safeList(r.disease_groups),
    assay_families: assay,
    tissues_raw: safeList(r.tissues_raw),
    cell_types_raw: safeList(r.cell_types_raw),
    n_done: nDone,
    n_total: nTotal,
    n_failed: r.n_gsm_failed != null ? nFailed : Math.max(0, nTotal - nDone),
    n_cells: nCells,
    suspect_cells: isSuspectStudyCells(assay, nCells, nDone),
    has_bundle: Number(r.has_bundle ?? 0) === 1,
    bundle_bytes: r.r2_bundle_bytes != null ? Number(r.r2_bundle_bytes) : null,
    bundle_key: r.r2_bundle_key,
    bundle_n_samples: r.bundle_n_samples != null ? Number(r.bundle_n_samples) : null,
    file_cells: r.file_cells != null ? Number(r.file_cells) : null,
    reference_build: r.reference_build,
    year: r.year != null ? Number(r.year) : null,
    n_conditions: Number(r.n_conditions ?? 0),
    conditions: [],
    conditions_label: "",
    match: { filters: [], text: [], facets: [], keywords: [], score: 0 },
    why: "",
    score: r.score != null ? Number(r.score) : null,
  };
}

function scoreStudy(r: StudyRow, signals: SoftSignals): { score: number; full: boolean } {
  let score = 0;
  let full = true;
  const addFacet = (key: keyof Omit<SoftSignals, "q">, label: string, have: string[], weight: number) => {
    const wanted = signals[key];
    if (!wanted.length) return;
    const hits = wanted.filter((value) => have.some((v) => v.toLowerCase() === value.toLowerCase()));
    const status = hits.length === wanted.length ? "hit" : hits.length ? "partial" : "miss";
    if (status !== "hit") full = false;
    if (hits.length) score += weight * (hits.length / wanted.length);
    r.match.facets.push({ key, label, status, detail: hits.length ? hits.join(" / ") : "not annotated" });
  };
  addFacet("tissue_group", "Tissue", r.tissue_groups, 3);
  addFacet("disease_group", "Disease", r.disease_groups, 3);
  addFacet("assay_family", "Assay", r.assay_families, 1.5);
  for (const ct of signals.cell_type) {
    const hit = r.match.filters.find((x) => x.field === "cell_type" && x.value === ct);
    const n = hit?.n_samples ?? 0;
    const fraction = r.n_total ? Math.min(1, n / r.n_total) : 0;
    const status = n >= r.n_total && r.n_total > 0 ? "hit" : n > 0 ? "partial" : "miss";
    if (status !== "hit") full = false;
    if (n) score += 1 + 2 * fraction;
    r.match.facets.push({ key: "cell_type", label: ct, status, detail: n ? `${n} of ${r.n_total} samples annotated` : "not annotated" });
  }
  let keywordScore = 0;
  for (const term of signals.q) {
    const matches = r.match.text.filter((x) => x.term === term || termVariants(term).includes(x.term));
    const hits: string[] = [];
    if (matches.some((x) => x.field === "title")) { keywordScore += 1.5; hits.push("title"); }
    if (matches.some((x) => x.field === "abstract")) { keywordScore += 1; hits.push("abstract"); }
    const sampleN = Math.max(0, ...matches.filter((x) => !["title", "abstract", "accession"].includes(x.field)).map((x) => x.n_samples));
    if (sampleN) { keywordScore += 0.5 * Math.min(1, sampleN / Math.max(1, r.n_total)); hits.push(`${sampleN} of ${r.n_total} samples`); }
    r.match.keywords.push({ term, hits });
  }
  score += Math.min(4, keywordScore);
  if (r.has_bundle) score += 0.5;
  if (r.bundle_n_samples != null) score += Math.log10(r.bundle_n_samples + 1) * 0.3;
  if ((r.year ?? 0) >= 2020) score += 0.2;
  r.match.score = Number(score.toFixed(3));
  r.score = r.match.score;
  return { score, full };
}

function softFromQuery(p: SearchParams): SoftSignals {
  return { tissue_group: [], disease_group: [], assay_family: [], cell_type: [], q: tokenizeQuery(p.q).terms };
}

/** Run the study query; fills match/conditions/why for the page. */
export async function runStudySearch(
  ctx: Ctx,
  p: SearchParams,
  opts: { orFallback?: boolean; soft?: SoftSignals } = {}
): Promise<SearchResult<StudyRow>> {
  const { db } = ctx;
  const signals = opts.soft ?? softFromQuery(p);
  const isRanked = !extractAccessions(p.q).gse.length && !extractAccessions(p.q).gsm.length &&
    (signals.q.length > 0 || signals.tissue_group.length > 0 || signals.disease_group.length > 0 || signals.assay_family.length > 0 || signals.cell_type.length > 0);
  const candidateParams = isRanked ? { ...p, page: 1, limit: RANKED_CANDIDATE_LIMIT } : p;
  const orMatch = signals.q.length ? tokenizeQuery(signals.q.join(" ")).or : null;
  let plan = planStudyQuery(candidateParams, isRanked ? orMatch : undefined);
  let res = await db.prepare(plan.sql).bind(...plan.params).all<StudyDbRow>();
  let anyWord = false;

  // AND found nothing → try OR over the same terms (only when there are ≥2 terms).
  if (!isRanked && !res.results.length && plan.match && opts.orFallback !== false && plan.terms.length > 1) {
    const fts = tokenizeQuery(p.q);
    const orPlan = planStudyQuery(p, fts.or);
    const orRes = await db.prepare(orPlan.sql).bind(...orPlan.params).all<StudyDbRow>();
    if (orRes.results.length) {
      plan = orPlan;
      res = orRes;
      anyWord = true;
    }
  }

  let total = res.results[0]?._total ?? 0;
  let samples = res.results[0]?._samples ?? null;
  let cells = res.results[0]?._cells ?? null;
  if (!res.results.length && p.page > 1) {
    const c = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number; samples: number | null; cells: number | null }>();
    total = c?.n ?? 0;
    samples = c?.samples ?? null;
    cells = c?.cells ?? null;
  }

  let rows = res.results.map(shapeStudy);
  const evidenceParams: SearchParams = { ...p,
    tissue_group: [...new Set([...p.tissue_group, ...signals.tissue_group])],
    disease_group: [...new Set([...p.disease_group, ...signals.disease_group])],
    assay_family: [...new Set([...p.assay_family, ...signals.assay_family])],
    cell_type: [...new Set([...p.cell_type, ...signals.cell_type])],
    q: signals.q.join(" ") };
  const evidencePlan = { ...plan, terms: signals.q, match: orMatch };
  await attachStudyMatches(ctx, rows, evidenceParams, evidencePlan);
  let groups: { full: number; partial: number } | undefined;
  if (isRanked) {
    const scored = rows.map((row) => ({ row, ...scoreStudy(row, signals) }));
    const top = Math.max(0, ...scored.map((x) => x.score));
    const kept = scored.filter((x) => x.full || x.score >= Math.max(2, 0.35 * top));
    kept.sort((a, b) => Number(b.full) - Number(a.full) || b.score - a.score || (b.row.bundle_n_samples ?? b.row.n_done) - (a.row.bundle_n_samples ?? a.row.n_done));
    groups = { full: kept.filter((x) => x.full).length, partial: kept.filter((x) => !x.full).length };
    total = kept.length;
    const start = (p.page - 1) * p.limit;
    rows = kept.slice(start, start + p.limit).map((x) => x.row);
  }
  await attachConditions(ctx, rows);
  for (const r of rows) {
    r.why = whyText(r, evidenceParams);
    r.abstract = truncateAbstract(r.abstract);
  }

  return {
    total,
    totals: { studies: total, samples: samples != null ? Number(samples) : null, cells: cells != null ? Number(cells) : null },
    page: p.page,
    limit: p.limit,
    data: rows,
    accessions: rows.map((r) => r.gse_id),
    ...(plan.accessionLookup ? { accession_lookup: plan.accessionLookup } : {}),
    ...(anyWord ? { any_word: true } : {}),
    ...(groups ? { groups } : {}),
  };
}

/** Count only (used for nl-search suggestions). */
export async function countStudies(ctx: Ctx, p: SearchParams): Promise<number> {
  const plan = planStudyQuery(p);
  const c = await ctx.db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number }>();
  return c?.n ?? 0;
}

/** Whole-result-set accession export (≤ MAX_EXPORT). */
export async function exportStudyAccessions(ctx: Ctx, p: SearchParams): Promise<{ total: number; accessions: string[] }> {
  const plan = planStudyQuery({ ...p, page: 1, limit: MAX_EXPORT });
  const sql = plan.sql.replace(/SELECT[\s\S]*?FROM gse_meta m/, "SELECT m.gse_id, COUNT(*) OVER () AS _total FROM gse_meta m");
  const res = await ctx.db.prepare(sql).bind(...plan.params).all<{ gse_id: string; _total: number }>();
  return { total: res.results[0]?._total ?? 0, accessions: res.results.map((r) => r.gse_id) };
}

// ── Match enrichment ────────────────────────────────────────────────────────

async function attachStudyMatches(ctx: Ctx, rows: StudyRow[], p: SearchParams, plan: StudyQueryPlan): Promise<void> {
  if (!rows.length) return;
  const ids = rows.map((r) => r.gse_id);
  const byId = new Map(rows.map((r) => [r.gse_id, r]));

  // Structured filter matches (intersection of the study's groups with the request).
  const inter = (field: ArrayFilterField, have: (r: StudyRow) => string[]) => {
    const want = new Set(p[field]);
    if (!want.size) return;
    for (const r of rows) {
      for (const v of have(r)) if (want.has(v)) r.match.filters.push({ field, value: v });
    }
  };
  inter("organism", (r) => r.organisms.length ? r.organisms : r.organism_primary ? [r.organism_primary] : []);
  inter("tissue_group", (r) => r.tissue_groups);
  inter("disease_group", (r) => r.disease_groups);
  inter("assay_family", (r) => r.assay_families);

  if (plan.accessionLookup) {
    for (const r of rows) {
      for (const a of plan.accessionLookup) {
        if (a === r.gse_id) r.match.text.push({ field: "accession", term: a, n_samples: 0 });
      }
    }
  }

  const queries: Promise<unknown>[] = [];

  // Cell-type filter: how many samples in each study carry the term.
  if (p.cell_type.length) {
    for (const ct of p.cell_type) {
      const match = cellTypeMatch([ct]);
      if (!match) continue;
      queries.push(
        ctx.db
          .prepare(
            `SELECT gse_id, COUNT(*) AS n FROM fts_gsm
              WHERE fts_gsm MATCH ? AND gse_id IN (SELECT value FROM json_each(?))
              GROUP BY gse_id`
          )
          .bind(match, jsonArray(ids))
          .all<{ gse_id: string; n: number }>()
          .then((res) => {
            for (const hit of res.results) {
              byId.get(hit.gse_id)?.match.filters.push({ field: "cell_type", value: ct, n_samples: Number(hit.n) });
            }
          })
      );
    }
  }

  // Free-text matches: title/abstract in JS, sample fields in one grouped query.
  // Synonym variants ("aging" → "old", "aged") count as a hit for the base term.
  if (plan.match && plan.terms.length) {
    const wordHit = (text: string, v: string): boolean => {
      // Whole-word for short variants ("age", "old", "ko") so "average" or
      // "cold" don't get credited; prefix-style substring for longer ones.
      if (v.length > 4) return text.includes(v);
      return new RegExp(`(^|[^\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text);
    };
    for (const r of rows) {
      const title = (r.title ?? "").toLowerCase();
      const abstract = (r.abstract ?? "").toLowerCase();
      for (const t of plan.terms) {
        const variants = termVariants(t);
        const inTitle = variants.find((v) => wordHit(title, v));
        if (inTitle) r.match.text.push({ field: "title", term: inTitle, n_samples: 0 });
        else {
          const inAbstract = variants.find((v) => wordHit(abstract, v));
          if (inAbstract) r.match.text.push({ field: "abstract", term: inAbstract, n_samples: 0 });
        }
      }
    }
    const fields: ["characteristics" | "source" | "cell_type" | "tissue" | "sample_title", string][] = [
      ["characteristics", "characteristics"],
      ["source", "source"],
      ["cell_type", "cell_type"],
      ["tissue", "tissue"],
      ["sample_title", "title"],
    ];
    const selects: string[] = [];
    const params: (string | number)[] = [];
    plan.terms.forEach((t, ti) => {
      // The user's word is bound; our own synonym constants are inlined as
      // escaped literals so the bound-parameter count stays well under D1's cap.
      const synLiterals = termVariants(t)
        .filter((v) => v !== t)
        .map((v) => `'${v.replace(/'/g, "''")}'`);
      for (const [key, col] of fields) {
        const tests = [`instr(lower(${col}), ?) > 0`, ...synLiterals.map((lit) => `instr(lower(${col}), ${lit}) > 0`)];
        selects.push(`SUM(CASE WHEN ${tests.join(" OR ")} THEN 1 ELSE 0 END) AS "${key}_${ti}"`);
        params.push(t);
      }
    });
    queries.push(
      ctx.db
        .prepare(
          `SELECT gse_id, ${selects.join(", ")}
             FROM fts_gsm
            WHERE fts_gsm MATCH ? AND gse_id IN (SELECT value FROM json_each(?))
            GROUP BY gse_id`
        )
        .bind(...params, plan.match, jsonArray(ids))
        .all<Record<string, unknown>>()
        .then((res) => {
          for (const hit of res.results) {
            const r = byId.get(String(hit.gse_id));
            if (!r) continue;
            plan.terms.forEach((t, ti) => {
              const perField = fields
                .map(([key]) => ({ key, n: Number(hit[`${key}_${ti}`] ?? 0) }))
                .filter((x) => x.n > 0);
              const nonTitle = perField.filter((x) => x.key !== "sample_title");
              // Sample titles usually duplicate the study title, so only report them
              // when nothing else carries the term and the study title/abstract don't either.
              const variants = termVariants(t);
              const alreadyInStudy = r.match.text.some(
                (m) => variants.includes(m.term) && (m.field === "title" || m.field === "abstract")
              );
              const chosen = nonTitle.length ? nonTitle : alreadyInStudy ? [] : perField;
              for (const x of chosen) r.match.text.push({ field: x.key, term: t, n_samples: x.n });
            });
          }
        })
    );
  }

  await Promise.all(queries);
}

// ── Conditions (memoised in meta_cache) ─────────────────────────────────────

interface StoredConditions {
  conditions: ConditionSummary["conditions"];
  label: string;
  n_with_characteristics: number;
}

export async function conditionsFor(ctx: Ctx, gseIds: string[]): Promise<Map<string, StoredConditions>> {
  const out = new Map<string, StoredConditions>();
  if (!gseIds.length) return out;
  const { db } = ctx;

  let cached: { key: string; value: string; updated_at: string }[] = [];
  try {
    const res = await db
      .prepare(
        `SELECT key, value, updated_at FROM meta_cache
          WHERE key IN (SELECT 'conditions:' || value FROM json_each(?))`
      )
      .bind(jsonArray(gseIds))
      .all<{ key: string; value: string; updated_at: string }>();
    cached = res.results;
  } catch {
    cached = [];
  }
  const now = Date.now();
  for (const row of cached) {
    const age = now - Date.parse(row.updated_at ?? "");
    if (!Number.isFinite(age) || age > CONDITIONS_TTL_MS) continue;
    try {
      out.set(row.key.slice("conditions:".length), JSON.parse(row.value) as StoredConditions);
    } catch {
      /* recompute below */
    }
  }

  const misses = gseIds.filter((id) => !out.has(id));
  if (!misses.length) return out;

  const res = await db
    .prepare(
      `SELECT gse_id, characteristics FROM (
         SELECT gse_id, characteristics,
                ROW_NUMBER() OVER (PARTITION BY gse_id ORDER BY gsm_id) AS rn
           FROM gsm
          WHERE gse_id IN (SELECT value FROM json_each(?))
       ) WHERE rn <= ${CONDITIONS_SAMPLE_CAP}`
    )
    .bind(jsonArray(misses))
    .all<{ gse_id: string; characteristics: string | null }>();

  const grouped = new Map<string, { characteristics: string | null }[]>();
  for (const r of res.results) {
    let arr = grouped.get(r.gse_id);
    if (!arr) grouped.set(r.gse_id, (arr = []));
    arr.push({ characteristics: r.characteristics });
  }

  const writes: D1PreparedStatement[] = [];
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const id of misses) {
    const s = summarizeConditions(grouped.get(id) ?? []);
    const stored: StoredConditions = { conditions: s.conditions, label: s.label, n_with_characteristics: s.n_with_characteristics };
    out.set(id, stored);
    writes.push(
      db
        .prepare(`INSERT OR REPLACE INTO meta_cache (key, value, updated_at) VALUES (?, ?, ?)`)
        .bind(`conditions:${id}`, JSON.stringify(stored), nowIso)
    );
  }
  if (writes.length) {
    const chunks: D1PreparedStatement[][] = [];
    for (let i = 0; i < writes.length; i += 40) chunks.push(writes.slice(i, i + 40));
    ctx.waitUntil(Promise.all(chunks.map((c) => db.batch(c))).catch(() => undefined));
  }
  return out;
}

async function attachConditions(ctx: Ctx, rows: StudyRow[]): Promise<void> {
  if (!rows.length) return;
  const map = await conditionsFor(ctx, rows.map((r) => r.gse_id));
  for (const r of rows) {
    const c = map.get(r.gse_id);
    if (!c) continue;
    r.conditions = c.conditions;
    r.conditions_label = c.label;
    if (!r.n_conditions) r.n_conditions = c.conditions.length;
  }
}

// ── "Why it matches" (deterministic) ────────────────────────────────────────

function quote(t: string): string {
  return `“${t}”`;
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function whyText(r: StudyRow, p: SearchFilters): string {
  const parts: string[] = [];
  const f = r.match.filters;

  const orgs = f.filter((x) => x.field === "organism").map((x) => organismToCommon(x.value));
  if (orgs.length) parts.push([...new Set(orgs)].join(" / "));
  else if (p.q || hasAnyFilter(p)) parts.push(r.organism_label);

  for (const field of ["tissue_group", "disease_group"] as const) {
    const vals = [...new Set(f.filter((x) => x.field === field).map((x) => x.value))];
    if (vals.length) parts.push(vals.join(" / "));
  }

  for (const x of f.filter((x) => x.field === "cell_type")) {
    const n = x.n_samples ?? 0;
    parts.push(`${n} of ${r.n_total} samples ${n === 1 ? "is" : "are"} annotated ${quote(x.value)}`);
  }

  // Text matches: strongest first, at most three clauses.
  const text = [...r.match.text];
  const acc = text.filter((t) => t.field === "accession");
  for (const a of acc) parts.push(a.term.startsWith("GSM") ? `contains sample ${a.term}` : `accession ${a.term}`);
  const titleTerms = text.filter((t) => t.field === "title").map((t) => quote(t.term));
  if (titleTerms.length) parts.push(`title mentions ${joinAnd(titleTerms)}`);
  const abstractTerms = text.filter((t) => t.field === "abstract").map((t) => quote(t.term));
  if (abstractTerms.length) parts.push(`abstract mentions ${joinAnd(abstractTerms)}`);
  const sampleHits = text
    .filter((t) => t.n_samples > 0 && GSM_FIELD_LABEL[t.field])
    .sort((a, b) => b.n_samples - a.n_samples)
    .slice(0, 3);
  for (const h of sampleHits) {
    parts.push(`${h.n_samples} of ${r.n_total} samples mention ${quote(h.term)} in ${GSM_FIELD_LABEL[h.field]}`);
  }

  const assays = [...new Set(f.filter((x) => x.field === "assay_family").map((x) => x.value))];
  if (assays.length) parts.push(assays.join(" / "));

  if (!parts.length) return "";
  return parts.join(" · ");
}

// ── Sample search ───────────────────────────────────────────────────────────

interface SampleDbRow {
  gsm_id: string;
  gse_id: string;
  study_title: string | null;
  organism: string | null;
  organism_primary: string | null;
  protocol: string | null;
  assay_family: string | null;
  tissue: string | null;
  tissue_group: string | null;
  cell_type: string | null;
  disease: string | null;
  disease_group: string | null;
  sex: string | null;
  n_cells: number | null;
  status: string;
  failure_category: string | null;
  title: string | null;
  source: string | null;
  characteristics: string | null;
  has_bundle: number | null;
  year: number | null;
  score: number | null;
  _total: number;
  _cells: number | null;
}

const SAMPLE_SELECT = `
  s.gsm_id, s.gse_id, g.title AS study_title, s.organism, s.organism_primary, s.protocol, s.assay_family,
  s.tissue, s.tissue_group, s.cell_type, s.disease, s.disease_group, s.sex, s.n_cells, s.status,
  s.failure_category, s.title, s.source, s.characteristics, m.has_bundle, m.year`;

function sampleOrder(sort: Sort, hasQ: boolean): string {
  switch (sort) {
    case "cells":
    case "samples":
      return "s.n_cells DESC NULLS LAST, s.gsm_id DESC";
    case "year":
      return "m.year DESC NULLS LAST, s.n_cells DESC";
    case "accession":
      return "CAST(substr(s.gsm_id, 4) AS INTEGER) DESC";
    default:
      return hasQ
        ? "score ASC, (s.status = 'DONE') DESC, s.n_cells DESC"
        : "(s.status = 'DONE') DESC, s.n_cells DESC NULLS LAST, s.gsm_id DESC";
  }
}

function planSampleQuery(p: SearchParams, matchOverride?: string | null) {
  const acc = p.q ? extractAccessions(p.q) : { gse: [], gsm: [] };
  const fts = p.q ? tokenizeQuery(p.q) : { terms: [], and: null, or: null };
  const isAccession = acc.gse.length > 0 || acc.gsm.length > 0;
  const match = isAccession ? null : matchOverride !== undefined ? matchOverride : fts.and;

  const where = buildSampleWhere(p);
  const clauses = [...where.clauses];
  const params: (string | number)[] = [];
  let cte = "";
  let join = "";
  let scoreExpr = "NULL";

  if (isAccession) {
    const parts: string[] = [];
    if (acc.gsm.length) {
      parts.push("s.gsm_id IN (SELECT value FROM json_each(?))");
      params.push(jsonArray(acc.gsm));
    }
    if (acc.gse.length) {
      parts.push("s.gse_id IN (SELECT value FROM json_each(?))");
      params.push(jsonArray(acc.gse));
    }
    clauses.length = 0;
    clauses.push(`(${parts.join(" OR ")})`);
  } else if (match) {
    cte = `WITH
      fs AS (SELECT gsm_id, rank AS s FROM fts_gsm WHERE fts_gsm MATCH ? AND ${RANK_GSM}),
      fg AS (SELECT id AS gse_id, rank AS s FROM fts_gse WHERE fts_gse MATCH ? AND ${RANK_GSE}),
      hit_ids AS (
        SELECT gsm_id FROM fs
        UNION
        SELECT gsm_id FROM gsm WHERE gse_id IN (SELECT gse_id FROM fg)
      )`;
    params.push(match, match);
    join = `JOIN hit_ids h ON h.gsm_id = s.gsm_id
            LEFT JOIN fs ON fs.gsm_id = s.gsm_id
            LEFT JOIN fg ON fg.gse_id = s.gse_id`;
    scoreExpr = "COALESCE(fs.s, 0) + 0.5 * COALESCE(fg.s, 0)";
  } else if (p.q && !fts.terms.length) {
    clauses.push("0");
  }
  params.push(...where.params);

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `${cte}
    SELECT ${SAMPLE_SELECT}, ${scoreExpr} AS score,
           COUNT(*) OVER () AS _total, SUM(s.n_cells) OVER () AS _cells
      FROM gsm s
      ${join}
      LEFT JOIN gse g ON g.id = s.gse_id
      LEFT JOIN gse_meta m ON m.gse_id = s.gse_id
      ${whereSql}
     ORDER BY ${sampleOrder(p.sort, !!match)}
     LIMIT ? OFFSET ?`;
  const countSql = `${cte}
    SELECT COUNT(*) AS n, SUM(s.n_cells) AS cells
      FROM gsm s ${join} LEFT JOIN gse_meta m ON m.gse_id = s.gse_id ${whereSql}`;
  return {
    sql,
    params: [...params, p.limit, (p.page - 1) * p.limit],
    countSql,
    countParams: params,
    match,
    terms: fts.terms,
    accessionLookup: isAccession ? [...acc.gse, ...acc.gsm] : null,
  };
}

function shapeSample(r: SampleDbRow): SampleRow {
  const nCells = r.n_cells != null ? Number(r.n_cells) : null;
  return {
    gsm_id: r.gsm_id,
    gse_id: r.gse_id,
    study_title: r.study_title,
    organism: r.organism,
    organism_primary: r.organism_primary,
    organism_label: organismToCommon(r.organism_primary ?? r.organism),
    protocol: r.protocol,
    assay_family: r.assay_family,
    tissue: r.tissue,
    tissue_group: r.tissue_group,
    cell_type: r.cell_type,
    disease: r.disease,
    disease_group: r.disease_group,
    sex: r.sex,
    n_cells: nCells,
    suspect_cells: isSuspectCellCount(r.protocol, r.assay_family, nCells),
    status: statusText(r.status, r.failure_category),
    status_code: r.status,
    failure_category: r.failure_category,
    title: r.title,
    source: r.source,
    characteristics: parseCharacteristics(r.characteristics),
    has_bundle: Number(r.has_bundle ?? 0) === 1,
    year: r.year != null ? Number(r.year) : null,
    score: r.score != null ? Number(r.score) : null,
  };
}

export async function runSampleSearch(ctx: Ctx, p: SearchParams): Promise<SearchResult<SampleRow>> {
  const { db } = ctx;
  let plan = planSampleQuery(p);
  let res = await db.prepare(plan.sql).bind(...plan.params).all<SampleDbRow>();
  if (!res.results.length && plan.match && plan.terms.length > 1) {
    const orPlan = planSampleQuery(p, tokenizeQuery(p.q).or);
    const orRes = await db.prepare(orPlan.sql).bind(...orPlan.params).all<SampleDbRow>();
    if (orRes.results.length) {
      plan = orPlan;
      res = orRes;
    }
  }
  let total = res.results[0]?._total ?? 0;
  let cells = res.results[0]?._cells ?? null;
  if (!res.results.length && p.page > 1) {
    const c = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number; cells: number | null }>();
    total = c?.n ?? 0;
    cells = c?.cells ?? null;
  }
  const rows = res.results.map(shapeSample);
  return {
    total,
    totals: { studies: null, samples: total, cells: cells != null ? Number(cells) : null },
    page: p.page,
    limit: p.limit,
    data: rows,
    accessions: rows.map((r) => r.gsm_id),
    ...(plan.accessionLookup ? { accession_lookup: plan.accessionLookup } : {}),
  };
}

// ── Misc exports for callers ────────────────────────────────────────────────

export { canonicalGroup, organismToCommon };

/** Just the filter fields (drops level/sort/page/limit/format). */
export function pickFilters(p: SearchFilters): SearchFilters {
  return {
    q: p.q,
    organism: p.organism,
    tissue_group: p.tissue_group,
    disease_group: p.disease_group,
    assay_family: p.assay_family,
    cell_type: p.cell_type,
    min_cells: p.min_cells,
    has_bundle: p.has_bundle,
    year_min: p.year_min,
    year_max: p.year_max,
    min_file_samples: p.min_file_samples,
    min_file_cells: p.min_file_cells,
    reference_build: p.reference_build,
    protocol: p.protocol,
    has_pubmed: p.has_pubmed,
    max_file_bytes: p.max_file_bytes,
    has_conditions: p.has_conditions,
    match_mode: p.match_mode,
  };
}
