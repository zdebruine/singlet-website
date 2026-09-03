/**
 * GET /api/facets
 * Returns filter option values WITH counts, as arrays the Browse UI consumes:
 *   organisms, protocols, qc_flags, failure_categories, tissues, cell_types,
 *   diseases, sexes — each an array of { value, count }, ordered by count desc
 *   and capped to the top entries.
 *
 * Note: facets are computed live from D1 (GROUP BY ... ORDER BY count DESC).
 * The meta_cache fast path is intentionally not used here because its stored
 * shape predates the { value, count } contract.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson } from "../_shared/cache";

interface Env {
  DB: D1Database;
}

interface FacetOption {
  value: string;
  count: number;
}

const FACET_LIMIT = 100;

/**
 * Group a non-null column and return its top values with counts.
 * `col` is a fixed identifier from the call sites below — never user input —
 * so interpolating it into the SQL is safe (no parameterization for idents).
 */
async function facet(db: D1Database, col: string): Promise<FacetOption[]> {
  const res = await db
    .prepare(
      `SELECT ${col} AS value, COUNT(*) AS count
         FROM gsm
        WHERE ${col} IS NOT NULL AND ${col} != ''
        GROUP BY ${col}
        ORDER BY count DESC
        LIMIT ?`
    )
    .bind(FACET_LIMIT)
    .all<{ value: string; count: number }>();
  return res.results.map((r) => ({ value: r.value, count: r.count }));
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(request, waitUntil, async () => {
  try {
    const [
      organisms,
      protocols,
      tissues,
      cell_types,
      diseases,
      sexes,
      qc_flags,
      failure_categories,
    ] = await Promise.all([
      facet(env.DB, "organism"),
      facet(env.DB, "protocol"),
      facet(env.DB, "tissue"),
      facet(env.DB, "cell_type"),
      facet(env.DB, "disease"),
      facet(env.DB, "sex"),
      facet(env.DB, "qc_flag"),
      facet(env.DB, "failure_category"),
    ]);

    return corsOk({
      organisms,
      protocols,
      tissues,
      cell_types,
      diseases,
      sexes,
      qc_flags,
      failure_categories,
    });
  } catch (e) {
    return corsErr(String(e));
  }
  });

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
