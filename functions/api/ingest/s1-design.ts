/**
 * POST /api/ingest/s1-design — record a curated study design (factors, levels, units, contrasts) in the catalog and publish its sidecar.
 * GET  /api/ingest/s1-design?gse=… — what the catalog holds for one study.
 *
 * Beta only (CHANNEL=beta), `X-Ingest-Token` as the other ingest routes. Body (JSON, at most 8 MiB):
 *   { "study": "GSE…" | "SRP…", "record": <singlet-design-catalog-0.1 record> }
 * Writes s1/d/<study>.design.json to the data bucket, then replaces the study's rows in one D1 batch (schema/042_design_catalog.sql),
 * so no reader sees half a study. Reposting an unchanged record (same rev) writes nothing. Tier is candidate, unresolved or confirmed as
 * the record says; the endpoint never raises a tier. 503 with a clear message when schema/042 has not been applied.
 */
import { serverError } from "../../_shared/errors";
import { isBeta } from "../../_shared/channel";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { sha256Hex } from "../../_shared/hash";
import { DesignError, MAX_RECORD_BYTES, STUDY_RE, designStatements, parseDesign } from "../../_shared/design-catalog";

interface Env {
  DB: D1Database;
  SINGLET_DATA?: R2Bucket;
  INGEST_TOKEN_SHA256?: string;
  CHANNEL?: string;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isBeta(env)) return json({ error: "Design ingest is enabled only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RECORD_BYTES) return json({ error: "Body exceeds 8 MiB" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_RECORD_BYTES) return json({ error: "Body exceeds 8 MiB" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  try {
    const p = parseDesign(body);
    const text = JSON.stringify(p.record);
    const rev = (await sha256Hex(text)).slice(0, 16);
    const prior = await env.DB.prepare(`SELECT rev FROM design_study WHERE gse_id = ?`).bind(p.study).first<{ rev: string }>();
    if (prior?.rev === rev) return json({ study: p.study, rev, unchanged: true, rows_written: 0 });
    const key = `s1/d/${p.study}.design.json`;
    if (env.SINGLET_DATA) await env.SINGLET_DATA.put(key, text, { httpMetadata: { contentType: "application/json" } });
    const res = await env.DB.batch(designStatements(env.DB, p.study, p.record, rev, env.SINGLET_DATA ? key : null));
    const rows = res.reduce((n, r) => n + Number((r as { meta?: { rows_written?: number } }).meta?.rows_written ?? 0), 0);
    return json({ study: p.study, rev, unchanged: false, tier: p.record.tier, sidecar: env.SINGLET_DATA ? key : null, rows_written: rows });
  } catch (e) {
    if (e instanceof DesignError) return json({ error: e.message }, e.status);
    if (/no such table/i.test(String(e))) return json({ error: "The design tables are missing: apply schema/042_design_catalog.sql first" }, 503);
    return serverError(e, "ingest s1-design");
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const gse = (new URL(request.url).searchParams.get("gse") ?? "").trim().toUpperCase();
  if (!STUDY_RE.test(gse)) return json({ error: "gse must look like GSE123 or SRP123" }, 400);
  try {
    const study = await env.DB.prepare(`SELECT * FROM design_study WHERE gse_id = ?`).bind(gse).first();
    const n = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE gse_id = ?`).bind(gse).first<{ n: number }>())?.n ?? 0;
    return json({ gse_id: gse, study, counts: { factors: await n("design_factor"), levels: await n("design_level"), units: await n("design_unit"), contrasts: await n("design_contrast") } });
  } catch (e) {
    return serverError(e, "ingest s1-design status");
  }
};
