/**
 * GET /api/search?q=...
 * Cross-entity FTS5 search across both gsm and gse tables.
 * Returns up to 10 results from each entity type.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson } from "../_shared/cache";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(request, waitUntil, async () => {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (!q) return corsOk({ gsm: [], gse: [] });

    const term = q + "*";

    const [gsmRows, gseRows] = await Promise.all([
      env.DB.prepare(
        `SELECT g.gsm_id, g.gse_id, g.title, g.organism, g.tissue, g.cell_type, g.status, g.n_cells
         FROM gsm g
         WHERE g.gsm_id IN (SELECT gsm_id FROM fts_gsm WHERE fts_gsm MATCH ?)
         LIMIT 10`
      ).bind(term).all<Record<string, unknown>>(),

      env.DB.prepare(
        `SELECT s.id, s.title, s.organism, s.n_cells, s.n_gsm_done
         FROM gse s
         WHERE s.id IN (SELECT id FROM fts_gse WHERE fts_gse MATCH ?)
         LIMIT 10`
      ).bind(term).all<Record<string, unknown>>(),
    ]);

    return corsOk({ gsm: gsmRows.results, gse: gseRows.results });
  } catch (e) {
    return corsErr(String(e));
  }
  });

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
