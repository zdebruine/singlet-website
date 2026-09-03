/**
 * Edge caching helper for D1-backed endpoints.
 *
 * Several catalog endpoints run unbounded GROUP BY / COUNT scans over `gsm`.
 * D1's free tier has a daily row-read cap, and running those on every pageview
 * exhausted it (2026-09-03 outage). Wrap those handlers in `cachedJson` so the
 * Cloudflare edge serves repeat requests without touching D1.
 */

/** Default TTL for catalog aggregate endpoints (catalog updates ~daily). */
export const CATALOG_CACHE_TTL = 120;

/**
 * Serve `producer()` through Cloudflare's Cache API, keyed on the request URL.
 * The cache write happens in `waitUntil` so the response isn't delayed.
 */
export async function cachedJson(
  request: Request,
  waitUntil: (p: Promise<unknown>) => void,
  producer: () => Promise<Response>,
  ttl: number = CATALOG_CACHE_TTL
): Promise<Response> {
  // Only GETs are cacheable; POST bodies aren't part of the cache key.
  if (request.method !== "GET") return producer();

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("X-Edge-Cache", "HIT");
    return new Response(hit.body, { status: hit.status, headers });
  }

  const fresh = await producer();
  if (fresh.status === 200) {
    const headers = new Headers(fresh.headers);
    headers.set("Cache-Control", `public, max-age=${ttl}, s-maxage=${ttl}`);
    const toCache = new Response(fresh.clone().body, { status: 200, headers });
    waitUntil(cache.put(cacheKey, toCache));
    headers.set("X-Edge-Cache", "MISS");
    return new Response(fresh.body, { status: 200, headers });
  }
  return fresh;
}
