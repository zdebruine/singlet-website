/**
 * Read side of pz2 matrix members (Singlet-Bio/singlet `include/singlet/pz2/`, docs/format-s1.md sections 4 and 5), for decoding cells
 * inside a Worker: a port of the scalar reference decoder of codec 1 (lane rANS, `detail/rans1_dec.h`) and of codec 2 (LEB128 + zstd,
 * `detail/codec2.h`), with the container (header, chunk index, tables, row order) of `detail/container.h` and `detail/api.h`.
 *
 * Research Alpha's members are codec 1. A member is opened from its prefix (header, chunk index, tables, row keys: the `prefix` bytes of a
 * gather plan) and decodes one chunk at a time from the chunk's bytes, so a caller holding the runs of a gather never needs the whole
 * member. Decoded row ids are canonical (row_order 1 is undone through the row keys) and ascending within each column, as
 * `Matrix::decode(mode = Canonical)` returns them. Values are the coded u32 numbers (counts); F32 members are refused.
 *
 * No Node APIs: `fzstd` for the zstd side streams.
 */
import { decompress } from "fzstd";

export class Pz2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Pz2Error";
  }
}

export const HEADER_BYTES = 256;
const REC_BYTES = 24;
const S_ROWS = 0;
const S_TABLES = 3;
const S_CHUNK_INDEX = 4;
const S_CHUNKS = 5;
export const NK_INLINE = 0;
export const NK_PACK = 1;
export const NK_SUBSET = 2;
export const NK_CELLS = 3;
export const NK_NONE = 4;

// ── bytes ───────────────────────────────────────────────────────────────────

const ld16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const ld32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ld64 = (b: Uint8Array, o: number) => ld32(b, o) + ld32(b, o + 4) * 2 ** 32;

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(p: Uint8Array, crc = 0): number {
  crc = ~crc >>> 0;
  for (let i = 0; i < p.length; i++) crc = CRC_TAB[(crc ^ p[i]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}

/** A bounds-checked LEB128 reader. Values above 2^53 are refused (none of the format's fields come near). */
class Leb {
  readonly b: Uint8Array;
  p: number;
  readonly end: number;
  constructor(b: Uint8Array, p: number, end: number) {
    this.b = b;
    this.p = p;
    this.end = end;
  }
  get(): number {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (this.p >= this.end) throw new Pz2Error("LEB128 runs past the end of its stream");
      const x = this.b[this.p++];
      v += (x & 127) * mul;
      if (!(x & 128)) return v;
      mul *= 128;
      if (mul > 2 ** 49) throw new Pz2Error("LEB128 too long");
    }
  }
}

/** `u32 raw_len, u32 zstd_len, zstd frame` starting at p; returns the raw bytes and the offset after the stream. */
function getStream(b: Uint8Array, p: number, end: number, maxRaw: number): [Uint8Array, number] {
  if (end - p < 8) throw new Pz2Error("truncated stream header");
  const n = ld32(b, p);
  const zn = ld32(b, p + 4);
  p += 8;
  if (zn > end - p) throw new Pz2Error("truncated stream body");
  if (n > maxRaw) throw new Pz2Error("stream raw length exceeds bound");
  if ((n === 0) !== (zn === 0)) throw new Pz2Error("stream length fields inconsistent");
  if (!n) return [new Uint8Array(0), p];
  let raw: Uint8Array;
  try {
    raw = decompress(b.subarray(p, p + zn), new Uint8Array(n));
  } catch (e) {
    throw new Pz2Error(`zstd: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (raw.length !== n) throw new Pz2Error("zstd frame decodes to the wrong length");
  return [raw, p + zn];
}

const ilog2 = (x: number) => 31 - Math.clz32(x | 1);

// ── header and chunk index ──────────────────────────────────────────────────

export interface Header {
  codec: number;
  m: number;
  n: number;
  nnz: number;
  valueType: number;
  rowOrder: number;
  flags: number;
  nChunks: number;
  lanes: number;
  probBits: number;
  valueProbBits: number;
  ctxKind: number;
  rowNamesId: string;
  digest: string;
  section: { off: number; len: number }[];
  totalLen: number;
  rowsKind: number;
  colsKind: number;
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function readHeader(p: Uint8Array): Header {
  if (p.length < HEADER_BYTES) throw new Pz2Error("header needs 256 bytes");
  if (p[0] !== 0x50 || p[1] !== 0x5a || p[2] !== 0x32 || p[3] !== 0x4d) throw new Pz2Error("bad magic (not a pz2 member)");
  if (ld16(p, 4) !== 1) throw new Pz2Error(`unsupported pz2 version ${ld16(p, 4)}`);
  if (ld32(p, 252) !== crc32(p.subarray(0, 252))) throw new Pz2Error("header CRC mismatch");
  const codec = ld16(p, 6);
  if (codec !== 1 && codec !== 2) throw new Pz2Error(`unknown codec ${codec}`);
  if (p[24] < 1 || p[24] > 4) throw new Pz2Error("bad value_type");
  const section = Array.from({ length: 7 }, (_, s) => ({ off: ld64(p, 72 + 16 * s), len: ld64(p, 80 + 16 * s) }));
  const h: Header = {
    codec,
    m: ld32(p, 8),
    n: ld32(p, 12),
    nnz: ld64(p, 16),
    valueType: p[24],
    rowOrder: p[25],
    flags: p[27],
    nChunks: ld32(p, 32),
    lanes: p[36],
    probBits: p[37],
    valueProbBits: p[38],
    ctxKind: p[39],
    rowNamesId: hex(p.subarray(40, 48)),
    digest: hex(p.subarray(56, 72)),
    section,
    totalLen: ld64(p, 184),
    rowsKind: p[192],
    colsKind: p[193],
  };
  if (h.rowsKind > 4 || h.colsKind > 4 || h.rowsKind === NK_CELLS) throw new Pz2Error("bad names kind");
  for (const r of section) if (r.len && (r.off < HEADER_BYTES || r.off > h.totalLen || r.len > h.totalLen - r.off)) throw new Pz2Error("section outside the member");
  if (section[S_CHUNK_INDEX].len !== (h.nChunks + 1) * REC_BYTES) throw new Pz2Error("chunk index length does not match n_chunks");
  if (codec === 1 && h.m >= 1 << 21) throw new Pz2Error("codec 1 member with m >= 2^21");
  return h;
}

export interface ChunkIndex {
  off: Float64Array;
  len: Uint32Array;
  first: Uint32Array;
  nnzBefore: Float64Array;
}

function readChunkIndex(h: Header, b: Uint8Array): ChunkIndex {
  const n = h.nChunks + 1;
  const ix: ChunkIndex = { off: new Float64Array(n), len: new Uint32Array(n), first: new Uint32Array(n), nnzBefore: new Float64Array(n) };
  const base = h.section[S_CHUNK_INDEX].off;
  if (b.length < base + n * REC_BYTES) throw new Pz2Error("chunk index truncated");
  for (let c = 0; c < n; c++) {
    const q = base + c * REC_BYTES;
    ix.off[c] = ld64(b, q);
    ix.len[c] = ld32(b, q + 8);
    ix.first[c] = ld32(b, q + 12);
    ix.nnzBefore[c] = ld64(b, q + 16);
  }
  for (let c = 0; c < h.nChunks; c++) {
    if (ix.first[c + 1] <= ix.first[c] || ix.nnzBefore[c + 1] < ix.nnzBefore[c] || ix.off[c + 1] !== ix.off[c] + ix.len[c]) throw new Pz2Error("chunk index not monotone");
  }
  const s = h.nChunks;
  if (ix.first[0] !== 0 || ix.off[0] !== 0 || ix.nnzBefore[0] !== 0) throw new Pz2Error("chunk index must start at 0");
  if (ix.first[s] !== h.n || ix.nnzBefore[s] !== h.nnz || ix.off[s] !== h.section[S_CHUNKS].len || ix.len[s] !== 0) throw new Pz2Error("chunk index sentinel mismatch");
  return ix;
}

// ── codec 1 tables (detail/rans1.h) ─────────────────────────────────────────

const K_L = 1 << 16;
const NUM_CLS = 124;
const CLS_PAD = 128;
const ALPHA = 2 * NUM_CLS;
const RES_POS = 21;
const RES_CTX = RES_POS * 4;
const MAX_CHUNK_N = 2 ** 28;

const CLS_BASE = new Uint32Array(CLS_PAD);
const CLS_NB = new Uint8Array(CLS_PAD);
for (let c = 0; c < CLS_PAD; c++) {
  const e = c >>> 2;
  const mm = c & 3;
  const n = e > 1 ? e - 1 : 0;
  CLS_BASE[c] = ((mm | (e ? 4 : 0)) << n) >>> 0;
  CLS_NB[c] = n;
}

interface Cfg {
  pb: number;
  pbv: number;
  sh: number;
  cap: number;
  ks: number;
  kcap: number;
  nk: number;
}

function makeCfg(kind: number, pb: number, pbv: number): Cfg {
  const t = [
    [0, 39, 0, 11],
    [0, 39, 1, 5],
    [1, 19, 1, 5],
    [0, 39, 0, 0],
    [1, 19, 0, 0],
  ][Math.min(kind, 4)];
  return { pb, pbv, sh: t[0], cap: t[1], ks: t[2], kcap: t[3], nk: t[3] + 1 };
}
const npc = (c: Cfg) => c.cap + 1;
const kbase = (c: Cfg, k: number) => {
  let kr = ilog2(k + 1) >>> c.ks;
  if (kr > c.kcap) kr = c.kcap;
  return (kr * npc(c)) << c.pb;
};
const posb = (p: number) => {
  const q = (p + 2) >>> 0;
  const lg = ilog2(q);
  return 2 * lg + ((q >>> (lg - 1)) & 1) - 2;
};
const dkOf = (kraw: number) => {
  const d = (kraw * 11) >>> 5;
  return d < 3 ? d : 3;
};

/** [(ctx << pb) | slot] -> sym << 24 | freq << 12 | bias (detail/rans1.h parse_tables). */
function parseTables(b: Uint8Array, p: number, end: number, pb: number, nctx: number, A: number): [Uint32Array, number] {
  const tab = new Uint32Array(nctx * (1 << pb) + 64);
  const [raw, after] = getStream(b, p, end, 2 ** 28);
  const q = new Leb(raw, 0, raw.length);
  const nused = q.get();
  if (nused > nctx) throw new Pz2Error("table: too many contexts");
  let ctx = 0;
  for (let u = 0; u < nused; u++) {
    const dc = q.get();
    if (u > 0 && dc === 0) throw new Pz2Error("table: context order");
    ctx += dc;
    if (ctx >= nctx) throw new Pz2Error("table: context out of range");
    const ns = q.get();
    if (ns === 0 || ns > A) throw new Pz2Error("table: symbol count");
    let sym = 0;
    let cu = 0;
    const base = ctx * (1 << pb);
    for (let i = 0; i < ns; i++) {
      const ds = q.get();
      if (i > 0 && ds === 0) throw new Pz2Error("table: symbol order");
      sym += ds;
      const f = q.get();
      if (sym >= A || f === 0 || f > (1 << pb) - 1 || cu + f > 1 << pb) throw new Pz2Error("table: bad symbol/frequency");
      for (let s = 0; s < f; s++) tab[base + cu + s] = ((sym << 24) | (f << 12) | s) >>> 0;
      cu += f;
    }
    if (cu !== 1 << pb) throw new Pz2Error("table: frequencies do not sum to 2^pb");
  }
  return [tab, after];
}

/** perm[stored id] = canonical id: key descending, canonical id ascending inside a key (detail/rans1.h perm_from_keys). */
function permFromKeys(key: Uint32Array): Uint32Array {
  const m = key.length;
  const perm = new Uint32Array(m);
  let mx = 0;
  for (let i = 0; i < m; i++) if (key[i] > mx) mx = key[i];
  if (mx <= 4 * m + 4096) {
    const start = new Uint32Array(mx + 2);
    for (let i = 0; i < m; i++) start[key[i]]++;
    let pos = 0;
    for (let b = mx; b >= 0; b--) {
      const c = start[b];
      start[b] = pos;
      pos += c;
    }
    for (let i = 0; i < m; i++) perm[start[key[i]]++] = i;
  } else {
    const ids = Array.from({ length: m }, (_, i) => i).sort((a, b) => key[b] - key[a] || a - b);
    perm.set(ids);
  }
  return perm;
}

// ── a decoded chunk ─────────────────────────────────────────────────────────

/** One chunk in canonical CSC form: columns [first, first + counts.length), ids ascending within each column. */
export interface Chunk {
  first: number;
  /** non-zeros per column */
  counts: Uint32Array;
  /** column starts into idx/val (counts.length + 1 entries) */
  colptr: Uint32Array;
  idx: Uint32Array;
  val: Uint32Array;
}

/**
 * A pz2 member opened from its prefix (the bytes from the member start up to its chunks section, or more). `chunkBytes(c)` gives the bytes
 * of chunk c from wherever the caller keeps them (a gather run, the whole member).
 */
export class Member {
  readonly h: Header;
  readonly ix: ChunkIndex;
  private perm: Uint32Array | null = null;
  private cfg: Cfg | null = null;
  private tCnt: Uint32Array | null = null;
  private tGap: Uint32Array | null = null;
  private tRes: Uint32Array | null = null;

  constructor(prefix: Uint8Array) {
    this.h = readHeader(prefix);
    const h = this.h;
    if (h.valueType === 4) throw new Pz2Error("f32 members are not decoded here");
    this.ix = readChunkIndex(h, prefix);
    if (h.codec === 1) {
      if (h.rowOrder !== 1) throw new Pz2Error("codec 1 requires row_order 1");
      if (h.lanes !== 16 && h.lanes !== 32 && h.lanes !== 64) throw new Pz2Error("bad lane count");
      if (h.probBits < 8 || h.probBits > 12 || h.valueProbBits < 8 || h.valueProbBits > 12) throw new Pz2Error("bad probability bits");
      if (h.ctxKind > 4) throw new Pz2Error("bad context kind");
      const cfg = makeCfg(h.ctxKind, h.probBits, h.valueProbBits);
      this.cfg = cfg;
      const tb = h.section[S_TABLES];
      if (prefix.length < tb.off + tb.len) throw new Pz2Error("prefix does not hold the tables");
      let p = tb.off;
      const end = tb.off + tb.len;
      [this.tCnt, p] = parseTables(prefix, p, end, 12, 1, NUM_CLS);
      [this.tGap, p] = parseTables(prefix, p, end, cfg.pb, npc(cfg) * cfg.nk, ALPHA);
      [this.tRes, p] = parseTables(prefix, p, end, cfg.pbv, RES_CTX, NUM_CLS);
      const rw = h.section[S_ROWS];
      if (prefix.length < rw.off + rw.len) throw new Pz2Error("prefix does not hold the row keys");
      const [raw] = getStream(prefix, rw.off, rw.off + rw.len, h.m * 5 + 16);
      const q = new Leb(raw, 0, raw.length);
      const key = new Uint32Array(h.m);
      for (let i = 0; i < h.m; i++) {
        const v = q.get();
        if (v > 0xffffffff) throw new Pz2Error("row key overflow");
        key[i] = v;
      }
      if (q.p !== raw.length) throw new Pz2Error("rows: trailing bytes");
      this.perm = permFromKeys(key);
    } else if (h.rowOrder !== 0) throw new Pz2Error("codec 2 requires row_order 0");
  }

  /** Offset of the chunks section from the member start. */
  get chunksAt(): number {
    return this.h.section[S_CHUNKS].off;
  }

  /** The chunk holding column `col`. */
  chunkOf(col: number): number {
    const f = this.ix.first;
    let a = 0;
    let b = this.h.nChunks - 1;
    while (a < b) {
      const m = (a + b + 1) >>> 1;
      if (f[m] <= col) a = m;
      else b = m - 1;
    }
    return a;
  }

  /** Byte range of chunk c relative to the member start. */
  chunkRange(c: number): [number, number] {
    return [this.chunksAt + this.ix.off[c], this.ix.len[c]];
  }

  /** stored row id -> canonical row id (codec 1), or null when stored ids are canonical (codec 2). */
  get rowPerm(): Uint32Array | null {
    return this.perm;
  }

  /**
   * Decode chunk c. `canonical` (the default) maps row ids to canonical ids and sorts each column; with false, codec 1 ids stay in
   * stored space (map them through `rowPerm`), which skips the per-column sort when the caller does not need the order.
   */
  decodeChunk(c: number, blob: Uint8Array, canonical = true): Chunk {
    const nc = this.ix.first[c + 1] - this.ix.first[c];
    const N = this.ix.nnzBefore[c + 1] - this.ix.nnzBefore[c];
    if (blob.length < this.ix.len[c]) throw new Pz2Error(`chunk ${c} truncated`);
    blob = blob.subarray(0, this.ix.len[c]);
    const out = this.h.codec === 1 ? this.decode1(blob, nc, N, canonical) : this.decode2(blob, nc, N);
    out.first = this.ix.first[c];
    return out;
  }

  // codec 2 (detail/codec2.h decode_chunk): ids are already canonical
  private decode2(blob: Uint8Array, nc: number, N: number): Chunk {
    let p = 0;
    const end = blob.length;
    let raw: Uint8Array;
    [raw, p] = getStream(blob, p, end, nc * 5 + 8);
    const qc = new Leb(raw, 0, raw.length);
    const counts = new Uint32Array(nc);
    let tot = 0;
    for (let j = 0; j < nc; j++) {
      counts[j] = qc.get();
      tot += counts[j];
    }
    if (qc.p !== raw.length) throw new Pz2Error("codec2: trailing bytes in counts");
    if (tot !== N) throw new Pz2Error("codec2: counts disagree with the chunk index");
    let gap: Uint8Array;
    let vals: Uint8Array;
    [gap, p] = getStream(blob, p, end, N * 5 + 8);
    [vals, p] = getStream(blob, p, end, N * 5 + 8);
    const g = new Leb(gap, 0, gap.length);
    const v = new Leb(vals, 0, vals.length);
    const idx = new Uint32Array(N);
    const val = new Uint32Array(N);
    const colptr = new Uint32Array(nc + 1);
    let o = 0;
    for (let j = 0; j < nc; j++) {
      let prev = -1;
      for (let t = 0; t < counts[j]; t++, o++) {
        const id = prev + 1 + g.get();
        if (id >= this.h.m) throw new Pz2Error("codec2: row id out of range");
        idx[o] = id;
        prev = id;
        const x = v.get();
        if (x > 0xffffffff) throw new Pz2Error("codec2: value overflow");
        val[o] = x;
      }
      colptr[j + 1] = o;
    }
    if (g.p !== gap.length || v.p !== vals.length) throw new Pz2Error("codec2: trailing bytes");
    return { first: 0, counts, colptr, idx, val };
  }

  // codec 1: chunk_counts + setup_chunk + decode_chunk_scalar (detail/rans1_dec.h), then canonicalize (detail/api.h)
  private decode1(blob: Uint8Array, nc: number, N: number, canonical: boolean): Chunk {
    const cfg = this.cfg!;
    const L = this.h.lanes;
    const bytes = blob.length;
    // column counts
    const hq = new Leb(blob, 0, bytes);
    const nwc = hq.get();
    const nw = hq.get();
    if (nwc > bytes || nw > bytes) throw new Pz2Error("chunk: word counts exceed the chunk");
    let q = hq.p;
    if (bytes - q < 4 + 2 * nwc) throw new Pz2Error("chunk: truncated count stream");
    const ct = this.tCnt!;
    const counts = new Uint32Array(nc);
    let x = ld32(blob, q);
    let wp = q + 4;
    const wend = q + 4 + 2 * nwc;
    const under = () => {
      throw new Pz2Error("chunk: count stream underrun");
    };
    for (let j = 0; j < nc; j++) {
      const e = ct[x & 4095];
      x = (((e >>> 12) & 0xfff) * (x >>> 12) + (e & 0xfff)) >>> 0;
      if (x < K_L) {
        if (wp >= wend) under();
        x = ((x << 16) | ld16(blob, wp)) >>> 0;
        wp += 2;
      }
      const c = e >>> 24;
      const nb = CLS_NB[c];
      const lo = nb < 16 ? nb : 16;
      let ex = x & ((1 << lo) - 1);
      x >>>= lo;
      if (x < K_L) {
        if (wp >= wend) under();
        x = ((x << 16) | ld16(blob, wp)) >>> 0;
        wp += 2;
      }
      if (nb > 16) {
        const hi = nb - 16;
        ex = (ex | ((x & ((1 << hi) - 1)) << 16)) >>> 0;
        x >>>= hi;
        if (x < K_L) {
          if (wp >= wend) under();
          x = ((x << 16) | ld16(blob, wp)) >>> 0;
          wp += 2;
        }
      }
      counts[j] = CLS_BASE[c] + ex;
    }
    if (x !== K_L || wp !== wend) throw new Pz2Error("chunk: count stream integrity check failed");
    q = wend;

    // lane setup
    const colptr = new Uint32Array(nc + 1);
    let acc = 0;
    for (let j = 0; j < nc; j++) {
      acc += counts[j];
      if (acc >= MAX_CHUNK_N) throw new Pz2Error("chunk: too many non-zeros");
      colptr[j + 1] = acc;
    }
    if (acc !== N) throw new Pz2Error("chunk: column counts disagree with the chunk index");
    const idx = new Uint32Array(N);
    const val = new Uint32Array(N);
    if (!N) return { first: 0, counts, colptr, idx, val };
    const S = Math.floor(N / L);
    const r = N % L;
    const steps = S + (r ? 1 : 0);
    const E0 = new Uint32Array(L);
    const CNT = new Uint32Array(L);
    const REM = new Uint32Array(L);
    const PP = new Uint32Array(L);
    const KB = new Uint32Array(L);
    const DK = new Uint32Array(L);
    const KP = new Uint32Array(L);
    const kl: number[] = [];
    const sq = new Leb(blob, q, bytes);
    let j = 0;
    for (let l = 0; l < L; l++) {
      E0[l] = l * S + Math.min(l, r);
      CNT[l] = S + (l < r ? 1 : 0);
      KP[l] = kl.length;
      if (!CNT[l]) {
        REM[l] = 1 << 27;
        continue;
      }
      while (colptr[j + 1] <= E0[l]) j++;
      const o = E0[l] - colptr[j];
      const kf = counts[j];
      REM[l] = kf - o;
      KB[l] = kbase(cfg, kf);
      DK[l] = dkOf(ilog2(kf + 1));
      PP[l] = o ? sq.get() : 0;
      let remaining = CNT[l] - REM[l];
      let jj = j + 1;
      while (remaining > 0) {
        const kk = counts[jj++];
        if (kk) {
          kl.push(kk);
          remaining -= kk;
        }
      }
    }
    for (let i = 0; i < 32; i++) kl.push(0);
    q = sq.p;
    if (bytes - q < 4 * L + 2 * nw) throw new Pz2Error("chunk: truncated lane stream");
    const X = new Uint32Array(L);
    for (let l = 0; l < L; l++) X[l] = ld32(blob, q + 4 * l);
    let w = q + 4 * L;
    const wordsEnd = w + 2 * nw;

    // The scalar reference decoder, phase by phase across lanes: the order in which lanes refill from the shared word stream is part of
    // the format, so only steps that read no words are merged into a neighbouring phase. Active lanes are always a prefix: all L lanes
    // for steps below S, the first r in the last one.
    const pb = cfg.pb;
    const pbv = cfg.pbv;
    const mask = (1 << pb) - 1;
    const maskv = (1 << pbv) - 1;
    const sh = cfg.sh;
    const cap = cfg.cap;
    const gt = this.tGap!;
    const rt = this.tRes!;
    const E = new Uint32Array(L);
    const E2 = new Uint32Array(L);
    const RK = new Uint32Array(L);
    const NB = new Uint32Array(L);
    const EX = new Uint32Array(L);
    const OUT = new Uint32Array(L);
    OUT.set(E0);
    const KPp = new Uint32Array(KP);
    for (let s = 0; s < steps; s++) {
      const na = s < S ? L : r;
      let wide = false;
      for (let l = 0; l < na; l++) {
        // A: gap class symbol, context = row-count class x position bucket of the previous row
        const q2 = PP[l] + 2;
        const lg = 31 - Math.clz32(q2);
        let pc = (2 * lg + ((q2 >>> (lg - 1)) & 1) - 2) >>> sh;
        if (pc > cap) pc = cap;
        const xx = X[l];
        const e = gt[KB[l] + (pc << pb) + (xx & mask)];
        let y = ((e >>> 12) & 0xfff) * (xx >>> pb) + (e & 0xfff);
        if (y < K_L) {
          y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
          w += 2;
        }
        X[l] = y;
        E[l] = e;
      }
      for (let l = 0; l < na; l++) {
        // B: the gap's extra bits, low 16
        const nb = CLS_NB[E[l] >>> 25];
        const xx = X[l];
        let y: number;
        if (nb > 16) {
          wide = true;
          EX[l] = xx & 0xffff;
          y = xx >>> 16;
        } else {
          EX[l] = xx & ((1 << nb) - 1);
          y = xx >>> nb;
        }
        NB[l] = nb;
        if (y < K_L) {
          y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
          w += 2;
        }
        X[l] = y;
      }
      if (wide) {
        for (let l = 0; l < na; l++) {
          // B2: high bits of wide gaps
          if (NB[l] <= 16) continue;
          const hi = NB[l] - 16;
          EX[l] = (EX[l] | ((X[l] & ((1 << hi) - 1)) << 16)) >>> 0;
          let y = X[l] >>> hi;
          if (y < K_L) {
            y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
            w += 2;
          }
          X[l] = y;
        }
      }
      for (let l = 0; l < na; l++) {
        // rank, then C1: residual class for flagged elements (value != 1)
        const e0 = E[l];
        const rk = PP[l] + CLS_BASE[e0 >>> 25] + EX[l];
        RK[l] = rk;
        if (!((e0 >>> 24) & 1)) continue;
        const q2 = rk + 2;
        const lg = 31 - Math.clz32(q2);
        let pcr = (2 * lg + ((q2 >>> (lg - 1)) & 1) - 2) >>> 1;
        if (pcr > RES_POS - 1) pcr = RES_POS - 1;
        const xx = X[l];
        const e = rt[((pcr * 4 + DK[l]) << pbv) + (xx & maskv)];
        let y = ((e >>> 12) & 0xfff) * (xx >>> pbv) + (e & 0xfff);
        if (y < K_L) {
          y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
          w += 2;
        }
        X[l] = y;
        E2[l] = e;
      }
      wide = false;
      for (let l = 0; l < na; l++) {
        // C2: the residual's extra bits, low 16
        if (!((E[l] >>> 24) & 1)) continue;
        const nb = CLS_NB[E2[l] >>> 24];
        const xx = X[l];
        let y: number;
        if (nb > 16) {
          wide = true;
          EX[l] = xx & 0xffff;
          y = xx >>> 16;
        } else {
          EX[l] = xx & ((1 << nb) - 1);
          y = xx >>> nb;
        }
        NB[l] = nb;
        if (y < K_L) {
          y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
          w += 2;
        }
        X[l] = y;
      }
      for (let l = 0; l < na; l++) {
        // C3 (high bits of wide residuals), then the element itself
        let v = 1;
        if ((E[l] >>> 24) & 1) {
          if (wide && NB[l] > 16) {
            const hi = NB[l] - 16;
            EX[l] = (EX[l] | ((X[l] & ((1 << hi) - 1)) << 16)) >>> 0;
            let y = X[l] >>> hi;
            if (y < K_L) {
              y = ((y << 16) | blob[w] | (blob[w + 1] << 8)) >>> 0;
              w += 2;
            }
            X[l] = y;
          }
          const rr = CLS_BASE[E2[l] >>> 24] + EX[l];
          v = rr ? rr + 1 : 0;
        }
        const o = OUT[l]++;
        idx[o] = RK[l];
        val[o] = v;
        PP[l] = RK[l] + 1;
        if (--REM[l] === 0 && s + 1 < CNT[l]) {
          const kk = kl[KPp[l]++];
          REM[l] = kk;
          PP[l] = 0;
          KB[l] = kbase(cfg, kk);
          DK[l] = dkOf(ilog2(kk + 1));
        }
      }
      if (w > wordsEnd) throw new Pz2Error("chunk: entropy stream integrity check failed");
    }
    if (w !== wordsEnd) throw new Pz2Error("chunk: entropy stream integrity check failed");
    for (let l = 0; l < L; l++) if (X[l] !== K_L) throw new Pz2Error("chunk: entropy stream integrity check failed");
    if (canonical) this.canonicalize(counts, idx, val);
    return { first: 0, counts, colptr, idx, val };
  }

  /**
   * stored ids -> canonical ids, each column sorted ascending (ids are unique within a column). An (id, value) pair is packed into one
   * float64, id * 2^32 + value (exact: codec 1 ids are below 2^21), and sorted with the native typed-array sort.
   */
  private canonicalize(counts: Uint32Array, idx: Uint32Array, val: Uint32Array): void {
    const perm = this.perm!;
    const m = this.h.m;
    let tmp = new Float64Array(256);
    let o = 0;
    for (let j = 0; j < counts.length; j++) {
      const kk = counts[j];
      if (!kk) continue;
      let sorted = true;
      let prev = 0;
      for (let i = 0; i < kk; i++) {
        const s = idx[o + i];
        if (s >= m) throw new Pz2Error("decoded row id out of range");
        const c = perm[s];
        idx[o + i] = c;
        if (i && c < prev) sorted = false;
        prev = c;
      }
      if (!sorted) {
        if (tmp.length < kk) tmp = new Float64Array(Math.max(kk, tmp.length * 2));
        const t = tmp.subarray(0, kk);
        for (let i = 0; i < kk; i++) t[i] = idx[o + i] * 4294967296 + val[o + i];
        t.sort();
        for (let i = 0; i < kk; i++) {
          const x = t[i];
          const id = Math.floor(x / 4294967296);
          idx[o + i] = id;
          val[o + i] = x - id * 4294967296;
        }
      }
      o += kk;
    }
  }
}
