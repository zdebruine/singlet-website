// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { describeAgent, isBot, parseWebEvent, reportQueries, runAnalyticsQuery, toDataPoint } from "../../functions/_shared/web-analytics";
import { onRequest as beacon } from "../../functions/api/v";
import { isAnalyticsAdmin, onRequest as adminReport } from "../../functions/api/admin/analytics";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IDS = { pv: "pv-12345678", s: "ses-12345678", v: "vis-12345678" };

describe("parseWebEvent", () => {
  it("keeps a landing view's source and drops the query string", () => {
    const e = parseWebEvent({ e: "view", p: "/study/GSE138867?tab=qc#x", ...IDS, r: "www.LinkedIn.com", us: "LinkedIn", um: "social", uc: "launch", land: true, w: 1280 }, "singlet.bio");
    expect(e).toMatchObject({ event: "view", path: "/study/GSE138867", referrer: "linkedin.com", utmSource: "linkedin", utmCampaign: "launch", landing: true, width: 1280 });
  });

  it("drops our own host as a referrer and clamps numbers", () => {
    const e = parseWebEvent({ e: "leave", p: "/", ...IDS, r: "www.singlet.bio", ms: 9e9, sc: 140 }, "singlet.bio");
    expect(e?.referrer).toBe("");
    expect(e?.visibleMs).toBe(3_600_000);
    expect(e?.scrollPct).toBe(100);
  });

  it("rejects malformed events", () => {
    expect(parseWebEvent({ e: "click", p: "/", ...IDS }, "singlet.bio")).toBeNull();
    expect(parseWebEvent({ e: "view", p: "https://x.com/", ...IDS }, "singlet.bio")).toBeNull();
    expect(parseWebEvent({ e: "view", p: "/", ...IDS, v: "x'; DROP" }, "singlet.bio")).toBeNull();
    expect(parseWebEvent([1], "singlet.bio")).toBeNull();
  });

  it("ignores unsafe utm values", () => {
    expect(parseWebEvent({ e: "view", p: "/", ...IDS, us: "<script>" }, "singlet.bio")?.utmSource).toBe("");
  });
});

describe("data points", () => {
  it("follow the documented blob and double layout", () => {
    const e = parseWebEvent({ e: "view", p: "/browse", ...IDS, ret: true, land: true, si: true, w: 390 }, "singlet.bio")!;
    const dp = toDataPoint(e, { host: "singlet.bio", country: "US", region: "Michigan", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" });
    expect(dp.indexes).toEqual([IDS.v]);
    expect(dp.blobs).toEqual(["view", "singlet.bio", "/browse", IDS.pv, IDS.s, IDS.v, "", "", "", "", "US", "Michigan", "mobile", "Safari", "iOS"]);
    expect(dp.doubles).toEqual([0, 0, 1, 1, 1, 390]);
  });

  it("describes common agents and spots bots", () => {
    expect(describeAgent(CHROME, 1440)).toEqual({ device: "desktop", browser: "Chrome", os: "Windows" });
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot("LinkedInBot/1.0")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(CHROME)).toBe(false);
  });
});

describe("POST /api/v", () => {
  const call = (body: string, ua = CHROME, method = "POST") => {
    const writeDataPoint = vi.fn();
    const request = new Request("https://singlet.bio/api/v", { method, body: method === "POST" ? body : undefined, headers: { "User-Agent": ua } });
    Object.assign(request, { cf: { country: "DE", region: "Berlin" } });
    const run = (beacon as unknown as (c: unknown) => Promise<Response>)({ request, env: { WEB_ANALYTICS: { writeDataPoint } } });
    return run.then((res) => ({ res, writeDataPoint }));
  };

  it("writes one data point with the edge's country and the request host", async () => {
    const { res, writeDataPoint } = await call(JSON.stringify({ e: "view", p: "/", ...IDS, land: true }));
    expect(res.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const blobs = writeDataPoint.mock.calls[0][0].blobs as string[];
    expect(blobs[1]).toBe("singlet.bio");
    expect(blobs[10]).toBe("DE");
  });

  it("answers 204 and writes nothing for bots, junk and oversized bodies", async () => {
    for (const [body, ua] of [
      [JSON.stringify({ e: "view", p: "/", ...IDS }), "Googlebot/2.1"],
      ["not json", CHROME],
      [JSON.stringify({ e: "view", p: "/" }), CHROME],
      ["x".repeat(5000), CHROME],
    ]) {
      const { res, writeDataPoint } = await call(body, ua);
      expect(res.status).toBe(204);
      expect(writeDataPoint).not.toHaveBeenCalled();
    }
  });

  it("is POST only", async () => {
    expect((await call("", CHROME, "GET")).res.status).toBe(405);
  });
});

describe("reports", () => {
  it("only admins listed in ANALYTICS_ADMINS may read them", () => {
    expect(isAnalyticsAdmin("u1", "u0, u1")).toBe(true);
    expect(isAnalyticsAdmin("u2", "u0, u1")).toBe(false);
    expect(isAnalyticsAdmin("u1", undefined)).toBe(false);
    expect(isAnalyticsAdmin("", ",")).toBe(false);
  });

  it("asks anonymous callers to sign in", async () => {
    const request = new Request("https://singlet.bio/api/admin/analytics?days=7");
    const res = await (adminReport as unknown as (c: unknown) => Promise<Response>)({ request, env: { DB: {} }, waitUntil: () => undefined });
    expect(res.status).toBe(401);
  });

  it("builds every report for the range and host, and refuses anything else", () => {
    const q = reportQueries(30, "singlet.bio");
    expect(Object.keys(q)).toEqual(["summary", "returning", "signedIn", "series", "pages", "landing", "referrers", "campaigns", "countries", "devices", "browsers"]);
    for (const sql of Object.values(q)) {
      expect(sql).toContain("INTERVAL '30' DAY");
      expect(sql).toContain("blob2 = 'singlet.bio'");
    }
    expect(() => reportQueries(5 as never, "singlet.bio")).toThrow();
    expect(() => reportQueries(7, "x' OR 1=1 --")).toThrow();
  });

  it("posts SQL with the token and returns the data rows", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [{ views: 3 }] }));
    const rows = await runAnalyticsQuery("acct", "tok", "SELECT 1", fetcher as unknown as typeof fetch);
    expect(rows).toEqual([{ views: 3 }]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/analytics_engine/sql");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(init.body).toBe("SELECT 1 FORMAT JSON");
  });
});

describe("GET /api/admin/analytics failures", () => {
  it("passes the SQL API's error through as a 503 the dashboard can show", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Authentication error", { status: 401 })));
    const { onRequest } = await import("../../functions/api/admin/analytics");
    const identity = await import("../../functions/_shared/identity");
    const spy = vi.spyOn(identity, "requireUser").mockResolvedValue({ ok: true, identity: { userId: "admin" } } as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await (onRequest as unknown as (c: unknown) => Promise<Response>)({
      request: new Request("https://singlet.bio/api/admin/analytics?days=7"),
      env: { DB: {}, ANALYTICS_ADMINS: "admin", CF_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "tok" },
      waitUntil: () => undefined,
    });
    expect(res.status).toBe(503);
    expect((await res.json()).message).toMatch(/analytics query failed \(401\): Authentication error/);
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("GET /api/admin/analytics token", () => {
  it("trims a secret stored with a trailing newline before using it", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { onRequest } = await import("../../functions/api/admin/analytics");
    const identity = await import("../../functions/_shared/identity");
    const spy = vi.spyOn(identity, "requireUser").mockResolvedValue({ ok: true, identity: { userId: "admin" } } as never);
    const res = await (onRequest as unknown as (c: unknown) => Promise<Response>)({
      request: new Request("https://singlet.bio/api/admin/analytics?days=1"),
      env: { DB: {}, ANALYTICS_ADMINS: "admin", CF_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "tok\r\n" },
      waitUntil: () => undefined,
    });
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
