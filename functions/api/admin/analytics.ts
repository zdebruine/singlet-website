/**
 * GET /api/admin/analytics?days=1|7|30|90[&host=…] — the website analytics
 * reports (_shared/web-analytics.ts) for the /admin/analytics page.
 *
 * Only accounts listed in ANALYTICS_ADMINS (wrangler.toml var, comma-separated
 * account ids) may read it. Queries the Analytics Engine SQL API with the
 * CF_ANALYTICS_TOKEN secret (Account Analytics: Read); without it the endpoint
 * answers 503 and says so. `host` defaults to singlet.bio; previews write
 * under their own host.
 */
import type { AppEnv } from "../../_shared/env";
import { requireUser } from "../../_shared/identity";
import { RANGES, reportQueries, runAnalyticsQuery, type RangeDays } from "../../_shared/web-analytics";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function isAnalyticsAdmin(userId: string, admins: string | undefined): boolean {
  return (admins ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed", message: "GET only." }, 405);
  const who = await requireUser(request, env, waitUntil, "Sign in to see site analytics.");
  if (!who.ok) return who.response;
  if (!isAnalyticsAdmin(who.identity.userId, env.ANALYTICS_ADMINS)) return json({ error: "forbidden", message: "Site analytics are for site admins." }, 403);
  // Trimmed: a secret piped in from a shell (Get-Clipboard | wrangler …) keeps its trailing newline, an invalid header value.
  const token = env.CF_ANALYTICS_TOKEN?.trim();
  const accountId = env.CF_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    return json({ error: "not_configured", message: "Set the CF_ANALYTICS_TOKEN secret (Account Analytics: Read) to read analytics." }, 503);
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? 7) as RangeDays;
  const host = (url.searchParams.get("host") ?? "singlet.bio").toLowerCase();
  if (!RANGES.includes(days)) return json({ error: "invalid_days", message: `days must be one of ${RANGES.join(", ")}.` }, 400);
  let queries: Record<string, string>;
  try {
    queries = reportQueries(days, host);
  } catch {
    return json({ error: "invalid_host", message: "host is not a hostname." }, 400);
  }

  try {
    const entries = await Promise.all(
      Object.entries(queries).map(async ([name, sql]) => [name, await runAnalyticsQuery(accountId, token, sql)] as const),
    );
    return json({ days, host, generated_at: new Date().toISOString(), reports: Object.fromEntries(entries) });
  } catch (err) {
    // 503, not 502: Cloudflare replaces a Function's 502 with its own error page, hiding this message.
    const message = err instanceof Error ? err.message : "Analytics query failed.";
    console.error("admin/analytics:", message);
    return json({ error: "analytics_unavailable", message }, 503);
  }
};
