/**
 * GET /api/stats
 * Corpus-wide statistics computed live from `gsm` / `gse`, so it can never
 * disagree with /api/facets. See ../_shared/stats-core.
 *
 * Cached at the edge for CATALOG_CACHE_TTL seconds to protect the D1 free-tier
 * row-read quota. Public — no key needed — but a key that IS sent must be a
 * valid one, so a script with a revoked key learns about it here rather than
 * on its first search. The check runs before the cache lookup.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson } from "../_shared/cache";
import { type CloudEnv } from "../_shared/cloud";
import { resolveIdentity } from "../_shared/identity";
import { computeStats } from "../_shared/stats-core";

interface Env extends CloudEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;

  return cachedJson(request, waitUntil, async () => {
    try {
      const stats = await computeStats(env.DB);
      if (!stats) return corsErr("No stats available", 404);
      return corsOk(stats);
    } catch (e) {
      return corsErr(String(e));
    }
  });
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
