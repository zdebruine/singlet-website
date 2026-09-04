/**
 * Typed fetch wrapper for the catalog API (Cloudflare Pages Functions).
 *
 * Base URL resolution:
 *   1. VITE_API_BASE when set.
 *   2. "" (same origin) on singlet.bio and during local dev, where the Vite
 *      proxy forwards /api to the live catalog.
 *   3. https://singlet.bio everywhere else (preview hosts have no /api).
 */
import type {
  CorpusStats,
  FacetsResponse,
  GseDetailResponse,
  GsmDetailResponse,
  NlSearchResponse,
  SearchQuery,
  SearchResponse,
  StudyRow,
  SampleRow,
} from "./types";

const PUBLIC_API = "https://singlet.bio";

function resolveBase(): string {
  const env = import.meta.env.VITE_API_BASE as string | undefined;
  if (env !== undefined && env !== "") return env.replace(/\/$/, "");
  if (typeof window === "undefined") return PUBLIC_API;
  const host = window.location.hostname;
  const firstParty = host === "singlet.bio" || host.endsWith(".singlet.bio") || host === "localhost" || host === "127.0.0.1";
  return firstParty ? "" : PUBLIC_API;
}

export const API_BASE = resolveBase();

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

async function get<T>(path: string, params?: Record<string, ParamValue>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(buildApiUrl(path, params), { signal });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(`API ${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}

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
  stats(): Promise<CorpusStats> {
    return get<CorpusStats>("/api/stats");
  },

  /** GET /api/facets — contextual counts for the current filter set. */
  facets(q: SearchQuery = {}, signal?: AbortSignal): Promise<FacetsResponse> {
    const { page: _p, limit: _l, sort: _s, ...rest } = searchParams(q);
    return get<FacetsResponse>("/api/facets", rest, signal);
  },

  /** GET /api/search — structured + keyword search (AND across groups). */
  search<T = StudyRow | SampleRow>(q: SearchQuery, signal?: AbortSignal): Promise<SearchResponse<T>> {
    return get<SearchResponse<T>>("/api/search", searchParams(q), signal);
  },

  /** GET /api/nl-search — plain-English search with interpretation + suggestions. */
  nlSearch<T = StudyRow | SampleRow>(q: SearchQuery & { q: string }, signal?: AbortSignal): Promise<NlSearchResponse<T>> {
    return get<NlSearchResponse<T>>("/api/nl-search", searchParams(q), signal);
  },

  /** URL for the accession export (text/plain, ≤ 5,000 studies). */
  exportAccessionsUrl(q: SearchQuery): string {
    return buildApiUrl("/api/search", { ...searchParams(q), level: "gse", format: "accessions", page: undefined, limit: undefined });
  },

  /** GET /api/gse/:id — study detail with samples, conditions, publications. */
  gse(id: string): Promise<GseDetailResponse> {
    return get<GseDetailResponse>(`/api/gse/${encodeURIComponent(id)}`);
  },

  /** GET /api/gsm/:id — sample detail with parent study + siblings. */
  gsm(id: string): Promise<GsmDetailResponse> {
    return get<GsmDetailResponse>(`/api/gsm/${encodeURIComponent(id)}`);
  },
};

/** Public download URL for a study bundle. */
export function bundleUrl(gseId: string): string {
  return `https://data.singlet.bio/data/${gseId}/${gseId}.singlet`;
}
