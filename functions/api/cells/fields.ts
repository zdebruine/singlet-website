/**
 * GET /api/cells/fields — the cell-search vocabulary: every filter, its level (cell / sample / study), ontology, source table, the
 * share of the served atlas it covers, and its most common values. Edge-cached for an hour, keyed by facts_epoch so a metadata
 * backfill shows within five minutes.
 */
import { handleOptions } from "../../_shared/cors";
import type { AppEnv } from "../../_shared/env";
import { cachedJson, errorResponse, fieldsBody, json, loadInputs } from "../../_shared/cells/http";
import { factsEpoch } from "../../_shared/cells/sample-facts";

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) =>
  cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        return json(200, fieldsBody(await loadInputs(env, waitUntil)));
      } catch (e) {
        return errorResponse(e, "fields");
      }
    },
    { ttl: 3600, key: `v=1&e=${encodeURIComponent(await factsEpoch(env.DB))}` }
  );

export const onRequestOptions: PagesFunction<AppEnv> = () => handleOptions();
