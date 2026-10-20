/**
 * Writes the bit index (layout in ./bitindex). Used by scripts/search-index/build-index.ts and by the tests.
 * No runtime imports: the builder script runs it under plain `node`, which does not resolve extensionless paths.
 */
import type { AttrSpec } from "./cohort-schema";
import type { AttrDict, IndexDict } from "./bitindex";

export type FactValue = string | number | { v: string | number; s?: string; c?: number };

export interface SampleRow {
  gsm: string;
  gse: string;
  /** Cells called. */
  cells: number;
  /** attr -> one fact or several. Missing, null and "" mean unknown. */
  facts: Record<string, FactValue | FactValue[] | null | undefined>;
}

export interface BuildOptions {
  builtAt?: string;
  /** Model facts at or above this confidence go to tier 2, the rest to tier 3. */
  modelHiConfidence?: number;
}

const FORMAT = 1;
const MAGIC = 0x58494253;
const HEADER = 32;

function tierOf(f: FactValue, core: boolean, hi: number): number {
  if (core || typeof f !== "object") return 0;
  const s = (f.s ?? "geo").toLowerCase();
  if (s === "pipeline") return 1;
  if (s === "model") return (f.c ?? 0) >= hi ? 2 : 3;
  return 0;
}

function binOf(edges: number[], x: number): number {
  if (!(x >= edges[0])) return -1;
  let lo = 0;
  let hi = edges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (edges[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function binLabel(edges: number[], b: number): string {
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
  return b + 1 < edges.length ? `${fmt(edges[b])}-${fmt(edges[b + 1])}` : `${fmt(edges[b])}+`;
}

function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

export function buildBitIndex(input: SampleRow[], attrs: AttrSpec[], opts: BuildOptions = {}): { bin: Uint8Array; dict: IndexDict } {
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error("The index is little endian; build on a little-endian host");
  const hi = opts.modelHiConfidence ?? 0.8;
  const builtAt = opts.builtAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const num = (s: string) => {
    const m = /^GSM(\d+)$/.exec(s);
    if (!m) throw new Error(`Not a GSM accession: ${s}`);
    return Number(m[1]);
  };
  const rows = input.slice().sort((a, b) => (a.gse < b.gse ? -1 : a.gse > b.gse ? 1 : num(a.gsm) - num(b.gsm)));
  const n = rows.length;
  const words = Math.ceil(n / 32);
  const studies: string[] = [];
  const studyIdx = new Uint32Array(n);
  const gsm = new Uint32Array(n);
  const cells = new Uint32Array(n);
  const studyStartList: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (i > 0 && rows[i - 1].gsm === r.gsm) throw new Error(`Duplicate sample ${r.gsm}`);
    if (studies[studies.length - 1] !== r.gse) {
      studies.push(r.gse);
      studyStartList.push(i);
    }
    studyIdx[i] = studies.length - 1;
    gsm[i] = num(r.gsm);
    cells[i] = Math.max(0, Math.round(Number(r.cells) || 0));
  }
  studyStartList.push(n);
  const studyStart = Uint32Array.from(studyStartList);

  const blobs: { at: number; data: Uint8Array }[] = [];
  let cursor = HEADER;
  const put = (data: Uint8Array): [number, number] => {
    const off = cursor;
    blobs.push({ at: off, data });
    cursor = (off + data.byteLength + 3) & ~3;
    return [off, data.byteLength];
  };
  const u8 = (a: Uint32Array | Uint16Array | Uint8Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  const sections = {
    gsm: put(u8(gsm)),
    study_idx: put(u8(studyIdx)),
    study_start: put(u8(studyStart)),
    cells: put(u8(cells)),
  };

  const attrDicts: AttrDict[] = [];
  for (const spec of attrs) {
    const core = !!spec.core;
    const numeric = spec.kind === "num";
    const edges = spec.edges ?? [];
    // value label (lower case) -> { label, per tier sample lists }
    const vals = new Map<string, { label: string; tiers: number[][]; count: number }>();
    // The value each sample's code column holds: its lowest-tier fact, first listed.
    const firstKey: (string | null)[] = new Array(n).fill(null);
    const firstTier = new Int8Array(n).fill(127);

    for (let i = 0; i < n; i++) {
      const raw = rows[i].facts[spec.key];
      if (raw == null || raw === "") continue;
      const list = Array.isArray(raw) ? raw : [raw];
      const seen = new Set<string>();
      for (const f of list) {
        const v = typeof f === "object" ? f.v : f;
        if (v == null || v === "") continue;
        let label: string;
        if (numeric) {
          const x = Number(v);
          if (!Number.isFinite(x)) continue;
          const b = binOf(edges, x);
          if (b < 0) continue;
          label = binLabel(edges, b);
        } else label = String(v).trim();
        if (!label) continue;
        const t = tierOf(f, core, hi);
        const key = label.toLowerCase();
        const dedupe = `${t}|${key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        let e = vals.get(key);
        if (!e) {
          e = { label, tiers: [[], [], [], []], count: 0 };
          vals.set(key, e);
        }
        e.tiers[t].push(i);
        if (t < firstTier[i]) {
          firstTier[i] = t;
          firstKey[i] = key;
        }
      }
    }

    // Distinct samples per value (a sample can sit in two tiers) for the frequency order.
    for (const e of vals.values()) {
      const s = new Set<number>();
      for (const t of e.tiers) for (const i of t) s.add(i);
      e.count = s.size;
    }
    let order = [...vals.entries()];
    if (numeric) {
      // Bins keep their natural order and every bin is present in the dictionary.
      const byLabel = new Map(order);
      order = edges.map((_, b) => {
        const label = binLabel(edges, b);
        return [label.toLowerCase(), byLabel.get(label.toLowerCase()) ?? { label, tiers: [[], [], [], []], count: 0 }] as [string, { label: string; tiers: number[][]; count: number }];
      });
    } else order.sort((a, b) => b[1].count - a[1].count || (a[1].label < b[1].label ? -1 : 1));
    const idOf = new Map<string, number>(order.map(([k], idx) => [k, idx]));
    if (order.length > 65534) throw new Error(`'${spec.key}' has ${order.length} distinct values (limit 65534)`);

    let code_bytes: 0 | 1 | 2 = 0;
    let code: [number, number] | null = null;
    if (!spec.multi) {
      code_bytes = order.length + 1 <= 255 ? 1 : 2;
      const col = code_bytes === 1 ? new Uint8Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) {
        const k = firstKey[i];
        if (k != null) col[i] = idOf.get(k)! + 1;
      }
      code = put(u8(col));
    }

    const tiers: [number, number, number, number][][] = [[], [], [], []];
    order.forEach(([, e], v) => {
      for (let t = 0; t < 4; t++) {
        const ids = e.tiers[t];
        if (!ids.length) continue;
        if (ids.length < words) {
          const [off, len] = put(u8(Uint32Array.from(ids)));
          tiers[t].push([v, off, len, ids.length]);
        } else {
          const w = new Uint32Array(words);
          for (const i of ids) w[i >>> 5] |= 1 << (i & 31);
          const [off, len] = put(u8(w));
          tiers[t].push([v, off, len, ids.length]);
        }
      }
    });

    attrDicts.push({
      key: spec.key,
      kind: spec.kind,
      multi: !!spec.multi,
      core,
      ...(numeric ? { edges } : {}),
      values: order.map(([, e]) => e.label),
      code_bytes,
      code,
      tiers,
    });
  }

  const total = cursor;
  const bin = new Uint8Array(total);
  const dv = new DataView(bin.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, FORMAT, true);
  dv.setUint32(8, n, true);
  dv.setUint32(12, words, true);
  dv.setUint32(16, total, true);
  for (const b of blobs) bin.set(b.data, b.at);
  const checksum = fnv1a(bin).toString(16).padStart(8, "0");
  const version = `${builtAt.slice(0, 10).replace(/-/g, "")}-${checksum}`;
  const dict: IndexDict = {
    format: FORMAT,
    index_version: version,
    built_at: builtAt,
    bin: `index.${version}.sbix`,
    n_samples: n,
    n_studies: studies.length,
    words,
    bytes: total,
    checksum,
    studies,
    sections,
    attrs: attrDicts,
  };
  return { bin, dict };
}
