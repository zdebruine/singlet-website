/**
 * POST /api/ingest/beta-catalog?n=20[&gse=GSE…]   Beta channel only (403 elsewhere), X-Ingest-Token.
 *
 * Writes the catalog rows (gse, gsm) for published Beta studies that do not have them yet or whose rev changed since the last sync
 * (_shared/beta-catalog). Bounded: at most `n` studies per call (default 20, max 50). Returns { synced, failed, remaining }.
 * Follow it with the refresh-next and index-next cranks (GET /api/ingest/refresh-next, index-next), which build gse_meta and
 * sample_qc; workers/beta-catalog-cron runs all three every 10 minutes. Each call also sets gsm.protocol to the engine's call where
 * sample_qc has one (applyEngineProtocol), keeping the inherited label in gsm.protocol_source_label.
 */
import { applyEngineProtocol, syncStudies } from "../../_shared/beta-catalog";
import { isBeta } from "../../_shared/channel";
import { serverError } from "../../_shared/errors";
import { checkIngestToken } from "../../_shared/ingest-auth";

interface Env {
  DB: D1Database;
  CHANNEL?: string;
  INGEST_TOKEN_SHA256?: string;
  ALPHA_API?: string;
  D1_DAILY_WRITE_ROWS?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isBeta(env)) return json({ error: "The Beta catalog sync runs only on the beta channel" }, 403);
  const auth = await checkIngestToken(request, env);
  if (!auth.ok) return json({ error: auth.error }, 401);
  const url = new URL(request.url);
  const n = Math.min(Math.max(Number(url.searchParams.get("n")) || 20, 1), 50);
  const only = [...new Set(url.searchParams.getAll("gse").flatMap((v) => v.split(",")))].filter((g) => /^GSE\d+$/.test(g));
  try {
    const started = Date.now();
    const r = await syncStudies(env.DB, n, { alphaApi: env.ALPHA_API, only: only.length ? only : undefined });
    const protocol = await applyEngineProtocol(env.DB, env);          // chemistry from the engine's call, the inherited label kept
    return json({ ...r, protocol, ms: Date.now() - started });
  } catch (e) {
    return serverError(e, "ingest beta-catalog");
  }
};
