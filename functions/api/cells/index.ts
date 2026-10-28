/**
 * GET|POST /api/cells — atlas-wide cell search (functions/_shared/cells; docs/CELL-SEARCH.md).
 *
 *   ?where=<JSON>  or  ?cell_type=T%20cell&sex=female&tissue=lung&not_disease=cancer  or  ?q=<plain English>
 *   &include_low_qc=1 &limit= &offset=
 *
 * Answers: matching cells, studies and samples (most cells first), a breakdown by every facet, the descendant terms each filter
 * matched, the per-cell-range count when n_umi / n_genes are given, and how to slice the cells (/api/cells/slice). GETs are edge-cached
 * for five minutes by their canonical query; an answer that needed a degraded model reading is not cached.
 */
import { handleOptions } from "../../_shared/cors";
import type { AppEnv } from "../../_shared/env";
import { resolveIdentity } from "../../_shared/identity";
import { cachedJson, cacheKey, CELLS_CACHE_TTL, cellSearchResponse, errorResponse, parseCellRequest } from "../../_shared/cells/http";

async function handle(request: Request, env: AppEnv, waitUntil: (p: Promise<unknown>) => void, body: Record<string, unknown> | null): Promise<Response> {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  let p;
  try {
    p = parseCellRequest(new URL(request.url), body);
  } catch (e) {
    return errorResponse(e, "parse");
  }
  const run = () => cellSearchResponse(env, id.identity, waitUntil, p).catch((e) => errorResponse(e, "query"));
  return cachedJson(request, waitUntil, run, { ttl: CELLS_CACHE_TTL, key: cacheKey(p) });
}

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => handle(request, env, waitUntil, null);

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(new (await import("../../_shared/cells/query")).QueryError("The body is not JSON."), "parse");
  }
  return handle(request, env, waitUntil, body);
};

export const onRequestOptions: PagesFunction<AppEnv> = () => handleOptions();
