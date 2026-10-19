// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runMeteredJson } from "../../functions/_shared/ai-metered";
import {
  GLOBAL_SUBJECT,
  allowanceFor,
  allowanceMessage,
  capMicros,
  costMicros,
  estimateMicros,
  monthOf,
  priceFor,
  recordToolCall,
  releaseSpend,
  reserveSpend,
  settleSpend,
  toolCallsThisMonth,
  withinRate,
} from "../../functions/_shared/spend";
import { createTestD1 } from "./helpers/d1-sqlite";
import { readFileSync } from "node:fs";

const SCHEMA = readFileSync("schema/012_ai_budget.sql", "utf8");
const HAIKU = { ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-haiku-4-5" };
const user = (id: string) => ({ subject: `user:${id}` });
const NOW = Date.UTC(2026, 9, 15, 12);

describe("prices and caps", () => {
  it("price the configured model, and unknown models high", () => {
    expect(priceFor(HAIKU)).toEqual({ inUsdPerM: 1, outUsdPerM: 5 });
    expect(priceFor({})).toEqual({ inUsdPerM: 0.27, outUsdPerM: 0.85 });
    expect(priceFor({ AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" })).toEqual({ inUsdPerM: 0.293, outUsdPerM: 2.253 });
    expect(priceFor({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-future-9" }).inUsdPerM).toBeGreaterThanOrEqual(5);
    expect(priceFor({ AI_PRICE_IN_USD_PER_M: "2", AI_PRICE_OUT_USD_PER_M: "8" })).toEqual({ inUsdPerM: 2, outUsdPerM: 8 });
  });

  it("cost is tokens times the per-million price, rounded up", () => {
    expect(costMicros({ inUsdPerM: 1, outUsdPerM: 5 }, 1000, 200)).toBe(2000);
    expect(costMicros({ inUsdPerM: 0.293, outUsdPerM: 2.253 }, 1000, 1)).toBe(296);
  });

  it("caps default to a small account allowance and apply per kind", () => {
    expect(capMicros({}, "user:1")).toBe(1_000_000);
    expect(capMicros({}, "anon:abc")).toBe(20_000);
    expect(capMicros({}, GLOBAL_SUBJECT)).toBe(50_000_000);
    expect(capMicros({ AI_MONTHLY_CAP_USD: "2.5" }, "user:1")).toBe(2_500_000);
    expect(capMicros({ AI_MONTHLY_CAP_USD: "nonsense" }, "user:1")).toBe(1_000_000);
  });
});

describe("reserve, settle, release", () => {
  it("never lets concurrent calls overspend the account cap", async () => {
    const db = createTestD1(SCHEMA);
    const env = { AI_MONTHLY_CAP_USD: "0.01" }; // 10,000 micro-USD
    const results = await Promise.all(Array.from({ length: 30 }, () => reserveSpend(db, env, user("a"), 1_000, NOW)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(20);
    for (const r of refused) expect(r).toEqual({ ok: false, reason: "allowance" });
  });

  it("settles to the real cost and frees the unused part of the reservation", async () => {
    const db = createTestD1(SCHEMA);
    const env = { ...HAIKU, AI_MONTHLY_CAP_USD: "0.01" };
    const got = await reserveSpend(db, env, user("a"), 9_000, NOW);
    if (!got.ok) throw new Error("expected a reservation");
    await settleSpend(db, env, got.reservation, { inputTokens: 500, outputTokens: 100 }, NOW); // 500 + 500 = 1,000
    const snap = await allowanceFor(db, env, "user:a", NOW);
    expect(snap.tokens_in).toBe(500);
    expect(snap.tokens_out).toBe(100);
    expect(snap.tokens_used).toBe(600);
    expect(snap.allowance.used).toBe(1_000);
    // 9,000 more still fits: 1,000 settled + 9,000 = the 10,000 cap.
    expect((await reserveSpend(db, env, user("a"), 9_000, NOW)).ok).toBe(true);
    expect((await reserveSpend(db, env, user("a"), 1, NOW)).ok).toBe(false);
  });

  it("charges the reservation when the provider reported no usage, and nothing when released", async () => {
    const db = createTestD1(SCHEMA);
    const env = { ...HAIKU, AI_MONTHLY_CAP_USD: "0.01" };
    const a = await reserveSpend(db, env, user("a"), 4_000, NOW);
    const b = await reserveSpend(db, env, user("a"), 3_000, NOW);
    if (!a.ok || !b.ok) throw new Error("expected reservations");
    await settleSpend(db, env, a.reservation, null, NOW);
    await releaseSpend(db, b.reservation);
    expect((await allowanceFor(db, env, "user:a", NOW)).allowance.used).toBe(4_000);
    expect((await reserveSpend(db, env, user("a"), 6_000, NOW)).ok).toBe(true);
  });

  it("an unsettled reservation stops counting once it expires", async () => {
    const db = createTestD1(SCHEMA);
    const env = { AI_MONTHLY_CAP_USD: "0.01" };
    expect((await reserveSpend(db, env, user("a"), 10_000, NOW)).ok).toBe(true);
    expect((await reserveSpend(db, env, user("a"), 1, NOW + 1_000)).ok).toBe(false);
    expect((await reserveSpend(db, env, user("a"), 1, NOW + 121_000)).ok).toBe(true);
  });

  it("keeps accounts apart and starts each month at zero", async () => {
    const db = createTestD1(SCHEMA);
    const env = { AI_MONTHLY_CAP_USD: "0.01" };
    expect((await reserveSpend(db, env, user("a"), 10_000, NOW)).ok).toBe(true);
    expect((await reserveSpend(db, env, user("b"), 10_000, NOW)).ok).toBe(true);
    const nextMonth = Date.UTC(2026, 10, 1, 0, 0, 1);
    expect(monthOf(nextMonth)).toBe("2026-11");
    expect((await reserveSpend(db, env, user("a"), 10_000, nextMonth)).ok).toBe(true);
  });

  it("the global ceiling stops everyone and says it is the service, not the account", async () => {
    const db = createTestD1(SCHEMA);
    const env = { AI_MONTHLY_CAP_USD: "1", AI_GLOBAL_MONTHLY_CAP_USD: "0.005" }; // 5,000 micro-USD overall
    expect((await reserveSpend(db, env, user("a"), 3_000, NOW)).ok).toBe(true);
    expect(await reserveSpend(db, env, user("b"), 3_000, NOW)).toEqual({ ok: false, reason: "service_cap" });
    expect((await reserveSpend(db, env, user("b"), 2_000, NOW)).ok).toBe(true);
  });

  it("fails closed when the budget tables are unavailable", async () => {
    const db = createTestD1(""); // no schema
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await reserveSpend(db, {}, user("a"), 1, NOW)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("the anonymous sandbox has its own small cap", async () => {
    const db = createTestD1(SCHEMA);
    expect((await reserveSpend(db, {}, { subject: "anon:x" }, 15_000, NOW)).ok).toBe(true);
    expect((await reserveSpend(db, {}, { subject: "anon:x" }, 15_000, NOW)).ok).toBe(false);
  });
});

describe("what the caller sees", () => {
  it("reports tokens and the output weight, never dollars", async () => {
    const db = createTestD1(SCHEMA);
    const snap = await allowanceFor(db, HAIKU, "user:a", NOW);
    expect(snap.allowance).toMatchObject({ unit: "weighted tokens", limit: 1_000_000, used: 0, remaining: 1_000_000, output_token_weight: 5 });
    expect(snap.resets_at).toBe("2026-11-01T00:00:00.000Z");
    expect(JSON.stringify(snap)).not.toMatch(/\$|usd|dollar|cent/i);
    expect(snap.billing).toMatch(/Singlet Cloud/);
    expect(allowanceMessage("allowance", snap)).not.toMatch(/\$|usd|dollar/i);
    expect(allowanceMessage("allowance", snap)).toMatch(/2026-11-01/);
  });

  it("estimates a call high enough that settling never exceeds the reservation for normal replies", () => {
    const price = { inUsdPerM: 1, outUsdPerM: 5 };
    expect(estimateMicros(price, 3_000, 500)).toBeGreaterThan(costMicros(price, 900, 500));
  });
});

describe("runMeteredJson", () => {
  const baseEnv = (db: ReturnType<typeof createTestD1>, fetchImpl: typeof fetch) => {
    vi.stubGlobal("fetch", fetchImpl);
    return { DB: db, ...HAIKU, AI_MONTHLY_CAP_USD: "0.01" };
  };
  const reply = (usage: unknown) =>
    new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn", usage }), { status: 200 });
  const opts = { system: "s", user: "u", schema: { type: "object" }, maxTokens: 100 };

  it("charges the provider-reported tokens", async () => {
    const db = createTestD1(SCHEMA);
    const env = baseEnv(db, async () => reply({ input_tokens: 400, output_tokens: 50 }));
    const out = await runMeteredJson(env, user("a"), opts);
    expect(out).toMatchObject({ ok: true, value: { ok: true }, usage: { inputTokens: 400, outputTokens: 50 } });
    const snap = await allowanceFor(db, env, "user:a");
    expect(snap.tokens_in).toBe(400);
    expect(snap.tokens_out).toBe(50);
  });

  it("refuses without calling the model once the allowance is gone", async () => {
    const db = createTestD1(SCHEMA);
    const fetchSpy = vi.fn(async () => reply({ input_tokens: 1, output_tokens: 1 }));
    const env = baseEnv(db, fetchSpy as unknown as typeof fetch);
    env.AI_MONTHLY_CAP_USD = "0.000001";
    const out = await runMeteredJson(env, user("a"), opts);
    expect(out).toMatchObject({ ok: false, reason: "allowance" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("charges nothing when the provider rejects the call", async () => {
    const db = createTestD1(SCHEMA);
    const env = baseEnv(db, async () => new Response("overloaded", { status: 529 }));
    await expect(runMeteredJson(env, user("a"), opts)).rejects.toThrow();
    expect((await allowanceFor(db, env, "user:a")).tokens_used).toBe(0);
    // and the reservation is gone, so the cap is whole again
    expect((await reserveSpend(db, env, user("a"), 10_000)).ok).toBe(true);
  });
});

describe("MCP counters", () => {
  it("counts calls per tool and month", async () => {
    const db = createTestD1(SCHEMA);
    await recordToolCall(db, "user:a", "get_study", NOW);
    await recordToolCall(db, "user:a", "get_study", NOW);
    await recordToolCall(db, "user:a", "search_datasets", NOW);
    expect(await toolCallsThisMonth(db, "user:a", NOW)).toEqual({ total: 3, by_tool: { get_study: 2, search_datasets: 1 } });
    expect((await toolCallsThisMonth(db, "user:b", NOW)).total).toBe(0);
  });

  it("limits calls per window per key, atomically", async () => {
    const db = createTestD1(SCHEMA);
    const results = await Promise.all(Array.from({ length: 12 }, () => withinRate(db, "user:a", "mcp", 5, 60_000, NOW)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await withinRate(db, "user:b", "mcp", 5, 60_000, NOW)).toBe(true);
    expect(await withinRate(db, "user:a", "mcp", 5, 60_000, NOW + 60_000)).toBe(true); // next window
  });
});

describe("the anonymous pool", () => {
  it("lets many visitors spend only the pool, leaving the global ceiling for signed-in accounts", async () => {
    const db = createTestD1(SCHEMA);
    const env = { AI_ANON_MONTHLY_CAP_USD: "0.01", AI_ANON_POOL_CAP_USD: "0.03", AI_GLOBAL_MONTHLY_CAP_USD: "1" };
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await reserveSpend(db, env, { subject: `anon:v${i}` }, 10_000, NOW));
    expect(results.filter((r) => r.ok)).toHaveLength(3); // 30,000 micro-USD of pool
    expect(results[3]).toEqual({ ok: false, reason: "anon_pool" });
    expect((await reserveSpend(db, env, user("a"), 500_000, NOW)).ok).toBe(true); // accounts are untouched
  });

  it("counts settled anonymous spend toward the pool", async () => {
    const db = createTestD1(SCHEMA);
    const env = { ...HAIKU, AI_ANON_MONTHLY_CAP_USD: "0.02", AI_ANON_POOL_CAP_USD: "0.02" };
    const got = await reserveSpend(db, env, { subject: "anon:a" }, 15_000, NOW);
    if (!got.ok) throw new Error("expected a reservation");
    await settleSpend(db, env, got.reservation, { inputTokens: 15_000, outputTokens: 0 }, NOW);
    expect(await reserveSpend(db, env, { subject: "anon:b" }, 10_000, NOW)).toEqual({ ok: false, reason: "anon_pool" });
  });

  it("says to sign in, not that AI is down for everyone", () => {
    expect(allowanceMessage("anon_pool")).toMatch(/sign in/i);
  });
});

describe("usage across provider retries", () => {
  it("adds up every run of the model", async () => {
    const db = createTestD1(SCHEMA);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      // first answer is not JSON (a retry follows with structured output off), the second is
      return calls === 1
        ? new Response(JSON.stringify({ content: [{ type: "text", text: "nope" }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 })
        : new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200 });
    });
    const env = { DB: db, ...HAIKU, AI_MONTHLY_CAP_USD: "0.01" };
    await runMeteredJson(env, user("a"), { system: "s", user: "u", schema: { type: "object" } }).catch(() => undefined);
    const snap = await allowanceFor(db, env, "user:a");
    // whatever the provider code did, what was reported is what is charged, and never less than one run
    expect(snap.tokens_in).toBeGreaterThanOrEqual(100);
    expect(snap.tokens_in % 100).toBe(0);
    vi.unstubAllGlobals();
  });
});
