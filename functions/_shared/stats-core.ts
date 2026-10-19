/**
 * Corpus-wide statistics computed live from `gsm`, shared by /api/stats and
 * the MCP `get_atlas_stats` tool.
 *
 * Two correctness rules are enforced here:
 *
 *  1. **Cell totals are partitioned, never silently summed.** Only counts that
 *     pass the plausibility model enter `total_cells`; provably inflated and
 *     unverifiable counts are reported in their own fields so the headline
 *     number is defensible and the discrepancy stays visible.
 *     See ./suspect-cells.
 *
 *  2. **Yield is reported against the real denominator.** `gsm` holds only
 *     samples that were ingested, so DONE/COUNT(gsm) measures survivors, not
 *     yield. `SUM(gse.n_gsm_total)` is the number of samples GEO advertises for
 *     the studies we track, which is the honest denominator for coverage.
 *
 *  3. **One headline definition.** The home page, /about and the MCP
 *     `get_atlas_stats` text lead with `studies_with_files`,
 *     `samples_in_files` (usable samples only) and `cells_in_files`. Every
 *     other count here (`series_count`, `success_samples`, `total_cells`,
 *     `geo_samples_known`, `species_count`, …) is catalog metadata and is
 *     labelled as such wherever it is shown.
 */
import { SUSPECT_CELLS_SQL, UNVERIFIED_CELLS_SQL, COUNTABLE_CELLS_SQL } from "./suspect-cells";
import { DOWNLOADABLE_SQL } from "./search-core";
import { QC_RULES } from "./qc-rules";

/**
 * Distinct species over the normalised `gsm.organism_primary` (the raw GEO
 * `organism` string has ~3x as many spellings). Genus-only leftovers ("Homo",
 * "Mus"), one-word placeholders ("unidentified", "Unknown") and non-organism
 * labels are not species, so they are not counted; case is folded so
 * "Synthetic construct" and "synthetic construct" cannot count twice.
 */
export const SPECIES_COUNT_SQL = `COUNT(DISTINCT CASE
             WHEN organism_primary IS NOT NULL
              AND organism_primary != 'Unknown'
              AND instr(trim(organism_primary), ' ') > 0
              AND lower(trim(organism_primary)) NOT IN ('blank sample', 'synthetic construct')
             THEN lower(trim(organism_primary)) END)`;

interface StatsRow {
  total_samples: number;
  success_samples: number;
  failed_samples: number;
  total_cells: number | null;
  suspect_cells: number | null;
  unverified_cells: number | null;
  suspect_samples: number;
  unverified_samples: number;
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
}

interface FileStatsRow {
  files_published?: number | null;
  studies_with_files: number;
  samples_in_files: number;
  cells_in_files: number | null;
  samples_unusable?: number | null;
  studies_unusable?: number | null;
  studies_withheld?: number | null;
  qc_rows?: number | null;
  usable_all?: number | null;
  awaiting_index?: number | null;
  qc_removed?: number | null;
  qc_low?: number | null;
  qc_low_cells?: number | null;
  qc_studies_affected?: number | null;
}

interface CoverageRow {
  geo_samples_known: number | null;
  studies_tracked: number;
}

export interface CorpusStats {
  total_samples: number;
  success_samples: number;
  /** Plausible cells only. Excludes suspect + unverified. */
  total_cells: number;
  /** Cells in counts the plausibility model rejects. */
  suspect_cells_excluded: number;
  /** Cells in implausibly high counts that could not be tested. */
  unverified_cells_excluded: number;
  suspect_samples: number;
  unverified_samples: number;
  /** total_cells + suspect + unverified. Matches a naive SUM(n_cells). */
  raw_cells_all: number;
  /** Distinct normalised species (gsm.organism_primary) in the catalog. See SPECIES_COUNT_SQL. */
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
  /** DONE / ingested. Survivorship-biased; kept for back-compat. */
  success_rate: number | null;
  /** Samples GEO advertises across tracked studies. */
  geo_samples_known: number;
  /** Ingested / advertised. */
  ingestion_rate: number | null;
  /** DONE / advertised — the honest end-to-end yield. */
  coverage_rate: number | null;
  failure_categories: { value: string; count: number }[];
  /** Studies a visitor can download and use: a published file, at least one usable sample, a reference that matches the species (DOWNLOADABLE_SQL). */
  studies_with_files: number;
  /** Files published in total, usable or not. `studies_with_files + studies_withheld`. */
  files_published: number;
  /** Published files withheld from the headline and from default searches: no usable sample, or a reference/species mismatch. */
  studies_withheld: number;
  /** Samples that passed QC: non-empty count matrix, ≥ 1 called cell, and not flagged low QC or removed. */
  samples_in_files: number;
  /** Called cells in those samples, in downloadable studies. */
  cells_in_files: number;
  /** What singlet's QC did to the catalog; see qc-rules.ts for the thresholds. */
  qc: QcSummary;
  /** Samples in files whose matrix is empty or that called 0 cells. */
  samples_unusable: number;
  /** Studies with a file but 0 usable samples. */
  studies_unusable: number;
  /**
   * Where every study and sample the catalog knows about stands. The lines add up:
   *   samples_advertised = not_ingested + failed + other + done
   *   done = done_in_files + done_not_in_files
   *   done_in_files = usable_downloadable + usable_withheld + low_qc + removed + unusable
   *   studies_tracked = studies_without_samples + studies_with_samples
   *   studies_published = studies_downloadable + studies_withheld
   */
  accounting: Accounting;
}

export interface QcSummary {
  /** Failed runs (almost no reads mapped and almost no genes detected), left out of the catalog. */
  removed_samples: number;
  /** Samples flagged low QC: held back from searches, counts and bulk downloads unless the user opts in. */
  low_qc_samples: number;
  low_qc_cells: number;
  /** Studies with at least one removed or low-QC sample. */
  studies_affected: number;
  rules: typeof QC_RULES;
}

export interface Accounting {
  studies_tracked: number;
  /** Tracked studies for which no sample has been ingested yet. */
  studies_without_samples: number;
  studies_with_samples: number;
  /** Files published, usable or not. */
  studies_published: number;
  studies_downloadable: number;
  studies_withheld: number;
  /** Published files whose per-sample QC has not been read yet (the index crank has not reached them or parked them). */
  studies_awaiting_index: number;
  /** Samples GEO advertises for the tracked studies. */
  samples_advertised: number;
  /** Advertised samples with no catalog row: not attempted (or not scRNA-seq). */
  samples_not_ingested: number;
  samples_failed: number;
  /** Ingested samples that are neither done nor failed (running, queued). */
  samples_other: number;
  samples_done: number;
  /** Done samples that are in a published file. */
  done_in_files: number;
  /** Done samples not (yet) in a published file. */
  done_not_in_files: number;
  /** In a file but empty or without called cells. */
  in_files_unusable: number;
  /** In a file with data, but a failed run: almost no reads mapped and almost no genes detected. Removed. */
  in_files_removed: number;
  /** In a file with data, flagged low QC. Left out of counts and default searches. */
  in_files_low_qc: number;
  /** Passed QC, but in a study that is withheld (no passing sample is in the study's count, or wrong reference). */
  in_files_usable_withheld: number;
  /** The headline: samples that passed QC, in downloadable studies. */
  in_files_usable_downloadable: number;
}

interface AccountInputs {
  studiesTracked: number;
  studiesWithSamples: number;
  published: number;
  downloadable: number;
  withheld: number;
  awaitingIndex: number;
  advertised: number;
  ingested: number;
  failed: number;
  done: number;
  qcRows: number;
  usableAll: number;
  unusable: number;
  usableDownloadable: number;
  /** Usable samples by QC tier (counted inside usableAll). */
  removed?: number;
  lowQc?: number;
}

/** Splits the corpus into parts that sum to their whole (see Accounting). Counts that cannot be split cleanly are clamped at zero. */
export function accountFor(a: AccountInputs): Accounting {
  const nonNeg = (n: number) => Math.max(0, n);
  return {
    studies_tracked: a.studiesTracked,
    studies_without_samples: nonNeg(a.studiesTracked - a.studiesWithSamples),
    studies_with_samples: a.studiesWithSamples,
    studies_published: a.published,
    studies_downloadable: a.downloadable,
    studies_withheld: a.withheld,
    studies_awaiting_index: a.awaitingIndex,
    samples_advertised: a.advertised,
    samples_not_ingested: nonNeg(a.advertised - a.ingested),
    samples_failed: a.failed,
    samples_other: nonNeg(a.ingested - a.done - a.failed),
    samples_done: a.done,
    done_in_files: a.qcRows,
    done_not_in_files: nonNeg(a.done - a.qcRows),
    in_files_unusable: a.unusable,
    in_files_removed: a.removed ?? 0,
    in_files_low_qc: a.lowQc ?? 0,
    in_files_usable_withheld: nonNeg(a.usableAll - (a.removed ?? 0) - (a.lowQc ?? 0) - a.usableDownloadable),
    in_files_usable_downloadable: a.usableDownloadable,
  };
}

export async function computeStats(db: D1Database): Promise<CorpusStats | null> {
  const [row, failures, fileStats, coverage] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS total_samples,
           SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END)           AS success_samples,
           SUM(CASE WHEN status IN ('FAIL', 'HARD_FAIL') THEN 1 ELSE 0 END) AS failed_samples,
           SUM(CASE WHEN status = 'DONE' AND ${COUNTABLE_CELLS_SQL}
                    THEN COALESCE(n_cells, 0) ELSE 0 END)             AS total_cells,
           SUM(CASE WHEN status = 'DONE' AND ${SUSPECT_CELLS_SQL}
                    THEN COALESCE(n_cells, 0) ELSE 0 END)             AS suspect_cells,
           SUM(CASE WHEN status = 'DONE' AND ${UNVERIFIED_CELLS_SQL}
                    THEN COALESCE(n_cells, 0) ELSE 0 END)             AS unverified_cells,
           SUM(CASE WHEN status = 'DONE' AND ${SUSPECT_CELLS_SQL}
                    THEN 1 ELSE 0 END)                                AS suspect_samples,
           SUM(CASE WHEN status = 'DONE' AND ${UNVERIFIED_CELLS_SQL}
                    THEN 1 ELSE 0 END)                                AS unverified_samples,
           ${SPECIES_COUNT_SQL}                                       AS species_count,
           COUNT(DISTINCT gse_id)                                     AS series_count,
           AVG(CASE WHEN status = 'DONE' THEN mapping_rate END)       AS avg_mapping_rate,
           AVG(CASE WHEN status = 'DONE' THEN median_genes END)       AS avg_median_genes
         FROM gsm`
      )
      .first<StatsRow>(),
    // Small, status-filtered GROUP BY (a few thousand rows) for the About page.
    db
      .prepare(
        `SELECT failure_category AS value, COUNT(*) AS count
           FROM gsm
          WHERE status IN ('FAIL', 'HARD_FAIL')
            AND failure_category IS NOT NULL AND failure_category != ''
          GROUP BY failure_category
          ORDER BY count DESC
          LIMIT 40`
      )
      .all<{ value: string; count: number }>(),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM gse_meta m WHERE ${DOWNLOADABLE_SQL}) AS studies_with_files,
           (SELECT COUNT(*) FROM bundle_manifest) AS files_published,
           (SELECT COUNT(*) FROM gse_meta m WHERE m.has_bundle = 1 AND NOT ${DOWNLOADABLE_SQL}) AS studies_withheld,
           (SELECT COUNT(*) FROM sample_qc q WHERE q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0
               AND q.gse_id IN (SELECT m.gse_id FROM gse_meta m WHERE ${DOWNLOADABLE_SQL})) AS samples_in_files,
           (SELECT SUM(COALESCE(q.n_cells_called, 0)) FROM sample_qc q WHERE q.usable = 1 AND COALESCE(q.qc_tier, 0) = 0
               AND q.gse_id IN (SELECT m.gse_id FROM gse_meta m WHERE ${DOWNLOADABLE_SQL})) AS cells_in_files,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 1 AND qc_tier = 2) AS qc_removed,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 1 AND qc_tier = 1) AS qc_low,
           (SELECT COALESCE(SUM(n_cells_called), 0) FROM sample_qc WHERE usable = 1 AND qc_tier = 1) AS qc_low_cells,
           (SELECT COUNT(DISTINCT gse_id) FROM sample_qc WHERE usable = 1 AND qc_tier >= 1) AS qc_studies_affected,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 0) AS samples_unusable,
           (SELECT COUNT(*) FROM sample_qc) AS qc_rows,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 1) AS usable_all,
           (SELECT COUNT(*) FROM bundle_manifest b WHERE NOT EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = b.gse_id)) AS awaiting_index,
           (SELECT COUNT(*) FROM bundle_manifest m
             WHERE EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = m.gse_id)
               AND NOT EXISTS (SELECT 1 FROM sample_qc q WHERE q.gse_id = m.gse_id AND q.usable = 1)) AS studies_unusable`
      )
      .first<FileStatsRow>()
      .catch(() => null),
    db
      .prepare(
        `SELECT SUM(COALESCE(n_gsm_total, 0)) AS geo_samples_known,
                COUNT(*)                      AS studies_tracked
           FROM gse`
      )
      .first<CoverageRow>()
      .catch(() => null),
  ]);

  if (!row) return null;
  const total = row.total_samples ?? 0;
  const done = row.success_samples ?? 0;
  const countable = row.total_cells ?? 0;
  const suspect = row.suspect_cells ?? 0;
  const unverified = row.unverified_cells ?? 0;
  const geoKnown = coverage?.geo_samples_known ?? 0;

  return {
    total_samples: total,
    success_samples: done,
    total_cells: countable,
    suspect_cells_excluded: suspect,
    unverified_cells_excluded: unverified,
    suspect_samples: row.suspect_samples ?? 0,
    unverified_samples: row.unverified_samples ?? 0,
    raw_cells_all: countable + suspect + unverified,
    species_count: row.species_count ?? 0,
    series_count: row.series_count ?? 0,
    avg_mapping_rate: row.avg_mapping_rate,
    avg_median_genes: row.avg_median_genes != null ? Math.round(row.avg_median_genes) : null,
    success_rate: total > 0 ? done / total : null,
    geo_samples_known: geoKnown,
    ingestion_rate: geoKnown > 0 ? total / geoKnown : null,
    coverage_rate: geoKnown > 0 ? done / geoKnown : null,
    failure_categories: failures.results.map((f) => ({ value: f.value, count: Number(f.count) })),
    studies_with_files: fileStats?.studies_with_files ?? 0,
    files_published: fileStats?.files_published ?? 0,
    studies_withheld: fileStats?.studies_withheld ?? 0,
    samples_in_files: fileStats?.samples_in_files ?? 0,
    cells_in_files: fileStats?.cells_in_files ?? 0,
    qc: {
      removed_samples: fileStats?.qc_removed ?? 0,
      low_qc_samples: fileStats?.qc_low ?? 0,
      low_qc_cells: fileStats?.qc_low_cells ?? 0,
      studies_affected: fileStats?.qc_studies_affected ?? 0,
      rules: QC_RULES,
    },
    samples_unusable: fileStats?.samples_unusable ?? 0,
    studies_unusable: fileStats?.studies_unusable ?? 0,
    accounting: accountFor({
      studiesTracked: coverage?.studies_tracked ?? 0,
      studiesWithSamples: row.series_count ?? 0,
      published: fileStats?.files_published ?? 0,
      downloadable: fileStats?.studies_with_files ?? 0,
      withheld: fileStats?.studies_withheld ?? 0,
      awaitingIndex: fileStats?.awaiting_index ?? 0,
      advertised: geoKnown,
      ingested: total,
      failed: row.failed_samples ?? 0,
      done,
      qcRows: fileStats?.qc_rows ?? 0,
      usableAll: fileStats?.usable_all ?? 0,
      unusable: fileStats?.samples_unusable ?? 0,
      usableDownloadable: fileStats?.samples_in_files ?? 0,
      removed: fileStats?.qc_removed ?? 0,
      lowQc: fileStats?.qc_low ?? 0,
    }),
  };
}
