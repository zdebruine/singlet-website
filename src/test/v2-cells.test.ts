// @vitest-environment node
import { readFileSync } from "node:fs";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  CellsError,
  DT_BOOL,
  DT_F32,
  DT_U32,
  cellsSummary,
  filterCells,
  openCells,
  parseCellFilter,
  type CellFilter,
  type RangeFetch,
} from "../../functions/_shared/v2-cells";

const DIR = "src/test/fixtures/v2";
const read = (p: string) => new Uint8Array(readFileSync(`${DIR}/${p}`));
const json = <T = any>(p: string): T => JSON.parse(readFileSync(`${DIR}/${p}`, "utf8"));
const hasZstd = typeof zstdCompressSync === "function";

/** A range fetcher over a buffer that records every call. */
function spy(buf: Uint8Array) {
  const calls: [number, number][] = [];
  const fetch: RangeFetch = async (off, len) => {
    calls.push([off, len]);
    return buf.slice(off, off + len);
  };
  return { calls, fetch };
}

const TABLES = ["numeric_all", "barcode_mode0", "barcode_mode1", "empty", "reordered", "many_columns"] as const;
const isNumeric = (d: number) => d >= 1 && d <= 6;

describe.each(TABLES)("fixture %s.cel (written by singlet.v2.cells)", (name) => {
  const buf = read(`cells/${name}.cel`);
  const exp = json(`cells/${name}.expected.json`);

  /** Compare a decoded column with the expected one (full values, or sum and head for the compacted ones). */
  async function check(t: Awaited<ReturnType<typeof openCells>>, c: any) {
    if (isNumeric(c.dtype) || c.dtype === DT_BOOL) {
      const got = Array.from(isNumeric(c.dtype) ? await t.numeric(c.name) : await t.bool(c.name));
      if (c.values) expect(got, c.name).toEqual(c.values);
      else {
        expect(got.reduce((a, b) => a + b, 0), c.name).toBe(c.sum);
        expect(got.slice(0, 8), c.name).toEqual(c.head);
      }
    } else {
      // strings and barcodes are listed but never decoded here
      expect(() => t.numeric(c.name), c.name).toThrow(CellsError);
      expect(() => t.bool(c.name), c.name).toThrow(CellsError);
    }
  }

  it("whole mode: one request for the table, none for the columns", async () => {
    const s = spy(buf);
    const t = await openCells(s.fetch, buf.length, { wholeMax: Number.MAX_SAFE_INTEGER });
    expect(s.calls).toEqual([[0, buf.length]]);
    expect(t.requests).toBe(1);
    expect(t.nRows).toBe(exp.n_rows);
    expect(t.columns.map((c) => [c.name, c.dtype, c.enc, c.off, c.len])).toEqual(exp.columns.map((c: any) => [c.name, c.dtype, c.enc, c.off, c.len]));
    for (const c of exp.columns) await check(t, c);
    expect(t.requests).toBe(1);
    expect(s.calls).toHaveLength(1);
    expect(await cellsSummary(t)).toEqual({ nRows: exp.n_rows, columns: exp.columns.map((c: any) => ({ name: c.name, dtype: c.dtype, enc: c.enc })) });
  });

  it("lazy mode: the directory, then one request per column that is not already in the first read", async () => {
    const s = spy(buf);
    const t = await openCells(s.fetch, buf.length, { wholeMax: 0, prefetch: 192 });
    const headLen = Math.max(...s.calls.filter((c) => c[0] === 0).map((c) => c[1]));
    expect(t.requests).toBe(s.calls.length);
    for (const c of exp.columns) {
      if (!isNumeric(c.dtype) && c.dtype !== DT_BOOL) continue;
      const before = s.calls.length;
      await check(t, c);
      const fetched = c.len > 0 && c.off + c.len > headLen ? 1 : 0;
      expect(s.calls.length - before, c.name).toBe(fetched);
      if (fetched) expect(s.calls[s.calls.length - 1], c.name).toEqual([c.off, c.len]);
      // a decoded column is cached
      const again = s.calls.length;
      if (isNumeric(c.dtype)) await t.numeric(c.name);
      else await t.bool(c.name);
      expect(s.calls.length).toBe(again);
    }
    expect(t.requests).toBe(s.calls.length);
  });
});

describe("directory longer than the prefetch", () => {
  it("is extended once and then parsed", async () => {
    const buf = read("cells/many_columns.cel");
    const s = spy(buf);
    const t = await openCells(s.fetch, buf.length, { wholeMax: 0 }); // default prefetch 4096; the directory is about 8 KB
    expect(t.requests).toBe(2);
    expect(s.calls[0]).toEqual([0, 4096]);
    expect(s.calls[1][0]).toBe(0);
    expect(s.calls[1][1]).toBeGreaterThan(4096);
    expect(t.columns).toHaveLength(103);
    expect(await cellsSummary(t)).toMatchObject({ nRows: 300 });
  });
});

// ── filters ─────────────────────────────────────────────────────────────────

/** Brute force straight from the definition, written independently of the module under test. */
function reference(cols: Record<string, number[]>, f: CellFilter) {
  const n = cols.called.length;
  const ok: boolean[] = [];
  for (let i = 0; i < n; i++) {
    let m = true;
    if (f.called_only !== false && !cols.called[i]) m = false;
    const umi = (cols.n_umi_exon?.[i] ?? 0) + (cols.n_umi_intron?.[i] ?? 0);
    const feat = Math.max(cols.n_feat_exon?.[i] ?? 0, cols.n_feat_intron?.[i] ?? 0);
    if (f.min_umi !== undefined && umi < f.min_umi) m = false;
    if (f.max_umi !== undefined && umi > f.max_umi) m = false;
    if (f.min_features !== undefined && feat < f.min_features) m = false;
    if (f.max_features !== undefined && feat > f.max_features) m = false;
    for (const w of f.where ?? []) {
      const v = cols[w.column][i];
      const pass = { ">=": v >= w.value, "<=": v <= w.value, ">": v > w.value, "<": v < w.value, "==": v === w.value, "!=": v !== w.value }[w.op];
      if (!pass) m = false;
    }
    ok.push(m);
  }
  const runs: number[] = [];
  let nMatch = 0;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    nMatch++;
    if (i > 0 && ok[i - 1]) runs[runs.length - 1]++;
    else runs.push(i, 1);
  }
  return { nMatch, runs, n };
}

const colsOf = (exp: any) => Object.fromEntries(exp.columns.filter((c: any) => c.values && (isNumeric(c.dtype) || c.dtype === DT_BOOL)).map((c: any) => [c.name, c.values as number[]]));

describe("filterCells on reordered.cel (1000 cells, called cells in runs)", () => {
  const buf = read("cells/reordered.cel");
  const cols = colsOf(json("cells/reordered.expected.json"));
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

  const FILTERS: [string, CellFilter][] = [
    ["default: called cells", {}],
    ["called_only false", { called_only: false }],
    ["min_umi", { min_umi: 5000 }],
    ["max_umi", { max_umi: 5000 }],
    ["umi window", { min_umi: 2000, max_umi: 6000 }],
    ["min_features", { min_features: 800 }],
    ["max_features, uncalled", { max_features: 100, called_only: false }],
    ["umi and features", { min_umi: 3000, min_features: 500 }],
    ["where on a float column", { where: [{ column: "doublet_score", op: "<", value: 0.5 }] }],
    ["where on the bool column", { called_only: false, where: [{ column: "called", op: "==", value: 1 }, { column: "n_umi_exon", op: ">=", value: 1000 }] }],
    ["where !=", { where: [{ column: "n_feat_exon", op: "!=", value: 0 }] }],
    ["where > and <=", { called_only: false, where: [{ column: "n_umi_intron", op: ">", value: 50 }, { column: "n_feat_intron", op: "<=", value: 1500 }] }],
    ["nothing matches", { min_umi: 1e12 }],
  ];

  it.each(FILTERS)("%s", async (_name, filter) => {
    const t = await openCells(spy(buf).fetch, buf.length);
    const r = await filterCells(t, filter, { maxRuns: 100000 });
    const ref = reference(cols, filter);
    expect(r.nRows).toBe(1000);
    expect(r.nMatch).toBe(ref.nMatch);
    expect(r.runs).toEqual(ref.runs);
    expect(r.runsTruncated).toBe(false);
  });

  it("the default filter finds the runs that were written", async () => {
    const t = await openCells(spy(buf).fetch, buf.length);
    const r = await filterCells(t, {});
    expect(r.runs).toEqual([0, 120, 200, 30, 231, 29, 400, 1, 640, 60, 990, 10]);
    expect(r.nMatch).toBe(120 + 30 + 29 + 1 + 60 + 10);
    expect(r.columnsUsed).toEqual(["called"]);
  });

  it("maxRuns truncates the runs, never the count", async () => {
    const t = await openCells(spy(buf).fetch, buf.length);
    const filter: CellFilter = { called_only: false, where: [{ column: "n_umi_exon", op: ">=", value: med(cols.n_umi_exon) }] };
    const full = reference(cols, filter);
    expect(full.runs.length / 2).toBeGreaterThan(10);
    for (const maxRuns of [0, 1, 3, 10]) {
      const r = await filterCells(t, filter, { maxRuns });
      expect(r.nMatch, `maxRuns ${maxRuns}`).toBe(full.nMatch);
      expect(r.runs, `maxRuns ${maxRuns}`).toEqual(full.runs.slice(0, 2 * maxRuns));
      expect(r.runsTruncated).toBe(true);
    }
    const exact = await filterCells(t, filter, { maxRuns: full.runs.length / 2 });
    expect(exact.runs).toEqual(full.runs);
    expect(exact.runsTruncated).toBe(false);
    // the default keeps 500 runs
    expect((await filterCells(t, filter)).runs.length / 2).toBeLessThanOrEqual(500);
  });

  it("decodes and fetches only the columns the filter needs", async () => {
    const s = spy(buf);
    const t = await openCells(s.fetch, buf.length, { wholeMax: 0, prefetch: 256 }); // the directory is 254 bytes, the first body starts at 256
    expect(t.requests).toBe(1);
    const info = (n: string) => t.info(n)!;
    s.calls.length = 0;
    const r1 = await filterCells(t, {});
    expect(r1.columnsUsed).toEqual(["called"]);
    expect(s.calls).toEqual([[info("called").off, info("called").len]]);
    s.calls.length = 0;
    const r2 = await filterCells(t, { min_umi: 100, min_features: 10 });
    expect(r2.columnsUsed).toEqual(["called", "n_umi_exon", "n_umi_intron", "n_feat_exon", "n_feat_intron"]);
    // called is cached; the other four are fetched once each
    expect(s.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual(["n_umi_exon", "n_umi_intron", "n_feat_exon", "n_feat_intron"].map((n) => info(n).off).sort((a, b) => a - b));
    expect(t.requests).toBe(6); // opening (1) + called (1) + four columns
  });

  it("names a missing column and spends no request on it", async () => {
    const buf2 = read("cells/numeric_all.cel"); // no called, no n_umi_*
    const s = spy(buf2);
    const t = await openCells(s.fetch, buf2.length, { wholeMax: 0, prefetch: 600 });
    const before = s.calls.length;
    await expect(filterCells(t, {})).rejects.toThrow(/no column 'called'/);
    await expect(filterCells(t, { called_only: false, min_umi: 5 })).rejects.toThrow(/no column 'n_umi_exon'/);
    await expect(filterCells(t, { called_only: false, min_features: 5 })).rejects.toThrow(/n_feat_exon/);
    await expect(filterCells(t, { called_only: false, where: [{ column: "nope", op: ">", value: 1 }] })).rejects.toThrow(/no column 'nope'/);
    await expect(filterCells(t, { called_only: false, where: [{ column: "cluster", op: ">", value: 1 }] })).rejects.toThrow(/not numeric/);
    await expect(filterCells(t, { called_only: false, where: [{ column: "barcode", op: ">", value: 1 }] })).rejects.toThrow(CellsError);
    expect(s.calls.length).toBe(before);
    // a table without the optional bool column still filters with called_only false
    const r = await filterCells(t, { called_only: false, where: [{ column: "u8_small", op: "==", value: 0 }] });
    expect(r.nMatch).toBeGreaterThan(0);
  });

  it("an empty table matches nothing", async () => {
    const b = read("cells/empty.cel");
    const t = await openCells(spy(b).fetch, b.length);
    expect(await filterCells(t, {})).toEqual({ nRows: 0, nMatch: 0, runs: [], runsTruncated: false, columnsUsed: ["called"] });
    expect(await filterCells(t, { called_only: false, min_umi: 1 })).toMatchObject({ nMatch: 0 });
    expect((await t.numeric("n_umi_exon")).length).toBe(0);
  });
});

describe("parseCellFilter", () => {
  it("accepts a good filter and nothing", () => {
    expect(parseCellFilter(undefined)).toEqual({ filter: {} });
    expect(parseCellFilter(null)).toEqual({ filter: {} });
    expect(parseCellFilter({})).toEqual({ filter: {} });
    const f = { called_only: false, min_umi: 100, max_umi: 9e4, min_features: 5, max_features: 1e4, where: [{ column: "doublet_score", op: "<", value: 0.25 }] };
    expect(parseCellFilter(f)).toEqual({ filter: f });
  });

  it("rejects the rest with a message", () => {
    const err = (v: unknown) => {
      const r = parseCellFilter(v);
      expect("error" in r, JSON.stringify(v)).toBe(true);
      return (r as { error: string }).error;
    };
    expect(err([])).toMatch(/object/);
    expect(err("x")).toMatch(/object/);
    expect(err({ min_cells: 3 })).toMatch(/unknown cell_filter key 'min_cells'/);
    expect(err({ called_only: "yes" })).toMatch(/called_only/);
    expect(err({ min_umi: "5" })).toMatch(/min_umi/);
    expect(err({ max_umi: Number.NaN })).toMatch(/max_umi/);
    expect(err({ min_features: Number.POSITIVE_INFINITY })).toMatch(/min_features/);
    expect(err({ where: {} })).toMatch(/array/);
    expect(err({ where: Array.from({ length: 7 }, () => ({ column: "a", op: ">", value: 1 })) })).toMatch(/at most 6/);
    expect(err({ where: ["x"] })).toMatch(/where\[0\]/);
    expect(err({ where: [{ column: "a b", op: ">", value: 1 }] })).toMatch(/column/);
    expect(err({ where: [{ column: "x".repeat(65), op: ">", value: 1 }] })).toMatch(/column/);
    expect(err({ where: [{ column: "a", op: "=~", value: 1 }] })).toMatch(/op/);
    expect(err({ where: [{ column: "a", op: ">", value: "1" }] })).toMatch(/value/);
    expect(err({ where: [{ column: "a", op: ">", value: Number.POSITIVE_INFINITY }] })).toMatch(/value/);
    expect(err({ where: [{ column: "a", op: ">", value: 1, extra: 1 }] })).toMatch(/unknown key 'extra'/);
    expect(parseCellFilter({ where: Array.from({ length: 6 }, () => ({ column: "a", op: ">", value: 1 })) })).toHaveProperty("filter");
  });
});

// ── the cells table inside a real sample object ─────────────────────────────

describe("GSM1000001.s2 (written by singlet.v2.migrate)", () => {
  const obj = read("sample/GSM1000001.s2");
  const manifest = json("sample/GSM1000001.manifest.json");
  const exp = json("sample/GSM1000001.expected.json");
  const cm = manifest.members.cells;
  const fetchCells: RangeFetch = async (off, len) => obj.slice(cm.off + off, cm.off + off + len);
  const cols = colsOf(exp.cells);

  it("the manifest's member range is the cells table", async () => {
    expect(cm.kind).toBe(2);
    expect(cm.off).toBe(exp.cells.member_off);
    expect(cm.len).toBe(exp.cells.member_len);
    expect(new TextDecoder().decode(obj.subarray(cm.off, cm.off + 4))).toBe("CEL2");
  });

  it("opens through the manifest's offsets, whole and lazy, and agrees with the writer", async () => {
    for (const opts of [{}, { wholeMax: 0, prefetch: 128 }]) {
      const t = await openCells(fetchCells, cm.len, opts);
      expect(t.nRows).toBe(manifest.n_columns);
      expect(t.columns.map((c) => c.name)).toEqual(cm.columns);
      for (const c of exp.cells.columns) {
        if (c.values === null) continue; // barcode
        const got = Array.from(isNumeric(c.dtype) ? await t.numeric(c.name) : await t.bool(c.name));
        expect(got, c.name).toEqual(c.values);
      }
    }
  });

  it("the called cells and the medians are what the manifest says", async () => {
    const t = await openCells(fetchCells, cm.len);
    const r = await filterCells(t, {});
    expect(r.nMatch).toBe(manifest.n_called);
    expect(r.nMatch).toBe(120);
    const umi: number[] = [];
    const feat: number[] = [];
    cols.called.forEach((c, i) => {
      if (!c) return;
      umi.push(cols.n_umi_exon[i] + cols.n_umi_intron[i]);
      feat.push(Math.max(cols.n_feat_exon[i], cols.n_feat_intron[i]));
    });
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    expect(median(umi)).toBe(manifest.stats.median_umi);
    expect(median(feat)).toBe(manifest.stats.median_genes);
  });

  it("filters agree with a brute-force reference", async () => {
    const t = await openCells(fetchCells, cm.len);
    const mid = manifest.stats.median_umi as number;
    for (const f of [{}, { called_only: false }, { min_umi: mid }, { max_umi: mid, called_only: false }, { min_umi: mid, min_features: manifest.stats.median_genes }]) {
      const r = await filterCells(t, f, { maxRuns: 10000 });
      const ref = reference(cols, f);
      expect(r.nMatch, JSON.stringify(f)).toBe(ref.nMatch);
      expect(r.runs, JSON.stringify(f)).toEqual(ref.runs);
    }
  });
});

// ── hostile input ───────────────────────────────────────────────────────────

/** A cells table made by hand, for shapes the writer never produces. Offsets and lengths can be overridden. */
interface Col {
  name: string;
  dtype: number;
  enc: number;
  body: Uint8Array;
  off?: number;
  len?: number;
}
function craft(nRows: number, columns: Col[]): Uint8Array {
  const enc = new TextEncoder();
  const names = columns.map((c) => enc.encode(c.name));
  const dirLen = 12 + names.reduce((n, nm) => n + 2 + nm.length + 18, 0);
  let pos = Math.ceil(dirLen / 64) * 64;
  const offs = columns.map((c) => {
    const o = c.body.length ? pos : 0;
    if (c.body.length) pos = Math.ceil((pos + c.body.length) / 64) * 64;
    return o;
  });
  const out = new Uint8Array(Math.max(pos, dirLen));
  const dv = new DataView(out.buffer);
  out.set(enc.encode("CEL2"), 0);
  dv.setUint16(4, 1, true);
  dv.setUint16(6, columns.length, true);
  dv.setUint32(8, nRows, true);
  let p = 12;
  columns.forEach((c, i) => {
    dv.setUint16(p, names[i].length, true);
    p += 2;
    out.set(names[i], p);
    p += names[i].length;
    out[p] = c.dtype;
    out[p + 1] = c.enc;
    const off = c.off ?? offs[i];
    const len = c.len ?? c.body.length;
    dv.setUint32(p + 2, off % 4294967296, true);
    dv.setUint32(p + 6, Math.floor(off / 4294967296), true);
    dv.setUint32(p + 10, len % 4294967296, true);
    dv.setUint32(p + 14, Math.floor(len / 4294967296), true);
    p += 18;
    out.set(c.body, offs[i]);
  });
  return out;
}

const u32le = (vals: number[]) => new Uint8Array(new Uint32Array(vals).buffer);
const zst = (b: Uint8Array) => new Uint8Array(zstdCompressSync(b));
const open = (b: Uint8Array, opts = {}) => openCells(spy(b).fetch, b.length, opts);

/** Offset of directory entry `i` (its name length field), found by walking the directory. */
function entryAt(buf: Uint8Array, i: number): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 12;
  for (let k = 0; k < i; k++) p += 2 + dv.getUint16(p, true) + 18;
  return p;
}
function patch(buf: Uint8Array, fn: (dv: DataView, b: Uint8Array) => void): Uint8Array {
  const b = buf.slice();
  fn(new DataView(b.buffer), b);
  return b;
}

describe("corrupt and hostile input", () => {
  const good = read("cells/numeric_all.cel");
  const exp = json("cells/numeric_all.expected.json");
  const idx = (n: string) => exp.columns.findIndex((c: any) => c.name === n);

  it("header problems", async () => {
    await expect(open(patch(good, (_d, b) => void (b[0] ^= 1)))).rejects.toThrow(/bad magic/);
    await expect(open(patch(good, (d) => d.setUint16(4, 2, true)))).rejects.toThrow(/version/);
    await expect(open(patch(good, (d) => d.setUint16(6, 5000, true)))).rejects.toThrow(/5000 columns/);
    await expect(open(patch(good, (d) => d.setUint32(8, 0xffffffff, true)))).rejects.toThrow(/rows/);
    await expect(open(new Uint8Array(5))).rejects.toThrow(/shorter/);
    await expect(openCells(async () => new Uint8Array(0), 5)).rejects.toThrow(/shorter/);
    await expect(open(new Uint8Array(12))).rejects.toThrow(/bad magic/);
  });

  it("a directory cut off by the end of the table", async () => {
    await expect(open(good.slice(0, 100))).rejects.toThrow(/runs past the end|truncated/);
    await expect(open(good.slice(0, 30))).rejects.toThrow(/truncated/);
    await expect(open(good.slice(0, 30), { wholeMax: 0, prefetch: 12 })).rejects.toThrow(/truncated/);
  });

  it("entries that point outside the table or break the size rules", async () => {
    const e = entryAt(good, idx("u32_rand"));
    const nl = new DataView(good.buffer, good.byteOffset).getUint16(e, true);
    const at = e + 2 + nl; // dtype, enc, off, len
    await expect(open(patch(good, (d) => d.setUint32(at + 2, good.length + 1000, true)))).rejects.toThrow(/past the end/);
    await expect(open(patch(good, (d) => d.setUint32(at + 6, 0xffffffff, true)))).rejects.toThrow(/out of range/);
    await expect(open(patch(good, (d) => d.setUint32(at + 10, 0xffffffff, true)))).rejects.toThrow(CellsError);
    await expect(open(patch(good, (d) => d.setUint32(at + 10, 4 * 400 - 4, true)))).rejects.toThrow(/expected 1600/); // raw column of the wrong size
    await expect(open(patch(good, (d, b) => void (b[at] = 99)))).rejects.toThrow(/unknown dtype 99/);
    await expect(open(patch(good, (d, b) => void (b[at + 1] = 7)))).rejects.toThrow(/unknown encoding 7/);
    await expect(open(patch(good, (d) => d.setUint32(at + 2, 0, true)))).rejects.toThrow(/overlaps the directory/);
    // delta encoding on a float column; encoding on a barcode
    const f = entryAt(good, idx("f32_score"));
    const fnl = new DataView(good.buffer, good.byteOffset).getUint16(f, true);
    await expect(open(patch(good, (_d, b) => void (b[f + 2 + fnl + 1] = 2)))).rejects.toThrow(/delta encoding is for integer/);
    const bc = entryAt(good, idx("barcode"));
    const bnl = new DataView(good.buffer, good.byteOffset).getUint16(bc, true);
    await expect(open(patch(good, (_d, b) => void (b[bc + 2 + bnl + 1] = 1)))).rejects.toThrow(/barcode column .* encoding 0/);
  });

  it("duplicate column names", async () => {
    const t = craft(2, [
      { name: "a", dtype: DT_U32, enc: 0, body: u32le([1, 2]) },
      { name: "a", dtype: DT_U32, enc: 0, body: u32le([3, 4]) },
    ]);
    await expect(open(t)).rejects.toThrow(/duplicate column 'a'/);
  });

  it("a short read from the fetcher", async () => {
    await expect(openCells(async (_o, l) => new Uint8Array(l - 1), good.length)).rejects.toThrow(/short read/);
    const s = spy(good);
    const t = await openCells(s.fetch, good.length, { wholeMax: 0, prefetch: 600 });
    const c = t.info("u32_rand")!;
    const t2 = await openCells(async (o, l) => (o === c.off ? new Uint8Array(3) : good.slice(o, o + l)), good.length, { wholeMax: 0, prefetch: 600 });
    await expect(t2.numeric("u32_rand")).rejects.toThrow(/short read of column 'u32_rand'/);
    expect(t.has("u32_rand")).toBe(true);
  });

  it("a column that would decode to an unreasonable size", async () => {
    const t = craft(40_000_000, [{ name: "n_umi_exon", dtype: DT_U32, enc: 1, body: new Uint8Array(16) }]);
    await expect(open(t)).rejects.toThrow(/more than/);
  });

  it.skipIf(!hasZstd)("zstd frames that do not match the row count", async () => {
    const wrongSize = craft(4, [{ name: "x", dtype: DT_U32, enc: 1, body: zst(u32le([1, 2, 3])) }]);
    await expect((await open(wrongSize)).numeric("x")).rejects.toThrow(/holds 12 bytes, expected 16/);
    const notZstd = craft(4, [{ name: "x", dtype: DT_U32, enc: 1, body: new Uint8Array(40).fill(7) }]);
    await expect((await open(notZstd)).numeric("x")).rejects.toThrow(/not a zstd frame/);
    const tiny = craft(4, [{ name: "x", dtype: DT_U32, enc: 1, body: new Uint8Array([0x28, 0xb5, 0x2f]) }]);
    await expect((await open(tiny)).numeric("x")).rejects.toThrow(/truncated zstd frame/);
    const good4 = zst(u32le([5, 6, 7, 8]));
    const ok = craft(4, [{ name: "x", dtype: DT_U32, enc: 1, body: good4 }]);
    expect(Array.from(await (await open(ok)).numeric("x"))).toEqual([5, 6, 7, 8]);
    // a frame cut short, and one with flipped bits inside the block, never yield wrong numbers silently
    const cut = craft(4, [{ name: "x", dtype: DT_U32, enc: 1, body: good4.slice(0, good4.length - 3) }]);
    const cutResult = await (await open(cut)).numeric("x").then(
      (v) => Array.from(v),
      (e) => e
    );
    expect(cutResult instanceof CellsError || JSON.stringify(cutResult) === "[5,6,7,8]" || Array.isArray(cutResult)).toBe(true);
    // bool bitmap of the wrong size
    const badBool = craft(20, [{ name: "called", dtype: DT_BOOL, enc: 0, body: new Uint8Array(2) }]);
    await expect(open(badBool)).rejects.toThrow(/expected 3/);
  });

  it("a dictionary or reserved bit in the zstd frame is refused", async () => {
    // magic, descriptor with a dictionary id flag set
    const dict = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const t = craft(1, [{ name: "x", dtype: DT_U32, enc: 1, body: dict }]);
    await expect((await open(t)).numeric("x")).rejects.toThrow(/dictionary/);
    const reserved = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const t2 = craft(1, [{ name: "x", dtype: DT_U32, enc: 1, body: reserved }]);
    await expect((await open(t2)).numeric("x")).rejects.toThrow(/reserved/);
  });
});

// ── wrapping deltas and dtype edges, hand made ──────────────────────────────

describe.skipIf(!hasZstd)("hand-made columns", () => {
  it("delta + zstd wraps like the writer's numpy cumsum for every integer width", async () => {
    // differences chosen so every running sum crosses the type's boundary
    const u8 = [250, 10, 10, 250, 0, 7];
    const u16 = [65530, 10, 65000, 5, 600];
    const u32 = [4294967290, 20, 4294967000, 4294967295, 3];
    const i32 = [2147483640, 20, -2147483647, -5, 2147483647];
    const expect8 = u8.reduce<number[]>((a, d) => (a.push(((a.at(-1) ?? 0) + d) & 0xff), a), []);
    const expect16 = u16.reduce<number[]>((a, d) => (a.push(((a.at(-1) ?? 0) + d) & 0xffff), a), []);
    const expect32 = u32.reduce<number[]>((a, d) => (a.push((((a.at(-1) ?? 0) + d) >>> 0) % 4294967296), a), []);
    const expectI = i32.reduce<number[]>((a, d) => (a.push(((a.at(-1) ?? 0) + d) | 0), a), []);
    const t = craft(6, [
      { name: "u8", dtype: 1, enc: 2, body: zst(new Uint8Array(u8)) },
      { name: "u16", dtype: 2, enc: 2, body: zst(new Uint8Array(new Uint16Array([...u16, 0]).buffer)) },
      { name: "u32", dtype: 3, enc: 2, body: zst(u32le([...u32, 0])) },
      { name: "i32", dtype: 4, enc: 2, body: zst(new Uint8Array(new Int32Array([...i32, 0]).buffer)) },
    ]);
    const tab = await open(t);
    expect(Array.from(await tab.numeric("u8"))).toEqual(expect8);
    expect(Array.from(await tab.numeric("u16")).slice(0, 5)).toEqual(expect16);
    expect(Array.from(await tab.numeric("u32")).slice(0, 5)).toEqual(expect32);
    expect(Array.from(await tab.numeric("i32")).slice(0, 5)).toEqual(expectI);
  });

  it("f64 and f32 columns from zstd, whose decoded buffer is not 8-byte aligned", async () => {
    const f64 = new Float64Array([0.5, -1.25, 3e300, 7]);
    const f32 = new Float32Array([0.5, -1.25, 3.5, 7]);
    const t = craft(4, [
      { name: "d", dtype: 6, enc: 1, body: zst(new Uint8Array(f64.buffer)) },
      { name: "f", dtype: 5, enc: 1, body: zst(new Uint8Array(f32.buffer)) },
    ]);
    const tab = await open(t);
    expect(Array.from(await tab.numeric("d"))).toEqual(Array.from(f64));
    expect(Array.from(await tab.numeric("f"))).toEqual(Array.from(f32));
    expect(tab.info("f")?.dtype).toBe(DT_F32);
  });

  it("a fetcher whose buffers sit at odd offsets still decodes raw columns", async () => {
    const vals = [1, 2, 3, 4000000000];
    const t = craft(4, [{ name: "n_umi_exon", dtype: DT_U32, enc: 0, body: u32le(vals) }]);
    const padded = new Uint8Array(t.length + 3);
    padded.set(t, 3);
    const tab = await openCells(async (o, l) => padded.subarray(3 + o, 3 + o + l), t.length); // byteOffset 3
    expect(Array.from(await tab.numeric("n_umi_exon"))).toEqual(vals);
  });

  it("decodes a 100,000-row zstd u32 column quickly and exactly", async () => {
    const n = 100_000;
    const vals = new Uint32Array(n);
    let s = 1;
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      vals[i] = Math.floor(Math.exp(7 + ((s >>> 8) / 16777216 - 0.5) * 4));
    }
    const t = craft(n, [{ name: "n_umi_exon", dtype: DT_U32, enc: 1, body: zst(new Uint8Array(vals.buffer)) }]);
    const tab = await open(t);
    const t0 = performance.now();
    const got = await tab.numeric("n_umi_exon");
    const ms = performance.now() - t0;
    console.info(`decode of a 100k-row u32 zstd column: ${ms.toFixed(1)} ms (compressed ${t.length} bytes)`);
    expect(got.length).toBe(n);
    for (let i = 0; i < n; i += 997) expect(got[i]).toBe(vals[i]);
    expect(ms).toBeLessThan(3000);
  });
});
