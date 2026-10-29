/**
 * data.singlet.bio/s1/* (and /v2/*, same keys under the old prefix) — read-only front for the per-sample objects in the R2 bucket `singlet-data`.
 *
 * Keys served (docs/format-s1.md section 2):
 *   s1/s/<GSM>/<32 hex>.s1  sample object, content-addressed        immutable
 *   s1/ref/<32 hex>.pack     side-information pack, content-addressed immutable
 *   s1/ref/index.json       list of packs                            max-age=300
 *   s1/m/<GSE>.json         study manifest (mutable)                 max-age=300
 *   s1/cells/<GSE>.cells       study-level cell tables (per rev)        max-age=300
 *
 * What it adds over the bare R2 custom domain: Range with a correct 206/416, ETag with If-Match / If-None-Match /
 * If-Range (the website's stale-index guard sends If-Match on ranged reads and treats 412 as "reindex"), CORS `*`,
 * the right Content-Type and Cache-Control, and an edge copy in the Cache API that range requests are served from. The copy is filled by a
 * full read of the object: at once for an object up to 32 MiB, on the second ranged miss of the same key in the isolate for a bigger one,
 * and on any full GET.
 *
 * The handler is runtime-neutral (no `env`, no `caches` global): `index.ts` wires the bindings, the tests wire fakes.
 */

import { isBlocked } from "./policy";

export const CACHE_MAX_BYTES = 500 * 1024 * 1024;
/**
 * Up to this size a cold full-object GET is teed (one R2 read feeds the client and the cache). Above it the client is
 * served straight from R2 and the cache is filled by a second, separate read: a tee holds whatever the slower side
 * has not read yet, so a slow client could pin a whole 130 MB sample in a 128 MB isolate.
 */
export const TEE_MAX_BYTES = 8 * 1024 * 1024;
/**
 * A cold Range (or conditional) request starts a background full-object fill only for an object up to this size. For a bigger one the
 * first miss is only remembered for the isolate; the fill starts on the second miss of the same key, or on any full GET. A fill reads the
 * whole object from R2 and streams it into the cache, which for a 130 MB sample costs more than the 10 KB range that was asked for, and
 * most ranged reads of a big sample are one-offs (the stale-index check, a cell slice).
 */
export const RANGE_FILL_MAX_BYTES = 32 * 1024 * 1024;
/** Keys whose first big-object miss is remembered, oldest forgotten first. */
export const MISSES_MAX = 256;

export const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_CONTROL_SHORT = "public, max-age=300";
/** s1/cidx/current.json: a new index version is visible within a minute. */
export const CACHE_CONTROL_POINTER = "public, max-age=60";
const CANONICAL_ORIGIN = "https://data.singlet.bio";
/** Host part of the edge-cache keys. The Cache API is shared by every Worker on the zone, so a second channel (Beta) must not use the same keys: its manifests differ. */
let cacheOrigin = CANONICAL_ORIGIN;
export function setCacheOrigin(origin: string | undefined): void {
  cacheOrigin = origin && /^https:\/\/[a-z0-9.-]+$/i.test(origin) ? origin : CANONICAL_ORIGIN;
}
const ALLOW = "GET, HEAD, OPTIONS";

// ── dependencies ────────────────────────────────────────────────────────────

export interface R2RangeLike {
  offset?: number;
  length?: number;
  suffix?: number;
}
export interface R2ObjectLike {
  size: number;
  /** Quoted entity tag, e.g. "d41d8cd98f00b204e9800998ecf8427e" or "...-3" for a multipart upload. */
  httpEtag: string;
  uploaded: Date;
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream<Uint8Array>;
}
export interface R2BucketLike {
  get(key: string, options?: { range?: R2RangeLike }): Promise<R2ObjectLike | R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
}
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
export interface Deps {
  bucket: R2BucketLike;
  cache: CacheLike | null;
  waitUntil: (p: Promise<unknown>) => void;
  /** Keys whose cache fill is running in this isolate. Defaults to a module-level set. */
  inFlight?: Set<string>;
  /** Keys of big objects (over RANGE_FILL_MAX_BYTES) that a ranged or conditional request has missed once in this isolate. Defaults to a module-level set. */
  misses?: Set<string>;
  /**
   * Overrides RANGE_FILL_MAX_BYTES for this request. The cell-index gather path reads many samples once each and passes 0, so a
   * sample object is only filled into the cache on its second ranged miss in the isolate.
   */
  rangeFillMax?: number;
}

const defaultInFlight = new Set<string>();
const defaultMisses = new Set<string>();

// ── keys ────────────────────────────────────────────────────────────────────

export interface KeyClass {
  /** R2 key, always the validated pathname without its leading slash. */
  key: string;
  contentType: string;
  cacheControl: string;
}

const OCTET = "application/octet-stream";
const JSON_TYPE = "application/json; charset=utf-8";

const KEY_PATTERNS: { re: RegExp; contentType: string; cacheControl: string }[] = [
  { re: /^\/(?:s1|v2)\/s\/GSM\d{1,12}\/[0-9a-f]{32}\.(?:s1|s2)$/, contentType: OCTET, cacheControl: CACHE_CONTROL_IMMUTABLE },
  { re: /^\/(?:s1|v2)\/ref\/[0-9a-f]{32}\.pack$/, contentType: OCTET, cacheControl: CACHE_CONTROL_IMMUTABLE },
  { re: /^\/(?:s1|v2)\/ref\/index\.json$/, contentType: JSON_TYPE, cacheControl: CACHE_CONTROL_SHORT },
  { re: /^\/(?:s1|v2)\/m\/GSE\d{1,12}\.json$/, contentType: JSON_TYPE, cacheControl: CACHE_CONTROL_SHORT },
  { re: /^\/(?:s1|v2)\/cells\/GSE\d{1,12}\.cells$/, contentType: OCTET, cacheControl: CACHE_CONTROL_SHORT },
  // atlas cell index (singlet-bio docs/format-s1-cell-index.md section 3): content-addressed objects, versioned directories, the pointer
  { re: /^\/(?:s1|v2)\/cidx\/obj\/[0-9a-f]{32}\.(scx|parquet)$/, contentType: OCTET, cacheControl: CACHE_CONTROL_IMMUTABLE },
  { re: /^\/(?:s1|v2)\/cidx\/obj\/[0-9a-f]{32}\.json$/, contentType: JSON_TYPE, cacheControl: CACHE_CONTROL_IMMUTABLE },
  { re: /^\/(?:s1|v2)\/cidx\/v\/\d{8}T\d{4}Z-[0-9a-f]{8}\.json$/, contentType: JSON_TYPE, cacheControl: CACHE_CONTROL_IMMUTABLE },
  { re: /^\/(?:s1|v2)\/cidx\/current\.json$/, contentType: JSON_TYPE, cacheControl: CACHE_CONTROL_POINTER },
  // per-cell label sidecars, content-addressed, referenced from the study manifest
  { re: /^\/(?:s1|v2)\/a\/GSM\d{1,12}\/[0-9a-f]{32}\.parquet$/, contentType: OCTET, cacheControl: CACHE_CONTROL_IMMUTABLE },
];

/** Raw request-target pieces that never appear in a valid key, tested before URL normalisation hides them. */
const SUSPICIOUS = /%2f|%5c|%2e|\\|\.\.|\/\//i;

export function classify(requestUrl: string): KeyClass | null {
  let pathname: string;
  try {
    pathname = new URL(requestUrl).pathname;
  } catch {
    return null;
  }
  const rawPath = requestUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").split(/[?#]/)[0];
  if (SUSPICIOUS.test(rawPath)) return null;
  for (const p of KEY_PATTERNS) {
    if (p.re.test(pathname)) return { key: pathname.slice(1), contentType: p.contentType, cacheControl: p.cacheControl };
  }
  return null;
}

// ── Range ───────────────────────────────────────────────────────────────────

export type RangeSpec =
  | { kind: "span"; first: number; last: number | null }
  | { kind: "suffix"; length: number };

/**
 * One byte range, or null when the header is absent or has to be ignored (another unit, bad syntax, last < first,
 * several ranges, numbers beyond 2^53). Ignored means the object is served whole with 200.
 */
export function parseRange(header: string | null): RangeSpec | null {
  if (header == null) return null;
  const m = /^\s*bytes=(\d*)-(\d*)\s*$/i.exec(header);
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    const length = Number(b);
    return Number.isSafeInteger(length) ? { kind: "suffix", length } : null;
  }
  const first = Number(a);
  if (!Number.isSafeInteger(first)) return null;
  if (b === "") return { kind: "span", first, last: null };
  const last = Number(b);
  if (!Number.isSafeInteger(last) || last < first) return null;
  return { kind: "span", first, last };
}

/** Inclusive byte positions against a known size, or null when no byte can be selected. */
export function resolveRange(spec: RangeSpec, size: number): { start: number; end: number } | null {
  if (size <= 0) return null;
  if (spec.kind === "suffix") {
    if (spec.length <= 0) return null;
    return { start: Math.max(0, size - spec.length), end: size - 1 };
  }
  if (spec.first >= size) return null;
  return { start: spec.first, end: Math.min(spec.last ?? size - 1, size - 1) };
}

export function toR2Range(spec: RangeSpec): R2RangeLike {
  if (spec.kind === "suffix") return { suffix: spec.length };
  return spec.last == null ? { offset: spec.first } : { offset: spec.first, length: spec.last - spec.first + 1 };
}

// ── validators ──────────────────────────────────────────────────────────────

interface EtagToken {
  weak: boolean;
  opaque: string;
}

function parseEtags(header: string): { any: boolean; tags: EtagToken[] } {
  const tags: EtagToken[] = [];
  let any = false;
  for (const m of header.matchAll(/(\*)|(W\/)?("[^"]*")/g)) {
    if (m[1]) any = true;
    else tags.push({ weak: !!m[2], opaque: m[3] });
  }
  return { any, tags };
}

const strongEqual = (a: EtagToken, b: EtagToken) => !a.weak && !b.weak && a.opaque === b.opaque;
const weakEqual = (a: EtagToken, b: EtagToken) => a.opaque === b.opaque;

export interface Validators {
  etag: string;
  /** Last-Modified as epoch milliseconds, or null when unknown. */
  lastModifiedMs: number | null;
}

const toSeconds = (ms: number) => Math.floor(ms / 1000);

export type Precondition = "ok" | "not_modified" | "precondition_failed";

/** RFC 9110 13.2.2 for GET and HEAD: If-Match, If-Unmodified-Since, If-None-Match, If-Modified-Since. */
export function evaluatePreconditions(h: Headers, v: Validators): Precondition {
  const cur = parseEtags(v.etag).tags[0];
  const ifMatch = h.get("if-match");
  if (ifMatch != null) {
    const p = parseEtags(ifMatch);
    if (!(p.any || (cur && p.tags.some((t) => strongEqual(t, cur))))) return "precondition_failed";
  } else {
    const ius = h.get("if-unmodified-since");
    if (ius != null && v.lastModifiedMs != null) {
      const t = Date.parse(ius);
      if (Number.isFinite(t) && toSeconds(v.lastModifiedMs) > toSeconds(t)) return "precondition_failed";
    }
  }
  const ifNoneMatch = h.get("if-none-match");
  if (ifNoneMatch != null) {
    const p = parseEtags(ifNoneMatch);
    if (p.any || (cur && p.tags.some((t) => weakEqual(t, cur)))) return "not_modified";
  } else {
    const ims = h.get("if-modified-since");
    if (ims != null && v.lastModifiedMs != null) {
      const t = Date.parse(ims);
      if (Number.isFinite(t) && toSeconds(v.lastModifiedMs) <= toSeconds(t)) return "not_modified";
    }
  }
  return "ok";
}

export type Decision = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "unsatisfiable" };

/** What the Range header (if any) means for an object of `size` bytes. If-Range: strong ETag form only, a date never matches. */
export function rangeDecision(spec: RangeSpec | null, h: Headers, size: number, etag: string): Decision {
  if (!spec) return { kind: "full" };
  const ifRange = h.get("if-range");
  if (ifRange != null) {
    const want = parseEtags(ifRange).tags[0];
    const cur = parseEtags(etag).tags[0];
    if (!want || !cur || !strongEqual(want, cur)) return { kind: "full" };
  }
  const r = resolveRange(spec, size);
  return r ? { kind: "partial", start: r.start, end: r.end } : { kind: "unsatisfiable" };
}

// ── responses ───────────────────────────────────────────────────────────────

const EXPOSE = "Content-Length, Content-Range, Accept-Ranges, ETag, Content-Type, Last-Modified";

function withCommon(h: Headers, cache: string | null): Headers {
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Expose-Headers", EXPOSE);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Timing-Allow-Origin", "*");
  h.set("X-Served-By", "singlet-data");
  if (cache) h.set("X-Cache", cache);
  return h;
}

function jsonError(status: number, error: string, message: string, extra: Record<string, string> = {}, head = false): Response {
  const h = withCommon(new Headers({ "Content-Type": JSON_TYPE, "Cache-Control": "no-store", ...extra }), null);
  return new Response(head ? null : JSON.stringify({ error, message }), { status, headers: h });
}

function preflight(): Response {
  const h = withCommon(new Headers(), null);
  h.set("Access-Control-Allow-Methods", ALLOW);
  h.set("Access-Control-Allow-Headers", "Range, If-Match, If-None-Match, If-Range, If-Modified-Since, If-Unmodified-Since, Content-Type");
  h.set("Access-Control-Max-Age", "86400");
  h.set("Allow", ALLOW);
  return new Response(null, { status: 204, headers: h });
}

function validatorHeaders(cls: KeyClass, v: Validators): Headers {
  const h = new Headers({
    "Content-Type": cls.contentType,
    "Cache-Control": cls.cacheControl,
    "Accept-Ranges": "bytes",
    ETag: v.etag,
  });
  if (v.lastModifiedMs != null) h.set("Last-Modified", new Date(toSeconds(v.lastModifiedMs) * 1000).toUTCString());
  return h;
}

function notModified(cls: KeyClass, v: Validators, cache: string): Response {
  const h = validatorHeaders(cls, v);
  h.delete("Content-Type");
  h.delete("Accept-Ranges");
  return new Response(null, { status: 304, headers: withCommon(h, cache) });
}

function preconditionFailed(v: Validators, cache: string, head: boolean): Response {
  return jsonError(412, "precondition_failed", "The object no longer matches If-Match.", { ETag: v.etag, "X-Cache": cache }, head);
}

function notSatisfiable(size: number, v: Validators, cache: string, head: boolean): Response {
  return jsonError(416, "range_not_satisfiable", `The object is ${size} bytes.`, { "Content-Range": `bytes */${size}`, ETag: v.etag, "X-Cache": cache }, head);
}

function okHeaders(cls: KeyClass, v: Validators, cache: string, length: number, range?: { start: number; end: number; size: number }): Headers {
  const h = validatorHeaders(cls, v);
  h.set("Content-Length", String(length));
  if (range) h.set("Content-Range", `bytes ${range.start}-${range.end}/${range.size}`);
  return withCommon(h, cache);
}

// ── cache ───────────────────────────────────────────────────────────────────

function canonicalRequest(key: string, range?: string | null): Request {
  return new Request(`${cacheOrigin}/${key}`, { method: "GET", headers: range ? { Range: range } : {} });
}

function cacheResponse(cls: KeyClass, v: Validators, size: number, body: ReadableStream<Uint8Array>): Response {
  const h = validatorHeaders(cls, v);
  h.set("Content-Length", String(size));
  return new Response(body, { status: 200, headers: h });
}

function hasBody(o: R2ObjectLike | R2ObjectBodyLike): o is R2ObjectBodyLike {
  return "body" in o && (o as R2ObjectBodyLike).body != null;
}

async function discard(body: ReadableStream<Uint8Array> | null | undefined): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    /* already closed */
  }
}

function validatorsOf(o: R2ObjectLike): Validators {
  const t = o.uploaded instanceof Date ? o.uploaded.getTime() : NaN;
  return { etag: o.httpEtag, lastModifiedMs: Number.isFinite(t) ? t : null };
}

/** Full-object fetch from R2 into the cache, in the background. At most one per key and isolate at a time. */
function scheduleFill(deps: Deps, cls: KeyClass): void {
  if (!deps.cache) return;
  const inFlight = deps.inFlight ?? defaultInFlight;
  if (inFlight.has(cls.key)) return;
  inFlight.add(cls.key);
  const cache = deps.cache;
  deps.waitUntil(
    (async () => {
      try {
        const full = await deps.bucket.get(cls.key);
        if (!full) return;
        if (!hasBody(full) || full.size > CACHE_MAX_BYTES) {
          if (hasBody(full)) await discard(full.body);
          return;
        }
        await cache.put(canonicalRequest(cls.key), cacheResponse(cls, validatorsOf(full), full.size, full.body));
      } catch (e) {
        console.error(`singlet-data: cache fill failed for ${cls.key}:`, e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.delete(cls.key);
      }
    })()
  );
}

/**
 * The fill after a request that did not need the whole object (a Range, or a conditional that ended in 304, 412 or 416). Objects up to
 * RANGE_FILL_MAX_BYTES are filled at once. A bigger one is filled on the second miss of the same key in this isolate; the first miss is
 * remembered (at most MISSES_MAX keys). A full GET does not come through here: it always fills.
 */
function fillAfterPartial(ctx: Ctx, size: number): void {
  if (ctx.alreadyCached || !ctx.deps.cache) return;
  if (size <= (ctx.deps.rangeFillMax ?? RANGE_FILL_MAX_BYTES)) {
    scheduleFill(ctx.deps, ctx.cls);
    return;
  }
  const misses = ctx.deps.misses ?? defaultMisses;
  if (misses.delete(ctx.cls.key)) {
    scheduleFill(ctx.deps, ctx.cls);
    return;
  }
  misses.add(ctx.cls.key);
  while (misses.size > MISSES_MAX) {
    const oldest = misses.values().next().value;
    if (oldest === undefined) break;
    misses.delete(oldest);
  }
}

function scheduleTeePut(deps: Deps, cls: KeyClass, copy: Response): void {
  if (!deps.cache) return;
  const inFlight = deps.inFlight ?? defaultInFlight;
  const cache = deps.cache;
  const guarded = !inFlight.has(cls.key);
  if (guarded) inFlight.add(cls.key);
  deps.waitUntil(
    cache
      .put(canonicalRequest(cls.key), copy)
      .catch((e) => console.error(`singlet-data: cache put failed for ${cls.key}:`, e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (guarded) inFlight.delete(cls.key);
      })
  );
}

// ── request handling ────────────────────────────────────────────────────────

interface Ctx {
  deps: Deps;
  cls: KeyClass;
  head: boolean;
  headers: Headers;
  rangeHeader: string | null;
  spec: RangeSpec | null;
  /** The Cache API already holds this object (it just could not serve the range), so nothing is filled or put. */
  alreadyCached: boolean;
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return preflight();
  if (method !== "GET" && method !== "HEAD") {
    return jsonError(405, "method_not_allowed", `Use ${ALLOW}.`, { Allow: ALLOW });
  }
  const head = method === "HEAD";
  const cls = classify(request.url);
  if (!cls || isBlocked(cls.key)) return jsonError(404, "not_found", "No such object.", {}, head);

  const rangeHeader = request.headers.get("range");
  const ctx: Ctx = { deps, cls, head, headers: request.headers, rangeHeader, spec: parseRange(rangeHeader), alreadyCached: false };

  if (deps.cache) {
    const served = await fromCache(ctx);
    if (served.response) return served.response;
    ctx.alreadyCached = served.cached;
    return fromR2(ctx, "MISS");
  }
  return fromR2(ctx, "BYPASS");
}

/** Total size from a cached response (Content-Length of a 200, Content-Range of a 206 or 416). */
function cachedSize(r: Response): number | null {
  if (r.status === 200) {
    const n = Number(r.headers.get("content-length"));
    return r.headers.has("content-length") && Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  const m = /\/(\d+)$|^bytes \*\/(\d+)$/.exec(r.headers.get("content-range") ?? "");
  return m ? Number(m[1] ?? m[2]) : null;
}

async function fromCache(ctx: Ctx): Promise<{ response: Response | null; cached: boolean }> {
  const { deps, cls, head } = ctx;
  const lookup = async (range: string | null): Promise<Response | undefined> => {
    try {
      return await deps.cache!.match(canonicalRequest(cls.key, range));
    } catch (e) {
      console.error(`singlet-data: cache match failed for ${cls.key}:`, e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };
  let hit = await lookup(ctx.spec ? ctx.rangeHeader : null);
  if (hit && hit.status === 416) {
    // The platform's own 416 carries no ETag, so it cannot answer If-Match: look at the whole entry and decide here.
    await discard(hit.body);
    hit = await lookup(null);
  }
  if (!hit) return { response: null, cached: false };

  const etag = hit.headers.get("etag");
  const size = cachedSize(hit);
  if (!etag || size == null || (hit.status !== 200 && hit.status !== 206 && hit.status !== 416)) {
    await discard(hit.body);
    return { response: null, cached: false };
  }
  const lm = hit.headers.get("last-modified");
  const v: Validators = { etag, lastModifiedMs: lm ? Date.parse(lm) || null : null };

  const pre = evaluatePreconditions(ctx.headers, v);
  if (pre !== "ok") {
    await discard(hit.body);
    return { response: pre === "not_modified" ? notModified(cls, v, "HIT") : preconditionFailed(v, "HIT", head), cached: true };
  }

  const decision = rangeDecision(ctx.spec, ctx.headers, size, etag);
  if (decision.kind === "unsatisfiable") {
    await discard(hit.body);
    return { response: notSatisfiable(size, v, "HIT", head), cached: true };
  }

  if (decision.kind === "full") {
    let full = hit;
    if (hit.status !== 200) {
      // Range was forwarded but If-Range says the client's copy is stale: ask again for the whole entry.
      await discard(hit.body);
      const again = await lookup(null);
      if (!again || again.status !== 200) {
        await discard(again?.body);
        return { response: null, cached: false };
      }
      full = again;
    }
    if (head) await discard(full.body);
    return { response: new Response(head ? null : full.body, { status: 200, headers: okHeaders(cls, v, "HIT", size) }), cached: true };
  }

  // partial: the platform slices a cached 200 for a Range match (documented); if it did not, read the range from R2.
  const want = { start: decision.start, end: decision.end, size };
  const length = want.end - want.start + 1;
  const range = hit.status === 206 ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(hit.headers.get("content-range") ?? "") : null;
  const sliced = range && Number(range[1]) === want.start && Number(range[2]) === want.end && Number(range[3]) === size;
  if (!sliced) {
    await discard(hit.body);
    return { response: null, cached: true };
  }
  if (head) await discard(hit.body);
  return { response: new Response(head ? null : hit.body, { status: 206, headers: okHeaders(cls, v, "HIT", length, want) }), cached: true };
}

async function fromR2(ctx: Ctx, cacheState: string): Promise<Response> {
  const { deps, cls, head, spec } = ctx;
  const fill = () => {
    if (!ctx.alreadyCached) scheduleFill(deps, cls);
  };

  try {
    // HEAD never reads a body and never fills the cache.
    if (head) {
      const meta = await deps.bucket.head(cls.key);
      if (!meta) return jsonError(404, "not_found", "No such object.", { "X-Cache": cacheState }, true);
      return answer(ctx, cacheState, meta, null, fill);
    }

    let obj: R2ObjectLike | R2ObjectBodyLike | null;
    try {
      obj = await deps.bucket.get(cls.key, spec ? { range: toR2Range(spec) } : undefined);
    } catch (e) {
      // R2 refuses a range it cannot satisfy by throwing; the size tells a 416 from a real failure.
      if (!spec) throw e;
      const meta = await deps.bucket.head(cls.key);
      if (!meta) return jsonError(404, "not_found", "No such object.", { "X-Cache": cacheState });
      const v = validatorsOf(meta);
      const pre = evaluatePreconditions(ctx.headers, v);
      if (pre === "not_modified") return notModified(cls, v, cacheState);
      if (pre === "precondition_failed") return preconditionFailed(v, cacheState, false);
      const decision = rangeDecision(spec, ctx.headers, meta.size, v.etag);
      if (decision.kind === "unsatisfiable") return notSatisfiable(meta.size, v, cacheState, false);
      throw e;
    }
    if (!obj) return jsonError(404, "not_found", "No such object.", { "X-Cache": cacheState });
    if (!hasBody(obj)) throw new Error("R2 returned an object without a body");
    return answer(ctx, cacheState, obj, obj.body, fill);
  } catch (e) {
    console.error(`singlet-data: R2 read failed for ${cls.key}:`, e instanceof Error ? e.message : String(e));
    return jsonError(502, "upstream_error", "The object store did not answer.", {}, ctx.head);
  }
}

/**
 * Decide and build the answer once the object's size and validators are known. `body` is what R2 returned for the
 * request as sent: the requested range when `spec` is set, the whole object otherwise (null for HEAD).
 */
async function answer(
  ctx: Ctx,
  cacheState: string,
  obj: R2ObjectLike,
  body: ReadableStream<Uint8Array> | null,
  fill: () => void
): Promise<Response> {
  const { deps, cls, head, spec } = ctx;
  const v = validatorsOf(obj);
  const size = obj.size;
  const cacheable = size <= CACHE_MAX_BYTES;

  const pre = evaluatePreconditions(ctx.headers, v);
  if (pre !== "ok") {
    await discard(body);
    if (!head && cacheable) fillAfterPartial(ctx, size);
    return pre === "not_modified" ? notModified(cls, v, cacheState) : preconditionFailed(v, cacheState, head);
  }

  const decision = rangeDecision(spec, ctx.headers, size, v.etag);
  if (decision.kind === "unsatisfiable") {
    await discard(body);
    if (!head && cacheable) fillAfterPartial(ctx, size);
    return notSatisfiable(size, v, cacheState, head);
  }

  if (decision.kind === "partial") {
    const length = decision.end - decision.start + 1;
    const h = okHeaders(cls, v, cacheState, length, { start: decision.start, end: decision.end, size });
    if (head) return new Response(null, { status: 206, headers: h });
    if (cacheable) fillAfterPartial(ctx, size);
    return new Response(body, { status: 206, headers: h });
  }

  // full object
  if (head) return new Response(null, { status: 200, headers: okHeaders(cls, v, cacheState, size) });
  let full = body;
  if (spec) {
    // R2 was asked for a range but If-Range says the client's copy is stale: fetch the whole object.
    await discard(body);
    const again = await deps.bucket.get(cls.key);
    if (!again || !hasBody(again)) return jsonError(404, "not_found", "No such object.", { "X-Cache": cacheState });
    full = again.body;
  }
  const h = okHeaders(cls, v, cacheState, size);
  if (!cacheable || !deps.cache || ctx.alreadyCached) return new Response(full, { status: 200, headers: h });
  if (size <= TEE_MAX_BYTES && full) {
    const res = new Response(full, { status: 200, headers: h });
    scheduleTeePut(deps, cls, cacheResponse(cls, v, size, res.clone().body!));
    return res;
  }
  fill();
  return new Response(full, { status: 200, headers: h });
}
