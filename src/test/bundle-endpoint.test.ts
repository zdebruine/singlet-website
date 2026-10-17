// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getBundleIndex = vi.hoisted(() => vi.fn());
vi.mock("../../functions/_shared/bundle-reader", async (orig) => ({ ...(await orig<object>()), getBundleIndex }));

import { onRequestGet } from "../../functions/api/bundle/[gse]/[action]";
import { onRequestGet as statsGet } from "../../functions/api/stats";
import { sha256Hex } from "../../functions/_shared/hash";
import { createTestD1 } from "./helpers/d1-sqlite";

beforeEach(() => {
  getBundleIndex.mockReset();
  getBundleIndex.mockRejectedValue(new Error("SQLITE_ERROR: no such table: bundle_index (SELECT entries FROM bundle_index)"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // No test may reach the real data host.
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is not available in tests");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function get(path: string, env: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://singlet.bio${path}`, { headers });
  const [, , , gse, action] = new URL(request.url).pathname.split("/");
  return onRequestGet({ request, env, params: { gse, action }, waitUntil: () => undefined } as never);
}

describe("GET /api/bundle/:gse/:action", () => {
  it("rejects a malformed accession before touching the database", async () => {
    const env = { DB: createTestD1() };
    const prepare = vi.spyOn(env.DB, "prepare");
    const res = await get("/api/bundle/NOTAGSE/index", env);
    expect(res.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(getBundleIndex).not.toHaveBeenCalled();
  });

  it("answers a read failure with a request id, not the underlying message", async () => {
    const env = { DB: createTestD1() };
    for (const path of ["index", "samples", "entry?path=samples/GSM1/summary.json"]) {
      const res = await get(`/api/bundle/GSE138867/${path}`, env);
      const text = await res.text();
      expect(res.status, path).toBe(502);
      expect(text, path).not.toMatch(/no such table|sqlite|bundle_index|SELECT/i);
      expect(JSON.parse(text), path).toMatchObject({ error: "Internal error", request_id: expect.stringMatching(/^[0-9a-f]{12}$/) });
    }
  });

  it("only honours ?refresh=1 with the ingest token", async () => {
    const token = "crank-token";
    const env = { DB: createTestD1(), INGEST_TOKEN_SHA256: await sha256Hex(token) };
    await get("/api/bundle/GSE138867/index?refresh=1", env);
    await get("/api/bundle/GSE138867/index?refresh=1", env, { "X-Ingest-Token": "wrong" });
    await get("/api/bundle/GSE138867/index?refresh=1", env, { "X-Ingest-Token": token });
    await get("/api/bundle/GSE138867/index", env, { "X-Ingest-Token": token });
    const refreshFlags = getBundleIndex.mock.calls.map((c) => Boolean((c[2] as { refresh?: boolean }).refresh));
    expect(refreshFlags).toEqual([false, false, true, false]);
  });
});

describe("other catalog endpoints", () => {
  it("do not echo database errors", async () => {
    const request = new Request("https://singlet.bio/api/stats");
    const res = await statsGet({ request, env: { DB: createTestD1() }, params: {}, waitUntil: () => undefined } as never);
    const text = await res.text();
    expect(text).not.toMatch(/no such table|sqlite|SELECT/i);
  });
});
