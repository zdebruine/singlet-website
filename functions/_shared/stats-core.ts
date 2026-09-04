/**
 * Corpus-wide statistics computed live from `gsm`, shared by /api/stats and
 * the MCP `get_atlas_stats` tool. Suspect plate-protocol cell counts are
 * excluded from total_cells — see ./suspect-cells.
 */
import { SUSPECT_CELLS_SQL } from "./suspect-cells";

interface StatsRow {
  total_samples: number;
  success_samples: number;
  total_cells: number | null;
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
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
  failure_categories: { value: string; count: number }[];
}

export async function computeStats(db: D1Database): Promise<CorpusStats | null> {
  const [row, failures] = await Promise.all([
    db
      .prepare(
        `SELECT
           COUNT(*)                                                   AS total_samples,
           SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END)           AS success_samples,
           SUM(CASE WHEN status = 'DONE' AND NOT ${SUSPECT_CELLS_SQL}
                    THEN COALESCE(n_cells, 0) ELSE 0 END)             AS total_cells,
           COUNT(DISTINCT organism)                                   AS species_count,
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
  ]);

  if (!row) return null;
  const total = row.total_samples ?? 0;
  const done = row.success_samples ?? 0;
  return {
    total_samples: total,
    success_samples: done,
    total_cells: row.total_cells ?? 0,
    species_count: row.species_count ?? 0,
    series_count: row.series_count ?? 0,
    avg_mapping_rate: row.avg_mapping_rate,
    avg_median_genes: row.avg_median_genes != null ? Math.round(row.avg_median_genes) : null,
    success_rate: total > 0 ? done / total : null,
    failure_categories: failures.results.map((f) => ({ value: f.value, count: Number(f.count) })),
  };
}
