/**
 * useDatabase.ts — Cloudflare D1 edition (v0.9.0)
 *
 * All hooks keep identical exported names and return shapes so no JSX
 * in Browse.tsx / SampleDetail.tsx / SeriesDetail.tsx / Index.tsx needs
 * to change. The only difference is the data now comes from the
 * Pages Functions API (/api/*) backed by D1, not Supabase.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/integrations/api/client";
import type { GsmRow } from "@/integrations/api/types";

// Re-export GsmRow under the legacy Table alias so imports like
// legacy `Tables` type alias in existing
// components can be replaced without touching JSX.
export type { GsmRow };

// ── Shared types (public interface — unchanged from Supabase era) ─────────────

export interface CorpusStats {
  total_samples: number;
  success_samples: number;
  total_cells: number;
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
  success_rate: number | null;
}

export interface SpeciesStat {
  organism: string;
  sample_count: number;
  total_cells: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
}

export interface SampleFilters {
  organism?: string;
  protocol?: string;
  modality?: string;
  status?: string;
  search?: string;
  qualityTier?: "gold" | "silver" | "bronze" | "";
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortAsc?: boolean;
}

export interface StatusBreakdown {
  done: number;
  failed: number;
}

export interface FailureCategoryStat {
  category: string;
  count: number;
}

export interface ProtocolStat {
  protocol: string;
  total: number;
  success: number;
  rate: number;
}

export interface SpeciesSuccessStat {
  organism: string;
  total: number;
  success: number;
  rate: number;
}

export interface FeaturedSeries {
  gse_id: string;
  n_samples: number;
  total_cells: number;
  avg_mapping_rate: number;
  organism: string;
}

// ── Last Updated ─────────────────────────────────────────────────────────────

export function useLastUpdated() {
  return useQuery({
    queryKey: ["last-updated"],
    queryFn: async (): Promise<string | null> => {
      try {
        const stats = await apiClient.stats();
        // Fallback: pull from gsm list sorted by last_updated desc
        if (!stats) return null;
        // The meta_cache "last_updated" key is a separate entry; use gsmList as proxy
        const rows = await apiClient.gsmList({ sort: "last_updated", asc: false, page_size: 1 });
        return rows.data[0]?.last_updated ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 120_000,
  });
}

// ── Corpus Stats ──────────────────────────────────────────────────────────────

export function useCorpusStats() {
  return useQuery({
    queryKey: ["corpus-stats"],
    queryFn: async (): Promise<CorpusStats> => {
      const data = await apiClient.stats();
      return {
        total_samples: data.total_samples,
        success_samples: data.success_samples,
        total_cells: data.total_cells,
        species_count: data.species_count,
        series_count: data.series_count,
        avg_mapping_rate: data.avg_mapping_rate,
        avg_median_genes: data.avg_median_genes,
        success_rate: data.success_rate,
      };
    },
    staleTime: 60_000,
  });
}

// ── Species Stats ─────────────────────────────────────────────────────────────

export function useSpeciesStats() {
  return useQuery({
    queryKey: ["species-stats"],
    queryFn: async (): Promise<SpeciesStat[]> => {
      // Aggregate from gsm list — fetch DONE samples, group client-side
      // (This is acceptable at catalog scale; a future meta_cache key can cache it)
      const all: GsmRow[] = [];
      let page = 0;
      while (true) {
        const res = await apiClient.gsmList({ status: "DONE", page_size: 500, page });
        all.push(...res.data);
        if (all.length >= res.total || res.data.length < 500) break;
        page++;
      }
      const groups = new Map<string, { cells: number; mr: number[]; mg: number[]; n: number }>();
      for (const r of all) {
        const org = r.organism ?? "unknown";
        const g = groups.get(org) ?? { cells: 0, mr: [], mg: [], n: 0 };
        g.n += 1;
        g.cells += r.n_cells ?? 0;
        if (r.mapping_rate != null) g.mr.push(r.mapping_rate);
        if (r.median_genes != null) g.mg.push(r.median_genes);
        groups.set(org, g);
      }
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      return [...groups.entries()]
        .map(([organism, g]) => ({
          organism,
          sample_count: g.n,
          total_cells: g.cells,
          avg_mapping_rate: avg(g.mr),
          avg_median_genes: avg(g.mg),
        }))
        .sort((a, b) => b.total_cells - a.total_cells)
        .slice(0, 20);
    },
    staleTime: 60_000,
  });
}

// ── Samples (Browse) ──────────────────────────────────────────────────────────

export function useSamples(filters: SampleFilters = {}) {
  const {
    organism, protocol, modality, status, search, qualityTier,
    page = 0, pageSize = 50, sortBy = "pipeline_date", sortAsc = false,
  } = filters;

  // Map qualityTier to qc_flag param
  const qc_flag = qualityTier && qualityTier !== "" ? qualityTier : undefined;
  // Derive status override: any qualityTier implies a successfully processed sample
  const effectiveStatus = qualityTier ? "DONE" : status;

  return useQuery({
    queryKey: ["samples", filters],
    queryFn: async () => {
      const res = await apiClient.gsmList({
        organism,
        protocol,
        // D1 schema uses modality column — pass through
        ...(modality ? { modality } : {}),
        status: effectiveStatus,
        qc_flag,
        q: search,
        page,
        page_size: pageSize,
        sort: sortBy,
        asc: sortAsc,
      } as Parameters<typeof apiClient.gsmList>[0]);

      // Map API GsmRow to the shape Browse.tsx expects (compatible with old Tables<"samples">)
      const samples = res.data.map(r => ({
        ...r,
        // Legacy field aliases used by Browse.tsx
        gsm_id: r.gsm_id,
        gse_id: r.gse_id,
        cells_called: r.n_cells,          // Browse reads cells_called
        status: r.status,
        updated_at: r.last_updated,
      }));

      return { samples, total: res.total };
    },
    staleTime: 30_000,
  });
}

export function useSample(gsmId: string) {
  return useQuery({
    queryKey: ["sample", gsmId],
    queryFn: async () => {
      const res = await apiClient.gsm(gsmId);
      const s = res.sample;
      // Return shape compatible with old Tables<"samples"> usage in SampleDetail.tsx
      return {
        ...s,
        cells_called: s.n_cells,
        updated_at: s.last_updated,
        created_at: s.last_updated,
      };
    },
    enabled: !!gsmId,
  });
}

// ── Filter Options ────────────────────────────────────────────────────────────

export function useFilterOptions() {
  return useQuery({
    queryKey: ["filter-options"],
    queryFn: async () => {
      const facets = await apiClient.facets();
      return {
        organisms: facets.organisms,
        protocols: facets.protocols,
        modalities: ["scrna", "snrna", "multiome"], // not yet in facets endpoint
      };
    },
    staleTime: 300_000,
  });
}

// ── Status Breakdown ──────────────────────────────────────────────────────────

export function useStatusBreakdown() {
  return useQuery({
    queryKey: ["status-breakdown"],
    queryFn: async (): Promise<StatusBreakdown> => {
      const stats = await apiClient.stats();
      const total = stats.total_samples;
      const done = stats.success_samples;
      // Live D1 status is binary: DONE vs FAIL. Everything terminal that is
      // not DONE is a failure (with a documented failure_category).
      const terminal = stats.success_rate ? Math.round(done / stats.success_rate) : total;
      const failed = Math.max(terminal - done, 0);
      return {
        done,
        failed,
      };
    },
    staleTime: 60_000,
  });
}

// ── Failure Category Stats ────────────────────────────────────────────────────

export function useFailureCategoryStats() {
  return useQuery({
    queryKey: ["failure-category-stats"],
    queryFn: async (): Promise<FailureCategoryStat[]> => {
      // Fetch all failed samples (paginated) and group by failure_category
      const all: GsmRow[] = [];
      let page = 0;
      while (true) {
        const res = await apiClient.gsmList({ status: "FAIL", page_size: 500, page });
        all.push(...res.data);
        if (all.length >= res.total || res.data.length < 500) break;
        page++;
        if (page > 20) break; // safety cap
      }

      const counts = new Map<string, number>();
      for (const r of all) {
        const cat = r.failure_category ?? "uncategorized";
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 120_000,
  });
}

// ── Protocol Stats ────────────────────────────────────────────────────────────

export function useProtocolStats() {
  return useQuery({
    queryKey: ["protocol-stats"],
    queryFn: async (): Promise<ProtocolStat[]> => {
      const facets = await apiClient.facets();
      // Fetch totals per protocol via parallel requests
      const results = await Promise.all(
        facets.protocols.map(async (proto) => {
          const [total, success] = await Promise.all([
            apiClient.gsmList({ protocol: proto, page_size: 1 }),
            apiClient.gsmList({ protocol: proto, status: "DONE", page_size: 1 }),
          ]);
          return { protocol: proto, total: total.total, success: success.total, rate: total.total > 0 ? success.total / total.total : 0 };
        })
      );
      return results.filter(p => p.total >= 5).sort((a, b) => b.total - a.total);
    },
    staleTime: 120_000,
  });
}

// ── Species Success Stats ─────────────────────────────────────────────────────

export function useSpeciesSuccessStats() {
  return useQuery({
    queryKey: ["species-success-stats"],
    queryFn: async (): Promise<SpeciesSuccessStat[]> => {
      const facets = await apiClient.facets();
      const results = await Promise.all(
        facets.organisms.map(async (org) => {
          const [total, success] = await Promise.all([
            apiClient.gsmList({ organism: org, page_size: 1 }),
            apiClient.gsmList({ organism: org, status: "DONE", page_size: 1 }),
          ]);
          return { organism: org, total: total.total, success: success.total, rate: total.total > 0 ? success.total / total.total : 0 };
        })
      );
      return results.sort((a, b) => b.total - a.total);
    },
    staleTime: 120_000,
  });
}

// ── Featured Series ───────────────────────────────────────────────────────────

export function useFeaturedSeries() {
  return useQuery({
    queryKey: ["featured-series"],
    queryFn: async (): Promise<FeaturedSeries[]> => {
      const res = await apiClient.gseList({ sort: "n_cells", asc: false, page_size: 8 });
      return res.data
        .filter(s => s.n_gsm_done >= 3)
        .map(s => ({
          gse_id: s.id,
          n_samples: s.n_gsm_done,
          total_cells: s.n_cells,
          avg_mapping_rate: 0, // not stored at series level; would need aggregation
          organism: s.organism ?? "unknown",
        }));
    },
    staleTime: 300_000,
  });
}

// ── E2E Results (stub — no D1 table yet) ─────────────────────────────────────

export function useE2EResults(_panel?: string) {
  return useQuery({
    queryKey: ["e2e-results", _panel],
    queryFn: async () => [] as unknown[],
    staleTime: 60_000,
  });
}

// ── GPU Frontier (stub — no D1 table yet) ────────────────────────────────────

export function useGPUFrontier(_feature?: string) {
  return useQuery({
    queryKey: ["gpu-frontier", _feature],
    queryFn: async () => [] as unknown[],
    staleTime: 60_000,
  });
}
