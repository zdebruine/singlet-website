/**
 * GET /api/account/usage — today's AI counters for the signed-in user:
 *   { search: Quota, explain: Quota }
 *   Quota = { kind: "user", used, limit, resets_at, exceeded }
 *
 * Works with the browser session or an API key (a key spends its owner's
 * budget, so it may read it too). Anonymous callers get 401 sign_in_required.
 * Reads only; nothing is charged. Never cached.
 */
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";
import { usageToday } from "../../_shared/quota";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed", message: "GET only." }, 405, { Allow: "GET" });

  const who = await requireUser(request, env, waitUntil, "Sign in to see your AI usage.");
  if (!who.ok) return who.response;

  return json(await usageToday(env.DB, env, who.identity));
};
