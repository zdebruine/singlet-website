import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

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

// ─── Last Updated ────────────────────────────────────────────────────────────

export function useLastUpdated() {
  return useQuery({
    queryKey: ["last-updated"],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("samples")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();
      if (error) return null;
      return data?.updated_at ?? null;
    },
    staleTime: 120_000,
  });
}

// ─── Corpus Stats (computed from samples) ────────────────────────────────────

export function useCorpusStats() {
  return useQuery({
    queryKey: ["corpus-stats"],
    queryFn: async (): Promise<CorpusStats> => {
      // Use the server-side materialized view (avoids 1000-row default limit)
      const { data, error } = await supabase
        .from("corpus_stats")
        .select("*")
        .single();
      if (error) {
        // Fallback to client-side computation if view doesn't exist
        const { data: rows, error: fallbackError } = await supabase
          .from("samples")
          .select("status, cells_called, organism, gse_id, mapping_rate, median_genes")
          .limit(10000);
        if (fallbackError) throw fallbackError;
        const success = (rows ?? []).filter((r) => r.status === "SUCCESS");
        const terminal = (rows ?? []).filter((r) => ["SUCCESS", "SOFT_FAIL", "HARD_FAIL"].includes(r.status));
        const avg = (vals: (number | null)[]) => {
          const nums = vals.filter((v): v is number => v != null);
          return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        };
        return {
          total_samples: (rows ?? []).length,
          success_samples: success.length,
          total_cells: success.reduce((a, r) => a + (r.cells_called ?? 0), 0),
          species_count: new Set((rows ?? []).map((r) => r.organism)).size,
          series_count: new Set((rows ?? []).map((r) => r.gse_id)).size,
          avg_mapping_rate: avg(success.map((r) => r.mapping_rate)),
          avg_median_genes: avg(success.map((r) => r.median_genes)),
          success_rate: terminal.length ? success.length / terminal.length : null,
        };
      }
      return data as CorpusStats;
    },
    staleTime: 60_000,
  });
}

export function useSpeciesStats() {
  return useQuery({
    queryKey: ["species-stats"],
    queryFn: async (): Promise<SpeciesStat[]> => {
      // Use the server-side materialized view
      const { data, error } = await supabase
        .from("species_stats")
        .select("*")
        .order("total_cells", { ascending: false })
        .limit(20);
      if (error) {
        // Fallback to client-side computation
        const { data: rows, error: fallbackError } = await supabase
          .from("samples")
          .select("organism, cells_called, mapping_rate, median_genes")
          .eq("status", "SUCCESS")
          .limit(5000);
        if (fallbackError) throw fallbackError;
        const groups = new Map<string, { cells: number; mr: number[]; mg: number[]; n: number }>();
        for (const r of rows ?? []) {
          const g = groups.get(r.organism) ?? { cells: 0, mr: [], mg: [], n: 0 };
          g.n += 1;
          g.cells += r.cells_called ?? 0;
          if (r.mapping_rate != null) g.mr.push(r.mapping_rate);
          if (r.median_genes != null) g.mg.push(r.median_genes);
          groups.set(r.organism, g);
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
      }
      return (data ?? []).map((r) => ({
        organism: r.organism ?? "unknown",
        sample_count: r.sample_count ?? 0,
        total_cells: r.total_cells ?? 0,
        avg_mapping_rate: r.avg_mapping_rate,
        avg_median_genes: r.avg_median_genes,
      }));
    },
    staleTime: 60_000,
  });
}

// ─── Samples (Browse) ────────────────────────────────────────────────────────

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

export function useSamples(filters: SampleFilters = {}) {
  const { organism, protocol, modality, status, search, qualityTier, page = 0, pageSize = 50, sortBy = "pipeline_date", sortAsc = false } = filters;

  return useQuery({
    queryKey: ["samples", filters],
    queryFn: async () => {
      let query = supabase
        .from("samples")
        .select("*", { count: "exact" })
        .order(sortBy, { ascending: sortAsc })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (organism) query = query.eq("organism", organism);
      if (protocol) query = query.eq("protocol", protocol);
      if (modality) query = query.eq("modality", modality);
      if (status) query = query.eq("status", status);
      if (qualityTier) {
        query = query.eq("status", "SUCCESS");
        if (qualityTier === "gold") {
          query = query.gte("mapping_rate", 0.7).gte("median_genes", 500).gte("cells_called", 500);
        } else if (qualityTier === "silver") {
          query = query.gte("mapping_rate", 0.5).gte("median_genes", 200).gte("cells_called", 100);
        }
        // bronze = all SUCCESS (no extra filter needed beyond status=SUCCESS)
      }
      if (search) {
        // Sanitize search input to prevent PostgREST filter injection
        const sanitized = search.replace(/[%(),]/g, "");
        if (sanitized) {
          query = query.or(`gsm_id.ilike.%${sanitized}%,gse_id.ilike.%${sanitized}%,title.ilike.%${sanitized}%,source.ilike.%${sanitized}%,characteristics->>tissue.ilike.%${sanitized}%,characteristics->>cell type.ilike.%${sanitized}%`);
        }
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { samples: data as Tables<"samples">[], total: count ?? 0 };
    },
    staleTime: 30_000,
  });
}

export function useSample(gsmId: string) {
  return useQuery({
    queryKey: ["sample", gsmId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("samples")
        .select("*")
        .eq("gsm_id", gsmId)
        .single();
      if (error) throw error;
      return data as Tables<"samples">;
    },
    enabled: !!gsmId,
  });
}

// ─── Filter Options ──────────────────────────────────────────────────────────

export function useFilterOptions() {
  return useQuery({
    queryKey: ["filter-options"],
    queryFn: async () => {
      const [organisms, protocols, modalities] = await Promise.all([
        supabase.from("samples").select("organism").not("organism", "is", null).limit(5000),
        supabase.from("samples").select("protocol").not("protocol", "is", null).limit(5000),
        supabase.from("samples").select("modality").not("modality", "is", null).limit(5000),
      ]);

      const uniqueOrganisms = [...new Set((organisms.data ?? []).map((r) => r.organism))].filter(Boolean);
      const uniqueProtocols = [...new Set((protocols.data ?? []).map((r) => r.protocol))].filter(Boolean);
      const uniqueModalities = [...new Set((modalities.data ?? []).map((r) => r.modality))].filter(Boolean);

      return {
        organisms: uniqueOrganisms as string[],
        protocols: uniqueProtocols as string[],
        modalities: uniqueModalities as string[],
      };
    },
    staleTime: 300_000,
  });
}

// ─── Status Breakdown ────────────────────────────────────────────────────────

export interface StatusBreakdown {
  success: number;
  soft_fail: number;
  hard_fail: number;
}

export function useStatusBreakdown() {
  return useQuery({
    queryKey: ["status-breakdown"],
    queryFn: async (): Promise<StatusBreakdown> => {
      const [s, sf, hf] = await Promise.all([
        supabase.from("samples").select("gsm_id", { count: "exact", head: true }).eq("status", "SUCCESS"),
        supabase.from("samples").select("gsm_id", { count: "exact", head: true }).eq("status", "SOFT_FAIL"),
        supabase.from("samples").select("gsm_id", { count: "exact", head: true }).eq("status", "HARD_FAIL"),
      ]);
      return {
        success: s.count ?? 0,
        soft_fail: sf.count ?? 0,
        hard_fail: hf.count ?? 0,
      };
    },
    staleTime: 60_000,
  });
}

// ─── Failure Category Stats ──────────────────────────────────────────────────

export interface FailureCategoryStat {
  category: string;
  count: number;
}

export function useFailureCategoryStats() {
  return useQuery({
    queryKey: ["failure-category-stats"],
    queryFn: async (): Promise<FailureCategoryStat[]> => {
      // Fetch failure_category for all non-SUCCESS samples
      const all: { failure_category: string | null }[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("samples")
          .select("failure_category")
          .neq("status", "SUCCESS")
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }
      // Group by category
      const counts = new Map<string, number>();
      for (const row of all) {
        const cat = row.failure_category ?? "uncategorized";
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 120_000,
  });
}

// ─── Protocol Stats ──────────────────────────────────────────────────────────

export interface ProtocolStat {
  protocol: string;
  total: number;
  success: number;
  rate: number;
}

export function useProtocolStats() {
  return useQuery({
    queryKey: ["protocol-stats"],
    queryFn: async (): Promise<ProtocolStat[]> => {
      const all: { protocol: string | null; status: string }[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("samples")
          .select("protocol, status")
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }
      const groups = new Map<string, { total: number; success: number }>();
      for (const row of all) {
        const p = row.protocol || "unknown";
        const g = groups.get(p) ?? { total: 0, success: 0 };
        g.total += 1;
        if (row.status === "SUCCESS") g.success += 1;
        groups.set(p, g);
      }
      return [...groups.entries()]
        .map(([protocol, g]) => ({
          protocol,
          total: g.total,
          success: g.success,
          rate: g.total > 0 ? g.success / g.total : 0,
        }))
        .filter((p) => p.total >= 5) // Only show protocols with 5+ samples
        .sort((a, b) => b.total - a.total);
    },
    staleTime: 120_000,
  });
}

// ─── Species Success Stats ───────────────────────────────────────────────────

export interface SpeciesSuccessStat {
  organism: string;
  total: number;
  success: number;
  rate: number;
}

export function useSpeciesSuccessStats() {
  return useQuery({
    queryKey: ["species-success-stats"],
    queryFn: async (): Promise<SpeciesSuccessStat[]> => {
      const all: { organism: string | null; status: string }[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("samples")
          .select("organism, status")
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }
      const groups = new Map<string, { total: number; success: number }>();
      for (const row of all) {
        const org = row.organism || "unknown";
        const g = groups.get(org) ?? { total: 0, success: 0 };
        g.total += 1;
        if (row.status === "SUCCESS") g.success += 1;
        groups.set(org, g);
      }
      return [...groups.entries()]
        .map(([organism, g]) => ({
          organism,
          total: g.total,
          success: g.success,
          rate: g.total > 0 ? g.success / g.total : 0,
        }))
        .sort((a, b) => b.total - a.total);
    },
    staleTime: 120_000,
  });
}

// ─── Featured Series ─────────────────────────────────────────────────────────

export interface FeaturedSeries {
  gse_id: string;
  n_samples: number;
  total_cells: number;
  avg_mapping_rate: number;
  organism: string;
}

export function useFeaturedSeries() {
  return useQuery({
    queryKey: ["featured-series"],
    queryFn: async (): Promise<FeaturedSeries[]> => {
      const all: { gse_id: string | null; cells_called: number | null; mapping_rate: number | null; organism: string | null }[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("samples")
          .select("gse_id, cells_called, mapping_rate, organism")
          .eq("status", "SUCCESS")
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
      }
      const groups = new Map<string, { cells: number; mr_sum: number; count: number; organism: string }>();
      for (const row of all) {
        const gse = row.gse_id ?? "";
        if (!gse) continue;
        const g = groups.get(gse) ?? { cells: 0, mr_sum: 0, count: 0, organism: row.organism ?? "unknown" };
        g.cells += row.cells_called ?? 0;
        g.mr_sum += row.mapping_rate ?? 0;
        g.count += 1;
        groups.set(gse, g);
      }
      return [...groups.entries()]
        .filter(([, g]) => g.count >= 3)
        .map(([gse_id, g]) => ({
          gse_id,
          n_samples: g.count,
          total_cells: g.cells,
          avg_mapping_rate: g.mr_sum / g.count,
          organism: g.organism,
        }))
        .sort((a, b) => b.total_cells - a.total_cells)
        .slice(0, 8);
    },
    staleTime: 300_000,
  });
}

// ─── E2E Results ─────────────────────────────────────────────────────────────

export function useE2EResults(panel?: string) {
  return useQuery({
    queryKey: ["e2e-results", panel],
    queryFn: async () => {
      let query = supabase
        .from("e2e_results")
        .select("*")
        .order("run_date", { ascending: false });

      if (panel) query = query.eq("panel", panel);

      const { data, error } = await query;
      if (error) throw error;
      return data as Tables<"e2e_results">[];
    },
    staleTime: 60_000,
  });
}

// ─── GPU Frontier ────────────────────────────────────────────────────────────

export function useGPUFrontier(feature?: string) {
  return useQuery({
    queryKey: ["gpu-frontier", feature],
    queryFn: async () => {
      let query = supabase
        .from("gpu_frontier")
        .select("*")
        .order("measured_date", { ascending: false });

      if (feature) query = query.eq("feature", feature);

      const { data, error } = await query;
      if (error) throw error;
      return data as Tables<"gpu_frontier">[];
    },
    staleTime: 60_000,
  });
}
