/**
 * First-party relay for PostHog analytics (src/lib/analytics.ts):
 * /relay/static/* → the PostHog asset CDN (lazy-loaded scripts such as
 * heatmaps), everything else under /relay → the PostHog ingestion API.
 *
 * The visitor's cookies and credentials are never forwarded: the singlet.bio
 * session cookie stays here. The visitor's address goes on as
 * X-Forwarded-For so PostHog can place them by country; PostHog does not
 * store the raw address (project setting "Discard client IP data" is on).
 * Writes nothing to D1.
 */
export const API_HOST = "us.i.posthog.com";
export const ASSET_HOST = "us-assets.i.posthog.com";

const DROP_HEADERS = ["cookie", "authorization", "x-api-key", "host"];

/** The PostHog URL for a /relay request, or null for anything outside /relay. */
export function relayTarget(requestUrl: string): URL | null {
  const url = new URL(requestUrl);
  const m = /^\/relay(\/.*)?$/.exec(url.pathname);
  if (!m) return null;
  const path = m[1] ?? "/";
  const host = path.startsWith("/static/") ? ASSET_HOST : API_HOST;
  return new URL(`https://${host}${path}${url.search}`);
}

export const onRequest: PagesFunction = async ({ request }) => {
  const target = relayTarget(request.url);
  if (!target) return new Response("Not found", { status: 404 });
  const headers = new Headers(request.headers);
  for (const name of DROP_HEADERS) headers.delete(name);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("X-Forwarded-For", ip);
  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
  });
  const out = new Headers(res.headers);
  out.delete("set-cookie");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
};
