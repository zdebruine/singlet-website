/**
 * GET /api/gse/:id
 * Study detail — see ../../_shared/study-core for the shape. Accepts an
 * optional API key (rejected when unknown / revoked / expired); no key is
 * needed to read or download.
 */
import { corsOk, corsErr, handleOptions } from "../../_shared/cors";
import { cachedJson } from "../../_shared/cache";
import { type CloudEnv } from "../../_shared/cloud";
import { resolveIdentity } from "../../_shared/identity";
import { GSE_RE, loadStudy } from "../../_shared/study-core";

interface Env extends CloudEnv {
  DB: D1Database;
}

const DETAIL_TTL = 300;

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  const identity = await resolveIdentity(request, env, waitUntil);
  if (!identity.ok) return identity.response;

  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const id = ((params.id as string) ?? "").toUpperCase();
        if (!GSE_RE.test(id)) return corsErr("Invalid series id", 400);
        const detail = await loadStudy(env.DB, id);
        if (!detail) return corsErr(`Series ${id} not found`, 404);
        return corsOk(detail);
      } catch (e) {
        return corsErr(String(e));
      }
    },
    DETAIL_TTL
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
