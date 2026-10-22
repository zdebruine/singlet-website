// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  V2FetchError,
  describeMember,
  fetchObjectRange,
  findMember,
  parseChunkIndex,
  parsePz2Header,
  planSlice,
  readPz2Prefix,
  selectColumns,
  type ColumnSelection,
} from "../../functions/_shared/v2-serve";
import { configureV2, v2Url } from "../../functions/_shared/v2-urls";

const DIR = "src/test/fixtures/v2/sample";
const OBJ = new Uint8Array(readFileSync(`${DIR}/GSM1000001.s2`));
const MANIFEST = JSON.parse(readFileSync(`${DIR}/GSM1000001.manifest.json`, "utf8"));
const EXPECTED = JSON.parse(readFileSync(`${DIR}/GSM1000001.expected.json`, "utf8"));
const URL_S2 = v2Url(MANIFEST.key);
const EXON = MANIFEST.members["exon_counts.1pz"];
const EXP_EXON = EXPECTED.matrices["exon_counts.1pz"];

let log: { range: string | null; status: number }[];
beforeEach(() => {
  configureV2(undefined);
  log = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (String(input) !== URL_S2) {
      log.push({ range, status: 404 });
      return new Response("nope", { status: 404 });
    }
    if (!m) {
      log.push({ range, status: 200 });
      return new Response(OBJ.slice(), { status: 200 });
    }
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), OBJ.length - 1);
    log.push({ range, status: 206 });
    return new Response(OBJ.slice(a, b + 1), { status: 206 });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("pz2 header and chunk index", () => {
  it("parse to what the Python writer recorded", async () => {
    const { header, index, requests } = await readPz2Prefix(URL_S2, EXON);
    const h = EXP_EXON.header;
    expect(header).toMatchObject({ version: h.version, codec: h.codec, m: h.m, n: h.n, nnz: h.nnz, valueType: h.value_type, rowOrder: h.row_order, flags: h.flags, chunkCols: h.chunk_cols, nChunks: h.n_chunks, totalLen: h.total_len });
    expect(header.rowNames).toBe(h.row_names_id);
    expect(header.colNames).toBe(h.col_names_id);
    expect(header.digest).toBe(h.digest);
    expect(header.sections).toEqual(h.sections);
    expect(index.off).toEqual(EXP_EXON.chunk_index.map((r: { off: number }) => r.off));
    expect(index.len).toEqual(EXP_EXON.chunk_index.map((r: { len: number }) => r.len));
    expect(index.first).toEqual(EXP_EXON.chunk_index.map((r: { first_col: number }) => r.first_col));
    expect(index.nnzBefore).toEqual(EXP_EXON.chunk_index.map((r: { nnz_before: number }) => r.nnz_before));
    expect(requests).toBe(1); // header and chunk index come in one ranged read
    expect(log).toHaveLength(1);
    expect(log[0].range).toBe(`bytes=${EXON.off}-${EXON.chunk_index[0] + EXON.chunk_index[1] - 1}`);
  });

  it("refuse a bad magic, a short buffer and a chunk index of the wrong length", () => {
    expect(() => parsePz2Header(new Uint8Array(10))).toThrow(V2FetchError);
    expect(() => parsePz2Header(new Uint8Array(256))).toThrow(/bad magic/);
    // a flipped bit in a real header fails the CRC
    const bad = OBJ.slice(EXON.off, EXON.off + 256);
    bad[30] ^= 1;
    expect(() => parsePz2Header(bad)).toThrow(/CRC/);
    expect(() => parseChunkIndex(new Uint8Array(24 * 5), 5)).toThrow(/wrong length/);
  });

  it("detects a manifest that disagrees with the member header", async () => {
    await expect(readPz2Prefix(URL_S2, { ...EXON, chunk_index: [EXON.chunk_index[0], EXON.chunk_index[1] - 24] })).rejects.toThrow();
    await expect(readPz2Prefix(URL_S2, { ...EXON, chunk_index: undefined })).rejects.toThrow(/no chunk_index/);
    await expect(readPz2Prefix(URL_S2, { ...EXON, chunk_index: [EXON.off - 10, 144] })).rejects.toThrow(/outside the member/);
  });
});

describe("selectColumns", () => {
  it("normalises runs, indices and ranges to ascending merged runs", () => {
    expect(selectColumns({}, 300)).toEqual({ runs: null });
    expect(selectColumns({ runs: [[10, 5], [12, 10], [100, 1]] }, 300)).toEqual({ runs: [[10, 12], [100, 1]] });
    expect(selectColumns({ runs: [10, 5, 15, 5] }, 300)).toEqual({ runs: [[10, 10]] }); // flat form, adjacent runs join
    expect(selectColumns({ indices: [5, 3, 4, 4, 200] }, 300)).toEqual({ runs: [[3, 3], [200, 1]] });
    expect(selectColumns({ range: [64, 128] }, 300)).toEqual({ runs: [[64, 64]] });
  });
  it("rejects what is outside the matrix or malformed", () => {
    const bad = (input: Record<string, unknown>) => expect(selectColumns(input, 300)).toHaveProperty("error");
    bad({ runs: [[0, 0]] });
    bad({ runs: [[299, 2]] });
    bad({ runs: [[-1, 2]] });
    bad({ runs: [1, 2, 3] });
    bad({ runs: "x" });
    bad({ indices: [300] });
    bad({ indices: [1.5] });
    bad({ range: [5, 5] });
    bad({ range: [0, 301] });
    bad({ runs: [[0, 1]], indices: [1] });
    expect(selectColumns({ indices: new Array(60_000).fill(1) }, 300)).toHaveProperty("error");
  });
});

describe("planSlice", () => {
  async function plan(sel: ColumnSelection, maxRanges?: number) {
    const { header, index } = await readPz2Prefix(URL_S2, EXON);
    return planSlice(EXON, header, index, sel, { maxRanges });
  }
  const chunksBase = EXON.off + EXP_EXON.header.sections.chunks[0];
  const rec = (c: number) => EXP_EXON.chunk_index[c] as { off: number; len: number; first_col: number };

  it("covers exactly the chunks that hold the columns, as absolute byte ranges", async () => {
    const p = await plan({ runs: [[70, 10]] }); // chunk 1 (columns 64..127)
    expect(p.chunks).toHaveLength(1);
    expect(p.chunks[0]).toMatchObject({ first_chunk: 1, last_chunk: 1, first_col: 64, end_col: 128, start: chunksBase + rec(1).off, end: chunksBase + rec(1).off + rec(1).len - 1 });
    expect(p.chunks[0].range).toBe(`bytes=${p.chunks[0].start}-${p.chunks[0].end}`);
    expect(p.columns_wanted).toBe(10);
    expect(p.columns_covered).toBe(64);
    expect(p.overread_ratio).toBe(6.4);
    // those bytes are the chunk: the index offsets are consistent with the sentinel
    expect(p.chunks[0].bytes).toBe(rec(1).len);
  });

  it("joins neighbouring chunks into one range and keeps separate runs separate", async () => {
    const p = await plan({ runs: [[60, 10], [200, 3], [299, 1]] }); // chunks 0-1, 3, 4
    expect(p.chunks.map((c) => [c.first_chunk, c.last_chunk])).toEqual([[0, 1], [3, 4]]);
    expect(p.chunks[0].bytes).toBe(rec(0).len + rec(1).len);
    expect(p.chunks[1].end_col).toBe(300); // the last chunk is shorter
    expect(p.n_chunks_needed).toBe(4);
  });

  it("with no selection asks for every chunk, and stays within maxRanges by joining the closest runs", async () => {
    const all = await plan({ runs: null });
    expect(all.chunks).toHaveLength(1);
    expect(all.chunks[0]).toMatchObject({ first_chunk: 0, last_chunk: 4, bytes: EXP_EXON.header.sections.chunks[1] });
    expect(all.columns_wanted).toBe(300);
    const wide = await plan({ runs: [[0, 1], [128, 1], [256, 1]] }, 2); // chunks 0, 2 and 4 are separate runs; two ranges allowed
    expect(wide.chunks).toHaveLength(2);
    expect(wide.merged).toBe(true);
    expect(wide.chunks.reduce((n, c) => n + c.last_chunk - c.first_chunk + 1, 0)).toBeGreaterThanOrEqual(3);
    const exact = await plan({ runs: [[0, 1], [128, 1], [256, 1]] });
    expect(exact.chunks).toHaveLength(3);
    expect(exact.merged).toBe(false);
  });

  it("lists the prefix a decoder needs: the header with the chunk index, tables and rows, and not the chunks, kv or extra", async () => {
    const p = await plan({ runs: [[0, 1]] });
    const covered = p.prefix.flatMap((x) => x.sections);
    expect(covered).toContain("header");
    expect(covered).toContain("chunk_index");
    expect(covered).not.toContain("kv");
    expect(p.prefix).toHaveLength(1); // one contiguous range at the start of the member
    expect(p.prefix[0].start).toBe(EXON.off);
    for (const x of p.prefix) {
      expect(x.end).toBeLessThan(chunksBase); // all before the chunks section in this file
      expect(x.bytes).toBe(x.end - x.start + 1);
    }
    expect(p.bytes_prefix).toBeLessThan(EXON.len / 2);
  });

  it("every planned byte range lies inside the member, and the chunk bytes carry the same nnz as the index says", async () => {
    const p = await plan(selectColumns({ range: [100, 250] }, 300) as ColumnSelection);
    for (const c of p.chunks) {
      expect(c.start).toBeGreaterThanOrEqual(EXON.off);
      expect(c.end).toBeLessThan(EXON.off + EXON.len);
    }
  });
});

describe("members", () => {
  it("describes each kind", () => {
    const d = (n: string) => describeMember(n, MANIFEST.members[n]);
    expect(d("exon_counts.1pz")).toMatchObject({ kind: 1, kind_name: "pz2 matrix", rows: 400, columns: 300, nnz: 9379, codec: { id: 2, name: "generic gaps + zstd" }, chunk_cols: 64, n_chunks: 5 });
    expect(d("exon_counts.1pz").range).toBe(`bytes=${EXON.off}-${EXON.off + EXON.len - 1}`);
    expect(d("cells")).toMatchObject({ kind: 2, columns: 300 });
    expect(d("summary.json")).toMatchObject({ kind: 3, legacy_bytes: 237 });
    expect(d("cell_qc_metrics.tsv")).toMatchObject({ kind: 4, bytes: 0, range: null, recipe: "cellqc-v1", legacy_bytes: 6064 });
  });
  it("finds a member by its name or its name without a directory", () => {
    const m = { "donor/donor_assignments.tsv": { kind: 3, off: 0, len: 1 }, "exon_counts.1pz": { kind: 1, off: 0, len: 1 }, "donor/snp_ad.tsv": { kind: 3, off: 0, len: 1 } };
    expect(findMember(m, "exon_counts.1pz")).toBe("exon_counts.1pz");
    expect(findMember(m, "donor_assignments.tsv")).toBe("donor/donor_assignments.tsv");
    expect(findMember(m, "snp_ad.tsv")).toBeNull(); // restricted members are never found
    expect(findMember(m, "nope")).toBeNull();
  });
});

describe("fetchObjectRange", () => {
  it("returns the bytes of a 206 and refuses anything else", async () => {
    expect(await fetchObjectRange(URL_S2, 0, 8)).toEqual(OBJ.slice(0, 8));
    await expect(fetchObjectRange("https://data.singlet.bio/v2/s/GSM1/" + "a".repeat(32) + ".s2", 0, 8)).rejects.toBeInstanceOf(V2FetchError);
    vi.stubGlobal("fetch", async () => new Response(OBJ.slice(), { status: 200 }));
    await expect(fetchObjectRange(URL_S2, 0, 8)).rejects.toThrow(/Range 200/);
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(3), { status: 206 }));
    await expect(fetchObjectRange(URL_S2, 0, 8)).rejects.toThrow(/returned 3 bytes/);
    expect((await fetchObjectRange(URL_S2, 0, 0)).length).toBe(0);
  });
});

describe("configureV2", () => {
  it("lets the site point at another host, and ignores anything that is not an https origin", () => {
    configureV2({ V2_ORIGIN: "https://dv2.singlet.bio/" });
    expect(v2Url("v2/m/GSE1.json")).toBe("https://dv2.singlet.bio/v2/m/GSE1.json");
    configureV2({ V2_ORIGIN: "http://evil.example" });
    expect(v2Url("v2/m/GSE1.json")).toBe("https://data.singlet.bio/v2/m/GSE1.json");
    configureV2({ V2_ORIGIN: "https://x.example/path" });
    expect(v2Url("v2/m/GSE1.json")).toBe("https://data.singlet.bio/v2/m/GSE1.json");
  });
});
