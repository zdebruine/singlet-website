/**
 * POST /api/v — website analytics beacon (src/lib/analytics.ts → Workers
 * Analytics Engine, see _shared/web-analytics.ts). Always answers 204 so a
 * dropped or malformed event never shows as an error on the page. Writes
 * nothing to D1.
 */
import type { AppEnv } from "../_shared/env";
import { isBot, parseWebEvent, toDataPoint } from "../_shared/web-analytics";

const MAX_BODY = 2048;
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env }) => {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const ua = request.headers.get("User-Agent");
  if (!env.WEB_ANALYTICS || isBot(ua)) return done();
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return done();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return done();
  }
  const host = new URL(request.url).hostname;
  const event = parseWebEvent(body, host);
  if (!event) return done();
  const cf = (request as Request & { cf?: { country?: string; region?: string } }).cf;
  env.WEB_ANALYTICS.writeDataPoint(toDataPoint(event, { host, country: cf?.country ?? "", region: cf?.region ?? "", userAgent: ua ?? "" }));
  return done();
};
