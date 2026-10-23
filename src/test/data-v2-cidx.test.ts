// @vitest-environment node
/**
 * Cell-index endpoints of the data Worker (workers/data-v2/src/{scx,cidx,gather,limits,routes}.ts) against golden files written by
 * singlet-bio (`python -P tests/python/_cidx_fixture.py src/test/fixtures/cidx`): a real index over the synthetic v2 study, the answers
 * `singlet.v2.atlas` gives to a fixed list of queries, and its gather plans. The Worker must give the same answers.
 * Sample objects are not in the fixture (the Worker never decodes them): the fake bucket fabricates deterministic bytes of the right size.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });
import { classify, type R2BucketLike, type R2ObjectBodyLike } from "../../workers/data-v2/src/handler";
import { clearMemos, openDirectory, planSamples, runQuery, shardHeader, readGroup, type Directory } from "../../workers/data-v2/src/cidx";
import { FR_END, FR_ERROR, FR_PREFIX, FR_RUN, FRAME_BYTES, membersFor, planGather, runGather } from "../../workers/data-v2/src/gather";
import { CidxQuota, charge, identify, limitsFor } from "../../workers/data-v2/src/limits";
import { handleCidx, type CidxDeps } from "../../workers/data-v2/src/routes";
import { decodeChunk, parseScxHeader } from "../../workers/data-v2/src/scx";

const FIX = join(__dirname, "fixtures", "cidx");
const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8")) as {
  version: string;
  queries: { query: { where: Record<string, unknown>; return: "count" | "cells"; by?: string[] }; answer: Record<string, unknown> }[];
  gathers: { cells: [number, number[]][]; members: string[]; have_prefix: string[]; bytes: number; payload: number; reads: { sample: number; key: string; start: number; end: number }[] }[];
  sample_objects: Record<string, number>;
};

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, `${prefix}${f}/`));
    else out.push(`${prefix}${f}`);
  }
  return out;
}

const fabricated = (key: string, size: number) => {
  let x = 0;
  for (const c of key) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
};

class MemBucket implements R2BucketLike {
  objects = new Map<string, Uint8Array>();
  gets = 0;
  constructor() {
    for (const k of walk(join(FIX, "v2"), "v2/")) this.objects.set(k, new Uint8Array(readFileSync(join(FIX, k))));
    for (const [k, n] of Object.entries(expected.sample_objects)) this.objects.set(k, fabricated(k, n));
  }
  async get(key: string, options?: { range?: { offset?: number; length?: number } }) {
    this.gets++;
    const o = this.objects.get(key);
    if (!o) return null;
    const a = options?.range?.offset ?? 0;
    const b = options?.range?.length != null ? a + options.range.length : o.length;
    const body = o.slice(a, b);
    return {
      size: o.length,
      httpEtag: '"x"',
      uploaded: new Date(0),
      body: new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(body);
          c.close();
        },
      }),
    } as R2ObjectBodyLike;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.length, httpEtag: '"x"', uploaded: new Date(0) } : null;
  }
}

let bucket: MemBucket;
let deps: CidxDeps;
beforeEach(() => {
  clearMemos();
  bucket = new MemBucket();
  deps = { bucket, cache: null, waitUntil: () => undefined };
});

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const sortRows = (rows: Record<string, unknown>[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).sort())).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function parseStream(res: Response) {
  const buf = new Uint8Array(await res.arrayBuffer());
  const dv = new DataView(buf.buffer);
  expect(new TextDecoder().decode(buf.subarray(0, 4))).toBe("SGA1");
  const hl = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hl)));
  const frames: { sample: number; member: number; kind: number; off: number; body: Uint8Array }[] = [];
  let p = 8 + hl;
  let trailer: Record<string, unknown> | null = null;
  while (p < buf.length) {
    const len = dv.getUint32(p + 16, true);
    const f = { sample: dv.getUint32(p, true), member: dv.getUint16(p + 4, true), kind: buf[p + 6], off: Number(dv.getBigUint64(p + 8, true)), body: buf.subarray(p + FRAME_BYTES, p + FRAME_BYTES + len) };
    p += FRAME_BYTES + len;
    if (f.kind === FR_END) trailer = JSON.parse(new TextDecoder().decode(f.body));
    else frames.push(f);
  }
  expect(p).toBe(buf.length);
  return { header, frames, trailer: trailer! };
}

describe("scx", () => {
  it("decodes every shard of the fixture; rows are sorted by ct, tissue, sample, col", async () => {
    const d = await openDirectory(deps, "current");
    expect(d.version).toBe(expected.version);
    let rows = 0;
    for (const key of d.shards) {
      const h = parseScxHeader(bucket.objects.get(key)!);
      const cols: Record<string, number[]> = {};
      for (const name of ["ct", "tissue", "sample", "col"]) {
        cols[name] = [];
        for (let g = 0; g < h.nGroups; g++) {
          const c = h.chunks[g][h.names.indexOf(name)];
          const n = h.groupRowsN[g];
          const out = decodeChunk(c, n, bucket.objects.get(key)!.subarray(c.off, c.off + c.len), new Uint32Array(n));
          for (let i = 0; i < n; i++) {
            expect(out[i]).toBeGreaterThanOrEqual(c.min);
            expect(out[i]).toBeLessThanOrEqual(c.max);
          }
          cols[name].push(...out);
        }
      }
      for (let i = 1; i < cols.ct.length; i++) {
        const a = [cols.ct[i - 1], cols.tissue[i - 1], cols.sample[i - 1], cols.col[i - 1]];
        const b = [cols.ct[i], cols.tissue[i], cols.sample[i], cols.col[i]];
        const cmp = a.findIndex((v, k) => v !== b[k]);
        expect(cmp === -1 || a[cmp] < b[cmp]).toBe(true);
      }
      rows += h.nRows;
    }
    expect(rows).toBe(d.totals.cells);
  });

  it("readGroup decodes the same values from one ranged read", async () => {
    const d = await openDirectory(deps, "current");
    const key = d.shards[0];
    const h = await shardHeader(deps, key);
    const v = await readGroup(deps, key, h, 0, ["sample", "umi_exon"]);
    expect(v.sample.length).toBe(h.groupRowsN[0]);
  });
});

describe("query", () => {
  for (const [i, q] of expected.queries.entries()) {
    it(`answers query ${i} like singlet.v2.atlas: ${JSON.stringify(q.query).slice(0, 80)}`, async () => {
      const r = (await runQuery(deps, { version: "current", where: q.query.where as never, return: q.query.return, by: q.query.by, limit: 100_000 }, { maxRowsScanned: 1e9, maxCellsPage: 100_000 })) as Record<string, unknown>;
      expect(r.complete).toBe(true);
      if (q.query.return === "count") {
        if (q.query.by) expect(sortRows(r.groups as Record<string, unknown>[])).toEqual(sortRows(q.answer.groups as Record<string, unknown>[]));
        else expect(r.count).toBe(q.answer.count);
      } else {
        const c = r.cells as { so: number[]; col: number[]; gsm: string[] };
        expect(c.so).toEqual(q.answer.so);
        expect(c.col).toEqual(q.answer.col);
        expect(c.gsm).toEqual(q.answer.gsm);
      }
    });
  }

  it("pages cells with a cursor and returns the same cells", async () => {
    const q = expected.queries.find((x) => x.query.return === "cells" && (x.answer.so as number[]).length > 20)!;
    const so: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = (await runQuery(deps, { where: q.query.where as never, return: "cells", limit: 7, cursor: cursor ?? undefined }, { maxRowsScanned: 1e9, maxCellsPage: 100 })) as {
        cells: { so: number[] };
        cursor: string | null;
      };
      so.push(...r.cells.so);
      cursor = r.cursor;
      pages++;
    } while (cursor && pages < 1000);
    expect(so).toEqual(q.answer.so);
    expect(pages).toBeGreaterThan(2);
  });

  it("stops at maxRowsScanned with a cursor; continuing sums to the full count", async () => {
    const q = expected.queries.find((x) => x.query.return === "count" && !x.query.by && (x.query.where as { ranges?: unknown }).ranges)!;
    let total = 0;
    let cursor: string | undefined;
    let partial = 0;
    for (;;) {
      const r = (await runQuery(deps, { where: q.query.where as never, return: "count", cursor }, { maxRowsScanned: 64, maxCellsPage: 100 })) as { count: number; cursor: string | null; complete: boolean };
      total += r.count;
      if (r.complete) break;
      partial++;
      cursor = r.cursor!;
    }
    expect(partial).toBeGreaterThan(0);
    expect(total).toBe(q.answer.count);
  });

  it("rejects a cursor of another query, unknown filters and terms", async () => {
    const r = (await runQuery(deps, { where: { cell_type: "CL:0000084" }, return: "cells", limit: 3 }, { maxRowsScanned: 1e9, maxCellsPage: 100 })) as { cursor: string };
    await expect(runQuery(deps, { where: { cell_type: "CL:0000236" }, return: "cells", cursor: r.cursor }, { maxRowsScanned: 1e9, maxCellsPage: 100 })).rejects.toThrow(/another query/);
    await expect(runQuery(deps, { where: { colour: "red" } as never }, { maxRowsScanned: 1, maxCellsPage: 1 })).rejects.toThrow(/Unknown filter/);
    await expect(runQuery(deps, { where: { organism: "Felis catus" } }, { maxRowsScanned: 1, maxCellsPage: 1 })).rejects.toThrow(/not in the index/);
    await expect(runQuery(deps, { where: { ranges: { n_umi: ["x", null] } } as never }, { maxRowsScanned: 1, maxCellsPage: 1 })).rejects.toThrow(/ranges/);
  });

  it("an ancestor named by label matches its descendants", async () => {
    const a = (await runQuery(deps, { where: { cell_type: "lymphocyte" } }, { maxRowsScanned: 1e9, maxCellsPage: 1 })) as { count: number };
    const b = (await runQuery(deps, { where: { cell_type: ["CL:0000084", "CL:0000236"] } }, { maxRowsScanned: 1e9, maxCellsPage: 1 })) as { count: number };
    expect(a.count).toBe(b.count);
    expect(a.count).toBeGreaterThan(0);
  });
});

describe("gather", () => {
  it("plans exactly like singlet.v2.atlas.plan_gather", async () => {
    const d = await openDirectory(deps, "current");
    for (const g of expected.gathers) {
      const want = new Map(g.cells.map(([s, c]) => [s, c]));
      const plans = await planSamples(deps, d, [...want.keys()]);
      const p = planGather([...want.keys()].map((s) => plans.get(s)!), want, g.members, new Set(g.have_prefix));
      expect(p.bytes).toBe(g.bytes);
      expect(p.payload).toBe(g.payload);
      expect(p.reads.map((r) => ({ sample: r.sample, key: r.key, start: r.start, end: r.end }))).toEqual(g.reads);
    }
  });

  async function gatherOnce(extra: Partial<Parameters<typeof runGather>[0]> = {}, body: Record<string, unknown> = {}) {
    const g = expected.gathers[0];
    const res = await runGather(
      { deps, limits: { maxCells: 1e6, maxSamples: 1e4, maxBytes: 1e10 }, ...extra },
      { version: "current", cells: g.cells, modalities: ["counts"], have_prefix: [], ...body }
    );
    return parseStream(res);
  }

  it("streams every planned piece with the bytes of the sample object", async () => {
    const { header, frames, trailer } = await gatherOnce();
    expect(trailer.ok).toBe(true);
    expect(header.member_names).toEqual(["exon_counts.1pz", "intron_counts.1pz"]);
    const prefixes = frames.filter((f) => f.kind === FR_PREFIX);
    const runs = frames.filter((f) => f.kind === FR_RUN);
    // one prefix per matrix a sample has (GSM9000003 has no intron matrix)
    expect(prefixes.length).toBe(header.samples.reduce((n: number, s: { members: object }) => n + Object.keys(s.members).length, 0));
    expect(prefixes.length).toBe(3);
    expect(runs.length).toBeGreaterThan(0);
    const d = await openDirectory(deps, "current");
    const plans = await planSamples(deps, d, header.samples.map((s: { so: number }) => s.so));
    for (const f of frames) {
      const s = header.samples[f.sample];
      const m = plans.get(s.so)!.members[header.member_names[f.member]];
      const obj = bucket.objects.get(s.key)!;
      expect(sameBytes(f.body, obj.subarray(m.off + f.off, m.off + f.off + f.body.length))).toBe(true);
    }
    // the planned sample-object bytes; the trailer also counts the directory and plan-block reads
    expect(header.bytes).toBe(expected.gathers[0].bytes);
    expect(trailer.bytes_read as number).toBeGreaterThanOrEqual(expected.gathers[0].bytes);
  });

  it("skips prefixes the client has and accepts GSM accessions", async () => {
    const d = await openDirectory(deps, "current");
    const g = expected.gathers[0];
    const plans = await planSamples(deps, d, g.cells.map((c) => c[0]));
    const have = [...plans.values()].flatMap((s) => Object.values(s.members).map((m) => m.digest!));
    const cells = g.cells.map(([so, c]) => [plans.get(so)!.gsm, c]);
    const { frames } = await gatherOnce({}, { have_prefix: have, cells });
    expect(frames.some((f) => f.kind === FR_PREFIX)).toBe(false);
  });

  it("gathers the cells of a query handle", async () => {
    const { header } = await gatherOnce({}, { cells: undefined, query: { where: { cell_type: "CL:0000084" } } });
    expect(header.cells).toBe(expected.gathers[0].cells.reduce((n, [, c]) => n + c.length, 0));
  });

  it("same frames through the fan-out path", async () => {
    const direct = await gatherOnce();
    const parts: number[] = [];
    const { runPart } = await import("../../workers/data-v2/src/gather");
    const fan = await gatherOnce({
      fanout: async (reads) => {
        parts.push(reads.length);
        return runPart(deps, reads);
      },
    });
    const key = (f: { sample: number; member: number; kind: number; off: number }) => `${f.sample}/${f.member}/${f.kind}/${f.off}`;
    expect(new Set(fan.frames.map(key))).toEqual(new Set(direct.frames.map(key)));
    // below FANOUT_MIN_READS the plan is not split
    expect(parts.length).toBe(0);
  });

  it("enforces the per-request caps before anything is read, and charges the plan", async () => {
    const g = expected.gathers[0];
    const n = g.cells.reduce((k, [, c]) => k + c.length, 0);
    await expect(runGather({ deps, limits: { maxCells: n - 1, maxSamples: 99, maxBytes: 1e10 } }, { cells: g.cells })).rejects.toThrow(/limit per request/);
    await expect(runGather({ deps, limits: { maxCells: 1e6, maxSamples: 99, maxBytes: 1000 } }, { cells: g.cells })).rejects.toThrow(/bytes/);
    const charged: [number, number][] = [];
    await gatherOnce({ charge: async (c, b) => void charged.push([c, b]) });
    expect(charged).toEqual([[n, g.bytes]]);
  });

  it("rejects unknown modalities and columns that are not indexed", async () => {
    expect(() => membersFor(["psi"])).toThrow(/Unknown modality/);
    expect(membersFor(["exon", "vdj"])).toEqual(["exon_counts.1pz", "vdj_gene_usage.1pz"]);
    const g = expected.gathers[0];
    await expect(runGather({ deps, limits: { maxCells: 1e6, maxSamples: 99, maxBytes: 1e10 } }, { cells: [[g.cells[0][0], [10 ** 7]]] })).rejects.toThrow(/not an indexed/);
  });

  it("reports a failed read as an error frame and keeps going", async () => {
    const g = expected.gathers[0];
    bucket.objects.delete(g.reads[0].key);
    const { frames, trailer } = await gatherOnce();
    expect(frames.some((f) => f.kind === FR_ERROR)).toBe(true);
    expect(trailer.ok).toBe(false);
  });
});

describe("limits and routes", () => {
  it("identifies anonymous callers and API keys (read-only D1)", async () => {
    const anon = await identify(new Request("https://x/", { headers: { "cf-connecting-ip": "1.2.3.4" } }), null);
    expect(anon.tier).toBe("anon");
    const db = {
      prepare: () => ({ bind: (h: unknown) => ({ first: async <T,>() => (h ? ({ id: "k1", expires_at: null, revoked_at: null } as T) : null) }) }),
    };
    const k = await identify(new Request("https://x/", { headers: { authorization: "Bearer sk_live_abcdefgh" } }), db);
    expect(k).toEqual({ id: "key:k1", tier: "key" });
    const revoked = { prepare: () => ({ bind: () => ({ first: async <T,>() => ({ id: "k2", expires_at: null, revoked_at: "2026-01-01" }) as T }) }) };
    await expect(identify(new Request("https://x/", { headers: { authorization: "Bearer sk_other_abcdefgh" } }), revoked)).rejects.toThrow(/revoked/);
  });

  it("limits come from the tier, overridable by CIDX_LIMITS", () => {
    expect(limitsFor("anon").maxCellsPerGather).toBeLessThan(limitsFor("key").maxCellsPerGather);
    expect(limitsFor("anon", JSON.stringify({ anon: { maxCellsPerGather: 5 } })).maxCellsPerGather).toBe(5);
  });

  it("the quota object adds up per UTC day and refuses past the allowance", async () => {
    const store = new Map<string, unknown>();
    const q = new CidxQuota({ storage: { get: async <T,>(k: string) => store.get(k) as T, put: async (k: string, v: unknown) => void store.set(k, v) } });
    const call = (cells: number, now: number) => q.fetch(new Request("https://q/charge", { method: "POST", body: JSON.stringify({ cells, bytes: cells * 10, cellsPerDay: 100, bytesPerDay: 1e9, now }) }));
    const day = Date.parse("2026-11-01T10:00:00Z");
    expect((await call(60, day)).status).toBe(200);
    expect((await call(50, day)).status).toBe(429);
    expect((await call(40, day)).status).toBe(200);
    expect((await call(60, day + 86_400_000)).status).toBe(200);
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: (u: string, i?: RequestInit) => q.fetch(new Request(u, i)) }) };
    await expect(charge(ns, { id: "anon:x", tier: "anon" }, { ...limitsFor("anon"), cellsPerDay: 100 }, 1000, 1)).rejects.toThrow(/Daily allowance/);
  });

  it("row-scan queries stop once the day's row budget is used; summary counts are not metered", async () => {
    const store = new Map<string, unknown>();
    const q = new CidxQuota({ storage: { get: async <T,>(k: string) => store.get(k) as T, put: async (k: string, v: unknown) => void store.set(k, v) } });
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: (u: string, i?: RequestInit) => q.fetch(new Request(u, i)) }) };
    const pending: Promise<unknown>[] = [];
    const d2: CidxDeps = { ...deps, quota: ns, waitUntil: (p) => void pending.push(p), limitsOverride: JSON.stringify({ anon: { rowsPerDay: 300 } }) };
    const scan = () =>
      handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "POST", body: JSON.stringify({ where: { ranges: { n_umi: [0, null] } } }) }), d2);
    expect((await scan()).status).toBe(200); // scans 225 rows
    await Promise.all(pending);
    expect((await scan()).status).toBe(200); // 225 < 300: allowed, overshoots to 450
    await Promise.all(pending);
    const r = await scan();
    expect(r.status).toBe(429);
    expect(((await r.json()) as { message: string }).message).toMatch(/rows scanned/);
    const summary = await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "POST", body: JSON.stringify({ where: { cell_type: "T cell" } }) }), d2);
    expect(summary.status).toBe(200);
  });

  it("routes: preflight, method, JSON errors, internal part endpoint, query over HTTP", async () => {
    const pre = await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "OPTIONS" }), deps);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect((await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query"), deps)).status).toBe(405);
    expect((await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "POST", body: "{" }), deps)).status).toBe(400);
    expect((await handleCidx(new Request("https://data.singlet.bio/v2/cidx/_part", { method: "POST", body: "{}" }), deps)).status).toBe(404);
    const ok = await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "POST", body: JSON.stringify({ where: { cell_type: "CL:0000084" } }) }), deps);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { count: number }).count).toBe(expected.queries[1].answer.count);
    const big = await handleCidx(
      new Request("https://data.singlet.bio/v2/cidx/gather", { method: "POST", body: JSON.stringify({ cells: expected.gathers[0].cells }) }),
      { ...deps, limitsOverride: JSON.stringify({ anon: { maxCellsPerGather: 3 } }) }
    );
    expect(big.status).toBe(413);
    const limited = await handleCidx(new Request("https://data.singlet.bio/v2/cidx/query", { method: "POST", body: "{}" }), {
      ...deps,
      rateLimiter: { anon: { limit: async () => ({ success: false }) } },
    });
    expect(limited.status).toBe(429);
  });

  it("serves the index objects and sidecars by GET with the right cache policy", () => {
    expect(classify(`https://data.singlet.bio/v2/cidx/obj/${"a".repeat(32)}.scx`)?.cacheControl).toContain("immutable");
    expect(classify(`https://data.singlet.bio/v2/cidx/v/20261101T0000Z-0123abcd.json`)?.cacheControl).toContain("immutable");
    expect(classify(`https://data.singlet.bio/v2/cidx/current.json`)?.cacheControl).toBe("public, max-age=60");
    expect(classify(`https://data.singlet.bio/v2/a/GSM123/${"b".repeat(32)}.parquet`)).not.toBeNull();
    expect(classify(`https://data.singlet.bio/v2/cidx/obj/../current.json`)).toBeNull();
  });
});
