/**
 * Edge caching helper for D1-backed endpoints.
 *
 * Several catalog endpoints run aggregate scans over `gsm` / `gse_meta`. D1's
 * free tier has a daily row-read cap, and running those on every pageview
 * exhausted it (2026-09-03 outage). Wrap those handlers in `cachedJson` so the
 * Cloudflare edge serves repeat requests without touching D1.
 */

/** Default TTL for catalog aggregate endpoints (catalog updates ~daily). */
export const CATALOG_CACHE_TTL = 120;
export const FACETS_CACHE_TTL = 300;

export interface CachedJsonOpts {
  ttl?: number;
  /**
   * Cache key override — a canonical query string (sorted params). When
   * omitted the raw request URL is the key. Always scoped to the request path.
   */
  key?: string;
}

/**
 * Serve `producer()` through Cloudflare's Cache API, keyed on the request URL
 * (or a canonical key). The cache write happens in `waitUntil` so the response
 * isn't delayed.
 */
export async function cachedJson(
  request: Request,
  waitUntil: (p: Promise<unknown>) => void,
  producer: () => Promise<Response>,
  ttlOrOpts: number | CachedJsonOpts = CATALOG_CACHE_TTL
): Promise<Response> {
  const opts: CachedJsonOpts = typeof ttlOrOpts === "number" ? { ttl: ttlOrOpts } : ttlOrOpts;
  const ttl = opts.ttl ?? CATALOG_CACHE_TTL;

  // Only GETs are cacheable; POST bodies aren't part of the cache key.
  if (request.method !== "GET") return producer();

  let cache: Cache | null = null;
  try {
    cache = (caches as unknown as { default?: Cache }).default ?? null;
  } catch {
    cache = null;
  }
  if (!cache) return producer();

  const url = new URL(request.url);
  const keyUrl = opts.key != null ? `${url.origin}${url.pathname}?${opts.key}` : url.toString();
  const cacheKey = new Request(keyUrl, { method: "GET" });

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
    waitUntil(cache.put(cacheKey, toCache).catch(() => undefined));
    headers.set("X-Edge-Cache", "MISS");
    return new Response(fresh.body, { status: 200, headers });
  }
  return fresh;
}

// ── meta_cache (D1-backed, global) ──────────────────────────────────────────

const isolateMemo = new Map<string, { value: unknown; at: number }>();

/**
 * Read-through cache for expensive precomputed blobs (unfiltered facets, cell
 * type vocabulary). Stored in the D1 `meta_cache` table so every colo shares
 * one computation; refreshed lazily once `maxAgeMs` has passed. A short
 * per-isolate memo avoids re-reading the blob on every request.
 */
export async function metaCached<T>(
  db: D1Database,
  waitUntil: (p: Promise<unknown>) => void,
  key: string,
  maxAgeMs: number,
  compute: () => Promise<T>
): Promise<T> {
  const memo = isolateMemo.get(key);
  if (memo && Date.now() - memo.at < 5 * 60 * 1000) return memo.value as T;

  let row: { value: string; updated_at: string } | null = null;
  try {
    row = await db
      .prepare(`SELECT value, updated_at FROM meta_cache WHERE key = ?`)
      .bind(key)
      .first<{ value: string; updated_at: string }>();
  } catch {
    row = null;
  }
  if (row) {
    const age = Date.now() - Date.parse(row.updated_at ?? "");
    if (Number.isFinite(age) && age < maxAgeMs) {
      try {
        const value = JSON.parse(row.value) as T;
        isolateMemo.set(key, { value, at: Date.now() });
        return value;
      } catch {
        /* recompute */
      }
    }
  }

  const value = await compute();
  isolateMemo.set(key, { value, at: Date.now() });
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  waitUntil(
    db
      .prepare(`INSERT OR REPLACE INTO meta_cache (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind(key, JSON.stringify(value), nowIso)
      .run()
      .catch(() => undefined)
  );
  return value;
}
