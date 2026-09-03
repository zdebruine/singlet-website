export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      e2e_results: {
        Row: {
          external_tool: string
          id: number
          metric_name: string
          metric_value: number
          panel: string
          run_date: string | null
          sample_srr: string
          singlet_commit: string
          status: string
          threshold: number
        }
        Insert: {
          external_tool: string
          id?: never
          metric_name: string
          metric_value: number
          panel: string
          run_date?: string | null
          sample_srr: string
          singlet_commit: string
          status: string
          threshold: number
        }
        Update: {
          external_tool?: string
          id?: never
          metric_name?: string
          metric_value?: number
          panel?: string
          run_date?: string | null
          sample_srr?: string
          singlet_commit?: string
          status?: string
          threshold?: number
        }
        Relationships: []
      }
      gpu_frontier: {
        Row: {
          commit_hash: string | null
          correctness_r: number | null
          correctness_ref: string | null
          cycle_number: number | null
          feature: string
          id: number
          measured_date: string | null
          memory_mb: number | null
          scale: string
          sota_tool: string | null
          sota_wall_ms: number | null
          speedup: number | null
          wall_ms: number | null
        }
        Insert: {
          commit_hash?: string | null
          correctness_r?: number | null
          correctness_ref?: string | null
          cycle_number?: number | null
          feature: string
          id?: never
          measured_date?: string | null
          memory_mb?: number | null
          scale: string
          sota_tool?: string | null
          sota_wall_ms?: number | null
          speedup?: number | null
          wall_ms?: number | null
        }
        Update: {
          commit_hash?: string | null
          correctness_r?: number | null
          correctness_ref?: string | null
          cycle_number?: number | null
          feature?: string
          id?: never
          measured_date?: string | null
          memory_mb?: number | null
          scale?: string
          sota_tool?: string | null
          sota_wall_ms?: number | null
          speedup?: number | null
          wall_ms?: number | null
        }
        Relationships: []
      }
      pipeline_batches: {
        Row: {
          batch_name: string
          completed_at: string | null
          id: number
          samples_failed: number
          samples_success: number
          samples_total: number
          slurm_job_id: string | null
          submitted_at: string | null
        }
        Insert: {
          batch_name: string
          completed_at?: string | null
          id?: never
          samples_failed?: number
          samples_success?: number
          samples_total?: number
          slurm_job_id?: string | null
          submitted_at?: string | null
        }
        Update: {
          batch_name?: string
          completed_at?: string | null
          id?: never
          samples_failed?: number
          samples_success?: number
          samples_total?: number
          slurm_job_id?: string | null
          submitted_at?: string | null
        }
        Relationships: []
      }
      samples: {
        Row: {
          ambient_pct: number | null
          cells_called: number | null
          characteristics: Json | null
          created_at: string | null
          doublet_rate: number | null
          download_path: string | null
          failure_category: string | null
          gse_id: string
          gsm_id: string
          mapping_rate: number | null
          median_genes: number | null
          median_umis: number | null
          modality: string | null
          mt_pct: number | null
          organism: string
          pipeline_date: string | null
          protocol: string | null
          pz_path: string | null
          pz_size_bytes: number | null
          saturation: number | null
          singlet_commit: string | null
          singlet_version: string | null
          source: string | null
          srr_ids: string[]
          status: string
          taxon_id: number | null
          title: string | null
          updated_at: string | null
          wall_time_s: number | null
        }
        Insert: {
          ambient_pct?: number | null
          cells_called?: number | null
          characteristics?: Json | null
          created_at?: string | null
          doublet_rate?: number | null
          download_path?: string | null
          failure_category?: string | null
          gse_id: string
          gsm_id: string
          mapping_rate?: number | null
          median_genes?: number | null
          median_umis?: number | null
          modality?: string | null
          mt_pct?: number | null
          organism?: string
          pipeline_date?: string | null
          protocol?: string | null
          pz_path?: string | null
          pz_size_bytes?: number | null
          saturation?: number | null
          singlet_commit?: string | null
          singlet_version?: string | null
          source?: string | null
          srr_ids?: string[]
          status?: string
          taxon_id?: number | null
          title?: string | null
          updated_at?: string | null
          wall_time_s?: number | null
        }
        Update: {
          ambient_pct?: number | null
          cells_called?: number | null
          characteristics?: Json | null
          created_at?: string | null
          doublet_rate?: number | null
          download_path?: string | null
          failure_category?: string | null
          gse_id?: string
          gsm_id?: string
          mapping_rate?: number | null
          median_genes?: number | null
          median_umis?: number | null
          modality?: string | null
          mt_pct?: number | null
          organism?: string
          pipeline_date?: string | null
          protocol?: string | null
          pz_path?: string | null
          pz_size_bytes?: number | null
          saturation?: number | null
          singlet_commit?: string | null
          singlet_version?: string | null
          source?: string | null
          srr_ids?: string[]
          status?: string
          taxon_id?: number | null
          title?: string | null
          updated_at?: string | null
          wall_time_s?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      corpus_stats: {
        Row: {
          avg_mapping_rate: number | null
          avg_median_genes: number | null
          series_count: number | null
          species_count: number | null
          success_rate: number | null
          success_samples: number | null
          total_cells: number | null
          total_samples: number | null
        }
        Relationships: []
      }
      species_stats: {
        Row: {
          avg_mapping_rate: number | null
          avg_median_genes: number | null
          organism: string | null
          sample_count: number | null
          total_cells: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      refresh_corpus_stats: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
