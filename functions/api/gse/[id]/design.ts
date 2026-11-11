/**
 * GET /api/gse/:id/design
 * The curated study design for the study page's Design panel (_shared/design-view). Beta channel only: Alpha answers 404 so the page keeps its
 * GEO-characteristics table. The sidecar written by POST /api/ingest/s1-design is read from the data bucket under the key recorded in
 * design_study; sample_status adds counts by processing state when it holds the study. 404 when the study has no design.
 */
import { serverError } from "../../../_shared/errors";
import { corsOk, corsErr, handleOptions } from "../../../_shared/cors";
import { cachedJson } from "../../../_shared/cache";
import { isBeta } from "../../../_shared/channel";
import { STUDY_RE } from "../../../_shared/design-catalog";
import { designView } from "../../../_shared/design-view";

interface Env {
  DB: D1Database;
  SINGLET_DATA?: R2Bucket;
  CHANNEL?: string;
}

const TTL = 300;
const noTable = (e: unknown) => /no such table|no such column/i.test(String(e));

export async function loadDesignView(env: Env, id: string) {
  let row: { sidecar_key: string | null; rev: string | null } | null = null;
  try {
    row = await env.DB.prepare(`SELECT sidecar_key, rev FROM design_study WHERE gse_id = ?`).bind(id).first();
  } catch (e) {
    if (noTable(e)) return null;
    throw e;
  }
  if (!row?.sidecar_key || !env.SINGLET_DATA) return null;
  const obj = await env.SINGLET_DATA.get(row.sidecar_key);
  if (!obj) return null;
  const record = JSON.parse(await obj.text());
  let statusByGsm: Map<string, string> | null = null;
  try {
    const rs = await env.DB.prepare(`SELECT sample_id, status FROM sample_status WHERE gse_id = ?`).bind(id).all<{ sample_id: string; status: string }>();
    statusByGsm = new Map((rs.results ?? []).map((r) => [r.sample_id, r.status]));
  } catch (e) {
    if (!noTable(e)) throw e;
  }
  return designView(record, { rev: row.rev, statusByGsm });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request, waitUntil }) => {
  const id = ((params.id as string) ?? "").toUpperCase();
  if (!STUDY_RE.test(id)) return corsErr("Invalid study id", 400);
  if (!isBeta(env)) return corsErr("Curated designs are served on the beta channel only", 404);
  return cachedJson(
    request,
    waitUntil,
    async () => {
      try {
        const view = await loadDesignView(env, id);
        return view ? corsOk(view) : corsErr(`No curated design for ${id}`, 404);
      } catch (e) {
        return serverError(e, "gse/[id]/design");
      }
    },
    TTL
  );
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
