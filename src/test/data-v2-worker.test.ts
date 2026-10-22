// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_MAX_BYTES,
  MISSES_MAX,
  RANGE_FILL_MAX_BYTES,
  TEE_MAX_BYTES,
  classify,
  evaluatePreconditions,
  handle,
  parseRange,
  rangeDecision,
  resolveRange,
  toR2Range,
  type CacheLike,
  type Deps,
  type R2BucketLike,
  type R2ObjectBodyLike,
  type R2ObjectLike,
} from "../../workers/data-v2/src/handler";

// ── fakes ────────────────────────────────────────────────────────────────────

const HEX = "00112233445566778899aabbccddeeff";
const HEX2 = "ffeeddccbbaa99887766554433221100";
const SAMPLE = `/v2/s/GSM1/${HEX}.s2`;
const SAMPLE_KEY = SAMPLE.slice(1);
const UPLOADED = new Date("2026-10-21T07:28:00.000Z");
const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7 + 3) & 0xff);
const slice = (a: number, b: number) => BYTES.slice(a, b + 1);

interface StoredObject {
  /** Real bytes, or null for an object that only has a size (lazy zeros). */
  bytes: Uint8Array | null;
  size: number;
  etag: string;
  uploaded: Date;
}

function stored(bytes: Uint8Array, etag = '"etag-1"'): StoredObject {
  return { bytes, size: bytes.length, etag, uploaded: UPLOADED };
}
function sizeOnly(size: number, etag = '"etag-big"'): StoredObject {
  return { bytes: null, size, etag, uploaded: UPLOADED };
}

function lazyBody(o: StoredObject, start: number, end: number): ReadableStream<Uint8Array> {
  let pos = start;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pos > end) {
        controller.close();
        return;
      }
      const next = Math.min(end + 1, pos + 65536);
      controller.enqueue(o.bytes ? o.bytes.slice(pos, next) : new Uint8Array(next - pos));
      pos = next;
    },
  });
}

class FakeBucket implements R2BucketLike {
  objects = new Map<string, StoredObject>();
  gets: { key: string; range?: unknown }[] = [];
  heads: string[] = [];
  /** R2 throws on a range it cannot satisfy; set false to return an empty body instead. */
  throwOnBadRange = true;
  /** Throw this from every get/head. */
  failWith: Error | null = null;
  /** Hold full-object reads (no range) until released. */
  gate: Promise<void> | null = null;
  bodyless = false;

  put(key: string, o: StoredObject) {
    this.objects.set(key, o);
  }

  async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
    this.gets.push({ key, range: options?.range });
    if (this.failWith) throw this.failWith;
    if (!options?.range && this.gate) await this.gate;
    const o = this.objects.get(key);
    if (!o) return null;
    const meta: R2ObjectLike = { size: o.size, httpEtag: o.etag, uploaded: o.uploaded };
    if (this.bodyless) return meta;
    let start = 0;
    let end = o.size - 1;
    const r = options?.range;
    if (r) {
      if (r.suffix != null) start = Math.max(0, o.size - r.suffix);
      else {
        start = r.offset ?? 0;
        if (r.length != null) end = Math.min(end, start + r.length - 1);
      }
      if (start >= o.size) {
        if (this.throwOnBadRange) throw new Error("get: The requested range is not satisfiable (10039)");
        start = 0;
        end = -1;
      }
    }
    return { ...meta, body: lazyBody(o, start, end) } as R2ObjectBodyLike;
  }

  async head(key: string) {
    this.heads.push(key);
    if (this.failWith) throw this.failWith;
    const o = this.objects.get(key);
    return o ? { size: o.size, httpEtag: o.etag, uploaded: o.uploaded } : null;
  }
}

interface Entry {
  status: number;
  headers: [string, string][];
  bytes: Uint8Array;
}

/** The Cache API as measured with workerd: Range on match slices a cached 200 (206), an unsatisfiable range is a bare 416. */
class FakeCache implements CacheLike {
  entries = new Map<string, Entry>();
  puts: string[] = [];
  matches: { url: string; range: string | null }[] = [];
  honourRange = true;
  throwOnMatch = false;
  throwOnPut = false;

  async put(request: Request, response: Response) {
    if (request.method !== "GET") throw new TypeError("cache.put needs a GET key");
    if (response.status === 206) throw new TypeError("Cannot cache response to a range request (206 Partial Content).");
    if (this.throwOnPut) throw new Error("put failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.puts.push(request.url);
    this.entries.set(request.url, { status: response.status, headers: [...response.headers.entries()], bytes });
  }

  async match(request: Request) {
    const range = request.headers.get("range");
    this.matches.push({ url: request.url, range });
    if (this.throwOnMatch) throw new Error("match failed");
    const e = this.entries.get(request.url);
    if (!e) return undefined;
    const headers = new Headers(e.headers);
    const size = e.bytes.length;
    if (range && this.honourRange) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        let start: number;
        let end: number;
        if (m[1] === "") {
          start = Math.max(0, size - Number(m[2]));
          end = size - 1;
        } else {
          start = Number(m[1]);
          end = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
        }
        if (start >= size || end < start) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
        headers.set("Content-Length", String(end - start + 1));
        return new Response(e.bytes.slice(start, end + 1), { status: 206, headers });
      }
    }
    return new Response(e.bytes.slice(), { status: e.status, headers });
  }
}

function setup(opts: { cache?: boolean } = {}) {
  const bucket = new FakeBucket();
  bucket.put(SAMPLE_KEY, stored(BYTES));
  const cache = opts.cache === false ? null : new FakeCache();
  const pending: Promise<unknown>[] = [];
  const inFlight = new Set<string>();
  const misses = new Set<string>();
  const deps: Deps = { bucket, cache, waitUntil: (p) => void pending.push(p), inFlight, misses };
  const flush = async () => {
    for (let i = 0; i < 10 && pending.length; i++) await Promise.allSettled(pending.splice(0));
  };
  const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://data.singlet.bio${path}`, init), deps);
  const get = (path: string, headers: Record<string, string> = {}) => call(path, { headers });
  return { bucket, cache, deps, call, get, flush, inFlight, misses };
}

const body = async (r: Response) => new Uint8Array(await r.arrayBuffer());
const h = (r: Response, name: string) => r.headers.get(name);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── paths ────────────────────────────────────────────────────────────────────

describe("classify", () => {
  const ok = (p: string) => classify(`https://data.singlet.bio${p}`);

  it("accepts exactly the five key shapes", () => {
    expect(ok(SAMPLE)).toMatchObject({ key: SAMPLE_KEY, contentType: "application/octet-stream" });
    expect(ok(`/v2/ref/${HEX}.pack`)).toMatchObject({ key: `v2/ref/${HEX}.pack` });
    expect(ok("/v2/ref/index.json")).toMatchObject({ contentType: "application/json; charset=utf-8" });
    expect(ok("/v2/m/GSE145370.json")).toMatchObject({ key: "v2/m/GSE145370.json" });
    expect(ok("/v2/cells/GSE145370.cells")).toMatchObject({ key: "v2/cells/GSE145370.cells", contentType: "application/octet-stream" });
  });

  it.each([
    "/",
    "/v2",
    "/v2/",
    "/v2/s/GSM1",
    `/v2/s/GSM1/${HEX.toUpperCase()}.s2`,
    `/v2/s/GSM1/${HEX.slice(1)}.s2`,
    `/v2/s/GSM1/${HEX}0.s2`,
    `/v2/s/GSM1/${HEX}.s2/`,
    `/v2/s/GSM1/${HEX}.pack`,
    `/v2/s/GSX1/${HEX}.s2`,
    `/v2/s/GSM/${HEX}.s2`,
    `/v2/ref/${HEX}.s2`,
    "/v2/ref/other.json",
    "/v2/m/GSE1",
    "/v2/m/GSE1.json/x",
    "/v2/m/gse1.json",
    "/v2/m/GSM1.json",
    "/v2/cells/GSE1.json",
    "/data/GSE138867/GSE138867.singlet",
    "/search-index/v1/index.json",
    `/v2/s/GSM1/../GSM2/${HEX}.s2`,
    `/v2/s/GSM1/%2e%2e/GSM2/${HEX}.s2`,
    `/v2/s%2fGSM1/${HEX}.s2`,
    `/v2/s/GSM1%2F${HEX}.s2`,
    `//v2/s/GSM1/${HEX}.s2`,
    `/v2//s/GSM1/${HEX}.s2`,
    `/v2/s/GSM1/${HEX}.s2%00`,
    `/v2/s\\GSM1/${HEX}.s2`,
    `/v2/s/%47SM1/${HEX}.s2`,
    `/v2/s/GSM${"1".repeat(13)}/${HEX}.s2`,
  ])("rejects %s", (p) => {
    expect(ok(p)).toBeNull();
  });

  it("ignores the query string and fragment", () => {
    expect(ok(`${SAMPLE}?a=1&b=../x`)).toMatchObject({ key: SAMPLE_KEY });
    expect(ok(`${SAMPLE}#frag`)).toMatchObject({ key: SAMPLE_KEY });
  });
});

describe("handle: routing, methods, CORS", () => {
  it("answers OPTIONS with 204 and the preflight headers, without touching R2 or the cache", async () => {
    const t = setup();
    for (const path of [SAMPLE, "/v2/anything"]) {
      const r = await t.call(path, { method: "OPTIONS", headers: { Origin: "https://example.org", "Access-Control-Request-Method": "GET" } });
      expect(r.status).toBe(204);
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      expect(h(r, "Access-Control-Allow-Methods")).toBe("GET, HEAD, OPTIONS");
      expect(h(r, "Access-Control-Allow-Headers")).toMatch(/Range/);
      expect(h(r, "Access-Control-Allow-Headers")).toMatch(/If-Match/);
      expect(h(r, "Access-Control-Max-Age")).toBe("86400");
      expect(h(r, "Vary")).toBeNull();
      expect(await r.text()).toBe("");
    }
    expect(t.bucket.gets.length + t.bucket.heads.length).toBe(0);
    expect(t.cache!.matches.length).toBe(0);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("answers %s with 405 and an Allow header", async (method) => {
    const t = setup();
    const r = await t.call(SAMPLE, { method, body: method === "DELETE" ? undefined : "x" });
    expect(r.status).toBe(405);
    expect(h(r, "Allow")).toBe("GET, HEAD, OPTIONS");
    expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
    expect(h(r, "Cache-Control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ error: "method_not_allowed" });
    expect(t.bucket.gets.length).toBe(0);
  });

  it("answers an unknown path with a JSON 404 and no R2 call", async () => {
    const t = setup();
    for (const path of ["/", "/v2/s/GSM1", `/v2/s/GSM1%2F${HEX}.s2`, "/data/GSE1/GSE1.singlet"]) {
      const r = await t.get(path);
      expect(r.status).toBe(404);
      expect(h(r, "Content-Type")).toBe("application/json; charset=utf-8");
      expect(h(r, "Cache-Control")).toBe("no-store");
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      expect(await r.json()).toMatchObject({ error: "not_found" });
    }
    expect(t.bucket.gets.length + t.bucket.heads.length).toBe(0);
  });

  it("answers a valid key that is not in the bucket with a 404 that is never cached", async () => {
    const t = setup();
    const r = await t.get(`/v2/s/GSM2/${HEX2}.s2`);
    expect(r.status).toBe(404);
    expect(h(r, "Cache-Control")).toBe("no-store");
    expect(h(r, "X-Cache")).toBe("MISS");
    await t.flush();
    expect(t.cache!.puts).toEqual([]);
    // uploaded later: visible at once
    t.bucket.put(`v2/s/GSM2/${HEX2}.s2`, stored(BYTES));
    expect((await t.get(`/v2/s/GSM2/${HEX2}.s2`)).status).toBe(200);
  });

  it("never lets a dot segment leave the key space: the URL is normalised before routing and still has to match", async () => {
    const t = setup();
    const r = await t.get(`/v2/s/GSM1/../GSM2/${HEX2}.s2`);
    expect(r.status).toBe(404); // normalises to /v2/s/GSM2/<hex>.s2, which is not in the bucket
    expect(t.bucket.gets.map((g) => g.key)).toEqual([`v2/s/GSM2/${HEX2}.s2`]);
    expect((await t.get("/v2/s/GSM1/../../../etc/passwd")).status).toBe(404);
    expect(t.bucket.gets.length).toBe(1);
  });

  it("ignores the query string: one key, one cache entry", async () => {
    const t = setup();
    const a = await t.get(`${SAMPLE}?v=1&Range=2`);
    expect(a.status).toBe(200);
    await body(a);
    await t.flush();
    const b = await t.get(`${SAMPLE}?other=1`);
    expect(h(b, "X-Cache")).toBe("HIT");
    expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${SAMPLE_KEY}`]);
    expect(t.bucket.gets.every((g) => g.key === SAMPLE_KEY)).toBe(true);
  });
});

// ── representation headers ───────────────────────────────────────────────────

describe("handle: headers by key class", () => {
  const fixtures: [string, string, string, string][] = [
    [SAMPLE, "application/octet-stream", "public, max-age=31536000, immutable", SAMPLE_KEY],
    [`/v2/ref/${HEX}.pack`, "application/octet-stream", "public, max-age=31536000, immutable", `v2/ref/${HEX}.pack`],
    ["/v2/ref/index.json", "application/json; charset=utf-8", "public, max-age=300", "v2/ref/index.json"],
    ["/v2/m/GSE145370.json", "application/json; charset=utf-8", "public, max-age=300", "v2/m/GSE145370.json"],
    ["/v2/cells/GSE145370.cells", "application/octet-stream", "public, max-age=300", "v2/cells/GSE145370.cells"],
  ];

  it.each(fixtures)("%s", async (path, type, cacheControl, key) => {
    const t = setup();
    t.bucket.put(key, stored(BYTES));
    for (const method of ["GET", "HEAD"]) {
      const r = await t.call(path, { method });
      expect(r.status).toBe(200);
      expect(h(r, "Content-Type")).toBe(type);
      expect(h(r, "Cache-Control")).toBe(cacheControl);
      expect(h(r, "Accept-Ranges")).toBe("bytes");
      expect(h(r, "ETag")).toBe('"etag-1"');
      expect(h(r, "Last-Modified")).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
      expect(h(r, "Content-Length")).toBe("1000");
      expect(h(r, "Content-Disposition")).toBeNull();
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      expect(h(r, "Access-Control-Expose-Headers")).toBe("Content-Length, Content-Range, Accept-Ranges, ETag, Content-Type, Last-Modified");
      expect(h(r, "X-Content-Type-Options")).toBe("nosniff");
      expect(h(r, "Timing-Allow-Origin")).toBe("*");
      expect(h(r, "X-Served-By")).toBe("data-v2");
      expect(h(r, "Vary")).toBeNull();
      await r.arrayBuffer();
    }
  });

  it("serves the whole body on a plain GET", async () => {
    const t = setup();
    const r = await t.get(SAMPLE);
    expect(r.status).toBe(200);
    expect(await body(r)).toEqual(BYTES);
  });

  it("answers HEAD from R2 metadata only: no body read, no cache fill", async () => {
    const t = setup();
    const r = await t.call(SAMPLE, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
    await t.flush();
    expect(t.bucket.gets).toEqual([]);
    expect(t.bucket.heads).toEqual([SAMPLE_KEY]);
    expect(t.cache!.puts).toEqual([]);
    const missing = await t.call(`/v2/s/GSM9/${HEX2}.s2`, { method: "HEAD" });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("");
  });
});

// ── ranges ───────────────────────────────────────────────────────────────────

describe("parseRange / resolveRange", () => {
  it.each([
    ["bytes=0-9", { kind: "span", first: 0, last: 9 }],
    ["bytes=10-", { kind: "span", first: 10, last: null }],
    ["bytes=-5", { kind: "suffix", length: 5 }],
    ["bytes=-0", { kind: "suffix", length: 0 }],
    ["Bytes=3-3", { kind: "span", first: 3, last: 3 }],
    [" bytes=1-2 ", { kind: "span", first: 1, last: 2 }],
  ])("parses %s", (header, want) => {
    expect(parseRange(header)).toEqual(want);
  });

  it.each([null, "", "bytes=", "bytes=-", "bytes=a-b", "bytes=5-2", "bytes=0-1,5-6", "items=0-1", "0-9", "bytes 0-9", `bytes=${"9".repeat(20)}-`, "bytes=0-9-"])(
    "ignores %s",
    (header) => {
      expect(parseRange(header)).toBeNull();
    }
  );

  it("resolves against the size", () => {
    expect(resolveRange({ kind: "span", first: 0, last: 9 }, 100)).toEqual({ start: 0, end: 9 });
    expect(resolveRange({ kind: "span", first: 95, last: 500 }, 100)).toEqual({ start: 95, end: 99 });
    expect(resolveRange({ kind: "span", first: 99, last: null }, 100)).toEqual({ start: 99, end: 99 });
    expect(resolveRange({ kind: "span", first: 100, last: null }, 100)).toBeNull();
    expect(resolveRange({ kind: "suffix", length: 5 }, 100)).toEqual({ start: 95, end: 99 });
    expect(resolveRange({ kind: "suffix", length: 500 }, 100)).toEqual({ start: 0, end: 99 });
    expect(resolveRange({ kind: "suffix", length: 0 }, 100)).toBeNull();
    expect(resolveRange({ kind: "span", first: 0, last: 0 }, 0)).toBeNull();
    expect(resolveRange({ kind: "suffix", length: 5 }, 0)).toBeNull();
  });

  it("maps to R2 range options", () => {
    expect(toR2Range({ kind: "span", first: 5, last: 9 })).toEqual({ offset: 5, length: 5 });
    expect(toR2Range({ kind: "span", first: 5, last: null })).toEqual({ offset: 5 });
    expect(toR2Range({ kind: "suffix", length: 7 })).toEqual({ suffix: 7 });
  });
});

describe("handle: Range on a cold cache (served from R2)", () => {
  it.each([
    ["bytes=10-19", 206, 10, 19],
    ["bytes=990-", 206, 990, 999],
    ["bytes=-5", 206, 995, 999],
    ["bytes=995-5000", 206, 995, 999],
    ["bytes=0-0", 206, 0, 0],
    ["bytes=-5000", 206, 0, 999],
  ])("%s", async (range, status, a, b) => {
    const t = setup();
    const r = await t.get(SAMPLE, { Range: range });
    expect(r.status).toBe(status);
    expect(h(r, "Content-Range")).toBe(`bytes ${a}-${b}/1000`);
    expect(h(r, "Content-Length")).toBe(String(b - a + 1));
    expect(h(r, "X-Cache")).toBe("MISS");
    expect(h(r, "ETag")).toBe('"etag-1"');
    expect(await body(r)).toEqual(slice(a, b));
    // exactly one ranged read on the client path
    expect(t.bucket.gets[0].range).toBeDefined();
  });

  it("answers 416 with Content-Range */size when the range starts past the end (R2 throws)", async () => {
    const t = setup();
    for (const range of ["bytes=1000-", "bytes=5000-6000", "bytes=-0"]) {
      const r = await t.get(SAMPLE, { Range: range });
      expect(r.status, range).toBe(416);
      expect(h(r, "Content-Range"), range).toBe("bytes */1000");
      expect(h(r, "Cache-Control"), range).toBe("no-store");
      expect(h(r, "Access-Control-Allow-Origin"), range).toBe("*");
    }
  });

  it("answers 416 from its own arithmetic when R2 returns an empty body instead of throwing", async () => {
    const t = setup();
    t.bucket.throwOnBadRange = false;
    const r = await t.get(SAMPLE, { Range: "bytes=1000-" });
    expect(r.status).toBe(416);
    expect(h(r, "Content-Range")).toBe("bytes */1000");
  });

  it("ignores a multi-range request, an unknown unit, bad syntax and inverted bounds: 200 with the whole object", async () => {
    for (const range of ["bytes=0-1,5-6", "items=0-1", "bytes=a-b", "bytes=5-2", "bytes=", "garbage"]) {
      const t = setup();
      const r = await t.get(SAMPLE, { Range: range });
      expect(r.status, range).toBe(200);
      expect(h(r, "Content-Range"), range).toBeNull();
      expect((await body(r)).length, range).toBe(1000);
    }
  });

  it("treats every Range on a zero-length object as unsatisfiable, and serves it whole otherwise", async () => {
    const t = setup();
    t.bucket.put("v2/m/GSE9.json", stored(new Uint8Array(0), '"empty"'));
    const whole = await t.get("/v2/m/GSE9.json");
    expect(whole.status).toBe(200);
    expect(h(whole, "Content-Length")).toBe("0");
    expect((await body(whole)).length).toBe(0);
    await t.flush();
    for (const range of ["bytes=0-0", "bytes=0-", "bytes=-5"]) {
      for (const pass of ["warm", "cold"]) {
        if (pass === "cold") t.cache!.entries.clear();
        const r = await t.get("/v2/m/GSE9.json", { Range: range });
        expect(r.status, `${range} ${pass}`).toBe(416);
        expect(h(r, "Content-Range"), `${range} ${pass}`).toBe("bytes */0");
      }
    }
  });

  it("HEAD with a Range answers the 206 headers without a body", async () => {
    const t = setup();
    const r = await t.call(SAMPLE, { method: "HEAD", headers: { Range: "bytes=0-99" } });
    expect(r.status).toBe(206);
    expect(h(r, "Content-Range")).toBe("bytes 0-99/1000");
    expect(h(r, "Content-Length")).toBe("100");
    expect(await r.text()).toBe("");
    const bad = await t.call(SAMPLE, { method: "HEAD", headers: { Range: "bytes=2000-" } });
    expect(bad.status).toBe(416);
    expect(h(bad, "Content-Range")).toBe("bytes */1000");
    await t.flush();
    expect(t.bucket.gets).toEqual([]);
    expect(t.cache!.puts).toEqual([]);
  });
});

// ── conditionals ─────────────────────────────────────────────────────────────

describe("evaluatePreconditions", () => {
  const v = { etag: '"abc"', lastModifiedMs: UPLOADED.getTime() };
  const hdr = (o: Record<string, string>) => new Headers(o);

  it("If-None-Match: strong, weak, list, star", () => {
    expect(evaluatePreconditions(hdr({ "If-None-Match": '"abc"' }), v)).toBe("not_modified");
    expect(evaluatePreconditions(hdr({ "If-None-Match": 'W/"abc"' }), v)).toBe("not_modified");
    expect(evaluatePreconditions(hdr({ "If-None-Match": '"x", "abc" , "y"' }), v)).toBe("not_modified");
    expect(evaluatePreconditions(hdr({ "If-None-Match": "*" }), v)).toBe("not_modified");
    expect(evaluatePreconditions(hdr({ "If-None-Match": '"x", "y"' }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({}), v)).toBe("ok");
  });

  it("If-Match: strong comparison only", () => {
    expect(evaluatePreconditions(hdr({ "If-Match": '"abc"' }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Match": '"x", "abc"' }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Match": "*" }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Match": '"x"' }), v)).toBe("precondition_failed");
    expect(evaluatePreconditions(hdr({ "If-Match": 'W/"abc"' }), v)).toBe("precondition_failed");
    expect(evaluatePreconditions(hdr({ "If-Match": "garbage" }), v)).toBe("precondition_failed");
  });

  it("If-Match is evaluated before If-None-Match", () => {
    expect(evaluatePreconditions(hdr({ "If-Match": '"x"', "If-None-Match": '"abc"' }), v)).toBe("precondition_failed");
    expect(evaluatePreconditions(hdr({ "If-Match": '"abc"', "If-None-Match": '"abc"' }), v)).toBe("not_modified");
  });

  it("date validators, only when the ETag validator is absent", () => {
    expect(evaluatePreconditions(hdr({ "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT" }), v)).toBe("not_modified");
    expect(evaluatePreconditions(hdr({ "If-Modified-Since": "Tue, 20 Oct 2026 07:28:00 GMT" }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT", "If-None-Match": '"x"' }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Unmodified-Since": "Tue, 20 Oct 2026 07:28:00 GMT" }), v)).toBe("precondition_failed");
    expect(evaluatePreconditions(hdr({ "If-Unmodified-Since": "Wed, 21 Oct 2026 07:28:00 GMT" }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Unmodified-Since": "Tue, 20 Oct 2026 07:28:00 GMT", "If-Match": '"abc"' }), v)).toBe("ok");
    expect(evaluatePreconditions(hdr({ "If-Modified-Since": "not a date" }), v)).toBe("ok");
  });
});

describe("rangeDecision", () => {
  const span = { kind: "span", first: 0, last: 9 } as const;
  it("applies If-Range only for a matching strong ETag", () => {
    expect(rangeDecision(span, new Headers(), 100, '"e"')).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(rangeDecision(span, new Headers({ "If-Range": '"e"' }), 100, '"e"')).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(rangeDecision(span, new Headers({ "If-Range": '"other"' }), 100, '"e"')).toEqual({ kind: "full" });
    expect(rangeDecision(span, new Headers({ "If-Range": 'W/"e"' }), 100, '"e"')).toEqual({ kind: "full" });
    expect(rangeDecision(span, new Headers({ "If-Range": "Wed, 21 Oct 2026 07:28:00 GMT" }), 100, '"e"')).toEqual({ kind: "full" });
    expect(rangeDecision(null, new Headers(), 100, '"e"')).toEqual({ kind: "full" });
  });
});

describe("handle: conditional requests", () => {
  const ETAG = '"etag-1"';

  it.each(["miss", "hit"])("If-None-Match answers 304 without a body (%s)", async (state) => {
    for (const value of [ETAG, `W/${ETAG}`, `"zzz", ${ETAG}`, "*"]) {
      const t = setup();
      if (state === "hit") {
        await body(await t.get(SAMPLE));
        await t.flush();
      }
      const r = await t.get(SAMPLE, { "If-None-Match": value });
      expect(r.status, value).toBe(304);
      expect(h(r, "ETag"), value).toBe(ETAG);
      expect(h(r, "Cache-Control"), value).toBe("public, max-age=31536000, immutable");
      expect(h(r, "Access-Control-Allow-Origin"), value).toBe("*");
      expect(h(r, "X-Cache"), value).toBe(state === "hit" ? "HIT" : "MISS");
      expect(await r.text(), value).toBe("");
    }
    const t = setup();
    const stale = await t.get(SAMPLE, { "If-None-Match": '"other"' });
    expect(stale.status).toBe(200);
    await body(stale);
  });

  it.each(["miss", "hit"])("If-Match mismatch answers 412 with the current ETag (%s)", async (state) => {
    const t = setup();
    if (state === "hit") {
      await body(await t.get(SAMPLE));
      await t.flush();
    }
    for (const range of [undefined, "bytes=0-9"]) {
      const r = await t.get(SAMPLE, { "If-Match": '"stale"', ...(range ? { Range: range } : {}) });
      expect(r.status).toBe(412);
      expect(h(r, "ETag")).toBe(ETAG);
      expect(h(r, "Cache-Control")).toBe("no-store");
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      expect(await r.json()).toMatchObject({ error: "precondition_failed" });
    }
  });

  it.each(["miss", "hit"])("If-Match with the current ETag serves the range (%s)", async (state) => {
    const t = setup();
    if (state === "hit") {
      await body(await t.get(SAMPLE));
      await t.flush();
    }
    for (const value of [ETAG, "*", `"x", ${ETAG}`]) {
      const r = await t.get(SAMPLE, { "If-Match": value, Range: "bytes=4-7" });
      expect(r.status, value).toBe(206);
      expect(await body(r), value).toEqual(slice(4, 7));
    }
  });

  it.each(["miss", "hit"])("If-Range: a stale validator gets the whole object, a current one the range (%s)", async (state) => {
    const t = setup();
    if (state === "hit") {
      await body(await t.get(SAMPLE));
      await t.flush();
    }
    const stale = await t.get(SAMPLE, { "If-Range": '"old"', Range: "bytes=0-9" });
    expect(stale.status).toBe(200);
    expect(h(stale, "Content-Range")).toBeNull();
    expect(await body(stale)).toEqual(BYTES);
    const date = await t.get(SAMPLE, { "If-Range": "Wed, 21 Oct 2026 07:28:00 GMT", Range: "bytes=0-9" });
    expect(date.status).toBe(200);
    await body(date);
    const fresh = await t.get(SAMPLE, { "If-Range": ETAG, Range: "bytes=0-9" });
    expect(fresh.status).toBe(206);
    expect(await body(fresh)).toEqual(slice(0, 9));
  });

  it("If-Modified-Since answers 304 when the object is not newer", async () => {
    const t = setup();
    const r = await t.get(SAMPLE, { "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(r.status).toBe(304);
    const newer = await t.get(SAMPLE, { "If-Modified-Since": "Tue, 20 Oct 2026 07:28:00 GMT" });
    expect(newer.status).toBe(200);
    await body(newer);
  });

  it("a 304 or 412 on HEAD has no body", async () => {
    const t = setup();
    expect((await t.call(SAMPLE, { method: "HEAD", headers: { "If-None-Match": ETAG } })).status).toBe(304);
    const r = await t.call(SAMPLE, { method: "HEAD", headers: { "If-Match": '"x"' } });
    expect(r.status).toBe(412);
    expect(await r.text()).toBe("");
  });
});

// ── the edge cache ───────────────────────────────────────────────────────────

describe("handle: cache behaviour", () => {
  it("a cold full GET streams from R2 once and caches a copy with the same ETag and validators", async () => {
    const t = setup();
    const miss = await t.get(SAMPLE);
    expect(h(miss, "X-Cache")).toBe("MISS");
    expect(await body(miss)).toEqual(BYTES);
    await t.flush();
    expect(t.bucket.gets.length).toBe(1);
    expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${SAMPLE_KEY}`]);

    const hit = await t.get(SAMPLE);
    expect(h(hit, "X-Cache")).toBe("HIT");
    expect(await body(hit)).toEqual(BYTES);
    for (const name of ["ETag", "Last-Modified", "Content-Length", "Content-Type", "Cache-Control", "Accept-Ranges"]) {
      expect(h(hit, name), name).toBe(h(miss, name));
    }
    expect(t.bucket.gets.length).toBe(1);
    expect(t.bucket.heads.length).toBe(0);
  });

  it("serves a range from the cached entry without touching R2", async () => {
    const t = setup();
    await body(await t.get(SAMPLE));
    await t.flush();
    t.bucket.gets.length = 0;
    t.bucket.heads.length = 0;
    const r = await t.get(SAMPLE, { Range: "bytes=100-199" });
    expect(r.status).toBe(206);
    expect(h(r, "X-Cache")).toBe("HIT");
    expect(h(r, "Content-Range")).toBe("bytes 100-199/1000");
    expect(h(r, "ETag")).toBe('"etag-1"');
    expect(await body(r)).toEqual(slice(100, 199));
    const suffix = await t.get(SAMPLE, { Range: "bytes=-4" });
    expect(await body(suffix)).toEqual(slice(996, 999));
    const head = await t.call(SAMPLE, { method: "HEAD", headers: { Range: "bytes=0-9" } });
    expect(head.status).toBe(206);
    expect(h(head, "X-Cache")).toBe("HIT");
    expect(t.bucket.gets.length + t.bucket.heads.length).toBe(0);
  });

  it("only forwards Range to the cache, never conditionals, and never a range it would have to ignore", async () => {
    const t = setup();
    await body(await t.get(SAMPLE));
    await t.flush();
    t.cache!.matches.length = 0;
    await t.get(SAMPLE, { Range: "bytes=0-1,5-6" });
    await t.get(SAMPLE, { Range: "items=1-2" });
    expect(t.cache!.matches.map((m) => m.range)).toEqual([null, null]);
    await body(await t.get(SAMPLE, { Range: "bytes=1-2", "If-None-Match": '"zzz"' }));
    expect(t.cache!.matches.at(-1)?.range).toBe("bytes=1-2");
  });

  it("a Range on a cold cache is served from R2 and schedules exactly one full fill", async () => {
    const t = setup();
    const r = await t.get(SAMPLE, { Range: "bytes=5-14" });
    expect(r.status).toBe(206);
    expect(h(r, "X-Cache")).toBe("MISS");
    expect(await body(r)).toEqual(slice(5, 14));
    await t.flush();
    expect(t.bucket.gets.length).toBe(2);
    expect(t.bucket.gets[0].range).toEqual({ offset: 5, length: 10 });
    expect(t.bucket.gets[1].range).toBeUndefined();
    expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${SAMPLE_KEY}`]);
    expect(t.inFlight.size).toBe(0);

    const next = await t.get(SAMPLE, { Range: "bytes=5-14" });
    expect(h(next, "X-Cache")).toBe("HIT");
    expect(await body(next)).toEqual(slice(5, 14));
    expect(t.bucket.gets.length).toBe(2);
  });

  it("does not start a second fill while one is in flight", async () => {
    const t = setup();
    let release!: () => void;
    t.bucket.gate = new Promise<void>((resolve) => (release = resolve));
    await body(await t.get(SAMPLE, { Range: "bytes=0-9" }));
    await body(await t.get(SAMPLE, { Range: "bytes=20-29" }));
    await body(await t.get(SAMPLE, { Range: "bytes=40-49" }));
    expect(t.inFlight.has(SAMPLE_KEY)).toBe(true);
    release();
    await t.flush();
    const fullReads = t.bucket.gets.filter((g) => !g.range);
    expect(fullReads.length).toBe(1);
    expect(t.cache!.puts.length).toBe(1);
    expect(t.inFlight.size).toBe(0);
  });

  it("clears the in-flight mark when the fill fails, and the response is unaffected", async () => {
    const t = setup();
    t.cache!.throwOnPut = true;
    const r = await t.get(SAMPLE, { Range: "bytes=0-9" });
    expect(r.status).toBe(206);
    expect(await body(r)).toEqual(slice(0, 9));
    await t.flush();
    expect(t.inFlight.size).toBe(0);
    expect(console.error).toHaveBeenCalled();
    t.cache!.throwOnPut = false;
    await body(await t.get(SAMPLE, { Range: "bytes=0-9" }));
    await t.flush();
    expect(t.cache!.puts.length).toBe(1);
  });

  it("never fills the cache for an object above the cap, and serves ranges from R2 every time", async () => {
    const t = setup();
    const key = `v2/s/GSM7/${HEX2}.s2`;
    t.bucket.put(key, sizeOnly(CACHE_MAX_BYTES + 1));
    for (let i = 0; i < 2; i++) {
      const r = await t.get(`/${key}`, { Range: "bytes=0-9" });
      expect(r.status).toBe(206);
      expect(h(r, "Content-Range")).toBe(`bytes 0-9/${CACHE_MAX_BYTES + 1}`);
      expect((await body(r)).length).toBe(10);
    }
    const whole = await t.get(`/${key}`);
    expect(whole.status).toBe(200);
    expect(h(whole, "Content-Length")).toBe(String(CACHE_MAX_BYTES + 1));
    expect(h(whole, "X-Cache")).toBe("MISS");
    await whole.body!.cancel();
    const revalidate = await t.get(`/${key}`, { "If-None-Match": '"etag-big"' });
    expect(revalidate.status).toBe(304);
    await t.flush();
    expect(t.cache!.puts).toEqual([]);
    expect(t.bucket.gets.length).toBe(4);
  });

  it("schedules a fill for an object exactly at the cap on its second ranged miss (and at once for one between the tee size and the range-fill size)", async () => {
    const t = setup();
    const at = `v2/s/GSM7/${HEX2}.s2`;
    t.bucket.put(at, sizeOnly(CACHE_MAX_BYTES));
    let release!: () => void;
    t.bucket.gate = new Promise<void>((resolve) => (release = resolve));
    await body(await t.get(`/${at}`, { Range: "bytes=0-0" }));
    expect(t.inFlight.has(at)).toBe(false); // the first miss of a big object is only remembered
    const r = await t.get(`/${at}`, { Range: "bytes=1-1" });
    expect(r.status).toBe(206);
    await body(r);
    expect(t.inFlight.has(at)).toBe(true); // the second starts the fill; the object is dropped before it is read in full
    t.bucket.objects.delete(at);
    release();
    await t.flush();
    expect(t.cache!.puts).toEqual([]);

    const mid = `v2/s/GSM8/${HEX2}.s2`;
    t.bucket.gate = null;
    t.bucket.put(mid, sizeOnly(TEE_MAX_BYTES + 1));
    await body(await t.get(`/${mid}`, { Range: "bytes=0-0" }));
    await t.flush();
    expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${mid}`]);
  });

  describe("a cold Range on an object over 32 MiB", () => {
    const big = `v2/s/GSM9/${HEX2}.s2`;
    const BIG = RANGE_FILL_MAX_BYTES + 1;
    const fullReads = (t: ReturnType<typeof setup>) => t.bucket.gets.filter((g) => !g.range).length;

    it("starts no background fill; the second miss of the same key does; the next read is a hit", async () => {
      const t = setup();
      t.bucket.put(big, sizeOnly(BIG));
      const first = await t.get(`/${big}`, { Range: "bytes=0-9" });
      expect(first.status).toBe(206);
      expect(h(first, "X-Cache")).toBe("MISS");
      expect((await body(first)).length).toBe(10);
      await t.flush();
      expect(fullReads(t)).toBe(0);
      expect(t.cache!.puts).toEqual([]);
      expect(t.misses.has(big)).toBe(true);

      const second = await t.get(`/${big}`, { Range: "bytes=20-29" });
      expect(h(second, "X-Cache")).toBe("MISS");
      await body(second);
      await t.flush();
      expect(fullReads(t)).toBe(1);
      expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${big}`]);
      expect(t.misses.has(big)).toBe(false);
      expect(t.inFlight.size).toBe(0);

      const third = await t.get(`/${big}`, { Range: "bytes=40-49" });
      expect(h(third, "X-Cache")).toBe("HIT");
      expect(third.status).toBe(206);
      expect((await body(third)).length).toBe(10);
      expect(fullReads(t)).toBe(1);
    });

    it("counts each key on its own", async () => {
      const t = setup();
      const other = `v2/s/GSM10/${HEX2}.s2`;
      t.bucket.put(big, sizeOnly(BIG));
      t.bucket.put(other, sizeOnly(BIG));
      await body(await t.get(`/${big}`, { Range: "bytes=0-0" }));
      await body(await t.get(`/${other}`, { Range: "bytes=0-0" }));
      await t.flush();
      expect(fullReads(t)).toBe(0);
      expect([...t.misses].sort()).toEqual([big, other].sort());
    });

    it("a full GET fills at once, whatever came before", async () => {
      const t = setup();
      t.bucket.put(big, sizeOnly(BIG));
      const r = await t.get(`/${big}`);
      expect(r.status).toBe(200);
      await r.body!.cancel();
      await t.flush();
      expect(fullReads(t)).toBe(2); // the answer and the fill
      expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${big}`]);
    });

    it("a conditional answer (304, 412) is a miss too: remembered the first time, filled on the second", async () => {
      const t = setup();
      t.bucket.put(big, sizeOnly(BIG));
      expect((await t.get(`/${big}`, { "If-None-Match": '"etag-big"' })).status).toBe(304);
      await t.flush();
      expect(t.misses.has(big)).toBe(true);
      expect(t.cache!.puts).toEqual([]);
      expect(fullReads(t)).toBe(1); // only the conditional read itself
      expect((await t.get(`/${big}`, { Range: "bytes=0-9", "If-Match": '"stale"' })).status).toBe(412);
      await t.flush();
      expect(fullReads(t)).toBe(2); // the second read had a range; this one is the fill
      expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${big}`]);
    });

    it("an object of exactly 32 MiB is filled on the first miss, like a small one", async () => {
      const t = setup();
      const at = `v2/s/GSM11/${HEX2}.s2`;
      t.bucket.put(at, sizeOnly(RANGE_FILL_MAX_BYTES));
      await body(await t.get(`/${at}`, { Range: "bytes=0-9" }));
      await t.flush();
      expect(fullReads(t)).toBe(1);
      expect(t.cache!.puts).toEqual([`https://data.singlet.bio/${at}`]);
      expect(t.misses.size).toBe(0);
    });

    it("remembers at most MISSES_MAX keys, oldest first, and does not remember an already cached key", async () => {
      const t = setup();
      const keys = Array.from({ length: MISSES_MAX + 1 }, (_, i) => `v2/s/GSM${100 + i}/${HEX2}.s2`);
      for (const k of keys) t.bucket.put(k, sizeOnly(BIG));
      for (const k of keys) await body(await t.get(`/${k}`, { Range: "bytes=0-0" }));
      expect(t.misses.size).toBe(MISSES_MAX);
      expect(t.misses.has(keys[0])).toBe(false); // forgotten: its next miss is a first miss again
      expect(t.misses.has(keys[MISSES_MAX])).toBe(true);
      await t.flush();
      expect(fullReads(t)).toBe(0);
    });

    it("without a cache there is nothing to fill or remember", async () => {
      const t = setup({ cache: false });
      t.bucket.put(big, sizeOnly(BIG));
      await body(await t.get(`/${big}`, { Range: "bytes=0-9" }));
      await body(await t.get(`/${big}`, { Range: "bytes=0-9" }));
      await t.flush();
      expect(t.misses.size).toBe(0);
      expect(fullReads(t)).toBe(0);
    });
  });

  it("serves a full GET above the tee size straight from R2 and fills with a separate read", async () => {
    const t = setup();
    const key = `v2/s/GSM7/${HEX2}.s2`;
    t.bucket.put(key, sizeOnly(TEE_MAX_BYTES + 1));
    const r = await t.get(`/${key}`);
    expect(r.status).toBe(200);
    expect(h(r, "X-Cache")).toBe("MISS");
    await r.body!.cancel();
    await t.flush();
    expect(t.bucket.gets.length).toBe(2);
    expect(t.cache!.puts.length).toBe(1);
    const hit = await t.get(`/${key}`, { Range: "bytes=0-3" });
    expect(h(hit, "X-Cache")).toBe("HIT");
    expect(h(hit, "Content-Range")).toBe(`bytes 0-3/${TEE_MAX_BYTES + 1}`);
    await body(hit);
  });

  it("falls through to an R2 range read, without a new put, when the cache returns the whole entry for a Range", async () => {
    const t = setup();
    await body(await t.get(SAMPLE));
    await t.flush();
    t.cache!.honourRange = false;
    t.bucket.gets.length = 0;
    t.cache!.puts.length = 0;
    const r = await t.get(SAMPLE, { Range: "bytes=10-19" });
    expect(r.status).toBe(206);
    expect(await body(r)).toEqual(slice(10, 19));
    await t.flush();
    expect(t.bucket.gets).toEqual([{ key: SAMPLE_KEY, range: { offset: 10, length: 10 } }]);
    expect(t.cache!.puts).toEqual([]);
  });

  it("answers an unsatisfiable range on a hit with its own 416 and the ETag, without R2", async () => {
    const t = setup();
    await body(await t.get(SAMPLE));
    await t.flush();
    t.bucket.gets.length = 0;
    t.bucket.heads.length = 0;
    const r = await t.get(SAMPLE, { Range: "bytes=1000-" });
    expect(r.status).toBe(416);
    expect(h(r, "X-Cache")).toBe("HIT");
    expect(h(r, "Content-Range")).toBe("bytes */1000");
    expect(h(r, "ETag")).toBe('"etag-1"');
    const zero = await t.get(SAMPLE, { Range: "bytes=-0" });
    expect(zero.status).toBe(416);
    const stale = await t.get(SAMPLE, { Range: "bytes=1000-", "If-Match": '"stale"' });
    expect(stale.status).toBe(412);
    expect(t.bucket.gets.length + t.bucket.heads.length).toBe(0);
  });

  it("treats a cache.match failure as a miss", async () => {
    const t = setup();
    t.cache!.throwOnMatch = true;
    const r = await t.get(SAMPLE);
    expect(r.status).toBe(200);
    expect(h(r, "X-Cache")).toBe("MISS");
    expect(await body(r)).toEqual(BYTES);
  });

  it("ignores a cached entry that lacks the validators it needs", async () => {
    const t = setup();
    t.cache!.entries.set(`https://data.singlet.bio/${SAMPLE_KEY}`, { status: 200, headers: [["content-length", "3"]], bytes: new Uint8Array([1, 2, 3]) });
    const r = await t.get(SAMPLE);
    expect(h(r, "X-Cache")).toBe("MISS");
    expect(await body(r)).toEqual(BYTES);
  });

  it("works without a cache (BYPASS) and never fills", async () => {
    const t = setup({ cache: false });
    const full = await t.get(SAMPLE);
    expect(h(full, "X-Cache")).toBe("BYPASS");
    expect(await body(full)).toEqual(BYTES);
    const part = await t.get(SAMPLE, { Range: "bytes=1-2" });
    expect(part.status).toBe(206);
    expect(h(part, "X-Cache")).toBe("BYPASS");
    expect(await body(part)).toEqual(slice(1, 2));
    await t.flush();
    expect(t.bucket.gets.length).toBe(2);
  });

  it("a revalidation of a cold object fills the cache for the next client", async () => {
    const t = setup();
    expect((await t.get(SAMPLE, { "If-None-Match": '"etag-1"' })).status).toBe(304);
    await t.flush();
    expect(t.cache!.puts.length).toBe(1);
  });
});

// ── failures ─────────────────────────────────────────────────────────────────

describe("handle: R2 failures", () => {
  it("answers 502 with no-store and CORS when R2 throws", async () => {
    const t = setup();
    t.bucket.failWith = new Error("R2 is down");
    for (const init of [{}, { headers: { Range: "bytes=0-9" } }, { method: "HEAD" }]) {
      const r = await t.call(SAMPLE, init);
      expect(r.status).toBe(502);
      expect(h(r, "Cache-Control")).toBe("no-store");
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      if (init.method !== "HEAD") expect(await r.json()).toMatchObject({ error: "upstream_error" });
    }
    expect(console.error).toHaveBeenCalled();
    await t.flush();
    expect(t.cache!.puts).toEqual([]);
  });

  it("does not leak the underlying message", async () => {
    const t = setup();
    t.bucket.failWith = new Error("internal bucket id 1234 secret");
    const r = await t.get(SAMPLE);
    expect(await r.text()).not.toMatch(/secret|1234/);
  });

  it("answers 502 when R2 returns an object without a body", async () => {
    const t = setup();
    t.bucket.bodyless = true;
    expect((await t.get(SAMPLE)).status).toBe(502);
  });

  it("carries CORS on every error class", async () => {
    const t = setup();
    await body(await t.get(SAMPLE));
    await t.flush();
    const responses = [
      await t.get("/nope"),
      await t.get(SAMPLE, { Range: "bytes=5000-" }),
      await t.get(SAMPLE, { "If-None-Match": '"etag-1"' }),
      await t.get(SAMPLE, { "If-Match": '"x"' }),
      await t.call(SAMPLE, { method: "POST" }),
    ];
    expect(responses.map((r) => r.status)).toEqual([404, 416, 304, 412, 405]);
    for (const r of responses) {
      expect(h(r, "Access-Control-Allow-Origin")).toBe("*");
      expect(h(r, "Access-Control-Expose-Headers")).toMatch(/Content-Range/);
      expect(h(r, "X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
