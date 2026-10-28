/**
 * Daily D1 write budget for the ingest endpoints. Every bulk write to production D1 through /api/ingest is counted in
 * `meta_cache` (key `d1-write-budget:<UTC date>`) as estimated rows written (functions/_shared/write-cost.ts). A call that would
 * take the day over the budget is refused with 429 before it writes anything.
 *
 * The budget is the owner's approval switch. D1_DAILY_WRITE_ROWS (Pages variable, default 1,500,000 rows a day, about
 * 45M a month, inside the 50M included) is raised by the owner, in Claude or the dashboard, only after seeing a cost estimate
 * for the planned write. An agent cannot raise it: it is a Pages variable, not a request parameter.
 */
import { costOf, estimateRows, fmtRows, fmtUsd } from "./write-cost";

export const DEFAULT_DAILY_WRITE_ROWS = 1_500_000;

const keyFor = (now: Date) => `d1-write-budget:${now.toISOString().slice(0, 10)}`;

export function dailyBudget(env: { D1_DAILY_WRITE_ROWS?: string }): number {
  const n = Number(env.D1_DAILY_WRITE_ROWS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_WRITE_ROWS;
}

export type BudgetResult =
  | { ok: true; used: number; budget: number }
  | { ok: false; used: number; budget: number; estimate: number; message: string };

/** Reserve `estimate` rows for today, or refuse. Approximate under concurrency (read, then add), which is enough for a cost guard. */
export async function reserveWrites(
  db: D1Database,
  env: { D1_DAILY_WRITE_ROWS?: string },
  estimate: number,
  now: Date = new Date()
): Promise<BudgetResult> {
  const budget = dailyBudget(env);
  const key = keyFor(now);
  const row = await db.prepare(`SELECT value FROM meta_cache WHERE key = ?`).bind(key).first<{ value: string }>().catch(() => null);
  const used = Number(row?.value ?? 0) || 0;
  if (used + estimate > budget) {
    const c = costOf(estimate);
    return {
      ok: false,
      used,
      budget,
      estimate,
      message:
        `Daily D1 write budget reached: ${fmtRows(used)} of ${fmtRows(budget)} rows used today, this call needs about ${fmtRows(estimate)} ` +
        `(up to ${fmtUsd(c.worstUsd)}). D1 writes cost money ($1 per million rows beyond the 50M a month included). ` +
        `Do not retry. Prepare a plan with a cost estimate (npm run d1:estimate) and ask the owner to approve it in Claude; ` +
        `the owner raises D1_DAILY_WRITE_ROWS.`,
    };
  }
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  await db
    .prepare(
      `INSERT INTO meta_cache (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT), updated_at = excluded.updated_at`
    )
    .bind(key, String(estimate), stamp, estimate)
    .run()
    .catch(() => undefined); // a failed counter write must not block ingest; the Cloudflare budget alerts are the backstop
  return { ok: true, used: used + estimate, budget };
}

export const estimateIngest = (table: string, nRows: number): number => estimateRows(table, nRows);
