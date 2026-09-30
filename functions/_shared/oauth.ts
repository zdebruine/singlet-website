/**
 * Sign-in with GitHub or Google: OAuth 2.0 authorization code + PKCE, run
 * entirely on Pages Functions + D1 (tables oauth_states, users,
 * oauth_identities, sessions — schema/010_accounts.sql).
 *
 * Flow
 *   1. GET /auth/<provider>/start?return_to=/path on singlet.bio, a
 *      *.singlet-4gc.pages.dev preview or localhost. A row in oauth_states
 *      keeps sha256(state), the PKCE code_verifier, the starting origin and
 *      the (validated) return path for 10 minutes, and a matching short-lived
 *      __Host- cookie marks this browser; the browser is sent to the provider
 *      with redirect_uri = https://singlet.bio/auth/<provider>/callback, the
 *      state and the S256 code_challenge.
 *   2. The provider sends the browser to that ONE registered callback. D1 is
 *      shared by production and previews, so singlet.bio can read the row; if
 *      the attempt started on another allowed host it relays the browser
 *      there (same query string), so the session cookie lands on that host.
 *   3. The host the attempt started on checks the browser cookie (login-CSRF
 *      guard), deletes the row (single use), exchanges the code server-side
 *      with the code_verifier, reads the verified email, finds or creates
 *      the user (by provider account first,
 *      then by verified email, so a GitHub and a Google account with the same
 *      address share one user), creates a session and redirects to
 *      return_to with the __Host- session cookie.
 *   Any failure lands on /auth/callback?error=<code>&provider=<provider>;
 *   tokens and codes never appear in logs or error URLs.
 *
 * Owner setup (Pages → singlet → Settings → Variables and Secrets, for both
 * Production and Preview):
 *   - GitHub: on the existing OAuth app (client id GITHUB_CLIENT_ID in
 *     wrangler.toml; callback URL https://singlet.bio/auth/github/callback),
 *     generate a new client secret and store it as GITHUB_CLIENT_SECRET.
 *   - Google: Google Cloud console → APIs & Services → Credentials → Create
 *     OAuth client ID → Web application, authorized redirect URI
 *     https://singlet.bio/auth/google/callback; store GOOGLE_CLIENT_ID and
 *     GOOGLE_CLIENT_SECRET.
 * Until a provider's id and secret both exist its start URL answers
 * /auth/callback?error=not_configured and /api/auth/me reports it as off.
 */
import type { AppEnv, WaitUntil } from "./env";
import { sha256Hex } from "./hash";
import { createSession, nowIso, randomToken, readCookie } from "./session";

export type OAuthProvider = "github" | "google";

type OAuthEnv = Pick<AppEnv, "DB" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">;

/** The only host whose callback URLs are registered with the providers. */
export const CANONICAL_ORIGIN = "https://singlet.bio";
export const DEFAULT_RETURN = "/browse";
const STATE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "singlet.bio";
const STATE_RE = /^[A-Za-z0-9_-]{32,128}$/;
/** Per-attempt cookie proving the callback reached the browser that started it. */
const BINDING_COOKIE = "__Host-singlet_oauth_";

/** Hosts a sign-in may start on (and be relayed back to). */
const ORIGIN_RES = [
  /^https:\/\/singlet\.bio$/,
  /^https:\/\/[a-z0-9-]+\.singlet-4gc\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

/** Codes the SPA's /auth/callback page knows how to explain. */
export type SignInErrorCode =
  | "not_configured"
  | "access_denied"
  | "provider_error"
  | "invalid_state"
  | "browser_mismatch"
  | "state_expired"
  | "missing_code"
  | "exchange_failed"
  | "profile_failed"
  | "no_verified_email"
  | "account_failed"
  | "unavailable";

class SignInError extends Error {
  readonly code: SignInErrorCode;
  constructor(code: SignInErrorCode, detail: string) {
    super(detail);
    this.code = code;
  }
}

interface OAuthClient {
  id: string;
  secret: string;
}

interface Profile {
  /** Stable provider account id (GitHub numeric id, Google `sub`) — never a renamable login. */
  id: string;
  /** Verified, lower-cased. */
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface StateRow {
  provider: string;
  code_verifier: string;
  origin: string;
  return_to: string;
  expires_at: string;
}

const AUTHORIZE: Record<OAuthProvider, { url: string; params: Record<string, string> }> = {
  github: {
    url: "https://github.com/login/oauth/authorize",
    params: { scope: "read:user user:email", allow_signup: "true" },
  },
  google: {
    url: "https://accounts.google.com/o/oauth2/v2/auth",
    params: { response_type: "code", scope: "openid email profile", prompt: "select_account" },
  },
};

export function isAllowedOrigin(origin: string): boolean {
  return ORIGIN_RES.some((re) => re.test(origin));
}

export function callbackUrl(provider: OAuthProvider): string {
  return `${CANONICAL_ORIGIN}/auth/${provider}/callback`;
}

/** Client id + secret for a provider, or null while either is missing. */
export function clientFor(env: OAuthEnv, provider: OAuthProvider): OAuthClient | null {
  const id = (provider === "github" ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID)?.trim() ?? "";
  const secret = (provider === "github" ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET)?.trim() ?? "";
  return id && secret ? { id, secret } : null;
}

/** Which providers this deployment can offer (GET /api/auth/me). */
export function configuredProviders(env: OAuthEnv): Record<OAuthProvider, boolean> {
  return { github: clientFor(env, "github") !== null, google: clientFor(env, "google") !== null };
}

/**
 * A same-site path to land on afterwards. Absolute URLs, protocol-relative
 * "//host", backslashes and whitespace (which browsers fold into "//") and
 * the auth pages themselves all fall back to /browse.
 */
export function cleanReturnTo(v: string | null | undefined): string {
  if (!v || v.length > 512) return DEFAULT_RETURN;
  if (!v.startsWith("/") || v.startsWith("//") || /[\\\s]/.test(v) || /^\/auth(?:[/?#]|$)/.test(v)) return DEFAULT_RETURN;
  return v;
}

/** return_to resolved on `origin`, re-checked so it can never leave that host. */
function landingUrl(returnTo: string, origin: string): string {
  try {
    const u = new URL(cleanReturnTo(returnTo), origin);
    if (u.origin === origin) return u.toString();
  } catch {
    /* fall through */
  }
  return new URL(DEFAULT_RETURN, origin).toString();
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256: base64url(sha256(verifier)). */
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function failTo(origin: string, provider: OAuthProvider, code: SignInErrorCode, cookies: string[] = []): Response {
  const u = new URL("/auth/callback", origin);
  u.searchParams.set("error", code);
  u.searchParams.set("provider", provider);
  return redirect(u.toString(), cookies);
}

/**
 * Login-CSRF guard: start sets a cookie named after this attempt's state
 * hash on the starting host; the host that finishes requires it. A callback
 * URL minted by someone else's attempt therefore cannot sign this browser in.
 */
function bindingName(stateHash: string): string {
  return BINDING_COOKIE + stateHash.slice(0, 16);
}

function bindingCookie(stateHash: string, maxAgeSec: number): string {
  return `${bindingName(stateHash)}=${maxAgeSec > 0 ? "1" : ""}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=Lax`;
}

interface FetchInit {
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

async function timedFetch(url: string, init: FetchInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── /auth/<provider>/start ─────────────────────────────────────────────────

export async function startSignIn(request: Request, env: OAuthEnv, provider: OAuthProvider, waitUntil: WaitUntil): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const returnTo = cleanReturnTo(url.searchParams.get("return_to"));

  // Any other host (www., the bare pages.dev alias) signs in on the canonical site.
  if (!isAllowedOrigin(origin)) {
    const canonical = new URL(`/auth/${provider}/start`, CANONICAL_ORIGIN);
    canonical.searchParams.set("return_to", returnTo);
    return redirect(canonical.toString());
  }

  const client = clientFor(env, provider);
  if (!client) return failTo(origin, provider, "not_configured");

  const now = Date.now();
  // Opportunistic cleanup of abandoned attempts; bounded so it never gets slow.
  waitUntil(
    env.DB.prepare(`DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE expires_at < ?1 LIMIT 50)`)
      .bind(nowIso(now))
      .run()
      .catch(() => undefined),
  );

  const state = randomToken(32);
  const stateHash = await sha256Hex(state);
  const verifier = randomToken(48);
  try {
    await env.DB.prepare(
      `INSERT INTO oauth_states (state_hash, provider, code_verifier, origin, return_to, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(stateHash, provider, verifier, origin, returnTo, nowIso(now), nowIso(now + STATE_TTL_MS))
      .run();
  } catch (e) {
    console.error(`oauth ${provider} start: state not stored:`, errText(e));
    return failTo(origin, provider, "unavailable");
  }

  const spec = AUTHORIZE[provider];
  const target = new URL(spec.url);
  target.searchParams.set("client_id", client.id);
  target.searchParams.set("redirect_uri", callbackUrl(provider));
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", await pkceChallenge(verifier));
  target.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(spec.params)) target.searchParams.set(k, v);
  return redirect(target.toString(), [bindingCookie(stateHash, Math.floor(STATE_TTL_MS / 1000))]);
}

// ── /auth/<provider>/callback ──────────────────────────────────────────────

export async function finishSignIn(request: Request, env: OAuthEnv, provider: OAuthProvider): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const providerError = url.searchParams.get("error");
  const state = url.searchParams.get("state") ?? "";
  if (!STATE_RE.test(state)) return failTo(origin, provider, providerError === "access_denied" ? "access_denied" : "invalid_state");

  const stateHash = await sha256Hex(state);
  let row: StateRow | null;
  try {
    row = await env.DB.prepare(`SELECT provider, code_verifier, origin, return_to, expires_at FROM oauth_states WHERE state_hash = ?1`)
      .bind(stateHash)
      .first<StateRow>();
  } catch (e) {
    console.error(`oauth ${provider} callback: state lookup failed:`, errText(e));
    return failTo(origin, provider, "unavailable");
  }
  if (!row) return failTo(origin, provider, providerError === "access_denied" ? "access_denied" : "state_expired");
  if (row.provider !== provider) return failTo(origin, provider, "invalid_state");

  // Started on a preview or local host: let that host finish, so the session
  // cookie is set on it. The row stays for that host to consume.
  if (row.origin !== origin && isAllowedOrigin(row.origin)) {
    return redirect(`${row.origin}/auth/${provider}/callback${url.search}`);
  }

  // From here on this host finishes the attempt, so it must be the browser that began it.
  if (readCookie(request, bindingName(stateHash)) !== "1") return failTo(origin, provider, "browser_mismatch");
  const clear = [bindingCookie(stateHash, 0)];

  // Single use: only the request that deletes the row may go on.
  let consumed = 0;
  try {
    const del = await env.DB.prepare(`DELETE FROM oauth_states WHERE state_hash = ?1`).bind(stateHash).run();
    consumed = Number(del.meta.changes) || 0;
  } catch (e) {
    console.error(`oauth ${provider} callback: state delete failed:`, errText(e));
    return failTo(origin, provider, "unavailable", clear);
  }
  if (!consumed || !(Date.parse(row.expires_at) > Date.now())) return failTo(origin, provider, "state_expired", clear);

  if (providerError) return failTo(origin, provider, providerError === "access_denied" ? "access_denied" : "provider_error", clear);
  const code = url.searchParams.get("code") ?? "";
  if (!code || code.length > 2048) return failTo(origin, provider, "missing_code", clear);

  const client = clientFor(env, provider);
  if (!client) return failTo(origin, provider, "not_configured", clear);

  let profile: Profile;
  try {
    const token = provider === "github" ? await githubToken(client, code, row.code_verifier) : await googleToken(client, code, row.code_verifier);
    profile = provider === "github" ? await githubProfile(token) : await googleProfile(token);
  } catch (e) {
    const failure = e instanceof SignInError ? e.code : "exchange_failed";
    console.error(`oauth ${provider} callback: ${failure}:`, errText(e));
    return failTo(origin, provider, failure, clear);
  }

  let userId: string;
  try {
    userId = await findOrCreateUser(env.DB, provider, profile);
  } catch (e) {
    console.error(`oauth ${provider} callback: account:`, errText(e));
    return failTo(origin, provider, "account_failed", clear);
  }

  let cookie: string;
  try {
    cookie = await createSession(env.DB, userId, request);
  } catch (e) {
    console.error(`oauth ${provider} callback: session:`, errText(e));
    return failTo(origin, provider, "unavailable", clear);
  }
  return redirect(landingUrl(row.return_to, origin), [cookie, ...clear]);
}

// ── Providers ──────────────────────────────────────────────────────────────

interface TokenReply {
  access_token?: unknown;
  error?: unknown;
}

async function readToken(res: Response, provider: OAuthProvider): Promise<string> {
  const data = ((await res.json().catch(() => ({}))) ?? {}) as TokenReply;
  if (!res.ok || typeof data.access_token !== "string" || !data.access_token) {
    const reason = typeof data.error === "string" ? data.error.slice(0, 60) : "no token";
    throw new SignInError("exchange_failed", `${provider} token endpoint ${res.status} ${reason}`);
  }
  return data.access_token;
}

async function githubToken(client: OAuthClient, code: string, verifier: string): Promise<string> {
  const res = await timedFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({
      client_id: client.id,
      client_secret: client.secret,
      code,
      redirect_uri: callbackUrl("github"),
      code_verifier: verifier,
    }).toString(),
  });
  return readToken(res, "github");
}

async function googleToken(client: OAuthClient, code: string, verifier: string): Promise<string> {
  const res = await timedFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl("google"),
      client_id: client.id,
      client_secret: client.secret,
      code_verifier: verifier,
    }).toString(),
  });
  return readToken(res, "google");
}

function cleanName(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null;
}

function cleanAvatar(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("https://") && v.length <= 1000 ? v : null;
}

async function getJson(url: string, token: string, headers: Record<string, string>, provider: OAuthProvider): Promise<unknown> {
  const res = await timedFetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new SignInError("profile_failed", `${provider} ${new URL(url).pathname} ${res.status}`);
  return res.json();
}

interface GitHubUser {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  avatar_url?: unknown;
}

interface GitHubEmail {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

async function githubProfile(token: string): Promise<Profile> {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28" };
  const user = ((await getJson("https://api.github.com/user", token, headers, "github")) ?? {}) as GitHubUser;
  const id = typeof user.id === "number" || typeof user.id === "string" ? String(user.id) : "";
  if (!id) throw new SignInError("profile_failed", "github /user has no id");
  const listed = await getJson("https://api.github.com/user/emails", token, headers, "github");
  const emails = (Array.isArray(listed) ? listed : []) as GitHubEmail[];
  const verified = emails.filter((e) => e.verified === true && typeof e.email === "string" && e.email.includes("@"));
  const pick = verified.find((e) => e.primary === true) ?? verified[0];
  const email = pick && typeof pick.email === "string" ? pick.email.trim().toLowerCase() : "";
  if (!email) throw new SignInError("no_verified_email", "github account has no verified email");
  return { id, email, name: cleanName(user.name) ?? cleanName(user.login), avatarUrl: cleanAvatar(user.avatar_url) };
}

interface GoogleUserInfo {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

async function googleProfile(token: string): Promise<Profile> {
  const info = ((await getJson("https://openidconnect.googleapis.com/v1/userinfo", token, { Accept: "application/json" }, "google")) ?? {}) as GoogleUserInfo;
  const id = typeof info.sub === "string" ? info.sub : "";
  if (!id) throw new SignInError("profile_failed", "google userinfo has no sub");
  const email = typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  const verified = info.email_verified === true || info.email_verified === "true";
  if (!email || !email.includes("@") || !verified) throw new SignInError("no_verified_email", "google email missing or unverified");
  return { id, email, name: cleanName(info.name), avatarUrl: cleanAvatar(info.picture) };
}

// ── Accounts ───────────────────────────────────────────────────────────────

/**
 * The user behind this provider account: an existing identity wins; else a
 * user with the same verified email gets this identity attached — unless that
 * user already has a different account from the SAME provider (GitHub and
 * Google let one address be verified on only one account at a time, so a
 * second account presenting it means the address changed hands, e.g. a
 * recycled work address); else a new user is created. A new user whose email
 * is still held by another user starts without one (users.email is unique).
 * INSERT OR IGNORE + a re-read makes concurrent first sign-ins (double
 * clicks, two tabs) converge on one user.
 */
async function findOrCreateUser(db: D1Database, provider: OAuthProvider, p: Profile): Promise<string> {
  const now = nowIso();
  const identity = () =>
    db
      .prepare(`SELECT user_id FROM oauth_identities WHERE provider = ?1 AND provider_user_id = ?2`)
      .bind(provider, p.id)
      .first<{ user_id: string }>();

  let found = await identity();
  for (let attempt = 0; !found && attempt < 2; attempt++) {
    const byEmail = await db
      .prepare(
        `SELECT u.id,
                EXISTS (SELECT 1 FROM oauth_identities i WHERE i.user_id = u.id AND i.provider = ?2 AND i.provider_user_id <> ?3) AS same_provider
           FROM users u WHERE lower(u.email) = ?1 AND u.email IS NOT NULL LIMIT 1`,
      )
      .bind(p.email, provider, p.id)
      .first<{ id: string; same_provider: number }>();
    const linkTo = byEmail && !Number(byEmail.same_provider) ? byEmail.id : null;
    const userId = linkTo ?? crypto.randomUUID();
    const stmts: D1PreparedStatement[] = [];
    if (!linkTo) {
      // Skipped when a concurrent sign-in already attached this provider
      // account, so a double click leaves no orphan user behind.
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, display_name, avatar_url, created_at, last_sign_in_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?5
              WHERE NOT EXISTS (SELECT 1 FROM oauth_identities WHERE provider = ?6 AND provider_user_id = ?7)`,
          )
          .bind(userId, byEmail ? null : p.email, p.name, p.avatarUrl, now, provider, p.id),
      );
    }
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO oauth_identities (provider, provider_user_id, user_id, email, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(provider, p.id, userId, p.email, now),
    );
    try {
      await db.batch(stmts);
    } catch (e) {
      // Usually a concurrent sign-in created the user or the email first; look again.
      console.error(`oauth ${provider}: account insert retry:`, errText(e));
    }
    found = await identity();
  }
  if (!found) throw new Error("identity could not be created");

  // Refresh what the provider reports. The email only moves if no other user
  // already holds it (users_email_lower is unique). Cosmetic: never fatal.
  await db
    .batch([
      db
        .prepare(
          `UPDATE users SET
             email = CASE WHEN EXISTS (SELECT 1 FROM users o WHERE lower(o.email) = ?2 AND o.email IS NOT NULL AND o.id <> ?1) THEN email ELSE ?2 END,
             display_name = COALESCE(?3, display_name),
             avatar_url = COALESCE(?4, avatar_url),
             last_sign_in_at = ?5
           WHERE id = ?1`,
        )
        .bind(found.user_id, p.email, p.name, p.avatarUrl, now),
      db.prepare(`UPDATE oauth_identities SET email = ?3 WHERE provider = ?1 AND provider_user_id = ?2`).bind(provider, p.id, p.email),
    ])
    .catch((e: unknown) => console.error(`oauth ${provider}: profile refresh:`, errText(e)));
  return found.user_id;
}
