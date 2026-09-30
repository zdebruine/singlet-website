/**
 * Browser sessions on D1.
 *
 * The cookie `__Host-singlet_session` carries 32 random bytes (base64url).
 * Only sha256(token) is stored in `sessions`. `__Host-` pins the cookie to the
 * exact host (singlet.bio or one preview host), Secure, Path=/. HttpOnly keeps
 * it away from page scripts; SameSite=Lax keeps it off cross-site POSTs.
 *
 * Sessions last 30 days and slide: a request more than a day after the last
 * refresh pushes `expires_at` out again (at most once per day per session).
 */
import { sha256Hex } from "./hash";

export const SESSION_COOKIE = "__Host-singlet_session";
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;
const REFRESH_AFTER_MS = 86_400_000;
const MEMO_TTL_MS = 30_000;

export interface SessionUser {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Memo {
  user: SessionUser | null;
  at: number;
}
/** Per-isolate memo keyed by token hash (never the token itself). */
const memo = new Map<string, Memo>();

export function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** URL-safe random token (default 32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  const t = readCookie(request, SESSION_COOKIE);
  return t && /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null;
}

export function sessionCookie(token: string, maxAgeSec = SESSION_DAYS * 86_400): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Create a session row and return the Set-Cookie header value. */
export async function createSession(db: D1Database, userId: string, request: Request): Promise<string> {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent)
       VALUES (?1, ?2, ?3, ?4, ?3, ?5)`,
    )
    .bind(hash, userId, nowIso(now), nowIso(now + SESSION_MS), (request.headers.get("User-Agent") ?? "").slice(0, 200))
    .run();
  // Opportunistic cleanup of long-dead rows; bounded so it never gets slow.
  await db
    .prepare(`DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at < ?1 LIMIT 100)`)
    .bind(nowIso(now))
    .run()
    .catch(() => undefined);
  return sessionCookie(token);
}

interface SessionRow {
  user_id: string;
  expires_at: string;
  last_seen_at: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * The signed-in user for this request, or null. Never throws: a database
 * hiccup degrades to "anonymous" rather than failing a catalog request.
 */
export async function lookupSession(
  db: D1Database,
  request: Request,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const now = Date.now();
  const hit = memo.get(hash);
  if (hit && now - hit.at < MEMO_TTL_MS) return hit.user;

  let user: SessionUser | null = null;
  try {
    const row = await db
      .prepare(
        `SELECT s.user_id, s.expires_at, s.last_seen_at, u.email, u.display_name, u.avatar_url
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ?1`,
      )
      .bind(hash)
      .first<SessionRow>();
    if (row && Date.parse(row.expires_at) > now) {
      user = { userId: row.user_id, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url };
      const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
      if (!Number.isFinite(seen) || now - seen > REFRESH_AFTER_MS) {
        const p = db
          .prepare(`UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1`)
          .bind(hash, nowIso(now), nowIso(now + SESSION_MS))
          .run()
          .catch(() => undefined);
        if (waitUntil) waitUntil(p);
        else await p;
      }
    }
  } catch {
    return null;
  }
  if (memo.size > 5000) memo.clear();
  memo.set(hash, { user, at: now });
  return user;
}

/** Delete the current session (if any) and return a clearing Set-Cookie value. */
export async function destroySession(db: D1Database, request: Request): Promise<string> {
  const token = readSessionToken(request);
  if (token) {
    const hash = await sha256Hex(token);
    memo.delete(hash);
    await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(hash).run().catch(() => undefined);
  }
  return clearSessionCookie();
}

/** Forget every memoised session for a user (after account deletion / sign-out everywhere). */
export function forgetMemo(): void {
  memo.clear();
}
