/**
 * GET /api/cohort/resolve?tissue_group=Brain&not_treatment_status=treated&year_min=2020&min_cells=500
 * GET /api/cohort/resolve?query=<url-encoded cohort query JSON>
 * POST /api/cohort/resolve  { cohort query }
 *
 * Resolves a cohort query against the bit index (../../_shared/bitindex) with no D1 reads and no model call:
 * totals (studies, samples, cells in files), the first studies, facet distributions over the included set,
 * unknown_by_attr, what_if per clause, ambiguities. Grammar: docs/COHORT-QUERY.md. /api/nl-search is unchanged.
 */
import { corsOk, handleOptions } from "../../_shared/cors";
import { cachedJson } from "../../_shared/cache";
import { resolveIdentity } from "../../_shared/identity";
import { canonicalCohort, resolveCohort } from "../../_shared/cohort-core";
import { cohortFailure, numOpt, readCohortRequest } from "../../_shared/cohort-http";
import { getBitIndex, type CohortEnv } from "../../_shared/cohort-index";

const TTL = 300;
const OPTION_KEYS = ["facet_limit", "study_limit", "what_if", "facets"];

async function resolve(env: CohortEnv, request: Request): Promise<Response> {
  try {
    const { query, opts } = await readCohortRequest(request);
    const index = await getBitIndex(env);
    const body = resolveCohort(index, query, {
      facetLimit: Math.min(100, Math.max(1, numOpt(opts, "facet_limit", 15)!)),
      studyLimit: Math.min(2000, Math.max(0, numOpt(opts, "study_limit", 50)!)),
      whatIf: opts.get("what_if") !== "0",
      facets: opts.get("facets") !== "0",
    });
    return corsOk(body);
  } catch (e) {
    return cohortFailure(e, "cohort/resolve");
  }
}

export const onRequestGet: PagesFunction<CohortEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  // Cache key: the canonical query plus the options that change the body. A new index shows within TTL seconds.
  let key: string;
  try {
    const { query, opts } = await readCohortRequest(request);
    key = `k=${encodeURIComponent(`${canonicalCohort(query)}|${OPTION_KEYS.map((k) => opts.get(k) ?? "").join("|")}`)}`;
  } catch (e) {
    return cohortFailure(e, "cohort/resolve");
  }
  return cachedJson(request, waitUntil, () => resolve(env, request), { ttl: TTL, key });
};

export const onRequestPost: PagesFunction<CohortEnv> = async ({ env, request, waitUntil }) => {
  const id = await resolveIdentity(request, env, waitUntil);
  if (!id.ok) return id.response;
  return resolve(env, request);
};

export const onRequestOptions: PagesFunction<CohortEnv> = async () => handleOptions();
