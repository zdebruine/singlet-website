/**
 * Sample quality control: the one place the thresholds live.
 *
 * Every sample in a published file gets a tier from two numbers the pipeline measured, the median genes
 * detected per cell and the fraction of reads that mapped:
 *
 *   tier 2, removed: almost no reads map AND almost no genes are detected. These are failed runs, so they are
 *     left out of the catalog entirely (counts, searches, sample lists).
 *   tier 1, low QC: few genes detected OR few reads mapped. singlet's QC found an issue with the sample; proceed
 *     with caution. Hidden from searches, counts and bulk downloads unless the user opts in.
 *   tier 0: everything else.
 *
 * A sample with no measurements is never judged (tier 0). The evidence for these cut points is in
 * docs/DATA-AUDIT.md and docs/QC.md.
 */

/** Bump when a threshold changes, and re-run the tier backfill (schema/022_low_qc.sql) over existing rows. */
export const QC_RULES_VERSION = "2026-10-19";

/** Removed: fraction of reads mapped below this AND median genes per cell below QC_REMOVED_MAX_GENES. */
export const QC_REMOVED_MAX_MAPPING = 0.05;
export const QC_REMOVED_MAX_GENES = 10;
/** Low QC: median genes per cell below this, OR fraction of reads mapped below QC_LOW_MIN_MAPPING. */
export const QC_LOW_MIN_GENES = 30;
export const QC_LOW_MIN_MAPPING = 0.2;

export type QcTier = 0 | 1 | 2;

export function qcTier(medianGenes: number | null | undefined, mappingRate: number | null | undefined): QcTier {
  const g = medianGenes == null ? null : Number(medianGenes);
  const m = mappingRate == null ? null : Number(mappingRate);
  if (g != null && m != null && Number.isFinite(g) && Number.isFinite(m) && m < QC_REMOVED_MAX_MAPPING && g < QC_REMOVED_MAX_GENES) return 2;
  if ((g != null && Number.isFinite(g) && g < QC_LOW_MIN_GENES) || (m != null && Number.isFinite(m) && m < QC_LOW_MIN_MAPPING)) return 1;
  return 0;
}

/** "ok", "low_qc" or "removed", for API output. */
export function qcStatus(medianGenes: number | null | undefined, mappingRate: number | null | undefined): "ok" | "low_qc" | "removed" {
  const t = qcTier(medianGenes, mappingRate);
  return t === 2 ? "removed" : t === 1 ? "low_qc" : "ok";
}

/** SQL for the same rule over a sample_qc alias, for backfills and reports. */
export const qcTierSql = (a = "q") =>
  `CASE WHEN ${a}.median_genes IS NOT NULL AND ${a}.mapping_rate IS NOT NULL AND ${a}.mapping_rate < ${QC_REMOVED_MAX_MAPPING} AND ${a}.median_genes < ${QC_REMOVED_MAX_GENES} THEN 2
        WHEN ${a}.median_genes < ${QC_LOW_MIN_GENES} OR ${a}.mapping_rate < ${QC_LOW_MIN_MAPPING} THEN 1 ELSE 0 END`;

/** What a visitor is told about a flagged sample. */
export const QC_LOW_MESSAGE =
  "singlet's QC algorithms detected an issue with this sample. It is recommended to proceed with caution.";

/** The reasons behind a tier, in plain words, from the same two numbers. */
export function qcReasons(medianGenes: number | null | undefined, mappingRate: number | null | undefined): string[] {
  const out: string[] = [];
  if (medianGenes != null && medianGenes < QC_LOW_MIN_GENES) out.push(`median ${Math.round(medianGenes)} genes per cell (below ${QC_LOW_MIN_GENES})`);
  if (mappingRate != null && mappingRate < QC_LOW_MIN_MAPPING) out.push(`${(mappingRate * 100).toFixed(1)}% of reads mapped (below ${Math.round(QC_LOW_MIN_MAPPING * 100)}%)`);
  return out;
}

export const QC_RULES = {
  version: QC_RULES_VERSION,
  removed: { max_mapping_rate: QC_REMOVED_MAX_MAPPING, max_median_genes: QC_REMOVED_MAX_GENES },
  low_qc: { min_median_genes: QC_LOW_MIN_GENES, min_mapping_rate: QC_LOW_MIN_MAPPING },
} as const;
