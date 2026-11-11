// Beta campaign status feed: the JSON the cluster publishes to /api/hpc/beta/campaign-status.json
// (schema "campaign-status/1", Singlet-Bio/singlet-agents hpc/clipper/campaign/monitor.py). Counts and ids only.

export const CAMPAIGN_STATUS_PATH = "/api/hpc/beta/campaign-status.json";
export const CAMPAIGN_SCHEMA = "campaign-status/1";

export interface LaneUse { label: string; unit: string; running: number; queued: number; cap: number }
export interface ReasonBucket { count: number; examples: string[] }

export interface CampaignStatus {
  schema: string;
  generated_at: string;
  generated_epoch: number;
  state: "running" | "paused" | "idle";
  samples: { done: number; excluded: number; in_review: number; failed: number; queued: number; finished_total: number; known_total: number };
  failed: { count: number; reasons: Record<string, ReasonBucket> };
  review: { count: number; reasons: Record<string, number> };
  halted_pilots: { lane: string; reason: string }[];
  per_day: { date: string; done: number }[];
  hourly_24h: { hour: string; done: number }[];
  progress_24h?: { t: number; finished: number; queued: number }[];
  eta: { samples_per_day: number; basis: string; remaining_samples: number; date: string | null; days: number | null };
  network: { ceiling_gbps: number; target_share: number; target_gbps: number; active_pilots: number; downloads_paused: boolean;
    estimated_gbps: number; estimated_share: number; measured_gbps: number | null };
  lanes: Record<string, LaneUse> | null;
  disk: { free_gb: number | null; floor_gb: number; resume_gb: number; guard_on: boolean; downloads_paused: boolean };
  shipping: { shipped: number; awaiting: number | null; upload_mb_s: number; gb_sent: number; last_run: string | null; growing: boolean };
  backlog: { gpairs: number; high_gpairs: number; low_gpairs: number };
}

/** The snapshot when it has the expected schema and the blocks the page reads, else null. */
export function parseStatus(raw: unknown): CampaignStatus | null {
  const s = raw as Partial<CampaignStatus> | null;
  if (!s || s.schema !== CAMPAIGN_SCHEMA || typeof s.generated_epoch !== "number") return null;
  for (const k of ["samples", "failed", "review", "eta", "network", "disk", "shipping", "backlog", "per_day"] as const) {
    if (s[k] == null) return null;
  }
  return s as CampaignStatus;
}

export type Freshness = "fresh" | "late" | "stale";

/** Age of the data in seconds, and how worried to be: the feed runs every 10 minutes. */
export function dataAge(generatedEpoch: number, nowMs: number = Date.now()): { seconds: number; freshness: Freshness } {
  const seconds = Math.max(0, Math.round(nowMs / 1000 - generatedEpoch));
  return { seconds, freshness: seconds <= 25 * 60 ? "fresh" : seconds <= 2 * 3600 ? "late" : "stale" };
}

export function ageLabel(seconds: number): string {
  if (seconds < 90) return "under a minute ago";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.round(seconds / 360) / 10} hours ago`;
  return `${Math.round(seconds / 8640) / 10} days ago`;
}

/** Plain-language names for the reason categories the runner records. */
const REASONS: Record<string, string> = {
  "status fail_export_matrix": "the count matrix could not be written",
  "empty required": "a required output file was empty",
  "missing required": "a required output file was missing",
  unknown: "reason not recorded",
};
export function reasonLabel(key: string): string {
  return REASONS[key] ?? key;
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (100 * part) / whole)) : 0;
}

export function plainState(s: CampaignStatus["state"]): string {
  return s === "running" ? "Running" : s === "paused" ? "Downloads paused" : "Idle";
}
