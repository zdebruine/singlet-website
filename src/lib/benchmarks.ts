/**
 * Benchmark pages: types for the results JSON, the loader, and pass/fail evaluation.
 * One result file per capability at /data/benchmarks/<slug>.json. A missing or unreadable file means
 * "benchmark in progress"; nothing is ever filled in for it.
 */

export const RESULTS_BASE = "/data/benchmarks";
export const NOTEBOOK_URL = `${RESULTS_BASE}/singlet-benchmarks.ipynb`;
export const REPO_URL = "https://github.com/Singlet-Bio/singlet";

export interface BenchSeries {
  tool: string;
  /** True for the Singlet series (drawn in the brand colour). */
  singlet?: boolean;
  points: { label: string; value: number }[];
}

export interface BenchPanel {
  id: string;
  title: string;
  /** "bar" = grouped bars per label; "line" = labels are ordered x positions. */
  kind: "bar" | "line";
  unit: string;
  direction: "higher" | "lower";
  series: BenchSeries[];
  note?: string;
}

export interface BenchMetric {
  name: string;
  value: number | null;
  unit?: string;
  /** Pass when value >= threshold (">=") or value <= threshold ("<="). */
  threshold: number;
  comparator: ">=" | "<=";
  /** Tool the threshold is relative to, e.g. "STARsolo". */
  baseline?: string;
}

export interface BenchDataset {
  accession: string;
  label?: string;
}

export interface BenchTool {
  name: string;
  version: string;
}

export interface BenchResult {
  schema_version: 1;
  capability: string;
  generated_at: string;
  singlet_commit: string;
  tools: BenchTool[];
  datasets: BenchDataset[];
  methods: string;
  panels: BenchPanel[];
  metrics: BenchMetric[];
  /** Under 100 words. */
  conclusion: string;
  code?: { label: string; path: string }[];
}

export type MetricState = "pass" | "fail" | "pending";

export function metricState(m: BenchMetric): MetricState {
  if (m.value == null || !Number.isFinite(m.value)) return "pending";
  return (m.comparator === ">=" ? m.value >= m.threshold : m.value <= m.threshold) ? "pass" : "fail";
}

export type CapabilityState = "in_progress" | "passing" | "failing";

/** Overall state: any failing metric fails the page; every metric must be evaluated and pass. */
export function capabilityState(r: BenchResult | null): CapabilityState {
  if (!r || r.metrics.length === 0) return "in_progress";
  const states = r.metrics.map(metricState);
  if (states.includes("fail")) return "failing";
  if (states.includes("pending")) return "in_progress";
  return "passing";
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** Shape check for a result file; returns null when it is not one (e.g. the SPA's HTML fallback). */
export function parseResult(raw: unknown, slug: string): BenchResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema_version !== 1 || r.capability !== slug) return null;
  if (!isStr(r.singlet_commit) || !Array.isArray(r.panels) || !Array.isArray(r.metrics)) return null;
  if (!isStr(r.methods) || !isStr(r.conclusion) || !isStr(r.generated_at)) return null;
  if (!Array.isArray(r.tools) || !Array.isArray(r.datasets)) return null;
  return r as unknown as BenchResult;
}

export async function loadResult(slug: string, signal?: AbortSignal): Promise<BenchResult | null> {
  try {
    const res = await fetch(`${RESULTS_BASE}/${slug}.json`, { signal });
    if (!res.ok) return null;
    return parseResult(await res.json(), slug);
  } catch {
    return null;
  }
}

export function datasetUrl(accession: string): string {
  return /^GSM/i.test(accession) ? `/sample/${accession.toUpperCase()}` : `/study/${accession.toUpperCase()}`;
}

export function commitUrl(sha: string): string {
  return `${REPO_URL}/commit/${sha}`;
}

// ---------------------------------------------------------------- roadmap

export type MilestoneStatus = "done" | "active" | "upcoming";

export interface Milestone {
  id: string;
  title: string;
  summary: string;
  status: MilestoneStatus;
  /** 0-100, shown for the active milestone. */
  progress?: number;
  detail?: string;
  /** ISO date; target while not done, completion date when done. */
  date?: string;
}

export interface Roadmap {
  schema_version: 1;
  release: string;
  updated_at: string;
  milestones: Milestone[];
}

export function parseRoadmap(raw: unknown): Roadmap | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schema_version !== 1 || !isStr(r.release) || !Array.isArray(r.milestones)) return null;
  const ok = r.milestones.every((m) => {
    const x = m as Record<string, unknown> | null;
    return !!x && isStr(x.id) && isStr(x.title) && isStr(x.summary) && ["done", "active", "upcoming"].includes(x.status as string);
  });
  return ok ? (r as unknown as Roadmap) : null;
}

/** Share of milestones done; the active one counts by its own progress. */
export function roadmapProgress(r: Roadmap): number {
  if (r.milestones.length === 0) return 0;
  const sum = r.milestones.reduce(
    (a, m) => a + (m.status === "done" ? 1 : m.status === "active" ? Math.min(100, Math.max(0, m.progress ?? 0)) / 100 : 0),
    0,
  );
  return Math.round((sum / r.milestones.length) * 100);
}
