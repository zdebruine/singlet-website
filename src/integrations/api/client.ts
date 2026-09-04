/**
 * Typed fetch wrapper for the Cloudflare Pages Functions API.
 *
 * Base URL: VITE_API_BASE env var (defaults to "" so relative URLs work
 * both on Pages (same origin) and during local dev with wrangler).
 */
import type {
  CorpusStats,
  Facets,
  GseDetailResponse,
  GseListParams,
  GsmDetailResponse,
  GsmListParams,
  PagedResponse,
  GseRow,
  GsmRow,
  SearchResponse,
  NlSearchResponse,
} from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(BASE + path, window.location.href);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const apiClient = {
  /** GET /api/stats — corpus-wide statistics */
  stats(): Promise<CorpusStats> {
    return get<CorpusStats>("/api/stats");
  },

  /** GET /api/facets — distinct filter option values */
  facets(): Promise<Facets> {
    return get<Facets>("/api/facets");
  },

  /** GET /api/gse — paginated series list */
  gseList(params: GseListParams = {}): Promise<PagedResponse<GseRow>> {
    return get<PagedResponse<GseRow>>("/api/gse", {
      ...params,
      asc: params.asc !== undefined ? (params.asc ? 1 : 0) : undefined,
    } as Record<string, string | number | boolean | undefined>);
  },

  /** GET /api/gse/:id — series detail with samples + publications */
  gse(id: string): Promise<GseDetailResponse> {
    return get<GseDetailResponse>(`/api/gse/${encodeURIComponent(id)}`);
  },

  /** GET /api/gsm — paginated sample list */
  gsmList(params: GsmListParams = {}): Promise<PagedResponse<GsmRow>> {
    return get<PagedResponse<GsmRow>>("/api/gsm", {
      ...params,
      asc: params.asc !== undefined ? (params.asc ? 1 : 0) : undefined,
    } as Record<string, string | number | boolean | undefined>);
  },

  /** GET /api/gsm/:id — sample detail with parent series + siblings */
  gsm(id: string): Promise<GsmDetailResponse> {
    return get<GsmDetailResponse>(`/api/gsm/${encodeURIComponent(id)}`);
  },

  /** GET /api/search?q=... — cross-entity FTS search */
  search(q: string): Promise<SearchResponse> {
    return get<SearchResponse>("/api/search", { q });
  },

  /**
   * GET /api/nl-search?q=... — natural-language ("AI") search.
   * Turns plain English into structured filters server-side (the
   * interpret-search-query edge function) and returns matching samples/series.
   * Degrades to keyword search when interpretation is unavailable.
   */
  nlSearch(
    q: string,
    opts: { level?: "gsm" | "gse"; limit?: number } = {}
  ): Promise<NlSearchResponse> {
    return get<NlSearchResponse>("/api/nl-search", {
      q,
      level: opts.level,
      limit: opts.limit,
    });
  },
};
