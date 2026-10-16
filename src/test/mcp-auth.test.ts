// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { onRequestPost } from "../../functions/mcp";
import { sha256Hex } from "../../functions/_shared/hash";
import { forgetKeyMemo } from "../../functions/_shared/identity";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = ["010_accounts.sql", "012_ai_budget.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n");
const KEY = "sk_live_" + "a".repeat(32);

async function setup(extra: Record<string, unknown> = {}) {
  const db = createTestD1(SCHEMA);
  await db.exec(`INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.com', '2026-01-01T00:00:00Z')`).catch(async () => {
    // users may need more columns; fall back to a minimal insert that satisfies the schema
    await db.exec(`INSERT INTO users (id) VALUES ('u1')`);
  });
  const hash = await sha256Hex(KEY);
  await db.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_aaaa', ?1)`).bind(hash).run();
  return { DB: db, ...extra };
}

function post(body: unknown, env: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request("https://singlet.bio/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: text });
  return onRequestPost({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: "/mcp" } as never);
}

const call = (name: string, args: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const auth = { Authorization: `Bearer ${KEY}` };

beforeEach(() => {
  forgetKeyMemo();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("MCP access", () => {
  it("lists tools without a key", async () => {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, await setup());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.length).toBeGreaterThan(10);
  });

  it("refuses every tool call without a key and records nothing", async () => {
    const env = await setup();
    for (const name of ["get_atlas_stats", "search_datasets", "get_study", "export_manifest"]) {
      const res = await post(call(name, { query: "x", gse_id: "GSE1" }), env);
      const body = (await res.json()) as { result: { isError: boolean; _meta: { auth: string } } };
      expect(body.result.isError, name).toBe(true);
      expect(body.result._meta.auth, name).toBe("key_required");
    }
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM mcp_usage`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("answers 401 to an unknown or revoked key, whatever the method", async () => {
    const env = await setup();
    const bad = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, env, { Authorization: "Bearer sk_live_" + "b".repeat(32) });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("WWW-Authenticate")).toMatch(/Bearer/);

    await env.DB.prepare(`UPDATE api_keys SET revoked_at = '2026-02-01T00:00:00Z'`).run();
    forgetKeyMemo();
    const revoked = await post(call("get_atlas_stats"), env, auth);
    expect(revoked.status).toBe(401);
  });

  it("counts each call against the key's owner and limits calls per minute", async () => {
    const env = await setup({ MCP_RATE_PER_MIN: "2" });
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await post(call("get_atlas_stats", {}, i), env, auth);
      const body = (await res.json()) as { result: { isError?: boolean; _meta?: { error?: string } } };
      results.push(body.result._meta?.error === "rate_limited" ? "limited" : "ran");
    }
    expect(results).toEqual(["ran", "ran", "limited"]);
    const row = await env.DB.prepare(`SELECT calls FROM mcp_usage WHERE subject = 'user:u1' AND tool = 'get_atlas_stats'`).first<{ calls: number }>();
    expect(row?.calls).toBe(2);
  });

  it("does not leak database errors from a failing tool", async () => {
    const env = await setup();
    const res = await post(call("get_atlas_stats"), env, auth); // catalog tables are absent in this database
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/no such table|sqlite|SELECT /i);
    expect(text).toMatch(/request [0-9a-f]{12}/);
  });

  it("caps the batch size and the body size", async () => {
    const env = await setup();
    const batch = Array.from({ length: 11 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    expect((await post(batch, env)).status).toBe(400);
    const ok = Array.from({ length: 10 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    expect((await post(ok, env)).status).toBe(200);

    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(300_000) } });
    expect((await post(big, env)).status).toBe(413);
  });
});
