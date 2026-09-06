// ── Catalog API types ────────────────────────────────────────────────────────
// Mirrors the shapes produced by functions/api/* (Cloudflare Pages Functions).
// Keep additive: the Python/R packages consume `data`, `total`, `accessions`.

export type Level = "gse" | "gsm";
export type Sort = "relevance" | "cells" | "samples" | "year" | "accession" | "file_cells" | "file_size" | "alphabetical";

// ── Study / sample rows returned by /api/search and /api/nl-search ──────────

export interface FilterMatch {
  field: string;
  value: string;
  n_samples?: number;
}

export interface TextMatch {
  field: "title" | "abstract" | "characteristics" | "source" | "cell_type" | "tissue" | "sample_title" | "accession";
  term: string;
  n_samples: number;
}

export interface MatchInfo {
  filters: FilterMatch[];
  text: TextMatch[];
  facets: { key: string; label: string; status: "hit" | "partial" | "miss"; detail: string }[];
  keywords: { term: string; hits: string[] }[];
  score: number;
}

export interface Condition {
  key: string;
  values: string[];
  counts: number[];
}

export interface StudyRow {
  gse_id: string;
  title: string | null;
  /** First 300 characters. */
  abstract: string | null;
  organism_primary: string | null;
  organism_label: string;
  organisms: string[];
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  tissues_raw: string[];
  cell_types_raw: string[];
  n_done: number;
  n_total: number;
  n_failed: number;
  n_cells: number;
  suspect_cells: boolean;
  has_bundle: boolean;
  bundle_bytes: number | null;
  bundle_key: string | null;
  bundle_n_samples: number | null;
  file_cells: number | null;
  reference_build: string | null;
  year: number | null;
  n_conditions: number;
  conditions: Condition[];
  conditions_label: string;
  match: MatchInfo;
  why: string;
  score: number | null;
}

export interface SampleRow {
  gsm_id: string;
  gse_id: string;
  study_title: string | null;
  organism: string | null;
  organism_primary: string | null;
  organism_label: string;
  protocol: string | null;
  assay_family: string | null;
  tissue: string | null;
  tissue_group: string | null;
  cell_type: string | null;
  disease: string | null;
  disease_group: string | null;
  sex: string | null;
  n_cells: number | null;
  suspect_cells: boolean;
  /** Plain words: "processed" | "processed (QC warning)" | "failed: …" */
  status: string;
  status_code: string;
  failure_category: string | null;
  title: string | null;
  source: string | null;
  characteristics: Record<string, string>;
  has_bundle: boolean;
  year: number | null;
  score: number | null;
}

export interface SearchTotals {
  studies: number | null;
  samples: number | null;
  cells: number | null;
}

/** Filters as the server applied them (canonical values). */
export interface AppliedFilters {
  q: string;
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  has_bundle: boolean | null;
  year_min: number | null;
  year_max: number | null;
  min_file_samples: number | null;
  min_file_cells: number | null;
  reference_build: string[];
  protocol: string[];
  has_pubmed: boolean | null;
  max_file_bytes: number | null;
  has_conditions: boolean | null;
  match_mode: Record<string, "any" | "all">;
}

export interface DroppedValue {
  field: string;
  value: string;
}

export interface SearchResponse<T = StudyRow | SampleRow> {
  level: Level;
  total: number;
  totals: SearchTotals;
  page: number;
  limit: number;
  data: T[];
  accessions: string[];
  applied: AppliedFilters;
  dropped: DroppedValue[];
  accession_lookup?: string[];
  /** Set when no study matched every word and results match any of them instead. */
  any_word?: boolean;
  note?: string;
  groups?: { full: number; partial: number };
  hard_applied?: AppliedFilters;
  ms?: number;
}

export interface Interpreted {
  organism: string[];
  tissue_group: string[];
  disease_group: string[];
  assay_family: string[];
  cell_type: string[];
  min_cells: number | null;
  year_min: number | null;
  year_max: number | null;
  q: string[];
}

export interface Suggestion {
  /** Remove this one filter (`all_filters` = keep only the free text). */
  drop?: FilterMatch | { field: "all_filters"; value: string };
  /** Offered only when no single removal helps: keep just this filter. */
  keep?: FilterMatch;
  total: number;
  /** Canonical query string (without "?") the UI can navigate to. */
  params: string;
}

/** Remaining AI budget for the requesting visitor, as reported by the API. */
export interface QuotaInfo {
  kind: "anon" | "user";
  used: number;
  limit: number;
  resets_at: string;
  exceeded: boolean;
}

export interface NlSearchQuery extends SearchQuery {
  q: string;
  /**
   * false = do not run the interpreter; the filters are already the visitor's
   * own (they edited a chip or a checkbox) and `q` is plain keywords.
   */
  interpret?: boolean;
}

export interface NlSearchResponse<T = StudyRow | SampleRow> extends SearchResponse<T> {
  configured: boolean;
  interpreted: Interpreted | null;
  suggestions: Suggestion[];
  /** gse_id → deterministic one-line explanation (study level only). */
  why: Record<string, string>;
  model?: string;
  /** True when today's AI-search budget is spent; the answer is a plain keyword search. */
  quota_exceeded?: boolean;
  quota?: QuotaInfo;
}

/** Reply from the signed-in "explain these matches" call. */
export interface ExplainResponse {
  explanations: Record<string, string>;
  cached: number;
  generated: number;
  quota?: QuotaInfo;
  model?: string;
}

// ── Facets ──────────────────────────────────────────────────────────────────

export interface FacetOption {
  value: string;
  count: number;
  label?: string;
}

export interface FacetsResponse {
  level: Level;
  organism: FacetOption[];
  tissue_group: FacetOption[];
  disease_group: FacetOption[];
  assay_family: FacetOption[];
  cell_type: FacetOption[];
  year: FacetOption[];
  reference_build: FacetOption[];
  protocol: FacetOption[];
  file_samples: FacetOption[];
  file_cells: FacetOption[];
  file_size: FacetOption[];
  vocab: {
    tissue_group: string[];
    disease_group: string[];
    assay_family: string[];
  };
  total: number;
  applied: AppliedFilters;
  dropped: DroppedValue[];
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface CorpusStats {
  total_samples: number;
  success_samples: number;
  total_cells: number;
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
  success_rate: number | null;
  /** Why samples fail, most common first. */
  failure_categories: FacetOption[];
  studies_with_files: number;
  samples_in_files: number;
  cells_in_files: number;
}

// ── Study / sample detail (/api/gse/:id, /api/gsm/:id) ──────────────────────

export interface GseRow {
  id: string;
  title: string | null;
  abstract: string | null;
  organism: string | null;
  n_gsm_total: number;
  n_gsm_done: number;
  n_gsm_failed: number;
  n_cells: number;
  pubmed_ids: string[];
  /** Object key of the per-study `.singlet` bundle; null when not published yet. */
  bundle_key: string | null;
  bundle_bytes: number | null;
  /** Public download URL (https://data.singlet.bio/…), null until the bundle exists. */
  bundle_url: string | null;
  /** Number of samples actually present in the bundle, when indexed by the packing job. */
  bundle_n_samples: number | null;
  reference_build: string | null;
  /** Pipeline version that packed the file, from the bundle manifest. */
  singlet_version: string | null;
  /** When the file was packed (ISO), from the bundle manifest. */
  packed_at: string | null;
  doi: string | null;
  submitted_date: string | null;
  last_updated: string;
  /** Common name for the study's primary organism (e.g. "Human"). */
  organism_label?: string;
}

export interface GsmRow {
  gsm_id: string;
  gse_id: string;
  organism: string | null;
  organism_primary?: string | null;
  organism_label?: string;
  protocol: string | null;
  assay_family?: string | null;
  modality: string | null;
  tissue: string | null;
  tissue_group?: string | null;
  cell_type: string | null;
  donor_id: string | null;
  disease: string | null;
  disease_group?: string | null;
  sex: string | null;
  n_cells: number | null;
  suspect_cells?: boolean;
  mapping_rate: number | null;
  median_genes: number | null;
  median_umis: number | null;
  mt_pct: number | null;
  status: string;
  status_text?: string;
  failure_category: string | null;
  failure_detail?: string | null;
  singlet_version: string | null;
  pipeline_date: string | null;
  pz_size_bytes: number | null;
  title: string | null;
  source: string | null;
  srr_ids: string[];
  characteristics?: Record<string, string> | null;
  /** The raw GEO characteristics string ("key: value ;; key: value"). */
  characteristics_raw?: string | null;
  last_updated: string;
}

export interface PublicationRow {
  pmid: string;
  title: string | null;
  doi: string | null;
  abstract: string | null;
  year: number | null;
  journal: string | null;
}

export interface StudyMeta {
  organism_primary: string | null;
  organism_label: string;
  organisms: string[];
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  tissues_raw: string[];
  cell_types_raw: string[];
  n_done: number;
  n_total: number;
  n_cells: number;
  has_bundle: boolean;
  year: number | null;
}

export interface GseDetailResponse {
  series: GseRow;
  meta: StudyMeta | null;
  samples: GsmRow[];
  conditions: Condition[];
  conditions_label: string;
  publications: PublicationRow[];
}

export interface GsmDetailResponse {
  sample: GsmRow;
  series: Pick<GseRow, "id" | "title" | "organism" | "n_gsm_total" | "n_gsm_done" | "n_gsm_failed" | "n_cells" | "submitted_date"> | null;
  siblings: Pick<GsmRow, "gsm_id" | "status" | "n_cells" | "title">[];
}

// ── Query params ────────────────────────────────────────────────────────────

export interface SearchQuery {
  q?: string;
  level?: Level;
  organism?: string[];
  tissue_group?: string[];
  disease_group?: string[];
  assay_family?: string[];
  cell_type?: string[];
  min_cells?: number;
  has_bundle?: boolean;
  year_min?: number;
  year_max?: number;
  min_file_samples?: number;
  min_file_cells?: number;
  reference_build?: string[];
  protocol?: string[];
  has_pubmed?: boolean;
  max_file_bytes?: number;
  has_conditions?: boolean;
  match_mode?: Record<string, "any" | "all">;
  sort?: Sort;
  page?: number;
  limit?: number;
}

// ── API keys (account page; managed by the Lovable Cloud `api-keys` function) ─

export interface ApiKeySummary {
  id: string;
  name: string;
  /** First characters of the key, e.g. "sk_live_a1b2c3d4"; the rest is never stored. */
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ApiKeyCreated {
  key: ApiKeySummary;
  /** The full secret. Shown once; never retrievable again. */
  secret: string;
}

export type ShareVisibility = "private" | "workspace" | "link";

export interface UserFile {
  id: string;
  project_id: string;
  filename: string;
  kind: "upload" | "url";
  bytes: number;
  status: "uploading" | "indexing" | "ready" | "failed";
  error: string | null;
  source_url?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  visibility: ShareVisibility;
  workspace_id: string | null;
  read_token_prefix: string;
  created_at: string;
  updated_at: string;
}

export interface PrivateStudy {
  id: string;
  project_id: string;
  study_id: string;
  title: string | null;
  abstract: string | null;
  organism_primary: string | null;
  organisms: string[];
  tissue_groups: string[];
  disease_groups: string[];
  assay_families: string[];
  cell_types_raw: string[];
  n_samples: number;
  n_cells: number | null;
  bytes: number;
  reference_build: string | null;
  singlet_version: string | null;
  year: number | null;
  manifest: Record<string, unknown>;
  study_meta: Record<string, unknown>;
}

export interface Cohort {
  id: string;
  name: string;
  notes: string;
  query: string;
  filters: Record<string, unknown>;
  catalog_version: string;
  visibility: ShareVisibility;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProductDashboard {
  projects: Project[];
  files: UserFile[];
  cohorts: Cohort[];
  workspaces: Workspace[];
  usage: { mcp_week?: Record<string, number>; downloads_month?: number; download_bytes_month?: number; storage_bytes?: number; projects?: number; cohorts?: number };
  weekly_summary: boolean;
  limits: { projects: number; files_per_project: number; storage_bytes: number; workspaces: number; members_per_workspace: number; file_bytes: number };
}

// ── Bundle contents (/api/bundle/:gse/*) ────────────────────────────────────

export interface BundleFile {
  path: string;
  bytes_compressed: number;
  bytes_uncompressed: number;
}

export interface BundleSampleFiles {
  gsm_id: string;
  files: BundleFile[];
  total_bytes: number;
}

export interface BundleIndexResponse {
  gse_id: string;
  bytes: number;
  reference_build: string | null;
  singlet_version: string | null;
  created_at: string | null;
  indexed_at: string | null;
  n_samples: number;
  samples: BundleSampleFiles[];
  study_files: BundleFile[];
}

/** Per-sample numbers read out of the published file (or the D1 memo of it). */
export interface SampleQc {
  gsm_id: string;
  gse_id: string;
  protocol: string | null;
  reference_build: string | null;
  n_input_reads: number | null;
  uniquely_mapped_pct: number | null;
  n_cells_called: number | null;
  median_umi: number | null;
  median_genes: number | null;
  mapping_rate: number | null;
  exonic_fraction: number | null;
  intronic_fraction: number | null;
  sequencing_saturation: number | null;
  median_mito_fraction: number | null;
  fraction_reads_in_cells: number | null;
  total_genes_detected: number | null;
  singlet_version: string | null;
}

export interface BundleSamplesResponse {
  gse_id: string;
  source: "d1" | "bundle";
  n_samples: number;
  samples: SampleQc[];
}

export interface RelatedStudy {
  gse_id: string;
  title: string | null;
  organism_label: string;
  tissue_groups: string[];
  disease_groups: string[];
  n_cells: number;
  n_done: number;
  year: number | null;
  reason: string;
}

export interface RelatedResponse {
  gse_id: string;
  total: number;
  related: RelatedStudy[];
}
