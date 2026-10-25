/** Roadmap to Singlet 1.0.0: the shape of public/data/roadmap.json and its progress roll-up. */

const isStr = (v: unknown): v is string => typeof v === "string";

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
