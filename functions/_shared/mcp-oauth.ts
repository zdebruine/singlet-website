/**
 * OAuth 2.1 authorization server for the MCP endpoint, so https://singlet.bio/mcp installs as a
 * custom connector in Claude (claude.ai, Desktop, mobile, Claude Code) and in any client that
 * follows the MCP authorization spec: the user pastes the URL, signs in with GitHub or Google,
 * approves, and the client holds a token instead of a pasted API key. Tables in
 * schema/034_mcp_oauth.sql.
 *
 * Endpoints (all on the request's own origin, so previews work end to end):
 *   /.well-known/oauth-protected-resource[/mcp]  RFC 9728: resource = <origin>/mcp, authorization_servers = [<origin>]
 *   /.well-known/oauth-authorization-server      RFC 8414 metadata
 *   POST /oauth/register                          RFC 7591 dynamic client registration (public or confidential)
 *   GET  /oauth/authorize                         checks client, redirect_uri and S256 challenge, parks the request,
 *                                                 sends the browser to /oauth/consent
 *   GET  /oauth/consent?request=…                 sign-in buttons (the existing GitHub/Google flow, which returns
 *                                                 here), then "Allow <client> to use singlet tools as you"
 *   POST /oauth/consent                           allow → redirect with a single-use code; cancel → access_denied
 *   POST /oauth/token                             authorization_code (PKCE) and refresh_token (rotated) grants
 *   POST /oauth/revoke                            RFC 7009
 *
 * Tokens: access `sat_…` (1 hour) and refresh `srt_…` (60 days, replaced on every use; a replaced
 * one presented again after a 30-second grace revokes the whole connection). Both belong to a grant
 * (one user × one client), listed on /account where it can be disconnected. An access token counts
 * only on the origin it was issued for, and acts as its owner exactly like an API key
 * (identity.ts), so metering, rate limits, the AI allowance and private cohorts are unchanged.
 * Only sha256 of codes, tokens, request ids and client secrets is stored.
 */
import type { AppEnv, WaitUntil } from "./env";
import { CORS_HEADERS } from "./cors";
import { sha256Hex } from "./hash";
import { CANONICAL_ORIGIN, configuredProviders, isAllowedOrigin, type OAuthProvider } from "./oauth";
import { lookupSession, nowIso, randomToken, type SessionUser } from "./session";
import { withinRate } from "./spend";

export const MCP_SCOPE = "mcp";
export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_MS = 60 * 86_400_000;
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_TTL_MS = 15 * 60_000;
/** A refresh token replaced this recently may be presented again (two concurrent refreshes from one client). */
const ROTATION_GRACE_MS = 30_000;
const MEMO_TTL_MS = 60_000;
const TOUCH_EVERY_MS = 5 * 60_000;
const REGISTER_PER_HOUR = 30;
const MAX_REDIRECT_URIS = 10;

export const ACCESS_TOKEN_RE = /^sat_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN_RE = /^srt_[A-Za-z0-9_-]{43}$/;
const CODE_RE = /^sac_[A-Za-z0-9_-]{43}$/;
const CLIENT_ID_RE = /^scl_[A-Za-z0-9_-]{22}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type OAuthEnv = Pick<AppEnv, "DB" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">;

// ── Shared helpers ─────────────────────────────────────────────────────────

/** The issuer for this request: its own origin on singlet.bio, a preview or localhost; else the canonical site. */
export function issuerFor(request: Request | string): string {
  const origin = new URL(typeof request === "string" ? request : request.url).origin;
  return isAllowedOrigin(origin) ? origin : CANONICAL_ORIGIN;
}

export function resourceFor(issuer: string): string {
  return `${issuer}/mcp`;
}

export function resourceMetadataUrl(issuer: string): string {
  return `${issuer}/.well-known/oauth-protected-resource`;
}

/** The challenge an MCP request without a usable credential answers with (RFC 6750 + RFC 9728). */
export function wwwAuthenticate(issuer: string, error?: "invalid_token"): string {
  const parts = [`resource_metadata="${resourceMetadataUrl(issuer)}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 S256. */
export async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

const JSON_HEADERS = { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/** RFC 6749 §5.2 error. */
function oauthError(error: string, description: string, status = 400, extra: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, extra);
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function methodNotAllowed(allow: string): Response {
  return oauthError("invalid_request", `Use ${allow}.`, 405, { Allow: allow });
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Discovery ──────────────────────────────────────────────────────────────

export function protectedResourceMetadata(issuer: string) {
  return {
    resource: resourceFor(issuer),
    authorization_servers: [issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "singlet.bio",
    resource_documentation: `${issuer}/docs/mcp`,
  };
}

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: [MCP_SCOPE, "offline_access"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/docs/mcp`,
  };
}

/** GET /.well-known/oauth-protected-resource[/mcp] and /.well-known/oauth-authorization-server[/…]; null for other paths. */
export function wellKnown(request: Request): Response | null {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const issuer = issuerFor(request);
  let body: unknown = null;
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") body = protectedResourceMetadata(issuer);
  else if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") body = authorizationServerMetadata(issuer);
  if (body === null) return null;
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET");
  return new Response(JSON.stringify(body), { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } });
}

// ── Clients ────────────────────────────────────────────────────────────────

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  client_uri: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
}

type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";
const AUTH_METHODS: readonly AuthMethod[] = ["none", "client_secret_post", "client_secret_basic"];

/** https anywhere, or http on a loopback host (native apps such as Claude Code and MCP Inspector). No fragments or userinfo. */
export function validRedirectUri(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 512 || v.includes("#") || /\s/.test(v)) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:" && u.hostname) return v;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return v;
  return null;
}

/**
 * Exact match, except that a loopback http redirect may use any port (RFC 8252 §7.3; Claude Code
 * binds an ephemeral port per session).
 */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered);
    const b = new URL(requested);
    return (
      a.protocol === "http:" &&
      b.protocol === "http:" &&
      LOOPBACK_HOSTS.has(a.hostname) &&
      a.hostname === b.hostname &&
      a.pathname === b.pathname &&
      a.search === b.search
    );
  } catch {
    return false;
  }
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
}

function parseUris(row: ClientRow): string[] {
  try {
    const v = JSON.parse(row.redirect_uris);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function getClient(db: D1Database, clientId: string): Promise<ClientRow | null> {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  return db
    .prepare(`SELECT client_id, client_secret_hash, client_name, client_uri, redirect_uris, token_endpoint_auth_method FROM oauth_clients WHERE client_id = ?1`)
    .bind(clientId)
    .first<ClientRow>();
}

/** POST /oauth/register (RFC 7591). */
export async function register(request: Request, env: OAuthEnv): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return oauthError("invalid_client_metadata", "Send client metadata as a JSON object.");
  const body = raw as Record<string, unknown>;

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > MAX_REDIRECT_URIS) return oauthError("invalid_redirect_uri", `Give 1 to ${MAX_REDIRECT_URIS} redirect_uris.`);
  const redirectUris: string[] = [];
  for (const u of uris) {
    const ok = validRedirectUri(u);
    if (!ok) return oauthError("invalid_redirect_uri", "Each redirect_uri must be https, or http on localhost / 127.0.0.1 / [::1], without a fragment.");
    if (!redirectUris.includes(ok)) redirectUris.push(ok);
  }

  const grants = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (!grants.every((g) => g === "authorization_code" || g === "refresh_token") || !grants.includes("authorization_code")) {
    return oauthError("invalid_client_metadata", "grant_types may be authorization_code and refresh_token.");
  }
  const responses = Array.isArray(body.response_types) ? body.response_types : ["code"];
  if (!responses.every((r) => r === "code")) return oauthError("invalid_client_metadata", "response_types must be [\"code\"].");

  const askedMethod = body.token_endpoint_auth_method ?? "none";
  if (!AUTH_METHODS.includes(askedMethod as AuthMethod)) {
    return oauthError("invalid_client_metadata", `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}.`);
  }
  const method = askedMethod as AuthMethod;

  const ipHash = (await sha256Hex(`oauth-register:${request.headers.get("CF-Connecting-IP") ?? "0.0.0.0"}`)).slice(0, 32);
  if (!(await withinRate(env.DB, `ip:${ipHash}`, "oauth_register", REGISTER_PER_HOUR, 3_600_000))) {
    return oauthError("invalid_request", "Too many registrations from this address. Try again later.", 429);
  }

  const clientName = cleanText(body.client_name, 100);
  const clientUriRaw = cleanText(body.client_uri, 512);
  const clientUri = clientUriRaw && /^https:\/\//.test(clientUriRaw) ? clientUriRaw : null;
  const clientId = `scl_${randomToken(16).slice(0, 22)}`;
  const secret = method === "none" ? null : `scs_${randomToken(32)}`;
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, client_uri, redirect_uris, token_endpoint_auth_method, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(clientId, secret ? await sha256Hex(secret) : null, clientName, clientUri, JSON.stringify(redirectUris), method, nowIso(now))
      .run();
  } catch (e) {
    console.error("oauth register:", errText(e));
    return oauthError("temporarily_unavailable", "Registration is unavailable right now. Try again in a minute.", 503);
  }
  // Registrations that never completed a sign-in within a week are dead; bounded so it never gets slow.
  await env.DB.prepare(
    `DELETE FROM oauth_clients WHERE client_id IN (SELECT client_id FROM oauth_clients WHERE last_used_at IS NULL AND created_at < ?1 LIMIT 50)`,
  )
    .bind(nowIso(now - 7 * 86_400_000))
    .run()
    .catch(() => undefined);

  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: clientName ?? undefined,
      client_uri: clientUri ?? undefined,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      scope: MCP_SCOPE,
    },
    201,
  );
}

// ── HTML (sign-in and consent pages) ───────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const PAGE_CSS = `:root{color-scheme:light dark;--bg:#fff;--ink:#0F1F1D;--muted:#5B6B68;--line:#D8E1DE;--primary:#0E8C7E;--primary-hover:#0B7A6E;--on-primary:#fff;--warn:#B45309;--warn-tint:#FBEFDF}
@media(prefers-color-scheme:dark){:root{--bg:#0E1615;--ink:#E6EEEC;--muted:#93A5A1;--line:#263834;--primary:#2EBFAE;--primary-hover:#27A999;--on-primary:#0E1615;--warn:#E9A15B;--warn-tint:#382719}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "IBM Plex Sans",ui-sans-serif,system-ui,sans-serif}
main{max-width:440px;margin:0 auto;padding:56px 16px}
.brand{font-weight:600;letter-spacing:-.02em;font-size:17px;margin-bottom:32px}.brand span{color:var(--primary)}
h1{font-size:22px;line-height:1.3;font-weight:600;margin:0 0 12px}
p{margin:0 0 14px}.muted{color:var(--muted);font-size:14px}
ul{margin:0 0 18px;padding-left:20px}li{margin:4px 0}
.box{border:1px solid var(--line);border-radius:6px;padding:20px;margin:20px 0}
.warn{background:var(--warn-tint);color:var(--warn);border-radius:3px;padding:10px 12px;font-size:14px;margin:0 0 16px}
.row{display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;flex:1;min-width:140px;text-align:center;padding:10px 16px;border-radius:3px;border:1px solid var(--line);background:transparent;color:var(--ink);font:inherit;font-weight:500;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}.btn.primary:hover{background:var(--primary-hover)}
.btn:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:13px}a{color:var(--primary)}`;

function page(title: string, body: string, status = 200, formTarget: string | null = null): Response {
  const formAction = ["'self'", formTarget].filter(Boolean).join(" ");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · singlet.bio</title><style>${PAGE_CSS}</style></head><body><main><div class="brand">singlet<span>.bio</span></div>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Not no-referrer: under it browsers send `Origin: null` on the consent form's POST, which
      // consentDecision refuses. same-origin still sends nothing to the client's site.
      "Referrer-Policy": "same-origin",
      // form-action must also allow the client's redirect origin: browsers apply it to the redirect after the POST.
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

function errorPage(title: string, message: string, status = 400): Response {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p><p class="muted">Go back to the app you were connecting and try again.</p>`, status);
}

// ── /oauth/authorize ───────────────────────────────────────────────────────

interface RequestRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  state: string | null;
  expires_at: string;
  client_name: string | null;
}

function redirectWith(redirectUri: string, params: Record<string, string | null | undefined>, status = 302): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return new Response(null, { status, headers: { Location: u.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

/** A resource indicator (RFC 8707) is optional; when sent it must name this server's MCP endpoint. */
function resourceOk(value: string | null, issuer: string): boolean {
  if (value == null || value === "") return true;
  const want = resourceFor(issuer);
  return value === want || value === `${want}/` || value === issuer || value === `${issuer}/`;
}

/** GET /oauth/authorize */
export async function authorize(request: Request, env: OAuthEnv, waitUntil: WaitUntil): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams;
  const issuer = issuerFor(request);
  const clientId = q.get("client_id") ?? "";
  const client = await getClient(env.DB, clientId).catch(() => null);
  if (!client) return errorPage("Unknown app", "This app is not registered with singlet.bio, or its registration expired.");

  const registered = parseUris(client);
  const asked = q.get("redirect_uri");
  const redirectUri = asked ? (registered.some((r) => redirectMatches(r, asked)) ? asked : null) : registered.length === 1 ? registered[0] : null;
  if (!redirectUri) return errorPage("Redirect not allowed", "The app asked to return to an address it did not register.");

  // From here on, errors go back to the app (RFC 6749 §4.1.2.1).
  const state = q.get("state");
  const fail = (error: string, description: string) => redirectWith(redirectUri, { error, error_description: description, state, iss: issuer });
  if (state && state.length > 2048) return fail("invalid_request", "state is too long.");
  if (q.get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = q.get("code_challenge") ?? "";
  if ((q.get("code_challenge_method") ?? "") !== "S256" || !CHALLENGE_RE.test(challenge)) {
    return fail("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
  }
  if (!resourceOk(q.get("resource"), issuer)) return fail("invalid_target", `resource must be ${resourceFor(issuer)}.`);

  const id = randomToken(32);
  const now = Date.now();
  waitUntil(
    env.DB.prepare(`DELETE FROM oauth_requests WHERE request_hash IN (SELECT request_hash FROM oauth_requests WHERE expires_at < ?1 LIMIT 50)`)
      .bind(nowIso(now))
      .run()
      .catch(() => undefined),
  );
  try {
    await env.DB.prepare(
      `INSERT INTO oauth_requests (request_hash, client_id, redirect_uri, code_challenge, scope, resource, state, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(await sha256Hex(id), client.client_id, redirectUri, challenge, MCP_SCOPE, resourceFor(issuer), state, nowIso(now), nowIso(now + REQUEST_TTL_MS))
      .run();
  } catch (e) {
    console.error("oauth authorize:", errText(e));
    return fail("temporarily_unavailable", "singlet.bio cannot start a sign-in right now. Try again in a minute.");
  }
  return new Response(null, { status: 302, headers: { Location: `${issuer}/oauth/consent?request=${id}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

// ── /oauth/consent ─────────────────────────────────────────────────────────

async function loadRequest(db: D1Database, id: string): Promise<RequestRow | null> {
  if (!REQUEST_ID_RE.test(id)) return null;
  const row = await db
    .prepare(
      `SELECT r.client_id, r.redirect_uri, r.code_challenge, r.scope, r.resource, r.state, r.expires_at, c.client_name
         FROM oauth_requests r JOIN oauth_clients c ON c.client_id = r.client_id
        WHERE r.request_hash = ?1`,
    )
    .bind(await sha256Hex(id))
    .first<RequestRow>();
  return row && Date.parse(row.expires_at) > Date.now() ? row : null;
}

function hostOf(uri: string): { host: string; loopback: boolean } {
  try {
    const u = new URL(uri);
    return { host: u.host, loopback: LOOPBACK_HOSTS.has(u.hostname) };
  } catch {
    return { host: uri, loopback: false };
  }
}

function originOf(uri: string): string {
  try {
    return new URL(uri).origin;
  } catch {
    return "";
  }
}

const PROVIDER_LABEL: Record<OAuthProvider, string> = { github: "GitHub", google: "Google" };

function providersOn(env: OAuthEnv): OAuthProvider[] {
  const on = configuredProviders(env);
  return (Object.keys(PROVIDER_LABEL) as OAuthProvider[]).filter((p) => on[p]);
}

function startUrl(p: OAuthProvider, returnTo: string): string {
  return `/auth/${p}/start?return_to=${encodeURIComponent(returnTo)}`;
}

function signInLinks(env: OAuthEnv, returnTo: string, cls: string): string {
  return providersOn(env)
    .map((p) => `<a class="${cls}" href="${esc(startUrl(p, returnTo))}">Continue with ${PROVIDER_LABEL[p]}</a>`)
    .join("");
}

/** Signing in again replaces the session, so "not you?" is just the sign-in links. */
function switchAccount(env: OAuthEnv, returnTo: string): string {
  const links = providersOn(env).map((p) => `<a href="${esc(startUrl(p, returnTo))}">${PROVIDER_LABEL[p]}</a>`);
  return links.length ? ` Not you? Sign in with ${links.join(" or ")}.` : "";
}

/** GET /oauth/consent?request=… */
export async function consentPage(request: Request, env: OAuthEnv, waitUntil: WaitUntil): Promise<Response> {
  const id = new URL(request.url).searchParams.get("request") ?? "";
  const row = await loadRequest(env.DB, id).catch(() => null);
  if (!row) return errorPage("This link has expired", "Sign-in requests last 15 minutes and work once.");
  const app = row.client_name ?? "An MCP client";
  const { host, loopback } = hostOf(row.redirect_uri);
  const returnTo = `/oauth/consent?request=${id}`;
  const user = await lookupSession(env.DB, request, waitUntil);

  if (!user) {
    const links = signInLinks(env, returnTo, "btn primary");
    return page(
      "Sign in",
      `<h1>Sign in to connect ${esc(app)}</h1>
       <p>${esc(app)} wants to use the singlet.bio tools with your account. Sign in first; you will be asked to approve next.</p>
       <div class="row" style="flex-direction:column">${links || `<p class="muted">Sign-in is not configured on this deployment.</p>`}</div>
       <p class="muted" style="margin-top:20px">No account yet? Signing in creates one. It is free.</p>`,
    );
  }
  return page(
    "Connect",
    `<h1>Allow ${esc(app)} to use singlet tools as you?</h1>
     <p class="muted">Signed in as <!--email_off-->${esc(signedInAs(user))}<!--/email_off-->.</p>
     <div class="box">
       <p>${esc(app)} will be able to:</p>
       <ul>
         <li>search the atlas and read studies, QC and download links</li>
         <li>read and save your cohorts and private projects</li>
         <li>use your monthly AI token allowance on searches that need it</li>
       </ul>
       <p class="muted" style="margin:0">It acts as you the way an API key does, but cannot create or revoke API keys. Calls are counted on your account.</p>
     </div>
     ${loopback ? `<p class="warn">This returns to a program on this computer (${esc(host)}). Allow only if you just started connecting from an app such as Claude Code.</p>` : `<p>You will return to <strong>${esc(host)}</strong>.</p>`}
     <form method="post" action="/oauth/consent">
       <input type="hidden" name="request" value="${esc(id)}">
       <div class="row">
         <button class="btn" type="submit" name="action" value="deny">Cancel</button>
         <button class="btn primary" type="submit" name="action" value="allow">Allow</button>
       </div>
     </form>
     <p class="muted" style="margin-top:20px">Disconnect it any time from <a href="/account">your account</a>.${switchAccount(env, returnTo)}</p>`,
    200,
    originOf(row.redirect_uri),
  );
}

/** The address is wrapped in email_off markers: Cloudflare's email obfuscation needs a script this page's CSP blocks. */
function signedInAs(user: SessionUser): string {
  return user.email ?? user.displayName ?? "your singlet.bio account";
}

/** Same check as identity.sameOriginOrSafe for this POST (kept local: identity.ts imports this module). */
function sameOrigin(request: Request): boolean {
  const self = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === self;
  const referer = request.headers.get("Referer");
  try {
    return !!referer && new URL(referer).origin === self;
  } catch {
    return false;
  }
}

/** POST /oauth/consent (the form above). */
export async function consentDecision(request: Request, env: OAuthEnv, waitUntil: WaitUntil): Promise<Response> {
  if (!sameOrigin(request)) return errorPage("Not allowed", "This form can only be sent from singlet.bio.", 403);
  const form = await request.formData().catch(() => null);
  const id = String(form?.get("request") ?? "");
  const action = String(form?.get("action") ?? "");
  const user = await lookupSession(env.DB, request, waitUntil);
  if (!user) return errorPage("Signed out", "Your singlet.bio session ended before you approved.", 401);
  if (!REQUEST_ID_RE.test(id)) return errorPage("This link has expired", "Sign-in requests last 15 minutes and work once.");

  // Single use: only the request that deletes the row may go on.
  const row = await env.DB.prepare(
    `DELETE FROM oauth_requests WHERE request_hash = ?1
     RETURNING client_id, redirect_uri, code_challenge, scope, resource, state, expires_at`,
  )
    .bind(await sha256Hex(id))
    .first<Omit<RequestRow, "client_name">>()
    .catch(() => null);
  if (!row || !(Date.parse(row.expires_at) > Date.now())) return errorPage("This link has expired", "Sign-in requests last 15 minutes and work once.");
  const issuer = issuerFor(request);
  if (action !== "allow") {
    return redirectWith(row.redirect_uri, { error: "access_denied", error_description: "The user did not approve the connection.", state: row.state, iss: issuer }, 303);
  }

  const code = `sac_${randomToken(32)}`;
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO oauth_codes (code_hash, grant_id, client_id, user_id, redirect_uri, code_challenge, scope, resource, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(await sha256Hex(code), crypto.randomUUID(), row.client_id, user.userId, row.redirect_uri, row.code_challenge, row.scope, row.resource, nowIso(now), nowIso(now + CODE_TTL_MS))
      .run();
  } catch (e) {
    console.error("oauth consent: code not stored:", errText(e));
    return redirectWith(row.redirect_uri, { error: "temporarily_unavailable", error_description: "Try again in a minute.", state: row.state, iss: issuer }, 303);
  }
  return redirectWith(row.redirect_uri, { code, state: row.state, iss: issuer }, 303);
}

// ── /oauth/token ───────────────────────────────────────────────────────────

interface ClientCredentials {
  id: string;
  secret: string | null;
}

async function readForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("Content-Type") ?? "";
  const text = await request.text().catch(() => "");
  if (text.length > 16_384) return new URLSearchParams();
  if (type.includes("application/json")) {
    try {
      const v = JSON.parse(text) as Record<string, unknown>;
      return new URLSearchParams(Object.entries(v).filter(([, x]) => typeof x === "string") as [string, string][]);
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(text);
}

function clientCredentials(request: Request, form: URLSearchParams): ClientCredentials | null {
  const m = /^Basic\s+(.+)$/i.exec((request.headers.get("Authorization") ?? "").trim());
  if (m) {
    try {
      const decoded = atob(m[1]);
      const i = decoded.indexOf(":");
      if (i > 0) return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) || null };
    } catch {
      return null;
    }
  }
  const id = form.get("client_id");
  return id ? { id, secret: form.get("client_secret") || null } : null;
}

/** The client behind these credentials, or null: a confidential client must present its secret. */
async function authenticateClient(db: D1Database, creds: ClientCredentials | null): Promise<ClientRow | null> {
  if (!creds) return null;
  const client = await getClient(db, creds.id);
  if (!client) return null;
  if (client.client_secret_hash) {
    if (!creds.secret || (await sha256Hex(creds.secret)) !== client.client_secret_hash) return null;
  }
  return client;
}

async function revokeGrant(db: D1Database, grantId: string, now = Date.now()): Promise<void> {
  await db
    .batch([
      db.prepare(`UPDATE oauth_grants SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL`).bind(grantId, nowIso(now)),
      db.prepare(`UPDATE oauth_tokens SET revoked_at = ?2, revoked_reason = 'revoked' WHERE grant_id = ?1 AND revoked_at IS NULL`).bind(grantId, nowIso(now)),
    ])
    .catch((e: unknown) => console.error("oauth revoke grant:", errText(e)));
  forgetAccessMemo();
}

async function tokenPair(db: D1Database, grantId: string, now: number, extra: D1PreparedStatement[] = []): Promise<{ access: string; refresh: string }> {
  const access = `sat_${randomToken(32)}`;
  const refresh = `srt_${randomToken(32)}`;
  const insert = `INSERT INTO oauth_tokens (token_hash, kind, grant_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`;
  await db.batch([
    ...extra,
    db.prepare(insert).bind(await sha256Hex(access), "access", grantId, nowIso(now), nowIso(now + ACCESS_TTL_S * 1000)),
    db.prepare(insert).bind(await sha256Hex(refresh), "refresh", grantId, nowIso(now), nowIso(now + REFRESH_TTL_MS)),
  ]);
  return { access, refresh };
}

function tokenResponse(pair: { access: string; refresh: string }, scope: string): Response {
  return json({ access_token: pair.access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: pair.refresh, scope });
}

function cleanup(db: D1Database, now: number): Promise<unknown> {
  const t = nowIso(now);
  return db
    .batch([
      db.prepare(`DELETE FROM oauth_tokens WHERE token_hash IN (SELECT token_hash FROM oauth_tokens WHERE expires_at < ?1 LIMIT 100)`).bind(t),
      db.prepare(`DELETE FROM oauth_codes WHERE code_hash IN (SELECT code_hash FROM oauth_codes WHERE expires_at < ?1 LIMIT 50)`).bind(t),
    ])
    .catch(() => undefined);
}

interface CodeRow {
  grant_id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
}

interface RefreshRow {
  grant_id: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  client_id: string;
  scope: string;
  resource: string;
  grant_revoked_at: string | null;
}

/** POST /oauth/token */
export async function token(request: Request, env: OAuthEnv, waitUntil: WaitUntil): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const form = await readForm(request);
  const grantType = form.get("grant_type") ?? "";
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  }
  const db = env.DB;
  const issuer = issuerFor(request);
  let client: ClientRow | null;
  try {
    client = await authenticateClient(db, clientCredentials(request, form));
  } catch (e) {
    console.error("oauth token: client lookup:", errText(e));
    return oauthError("temporarily_unavailable", "Try again in a minute.", 503);
  }
  if (!client) return oauthError("invalid_client", "Unknown client or wrong client credentials.", 401, { "WWW-Authenticate": 'Basic realm="singlet.bio"' });
  const now = Date.now();
  waitUntil(cleanup(db, now));
  const resource = form.get("resource");
  const touchClient = db.prepare(`UPDATE oauth_clients SET last_used_at = ?2 WHERE client_id = ?1`).bind(client.client_id, nowIso(now));

  try {
    if (grantType === "authorization_code") {
      const code = form.get("code") ?? "";
      if (!CODE_RE.test(code)) return oauthError("invalid_grant", "The authorization code is invalid, expired or already used.");
      const hash = await sha256Hex(code);
      const row = await db
        .prepare(
          `UPDATE oauth_codes SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL
           RETURNING grant_id, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at`,
        )
        .bind(hash, nowIso(now))
        .first<CodeRow>();
      if (!row) {
        // A second exchange of a code means it leaked: end whatever the first exchange produced.
        const used = await db.prepare(`SELECT grant_id FROM oauth_codes WHERE code_hash = ?1`).bind(hash).first<{ grant_id: string }>();
        if (used) await revokeGrant(db, used.grant_id, now);
        return oauthError("invalid_grant", "The authorization code is invalid, expired or already used.");
      }
      if (row.client_id !== client.client_id || !(Date.parse(row.expires_at) > now)) {
        return oauthError("invalid_grant", "The authorization code is invalid, expired or already used.");
      }
      const redirectUri = form.get("redirect_uri");
      if (redirectUri != null && redirectUri !== row.redirect_uri) return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
      const verifier = form.get("code_verifier") ?? "";
      if (!VERIFIER_RE.test(verifier) || (await s256(verifier)) !== row.code_challenge) {
        return oauthError("invalid_grant", "code_verifier does not match the code_challenge.");
      }
      if (!resourceOk(resource, issuer) || row.resource !== resourceFor(issuer)) return oauthError("invalid_target", `resource must be ${resourceFor(issuer)}.`);

      const grant = db
        .prepare(
          `INSERT INTO oauth_grants (id, user_id, client_id, client_name, scope, resource, created_at, last_used_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
        )
        .bind(row.grant_id, row.user_id, client.client_id, client.client_name, row.scope, row.resource, nowIso(now));
      return tokenResponse(await tokenPair(db, row.grant_id, now, [grant, touchClient]), row.scope);
    }

    const refresh = form.get("refresh_token") ?? "";
    const invalid = () => oauthError("invalid_grant", "The refresh token is invalid, expired or revoked. Sign in again.");
    if (!REFRESH_TOKEN_RE.test(refresh)) return invalid();
    const hash = await sha256Hex(refresh);
    const row = await db
      .prepare(
        `SELECT t.grant_id, t.expires_at, t.revoked_at, t.revoked_reason, g.client_id, g.scope, g.resource, g.revoked_at AS grant_revoked_at
           FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
          WHERE t.token_hash = ?1 AND t.kind = 'refresh'`,
      )
      .bind(hash)
      .first<RefreshRow>();
    if (!row || row.client_id !== client.client_id || row.grant_revoked_at || !(Date.parse(row.expires_at) > now)) return invalid();
    if (row.resource !== resourceFor(issuer) || !resourceOk(resource, issuer)) return oauthError("invalid_target", `resource must be ${resourceFor(issuer)}.`);
    if (row.revoked_at) {
      const recent = row.revoked_reason === "rotated" && now - Date.parse(row.revoked_at) <= ROTATION_GRACE_MS;
      if (!recent) {
        // An old refresh token came back: someone else may hold it. End the connection.
        await revokeGrant(db, row.grant_id, now);
        return invalid();
      }
    } else {
      // If a concurrent refresh rotated it first, changes is 0 and we are inside the grace window.
      await db.prepare(`UPDATE oauth_tokens SET revoked_at = ?2, revoked_reason = 'rotated' WHERE token_hash = ?1 AND revoked_at IS NULL`).bind(hash, nowIso(now)).run();
    }
    const touchGrant = db.prepare(`UPDATE oauth_grants SET last_used_at = ?2 WHERE id = ?1`).bind(row.grant_id, nowIso(now));
    return tokenResponse(await tokenPair(db, row.grant_id, now, [touchGrant, touchClient]), row.scope);
  } catch (e) {
    console.error(`oauth token ${grantType}:`, errText(e));
    return oauthError("temporarily_unavailable", "Try again in a minute.", 503);
  }
}

/** POST /oauth/revoke (RFC 7009): ends the connection the token belongs to. Always 200 for a known client. */
export async function revoke(request: Request, env: OAuthEnv): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return methodNotAllowed("POST");
  const form = await readForm(request);
  const client = await authenticateClient(env.DB, clientCredentials(request, form)).catch(() => null);
  if (!client) return oauthError("invalid_client", "Unknown client or wrong client credentials.", 401);
  const value = form.get("token") ?? "";
  if (ACCESS_TOKEN_RE.test(value) || REFRESH_TOKEN_RE.test(value)) {
    const row = await env.DB.prepare(
      `SELECT g.id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = ?1`,
    )
      .bind(await sha256Hex(value))
      .first<{ id: string; client_id: string }>()
      .catch(() => null);
    if (row && row.client_id === client.client_id) await revokeGrant(env.DB, row.id);
  }
  return new Response(null, { status: 200, headers: JSON_HEADERS });
}

// ── Access tokens on API and MCP requests ──────────────────────────────────

export type AccessCheck =
  | { ok: true; userId: string; grantId: string; clientId: string }
  | { ok: false; reason: "unknown" | "revoked" | "expired" | "unavailable" };

interface AccessRow {
  grant_id: string;
  user_id: string;
  client_id: string;
  resource: string;
  last_used_at: string | null;
  grant_revoked_at: string | null;
  expires_at: string;
  revoked_at: string | null;
}

interface AccessMemo {
  result: AccessCheck;
  expiresAt: number;
  at: number;
  lastTouched: number;
}

/** Per-isolate memo keyed by token hash (never the token itself). */
const accessMemo = new Map<string, AccessMemo>();

export function forgetAccessMemo(): void {
  accessMemo.clear();
}

/**
 * Validate a `sat_…` access token for a request to `origin`. Valid and invalid results are memoised
 * for up to 60 s per isolate (never past the token's expiry); the grant's last_used_at is refreshed in
 * the background at most every 5 min.
 */
export async function checkAccessToken(db: D1Database, token: string, origin: string, waitUntil: WaitUntil): Promise<AccessCheck> {
  const hash = await sha256Hex(token);
  const now = Date.now();
  const want = resourceFor(issuerFor(origin));
  const touch = (grantId: string) =>
    db.prepare(`UPDATE oauth_grants SET last_used_at = ?2 WHERE id = ?1`).bind(grantId, nowIso(now)).run().catch(() => undefined);

  const hit = accessMemo.get(`${hash}|${want}`);
  if (hit && now - hit.at < MEMO_TTL_MS) {
    if (!hit.result.ok) return hit.result;
    if (now < hit.expiresAt) {
      if (now - hit.lastTouched >= TOUCH_EVERY_MS) {
        hit.lastTouched = now;
        waitUntil(touch(hit.result.grantId));
      }
      return hit.result;
    }
  }

  let result: AccessCheck;
  let expiresAt = now + MEMO_TTL_MS;
  let lastTouched = now;
  try {
    const row = await db
      .prepare(
        `SELECT g.id AS grant_id, g.user_id, g.client_id, g.resource, g.last_used_at, g.revoked_at AS grant_revoked_at, t.expires_at, t.revoked_at
           FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
          WHERE t.token_hash = ?1 AND t.kind = 'access'`,
      )
      .bind(hash)
      .first<AccessRow>();
    if (!row || row.resource !== want) result = { ok: false, reason: "unknown" };
    else if (row.grant_revoked_at || row.revoked_at) result = { ok: false, reason: "revoked" };
    else if (!(Date.parse(row.expires_at) > now)) result = { ok: false, reason: "expired" };
    else {
      result = { ok: true, userId: row.user_id, grantId: row.grant_id, clientId: row.client_id };
      expiresAt = Math.min(expiresAt, Date.parse(row.expires_at));
      const used = row.last_used_at ? Date.parse(row.last_used_at) : 0;
      if (!Number.isFinite(used) || now - used >= TOUCH_EVERY_MS) waitUntil(touch(row.grant_id));
      else lastTouched = used;
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (accessMemo.size > 5000) accessMemo.clear();
  accessMemo.set(`${hash}|${want}`, { result, expiresAt, at: now, lastTouched });
  return result;
}

// ── Connections on /account ────────────────────────────────────────────────

export interface ConnectionItem {
  id: string;
  client_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** The user's live connections (approved clients), newest first. */
export async function listConnections(db: D1Database, userId: string): Promise<ConnectionItem[]> {
  const rows = await db
    .prepare(
      `SELECT id, client_name, created_at, last_used_at FROM oauth_grants
        WHERE user_id = ?1 AND revoked_at IS NULL
          AND EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.grant_id = oauth_grants.id AND t.kind = 'refresh' AND t.revoked_at IS NULL AND t.expires_at > ?2)
        ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(userId, nowIso())
    .all<ConnectionItem>();
  return rows.results ?? [];
}

/** Disconnect one of the user's connections. False when it is not theirs or already gone. */
export async function revokeConnection(db: D1Database, userId: string, grantId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM oauth_grants WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL`).bind(grantId, userId).first<{ id: string }>();
  if (!row) return false;
  await revokeGrant(db, row.id);
  return true;
}
