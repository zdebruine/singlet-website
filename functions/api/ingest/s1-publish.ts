/**
 * Rolling ingest, step 2 and 3: publish a study's manifest. Beta channel only (403 elsewhere).
 *
 *   POST /api/ingest/s1-publish    body as POST /api/ingest/s1-study: { manifest, final?, force?, migration? }
 *
 * Order, so that a reader never sees a manifest whose objects are missing:
 *   1. every sample object the manifest names (and every label sidecar `s1/a/…` it mentions) must already be in the bucket with the size and
 *      SHA-256 the manifest declares (PUT /api/ingest/s1-object stored the SHA-256 beside the object); otherwise 409 and nothing is written;
 *   2. the manifest is written to R2 at s1/m/<GSE>.json (skipped when the stored one is byte-identical);
 *   3. the D1 rows are applied by the same code as s1-study (_shared/s1-apply): sample rows of the new rev, then one atomic batch that flips
 *      s1_study and removes the older rev's rows.
 * Idempotent: re-posting the same manifest writes no R2 object and no D1 row. A sample re-run gets a new object key and so a new rev; the
 * old object stays in the bucket (immutable, harmless) and the manifest points at the new one.
 *
 * Without a migration block the study is recorded as `verified` (the checks above are the verification: sizes and SHA-256 of every object).
 * The response carries `rows_written` (D1's own count for this post), `r2_manifest` ("written" | "unchanged") and `objects_checked`.
 *
 * D1 cost per publish (measured: 5 samples replacing a 3-sample rev wrote 21): 3 rows per sample of the new rev, 1 per sample of the rev it replaces, about 3 for the study, migration and queue
 * rows. A publish after every sample of an n-sample study therefore writes about 4n rows each time; publish once per job or every k samples.
 */
import { isBeta } from "../../_shared/channel";
import { serverError } from "../../_shared/errors";
import { sha256Hex } from "../../_shared/hash";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { applyIngest } from "../../_shared/s1-apply";
import { MAX_BODY_BYTES, S1ManifestError, manifestKey, parseIngestBody } from "../../_shared/s1-catalog";

interface Env {
  DB: D1Database;
  SINGLET_DATA?: R2Bucket;
  CHANNEL?: string;
  INGEST_TOKEN_SHA256?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const LABEL_KEY_RE = /s1\/a\/GSM\d+\/[0-9a-f]{32}\.parquet/g;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isBeta(env)) return json({ error: "Rolling ingest is enabled only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const bucket = env.SINGLET_DATA;
  if (!bucket) return json({ error: "SINGLET_DATA binding missing" }, 503);
  const started = Date.now();

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Body exceeds 8 MiB" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  try {
    // Only a new rev gets a migration row: re-posting a stored rev must write nothing (a fresh verified_at would rewrite the row every time).
    const stored = body.manifest !== undefined && body.force !== true
      ? await env.DB.prepare(`SELECT rev FROM s1_study WHERE gse_id = ?`).bind((body.manifest as { gse?: string }).gse ?? "").first<{ rev: string }>().catch(() => null)
      : null;
    if (body.manifest !== undefined && body.migration === undefined && stored?.rev !== (body.manifest as { rev?: string }).rev) {
      const m = body.manifest as { n_samples?: number; samples?: unknown[]; bytes?: number };
      body.migration = { status: "verified", verify_ok: true, n_samples: m.n_samples ?? m.samples?.length, s1_bytes: m.bytes, verified_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    }
    const parsed = parseIngestBody(body);
    const study = parsed.study;
    let r2Manifest: "written" | "unchanged" | "skipped" = "skipped";
    let checked = 0;

    if (study) {
      // 1. objects first
      const problems: { key: string; problem: string }[] = [];
      const expect = study.samples.map((s) => ({ key: s.key, bytes: s.bytes, sha256: s.sha256 }));
      for (const k of new Set(JSON.stringify(body.manifest).match(LABEL_KEY_RE) ?? [])) expect.push({ key: k, bytes: -1, sha256: null });
      for (let i = 0; i < expect.length; i += 8) {
        await Promise.all(
          expect.slice(i, i + 8).map(async (e) => {
            const h = await bucket.head(e.key);
            checked++;
            if (!h) problems.push({ key: e.key, problem: "missing" });
            else if (e.bytes >= 0 && h.size !== e.bytes) problems.push({ key: e.key, problem: `size ${h.size} != manifest ${e.bytes}` });
            else if (e.sha256 && h.customMetadata?.sha256 !== e.sha256) problems.push({ key: e.key, problem: "sha256 differs from the manifest" });
          }),
        );
      }
      if (problems.length) return json({ error: "Objects named by the manifest are not all in the bucket; nothing written", problems: problems.slice(0, 50), n_problems: problems.length }, 409);

      // 2. manifest to R2 (only a complete post: a slice of a sliced study is D1 only)
      if (parsed.final) {
        const text = JSON.stringify(body.manifest);
        const bytes = new TextEncoder().encode(text);
        const sha = await sha256Hex(text);
        const key = manifestKey(study.gse);
        const have = await bucket.head(key);
        if (have && have.customMetadata?.sha256 === sha) r2Manifest = "unchanged";
        else {
          await bucket.put(key, bytes, { sha256: sha, httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: sha, rev: study.rev } });
          r2Manifest = "written";
        }
      }
    }

    // 3. D1
    const applied = await applyIngest(env.DB, parsed, started);
    return json({ ...applied, r2_manifest: r2Manifest, objects_checked: checked });
  } catch (e) {
    if (e instanceof S1ManifestError) return json({ error: e.message }, e.status);
    if (/no such table/i.test(String(e))) return json({ error: "The catalog tables are missing in this channel's D1 database" }, 503);
    return serverError(e, "ingest s1-publish");
  }
};

/**
 * GET /api/ingest/s1-publish?n=10 — the newest samples in this channel's catalog (s1_sample.updated_at), for the daily product test
 * (scripts/beta/product-test.mjs). Token-protected, read only.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const n = Math.min(Math.max(Number(new URL(request.url).searchParams.get("n")) || 10, 1), 100);
  try {
    const rs = await env.DB.prepare(
      `SELECT sm.gse_id, sm.gsm_id, sm.key, sm.bytes, sm.sha256, sm.rev, sm.updated_at
         FROM s1_sample sm JOIN s1_study st ON st.gse_id = sm.gse_id AND st.rev = sm.rev
        ORDER BY sm.updated_at DESC, sm.gsm_id DESC LIMIT ?`,
    )
      .bind(n)
      .all();
    return json({ channel: env.CHANNEL ?? null, samples: rs.results });
  } catch (e) {
    return serverError(e, "ingest s1-publish recent");
  }
};
