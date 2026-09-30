/**
 * GET /api/auth/me — who is signed in on this browser (from the session
 * cookie) and which sign-in providers this deployment can offer.
 *
 * Never 401: a signed-out visitor gets `user: null`. Same-origin only (no
 * CORS headers) and never cached. While the session is valid the cookie is
 * sent again (same token, fresh Max-Age), so an active browser keeps it as
 * long as the sliding expiry in D1 (session.ts).
 */
import type { AppEnv } from "../../_shared/env";
import { configuredProviders } from "../../_shared/oauth";
import { lookupSession, readSessionToken, sessionCookie } from "../../_shared/session";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  const u = await lookupSession(env.DB, request, waitUntil);
  const body = {
    user: u ? { id: u.userId, email: u.email, display_name: u.displayName, avatar_url: u.avatarUrl } : null,
    providers: configuredProviders(env),
  };
  const headers = new Headers(HEADERS);
  const token = u ? readSessionToken(request) : null;
  if (token) headers.append("Set-Cookie", sessionCookie(token));
  return new Response(JSON.stringify(body), { headers });
};
