/**
 * POST /api/ingest/s1-status — per-sample processing status for the live Beta roadmap (schema/042_design_catalog.sql).
 * GET  /api/ingest/s1-status?gse=… — status counts for one study.
 *
 * Beta only, `X-Ingest-Token`. Body: { "updates": [ { "sample", "gse?", "status", "reason?", "object_url?", "assay?", "read_pairs?", "attempt?", "release?" } ] },
 * at most 500 per post. status is scheduled, held, running, counts_available or needs_debug. object_url goes only with counts_available.
 * A sample that is held (multiplexed or unknown pool, D-137) moves on only when the update names a release route:
 * tag_demultiplexing, author_labels or not_pooled; other updates for it are refused and listed in `refused`.
 * The campaign shipper calls this after fetch (running), after a verified s1-publish (counts_available), on a failed gate (needs_debug)
 * and when a hold is released.
 */
import { serverError } from "../../_shared/errors";
import { isBeta } from "../../_shared/channel";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { DesignError, STUDY_RE, applyStatus, parseStatus } from "../../_shared/design-catalog";

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
  CHANNEL?: string;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isBeta(env)) return json({ error: "Status ingest is enabled only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  try {
    const r = await applyStatus(env.DB, parseStatus(body));
    return json(r, r.refused.length && !r.written ? 409 : 200);
  } catch (e) {
    if (e instanceof DesignError) return json({ error: e.message }, e.status);
    if (/no such table/i.test(String(e))) return json({ error: "sample_status is missing: apply schema/042_design_catalog.sql first" }, 503);
    return serverError(e, "ingest s1-status");
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const gse = (new URL(request.url).searchParams.get("gse") ?? "").trim().toUpperCase();
  if (gse && !STUDY_RE.test(gse)) return json({ error: "gse must look like GSE123 or SRP123" }, 400);
  try {
    const q = gse
      ? env.DB.prepare(`SELECT status, COUNT(*) AS n FROM sample_status WHERE gse_id = ? GROUP BY status`).bind(gse)
      : env.DB.prepare(`SELECT status, COUNT(*) AS n FROM sample_status GROUP BY status`);
    return json({ gse_id: gse || null, counts: (await q.all()).results });
  } catch (e) {
    return serverError(e, "ingest s1-status read");
  }
};
