/**
 * GET /api/stats/layers — how many downloadable studies hold each layer beyond gene counts
 * (splicing, mitochondrial variants, SNPs, ancestry, …). See ../../_shared/layers-core.
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
        return corsOk(await metaCached(env.DB, waitUntil, "stats:layers:v2", MAX_AGE_MS, () => computeLayerStats(env.DB)));
      } catch (e) {
        return serverError(e, "stats/layers");
      }
    },
    3600,
  );

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
