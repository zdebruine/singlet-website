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
      account_preferences: {
        Row: {
          updated_at: string
          user_id: string
          weekly_summary: boolean
        }
        Insert: {
          updated_at?: string
          user_id: string
          weekly_summary?: boolean
        }
        Update: {
          updated_at?: string
          user_id?: string
          weekly_summary?: boolean
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          id: number
          kind: string
          subject_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          kind: string
          subject_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          id?: never
          kind?: string
          subject_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_search_usage: {
        Row: {
          count: number
          day: string
          first_at: string
          kind: string
          last_at: string
          subject: string
          user_id: string | null
        }
        Insert: {
          count?: number
          day?: string
          first_at?: string
          kind?: string
          last_at?: string
          subject: string
          user_id?: string | null
        }
        Update: {
          count?: number
          day?: string
          first_at?: string
          kind?: string
          last_at?: string
          subject?: string
          user_id?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      cohort_comments: {
        Row: {
          author_id: string
          body: string
          cohort_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          cohort_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          cohort_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cohort_comments_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
        ]
      }
      cohort_items: {
        Row: {
          cohort_id: string
          created_at: string
          id: string
          position: number
          private_study_id: string | null
          public_gse_id: string | null
        }
        Insert: {
          cohort_id: string
          created_at?: string
          id?: string
          position?: number
          private_study_id?: string | null
          public_gse_id?: string | null
        }
        Update: {
          cohort_id?: string
          created_at?: string
          id?: string
          position?: number
          private_study_id?: string | null
          public_gse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohort_items_cohort_id_fkey"
            columns: ["cohort_id"]
            isOneToOne: false
            referencedRelation: "cohorts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cohort_items_private_study_id_fkey"
            columns: ["private_study_id"]
            isOneToOne: false
            referencedRelation: "user_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      cohorts: {
        Row: {
          catalog_version: string
          created_at: string
          filters: Json
          id: string
          name: string
          notes: string
          owner_id: string
          query: string
          share_token_hash: string | null
          share_token_prefix: string | null
          updated_at: string
          visibility: Database["public"]["Enums"]["share_visibility"]
          workspace_id: string | null
        }
        Insert: {
          catalog_version: string
          created_at?: string
          filters?: Json
          id?: string
          name: string
          notes?: string
          owner_id: string
          query?: string
          share_token_hash?: string | null
          share_token_prefix?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["share_visibility"]
          workspace_id?: string | null
        }
        Update: {
          catalog_version?: string
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          notes?: string
          owner_id?: string
          query?: string
          share_token_hash?: string | null
          share_token_prefix?: string | null
          updated_at?: string
          visibility?: Database["public"]["Enums"]["share_visibility"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cohorts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
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
      explanations: {
        Row: {
          cache_key: string
          created_at: string
          explanation: string
          gse_id: string
          model: string | null
          query_norm: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          explanation: string
          gse_id: string
          model?: string | null
          query_norm: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          explanation?: string
          gse_id?: string
          model?: string | null
          query_norm?: string
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
      multipart_uploads: {
        Row: {
          created_at: string
          expected_bytes: number
          expires_at: string
          file_id: string
          id: string
          object_key: string
          owner_id: string
          r2_upload_id: string
          reserved_bytes: number
        }
        Insert: {
          created_at?: string
          expected_bytes: number
          expires_at: string
          file_id: string
          id?: string
          object_key: string
          owner_id: string
          r2_upload_id: string
          reserved_bytes: number
        }
        Update: {
          created_at?: string
          expected_bytes?: number
          expires_at?: string
          file_id?: string
          id?: string
          object_key?: string
          owner_id?: string
          r2_upload_id?: string
          reserved_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "multipart_uploads_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "user_files"
            referencedColumns: ["id"]
          },
        ]
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          owner_id: string
          read_token_hash: string
          read_token_prefix: string
          updated_at: string
          visibility: Database["public"]["Enums"]["share_visibility"]
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          owner_id: string
          read_token_hash: string
          read_token_prefix: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["share_visibility"]
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          owner_id?: string
          read_token_hash?: string
          read_token_prefix?: string
          updated_at?: string
          visibility?: Database["public"]["Enums"]["share_visibility"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
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
      usage_events: {
        Row: {
          bytes: number
          calls: number
          created_at: string
          day: string
          id: number
          key_prefix: string | null
          kind: string
          ms: number
          tool: string
          user_id: string | null
        }
        Insert: {
          bytes?: number
          calls?: number
          created_at?: string
          day?: string
          id?: never
          key_prefix?: string | null
          kind: string
          ms?: number
          tool: string
          user_id?: string | null
        }
        Update: {
          bytes?: number
          calls?: number
          created_at?: string
          day?: string
          id?: never
          key_prefix?: string | null
          kind?: string
          ms?: number
          tool?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_files: {
        Row: {
          bytes: number
          created_at: string
          error: string | null
          etag: string | null
          filename: string
          id: string
          kind: Database["public"]["Enums"]["user_file_kind"]
          object_key: string | null
          owner_id: string
          project_id: string
          source_url: string | null
          status: Database["public"]["Enums"]["user_file_status"]
          updated_at: string
        }
        Insert: {
          bytes?: number
          created_at?: string
          error?: string | null
          etag?: string | null
          filename: string
          id?: string
          kind: Database["public"]["Enums"]["user_file_kind"]
          object_key?: string | null
          owner_id: string
          project_id: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["user_file_status"]
          updated_at?: string
        }
        Update: {
          bytes?: number
          created_at?: string
          error?: string | null
          etag?: string | null
          filename?: string
          id?: string
          kind?: Database["public"]["Enums"]["user_file_kind"]
          object_key?: string | null
          owner_id?: string
          project_id?: string
          source_url?: string | null
          status?: Database["public"]["Enums"]["user_file_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sample_qc: {
        Row: {
          fraction_reads_in_cells: number | null
          mapping_rate: number | null
          median_genes: number | null
          median_mito_fraction: number | null
          median_umi: number | null
          n_cells_called: number | null
          n_input_reads: number | null
          owner_id: string
          project_id: string
          reference_build: string | null
          sample_id: string
          singlet_version: string | null
          summary: Json
          uniquely_mapped_pct: number | null
          updated_at: string
        }
        Insert: {
          fraction_reads_in_cells?: number | null
          mapping_rate?: number | null
          median_genes?: number | null
          median_mito_fraction?: number | null
          median_umi?: number | null
          n_cells_called?: number | null
          n_input_reads?: number | null
          owner_id: string
          project_id: string
          reference_build?: string | null
          sample_id: string
          singlet_version?: string | null
          summary?: Json
          uniquely_mapped_pct?: number | null
          updated_at?: string
        }
        Update: {
          fraction_reads_in_cells?: number | null
          mapping_rate?: number | null
          median_genes?: number | null
          median_mito_fraction?: number | null
          median_umi?: number | null
          n_cells_called?: number | null
          n_input_reads?: number | null
          owner_id?: string
          project_id?: string
          reference_build?: string | null
          sample_id?: string
          singlet_version?: string | null
          summary?: Json
          uniquely_mapped_pct?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sample_qc_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sample_qc_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: true
            referencedRelation: "user_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      user_samples: {
        Row: {
          assay_family: string | null
          cell_type: string | null
          characteristics: Json
          disease: string | null
          disease_group: string | null
          id: string
          organism: string | null
          owner_id: string
          project_id: string
          protocol: string | null
          sample_id: string
          study_id: string
          tissue: string | null
          tissue_group: string | null
        }
        Insert: {
          assay_family?: string | null
          cell_type?: string | null
          characteristics?: Json
          disease?: string | null
          disease_group?: string | null
          id?: string
          organism?: string | null
          owner_id: string
          project_id: string
          protocol?: string | null
          sample_id: string
          study_id: string
          tissue?: string | null
          tissue_group?: string | null
        }
        Update: {
          assay_family?: string | null
          cell_type?: string | null
          characteristics?: Json
          disease?: string | null
          disease_group?: string | null
          id?: string
          organism?: string | null
          owner_id?: string
          project_id?: string
          protocol?: string | null
          sample_id?: string
          study_id?: string
          tissue?: string | null
          tissue_group?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_samples_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_samples_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "user_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_studies: {
        Row: {
          abstract: string | null
          assay_families: Json
          bytes: number
          cell_types_raw: Json
          disease_groups: Json
          file_id: string
          id: string
          indexed_at: string
          manifest: Json
          n_cells: number | null
          n_samples: number
          organism_primary: string | null
          organisms: Json
          owner_id: string
          project_id: string
          reference_build: string | null
          singlet_version: string | null
          study_id: string
          study_meta: Json
          tissue_groups: Json
          title: string | null
          year: number | null
        }
        Insert: {
          abstract?: string | null
          assay_families?: Json
          bytes?: number
          cell_types_raw?: Json
          disease_groups?: Json
          file_id: string
          id?: string
          indexed_at?: string
          manifest?: Json
          n_cells?: number | null
          n_samples?: number
          organism_primary?: string | null
          organisms?: Json
          owner_id: string
          project_id: string
          reference_build?: string | null
          singlet_version?: string | null
          study_id: string
          study_meta?: Json
          tissue_groups?: Json
          title?: string | null
          year?: number | null
        }
        Update: {
          abstract?: string | null
          assay_families?: Json
          bytes?: number
          cell_types_raw?: Json
          disease_groups?: Json
          file_id?: string
          id?: string
          indexed_at?: string
          manifest?: Json
          n_cells?: number | null
          n_samples?: number
          organism_primary?: string | null
          organisms?: Json
          owner_id?: string
          project_id?: string
          reference_build?: string | null
          singlet_version?: string | null
          study_id?: string
          study_meta?: Json
          tissue_groups?: Json
          title?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_studies_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "user_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_studies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string
          email: string | null
          expires_at: string
          id: string
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          expires_at: string
          id?: string
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          expires_at?: string
          id?: string
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          joined_at?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
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
      consume_ai_search: {
        Args: {
          _kind: string
          _limit: number
          _subject: string
          _user_id: string
        }
        Returns: {
          allowed: boolean
          limit: number
          resets_at: string
          used: number
        }[]
      }
      my_ai_usage_today: {
        Args: never
        Returns: {
          kind: string
          used: number
        }[]
      }
      my_product_usage: { Args: never; Returns: Json }
      refresh_corpus_stats: { Args: never; Returns: undefined }
      resolve_api_key: {
        Args: { _key_hash: string }
        Returns: {
          expires_at: string
          key_id: string
          last_used_at: string
          revoked_at: string
        }[]
      }
      touch_api_key: { Args: { _key_hash: string }; Returns: undefined }
    }
    Enums: {
      share_visibility: "private" | "workspace" | "link"
      user_file_kind: "upload" | "url"
      user_file_status: "uploading" | "indexing" | "ready" | "failed"
      workspace_role: "owner" | "member"
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
    Enums: {
      share_visibility: ["private", "workspace", "link"],
      user_file_kind: ["upload", "url"],
      user_file_status: ["uploading", "indexing", "ready", "failed"],
      workspace_role: ["owner", "member"],
    },
  },
} as const
