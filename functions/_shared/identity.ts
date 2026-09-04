/**
 * Who is calling the catalog API.
 *
 * Three shapes of caller:
 *   - a signed-in browser: `Authorization: Bearer <session JWT>` — forwarded
 *     untouched to the Lovable Cloud function, which validates it;
 *   - a script or MCP client: `Authorization: Bearer sk_live_…` or
 *     `X-API-Key: sk_live_…` — validated HERE (hash lookup through the public
 *     `resolve_api_key` database function, 60 s per-isolate memo,
 *     `last_used_at` refreshed at most every 5 min), then forwarded so the
 *     Cloud function charges the key's OWNER (200 AI searches / day);
 *   - everyone else: anonymous, metered by a salted hash of the IP. The hash
 *     MUST be computed here: the Cloud function only ever sees the Pages
 *     egress address. Salt and `anon:<hex>` shape mirror
 *     supabase/functions/_shared/quota.ts.
 *
 * Downloads never need any of this; keys exist for programmatic natural-
 * language search and the MCP server.
 */
import { cloudAnonKey, cloudRpc, type CloudEnv } from "./cloud";
import { CORS_HEADERS } from "./cors";

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
  | { ok: true; keyId: string }
  | { ok: false; reason: KeyReason; message: string };

interface MemoEntry {
  result: KeyCheck;
  at: number;
  lastTouched: number;
}

/** Per-isolate memo, keyed by SHA-256 of the key (the plain key is never kept). */
const memo = new Map<string, MemoEntry>();

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

/** A user's bearer JWT, or null when the request is anonymous / carries the public key / an API key. */
export function userBearer(request: Request, anonKey: string): string | null {
  const raw = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!m) return null;
  const token = m[1].trim();
  if (!token || token === anonKey || API_KEY_RE.test(token) || token.split(".").length !== 3) return null;
  return token;
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

interface ResolveRow {
  key_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Validate an API key. Results (valid or not) are memoised for 60 s per
 * isolate; `last_used_at` is refreshed in the background at most every 5 min.
 */
export async function checkApiKey(
  env: CloudEnv,
  key: string,
  waitUntil: (p: Promise<unknown>) => void
): Promise<KeyCheck> {
  const hash = await sha256Hex(key);
  const now = Date.now();
  const hit = memo.get(hash);
  if (hit && now - hit.at < KEY_MEMO_TTL_MS) {
    if (hit.result.ok && now - hit.lastTouched >= TOUCH_EVERY_MS) {
      hit.lastTouched = now;
      waitUntil(cloudRpc(env, "touch_api_key", { _key_hash: hash }).catch(() => undefined));
    }
    return hit.result;
  }

  let result: KeyCheck;
  let lastTouched = 0;
  try {
    const rows = await cloudRpc<ResolveRow[]>(env, "resolve_api_key", { _key_hash: hash });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) result = { ok: false, reason: "unknown", message: keyMessage("unknown") };
    else if (row.revoked_at) result = { ok: false, reason: "revoked", message: keyMessage("revoked") };
    else if (row.expires_at && Date.parse(row.expires_at) <= now) result = { ok: false, reason: "expired", message: keyMessage("expired") };
    else {
      result = { ok: true, keyId: row.key_id };
      const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
      if (!Number.isFinite(lastUsed) || now - lastUsed >= TOUCH_EVERY_MS) {
        lastTouched = now;
        waitUntil(cloudRpc(env, "touch_api_key", { _key_hash: hash }).catch(() => undefined));
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
  | { kind: "anonymous" }
  | { kind: "session"; token: string }
  | { kind: "api_key"; key: string; keyId: string };

export type IdentityOutcome = { ok: true; identity: Identity } | { ok: false; response: Response };

/** JSON 401 in the same shape as every other API error, with CORS. */
export function unauthorized(message: string, reason: KeyReason): Response {
  return new Response(JSON.stringify({ error: "invalid_api_key", message, reason, account: ACCOUNT_URL }), {
    status: reason === "unavailable" ? 503 : 401,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}

/**
 * Resolve the caller before touching the cache or D1. Only an API key can
 * fail: a bad session token simply degrades to anonymous (the Cloud function
 * makes the final call), and anonymous is always allowed.
 */
export async function resolveIdentity(
  request: Request,
  env: CloudEnv,
  waitUntil: (p: Promise<unknown>) => void
): Promise<IdentityOutcome> {
  const key = apiKeyFromRequest(request);
  if (key) {
    const check = await checkApiKey(env, key, waitUntil);
    if (!check.ok) return { ok: false, response: unauthorized(check.message, check.reason) };
    return { ok: true, identity: { kind: "api_key", key, keyId: check.keyId } };
  }
  const token = userBearer(request, cloudAnonKey(env));
  if (token) return { ok: true, identity: { kind: "session", token } };
  return { ok: true, identity: { kind: "anonymous" } };
}

/**
 * Headers to attach when calling a Lovable Cloud function on the visitor's
 * behalf. `apikey` is always the public key; `Authorization` is the user's
 * token when signed in. An API key travels in `X-API-Key` so the Cloud
 * function resolves — and charges — its owner. Anonymous callers send the
 * salted IP hash.
 */
export async function identityHeaders(request: Request, anonKey: string): Promise<Record<string, string>> {
  const key = apiKeyFromRequest(request);
  if (key) return { apikey: anonKey, Authorization: `Bearer ${anonKey}`, [API_KEY_HEADER]: key };
  const user = userBearer(request, anonKey);
  if (user) return { apikey: anonKey, Authorization: `Bearer ${user}` };
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "X-Singlet-Anon": await anonSubjectFromIp(clientIp(request)),
  };
}
