/**
 * GET /api/stats
 * Corpus-wide statistics computed live from `gsm` / `gse`, so it can never
 * disagree with /api/facets (the old meta_cache.corpus_stats row was never
 * refreshed and went stale).
 *
 * Suspect plate-protocol cell counts are excluded from total_cells — see
 * ../_shared/suspect-cells.
 *
 * Cached at the edge for CATALOG_CACHE_TTL seconds to protect the D1 free-tier
 * row-read quota.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson } from "../_shared/cache";
import { SUSPECT_CELLS_SQL } from "../_shared/suspect-cells";

interface Env {
  DB: D1Database;
}

interface StatsRow {
  total_samples: number;
  success_samples: number;
  total_cells: number | null;
  species_count: number;
  series_count: number;
  avg_mapping_rate: number | null;
  avg_median_genes: number | null;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(request, waitUntil, async () => {
    try {
      const [row, failures] = await Promise.all([
        env.DB.prepare(
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
        ).first<StatsRow>(),
        // Small, status-filtered GROUP BY (a few thousand rows) for the About page.
        env.DB.prepare(
          `SELECT failure_category AS value, COUNT(*) AS count
             FROM gsm
            WHERE status IN ('FAIL', 'HARD_FAIL')
              AND failure_category IS NOT NULL AND failure_category != ''
            GROUP BY failure_category
            ORDER BY count DESC
            LIMIT 40`
        ).all<{ value: string; count: number }>(),
      ]);

      if (!row) return corsErr("No stats available", 404);

      const total = row.total_samples ?? 0;
      const done = row.success_samples ?? 0;

      return corsOk({
        total_samples: total,
        success_samples: done,
        total_cells: row.total_cells ?? 0,
        species_count: row.species_count ?? 0,
        series_count: row.series_count ?? 0,
        avg_mapping_rate: row.avg_mapping_rate,
        avg_median_genes:
          row.avg_median_genes != null ? Math.round(row.avg_median_genes) : null,
        success_rate: total > 0 ? done / total : null,
        failure_categories: failures.results.map((f) => ({ value: f.value, count: Number(f.count) })),
      });
    } catch (e) {
      return corsErr(String(e));
    }
  });

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
