/**
 * POST /api/ingest/v2-study — record a migrated study in the v2 catalog (schema/032_v2_catalog.sql).
 * GET  /api/ingest/v2-study?gse=GSE… — what the catalog holds for one study (counts per rev, migration row).
 *
 * Auth: `X-Ingest-Token`, as the other /api/ingest routes (../../_shared/ingest-auth). Idempotent: re-posting a manifest whose rev is
 * already stored writes none of its rows (send `force: true` to rewrite them).
 *
 * Body (JSON, at most 8 MiB):
 *
 *   { "manifest": <study manifest, docs/format-v2.md section 7>,
 *     "final": true,                 // default true; false on every slice but the last of a sliced post
 *     "force": false,                // default false; true rewrites rows of a rev that is already stored
 *     "migration": { "status": "verified", "verify_ok": true, "legacy_etag": "…", "legacy_bytes": 187066350, "v2_bytes": 123456789,
 *                    "verified_at": "2026-10-23T08:00:00Z", "ledger_key": "v2/ledger/GSE1.jsonl", "error": null } }
 *
 *   { "gse_id": "GSE…", "migration": { "status": "failed", "error": "…" } }      // state only, no manifest
 *
 * There is no implicit "live". A study is served from v2 only while its migration row says `verified` or `retired`, and those two statuses
 * are refused (422) without `verify_ok: true`. A manifest posted without a migration block is recorded as `uploaded` (not served), and
 * when its rev is the one already stored the migration row is left as it is.
 *
 * The manifest is validated, not trusted: format "singlet-v2", manifest_version 1, a 16-hex rev, every sample key
 * v2/s/<GSM>/<32 hex>.s2 for its own GSM, members with integer kind/off/len. A sample that lists a restricted member
 * (per-donor genotype layers, see _shared/restricted.ts) is refused with 422: such a member must not be in a public
 * object at all. At most 400 samples per post; a larger study is sent in slices that each carry `n_samples` (the
 * study total) and `bytes` (the total over all samples), with `final: false` until the last.
 *
 * Order of writes, so that no reader sees a mix of two revisions: the new rev's sample rows first (primary key gse_id, rev, gsm_id, so they
 * sit beside the served rev's rows, schema/033); then, on the final post, ONE atomic batch: the v2_study row (this flips the rev), the
 * removal of every other rev's sample rows, the migration row. If the posted rev is already stored, nothing of the study is rewritten.
 * Rows written per sample: 3 when new, 3 when removed with an older rev (table row, primary-key index, gsm_id index). The response carries
 * `rows_written`, the sum of D1's own meta.rows_written for the post, so the cost can be read off the first real post.
 *
 * 503 with a clear message when schema/032 or schema/033 has not been applied.
 */
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";
import {
  GSE_RE,
  MAX_BODY_BYTES,
  V2ManifestError,
  getV2Migration,
  getV2Study,
  ingestStatements,
  parseIngestBody,
} from "../../_shared/v2-catalog";

interface Env {
  DB: D1Database;
  INGEST_TOKEN_SHA256?: string;
}

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "https://singlet.bio",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Ingest-Token",
  Vary: "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const SERVED = new Set(["verified", "retired"]);

/** What D1 says this post cost: the sum of meta.rows_written (table and index rows) over every statement, or null when the binding does not report it. */
function rowsWritten(results: unknown[]): number | null {
  let total = 0;
  for (const r of results) {
    const n = (r as { meta?: { rows_written?: unknown } } | null)?.meta?.rows_written;
    if (typeof n !== "number") return null;
    total += n;
  }
  return results.length ? total : 0;
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: HEADERS });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const started = Date.now();

  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: "Body exceeds 8 MiB" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Body exceeds 8 MiB" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  try {
    const parsed = parseIngestBody(body);
    const stamp = nowIso();
    // The rev already stored decides what is rewritten: an unchanged rev costs no sample or study rows (see ingestStatements).
    const stored = parsed.study ? await env.DB.prepare(`SELECT rev FROM v2_study WHERE gse_id = ?`).bind(parsed.gse).first<{ rev: string }>() : null;
    const { batches, tail, unchanged } = ingestStatements(env.DB, parsed, stamp, stored?.rev ?? null);
    const results: unknown[] = [];
    for (const batch of batches) results.push(...(await env.DB.batch(batch)));
    // The tail is one atomic batch: the v2_study row (the flip), the removal of the other revs' sample rows, the migration row.
    if (tail.length) results.push(...(await env.DB.batch(tail)));
    // A study that is now served from v2 but has no legacy file (gse_meta.has_bundle = 0) is queued for the catalog crank, which recomputes
    // has_bundle from the v2 tables. Best effort and no write at all for a study with a legacy file (the WHERE matches nothing).
    if (parsed.final && parsed.migration && SERVED.has(parsed.migration.status)) {
      await env.DB.prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ? AND COALESCE(has_bundle, 0) = 0`)
        .bind(parsed.gse)
        .run()
        .catch(() => undefined);
    }
    return json({
      ok: true,
      gse_id: parsed.gse,
      rev: parsed.study?.rev ?? null,
      unchanged,
      samples_written: unchanged ? 0 : (parsed.study?.samples.length ?? 0),
      rows_written: rowsWritten(results),
      n_samples: parsed.study?.n_samples ?? null,
      final: parsed.final,
      migration_status: parsed.migration && parsed.final && !(parsed.migrationImplicit && unchanged) ? parsed.migration.status : null,
      ms: Date.now() - started,
    });
  } catch (e) {
    if (e instanceof V2ManifestError) return json({ error: e.message }, e.status);
    if (/no such table/i.test(String(e))) return json({ error: "The v2 catalog tables are missing: apply schema/032_v2_catalog.sql and schema/033_v2_sample_rev_key.sql first" }, 503);
    if (/does not match any (PRIMARY KEY|UNIQUE)/i.test(String(e))) return json({ error: "v2_sample still has the 032 key: apply schema/033_v2_sample_rev_key.sql first" }, 503);
    return serverError(e, "ingest v2-study");
  }
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const gse = (new URL(request.url).searchParams.get("gse") ?? "").trim().toUpperCase();
  if (!GSE_RE.test(gse)) return json({ error: "gse must look like GSE123" }, 400);
  try {
    const [study, migration] = await Promise.all([getV2Study(env.DB, gse), getV2Migration(env.DB, gse)]);
    const revs = await env.DB.prepare(`SELECT rev, COUNT(*) AS n FROM v2_sample WHERE gse_id = ? GROUP BY rev`)
      .bind(gse)
      .all<{ rev: string; n: number }>()
      .catch(() => null);
    return json({
      gse_id: gse,
      study,
      migration,
      sample_rows_by_rev: revs?.results ?? [],
      complete: !!study && (revs?.results ?? []).length === 1 && revs!.results[0].rev === study.rev && Number(revs!.results[0].n) === study.n_samples,
    });
  } catch (e) {
    return serverError(e, "ingest v2-study status");
  }
};
