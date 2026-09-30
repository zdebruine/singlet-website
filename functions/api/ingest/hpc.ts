/**
 * POST /api/ingest/hpc?path=<path> — upload one HPC dashboard JSON snapshot
 * into R2 (`singlet-hpc-dashboard`, binding HPC_DASHBOARD), replacing the old
 * bot commits of public/data/hpc/* to git main.
 *
 *   curl -fsS -X POST "https://singlet.bio/api/ingest/hpc?path=latest.json" \
 *     -H "X-Ingest-Token: $SINGLET_INGEST_TOKEN" \
 *     -H "Content-Type: application/json" --data-binary @latest.json
 *
 * Auth: the same `X-Ingest-Token` as POST /api/ingest/:table
 * (../../_shared/ingest-auth). `path` must be on the allowlist in
 * ../../_shared/hpc-dashboard (latest.json, timeseries.json,
 * history/<YYYYMMDDTHHZ>.json, anvil/…). The body must be a JSON object or
 * array of at most 2 MB; it is stored byte-for-byte as application/json and
 * served by GET /api/hpc/<path>.
 *
 * Routing: this static file wins over the dynamic ./[table].ts for
 * /api/ingest/hpc (Pages prefers the more specific route). It exports POST
 * only, so a GET falls through to [table].ts and gets its JSON 404.
 */
import { checkIngestToken } from "../../_shared/ingest-auth";
import { HPC_MAX_BODY_BYTES, hpcPath } from "../../_shared/hpc-dashboard";

interface Env {
  HPC_DASHBOARD?: R2Bucket;
  INGEST_TOKEN_SHA256?: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const bucket = env.HPC_DASHBOARD;
  if (!bucket) return json({ error: "HPC_DASHBOARD bucket is not bound" }, 503);

  // ── Path allow-list ───────────────────────────────────────────────────────
  const url = new URL(request.url);
  const path = hpcPath(url.searchParams.get("path"));
  if (!path) {
    return json(
      {
        error:
          "Invalid ?path=. Allowed: latest.json, timeseries.json, history/<YYYYMMDDTHHZ>.json, " +
          "anvil/<name>.json, anvil/history/<YYYYMMDDTHHZ>.json",
      },
      400
    );
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > HPC_MAX_BODY_BYTES) {
    return json({ error: "Body exceeds 2 MB" }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > HPC_MAX_BODY_BYTES) return json({ error: "Body exceeds 2 MB" }, 413);
  if (bytes.byteLength === 0) return json({ error: "Body is empty" }, 400);
  let parsed: unknown;
  try {
    // Both options spelled out: workers-types declares them as required.
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return json({ error: "Body must be UTF-8 JSON" }, 400);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return json({ error: "Body must be a JSON object or array" }, 400);
  }

  // ── Store ─────────────────────────────────────────────────────────────────
  try {
    const obj = await bucket.put(path, bytes, {
      httpMetadata: { contentType: "application/json" },
    });
    return json({ ok: true, path, bytes: bytes.byteLength, etag: obj?.etag ?? null }, 200);
  } catch (e) {
    return json({ error: String(e), path }, 500);
  }
};
