/**
 * GET /api/admin/hpc?range=24h|7d|all — the latest Clipper snapshot and the history points for the /HPC-dashboard page.
 * Site admins only (ANALYTICS_ADMINS, the same list as /api/admin/analytics). Data posted by POST /api/ingest/hpc-ops.
 */
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";
import { inRange, OPS_LATEST, OPS_SERIES, type Point, type Range } from "../../_shared/hpc-ops";
import { isAnalyticsAdmin } from "./analytics";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed", message: "GET only." }, 405);
  const who = await requireUser(request, env, waitUntil, "Sign in to see the HPC dashboard.");
  if (!who.ok) return who.response;
  if (!isAnalyticsAdmin(who.identity.userId, env.ANALYTICS_ADMINS)) return json({ error: "forbidden", message: "The HPC dashboard is for site admins." }, 403);
  if (!env.HPC_DASHBOARD) return json({ error: "not_configured", message: "The HPC_DASHBOARD bucket is not bound." }, 503);

  const r = new URL(request.url).searchParams.get("range") ?? "24h";
  const range: Range = r === "7d" || r === "all" ? r : "24h";
  const [latestObj, seriesObj] = await Promise.all([env.HPC_DASHBOARD.get(OPS_LATEST), env.HPC_DASHBOARD.get(OPS_SERIES)]);
  let latest: unknown = null;
  let points: Point[] = [];
  try {
    latest = latestObj ? await latestObj.json() : null;
    const s = seriesObj ? ((await seriesObj.json()) as { points?: Point[] }) : null;
    if (s && Array.isArray(s.points)) points = s.points;
  } catch {
    /* a damaged object reads as missing */
  }
  const now = Date.now();
  return json({ range, now: new Date(now).toISOString(), latest, points: inRange(points, range, now) });
};
