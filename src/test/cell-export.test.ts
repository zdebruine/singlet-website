// @vitest-environment node
/**
 * Cell export: the pz2 decoder (workers/data/src/pz2.ts), the export route (workers/data/src/export.ts, zipstream.ts), its link and MCP
 * text (functions/_shared/cells/export.ts, mcp.ts).
 *
 *  - codec 1 against the compiled reference: a real Research Alpha member (fixtures/s1/pz2, 5 kB of GSM6112133) and the SHA-256 of the
 *    canonical arrays `singlet._pz2.decode` returns for it (workers/data/scripts/pz2_truth.py). `node workers/data/scripts/pz2-check.ts`
 *    runs the same check on whole real samples (20 members of 5 samples were identical when this was written).
 *  - codec 2 and the whole export against the synthetic sample object the Python writer made (fixtures/s1/sample): every cell's decoded
 *    counts must add up to the n_umi_exon + n_umi_intron the writer stored in its cells table, and the zip must read back.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { R2BucketLike, R2ObjectBodyLike } from "../../workers/data/src/handler";
import type { PlanSample } from "../../workers/data/src/cidx";
import { newStats } from "../../workers/data/src/cidx";
import { exportSamples, matchGenes, modalityMembers, type ExportBody } from "../../workers/data/src/export";
import { identify } from "../../workers/data/src/limits";
import { Member, Pz2Error } from "../../workers/data/src/pz2";
import { handleCidx } from "../../workers/data/src/routes";
import { openCells } from "../../functions/_shared/s1-cells";
import { exportLink, parseExportRequest } from "../../functions/_shared/cells/export";
import { exportCellsText } from "../../functions/_shared/cells/mcp";

const FIX = join(__dirname, "fixtures", "s1");

function decodeAll(b: Uint8Array, canonical = true) {
  const mem = new Member(b);
  const indptr = new BigInt64Array(mem.h.n + 1);
  const idx = new Uint32Array(mem.h.nnz);
  const val = new Uint32Array(mem.h.nnz);
  for (let c = 0; c < mem.h.nChunks; c++) {
    const [o, l] = mem.chunkRange(c);
    const ch = mem.decodeChunk(c, b.subarray(o, o + l), canonical);
    const base = mem.ix.nnzBefore[c];
    idx.set(ch.idx, base);
    val.set(ch.val, base);
    for (let j = 0; j < ch.counts.length; j++) indptr[ch.first + j + 1] = BigInt(base + ch.colptr[j + 1]);
  }
  return { mem, indptr, idx, val };
}
const sha = (a: ArrayBufferView) => createHash("sha256").update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest("hex");

describe("pz2 decoder", () => {
  const truth = JSON.parse(readFileSync(join(FIX, "pz2", "GSM6112133.vdj_gene_usage.expected.json"), "utf8"));
  const real = new Uint8Array(readFileSync(join(FIX, "pz2", "GSM6112133.vdj_gene_usage.1pz")));

  it("decodes a real codec-1 member exactly as singlet._pz2 does", () => {
    const { mem, indptr, idx, val } = decodeAll(real);
    expect(mem.h.codec).toBe(1);
    expect([mem.h.m, mem.h.n, mem.h.nnz]).toEqual([truth.m, truth.n, truth.nnz]);
    expect(sha(indptr)).toBe(truth.sha_indptr);
    expect(sha(idx)).toBe(truth.sha_indices);
    expect(sha(val)).toBe(truth.sha_data);
  });

  it("stored-space ids map through rowPerm to the same matrix", () => {
    const a = decodeAll(real);
    const b = decodeAll(real, false);
    const perm = b.mem.rowPerm!;
    const ids: number[] = [];
    const vals: number[] = [];
    for (let j = 0; j < a.mem.h.n; j++) {
      const s = Number(a.indptr[j]);
      const e = Number(a.indptr[j + 1]);
      if (s === e) continue;
      const pairs = [...b.idx.subarray(s, e)].map((x, k) => [perm[x], b.val[s + k]]).sort((p, q) => p[0] - q[0]);
      for (const [i, v] of pairs) ids.push(i), vals.push(v);
    }
    expect(b.indptr).toEqual(a.indptr);
    expect(ids).toEqual([...a.idx]);
    expect(vals).toEqual([...a.val]);
  });

  it("refuses a corrupt header or chunk", () => {
    const h = real.slice();
    h[20] ^= 1;
    expect(() => new Member(h)).toThrow(/CRC/);
    const mem = new Member(real);
    const c = mem.ix.len.findIndex((l) => l > 64);
    const [o, l] = mem.chunkRange(c);
    const blob = real.slice(o, o + l);
    blob[l - 3] ^= 0x5a;
    expect(() => mem.decodeChunk(c, blob)).toThrow(Pz2Error);
  });

  it("decodes codec 2 (the Python writer's fixture) consistently with its cells table", async () => {
    const obj = new Uint8Array(readFileSync(join(FIX, "sample", "GSM1000001.s1")));
    const man = JSON.parse(readFileSync(join(FIX, "sample", "GSM1000001.manifest.json"), "utf8"));
    const cm = man.members.cells;
    const table = await openCells(async (o, l) => obj.subarray(cm.off + o, cm.off + o + l), cm.len);
    for (const [m, col] of [
      ["exon_counts.1pz", "exon"],
      ["intron_counts.1pz", "intron"],
    ]) {
      const mm = man.members[m];
      const { mem, indptr, val } = decodeAll(obj.subarray(mm.off, mm.off + mm.len));
      expect(mem.h.codec).toBe(2);
      const umi = await table.numeric(`n_umi_${col}`);
      const feat = await table.numeric(`n_feat_${col}`);
      for (let j = 0; j < mem.h.n; j++) {
        const s = Number(indptr[j]);
        const e = Number(indptr[j + 1]);
        expect(e - s).toBe(feat[j]);
        expect(val.subarray(s, e).reduce((a, b) => a + b, 0)).toBe(umi[j]);
      }
    }
  });
});

// ── the export route, on the fixture sample ─────────────────────────────────

class MemBucket implements R2BucketLike {
  constructor(private readonly objects: Map<string, Uint8Array>) {}
  async get(key: string, options?: { range?: { offset?: number; length?: number } }) {
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

async function gunzip(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}

/** The entries of a zip, from its central directory (stored entries only, as the export writes them). */
function unzip(z: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22;
  while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < n; i++) {
    expect(dv.getUint32(p, true)).toBe(0x02014b50);
    const size = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(z.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true);
    const start = off + 30 + lnl + dv.getUint16(off + 28, true);
    const data = z.subarray(start, start + size);
    const crc = dv.getUint32(p + 16, true);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}
function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

describe("export route", () => {
  const obj = new Uint8Array(readFileSync(join(FIX, "sample", "GSM1000001.s1")));
  const man = JSON.parse(readFileSync(join(FIX, "sample", "GSM1000001.manifest.json"), "utf8"));
  const exp = JSON.parse(readFileSync(join(FIX, "sample", "GSM1000001.expected.json"), "utf8"));
  const bucket = new MemBucket(new Map([[man.key, obj]]));
  const deps = { bucket, cache: null, waitUntil: () => undefined };
  // the plan block entry the cell index would carry for this sample
  const members: PlanSample["members"] = { cells: { off: man.members.cells.off, len: man.members.cells.len, digest: man.members.cells.digest } };
  for (const m of ["exon_counts.1pz", "intron_counts.1pz"]) {
    const x = exp.matrices[m];
    const chunksAt = x.header.sections.chunks[0];
    members[m] = {
      off: x.member_off,
      len: x.member_len,
      digest: x.header.digest,
      prefix: chunksAt,
      chunks_at: x.member_off + chunksAt,
      n_chunks: x.header.n_chunks,
      first_col: x.chunk_index.map((r: { first_col: number }) => r.first_col),
      coff: x.chunk_index.map((r: { off: number }) => r.off),
    };
  }
  const entry: PlanSample = { so: 0, gsm: "GSM1000001", gse: "GSE1000001", key: man.key, bytes: obj.length, n_columns: 300, n_called: 120, organism: "Homo sapiens", members, runs: [] };
  const called = (exp.cells.columns.find((c: { name: string }) => c.name === "called").values as number[]).flatMap((v, i) => (v ? [i] : []));
  // gene space of the fixture (its rows are inline names, not a pack): 40 genes, exon row r -> r % 40, intron row r -> r % 40
  const rowMap = async (mem: Member) => ({
    space: "fixture",
    member: "exon" as const,
    gene_ids: Array.from({ length: 40 }, (_, g) => `ENSG${String(g).padStart(11, "0")}`),
    symbols: Array.from({ length: 40 }, (_, g) => `GENE${g}`),
    rowGene: Int32Array.from({ length: mem.h.m }, (_, r) => r % 40),
  });
  const limits = { maxCells: 10_000, maxStudies: 10, maxSamples: 2000, maxBytes: 1 << 30, maxReads: 4000, maxCostUsd: 0.01, maxRowsScanned: 1e7 };
  const run = (body: ExportBody) => exportSamples({ deps, limits, rowMap }, { name: "t", ...body }, "test", [entry], new Map([[0, called]]), newStats());

  it("writes a zip whose matrix adds up to the cells table's UMIs", async () => {
    const res = await run({ samples: { GSM1000001: { tissue: "lung", disease: "lung adenocarcinoma" } } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual(["t/README.txt", "t/barcodes.tsv.gz", "t/features.tsv.gz", "t/manifest.json", "t/matrix.mtx.gz", "t/obs.tsv.gz"]);
    const mtx = new TextDecoder().decode(await gunzip(files.get("t/matrix.mtx.gz")!)).trim().split("\n");
    expect(mtx[0]).toBe("%%MatrixMarket matrix coordinate integer general");
    const [nr, nc, nnz] = mtx[2].split(" ").map(Number);
    expect([nr, nc]).toEqual([40, called.length]);
    expect(mtx.length - 3).toBe(nnz);
    const sums = new Array(nc).fill(0);
    let last = [0, 0];
    for (const line of mtx.slice(3)) {
      const [g, c, v] = line.split(" ").map(Number);
      expect(c > last[1] || (c === last[1] && g > last[0])).toBe(true); // cell-major, genes ascending
      last = [g, c];
      sums[c - 1] += v;
    }
    const cm = man.members.cells;
    const table = await openCells(async (o, l) => obj.subarray(cm.off + o, cm.off + o + l), cm.len);
    const ue = await table.numeric("n_umi_exon");
    const ui = await table.numeric("n_umi_intron");
    expect(sums).toEqual(called.map((j) => ue[j] + ui[j]));
    const feats = new TextDecoder().decode(await gunzip(files.get("t/features.tsv.gz")!)).trim().split("\n");
    expect(feats[1]).toBe("ENSG00000000001\tGENE1\tGene Expression");
    const bcs = new TextDecoder().decode(await gunzip(files.get("t/barcodes.tsv.gz")!)).trim().split("\n");
    expect(bcs).toEqual(called.map((j) => `GSM1000001_${j}`));
    const obs = new TextDecoder().decode(await gunzip(files.get("t/obs.tsv.gz")!)).trim().split("\n").map((l) => l.split("\t"));
    expect(obs[0]).toEqual(["cell", "gsm", "gse", "column", "cell_type", "cell_type_ontology_term_id", "sex", "ancestry", "n_umi", "n_counts", "tissue", "disease"]);
    expect(obs[1].slice(-4)).toEqual([String(sums[0]), String(sums[0]), "lung", "lung adenocarcinoma"]);
    const manifest = JSON.parse(new TextDecoder().decode(files.get("t/manifest.json")!));
    expect(manifest).toMatchObject({ license: "CC0-1.0", cells: called.length, nnz, modality_members: ["exon_counts.1pz", "intron_counts.1pz"] });
  });

  it("keeps only the requested genes, and reports the missing ones", async () => {
    const res = await run({ genes: ["gene3", "ENSG00000000007", "NOPE"], modality: "spliced" });
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    const feats = new TextDecoder().decode(await gunzip(files.get("t/features.tsv.gz")!)).trim().split("\n");
    expect(feats.map((l) => l.split("\t")[1])).toEqual(["GENE3", "GENE7"]);
    expect(JSON.parse(new TextDecoder().decode(files.get("t/manifest.json")!)).genes.missing).toEqual(["NOPE"]);
  });

  it("summarises genes per cell type", async () => {
    const res = await run({ genes: ["GENE0", "GENE1"], format: "summary" });
    const j = (await res.json()) as { cells: number; groups: { cell_type: string; cells: number; genes: { symbol: string; mean: number; frac_expressing: number }[] }[] };
    expect(j.cells).toBe(called.length);
    expect(j.groups).toHaveLength(1); // the fixture's cells table has no labels
    expect(j.groups[0]).toMatchObject({ cell_type: "unknown", cells: called.length });
    expect(j.groups[0].genes.map((g) => g.symbol)).toEqual(["GENE0", "GENE1"]);
    for (const g of j.groups[0].genes) expect(g.frac_expressing).toBeGreaterThanOrEqual(0);
  });

  it("gives a cell-line sample's cells its line as cell type, in the table and the summary", async () => {
    const lineBody = { cell_types: { GSM1000001: { label: "K-562", id: "CVCL_0004" } } };
    const zipRes = await run(lineBody);
    const obs = new TextDecoder().decode(await gunzip(unzip(new Uint8Array(await zipRes.arrayBuffer())).get("t/obs.tsv.gz")!)).trim().split("\n").slice(1).map((l) => l.split("\t"));
    expect(new Set(obs.map((r) => `${r[4]}|${r[5]}`))).toEqual(new Set(["K-562|CVCL_0004"]));
    const sum = (await (await run({ ...lineBody, genes: ["GENE0"], format: "summary" })).json()) as { groups: { cell_type: string; cell_type_id: string; cells: number }[] };
    expect(sum.groups).toEqual([expect.objectContaining({ cell_type: "K-562", cell_type_id: "CVCL_0004", cells: called.length })]);
  });

  it("holds an export to its caps and answers a dry run with the plan", async () => {
    const dry = await run({ dry_run: true });
    expect(((await dry.json()) as { plan: { cells: number } }).plan.cells).toBe(called.length);
    await expect(exportSamples({ deps, limits: { ...limits, maxCells: 10 }, rowMap }, {}, "test", [entry], new Map([[0, called]]), newStats())).rejects.toMatchObject({ status: 413 });
    await expect(exportSamples({ deps, limits, rowMap, exportLimits: { maxBytes: 100 } }, {}, "test", [entry], new Map([[0, called]]), newStats())).rejects.toMatchObject({ status: 413 });
  });
});

describe("export inputs", () => {
  it("serves gene counts only", async () => {
    expect(modalityMembers(undefined)).toEqual(["exon_counts.1pz", "intron_counts.1pz"]);
    expect(modalityMembers("unspliced")).toEqual(["intron_counts.1pz"]);
    for (const m of ["mt", "splice_junctions", "vdj"]) expect(() => modalityMembers(m)).toThrow(/gene counts only/);
    const res = await handleCidx(new Request("https://data.singlet.bio/s1/cidx/export", { method: "POST", body: JSON.stringify({ cells: [["GSM1", [0]]], modality: "mt" }) }), {
      bucket: new MemBucket(new Map()),
      cache: null,
      waitUntil: () => undefined,
    });
    expect(res.status).toBe(400);
  });

  it("matches genes like singlet.s1.atlas.gather", () => {
    const ids = ["ENSG1", "ENSG2", "ENSG3"];
    const sym = ["CD8A", "cd8b", "CD8A"];
    expect(matchGenes(ids, sym, ["CD8A"]).keep).toEqual([0, 2]);
    expect(matchGenes(ids, sym, ["CD8B", "ensg2", "x"])).toEqual({ keep: [1], missing: ["x"] });
  });

  it("trusts a forwarded subject only with the internal secret", async () => {
    const h = { "x-cidx-subject": "acct:e9d8c1c2-81f9-4017-8e14-cdd67be31459", "x-cidx-client-ip": "203.0.113.9", "cf-connecting-ip": "198.51.100.1" };
    expect(await identify(new Request("https://x/", { headers: h }), null, Date.now(), true)).toEqual({ id: "acct:e9d8c1c2-81f9-4017-8e14-cdd67be31459", tier: "key" });
    const anonFwd = await identify(new Request("https://x/", { headers: { "x-cidx-client-ip": "203.0.113.9" } }), null, Date.now(), true);
    const anonSame = await identify(new Request("https://x/", { headers: { "cf-connecting-ip": "203.0.113.9" } }), null);
    expect(anonFwd).toEqual(anonSame);
    const untrusted = await identify(new Request("https://x/", { headers: h }), null);
    expect(untrusted.tier).toBe("anon");
    expect(untrusted).toEqual(await identify(new Request("https://x/", { headers: { "cf-connecting-ip": "198.51.100.1" } }), null));
  });

  it("reads the link's parameters back, and keeps them out of the filter", () => {
    const where = { and: [{ field: "cell_type", any: ["CD8-positive, alpha-beta T cell"] }, { field: "sex", any: ["female"] }] };
    const link = exportLink(where, { genes: ["CD8A", "GZMB"], maxCells: 500, modality: "spliced", cursor: "abc" });
    expect(link.startsWith("https://singlet.bio/api/cells/export?")).toBe(true);
    const er = parseExportRequest(new URL(link), null);
    expect(er).toMatchObject({ genes: ["CD8A", "GZMB"], maxCells: 500, modality: "spliced", format: "mtx" });
    expect(er.p.cursor).toBe("abc");
    expect(JSON.stringify(er.p.query.where)).not.toMatch(/genes|max_cells|modality/);
    expect(() => parseExportRequest(new URL("https://singlet.bio/api/cells/export?cell_type=T%20cell&modality=mt"), null)).toThrow(/gene counts only/);
  });

  it("puts the link and the summary in the MCP text", () => {
    const text = exportCellsText({
      link: "https://singlet.bio/api/cells/export?where=x",
      next_link: "https://singlet.bio/api/cells/export?where=x&cursor=y",
      format: "zip",
      page: { cells: 1106, samples: 10 },
      progress: { cells_total: 1106, samples_done: 10, samples_total: 20 },
      plan: { bytes: 50_000_000 },
      query: { genes: ["CD8A"], modality: "counts" },
      samples: [{ gsm_id: "GSM6112146", gse_id: "GSE202371", cells: 293 }],
      summary: { cells: 1106, genes: [{ id: "ENSG00000153563", symbol: "CD8A" }], groups: [{ cell_type: "effector memory CD8-positive, alpha-beta T cell", cells: 808, genes: [{ mean: 1.234, mean_cp10k: 9.87, frac_expressing: 0.61 }] }], missing_genes: [] },
    });
    expect(text.split("\n")[0]).toBe("Download (no account needed): https://singlet.bio/api/cells/export?where=x");
    expect(text).toMatch(/Next page: https:\/\/singlet\.bio\/api\/cells\/export\?where=x&cursor=y/);
    expect(text).toMatch(/effector memory CD8-positive, alpha-beta T cell\t808\t1\.23 \/ 9\.9 \/ 61%/);
  });
});
