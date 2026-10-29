/**
 * First-party website analytics on Workers Analytics Engine (dataset
 * `singlet_web`, binding WEB_ANALYTICS). No third party, no cookies, no D1.
 *
 * The page (src/lib/analytics.ts) beacons two events to POST /api/v:
 *   - "view":  a page view (one per route change), with the visit's source on
 *              the first view of a session;
 *   - "leave": time the page was visible and how far it was scrolled, sent
 *              each time the tab is hidden and when the route changes. Several
 *              leaves can belong to one view; they add up.
 * Visitor and session ids are random ids the page keeps in localStorage. The
 * address is used only for the country and region Cloudflare derives from it
 * and is never written.
 *
 * Data point layout (Analytics Engine keeps 90 days):
 *   index1  visitor id
 *   blob1 event   blob2 host     blob3 path      blob4 page-view id  blob5 session id
 *   blob6 visitor blob7 referrer host (external only)  blob8-10 utm source / medium / campaign
 *   blob11 country  blob12 region  blob13 device  blob14 browser  blob15 os
 *   double1 visible ms  double2 max scroll %  double3 returning visitor  double4 first view of the session
 *   double5 signed in   double6 viewport width
 *
 * GET /api/admin/analytics reads it back with the SQL API (`runAnalyticsQuery`).
 */

export const DATASET = "singlet_web";

export type WebEvent = {
  event: "view" | "leave";
  path: string;
  pageId: string;
  sessionId: string;
  visitorId: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  visibleMs: number;
  scrollPct: number;
  returning: boolean;
  landing: boolean;
  signedIn: boolean;
  width: number;
};

const ID_RE = /^[A-Za-z0-9-]{8,40}$/;
const UTM_RE = /^[\w .%+-]{1,60}$/;
const HOST_RE = /^[a-z0-9.-]{1,100}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|preview|facebookexternalhit|embedly|python-requests|curl|wget/i;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), 0), max) : 0);
const flag = (v: unknown) => v === true || v === 1;

/** A beacon body checked and trimmed, or null to drop it. */
export function parseWebEvent(body: unknown, siteHost: string): WebEvent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const event = b.e === "view" || b.e === "leave" ? b.e : null;
  const [pageId, sessionId, visitorId] = [str(b.pv), str(b.s), str(b.v)];
  const path = str(b.p).split(/[?#]/)[0].slice(0, 200);
  if (!event || !path.startsWith("/") || ![pageId, sessionId, visitorId].every((id) => ID_RE.test(id))) return null;
  const ref = str(b.r).toLowerCase();
  const utm = (v: unknown) => (UTM_RE.test(str(v)) ? str(v).toLowerCase() : "");
  return {
    event,
    path,
    pageId,
    sessionId,
    visitorId,
    referrer: HOST_RE.test(ref) && ref !== siteHost && ref !== `www.${siteHost}` ? ref.replace(/^www\./, "") : "",
    utmSource: utm(b.us),
    utmMedium: utm(b.um),
    utmCampaign: utm(b.uc),
    visibleMs: num(b.ms, 3_600_000),
    scrollPct: num(b.sc, 100),
    returning: flag(b.ret),
    landing: flag(b.land),
    signedIn: flag(b.si),
    width: num(b.w, 10_000),
  };
}

export function isBot(userAgent: string | null): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

/** Coarse device, browser and OS from the user agent. */
export function describeAgent(ua: string, width: number): { device: string; browser: string; os: string } {
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) || (width > 0 && width < 768) ? "mobile" : "desktop";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "Other";
  return { device, browser, os };
}

export function toDataPoint(
  e: WebEvent,
  ctx: { host: string; country: string; region: string; userAgent: string },
): AnalyticsEngineDataPoint {
  const { device, browser, os } = describeAgent(ctx.userAgent, e.width);
  return {
    indexes: [e.visitorId],
    blobs: [
      e.event, ctx.host, e.path, e.pageId, e.sessionId, e.visitorId, e.referrer, e.utmSource, e.utmMedium, e.utmCampaign,
      ctx.country, ctx.region, device, browser, os,
    ],
    doubles: [e.visibleMs, e.scrollPct, e.returning ? 1 : 0, e.landing ? 1 : 0, e.signedIn ? 1 : 0, e.width],
  };
}

// ── Reading it back ─────────────────────────────────────────────────────────

export const RANGES = [1, 7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

/** Each report's SQL. `_sample_interval` weights rows Analytics Engine sampled away; distinct counts are of retained rows. */
export function reportQueries(days: RangeDays, host: string): Record<string, string> {
  if (!RANGES.includes(days) || !HOST_RE.test(host)) throw new Error("bad report range");
  const where = `timestamp > NOW() - INTERVAL '${days}' DAY AND blob2 = '${host}'`;
  const views = "sumIf(_sample_interval, blob1 = 'view')";
  const visible = "sumIf(double1 * _sample_interval, blob1 = 'leave')";
  const bucket = days === 1 ? "HOUR" : "DAY";
  const sessionsBy = (col: string, extra = "") =>
    `SELECT ${col} AS key, COUNT(DISTINCT blob5) AS sessions, COUNT(DISTINCT blob6) AS visitors FROM ${DATASET}
     WHERE ${where} AND blob1 = 'view' AND double4 = 1 ${extra} GROUP BY key ORDER BY sessions DESC LIMIT 25`;
  const visitorsBy = (col: string) =>
    `SELECT ${col} AS key, COUNT(DISTINCT blob6) AS visitors, ${views} AS views FROM ${DATASET}
     WHERE ${where} GROUP BY key ORDER BY visitors DESC LIMIT 25`;
  return {
    summary: `SELECT ${views} AS views, COUNT(DISTINCT blob6) AS visitors, COUNT(DISTINCT blob5) AS sessions, ${visible} AS visible_ms
      FROM ${DATASET} WHERE ${where}`,
    returning: `SELECT COUNT(DISTINCT blob6) AS visitors FROM ${DATASET} WHERE ${where} AND double3 = 1`,
    signedIn: `SELECT COUNT(DISTINCT blob6) AS visitors FROM ${DATASET} WHERE ${where} AND double5 = 1`,
    series: `SELECT toStartOfInterval(timestamp, INTERVAL '1' ${bucket}) AS t, ${views} AS views, COUNT(DISTINCT blob6) AS visitors,
      COUNT(DISTINCT blob5) AS sessions FROM ${DATASET} WHERE ${where} GROUP BY t ORDER BY t`,
    pages: `SELECT blob3 AS key, ${views} AS views, COUNT(DISTINCT blob6) AS visitors, ${visible} AS visible_ms,
      avgIf(double2, blob1 = 'leave') AS scroll FROM ${DATASET} WHERE ${where} GROUP BY key ORDER BY views DESC LIMIT 50`,
    landing: sessionsBy("blob3"),
    referrers: sessionsBy("blob7"),
    campaigns: `SELECT blob8 AS source, blob9 AS medium, blob10 AS campaign, COUNT(DISTINCT blob5) AS sessions,
      COUNT(DISTINCT blob6) AS visitors FROM ${DATASET} WHERE ${where} AND blob1 = 'view' AND double4 = 1 AND blob8 != ''
      GROUP BY source, medium, campaign ORDER BY sessions DESC LIMIT 25`,
    countries: visitorsBy("blob11"),
    devices: visitorsBy("blob13"),
    browsers: visitorsBy("blob14"),
  };
}

export type QueryRows = Record<string, string | number>[];

/** One SQL API call. Needs an API token with Account Analytics: Read. */
export async function runAnalyticsQuery(accountId: string, token: string, sql: string, fetcher: typeof fetch = fetch): Promise<QueryRows> {
  const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: `${sql} FORMAT JSON`,
  });
  if (!res.ok) throw new Error(`analytics query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const out = (await res.json()) as { data?: QueryRows };
  return out.data ?? [];
}
