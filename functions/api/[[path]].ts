/**
 * Any /api/* path no other function handles (unknown path, or a method the
 * matching route does not export) answers a JSON 404. Without this the SPA
 * fallback in public/_redirects served index.html with a 200.
 *
 * Pages tries more specific routes first, so every other file under
 * functions/api keeps its paths; this catch-all only sees the leftovers.
 */
import { CORS_HEADERS } from "../_shared/cors";

export const onRequest: PagesFunction = () =>
  new Response(JSON.stringify({ error: "not_found", message: "Unknown API endpoint." }), {
    status: 404,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
