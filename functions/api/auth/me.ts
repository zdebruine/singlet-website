/**
 * GET /api/auth/me — who is signed in on this browser (from the session
 * cookie) and which sign-in providers this deployment can offer.
 *
 * Never 401: a signed-out visitor gets `user: null`. Same-origin only (no
 * CORS headers) and never cached.
 */
import type { AppEnv } from "../../_shared/env";
import { configuredProviders } from "../../_shared/oauth";
import { lookupSession } from "../../_shared/session";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  const u = await lookupSession(env.DB, request, waitUntil);
  const body = {
    user: u ? { id: u.userId, email: u.email, display_name: u.displayName, avatar_url: u.avatarUrl } : null,
    providers: configuredProviders(env),
  };
  return new Response(JSON.stringify(body), { headers: HEADERS });
};
