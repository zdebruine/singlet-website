/**
 * Natural-language search core, shared by /api/nl-search and the MCP server.
 *
 *   1. The query is read by ./interpret: a deterministic parse against the
 *      CANONICAL vocabulary (organism aliases, the D1 vocab_rules for tissue /
 *      disease / assay, cell types, cell-count and year phrases) always runs;
 *      a model (Anthropic or Workers AI, see ./ai) is asked only when the parse
 *      leaves several words it could not place, and its validated reading is
 *      cached in D1 so each distinct question is paid for once.
 *   2. The resulting filters run through the shared search core with AND
 *      semantics. Only the interpreted organism is a hard filter; interpreted
 *      tissue / disease / assay / cell type are ranking signals. A zero result
 *      is NEVER broadened silently: instead `suggestions` lists what dropping
 *      each single filter would yield.
 *   3. `why` holds a deterministic one-line explanation per study, built from
 *      the structured `match` data — no second model call.
 *
 * Explicit filters (organism=…, tissue_group=…, …) are merged (union per
 * field) with the interpreted ones.
 *
 * Budgets: only a *fresh* model reading spends a unit of the caller's daily
 * AI budget — 10/day anonymous (salted IP hash), 200/day signed in or with a
 * personal API key (charged to the key's owner). Vocabulary-only readings and
 * cached model readings are free. The remaining budget comes back in the
 * `X-Singlet-Quota` header (never cached). When the budget is spent the
 * request still succeeds on the vocabulary reading, with
 * `quota_exceeded: true`, `quota` and a human `note`.
 */
import { NO_CACHE_HEADER } from "./cache";
import { QUOTA_HEADER, type Identity } from "./identity";
import { quotaHeaderValue, type Quota } from "./quota";
import { interpretQuery, isEmptyInterpretation, type InterpretEnv, type Interpreted } from "./interpret";
import { loadRules, type VocabRule } from "./vocab";
import {
  canonicalQuery,
  countStudies,
  emptyFilters,
  extractAccessions,
  hasAnyFilter,
  normalizeFilters,
  parseSearchParams,
  pickFilters,
  runSampleSearch,
  runStudySearch,
  tokenizeQuery,
  type Ctx,
  type FilterMatch,
  type SearchFilters,
  type SearchParams,
  type SoftSignals,
  type StudyRow,
} from "./search-core";

export type { Interpreted } from "./interpret";
export type { Quota } from "./quota";

/** Bindings and vars nlSearch needs (a subset of AppEnv). */
export type NlEnv = InterpretEnv;

const MAX_SUGGESTIONS = 5;

interface Suggestion {
  /** Remove this one filter (or `all_filters` = keep only the free text). */
  drop?: FilterMatch | { field: "all_filters"; value: string };
  /** Second tier, offered only when no single removal helps: keep just this filter. */
  keep?: FilterMatch;
  total: number;
  /** Canonical query-string fragment the UI can apply. */
  params: string;
}

/** Keep rail filters hard; only interpreted organism is hard. Other interpreted facets are ranking signals. */
function mergeFilters(explicit: SearchParams, interp: Interpreted, rules: VocabRule[]): { filters: SearchParams; display: SearchParams; soft: SoftSignals; dropped: FilterMatch[] } {
  const hardInput: SearchParams = {
    ...explicit,
    q: interp.q.join(" "),
    organism: [...explicit.organism, ...interp.organism],
    min_cells: explicit.min_cells ?? interp.min_cells,
    year_min: explicit.year_min ?? interp.year_min,
    year_max: explicit.year_max ?? interp.year_max,
  };
  const displayInput = {
    ...hardInput,
    tissue_group: [...explicit.tissue_group, ...interp.tissue_group],
    disease_group: [...explicit.disease_group, ...interp.disease_group],
    assay_family: [...explicit.assay_family, ...interp.assay_family],
    cell_type: [...explicit.cell_type, ...interp.cell_type],
  };
  const hard = normalizeFilters(hardInput, rules);
  const shown = normalizeFilters(displayInput, rules);
  const filters = hard.filters;
  const display = shown.filters;
  const dropped = shown.dropped;
  // Values the vocabulary could not place are removed rather than left to match nothing —
  // the interpretation row shows them as "not recognised" instead.
  for (const d of dropped) {
    const key = d.field as keyof SearchFilters;
    const arr = filters[key];
    if (Array.isArray(arr)) (filters as unknown as Record<string, string[]>)[key] = arr.filter((v) => v !== d.value);
  }
  const soft: SoftSignals = {
    organism: display.organism.filter((v) => interp.organism.includes(v)),
    tissue_group: display.tissue_group.filter((v) => !explicit.tissue_group.includes(v)),
    disease_group: display.disease_group.filter((v) => !explicit.disease_group.includes(v)),
    assay_family: display.assay_family.filter((v) => !explicit.assay_family.includes(v)),
    cell_type: display.cell_type.filter((v) => !explicit.cell_type.map((x) => x.toLowerCase()).includes(v)),
    q: interp.q,
  };
  return { filters, display, soft, dropped };
}

/** Atomic filters currently applied, as (field, value) pairs. */
function atomicFilters(f: SearchFilters): FilterMatch[] {
  const out: FilterMatch[] = [];
  for (const field of ["organism", "tissue_group", "disease_group", "assay_family", "cell_type"] as const) {
    for (const v of f[field]) out.push({ field, value: v });
  }
  if (f.min_cells != null) out.push({ field: "min_cells", value: String(f.min_cells) });
  if (f.year_min != null) out.push({ field: "year_min", value: String(f.year_min) });
  if (f.year_max != null) out.push({ field: "year_max", value: String(f.year_max) });
  if (f.q) out.push({ field: "q", value: f.q });
  return out;
}

function without(f: SearchParams, drop: FilterMatch): SearchParams {
  const g: SearchParams = { ...f };
  switch (drop.field) {
    case "min_cells":
      g.min_cells = null;
      break;
    case "year_min":
      g.year_min = null;
      break;
    case "year_max":
      g.year_max = null;
      break;
    case "q":
      g.q = "";
      break;
    default: {
      const key = drop.field as "organism" | "tissue_group" | "disease_group" | "assay_family" | "cell_type";
      g[key] = f[key].filter((v) => v !== drop.value);
    }
  }
  return g;
}

function filterParams(f: SearchFilters): string {
  return canonicalQuery({ ...emptyFilters(), ...pickFilters(f) });
}

function onlyFilter(f: SearchParams, keep: FilterMatch): SearchParams {
  const g: SearchParams = { ...emptyFilters(), level: f.level, sort: f.sort, page: 1, limit: f.limit, format: "json", has_bundle: f.has_bundle };
  switch (keep.field) {
    case "min_cells":
      g.min_cells = Number(keep.value);
      break;
    case "year_min":
      g.year_min = Number(keep.value);
      break;
    case "year_max":
      g.year_max = Number(keep.value);
      break;
    case "q":
      g.q = keep.value;
      break;
    default:
      (g as unknown as Record<string, string[]>)[keep.field] = [keep.value];
  }
  return g;
}

/**
 * What removing one filter at a time would yield (≤ MAX_SUGGESTIONS, plus
 * "free text alone"). If no single removal helps, offer keeping just one
 * filter instead — the user always chooses; nothing is relaxed for them.
 */
async function suggestions(ctx: Ctx, f: SearchParams): Promise<Suggestion[]> {
  const atoms = atomicFilters(f);
  const out: Suggestion[] = [];
  const tasks: Promise<void>[] = [];
  for (const atom of atoms.slice(0, MAX_SUGGESTIONS)) {
    const g = without(f, atom);
    tasks.push(
      countStudies(ctx, g).then((total) => {
        if (total > 0) out.push({ drop: atom, total, params: filterParams(g) });
      })
    );
  }
  if (f.q && hasAnyFilter(f)) {
    const g: SearchParams = { ...emptyFilters(), level: f.level, sort: f.sort, page: 1, limit: f.limit, format: "json", q: f.q, has_bundle: f.has_bundle };
    tasks.push(
      countStudies(ctx, g).then((total) => {
        if (total > 0) out.push({ drop: { field: "all_filters", value: f.q }, total, params: filterParams(g) });
      })
    );
  }
  await Promise.all(tasks);

  if (!out.length && atoms.length > 1) {
    const keeps: Promise<void>[] = [];
    for (const atom of atoms.slice(0, MAX_SUGGESTIONS)) {
      const g = onlyFilter(f, atom);
      keeps.push(
        countStudies(ctx, g).then((total) => {
          if (total > 0) out.push({ keep: atom, total, params: filterParams(g) });
        })
      );
    }
    await Promise.all(keeps);
  }
  return out.sort((a, b) => a.total - b.total);
}

export interface NlSearchBody {
  /** Always true now: the vocabulary reader needs no external service. Kept for older clients. */
  configured: boolean;
  interpreted: Interpreted | null;
  applied: ReturnType<typeof pickFilters>;
  dropped: FilterMatch[];
  level: SearchParams["level"];
  data: unknown[];
  total: number;
  totals: { studies: number | null; samples: number | null; cells: number | null };
  page: number;
  limit: number;
  accessions: string[];
  suggestions: Suggestion[];
  why: Record<string, string>;
  /** Model label, present only when a model reading (fresh or cached) was used. */
  model?: string;
  any_word?: boolean;
  note?: string;
  quota_exceeded?: boolean;
  quota?: Quota;
  accession_lookup?: string[];
  hard_applied?: SearchFilters;
  groups?: { full: number; partial: number };
  candidate_accessions?: string[];
  ms?: number;
}

export type NlSearchOutcome =
  | { ok: true; body: NlSearchBody; headers: Record<string, string>; quota?: Quota }
  | { ok: false; status: number; error: string; message: string };

/**
 * Run a natural-language search. `url` carries the same parameters as
 * /api/search plus `q`; `identity` (resolved by the caller: session, API key
 * or anonymous) is who a fresh model reading is charged to.
 */
export async function nlSearch(
  env: NlEnv,
  identity: Identity,
  waitUntil: (p: Promise<unknown>) => void,
  url: URL
): Promise<NlSearchOutcome> {
  const started = Date.now();
  const explicit = parseSearchParams(url);
  const q = explicit.q;
  if (!q) return { ok: false, status: 400, error: "missing_query", message: "Missing query parameter 'q'" };
  const rules = await loadRules(env.DB, waitUntil);
  const ctx: Ctx = { db: env.DB, rules, waitUntil };

  // Accessions are an exact ask — nothing to interpret. `interpret=0` is how
  // the site re-runs a search after the visitor edited the interpretation:
  // the filters are theirs now and `q` is plain keywords.
  const acc = extractAccessions(q);
  const isAccession = acc.gse.length > 0 || acc.gsm.length > 0;
  const skipInterpret = isAccession || url.searchParams.get("interpret") === "0";

  let interpreted: Interpreted | null = null;
  let model: string | undefined;
  let note: string | undefined;
  let quota: Quota | undefined;
  let quotaExceeded = false;
  // Degraded answers (model failed, budget spent) are visitor-specific
  // moments, not facts about the catalog — never let them into the edge cache.
  let cacheable = true;

  if (!skipInterpret) {
    const r = await interpretQuery(env, ctx, identity, q);
    interpreted = r.interpreted;
    model = r.model;
    quota = r.quota;
    if (r.quotaExceeded) {
      quota = r.quotaExceeded.quota;
      quotaExceeded = true;
      cacheable = false;
      note = `${r.quotaExceeded.message} Meanwhile this search was read with the built-in vocabulary only.`;
    }
    if (r.degraded) cacheable = false;
  }

  const merged = interpreted ? mergeFilters(explicit, interpreted, rules) : null;
  const normalized = merged ?? normalizeFilters(explicit, rules);
  const filters = normalized.filters;
  const dropped = normalized.dropped;
  // When the reading produced nothing usable, fall back to the raw text.
  if (interpreted && !hasAnyFilter(filters) && !filters.q) filters.q = q;
  // Nothing at all was read (no facet, no keyword): behave like a plain keyword search.
  const plainKeywords = !interpreted || isEmptyInterpretation(interpreted);

  const result =
    filters.level === "gse"
      ? await runStudySearch(ctx, filters, { orFallback: plainKeywords, soft: merged?.soft })
      : await runSampleSearch(ctx, filters);

  const why: Record<string, string> = {};
  if (filters.level === "gse") for (const r of result.data as StudyRow[]) why[r.gse_id] = r.why;

  let sugg: Suggestion[] = [];
  if (result.total === 0 && filters.level === "gse") sugg = await suggestions(ctx, filters);

  // Values the vocabulary could not place are reported structurally in `dropped`
  // (the UI renders them itself), so they are deliberately not repeated in `note`.
  if (result.any_word) {
    note = [note, "No study mentions every word, so these match any of the words instead."].filter(Boolean).join(" ");
  }
  if (interpreted && filters.q) {
    const fts = tokenizeQuery(filters.q);
    if (!fts.terms.length) filters.q = "";
  }

  const headers: Record<string, string> = {};
  if (quota && !quotaExceeded) headers[QUOTA_HEADER] = quotaHeaderValue(quota);
  if (!cacheable) headers[NO_CACHE_HEADER] = "1";

  const body: NlSearchBody = {
    configured: true,
    interpreted,
    applied: pickFilters(merged?.display ?? filters),
    hard_applied: pickFilters(filters),
    dropped,
    level: filters.level,
    data: result.data,
    total: result.total,
    totals: result.totals,
    page: result.page,
    limit: result.limit,
    accessions: result.accessions,
    suggestions: sugg,
    why,
    ...(model ? { model } : {}),
    ...(result.any_word ? { any_word: true } : {}),
    ...(note ? { note } : {}),
    ...(quotaExceeded && quota ? { quota_exceeded: true, quota } : {}),
    ...(result.accession_lookup ? { accession_lookup: result.accession_lookup } : {}),
    ...(result.groups ? { groups: result.groups } : {}),
    ...(result.candidate_accessions ? { candidate_accessions: result.candidate_accessions } : {}),
    ms: Date.now() - started,
  };
  return { ok: true, body, headers, quota };
}
