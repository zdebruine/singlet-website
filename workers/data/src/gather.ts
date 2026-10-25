/**
 * `POST /store/cidx/gather` (singlet-bio docs/format-store-cell-index.md section 7): cells from any number of samples in one streamed answer.
 *
 * The Worker plans from the index's plan blocks (no prefix or chunk-index read per sample): for every sample and matrix member the
 * prefix (unless the client already has it, `have_prefix`) and the chunk runs covering the wanted columns; pieces of one sample object
 * closer than 64 KiB share one read (at most 8 MiB). Reads go through `handle()` (Cache API, then R2), six at a time per invocation
 * (the platform's limit on connections waiting for headers); with a `SELF` service binding, big plans are split across
 * sub-invocations that each run their own six. Every piece is sent as one frame; frames arrive in completion order.
 *
 *   "SGA1" u32 header_len, header JSON {version, member_names, samples, reads, bytes}
 *   frames: u32 sample, u16 member, u8 kind (1 prefix, 2 run, 3 whole member, 254 error, 255 end), u8 0, u64 member offset, u32 len, body
 *   the end frame's body is the trailer JSON {ok, errors, reads, bytes_read, bytes_sent, cache_hits, ms}
 */
import type { Deps } from "./handler";
import {
  actualCost,
  CidxError,
  clientPlan,
  estimateCost,
  newStats,
  openDirectory,
  OverBudget,
  planSamples,
  readBytes,
  readTable,
  runQuery,
  type Directory,
  type PlanSample,
  type QueryBody,
  type ReadStats,
} from "./cidx";

export const GATHER_GAP = 64 * 1024;
export const GATHER_READ_MAX = 8 * 1024 * 1024;
export const FR_PREFIX = 1;
export const FR_RUN = 2;
export const FR_WHOLE = 3;
export const FR_ERROR = 0xfe;
export const FR_END = 0xff;
export const FRAME_BYTES = 20;
/** reads per invocation before the plan is split across sub-invocations (when a SELF binding is configured) */
export const FANOUT_MIN_READS = 48;
export const FANOUT_MAX_PARTS = 16;

export const MODALITY_MEMBERS: Record<string, string[]> = {
  counts: ["exon_counts.1pz", "intron_counts.1pz"],
  spliced: ["exon_counts.1pz"],
  unspliced: ["intron_counts.1pz"],
  splice_junctions: ["sj_counts.1pz"],
  mt: ["mt_heteroplasmy.1pz"],
  vdj: ["vdj_gene_usage.1pz"],
};
const ALIASES: Record<string, string> = { x: "counts", exon: "spliced", intron: "unspliced", junctions: "splice_junctions", sj: "splice_junctions", mt_heteroplasmy: "mt", vdj_gene_usage: "vdj" };

export function membersFor(modalities: unknown): string[] {
  const list = modalities === undefined || modalities === null ? ["counts", "spliced", "unspliced"] : Array.isArray(modalities) ? modalities : [modalities];
  const out: string[] = [];
  for (const m of list) {
    const k = ALIASES[String(m).toLowerCase()] ?? String(m).toLowerCase();
    const mem = MODALITY_MEMBERS[k];
    if (!mem) throw new CidxError(400, "bad_request", `Unknown modality '${m}'. Use ${Object.keys(MODALITY_MEMBERS).join(", ")}.`);
    for (const x of mem) if (!out.includes(x)) out.push(x);
  }
  return out;
}

export interface Piece {
  member: number;
  kind: number;
  off: number; // member offset
  len: number;
  abs: number; // object offset
}
export interface Read {
  sample: number;
  key: string;
  start: number;
  end: number;
  pieces: Piece[];
}
export interface GatherPlan {
  samples: { i: number; so: number; gsm: string; gse: string; key: string; n_cells: number; members: Record<string, unknown> }[];
  reads: Read[];
  bytes: number;
  payload: number;
  cells: number;
}

function chunkOf(first: number[], col: number): number {
  let a = 0;
  let b = first.length - 1;
  while (a < b) {
    const m = (a + b + 1) >>> 1;
    if (first[m] <= col) a = m;
    else b = m - 1;
  }
  return a;
}

/** The plan of singlet.store.atlas.plan_gather (same pieces, same coalescing). `want` columns are ascending and unique. */
export function planGather(samples: PlanSample[], want: Map<number, number[]>, members: string[], havePrefix: Set<string>, whole: string[] = []): GatherPlan {
  const names = [...members, ...whole];
  const out: GatherPlan = { samples: [], reads: [], bytes: 0, payload: 0, cells: 0 };
  samples.forEach((s, i) => {
    const cols = want.get(s.so) ?? [];
    out.cells += cols.length;
    const pieces: Piece[] = [];
    const memOut: Record<string, unknown> = {};
    names.forEach((name, mi) => {
      const m = s.members[name];
      if (!m) return;
      if (whole.includes(name)) {
        pieces.push({ member: mi, kind: FR_WHOLE, off: 0, len: m.len, abs: m.off });
        memOut[name] = { digest: m.digest, whole: true, len: m.len };
        return;
      }
      const first = m.first_col ?? [];
      const coff = m.coff ?? [];
      if (first.length < 2 || m.chunks_at === undefined || m.prefix === undefined) return;
      const runs: number[][] = [];
      let cur: [number, number] | null = null;
      const flush = () => {
        if (!cur) return;
        const [k0, k1] = cur;
        const rel = m.chunks_at! - m.off + coff[k0];
        const len = coff[k1 + 1] - coff[k0];
        runs.push([first[k0], first[k1 + 1], rel, len]);
        pieces.push({ member: mi, kind: FR_RUN, off: rel, len, abs: m.off + rel });
      };
      for (const c of cols) {
        if (c < 0 || c >= first[first.length - 1]) throw new CidxError(400, "bad_cells", `${s.gsm}: column ${c} is not an indexed (called) cell.`);
        const k = chunkOf(first, c);
        if (cur && k <= cur[1] + 1) cur[1] = Math.max(cur[1], k);
        else {
          flush();
          cur = [k, k];
        }
      }
      flush();
      const send = !(m.digest && havePrefix.has(m.digest));
      if (send) pieces.push({ member: mi, kind: FR_PREFIX, off: 0, len: m.prefix, abs: m.off });
      memOut[name] = { digest: m.digest, prefix: m.prefix, send_prefix: send, runs, len: m.len };
    });
    pieces.sort((a, b) => a.abs - b.abs || a.len - b.len);
    let r: Read | null = null;
    for (const p of pieces) {
      if (p.len <= 0) continue;
      if (r && p.abs - r.end <= GATHER_GAP && Math.max(r.end, p.abs + p.len) - r.start <= GATHER_READ_MAX) {
        r.end = Math.max(r.end, p.abs + p.len);
        r.pieces.push(p);
      } else {
        r = { sample: i, key: s.key, start: p.abs, end: p.abs + p.len, pieces: [p] };
        out.reads.push(r);
      }
      out.payload += p.len;
    }
    out.samples.push({ i, so: s.so, gsm: s.gsm, gse: s.gse, key: s.key, n_cells: cols.length, members: memOut });
  });
  out.bytes = out.reads.reduce((n, r) => n + (r.end - r.start), 0);
  return out;
}

export function frame(sample: number, member: number, kind: number, off: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(FRAME_BYTES + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, sample, true);
  dv.setUint16(4, member, true);
  dv.setUint8(6, kind);
  dv.setUint8(7, 0);
  dv.setBigUint64(8, BigInt(off), true);
  dv.setUint32(16, body.length, true);
  out.set(body, FRAME_BYTES);
  return out;
}

const SAMPLE_KEY = /^(store|v2)\/s\/GSM\d{1,12}\/[0-9a-f]{32}\.(s1|s2)$/;

/** Run reads (at most `conc` at a time), calling `emit` with complete frames. Read failures become error frames. */
export async function runReads(deps: Deps, reads: Read[], emit: (f: Uint8Array) => Promise<void>, stats: ReadStats, errors: unknown[], conc = 6): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < reads.length) {
      const r = reads[next++];
      try {
        if (!SAMPLE_KEY.test(r.key)) throw new CidxError(502, "bad_index", "plan names a key that is not a sample object");
        const buf = await readBytes({ ...deps, rangeFillMax: 0 }, r.key, r.start, r.end - r.start, stats);
        for (const p of r.pieces) await emit(frame(r.sample, p.member, p.kind, p.off, buf.subarray(p.abs - r.start, p.abs - r.start + p.len)));
      } catch (e) {
        const err = { sample: r.sample, key: r.key, error: e instanceof Error ? e.message : String(e) };
        errors.push(err);
        await emit(frame(r.sample, 0, FR_ERROR, 0, new TextEncoder().encode(JSON.stringify(err))));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, reads.length) }, worker));
}

export interface GatherLimits {
  /** cells per request (10,000) */
  maxCells: number;
  /** studies the cells of one request may come from (10) */
  maxStudies: number;
  maxSamples: number;
  /** planned sample-object bytes per request */
  maxBytes: number;
  /** planned R2 reads per request */
  maxReads: number;
  /** worst-case cost of one request, USD */
  maxCostUsd: number;
  /** rows a query handle may scan */
  maxRowsScanned: number;
}
export interface GatherBody {
  version?: string;
  cells?: [number | string, number[]][];
  /** a query handle: the cells of `POST /store/cidx/query` with return "cells" and these parameters */
  query?: Omit<QueryBody, "return" | "by" | "fields" | "dry_run" | "version">;
  modalities?: string[];
  have_prefix?: string[];
  cells_table?: boolean;
  /** answer with the plan and its worst-case cost (JSON) instead of streaming */
  dry_run?: boolean;
}
export interface GatherCtx {
  deps: Deps;
  limits: GatherLimits;
  /** charge the planned cells/bytes before anything is streamed; throws CidxError(429) when over quota */
  charge?: (cells: number, bytes: number, usd: number) => Promise<void>;
  /** split reads across sub-invocations: returns a frames-only stream for the given reads */
  fanout?: ((reads: Read[]) => Promise<Response>) | null;
  /** reads before the plan is split (default FANOUT_MIN_READS) */
  fanoutMin?: number;
  waitUntil?: (p: Promise<unknown>) => void;
}

const GSM_RE = /^GSM(\d{1,9})$/;

async function resolveCells(ctx: GatherCtx, d: Directory, body: GatherBody, stats: ReadStats): Promise<Map<number, number[]>> {
  const want = new Map<number, number[]>();
  if (body.query) {
    const L = ctx.limits;
    const r = (await runQuery(
      ctx.deps,
      { ...body.query, version: d.version, return: "cells", fields: [] },
      { maxRowsScanned: L.maxRowsScanned, maxCells: L.maxCells, maxStudies: L.maxStudies, maxCostUsd: L.maxCostUsd }
    )) as { cells: { so: number[]; col: number[] } };
    r.cells.so.forEach((so, k) => {
      const l = want.get(so);
      if (l) l.push(r.cells.col[k]);
      else want.set(so, [r.cells.col[k]]);
    });
  } else {
    if (!Array.isArray(body.cells) || !body.cells.length) throw new CidxError(400, "bad_request", "Give `cells` as [[sample ordinal or GSM, [columns...]], ...] or a `query`.");
    let gsmLut: Map<number, number> | null = null;
    for (const item of body.cells) {
      if (!Array.isArray(item) || item.length !== 2 || !Array.isArray(item[1])) throw new CidxError(400, "bad_request", "Each entry of `cells` is [sample, [columns...]].");
      let so: number;
      if (typeof item[0] === "string") {
        const m = GSM_RE.exec(item[0].toUpperCase());
        if (!m) throw new CidxError(400, "bad_request", `'${item[0]}' is not a GSM accession or a sample ordinal.`);
        if (!gsmLut) {
          const t = await readTable(ctx.deps, d.samples.key, stats);
          gsmLut = new Map();
          for (let i = 0; i < t.so.length; i++) gsmLut.set(t.gsm[i], t.so[i]);
        }
        const s = gsmLut.get(Number(m[1]));
        if (s === undefined) throw new CidxError(400, "unknown_sample", `${item[0]} is not in index ${d.version}.`);
        so = s;
      } else so = Number(item[0]);
      if (!Number.isInteger(so) || so < 0) throw new CidxError(400, "bad_request", "Sample ordinals are non-negative integers.");
      const l = want.get(so) ?? [];
      for (const c of item[1]) {
        const n = Number(c);
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new CidxError(400, "bad_request", "Columns are non-negative integers.");
        l.push(n);
      }
      want.set(so, l);
    }
  }
  for (const [so, l] of want) want.set(so, [...new Set(l)].sort((a, b) => a - b));
  return want;
}

export async function runGather(ctx: GatherCtx, body: GatherBody): Promise<Response> {
  const t0 = Date.now();
  const stats = newStats();
  const d = await openDirectory(ctx.deps, body.version, stats);
  const want = await resolveCells(ctx, d, body, stats);
  const sos = [...want.keys()].sort((a, b) => a - b);
  const nCells = sos.reduce((n, s) => n + want.get(s)!.length, 0);
  if (!nCells) throw new CidxError(400, "bad_request", "No cells to gather.");
  const L = ctx.limits;
  if (nCells > L.maxCells) throw new CidxError(413, "too_many_cells", `${nCells} cells requested; the limit per request is ${L.maxCells}. Split the request (singlet.store.atlas.gather does).`);
  if (sos.length > L.maxSamples) throw new CidxError(413, "too_many_samples", `${sos.length} samples; the limit per request is ${L.maxSamples}.`);
  const members = membersFor(body.modalities);
  const plans = await planSamples(ctx.deps, d, sos, stats);
  const entries = sos.map((s) => plans.get(s)!);
  const orgs = new Set(entries.map((e) => e.organism));
  if (orgs.size > 1) throw new CidxError(400, "mixed_organisms", "Cells from several organisms: gather one organism at a time.");
  const studies = new Set(entries.map((e) => e.gse));
  if (studies.size > L.maxStudies) throw new CidxError(413, "too_many_studies", `Cells from ${studies.size} studies; the limit per request is ${L.maxStudies}. Split the request by study.`);
  const have = new Set((body.have_prefix ?? []).map(String).slice(0, 100_000));
  const plan = planGather(entries, want, members, have, body.cells_table ? ["cells"] : []);
  // worst case of this request: every planned read misses the cache and starts a fill; every byte is copied once
  const est = estimateCost({ reads: plan.reads.length + stats.reads, rows: 0, mb: plan.bytes / 1e6, doCalls: 1, doWrites: 1 });
  const over = plan.bytes > L.maxBytes || plan.reads.length > L.maxReads || est.usd > L.maxCostUsd;
  if (body.dry_run || over) {
    const why = body.dry_run
      ? "dry run"
      : `the plan reads ${plan.bytes} bytes in ${plan.reads.length} reads (limits ${L.maxBytes} bytes, ${L.maxReads} reads, $${L.maxCostUsd} worst case per request); split it into smaller requests`;
    const cp = clientPlan(d, "gather", body as unknown as Record<string, unknown>, est, L.maxCostUsd, why);
    const out = { ...cp, cells: nCells, samples: sos.length, studies: studies.size, bytes: plan.bytes, reads: plan.reads.length };
    if (body.dry_run) return Response.json({ version: d.version, dry_run: true, plan: out }, { headers: { "Cache-Control": "no-store" } });
    throw new OverBudget("This gather would exceed the per-request budget.", out);
  }
  if (ctx.charge) await ctx.charge(nCells, plan.bytes, est.usd);

  const names = [...members, ...(body.cells_table ? ["cells"] : [])];
  const header = new TextEncoder().encode(
    JSON.stringify({
      format: "singlet-gather",
      version: d.version,
      member_names: names,
      samples: plan.samples,
      reads: plan.reads.length,
      bytes: plan.bytes,
      payload: plan.payload,
      cells: plan.cells,
      estimate: est,
    })
  );
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let sent = 0;
  const emit = async (f: Uint8Array) => {
    sent += f.length;
    await writer.write(f);
  };
  const errors: unknown[] = [];
  const work = (async () => {
    try {
      const head = new Uint8Array(8 + header.length);
      head.set([0x53, 0x47, 0x41, 0x31]);
      new DataView(head.buffer).setUint32(4, header.length, true);
      head.set(header, 8);
      await emit(head);
      const reads = plan.reads;
      if (ctx.fanout && reads.length >= (ctx.fanoutMin ?? FANOUT_MIN_READS)) {
        const parts = Math.min(FANOUT_MAX_PARTS, Math.max(2, Math.ceil(reads.length / 24)));
        const per = Math.ceil(reads.length / parts);
        const slices: Read[][] = [];
        for (let i = 0; i < reads.length; i += per) slices.push(reads.slice(i, i + per));
        await Promise.all(slices.map((sl) => pipePart(ctx, sl, emit, stats, errors)));
      } else {
        await runReads(ctx.deps, reads, emit, stats, errors);
      }
      const trailer = new TextEncoder().encode(
        JSON.stringify({
          ok: errors.length === 0,
          errors: errors.slice(0, 50),
          reads: stats.reads,
          bytes_read: stats.bytes,
          bytes_sent: sent,
          cache_hits: stats.hits,
          cost: actualCost(stats, 0, sent / 1e6, 1),
          ms: Date.now() - t0,
        })
      );
      await emit(frame(0, 0, FR_END, 0, trailer));
      await writer.close();
    } catch (e) {
      await writer.abort(e).catch(() => undefined);
    }
  })();
  ctx.waitUntil?.(work);
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-singlet-gather",
      "Cache-Control": "no-store",
      "X-Gather-Bytes": String(plan.bytes),
      "X-Gather-Reads": String(plan.reads.length),
      "X-Gather-Cells": String(plan.cells),
    },
  });
}

/** Run a slice of reads in a sub-invocation and copy its frames into the parent stream, whole frames at a time. */
async function pipePart(ctx: GatherCtx, reads: Read[], emit: (f: Uint8Array) => Promise<void>, stats: ReadStats, errors: unknown[]): Promise<void> {
  let res: Response;
  try {
    res = await ctx.fanout!(reads);
    if (res.status !== 200 || !res.body) throw new Error(`sub-invocation answered HTTP ${res.status}`);
  } catch {
    // fall back to reading here
    await runReads(ctx.deps, reads, emit, stats, errors);
    return;
  }
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  const append = (b: Uint8Array) => {
    const n = new Uint8Array(buf.length + b.length);
    n.set(buf);
    n.set(b, buf.length);
    buf = n;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) append(value);
    for (;;) {
      if (buf.length < FRAME_BYTES) break;
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const len = dv.getUint32(16, true);
      if (buf.length < FRAME_BYTES + len) break;
      const f = buf.slice(0, FRAME_BYTES + len);
      buf = buf.slice(FRAME_BYTES + len);
      const kind = f[6];
      if (kind === FR_END) {
        const t = JSON.parse(new TextDecoder().decode(f.subarray(FRAME_BYTES))) as { reads: number; bytes_read: number; cache_hits: number; errors: unknown[] };
        stats.reads += t.reads;
        stats.bytes += t.bytes_read;
        stats.hits += t.cache_hits;
        errors.push(...(t.errors ?? []));
        continue;
      }
      await emit(f);
    }
    if (done) break;
  }
}

/** `POST /store/cidx/_part` (internal, behind the shared secret): frames for the given reads, then an end frame with the read stats. */
export async function runPart(deps: Deps, reads: Read[]): Promise<Response> {
  if (!Array.isArray(reads) || reads.length > 1000) throw new CidxError(400, "bad_request", "bad part");
  const stats = newStats();
  const errors: unknown[] = [];
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  (async () => {
    try {
      await runReads(deps, reads, (f) => writer.write(f), stats, errors);
      await writer.write(frame(0, 0, FR_END, 0, new TextEncoder().encode(JSON.stringify({ reads: stats.reads, bytes_read: stats.bytes, cache_hits: stats.hits, errors }))));
      await writer.close();
    } catch (e) {
      await writer.abort(e).catch(() => undefined);
    }
  })();
  return new Response(readable, { status: 200, headers: { "Content-Type": "application/x-singlet-gather-part", "Cache-Control": "no-store" } });
}
