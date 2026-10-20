/**
 * Bit-packed categorical index over every sample in the catalog.
 *
 * Each attribute is dictionary-encoded (value -> small integer, 0 = unknown) and stored two ways:
 *   - a code column (uint8/uint16 per sample) for lookups and ranking, single-valued attributes only;
 *   - one bitset per value and source tier (one bit per sample): dense Uint32 words, or a sorted id list when
 *     the value is rare (fewer set bits than words).
 * A query is bitwise AND / OR / ANDNOT over those sets plus popcounts. Numeric attributes are quantised into
 * bins at build time and a range is the OR of the bins it overlaps.
 *
 * File layout (little endian; served as `index.<version>.sbix` next to `index.json`, see scripts/search-index):
 *
 *   header, 32 bytes:  "SBIX" | u32 format | u32 n_samples | u32 words | u32 total bytes | 12 reserved
 *   then blobs, each 4-byte aligned, located by the JSON dictionary (`IndexDict`):
 *     gsm          u32 x n      numeric part of the GSM accession
 *     study_idx    u32 x n      index into `studies` (samples of one study are contiguous, sorted by GSM)
 *     study_start  u32 x (s+1)  first sample of each study
 *     cells        u32 x n      cells called
 *     per attribute: code column, then its bitsets
 *
 * The same layout holds for cells instead of samples (n = cells, `study_start` = sample starts) once cell labels
 * exist; nothing here assumes the unit is a sample.
 *
 * Source tiers (see cohort-schema): 0 geo, 1 pipeline, 2 model >= 0.8, 3 model < 0.8. A fact lives in exactly one.
 * The `sources` gate of a query is a tier mask; core attributes ignore it.
 */
import { ATTRS, TIER_BIT, type AttrSpec } from "./cohort-schema";

export const BITINDEX_FORMAT = 1;
export const HEADER_BYTES = 32;
const MAGIC = 0x58494253; // "SBIX" read little endian

export interface IndexDict {
  format: number;
  /** Changes whenever the content does; part of every cohort cache key. */
  index_version: string;
  built_at: string;
  /** File name of the binary next to this dictionary. */
  bin: string;
  n_samples: number;
  n_studies: number;
  words: number;
  bytes: number;
  /** FNV-1a 32 of the binary, hex. */
  checksum: string;
  studies: string[];
  sections: Record<"gsm" | "study_idx" | "study_start" | "cells", [number, number]>;
  attrs: AttrDict[];
}

export interface AttrDict {
  key: string;
  kind: "cat" | "num";
  multi: boolean;
  core: boolean;
  edges?: number[];
  /** values[code - 1]; for numeric attributes the bin labels. */
  values: string[];
  /** 0 = none (multi), 1 = uint8, 2 = uint16. */
  code_bytes: 0 | 1 | 2;
  code: [number, number] | null;
  /** tiers[t] = [valueId, offset, byteLength, cardinality][] ; byteLength === words * 4 means dense. */
  tiers: [number, number, number, number][][];
}

interface SetRef {
  /** Dense words, or null when `ids` holds the members. */
  dense: Uint32Array | null;
  ids: Uint32Array | null;
  card: number;
}

interface AttrRt {
  d: AttrDict;
  spec: AttrSpec | undefined;
  sets: (SetRef | undefined)[][];
  codes: Uint8Array | Uint16Array | null;
  byLabel: Map<string, number>;
}

// ── word helpers (exported for the resolver and the tests) ──────────────────

export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

export function popcount(a: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x !== 0) n += popcount32(x);
  }
  return n;
}

export function andInto(dst: Uint32Array, src: Uint32Array): Uint32Array {
  for (let i = 0; i < dst.length; i++) dst[i] &= src[i];
  return dst;
}
export function orInto(dst: Uint32Array, src: Uint32Array): Uint32Array {
  for (let i = 0; i < dst.length; i++) dst[i] |= src[i];
  return dst;
}
export function andNotInto(dst: Uint32Array, src: Uint32Array): Uint32Array {
  for (let i = 0; i < dst.length; i++) dst[i] &= ~src[i];
  return dst;
}
export function andCount(a: Uint32Array, b: Uint32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] & b[i];
    if (x !== 0) n += popcount32(x);
  }
  return n;
}

/** Calls fn(i) for every set bit, ascending. */
export function forEachSet(mask: Uint32Array, fn: (i: number) => void): void {
  for (let w = 0; w < mask.length; w++) {
    let x = mask[w];
    while (x !== 0) {
      const low = x & -x;
      fn((w << 5) + (31 - Math.clz32(low)));
      x ^= low;
    }
  }
}

export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

// ── tiers ───────────────────────────────────────────────────────────────────

/** `sources` strings ("geo", "pipeline", "model", "model>=0.8") to a tier mask. Unknown strings are returned in `bad`. */
export function parseSources(sources: readonly string[] | undefined): { mask: number; bad: string[] } {
  const list = sources && sources.length ? sources : ["geo", "pipeline", "model>=0.8"];
  let mask = 0;
  const bad: string[] = [];
  for (const raw of list) {
    const s = String(raw).trim().toLowerCase();
    if (s === "geo") mask |= TIER_BIT.geo;
    else if (s === "pipeline") mask |= TIER_BIT.pipeline;
    else if (s === "model") mask |= TIER_BIT.model_hi | TIER_BIT.model_lo;
    else {
      const m = /^model\s*>=\s*([0-9.]+)$/.exec(s);
      const t = m ? Number(m[1]) : NaN;
      // Model facts are stored in two bands, so any threshold of 0.8 or more keeps the high band and any below
      // 0.8 keeps both.
      if (m && Number.isFinite(t) && t >= 0 && t <= 1) mask |= t >= 0.8 ? TIER_BIT.model_hi : TIER_BIT.model_hi | TIER_BIT.model_lo;
      else bad.push(String(raw));
    }
  }
  return { mask, bad };
}

// ── the index ───────────────────────────────────────────────────────────────

export interface Summary {
  samples: number;
  cells: number;
  studies: number;
  /** Per study index (into `studies`): selected samples and their cells. */
  studySamples: Uint32Array;
  studyCells: Float64Array;
  /** Study indexes that have at least one selected sample, in first-seen order. */
  touched: number[];
}

export interface FacetValue {
  value: string;
  n: number;
}

export interface SoftClause {
  attr: string;
  /** Value labels; matched case-insensitively. */
  values: string[];
  weight?: number;
}

export class BitIndex {
  readonly n: number;
  readonly words: number;
  readonly studies: string[];
  readonly version: string;
  readonly dict: IndexDict;
  private readonly gsm: Uint32Array;
  private readonly studyIdx: Uint32Array;
  private readonly studyStart: Uint32Array;
  private readonly cells: Uint32Array;
  private readonly attrs: AttrRt[];
  private readonly byKey = new Map<string, AttrRt>();
  private readonly tail: number;
  private readonly knownCache = new Map<string, Uint32Array>();

  constructor(buf: ArrayBuffer, dict: IndexDict) {
    if (dict.format !== BITINDEX_FORMAT) throw new Error(`Unsupported index format ${dict.format}`);
    if (buf.byteLength !== dict.bytes) throw new Error(`Index is ${buf.byteLength} bytes, dictionary says ${dict.bytes}`);
    const h = new DataView(buf);
    if (h.getUint32(0, true) !== MAGIC || h.getUint32(4, true) !== BITINDEX_FORMAT) throw new Error("Not a bit index");
    if (h.getUint32(8, true) !== dict.n_samples || h.getUint32(12, true) !== dict.words) throw new Error("Index header does not match its dictionary");
    this.dict = dict;
    this.n = dict.n_samples;
    this.words = dict.words;
    this.studies = dict.studies;
    this.version = dict.index_version;
    this.tail = this.n % 32 === 0 ? 0xffffffff : (1 << (this.n % 32)) - 1;
    const u32 = (s: [number, number]) => new Uint32Array(buf, s[0], s[1] / 4);
    this.gsm = u32(dict.sections.gsm);
    this.studyIdx = u32(dict.sections.study_idx);
    this.studyStart = u32(dict.sections.study_start);
    this.cells = u32(dict.sections.cells);
    const specs = new Map<string, AttrSpec>(ATTRS.map((a) => [a.key, a]));
    this.attrs = dict.attrs.map((d) => {
      const sets: (SetRef | undefined)[][] = [];
      for (let t = 0; t < d.tiers.length; t++) {
        const arr: (SetRef | undefined)[] = new Array(d.values.length);
        for (const [v, off, len, card] of d.tiers[t]) {
          arr[v] = len === this.words * 4 ? { dense: new Uint32Array(buf, off, this.words), ids: null, card } : { dense: null, ids: new Uint32Array(buf, off, len / 4), card };
        }
        sets.push(arr);
      }
      let codes: Uint8Array | Uint16Array | null = null;
      if (d.code && d.code_bytes === 1) codes = new Uint8Array(buf, d.code[0], d.code[1]);
      else if (d.code && d.code_bytes === 2) codes = new Uint16Array(buf, d.code[0], d.code[1] / 2);
      const byLabel = new Map<string, number>();
      d.values.forEach((v, i) => byLabel.set(v.toLowerCase(), i));
      const rt: AttrRt = { d, spec: specs.get(d.key), sets, codes, byLabel };
      this.byKey.set(d.key, rt);
      return rt;
    });
  }

  // ── lookups ───────────────────────────────────────────────────────────────

  hasAttr(key: string): boolean {
    return this.byKey.has(key);
  }
  attrKeys(): string[] {
    return this.attrs.map((a) => a.d.key);
  }
  attrDict(key: string): AttrDict {
    return this.rt(key).d;
  }
  private rt(key: string): AttrRt {
    const a = this.byKey.get(key);
    if (!a) throw new Error(`Unknown attribute '${key}'`);
    return a;
  }

  /** Tiers a query may read for this attribute: core attributes always read their one tier. */
  tiersFor(key: string, sourceMask: number): number {
    return this.rt(key).d.core ? TIER_BIT.geo : sourceMask;
  }

  gsmId(i: number): string {
    return `GSM${this.gsm[i]}`;
  }
  gseOf(i: number): string {
    return this.studies[this.studyIdx[i]];
  }
  studyOf(i: number): number {
    return this.studyIdx[i];
  }
  studyRange(s: number): [number, number] {
    return [this.studyStart[s], this.studyStart[s + 1]];
  }
  cellsOf(i: number): number {
    return this.cells[i];
  }
  /** Code of sample i for a single-valued attribute: 0 unknown, else value id + 1. */
  codeAt(key: string, i: number): number {
    const c = this.rt(key).codes;
    if (!c) throw new Error(`'${key}' holds several values per sample and has no code column`);
    return c[i];
  }
  valueAt(key: string, i: number): string | null {
    const a = this.rt(key);
    const c = this.codeAt(key, i);
    return c === 0 ? null : a.d.values[c - 1];
  }
  /** Value id for a label (case-insensitive), or -1. */
  valueId(key: string, label: string): number {
    return this.rt(key).byLabel.get(String(label).trim().toLowerCase()) ?? -1;
  }

  // ── masks ─────────────────────────────────────────────────────────────────

  /** Every sample. */
  all(): Uint32Array {
    const m = new Uint32Array(this.words).fill(0xffffffff);
    if (this.words) m[this.words - 1] = this.tail;
    return m;
  }
  /** Complement within the sample range. */
  not(m: Uint32Array): Uint32Array {
    const out = new Uint32Array(this.words);
    for (let i = 0; i < out.length; i++) out[i] = ~m[i];
    if (this.words) out[this.words - 1] &= this.tail;
    return out;
  }

  private orSet(dst: Uint32Array, s: SetRef): void {
    if (s.dense) {
      const d = s.dense;
      for (let i = 0; i < dst.length; i++) dst[i] |= d[i];
    } else if (s.ids) {
      const ids = s.ids;
      for (let i = 0; i < ids.length; i++) dst[ids[i] >>> 5] |= 1 << (ids[i] & 31);
    }
  }

  /** Samples holding any of the values (ids from valueId) in the allowed tiers. */
  valueMask(key: string, valueIds: readonly number[], sourceMask: number): Uint32Array {
    const a = this.rt(key);
    const tiers = this.tiersFor(key, sourceMask);
    const out = new Uint32Array(this.words);
    for (let t = 0; t < a.sets.length; t++) {
      if (!(tiers & (1 << t))) continue;
      for (const v of valueIds) {
        const s = a.sets[t][v];
        if (s) this.orSet(out, s);
      }
    }
    return out;
  }

  /**
   * Samples in the bins a numeric range overlaps. `min` and `max` are inclusive and snap outward to bin edges;
   * `snapped` is the [lo, hi) the bins actually cover (hi null for the open last bin).
   */
  rangeMask(key: string, min: number | null, max: number | null, sourceMask: number): { mask: Uint32Array; snapped: [number | null, number | null]; bins: number[] } {
    const a = this.rt(key);
    if (a.d.kind !== "num" || !a.d.edges) throw new Error(`'${key}' is not numeric`);
    const e = a.d.edges;
    const bins: number[] = [];
    for (let b = 0; b < e.length; b++) {
      const lo = e[b];
      const hi = b + 1 < e.length ? e[b + 1] : Infinity;
      if ((min == null || hi > min) && (max == null || lo <= max)) bins.push(b);
    }
    const mask = this.valueMask(key, bins, sourceMask);
    const first = bins.length ? e[bins[0]] : null;
    const lastB = bins.length ? bins[bins.length - 1] : -1;
    const last = lastB >= 0 && lastB + 1 < e.length ? e[lastB + 1] : null;
    return { mask, snapped: [first, last], bins };
  }

  /** Samples with any fact for the attribute in the allowed tiers (cached). */
  known(key: string, sourceMask: number): Uint32Array {
    const tiers = this.tiersFor(key, sourceMask);
    const ck = `${key}|${tiers}`;
    let m = this.knownCache.get(ck);
    if (!m) {
      const a = this.rt(key);
      m = new Uint32Array(this.words);
      for (let t = 0; t < a.sets.length; t++) {
        if (!(tiers & (1 << t))) continue;
        for (const s of a.sets[t]) if (s) this.orSet(m, s);
      }
      this.knownCache.set(ck, m);
    }
    return m;
  }

  // ── counts ────────────────────────────────────────────────────────────────

  /** Counts per value over `mask`, descending, plus the unknown count. Rows with a zero count are left out. */
  facet(key: string, mask: Uint32Array, sourceMask: number, limit = Infinity): { values: FacetValue[]; unknown: number; known: number } {
    const a = this.rt(key);
    const tiers = this.tiersFor(key, sourceMask);
    const out: FacetValue[] = [];
    let tmp: Uint32Array | null = null;
    for (let v = 0; v < a.d.values.length; v++) {
      const refs: SetRef[] = [];
      for (let t = 0; t < a.sets.length; t++) {
        const s = tiers & (1 << t) ? a.sets[t][v] : undefined;
        if (s) refs.push(s);
      }
      if (!refs.length) continue;
      let n: number;
      if (refs.length === 1) n = this.countAnd(mask, refs[0]);
      else {
        tmp = tmp ?? new Uint32Array(this.words);
        tmp.fill(0);
        for (const r of refs) this.orSet(tmp, r);
        n = andCount(mask, tmp);
      }
      if (n > 0) out.push({ value: a.d.values[v], n });
    }
    out.sort((x, y) => y.n - x.n || (x.value < y.value ? -1 : 1));
    const total = popcount(mask);
    const known = andCount(mask, this.known(key, sourceMask));
    return { values: out.length > limit ? out.slice(0, limit) : out, unknown: total - known, known };
  }

  private countAnd(mask: Uint32Array, s: SetRef): number {
    if (s.dense) return andCount(mask, s.dense);
    let n = 0;
    const ids = s.ids!;
    for (let i = 0; i < ids.length; i++) n += (mask[ids[i] >>> 5] >>> (ids[i] & 31)) & 1;
    return n;
  }

  /** Samples, cells and studies in `mask`, with per-study tallies. */
  summarize(mask: Uint32Array): Summary {
    const studySamples = new Uint32Array(this.studies.length);
    const studyCells = new Float64Array(this.studies.length);
    const touched: number[] = [];
    let samples = 0;
    let cells = 0;
    const idx = this.studyIdx;
    const c = this.cells;
    for (let w = 0; w < mask.length; w++) {
      let x = mask[w];
      while (x !== 0) {
        const low = x & -x;
        const i = (w << 5) + (31 - Math.clz32(low));
        const s = idx[i];
        if (studySamples[s]++ === 0) touched.push(s);
        studyCells[s] += c[i];
        cells += c[i];
        samples++;
        x ^= low;
      }
    }
    return { samples, cells, studies: touched.length, studySamples, studyCells, touched };
  }

  /** Clears the bits of every study that has fewer than `min` samples in `mask` (in place). */
  dropSmallStudies(mask: Uint32Array, min: number, summary: Summary): number {
    let dropped = 0;
    for (const s of summary.touched) {
      const k = summary.studySamples[s];
      if (k >= min) continue;
      dropped++;
      const [a, b] = this.studyRange(s);
      for (let i = a; i < b; i++) mask[i >>> 5] &= ~(1 << (i & 31));
    }
    return dropped;
  }

  /**
   * Mask of samples with at least `min` cells called (exact). Bins of the `n_cells` attribute that lie wholly
   * above `min` are taken as bitsets; only the one bin that straddles `min` is checked sample by sample.
   */
  minCellsMask(min: number): Uint32Array {
    const out = new Uint32Array(this.words);
    const a = this.byKey.get("n_cells");
    if (!a || !a.d.edges) {
      const c = this.cells;
      for (let i = 0; i < this.n; i++) if (c[i] >= min) out[i >>> 5] |= 1 << (i & 31);
      return out;
    }
    const e = a.d.edges;
    for (let b = 0; b < e.length; b++) {
      const hi = b + 1 < e.length ? e[b + 1] : Infinity;
      if (hi <= min) continue;
      const set = a.sets[0][b];
      if (!set) continue;
      if (e[b] >= min) this.orSet(out, set);
      else {
        const c = this.cells;
        if (set.ids) {
          for (let k = 0; k < set.ids.length; k++) if (c[set.ids[k]] >= min) out[set.ids[k] >>> 5] |= 1 << (set.ids[k] & 31);
        } else if (set.dense) {
          forEachSet(set.dense, (i) => {
            if (c[i] >= min) out[i >>> 5] |= 1 << (i & 31);
          });
        }
      }
    }
    return out;
  }

  /** Sample indices of the set bits, ascending. */
  indices(mask: Uint32Array): Uint32Array {
    const out = new Uint32Array(popcount(mask));
    let k = 0;
    forEachSet(mask, (i) => (out[k++] = i));
    return out;
  }

  // ── ranking ───────────────────────────────────────────────────────────────

  /**
   * Cosine similarity between a weighted query vector and each candidate's one-hot profile over the soft
   * attributes, read from the code columns. A candidate unknown on an attribute contributes nothing to its
   * norm, so it is not ranked below a known mismatch for that reason. Returns the top `k` sample indices.
   */
  rank(mask: Uint32Array, soft: readonly SoftClause[], k: number): { index: number; score: number }[] {
    const clauses = soft
      .map((s) => {
        const a = this.rt(s.attr);
        if (!a.codes) throw new Error(`'${s.attr}' holds several values per sample and cannot be ranked on`);
        const want = new Set<number>();
        for (const v of s.values) {
          const id = a.byLabel.get(String(v).trim().toLowerCase());
          if (id !== undefined) want.add(id + 1);
        }
        return { codes: a.codes, want, w: s.weight ?? 1 };
      })
      .filter((c) => c.want.size > 0);
    if (!clauses.length) return [];
    let q2 = 0;
    for (const c of clauses) q2 += c.w * c.w * c.want.size;
    const qn = Math.sqrt(q2);
    const top: { index: number; score: number }[] = [];
    forEachSet(mask, (i) => {
      let dot = 0;
      let known = 0;
      for (const c of clauses) {
        const code = c.codes[i];
        if (code === 0) continue;
        known++;
        if (c.want.has(code)) dot += c.w;
      }
      if (dot === 0) return;
      const score = dot / (qn * Math.sqrt(known));
      if (top.length === k && score <= top[k - 1].score) return;
      let j = top.length < k ? top.length : k - 1;
      if (top.length < k) top.push({ index: i, score });
      else top[j] = { index: i, score };
      while (j > 0 && top[j - 1].score < top[j].score) {
        const t = top[j - 1];
        top[j - 1] = top[j];
        top[j] = t;
        j--;
      }
    });
    return top;
  }
}

/** Reads a binary and its dictionary; a view onto a larger or unaligned buffer (a pooled Node Buffer) is copied first. */
export function loadBitIndex(bytes: ArrayBuffer | Uint8Array, dict: IndexDict): BitIndex {
  if (!(bytes instanceof Uint8Array)) return new BitIndex(bytes, dict);
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  // ArrayBuffer.slice always copies, unlike Buffer.slice, which would keep a pooled buffer.
  return new BitIndex(whole ? (bytes.buffer as ArrayBuffer) : (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), dict);
}
