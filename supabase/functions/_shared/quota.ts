/**
 * Daily AI budgets for singlet.bio, shared by the edge functions.
 *
 * Every AI call is charged to a *subject*:
 *   - "user:<uuid>" when the request carries a valid user session token
 *   - "anon:<hash>"  otherwise — the catalog API forwards a salted hash of the
 *     visitor's IP (`X-Singlet-Anon`); direct callers are hashed here from the
 *     forwarded address. The raw address is never stored.
 *
 * Counters live in public.ai_search_usage (one row per subject/day/kind) and
 * are incremented atomically by the `consume_ai_search` database function,
 * which only the service role may call. Limits reset at 00:00 UTC.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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

export interface Subject {
  subject: string;
  kind: SubjectKind;
  userId: string | null;
  email: string | null;
}

/** Default daily limits; override with env AI_LIMIT_<KIND>_<SUBJECT> (e.g. AI_LIMIT_SEARCH_ANON). */
const DEFAULT_LIMITS: Record<QuotaKind, Record<SubjectKind, number>> = {
  search: { anon: 10, user: 200 },
  explain: { anon: 0, user: 100 },
};

const ANON_SALT = "singlet-ai-quota-v1";

export function limitFor(kind: QuotaKind, subject: SubjectKind): number {
  const env = Deno.env.get(`AI_LIMIT_${kind.toUpperCase()}_${subject.toUpperCase()}`);
  const n = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIMITS[kind][subject];
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function anonSubjectFromIp(ip: string): Promise<string> {
  const h = await sha256Hex(`${ANON_SALT}:${ip.trim()}`);
  return `anon:${h.slice(0, 32)}`;
}

let serviceClient: SupabaseClient | null = null;
export function service(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}

/**
 * Work out who is asking. A bearer token that is not the project's anon key
 * is validated as a user session; anything else (missing, anon key, invalid)
 * falls back to the forwarded anonymous subject, then to the caller's IP.
 */
export async function resolveSubject(req: Request): Promise<Subject> {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();

  if (token && token !== anonKey && token.split(".").length === 3) {
    try {
      const { data, error } = await service().auth.getUser(token);
      if (!error && data.user) {
        return { subject: `user:${data.user.id}`, kind: "user", userId: data.user.id, email: data.user.email ?? null };
      }
    } catch {
      /* fall through to anonymous accounting */
    }
  }

  const forwarded = (req.headers.get("X-Singlet-Anon") ?? "").trim();
  if (/^anon:[0-9a-f]{16,64}$/.test(forwarded)) return { subject: forwarded, kind: "anon", userId: null, email: null };

  const ip =
    req.headers.get("CF-Connecting-IP") ??
    (req.headers.get("X-Forwarded-For") ?? "").split(",")[0].trim() ??
    "";
  return { subject: await anonSubjectFromIp(ip || "unknown"), kind: "anon", userId: null, email: null };
}

/** Charge one unit. Never throws: if the database is unreachable the call is allowed (fail open). */
export async function consume(subject: Subject, kind: QuotaKind): Promise<Quota> {
  const limit = limitFor(kind, subject.kind);
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  if (limit <= 0) {
    return { kind: subject.kind, used: 0, limit, resets_at: midnight.toISOString(), exceeded: true };
  }
  try {
    const { data, error } = await service().rpc("consume_ai_search", {
      _subject: subject.subject,
      _user_id: subject.userId,
      _kind: kind,
      _limit: limit,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; used: number; limit: number; resets_at: string }
      | undefined;
    if (!row) throw new Error("consume_ai_search returned no row");
    return { kind: subject.kind, used: row.used, limit: row.limit, resets_at: row.resets_at, exceeded: !row.allowed };
  } catch (e) {
    console.warn("[quota] consume failed, allowing request:", String(e));
    return { kind: subject.kind, used: 0, limit, resets_at: midnight.toISOString(), exceeded: false };
  }
}

/** Human sentence for the 429 body — the UI shows it verbatim as a fallback. */
export function quotaMessage(q: Quota, what: string): string {
  const when = new Date(q.resets_at);
  const hhmm = Number.isNaN(when.getTime()) ? "midnight UTC" : `${String(when.getUTCHours()).padStart(2, "0")}:${String(when.getUTCMinutes()).padStart(2, "0")} UTC`;
  if (q.kind === "anon") {
    return `You have used today's ${q.limit} free ${what}. Sign in (free) for ${limitFor("search", "user")} a day, or try again after ${hhmm}.`;
  }
  return `You have used today's ${q.limit} ${what}. The limit resets at ${hhmm}.`;
}
