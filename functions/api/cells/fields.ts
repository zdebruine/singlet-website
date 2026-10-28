/**
 * GET /api/cells/fields — the cell-search vocabulary: every filter, its level (cell / sample / study), ontology, source table, the
 * share of the served atlas it covers, and its most common values. Edge-cached for an hour.
 */
import { handleOptions } from "../../_shared/cors";
import type { AppEnv } from "../../_shared/env";
import { cachedJson, errorResponse, fieldsBody, json, loadInputs } from "../../_shared/cells/http";

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) =>
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
    { ttl: 3600, key: "v=1" }
  );

export const onRequestOptions: PagesFunction<AppEnv> = () => handleOptions();
