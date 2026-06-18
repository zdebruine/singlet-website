/**
 * GET /api/facets
 * Returns distinct filter option values for dropdowns.
 * Tries meta_cache first; falls back to live D1 queries.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    // Fast path: cached facets
    const cached = await env.DB.prepare(
      "SELECT value FROM meta_cache WHERE key = 'facets'"
    ).first<{ value: string }>();
    if (cached) {
      return corsOk(JSON.parse(cached.value));
    }

    // Slow path: compute from DB
    const [organisms, protocols, tissues, cellTypes, diseases, sexes, statuses, qcFlags, failCats] = await Promise.all([
      env.DB.prepare("SELECT DISTINCT organism FROM gsm WHERE organism IS NOT NULL ORDER BY organism").all<{ organism: string }>(),
      env.DB.prepare("SELECT DISTINCT protocol FROM gsm WHERE protocol IS NOT NULL ORDER BY protocol").all<{ protocol: string }>(),
      env.DB.prepare("SELECT DISTINCT tissue FROM gsm WHERE tissue IS NOT NULL ORDER BY tissue").all<{ tissue: string }>(),
      env.DB.prepare("SELECT DISTINCT cell_type FROM gsm WHERE cell_type IS NOT NULL ORDER BY cell_type").all<{ cell_type: string }>(),
      env.DB.prepare("SELECT DISTINCT disease FROM gsm WHERE disease IS NOT NULL ORDER BY disease").all<{ disease: string }>(),
      env.DB.prepare("SELECT DISTINCT sex FROM gsm WHERE sex IS NOT NULL ORDER BY sex").all<{ sex: string }>(),
      env.DB.prepare("SELECT DISTINCT status FROM gsm ORDER BY status").all<{ status: string }>(),
      env.DB.prepare("SELECT DISTINCT qc_flag FROM gsm WHERE qc_flag IS NOT NULL ORDER BY qc_flag").all<{ qc_flag: string }>(),
      env.DB.prepare("SELECT DISTINCT failure_category FROM gsm WHERE failure_category IS NOT NULL ORDER BY failure_category").all<{ failure_category: string }>(),
    ]);

    return corsOk({
      organisms: organisms.results.map(r => r.organism),
      protocols: protocols.results.map(r => r.protocol),
      tissues: tissues.results.map(r => r.tissue),
      cell_types: cellTypes.results.map(r => r.cell_type),
      diseases: diseases.results.map(r => r.disease),
      sexes: sexes.results.map(r => r.sex),
      statuses: statuses.results.map(r => r.status),
      qc_flags: qcFlags.results.map(r => r.qc_flag),
      failure_categories: failCats.results.map(r => r.failure_category),
    });
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
