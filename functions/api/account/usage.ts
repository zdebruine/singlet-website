/**
 * GET /api/account/usage — what the signed-in account has used:
 *   {
 *     search: Quota, explain: Quota,        // today's request counters (a backstop against bursts)
 *     allowance: AllowanceSnapshot,         // this month's AI token allowance, in tokens
 *     mcp: { total, by_tool }               // MCP tool calls this month
 *   }
 *
 * Works with the browser session or an API key (a key spends its owner's
 * allowance, so it may read it too). Anonymous callers get 401 sign_in_required.
 * Reads only; nothing is charged. Never cached.
 */
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";
import { usageToday } from "../../_shared/quota";
import { allowanceFor, toolCallsThisMonth } from "../../_shared/spend";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed", message: "GET only." }, 405, { Allow: "GET" });

  const who = await requireUser(request, env, waitUntil, "Sign in to see your AI usage.");
  if (!who.ok) return who.response;

  const [counters, allowance, mcp] = await Promise.all([
    usageToday(env.DB, env, who.identity),
    allowanceFor(env.DB, env, who.identity.subject),
    toolCallsThisMonth(env.DB, who.identity.subject),
  ]);
  return json({ ...counters, allowance, mcp });
};
