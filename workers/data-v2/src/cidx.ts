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
  dicts: Record<"organism" | "cell_type" | "tissue" | "sex" | "ancestry", DictEntry[]> & { disease?: DictEntry[]; development_stage?: DictEntry[] };
  /** sample-level property vocabularies: donor_status and sample_kind codes, perturbation bits */
  properties?: { donor_status?: Record<string, number>; perturbation?: Record<string, number>; sample_kind?: Record<string, number> };
  samples: { key: string; rows: number; max_so: number };
  summary: { key: string; rows: number };
  plan: { block_size: number; blocks: Record<string, string> };
  shards: string[];
  partitions: { organism: number; label: string; rows: number; shards: ShardEntry[] }[];
  exclude: number[];
  totals: Record<string, number>;
  /** id -> label of every dictionary term and every ancestor they list */
  terms?: Record<string, string>;
  /** registered per-cell features (spec section 4.9) */
  features?: FeatureSpec[];
  /** range field -> sample-table column prefix of its per-sample min/q10/q50/q90/max */
  sample_stats?: Record<string, string>;
}

export interface FeatureSpec {
  /** <feature_set>/<name>, or name without a set */
  id: string;
  name: string;
  feature_set: string;
  kind: "score" | "category" | "flag";
  categories: string[];
  method_version: string;
  comparable: "atlas" | "sample";
  dtype: "u8" | "u16";
  lo: number;
  hi: number;
  scale: number;
  na: number;
  thresholds: number[];
  description: string;
  /** physical shard column, f1, f2, ... */
  column: string;
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
const RANGE_NAME = /^[a-z][a-z0-9_]{0,47}(\/[a-z][a-z0-9_]{0,47})?$/;
const WHERE_KEYS = [
  "organism",
  "cell_type",
  "tissue",
  "sex",
  "ancestry",
  "samples",
  "studies",
  "donor_status",
  "perturbation",
  "sample_kind",
  "disease",
  "development_stage",
  "ranges",
  "categories",
];
const DONOR_STATUS: Record<string, number> = { healthy: 1, diseased: 2 };
const PERTURBATION_BITS: Record<string, number> = { treated: 1, genetic: 2, control: 4 };
const SAMPLE_KINDS: Record<string, number> = { primary: 1, cell_line: 2, stem_cell: 3, organoid: 4, xenograft: 5 };

export interface Where {
  organism?: string;
  cell_type?: string | string[];
  tissue?: string | string[];
  sex?: string | string[];
  ancestry?: string | string[];
  samples?: string[];
  studies?: string[];
  donor_status?: string | string[];
  perturbation?: string | string[];
  sample_kind?: string | string[];
  disease?: string | string[];
  development_stage?: string | string[];
  ranges?: Record<string, [number | null, number | null]>;
  /** category features: {feature id or name: [category, ...]} */
  categories?: Record<string, string[]>;
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

/** The code a score bound compares against: the code the bound's value is stored as (round half up). Same as singlet.v2.atlas.q8_threshold. */
export function q8Code(v: number): number {
  return Math.floor(v * SCALE8 + 0.5);
}

/** The code a feature bound compares against (FeatureSpec.bound). */
export function featureCode(f: FeatureSpec, v: number): number {
  return Math.floor(((v - f.lo) / (f.hi - f.lo)) * f.scale + 0.5);
}

/** lowbias32 (C. Wellons), as singlet.v2.atlas._mix32. */
export function mix32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** The sampling key: mix32(mix32(seed ^ a) ^ b), u32 (singlet.v2.atlas.hash32). */
export function hash32(seed: number, a: number, b: number): number {
  return mix32((mix32((seed ^ a) >>> 0) ^ b) >>> 0);
}
export const CHUNK_SALT = 0x5bd1e995;

export class QueryPlan {
  orgCodes: Set<number> | null = null;
  ct: Uint8Array | null = null;
  tissue: Uint8Array | null = null;
  anc: Uint8Array | null = null;
  sex: Uint8Array | null = null;
  /** [query name, shard columns, lo code, hi code] */
  ranges: [string, string[], number, number][] = [];
  sampleSet: Uint32Array | null = null; // sorted
  exclude: Set<number>;
  /** feature id -> spec */
  features: Map<string, FeatureSpec>;
  /** bare feature name -> id, when the name is unique */
  alias = new Map<string, string>();
  /** category filters: [shard column, allowed codes] */
  cats: [string, Uint8Array][] = [];
  /** a hash of the normalised query, bound into cursors */
  digest = "";

  constructor(
    readonly d: Directory,
    readonly where: Where
  ) {
    const w = where ?? {};
    for (const k of Object.keys(w)) if (!WHERE_KEYS.includes(k)) throw new CidxError(400, "bad_request", `Unknown filter '${k}'.`);
    this.features = new Map((d.features ?? []).map((f) => [f.id ?? f.name, f]));
    const byName = new Map<string, FeatureSpec[]>();
    for (const f of this.features.values()) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
    for (const [n, fs] of byName) if (fs.length === 1 && !this.features.has(n)) this.alias.set(n, fs[0].id ?? fs[0].name);
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
      if (!RANGE_NAME.test(k)) throw new CidxError(400, "bad_request", `'${k}' is not a field name.`);
      const [lo, hi] = Array.isArray(v) ? v : [v as unknown as number, null];
      if ((lo !== null && lo !== undefined && !Number.isFinite(Number(lo))) || (hi !== null && hi !== undefined && !Number.isFinite(Number(hi)))) {
        throw new CidxError(400, "bad_request", `ranges.${k} must be [min, max] numbers or null.`);
      }
      const f = this.feature(k);
      if (RANGE_FIELDS[k]) {
        let a: number;
        let b: number;
        if (SCORE_FIELDS.has(k)) {
          a = lo == null ? 0 : q8Code(Number(lo));
          b = hi == null ? SCALE8 : Math.min(SCALE8, q8Code(Number(hi)));
        } else {
          a = lo == null ? 0 : Math.ceil(Number(lo));
          b = hi == null ? Number.MAX_SAFE_INTEGER : Math.floor(Number(hi));
        }
        this.ranges.push([k, RANGE_FIELDS[k], a, b]);
      } else if (f && f.kind !== "category") {
        const a = lo == null ? 0 : Math.max(0, featureCode(f, Number(lo)));
        const b = hi == null ? f.scale : Math.min(f.scale, featureCode(f, Number(hi)));
        this.ranges.push([f.id ?? f.name, [f.column], a, b]);
      } else {
        throw new CidxError(400, "bad_request", `Unknown range field '${k}'. Use ${[...Object.keys(RANGE_FIELDS), ...this.features.keys()].join(", ")}.`);
      }
    }
    for (const [k, vals] of Object.entries(w.categories ?? {})) {
      const f = this.feature(k);
      if (!f || f.kind !== "category") throw new CidxError(400, "bad_request", `'${k}' is not a registered category feature.`);
      const m = new Uint8Array(65536);
      for (const v of asList(vals) ?? []) {
        const i = f.categories.indexOf(v);
        if (i < 0) throw new CidxError(400, "bad_request", `${f.id}: unknown category '${v}' (use ${f.categories.slice(0, 20).join(", ")}).`);
        m[i] = 1;
      }
      this.cats.push([f.column, m]);
    }
    this.exclude = new Set(d.exclude ?? []);
    this.digest = JSON.stringify(w);
  }

  feature(k: string): FeatureSpec | undefined {
    return this.features.get(k) ?? this.features.get(this.alias.get(k) ?? "");
  }

  /** Samples allowed by the sample-level property filters (singlet.v2.atlas._Plan._property_mask), or null when none is given. */
  propertyMask(t: Record<string, Uint32Array>): Uint8Array | null {
    const w = this.where ?? {};
    const props = this.d.properties ?? {};
    const n = t.so.length;
    let m: Uint8Array | null = null;
    const and = (x: Uint8Array) => {
      if (!m) m = x;
      else for (let i = 0; i < n; i++) m[i] &= x[i];
    };
    const codeFilter = (key: "donor_status" | "sample_kind", col: string, lut: Record<string, number>) => {
      const vals = asList(w[key]);
      if (!vals) return;
      const codes = new Set<number>();
      for (const v of vals) {
        const lv = v.toLowerCase();
        if (lv === "unknown") codes.add(0);
        else if (lut[lv] !== undefined) codes.add(lut[lv]);
        else throw new CidxError(400, "bad_request", `${key} is one of ${Object.keys(lut).join(", ")} or unknown.`);
      }
      const x = new Uint8Array(n);
      for (let i = 0; i < n; i++) x[i] = codes.has(t[col][i]) ? 1 : 0;
      and(x);
    };
    codeFilter("donor_status", "donor", props.donor_status ?? DONOR_STATUS);
    codeFilter("sample_kind", "kind", props.sample_kind ?? SAMPLE_KINDS);
    const pv = asList(w.perturbation);
    if (pv) {
      const bits = props.perturbation ?? PERTURBATION_BITS;
      let want = 0;
      let unknown = false;
      for (const v of pv) {
        const lv = v.toLowerCase();
        if (lv === "unknown") unknown = true;
        else if (bits[lv] !== undefined) want |= bits[lv];
        else throw new CidxError(400, "bad_request", `perturbation is one of ${Object.keys(bits).join(", ")} or unknown.`);
      }
      const x = new Uint8Array(n);
      for (let i = 0; i < n; i++) x[i] = (t.perturb[i] & want) !== 0 || (unknown && t.perturb[i] === 0) ? 1 : 0;
      and(x);
    }
    for (const [key, col] of [
      ["disease", "disease"],
      ["development_stage", "dev_stage"],
    ] as const) {
      const vals = asList(w[key]);
      if (!vals) continue;
      const entries = this.d.dicts[key] ?? [{ code: 0, id: null, label: "unknown", anc: [] }];
      const codes = new Set(dictCodes(entries, vals, true, this.d.terms ?? {}));
      const x = new Uint8Array(n);
      for (let i = 0; i < n; i++) x[i] = codes.has(t[col][i]) ? 1 : 0;
      and(x);
    }
    return m;
  }

  private mask(entries: DictEntry[], wanted: string[] | null, size: number): Uint8Array | null {
    if (!wanted) return null;
    const m = new Uint8Array(size);
    for (const c of dictCodes(entries, wanted, true, this.d.terms ?? {})) m[c] = 1;
    return m;
  }

  async resolveSamples(deps: Deps, stats?: ReadStats): Promise<void> {
    await this.resolveSampleList(deps, stats);
    const props = ["donor_status", "perturbation", "sample_kind", "disease", "development_stage"] as const;
    if (!props.some((k) => asList((this.where ?? {})[k]))) return;
    const t = await readTable(deps, this.d.samples.key, stats);
    const pm = this.propertyMask(t)!;
    const allowed: number[] = [];
    for (let i = 0; i < t.so.length; i++) if (pm[i]) allowed.push(t.so[i]);
    allowed.sort((a, b) => a - b);
    const cur = this.sampleSet;
    this.sampleSet = Uint32Array.from(cur ? allowed.filter((so) => this.sampleOverlap(so, so)) : allowed);
  }

  private async resolveSampleList(deps: Deps, stats?: ReadStats): Promise<void> {
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

  /**
   * Per-ordinal mask of the samples that can hold matching cells: organism, sample/study set, exclusions, and ranges the per-sample
   * min/max rule out (singlet.v2.atlas._Plan.samples_ok).
   */
  samplesOk(t: Record<string, Uint32Array>): Uint8Array {
    const ok = new Uint8Array((this.d.samples.max_so ?? 0) + 2);
    const stat = this.d.sample_stats ?? {};
    const rangeStats = this.ranges
      .map(([k, , a, b]) => ({ pre: stat[k], a, b, feature: t[`${stat[k]}_n`] !== undefined }))
      .filter((r) => r.pre && t[`${r.pre}_min`] !== undefined);
    for (let i = 0; i < t.so.length; i++) {
      const so = t.so[i];
      if (this.orgCodes && !this.orgCodes.has(t.organism[i])) continue;
      if (this.exclude.has(so)) continue;
      if (this.sampleSet && !this.sampleOverlap(so, so)) continue;
      let good = true;
      for (const r of rangeStats) {
        if (t[`${r.pre}_max`][i] < r.a || t[`${r.pre}_min`][i] > r.b || (r.feature && t[`${r.pre}_n`][i] === 0)) {
          good = false;
          break;
        }
      }
      if (good && so < ok.length) ok[so] = 1;
    }
    return ok;
  }

  hasRowRanges(): boolean {
    return this.ranges.length > 0 || this.cats.length > 0;
  }

  private static overlaps(m: Uint8Array | null, lo: number, hi: number): boolean {
    if (!m) return true;
    for (let c = lo; c <= hi && c < m.length; c++) if (m[c]) return true;
    return false;
  }

  sampleOverlap(lo: number, hi: number): boolean {
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
    for (const [col, m] of this.cats) if (!QueryPlan.overlaps(m, ...z(col))) return false;
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
    for (const [col] of this.cats) need.add(col);
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
      for (let c = 0; c < this.cats.length && ok; c++) ok = this.cats[c][1][cols[this.cats[c][0]][i]] === 1;
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

/** Shards a query can touch (directory zone maps, postings for small sample sets), and the postings. */
export async function candidateShards(deps: Deps, p: QueryPlan, start: { s: number }, stats?: ReadStats): Promise<{ shards: ShardEntry[]; postings: Map<number, [number, number][]> | null }> {
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
  return { shards, postings };
}

/** Candidate row groups in directory order, starting at cursor (shard, group). Reads shard headers 6 at a time. */
export async function* candidateGroups(deps: Deps, p: QueryPlan, start: { s: number; g: number }, stats?: ReadStats): AsyncGenerator<GroupRef> {
  const { shards, postings } = await candidateShards(deps, p, start, stats);
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

/** Opaque cursor: {v: version, q: query digest, ...position}; rejected for another query or version. */
export async function encodeCursor(pos: Record<string, number>, version: string, digest: string): Promise<string> {
  return b64url(JSON.stringify({ v: version, q: await qhash(digest), ...pos }));
}

export async function decodeCursor(s: unknown, version: string, digest: string, fields: string[]): Promise<Record<string, number> | null> {
  if (s === undefined || s === null || s === "") return null;
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(unb64url(String(s))) as Record<string, unknown>;
  } catch {
    throw new CidxError(400, "bad_cursor", "The cursor is not valid.");
  }
  if (c.v !== version || c.q !== (await qhash(digest))) throw new CidxError(400, "bad_cursor", "The cursor belongs to another query or index version.");
  const out: Record<string, number> = {};
  for (const f of fields) {
    const x = c[f];
    if (!Number.isInteger(x) || (x as number) < 0) throw new CidxError(400, "bad_cursor", "The cursor is not valid.");
    out[f] = x as number;
  }
  return out;
}

// ── costs ───────────────────────────────────────────────────────────────────

/** Cloudflare list prices, 2026-10-23 (singlet-bio docs/format-v2-cell-index-costs.md). Same as singlet.v2.atlas.PRICE. */
export const PRICE = { request: 0.3e-6, cpuMs: 0.02e-6, classB: 0.36e-6, doRequest: 0.15e-6, doRowWrite: 1e-6 };
export const CPU_MS_PER_1K_ROWS = 0.25;
export const CPU_MS_PER_MB = 1.0;
export const CPU_MS_FIXED = 5.0;

export interface CostEstimate {
  reads: number;
  fills: number;
  rows: number;
  mb: number;
  cpu_ms: number;
  usd: number;
}

/** Worst case of one request: every read misses the cache and may start one cache fill (singlet.v2.atlas.estimate_cost). */
export function estimateCost(o: { reads?: number; rows?: number; mb?: number; doCalls?: number; doWrites?: number; fills?: number }): CostEstimate {
  const reads = o.reads ?? 0;
  const fills = o.fills ?? reads;
  const rows = o.rows ?? 0;
  const mb = o.mb ?? 0;
  const cpu = CPU_MS_FIXED + (rows / 1000) * CPU_MS_PER_1K_ROWS + mb * CPU_MS_PER_MB;
  const usd = PRICE.request + cpu * PRICE.cpuMs + (reads + fills) * PRICE.classB + (o.doCalls ?? 0) * PRICE.doRequest + (o.doWrites ?? 0) * PRICE.doRowWrite;
  return { reads, fills, rows, mb: Math.round(mb * 1000) / 1000, cpu_ms: Math.round(cpu * 10) / 10, usd };
}

/** The cost a finished request actually incurred, from its read stats (cache misses only; each miss counted with a possible fill). */
export function actualCost(stats: ReadStats, rows: number, mb: number, doCalls: number): CostEstimate {
  const misses = Math.max(0, stats.reads - stats.hits);
  return estimateCost({ reads: misses, fills: misses, rows, mb, doCalls });
}

// ── POST /v2/cidx/query ─────────────────────────────────────────────────────

export interface QueryLimits {
  /** rows decoded per request before a count is returned partial with a cursor, or a sample is refused with a plan */
  maxRowsScanned: number;
  /** cells per answer */
  maxCells: number;
  /** studies a cell answer may draw from */
  maxStudies: number;
  /** worst-case cost of one request, USD */
  maxCostUsd: number;
}

export interface QueryBody {
  version?: string;
  where?: Where;
  return?: "count" | "cells";
  by?: string[];
  cursor?: string;
  fields?: string[];
  /** cells: sample size (<= maxCells) */
  n?: number;
  seed?: number;
  max_studies?: number;
  study_rank?: "cells" | "given" | "random";
  sampling?: "uniform" | "chunks";
  /** answer with the plan and its worst-case cost instead of running it */
  dry_run?: boolean;
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
  /** called with the rows the scan decoded and the worst-case cost of what it read */
  afterScan?: (rows: number, usd: number) => void;
}

/** A request the Worker will not run within its per-request budget, with what the caller can run instead (spec section 8.2). */
export class OverBudget extends CidxError {
  constructor(
    message: string,
    readonly plan: Record<string, unknown>
  ) {
    super(413, "over_budget", message);
  }
}

function pyLiteral(v: unknown): string {
  return JSON.stringify(v ?? {})
    .replace(/\bnull\b/g, "None")
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False");
}

export function clientPlan(d: Directory, kind: "query" | "sample" | "gather", body: Record<string, unknown>, estimate: CostEstimate, budget: number, reason: string, shards: ShardEntry[] = []): Record<string, unknown> {
  const where = pyLiteral((body as { where?: unknown }).where ?? {});
  const v = JSON.stringify(d.version);
  const py =
    kind === "gather"
      ? `from singlet.v2 import atlas\n# smaller requests (each within the budget), batched by the client:\nadata = atlas.gather(cells, batch_cells=2000, batch_studies=2)`
      : kind === "sample"
        ? `from singlet.v2 import atlas\nidx = atlas.Index.open(${v})   # immutable index objects, read with ranged GETs\ndf, info = idx.sample_cells(${where}, n=${Number(body.n ?? 10000)}, seed=${Number(body.seed ?? 0)}, max_studies=${Number(body.max_studies ?? 10)})`
        : `from singlet.v2 import atlas\nidx = atlas.Index.open(${v})\nn = idx.count(${where}, by=${pyLiteral(body.by ?? [])})`;
  return {
    reason,
    kind,
    version: d.version,
    budget_usd: budget,
    estimate,
    shards: shards.slice(0, 200).map((s) => ({ key: s.key, bytes: s.bytes, rows: s.rows })),
    shards_total: shards.length,
    python: py,
    note: "Every object named here is immutable and cacheable; a client can read them itself (GET with Range) or narrow the request.",
  };
}

interface SampledRow {
  h: number;
  so: number;
  col: number;
  vals: number[];
}

/** keyed comparison (h, so, col) */
function keyLess(a: SampledRow, b: SampledRow): boolean {
  return a.h !== b.h ? a.h < b.h : a.so !== b.so ? a.so < b.so : a.col < b.col;
}

/** A bounded max-heap: keeps the n smallest keys seen (streaming bottom-n sample with O(n) memory). */
class BottomN {
  heap: SampledRow[] = [];
  constructor(readonly n: number) {}
  offer(r: SampledRow): void {
    const hp = this.heap;
    if (hp.length < this.n) {
      hp.push(r);
      let i = hp.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keyLess(hp[p], hp[i])) {
          [hp[p], hp[i]] = [hp[i], hp[p]];
          i = p;
        } else break;
      }
    } else if (this.n > 0 && keyLess(r, hp[0])) {
      hp[0] = r;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const rr = l + 1;
        let m = i;
        if (l < hp.length && keyLess(hp[m], hp[l])) m = l;
        if (rr < hp.length && keyLess(hp[m], hp[rr])) m = rr;
        if (m === i) break;
        [hp[m], hp[i]] = [hp[i], hp[m]];
        i = m;
      }
    }
  }
  /** would `r` enter the heap? (cheap pre-check before building a row) */
  admits(h: number, so: number, col: number): boolean {
    if (this.heap.length < this.n) return true;
    const t = this.heap[0];
    return h !== t.h ? h < t.h : so !== t.so ? so < t.so : col < t.col;
  }
}

export async function runQuery(deps: Deps, body: QueryBody, limits: QueryLimits, hooks: ScanHooks = {}): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const stats = newStats();
  const d = await openDirectory(deps, body.version, stats);
  const p = new QueryPlan(d, body.where ?? {});
  await p.resolveSamples(deps, stats);
  const ret = body.return ?? "count";
  if (ret !== "count" && ret !== "cells") throw new CidxError(400, "bad_request", "`return` is 'count' or 'cells'.");
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
  const soOk = p.samplesOk(samples);
  if (ret === "cells") return runSample(deps, d, p, body, limits, hooks, stats, samples, soIndex, soOk, t0);

  const cursor = await decodeCursor(body.cursor, d.version, p.digest + "|count|" + by.join(","), ["s", "g", "r"]);
  // counts from the summary table when no per-cell range is asked for
  if (!p.hasRowRanges()) {
    const groups = new Map<string, number>();
    let total = 0;
    await scanSummary(deps, d, p, soOk, stats, (cols, i) => {
      const so = cols.sample[i];
      const w = cols.n[i];
      total += w;
      if (by.length) {
        const key = by.map((b) => (b === "study" ? samples.gse[soIndex(so)] : b === "organism" ? cols.organism[i] : cols[BY[b]][i])).join("\u0000");
        groups.set(key, (groups.get(key) ?? 0) + w);
      }
    });
    return countAnswer(d, by, total, groups, true, null, stats, t0, "summary", samples, soIndex, 0);
  }

  // row scan, bounded by maxRowsScanned (the rest continues with the cursor)
  const { shards: cand } = await candidateShards(deps, p, { s: cursor?.s ?? 0 }, stats);
  const rowsMax = Math.min(limits.maxRowsScanned, cand.reduce((k, sh) => k + sh.rows, 0));
  const est = estimateCost({ reads: Math.ceil(rowsMax / Math.max(1, d.group_rows)) + 2 * Math.min(cand.length, 64) + 8, rows: rowsMax, doCalls: 2, doWrites: 1 });
  if (body.dry_run || est.usd > limits.maxCostUsd) {
    const shards = cand;
    const plan = clientPlan(d, "query", body as Record<string, unknown>, est, limits.maxCostUsd, body.dry_run ? "dry run" : "the row budget of one request costs more than the per-request budget", shards);
    if (body.dry_run) return { version: d.version, dry_run: true, plan };
    throw new OverBudget("This count would exceed the per-request budget.", plan);
  }
  if (hooks.beforeScan) await hooks.beforeScan();
  const want = new Set(p.neededColumns());
  for (const b of by) if (BY[b] !== "study" && BY[b] !== "organism") want.add(BY[b]);
  const cols = [...want];
  let scanned = 0;
  let total = 0;
  const groups = new Map<string, number>();
  let next: { s: number; g: number; r: number } | null = null;
  for await (const ref of candidateGroups(deps, p, cursor ? { s: cursor.s, g: cursor.g } : { s: 0, g: 0 }, stats)) {
    if (scanned >= limits.maxRowsScanned) {
      next = { s: ref.shard, g: ref.g, r: 0 };
      break;
    }
    const n = ref.header.groupRowsN[ref.g];
    const v = await readGroup(deps, ref.key, ref.header, ref.g, cols, stats);
    scanned += n;
    const idx = p.match(v, n);
    total += idx.length;
    if (by.length) {
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const so = v.sample[i];
        const key = by.map((b) => (b === "study" ? samples.gse[soIndex(so)] : b === "organism" ? samples.organism[soIndex(so)] : v[BY[b]][i])).join("\u0000");
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
    }
  }
  hooks.afterScan?.(scanned, estimateCost({ reads: stats.reads, rows: scanned, doCalls: 2, doWrites: 1 }).usd);
  const nextCursor = next ? await encodeCursor(next, d.version, p.digest + "|count|" + by.join(",")) : null;
  return countAnswer(d, by, total, groups, next === null, nextCursor, stats, t0, "scan", samples, soIndex, scanned);
}

/** Walk the summary rows matching the non-range filters and the sample mask; `each(cols, i)` per row. */
async function scanSummary(deps: Deps, d: Directory, p: QueryPlan, soOk: Uint8Array, stats: ReadStats, each: (cols: Record<string, Uint32Array>, i: number) => void): Promise<void> {
  const h = await shardHeader(deps, d.summary.key, stats);
  for (let g = 0; g < h.nGroups; g++) {
    const z = (c: string): [number, number] => {
      const j = h.names.indexOf(c);
      return j < 0 ? [0, 0xffffffff] : [h.chunks[g][j].min, h.chunks[g][j].max];
    };
    // ranges are per cell: the summary prunes on everything else
    const saved = p.ranges;
    p.ranges = [];
    const ok = p.zoneOk(z);
    p.ranges = saved;
    if (!ok) continue;
    const cols = await readGroup(deps, d.summary.key, h, g, ["organism", "ct", "sex", "anc", "sample", "tissue", "n"], stats);
    const n = h.groupRowsN[g];
    for (let i = 0; i < n; i++) {
      if (p.orgCodes && !p.orgCodes.has(cols.organism[i])) continue;
      if (p.ct && !p.ct[cols.ct[i]]) continue;
      if (p.tissue && !p.tissue[cols.tissue[i]]) continue;
      if (p.sex && !p.sex[cols.sex[i]]) continue;
      if (p.anc && !p.anc[cols.anc[i]]) continue;
      if (!soOk[cols.sample[i]]) continue;
      each(cols, i);
    }
  }
}

interface RankedStudy {
  gse: number;
  eligible_max: number;
  samples: number[];
}

/** Studies with possibly matching cells, best first (singlet.v2.atlas.Index._rank). */
async function rankStudies(deps: Deps, d: Directory, p: QueryPlan, soOk: Uint8Array, stats: ReadStats, samples: Record<string, Uint32Array>, soIndex: (so: number) => number, rank: string, seed: number): Promise<RankedStudy[]> {
  const cells = new Map<number, number>();
  const per = new Map<number, Set<number>>();
  await scanSummary(deps, d, p, soOk, stats, (cols, i) => {
    const so = cols.sample[i];
    const g = samples.gse[soIndex(so)];
    cells.set(g, (cells.get(g) ?? 0) + cols.n[i]);
    let s = per.get(g);
    if (!s) per.set(g, (s = new Set()));
    s.add(so);
  });
  const out: RankedStudy[] = [];
  for (const [g, n] of cells) if (n > 0) out.push({ gse: g, eligible_max: n, samples: [...per.get(g)!].sort((a, b) => a - b) });
  if (rank === "cells") out.sort((a, b) => b.eligible_max - a.eligible_max || a.gse - b.gse);
  else if (rank === "random") {
    const key = new Map(out.map((r) => [r.gse, hash32(seed, r.gse, 0x9e3779b9)]));
    out.sort((a, b) => key.get(a.gse)! - key.get(b.gse)! || a.gse - b.gse);
  } else if (rank === "given") {
    const given = asList(p.where.studies);
    if (!given) throw new CidxError(400, "bad_request", "study_rank 'given' needs the studies filter, in order of relevance.");
    const pos = new Map<number, number>();
    given.forEach((g, i) => {
      const m = GSE_RE.exec(g.toUpperCase());
      if (m && !pos.has(Number(m[1]))) pos.set(Number(m[1]), i);
    });
    out.sort((a, b) => (pos.get(a.gse) ?? given.length) - (pos.get(b.gse) ?? given.length));
  } else throw new CidxError(400, "bad_request", "study_rank is 'cells', 'given' or 'random'.");
  return out;
}

/** `return: "cells"`: a seeded sample of at most n cells from at most max_studies studies (spec 6.3). */
async function runSample(
  deps: Deps,
  d: Directory,
  p: QueryPlan,
  body: QueryBody,
  limits: QueryLimits,
  hooks: ScanHooks,
  stats: ReadStats,
  samples: Record<string, Uint32Array>,
  soIndex: (so: number) => number,
  soOk: Uint8Array,
  t0: number
): Promise<Record<string, unknown>> {
  const n = Math.floor(Number(body.n ?? limits.maxCells));
  const maxStudies = Math.floor(Number(body.max_studies ?? limits.maxStudies));
  if (!(n >= 1) || n > limits.maxCells) throw new CidxError(400, "bad_request", `n is 1..${limits.maxCells} cells per request; ask again with the cursor for more.`);
  if (!(maxStudies >= 1) || maxStudies > limits.maxStudies) throw new CidxError(400, "bad_request", `max_studies is 1..${limits.maxStudies} per request.`);
  const seed = Number(body.seed ?? 0) >>> 0;
  const sampling = body.sampling ?? "uniform";
  if (sampling !== "uniform" && sampling !== "chunks") throw new CidxError(400, "bad_request", "sampling is 'uniform' or 'chunks'.");
  const rank = body.study_rank ?? "cells";
  const digest = `${p.digest}|cells|${seed}|${maxStudies}|${rank}|${sampling}`;
  const cursor = await decodeCursor(body.cursor, d.version, digest, ["h", "so", "col"]);

  const ranked = await rankStudies(deps, d, p, soOk, stats, samples, soIndex, rank, seed);
  const chosen = ranked.slice(0, maxStudies);
  const sel = new Set<number>();
  for (const r of chosen) for (const s of r.samples) sel.add(s);
  const eMax = chosen.reduce((k, r) => k + r.eligible_max, 0);
  const selArr = Uint32Array.from([...sel].sort((a, b) => a - b));
  p.sampleSet = p.sampleSet ? selArr.filter((s) => p.sampleOverlap(s, s)) : selArr;

  // budget: every eligible row of the chosen studies is decoded once
  const est = estimateCost({ reads: Math.ceil(eMax / Math.max(1, d.group_rows)) * 2 + Math.ceil(sel.size / Math.max(1, d.plan.block_size)) + 16, rows: eMax, doCalls: 2, doWrites: 1 });
  const studiesOut = ranked.slice(0, Math.max(50, maxStudies)).map((r, i) => ({ gse: `GSE${r.gse}`, eligible_max: r.eligible_max, selected: i < maxStudies }));
  if (body.dry_run || eMax > limits.maxRowsScanned || est.usd > limits.maxCostUsd) {
    const { shards } = sel.size ? await candidateShards(deps, p, { s: 0 }, stats) : { shards: [] as ShardEntry[] };
    const why = body.dry_run ? "dry run" : `the selected studies hold up to ${eMax} matching cells, more than one request may scan (${limits.maxRowsScanned}); lower max_studies or narrow the filter`;
    const plan = clientPlan(d, "sample", body as Record<string, unknown>, est, limits.maxCostUsd, why, shards);
    if (body.dry_run) return { version: d.version, dry_run: true, plan, studies: studiesOut, n_studies: ranked.length, eligible_max: eMax };
    throw new OverBudget("This sample would exceed the per-request budget.", plan);
  }
  if (hooks.beforeScan) await hooks.beforeScan();

  const fieldsWanted = (body.fields ?? [...CELL_FIELDS, ...(d.features ?? []).map((f) => f.column)]).filter((f) => CELL_FIELDS.includes(f) || (d.features ?? []).some((x) => x.column === f));
  const want = new Set(p.neededColumns());
  want.add("col");
  for (const f of fieldsWanted) want.add(f);
  const cols = [...want];
  const heap = new BottomN(n);
  let eligible = 0;
  let after = 0;
  let scanned = 0;
  // chunk units (sampling "chunks"): first_col of each chosen sample's exon matrix
  let units: Map<number, number[]> | null = null;
  if (sampling === "chunks" && sel.size) {
    units = new Map();
    const plans = await planSamples(deps, d, [...sel], stats);
    for (const [so, s] of plans) {
      const m = s.members["exon_counts.1pz"] ?? Object.values(s.members).find((x) => (x.first_col ?? []).length >= 2);
      const fc = m?.first_col && m.first_col.length >= 2 ? [...m.first_col] : [0, 2 ** 32];
      fc[fc.length - 1] = 2 ** 32;
      units.set(so, fc);
    }
  }
  const unitOf = (so: number, col: number): number => {
    const fc = units!.get(so) ?? [0, 2 ** 32];
    let a = 0;
    let b = fc.length - 1;
    while (a < b) {
      const m = (a + b + 1) >>> 1;
      if (fc[m] <= col) a = m;
      else b = m - 1;
    }
    return a;
  };
  if (sel.size) {
    for await (const ref of candidateGroups(deps, p, { s: 0, g: 0 }, stats)) {
      const nr = ref.header.groupRowsN[ref.g];
      const v = await readGroup(deps, ref.key, ref.header, ref.g, cols, stats);
      scanned += nr;
      const idx = p.match(v, nr);
      eligible += idx.length;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        const so = v.sample[i];
        const col = v.col[i];
        const h = sampling === "uniform" ? hash32(seed, so, col) : hash32((seed ^ CHUNK_SALT) >>> 0, so, unitOf(so, col));
        if (cursor && (h < cursor.h || (h === cursor.h && (so < cursor.so || (so === cursor.so && col <= cursor.col))))) continue;
        after++;
        if (!heap.admits(h, so, col)) continue;
        heap.offer({ h, so, col, vals: fieldsWanted.map((f) => v[f][i]) });
      }
    }
  }
  hooks.afterScan?.(scanned, estimateCost({ reads: stats.reads, rows: scanned, doCalls: 2, doWrites: 1 }).usd);
  const rows = heap.heap.slice().sort((a, b) => (keyLess(a, b) ? -1 : 1));
  const last = rows[rows.length - 1];
  const more = after > rows.length;
  const nextCursor = more && last ? await encodeCursor({ h: last.h, so: last.so, col: last.col }, d.version, digest) : null;
  rows.sort((a, b) => a.so - b.so || a.col - b.col);

  const res: Record<string, unknown[]> = {
    so: rows.map((r) => r.so),
    gsm: rows.map((r) => `GSM${samples.gsm[soIndex(r.so)]}`),
    col: rows.map((r) => r.col),
  };
  const dec = (dict: DictEntry[], c: number) => dict[c]?.id ?? dict[c]?.label ?? null;
  const score = (c: number) => (c === NA8 ? null : Math.round((c / SCALE8) * 1e4) / 1e4);
  fieldsWanted.forEach((f, j) => {
    const vals = rows.map((r) => r.vals[j]);
    const feat = (d.features ?? []).find((x) => x.column === f);
    if (feat && feat.kind === "category") res[feat.id ?? feat.name] = vals.map((c) => (c === feat.na ? null : (feat.categories[c] ?? null)));
    else if (feat) res[feat.id ?? feat.name] = vals.map((c) => (c === feat.na ? null : Math.round((feat.lo + (c / feat.scale) * (feat.hi - feat.lo)) * 1e6) / 1e6));
    else if (f === "ct") res.cell_type = vals.map((c) => dec(d.dicts.cell_type, c));
    else if (f === "tissue") res.tissue = vals.map((c) => dec(d.dicts.tissue, c));
    else if (f === "sex") res.sex = vals.map((c) => d.dicts.sex[c]?.label ?? "unknown");
    else if (f === "anc") res.ancestry = vals.map((c) => dec(d.dicts.ancestry, c));
    else if (f === "ct_score") res.cell_type_score = vals.map(score);
    else if (f === "sex_score") res.sex_score = vals.map(score);
    else if (f === "anc_prob") res.ancestry_prob = vals.map(score);
    else res[{ umi_exon: "n_umi_exon", umi_intron: "n_umi_intron", feat_exon: "n_feat_exon", feat_intron: "n_feat_intron" }[f] ?? f] = vals;
  });
  return {
    version: d.version,
    n: rows.length,
    cells: res,
    eligible,
    eligible_max: eMax,
    remaining: after - rows.length,
    sampled: eligible > rows.length,
    seed,
    sampling,
    study_rank: rank,
    n_studies: ranked.length,
    studies: studiesOut,
    cursor: nextCursor,
    complete: !nextCursor,
    rows_scanned: scanned,
    reads: stats.reads,
    bytes_read: stats.bytes,
    cache_hits: stats.hits,
    estimate: est,
    cost: actualCost(stats, scanned, 0, 2),
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
  const out: Record<string, unknown> = {
    version: d.version,
    count: total,
    complete,
    cursor,
    source,
    rows_scanned: scanned,
    reads: stats.reads,
    bytes_read: stats.bytes,
    cache_hits: stats.hits,
    cost: actualCost(stats, scanned, 0, source === "scan" ? 2 : 0),
    ms: Date.now() - t0,
  };
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
