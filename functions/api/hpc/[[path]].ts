/**
 * GET /api/hpc/<path> — one HPC dashboard JSON snapshot for the /hpc page.
 *
 * Served from the R2 bucket `singlet-hpc-dashboard` (binding HPC_DASHBOARD),
 * where the cluster orchestrators upload with POST /api/ingest/hpc. When the
 * object is not there (the bucket is unbound, or a bot still commits to git
 * instead), the committed static copy at /data/hpc/<path> is returned, so the
 * page keeps working through the switch-over. `path` must be on the allowlist
 * in ../../_shared/hpc-dashboard; anything else is a JSON 404.
 *
 * Response header X-Hpc-Source says which copy was served ("r2" or "static").
 */
import { CORS_HEADERS } from "../../_shared/cors";
import { hpcPath } from "../../_shared/hpc-dashboard";

// Pages adds env.ASSETS (this deployment's static files) to every context.
interface Env {
  HPC_DASHBOARD?: R2Bucket;
}

const CACHE_CONTROL = "public, max-age=60";

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found", message: "Unknown HPC dashboard file." }), {
    status: 404,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

const serve: PagesFunction<Env> = async ({ request, env, params }) => {
  const segs = params.path;
  const path = hpcPath(Array.isArray(segs) ? segs.join("/") : segs);
  if (!path) return notFound();

  if (env.HPC_DASHBOARD) {
    try {
      const obj = await env.HPC_DASHBOARD.get(path);
      if (obj) {
        return new Response(obj.body, {
          headers: {
            ...CORS_HEADERS,
            "Cache-Control": CACHE_CONTROL,
            ETag: obj.httpEtag,
            "Last-Modified": obj.uploaded.toUTCString(),
            "X-Hpc-Source": "r2",
          },
        });
      }
    } catch {
      // R2 unavailable: fall back to the static copy below.
    }
  }

  if (env.ASSETS) {
    try {
      const res = await env.ASSETS.fetch(new URL(`/data/hpc/${path}`, request.url));
      // A missing asset comes back as the SPA's index.html (text/html, 200), so
      // only a JSON response counts as found.
      if (res.ok && /json/i.test(res.headers.get("Content-Type") ?? "")) {
        return new Response(res.body, {
          headers: { ...CORS_HEADERS, "Cache-Control": CACHE_CONTROL, "X-Hpc-Source": "static" },
        });
      }
      await res.body?.cancel();
    } catch {
      // No static copy either: a 404 below.
    }
  }

  return notFound();
};

export const onRequestGet = serve;
export const onRequestHead = serve;
