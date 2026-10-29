/**
 * `POST /s1/cidx/export`: the cells of a gather, decoded here into files any tool can read, so a client without the singlet package (an
 * AI assistant handing a user a download link, a browser, R without the package) gets a matrix instead of byte ranges.
 *
 * The request is a gather body (`cells` or a `query` handle, `version`) plus `genes` (ids or symbols, matched like
 * `singlet.s1.atlas.gather(genes=...)`), `modality` (counts = spliced + unspliced, the AnnData X of atlas.gather; spliced; unspliced),
 * `format` and optional per-sample columns for the cell table (`samples`: {GSM: {column: value}}, the site's sample facts). It is planned
 * with the gather planner (`planGather`: matrix prefixes and the chunk runs covering the cells, plus each sample's cells table) and held
 * to the gather caps and `EXPORT_LIMITS` before anything is read. Samples are then read and decoded one at a time (src/pz2.ts), and every
 * cell's exon and intron rows are summed into genes through the feature packs, as atlas.gather does.
 *
 *   format "mtx" (default): a zip, streamed, of <name>/matrix.mtx.gz (MatrixMarket coordinate integer, genes x cells, as 10x writes it),
 *     features.tsv.gz (gene id, symbol, "Gene Expression"), barcodes.tsv.gz (cell ids <GSM>_<column>), obs.tsv.gz (per-cell labels and
 *     the given sample columns), README.txt and manifest.json. Readable by scanpy.read_10x_mtx and Seurat::Read10X.
 *   format "summary": JSON, per cell type: cells, and for each requested gene (at most SUMMARY_MAX_GENES) the mean count, the mean
 *     counts per 10k and the fraction of cells expressing it.
 *
 * Only gene counts leave this route: no splice-junction, mitochondrial-allele or V(D)J members, no barcode sequences.
 */
import type { Deps } from "./handler";
import { CidxError, estimateCost, newStats, openDirectory, OverBudget, planSamples, PRICE, readBytes, type PlanSample, type ReadStats } from "./cidx";
import { planGather, resolveCells, type GatherBody, type GatherLimits, type GatherPlan, type Read } from "./gather";
import { isBlocked } from "./policy";
import { Member, NK_PACK, type Chunk } from "./pz2";
import { gzip, gzipBytes, ZipWriter } from "./zipstream";
import { geneRowMap, resolvePackId, type GeneRowMap, type PackIndexEntry } from "../../../functions/_shared/s1-packs";
import { openCells, type CellsTable } from "../../../functions/_shared/s1-cells";

export const EXPORT_LIMITS = {
  /** cells per export (the gather cap applies too) */
  maxCells: 10_000,
  /** planned sample-object bytes: bounds the decode (about 1.2 non-zeros per byte) and the memory the reads hold */
  maxBytes: 64 * 1024 * 1024,
  /** gene-level non-zeros held before the matrix is written (8 bytes each at most in the packed store) */
  maxNnz: 30_000_000,
};
export const SUMMARY_MAX_GENES = 50;
const DECODE_CPU_MS_PER_MB = 250;
const MODALITY_MEMBERS: Record<string, string[]> = { counts: ["exon_counts.1pz", "intron_counts.1pz"], spliced: ["exon_counts.1pz"], unspliced: ["intron_counts.1pz"] };
const CELL_COLUMNS = ["cell_type_label", "cell_type_cl", "sex_chrom", "ancestry_hancestro"] as const;
const UMI_COLUMNS = ["n_umi_exon", "n_umi_intron"] as const;

export interface ExportBody extends Omit<GatherBody, "modalities" | "have_prefix" | "cells_table"> {
  genes?: string[];
  modality?: string;
  format?: "mtx" | "summary";
  samples?: Record<string, Record<string, string | number | null>>;
  /** folder name inside the zip, and the file name */
  name?: string;
  /** provenance written into manifest.json (the query that chose the cells, the link) */
  provenance?: Record<string, unknown>;
}

export interface ExportCtx {
  deps: Deps;
  limits: GatherLimits;
  charge?: (cells: number, bytes: number, usd: number) => Promise<void>;
  waitUntil?: (p: Promise<unknown>) => void;
  exportLimits?: Partial<typeof EXPORT_LIMITS>;
  /** gene of every row of a matrix (default: its feature pack, through s1/ref); tests pass their own */
  rowMap?: (mem: Member) => Promise<GeneRowMap>;
}

// ── genes ───────────────────────────────────────────────────────────────────

/** Requested genes -> indices in a gene space: ids exact, symbols exact, then both case-insensitive (singlet._loader._gene_keep_mask). */
export function matchGenes(ids: string[], symbols: string[], want: string[]): { keep: number[]; missing: string[] } {
  const index = (names: string[]) => {
    const exact = new Map<string, number[]>();
    const folded = new Map<string, number[]>();
    names.forEach((n, i) => {
      (exact.get(n) ?? exact.set(n, []).get(n)!).push(i);
      const f = n.toLowerCase();
      (folded.get(f) ?? folded.set(f, []).get(f)!).push(i);
    });
    return { exact, folded };
  };
  const I = index(ids);
  const S = index(symbols);
  const keep = new Set<number>();
  const missing: string[] = [];
  for (const g of want) {
    const k = String(g).trim();
    const hits = I.exact.get(k) ?? S.exact.get(k) ?? I.folded.get(k.toLowerCase()) ?? S.folded.get(k.toLowerCase());
    if (hits?.length) hits.forEach((h) => keep.add(h));
    else missing.push(k);
  }
  return { keep: [...keep].sort((a, b) => a - b), missing };
}

// ── reading ─────────────────────────────────────────────────────────────────

interface Got {
  /** member name -> bytes from the member start (prefix), runs [member offset, bytes], whole member */
  prefix: Map<string, Uint8Array>;
  runs: Map<string, [number, Uint8Array][]>;
  whole: Map<string, Uint8Array>;
}

const SAMPLE_KEY = /^(s1|v2)\/s\/GSM\d{1,12}\/[0-9a-f]{32}\.(s1|s2)$/;

async function readSample(deps: Deps, reads: Read[], names: string[], stats: ReadStats): Promise<Got> {
  const got: Got = { prefix: new Map(), runs: new Map(), whole: new Map() };
  let next = 0;
  const worker = async () => {
    while (next < reads.length) {
      const r = reads[next++];
      if (!SAMPLE_KEY.test(r.key) || isBlocked(r.key)) throw new CidxError(404, "not_found", "plan names a sample object that is not served");
      const buf = await readBytes({ ...deps, rangeFillMax: 0 }, r.key, r.start, r.end - r.start, stats);
      for (const p of r.pieces) {
        const body = buf.slice(p.abs - r.start, p.abs - r.start + p.len);
        const nm = names[p.member];
        if (p.kind === 1) got.prefix.set(nm, body);
        else if (p.kind === 3) got.whole.set(nm, body);
        else (got.runs.get(nm) ?? got.runs.set(nm, []).get(nm)!).push([p.off, body]);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, reads.length) }, worker));
  return got;
}

let packIndex: { at: number; list: PackIndexEntry[] } | null = null;

async function packFetcher(deps: Deps, stats: ReadStats) {
  if (!packIndex || Date.now() - packIndex.at > 300_000) {
    const raw = await readBytes(deps, "s1/ref/index.json", undefined, undefined, stats);
    const j = JSON.parse(new TextDecoder().decode(raw)) as { packs?: PackIndexEntry[] } | PackIndexEntry[];
    packIndex = { at: Date.now(), list: Array.isArray(j) ? j : (j.packs ?? []) };
  }
  const list = packIndex.list;
  return {
    full: (prefix16: string) => resolvePackId(list, prefix16),
    fetch: (id: string) => readBytes(deps, `s1/ref/${id}.pack`, undefined, undefined, stats),
  };
}

/** One member of one sample, decoding the chunks the wanted columns fall in, each once. */
class MemberCols {
  readonly mem: Member;
  /** stored row id -> gene index of the export's gene space (-1: none) */
  readonly rowGene: Int32Array;
  private chunk: Chunk | null = null;
  private chunkNo = -1;
  private readonly runs: [number, Uint8Array][];
  constructor(mem: Member, runs: [number, Uint8Array][], map: GeneRowMap, toSpace: Int32Array | null) {
    this.mem = mem;
    this.runs = runs;
    if (map.rowGene.length !== this.mem.h.m) throw new CidxError(502, "bad_object", `matrix has ${this.mem.h.m} rows, its pack ${map.rowGene.length}`);
    const perm = this.mem.rowPerm;
    const m = this.mem.h.m;
    this.rowGene = new Int32Array(m);
    for (let s = 0; s < m; s++) {
      const g = map.rowGene[perm ? perm[s] : s];
      this.rowGene[s] = g < 0 ? -1 : toSpace ? toSpace[g] : g;
    }
  }

  /** Add column `col`'s counts into acc (by gene); returns the number of genes it touched for the first time (pushed to `touched`). */
  addColumn(col: number, acc: Float64Array, touched: number[]): void {
    const c = this.mem.chunkOf(col);
    if (c !== this.chunkNo) {
      const [off, len] = this.mem.chunkRange(c);
      const run = this.runs.find(([o, b]) => o <= off && off + len <= o + b.length);
      if (!run) throw new CidxError(502, "bad_plan", `chunk ${c} was not read`);
      this.chunk = this.mem.decodeChunk(c, run[1].subarray(off - run[0], off - run[0] + len), false);
      this.chunkNo = c;
    }
    const ch = this.chunk!;
    const j = col - ch.first;
    const rg = this.rowGene;
    for (let t = ch.colptr[j]; t < ch.colptr[j + 1]; t++) {
      const g = rg[ch.idx[t]];
      if (g < 0) continue;
      if (acc[g] === 0) touched.push(g);
      acc[g] += ch.val[t];
    }
  }
}

// ── the packed per-cell store ───────────────────────────────────────────────

/** Gene-level entries of every cell, LEB128 (gene delta, count): about 2-3 bytes per non-zero instead of 8. */
class CellStore {
  private buf = new Uint8Array(1 << 20);
  private n = 0;
  nnz = 0;
  readonly starts: number[] = [];
  readonly counts: number[] = [];
  private put(v: number): void {
    if (this.n + 10 > this.buf.length) {
      const b = new Uint8Array(this.buf.length * 2);
      b.set(this.buf);
      this.buf = b;
    }
    while (v >= 128) {
      this.buf[this.n++] = (v & 127) | 128;
      v = Math.floor(v / 128);
    }
    this.buf[this.n++] = v;
  }
  add(genes: Int32Array | number[], vals: Float64Array, k: number): void {
    this.starts.push(this.n);
    this.counts.push(k);
    let prev = -1;
    for (let i = 0; i < k; i++) {
      this.put(genes[i] - prev - 1);
      prev = genes[i];
      this.put(vals[i]);
    }
    this.nnz += k;
  }
  /** (gene, count) of cell i */
  *cell(i: number): Generator<[number, number]> {
    let p = this.starts[i];
    const get = () => {
      let v = 0;
      let mul = 1;
      for (;;) {
        const x = this.buf[p++];
        v += (x & 127) * mul;
        if (x < 128) return v;
        mul *= 128;
      }
    };
    let g = -1;
    for (let k = 0; k < this.counts[i]; k++) {
      g += get() + 1;
      yield [g, get()];
    }
  }
}

// ── text ────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const tsvCell = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/[\t\r\n]+/g, " "));

/** Writes ASCII decimal lines into a reusable buffer, flushing it as chunks. */
class Lines {
  private b = new Uint8Array(1 << 16);
  private n = 0;
  constructor(private readonly flush: (b: Uint8Array) => Promise<void>) {}
  private num(v: number): void {
    if (v === 0) {
      this.b[this.n++] = 48;
      return;
    }
    let s = this.n;
    while (v > 0) {
      const q = Math.floor(v / 10);
      this.b[this.n++] = 48 + (v - q * 10);
      v = q;
    }
    for (let e = this.n - 1; s < e; s++, e--) {
      const t = this.b[s];
      this.b[s] = this.b[e];
      this.b[e] = t;
    }
  }
  async triple(a: number, b: number, c: number): Promise<void> {
    if (this.n + 40 > this.b.length) await this.drain();
    this.num(a);
    this.b[this.n++] = 32;
    this.num(b);
    this.b[this.n++] = 32;
    this.num(c);
    this.b[this.n++] = 10;
  }
  async drain(): Promise<void> {
    if (!this.n) return;
    const out = this.b.slice(0, this.n);
    this.n = 0;
    await this.flush(out);
  }
}

// ── the route ───────────────────────────────────────────────────────────────

interface CellRow {
  gsm: string;
  gse: string;
  col: number;
  labels: string[];
  umi: number;
  total: number;
}

export interface ExportPlan {
  plan: GatherPlan;
  entries: PlanSample[];
  want: Map<number, number[]>;
  version: string;
  cells: number;
  studies: number;
  members: string[];
  est: ReturnType<typeof estimateCost>;
}

export function modalityMembers(modality: unknown): string[] {
  const m = modality === undefined || modality === null || modality === "" ? "counts" : String(modality).toLowerCase();
  const mem = MODALITY_MEMBERS[m === "x" ? "counts" : m === "exon" ? "spliced" : m === "intron" ? "unspliced" : m];
  if (!mem) throw new CidxError(400, "bad_request", `Unknown modality '${modality}'. Use counts, spliced or unspliced (gene counts only).`);
  return mem;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export async function runExport(ctx: ExportCtx, body: ExportBody): Promise<Response> {
  const t0 = Date.now();
  const XL = { ...EXPORT_LIMITS, ...(ctx.exportLimits ?? {}) };
  const L = ctx.limits;
  const format = body.format ?? "mtx";
  if (format !== "mtx" && format !== "summary") throw new CidxError(400, "bad_request", "`format` is 'mtx' or 'summary'.");
  const members = modalityMembers(body.modality);
  const genesWanted = Array.isArray(body.genes) ? body.genes.map(String).filter((g) => g.trim()).slice(0, 5000) : null;
  if (format === "summary" && (!genesWanted || !genesWanted.length)) throw new CidxError(400, "bad_request", "A summary needs `genes`.");
  if (format === "summary" && genesWanted!.length > SUMMARY_MAX_GENES) throw new CidxError(400, "bad_request", `A summary takes at most ${SUMMARY_MAX_GENES} genes.`);
  const name = body.name ?? "singlet_cells";
  if (!NAME_RE.test(name)) throw new CidxError(400, "bad_request", "`name` is 1-64 letters, digits, '.', '_' or '-'.");

  // plan (the gather planner) and caps
  const stats = newStats();
  const d = await openDirectory(ctx.deps, body.version, stats);
  const want = await resolveCells({ deps: ctx.deps, limits: L }, d, body as GatherBody, stats);
  const sos = [...want.keys()].sort((a, b) => a - b);
  const nCells = sos.reduce((n, s) => n + want.get(s)!.length, 0);
  if (!nCells) throw new CidxError(400, "bad_request", "No cells to export.");
  const maxCells = Math.min(L.maxCells, XL.maxCells);
  if (nCells > maxCells) throw new CidxError(413, "too_many_cells", `${nCells} cells requested; an export holds at most ${maxCells}. Page the query (cursor) or narrow it.`);
  if (sos.length > L.maxSamples) throw new CidxError(413, "too_many_samples", `${sos.length} samples; the limit per request is ${L.maxSamples}.`);
  const plans = await planSamples(ctx.deps, d, sos, stats);
  return exportSamples(ctx, body, d.version, sos.map((s) => plans.get(s)!), want, stats, t0);
}

/** The export of planned samples (`entries`, from the index's plan blocks) and their wanted columns: caps, reads, decode, output. */
export async function exportSamples(ctx: ExportCtx, body: ExportBody, version: string, entries: PlanSample[], want: Map<number, number[]>, stats: ReadStats, t0 = Date.now()): Promise<Response> {
  const XL = { ...EXPORT_LIMITS, ...(ctx.exportLimits ?? {}) };
  const L = ctx.limits;
  const format = body.format ?? "mtx";
  const members = modalityMembers(body.modality);
  const genesWanted = Array.isArray(body.genes) ? body.genes.map(String).filter((g) => g.trim()).slice(0, 5000) : null;
  const name = body.name ?? "singlet_cells";
  const nCells = entries.reduce((n, e) => n + (want.get(e.so)?.length ?? 0), 0);
  const maxCells = Math.min(L.maxCells, XL.maxCells);
  const sos = entries.map((e) => e.so);
  if (!nCells) throw new CidxError(400, "bad_request", "No cells to export.");
  if (nCells > maxCells) throw new CidxError(413, "too_many_cells", `${nCells} cells requested; an export holds at most ${maxCells}. Page the query (cursor) or narrow it.`);
  if (sos.length > L.maxSamples) throw new CidxError(413, "too_many_samples", `${sos.length} samples; the limit per request is ${L.maxSamples}.`);
  for (const e of entries) if (isBlocked(e.key)) throw new CidxError(404, "not_found", `${e.gsm} is not served.`);
  const studies = new Set(entries.map((e) => e.gse));
  if (studies.size > L.maxStudies) throw new CidxError(413, "too_many_studies", `Cells from ${studies.size} studies; the limit per request is ${L.maxStudies}.`);
  for (const e of entries) for (const m of members) if (!e.members[m]) throw new CidxError(502, "bad_object", `${e.gsm} has no ${m}.`);
  const plan = planGather(entries, want, members, new Set(), ["cells"]);
  // the gather estimate, plus the decode: about 250 CPU ms per planned MB (measured in Node on Research Alpha samples, 2026-10-29)
  const base = estimateCost({ reads: plan.reads.length + stats.reads + 4, rows: 0, mb: plan.bytes / 1e6, doCalls: 1, doWrites: 1 });
  const decodeMs = (plan.bytes / 1e6) * DECODE_CPU_MS_PER_MB;
  const est = { ...base, cpu_ms: Math.round((base.cpu_ms + decodeMs) * 10) / 10, usd: base.usd + decodeMs * PRICE.cpuMs };
  const maxBytes = Math.min(L.maxBytes, XL.maxBytes);
  const over = plan.bytes > maxBytes || plan.reads.length > L.maxReads || est.usd > L.maxCostUsd;
  const summary = {
    version,
    cells: nCells,
    samples: sos.length,
    studies: studies.size,
    bytes: plan.bytes,
    reads: plan.reads.length,
    limits: { cells: maxCells, bytes: maxBytes, reads: L.maxReads, usd: L.maxCostUsd },
    estimate: est,
  };
  if (body.dry_run) return Response.json({ dry_run: true, format, modality: body.modality ?? "counts", members, plan: summary }, { headers: { "Cache-Control": "no-store" } });
  if (over)
    throw new OverBudget(`This export would read ${plan.bytes} bytes in ${plan.reads.length} reads (limits ${maxBytes} bytes, ${L.maxReads} reads, $${L.maxCostUsd} worst case); export fewer cells or fewer samples at a time.`, summary);
  if (ctx.charge) await ctx.charge(nCells, plan.bytes, est.usd);

  // decode, sample by sample, into per-cell gene vectors
  const names = [...members, "cells"];
  const rowMap =
    ctx.rowMap ??
    (await (async () => {
      const packs = await packFetcher(ctx.deps, stats);
      return (mem: Member) => {
        if (mem.h.rowsKind !== NK_PACK) throw new CidxError(502, "bad_object", "a gene matrix whose rows are not a feature pack");
        return geneRowMap(packs.fetch, packs.full(mem.h.rowNamesId));
      };
    })());
  let space: { key: string; ids: string[]; symbols: string[] } | null = null;
  const spaceMaps = new Map<string, Int32Array | null>();
  let keep: Int32Array | null = null; // space gene -> output gene (-1: dropped)
  let outGenes: number[] = [];
  let missing: string[] = [];
  const cells: CellRow[] = [];
  const store = new CellStore();
  // summary accumulators: group label -> per output gene [sum, sum cp10k, n > 0]
  const groups = new Map<string, { id: string; n: number; sum: Float64Array; cp: Float64Array; pos: Float64Array }>();
  const extraCols = new Set<string>();
  for (const v of Object.values(body.samples ?? {})) for (const k of Object.keys(v ?? {})) if (/^[a-z][a-z0-9_]{0,40}$/.test(k)) extraCols.add(k);

  const readsBySample = new Map<number, Read[]>();
  for (const r of plan.reads) (readsBySample.get(r.sample) ?? readsBySample.set(r.sample, []).get(r.sample)!).push(r);
  let pending: Promise<Got> | null = null;
  const fetchOf = (i: number) => readSample(ctx.deps, readsBySample.get(i) ?? [], names, stats);
  for (let i = 0; i < plan.samples.length; i++) {
    const ps = plan.samples[i];
    const got = await (pending ?? fetchOf(i));
    pending = i + 1 < plan.samples.length ? fetchOf(i + 1) : null; // read the next sample while this one decodes
    const cols = want.get(ps.so)!;
    // matrices
    const mats: MemberCols[] = [];
    for (const m of members) {
      const prefix = got.prefix.get(m);
      if (!prefix) throw new CidxError(502, "bad_plan", `${ps.gsm}: no prefix for ${m}`);
      const mem = new Member(prefix);
      const map = await rowMap(mem);
      if (!space) {
        space = { key: map.space, ids: map.gene_ids, symbols: map.symbols };
        if (genesWanted) {
          const mg = matchGenes(space.ids, space.symbols, genesWanted);
          missing = mg.missing;
          outGenes = mg.keep;
        } else outGenes = space.ids.map((_, g) => g);
        keep = new Int32Array(space.ids.length).fill(-1);
        outGenes.forEach((g, k) => (keep![g] = k));
      }
      let toSpace = spaceMaps.get(map.space);
      if (toSpace === undefined) {
        if (map.space === space.key) toSpace = null;
        else {
          // another reference: translate by gene id (genes the first one lacks are dropped); a reference of another species shares
          // almost no ids and is refused (the cell index's organism field is GEO text, so samples are not checked by it)
          const lut = new Map(space.ids.map((g, k) => [g, k]));
          toSpace = Int32Array.from(map.gene_ids, (g) => lut.get(g) ?? -1);
          const shared = toSpace.reduce((n, g) => n + (g >= 0 ? 1 : 0), 0);
          if (shared < 0.5 * Math.min(space.ids.length, map.gene_ids.length))
            throw new CidxError(400, "mixed_references", `${ps.gsm} was aligned to another reference (${shared} genes shared): export one organism at a time.`);
        }
        spaceMaps.set(map.space, toSpace);
      }
      mats.push(new MemberCols(mem, got.runs.get(m) ?? [], map, toSpace));
    }
    // per-cell labels from the cells table
    const whole = got.whole.get("cells");
    let table: CellsTable | null = null;
    if (whole) table = await openCells(async (o, l) => whole.subarray(o, o + l), whole.length);
    const lab = await Promise.all(CELL_COLUMNS.map((c) => (table?.has(c) ? table.strings(c) : Promise.resolve(null))));
    const umi = await Promise.all(UMI_COLUMNS.map((c) => (table?.has(c) ? table.numeric(c) : Promise.resolve(null))));
    const nSpace = space!.ids.length;
    const acc = new Float64Array(nSpace);
    const outIdx = new Int32Array(outGenes.length);
    const outVal = new Float64Array(outGenes.length);
    for (const col of cols) {
      const touched: number[] = [];
      for (const mc of mats) mc.addColumn(col, acc, touched);
      let total = 0;
      let k = 0;
      for (const g of touched) total += acc[g];
      const sorted = Int32Array.from(touched).sort();
      for (const g of sorted) {
        const o = keep![g];
        if (o >= 0) {
          outIdx[k] = o;
          outVal[k] = acc[g];
          k++;
        }
        acc[g] = 0;
      }
      const labels = lab.map((l) => (l ? (l[col] ?? "") : ""));
      const row: CellRow = { gsm: ps.gsm, gse: ps.gse, col, labels, umi: umi.reduce((n, u) => n + (u ? (u[col] ?? 0) : 0), 0), total };
      cells.push(row);
      if (format === "summary") {
        const key = labels[0] || "unknown";
        let gr = groups.get(key);
        if (!gr) groups.set(key, (gr = { id: labels[1] || "", n: 0, sum: new Float64Array(outGenes.length), cp: new Float64Array(outGenes.length), pos: new Float64Array(outGenes.length) }));
        gr.n++;
        for (let t = 0; t < k; t++) {
          gr.sum[outIdx[t]] += outVal[t];
          gr.cp[outIdx[t]] += total > 0 ? (outVal[t] * 1e4) / total : 0;
          gr.pos[outIdx[t]] += 1;
        }
      } else {
        store.add(outIdx, outVal, k);
        if (store.nnz > XL.maxNnz) throw new CidxError(413, "too_many_values", `More than ${XL.maxNnz} non-zero values; export fewer cells or pass genes.`);
      }
    }
  }
  const elapsedMs = Date.now() - t0;
  const geneMeta = outGenes.map((g) => ({ id: space!.ids[g], symbol: space!.symbols[g] }));

  if (format === "summary") {
    const out = [...groups.entries()]
      .map(([label, g]) => ({
        cell_type: label,
        cell_type_id: g.id || null,
        cells: g.n,
        genes: geneMeta.map((gm, k) => ({ gene_id: gm.id, symbol: gm.symbol, mean: g.sum[k] / g.n, mean_cp10k: g.cp[k] / g.n, frac_expressing: g.pos[k] / g.n })),
      }))
      .sort((a, b) => b.cells - a.cells);
    return Response.json(
      {
        format: "summary",
        version,
        modality: body.modality ?? "counts",
        cells: cells.length,
        samples: plan.samples.length,
        studies: studies.size,
        genes: geneMeta,
        missing_genes: missing,
        groups: out,
        note: "mean = mean UMI count per cell; mean_cp10k = mean of count / cell total x 10,000 (cell total over every gene of the modality); frac_expressing = share of cells with a count > 0. Groups are the .s1 labeller's cell types.",
        reads: stats.reads,
        bytes_read: stats.bytes,
        ms: Date.now() - t0,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // the zip
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const zip = new ZipWriter((b) => writer.write(b));
  const dir = `${name}/`;
  const work = (async () => {
    try {
      const nnz = store.nnz;
      const manifest = {
        format: "singlet-cells-export",
        format_version: 1,
        license: "CC0-1.0",
        source: "https://singlet.bio (Research Alpha), reprocessed GEO studies",
        index_version: version,
        modality: body.modality ?? "counts",
        modality_members: members,
        genes: { n: geneMeta.length, requested: genesWanted, missing, gene_space: space!.key },
        cells: cells.length,
        nnz,
        samples: plan.samples.map((s) => ({ gsm: s.gsm, gse: s.gse, object: `https://data.singlet.bio/${s.key}`, cells: s.n_cells })),
        provenance: body.provenance ?? null,
        created_at: new Date().toISOString(),
        decode_ms: elapsedMs,
      };
      await zip.file(dir + "README.txt", enc.encode(readme(name, cells.length, geneMeta.length, nnz, manifest.modality as string)));
      await zip.file(dir + "manifest.json", enc.encode(JSON.stringify(manifest, null, 1) + "\n"));
      await zip.file(dir + "features.tsv.gz", await gzipBytes(enc.encode(geneMeta.map((g) => `${g.id}\t${g.symbol || g.id}\tGene Expression\n`).join(""))));
      await zip.file(dir + "barcodes.tsv.gz", await gzipBytes(enc.encode(cells.map((c) => `${c.gsm}_${c.col}\n`).join(""))));
      const extra = [...extraCols];
      const head = ["cell", "gsm", "gse", "column", "cell_type", "cell_type_ontology_term_id", "sex", "ancestry", "n_umi", "n_counts", ...extra];
      const rows = cells.map((c) => {
        const sx = body.samples?.[c.gsm] ?? {};
        return [`${c.gsm}_${c.col}`, c.gsm, c.gse, c.col, ...c.labels, c.umi, c.total, ...extra.map((k) => sx[k])].map(tsvCell).join("\t");
      });
      await zip.file(dir + "obs.tsv.gz", await gzipBytes(enc.encode(head.join("\t") + "\n" + rows.join("\n") + "\n")));
      // matrix.mtx.gz: a gzip member with the header, then one with the entries (a .gz may hold several members; gunzip, R and Python read them all)
      await zip.begin(dir + "matrix.mtx.gz");
      await zip.data(
        await gzipBytes(
          enc.encode(
            `%%MatrixMarket matrix coordinate integer general\n%metadata_json: {"software": "singlet.bio export", "index_version": "${version}"}\n${geneMeta.length} ${cells.length} ${nnz}\n`
          )
        )
      );
      async function* body_(): AsyncGenerator<Uint8Array> {
        const q: Uint8Array[] = [];
        const lines = new Lines(async (b) => {
          q.push(b);
        });
        for (let i = 0; i < cells.length; i++) {
          for (const [g, v] of store.cell(i)) await lines.triple(g + 1, i + 1, v);
          while (q.length) yield q.shift()!;
        }
        await lines.drain();
        while (q.length) yield q.shift()!;
      }
      await gzip(body_(), (b) => zip.data(b));
      await zip.end();
      await zip.finish();
      await writer.close();
    } catch (e) {
      console.error("singlet-data export:", e instanceof Error ? (e.stack ?? e.message) : String(e));
      await writer.abort(e).catch(() => undefined);
    }
  })();
  ctx.waitUntil?.(work);
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}.zip"`,
      "Cache-Control": "no-store",
      "X-Export-Cells": String(cells.length),
      "X-Export-Genes": String(geneMeta.length),
      "X-Export-Nnz": String(store.nnz),
      "X-Export-Ms": String(elapsedMs),
    },
  });
}

function readme(name: string, cells: number, genes: number, nnz: number, modality: string): string {
  return `singlet.bio cell export (CC0 1.0: no rights reserved)

${cells} cells x ${genes} genes, ${nnz} non-zero UMI counts (${modality === "counts" ? "spliced + unspliced" : modality}), from
Research Alpha: public GEO studies reprocessed from raw reads with one pipeline. manifest.json lists the source samples and the query.

Files (10x Genomics layout, genes x cells):
  matrix.mtx.gz     MatrixMarket coordinate integer counts
  features.tsv.gz   gene id, symbol, "Gene Expression"
  barcodes.tsv.gz   cell id <GSM>_<column> (column = the cell's row in the sample's cells table)
  obs.tsv.gz        per cell: sample, study, cell type (Cell Ontology), chromosomal sex, genetic ancestry, UMIs, and sample facts

Python:   import scanpy as sc, pandas as pd
          adata = sc.read_10x_mtx("${name}")
          adata.obs = adata.obs.join(pd.read_csv("${name}/obs.tsv.gz", sep="\\t", index_col=0))
R:        m <- Seurat::Read10X("${name}"); obs <- read.delim("${name}/obs.tsv.gz", row.names = 1)

Cell-type labels below lineage level are previews (per-study accuracy: compartment 0.84, lineage 0.75, cell type 0.43,
subtype 0.32). Sex is called per cell from XIST and chrY; ancestry only for donors with enough covered sites.
More: https://singlet.bio/docs/mcp
`;
}
