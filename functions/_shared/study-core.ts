/**
 * Study detail, shared by /api/gse/:id and the MCP `get_study` tool.
 *
 * Series row + normalised study metadata + all samples (with parsed GEO
 * characteristics and a plain-words status) + conditions summary + linked
 * publications. `qc_flag` is the pipeline's per-sample verdict
 * (HEALTHY | WARN | LOW_QUALITY) and is null until the QC backfill has run for
 * that sample.
 *
 * Research Alpha (./alpha): a withheld study is not found (null, a 404), and samples that are not part of the atlas are
 * left out of the sample list, every count and the completeness ledger, as if GEO did not list them. Cells are cells
 * called in the file (sample_qc.n_cells_called), never the catalog's raw barcode count.
 */
import { referenceMismatch } from "./catalog-refresh";
import { safeList } from "./json";
import { normalizeModality, sanitizeQcFlag } from "./data-quality";
import { QC_LOW_MESSAGE, QC_RULES, qcReasons } from "./qc-rules";
import { parseCharacteristics, summarizeConditions, type ConditionSummary } from "./conditions";
import { exclusionFor, studyCompleteness, type Completeness, type Exclusion } from "./completeness";
import { cellCountVerdict, type CellCountVerdict } from "./suspect-cells";
import { statusText } from "./search-core";
import { organismToCommon } from "./vocab";
import { getS1State, parseJsonObject } from "./s1-catalog";
import { DATA_BASE, bundleUrl } from "./data-urls";
import { legacyUrl, studyS1, type StudyS1 } from "./file-facts";
import { excludedInStudy, isStudyWithheld, sampleServedSql } from "./alpha";

// The legacy URL builder lives in data-urls.ts (no import cycle with the readers); kept importable from here.
export { DATA_BASE, bundleUrl };
export type { StudyS1 };

export interface StudySeries {
  id: string;
  title: string | null;
  abstract: string | null;
  organism: string | null;
  organism_label: string;
  n_gsm_total: number;
  n_gsm_done: number;
  n_gsm_failed: number;
  /** Cells called in the file's samples that passed QC (null before the file is assessed). */
  n_cells: number;
  pubmed_ids: string[];
  bundle_key: string | null;
  bundle_bytes: number | null;
  bundle_url: string | null;
  /** Number of samples actually present in the bundle, when indexed. Null until the packing job writes gse.r2_bundle_n_gsms. */
  bundle_n_samples: number | null;
  /** Reference genome build of the bundle, e.g. "GRCm39-2024-A". Null until the packing job ingests it via bundle_manifest. */
  reference_build: string | null;
  /** singlet pipeline version the file was packed with: the file's own provenance (manifest.json), the one version source. */
  singlet_version: string | null;
  /** When the bundle was packed (manifest_created_at). */
  packed_at: string | null;
  /** Set when the study is served from the per-sample layout; null for a study that is still one .singlet file. */
  s1: StudyS1 | null;
  /** DUAL: alias of `s1` (the same object), removed in the cleanup. */
  v2: StudyS1 | null;
  /** Reserved: study DOI, once one is derivable. Always null today. */
  doi: string | null;
  submitted_date: string | null;
  last_updated: string | null;
  /** Legacy names kept for the Python/R packages. */
  r2_bundle_key: string | null;
  r2_bundle_bytes: number | null;
  /** Samples in the file with a non-empty matrix and ≥ 1 called cell (null = not yet assessed). */
  usable_samples: number | null;
  /** Samples in the file with per-sample QC recorded. */
  assessed_samples: number | null;
  /** GSMs in the file with no count data (empty matrix or 0 called cells). */
  unusable_gsm_ids: string[];
  /** Samples singlet's QC flagged (few genes or few reads mapped). They stay in the file and are listed here with a warning. */
  low_qc_samples: number;
  low_qc_gsm_ids: string[];
  /** Failed runs removed from the catalog entirely: not listed, not counted. Still present in the file. */
  removed_samples: number;
  qc_rules: typeof QC_RULES;
  /** Primary organism is not covered by the reference build the reads were aligned to. */
  reference_mismatch: boolean;
  reference_mismatch_note: string | null;
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
  /** Cells called in the file for this sample (sample_qc); null when the file holds none. */
  n_cells: number | null;
  srr_ids: string[];
  characteristics: Record<string, string>;
  characteristics_raw: string | null;
  status_text: string;
  /** Flagged low QC: proceed with caution. */
  low_qc: boolean;
  qc_message: string | null;
  qc_reasons: string[];
  /** Why the sample is not usable (class + plain-words reason); null for processed samples. */
  exclusion: Exclusion | null;
  suspect_cells: boolean;
  /** "ok" | "suspect" | "unverified" — see ./suspect-cells. */
  cell_verdict: CellCountVerdict;
  /** Pipeline QC verdict: "HEALTHY" | "WARN" | "LOW_QUALITY", or null if not yet scored. */
  qc_flag: string | null;
  organism_label: string;
}

export interface StudyDetail {
  series: StudySeries;
  meta: StudyMeta | null;
  samples: StudySample[];
  conditions: ConditionSummary["conditions"];
  conditions_label: string;
  publications: Record<string, unknown>[];
  /** Where every GEO sample of the series ended up. */
  completeness: Completeness;
}

export const GSE_RE = /^GSE\d+$/;

const SAMPLE_COLS = `gsm_id, gse_id, organism, organism_primary, protocol, assay_family, modality,
                tissue, tissue_group, cell_type, donor_id, disease, disease_group, sex,
                (SELECT q.n_cells_called FROM sample_qc q WHERE q.gsm_id = gsm.gsm_id) AS n_cells,
                mapping_rate, median_genes, median_umis, status, qc_flag, failure_category,
                failure_detail, pipeline_date, pz_size_bytes, title, source,
                srr_ids, characteristics, last_updated`;

export async function loadStudy(db: D1Database, rawId: string): Promise<StudyDetail | null> {
  const id = rawId.trim().toUpperCase();
  if (!GSE_RE.test(id)) return null;
  // A withheld study is not part of the atlas: it is answered exactly like an unknown one.
  if (await isStudyWithheld(db, id)) return null;
  const served = sampleServedSql("sample_qc.gsm_id");

  const usablePromise = db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN usable = 1 THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN usable IS NULL THEN 1 ELSE 0 END) AS unknown,
              group_concat(CASE WHEN usable = 0 THEN gsm_id END) AS bad,
              SUM(CASE WHEN usable = 1 AND qc_tier = 1 THEN 1 ELSE 0 END) AS low,
              SUM(CASE WHEN usable = 1 AND qc_tier = 2 THEN 1 ELSE 0 END) AS removed,
              SUM(CASE WHEN usable = 1 AND COALESCE(qc_tier, 0) = 0 THEN n_cells_called ELSE 0 END) AS cells
         FROM sample_qc WHERE gse_id = ? AND ${served}`
    )
    .bind(id)
    .first<{ n: number; ok: number | null; unknown: number | null; bad: string | null; low: number | null; removed: number | null; cells: number | null }>()
    .catch(() => null);
  // Per-sample verdicts for the samples QC touched (tier 1 low QC, tier 2 removed).
  const tiersPromise = db
    .prepare(`SELECT gsm_id, qc_tier, median_genes, mapping_rate FROM sample_qc WHERE gse_id = ? AND usable = 1 AND qc_tier >= 1 AND ${served}`)
    .bind(id)
    .all<{ gsm_id: string; qc_tier: number; median_genes: number | null; mapping_rate: number | null }>()
    .catch(() => ({ results: [] as { gsm_id: string; qc_tier: number; median_genes: number | null; mapping_rate: number | null }[] }));
  // Samples the study's .s1 files hold that the catalog files under another series (GEO lists some samples in two series; gsm keeps
  // one gse_id). Without the .s1 tables there are none.
  const crossPromise = db
    .prepare(`SELECT ${SAMPLE_COLS} FROM gsm WHERE gsm_id IN (SELECT gsm_id FROM s1_sample WHERE gse_id = ?) AND gse_id != ? AND ${sampleServedSql("gsm.gsm_id")}`)
    .bind(id, id)
    .all<Record<string, unknown>>()
    .catch(() => ({ results: [] as Record<string, unknown>[] }));
  const [seriesRow, metaRow, samplesResult, pubsResult, manifestRow] = await Promise.all([
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
        `SELECT ${SAMPLE_COLS} FROM gsm WHERE gse_id = ? AND ${sampleServedSql("gsm.gsm_id")} ORDER BY gsm_id ASC`
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

    // Bundle manifest (ingested by the packing job): reference build + actual sample count.
    db
      .prepare(`SELECT reference_build, singlet_version, manifest_created_at, bytes, n_gsms_in_bundle, gsm_ids FROM bundle_manifest WHERE gse_id = ?`)
      .bind(id)
      .first<Record<string, unknown>>()
      .catch(() => null),
  ]);

  if (!seriesRow) return null;
  // Samples that are not part of the atlas: subtracted from GEO's count and from the file's sample count.
  const excluded = await excludedInStudy(db, id);
  const inBundleExcluded = (() => {
    if (!excluded.size) return 0;
    const ids = safeList(manifestRow?.gsm_ids);
    return ids.length ? ids.filter((g) => excluded.has(g)).length : excluded.size;
  })();

  const cross = (await crossPromise).results ?? [];
  if (cross.length) {
    samplesResult.results.push(...cross);
    samplesResult.results.sort((a, b) => String(a.gsm_id).localeCompare(String(b.gsm_id)));
  }
  const tiers = (await tiersPromise).results ?? [];
  const lowById = new Map(tiers.filter((t) => Number(t.qc_tier) === 1).map((t) => [t.gsm_id, t]));
  const removedIds = new Set(tiers.filter((t) => Number(t.qc_tier) === 2).map((t) => t.gsm_id));
  const samples: StudySample[] = samplesResult.results.filter((r) => !removedIds.has(String(r.gsm_id))).map((r) => {
    const low = lowById.get(String(r.gsm_id));
    const nCells = r.n_cells != null ? Number(r.n_cells) : null;
    const verdict = cellCountVerdict(
      r.protocol as string | null,
      r.assay_family as string | null,
      nCells,
      r.median_umis != null ? Number(r.median_umis) : null
    );
    return {
      ...r,
      gsm_id: String(r.gsm_id),
      n_cells: nCells,
      srr_ids: safeList(r.srr_ids),
      characteristics: parseCharacteristics(r.characteristics),
      characteristics_raw: typeof r.characteristics === "string" ? r.characteristics : null,
      status_text: statusText(r.status as string, r.failure_category as string | null),
      low_qc: !!low,
      qc_message: low ? QC_LOW_MESSAGE : null,
      qc_reasons: low ? qcReasons(low.median_genes, low.mapping_rate) : [],
      exclusion: exclusionFor(r.status as string, r.failure_category as string | null),
      suspect_cells: verdict === "suspect",
      cell_verdict: verdict,
      qc_flag: sanitizeQcFlag(r.qc_flag),
      modality: normalizeModality(r.modality, r.assay_family),
      organism_label: organismToCommon((r.organism_primary as string | null) ?? (r.organism as string | null)),
    };
  });

  const summary = summarizeConditions(samples.map((s) => ({ characteristics: s.characteristics_raw })));

  const organismLabel = organismToCommon((metaRow?.organism_primary as string | null) ?? (seriesRow.organism as string | null));
  const bundleKey = (seriesRow.r2_bundle_key as string | null) ?? null;
  // The file's size from its own index (bundle_manifest, refreshed when the object changes) before the ingest's copy in gse.
  const bundleBytes =
    manifestRow?.bytes != null ? Number(manifestRow.bytes) : seriesRow.r2_bundle_bytes != null ? Number(seriesRow.r2_bundle_bytes) : null;
  const hasBundle = metaRow ? Number(metaRow.has_bundle ?? 0) === 1 : !!bundleKey;

  const s1State = await getS1State(db, id);
  const s1 = s1State ? studyS1(id, s1State) : null;
  // What a study served from s1 says about its own files stands in where the legacy file's catalog rows (bundle_manifest) are absent:
  // a study that never had a legacy file has none, and a retired one keeps them.
  const s1Pipeline = s1State ? parseJsonObject(s1State.study.pipeline_json) : null;

  const bundleNSamplesRaw =
    manifestRow?.n_gsms_in_bundle != null
      ? Number(manifestRow.n_gsms_in_bundle)
      : seriesRow.r2_bundle_n_gsms != null
        ? Number(seriesRow.r2_bundle_n_gsms)
        : (s1State?.study.n_samples ?? null);
  const bundleNSamples = bundleNSamplesRaw != null ? Math.max(0, bundleNSamplesRaw - inBundleExcluded) : null;
  const referenceBuild =
    typeof manifestRow?.reference_build === "string" && manifestRow.reference_build
      ? manifestRow.reference_build
      : (s1State?.study.reference_build ?? null) || null;
  // A retired study's legacy file is deleted: no URL, no key, and the size is that of the s1 files. The catalog rows stay.
  const legacyGone = !!s1 && !s1.legacy_available;
  const usableRow = await usablePromise;
  const assessed = usableRow && Number(usableRow.n) > 0 && Number(usableRow.unknown ?? 0) === 0 ? Number(usableRow.n) : null;
  const organismForRef = (metaRow?.organism_primary as string | null) ?? (seriesRow.organism as string | null);
  const mismatch = referenceMismatch(organismForRef, referenceBuild);

  const series: StudySeries = {
    id,
    title: (seriesRow.title as string | null) ?? null,
    abstract: (seriesRow.abstract as string | null) ?? null,
    organism: (seriesRow.organism as string | null) ?? null,
    organism_label: organismLabel,
    n_gsm_total: Math.max(0, Number(seriesRow.n_gsm_total ?? 0) - excluded.size),
    n_gsm_done: Number(seriesRow.n_gsm_done ?? 0),
    n_gsm_failed: Number(seriesRow.n_gsm_failed ?? 0),
    n_cells: Number(usableRow?.cells ?? 0),
    pubmed_ids: safeList(seriesRow.pubmed_ids),
    bundle_key: legacyGone ? null : bundleKey,
    bundle_bytes: legacyGone ? (s1!.bytes ?? bundleBytes) : bundleBytes,
    // Once the legacy file is retired its URL is dead; the s1 block says where the data is.
    // (A study served from s1 that never had a legacy key has no legacy file either.)
    bundle_url: hasBundle ? legacyUrl(id, s1, !!bundleKey || !s1) : null,
    s1,
    v2: s1,
    bundle_n_samples: bundleNSamples != null && !Number.isNaN(bundleNSamples) ? bundleNSamples : null,
    reference_build: referenceBuild,
    singlet_version:
      typeof manifestRow?.singlet_version === "string" && manifestRow.singlet_version
        ? manifestRow.singlet_version
        : typeof s1Pipeline?.singlet_version === "string" && s1Pipeline.singlet_version
          ? s1Pipeline.singlet_version
          : null,
    packed_at:
      typeof manifestRow?.manifest_created_at === "string" && manifestRow.manifest_created_at
        ? manifestRow.manifest_created_at
        : (s1State?.study.created_at ?? null),
    doi: null,
    submitted_date: (seriesRow.submitted_date as string | null) ?? null,
    last_updated: (seriesRow.last_updated as string | null) ?? null,
    r2_bundle_key: legacyGone ? null : bundleKey,
    r2_bundle_bytes: legacyGone ? (s1!.bytes ?? bundleBytes) : bundleBytes,
    usable_samples: assessed != null ? Number(usableRow?.ok ?? 0) : null,
    assessed_samples: assessed,
    unusable_gsm_ids: assessed != null && usableRow?.bad ? usableRow.bad.split(",").sort() : [],
    low_qc_samples: lowById.size,
    low_qc_gsm_ids: [...lowById.keys()].sort(),
    removed_samples: removedIds.size,
    qc_rules: QC_RULES,
    reference_mismatch: mismatch,
    reference_mismatch_note: mismatch
      ? `Reads from ${organismLabel} were aligned to ${referenceBuild}; gene-level counts are cross-species and not suitable for most analyses.`
      : null,
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
        n_cells: Number(usableRow?.cells ?? 0),
        has_bundle: hasBundle,
        year: metaRow.year != null ? Number(metaRow.year) : null,
      }
    : null;

  const completeness = studyCompleteness({
    nGsmTotal: series.n_gsm_total,
    samples: samplesResult.results.map((r) => ({ status: r.status as string | null, failure_category: r.failure_category as string | null })),
    hasFile: hasBundle || !!s1,
    bundleSamples: bundleNSamples != null && !Number.isNaN(bundleNSamples) ? bundleNSamples : null,
    passedQc: assessed != null ? Math.max(0, Number(usableRow?.ok ?? 0) - lowById.size - removedIds.size) : null,
    lowQc: lowById.size,
    removed: removedIds.size,
  });

  // One source of truth: the sample rows. The stored gse.* counters are written by the ingest and drift.
  series.n_gsm_total = completeness.geo_samples;
  series.n_gsm_done = completeness.processed;
  series.n_gsm_failed = completeness.not_processable + completeness.retry + completeness.failed_qc;
  if (meta) {
    meta.n_total = completeness.geo_samples;
    meta.n_done = completeness.processed;
  }

  return {
    series,
    meta,
    samples,
    conditions: summary.conditions,
    conditions_label: summary.label,
    publications: pubsResult.results,
    completeness,
  };
}
