/**
 * Owner-only HPC dashboard (singlet.bio/HPC-dashboard): Clipper node use and Beta campaign telemetry.
 *
 * A one-core Slurm job on Clipper (singlet-agents hpc/clipper/dashboard) posts one `hpc-dashboard/1` snapshot every
 * 30 minutes to POST /api/ingest/hpc-ops. Two objects live in the HPC_DASHBOARD bucket:
 *   ops/latest.json  the newest snapshot as posted (nodes, queue, campaign headline);
 *   ops/series.json  one small `point` per snapshot, oldest first. Every point of the last 7 days is kept; older ones
 *                    thin out to one per hour, then one per 6 hours after 60 days, and go after a year.
 * GET /api/admin/hpc?range=24h|7d|all serves both to site admins (ANALYTICS_ADMINS) only.
 */

export const OPS_LATEST = "ops/latest.json";
export const OPS_SERIES = "ops/series.json";
export const OPS_MAX_BODY_BYTES = 512 * 1024;
export const OPS_SCHEMA = "hpc-dashboard/1";
export const MAX_POINTS = 6000;

export type Point = { t: string } & Record<string, number | string | null>;

const KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
const DAY = 86_400_000;

/** A point trimmed to numbers and short strings under safe keys, or null when it has no valid time. */
export function cleanPoint(raw: unknown): Point | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.t !== "string" || !Number.isFinite(Date.parse(r.t))) return null;
  const out: Point = { t: new Date(Date.parse(r.t)).toISOString().replace(/\.\d{3}Z$/, "Z") };
  for (const [k, v] of Object.entries(r)) {
    if (k === "t" || !KEY_RE.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 16);
    else if (v === null) out[k] = null;
    if (Object.keys(out).length > 40) break;
  }
  return out;
}

/** The snapshot when it has the shape the page reads, else an error message. */
export function checkSnapshot(raw: unknown): { ok: true; snap: Record<string, unknown>; point: Point } | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Body must be a JSON object" };
  const s = raw as Record<string, unknown>;
  if (s.schema !== OPS_SCHEMA) return { ok: false, error: `schema must be ${OPS_SCHEMA}` };
  if (typeof s.generated_at !== "string" || !Number.isFinite(Date.parse(s.generated_at))) return { ok: false, error: "generated_at must be a time" };
  if (!Array.isArray(s.nodes) || s.nodes.length > 400) return { ok: false, error: "nodes must be a list of at most 400" };
  const point = cleanPoint(s.point);
  if (!point) return { ok: false, error: "point.t must be a time" };
  return { ok: true, snap: s, point };
}

/** Keep every point of the last 7 days; thin older ones (hourly, then 6-hourly) and drop anything over a year old. */
export function keepPoint(t: number, now: number): boolean {
  const age = now - t;
  if (age > 365 * DAY) return false;
  if (age <= 7 * DAY) return true;
  const d = new Date(t);
  if (age <= 60 * DAY) return d.getUTCMinutes() < 30;
  return d.getUTCMinutes() < 30 && d.getUTCHours() % 6 === 0;
}

/** The series with `p` added (a point at the same time is replaced) and old points thinned, oldest first. */
export function appendPoint(series: Point[], p: Point, now: number): Point[] {
  const byT = new Map<string, Point>();
  for (const q of series) byT.set(q.t, q);
  byT.set(p.t, p);
  const out = [...byT.values()].filter((q) => q.t === p.t || keepPoint(Date.parse(q.t), now));
  out.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
}

export type Range = "24h" | "7d" | "all";
export const RANGE_MS: Record<Range, number> = { "24h": DAY, "7d": 7 * DAY, all: Infinity };

export function inRange(series: Point[], range: Range, now: number): Point[] {
  const floor = now - RANGE_MS[range];
  return series.filter((p) => Date.parse(p.t) >= floor);
}
