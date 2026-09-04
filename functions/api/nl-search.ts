/**
 * GET /api/nl-search?q=<plain English>&level=gse|gsm&page=&limit=&sort=&has_bundle=
 * (POST { q, level, ... } is accepted too.)
 *
 * Natural-language search on top of /api/search:
 *   1. The query is interpreted by the Lovable Cloud edge function
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
 * Explicit filters in the query string (organism=…, tissue_group=…, …) are
 * merged (union per field) with the interpreted ones.
 *
 * Response:
 *   { configured, interpreted, applied, level, data, total, totals, page, limit,
 *     accessions, suggestions: [{drop:{field,value}, total}], why: {gse_id: string},
 *     model?, note? }
 *
 * `accessions` (flat GSE / GSM id list) is a stable contract consumed by the
 * Python and R packages.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson, CATALOG_CACHE_TTL } from "../_shared/cache";
import { loadRules, organismVocabForModel, TISSUE_GROUPS, DISEASE_GROUPS, ASSAY_FAMILIES, type VocabRule } from "../_shared/vocab";
import { cellTypeVocab } from "../_shared/facets-core";
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
  type StudyRow,
} from "../_shared/search-core";

interface Env {
  DB: D1Database;
  /** Optional overrides; sane public defaults are baked in below. */
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

/**
 * Lovable Cloud edge function that performs the AI interpretation step. The
 * anon key is public/client-safe by design, so it is inlined here — AI Search
 * must not depend on any secret entered manually in the Cloudflare dashboard.
 */
const DEFAULT_SUPABASE_URL = "https://vbswbitfyallghbgxkuw.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic3diaXRmeWFsbGdoYmd4a3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjkzNDksImV4cCI6MjA5MDIwNTM0OX0.GtX_3p0L78p0KqmgNY71ENagf-lugz5FhvhYrtKqLhs";
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

/** Call the edge function (cached 1h per normalised query). Null on any failure. */
async function interpret(env: Env, ctx: Ctx, query: string): Promise<{ interpreted: Interpreted; model?: string } | null> {
  const normQ = query.toLowerCase().replace(/\s+/g, " ").trim();
  const cacheKey = `${INTERPRET_CACHE_URL}?v=2&q=${encodeURIComponent(normQ)}`;
  let cache: Cache | null = null;
  try {
    cache = (caches as unknown as { default?: Cache }).default ?? null;
    const hit = cache ? await cache.match(cacheKey) : null;
    if (hit) return (await hit.json()) as { interpreted: Interpreted; model?: string };
  } catch {
    /* ignore cache errors */
  }

  const base = (env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const anon = env.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;
  const cellTypes = await cellTypeVocab(ctx, 200).catch(() => [] as string[]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERPRET_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/functions/v1/${INTERPRET_FN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
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
    if (!res.ok) return null;
    const data = (await res.json()) as { interpreted?: unknown; model?: string };
    if (data.interpreted == null) return null;
    const out = { interpreted: coerceInterpreted(data.interpreted), model: data.model };
    if (cache) {
      ctx.waitUntil(
        cache
          .put(
            cacheKey,
            new Response(JSON.stringify(out), {
              headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${INTERPRET_CACHE_TTL}` },
            })
          )
          .catch(() => undefined)
      );
    }
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Merge explicit URL filters with the interpretation (union per field). */
function mergeFilters(explicit: SearchParams, interp: Interpreted, rules: VocabRule[]): { filters: SearchParams; dropped: FilterMatch[] } {
  const merged: SearchParams = {
    ...explicit,
    q: interp.q.join(" "),
    organism: [...explicit.organism, ...interp.organism],
    tissue_group: [...explicit.tissue_group, ...interp.tissue_group],
    disease_group: [...explicit.disease_group, ...interp.disease_group],
    assay_family: [...explicit.assay_family, ...interp.assay_family],
    cell_type: [...explicit.cell_type, ...interp.cell_type],
    min_cells: explicit.min_cells ?? interp.min_cells,
    year_min: explicit.year_min ?? interp.year_min,
    year_max: explicit.year_max ?? interp.year_max,
  };
  const { filters, dropped } = normalizeFilters(merged, rules);
  // Values the vocabulary could not place are removed rather than left to match nothing —
  // the interpretation row shows them as "not recognised" instead.
  for (const d of dropped) {
    const key = d.field as keyof SearchFilters;
    const arr = filters[key];
    if (Array.isArray(arr)) (filters as unknown as Record<string, string[]>)[key] = arr.filter((v) => v !== d.value);
  }
  return { filters, dropped };
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

async function handle(env: Env, request: Request, waitUntil: (p: Promise<unknown>) => void, url: URL): Promise<Response> {
  const explicit = parseSearchParams(url);
  const q = explicit.q;
  if (!q) return corsErr("Missing query parameter 'q'", 400);
  const rules = await loadRules(env.DB, waitUntil);
  const ctx: Ctx = { db: env.DB, rules, waitUntil };

  // Accessions are an exact ask — no model needed.
  const acc = extractAccessions(q);
  const isAccession = acc.gse.length > 0 || acc.gsm.length > 0;

  let interpreted: Interpreted | null = null;
  let model: string | undefined;
  let configured = true;
  let note: string | undefined;

  if (!isAccession) {
    const r = await interpret(env, ctx, q);
    if (r) {
      interpreted = r.interpreted;
      model = r.model;
    } else {
      configured = false;
      note = "The query interpreter was unavailable, so this is a plain keyword search.";
    }
  }

  const { filters, dropped } = interpreted
    ? mergeFilters(explicit, interpreted, rules)
    : normalizeFilters(explicit, rules);
  // When the model returned nothing usable, fall back to the raw text.
  if (interpreted && !hasAnyFilter(filters) && !filters.q) filters.q = q;

  const result =
    filters.level === "gse"
      ? await runStudySearch(ctx, filters, { orFallback: !interpreted })
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

  return corsOk({
    configured,
    interpreted,
    applied: pickFilters(filters),
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
    ...(result.accession_lookup ? { accession_lookup: result.accession_lookup } : {}),
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const url = new URL(request.url);
  const key = canonicalQuery(parseSearchParams(url));
  return cachedJson(request, waitUntil, () => handle(env, request, waitUntil, url).catch((e) => corsErr(String(e))), {
    ttl: CATALOG_CACHE_TTL,
    key,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(request.url);
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
    return await handle(env, request, waitUntil, url);
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
