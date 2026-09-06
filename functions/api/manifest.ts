/**
 * GET /api/manifest?<same params as /api/search>&format=tsv|json|curl|wget|python|r
 *
 * The download-manifest pattern used by the HCA Data Portal and the Broad
 * Single Cell Portal: take the current search, get back a file that lists every
 * matching study (≤ 2,000) and how to fetch it. Everything here is CC0.
 */
import { CORS_HEADERS, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson } from "../_shared/cache";
import { type CloudEnv } from "../_shared/cloud";
import { resolveIdentity } from "../_shared/identity";
import { loadRules } from "../_shared/vocab";
import { canonicalQuery, normalizeFilters, parseSearchParams } from "../_shared/search-core";
import {
  buildManifestFromSearch,
  MANIFEST_FORMATS,
  MAX_MANIFEST_STUDIES,
  type ManifestFormat,
} from "../_shared/manifest-core";

interface Env extends CloudEnv {
  DB: D1Database;
}

const TTL = 300;

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;

  const url = new URL(request.url);
  const params = parseSearchParams(url);
  const rawFormat = (url.searchParams.get("format") ?? "tsv").toLowerCase();
  if (!MANIFEST_FORMATS.includes(rawFormat as ManifestFormat)) {
    return corsErr(`Unknown format '${rawFormat}'. Use ${MANIFEST_FORMATS.join(", ")}.`, 400);
  }
  const format = rawFormat as ManifestFormat;

  const rules = await loadRules(env.DB, waitUntil);
  const { filters, dropped } = normalizeFilters(params, rules);
  const key = `${canonicalQuery(filters)}&format=${format}`;

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const m = await buildManifestFromSearch({ db: env.DB, rules, waitUntil }, filters, format, {
          applied: filters,
          dropped,
        });
        return new Response(m.body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": m.content_type,
            "Content-Disposition": `attachment; filename="${m.filename}"`,
            "X-Total-Count": String(m.total),
            "X-Export-Limit": String(MAX_MANIFEST_STUDIES),
          },
        });
      } catch (e) {
        return corsErr(String(e));
      }
    },
    { ttl: TTL, key }
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
