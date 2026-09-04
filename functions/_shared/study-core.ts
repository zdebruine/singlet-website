/**
 * Study detail, shared by /api/gse/:id and the MCP `get_study` tool.
 *
 * Series row + normalised study metadata + all samples (with parsed GEO
 * characteristics and a plain-words status) + conditions summary + linked
 * publications. `qc_flag` is never returned.
 */
import { safeList } from "./json";
import { parseCharacteristics, summarizeConditions, type ConditionSummary } from "./conditions";
import { isSuspectCellCount } from "./suspect-cells";
import { statusText } from "./search-core";
import { organismToCommon } from "./vocab";

/** Public base for per-study bundles; one `.singlet` file per GSE. */
export const DATA_BASE = "https://data.singlet.bio";

export function bundleUrl(gse: string): string {
  return `${DATA_BASE}/data/${gse}/${gse}.singlet`;
}

export interface StudySeries {
  id: string;
  title: string | null;
  abstract: string | null;
  organism: string | null;
  organism_label: string;
  n_gsm_total: number;
  n_gsm_done: number;
  n_gsm_failed: number;
  n_cells: number;
  pubmed_ids: string[];
  bundle_key: string | null;
  bundle_bytes: number | null;
  bundle_url: string | null;
  /** Number of samples actually present in the bundle, when indexed. Null until the packing job writes gse.r2_bundle_n_gsms. */
  bundle_n_samples: number | null;
  submitted_date: string | null;
  last_updated: string | null;
  /** Legacy names kept for the Python/R packages. */
  r2_bundle_key: string | null;
  r2_bundle_bytes: number | null;
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

export interface StudySample extends Record<string, unknown> {
  gsm_id: string;
  n_cells: number | null;
  srr_ids: string[];
  characteristics: Record<string, string>;
  characteristics_raw: string | null;
  status_text: string;
  suspect_cells: boolean;
  organism_label: string;
}

export interface StudyDetail {
  series: StudySeries;
  meta: StudyMeta | null;
  samples: StudySample[];
  conditions: ConditionSummary["conditions"];
  conditions_label: string;
  publications: Record<string, unknown>[];
}

export const GSE_RE = /^GSE\d+$/;

export async function loadStudy(db: D1Database, rawId: string): Promise<StudyDetail | null> {
  const id = rawId.trim().toUpperCase();
  if (!GSE_RE.test(id)) return null;

  const [seriesRow, metaRow, samplesResult, pubsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed,
                n_cells, pubmed_ids, r2_bundle_key, r2_bundle_bytes,
                r2_bundle_n_gsms, submitted_date, last_updated
           FROM gse WHERE id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>(),

    db
      .prepare(
        `SELECT gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
                tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year
           FROM gse_meta WHERE gse_id = ?`
      )
      .bind(id)
      .first<Record<string, unknown>>()
      .catch(() => null),

    db
      .prepare(
        `SELECT gsm_id, gse_id, organism, organism_primary, protocol, assay_family, modality,
                tissue, tissue_group, cell_type, donor_id, disease, disease_group, sex, n_cells,
                mapping_rate, median_genes, median_umis, mt_pct, status, failure_category,
                failure_detail, singlet_version, pipeline_date, pz_size_bytes, title, source,
                srr_ids, characteristics, last_updated
           FROM gsm WHERE gse_id = ? ORDER BY gsm_id ASC`
      )
      .bind(id)
      .all<Record<string, unknown>>(),

    db
      .prepare(
        `SELECT p.pmid, p.title, p.doi, p.abstract, p.year, p.journal
           FROM publications p
           JOIN gse_publication gp ON gp.pmid = p.pmid
          WHERE gp.gse_id = ?`
      )
      .bind(id)
      .all<Record<string, unknown>>()
      .catch(() => ({ results: [] as Record<string, unknown>[] })),
  ]);

  if (!seriesRow) return null;

  const samples: StudySample[] = samplesResult.results.map((r) => {
    const nCells = r.n_cells != null ? Number(r.n_cells) : null;
    return {
      ...r,
      gsm_id: String(r.gsm_id),
      n_cells: nCells,
      srr_ids: safeList(r.srr_ids),
      characteristics: parseCharacteristics(r.characteristics),
      characteristics_raw: typeof r.characteristics === "string" ? r.characteristics : null,
      status_text: statusText(r.status as string, r.failure_category as string | null),
      suspect_cells: isSuspectCellCount(r.protocol as string | null, r.assay_family as string | null, nCells),
      organism_label: organismToCommon((r.organism_primary as string | null) ?? (r.organism as string | null)),
    };
  });

  const summary = summarizeConditions(samples.map((s) => ({ characteristics: s.characteristics_raw })));

  const organismLabel = organismToCommon((metaRow?.organism_primary as string | null) ?? (seriesRow.organism as string | null));
  const bundleKey = (seriesRow.r2_bundle_key as string | null) ?? null;
  const bundleBytes = seriesRow.r2_bundle_bytes != null ? Number(seriesRow.r2_bundle_bytes) : null;
  const hasBundle = metaRow ? Number(metaRow.has_bundle ?? 0) === 1 : !!bundleKey;

  const bundleNSamples =
    seriesRow.r2_bundle_n_gsms != null ? Number(seriesRow.r2_bundle_n_gsms) : null;

  const series: StudySeries = {
    id,
    title: (seriesRow.title as string | null) ?? null,
    abstract: (seriesRow.abstract as string | null) ?? null,
    organism: (seriesRow.organism as string | null) ?? null,
    organism_label: organismLabel,
    n_gsm_total: Number(seriesRow.n_gsm_total ?? 0),
    n_gsm_done: Number(seriesRow.n_gsm_done ?? 0),
    n_gsm_failed: Number(seriesRow.n_gsm_failed ?? 0),
    n_cells: Number(seriesRow.n_cells ?? 0),
    pubmed_ids: safeList(seriesRow.pubmed_ids),
    bundle_key: bundleKey,
    bundle_bytes: bundleBytes,
    bundle_url: hasBundle ? bundleUrl(id) : null,
    bundle_n_samples: bundleNSamples != null && !Number.isNaN(bundleNSamples) ? bundleNSamples : null,
    submitted_date: (seriesRow.submitted_date as string | null) ?? null,
    last_updated: (seriesRow.last_updated as string | null) ?? null,
    r2_bundle_key: bundleKey,
    r2_bundle_bytes: bundleBytes,
  };

  const meta: StudyMeta | null = metaRow
    ? {
        organism_primary: metaRow.organism_primary as string | null,
        organism_label: organismLabel,
        organisms: safeList(metaRow.organisms),
        tissue_groups: safeList(metaRow.tissue_groups),
        disease_groups: safeList(metaRow.disease_groups),
        assay_families: safeList(metaRow.assay_families),
        tissues_raw: safeList(metaRow.tissues_raw),
        cell_types_raw: safeList(metaRow.cell_types_raw),
        n_done: Number(metaRow.n_done ?? 0),
        n_total: Number(metaRow.n_total ?? 0),
        n_cells: Number(metaRow.n_cells ?? 0),
        has_bundle: hasBundle,
        year: metaRow.year != null ? Number(metaRow.year) : null,
      }
    : null;

  return {
    series,
    meta,
    samples,
    conditions: summary.conditions,
    conditions_label: summary.label,
    publications: pubsResult.results,
  };
}
