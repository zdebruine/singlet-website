/**
 * What the API and the MCP tools say about v2 objects: member descriptions, byte ranges, chunk plans. Pure functions over the
 * catalog rows (v2-catalog.ts) plus the two small ranged reads a column plan needs (`readPz2Prefix`). Format: docs/format-v2.md
 * sections 3, 4 and 7 in the singlet-bio repository; the header layout is python/singlet/v2/codec.py.
 *
 * Offsets. A member's `off` and `len` in the manifest are ABSOLUTE positions inside the sample object. Inside a pz2 matrix member
 * the header's section table is RELATIVE to the member start, while the manifest's `chunk_index: [off, len]` is absolute. A chunk's
 * bytes are at   member.off + sections.chunks.off + record.off   for   record.len   bytes.
 */
import { isRestrictedMember } from "./restricted";
import type { V2Member, V2SampleFull } from "./v2-catalog";
import { parseMembers, v2ServedStudies } from "./v2-catalog";
import { v2ManifestUrl, v2Url } from "./v2-urls";

export const KIND_NAMES: Record<number, string> = { 1: "pz2 matrix", 2: "cells table", 3: "stored (zstd)", 4: "derived (recipe)", 5: "raw" };
export const CODEC_NAMES: Record<number, string> = { 1: "lane rANS", 2: "generic gaps + zstd" };
export const PZ2_HEADER_BYTES = 256;

export class V2FetchError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "V2FetchError";
  }
}

// ── members ─────────────────────────────────────────────────────────────────

export interface MemberDescription {
  name: string;
  kind: number;
  kind_name: string;
  /** Bytes of the member body inside the sample object (0 for a derived member: nothing is stored). */
  bytes: number;
  /** Absolute range inside the object, null when nothing is stored. */
  range: string | null;
  /** Size of the legacy file this member regenerates, for kinds 3, 4 and 5. */
  legacy_bytes?: number;
  digest?: string;
  // matrices
  rows?: number;
  columns?: number;
  nnz?: number;
  codec?: { id: number; name: string };
  chunk_cols?: number;
  n_chunks?: number;
  names?: unknown;
  // derived
  recipe?: string;
  params?: unknown;
  needs?: unknown;
  // cells
  cells_columns?: unknown;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function describeMember(name: string, m: V2Member): MemberDescription {
  const len = Number(m.len) || 0;
  const off = Number(m.off) || 0;
  const d: MemberDescription = {
    name,
    kind: m.kind,
    kind_name: KIND_NAMES[m.kind] ?? `kind ${m.kind}`,
    bytes: len,
    range: len > 0 ? `bytes=${off}-${off + len - 1}` : null,
  };
  if (typeof m.digest === "string") d.digest = m.digest;
  if (m.kind === 1) {
    d.rows = num(m.m);
    d.columns = num(m.n);
    d.nnz = num(m.nnz);
    const codec = num(m.codec);
    if (codec !== undefined) d.codec = { id: codec, name: CODEC_NAMES[codec] ?? `codec ${codec}` };
    d.chunk_cols = num(m.chunk_cols);
    d.n_chunks = num(m.n_chunks);
    if (m.names !== undefined) d.names = m.names;
  } else if (m.kind === 2) {
    d.columns = num(m.n_rows);
    if (m.columns !== undefined) d.cells_columns = m.columns;
  } else {
    d.legacy_bytes = num(m.out_len);
    if (m.kind === 4) {
      d.recipe = typeof m.recipe === "string" ? m.recipe : undefined;
      d.params = m.params;
      d.needs = m.needs;
    }
  }
  return d;
}

/** Public members of a sample, described, in name order. */
export function describeMembers(sample: Pick<V2SampleFull, "members_json">): MemberDescription[] {
  const members = parseMembers(sample.members_json);
  return Object.keys(members)
    .filter((n) => !isRestrictedMember(n))
    .sort()
    .map((n) => describeMember(n, members[n]));
}

/** Find a member by the name a caller gave: the exact name, or the name without a directory part. */
export function findMember(members: Record<string, V2Member>, file: string): string | null {
  const names = Object.keys(members).filter((n) => !isRestrictedMember(n));
  return names.find((n) => n === file) ?? names.find((n) => n.endsWith(`/${file}`)) ?? null;
}

export function sampleObjectUrl(key: string): string {
  return v2Url(key);
}

// ── ranged reads ────────────────────────────────────────────────────────────

/** Read `length` bytes at `offset` of an object; only a 206 counts (a 200 would be the whole object). */
export async function fetchObjectRange(url: string, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);
  const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
  if (res.status !== 206) {
    await res.body?.cancel().catch(() => undefined);
    throw new V2FetchError(`Range ${res.status} for ${url}`, res.status);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length !== length) throw new V2FetchError(`Range for ${url} returned ${buf.length} bytes, wanted ${length}`, 206);
  return buf;
}

// ── pz2 header and chunk index ──────────────────────────────────────────────

export const SECTION_NAMES = ["rows", "cols", "kv", "tables", "chunk_index", "chunks", "extra"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

export interface Pz2Header {
  version: number;
  codec: number;
  m: number;
  n: number;
  nnz: number;
  valueType: number;
  rowOrder: number;
  flags: number;
  chunkCols: number;
  nChunks: number;
  rowNames: string;
  colNames: string;
  digest: string;
  /** [offset, length] of each section, relative to the member start. */
  sections: Record<SectionName, [number, number]>;
  totalLen: number;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function u64(dv: DataView, p: number): number {
  const hi = dv.getUint32(p + 4, true);
  if (hi >= 0x200000) throw new V2FetchError("a 64-bit field in a pz2 header is out of range");
  return hi * 4294967296 + dv.getUint32(p, true);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * The 256-byte header of a pz2 matrix member (include/singlet/pz2/detail/container.h, python/singlet/v2/codec.py):
 *   0 "PZ2M" | 4 version u16 | 6 codec u16 | 8 m u32 | 12 n u32 | 16 nnz u64 | 24 value_type | 25 row_order | 26 classes_per_octave |
 *   27 flags | 28 chunk_cols u32 | 32 n_chunks u32 | 36 lanes | 37 prob_bits | 38 value_prob_bits | 39 ctx_kind | 40 row_names_id[8] |
 *   48 col_names_id[8] | 56 digest[16] | 72 seven (off u64, len u64) sections | 184 total_len u64 | 192 rows_kind | 193 cols_kind |
 *   252 crc32 of bytes 0..251.
 */
export function parsePz2Header(buf: Uint8Array): Pz2Header {
  if (buf.length < PZ2_HEADER_BYTES) throw new V2FetchError("pz2 header is shorter than 256 bytes");
  if (buf[0] !== 0x50 || buf[1] !== 0x5a || buf[2] !== 0x32 || buf[3] !== 0x4d) throw new V2FetchError("not a pz2 matrix (bad magic)");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(252, true) !== crc32(buf.subarray(0, 252))) throw new V2FetchError("pz2 header fails its CRC-32");
  const sections = {} as Record<SectionName, [number, number]>;
  SECTION_NAMES.forEach((name, i) => {
    sections[name] = [u64(dv, 72 + 16 * i), u64(dv, 80 + 16 * i)];
  });
  return {
    version: dv.getUint16(4, true),
    codec: dv.getUint16(6, true),
    m: dv.getUint32(8, true),
    n: dv.getUint32(12, true),
    nnz: u64(dv, 16),
    valueType: buf[24],
    rowOrder: buf[25],
    flags: buf[27],
    chunkCols: dv.getUint32(28, true),
    nChunks: dv.getUint32(32, true),
    rowNames: hex(buf.subarray(40, 48)),
    colNames: hex(buf.subarray(48, 56)),
    digest: hex(buf.subarray(56, 72)),
    sections,
    totalLen: u64(dv, 184),
  };
}

export interface ChunkIndex {
  /** n_chunks + 1 entries; the last is the sentinel (off = chunks section length, first = n). */
  off: number[];
  len: number[];
  first: number[];
  nnzBefore: number[];
}

export const CHUNK_RECORD_BYTES = 24;

/** `n_chunks + 1` records {u64 off, u32 len, u32 first_col, u64 nnz_before}. */
export function parseChunkIndex(buf: Uint8Array, nChunks: number): ChunkIndex {
  if (buf.length !== CHUNK_RECORD_BYTES * (nChunks + 1)) throw new V2FetchError("chunk index has the wrong length");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const idx: ChunkIndex = { off: [], len: [], first: [], nnzBefore: [] };
  for (let c = 0; c <= nChunks; c++) {
    const p = c * CHUNK_RECORD_BYTES;
    idx.off.push(u64(dv, p));
    idx.len.push(dv.getUint32(p + 8, true));
    idx.first.push(dv.getUint32(p + 12, true));
    idx.nnzBefore.push(u64(dv, p + 16));
  }
  return idx;
}

/** Header and chunk index of a pz2 member with the fewest requests: one when the index sits right behind the header (it does in files written so far, at offset 256). */
export async function readPz2Prefix(url: string, member: V2Member): Promise<{ header: Pz2Header; index: ChunkIndex; requests: number }> {
  const off = member.off;
  const ci = Array.isArray(member.chunk_index) ? member.chunk_index : null;
  if (!ci || !Number.isInteger(ci[0]) || !Number.isInteger(ci[1])) throw new V2FetchError("the manifest has no chunk_index for this member");
  const idxStart = ci[0];
  const idxEnd = ci[0] + ci[1];
  if (idxStart < off || idxEnd > off + member.len) throw new V2FetchError("chunk_index lies outside the member");
  let requests = 0;
  let headBuf: Uint8Array;
  let idxBuf: Uint8Array;
  if (idxStart - (off + PZ2_HEADER_BYTES) <= 4096) {
    const span = await fetchObjectRange(url, off, idxEnd - off);
    requests = 1;
    headBuf = span.subarray(0, PZ2_HEADER_BYTES);
    idxBuf = span.subarray(idxStart - off);
  } else {
    [headBuf, idxBuf] = await Promise.all([fetchObjectRange(url, off, PZ2_HEADER_BYTES), fetchObjectRange(url, idxStart, ci[1])]);
    requests = 2;
  }
  const header = parsePz2Header(headBuf);
  const chunkIndexAt = off + header.sections.chunk_index[0];
  if (chunkIndexAt !== idxStart || header.sections.chunk_index[1] !== ci[1]) {
    throw new V2FetchError("the member header and the manifest disagree about the chunk index");
  }
  if (header.nChunks !== (member.n_chunks ?? header.nChunks)) throw new V2FetchError("the member header and the manifest disagree about n_chunks");
  if (header.totalLen !== member.len) throw new V2FetchError("the member header and the manifest disagree about the member length");
  return { header, index: parseChunkIndex(idxBuf, header.nChunks), requests };
}

// ── column selection -> byte ranges ─────────────────────────────────────────

export interface ColumnSelection {
  /** Ascending, merged [start, length) runs of matrix columns; null = every column. */
  runs: [number, number][] | null;
}

/** Normalise `runs` (pairs), `indices` or `range` into ascending merged runs inside [0, n). Returns an error string for bad input. */
export function selectColumns(
  input: { runs?: unknown; indices?: unknown; range?: unknown },
  n: number,
  limits = { maxRuns: 2000, maxIndices: 50_000 }
): ColumnSelection | { error: string } {
  const raw: [number, number][] = [];
  const add = (start: unknown, len: unknown): string | null => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(len) || (start as number) < 0 || (len as number) < 1) return "column runs are [start, length] pairs of non-negative integers, length at least 1";
    if ((start as number) + (len as number) > n) return `column run ${start}+${len} is outside the matrix (${n} columns)`;
    raw.push([start as number, len as number]);
    return null;
  };
  const given = [input.runs, input.indices, input.range].filter((v) => v !== undefined && v !== null).length;
  if (given === 0) return { runs: null };
  if (given > 1) return { error: "Give one of runs, indices or range." };
  if (input.runs !== undefined && input.runs !== null) {
    if (!Array.isArray(input.runs) || input.runs.length > limits.maxRuns) return { error: `runs must be an array of at most ${limits.maxRuns} [start, length] pairs` };
    // Accept [[s,l],...] and the flat [s,l,s,l,...] that find_cells reports internally.
    const flat = input.runs.length > 0 && !Array.isArray(input.runs[0]);
    if (flat) {
      if (input.runs.length % 2) return { error: "a flat runs array needs an even number of values" };
      for (let i = 0; i < input.runs.length; i += 2) {
        const e = add(input.runs[i], input.runs[i + 1]);
        if (e) return { error: e };
      }
    } else {
      for (const r of input.runs as unknown[]) {
        if (!Array.isArray(r) || r.length !== 2) return { error: "runs must be [start, length] pairs" };
        const e = add(r[0], r[1]);
        if (e) return { error: e };
      }
    }
  } else if (input.indices !== undefined && input.indices !== null) {
    if (!Array.isArray(input.indices) || input.indices.length > limits.maxIndices) return { error: `indices must be an array of at most ${limits.maxIndices} column numbers` };
    for (const v of input.indices) {
      if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) >= n) return { error: `column index ${String(v)} is outside the matrix (${n} columns)` };
      raw.push([v as number, 1]);
    }
  } else {
    const r = input.range;
    if (!Array.isArray(r) || r.length !== 2) return { error: "range is [start, end) column numbers" };
    if (!Number.isSafeInteger(r[0]) || !Number.isSafeInteger(r[1]) || r[0] < 0 || r[1] <= r[0] || r[1] > n) return { error: `range must satisfy 0 <= start < end <= ${n}` };
    raw.push([r[0], r[1] - r[0]]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, l] of raw) {
    const last = merged[merged.length - 1];
    if (last && s <= last[0] + last[1]) last[1] = Math.max(last[1], s + l - last[0]);
    else merged.push([s, l]);
  }
  return { runs: merged };
}

export interface ChunkRange {
  first_chunk: number;
  last_chunk: number;
  /** Matrix columns covered by these chunks: [first_col, end_col). */
  first_col: number;
  end_col: number;
  range: string;
  start: number;
  end: number;
  bytes: number;
}

export interface SlicePlan {
  /** Ranges to fetch once per matrix to be able to decode any chunk: header, chunk index, tables, kv and the row section. */
  prefix: { sections: string[]; range: string; start: number; end: number; bytes: number }[];
  chunks: ChunkRange[];
  n_chunks_total: number;
  n_chunks_needed: number;
  columns_wanted: number;
  columns_covered: number;
  bytes_prefix: number;
  bytes_chunks: number;
  bytes_member: number;
  /** Columns fetched divided by columns wanted. */
  overread_ratio: number;
  /** True when adjacent runs were joined to stay within `maxRanges`. */
  merged: boolean;
}

/** The chunk (index) containing column `col`, by binary search over first_col. */
function chunkOf(first: number[], nChunks: number, col: number): number {
  let lo = 0;
  let hi = nChunks - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (first[mid] <= col) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function planSlice(member: V2Member, header: Pz2Header, index: ChunkIndex, sel: ColumnSelection, opts: { maxRanges?: number } = {}): SlicePlan {
  const maxRanges = Math.max(1, opts.maxRanges ?? 64);
  const base = member.off;
  const nChunks = header.nChunks;
  const chunksAt = base + header.sections.chunks[0];

  // chunks needed, as ascending [first, last] chunk runs
  let runs: [number, number][];
  let wanted: number;
  if (sel.runs === null) {
    runs = nChunks ? [[0, nChunks - 1]] : [];
    wanted = header.n;
  } else {
    runs = [];
    wanted = 0;
    for (const [s, l] of sel.runs) {
      wanted += l;
      const c0 = chunkOf(index.first, nChunks, s);
      const c1 = chunkOf(index.first, nChunks, s + l - 1);
      const last = runs[runs.length - 1];
      if (last && c0 <= last[1] + 1) last[1] = Math.max(last[1], c1);
      else runs.push([c0, c1]);
    }
  }
  // stay within maxRanges by joining the neighbours with the smallest byte gap
  let merged = false;
  const byteStart = (c: number) => index.off[c];
  const byteEnd = (c: number) => index.off[c] + index.len[c];
  while (runs.length > maxRanges) {
    let best = 1;
    let gap = Infinity;
    for (let i = 1; i < runs.length; i++) {
      const g = byteStart(runs[i][0]) - byteEnd(runs[i - 1][1]);
      if (g < gap) {
        gap = g;
        best = i;
      }
    }
    runs[best - 1][1] = runs[best][1];
    runs.splice(best, 1);
    merged = true;
  }

  const chunks: ChunkRange[] = runs.map(([c0, c1]) => {
    const startAbs = chunksAt + byteStart(c0);
    const endAbs = chunksAt + byteEnd(c1) - 1;
    return {
      first_chunk: c0,
      last_chunk: c1,
      first_col: index.first[c0],
      end_col: index.first[c1 + 1],
      range: `bytes=${startAbs}-${endAbs}`,
      start: startAbs,
      end: endAbs,
      bytes: endAbs - startAbs + 1,
    };
  });

  // prefix: what a decoder needs to open the member (python/singlet/v2/codec.py prefix_len): the header, the chunk index, the tables
  // and the row section. Not `cols` or `kv` (names and key/values), not `extra`. In files written so far these are contiguous.
  const pieces: { name: string; start: number; end: number }[] = [{ name: "header", start: base, end: base + PZ2_HEADER_BYTES }];
  for (const name of ["chunk_index", "tables", "rows"] as const) {
    const [o, l] = header.sections[name];
    if (l > 0) pieces.push({ name, start: base + o, end: base + o + l });
  }
  pieces.sort((a, b) => a.start - b.start);
  const prefix: SlicePlan["prefix"] = [];
  let cur: { names: string[]; start: number; end: number } | null = null;
  for (const p of pieces) {
    if (cur && p.start - cur.end <= 4096) {
      cur.names.push(p.name);
      cur.end = Math.max(cur.end, p.end);
    } else {
      if (cur) prefix.push({ sections: cur.names, range: `bytes=${cur.start}-${cur.end - 1}`, start: cur.start, end: cur.end - 1, bytes: cur.end - cur.start });
      cur = { names: [p.name], start: p.start, end: p.end };
    }
  }
  if (cur) prefix.push({ sections: cur.names, range: `bytes=${cur.start}-${cur.end - 1}`, start: cur.start, end: cur.end - 1, bytes: cur.end - cur.start });

  const bytesPrefix = prefix.reduce((n, p) => n + p.bytes, 0);
  const bytesChunks = chunks.reduce((n, c) => n + c.bytes, 0);
  const covered = chunks.reduce((n, c) => n + (c.end_col - c.first_col), 0);
  return {
    prefix,
    chunks,
    n_chunks_total: nChunks,
    n_chunks_needed: runs.reduce((n, [a, b]) => n + (b - a + 1), 0),
    columns_wanted: wanted,
    columns_covered: covered,
    bytes_prefix: bytesPrefix,
    bytes_chunks: bytesChunks,
    bytes_member: member.len,
    overread_ratio: wanted ? Math.round((covered / wanted) * 100) / 100 : 0,
    merged,
  };
}

// ── what a catalog row needs to know about v2 ───────────────────────────────

export interface V2Facts {
  rev: string;
  manifest_url: string;
  bytes: number | null;
  n_samples: number;
  /** The legacy single-file bundle still exists (the migration is not retired). */
  legacy_alive: boolean;
}

/** Which of these studies are served from v2, with the facts a manifest row needs (two reads per 90 studies). */
export async function v2Facts(db: D1Database, gses: string[]): Promise<Map<string, V2Facts>> {
  const out = new Map<string, V2Facts>();
  for (const [gse, st] of await v2ServedStudies(db, gses)) {
    out.set(gse, { rev: st.study.rev, manifest_url: v2ManifestUrl(gse), bytes: st.study.bytes, n_samples: st.study.n_samples, legacy_alive: st.migration?.status !== "retired" });
  }
  return out;
}
