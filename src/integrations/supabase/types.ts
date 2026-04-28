export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      samples: {
        Row: {
          gsm_id: string
          gse_id: string
          srr_ids: string[]
          organism: string
          taxon_id: number | null
          protocol: string | null
          modality: string | null
          status: string
          failure_category: string | null
          mapping_rate: number | null
          cells_called: number | null
          median_genes: number | null
          median_umis: number | null
          mt_pct: number | null
          doublet_rate: number | null
          ambient_pct: number | null
          saturation: number | null
          singlet_version: string | null
          singlet_commit: string | null
          wall_time_s: number | null
          download_path: string | null
          pipeline_date: string | null
          pz_path: string | null
          pz_size_bytes: number | null
          title: string | null
          source: string | null
          characteristics: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          gsm_id: string
          gse_id: string
          srr_ids?: string[]
          organism?: string
          taxon_id?: number | null
          protocol?: string | null
          modality?: string | null
          status?: string
          failure_category?: string | null
          mapping_rate?: number | null
          cells_called?: number | null
          median_genes?: number | null
          median_umis?: number | null
          mt_pct?: number | null
          doublet_rate?: number | null
          ambient_pct?: number | null
          saturation?: number | null
          singlet_version?: string | null
          singlet_commit?: string | null
          wall_time_s?: number | null
          download_path?: string | null
          pipeline_date?: string | null
          pz_path?: string | null
          pz_size_bytes?: number | null
          title?: string | null
          source?: string | null
          characteristics?: Json | null
        }
        Update: {
          gsm_id?: string
          gse_id?: string
          srr_ids?: string[]
          organism?: string
          taxon_id?: number | null
          protocol?: string | null
          modality?: string | null
          status?: string
          failure_category?: string | null
          mapping_rate?: number | null
          cells_called?: number | null
          median_genes?: number | null
          median_umis?: number | null
          mt_pct?: number | null
          doublet_rate?: number | null
          ambient_pct?: number | null
          saturation?: number | null
          singlet_version?: string | null
          singlet_commit?: string | null
          wall_time_s?: number | null
          download_path?: string | null
          pipeline_date?: string | null
          pz_path?: string | null
          pz_size_bytes?: number | null
          title?: string | null
          source?: string | null
          characteristics?: Json | null
        }
        Relationships: []
      }
      e2e_results: {
        Row: {
          id: number
          panel: string
          sample_srr: string
          singlet_commit: string
          external_tool: string
          metric_name: string
          metric_value: number
          threshold: number
          status: string
          run_date: string
        }
        Insert: {
          panel: string
          sample_srr: string
          singlet_commit: string
          external_tool: string
          metric_name: string
          metric_value: number
          threshold: number
          status: string
          run_date?: string
        }
        Update: {
          panel?: string
          sample_srr?: string
          singlet_commit?: string
          external_tool?: string
          metric_name?: string
          metric_value?: number
          threshold?: number
          status?: string
          run_date?: string
        }
        Relationships: []
      }
      gpu_frontier: {
        Row: {
          id: number
          feature: string
          scale: string
          wall_ms: number | null
          memory_mb: number | null
          sota_tool: string | null
          sota_wall_ms: number | null
          speedup: number | null
          correctness_r: number | null
          correctness_ref: string | null
          cycle_number: number | null
          commit_hash: string | null
          measured_date: string
        }
        Insert: {
          feature: string
          scale: string
          wall_ms?: number | null
          memory_mb?: number | null
          sota_tool?: string | null
          sota_wall_ms?: number | null
          speedup?: number | null
          correctness_r?: number | null
          correctness_ref?: string | null
          cycle_number?: number | null
          commit_hash?: string | null
        }
        Update: {
          feature?: string
          scale?: string
          wall_ms?: number | null
          memory_mb?: number | null
          sota_tool?: string | null
          sota_wall_ms?: number | null
          speedup?: number | null
          correctness_r?: number | null
          correctness_ref?: string | null
          cycle_number?: number | null
          commit_hash?: string | null
        }
        Relationships: []
      }
      pipeline_batches: {
        Row: {
          id: number
          batch_name: string
          slurm_job_id: string | null
          samples_total: number
          samples_success: number
          samples_failed: number
          submitted_at: string
          completed_at: string | null
        }
        Insert: {
          batch_name: string
          slurm_job_id?: string | null
          samples_total?: number
          samples_success?: number
          samples_failed?: number
          completed_at?: string | null
        }
        Update: {
          batch_name?: string
          slurm_job_id?: string | null
          samples_total?: number
          samples_success?: number
          samples_failed?: number
          completed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      corpus_stats: {
        Row: {
          total_samples: number | null
          success_samples: number | null
          total_cells: number | null
          species_count: number | null
          series_count: number | null
          avg_mapping_rate: number | null
          avg_median_genes: number | null
          success_rate: number | null
        }
      }
      species_stats: {
        Row: {
          organism: string | null
          sample_count: number | null
          total_cells: number | null
          avg_mapping_rate: number | null
          avg_median_genes: number | null
        }
      }
    }
    Functions: {
      refresh_corpus_stats: {
        Args: Record<string, never>
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type Insertable<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type Updatable<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
