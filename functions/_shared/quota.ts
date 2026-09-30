/**
 * Daily AI budgets on D1 (table `ai_usage`, schema/010_accounts.sql).
 *
 * Every AI call is charged to the caller's subject (identity.ts):
 *   "user:<id>"  — signed-in session or an API key (charged to the key's owner)
 *   "anon:<hash>" — salted hash of the visitor's IP; the raw address is never stored.
 *
 * Limits reset at 00:00 UTC. Defaults: search 10 anonymous / 200 signed-in,
 * explanations 0 / 100; override with AI_LIMIT_<KIND>_<ANON|USER>.
 *
 * `consume` is one atomic upsert: the counter only increments while it is
 * below the limit, so concurrent requests can never overspend. It never
 * throws — if D1 is unreachable the call is allowed (fail open).
 */
import type { AppEnv } from "./env";
import type { Identity } from "./identity";

export type QuotaKind = "search" | "explain";
export type SubjectKind = "anon" | "user";

export interface Quota {
  kind: SubjectKind;
  used: number;
  limit: number;
  /** ISO timestamp of the next reset (midnight UTC). */
  resets_at: string;
  exceeded: boolean;
}

const DEFAULT_LIMITS: Record<QuotaKind, Record<SubjectKind, number>> = {
  search: { anon: 10, user: 200 },
  explain: { anon: 0, user: 100 },
};

type LimitEnv = Pick<AppEnv, "AI_LIMIT_SEARCH_ANON" | "AI_LIMIT_SEARCH_USER" | "AI_LIMIT_EXPLAIN_ANON" | "AI_LIMIT_EXPLAIN_USER">;

export function limitFor(env: LimitEnv, kind: QuotaKind, subject: SubjectKind): number {
  const key = `AI_LIMIT_${kind.toUpperCase()}_${subject.toUpperCase()}` as keyof LimitEnv;
  const raw = env[key];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMITS[kind][subject];
}

export function subjectKind(identity: Identity): SubjectKind {
  return identity.kind === "anonymous" ? "anon" : "user";
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextMidnightIso(ms: number): string {
  const d = new Date(ms);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Charge one unit of `kind` to the caller. */
export async function consume(db: D1Database, env: LimitEnv, identity: Identity, kind: QuotaKind): Promise<Quota> {
  const sk = subjectKind(identity);
  const limit = limitFor(env, kind, sk);
  const now = Date.now();
  const resets_at = nextMidnightIso(now);
  if (limit <= 0) return { kind: sk, used: 0, limit, resets_at, exceeded: true };
  const day = utcDay(now);
  const at = new Date(now).toISOString();
  const userId = identity.kind === "anonymous" ? null : identity.userId;
  try {
    const row = await db
      .prepare(
        `INSERT INTO ai_usage (subject, day, kind, user_id, count, first_at, last_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
         ON CONFLICT (subject, day, kind) DO UPDATE
           SET count = ai_usage.count + 1, last_at = excluded.last_at
           WHERE ai_usage.count < ?6
         RETURNING count`,
      )
      .bind(identity.subject, day, kind, userId, at, limit)
      .first<{ count: number }>();
    if (row) return { kind: sk, used: row.count, limit, resets_at, exceeded: false };
    return { kind: sk, used: limit, limit, resets_at, exceeded: true };
  } catch (e) {
    console.warn("[quota] consume failed, allowing request:", String(e));
    return { kind: sk, used: 0, limit, resets_at, exceeded: false };
  }
}

/** Current counters for a subject without charging anything. */
export async function usageToday(db: D1Database, env: LimitEnv, identity: Identity): Promise<Record<QuotaKind, Quota>> {
  const sk = subjectKind(identity);
  const now = Date.now();
  const resets_at = nextMidnightIso(now);
  const used: Record<QuotaKind, number> = { search: 0, explain: 0 };
  try {
    const rows = await db
      .prepare(`SELECT kind, count FROM ai_usage WHERE subject = ?1 AND day = ?2`)
      .bind(identity.subject, utcDay(now))
      .all<{ kind: QuotaKind; count: number }>();
    for (const r of rows.results ?? []) if (r.kind in used) used[r.kind] = r.count;
  } catch {
    /* report zeros */
  }
  const q = (kind: QuotaKind): Quota => {
    const limit = limitFor(env, kind, sk);
    return { kind: sk, used: used[kind], limit, resets_at, exceeded: used[kind] >= limit };
  };
  return { search: q("search"), explain: q("explain") };
}

/** Human sentence for the 429 body — the UI shows it verbatim as a fallback. */
export function quotaMessage(env: LimitEnv, q: Quota, what: string): string {
  const when = new Date(q.resets_at);
  const hhmm = Number.isNaN(when.getTime())
    ? "midnight UTC"
    : `${String(when.getUTCHours()).padStart(2, "0")}:${String(when.getUTCMinutes()).padStart(2, "0")} UTC`;
  if (q.kind === "anon") {
    return `You have used today's ${q.limit} free ${what}. Sign in (free) for ${limitFor(env, "search", "user")} a day, or try again after ${hhmm}.`;
  }
  return `You have used today's ${q.limit} ${what}. The limit resets at ${hhmm}.`;
}

/** Compact header value for X-Singlet-Quota (the UI parses this JSON). */
export function quotaHeaderValue(q: Quota): string {
  return JSON.stringify(q);
}
