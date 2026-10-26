// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTestD1 } from "./helpers/d1-sqlite";
import { HOURLY_LIMIT, LIMITS, parseBetaSignup, saveBetaSignup, underLimit } from "../../functions/_shared/beta-signup";
import { onRequest } from "../../functions/api/beta-signup";

// The real migration, with the users table it references.
const SCHEMA =
  `CREATE TABLE users (id TEXT PRIMARY KEY);\nINSERT INTO users VALUES ('u1');\n` + readFileSync("schema/035_beta_signups.sql", "utf8");
const db = () => createTestD1(SCHEMA);

const input = (over: Record<string, unknown> = {}) => {
  const p = parseBetaSignup({ email: "Ada@Example.org", ...over });
  if ("message" in p) throw new Error(p.message);
  return p.value;
};

describe("beta sign-up input", () => {
  it("needs a plausible email and lower-cases it", () => {
    expect(parseBetaSignup({}).ok).toBe(false);
    expect(parseBetaSignup({ email: "nope" }).ok).toBe(false);
    expect(parseBetaSignup({ email: `${"a".repeat(250)}@b.org` }).ok).toBe(false);
    expect(input().email).toBe("ada@example.org");
  });

  it("keeps optional fields, trims them and enforces limits", () => {
    const v = input({ name: "  Ada ", institution: "", role: "postdoc", interests: " atlas QC ", updates: true });
    expect(v).toEqual({ email: "ada@example.org", name: "Ada", institution: null, role: "postdoc", interests: "atlas QC", updates: true });
    expect(parseBetaSignup({ email: "a@b.org", interests: "x".repeat(LIMITS.interests + 1) }).ok).toBe(false);
    expect(parseBetaSignup({ email: "a@b.org", name: "x".repeat(LIMITS.name + 1) }).ok).toBe(false);
  });

  it("drops an unknown role and treats anything but true as no opt-in", () => {
    const v = input({ role: "admin", updates: "yes" });
    expect(v.role).toBeNull();
    expect(v.updates).toBe(false);
  });
});

describe("beta sign-up storage", () => {
  it("stores one row per address and never overwrites an existing one", async () => {
    const d = db();
    expect(await saveBetaSignup(d, { subject: "anon-1", userId: null }, input({ name: "Ada", updates: true }))).toBe(true);
    expect(await saveBetaSignup(d, { subject: "anon-2", userId: null }, input({ name: "Mallory", updates: false }))).toBe(false);
    const rows = await d.prepare("SELECT email, name, updates_opt_in FROM beta_signups").all();
    expect(rows.results).toEqual([{ email: "ada@example.org", name: "Ada", updates_opt_in: 1 }]);
  });

  it("attaches the account id when signed in", async () => {
    const d = db();
    await saveBetaSignup(d, { subject: "user:u1", userId: "u1" }, input());
    const row = await d.prepare("SELECT user_id, subject FROM beta_signups").first();
    expect(row).toEqual({ user_id: "u1", subject: "user:u1" });
  });

  it("throttles a sender", async () => {
    const d = db();
    for (let i = 0; i < HOURLY_LIMIT; i++) {
      expect(await underLimit(d, "anon-1")).toBe(true);
      await saveBetaSignup(d, { subject: "anon-1", userId: null }, input({ email: `p${i}@example.org` }));
    }
    expect(await underLimit(d, "anon-1")).toBe(false);
    expect(await underLimit(d, "anon-2")).toBe(true);
  });
});

describe("POST /api/beta-signup", () => {
  const call = async (d: D1Database, body: unknown, method = "POST") => {
    const request = new Request("https://singlet.bio/api/beta-signup", {
      method,
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", Origin: "https://singlet.bio" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await onRequest({ request, env: { DB: d } as any, waitUntil: () => {} } as any);
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("accepts a sign-up and answers the same for a repeat", async () => {
    const d = db();
    expect(await call(d, { email: "ada@example.org", updates: true })).toEqual({ status: 200, json: { ok: true } });
    expect(await call(d, { email: "ADA@example.org" })).toEqual({ status: 200, json: { ok: true } });
    const n = await d.prepare("SELECT COUNT(*) AS n FROM beta_signups").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("rejects bad input and other methods, and silently drops the honeypot", async () => {
    const d = db();
    expect((await call(d, { email: "x" })).status).toBe(400);
    expect((await call(d, null)).status).toBe(400);
    expect((await call(d, {}, "GET")).status).toBe(405);
    expect(await call(d, { email: "bot@example.org", website: "spam" })).toEqual({ status: 200, json: { ok: true } });
    const n = await d.prepare("SELECT COUNT(*) AS n FROM beta_signups").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});
