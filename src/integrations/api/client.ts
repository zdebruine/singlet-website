/**
 * Typed fetch wrapper for the catalog API (Cloudflare Pages Functions).
 *
 * Base URL resolution:
 *   1. VITE_API_BASE when set.
 *   2. "" (same origin) everywhere the app is served by Cloudflare Pages —
 *      singlet.bio, every *.pages.dev preview — and during local dev, where the
 *      Vite proxy forwards /api to the live catalog.
 *   3. https://singlet.bio ONLY on hosts that have no Pages Functions at all
 *      (the Lovable editor previews). A wrong guess here is what made the
 *      preview render production's old response shapes, so the fallback list
 *      is deliberately narrow.
 *
 * Every response goes through a normaliser that fills in defaults for
 * missing fields (arrays → [], counts → 0), so a partial or older-shaped
 * payload degrades to an empty section instead of a crash.
 */
import type {
  ApiKeyCreated,
  ApiKeySummary,
  Condition,
  CorpusStats,
  ExplainResponse,
  FacetsResponse,
  GseDetailResponse,
  GsmDetailResponse,
  GsmRow,
  NlSearchQuery,
  NlSearchResponse,
  QuotaInfo,
  SampleRow,
  SearchQuery,
  SearchResponse,
  StudyRow,
} from "./types";
import { authToken } from "@/lib/auth-token";
import { aiQuotaStore, parseQuota } from "@/lib/ai-quota";

const PUBLIC_API = "https://singlet.bio";

/** Hosts that serve the static bundle without the Pages Functions. */
const NO_FUNCTIONS_HOSTS = [/(^|\.)lovable\.app$/, /(^|\.)lovableproject\.com$/, /(^|\.)lovable\.dev$/];

export function resolveBase(hostname?: string): string {
  const env = import.meta.env.VITE_API_BASE as string | undefined;
  if (env !== undefined && env !== "") return env.replace(/\/$/, "");
  const host = hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  if (!host) return PUBLIC_API;
  return NO_FUNCTIONS_HOSTS.some((re) => re.test(host)) ? PUBLIC_API : "";
}

export const API_BASE = resolveBase();

/**
 * Lovable Cloud functions called directly from the browser (signed-in AI
 * features). The publishable key is client-safe by design; the values below
 * match the generated .env and are only a fallback for builds without it.
 */
const CLOUD_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://vbswbitfyallghbgxkuw.supabase.co").replace(/\/$/, "");
const CLOUD_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZic3diaXRmeWFsbGdoYmd4a3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjkzNDksImV4cCI6MjA5MDIwNTM0OX0.GtX_3p0L78p0KqmgNY71ENagf-lugz5FhvhYrtKqLhs";

/** Header the catalog API uses to return the visitor's remaining AI-search budget. */
const QUOTA_HEADER = "X-Singlet-Quota";

type ParamValue = string | number | boolean | string[] | undefined | null;

/** Build a URL with repeatable array params (`organism=a&organism=b`). */
export function buildApiUrl(path: string, params?: Record<string, ParamValue>): string {
  const url = new URL(API_BASE + path, typeof window !== "undefined" ? window.location.href : PUBLIC_API);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) {
        for (const item of v) if (item !== "") url.searchParams.append(k, item);
      } else if (typeof v === "boolean") {
        url.searchParams.set(k, v ? "1" : "0");
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

/** Error carrying the HTTP status so pages can distinguish 404 / 429 / 5xx. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "ApiError");
}

async function readJson(res: Response): Promise<unknown> {
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    let body: unknown;
    try {
      body = await res.json();
      const b = body as { error?: unknown; message?: unknown } | null;
      if (typeof b?.message === "string" && b.message) message = b.message;
      else if (typeof b?.error === "string" && b.error) message = b.error;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message, body);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "The catalog returned an unreadable response.");
  }
  if (json === null || typeof json !== "object") {
    throw new ApiError(res.status, "The catalog returned an unexpected response.");
  }
  return json;
}

interface GetOptions {
  signal?: AbortSignal;
  /** Send the signed-in visitor's token (only the AI endpoints care). */
  withAuth?: boolean;
}

async function getWithHeaders<T>(path: string, params?: Record<string, ParamValue>, opts: GetOptions = {}): Promise<{ json: T; headers: Headers }> {
  const headers: Record<string, string> = {};
  const token = opts.withAuth ? authToken.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(buildApiUrl(path, params), { signal: opts.signal, headers });
  return { json: (await readJson(res)) as T, headers: res.headers };
}

async function get<T>(path: string, params?: Record<string, ParamValue>, signal?: AbortSignal): Promise<T> {
  return (await getWithHeaders<T>(path, params, { signal })).json;
}

// ── Normalisers ─────────────────────────────────────────────────────────────

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strArr = (v: unknown): string[] => arr<unknown>(v).filter((x): x is string => typeof x === "string");
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strRecord = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(rec(v))) if (typeof val === "string") out[k] = val;
  return out;
};

function normalizeCondition(v: unknown): Condition | null {
  const c = rec(v);
  if (typeof c.key !== "string") return null;
  return { key: c.key, values: strArr(c.values), counts: arr<unknown>(c.counts).map((n) => num(n)) };
}

function normalizeConditions(v: unknown): Condition[] {
  return arr<unknown>(v).map(normalizeCondition).filter((c): c is Condition => c !== null);
}

function normalizeFacetOptions(v: unknown) {
  return arr<unknown>(v)
    .map((o) => rec(o))
    .filter((o) => typeof o.value === "string")
    .map((o) => ({ value: o.value as string, count: num(o.count), label: typeof o.label === "string" ? o.label : undefined }));
}

const EMPTY_APPLIED = (): FacetsResponse["applied"] => ({
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
});

function normalizeApplied(v: unknown): FacetsResponse["applied"] {
  const a = rec(v);
  return {
    q: str(a.q),
    organism: strArr(a.organism),
    tissue_group: strArr(a.tissue_group),
    disease_group: strArr(a.disease_group),
    assay_family: strArr(a.assay_family),
    cell_type: strArr(a.cell_type),
    min_cells: numOrNull(a.min_cells),
    has_bundle: typeof a.has_bundle === "boolean" ? a.has_bundle : null,
    year_min: numOrNull(a.year_min),
    year_max: numOrNull(a.year_max),
  };
}

function normalizeDropped(v: unknown) {
  return arr<unknown>(v)
    .map((d) => rec(d))
    .filter((d) => typeof d.field === "string" && typeof d.value === "string")
    .map((d) => ({ field: d.field as string, value: d.value as string }));
}

export function normalizeFacets(raw: unknown, fallbackLevel: "gse" | "gsm" = "gse"): FacetsResponse {
  const r = rec(raw);
  const vocab = rec(r.vocab);
  return {
    level: r.level === "gsm" ? "gsm" : r.level === "gse" ? "gse" : fallbackLevel,
    organism: normalizeFacetOptions(r.organism),
    tissue_group: normalizeFacetOptions(r.tissue_group),
    disease_group: normalizeFacetOptions(r.disease_group),
    assay_family: normalizeFacetOptions(r.assay_family),
    cell_type: normalizeFacetOptions(r.cell_type),
    year: normalizeFacetOptions(r.year),
    vocab: {
      tissue_group: strArr(vocab.tissue_group),
      disease_group: strArr(vocab.disease_group),
      assay_family: strArr(vocab.assay_family),
    },
    total: num(r.total),
    applied: r.applied ? normalizeApplied(r.applied) : EMPTY_APPLIED(),
    dropped: normalizeDropped(r.dropped),
  };
}

export function normalizeStudyRow(raw: unknown): StudyRow | null {
  const r = rec(raw);
  if (typeof r.gse_id !== "string") return null;
  const match = rec(r.match);
  return {
    gse_id: r.gse_id,
    title: strOrNull(r.title),
    abstract: strOrNull(r.abstract),
    organism_primary: strOrNull(r.organism_primary),
    organism_label: str(r.organism_label, strOrNull(r.organism_primary) ?? ""),
    organisms: strArr(r.organisms),
    tissue_groups: strArr(r.tissue_groups),
    disease_groups: strArr(r.disease_groups),
    assay_families: strArr(r.assay_families),
    tissues_raw: strArr(r.tissues_raw),
    cell_types_raw: strArr(r.cell_types_raw),
    n_done: num(r.n_done),
    n_total: num(r.n_total),
    n_failed: num(r.n_failed),
    n_cells: num(r.n_cells),
    suspect_cells: r.suspect_cells === true,
    has_bundle: r.has_bundle === true || r.has_bundle === 1,
    bundle_bytes: numOrNull(r.bundle_bytes),
    bundle_key: strOrNull(r.bundle_key),
    year: numOrNull(r.year),
    n_conditions: num(r.n_conditions),
    conditions: normalizeConditions(r.conditions),
    conditions_label: str(r.conditions_label),
    match: {
      filters: arr<StudyRow["match"]["filters"][number]>(match.filters).filter((m) => m && typeof m.field === "string"),
      text: arr<StudyRow["match"]["text"][number]>(match.text).filter((m) => m && typeof m.term === "string"),
    },
    why: str(r.why),
    score: numOrNull(r.score),
  };
}

export function normalizeSampleRow(raw: unknown): SampleRow | null {
  const r = rec(raw);
  if (typeof r.gsm_id !== "string") return null;
  return {
    gsm_id: r.gsm_id,
    gse_id: str(r.gse_id),
    study_title: strOrNull(r.study_title),
    organism: strOrNull(r.organism),
    organism_primary: strOrNull(r.organism_primary),
    organism_label: str(r.organism_label, strOrNull(r.organism) ?? ""),
    protocol: strOrNull(r.protocol),
    assay_family: strOrNull(r.assay_family),
    tissue: strOrNull(r.tissue),
    tissue_group: strOrNull(r.tissue_group),
    cell_type: strOrNull(r.cell_type),
    disease: strOrNull(r.disease),
    disease_group: strOrNull(r.disease_group),
    sex: strOrNull(r.sex),
    n_cells: numOrNull(r.n_cells),
    suspect_cells: r.suspect_cells === true,
    status: str(r.status, "unknown"),
    status_code: str(r.status_code, str(r.status)),
    failure_category: strOrNull(r.failure_category),
    title: strOrNull(r.title),
    source: strOrNull(r.source),
    characteristics: strRecord(r.characteristics),
    has_bundle: r.has_bundle === true || r.has_bundle === 1,
    year: numOrNull(r.year),
    score: numOrNull(r.score),
  };
}

function normalizeSearch<T>(raw: unknown, level: "gse" | "gsm"): SearchResponse<T> {
  const r = rec(raw);
  const lvl: "gse" | "gsm" = r.level === "gsm" ? "gsm" : r.level === "gse" ? "gse" : level;
  const rows = arr<unknown>(r.data)
    .map((row) => (lvl === "gsm" ? normalizeSampleRow(row) : normalizeStudyRow(row)))
    .filter((row): row is StudyRow | SampleRow => row !== null) as unknown as T[];
  const totals = rec(r.totals);
  return {
    level: lvl,
    total: num(r.total, rows.length),
    totals: { studies: numOrNull(totals.studies), samples: numOrNull(totals.samples), cells: numOrNull(totals.cells) },
    page: num(r.page, 1),
    limit: num(r.limit, rows.length),
    data: rows,
    accessions: strArr(r.accessions),
    applied: r.applied ? normalizeApplied(r.applied) : EMPTY_APPLIED(),
    dropped: normalizeDropped(r.dropped),
    accession_lookup: r.accession_lookup ? strArr(r.accession_lookup) : undefined,
    any_word: r.any_word === true ? true : undefined,
    note: typeof r.note === "string" ? r.note : undefined,
  };
}

function normalizeNlSearch<T>(raw: unknown, level: "gse" | "gsm"): NlSearchResponse<T> {
  const r = rec(raw);
  const base = normalizeSearch<T>(raw, level);
  const i = r.interpreted ? rec(r.interpreted) : null;
  return {
    ...base,
    configured: r.configured === true,
    interpreted: i
      ? {
          organism: strArr(i.organism),
          tissue_group: strArr(i.tissue_group),
          disease_group: strArr(i.disease_group),
          assay_family: strArr(i.assay_family),
          cell_type: strArr(i.cell_type),
          min_cells: numOrNull(i.min_cells),
          year_min: numOrNull(i.year_min),
          year_max: numOrNull(i.year_max),
          q: strArr(i.q),
        }
      : null,
    suggestions: arr<NlSearchResponse["suggestions"][number]>(r.suggestions).filter((s) => s && typeof s.params === "string"),
    why: strRecord(r.why),
    model: typeof r.model === "string" ? r.model : undefined,
    quota_exceeded: r.quota_exceeded === true ? true : undefined,
    quota: parseQuota(r.quota) ?? undefined,
  };
}

function normalizeSample(raw: unknown): GsmRow | null {
  const r = rec(raw);
  if (typeof r.gsm_id !== "string") return null;
  const chars = r.characteristics;
  return {
    ...(r as unknown as GsmRow),
    gsm_id: r.gsm_id,
    gse_id: str(r.gse_id),
    organism: strOrNull(r.organism),
    protocol: strOrNull(r.protocol),
    modality: strOrNull(r.modality),
    tissue: strOrNull(r.tissue),
    cell_type: strOrNull(r.cell_type),
    donor_id: strOrNull(r.donor_id),
    disease: strOrNull(r.disease),
    sex: strOrNull(r.sex),
    n_cells: numOrNull(r.n_cells),
    mapping_rate: numOrNull(r.mapping_rate),
    median_genes: numOrNull(r.median_genes),
    median_umis: numOrNull(r.median_umis),
    mt_pct: numOrNull(r.mt_pct),
    status: str(r.status, "UNKNOWN"),
    failure_category: strOrNull(r.failure_category),
    singlet_version: strOrNull(r.singlet_version),
    pipeline_date: strOrNull(r.pipeline_date),
    pz_size_bytes: numOrNull(r.pz_size_bytes),
    title: strOrNull(r.title),
    source: strOrNull(r.source),
    srr_ids: strArr(r.srr_ids),
    characteristics: chars !== null && typeof chars === "object" && !Array.isArray(chars) ? strRecord(chars) : null,
    characteristics_raw: typeof chars === "string" ? chars : strOrNull(r.characteristics_raw),
    last_updated: str(r.last_updated),
  };
}

export function normalizeGseDetail(raw: unknown): GseDetailResponse {
  const r = rec(raw);
  const s = rec(r.series);
  if (typeof s.id !== "string") throw new ApiError(502, "The catalog returned a study without an accession.");
  const m = r.meta ? rec(r.meta) : null;
  const samples = arr<unknown>(r.samples).map(normalizeSample).filter((x): x is GsmRow => x !== null);
  return {
    series: {
      id: s.id,
      title: strOrNull(s.title),
      abstract: strOrNull(s.abstract),
      organism: strOrNull(s.organism),
      n_gsm_total: num(s.n_gsm_total, samples.length),
      n_gsm_done: num(s.n_gsm_done),
      n_gsm_failed: num(s.n_gsm_failed),
      n_cells: num(s.n_cells),
      pubmed_ids: strArr(s.pubmed_ids),
      bundle_key: strOrNull(s.bundle_key) ?? strOrNull(s.r2_bundle_key),
      bundle_bytes: numOrNull(s.bundle_bytes) ?? numOrNull(s.r2_bundle_bytes),
      bundle_url: strOrNull(s.bundle_url) ?? (strOrNull(s.bundle_key) ?? strOrNull(s.r2_bundle_key) ? bundleUrl(s.id) : null),
      submitted_date: strOrNull(s.submitted_date),
      last_updated: str(s.last_updated),
      organism_label: typeof s.organism_label === "string" ? s.organism_label : undefined,
    },
    meta: m
      ? {
          organism_primary: strOrNull(m.organism_primary),
          organism_label: str(m.organism_label),
          organisms: strArr(m.organisms),
          tissue_groups: strArr(m.tissue_groups),
          disease_groups: strArr(m.disease_groups),
          assay_families: strArr(m.assay_families),
          tissues_raw: strArr(m.tissues_raw),
          cell_types_raw: strArr(m.cell_types_raw),
          n_done: num(m.n_done),
          n_total: num(m.n_total),
          n_cells: num(m.n_cells),
          has_bundle: m.has_bundle === true || m.has_bundle === 1,
          year: numOrNull(m.year),
        }
      : null,
    samples,
    conditions: normalizeConditions(r.conditions),
    conditions_label: str(r.conditions_label),
    publications: arr<unknown>(r.publications)
      .map((p) => rec(p))
      .filter((p) => typeof p.pmid === "string" || typeof p.pmid === "number")
      .map((p) => ({
        pmid: String(p.pmid),
        title: strOrNull(p.title),
        doi: strOrNull(p.doi),
        abstract: strOrNull(p.abstract),
        year: numOrNull(p.year),
        journal: strOrNull(p.journal),
      })),
  };
}

function normalizeGsmDetail(raw: unknown): GsmDetailResponse {
  const r = rec(raw);
  const sample = normalizeSample(r.sample);
  if (!sample) throw new ApiError(502, "The catalog returned a sample without an accession.");
  const s = r.series ? rec(r.series) : null;
  return {
    sample,
    series:
      s && typeof s.id === "string"
        ? {
            id: s.id,
            title: strOrNull(s.title),
            organism: strOrNull(s.organism),
            n_gsm_total: num(s.n_gsm_total),
            n_gsm_done: num(s.n_gsm_done),
            n_gsm_failed: num(s.n_gsm_failed),
            n_cells: num(s.n_cells),
            submitted_date: strOrNull(s.submitted_date),
          }
        : null,
    siblings: arr<unknown>(r.siblings)
      .map((x) => rec(x))
      .filter((x) => typeof x.gsm_id === "string")
      .map((x) => ({ gsm_id: x.gsm_id as string, status: str(x.status), n_cells: numOrNull(x.n_cells), title: strOrNull(x.title) })),
  };
}

function normalizeApiKey(raw: unknown): ApiKeySummary | null {
  const r = rec(raw);
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    name: str(r.name, "Untitled key"),
    key_prefix: str(r.key_prefix),
    created_at: str(r.created_at),
    last_used_at: strOrNull(r.last_used_at),
    expires_at: strOrNull(r.expires_at),
    revoked_at: strOrNull(r.revoked_at),
  };
}

/** POST a JSON body to a Lovable Cloud function as the signed-in visitor. */
async function cloudPost(fn: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const token = authToken.get();
  if (!token) throw new ApiError(401, "Sign in to manage API keys.");
  const res = await fetch(`${CLOUD_URL}/functions/v1/${fn}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", apikey: CLOUD_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return readJson(res);
}

function normalizeStats(raw: unknown): CorpusStats {
  const r = rec(raw);
  return {
    total_samples: num(r.total_samples),
    success_samples: num(r.success_samples),
    total_cells: num(r.total_cells),
    species_count: num(r.species_count),
    series_count: num(r.series_count),
    avg_mapping_rate: numOrNull(r.avg_mapping_rate),
    avg_median_genes: numOrNull(r.avg_median_genes),
    success_rate: numOrNull(r.success_rate),
    failure_categories: normalizeFacetOptions(r.failure_categories),
  };
}

// ── Query params ────────────────────────────────────────────────────────────

function searchParams(q: SearchQuery): Record<string, ParamValue> {
  return {
    q: q.q,
    level: q.level,
    organism: q.organism,
    tissue_group: q.tissue_group,
    disease_group: q.disease_group,
    assay_family: q.assay_family,
    cell_type: q.cell_type,
    min_cells: q.min_cells,
    has_bundle: q.has_bundle,
    year_min: q.year_min,
    year_max: q.year_max,
    sort: q.sort,
    page: q.page,
    limit: q.limit,
  };
}

export const apiClient = {
  /** GET /api/stats — corpus-wide statistics (edge-cached). */
  async stats(): Promise<CorpusStats> {
    return normalizeStats(await get<unknown>("/api/stats"));
  },

  /** GET /api/facets — contextual counts for the current filter set. */
  async facets(q: SearchQuery = {}, signal?: AbortSignal): Promise<FacetsResponse> {
    const { page: _p, limit: _l, sort: _s, ...rest } = searchParams(q);
    return normalizeFacets(await get<unknown>("/api/facets", rest, signal), q.level ?? "gse");
  },

  /** GET /api/search — structured + keyword search (AND across groups). */
  async search<T = StudyRow | SampleRow>(q: SearchQuery, signal?: AbortSignal): Promise<SearchResponse<T>> {
    return normalizeSearch<T>(await get<unknown>("/api/search", searchParams(q), signal), q.level ?? "gse");
  },

  /**
   * GET /api/nl-search — the site's one search. Plain English, keywords and
   * accessions all go here; `interpret: false` re-runs an edited search with
   * the visitor's own filters and no model call.
   */
  async nlSearch<T = StudyRow | SampleRow>(q: NlSearchQuery, signal?: AbortSignal): Promise<NlSearchResponse<T>> {
    const params = { ...searchParams(q), ...(q.interpret === false ? { interpret: "0" } : {}) };
    const { json, headers } = await getWithHeaders<unknown>("/api/nl-search", params, { signal, withAuth: true });
    const out = normalizeNlSearch<T>(json, q.level ?? "gse");
    // The budget rides in a per-request header on fresh AI answers, and in the
    // body when it has just run out. Cached answers carry neither.
    const quota = parseQuota(headers.get(QUOTA_HEADER)) ?? (out.quota_exceeded ? (out.quota ?? null) : null);
    if (quota) aiQuotaStore.set("search", quota);
    return out;
  },

  /**
   * POST explain-results (Lovable Cloud) — signed-in only. One sentence per
   * study on why it does or doesn't answer `q`, grounded in the metadata sent.
   * ≤ 10 studies per call; already-explained pairs come back from cache free.
   */
  async explain(q: string, studies: StudyRow[], signal?: AbortSignal): Promise<ExplainResponse> {
    const token = authToken.get();
    if (!token) throw new ApiError(401, "Sign in (free) to get AI explanations.");
    const res = await fetch(`${CLOUD_URL}/functions/v1/explain-results`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", apikey: CLOUD_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        q,
        studies: studies.slice(0, 10).map((s) => ({
          gse_id: s.gse_id,
          title: s.title ?? "",
          abstract: s.abstract ?? "",
          organism_label: s.organism_label,
          tissue_groups: s.tissue_groups,
          disease_groups: s.disease_groups,
          cell_types_raw: s.cell_types_raw.slice(0, 15),
          conditions_label: s.conditions_label,
          n_cells: s.n_cells,
          year: s.year,
        })),
      }),
    });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const r = rec(body);
    const quota = parseQuota(r.quota);
    if (quota) aiQuotaStore.set("explain", quota);
    if (!res.ok) {
      const message = typeof r.message === "string" ? r.message : typeof r.error === "string" ? r.error : `HTTP ${res.status}`;
      throw new ApiError(res.status, message, body);
    }
    return {
      explanations: strRecord(r.explanations),
      cached: num(r.cached),
      generated: num(r.generated),
      quota: quota ?? undefined,
      model: typeof r.model === "string" ? r.model : undefined,
    };
  },

  /** API keys for scripts and the MCP server — signed-in only; writes happen in one Cloud function. */
  apiKeys: {
    async list(): Promise<ApiKeySummary[]> {
      const r = rec(await cloudPost("api-keys", { action: "list" }));
      return arr<unknown>(r.keys).map(normalizeApiKey).filter((k): k is ApiKeySummary => k !== null);
    },
    async create(name: string, expiresInDays?: number | null): Promise<ApiKeyCreated> {
      const r = rec(await cloudPost("api-keys", { action: "create", name, expires_in_days: expiresInDays ?? null }));
      const key = normalizeApiKey(r.key);
      if (!key || typeof r.secret !== "string") throw new ApiError(502, "The key was created but could not be read back. Refresh the page.");
      return { key, secret: r.secret };
    },
    async revoke(id: string): Promise<void> {
      await cloudPost("api-keys", { action: "revoke", id });
    },
  },

  /** URL for the accession export (text/plain, ≤ 5,000 studies). */
  exportAccessionsUrl(q: SearchQuery): string {
    return buildApiUrl("/api/search", { ...searchParams(q), level: "gse", format: "accessions", page: undefined, limit: undefined });
  },

  /** GET /api/gse/:id — study detail with samples, conditions, publications. */
  async gse(id: string): Promise<GseDetailResponse> {
    return normalizeGseDetail(await get<unknown>(`/api/gse/${encodeURIComponent(id)}`));
  },

  /** GET /api/gsm/:id — sample detail with parent study + siblings. */
  async gsm(id: string): Promise<GsmDetailResponse> {
    return normalizeGsmDetail(await get<unknown>(`/api/gsm/${encodeURIComponent(id)}`));
  },
};

/** Public download URL for a study bundle. */
export function bundleUrl(gseId: string): string {
  return `https://data.singlet.bio/data/${gseId}/${gseId}.singlet`;
}
