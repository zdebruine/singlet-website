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
  studies_with_files: number;
  samples_in_files: number;
  cells_in_files: number | null;
  samples_unusable?: number | null;
  studies_unusable?: number | null;
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
  studies_with_files: number;
  /** Usable samples only: non-empty count matrix AND ≥ 1 called cell. */
  samples_in_files: number;
  /** Called cells in usable samples only. */
  cells_in_files: number;
  /** Samples in files whose matrix is empty or that called 0 cells. */
  samples_unusable: number;
  /** Studies with a file but 0 usable samples. */
  studies_unusable: number;
}

export async function computeStats(db: D1Database): Promise<CorpusStats | null> {
  const [row, failures, fileStats, coverage] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS total_samples,
           SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END)           AS success_samples,
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
           (SELECT COUNT(*) FROM bundle_manifest) AS studies_with_files,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 1) AS samples_in_files,
           (SELECT SUM(COALESCE(n_cells_called, 0)) FROM sample_qc WHERE usable = 1) AS cells_in_files,
           (SELECT COUNT(*) FROM sample_qc WHERE usable = 0) AS samples_unusable,
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
    samples_in_files: fileStats?.samples_in_files ?? 0,
    cells_in_files: fileStats?.cells_in_files ?? 0,
    samples_unusable: fileStats?.samples_unusable ?? 0,
    studies_unusable: fileStats?.studies_unusable ?? 0,
  };
}
