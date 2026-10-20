/**
 * GET /api/stats/layers — how many downloadable studies hold each layer beyond gene counts
 * (splicing, mitochondrial variants, ancestry, …). See ../../_shared/layers-core.
 *
 * Computed at most every 12 h (meta_cache) and cached at the edge for an hour. Public.
 */
import { serverError } from "../../_shared/errors";
import { corsOk, handleOptions } from "../../_shared/cors";
import { cachedJson, metaCached } from "../../_shared/cache";
import { computeLayerStats } from "../../_shared/layers-core";

interface Env {
  DB: D1Database;
}

const MAX_AGE_MS = 12 * 3600 * 1000;

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        return corsOk(await metaCached(env.DB, waitUntil, "stats:layers:v3", MAX_AGE_MS, () => computeLayerStats(env.DB)));
      } catch (e) {
        return serverError(e, "stats/layers");
      }
    },
    // The key carries the payload version, so a change of shape never meets an old cached copy.
    { ttl: 3600, key: "v3" },
  );

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
