// ── D1 catalog API types ─────────────────────────────────────────────────────
// Mirror of the D1 schema columns. All nullable fields match DB schema.

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
  r2_bundle_key: string | null;
  r2_bundle_bytes: number | null;
  submitted_date: string | null;
  last_updated: string;
}

export interface GsmRow {
  gsm_id: string;
  gse_id: string;
  organism: string | null;
  protocol: string | null;
  modality: string | null;
  tissue: string | null;
  cell_type: string | null;
  donor_id: string | null;
  disease: string | null;
  sex: string | null;
  n_cells: number | null;
  mapping_rate: number | null;
  median_genes: number | null;
  median_umis: number | null;
  mt_pct: number | null;
  status: string;
  qc_flag: string | null;
  failure_category: string | null;
  failure_detail?: string | null;
  singlet_version: string | null;
  pipeline_date: string | null;
  pz_size_bytes: number | null;
  title: string | null;
  source: string | null;
  srr_ids: string[];
  characteristics?: Record<string, string> | null;
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

export interface Facets {
  organisms: string[];
  protocols: string[];
  tissues: string[];
  cell_types: string[];
  diseases: string[];
  sexes: string[];
  statuses: string[];
  qc_flags: string[];
  failure_categories: string[];
}

export interface PagedResponse<T> {
  total: number;
  page: number;
  page_size: number;
  data: T[];
}

export interface GseDetailResponse {
  series: GseRow;
  samples: GsmRow[];
  publications: PublicationRow[];
}

export interface GsmDetailResponse {
  sample: GsmRow;
  series: Pick<GseRow, "id" | "title" | "organism" | "n_gsm_total" | "n_gsm_done" | "n_gsm_failed" | "n_cells" | "submitted_date"> | null;
  siblings: Pick<GsmRow, "gsm_id" | "status" | "n_cells" | "title" | "qc_flag">[];
}

export interface SearchResponse {
  gsm: Pick<GsmRow, "gsm_id" | "gse_id" | "title" | "organism" | "tissue" | "cell_type" | "status" | "n_cells">[];
  gse: Pick<GseRow, "id" | "title" | "organism" | "n_cells" | "n_gsm_done">[];
}

// ── Query params ─────────────────────────────────────────────────────────────

export interface GsmListParams {
  organism?: string;
  protocol?: string;
  tissue?: string;
  cell_type?: string;
  disease?: string;
  sex?: string;
  status?: string;
  qc_flag?: string;
  failure_category?: string;
  min_cells?: number;
  max_cells?: number;
  q?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  asc?: boolean;
}

export interface GseListParams {
  organism?: string;
  q?: string;
  min_cells?: number;
  max_cells?: number;
  page?: number;
  page_size?: number;
  sort?: string;
  asc?: boolean;
}
