/**
 * POST /functions/v1/github-oauth — "Continue with GitHub".
 *
 * GitHub is not one of the providers the hosted auth settings can hold, so the
 * OAuth dance is done here with a GitHub OAuth App owned by the project:
 *
 *   { action: "start", origin, return_to? }
 *     → { url }   the GitHub authorize URL, with a signed `state` that carries
 *                 the origin to return to. 503 `not_configured` until the two
 *                 secrets below exist.
 *   { action: "exchange", code, state }
 *     → { token_hash, return_to }
 *                 the code is swapped for the user's primary verified GitHub
 *                 email, a one-time sign-in token is minted for that email and
 *                 its hash returned; the browser finishes with
 *                 auth.verifyOtp({ token_hash, type: "magiclink" }).
 *
 * GitHub sends the browser back to ONE registered callback,
 * https://singlet.bio/auth/github/callback, which relays to the origin named
 * in `state` (so *.pages.dev previews and local dev work too).
 *
 * Secrets (Project Settings → Secrets):
 *   GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
 *
 * We store nothing about the GitHub account beyond what the account itself
 * carries (email; display name and avatar in user metadata).
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { service } from "../_shared/service.ts";

const CALLBACK_URL = "https://singlet.bio/auth/github/callback";
const STATE_TTL_MS = 10 * 60_000;
const USER_AGENT = "singlet.bio sign-in (+https://singlet.bio)";

/** Origins the callback relay may send a browser back to. */
const ORIGIN_RE =
  /^(https:\/\/(www\.)?singlet\.bio|https:\/\/[a-z0-9-]+\.singlet-4gc\.pages\.dev|https:\/\/[a-z0-9.-]+\.(lovable\.app|lovableproject\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const fail = (status: number, error: string, message: string) => json({ error, message }, status);

function config(): { id: string; secret: string } | null {
  const id = Deno.env.get("GITHUB_OAUTH_CLIENT_ID")?.trim() ?? "";
  const secret = Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET")?.trim() ?? "";
  return id && secret ? { id, secret } : null;
}

// ── state = base64url(payload) "." base64url(HMAC-SHA256(secret, payload)) ──

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(text: string): Uint8Array {
    const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url.encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

interface StatePayload {
  o: string; // origin to return to
  r: string; // path to land on afterwards
  n: string; // nonce, echoed back so the browser can tie the callback to its own start
  e: number; // expiry (ms since epoch)
}

async function signState(secret: string, payload: StatePayload): Promise<string> {
  const body = b64url.encode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

async function readState(secret: string, state: string): Promise<StatePayload | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64url.decode(body))) as Partial<StatePayload>;
    if (typeof p.o !== "string" || typeof p.r !== "string" || typeof p.n !== "string" || typeof p.e !== "number") return null;
    if (!ORIGIN_RE.test(p.o) || p.e < Date.now()) return null;
    return p as StatePayload;
  } catch {
    return null;
  }
}

function cleanReturnPath(v: unknown): string {
  if (typeof v !== "string") return "/browse";
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/auth/") || v.length > 512) return "/browse";
  return v;
}

// ── GitHub ─────────────────────────────────────────────────────────────────

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}
interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function github<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function exchangeCode(cfg: { id: string; secret: string }, code: string): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: cfg.id, client_secret: cfg.secret, code, redirect_uri: CALLBACK_URL }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error === "bad_verification_code" ? "code_used" : data.error_description || data.error || `GitHub token exchange → ${res.status}`);
  }
  return data.access_token;
}

async function verifiedEmail(token: string): Promise<{ email: string; user: GitHubUser } | null> {
  const user = await github<GitHubUser>("/user", token);
  const emails = await github<GitHubEmail[]>("/user/emails", token).catch(() => [] as GitHubEmail[]);
  const primary = emails.find((e) => e.verified && e.primary) ?? emails.find((e) => e.verified);
  const email = (primary?.email ?? (user.email && emails.length === 0 ? user.email : null))?.toLowerCase().trim() ?? null;
  return email ? { email, user } : null;
}

// ── handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only");

  const cfg = config();
  if (!cfg) return fail(503, "not_configured", "GitHub sign-in isn't available on this site yet — use your email instead.");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "start") {
    const origin = typeof body.origin === "string" ? body.origin.replace(/\/+$/, "") : "";
    if (!ORIGIN_RE.test(origin)) return fail(400, "bad_origin", "Sign-in can only start from singlet.bio or one of its previews.");
    const nonce = b64url.encode(crypto.getRandomValues(new Uint8Array(16)));
    const state = await signState(cfg.secret, { o: origin, r: cleanReturnPath(body.return_to), n: nonce, e: Date.now() + STATE_TTL_MS });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", cfg.id);
    url.searchParams.set("redirect_uri", CALLBACK_URL);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "true");
    return json({ url: url.toString(), nonce });
  }

  if (action === "exchange") {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";
    if (!code || !state) return fail(400, "bad_request", "Missing code or state.");
    const payload = await readState(cfg.secret, state);
    if (!payload) return fail(400, "invalid_state", "That sign-in attempt has expired or was tampered with. Please try again.");

    let ghToken: string;
    try {
      ghToken = await exchangeCode(cfg, code);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "code_used") return fail(400, "code_used", "That GitHub sign-in was already used or has expired. Please try again.");
      console.error("github-oauth exchange:", m);
      return fail(502, "github_unavailable", "GitHub didn't answer. Please try again in a moment.");
    }

    let found: { email: string; user: GitHubUser } | null;
    try {
      found = await verifiedEmail(ghToken);
    } catch (e) {
      console.error("github-oauth profile:", e instanceof Error ? e.message : e);
      return fail(502, "github_unavailable", "GitHub didn't answer. Please try again in a moment.");
    }
    if (!found) {
      return fail(400, "no_verified_email", "Your GitHub account has no verified email address. Add one on GitHub or sign in with your email instead.");
    }

    const { email, user } = found;
    const { data, error } = await service().auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${payload.o}/auth/callback`,
        data: { full_name: user.name ?? user.login, user_name: user.login, avatar_url: user.avatar_url, provider: "github" },
      },
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("github-oauth generateLink:", error?.message ?? "no token");
      return fail(500, "sign_in_failed", "We couldn't finish signing you in. Please try again or use your email.");
    }
    return json({ token_hash: tokenHash, return_to: payload.r, nonce: payload.n });
  }

  return fail(400, "bad_action", "Unknown action.");
});
