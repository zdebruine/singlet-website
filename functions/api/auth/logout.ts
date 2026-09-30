/**
 * POST /api/auth/logout — end this browser's session: the row is deleted and
 * the cookie cleared. Only honoured from this site's own pages (Origin
 * check), so another site cannot sign a visitor out.
 */
import type { AppEnv } from "../../_shared/env";
import { sameOriginOrSafe } from "../../_shared/identity";
import { destroySession } from "../../_shared/session";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  if (!sameOriginOrSafe(request)) {
    return new Response(JSON.stringify({ error: "forbidden", message: "Sign-out must come from singlet.bio itself." }), { status: 403, headers: HEADERS });
  }
  const headers = new Headers(HEADERS);
  headers.append("Set-Cookie", await destroySession(env.DB, request));
  return new Response(JSON.stringify({ ok: true }), { headers });
};
