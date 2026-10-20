// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allocateCells,
  fnv1a32,
  mulberry32,
  planChunks,
  planManifest,
  selectColumns,
  toRuns,
  type ChunkRow,
  type IndexedEntry,
} from "../../functions/_shared/cohort-manifest";
import { setBitIndex } from "../../functions/_shared/cohort-index";
import { onRequestGet } from "../../functions/api/cohort/manifest";
import { createTestD1 } from "./helpers/d1-sqlite";
import { indexOf, sample } from "./helpers/bitindex-fixture";

const counts = (ns: number[]) => ns.map((n, i) => ({ gsm_id: `GSM${100 + i}`, n_cells: n }));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("seeded stream (reference vectors for client implementations)", () => {
  it("fnv1a32 and mulberry32 match the documented values", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    const r = mulberry32(1);
    // Raw 32-bit outputs: floor(r() * 2^32).
    expect([r(), r(), r()].map((x) => Math.floor(x * 4294967296))).toEqual([2693262067, 11749833, 2265367787]);
    expect(fnv1a32("7|GSM100")).toBe(3090295242);
  });
});

describe("allocateCells", () => {
  it("keeps everything when the cohort fits", () => {
    const a = allocateCells(counts([500, 300]), 800, "s");
    expect(a.keep).toEqual([500, 300]);
    expect(a.dropped).toEqual([]);
    expect(allocateCells(counts([500, 300]), 5000, "s").cells_after).toBe(800);
  });

  it("is proportional per sample and totals exactly max_cells", () => {
    const n = [10000, 5000, 3000, 2000];
    const a = allocateCells(counts(n), 2000, "s");
    expect(sum(a.keep)).toBe(2000);
    expect(a.keep).toEqual([1000, 500, 300, 200]);
    expect(a.dropped).toEqual([]);
    // Uneven shares: largest remainder keeps the total exact and within one cell of proportional.
    const m = [1234, 4321, 777, 9999, 52];
    const b = allocateCells(counts(m), 3001, "s", 1);
    expect(sum(b.keep)).toBe(3001);
    b.keep.forEach((k, i) => {
      expect(Math.abs(k - (m[i] * 3001) / sum(m))).toBeLessThan(1);
      expect(k).toBeLessThanOrEqual(m[i]);
    });
  });

  it("drops whole samples only when their share is under the floor, smallest first", () => {
    // 10 samples of 100k and 3 of 40 cells, cap 5000: the small ones would get ~0.1 cells each.
    const n = [...Array(10).fill(100000), 40, 40, 40];
    const a = allocateCells(counts(n), 5000, "s", 50);
    expect(a.dropped).toEqual([10, 11, 12]);
    expect(a.keep.slice(0, 10).every((k) => k === 500)).toBe(true);
    expect(sum(a.keep)).toBe(5000);
    // The floor is at least one cell: a sample that would get none is dropped, whatever the setting.
    expect(allocateCells(counts(n), 5000, "s", 0).dropped).toEqual([10, 11, 12]);
  });

  it("does not drop a sample the cap leaves enough for", () => {
    const a = allocateCells(counts([1000, 1000, 100]), 1500, "s", 50);
    expect(a.dropped).toEqual([]);
    expect(a.keep.every((k) => k >= 50)).toBe(true);
    expect(sum(a.keep)).toBe(1500);
  });

  it("keeps one sample when the cap is below the floor", () => {
    const a = allocateCells(counts([400, 300, 200]), 20, "s", 50);
    expect(a.dropped.length).toBe(2);
    expect(sum(a.keep)).toBe(20);
    expect(a.keep[0]).toBe(20);
  });

  it("is deterministic and independent of input order", () => {
    const n = [900, 900, 900, 900, 7, 7, 7];
    const a = allocateCells(counts(n), 1000, "seed-1", 50);
    const b = allocateCells(counts(n), 1000, "seed-1", 50);
    expect(a).toEqual(b);
    const shuffled = [...counts(n)].reverse();
    const c = allocateCells(shuffled, 1000, "seed-1", 50);
    const byId = (s: { gsm_id: string }[], k: number[]) => Object.fromEntries(s.map((x, i) => [x.gsm_id, k[i]]));
    expect(byId(shuffled, c.keep)).toEqual(byId(counts(n), a.keep));
  });
});

describe("selectColumns", () => {
  it("returns k sorted distinct columns below n", () => {
    const c = selectColumns(10000, 700, "42", "GSM1");
    expect(c.length).toBe(700);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    expect(c[c.length - 1]).toBeLessThan(10000);
  });
  it("is deterministic per (seed, sample) and differs across them", () => {
    const a = selectColumns(5000, 500, "42", "GSM1");
    expect([...selectColumns(5000, 500, "42", "GSM1")]).toEqual([...a]);
    expect([...selectColumns(5000, 500, "43", "GSM1")]).not.toEqual([...a]);
    expect([...selectColumns(5000, 500, "42", "GSM2")]).not.toEqual([...a]);
  });
  it("is spread over the sample, not the front", () => {
    const c = selectColumns(10000, 1000, "1", "GSM9");
    const firstHalf = [...c].filter((x) => x < 5000).length;
    expect(firstHalf).toBeGreaterThan(400);
    expect(firstHalf).toBeLessThan(600);
  });
  it("returns everything when k >= n and handles k = 0", () => {
    expect([...selectColumns(4, 9, "1", "G")]).toEqual([0, 1, 2, 3]);
    expect(selectColumns(4, 0, "1", "G").length).toBe(0);
  });
  it("pins the output for a fixed input (client conformance vector)", () => {
    expect([...selectColumns(20, 5, "7", "GSM100")]).toEqual(VECTOR_20_5);
  });
});
const VECTOR_20_5 = [0, 4, 14, 15, 16];

describe("toRuns", () => {
  it("run-length encodes ascending indices", () => {
    expect(toRuns([0, 1, 2, 5, 7, 8])).toEqual([0, 3, 5, 1, 7, 2]);
    expect(toRuns([])).toEqual([]);
    expect(toRuns([4])).toEqual([4, 1]);
  });
});

// 10 chunks of 100 columns, 1000 bytes each, after a 64-byte header.
const chunkRow = (over: Partial<ChunkRow> = {}): ChunkRow => ({
  gsm_id: "GSM1",
  file: "exon_counts.1pz",
  n_cols: 1000,
  chunk_cols: 100,
  chunk_offsets: Array.from({ length: 11 }, (_, i) => 64 + i * 1000),
  perm_present: 1,
  ...over,
});

describe("planChunks", () => {
  it("fetches only the chunks that hold kept columns and merges neighbours", () => {
    const p = planChunks(chunkRow(), [5, 6, 150, 250, 251, 900]);
    expect(p.ranges).toEqual([
      { first_chunk: 0, last_chunk: 2, start: 64, end: 3063 },
      { first_chunk: 9, last_chunk: 9, start: 9064, end: 10063 },
    ]);
    expect(p.n_chunks_needed).toBe(4);
    expect(p.bytes_to_fetch).toBe(64 + 4000);
    expect(p.bytes_total).toBe(10064);
    expect(p.header).toEqual({ start: 0, end: 63 });
    expect(p.overread_ratio).toBeCloseTo(400 / 6, 1);
  });
  it("covers the whole matrix when no columns are given", () => {
    const p = planChunks(chunkRow(), null);
    expect(p.ranges).toEqual([{ first_chunk: 0, last_chunk: 9, start: 64, end: 10063 }]);
    expect(p.overread_ratio).toBe(1);
  });
  it("handles a short last chunk", () => {
    const p = planChunks(chunkRow({ n_cols: 950 }), [949]);
    expect(p.ranges[0].first_chunk).toBe(9);
    expect(p.overread_ratio).toBe(50);
  });
});

const entry = (p: string, o: number, c: number, over: Partial<IndexedEntry> = {}): IndexedEntry => ({ p, n: 0, c, u: c, o, ...over });

describe("planManifest", () => {
  const selected = [
    { gsm_id: "GSM1", gse_id: "GSE1", n_cells: 1000 },
    { gsm_id: "GSM2", gse_id: "GSE1", n_cells: 3000 },
    { gsm_id: "GSM3", gse_id: "GSE2", n_cells: 2000 },
  ];
  const entries = new Map<string, IndexedEntry[]>([
    ["GSE1", [entry("samples/GSM1/exon_counts.1pz", 1000, 10064), entry("samples/GSM1/intron_counts.1pz", 20000, 500), entry("samples/GSM1/summary.json", 30000, 90), entry("samples/GSM2/exon_counts.1pz", 40000, 9000, { d: 40100 })]],
  ]);
  const chunks = new Map([["GSM1|exon_counts.1pz", chunkRow()]]);

  it("points at the public file and the zip entries", () => {
    const m = planManifest({ selected, entries, chunks });
    expect(m.downsample).toBeNull();
    expect(m.page).toEqual({ offset: 0, limit: 100, n_samples: 3, next_offset: null });
    expect(m.studies.map((s) => [s.gse_id, s.url, s.indexed])).toEqual([["GSE1", "https://data.singlet.bio/data/GSE1/GSE1.singlet", true], ["GSE2", "https://data.singlet.bio/data/GSE2/GSE2.singlet", false]]);
    const g1 = m.studies[0].samples[0];
    expect(g1.keep_runs).toBeNull();
    expect(g1.files.map((f) => f.path)).toEqual(["samples/GSM1/exon_counts.1pz", "samples/GSM1/intron_counts.1pz"]);
    const f = g1.files[0];
    expect(f).toMatchObject({ method: "stored", local_header_offset: 1000, data_offset: null, range: null });
    expect(f.data_offset_min).toBe(1000 + 30 + "samples/GSM1/exon_counts.1pz".length);
    // exact offsets pass through
    expect(m.studies[0].samples[1].files[0]).toMatchObject({ data_offset: 40100, range: "bytes=40100-49099" });
  });

  it("downsamples with column lists and chunk plans", () => {
    const m = planManifest({ selected, entries, chunks, maxCells: 600, seed: "7", minCellsPerSample: 50 });
    expect(m.downsample).toMatchObject({ max_cells: 600, cells_before: 6000, cells_after: 600, samples_before: 3, samples_after: 3, dropped: [] });
    const s = m.studies[0].samples[0];
    expect(s.keep_cells).toBe(100);
    const kept = s.keep_runs!.reduce((n, v, i) => (i % 2 ? n + v : n), 0);
    expect(kept).toBe(100);
    const plan = s.files[0].chunks!;
    expect(plan.n_chunks_needed).toBeGreaterThan(5); // 10% of columns spread over most chunks
    expect(plan.bytes_to_fetch).toBeLessThanOrEqual(plan.bytes_total);
    expect(s.files[1].chunks).toBeNull(); // no chunk map for the intron matrix
    // Same inputs, same plan.
    expect(planManifest({ selected, entries, chunks, maxCells: 600, seed: "7" })).toEqual(planManifest({ selected, entries, chunks, maxCells: 600, seed: "7" }));
  });

  it("lists dropped samples and keeps them out of the pages", () => {
    const sel = [...selected, { gsm_id: "GSM4", gse_id: "GSE2", n_cells: 30 }];
    const m = planManifest({ selected: sel, entries, chunks, maxCells: 500, seed: "1", minCellsPerSample: 50 });
    expect(m.downsample!.dropped).toEqual([{ gsm_id: "GSM4", gse_id: "GSE2", n_cells: 30 }]);
    expect(m.page.n_samples).toBe(3);
    expect(m.studies.flatMap((s) => s.samples.map((x) => x.gsm_id))).not.toContain("GSM4");
  });

  it("pages over samples and can leave out the column lists", () => {
    const first = planManifest({ selected, entries, chunks, maxCells: 600, limit: 2 });
    expect(first.page).toEqual({ offset: 0, limit: 2, n_samples: 3, next_offset: 2 });
    const second = planManifest({ selected, entries, chunks, maxCells: 600, limit: 2, offset: 2, indices: false });
    expect(second.studies.map((s) => s.gse_id)).toEqual(["GSE2"]);
    expect(second.studies[0].samples[0].keep_runs).toBeNull();
    expect(second.studies[0].samples[0].keep_cells).toBeLessThan(2000);
    expect(second.page.next_offset).toBeNull();
  });

  it("does not plan chunk ranges inside a deflated entry", () => {
    const e = new Map([["GSE1", [entry("samples/GSM1/exon_counts.1pz", 0, 100, { n: 8 })]]]);
    const m = planManifest({ selected: [selected[0]], entries: e, chunks, maxCells: 100 });
    expect(m.studies[0].samples[0].files[0]).toMatchObject({ method: "deflate", chunks: null });
  });
});

describe("/api/cohort/manifest", () => {
  const { index } = indexOf([
    sample("GSE1", 1, { tissue_group: "Brain" }, 1000),
    sample("GSE1", 2, { tissue_group: "Brain" }, 3000),
    sample("GSE2", 3, { tissue_group: "Blood" }, 2000),
  ]);
  const schema = `
    CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT);
    CREATE TABLE pz_chunk_index (gsm_id TEXT, gse_id TEXT, file TEXT, n_cols INTEGER, chunk_cols INTEGER, chunk_offsets TEXT, perm_present INTEGER, PRIMARY KEY (gsm_id, file));`;
  beforeEach(() => {
    setBitIndex(index);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    setBitIndex(null);
    vi.restoreAllMocks();
  });

  async function call(path: string, withTables = true) {
    const db = createTestD1(withTables ? schema : "");
    if (withTables) {
      await db.prepare("INSERT INTO bundle_index VALUES (?, 1, ?, '')").bind("GSE1", JSON.stringify([entry("samples/GSM1/exon_counts.1pz", 100, 10064), entry("samples/GSM2/exon_counts.1pz", 20000, 10064)])).run();
      await db
        .prepare("INSERT INTO pz_chunk_index VALUES ('GSM2', 'GSE1', 'exon_counts.1pz', 3000, 100, ?, 1)")
        .bind(JSON.stringify(Array.from({ length: 31 }, (_, i) => 64 + i * 300)))
        .run();
    }
    return onRequestGet({ request: new Request(`https://singlet.bio${path}`), env: { DB: db }, waitUntil: () => undefined } as never);
  }

  it("returns the plan for the cohort", async () => {
    const res = await call("/api/cohort/manifest?tissue_group=Brain&max_cells=400&seed=3&min_cells_per_sample=10");
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.cohort.totals).toEqual({ studies: 1, samples: 2, cells: 4000, basis: "file" });
    expect(j.cohort.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(j.downsample).toMatchObject({ cells_before: 4000, cells_after: 400 });
    const samples = j.studies[0].samples;
    expect(samples.map((s: any) => [s.gsm_id, s.keep_cells])).toEqual([["GSM1", 100], ["GSM2", 300]]);
    expect(samples[1].files[0].chunks.n_chunks_total).toBe(30);
    expect(samples[0].files[0].chunks).toBeNull(); // no chunk row for GSM1
    const again = (await (await call("/api/cohort/manifest?tissue_group=Brain&max_cells=400&seed=3&min_cells_per_sample=10")).json()) as any;
    expect(again.studies).toEqual(j.studies);
    expect(again.cohort.hash).toBe(j.cohort.hash);
    const other = (await (await call("/api/cohort/manifest?tissue_group=Brain&max_cells=400&seed=4&min_cells_per_sample=10")).json()) as any;
    expect(other.cohort.hash).not.toBe(j.cohort.hash);
  });

  it("works before schema/030 is applied", async () => {
    const res = await call("/api/cohort/manifest?tissue_group=Brain", false);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.studies[0].indexed).toBe(false);
    expect(j.studies[0].samples.length).toBe(2);
  });

  it("rejects bad options with 400", async () => {
    for (const p of ["max_cells=0", "max_cells=abc", "files=../x", "seed=" + "x".repeat(65)]) {
      const res = await call(`/api/cohort/manifest?${p}`);
      expect(res.status, p).toBe(400);
    }
  });
});
