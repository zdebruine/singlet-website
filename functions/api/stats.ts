/**
 * GET /api/stats
 * Returns corpus-wide statistics from meta_cache.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM meta_cache WHERE key = 'corpus_stats'"
    ).first<{ value: string }>();

    if (!row) {
      return corsErr("No stats available yet", 404);
    }
    const stats = JSON.parse(row.value);
    return corsOk(stats);
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
