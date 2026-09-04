/**
 * GET /api/facets?level=gse|gsm&<any /api/search filters>
 *
 * Contextual facet counts for the Browse rail. Each facet respects every OTHER
 * active filter (standard faceted search). Study level (default) counts
 * distinct studies via `gse_meta`; sample level counts `gsm` rows.
 *
 * Response:
 *   { level, organism: [{value, label, count}], tissue_group: [{value, count}],
 *     disease_group: [...], assay_family: [...], cell_type: [...], year: [...],
 *     vocab: { tissue_group, disease_group, assay_family }, total, applied }
 *
 * Cached at the edge for FACETS_CACHE_TTL seconds, keyed on the normalised
 * filter set. The unfiltered catalog is served from a daily `meta_cache` blob.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson, FACETS_CACHE_TTL } from "../_shared/cache";
import { type CloudEnv } from "../_shared/cloud";
import { resolveIdentity } from "../_shared/identity";
import { loadRules } from "../_shared/vocab";
import { canonicalQuery, normalizeFilters, parseSearchParams, pickFilters } from "../_shared/search-core";
import { computeFacets } from "../_shared/facets-core";

interface Env extends CloudEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;

  const url = new URL(request.url);
  const params = parseSearchParams(url);
  const rules = await loadRules(env.DB, waitUntil);
  const { filters, dropped } = normalizeFilters(params, rules);
  const applied = pickFilters(filters);
  const key = canonicalQuery({ ...applied, level: params.level });

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const facets = await computeFacets({ db: env.DB, rules, waitUntil }, applied, params.level);
        return corsOk({ ...facets, applied, dropped });
      } catch (e) {
        return corsErr(String(e));
      }
    },
    { ttl: FACETS_CACHE_TTL, key }
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
