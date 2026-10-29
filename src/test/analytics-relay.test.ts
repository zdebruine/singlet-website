// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_HOST, ASSET_HOST, onRequest, relayTarget } from "../../functions/relay/[[path]]";

describe("analytics relay", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends scripts to the asset CDN and everything else to ingestion, query kept", () => {
    expect(relayTarget("https://singlet.bio/relay/static/array.js")?.href).toBe(`https://${ASSET_HOST}/static/array.js`);
    expect(relayTarget("https://singlet.bio/relay/e/?ip=0&ver=1")?.href).toBe(`https://${API_HOST}/e/?ip=0&ver=1`);
    expect(relayTarget("https://singlet.bio/relay/flags/?v=2")?.host).toBe(API_HOST);
  });

  it("answers only under /relay", () => {
    expect(relayTarget("https://singlet.bio/relayx/e/")).toBeNull();
    expect(relayTarget("https://singlet.bio/api/stats")).toBeNull();
  });

  it("never forwards the visitor's cookies or credentials, and passes their address for geography", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { headers: { "Set-Cookie": "x=1", "Content-Type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://singlet.bio/relay/e/", {
      method: "POST",
      body: "{}",
      headers: { Cookie: "__Host-singlet_session=secret", Authorization: "Bearer k", "CF-Connecting-IP": "203.0.113.7", "Content-Type": "application/json" },
    });
    const res = await (onRequest as unknown as (c: unknown) => Promise<Response>)({ request });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const sent = new Headers(init.headers);
    expect(url.host).toBe(API_HOST);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(sent.get("content-type")).toBe("application/json");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("ok");
  });
});
