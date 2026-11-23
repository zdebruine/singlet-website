// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const nlSearch = vi.hoisted(() => vi.fn(async () => ({ ok: false as const, status: 503, error: "stub", message: "stubbed search" })));
vi.mock("../../functions/_shared/nl-search-core", async (orig) => ({ ...(await orig<typeof import("../../functions/_shared/nl-search-core")>()), nlSearch }));

import { onRequestPost as mcpPost } from "../../functions/mcp";
import { onRequestGet as publicGet, onRequestPost as publicPost } from "../../functions/mcp/public";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = ["010_accounts.sql", "011_product.sql", "012_ai_budget.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n");

function setup(extra: Record<string, unknown> = {}) {
  return { DB: createTestD1(SCHEMA), ...extra };
}

function post(handler: typeof mcpPost, path: string, body: unknown, env: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://singlet.bio${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
  return handler({ request, env, waitUntil: () => undefined, params: {}, data: {}, next: async () => new Response(), functionPath: path } as never);
}
const pub = (body: unknown, env: unknown, headers: Record<string, string> = {}) => post(publicPost, "/mcp/public", body, env, headers);
const rpc = (method: string, params: Record<string, unknown> = {}, id = 1) => ({ jsonrpc: "2.0", id, method, params });
const call = (name: string, args: Record<string, unknown> = {}, id = 1) => rpc("tools/call", { name, arguments: args }, id);

type Tool = { name: string; inputSchema: unknown; description: string };
type ToolReply = { result: { isError?: boolean; content: { text: string }[]; _meta?: { error?: string } } };

beforeEach(() => {
  nlSearch.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("/mcp/public", () => {
  it("initializes without an account and says what it is", async () => {
    const res = await pub(rpc("initialize", { protocolVersion: "2025-06-18" }), setup());
    expect(res.status).toBe(200);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    const body = (await res.json()) as { result: { instructions: string; protocolVersion: string } };
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.instructions).toMatch(/^Public endpoint: read-only tools, rate-limited per network address/);
    expect(body.result.instructions).not.toMatch(/Every tool call needs a free singlet.bio account/);
  });

  it("lists the same definitions as /mcp, read-only tools only", async () => {
    const env = setup();
    const full = ((await (await post(mcpPost, "/mcp", rpc("tools/list"), env)).json()) as { result: { tools: Tool[] } }).result.tools;
    const open = ((await (await pub(rpc("tools/list"), env)).json()) as { result: { tools: Tool[] } }).result.tools;
    expect(full.map((t) => t.name)).toContain("save_cohort");
    expect(open.map((t) => t.name)).not.toContain("save_cohort");
    expect(open.length).toBe(full.length - 1);
    for (const t of open) expect(t, t.name).toEqual(full.find((f) => f.name === t.name));
  });

  it("refuses save_cohort and writes nothing", async () => {
    const env = setup();
    const res = await pub(call("save_cohort", { name: "x", gse_ids: ["GSE1"] }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ToolReply;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/not on the public endpoint/);
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM cohorts`).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("reads search questions with the vocabulary only, whatever interpret says", async () => {
    const res = await pub(call("search_datasets", { query: "microglia in the aging mouse brain", interpret: "ai" }), setup());
    expect(res.status).toBe(200);
    expect(nlSearch).toHaveBeenCalledTimes(1);
    const calls = nlSearch.mock.calls as unknown as [unknown, { kind: string }, unknown, URL][];
    expect(calls[0][3].searchParams.get("interpret")).toBe("vocab");
    expect(calls[0][1].kind).toBe("anonymous");
  });

  it("limits calls per network address an hour and counts them per tool", async () => {
    const env = setup({ MCP_PUBLIC_RATE_PER_HOUR: "2" });
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      const body = (await (await pub(call("get_atlas_stats", {}, i), env)).json()) as ToolReply;
      out.push(body.result._meta?.error === "rate_limited" ? "limited" : "ran");
    }
    expect(out).toEqual(["ran", "ran", "limited"]);
    // another address has its own allowance
    const other = (await (await pub(call("get_atlas_stats"), env, { "CF-Connecting-IP": "198.51.100.9" })).json()) as ToolReply;
    expect(other.result._meta?.error).not.toBe("rate_limited");
    const rows = await env.DB.prepare(`SELECT subject, tool, calls FROM mcp_usage ORDER BY calls DESC`).all<{ subject: string; tool: string; calls: number }>();
    expect(rows.results[0]).toMatchObject({ tool: "get_atlas_stats", calls: 2 });
    expect(rows.results.every((r) => r.subject.startsWith("anon:"))).toBe(true);
  });

  it("has a daily ceiling for all addresses together", async () => {
    const env = setup({ MCP_PUBLIC_DAILY_CAP: "1" });
    await pub(call("get_atlas_stats"), env);
    const body = (await (await pub(call("get_atlas_stats"), env, { "CF-Connecting-IP": "198.51.100.9" })).json()) as ToolReply;
    expect(body.result.content[0].text).toMatch(/daily limit for all visitors/);
  });

  it("ignores credentials, so a stale key is never a 401 here", async () => {
    const res = await pub(rpc("tools/list"), setup(), { Authorization: "Bearer sk_live_" + "b".repeat(32) });
    expect(res.status).toBe(200);
  });

  it("describes itself on GET", async () => {
    const res = await publicGet({ request: new Request("https://singlet.bio/mcp/public"), env: setup() } as never);
    const body = (await res.json()) as { endpoint: string; tools: string[] };
    expect(body.endpoint).toBe("https://singlet.bio/mcp/public");
    expect(body.tools).not.toContain("save_cohort");
  });
});

describe("/mcp is unchanged", () => {
  it("still answers initialize without a credential with 401, so connectors start sign-in", async () => {
    const res = await post(mcpPost, "/mcp", rpc("initialize", { protocolVersion: "2025-06-18" }), setup());
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata=/);
  });

  it("names the account and the 200-a-day model readings in its instructions", async () => {
    const { instructions } = await import("../../functions/mcp");
    const text = instructions(true, false);
    expect(text).toMatch(/search_datasets reads questions with the built-in vocabulary \(no model, no allowance\); interpret:"ai" asks the server's model, up to 200 readings a day/);
    expect(text).not.toMatch(/legacy \.singlet|singlet-v2/);
  });
});
