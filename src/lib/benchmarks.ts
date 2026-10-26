/**
 * Benchmark pages: types for the results contract (schema 1.x, Singlet-Bio/singlet bench/public/CONTRACT.md),
 * the loaders, and the derived views (status, Pareto frontier, reach).
 * Files live at /data/benchmarks/index.json and /data/benchmarks/<capability>.json. A capability that is
 * missing from the index or has no readable file means "benchmark in progress"; nothing is filled in for it.
 */

export const RESULTS_BASE = "/data/benchmarks";
export const NOTEBOOK_URL = `${RESULTS_BASE}/singlet_benchmarks.ipynb`;
export const REPO_URL = "https://github.com/Singlet-Bio/singlet";

export type Verdict = "pass" | "fail" | "na";
/** Status as the contract defines it, plus "missing" for a capability with no file. */
export type CapabilityStatus = "pass" | "fail" | "incomplete" | "missing" | "invalid";

export interface BenchValue {
  value: number | null;
  ci?: [number, number];
}

export interface BenchMetric {
  id: string;
  name: string;
  unit: string;
  category: "accuracy" | "agreement" | "coverage" | "resources" | "robustness";
  dataset: string;
  direction: "higher" | "lower" | "none";
  singlet: BenchValue;
  competitors?: { tool: string; value: number | null; ci?: [number, number]; note?: string }[];
  rule: {
    type: "match_or_beat" | "threshold" | "equivalence" | "informational";
    against?: "best" | string[];
    value?: number;
    target?: number | string;
    tolerance?: { abs?: number; rel?: number };
    rationale?: string;
  };
  pass?: Verdict;
  notes?: string;
  /** Metrics on real data that show the same effect, for results on derived or simulated data. */
  corroborated_by?: string[];
}

export interface BenchFigure {
  id: string;
  title: string;
  caption?: string;
  kind: "bar" | "grouped_bar" | "scatter" | "line" | "box" | "histogram" | "heatmap" | "table" | "pareto";
  x?: { label?: string; unit?: string; scale?: "linear" | "log"; categories?: (string | number)[] };
  y?: { label?: string; unit?: string; scale?: "linear" | "log"; min?: number; max?: number };
  series?: { name: string; tool?: string; x?: (string | number)[]; y: number[]; frontier?: boolean }[];
  rows?: (string | number)[] | (string | number)[][];
  cols?: string[];
  columns?: string[];
  z?: number[][];
  data_file?: string;
}

export interface BenchTool {
  name: string;
  version: string;
  role: "singlet" | "competitor" | "truth" | "helper";
  url?: string;
  params?: string;
}

export interface BenchResource {
  tool: string;
  dataset?: string;
  wall_s: number;
  max_rss_gb: number;
  threads: number;
  cpu_h?: number | null;
  notes?: string;
}

/** Optional (a minor addition to the contract): which outputs each tool can produce at all. */
export interface BenchReach {
  tool: string;
  output: string;
  supported: "yes" | "no" | "partial";
  note?: string;
}

export interface BenchDoc {
  schema: "singlet.benchmark.capability";
  schema_version: string;
  capability: string;
  title: string;
  conclusion: string;
  methods: string;
  status: "draft" | "final";
  generated_at: string;
  owner: string;
  singlet: { version: string; commit: string };
  tools: BenchTool[];
  datasets: {
    id: string;
    title?: string;
    truth: string;
    data_kind?: "real" | "derived" | "simulated";
    n_cells?: number;
    accessions: { gse?: string; gsm?: string[]; srr?: string[]; url?: string };
  }[];
  metrics: BenchMetric[];
  resources: BenchResource[];
  figures?: BenchFigure[];
  reach?: BenchReach[];
  code: { path: string; url: string; role?: string }[];
  reproduce?: { module: string; function: string };
  caveats?: string[];
}

export interface BenchIndexEntry {
  capability: string;
  title: string | null;
  owner: string;
  status: CapabilityStatus;
  n_metrics: number;
  n_pass: number;
  n_fail: number;
  n_na: number;
  conclusion?: string;
  unresolved_corroboration?: string[];
}

export interface BenchIndex {
  schema: "singlet.benchmark.index";
  generated_at: string;
  overall: string;
  n_capabilities: number;
  n_pass: number;
  capabilities: BenchIndexEntry[];
}

const isStr = (v: unknown): v is string => typeof v === "string";
const major1 = (v: unknown) => isStr(v) && /^1\.\d+\.\d+$/.test(v);

/** Shape check; returns null for anything else (e.g. the SPA's HTML fallback or another major version). */
export function parseDoc(raw: unknown, capability: string): BenchDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== "singlet.benchmark.capability" || !major1(r.schema_version) || r.capability !== capability) return null;
  if (![r.title, r.conclusion, r.methods, r.generated_at].every(isStr)) return null;
  if (!["tools", "datasets", "metrics", "resources", "code"].every((k) => Array.isArray(r[k]))) return null;
  const s = r.singlet as Record<string, unknown> | undefined;
  if (!s || !isStr(s.commit)) return null;
  return r as unknown as BenchDoc;
}

export function parseIndex(raw: unknown): BenchIndex | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== "singlet.benchmark.index" || !major1(r.schema_version) || !Array.isArray(r.capabilities)) return null;
  return r as unknown as BenchIndex;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(url, { signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export const loadIndex = async (signal?: AbortSignal) => parseIndex(await getJson(`${RESULTS_BASE}/index.json`, signal));
export const loadDoc = async (capability: string, signal?: AbortSignal) =>
  parseDoc(await getJson(`${RESULTS_BASE}/${capability}.json`, signal), capability);

/** Informational metrics never gate a page. */
export const isGating = (m: BenchMetric) => m.rule.type !== "informational";

/** Same roll-up as the contract: only a final document with at least one gating metric can pass. */
export function docStatus(d: BenchDoc | null): CapabilityStatus {
  if (!d) return "missing";
  const gating = d.metrics.filter(isGating);
  if (gating.some((m) => m.pass === "fail")) return "fail";
  if (d.status === "final" && gating.length > 0 && gating.every((m) => m.pass === "pass")) return "pass";
  return "incomplete";
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function datasetLinks(d: BenchDoc["datasets"][number]): { label: string; href: string; internal: boolean }[] {
  const a = d.accessions ?? {};
  const out: { label: string; href: string; internal: boolean }[] = [];
  if (a.gse) out.push({ label: a.gse, href: `/study/${a.gse.toUpperCase()}`, internal: true });
  for (const g of a.gsm ?? []) out.push({ label: g, href: `/sample/${g.toUpperCase()}`, internal: true });
  if (a.url) out.push({ label: "source", href: a.url, internal: false });
  return out;
}

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

// ---------------------------------------------------------------- derived: Pareto and reach

export interface ParetoPoint {
  tool: string;
  singlet: boolean;
  /** Cost (wall time, CPU-hours or memory). */
  x: number;
  /** Quality. */
  y: number;
  frontier: boolean;
}

export interface Pareto {
  title: string;
  xLabel: string;
  xUnit: string;
  yLabel: string;
  direction: "higher" | "lower";
  points: ParetoPoint[];
}

/** A contract `pareto` figure: one point per tool, `frontier` set by the contract. */
export function paretoFromFigure(f: BenchFigure): Pareto | null {
  const points = (f.series ?? [])
    .filter((s) => s.x?.length && s.y.length)
    .map((s) => ({ tool: s.tool ?? s.name, singlet: (s.tool ?? s.name).toLowerCase() === "singlet", x: Number(s.x![0]), y: s.y[0], frontier: !!s.frontier }));
  if (points.length < 2) return null;
  return { title: f.title, xLabel: f.x?.label ?? "cost", xUnit: f.x?.unit ?? "", yLabel: f.y?.label ?? "quality", direction: "higher", points };
}

/**
 * Fallback for documents without a `pareto` figure: quality (the first accuracy/agreement metric with a Singlet
 * value and competitor values) against mean wall time, one point per tool. The frontier is the set of points
 * no other tool beats on both axes.
 */
export function paretoOf(d: BenchDoc): Pareto | null {
  const metric = d.metrics.find(
    (m) =>
      (m.category === "accuracy" || m.category === "agreement") &&
      m.direction !== "none" &&
      m.singlet.value != null &&
      (m.competitors ?? []).some((c) => c.value != null),
  );
  if (!metric) return null;
  const quality = new Map<string, number>([["singlet", metric.singlet.value as number]]);
  for (const c of metric.competitors ?? []) if (c.value != null) quality.set(c.tool, c.value);
  const raw: Omit<ParetoPoint, "frontier">[] = [];
  for (const [tool, q] of quality) {
    const rs = d.resources.filter((r) => r.tool === tool && (!r.dataset || r.dataset === "pooled" || r.dataset === metric.dataset));
    if (rs.length === 0) continue;
    raw.push({ tool, singlet: tool === "singlet", x: rs.reduce((a, r) => a + r.wall_s, 0) / rs.length, y: q });
  }
  if (raw.length < 2) return null;
  const sign = metric.direction === "higher" ? 1 : -1;
  const beats = (o: (typeof raw)[number], p: (typeof raw)[number]) =>
    o !== p && o.x <= p.x && sign * o.y >= sign * p.y && (o.x < p.x || sign * o.y > sign * p.y);
  const points = raw.map((p) => ({ ...p, frontier: !raw.some((o) => beats(o, p)) }));
  return { title: "Quality against runtime", xLabel: "Mean wall time", xUnit: "s", yLabel: metric.name, direction: metric.direction as "higher" | "lower", points };
}

/** The document's own pareto figures when it has any, else the derived one. */
export function paretosFor(d: BenchDoc): Pareto[] {
  const own = (d.figures ?? []).filter((f) => f.kind === "pareto").map(paretoFromFigure).filter((p): p is Pareto => !!p);
  if (own.length) return own;
  const derived = paretoOf(d);
  return derived ? [derived] : [];
}

/** Counts for a document: gating metrics only. */
export function docCounts(d: BenchDoc) {
  const g = d.metrics.filter(isGating);
  return { n_metrics: g.length, n_pass: g.filter((m) => m.pass === "pass").length, n_fail: g.filter((m) => m.pass === "fail").length };
}

/** Tools x outputs across every document that publishes `reach`. */
export function reachMatrix(docs: BenchDoc[]) {
  const entries = docs.flatMap((d) => (d.reach ?? []).map((r) => ({ capability: d.capability, ...r })));
  const tools = Array.from(new Set(entries.map((e) => e.tool)));
  const outputs = Array.from(new Map(entries.map((e) => [`${e.capability}|${e.output}`, { capability: e.capability, output: e.output }])).values());
  const cell = (tool: string, capability: string, output: string): BenchReach["supported"] | null =>
    entries.find((e) => e.tool === tool && e.capability === capability && e.output === output)?.supported ?? null;
  return { tools, outputs, cell };
}
