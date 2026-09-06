/**
 * Natural-language search core, shared by /api/nl-search and the MCP server.
 *
 *   1. The query is interpreted by the Lovable Cloud function
 *      `interpret-search-query` (Gemini via the Lovable AI Gateway), grounded on
 *      the CANONICAL vocabulary — organism common names, tissue/disease/assay
 *      groups and the top raw cell types. Anything it returns as raw text is
 *      mapped through the same synonym rules that built the normalised columns.
 *   2. The resulting filters run through the shared search core with AND
 *      semantics. A zero result is NEVER broadened silently: instead
 *      `suggestions` lists what dropping each single filter would yield.
 *   3. `why` holds a deterministic one-line explanation per study, built from
 *      the structured `match` data — no second model call.
 *
 * Explicit filters (organism=…, tissue_group=…, …) are merged (union per
 * field) with the interpreted ones.
 *
 * Budgets: each *fresh* interpretation (not served from the 1 h interpretation
 * cache or the response cache) spends one unit of the caller's daily AI
 * budget — 10/day anonymous (salted IP hash), 200/day signed in or with a
 * personal API key (charged to the key's owner). The remaining budget comes
 * back in the `X-Singlet-Quota` header (never cached). When the budget is
 * spent the request still succeeds as a plain keyword search with
 * `quota_exceeded: true`, `quota` and a human `note`.
 */
import { cloudAnonKey, cloudBase, type CloudEnv } from "./cloud";
import { NO_CACHE_HEADER } from "./cache";
import { identityHeaders, QUOTA_HEADER } from "./identity";
import { loadRules, organismVocabForModel, TISSUE_GROUPS, DISEASE_GROUPS, ASSAY_FAMILIES, type VocabRule } from "./vocab";
import { cellTypeVocab } from "./facets-core";
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

export interface NlEnv extends CloudEnv {
  DB: D1Database;
}
const INTERPRET_FN = "interpret-search-query";
const INTERPRET_TIMEOUT_MS = 9000;
const INTERPRET_CACHE_TTL = 3600;
const INTERPRET_CACHE_URL = "https://singlet.bio/__internal/interpret";
const MAX_SUGGESTIONS = 5;

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

interface Suggestion {
  /** Remove this one filter (or `all_filters` = keep only the free text). */
  drop?: FilterMatch | { field: "all_filters"; value: string };
  /** Second tier, offered only when no single removal helps: keep just this filter. */
  keep?: FilterMatch;
  total: number;
  /** Canonical query-string fragment the UI can apply. */
  params: string;
}

const emptyInterpreted = (): Interpreted => ({
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

function coerceInterpreted(raw: unknown): Interpreted {
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

/** Remaining AI budget for the requesting visitor, as reported by the edge function. */
export interface Quota {
  kind: "anon" | "user";
  used: number;
  limit: number;
  resets_at: string;
  exceeded: boolean;
}

type InterpretOutcome =
  | { ok: true; interpreted: Interpreted; model?: string; quota?: Quota; cached: boolean }
  | { ok: false; reason: "quota"; quota: Quota; message: string }
  | { ok: false; reason: "invalid_key"; message: string }
  | { ok: false; reason: "busy" | "unavailable" };

const isQuota = (v: unknown): v is Quota =>
  !!v && typeof v === "object" && typeof (v as Quota).used === "number" && typeof (v as Quota).limit === "number";

/**
 * Call the edge function on the visitor's behalf. Interpretations are cached
 * 1 h per normalised query — a cache hit costs nobody any budget.
 */
async function interpret(env: NlEnv, ctx: Ctx, request: Request, query: string): Promise<InterpretOutcome> {
  const normQ = query.toLowerCase().replace(/\s+/g, " ").trim();
  const cacheKey = `${INTERPRET_CACHE_URL}?v=2&q=${encodeURIComponent(normQ)}`;
  let cache: Cache | null = null;
  try {
    cache = (caches as unknown as { default?: Cache }).default ?? null;
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) {
      const c = (await hit.json()) as { interpreted: Interpreted; model?: string };
      return { ok: true, interpreted: c.interpreted, model: c.model, cached: true };
    }
  } catch {
    /* ignore cache errors */
  }

  const base = cloudBase(env);
  const anon = cloudAnonKey(env);
  const [cellTypes, identity] = await Promise.all([
    cellTypeVocab(ctx, 200).catch(() => [] as string[]),
    identityHeaders(request, anon),
  ]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERPRET_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/functions/v1/${INTERPRET_FN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...identity },
      body: JSON.stringify({
        version: 2,
        q: query,
        vocab: {
          organism: organismVocabForModel(),
          tissue_group: TISSUE_GROUPS,
          disease_group: DISEASE_GROUPS,
          assay_family: ASSAY_FAMILIES,
          cell_type: cellTypes,
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 429) {
      const body = (await res.json().catch(() => ({}))) as { quota?: unknown; message?: string };
      if (isQuota(body.quota)) {
        return { ok: false, reason: "quota", quota: body.quota, message: body.message ?? "Today's free AI searches are used up." };
      }
      return { ok: false, reason: "busy" };
    }
    if (res.status === 401) {
      // Only an API key can be rejected here (sessions degrade to anonymous).
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (body.error === "invalid_api_key") {
        return { ok: false, reason: "invalid_key", message: body.message ?? "This API key is not valid." };
      }
      return { ok: false, reason: "unavailable" };
    }
    if (res.status === 503) return { ok: false, reason: "busy" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data = (await res.json()) as { interpreted?: unknown; model?: string; quota?: unknown };
    if (data.interpreted == null) return { ok: false, reason: "unavailable" };
    const stored = { interpreted: coerceInterpreted(data.interpreted), model: data.model };
    if (cache) {
      ctx.waitUntil(
        cache
          .put(
            cacheKey,
            new Response(JSON.stringify(stored), {
              headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${INTERPRET_CACHE_TTL}` },
            })
          )
          .catch(() => undefined)
      );
    }
    return { ok: true, ...stored, quota: isQuota(data.quota) ? data.quota : undefined, cached: false };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
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
  model?: string;
  any_word?: boolean;
  note?: string;
  quota_exceeded?: boolean;
  quota?: Quota;
  accession_lookup?: string[];
  hard_applied?: SearchFilters;
  groups?: { full: number; partial: number };
  ms?: number;
}

export type NlSearchOutcome =
  | { ok: true; body: NlSearchBody; headers: Record<string, string>; quota?: Quota }
  | { ok: false; status: number; error: string; message: string };

/**
 * Run a natural-language search. `url` carries the same parameters as
 * /api/search plus `q`; `request` supplies the caller's identity (session,
 * API key or anonymous) for budgeting.
 */
export async function nlSearch(
  env: NlEnv,
  request: Request,
  waitUntil: (p: Promise<unknown>) => void,
  url: URL
): Promise<NlSearchOutcome> {
  const started = Date.now();
  const explicit = parseSearchParams(url);
  const q = explicit.q;
  if (!q) return { ok: false, status: 400, error: "missing_query", message: "Missing query parameter 'q'" };
  const rules = await loadRules(env.DB, waitUntil);
  const ctx: Ctx = { db: env.DB, rules, waitUntil };

  // Accessions are an exact ask — no model needed. `interpret=0` is how the
  // site re-runs a search after the visitor edited the interpretation: the
  // filters are theirs now and `q` is plain keywords.
  const acc = extractAccessions(q);
  const isAccession = acc.gse.length > 0 || acc.gsm.length > 0;
  const skipModel = isAccession || url.searchParams.get("interpret") === "0";

  let interpreted: Interpreted | null = null;
  let model: string | undefined;
  let configured = true;
  let note: string | undefined;
  let quota: Quota | undefined;
  let quotaExceeded = false;
  // Degraded answers (interpreter down, budget spent) are visitor-specific
  // moments, not facts about the catalog — never let them into the edge cache.
  let cacheable = true;

  if (!skipModel) {
    const r = await interpret(env, ctx, request, q);
    if (r.ok) {
      interpreted = r.interpreted;
      model = r.model;
      quota = r.quota;
    } else if (r.reason === "quota") {
      quota = r.quota;
      quotaExceeded = true;
      cacheable = false;
      note = `${r.message} Meanwhile this is a plain keyword search.`;
    } else if (r.reason === "invalid_key") {
      return { ok: false, status: 401, error: "invalid_api_key", message: r.message };
    } else {
      configured = false;
      cacheable = false;
      note =
        r.reason === "busy"
          ? "AI search is busy right now, so this is a plain keyword search — try again in a minute."
          : "The query interpreter was unavailable, so this is a plain keyword search.";
    }
  }

  const merged = interpreted ? mergeFilters(explicit, interpreted, rules) : null;
  const normalized = merged ?? normalizeFilters(explicit, rules);
  const filters = normalized.filters;
  const dropped = normalized.dropped;
  // When the model returned nothing usable, fall back to the raw text.
  if (interpreted && !hasAnyFilter(filters) && !filters.q) filters.q = q;

  const result =
    filters.level === "gse"
      ? await runStudySearch(ctx, filters, { orFallback: !interpreted, soft: merged?.soft })
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
  if (quota && !quotaExceeded) headers[QUOTA_HEADER] = JSON.stringify(quota);
  if (!cacheable) headers[NO_CACHE_HEADER] = "1";

  const body: NlSearchBody = {
    configured,
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
    ms: Date.now() - started,
  };
  return { ok: true, body, headers, quota };
}
