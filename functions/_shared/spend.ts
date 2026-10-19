/**
 * Monthly AI token allowance per account, plus a global circuit breaker.
 *
 * Every model call is charged in tokens as the provider reports them. Each
 * account has a monthly allowance (the cap below, converted to tokens at the
 * configured model's input price); callers see tokens, never prices. Usage
 * beyond the allowance is not served yet: billing for accounts that need more
 * is being built, and the API says so.
 *
 * How a call is metered (reserve, then settle):
 *   1. `reserveSpend` writes a reservation for the call's worst-case cost with
 *      ONE guarded INSERT ... SELECT. The guard checks the account's settled
 *      spend plus live reservations, and the global total, so concurrent calls
 *      can never push either past its cap. Reservations expire on their own.
 *   2. The model runs.
 *   3. `settleSpend` replaces the reservation with the real cost from the
 *      provider's usage report (or the reservation if none was reported).
 *      `releaseSpend` drops it when the call failed before reaching the model.
 *
 * Fails closed: if the budget tables cannot be read or written, the AI call is
 * refused (the deterministic vocabulary search still answers).
 *
 * Internal unit: micro-USD (1e-6 dollars). With prices quoted in dollars per
 * million tokens, one token costs exactly `price` micro-USD, so
 * cost = tokens_in * in_price + tokens_out * out_price needs no scaling.
 */
import type { AppEnv } from "./env";
import type { Identity } from "./identity";

export const GLOBAL_SUBJECT = "*";
/** A reservation that is never settled stops counting after this long. */
const RESERVATION_TTL_MS = 120_000;

/** Defaults; each can be overridden with an environment variable. */
const DEFAULT_USER_CAP_USD = 1;
const DEFAULT_ANON_CAP_USD = 0.02;
const DEFAULT_GLOBAL_CAP_USD = 50;
/** All anonymous visitors together, so a crowd of fresh addresses cannot use up the global ceiling. */
const DEFAULT_ANON_POOL_CAP_USD = 10;
export const ANON_POOL_SUBJECT = "*anon";

export interface Price {
  /** Dollars per million input tokens (= micro-USD per input token). */
  inUsdPerM: number;
  /** Dollars per million output tokens. */
  outUsdPerM: number;
}

/**
 * List prices (checked 2026-10: Anthropic model table, Cloudflare Workers AI
 * pricing page). Unknown models are priced high so a new model id cannot make
 * the cap look looser than it is; override with AI_PRICE_IN_USD_PER_M and
 * AI_PRICE_OUT_USD_PER_M.
 */
const ANTHROPIC_PRICES: Record<string, Price> = {
  "claude-haiku-4-5": { inUsdPerM: 1, outUsdPerM: 5 },
  "claude-haiku-5-5": { inUsdPerM: 0.1, outUsdPerM: 0.5 },
  "claude-sonnet-5-5": { inUsdPerM: 2, outUsdPerM: 10 },
  "claude-sonnet-5": { inUsdPerM: 2, outUsdPerM: 10 },
  "claude-opus-5-5": { inUsdPerM: 4, outUsdPerM: 20 },
  "claude-opus-5": { inUsdPerM: 5, outUsdPerM: 25 },
};
const WORKERS_AI_PRICES: Record<string, Price> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inUsdPerM: 0.293, outUsdPerM: 2.253 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { inUsdPerM: 0.27, outUsdPerM: 0.85 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { inUsdPerM: 0.351, outUsdPerM: 0.555 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { inUsdPerM: 0.152, outUsdPerM: 0.287 },
};
const UNKNOWN_MODEL_PRICE: Price = { inUsdPerM: 5, outUsdPerM: 25 };

export type SpendEnv = Pick<
  AppEnv,
  | "AI_MODEL"
  | "ANTHROPIC_API_KEY"
  | "ANTHROPIC_MODEL"
  | "AI_MONTHLY_CAP_USD"
  | "AI_ANON_MONTHLY_CAP_USD"
  | "AI_GLOBAL_MONTHLY_CAP_USD"
  | "AI_ANON_POOL_CAP_USD"
  | "AI_PRICE_IN_USD_PER_M"
  | "AI_PRICE_OUT_USD_PER_M"
>;

function positive(v: string | undefined): number | null {
  const n = v ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function priceFor(env: SpendEnv): Price {
  const inOverride = positive(env.AI_PRICE_IN_USD_PER_M);
  const outOverride = positive(env.AI_PRICE_OUT_USD_PER_M);
  if (inOverride && outOverride) return { inUsdPerM: inOverride, outUsdPerM: outOverride };
  const table = env.ANTHROPIC_API_KEY ? ANTHROPIC_PRICES : WORKERS_AI_PRICES;
  const model = env.ANTHROPIC_API_KEY ? env.ANTHROPIC_MODEL || "claude-haiku-4-5" : env.AI_MODEL || "@cf/meta/llama-4-scout-17b-16e-instruct";
  return table[model] ?? UNKNOWN_MODEL_PRICE;
}

/** Cap for an account kind, in micro-USD. */
export function capMicros(env: SpendEnv, subject: string): number {
  const usd =
    subject === GLOBAL_SUBJECT
      ? (positive(env.AI_GLOBAL_MONTHLY_CAP_USD) ?? DEFAULT_GLOBAL_CAP_USD)
      : subject === ANON_POOL_SUBJECT
        ? (positive(env.AI_ANON_POOL_CAP_USD) ?? DEFAULT_ANON_POOL_CAP_USD)
      : subject.startsWith("anon:")
        ? (positive(env.AI_ANON_MONTHLY_CAP_USD) ?? DEFAULT_ANON_CAP_USD)
        : (positive(env.AI_MONTHLY_CAP_USD) ?? DEFAULT_USER_CAP_USD);
  return Math.round(usd * 1_000_000);
}

export function monthOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function nextMonthIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export function costMicros(price: Price, tokensIn: number, tokensOut: number): number {
  return Math.ceil(tokensIn * price.inUsdPerM + tokensOut * price.outUsdPerM);
}

/** Worst-case cost of a call: a deliberately high token estimate for the prompt (1 per 3 characters) plus the full output allowance. */
export function estimateMicros(price: Price, promptChars: number, maxOutputTokens: number): number {
  return costMicros(price, Math.ceil(promptChars / 3) + 64, maxOutputTokens);
}

export interface Reservation {
  id: string;
  subject: string;
  month: string;
  micros: number;
}

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "allowance" | "service_cap" | "anon_pool" | "unavailable" };

function newId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Reserve `micros` against the account's and the global cap in one atomic statement. */
export async function reserveSpend(
  db: D1Database,
  env: SpendEnv,
  identity: Pick<Identity, "subject">,
  micros: number,
  now: number = Date.now()
): Promise<ReserveResult> {
  const month = monthOf(now);
  const subject = identity.subject;
  const userCap = capMicros(env, subject);
  const globalCap = capMicros(env, GLOBAL_SUBJECT);
  // Anonymous visitors also share one pool; everyone else is not limited by it.
  const poolCap = subject.startsWith("anon:") ? capMicros(env, ANON_POOL_SUBJECT) : Number.MAX_SAFE_INTEGER;
  const id = newId();
  try {
    const res = await db
      .prepare(
        `INSERT INTO ai_reservation (id, subject, month, micro_usd, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE ( COALESCE((SELECT micro_usd FROM ai_spend WHERE subject = ?2 AND month = ?3), 0)
               + COALESCE((SELECT SUM(micro_usd) FROM ai_reservation WHERE subject = ?2 AND month = ?3 AND expires_at > ?6), 0)
               + ?4 ) <= ?7
           AND ( COALESCE((SELECT micro_usd FROM ai_spend WHERE subject = ?8 AND month = ?3), 0)
               + COALESCE((SELECT SUM(micro_usd) FROM ai_reservation WHERE month = ?3 AND expires_at > ?6), 0)
               + ?4 ) <= ?9
           AND ( COALESCE((SELECT micro_usd FROM ai_spend WHERE subject = ?10 AND month = ?3), 0)
               + COALESCE((SELECT SUM(micro_usd) FROM ai_reservation WHERE subject LIKE 'anon:%' AND month = ?3 AND expires_at > ?6), 0)
               + ?4 ) <= ?11`
      )
      .bind(id, subject, month, micros, now + RESERVATION_TTL_MS, now, userCap, GLOBAL_SUBJECT, globalCap, ANON_POOL_SUBJECT, poolCap)
      .run();
    if (Number(res.meta?.changes ?? 0) === 1) return { ok: true, reservation: { id, subject, month, micros } };

    // Refused: say which cap, so the message can tell a user from an outage.
    const row = await db
      .prepare(
        `SELECT COALESCE((SELECT micro_usd FROM ai_spend WHERE subject = ?1 AND month = ?2), 0)
              + COALESCE((SELECT SUM(micro_usd) FROM ai_reservation WHERE subject = ?1 AND month = ?2 AND expires_at > ?3), 0) AS mine`
      )
      .bind(subject, month, now)
      .first<{ mine: number }>();
    if (Number(row?.mine ?? 0) + micros > userCap) return { ok: false, reason: "allowance" };
    if (subject.startsWith("anon:")) {
      const pool = await db
        .prepare(
          `SELECT COALESCE((SELECT micro_usd FROM ai_spend WHERE subject = ?1 AND month = ?2), 0)
                + COALESCE((SELECT SUM(micro_usd) FROM ai_reservation WHERE subject LIKE 'anon:%' AND month = ?2 AND expires_at > ?3), 0) AS used`
        )
        .bind(ANON_POOL_SUBJECT, month, now)
        .first<{ used: number }>();
      if (Number(pool?.used ?? 0) + micros > poolCap) return { ok: false, reason: "anon_pool" };
    }
    return { ok: false, reason: "service_cap" };
  } catch (e) {
    console.error("[spend] reserve failed, refusing the AI call:", String(e));
    return { ok: false, reason: "unavailable" };
  }
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Replace the reservation with the real cost. With no usage report the reservation itself is charged. */
export async function settleSpend(
  db: D1Database,
  env: SpendEnv,
  r: Reservation,
  usage: Usage | null,
  now: number = Date.now()
): Promise<void> {
  const price = priceFor(env);
  const micros = usage ? costMicros(price, usage.inputTokens, usage.outputTokens) : r.micros;
  const tin = usage ? Math.max(0, Math.round(usage.inputTokens)) : 0;
  const tout = usage ? Math.max(0, Math.round(usage.outputTokens)) : 0;
  const at = new Date(now).toISOString();
  const upsert = (subject: string) =>
    db
      .prepare(
        `INSERT INTO ai_spend (subject, month, micro_usd, tokens_in, tokens_out, calls, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
         ON CONFLICT (subject, month) DO UPDATE SET
           micro_usd = ai_spend.micro_usd + excluded.micro_usd, tokens_in = ai_spend.tokens_in + excluded.tokens_in,
           tokens_out = ai_spend.tokens_out + excluded.tokens_out, calls = ai_spend.calls + 1, updated_at = excluded.updated_at`
      )
      .bind(subject, r.month, micros, tin, tout, at);
  try {
    await db.batch([
      db.prepare(`DELETE FROM ai_reservation WHERE id = ?1`).bind(r.id),
      upsert(r.subject),
      upsert(GLOBAL_SUBJECT),
      ...(r.subject.startsWith("anon:") ? [upsert(ANON_POOL_SUBJECT)] : []),
    ]);
  } catch (e) {
    // The reservation still holds the budget until it expires, so nothing is lost.
    console.error("[spend] settle failed:", String(e));
  }
}

/** Drop a reservation without charging (the call never reached the model). */
export async function releaseSpend(db: D1Database, r: Reservation): Promise<void> {
  await db.prepare(`DELETE FROM ai_reservation WHERE id = ?1`).bind(r.id).run().catch(() => undefined);
}

/** Housekeeping: forget reservations that expired more than an hour ago. */
export async function purgeExpired(db: D1Database, now: number = Date.now()): Promise<void> {
  await db.prepare(`DELETE FROM ai_reservation WHERE expires_at < ?1`).bind(now - 3_600_000).run().catch(() => undefined);
}

export interface AllowanceSnapshot {
  month: string;
  resets_at: string;
  tokens_in: number;
  tokens_out: number;
  /** Raw tokens used this month (input + output). */
  tokens_used: number;
  allowance: {
    unit: "weighted tokens";
    /** Output tokens count more than input tokens, in proportion to their price. */
    output_token_weight: number;
    limit: number;
    used: number;
    remaining: number;
  };
  calls: number;
  billing: string;
}

export const BILLING_NOTE =
  "This is your monthly AI allowance. For more, Singlet Cloud (https://cloud.singlet.bio) sells credits for AI search and analyses; on singlet.bio, AI features pause when it is used up. Searching and downloads never need it.";

export async function allowanceFor(db: D1Database, env: SpendEnv, subject: string, now: number = Date.now()): Promise<AllowanceSnapshot> {
  const month = monthOf(now);
  const price = priceFor(env);
  const row = await db
    .prepare(`SELECT micro_usd, tokens_in, tokens_out, calls FROM ai_spend WHERE subject = ?1 AND month = ?2`)
    .bind(subject, month)
    .first<{ micro_usd: number; tokens_in: number; tokens_out: number; calls: number }>()
    .catch(() => null);
  const spent = Number(row?.micro_usd ?? 0);
  const limit = Math.floor(capMicros(env, subject) / price.inUsdPerM);
  const used = Math.min(limit, Math.ceil(spent / price.inUsdPerM));
  return {
    month,
    resets_at: nextMonthIso(now),
    tokens_in: Number(row?.tokens_in ?? 0),
    tokens_out: Number(row?.tokens_out ?? 0),
    tokens_used: Number(row?.tokens_in ?? 0) + Number(row?.tokens_out ?? 0),
    allowance: {
      unit: "weighted tokens",
      output_token_weight: Math.round((price.outUsdPerM / price.inUsdPerM) * 100) / 100,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    },
    calls: Number(row?.calls ?? 0),
    billing: BILLING_NOTE,
  };
}

/** The message for a refused AI call; speaks in tokens and never mentions money. */
export function allowanceMessage(reason: "allowance" | "service_cap" | "anon_pool" | "unavailable", snap?: AllowanceSnapshot): string {
  if (reason === "anon_pool") return "The free search box has reached its limit for this month. Sign in for your own AI allowance. Searching and downloads still work.";
  if (reason === "service_cap") return "AI features are paused for everyone until the start of next month. Searching and downloads still work.";
  if (reason === "unavailable") return "AI features are unavailable for a moment. Searching and downloads still work.";
  const when = snap ? snap.resets_at.slice(0, 10) : "the start of next month";
  return `You have used this month's AI allowance. It renews on ${when}. For more AI search and analyses, use Singlet Cloud: https://cloud.singlet.bio. Searching and downloads still work.`;
}

// ── Request counters (burst limits) ─────────────────────────────────────────

/**
 * Fixed-window counter: true while fewer than `limit` calls have been seen for
 * `subject` in the current window. One atomic upsert; fails open only for
 * reads (a counter outage must not take the tools down), so it is paired with
 * the key requirement and the per-month usage record.
 */
export async function withinRate(
  db: D1Database,
  subject: string,
  bucket: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): Promise<boolean> {
  const window = Math.floor(now / windowMs);
  try {
    const row = await db
      .prepare(
        `INSERT INTO rate_window (subject, bucket, window, count) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT (subject, bucket, window) DO UPDATE SET count = rate_window.count + 1 WHERE rate_window.count < ?4
         RETURNING count`
      )
      .bind(subject, bucket, window, limit)
      .first<{ count: number }>();
    if (Math.random() < 0.01) {
      await db.prepare(`DELETE FROM rate_window WHERE window < ?1`).bind(window - 2).run().catch(() => undefined);
    }
    return !!row;
  } catch (e) {
    console.warn("[rate] counter unavailable, allowing:", String(e));
    return true;
  }
}

// ── MCP usage ───────────────────────────────────────────────────────────────

export async function recordToolCall(db: D1Database, subject: string, tool: string, now: number = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mcp_usage (subject, month, tool, calls, last_at) VALUES (?1, ?2, ?3, 1, ?4)
       ON CONFLICT (subject, month, tool) DO UPDATE SET calls = mcp_usage.calls + 1, last_at = excluded.last_at`
    )
    .bind(subject, monthOf(now), tool, new Date(now).toISOString())
    .run()
    .catch((e) => console.warn("[mcp] usage not recorded:", String(e)));
}

export async function toolCallsThisMonth(
  db: D1Database,
  subject: string,
  now: number = Date.now()
): Promise<{ total: number; by_tool: Record<string, number> }> {
  const rows = await db
    .prepare(`SELECT tool, calls FROM mcp_usage WHERE subject = ?1 AND month = ?2`)
    .bind(subject, monthOf(now))
    .all<{ tool: string; calls: number }>()
    .catch(() => ({ results: [] as { tool: string; calls: number }[] }));
  const by_tool: Record<string, number> = {};
  let total = 0;
  for (const r of rows.results ?? []) {
    by_tool[r.tool] = Number(r.calls);
    total += Number(r.calls);
  }
  return { total, by_tool };
}
