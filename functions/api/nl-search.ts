/**
 * GET /api/nl-search?q=<plain English>&level=gse|gsm&page=&limit=&sort=&has_bundle=
 * (POST { q, level, ... } is accepted too.)
 *
 * Natural-language search — the single search behind the site's one search
 * bar, the Python/R packages and the MCP server. All of the logic lives in
 * ../_shared/nl-search-core; this file only handles identity, caching and
 * the HTTP envelope.
 *
 * Identity: `Authorization: Bearer <session>` (browser), `Authorization:
 * Bearer sk_live_…` / `X-API-Key` (scripts, MCP) or nothing (anonymous). An
 * unknown / revoked / expired key is refused with 401 before anything else
 * runs; a key that is valid is charged to its owner's signed-in budget.
 *
 * Response:
 *   { configured, interpreted, applied, level, data, total, totals, page, limit,
 *     accessions, suggestions: [{drop:{field,value}, total}], why: {gse_id: string},
 *     model?, note?, quota_exceeded?, quota? }
 *
 * `accessions` (flat GSE / GSM id list) is a stable contract consumed by the
 * Python and R packages.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { cachedJson, CATALOG_CACHE_TTL } from "../_shared/cache";
import { resolveIdentity } from "../_shared/identity";
import { nlSearch, type NlEnv } from "../_shared/nl-search-core";
import { canonicalQuery, parseSearchParams } from "../_shared/search-core";

async function respond(env: NlEnv, request: Request, waitUntil: (p: Promise<unknown>) => void, url: URL): Promise<Response> {
  try {
    const r = await nlSearch(env, request, waitUntil, url);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: r.error, message: r.message }), {
        status: r.status,
        headers: { ...corsErr("", 200).headers, "Cache-Control": "no-store" },
      });
    }
    return corsOk(r.body, { headers: r.headers });
  } catch (e) {
    return corsErr(String(e));
  }
}

export const onRequestGet: PagesFunction<NlEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  const url = new URL(request.url);
  const key = canonicalQuery(parseSearchParams(url));
  return cachedJson(request, waitUntil, () => respond(env, request, waitUntil, url), { ttl: CATALOG_CACHE_TTL, key });
};

export const onRequestPost: PagesFunction<NlEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const url = new URL(request.url);
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else if (v != null && v !== "") url.searchParams.set(k, String(v));
    }
    return await respond(env, request, waitUntil, url);
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<NlEnv> = async () => handleOptions();
