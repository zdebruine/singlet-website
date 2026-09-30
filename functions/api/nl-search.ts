/**
 * GET /api/nl-search?q=<plain English>&level=gse|gsm&page=&limit=&sort=&has_bundle=
 * (POST { q, level, ... } is accepted too.)
 *
 * Natural-language search — the single search behind the site's one search
 * bar, the Python/R packages and the MCP server. All of the logic lives in
 * ../_shared/nl-search-core (reading the query: ../_shared/interpret); this
 * file only handles identity, caching and the HTTP envelope.
 *
 * Identity (../_shared/identity): the `__Host-singlet_session` cookie
 * (browser), `Authorization: Bearer sk_live_…` / `X-API-Key` (scripts, MCP)
 * or nothing (anonymous, metered by a salted IP hash). An unknown / revoked /
 * expired key is refused with 401 before anything else runs; a valid key is
 * charged to its owner's signed-in budget. Only a fresh model reading of the
 * query spends budget; vocabulary-only and cached readings are free.
 *
 * Response:
 *   { configured, interpreted, applied, hard_applied, dropped, level, data, total,
 *     totals, page, limit, accessions, suggestions: [{drop:{field,value}, total}],
 *     why: {gse_id: string}, model?, note?, quota_exceeded?, quota? }
 *
 * `accessions` (flat GSE / GSM id list) is a stable contract consumed by the
 * Python and R packages.
 */
import { ensureCatalogColumns } from "../_shared/catalog-refresh";
import { CORS_HEADERS, corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson, CATALOG_CACHE_TTL } from "../_shared/cache";
import type { AppEnv, WaitUntil } from "../_shared/env";
import { resolveIdentity, type Identity } from "../_shared/identity";
import { nlSearch } from "../_shared/nl-search-core";
import { canonicalQuery, parseSearchParams } from "../_shared/search-core";

async function respond(env: AppEnv, identity: Identity, waitUntil: WaitUntil, url: URL): Promise<Response> {
  try {
    const r = await nlSearch(env, identity, waitUntil, url);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: r.error, message: r.message }), {
        status: r.status,
        headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
      });
    }
    return corsOk(r.body, { headers: r.headers });
  } catch (e) {
    return corsErr(String(e));
  }
}

export const onRequestGet: PagesFunction<AppEnv> = async ({ env, request, waitUntil }) => {
  await ensureCatalogColumns(env.DB).catch(() => undefined);
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  const identity = id.identity;
  const url = new URL(request.url);
  const key = canonicalQuery(parseSearchParams(url)) + (url.searchParams.get("interpret") === "0" ? "&interpret=0" : "");
  return cachedJson(request, waitUntil, () => respond(env, identity, waitUntil, url), { ttl: CATALOG_CACHE_TTL, key });
};

export const onRequestPost: PagesFunction<AppEnv> = async ({ env, request, waitUntil }) => {
  await ensureCatalogColumns(env.DB).catch(() => undefined);
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(request.url);
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
    return await respond(env, id.identity, waitUntil, url);
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<AppEnv> = async () => handleOptions();
