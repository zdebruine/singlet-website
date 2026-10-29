/**
 * Alpha benchmarks: measurements of the files singlet.bio serves today (Research Alpha), as opposed to the Beta
 * engine results in /data/benchmarks/<capability>.json. Files live at /data/benchmarks/alpha/<id>.json.
 *
 * Dropping a file in fills its panel; no code change is needed. A panel accepts either
 *   - a results-contract document (schema "singlet.benchmark.capability", see src/lib/benchmarks.ts), or
 *   - a summary document: { title, conclusion | summary, measured_at | generated_at?, headline?: [{ label, value, detail? }],
 *     tables?: [{ title, columns: string[], rows: (string | number | null)[][], note? }], caveats?: string[], source?: { repo?, commit?, files?, code? } }.
 * Files that hold counts of samples or studies not in Alpha must be reduced to the included atlas before they are copied
 * here (docs/BENCHMARKS.md). A missing file (or the SPA's HTML fallback) shows "Benchmark running". The scBaseCount comparison has its own
 * richer shape (schema "singlet.alpha.benchmark") and its own panel.
 */
import { parseDoc, RESULTS_BASE, type BenchDoc } from "@/lib/benchmarks";

export const ALPHA_BASE = `${RESULTS_BASE}/alpha`;

/**
 * What the Alpha files do well, as measured against the authors' own Cell Ranger results on 135 Alpha samples. Each tile names
 * the pooled metric it quotes; src/test/alpha-pages.test.tsx checks every value against its file, so the page cannot drift from
 * the measurement.
 */
export const ALPHA_STRENGTHS = [
  {
    file: "alpha-cell-calling",
    metric: "cell_precision",
    value: 0.9996,
    shown: "99.96%",
    label: "of the cells Alpha calls are the authors' cells too",
    detail: "precision against the authors' Cell Ranger calls, median of 135 samples (95% CI 99.9%–100%)",
  },
  {
    file: "alpha-cell-calling",
    metric: "author_cells_in_barcode_matrix",
    value: 1,
    shown: "100%",
    label: "of the authors' cells are in the file's barcode matrix",
    detail: "every barcode with at least 100 reads is kept, so you can call cells again with your own method",
  },
  {
    file: "alpha-gex-counts",
    metric: "pseudobulk_spearman",
    value: 0.952,
    shown: "0.95",
    label: "pseudobulk Spearman ρ with the authors' matrices",
    detail: "median of 135 samples (95% CI 0.949–0.958): gene-level expression agrees with Cell Ranger",
  },
] as const;

/** The census panel: scale of the served atlas. Read usage is a known issue, so its tile is left out here. */
export const CENSUS_PANEL = {
  id: "census",
  name: "Atlas census",
  what: "Studies, samples, cells, species and chemistry across Alpha.",
  files: ["alpha-census"],
} as const;

export interface AlphaTable {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
  note?: string;
}

export interface AlphaSource {
  repo?: string;
  commit?: string;
  files?: string[];
  code?: string;
}

/** A summary document, normalised. */
export interface AlphaSummary {
  kind: "summary";
  title: string;
  conclusion: string;
  measuredAt: string | null;
  headline: { label: string; value: string; detail?: string }[];
  tables: AlphaTable[];
  caveats: string[];
  source: AlphaSource | null;
}

export type AlphaResult = AlphaSummary | { kind: "contract"; doc: BenchDoc };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const cell = (v: unknown): string | number | null => (typeof v === "number" || typeof v === "string" ? v : null);

/** Parses either accepted shape; anything else is null ("Benchmark running"). */
export function parseAlpha(raw: unknown, id: string): AlphaResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.schema === "singlet.benchmark.capability") {
    const doc = parseDoc(raw, typeof r.capability === "string" ? r.capability : id);
    return doc ? { kind: "contract", doc } : null;
  }
  const conclusion = isStr(r.conclusion) ? r.conclusion : isStr(r.summary) ? r.summary : null;
  if (!isStr(r.title) || !conclusion) return null;
  const headline = (Array.isArray(r.headline) ? r.headline : [])
    .map((h) => h as Record<string, unknown>)
    .filter((h) => h && isStr(h.label) && (isStr(h.value) || typeof h.value === "number"))
    .map((h) => ({ label: String(h.label), value: String(h.value), ...(isStr(h.detail) ? { detail: h.detail } : {}) }));
  const tables = (Array.isArray(r.tables) ? r.tables : [])
    .map((t) => t as Record<string, unknown>)
    .filter((t) => t && isStr(t.title) && Array.isArray(t.columns) && Array.isArray(t.rows))
    .map((t) => ({
      title: String(t.title),
      columns: (t.columns as unknown[]).map(String),
      rows: (t.rows as unknown[]).filter(Array.isArray).map((row) => (row as unknown[]).map(cell)),
      ...(isStr(t.note) ? { note: t.note } : {}),
    }));
  const measured = isStr(r.measured_at) ? r.measured_at : isStr(r.generated_at) ? r.generated_at : null;
  const src = r.source && typeof r.source === "object" ? (r.source as AlphaSource) : null;
  return {
    kind: "summary",
    title: r.title,
    conclusion,
    measuredAt: measured ? measured.slice(0, 10) : null,
    headline,
    tables,
    caveats: Array.isArray(r.caveats) ? r.caveats.filter(isStr) : [],
    source: src,
  };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const loadAlpha = async (id: string, signal?: AbortSignal) => parseAlpha(await getJson(`${ALPHA_BASE}/${id}.json`, signal), id);

/** Every file of a panel that exists, in order. */
export const loadAlphaPanel = async (files: readonly string[], signal?: AbortSignal) =>
  (await Promise.all(files.map((f) => loadAlpha(f, signal)))).filter((r): r is AlphaResult => !!r);

// ---------------------------------------------------------------- the scBaseCount / Cell Ranger comparison

export interface ScbcDoc {
  schema: "singlet.alpha.benchmark";
  title: string;
  measured_at: string;
  data: string;
  source: Required<Pick<AlphaSource, "repo" | "commit">> & AlphaSource;
  coverage: {
    protocols: { protocol: string; singlet: boolean; scbasecount: boolean }[];
    other: { item: string; singlet: boolean | string; scbasecount: boolean | string }[];
  };
  cell_calls: {
    against: string;
    basis: string;
    n: number;
    rows: { category: string; singlet_recovery: number; scbasecount_recovery: number; singlet_precision: number }[];
    singlet_median_recovery: number;
    singlet_recovery_range: [number, number];
    scbasecount_median_recovery: number;
    singlet_precision_range: [number, number];
    note: string;
  };
  depth: {
    samples: number;
    basis: string;
    reads_used_median: number;
    umi_ratio_median: number;
    umi_ratio_p10_p90: [number, number];
    cell_ratio_median: number;
    cell_ratio_p10_p90: [number, number];
    median_umi_per_cell: { singlet: number; scbasecount: number };
    median_genes_per_cell: { singlet: number; scbasecount: number };
    full_depth: { samples: number; umi_ratio_median: number; cell_ratio_median: number };
  };
  depth_matched: {
    note: string;
    rows: { category: string; depth_matched: number; noise_floor: number; pseudobulk_spearman: number }[];
  };
}

export function parseScbc(raw: unknown): ScbcDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== "singlet.alpha.benchmark" || !isStr(r.title)) return null;
  if (!["coverage", "cell_calls", "depth", "depth_matched", "source"].every((k) => r[k] && typeof r[k] === "object")) return null;
  return r as unknown as ScbcDoc;
}

export const loadScbc = async (signal?: AbortSignal) => parseScbc(await getJson(`${ALPHA_BASE}/scbasecount.json`, signal));

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const times = (v: number) => `${v.toFixed(2)}×`;
