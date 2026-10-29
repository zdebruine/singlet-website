// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { onRequestPost as mcpPost } from "../../functions/mcp";
import { onRequest as middleware } from "../../functions/_middleware";
import { onRequest as connectionsApi } from "../../functions/api/connections";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo, resolveIdentity } from "../../functions/_shared/identity";
import {
  authorize,
  consentDecision,
  consentPage,
  forgetAccessMemo,
  metadataDocumentUrl,
  redirectMatches,
  register,
  revoke,
  s256,
  token,
  validRedirectUri,
} from "../../functions/_shared/mcp-oauth";
import { createSession } from "../../functions/_shared/session";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = ["010_accounts.sql", "012_ai_budget.sql", "034_mcp_oauth.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n");
const SITE = "https://singlet.bio";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const KEY = "sk_live_" + "a".repeat(32);
const VERIFIER = "v".repeat(20) + "-._~" + "w".repeat(40);
const noWait = () => undefined;

type Env = { DB: D1Database; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; MCP_RATE_PER_MIN?: string };

async function setup(): Promise<Env> {
  const db = createTestD1(SCHEMA);
  await db.exec(`INSERT INTO users (id, email, display_name) VALUES ('u1', 'u1@example.com', 'User One'), ('u2', 'u2@example.com', 'User Two')`);
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_aaaa', ?1)`).bind(await sha256Hex(KEY)).run();
  return { DB: db, GITHUB_CLIENT_ID: "gh", GITHUB_CLIENT_SECRET: "secret" };
}

async function cookieFor(env: Env, userId = "u1"): Promise<string> {
  const set = await createSession(env.DB, userId, new Request(SITE));
  return set.split(";")[0];
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

async function registerClient(env: Env, body: Record<string, unknown> = {}, origin = SITE) {
  const res = await register(
    new Request(`${origin}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], ...body }) }),
    env,
  );
  return { res, body: (await res.json()) as Record<string, unknown> };
}

function authorizeUrl(clientId: string, extra: Record<string, string> = {}, origin = SITE, challenge?: string) {
  const u = new URL(`${origin}/oauth/authorize`);
  const q: Record<string, string> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge ?? "",
    code_challenge_method: "S256",
    state: "st4te",
    scope: "mcp",
    resource: `${origin}/mcp`,
    ...extra,
  };
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
}

/** register → authorize → consent (signed in) → redirect with a code. */
async function getCode(env: Env, opts: { origin?: string; userId?: string; clientId?: string; redirect?: string } = {}) {
  const origin = opts.origin ?? SITE;
  const clientId = opts.clientId ?? ((await registerClient(env, opts.redirect ? { redirect_uris: [opts.redirect] } : {}, origin)).body.client_id as string);
  const challenge = await s256(VERIFIER);
  const extra = opts.redirect ? { redirect_uri: opts.redirect } : {};
  const start = await authorize(new Request(authorizeUrl(clientId, extra, origin, challenge)), env, noWait);
  expect(start.status).toBe(302);
  const consentUrl = new URL(start.headers.get("Location") ?? "");
  expect(consentUrl.pathname).toBe("/oauth/consent");
  const requestId = consentUrl.searchParams.get("request") ?? "";
  const cookie = await cookieFor(env, opts.userId ?? "u1");
  const decided = await consentDecision(
    new Request(`${origin}/oauth/consent`, { method: "POST", headers: { ...FORM_HEADERS, Cookie: cookie, Origin: origin }, body: form({ request: requestId, action: "allow" }) }),
    env,
    noWait,
  );
  expect(decided.status).toBe(303);
  const back = new URL(decided.headers.get("Location") ?? "");
  return { clientId, back, code: back.searchParams.get("code") ?? "", requestId, cookie };
}

async function exchange(env: Env, clientId: string, code: string, verifier = VERIFIER, origin = SITE) {
  const res = await token(
    new Request(`${origin}/oauth/token`, {
      method: "POST",
      headers: FORM_HEADERS,
      body: form({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: CLAUDE_CALLBACK, code_verifier: verifier, resource: `${origin}/mcp` }),
    }),
    env,
    noWait,
  );
  return { res, body: (await res.json()) as Record<string, string | number> };
}

async function refreshWith(env: Env, clientId: string, refreshToken: string) {
  const res = await token(
    new Request(`${SITE}/oauth/token`, { method: "POST", headers: FORM_HEADERS, body: form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }) }),
    env,
    noWait,
  );
  return { res, body: (await res.json()) as Record<string, string | number> };
}

function mcp(env: Env, body: unknown, headers: Record<string, string> = {}, origin = SITE) {
  const request = new Request(`${origin}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return mcpPost({ request, env, waitUntil: noWait, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

beforeEach(() => {
  forgetKeyMemo();
  forgetAccessMemo();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("discovery metadata", () => {
  const get = (path: string) =>
    (middleware as unknown as (c: unknown) => Promise<Response>)({ request: new Request(`${SITE}${path}`), next: async () => new Response("spa", { status: 200 }) });

  it("protected resource metadata names the MCP URL and this site as the authorization server", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.resource).toBe("https://singlet.bio/mcp");
      expect(body.authorization_servers).toEqual(["https://singlet.bio"]);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });

  it("authorization server metadata advertises the endpoints, S256 and both grants", async () => {
    const body = (await (await get("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(body.issuer).toBe(SITE);
    expect(body.authorization_endpoint).toBe(`${SITE}/oauth/authorize`);
    expect(body.token_endpoint).toBe(`${SITE}/oauth/token`);
    expect(body.registration_endpoint).toBe(`${SITE}/oauth/register`);
    expect(body.code_challenge_methods_supported).toEqual(["S256"]);
    expect(body.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(body.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("is served for a preview on its own origin, and other paths fall through", async () => {
    const preview = "https://claude-mcp-oauth.singlet-4gc.pages.dev";
    const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
      request: new Request(`${preview}/.well-known/oauth-protected-resource`),
      next: async () => new Response("spa"),
    });
    expect(((await res.json()) as { resource: string }).resource).toBe(`${preview}/mcp`);
    expect(await (await get("/.well-known/security.txt")).text()).toBe("spa");
  });
});

describe("dynamic client registration", () => {
  it("registers a public client for Claude's callback", async () => {
    const env = await setup();
    const { res, body } = await registerClient(env);
    expect(res.status).toBe(201);
    expect(body.client_id).toMatch(/^scl_/);
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.redirect_uris).toEqual([CLAUDE_CALLBACK]);
  });

  it("issues a secret to a confidential client and requires it at the token endpoint", async () => {
    const env = await setup();
    const { body } = await registerClient(env, { token_endpoint_auth_method: "client_secret_post" });
    expect(body.client_secret).toMatch(/^scs_/);
    const { code } = await getCode(env, { clientId: body.client_id as string });
    const noSecret = await exchange(env, body.client_id as string, code);
    expect(noSecret.res.status).toBe(401);
    expect(noSecret.body.error).toBe("invalid_client");
  });

  it("accepts https and loopback redirects only", async () => {
    expect(validRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBeTruthy();
    expect(validRedirectUri("https://claude.com/api/mcp/auth_callback")).toBeTruthy();
    expect(validRedirectUri("http://localhost:6274/oauth/callback")).toBeTruthy();
    expect(validRedirectUri("http://127.0.0.1:33418/callback")).toBeTruthy();
    expect(validRedirectUri("http://[::1]:8080/cb")).toBeTruthy();
    expect(validRedirectUri("http://evil.example/cb")).toBeNull();
    expect(validRedirectUri("javascript:alert(1)")).toBeNull();
    expect(validRedirectUri("https://claude.ai/cb#frag")).toBeNull();
    expect(validRedirectUri("https://user:pw@claude.ai/cb")).toBeNull();
    const env = await setup();
    const { res, body } = await registerClient(env, { redirect_uris: ["http://evil.example/cb"] });
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_redirect_uri");
  });

  it("matches loopback redirects on any port, everything else exactly", () => {
    expect(redirectMatches("http://localhost:1234/callback", "http://localhost:5678/callback")).toBe(true);
    expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:5678/callback")).toBe(true);
    expect(redirectMatches("http://localhost/callback", "http://127.0.0.1:5678/callback")).toBe(false);
    expect(redirectMatches("http://localhost/callback", "http://localhost:5678/other")).toBe(false);
    expect(redirectMatches(CLAUDE_CALLBACK, "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
  });
});

describe("authorization and consent", () => {
  it("refuses an unknown client or an unregistered redirect without redirecting", async () => {
    const env = await setup();
    const unknown = await authorize(new Request(authorizeUrl("scl_" + "x".repeat(22), {}, SITE, await s256(VERIFIER))), env, noWait);
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("Location")).toBeNull();
    const { body } = await registerClient(env);
    const wrong = await authorize(new Request(authorizeUrl(body.client_id as string, { redirect_uri: "https://evil.example/cb" }, SITE, await s256(VERIFIER))), env, noWait);
    expect(wrong.status).toBe(400);
    expect(wrong.headers.get("Location")).toBeNull();
  });

  it("requires PKCE S256, reporting it to the app's redirect", async () => {
    const env = await setup();
    const { body } = await registerClient(env);
    const res = await authorize(new Request(authorizeUrl(body.client_id as string, { code_challenge_method: "plain", code_challenge: "x".repeat(43) })), env, noWait);
    const back = new URL(res.headers.get("Location") ?? "");
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("st4te");
  });

  it("asks a signed-out visitor to sign in and comes back to the same request", async () => {
    const env = await setup();
    const { body } = await registerClient(env);
    const start = await authorize(new Request(authorizeUrl(body.client_id as string, {}, SITE, await s256(VERIFIER))), env, noWait);
    const consentUrl = start.headers.get("Location") ?? "";
    const page = await consentPage(new Request(consentUrl), env, noWait);
    const html = await page.text();
    expect(html).toContain("Sign in to connect Claude");
    const returnTo = new URL(consentUrl).pathname + new URL(consentUrl).search;
    expect(html).toContain(`/auth/github/start?return_to=${encodeURIComponent(returnTo)}`.replace(/&/g, "&amp;"));
    expect(page.headers.get("Content-Security-Policy")).toMatch(/frame-ancestors 'none'/);

    const signedIn = await consentPage(new Request(consentUrl, { headers: { Cookie: await cookieFor(env) } }), env, noWait);
    const consent = await signedIn.text();
    expect(consent).toContain("Allow Claude to use singlet tools as you?");
    expect(consent).toContain("<!--email_off-->u1@example.com<!--/email_off-->");
    // no-referrer would make the browser send `Origin: null` on the Allow form, which the POST refuses.
    expect(signedIn.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(consent).toContain("claude.ai");
    expect(signedIn.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://claude.ai");
  });

  it("returns access_denied on cancel and refuses a cross-site form post", async () => {
    const env = await setup();
    const { body } = await registerClient(env);
    const start = await authorize(new Request(authorizeUrl(body.client_id as string, {}, SITE, await s256(VERIFIER))), env, noWait);
    const requestId = new URL(start.headers.get("Location") ?? "").searchParams.get("request") ?? "";
    const cookie = await cookieFor(env);
    const post = (origin: string, action: string) =>
      consentDecision(new Request(`${SITE}/oauth/consent`, { method: "POST", headers: { ...FORM_HEADERS, Cookie: cookie, Origin: origin }, body: form({ request: requestId, action }) }), env, noWait);
    expect((await post("https://evil.example", "allow")).status).toBe(403);
    expect((await post("null", "allow")).status).toBe(403);
    const denied = await post(SITE, "deny");
    expect(new URL(denied.headers.get("Location") ?? "").searchParams.get("error")).toBe("access_denied");
    // The request is single use.
    expect((await post(SITE, "allow")).status).toBe(400);
  });

  it("redirects back with a code, the state and the issuer", async () => {
    const env = await setup();
    const { back, code } = await getCode(env);
    expect(back.origin + back.pathname).toBe(CLAUDE_CALLBACK);
    expect(code).toMatch(/^sac_/);
    expect(back.searchParams.get("state")).toBe("st4te");
    expect(back.searchParams.get("iss")).toBe(SITE);
  });
});

describe("token endpoint", () => {
  it("exchanges a code for an access and a refresh token", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const { res, body } = await exchange(env, clientId, code);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token).toMatch(/^sat_/);
    expect(body.refresh_token).toMatch(/^srt_/);
    expect(body.expires_in).toBe(3600);
    const stored = await env.DB.prepare(`SELECT COUNT(*) AS n FROM oauth_tokens WHERE token_hash = ?1`).bind(body.access_token).first<{ n: number }>();
    expect(stored?.n).toBe(0); // only hashes are kept
  });

  it("rejects a wrong PKCE verifier", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const { res, body } = await exchange(env, clientId, code, "x".repeat(64));
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_grant");
  });

  it("refuses a reused code and revokes what the first exchange issued", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const first = await exchange(env, clientId, code);
    expect(first.res.status).toBe(200);
    const again = await exchange(env, clientId, code);
    expect(again.body.error).toBe("invalid_grant");
    forgetAccessMemo();
    const res = await mcp(env, call("get_atlas_stats"), { Authorization: `Bearer ${first.body.access_token}` });
    expect(res.status).toBe(401);
    expect((await refreshWith(env, clientId, first.body.refresh_token as string)).body.error).toBe("invalid_grant");
  });

  it("refuses an expired code and a code from another client", async () => {
    const env = await setup();
    const a = await getCode(env);
    const other = (await registerClient(env)).body.client_id as string;
    expect((await exchange(env, other, a.code)).body.error).toBe("invalid_grant");
    const b = await getCode(env);
    await env.DB.prepare(`UPDATE oauth_codes SET expires_at = '2000-01-01T00:00:00Z' WHERE used_at IS NULL`).run();
    expect((await exchange(env, b.clientId, b.code)).body.error).toBe("invalid_grant");
  });

  it("rotates refresh tokens and ends the connection when an old one returns", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const first = (await exchange(env, clientId, code)).body;
    const second = await refreshWith(env, clientId, first.refresh_token as string);
    expect(second.res.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect(second.body.access_token).not.toBe(first.access_token);

    // Inside the grace window (two refreshes racing) the old one still works once more.
    expect((await refreshWith(env, clientId, first.refresh_token as string)).res.status).toBe(200);
    // After it, presenting the old token revokes the whole grant.
    await env.DB.prepare(`UPDATE oauth_tokens SET revoked_at = '2000-01-01T00:00:00Z' WHERE revoked_reason = 'rotated'`).run();
    const replay = await refreshWith(env, clientId, first.refresh_token as string);
    expect(replay.res.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    expect((await refreshWith(env, clientId, second.body.refresh_token as string)).body.error).toBe("invalid_grant");
  });

  it("only accepts form or JSON bodies with a known grant type", async () => {
    const env = await setup();
    const res = await token(new Request(`${SITE}/oauth/token`, { method: "POST", headers: FORM_HEADERS, body: form({ grant_type: "client_credentials" }) }), env, noWait);
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("revokes a connection through /oauth/revoke", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const t = (await exchange(env, clientId, code)).body;
    const res = await revoke(new Request(`${SITE}/oauth/revoke`, { method: "POST", headers: FORM_HEADERS, body: form({ token: t.refresh_token as string, client_id: clientId }) }), env);
    expect(res.status).toBe(200);
    expect((await mcp(env, call("get_atlas_stats"), { Authorization: `Bearer ${t.access_token}` })).status).toBe(401);
  });
});

describe("MCP with OAuth", () => {
  it("answers 401 with resource_metadata to initialize and tools/call without a credential", async () => {
    const env = await setup();
    for (const body of [initialize, call("search_datasets", { query: "x" }), { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "singlet://stats" } }]) {
      const res = await mcp(env, body);
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe(
        'Bearer resource_metadata="https://singlet.bio/.well-known/oauth-protected-resource", scope="mcp"',
      );
    }
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mcp_usage`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("answers Claude's connector check: initialize with a newer protocol header still reaches the 401", async () => {
    const env = await setup();
    for (const v of ["2025-11-25", "2099-01-01"]) {
      const res = await mcp(env, { ...initialize, params: { ...initialize.params, protocolVersion: v } }, { "MCP-Protocol-Version": v });
      expect(res.status, v).toBe(401);
      expect(res.headers.get("WWW-Authenticate"), v).toMatch(/resource_metadata=/);
    }
    const ok = await mcp(env, { ...initialize, params: { ...initialize.params, protocolVersion: "2025-11-25" } }, { "MCP-Protocol-Version": "2025-11-25", Authorization: `Bearer ${KEY}` });
    expect(((await ok.json()) as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-11-25");
    const other = await mcp(env, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { "MCP-Protocol-Version": "2099-01-01" });
    expect(other.status).toBe(400);
  });

  it("keeps ping and tools/list open, and header API keys working as before", async () => {
    const env = await setup();
    expect((await mcp(env, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(200);
    expect((await mcp(env, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    expect((await mcp(env, initialize, { Authorization: `Bearer ${KEY}` })).status).toBe(200);
    expect((await mcp(env, initialize, { "X-API-Key": KEY })).status).toBe(200);
  });

  it("runs tools as the token's owner and counts them on that account", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const t = (await exchange(env, clientId, code)).body;
    const auth = { Authorization: `Bearer ${t.access_token}` };
    expect((await mcp(env, initialize, auth)).status).toBe(200);
    const res = await mcp(env, call("get_atlas_stats"), auth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { _meta?: { auth?: string } } };
    expect(body.result._meta?.auth).toBeUndefined();
    const row = await env.DB.prepare(`SELECT calls FROM mcp_usage WHERE subject = 'user:u1' AND tool = 'get_atlas_stats'`).first<{ calls: number }>();
    expect(row?.calls).toBe(1);
  });

  it("answers an expired access token with 401 invalid_token so the client refreshes", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const t = (await exchange(env, clientId, code)).body;
    await env.DB.prepare(`UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE kind = 'access'`).run();
    const res = await mcp(env, call("get_atlas_stats"), { Authorization: `Bearer ${t.access_token}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer error="invalid_token", resource_metadata="https:\/\/singlet\.bio\/\.well-known\/oauth-protected-resource"/);
    const fresh = (await refreshWith(env, clientId, t.refresh_token as string)).body;
    expect((await mcp(env, call("get_atlas_stats"), { Authorization: `Bearer ${fresh.access_token}` })).status).toBe(200);
  });

  it("only accepts a token on the origin that issued it", async () => {
    const env = await setup();
    const preview = "https://claude-mcp-oauth.singlet-4gc.pages.dev";
    const { clientId, code } = await getCode(env, { origin: preview });
    const t = (await exchange(env, clientId, code, VERIFIER, preview)).body;
    expect((await mcp(env, initialize, { Authorization: `Bearer ${t.access_token}` }, preview)).status).toBe(200);
    expect((await mcp(env, initialize, { Authorization: `Bearer ${t.access_token}` }, SITE)).status).toBe(401);
  });

  it("counts as signed in on the API, but cannot manage keys or connections", async () => {
    const env = await setup();
    const { clientId, code } = await getCode(env);
    const t = (await exchange(env, clientId, code)).body;
    const who = await resolveIdentity(new Request(`${SITE}/api/nl-search?q=x`, { headers: { Authorization: `Bearer ${t.access_token}` } }), env, noWait);
    expect(who.ok && who.identity.kind).toBe("oauth");
    expect(who.ok && who.identity.subject).toBe("user:u1");
    const res = await (connectionsApi as unknown as (c: unknown) => Promise<Response>)({
      request: new Request(`${SITE}/api/connections`, { method: "POST", headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" }, body: '{"action":"list"}' }),
      env,
      waitUntil: noWait,
    });
    expect(res.status).toBe(403);
  });
});

describe("connected apps on /account", () => {
  const api = (env: Env, cookie: string, body: unknown) =>
    (connectionsApi as unknown as (c: unknown) => Promise<Response>)({
      request: new Request(`${SITE}/api/connections`, { method: "POST", headers: { Cookie: cookie, Origin: SITE, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      env,
      waitUntil: noWait,
    });

  it("lists the user's connections and disconnects one", async () => {
    const env = await setup();
    const { clientId, code, cookie } = await getCode(env);
    const t = (await exchange(env, clientId, code)).body;
    const list = (await (await api(env, cookie, { action: "list" })).json()) as { items: { id: string; client_name: string }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0].client_name).toBe("Claude");

    const otherUser = await cookieFor(env, "u2");
    expect((await api(env, otherUser, { action: "revoke", id: list.items[0].id })).status).toBe(404);
    expect((await api(env, cookie, { action: "revoke", id: list.items[0].id })).status).toBe(200);
    expect((await mcp(env, call("get_atlas_stats"), { Authorization: `Bearer ${t.access_token}` })).status).toBe(401);
    expect(((await (await api(env, cookie, { action: "list" })).json()) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe("client ID metadata documents", () => {
  const CIMD = "https://claude.ai/oauth/mcp-client-metadata";
  const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
  const docFor = (clientId: string, extra: Record<string, unknown> = {}) => ({
    client_id: clientId,
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: [CLAUDE_CALLBACK],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...extra,
  });
  const CLAUDE_CODE_DOC = docFor(CLAUDE_CODE, { client_name: "Claude Code", redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"] });

  /** Stub fetch with one document per URL; anything else is a 404. */
  function serve(docs: Record<string, unknown>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!(url in docs)) return new Response("not found", { status: 404 });
      const body = docs[url];
      if (typeof body !== "string") return Response.json(body);
      return new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": String(new TextEncoder().encode(body).byteLength) } });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const clientCount = async (env: Env) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM oauth_clients`).first<{ n: number }>())?.n;

  it("recognises only https URLs on a DNS name with a path", () => {
    expect(metadataDocumentUrl(CLAUDE_CODE)?.host).toBe("claude.ai");
    for (const bad of [
      "http://claude.ai/oauth/claude-code-client-metadata",
      "https://claude.ai",
      "https://claude.ai/",
      "https://127.0.0.1/meta",
      "https://[::1]/meta",
      "https://localhost/meta",
      "https://app.localhost/meta",
      "https://intranet/meta",
      "https://claude.ai:8443/meta",
      "https://claude.ai/meta?x=1",
      "https://claude.ai/meta#x",
      "https://user@claude.ai/meta",
      "https://claude.ai/a/../meta",
      "https://CLAUDE.ai/meta",
      "scl_" + "x".repeat(22),
    ]) {
      expect(metadataDocumentUrl(bad), bad).toBeNull();
    }
  });

  it("fetches the document, caches the client once and completes sign-in as a public client", async () => {
    const env = await setup();
    const fetchMock = serve({ [CIMD]: docFor(CIMD) });
    const challenge = await s256(VERIFIER);
    const start = await authorize(new Request(authorizeUrl(CIMD, {}, SITE, challenge)), env, noWait);
    expect(start.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CIMD);
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeDefined();

    // The consent page names the app by the client_id's host, not its self-asserted name.
    const consent = await (await consentPage(new Request(start.headers.get("Location") ?? ""), env, noWait)).text();
    expect(consent).toContain("Sign in to connect claude.ai");
    expect(consent).not.toContain("connect Claude<");

    const { code } = await getCode(env, { clientId: CIMD });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await clientCount(env)).toBe(1); // the unchanged document was not written again
    const t = await exchange(env, CIMD, code);
    expect(t.res.status).toBe(200);
    expect(t.body.access_token).toMatch(/^sat_/);
    // Token and refresh identify the client from the cache, without fetching again.
    const fresh = await refreshWith(env, CIMD, t.body.refresh_token as string);
    expect(fresh.res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const grant = await env.DB.prepare(`SELECT client_id, client_name FROM oauth_grants`).first<{ client_id: string; client_name: string }>();
    expect(grant).toEqual({ client_id: CIMD, client_name: "claude.ai" });
    const row = await env.DB.prepare(`SELECT client_secret_hash, token_endpoint_auth_method FROM oauth_clients WHERE client_id = ?1`).bind(CIMD).first();
    expect(row).toEqual({ client_secret_hash: null, token_endpoint_auth_method: "none" });
  });

  it("accepts Claude Code's loopback redirect on any port", async () => {
    const env = await setup();
    serve({ [CLAUDE_CODE]: CLAUDE_CODE_DOC });
    const res = await authorize(new Request(authorizeUrl(CLAUDE_CODE, { redirect_uri: "http://localhost:53682/callback" }, SITE, await s256(VERIFIER))), env, noWait);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("Location") ?? "").pathname).toBe("/oauth/consent");
  });

  it("updates the cached redirect_uris when the document changes", async () => {
    const env = await setup();
    const challenge = await s256(VERIFIER);
    serve({ [CIMD]: docFor(CIMD) });
    expect((await authorize(new Request(authorizeUrl(CIMD, {}, SITE, challenge)), env, noWait)).status).toBe(302);
    const moved = "https://claude.com/api/mcp/auth_callback";
    serve({ [CIMD]: docFor(CIMD, { redirect_uris: [moved] }) });
    expect((await authorize(new Request(authorizeUrl(CIMD, { redirect_uri: moved }, SITE, challenge)), env, noWait)).status).toBe(302);
    const row = await env.DB.prepare(`SELECT redirect_uris FROM oauth_clients WHERE client_id = ?1`).bind(CIMD).first<{ redirect_uris: string }>();
    expect(JSON.parse(row?.redirect_uris ?? "[]")).toEqual([moved]);
  });

  it("refuses a document whose client_id is not its URL, without redirecting or caching", async () => {
    const env = await setup();
    serve({ [CIMD]: docFor("https://evil.example/oauth/client") });
    const res = await authorize(new Request(authorizeUrl(CIMD, {}, SITE, await s256(VERIFIER))), env, noWait);
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    expect(await res.text()).toContain("names a different client_id");
    expect(await clientCount(env)).toBe(0);
  });

  it("refuses a redirect_uri the document does not list, without redirecting or caching", async () => {
    const env = await setup();
    serve({ [CIMD]: docFor(CIMD) });
    const res = await authorize(new Request(authorizeUrl(CIMD, { redirect_uri: "https://evil.example/cb" }, SITE, await s256(VERIFIER))), env, noWait);
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    expect(await res.text()).toContain("Redirect not allowed");
    expect(await clientCount(env)).toBe(0);
  });

  it("refuses a document over 10 KB, with or without a Content-Length", async () => {
    const env = await setup();
    const big = JSON.stringify(docFor(CIMD, { client_name: "x".repeat(11_000) }));
    serve({ [CIMD]: big });
    const declared = await authorize(new Request(authorizeUrl(CIMD, {}, SITE, await s256(VERIFIER))), env, noWait);
    expect(declared.status).toBe(400);
    expect(await declared.text()).toContain("larger than 10 KB");

    // A streamed body has no Content-Length: the reader stops at the cap.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob([big]).stream())),
    );
    const streamed = await authorize(new Request(authorizeUrl(CIMD, {}, SITE, await s256(VERIFIER))), env, noWait);
    expect(streamed.status).toBe(400);
    expect(await streamed.text()).toContain("larger than 10 KB");
    expect(await clientCount(env)).toBe(0);
  });

  it("never fetches a non-https, IP or localhost client_id", async () => {
    const env = await setup();
    const fetchMock = serve({});
    for (const id of ["http://claude.ai/oauth/meta", "https://127.0.0.1/meta", "https://localhost/meta"]) {
      const res = await authorize(new Request(authorizeUrl(id, {}, SITE, await s256(VERIFIER))), env, noWait);
      expect(res.status, id).toBe(400);
      expect(await res.text(), id).toContain("Unknown app");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a document that cannot be fetched, is not 200, or asks for a secret", async () => {
    const env = await setup();
    const challenge = await s256(VERIFIER);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    const timeout = await authorize(new Request(authorizeUrl(CIMD, {}, SITE, challenge)), env, noWait);
    expect(await timeout.text()).toContain("could not fetch");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/doc" } })));
    expect(await (await authorize(new Request(authorizeUrl(CIMD, {}, SITE, challenge)), env, noWait)).text()).toContain("HTTP 302");

    serve({ [CIMD]: docFor(CIMD, { token_endpoint_auth_method: "client_secret_basic" }) });
    expect(await (await authorize(new Request(authorizeUrl(CIMD, {}, SITE, challenge)), env, noWait)).text()).toContain("public clients");
    expect(await clientCount(env)).toBe(0);
  });

  it("keeps dynamic client registration working", async () => {
    const env = await setup();
    const fetchMock = serve({});
    const { clientId, code } = await getCode(env);
    expect(clientId).toMatch(/^scl_/);
    expect((await exchange(env, clientId, code)).res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
