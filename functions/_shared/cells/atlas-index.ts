/**
 * The atlas cell index's summary, held in memory by a Pages Function isolate (cell search, ./query.ts).
 *
 * The cell index (singlet-bio docs/format-s1-cell-index.md; served by workers/data at data.singlet.bio/s1/cidx/*) carries a summary table:
 * one row per (sample, cell type, chromosomal sex, genetic ancestry) with the number of cells, 1.5 M rows for the whole atlas in one
 * immutable 6 MB SCX object, plus a sample table (ordinal -> GSM, GSE, per-sample UMI and gene quantiles). Both are read once per isolate
 * through the edge cache (immutable, content-addressed) and decoded into typed arrays, so a cell count over the whole atlas is a scan of
 * memory, never a read of cell data. Only `s1/cidx/current.json` is re-read, at most once a minute, to pick up a new index version.
 */
import { decodeChunk, parseScxHeader } from "../../../workers/data/src/scx";
import { HANCESTRO_LABELS } from "../hancestro";
import { s1Url } from "../s1-urls";

export interface IndexDictEntry {
  code: number;
  id: string | null;
  label: string;
  anc?: string[];
}

interface IndexDirectory {
  format: string;
  format_version: number;
  version: string;
  dicts: Record<"organism" | "cell_type" | "sex" | "ancestry", IndexDictEntry[]>;
  samples: { key: string; rows: number; max_so: number };
  summary: { key: string; rows: number };
  plan: { block_size: number; blocks: Record<string, string> };
  terms?: Record<string, string>;
  totals: Record<string, number>;
  created_at?: string;
}

export interface CellIndex {
  version: string;
  created_at: string | null;
  /** dictionaries of the summary's coded columns (code = position) */
  cellTypes: IndexDictEntry[];
  sexes: IndexDictEntry[];
  ancestries: IndexDictEntry[];
  organisms: IndexDictEntry[];
  /** id -> label of every cell-type dictionary term and every ancestor they list */
  terms: Record<string, string>;
  /** summary rows */
  n: number;
  ct: Uint16Array;
  sex: Uint8Array;
  anc: Uint8Array;
  so: Uint32Array;
  cells: Uint32Array;
  /** sample table, by ordinal: GSM / GSE numbers (0 = no such ordinal), per-sample UMI and gene medians */
  maxSo: number;
  gsmOf: Uint32Array;
  gseOf: Uint32Array;
  umiQ50: Uint32Array;
  genesQ50: Uint32Array;
  /** GSM number -> ordinal */
  soOfGsm: Map<number, number>;
  /** plan blocks (per-sample object keys and matrix chunk offsets, immutable JSON): ordinal / block_size -> key */
  plan: { block_size: number; blocks: Record<string, string> };
  /** what loading cost: bytes and requests (edge-cache reads of immutable objects) */
  load: { bytes: number; requests: number; ms: number };
}

const CURRENT_TTL_MS = 60_000;
let current: { at: number; version: string } | null = null;
let memo: { version: string; index: Promise<CellIndex> } | null = null;

/** Test hook. */
export function clearCellIndexMemo(): void {
  current = null;
  memo = null;
}

export type Fetcher = (url: string, ttl: number) => Promise<Response>;

const edgeFetch: Fetcher = (url, ttl) => fetch(url, { cf: { cacheEverything: true, cacheTtl: ttl } } as RequestInit);

async function fetchOk(f: Fetcher, url: string, ttl: number): Promise<Uint8Array> {
  const res = await f(url, ttl);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Every column of an SCX object, decoded. */
export function decodeScxTable(buf: Uint8Array): Record<string, Uint32Array> {
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
  return out;
}

async function currentVersion(f: Fetcher, now: number): Promise<string> {
  if (current && now - current.at < CURRENT_TTL_MS) return current.version;
  const doc = JSON.parse(new TextDecoder().decode(await fetchOk(f, s1Url("s1/cidx/current.json"), 60))) as { version?: string };
  if (!doc.version || !/^\d{8}T\d{4}Z-[0-9a-f]{8}$/.test(doc.version)) throw new Error("the cell index has no current version");
  current = { at: now, version: doc.version };
  return doc.version;
}

async function loadIndex(f: Fetcher, version: string): Promise<CellIndex> {
  const t0 = Date.now();
  let bytes = 0;
  const get = async (key: string, ttl: number) => {
    const b = await fetchOk(f, s1Url(key), ttl);
    bytes += b.length;
    return b;
  };
  const d = JSON.parse(new TextDecoder().decode(await get(`s1/cidx/v/${version}.json`, 86400))) as IndexDirectory;
  if (d.format !== "singlet-cidx" || d.format_version > 1) throw new Error("unsupported cell index format");
  const [sumBuf, smpBuf] = await Promise.all([get(d.summary.key, 86400), get(d.samples.key, 86400)]);
  const s = decodeScxTable(sumBuf);
  const t = decodeScxTable(smpBuf);
  const maxSo = Math.max(d.samples.max_so ?? 0, ...(t.so.length ? [t.so[t.so.length - 1]] : [0]));
  const gsmOf = new Uint32Array(maxSo + 1);
  const gseOf = new Uint32Array(maxSo + 1);
  const soOfGsm = new Map<number, number>();
  const umiQ50 = new Uint32Array(maxSo + 1);
  const genesQ50 = new Uint32Array(maxSo + 1);
  for (let i = 0; i < t.so.length; i++) {
    const so = t.so[i];
    gsmOf[so] = t.gsm[i];
    gseOf[so] = t.gse[i];
    soOfGsm.set(t.gsm[i], so);
    if (t.umi_q50) umiQ50[so] = t.umi_q50[i];
    if (t.genes_q50) genesQ50[so] = t.genes_q50[i];
  }
  // the directory's ancestry entries carry no names: the labeller's group names (as the data Worker does)
  const ancestries = d.dicts.ancestry.map((e) => (e.id && (!e.label || e.label === e.id) && HANCESTRO_LABELS[e.id] ? { ...e, label: HANCESTRO_LABELS[e.id] } : e));
  const terms = { ...(d.terms ?? {}) };
  for (const [id, name] of Object.entries(HANCESTRO_LABELS)) if (!terms[id] || terms[id] === id) terms[id] = name;
  return {
    version: d.version,
    created_at: d.created_at ?? null,
    cellTypes: d.dicts.cell_type,
    sexes: d.dicts.sex,
    ancestries,
    organisms: d.dicts.organism,
    terms,
    n: s.n.length,
    ct: Uint16Array.from(s.ct),
    sex: Uint8Array.from(s.sex),
    anc: Uint8Array.from(s.anc),
    so: s.sample,
    cells: s.n,
    maxSo,
    gsmOf,
    gseOf,
    umiQ50,
    genesQ50,
    soOfGsm,
    plan: d.plan,
    load: { bytes, requests: 4, ms: Date.now() - t0 },
  };
}

/** The current cell index, decoded (memoised per isolate; a new version is picked up within a minute). */
export async function cellIndex(opts: { fetcher?: Fetcher; now?: number } = {}): Promise<CellIndex> {
  const f = opts.fetcher ?? edgeFetch;
  const version = await currentVersion(f, opts.now ?? Date.now());
  if (!memo || memo.version !== version) {
    const p = loadIndex(f, version);
    memo = { version, index: p };
    p.catch(() => {
      if (memo?.index === p) memo = null;
    });
  }
  return memo.index;
}
