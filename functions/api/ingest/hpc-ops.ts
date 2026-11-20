/**
 * POST /api/ingest/hpc-ops — one `hpc-dashboard/1` snapshot from the Clipper collector (see _shared/hpc-ops.ts).
 *
 * Auth: `X-Ingest-Token`, as POST /api/ingest/hpc. Stores the snapshot as ops/latest.json and appends its `point` to
 * ops/series.json in the HPC_DASHBOARD bucket (one writer, once per 30 minutes: two small puts and one get per run).
 */
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";
import { appendPoint, checkSnapshot, OPS_LATEST, OPS_MAX_BODY_BYTES, OPS_SERIES, type Point } from "../../_shared/hpc-ops";

interface Env {
  HPC_DASHBOARD?: R2Bucket;
  INGEST_TOKEN_SHA256?: string;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const bucket = env.HPC_DASHBOARD;
  if (!bucket) return json({ error: "HPC_DASHBOARD bucket is not bound" }, 503);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return json({ error: "Body is empty" }, 400);
  if (bytes.byteLength > OPS_MAX_BODY_BYTES) return json({ error: "Body exceeds 512 KB" }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return json({ error: "Body must be UTF-8 JSON" }, 400);
  }
  const checked = checkSnapshot(parsed);
  if (!checked.ok) return json({ error: checked.error }, 400);

  try {
    let series: Point[] = [];
    const prev = await bucket.get(OPS_SERIES);
    if (prev) {
      try {
        const j = (await prev.json()) as { points?: Point[] };
        if (Array.isArray(j.points)) series = j.points;
      } catch {
        /* a damaged series restarts from this point */
      }
    }
    const next = appendPoint(series, checked.point, Date.now());
    await bucket.put(OPS_SERIES, JSON.stringify({ schema: "hpc-series/1", points: next }), { httpMetadata: { contentType: "application/json" } });
    await bucket.put(OPS_LATEST, bytes, { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true, points: next.length, bytes: bytes.byteLength }, 200);
  } catch (e) {
    return serverError(e, "hpc-ops upload");
  }
};
