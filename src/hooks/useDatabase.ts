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

// ─── Corpus Stats (computed from samples) ────────────────────────────────────

export function useCorpusStats() {
  return useQuery({
    queryKey: ["corpus-stats"],
    queryFn: async (): Promise<CorpusStats> => {
      const { data, error } = await supabase
        .from("samples")
        .select("status, cells_called, organism, gse_id, mapping_rate, median_genes");
      if (error) throw error;
      const rows = data ?? [];
      const success = rows.filter((r) => r.status === "SUCCESS");
      const terminal = rows.filter((r) => ["SUCCESS", "SOFT_FAIL", "HARD_FAIL"].includes(r.status));
      const avg = (vals: (number | null)[]) => {
        const nums = vals.filter((v): v is number => v != null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      };
      return {
        total_samples: rows.length,
        success_samples: success.length,
        total_cells: success.reduce((a, r) => a + (r.cells_called ?? 0), 0),
        species_count: new Set(rows.map((r) => r.organism)).size,
        series_count: new Set(rows.map((r) => r.gse_id)).size,
        avg_mapping_rate: avg(success.map((r) => r.mapping_rate)),
        avg_median_genes: avg(success.map((r) => r.median_genes)),
        success_rate: terminal.length ? success.length / terminal.length : null,
      };
    },
    staleTime: 60_000,
  });
}

export function useSpeciesStats() {
  return useQuery({
    queryKey: ["species-stats"],
    queryFn: async (): Promise<SpeciesStat[]> => {
      const { data, error } = await supabase
        .from("samples")
        .select("organism, cells_called, mapping_rate, median_genes")
        .eq("status", "SUCCESS");
      if (error) throw error;
      const groups = new Map<string, { cells: number; mr: number[]; mg: number[]; n: number }>();
      for (const r of data ?? []) {
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
  page?: number;
  pageSize?: number;
}

export function useSamples(filters: SampleFilters = {}) {
  const { organism, protocol, modality, status, search, page = 0, pageSize = 50 } = filters;

  return useQuery({
    queryKey: ["samples", filters],
    queryFn: async () => {
      let query = supabase
        .from("samples")
        .select("*", { count: "exact" })
        .order("pipeline_date", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (organism) query = query.eq("organism", organism);
      if (protocol) query = query.eq("protocol", protocol);
      if (modality) query = query.eq("modality", modality);
      if (status) query = query.eq("status", status);
      if (search) query = query.or(`gsm_id.ilike.%${search}%,gse_id.ilike.%${search}%,title.ilike.%${search}%`);

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
        supabase.from("species_stats").select("organism").order("total_cells", { ascending: false }).limit(30),
        supabase.from("samples").select("protocol").not("protocol", "is", null),
        supabase.from("samples").select("modality").not("modality", "is", null),
      ]);

      const uniqueProtocols = [...new Set((protocols.data ?? []).map((r) => r.protocol))].filter(Boolean);
      const uniqueModalities = [...new Set((modalities.data ?? []).map((r) => r.modality))].filter(Boolean);

      return {
        organisms: (organisms.data ?? []).map((r) => r.organism).filter(Boolean) as string[],
        protocols: uniqueProtocols as string[],
        modalities: uniqueModalities as string[],
      };
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
