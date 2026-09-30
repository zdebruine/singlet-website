/**
 * Who is calling the catalog API — resolved entirely on Cloudflare (D1).
 *
 * Three shapes of caller:
 *   - a signed-in browser: the `__Host-singlet_session` cookie (see session.ts).
 *     For unsafe methods (POST/PUT/PATCH/DELETE) the cookie only counts when the
 *     request's Origin is this site — a cross-site form can never act as the
 *     user even if a browser ignored SameSite;
 *   - a script or MCP client: `Authorization: Bearer sk_live_…` or
 *     `X-API-Key: sk_live_…`, looked up by sha256 in `api_keys` (60 s
 *     per-isolate memo; `last_used_at` refreshed at most every 5 min). A key
 *     acts as its owner, so it spends the owner's signed-in AI budget;
 *   - everyone else: anonymous, metered by a salted hash of the IP.
 *
 * Downloads never need any of this; accounts exist for AI budgets, API keys,
 * private projects, cohorts and workspaces.
 */
import type { WaitUntil } from "./env";
import { CORS_HEADERS } from "./cors";
import { sha256Hex } from "./hash";
import { lookupSession, nowIso, type SessionUser } from "./session";

export { sha256Hex };

const ANON_SALT = "singlet-ai-quota-v1";

/** Per-request header that carries the visitor's remaining budget back to the UI. */
export const QUOTA_HEADER = "X-Singlet-Quota";
export const API_KEY_HEADER = "X-API-Key";
export const API_KEY_RE = /^sk_live_[A-Za-z0-9_-]{20,64}$/;

const KEY_MEMO_TTL_MS = 60_000;
const TOUCH_EVERY_MS = 5 * 60_000;
const ACCOUNT_URL = "https://singlet.bio/account";

export type KeyReason = "unknown" | "revoked" | "expired" | "unavailable";

export type KeyCheck =
  | { ok: true; keyId: string; userId: string }
  | { ok: false; reason: KeyReason; message: string };

interface MemoEntry {
  result: KeyCheck;
  at: number;
  lastTouched: number;
}

/** Per-isolate memo, keyed by SHA-256 of the key (the plain key is never kept). */
const memo = new Map<string, MemoEntry>();

/** Drop memoised key results (call after a key is created or revoked in this isolate). */
export function forgetKeyMemo(): void {
  memo.clear();
}

export async function anonSubjectFromIp(ip: string): Promise<string> {
  return `anon:${(await sha256Hex(`${ANON_SALT}:${ip.trim()}`)).slice(0, 32)}`;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

/** The `sk_live_…` key on the request, if any (header wins over bearer). */
export function apiKeyFromRequest(request: Request): string | null {
  const header = (request.headers.get(API_KEY_HEADER) ?? "").trim();
  if (API_KEY_RE.test(header)) return header;
  const raw = (request.headers.get("Authorization") ?? "").trim();
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  const token = m?.[1]?.trim() ?? "";
  return API_KEY_RE.test(token) ? token : null;
}

export function keyMessage(reason: KeyReason): string {
  switch (reason) {
    case "revoked":
      return `This API key was revoked. Create a new one at ${ACCOUNT_URL}.`;
    case "expired":
      return `This API key has expired. Create a new one at ${ACCOUNT_URL}.`;
    case "unavailable":
      return "API keys cannot be checked right now. Try again in a minute.";
    default:
      return `Unknown API key. Create one at ${ACCOUNT_URL} (sign in, then "API keys").`;
  }
}

interface KeyRow {
  id: string;
  user_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Validate an API key against D1. Results (valid or not) are memoised for
 * 60 s per isolate; `last_used_at` is refreshed in the background at most
 * every 5 min.
 */
export async function checkApiKey(env: { DB: D1Database }, key: string, waitUntil: WaitUntil): Promise<KeyCheck> {
  const hash = await sha256Hex(key);
  const now = Date.now();
  const touch = () =>
    env.DB.prepare(`UPDATE api_keys SET last_used_at = ?2 WHERE key_hash = ?1`).bind(hash, nowIso(now)).run().catch(() => undefined);

  const hit = memo.get(hash);
  if (hit && now - hit.at < KEY_MEMO_TTL_MS) {
    if (hit.result.ok && now - hit.lastTouched >= TOUCH_EVERY_MS) {
      hit.lastTouched = now;
      waitUntil(touch());
    }
    return hit.result;
  }

  let result: KeyCheck;
  let lastTouched = 0;
  try {
    const row = await env.DB.prepare(
      `SELECT id, user_id, expires_at, revoked_at, last_used_at FROM api_keys WHERE key_hash = ?1`,
    )
      .bind(hash)
      .first<KeyRow>();
    if (!row) result = { ok: false, reason: "unknown", message: keyMessage("unknown") };
    else if (row.revoked_at) result = { ok: false, reason: "revoked", message: keyMessage("revoked") };
    else if (row.expires_at && Date.parse(row.expires_at) <= now) result = { ok: false, reason: "expired", message: keyMessage("expired") };
    else {
      result = { ok: true, keyId: row.id, userId: row.user_id };
      const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
      if (!Number.isFinite(lastUsed) || now - lastUsed >= TOUCH_EVERY_MS) {
        lastTouched = now;
        waitUntil(touch());
      } else {
        lastTouched = lastUsed;
      }
    }
  } catch {
    // Do not memoise outages for the full minute; a retry may succeed.
    return { ok: false, reason: "unavailable", message: keyMessage("unavailable") };
  }

  if (memo.size > 5000) memo.clear();
  memo.set(hash, { result, at: now, lastTouched });
  return result;
}

export type Identity =
  | { kind: "anonymous"; subject: string }
  | { kind: "session"; subject: string; userId: string; user: SessionUser }
  | { kind: "api_key"; subject: string; userId: string; keyId: string };

export type SignedInIdentity = Exclude<Identity, { kind: "anonymous" }>;

export type IdentityOutcome = { ok: true; identity: Identity } | { ok: false; response: Response };

export function isSignedIn(identity: Identity): identity is SignedInIdentity {
  return identity.kind !== "anonymous";
}

/** JSON 401 in the same shape as every other API error, with CORS. */
export function unauthorized(message: string, reason: KeyReason): Response {
  return new Response(JSON.stringify({ error: "invalid_api_key", message, reason, account: ACCOUNT_URL }), {
    status: reason === "unavailable" ? 503 : 401,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when a cookie-authenticated request may act as the user: safe methods
 * always; unsafe methods only with an Origin (or, failing that, Referer) on
 * this same host.
 */
export function sameOriginOrSafe(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const self = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === self;
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin === self;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Resolve the caller before touching the cache or D1-heavy work. Only an API
 * key can fail (401 / 503): a missing, expired or cross-origin session simply
 * degrades to anonymous, and anonymous is always allowed.
 */
export async function resolveIdentity(
  request: Request,
  env: { DB: D1Database },
  waitUntil: WaitUntil,
): Promise<IdentityOutcome> {
  const key = apiKeyFromRequest(request);
  if (key) {
    const check = await checkApiKey(env, key, waitUntil);
    if (!check.ok) return { ok: false, response: unauthorized(check.message, check.reason) };
    return { ok: true, identity: { kind: "api_key", subject: `user:${check.userId}`, userId: check.userId, keyId: check.keyId } };
  }
  if (sameOriginOrSafe(request)) {
    const user = await lookupSession(env.DB, request, waitUntil);
    if (user) return { ok: true, identity: { kind: "session", subject: `user:${user.userId}`, userId: user.userId, user } };
  }
  return { ok: true, identity: { kind: "anonymous", subject: await anonSubjectFromIp(clientIp(request)) } };
}

/** 401 for endpoints that need an account. */
export function signInRequired(message = "Sign in to use private projects, cohorts and workspaces."): Response {
  return new Response(JSON.stringify({ error: "sign_in_required", message }), {
    status: 401,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Resolve a signed-in caller or produce the error response to return.
 * Bad API key → 401/503 from resolveIdentity; anonymous → 401 sign_in_required.
 */
export async function requireUser(
  request: Request,
  env: { DB: D1Database },
  waitUntil: WaitUntil,
  message?: string,
): Promise<{ ok: true; identity: SignedInIdentity } | { ok: false; response: Response }> {
  const who = await resolveIdentity(request, env, waitUntil);
  if (!who.ok) return who;
  if (!isSignedIn(who.identity)) return { ok: false, response: signInRequired(message) };
  return { ok: true, identity: who.identity };
}
