import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, Views } from "@/integrations/supabase/types";

// ─── Corpus Stats ────────────────────────────────────────────────────────────

export function useCorpusStats() {
  return useQuery({
    queryKey: ["corpus-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("corpus_stats")
        .select("*")
        .single();
      if (error) throw error;
      return data as Views<"corpus_stats">;
    },
    staleTime: 60_000,
  });
}

export function useSpeciesStats() {
  return useQuery({
    queryKey: ["species-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("species_stats")
        .select("*")
        .order("total_cells", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Views<"species_stats">[];
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
