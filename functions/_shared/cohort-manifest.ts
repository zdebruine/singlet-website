/**
 * Cohort manifest: for a resolved cohort, which bytes of which public files a client fetches, and which cells
 * (matrix columns) it keeps. The Worker plans; the client does the Range requests. Spec: docs/COHORT-QUERY.md.
 *
 * Downsampling is deterministic and stratified by sample:
 *   1. If the cohort has at most `max_cells` cells, every cell is kept.
 *   2. Otherwise each sample gets cells in proportion to its size (largest remainder, so the total is exactly
 *      `max_cells`).
 *   3. A sample whose share would fall below `min_cells_per_sample` (and is not the whole sample) is dropped
 *      whole, smallest first, until every kept sample clears the floor. Dropping is the only way a sample
 *      disappears.
 *   4. Within a sample the kept columns are drawn without replacement by selection sampling (Knuth's
 *      algorithm S) from a mulberry32 stream seeded with FNV-1a("<seed>|<GSM>").
 * The same (cohort, max_cells, seed, min_cells_per_sample) always yields the same columns.
 */
import type { ZipEntry } from "./bundle-reader";
import { bundleUrl } from "./study-core";

export const DEFAULT_MIN_CELLS_PER_SAMPLE = 50;
export const DEFAULT_FILES = ["exon_counts.1pz", "intron_counts.1pz"];
export const MAX_PAGE_SAMPLES = 500;

// ── seeded stream ───────────────────────────────────────────────────────────

export function fnv1a32(text: string): number {
  const b = new TextEncoder().encode(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

/** mulberry32: returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── allocation ──────────────────────────────────────────────────────────────

export interface SampleCount {
  gsm_id: string;
  n_cells: number;
}

export interface Allocation {
  /** Cells to keep per input sample (0 = dropped), same order as the input. */
  keep: number[];
  dropped: number[];
  cells_before: number;
  cells_after: number;
}

export function allocateCells(samples: SampleCount[], maxCells: number, seed: string, minPerSampleIn = DEFAULT_MIN_CELLS_PER_SAMPLE): Allocation {
  const minPerSample = Math.max(1, minPerSampleIn);
  const S = samples.length;
  const before = samples.reduce((n, s) => n + s.n_cells, 0);
  const keep = samples.map((s) => s.n_cells);
  if (!(maxCells >= 1) || before <= maxCells) return { keep, dropped: [], cells_before: before, cells_after: before };

  const tie = samples.map((s) => fnv1a32(`${seed}|${s.gsm_id}`));
  // Smallest first; ties by the seeded hash so the drop order does not depend on input order.
  const byAsc = samples.map((_, i) => i).sort((a, b) => samples[a].n_cells - samples[b].n_cells || tie[a] - tie[b] || (samples[a].gsm_id < samples[b].gsm_id ? -1 : 1));
  const prefix = new Float64Array(S + 1);
  for (let i = 0; i < S; i++) prefix[i + 1] = prefix[i] + samples[byAsc[i]].n_cells;

  // Fewest drops d (smallest samples) such that the smallest sample left keeps at least the floor.
  const ok = (d: number) => {
    const rest = before - prefix[d];
    if (rest <= maxCells) return true;
    return (samples[byAsc[d]].n_cells * maxCells) / rest >= minPerSample;
  };
  let lo = 0;
  let hi = S - 1; // never drop the last sample
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  const d = lo;
  const dropped = byAsc.slice(0, d).sort((a, b) => a - b);
  for (const i of dropped) keep[i] = 0;

  const live = byAsc.slice(d);
  const rest = before - prefix[d];
  if (rest <= maxCells) {
    return { keep, dropped, cells_before: before, cells_after: rest };
  }
  // Largest remainder over the samples left.
  const q = live.map((i) => (samples[i].n_cells * maxCells) / rest);
  const floors = q.map((x) => Math.floor(x));
  let left = maxCells - floors.reduce((a, b) => a + b, 0);
  const order = live.map((_, j) => j).sort((a, b) => q[b] - floors[b] - (q[a] - floors[a]) || tie[live[a]] - tie[live[b]] || (samples[live[a]].gsm_id < samples[live[b]].gsm_id ? -1 : 1));
  for (let j = 0; j < live.length; j++) keep[live[j]] = floors[j];
  for (let r = 0; r < order.length && left > 0; r++, left--) keep[live[order[r]]]++;
  // Never more than the sample holds (only possible when the cap is almost the whole cohort).
  for (const i of live) keep[i] = Math.min(keep[i], samples[i].n_cells);
  return { keep, dropped, cells_before: before, cells_after: keep.reduce((a, b) => a + b, 0) };
}

/** Sorted column indices: `k` of `n`, drawn by selection sampling from the stream seeded by (seed, gsm). */
export function selectColumns(n: number, k: number, seed: string, gsm: string): Uint32Array {
  if (k >= n) return Uint32Array.from({ length: n }, (_, i) => i);
  const out = new Uint32Array(k);
  const rng = mulberry32(fnv1a32(`${seed}|${gsm}`));
  let chosen = 0;
  for (let i = 0; i < n && chosen < k; i++) {
    if (rng() * (n - i) < k - chosen) out[chosen++] = i;
  }
  return out;
}

/** [start, length, start, length, ...] over ascending indices. */
export function toRuns(idx: ArrayLike<number>): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    runs.push(idx[i], j - i + 1);
    i = j + 1;
  }
  return runs;
}

// ── byte plans ──────────────────────────────────────────────────────────────

export interface ChunkRow {
  gsm_id: string;
  file: string;
  n_cols: number;
  chunk_cols: number;
  /** n_chunks + 1 byte offsets relative to the start of the entry's data; chunk c is [o[c], o[c+1]). */
  chunk_offsets: number[];
  perm_present: number;
}

export interface ChunkPlan {
  n_cols: number;
  chunk_cols: number;
  perm_present: boolean;
  /** Bytes before the first chunk (needed once to decode), relative to the entry data. */
  header: { start: number; end: number };
  n_chunks_total: number;
  n_chunks_needed: number;
  /** Contiguous chunk runs to fetch; start/end are inclusive byte offsets relative to the entry data. */
  ranges: { first_chunk: number; last_chunk: number; start: number; end: number }[];
  bytes_to_fetch: number;
  bytes_total: number;
  /** Cells in the fetched chunks divided by cells kept. */
  overread_ratio: number;
}

/** Chunks that hold the kept columns, merged into byte ranges. `columns` null keeps everything. */
export function planChunks(row: ChunkRow, columns: ArrayLike<number> | null): ChunkPlan {
  const o = row.chunk_offsets;
  const nChunks = o.length - 1;
  const cc = row.chunk_cols;
  const need: number[] = [];
  if (columns === null) for (let c = 0; c < nChunks; c++) need.push(c);
  else {
    let last = -1;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (col >= row.n_cols) continue;
      const c = Math.floor(col / cc);
      if (c !== last) need.push(c);
      last = c;
    }
  }
  const ranges: ChunkPlan["ranges"] = [];
  let bytes = 0;
  let cellsFetched = 0;
  for (let i = 0; i < need.length; ) {
    let j = i;
    while (j + 1 < need.length && need[j + 1] === need[j] + 1) j++;
    const first = need[i];
    const lastC = need[j];
    ranges.push({ first_chunk: first, last_chunk: lastC, start: o[first], end: o[lastC + 1] - 1 });
    bytes += o[lastC + 1] - o[first];
    cellsFetched += Math.min(row.n_cols, (lastC + 1) * cc) - first * cc;
    i = j + 1;
  }
  const kept = columns === null ? row.n_cols : Math.max(1, columns.length);
  return {
    n_cols: row.n_cols,
    chunk_cols: cc,
    perm_present: !!row.perm_present,
    header: { start: 0, end: Math.max(0, o[0] - 1) },
    n_chunks_total: nChunks,
    n_chunks_needed: need.length,
    ranges,
    bytes_to_fetch: bytes + o[0],
    bytes_total: o[nChunks],
    overread_ratio: Math.round((cellsFetched / kept) * 100) / 100,
  };
}

/** Entry extended by an indexer that records the payload start; absent in today's bundle_index rows. */
export type IndexedEntry = ZipEntry & { d?: number };

export interface ManifestFile {
  path: string;
  method: "stored" | "deflate";
  compressed_bytes: number;
  uncompressed_bytes: number;
  /** Offset of the zip local header. Bytes 26-29 of it give the name and extra lengths. */
  local_header_offset: number;
  /** First payload byte if the local header has no extra field; add the extra length (header bytes 28-29). */
  data_offset_min: number;
  /** Exact first payload byte, when the indexer recorded it. */
  data_offset: number | null;
  /** Inclusive absolute range of the whole entry when data_offset is known. */
  range: string | null;
  chunks: ChunkPlan | null;
}

export interface ManifestSample {
  gsm_id: string;
  n_cells: number;
  keep_cells: number;
  /** Runs of kept columns [start, length, ...]; null = all columns. */
  keep_runs: number[] | null;
  files: ManifestFile[];
}

export interface ManifestStudy {
  gse_id: string;
  url: string;
  indexed: boolean;
  samples: ManifestSample[];
}

export interface PlanInput {
  selected: { gsm_id: string; gse_id: string; n_cells: number }[];
  /** gse -> entries from bundle_index (absent = study not indexed yet). */
  entries: Map<string, IndexedEntry[]>;
  /** `${gsm}|${file}` -> chunk map. */
  chunks: Map<string, ChunkRow>;
  files?: string[];
  maxCells?: number | null;
  seed?: string;
  minCellsPerSample?: number;
  offset?: number;
  limit?: number;
  /** false: no column lists in the page, the client reproduces them from (seed, n, k). */
  indices?: boolean;
}

export interface Plan {
  downsample: null | {
    max_cells: number;
    seed: string;
    min_cells_per_sample: number;
    algorithm: string;
    cells_before: number;
    cells_after: number;
    samples_before: number;
    samples_after: number;
    dropped: { gsm_id: string; gse_id: string; n_cells: number }[];
  };
  page: { offset: number; limit: number; n_samples: number; next_offset: number | null };
  studies: ManifestStudy[];
  warnings: string[];
}

export const DOWNSAMPLE_ALGORITHM = "proportional largest-remainder per sample; floor drops whole samples; columns by Knuth algorithm S over mulberry32(fnv1a32(seed|gsm))";

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** Pure planner: no I/O, so it is testable and the endpoint is a thin shell around it. */
export function planManifest(inp: PlanInput): Plan {
  const seed = inp.seed ?? "0";
  const minPer = inp.minCellsPerSample ?? DEFAULT_MIN_CELLS_PER_SAMPLE;
  const files = inp.files?.length ? inp.files : DEFAULT_FILES;
  const sel = inp.selected;
  const warnings: string[] = [];

  let alloc: Allocation | null = null;
  let downsample: Plan["downsample"] = null;
  if (inp.maxCells != null) {
    alloc = allocateCells(sel.map((s) => ({ gsm_id: s.gsm_id, n_cells: s.n_cells })), inp.maxCells, seed, minPer);
    downsample = {
      max_cells: inp.maxCells,
      seed,
      min_cells_per_sample: minPer,
      algorithm: DOWNSAMPLE_ALGORITHM,
      cells_before: alloc.cells_before,
      cells_after: alloc.cells_after,
      samples_before: sel.length,
      samples_after: sel.length - alloc.dropped.length,
      dropped: alloc.dropped.map((i) => ({ gsm_id: sel[i].gsm_id, gse_id: sel[i].gse_id, n_cells: sel[i].n_cells })),
    };
  }
  const droppedSet = new Set(alloc?.dropped ?? []);
  const kept = sel.map((_, i) => i).filter((i) => !droppedSet.has(i));

  const offset = Math.max(0, inp.offset ?? 0);
  const limit = Math.min(MAX_PAGE_SAMPLES, Math.max(1, inp.limit ?? 100));
  const pageIdx = kept.slice(offset, offset + limit);

  const studies: ManifestStudy[] = [];
  let cur: ManifestStudy | null = null;
  for (const i of pageIdx) {
    const s = sel[i];
    if (!cur || cur.gse_id !== s.gse_id) {
      const entries = inp.entries.get(s.gse_id);
      cur = { gse_id: s.gse_id, url: bundleUrl(s.gse_id), indexed: !!entries, samples: [] };
      studies.push(cur);
    }
    const keepN = alloc ? alloc.keep[i] : s.n_cells;
    const subset = keepN < s.n_cells;
    const cols = subset ? selectColumns(s.n_cells, keepN, seed, s.gsm_id) : null;
    const entries = inp.entries.get(s.gse_id) ?? [];
    const prefix = `samples/${s.gsm_id}/`;
    const outFiles: ManifestFile[] = [];
    for (const e of entries) {
      if (!e.p.startsWith(prefix) || !files.includes(basename(e.p))) continue;
      const row = inp.chunks.get(`${s.gsm_id}|${basename(e.p)}`);
      const nameLen = new TextEncoder().encode(e.p).length;
      const stored = e.n === 0;
      if (row && row.n_cols !== s.n_cells && subset) warnings.push(`${s.gsm_id}: chunk map has ${row.n_cols} columns, catalog has ${s.n_cells} cells`);
      outFiles.push({
        path: e.p,
        method: stored ? "stored" : "deflate",
        compressed_bytes: e.c,
        uncompressed_bytes: e.u,
        local_header_offset: e.o,
        data_offset_min: e.o + 30 + nameLen,
        data_offset: e.d ?? null,
        range: e.d != null ? `bytes=${e.d}-${e.d + e.c - 1}` : null,
        chunks: stored && row ? planChunks(row, cols) : null,
      });
    }
    cur.samples.push({
      gsm_id: s.gsm_id,
      n_cells: s.n_cells,
      keep_cells: keepN,
      keep_runs: cols && inp.indices !== false ? toRuns(cols) : null,
      files: outFiles.sort((a, b) => (a.path < b.path ? -1 : 1)),
    });
  }
  const next = offset + limit < kept.length ? offset + limit : null;
  return { downsample, page: { offset, limit, n_samples: kept.length, next_offset: next }, studies, warnings: [...new Set(warnings)].slice(0, 20) };
}

// ── D1 reads ────────────────────────────────────────────────────────────────

/** Entries from the stored bundle_index only: the manifest never triggers a read of a remote zip. */
export async function loadEntries(db: D1Database, gses: string[]): Promise<Map<string, IndexedEntry[]>> {
  const out = new Map<string, IndexedEntry[]>();
  const uniq = [...new Set(gses)];
  for (let i = 0; i < uniq.length; i += 20) {
    const part = uniq.slice(i, i + 20);
    const rs = await db
      .prepare(`SELECT gse_id, entries FROM bundle_index WHERE gse_id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ gse_id: string; entries: string }>()
      .catch(() => ({ results: [] as { gse_id: string; entries: string }[] }));
    for (const r of rs.results ?? []) {
      try {
        out.set(r.gse_id, JSON.parse(r.entries) as IndexedEntry[]);
      } catch {
        /* unreadable row: treated as not indexed */
      }
    }
  }
  return out;
}

/** Chunk maps for the samples on a page. Empty when schema/030_search_facts.sql has not been applied. */
export async function loadChunkRows(db: D1Database, gsms: string[]): Promise<Map<string, ChunkRow>> {
  const out = new Map<string, ChunkRow>();
  for (let i = 0; i < gsms.length; i += 90) {
    const part = gsms.slice(i, i + 90);
    const rs = await db
      .prepare(`SELECT gsm_id, file, n_cols, chunk_cols, chunk_offsets, perm_present FROM pz_chunk_index WHERE gsm_id IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .all<{ gsm_id: string; file: string; n_cols: number; chunk_cols: number; chunk_offsets: string; perm_present: number }>()
      .catch(() => ({ results: [] as never[] }));
    for (const r of rs.results ?? []) {
      try {
        const offsets = JSON.parse(r.chunk_offsets) as number[];
        if (!Array.isArray(offsets) || offsets.length < 2) continue;
        out.set(`${r.gsm_id}|${r.file}`, { gsm_id: r.gsm_id, file: r.file, n_cols: r.n_cols, chunk_cols: r.chunk_cols, chunk_offsets: offsets, perm_present: r.perm_present });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}
