/**
 * Atlas cell index: `POST /v2/cidx/query` (singlet-bio docs/format-v2-cell-index.md section 6).
 *
 * Reads go through the same handler as public GETs (`handle()` with a Range header), so they share its Cache API copy, its R2 fallback
 * and its fill policy. Everything an index version consists of is immutable and content-addressed, so per-isolate memos never go stale;
 * only `v2/cidx/current.json` is re-read (at most once a minute).
 *
 * The query semantics are those of `singlet.v2.atlas.Index` in singlet-bio: lists are OR within a field, fields are ANDed;
 * cell_type / tissue / ancestry match descendants through each dictionary entry's ancestor list; ranges are inclusive; score ranges
 * are applied at the stored u8 resolution and a missing score (255) never matches a score range.
 */
import { handle, type Deps } from "./handler";
import { decodeChunk, parseScxHeader, scxHeaderLen, type ScxHeader } from "./scx";

export const ORIGIN = "https://data.singlet.bio";
export const SCALE8 = 254;
export const NA8 = 255;
export const POSTINGS_MAX_SAMPLES = 2000;

export class CidxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

export interface ReadStats {
  reads: number;
  bytes: number;
  hits: number;
}

export function newStats(): ReadStats {
  return { reads: 0, bytes: 0, hits: 0 };
}

/** Bytes [start, start+len) of `key` (or the whole object), through the public GET path. */
export async function readBytes(deps: Deps, key: string, start?: number, len?: number, stats?: ReadStats): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (start !== undefined) {
    if (!len || len <= 0) return new Uint8Array(0);
    headers.Range = `bytes=${start}-${start + len - 1}`;
  }
  const res = await handle(new Request(`${ORIGIN}/${key}`, { headers }), deps);
  if (res.status === 404) {
    await res.body?.cancel();
    throw new CidxError(404, "not_found", `${key} does not exist`);
  }
  if (res.status !== (start !== undefined ? 206 : 200)) {
    await res.body?.cancel();
    throw new CidxError(502, "upstream_error", `${key}: HTTP ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (start !== undefined && buf.length !== len) throw new CidxError(502, "upstream_error", `${key}: short read`);
  if (stats) {
    stats.reads++;
    stats.bytes += buf.length;
    if (res.headers.get("x-cache") === "HIT") stats.hits++;
  }
  return buf;
}

async function readJson<T>(deps: Deps, key: string, stats?: ReadStats): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readBytes(deps, key, undefined, undefined, stats))) as T;
}

/** Small LRU for per-isolate memos of immutable things. */
class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  clear(): void {
    this.m.clear();
  }
}

// ── directory ───────────────────────────────────────────────────────────────

export interface DictEntry {
  code: number;
  id: string | null;
  label: string;
  anc?: string[];
}
export interface ShardEntry {
  i: number;
  key: string;
  bytes: number;
  rows: number;
  zone: Record<string, [number, number]>;
  tissues: number[] | null;
}
export interface Directory {
  format: string;
  format_version: number;
  version: string;
  group_rows: number;
  dicts: Record<"organism" | "cell_type" | "tissue" | "sex" | "ancestry", DictEntry[]>;
  samples: { key: string; rows: number; max_so: number };
  summary: { key: string; rows: number };
  plan: { block_size: number; blocks: Record<string, string> };
  shards: string[];
  partitions: { organism: number; label: string; rows: number; shards: ShardEntry[] }[];
  exclude: number[];
  totals: Record<string, number>;
  /** id -> label of every dictionary term and every ancestor they list */
  terms?: Record<string, string>;
}

export interface PlanMember {
  off: number;
  len: number;
  digest: string | null;
  prefix?: number;
  chunks_at?: number;
  n_chunks?: number;
  first_col?: number[];
  coff?: number[];
}
export interface PlanSample {
  so: number;
  gsm: string;
  gse: string;
  key: string;
  bytes: number;
  n_columns: number;
  n_called: number;
  organism: string;
  members: Record<string, PlanMember>;
  runs: [number, number, number][];
}

const memoDir = new Lru<Directory>(4);
const memoHeader = new Lru<ScxHeader>(512);
const memoPlan = new Lru<Map<number, PlanSample>>(512);
const memoTable = new Lru<Record<string, Uint32Array>>(4);
let memoCurrent: { at: number; version: string } | null = null;

export function clearMemos(): void {
  memoDir.clear();
  memoHeader.clear();
  memoPlan.clear();
  memoTable.clear();
  memoCurrent = null;
}

const VERSION_RE = /^\d{8}T\d{4}Z-[0-9a-f]{8}$/;

export async function openDirectory(deps: Deps, version: string | undefined, stats?: ReadStats, now = Date.now()): Promise<Directory> {
  let v = version && version !== "current" ? version : null;
  if (v && !VERSION_RE.test(v)) throw new CidxError(400, "bad_request", "`version` must be 'current' or an index version like 20261101T0000Z-ab12cd34.");
  if (!v) {
    if (memoCurrent && now - memoCurrent.at < 60_000) v = memoCurrent.version;
    else {
      const cur = await readJson<{ version: string }>(deps, "v2/cidx/current.json", stats).catch((e) => {
        if (e instanceof CidxError && e.status === 404) throw new CidxError(404, "no_index", "No cell index has been published yet.");
        throw e;
      });
      if (!VERSION_RE.test(cur.version)) throw new CidxError(502, "bad_index", "current.json names an invalid version");
      memoCurrent = { at: now, version: cur.version };
      v = cur.version;
    }
  }
  const hit = memoDir.get(v);
  if (hit) return hit;
  const d = await readJson<Directory>(deps, `v2/cidx/v/${v}.json`, stats).catch((e) => {
    if (e instanceof CidxError && e.status === 404) throw new CidxError(404, "no_such_version", `Index version ${v} does not exist (it may have been retired; use 'current').`);
    throw e;
  });
  if (d.format !== "singlet-cidx" || d.format_version > 1) throw new CidxError(502, "bad_index", "unsupported index format");
  memoDir.set(v, d);
  return d;
}

export async function shardHeader(deps: Deps, key: string, stats?: ReadStats): Promise<ScxHeader> {
  const hit = memoHeader.get(key);
  if (hit) return hit;
  const first = await readBytes(deps, key, 0, 64, stats);
  const hl = scxHeaderLen(first);
  const h = parseScxHeader(await readBytes(deps, key, 0, hl, stats));
  memoHeader.set(key, h);
  return h;
}

/** Decode columns of one row group; one read covers all the wanted chunk bodies (they are close together). */
export async function readGroup(deps: Deps, key: string, h: ScxHeader, g: number, cols: string[], stats?: ReadStats): Promise<Record<string, Uint32Array>> {
  const n = h.groupRowsN[g];
  const idx = cols.map((c) => {
    const i = h.names.indexOf(c);
    if (i < 0) throw new CidxError(502, "bad_index", `shard ${key} has no column ${c}`);
    return i;
  });
  const chunks = idx.map((i) => h.chunks[g][i]);
  const withBody = chunks.filter((c) => c.len > 0);
  const out: Record<string, Uint32Array> = {};
  let buf: Uint8Array | null = null;
  let base = 0;
  if (withBody.length) {
    base = Math.min(...withBody.map((c) => c.off));
    const end = Math.max(...withBody.map((c) => c.off + c.len));
    buf = await readBytes(deps, key, base, end - base, stats);
  }
  cols.forEach((c, k) => {
    const ch = chunks[k];
    out[c] = decodeChunk(ch, n, buf && ch.len ? buf.subarray(ch.off - base, ch.off - base + ch.len) : null, new Uint32Array(n));
  });
  return out;
}

/** Every row of a small SCX object (sample table), memoised. */
export async function readTable(deps: Deps, key: string, stats?: ReadStats): Promise<Record<string, Uint32Array>> {
  const hit = memoTable.get(key);
  if (hit) return hit;
  const buf = await readBytes(deps, key, undefined, undefined, stats);
  const h = parseScxHeader(buf);
  const out: Record<string, Uint32Array> = {};
  h.names.forEach((name, c) => {
    const all = new Uint32Array(h.nRows);
    for (let g = 0; g < h.nGroups; g++) {
      const ch = h.chunks[g][c];
      const n = h.groupRowsN[g];
      const tmp = new Uint32Array(n);
      decodeChunk(ch, n, ch.len ? buf.subarray(ch.off, ch.off + ch.len) : null, tmp);
      all.set(tmp, h.groupFirst[g]);
    }
    out[name] = all;
  });
  memoTable.set(key, out);
  return out;
}

export async function planSamples(deps: Deps, d: Directory, sos: number[], stats?: ReadStats): Promise<Map<number, PlanSample>> {
  const blocks = new Map<string, number[]>();
  for (const so of sos) {
    const b = String(Math.floor(so / d.plan.block_size));
    const l = blocks.get(b);
    if (l) l.push(so);
    else blocks.set(b, [so]);
  }
  const out = new Map<number, PlanSample>();
  const keys = [...blocks.keys()];
  for (let i = 0; i < keys.length; i += 6) {
    const batch = keys.slice(i, i + 6);
    const maps = await Promise.all(
      batch.map(async (b) => {
        const key = d.plan.blocks[b];
        if (!key) throw new CidxError(400, "unknown_sample", `sample ordinals ${blocks.get(b)!.slice(0, 3).join(", ")} are not in index ${d.version}`);
        let m = memoPlan.get(key);
        if (!m) {
          const doc = await readJson<{ samples: PlanSample[] }>(deps, key, stats);
          m = new Map(doc.samples.map((s) => [s.so, s]));
          memoPlan.set(key, m);
        }
        return [b, m] as const;
      })
    );
    for (const [b, m] of maps) {
      for (const so of blocks.get(b)!) {
        const s = m.get(so);
        if (!s) throw new CidxError(400, "unknown_sample", `sample ordinal ${so} is not in index ${d.version}`);
        out.set(so, s);
      }
    }
  }
  return out;
}

// ── queries ─────────────────────────────────────────────────────────────────

export const RANGE_FIELDS: Record<string, string[]> = {
  n_umi: ["umi_exon", "umi_intron"],
  n_umi_exon: ["umi_exon"],
  n_umi_intron: ["umi_intron"],
  n_genes: ["feat_exon"],
  n_feat_exon: ["feat_exon"],
  n_feat_intron: ["feat_intron"],
  cell_type_score: ["ct_score"],
  sex_score: ["sex_score"],
  ancestry_prob: ["anc_prob"],
};
const SCORE_FIELDS = new Set(["cell_type_score", "sex_score", "ancestry_prob"]);
const SEX_CODE: Record<string, number> = { unknown: 0, female: 1, male: 2, ambiguous: 3 };
const GSM_RE = /^GSM(\d{1,9})$/;
const GSE_RE = /^GSE(\d{1,9})$/;

export interface Where {
  organism?: string;
  cell_type?: string | string[];
  tissue?: string | string[];
  sex?: string | string[];
  ancestry?: string | string[];
  samples?: string[];
  studies?: string[];
  ranges?: Record<string, [number | null, number | null]>;
}

const asList = (v: unknown): string[] | null => {
  if (v === undefined || v === null) return null;
  const a = Array.isArray(v) ? v : [v];
  const out = a.map((x) => String(x).trim()).filter(Boolean);
  return out.length ? out : null;
};

/**
 * Codes of the entries that are a wanted term or have one as an ancestor. A wanted value is an ontology id or a label (case-insensitive)
 * of a dictionary entry or of any term in `terms` (the directory's id -> label map of every ancestor), so "T cell" also matches CD4/CD8.
 */
export function dictCodes(entries: DictEntry[], wanted: string[], descendants = true, terms: Record<string, string> = {}): number[] {
  const wl = new Set(wanted.map((w) => w.toLowerCase()));
  const ids = new Set(wanted);
  for (const e of entries) if (e.id && wl.has((e.label ?? "").toLowerCase())) ids.add(e.id);
  for (const [id, label] of Object.entries(terms)) if (wl.has((label ?? "").toLowerCase())) ids.add(id);
  const out: number[] = [];
  for (const e of entries) {
    if (e.code === 0) {
      if (wl.has("unknown")) out.push(0);
      continue;
    }
    if ((e.id && ids.has(e.id)) || (descendants && (e.anc ?? []).some((a) => ids.has(a)))) out.push(e.code);
  }
  return out;
}

function q8Lower(v: number): number {
  return Math.ceil(v * SCALE8 - 1e-9);
}
function q8Upper(v: number): number {
  return Math.floor(v * SCALE8 + 1e-9);
}

export class QueryPlan {
  orgCodes: Set<number> | null = null;
  ct: Uint8Array | null = null;
  tissue: Uint8Array | null = null;
  anc: Uint8Array | null = null;
  sex: Uint8Array | null = null;
  ranges: [string, string[], number, number][] = [];
  sampleSet: Uint32Array | null = null; // sorted
  exclude: Set<number>;
  /** a hash of the normalised query, bound into cursors */
  digest = "";

  constructor(
    readonly d: Directory,
    readonly where: Where
  ) {
    const w = where ?? {};
    for (const k of Object.keys(w)) {
      if (!["organism", "cell_type", "tissue", "sex", "ancestry", "samples", "studies", "ranges"].includes(k)) throw new CidxError(400, "bad_request", `Unknown filter '${k}'.`);
    }
    if (w.organism) {
      const codes = dictCodes(d.dicts.organism, [String(w.organism)], false);
      for (const e of d.dicts.organism) if (e.id === w.organism) codes.push(e.code);
      if (!codes.length) throw new CidxError(400, "unknown_term", `Organism '${w.organism}' is not in the index (${d.dicts.organism.slice(1).map((e) => e.label).join(", ")}).`);
      this.orgCodes = new Set(codes);
    }
    this.ct = this.mask(d.dicts.cell_type, asList(w.cell_type), 65536);
    this.tissue = this.mask(d.dicts.tissue, asList(w.tissue), 65536);
    this.anc = this.mask(d.dicts.ancestry, asList(w.ancestry), 256);
    const sx = asList(w.sex);
    if (sx) {
      this.sex = new Uint8Array(256);
      for (const s of sx) {
        const c = SEX_CODE[s.toLowerCase()];
        if (c === undefined) throw new CidxError(400, "bad_request", "sex must be female, male, ambiguous or unknown.");
        this.sex[c] = 1;
      }
    }
    for (const [k, v] of Object.entries(w.ranges ?? {})) {
      const cols = RANGE_FIELDS[k];
      if (!cols) throw new CidxError(400, "bad_request", `Unknown range field '${k}'. Use ${Object.keys(RANGE_FIELDS).join(", ")}.`);
      const [lo, hi] = Array.isArray(v) ? v : [v as unknown as number, null];
      if ((lo !== null && lo !== undefined && !Number.isFinite(Number(lo))) || (hi !== null && hi !== undefined && !Number.isFinite(Number(hi)))) {
        throw new CidxError(400, "bad_request", `ranges.${k} must be [min, max] numbers or null.`);
      }
      let a: number;
      let b: number;
      if (SCORE_FIELDS.has(k)) {
        a = lo == null ? 0 : q8Lower(Number(lo));
        b = hi == null ? SCALE8 : Math.min(SCALE8, q8Upper(Number(hi)));
      } else {
        a = lo == null ? 0 : Math.ceil(Number(lo));
        b = hi == null ? Number.MAX_SAFE_INTEGER : Math.floor(Number(hi));
      }
      this.ranges.push([k, cols, a, b]);
    }
    this.exclude = new Set(d.exclude ?? []);
    this.digest = JSON.stringify(w);
  }

  private mask(entries: DictEntry[], wanted: string[] | null, size: number): Uint8Array | null {
    if (!wanted) return null;
    const m = new Uint8Array(size);
    for (const c of dictCodes(entries, wanted, true, this.d.terms ?? {})) m[c] = 1;
    return m;
  }

  async resolveSamples(deps: Deps, stats?: ReadStats): Promise<void> {
    const w = this.where ?? {};
    const sm = asList(w.samples);
    const st = asList(w.studies);
    if (!sm && !st) return;
    if ((sm?.length ?? 0) > 50_000 || (st?.length ?? 0) > 10_000) throw new CidxError(400, "too_many", "At most 50,000 samples and 10,000 studies per query.");
    const gsm = new Set<number>();
    const gse = new Set<number>();
    for (const g of sm ?? []) {
      const m = GSM_RE.exec(g.toUpperCase());
      if (!m) throw new CidxError(400, "bad_request", `'${g}' is not a GSM accession.`);
      gsm.add(Number(m[1]));
    }
    for (const g of st ?? []) {
      const m = GSE_RE.exec(g.toUpperCase());
      if (!m) throw new CidxError(400, "bad_request", `'${g}' is not a GSE accession.`);
      gse.add(Number(m[1]));
    }
    const t = await readTable(deps, this.d.samples.key, stats);
    const out: number[] = [];
    for (let i = 0; i < t.so.length; i++) if (gsm.has(t.gsm[i]) || gse.has(t.gse[i])) out.push(t.so[i]);
    out.sort((a, b) => a - b);
    this.sampleSet = Uint32Array.from(out);
  }

  hasRowRanges(): boolean {
    return this.ranges.length > 0;
  }

  private static overlaps(m: Uint8Array | null, lo: number, hi: number): boolean {
    if (!m) return true;
    for (let c = lo; c <= hi && c < m.length; c++) if (m[c]) return true;
    return false;
  }

  private sampleOverlap(lo: number, hi: number): boolean {
    const s = this.sampleSet;
    if (!s) return true;
    let a = 0;
    let b = s.length;
    while (a < b) {
      const mid = (a + b) >>> 1;
      if (s[mid] < lo) a = mid + 1;
      else b = mid;
    }
    return a < s.length && s[a] <= hi;
  }

  zoneOk(z: (col: string) => [number, number]): boolean {
    if (!QueryPlan.overlaps(this.ct, ...z("ct")) || !QueryPlan.overlaps(this.tissue, ...z("tissue")) || !QueryPlan.overlaps(this.anc, ...z("anc"))) return false;
    if (!QueryPlan.overlaps(this.sex, ...z("sex"))) return false;
    for (const [, cols, a, b] of this.ranges) {
      let lo = 0;
      let hi = 0;
      for (const c of cols) {
        const [x, y] = z(c);
        lo += x;
        hi += y;
      }
      if (hi < a || lo > b) return false;
    }
    const [s0, s1] = z("sample");
    return this.sampleOverlap(s0, s1);
  }

  neededColumns(): string[] {
    const need = new Set<string>(["sample"]);
    if (this.ct) need.add("ct");
    if (this.tissue) need.add("tissue");
    if (this.sex) need.add("sex");
    if (this.anc) need.add("anc");
    for (const [, cols] of this.ranges) for (const c of cols) need.add(c);
    return [...need];
  }

  /** Indices of matching rows of a decoded group. */
  match(cols: Record<string, Uint32Array>, n: number): Uint32Array {
    const out = new Uint32Array(n);
    let k = 0;
    const { ct, tissue, sex, anc, ranges, exclude } = this;
    const s = cols.sample;
    const set = this.sampleSet;
    let lastS = -1;
    let lastOk = true;
    for (let i = 0; i < n; i++) {
      if (ct && !ct[cols.ct[i]]) continue;
      if (tissue && !tissue[cols.tissue[i]]) continue;
      if (sex && !sex[cols.sex[i]]) continue;
      if (anc && !anc[cols.anc[i]]) continue;
      let ok = true;
      for (let r = 0; r < ranges.length && ok; r++) {
        const [, rc, a, b] = ranges[r];
        const v = rc.length === 1 ? cols[rc[0]][i] : cols[rc[0]][i] + cols[rc[1]][i];
        ok = v >= a && v <= b;
      }
      if (!ok) continue;
      const so = s[i];
      if (so !== lastS) {
        lastS = so;
        lastOk = !exclude.has(so) && (!set || this.sampleOverlap(so, so));
      }
      if (!lastOk) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }
}

export interface GroupRef {
  shard: number;
  key: string;
  header: ScxHeader;
  g: number;
}

/** Candidate row groups in directory order, starting at cursor (shard, group). Reads shard headers 6 at a time. */
export async function* candidateGroups(deps: Deps, p: QueryPlan, start: { s: number; g: number }, stats?: ReadStats): AsyncGenerator<GroupRef> {
  const d = p.d;
  let postings: Map<number, [number, number][]> | null = null;
  if (p.sampleSet && p.sampleSet.length <= POSTINGS_MAX_SAMPLES) {
    postings = new Map();
    const plans = await planSamples(deps, d, Array.from(p.sampleSet), stats);
    for (const s of plans.values()) {
      for (const [gi, st, n] of s.runs) {
        const l = postings.get(gi);
        if (l) l.push([st, st + n]);
        else postings.set(gi, [[st, st + n]]);
      }
    }
  }
  const shards: ShardEntry[] = [];
  for (const part of d.partitions) {
    if (p.orgCodes && !p.orgCodes.has(part.organism)) continue;
    for (const sh of part.shards) {
      if (sh.i < start.s) continue;
      if (postings && !postings.has(sh.i)) continue;
      if (!p.zoneOk((c) => sh.zone[c] ?? [0, 0xffffffff])) continue;
      shards.push(sh);
    }
  }
  for (let i = 0; i < shards.length; i += 6) {
    const batch = shards.slice(i, i + 6);
    const heads = await Promise.all(batch.map((sh) => shardHeader(deps, sh.key, stats)));
    for (let k = 0; k < batch.length; k++) {
      const sh = batch[k];
      const h = heads[k];
      const win = postings?.get(sh.i) ?? null;
      for (let g = sh.i === start.s ? start.g : 0; g < h.nGroups; g++) {
        const g0 = h.groupFirst[g];
        const g1 = g0 + h.groupRowsN[g];
        if (win && !win.some(([a, b]) => a < g1 && b > g0)) continue;
        const ix = (c: string): [number, number] => {
          const j = h.names.indexOf(c);
          return j < 0 ? [0, 0xffffffff] : [h.chunks[g][j].min, h.chunks[g][j].max];
        };
        if (!p.zoneOk(ix)) continue;
        yield { shard: sh.i, key: sh.key, header: h, g };
      }
    }
  }
}

// ── cursors ─────────────────────────────────────────────────────────────────

export interface Cursor {
  v: string;
  q: string;
  s: number;
  g: number;
  r: number;
}

function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
}

async function qhash(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encodeCursor(c: Omit<Cursor, "q">, digest: string): Promise<string> {
  return b64url(JSON.stringify({ ...c, q: await qhash(digest) }));
}

export async function decodeCursor(s: unknown, version: string, digest: string): Promise<Cursor | null> {
  if (s === undefined || s === null || s === "") return null;
  let c: Cursor;
  try {
    c = JSON.parse(unb64url(String(s))) as Cursor;
  } catch {
    throw new CidxError(400, "bad_cursor", "The cursor is not valid.");
  }
  if (c.v !== version || c.q !== (await qhash(digest))) throw new CidxError(400, "bad_cursor", "The cursor belongs to another query or index version.");
  if (![c.s, c.g, c.r].every((x) => Number.isInteger(x) && x >= 0)) throw new CidxError(400, "bad_cursor", "The cursor is not valid.");
  return c;
}

// ── POST /v2/cidx/query ─────────────────────────────────────────────────────

export interface QueryLimits {
  /** rows decoded per request before the answer is returned partial with a cursor */
  maxRowsScanned: number;
  /** cells per page of a "cells" answer */
  maxCellsPage: number;
}

export interface QueryBody {
  version?: string;
  where?: Where;
  return?: "count" | "cells";
  by?: string[];
  limit?: number;
  cursor?: string;
  fields?: string[];
}

const BY: Record<string, string> = { organism: "organism", cell_type: "ct", tissue: "tissue", sex: "sex", ancestry: "anc", sample: "sample", study: "study" };
const CELL_FIELDS = ["ct", "tissue", "umi_exon", "umi_intron", "feat_exon", "feat_intron", "ct_score", "sex", "sex_score", "anc", "anc_prob"];

function labelOf(d: Directory, by: string, code: number): { id: string | null; label: string } {
  const dict = by === "organism" ? d.dicts.organism : by === "cell_type" ? d.dicts.cell_type : by === "tissue" ? d.dicts.tissue : by === "sex" ? d.dicts.sex : d.dicts.ancestry;
  const e = dict[code] && dict[code].code === code ? dict[code] : dict.find((x) => x.code === code);
  return { id: e?.id ?? null, label: e?.label ?? "unknown" };
}

export interface ScanHooks {
  /** called once before a row scan starts (not for summary counts); throws to refuse */
  beforeScan?: () => Promise<void>;
  /** called with the rows the scan decoded */
  afterScan?: (rows: number) => void;
}

export async function runQuery(deps: Deps, body: QueryBody, limits: QueryLimits, hooks: ScanHooks = {}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const stats = newStats();
  const d = await openDirectory(deps, body.version, stats);
  const p = new QueryPlan(d, body.where ?? {});
  await p.resolveSamples(deps, stats);
  const ret = body.return ?? "count";
  const by = (body.by ?? []).map(String);
  for (const b of by) if (!BY[b]) throw new CidxError(400, "bad_request", `Cannot group by '${b}'. Use ${Object.keys(BY).join(", ")}.`);
  if (by.length > 3) throw new CidxError(400, "bad_request", "Group by at most 3 fields.");
  const samples = await readTable(deps, d.samples.key, stats);
  const soIndex = (so: number): number => {
    let a = 0;
    let b = samples.so.length;
    while (a < b) {
      const m = (a + b) >>> 1;
      if (samples.so[m] < so) a = m + 1;
      else b = m;
    }
    return a;
  };
  const cursor = await decodeCursor(body.cursor, d.version, p.digest + "|" + ret + "|" + by.join(","));

  // counts from the summary table when no per-cell range is asked for
  if (ret === "count" && !p.hasRowRanges()) {
    const h = await shardHeader(deps, d.summary.key, stats);
    const groups = new Map<string, number>();
    let total = 0;
    for (let g = 0; g < h.nGroups; g++) {
      const z = (c: string): [number, number] => {
        const j = h.names.indexOf(c);
        return j < 0 ? [0, 0xffffffff] : [h.chunks[g][j].min, h.chunks[g][j].max];
      };
      if (!p.zoneOk(z)) continue;
      const cols = await readGroup(deps, d.summary.key, h, g, ["organism", "ct", "sex", "anc", "sample", "tissue", "n"], stats);
      const n = h.groupRowsN[g];
      for (let i = 0; i < n; i++) {
        if (p.orgCodes && !p.orgCodes.has(cols.organism[i])) continue;
        if (p.ct && !p.ct[cols.ct[i]]) continue;
        if (p.tissue && !p.tissue[cols.tissue[i]]) continue;
        if (p.sex && !p.sex[cols.sex[i]]) continue;
        if (p.anc && !p.anc[cols.anc[i]]) continue;
        const so = cols.sample[i];
        if (p.exclude.has(so)) continue;
        if (p.sampleSet) {
          const s = p.sampleSet;
          let a = 0;
          let b = s.length;
          while (a < b) {
            const m = (a + b) >>> 1;
            if (s[m] < so) a = m + 1;
            else b = m;
          }
          if (a >= s.length || s[a] !== so) continue;
        }
        const w = cols.n[i];
        total += w;
        if (by.length) {
          const key = by.map((b) => (b === "study" ? samples.gse[soIndex(so)] : b === "organism" ? cols.organism[i] : cols[BY[b]][i])).join("\u0000");
          groups.set(key, (groups.get(key) ?? 0) + w);
        }
      }
    }
    return countAnswer(d, by, total, groups, true, null, stats, t0, "summary", samples, soIndex);
  }

  // row scan
  const want = new Set(p.neededColumns());
  want.add("sample");
  if (ret === "cells") {
    want.add("col");
    for (const f of body.fields ?? CELL_FIELDS) if (CELL_FIELDS.includes(f)) want.add(f);
  } else for (const b of by) if (BY[b] !== "study" && BY[b] !== "organism") want.add(BY[b]);
  const cols = [...want];
  const limit = Math.max(1, Math.min(Number(body.limit ?? limits.maxCellsPage) || limits.maxCellsPage, limits.maxCellsPage));
  if (hooks.beforeScan) await hooks.beforeScan();
  let scanned = 0;
  let total = 0;
  const groups = new Map<string, number>();
  const outCols: Record<string, number[]> = Object.fromEntries(cols.map((c) => [c, []]));
  let next: { s: number; g: number; r: number } | null = null;
  const start = cursor ? { s: cursor.s, g: cursor.g } : { s: 0, g: 0 };
  for await (const ref of candidateGroups(deps, p, start, stats)) {
    if (scanned >= limits.maxRowsScanned) {
      next = { s: ref.shard, g: ref.g, r: 0 };
      break;
    }
    const n = ref.header.groupRowsN[ref.g];
    const v = await readGroup(deps, ref.key, ref.header, ref.g, cols, stats);
    scanned += n;
    let idx = p.match(v, n);
    if (cursor && ref.shard === cursor.s && ref.g === cursor.g && cursor.r > 0) idx = idx.filter((i) => i >= cursor.r);
    if (ret === "cells") {
      const room = limit - outCols.sample.length;
      const take = idx.subarray(0, room);
      for (const c of cols) {
        const src = v[c];
        const dst = outCols[c];
        for (let k = 0; k < take.length; k++) dst.push(src[take[k]]);
      }
      if (idx.length > room) {
        next = { s: ref.shard, g: ref.g, r: idx[room] };
        break;
      }
      if (outCols.sample.length >= limit) {
        next = { s: ref.shard, g: ref.g + 1, r: 0 };
        break;
      }
    } else {
      total += idx.length;
      if (by.length) {
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          const so = v.sample[i];
          const key = by
            .map((b) => (b === "study" ? samples.gse[soIndex(so)] : b === "organism" ? samples.organism[soIndex(so)] : v[BY[b]][i]))
            .join("\u0000");
          groups.set(key, (groups.get(key) ?? 0) + 1);
        }
      }
    }
  }
  hooks.afterScan?.(scanned);
  const nextCursor = next ? await encodeCursor({ v: d.version, ...next }, p.digest + "|" + ret + "|" + by.join(",")) : null;
  if (ret === "count") return countAnswer(d, by, total, groups, next === null, nextCursor, stats, t0, "scan", samples, soIndex, scanned);
  // cells answer: so, gsm, col, decoded fields
  const so = outCols.sample;
  const res: Record<string, unknown[]> = {
    so,
    gsm: so.map((x) => `GSM${samples.gsm[soIndex(x)]}`),
    col: outCols.col,
  };
  const dec = (dict: DictEntry[], codes: number[]) => codes.map((c) => dict[c]?.id ?? dict[c]?.label ?? null);
  const score = (codes: number[]) => codes.map((c) => (c === NA8 ? null : Math.round((c / SCALE8) * 1e4) / 1e4));
  for (const c of cols) {
    if (c === "sample" || c === "col" || !(body.fields ?? CELL_FIELDS).includes(c)) continue;
    const vals = outCols[c];
    if (c === "ct") res.cell_type = dec(d.dicts.cell_type, vals);
    else if (c === "tissue") res.tissue = dec(d.dicts.tissue, vals);
    else if (c === "sex") res.sex = vals.map((x) => d.dicts.sex[x]?.label ?? "unknown");
    else if (c === "anc") res.ancestry = dec(d.dicts.ancestry, vals);
    else if (c === "ct_score") res.cell_type_score = score(vals);
    else if (c === "sex_score") res.sex_score = score(vals);
    else if (c === "anc_prob") res.ancestry_prob = score(vals);
    else res[{ umi_exon: "n_umi_exon", umi_intron: "n_umi_intron", feat_exon: "n_feat_exon", feat_intron: "n_feat_intron" }[c] ?? c] = vals;
  }
  return {
    version: d.version,
    n: so.length,
    cells: res,
    cursor: nextCursor,
    complete: next === null,
    rows_scanned: scanned,
    reads: stats.reads,
    bytes_read: stats.bytes,
    cache_hits: stats.hits,
    ms: Date.now() - t0,
  };
}

function countAnswer(
  d: Directory,
  by: string[],
  total: number,
  groups: Map<string, number>,
  complete: boolean,
  cursor: string | null,
  stats: ReadStats,
  t0: number,
  source: string,
  samples: Record<string, Uint32Array>,
  soIndex: (so: number) => number,
  scanned = 0
): Record<string, unknown> {
  const out: Record<string, unknown> = { version: d.version, count: total, complete, cursor, source, rows_scanned: scanned, reads: stats.reads, bytes_read: stats.bytes, cache_hits: stats.hits, ms: Date.now() - t0 };
  if (by.length) {
    const rows: Record<string, unknown>[] = [];
    for (const [k, n] of groups) {
      const parts = k.split("\u0000").map(Number);
      const row: Record<string, unknown> = {};
      by.forEach((b, i) => {
        const code = parts[i];
        if (b === "sample") row.sample = `GSM${samples.gsm[soIndex(code)]}`;
        else if (b === "study") row.study = `GSE${code}`;
        else {
          const l = labelOf(d, b, code);
          row[b] = l.id ?? l.label;
          row[`${b}_label`] = l.label;
        }
      });
      row.n_cells = n;
      rows.push(row);
    }
    rows.sort((a, b) => (b.n_cells as number) - (a.n_cells as number));
    out.groups = rows.slice(0, 10_000);
    out.groups_truncated = rows.length > 10_000;
  }
  return out;
}
