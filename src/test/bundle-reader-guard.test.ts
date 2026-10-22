// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEAD_TIMEOUT_MS,
  StaleBundleError,
  USER_HOST_FULL_READ_MAX,
  entryRange,
  getBundleIndex,
  httpBundleSource,
  parseZipSource,
  readEntry,
  readEntryFromSource,
  withIndexRetry,
  type ZipEntry,
} from "../../functions/_shared/bundle-reader";
import { loadSampleQc } from "../../functions/_shared/bundle-core";
import { getPartialDownload } from "../../functions/_shared/mcp-tools";
import { onRequestGet } from "../../functions/api/bundle/[gse]/[action]";
import { createTestD1 } from "./helpers/d1-sqlite";
import { FakeHost, buildZip, type ZipFile } from "./helpers/zip";

const URL1 = "https://data.singlet.bio/data/GSE1/GSE1.singlet";
const enc = new TextEncoder();
const summary = (gsm: string) => enc.encode(JSON.stringify({ protocol_name: "10x 3' v3", n_cells_called: 100, median_umi_per_cell: 900, reference_build: "GRCh38" , gsm }));
const matrix = (tag: string) => enc.encode(`TP1Z ${tag}`.padEnd(64, "."));

/** The bundle as first packed: plain local headers, a donor file ahead of the matrix. */
function layoutA(): ZipFile[] {
  return [
    { name: "manifest.json", data: enc.encode('{"gsm_ids":["GSM1"]}'), deflate: true },
    { name: "samples/GSM1/donor/snp_ad.tsv", data: enc.encode("x".repeat(500)), deflate: true },
    { name: "samples/GSM1/summary.json", data: summary("GSM1"), deflate: true },
    { name: "samples/GSM1/extra.tsv", data: enc.encode("y".repeat(300)), deflate: true },
    { name: "samples/GSM1/exon_counts.1pz", data: matrix("A") },
    { name: "samples/GSM1/big.tsv", data: new Uint8Array(5 * 1024 * 1024), deflate: true },
  ];
}
/** The same study after the migration rewrote it: restricted member and extra.tsv gone, zip64 local headers (extra length 20). */
function layoutB(): ZipFile[] {
  return layoutA()
    .filter((f) => !f.name.includes("snp_") && !f.name.endsWith("extra.tsv"))
    .map((f) => ({ ...f, zip64Local: true }));
}

const LEGACY_TABLE = "CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT)";
const SCHEMA_031 = readFileSync("schema/031_bundle_index_identity.sql", "utf8");

function legacyD1() {
  return createTestD1(LEGACY_TABLE);
}
function identityD1() {
  const db = createTestD1(LEGACY_TABLE);
  db.raw.exec(SCHEMA_031); // the real file, on the table as production has it
  return db;
}

let host: FakeHost;
beforeEach(() => {
  host = new FakeHost();
  vi.stubGlobal("fetch", host.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Seed D1 with the index of layout A (as an old crank wrote it) while the host now serves layout B. */
async function staleSetup(opts: { identity: boolean; storedEtag?: string | null }) {
  const a = buildZip(layoutA());
  const b = buildZip(layoutB());
  host.put(URL1, { bytes: b.bytes, etag: '"etag-B"', lastModified: "Tue, 20 Oct 2026 22:21:57 GMT" });
  const db = opts.identity ? identityD1() : legacyD1();
  const cols = opts.identity ? "(gse_id, bytes, entries, indexed_at, etag, last_modified, verified_at)" : "(gse_id, bytes, entries, indexed_at)";
  const marks = opts.identity ? "(?, ?, ?, ?, ?, ?, ?)" : "(?, ?, ?, ?)";
  const vals: (string | number | null)[] = ["GSE1", a.bytes.length, JSON.stringify(a.entries), "2026-09-06T04:15:53Z"];
  if (opts.identity) vals.push(opts.storedEtag === undefined ? '"etag-A"' : opts.storedEtag, "Fri, 19 Jun 2026 10:00:00 GMT", "2026-09-06T04:15:53Z");
  db.raw.prepare(`INSERT INTO bundle_index ${cols} VALUES ${marks}`).run(...vals);
  return { db, a, b };
}

function pending() {
  const list: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void list.push(p), settle: () => Promise.all(list) };
}

describe("schema/031 and the identity columns", () => {
  it("runs on the table as production has it, and getBundleIndex stores etag, last_modified and verified_at", async () => {
    const db = identityD1();
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"', lastModified: "Tue, 20 Oct 2026 22:21:57 GMT" });
    const idx = await getBundleIndex(db, "GSE1");
    expect(idx).toMatchObject({ bytes: b.bytes.length, etag: '"etag-B"', last_modified: "Tue, 20 Oct 2026 22:21:57 GMT" });
    expect(idx.verified_at).toBe(idx.indexed_at);
    const row = db.raw.prepare("SELECT bytes, etag, last_modified, verified_at FROM bundle_index WHERE gse_id = 'GSE1'").get() as Record<string, unknown>;
    expect(row).toMatchObject({ bytes: b.bytes.length, etag: '"etag-B"', last_modified: "Tue, 20 Oct 2026 22:21:57 GMT" });
    expect(row.verified_at).toBeTruthy();
    // and the second call is served from the row, with the identity
    host.log.length = 0;
    expect(await getBundleIndex(db, "GSE1")).toMatchObject({ etag: '"etag-B"' });
    expect(host.log).toHaveLength(0);
  });

  it("costs one statement to read a stored row and one to write it: nothing is probed or created up front", async () => {
    const db = identityD1();
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"' });
    const sql: string[] = [];
    const orig = db.prepare.bind(db);
    (db as { prepare: unknown }).prepare = (q: string) => (sql.push(q), orig(q));
    await getBundleIndex(db, "GSE1"); // miss: one SELECT, then the file is read and one INSERT stores it
    expect(sql.map((q) => q.trim().split(/\s+/)[0])).toEqual(["SELECT", "INSERT"]);
    sql.length = 0;
    await getBundleIndex(db, "GSE1"); // hit
    expect(sql.map((q) => q.trim().split(/\s+/)[0])).toEqual(["SELECT"]);
  });

  it("a fresh table is created with the columns", async () => {
    const db = createTestD1();
    host.put(URL1, { bytes: buildZip(layoutB()).bytes, etag: '"etag-B"' });
    await getBundleIndex(db, "GSE1");
    const cols = (db.raw.prepare("PRAGMA table_info(bundle_index)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["etag", "last_modified", "verified_at"]));
  });

  it("works on a table without the columns (schema/031 not applied yet): reads, writes and no If-Match", async () => {
    const db = legacyD1();
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"' });
    const first = await getBundleIndex(db, "GSE1");
    expect(first.entries.map((e) => e.p)).toEqual(b.entries.map((e) => e.p));
    expect(first.etag).toBe('"etag-B"'); // known from the HEAD, just not stored
    const again = await getBundleIndex(db, "GSE1");
    expect(again.entries).toHaveLength(b.entries.length);
    expect(again.etag).toBeNull(); // the row has nowhere to keep it
    const range = await entryRange("GSE1", again.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!, again);
    expect(range.start).toBeGreaterThan(0);
    // the only If-Match on the wire is the one pinned from the HEAD while indexing
    expect(host.ranged.filter((r) => r.ifMatch === null).length).toBe(1);
  });

  it("starts using the columns once they appear, without a redeploy", async () => {
    vi.useFakeTimers();
    try {
      const db = legacyD1();
      host.put(URL1, { bytes: buildZip(layoutB()).bytes, etag: '"etag-B"' });
      await getBundleIndex(db, "GSE1");
      db.raw.exec(SCHEMA_031);
      vi.advanceTimersByTime(61_000);
      await getBundleIndex(db, "GSE1", { refresh: true });
      const row = db.raw.prepare("SELECT etag FROM bundle_index").get() as { etag: string };
      expect(row.etag).toBe('"etag-B"');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ranged reads", () => {
  it("send If-Match with the pinned etag and require 206", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"' });
    const src = httpBundleSource(URL1);
    const parsed = await parseZipSource(src);
    expect(parsed.etag).toBe('"etag-B"');
    expect(host.ranged.length).toBeGreaterThan(0);
    for (const r of host.ranged) expect(r.ifMatch, r.range ?? "").toBe('"etag-B"'); // pinned by the HEAD
  });

  it("do not send a weak etag as If-Match", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: 'W/"weak-1"' });
    await parseZipSource(httpBundleSource(URL1));
    for (const r of host.ranged) expect(r.ifMatch).toBeNull();
  });

  it("refuse a 200 for a range instead of buffering the whole file", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"', ignoreRange: true });
    const entry = b.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!;
    const err = await entryRange("GSE1", entry).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StaleBundleError);
    expect(String(err)).toMatch(/Range 200/);
    await expect(parseZipSource(httpBundleSource(URL1))).rejects.toThrow(/Range 200/);
  });

  it("treat 412 (changed) and 416 (past the end) as a stale index", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"' });
    const entry = b.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!;
    await expect(entryRange("GSE1", entry, { etag: '"etag-OLD"' })).rejects.toBeInstanceOf(StaleBundleError); // 412
    const far: ZipEntry = { ...entry, o: b.bytes.length + 1000 };
    await expect(entryRange("GSE1", far)).rejects.toBeInstanceOf(StaleBundleError); // 416
    expect(host.ranged.map((r) => r.status)).toEqual([412, 416]);
  });
});

describe("the local-header check", () => {
  it("accepts the right entry, including a zip64 local header with a 20-byte extra", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-B"' });
    const entry = b.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!;
    const { start, end, etag } = await entryRange("GSE1", entry);
    expect(etag).toBe('"etag-B"');
    expect(end - start + 1).toBe(entry.c);
    expect(new TextDecoder().decode(b.bytes.slice(start, start + 4))).toBe("TP1Z");
    // 30 bytes + the name only: the header check does not cost a bigger read
    expect(host.ranged[0].range).toBe(`bytes=${entry.o}-${entry.o + 29 + enc.encode(entry.p).length}`);
  });

  it("rejects an offset that no longer points at a local header", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: null }); // no ETag to lean on: the header check alone must catch it
    const entry = b.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!;
    const shifted: ZipEntry = { ...entry, o: entry.o + 7 }; // inside the previous header, not at one
    await expect(entryRange("GSE1", shifted)).rejects.toThrow(/No zip local header/);
    await expect(readEntry("GSE1", shifted)).rejects.toBeInstanceOf(StaleBundleError);
  });

  it("rejects a header that belongs to another entry", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: null });
    const manifest = b.entries.find((e) => e.p === "manifest.json")!;
    const wrongName: ZipEntry = { ...manifest, p: "samples/GSM1/summary.json" }; // same offset, other name
    await expect(entryRange("GSE1", wrongName)).rejects.toThrow(/is not 'samples\/GSM1\/summary.json'/);
  });

  it("readEntryFromSource inflates a deflated entry and checks the name", async () => {
    const b = buildZip(layoutB());
    const src = { size: async () => b.bytes.length, range: async (s: number, e: number) => b.bytes.slice(s, e + 1) };
    const sum = b.entries.find((e) => e.p === "samples/GSM1/summary.json")!;
    expect(JSON.parse(new TextDecoder().decode(await readEntryFromSource(src, sum)))).toMatchObject({ gsm: "GSM1" });
    await expect(readEntryFromSource(src, { ...sum, p: "samples/GSM2/summary.json" })).rejects.toBeInstanceOf(StaleBundleError);
  });

  it("copes with a local extra field longer than the slack the read asks for", async () => {
    const files: ZipFile[] = [{ name: "a.txt", data: enc.encode("hello world") }];
    const built = buildZip(files);
    // splice a 2000-byte extra field into the local header (and shift nothing else: single entry, offset 0)
    const nameLen = "a.txt".length;
    const extra = new Uint8Array(2000);
    const head = built.bytes.slice(0, 30 + nameLen);
    new DataView(head.buffer).setUint16(28, 2000, true);
    const body = built.bytes.slice(30 + nameLen, 30 + nameLen + 11);
    const bytes = new Uint8Array([...head, ...extra, ...body]);
    const src = { size: async () => bytes.length, range: async (s: number, e: number) => bytes.slice(s, Math.min(e, bytes.length - 1) + 1) };
    const out = await readEntryFromSource(src, { p: "a.txt", n: 0, c: 11, u: 11, o: 0 });
    expect(new TextDecoder().decode(out)).toBe("hello world");
  });
});

describe("a stale cached index after the file was overwritten", () => {
  it("is refreshed once on the first ranged read, and the retry returns the right bytes", async () => {
    const { db, a, b } = await staleSetup({ identity: true });
    const p = pending();
    const target = "samples/GSM1/exon_counts.1pz";
    expect(b.entries.map((e) => e.o)).not.toContain(a.entries.find((e) => e.p === target)!.o); // the cached offset is not a header in the new file
    const out = await withIndexRetry(db, "GSE1", { waitUntil: p.waitUntil }, async (index) => {
      const entry = index.entries.find((e) => e.p === target)!;
      return { index, range: await entryRange("GSE1", entry, index) };
    });
    await p.settle();
    // the 412 on the stored etag came first, then a refresh (HEAD + tail + central directory), then the retry
    expect(host.ranged[0]).toMatchObject({ status: 412, ifMatch: '"etag-A"' });
    expect(host.heads).toHaveLength(1);
    expect(out.index.etag).toBe('"etag-B"');
    expect(new TextDecoder().decode(b.bytes.slice(out.range.start, out.range.start + 4))).toBe("TP1Z");
    // D1 now holds the new identity and offsets
    const row = db.raw.prepare("SELECT bytes, etag, verified_at, indexed_at FROM bundle_index").get() as Record<string, unknown>;
    expect(row).toMatchObject({ bytes: b.bytes.length, etag: '"etag-B"' });
    expect(row.verified_at).not.toBe("2026-09-06T04:15:53Z");
  });

  it("is caught by the header check alone for a row that has no etag (written before schema/031)", async () => {
    const { db, a, b } = await staleSetup({ identity: false });
    expect(b.entries.map((e) => e.o)).not.toContain(a.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!.o);
    const p = pending();
    const out = await withIndexRetry(db, "GSE1", { waitUntil: p.waitUntil }, async (index) => {
      const entry = index.entries.find((e) => e.p === "samples/GSM1/exon_counts.1pz")!;
      return entryRange("GSE1", entry, index);
    });
    await p.settle();
    expect(host.ranged.some((r) => r.status === 412)).toBe(false); // nothing to send If-Match with
    expect(new TextDecoder().decode(b.bytes.slice(out.start, out.start + 4))).toBe("TP1Z");
    expect(host.heads).toHaveLength(1); // exactly one refresh
  });

  it("refreshes once, not in a loop, when the file still does not match", async () => {
    const a = buildZip(layoutA());
    // central directory says one thing, the local header another: a refresh cannot fix this file
    const broken = buildZip([{ name: "samples/GSM1/exon_counts.1pz", data: matrix("X"), localName: "samples/GSM9/exon_counts.1pz" }]);
    host.put(URL1, { bytes: broken.bytes, etag: '"etag-X"' });
    const db = identityD1();
    db.raw.prepare("INSERT INTO bundle_index VALUES ('GSE1', ?, ?, '2026-09-06T04:15:53Z', '\"etag-X\"', NULL, NULL)").run(a.bytes.length, JSON.stringify(broken.entries));
    let calls = 0;
    const err = await withIndexRetry(db, "GSE1", {}, async (index) => {
      calls++;
      return entryRange("GSE1", index.entries[0], index);
    }).catch((e) => e);
    expect(err).toBeInstanceOf(StaleBundleError);
    expect(calls).toBe(2);
    expect(host.heads).toHaveLength(1);
  });

  it("does not hide other errors behind a refresh", async () => {
    const { db } = await staleSetup({ identity: true });
    const err = await withIndexRetry(db, "GSE1", {}, async () => {
      throw new Error("boom");
    }).catch((e) => e);
    expect(String(err)).toBe("Error: boom");
    expect(host.heads).toHaveLength(0);
  });

  it("shares one central-directory read between concurrent refreshes of the same study", async () => {
    const { db } = await staleSetup({ identity: true });
    await Promise.all([getBundleIndex(db, "GSE1", { refresh: true }), getBundleIndex(db, "GSE1", { refresh: true }), getBundleIndex(db, "GSE1", { refresh: true })]);
    expect(host.heads).toHaveLength(1);
  });

  it("loadSampleQc re-reads the central directory when the summaries cannot be found at the cached offsets", async () => {
    const { db } = await staleSetup({ identity: true });
    // no sample_qc rows → the summaries are read from the bundle
    db.raw.exec(
      "CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, n_usable_samples INTEGER); " +
        "CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, n_input_reads INTEGER, uniquely_mapped_pct REAL, n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL, intronic_fraction REAL, sequencing_saturation REAL, median_mito_fraction REAL, fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT, updated_at TEXT, matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);"
    );
    const p = pending();
    const { source, samples } = await loadSampleQc(db, "GSE1", { waitUntil: p.waitUntil });
    await p.settle();
    expect(source).toBe("bundle");
    expect(samples.map((s) => s.gsm_id)).toEqual(["GSM1"]);
    expect(samples[0].n_cells_called).toBe(100);
  });
});

describe("getBundleIndex verify", () => {
  it("re-reads when the live size differs, and leaves a matching row alone", async () => {
    const { db, b } = await staleSetup({ identity: true });
    const p = pending();
    const idx = await getBundleIndex(db, "GSE1", { verify: true, waitUntil: p.waitUntil });
    await p.settle();
    expect(idx.bytes).toBe(b.bytes.length);
    expect(idx.etag).toBe('"etag-B"');
    host.log.length = 0;
    const again = await getBundleIndex(db, "GSE1", { verify: true });
    expect(again.bytes).toBe(b.bytes.length);
    expect(host.log.map((r) => r.method)).toEqual(["HEAD"]); // one HEAD, no re-read
  });

  it("re-reads when only the etag differs (same size)", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: '"etag-NEW"' });
    const db = identityD1();
    db.raw.prepare("INSERT INTO bundle_index VALUES ('GSE1', ?, ?, 't', '\"etag-OLD\"', NULL, 't')").run(b.bytes.length, JSON.stringify(b.entries));
    const idx = await getBundleIndex(db, "GSE1", { verify: true });
    expect(idx.etag).toBe('"etag-NEW"');
  });

  it("keeps the cached row when the HEAD fails", async () => {
    const { db, a } = await staleSetup({ identity: true });
    host.failHead = 503;
    const idx = await getBundleIndex(db, "GSE1", { verify: true });
    expect(idx.bytes).toBe(a.bytes.length);
    expect(host.ranged).toHaveLength(0);
  });

  it("is off by default: entry reads cost no HEAD", async () => {
    const { db, a } = await staleSetup({ identity: true });
    const idx = await getBundleIndex(db, "GSE1");
    expect(idx.bytes).toBe(a.bytes.length);
    expect(host.log).toHaveLength(0);
  });
});

describe("GET /api/bundle/:gse/entry", () => {
  function get(path: string, env: unknown) {
    const request = new Request(`https://singlet.bio${path}`);
    const [, , , gse, action] = new URL(request.url).pathname.split("/");
    const waits: Promise<unknown>[] = [];
    return (async () => {
      const res = await onRequestGet({ request, env, params: { gse, action }, waitUntil: (p: Promise<unknown>) => void waits.push(p) } as never);
      await Promise.all(waits);
      return res;
    })();
  }

  it("answers a corrected recipe (start offset, live etag) for a >4 MB entry whose cached offset is stale", async () => {
    const { db, a, b } = await staleSetup({ identity: true });
    const aBig = a.entries.find((e) => e.p.endsWith("big.tsv"))!;
    const bBig = b.entries.find((e) => e.p.endsWith("big.tsv"))!;
    expect(aBig.o).not.toBe(bBig.o);
    const res = await get(`/api/bundle/GSE1/entry?path=${encodeURIComponent("samples/GSM1/big.tsv")}`, { DB: db });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { range: string; etag: string; method: string; bytes_uncompressed: number };
    expect(body.etag).toBe('"etag-B"');
    expect(body.method).toBe("deflate-raw");
    const [start] = body.range.replace("bytes=", "").split("-").map(Number);
    expect(start).toBeGreaterThan(bBig.o); // the payload starts after the local header (30 + name + 20)
    expect(start).toBe(bBig.o + 30 + enc.encode(bBig.p).length + 20);
  });

  it("returns the inflated file for a small entry after refreshing a stale index", async () => {
    const { db } = await staleSetup({ identity: true });
    const res = await get(`/api/bundle/GSE1/entry?path=${encodeURIComponent("samples/GSM1/summary.json")}`, { DB: db });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gsm: "GSM1" });
  });

  it("answers 404 for an entry the refreshed listing no longer has", async () => {
    const { db } = await staleSetup({ identity: true });
    // extra.tsv is gone from layout B; the stale row still lists it, at an offset that is now another entry
    const res = await get(`/api/bundle/GSE1/entry?path=${encodeURIComponent("samples/GSM1/extra.tsv")}`, { DB: db });
    expect(res.status).toBe(404);
  });

  it("answers 409 with a clear message, not a cached 200 or a 502, when the file and index still disagree", async () => {
    const broken = buildZip([{ name: "samples/GSM1/summary.json", data: summary("GSM1"), deflate: true, localName: "samples/GSM9/summary.json" }]);
    host.put(URL1, { bytes: broken.bytes, etag: '"etag-X"' });
    const db = identityD1();
    db.raw.prepare("INSERT INTO bundle_index VALUES ('GSE1', ?, ?, 't', '\"etag-X\"', NULL, 't')").run(broken.bytes.length, JSON.stringify(broken.entries));
    const res = await get(`/api/bundle/GSE1/entry?path=${encodeURIComponent("samples/GSM1/summary.json")}`, { DB: db });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text).error).toMatch(/did not match the file and was refreshed/);
    expect(text).not.toMatch(/offset|SELECT|sqlite/i);
  });

  it("index action: one HEAD detects an overwritten file, and the size it reports is the live one", async () => {
    const { db, b } = await staleSetup({ identity: true });
    const res = await get("/api/bundle/GSE1/index", { DB: db });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bytes: number; etag: string; samples: { files: { path: string }[] }[] };
    expect(body.bytes).toBe(b.bytes.length);
    expect(body.etag).toBe('"etag-B"');
    // the restricted donor file is not listed either way (publicEntries), the matrix is
    expect(body.samples[0].files.map((f) => f.path)).toContain("samples/GSM1/exon_counts.1pz");
  });
});

describe("MCP get_partial_download", () => {
  it("gives the corrected range and an If-Match for a stale cached index", async () => {
    const { db, b } = await staleSetup({ identity: true });
    const entry = b.entries.find((e) => e.p.endsWith("exon_counts.1pz"))!;
    const p = pending();
    const r = await getPartialDownload({ db, waitUntil: p.waitUntil }, { gse_id: "GSE1", gsm_id: "GSM1", file: "exon_counts.1pz" });
    await p.settle();
    expect(r.isError).toBeUndefined();
    const s = r.structuredContent as { range: string; etag: string; curl: string; python: string };
    const start = entry.o + 30 + enc.encode(entry.p).length + 20;
    expect(s.range).toBe(`bytes=${start}-${start + entry.c - 1}`);
    expect(s.etag).toBe('"etag-B"');
    expect(s.curl).toContain(`-H 'If-Match: "etag-B"'`);
    expect(s.python).toContain(`"If-Match": '"etag-B"'`);
  });

  it("says so, as a tool error, when the file keeps disagreeing with its index", async () => {
    const broken = buildZip([{ name: "samples/GSM1/exon_counts.1pz", data: matrix("X"), localName: "samples/GSM9/exon_counts.1pz" }]);
    host.put(URL1, { bytes: broken.bytes, etag: '"etag-X"' });
    const db = identityD1();
    db.raw.prepare("INSERT INTO bundle_index VALUES ('GSE1', ?, ?, 't', '\"etag-X\"', NULL, 't')").run(broken.bytes.length, JSON.stringify(broken.entries));
    const r = await getPartialDownload({ db, waitUntil: () => undefined }, { gse_id: "GSE1", gsm_id: "GSM1", file: "exon_counts.1pz" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/did not match the file and was refreshed/);
  });
});

describe("a user-registered host (private uploads)", () => {
  const USER_URL = "https://files.example.org/u/study.singlet";
  const user = (opts: { etag?: string | null } = {}) => httpBundleSource(USER_URL, { noRedirects: true, userHost: true, ...opts });

  it("accepts a 200 to a ranged request by reading no more than end + 1 bytes, then cancelling the body", async () => {
    let pulled = 0;
    let cancelled = false;
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": "10000000" } });
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          const chunk = new Uint8Array(1000).map((_, i) => (pulled + i) & 255);
          pulled += 1000;
          c.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 }); // a host that ignores Range and would send the whole file
    });
    const src = user();
    await src.head!();
    const got = await src.range(2500, 3999);
    expect(got.length).toBe(1500);
    expect(got[0]).toBe(2500 & 255);
    expect(pulled).toBeLessThanOrEqual(4000 + 1000);
    expect(cancelled).toBe(true);
  });

  it("refuses a ranged read that would need more than the full-read cap from a host that ignores Range", async () => {
    const big = { bytes: new Uint8Array(USER_HOST_FULL_READ_MAX + 1000), etag: null, ignoreRange: true };
    host.put(USER_URL, big);
    const src = user();
    await src.head!();
    await expect(src.range(big.bytes.length - 100, big.bytes.length - 1)).rejects.toThrow(/ignores Range requests/);
    // a small read at the front is still fine
    expect((await src.range(0, 99)).length).toBe(100);
  });

  it("indexes a small zip from a host that ignores Range", async () => {
    const b = buildZip(layoutB());
    host.put(USER_URL, { bytes: b.bytes, etag: null, ignoreRange: true });
    // the fixture archive holds a 5 MiB entry; the whole file is still under the cap
    const parsed = await parseZipSource(user());
    expect(parsed.entries.map((e) => e.p)).toEqual(b.entries.map((e) => e.p));
    const sum = b.entries.find((e) => e.p.endsWith("summary.json"))!;
    expect(new TextDecoder().decode(await readEntryFromSource(user(), sum))).toContain("GSM1");
  });

  it("sends If-Match only with a strong ETag from that host's own HEAD, never one it was handed", async () => {
    const b = buildZip(layoutB());
    host.put(USER_URL, { bytes: b.bytes, etag: '"theirs-1"' });
    const src = user({ etag: '"ours-0"' });
    await parseZipSource(src);
    expect(host.ranged.length).toBeGreaterThan(0);
    for (const r of host.ranged) expect(r.ifMatch).toBe('"theirs-1"');
    host.log.length = 0;
    host.put(USER_URL, { bytes: b.bytes, etag: 'W/"weak"' });
    await parseZipSource(user({ etag: '"ours-0"' }));
    for (const r of host.ranged) expect(r.ifMatch).toBeNull();
    host.log.length = 0;
    host.put(USER_URL, { bytes: b.bytes, etag: null });
    await parseZipSource(user({ etag: '"ours-0"' }));
    for (const r of host.ranged) expect(r.ifMatch).toBeNull();
  });

  it("treats a 412 as a reason to HEAD again and ask once more; a second 412 is a stale file", async () => {
    const b = buildZip(layoutB());
    host.put(USER_URL, { bytes: b.bytes, etag: '"v1"' });
    const src = user();
    await src.head!();
    host.put(USER_URL, { bytes: b.bytes, etag: '"v2"' }); // replaced after our HEAD
    host.log.length = 0;
    const got = await src.range(0, 3);
    expect(got.length).toBe(4);
    expect(host.log.map((r) => `${r.method}:${r.status}`)).toEqual(["GET:412", "HEAD:200", "GET:206"]);
    expect(host.ranged[1].ifMatch).toBe('"v2"');
    // a host that answers 412 whatever we send
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) =>
      init?.method === "HEAD" ? new Response(null, { status: 200, headers: { "content-length": "100", etag: '"x"' } }) : new Response("no", { status: 412 })
    );
    const bad = user();
    await bad.head!();
    await expect(bad.range(0, 3)).rejects.toBeInstanceOf(StaleBundleError);
  });

  it("our own host is still 206 only", async () => {
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: null, ignoreRange: true });
    await expect(parseZipSource(httpBundleSource(URL1))).rejects.toThrow(/Range 200/);
  });
});

describe("recipes and the verify HEAD", () => {
  it("never offer a weak ETag as If-Match in a recipe", async () => {
    const a = buildZip(layoutA());
    const b = buildZip(layoutB());
    host.put(URL1, { bytes: b.bytes, etag: 'W/"compressed-1"' });
    const db = identityD1();
    db.raw.prepare("INSERT INTO bundle_index VALUES ('GSE1', ?, ?, 't', NULL, NULL, 't')").run(a.bytes.length, JSON.stringify(a.entries));
    const res = await (async () => {
      const request = new Request(`https://singlet.bio/api/bundle/GSE1/entry?path=${encodeURIComponent("samples/GSM1/big.tsv")}`);
      return onRequestGet({ request, env: { DB: db }, params: { gse: "GSE1", action: "entry" }, waitUntil: () => undefined } as never);
    })();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { etag: string | null }).etag).toBeNull();
    const r = await getPartialDownload({ db, waitUntil: () => undefined }, { gse_id: "GSE1", gsm_id: "GSM1", file: "exon_counts.1pz" });
    const s = r.structuredContent as { etag: string | null; curl: string; python: string };
    expect(s.etag).toBeNull();
    expect(s.curl).not.toMatch(/If-Match/);
    expect(s.python).not.toMatch(/If-Match/);
  });

  it("verify gives up on a HEAD that does not answer within the limit, and the cached row stands", async () => {
    const { db, a } = await staleSetup({ identity: true });
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      expect(ms).toBe(HEAD_TIMEOUT_MS);
      return AbortSignal.abort();
    });
    const hanging = host.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        if (init.signal?.aborted) throw new DOMException("The operation was aborted", "TimeoutError");
        return new Promise<Response>(() => undefined);
      }
      return hanging(input, init);
    });
    const idx = await getBundleIndex(db, "GSE1", { verify: true });
    expect(spy).toHaveBeenCalled();
    expect(idx.bytes).toBe(a.bytes.length); // the stale row stands; the guard on the reads will catch it
    expect(HEAD_TIMEOUT_MS).toBe(5000);
  });
});
