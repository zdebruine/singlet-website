/**
 * Beta clean-up: remove a study or an unreferenced object that a test left behind. Beta channel only (403 elsewhere), token-checked like the
 * other /api/ingest routes, and a DRY RUN unless `apply=1` is sent.
 *
 *   DELETE /api/ingest/s1-delete?gse=GSE…            [&apply=1]
 *       removes the study manifest s1/m/<GSE>.json from R2 and the study's rows from s1_sample, s1_migration and s1_study (one atomic D1
 *       batch). The sample and label objects are NOT touched; the answer lists them (`objects`) so that each can be removed with the call below.
 *   DELETE /api/ingest/s1-delete?key=s1/s/GSM…/<d16>.s1 | s1/a/GSM…/<d16>.parquet   [&apply=1]
 *       removes one object, only when the catalog no longer references it: a sample key that no s1_sample row names, a label key whose
 *       GSM has no s1_sample row. Packs and cell tables are never deleted here.
 *
 * Nothing here can reach the production bucket or database: the route answers 403 unless CHANNEL=beta, and the Beta Pages project is the only one
 * with CHANNEL=beta and its own bindings (docs/BETA-CHANNEL.md).
 */
import { classifyObjectKey, isBeta } from "../../_shared/channel";
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { GSE_RE } from "../../_shared/s1-catalog";

interface Env {
  DB: D1Database;
  SINGLET_DATA?: R2Bucket;
  CHANNEL?: string;
  INGEST_TOKEN_SHA256?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!isBeta(env)) return json({ error: "Delete is enabled only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  if (!env.SINGLET_DATA) return json({ error: "SINGLET_DATA binding missing" }, 503);
  const q = new URL(request.url).searchParams;
  const apply = q.get("apply") === "1";
  const gseParam = (q.get("gse") ?? "").trim().toUpperCase();
  const key = (q.get("key") ?? "").trim();
  if (!!gseParam === !!key) return json({ error: "Give exactly one of gse or key" }, 400);
  try {
    if (gseParam) {
      if (!GSE_RE.test(gseParam)) return json({ error: "gse must look like GSE123" }, 400);
      const manifestKey = `s1/m/${gseParam}.json`;
      const samples = await env.DB.prepare(`SELECT gsm_id, key, rev FROM s1_sample WHERE gse_id = ?`).bind(gseParam).all<{ gsm_id: string; key: string; rev: string }>();
      const rows = samples.results ?? [];
      const hadManifest = !!(await env.SINGLET_DATA.head(manifestKey));
      const out = { gse_id: gseParam, apply, manifest: manifestKey, manifest_in_r2: hadManifest, sample_rows: rows.length, objects: rows.map((r) => r.key) };
      if (!apply) return json({ ...out, dry_run: true });
      if (hadManifest) await env.SINGLET_DATA.delete(manifestKey); // readers stop seeing the study before its rows go
      const res = await env.DB.batch([
        env.DB.prepare(`DELETE FROM s1_sample WHERE gse_id = ?`).bind(gseParam),
        env.DB.prepare(`DELETE FROM s1_migration WHERE gse_id = ?`).bind(gseParam),
        env.DB.prepare(`DELETE FROM s1_study WHERE gse_id = ?`).bind(gseParam),
      ]);
      const changes = res.map((r) => (r as { meta?: { changes?: number } }).meta?.changes ?? null);
      return json({ ...out, deleted: true, rows_deleted: { s1_sample: changes[0], s1_migration: changes[1], s1_study: changes[2] } });
    }
    const c = classifyObjectKey(key);
    if (!c.ok) return json({ error: c.error }, 422);
    if (c.kind !== "sample" && c.kind !== "label") return json({ error: `${c.kind} objects are not deleted here` }, 422);
    const gsm = /^s1\/[sa]\/(GSM\d+)\//.exec(key)?.[1] ?? "";
    const ref =
      c.kind === "sample"
        ? await env.DB.prepare(`SELECT 1 AS x FROM s1_sample WHERE key = ? LIMIT 1`).bind(key).first()
        : await env.DB.prepare(`SELECT 1 AS x FROM s1_sample WHERE gsm_id = ? LIMIT 1`).bind(gsm).first();
    if (ref) return json({ error: "The catalog still references this object; delete the study first", key }, 409);
    const head = await env.SINGLET_DATA.head(key);
    if (!head) return json({ key, exists: false, apply }, 404);
    if (!apply) return json({ key, exists: true, bytes: head.size, apply, dry_run: true });
    await env.SINGLET_DATA.delete(key);
    return json({ key, exists: true, bytes: head.size, apply, deleted: true });
  } catch (e) {
    if (/no such table/i.test(String(e))) return json({ error: "The catalog tables are missing" }, 503);
    return serverError(e, "ingest s1-delete");
  }
};
