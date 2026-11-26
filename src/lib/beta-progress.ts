// Public Research Beta progress: GET /api/beta/progress (functions/api/beta/progress.ts). Counts only.
// The `campaign` block is the cluster's public summary (schema "campaign-public/1", singlet-agents hpc/clipper/campaign/public_feed.py).

export const BETA_PROGRESS_PATH = "/api/beta/progress";

export interface ReasonCount { reason: string; count: number }

export type ProjectionWindow = "6h" | "24h" | "7d";
export interface ProjectionCounts { total: number | null; done: number | null; remaining: number | null }
/** One sequential campaign's estimated finish (status.json projection, reduced by public_feed.py). */
export interface ProjectionCampaign {
  id: number;
  label: string;
  in_scope: boolean;
  samples: ProjectionCounts;
  pairs: ProjectionCounts;
  eta: Partial<Record<ProjectionWindow, string | null>>;
  window_actual_h?: Partial<Record<ProjectionWindow, number | null>>;
}
export interface Projection { generated_at?: string | null; campaigns: ProjectionCampaign[] }

/** One point of the queue ahead of the H100s (status.json ready_history, thinned by public_feed.py). */
export interface ReadyPoint {
  t: string;
  ready_hours_h100: number | null;
  staged_samples_h100: number | null;
  dl_gbps: number | null;
  h100_avg60_pct: number | null;
}

export interface CampaignPublic {
  schema: "campaign-public/1";
  generated_at: string;
  state: "running" | "paused" | "idle" | "stopped";
  engine: string[];
  samples: { processed: number; published: number; held: number; excluded: number; failed: number; in_review: number; awaiting_publish: number };
  studies: { published: number; held_only: number; touched: number };
  excluded_reasons: ReasonCount[];
  held_reasons: ReasonCount[];
  per_day: { date: string; published: number; processed: number }[];
  scope: { total_samples: number | null; current_class: string | null };
  /** Absent until the cluster publishes it; empty when there are no points. */
  ready_history?: ReadyPoint[];
  projection?: Projection | null;
}

export interface BetaProgress {
  schema: "beta-progress/1";
  generated_at: string;
  published: { studies: number; samples: number; cells: number; last_publish: string | null; catalog_pending?: number } | null;
  campaign: CampaignPublic | null;
  alpha: { studies: number; samples: number; cells: number } | null;
}

export function parseProgress(raw: unknown): BetaProgress | null {
  const p = raw as Partial<BetaProgress> | null;
  if (!p || p.schema !== "beta-progress/1") return null;
  const c = p.campaign as Partial<CampaignPublic> | null | undefined;
  return { ...(p as BetaProgress), campaign: c && c.schema === "campaign-public/1" && c.samples ? (c as CampaignPublic) : null };
}

/** Plain wording for the reasons the campaign records when it sets a sample aside. Unknown reasons are shown as recorded. */
const CODES: Record<string, string> = {
  no_usable_barcodes: "The reads carry no cell barcodes the engine can use (often stripped before upload)",
  unsupported_protocol: "Plate-based or other library type the engine does not support yet",
  bulk_library: "Bulk RNA-seq, not single-cell",
  atac_library: "Chromatin accessibility (ATAC) library, outside Beta's transcriptomics scope",
  feature_barcode_library: "Antibody or feature-barcode library, outside Beta's transcriptomics scope",
  reads_unavailable: "Reads not available from the archive",
  too_few_reads: "Too few usable reads",
  pooled_donors: "Pooled donors that cannot yet be told apart",
  other: "Other recorded reasons",
};
const REASONS: [RegExp, string][] = [
  [/not a barcoded library|no barcod|barcode/i, "The reads carry no cell barcodes the engine can use"],
  [/bulk/i, "Bulk RNA-seq, not single-cell"],
  [/atac/i, "Chromatin accessibility (ATAC) library, outside Beta's transcriptomics scope"],
  [/adt|antibody|feature barcod|hashtag/i, "Antibody or feature-barcode library, outside Beta's transcriptomics scope"],
  [/multiplex|mux|donor/i, "Pooled donors that cannot yet be separated"],
  [/download|unavailable|sra|missing reads|no runs/i, "Reads not available from the archive"],
  [/too few|low (reads|cells|quality)|empty/i, "Too few usable reads or cells"],
  [/protocol|chemistry|unsupported/i, "Library type the engine does not support yet"],
];
export function reasonLabel(raw: string): string {
  if (CODES[raw]) return CODES[raw];
  for (const [re, label] of REASONS) if (re.test(raw)) return label;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Merges reasons that map to the same plain label. */
export function groupReasons(rows: ReasonCount[]): ReasonCount[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(reasonLabel(r.reason), (m.get(reasonLabel(r.reason)) ?? 0) + r.count);
  return [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

export function share(part: number | null | undefined, whole: number | null | undefined): number {
  return part && whole ? Math.min(100, (100 * part) / whole) : 0;
}

export function since(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "unknown";
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 90) return "under a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 360) / 10} hours ago`;
  return `${Math.round(s / 8640) / 10} days ago`;
}
