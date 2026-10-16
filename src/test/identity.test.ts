// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { anonSubjectFromIp, forgetKeyMemo, isSiteRequest, resolveIdentity, sameOriginOrSafe } from "../../functions/_shared/identity";
import { sha256Hex } from "../../functions/_shared/hash";
import { createTestD1 } from "./helpers/d1-sqlite";

const KEY = "sk_live_" + "k".repeat(32);
const noWait = () => undefined;
const req = (path: string, init: RequestInit = {}) => new Request(`https://singlet.bio${path}`, init);

async function db() {
  const d = createTestD1(readFileSync("schema/010_accounts.sql", "utf8"));
  await d.exec(`INSERT INTO users (id, email) VALUES ('u1', 'a@example.com')`);
  await d.prepare(`INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash) VALUES ('k1', 'u1', 't', 'sk_live_kkkk', ?1)`).bind(await sha256Hex(KEY)).run();
  return d;
}

beforeEach(() => forgetKeyMemo());

describe("who is calling", () => {
  it("a valid API key acts as its owner", async () => {
    const out = await resolveIdentity(req("/api/stats", { headers: { Authorization: `Bearer ${KEY}` } }), { DB: await db() }, noWait);
    expect(out).toMatchObject({ ok: true, identity: { kind: "api_key", subject: "user:u1", userId: "u1" } });
  });

  it("X-API-Key works the same as a bearer token", async () => {
    const out = await resolveIdentity(req("/api/stats", { headers: { "X-API-Key": KEY } }), { DB: await db() }, noWait);
    expect(out).toMatchObject({ ok: true, identity: { kind: "api_key" } });
  });

  it("a wrong, revoked or expired key is refused, never downgraded to anonymous", async () => {
    const d = await db();
    const wrong = await resolveIdentity(req("/", { headers: { Authorization: "Bearer sk_live_" + "z".repeat(32) } }), { DB: d }, noWait);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.response.status).toBe(401);

    await d.exec(`UPDATE api_keys SET revoked_at = '2026-01-01T00:00:00Z'`);
    forgetKeyMemo();
    const revoked = await resolveIdentity(req("/", { headers: { Authorization: `Bearer ${KEY}` } }), { DB: d }, noWait);
    expect(revoked.ok).toBe(false);

    await d.exec(`UPDATE api_keys SET revoked_at = NULL, expires_at = '2020-01-01T00:00:00Z'`);
    forgetKeyMemo();
    const expired = await resolveIdentity(req("/", { headers: { Authorization: `Bearer ${KEY}` } }), { DB: d }, noWait);
    expect(expired.ok).toBe(false);
  });

  it("a key lookup that cannot reach the database is a 503, not a free pass", async () => {
    const out = await resolveIdentity(req("/", { headers: { Authorization: `Bearer ${KEY}` } }), { DB: createTestD1("") }, noWait);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(503);
  });

  it("with nothing sent, the caller is anonymous and the address is hashed, not stored", async () => {
    const out = await resolveIdentity(req("/", { headers: { "CF-Connecting-IP": "203.0.113.7" } }), { DB: await db() }, noWait);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.identity.kind).toBe("anonymous");
      expect(out.identity.subject).toMatch(/^anon:[0-9a-f]{32}$/);
      expect(out.identity.subject).not.toContain("203");
    }
  });
});

describe("cookie sessions only count for same-origin writes", () => {
  it("allows safe methods from anywhere", () => {
    expect(sameOriginOrSafe(req("/", { method: "GET", headers: { Origin: "https://evil.example" } }))).toBe(true);
  });
  it("allows a POST from this site, by Origin or by Referer", () => {
    expect(sameOriginOrSafe(req("/", { method: "POST", headers: { Origin: "https://singlet.bio" } }))).toBe(true);
    expect(sameOriginOrSafe(req("/", { method: "POST", headers: { Referer: "https://singlet.bio/account" } }))).toBe(true);
  });
  it("refuses a POST from another site, with neither header, or with a malformed Referer", () => {
    expect(sameOriginOrSafe(req("/", { method: "POST", headers: { Origin: "https://evil.example" } }))).toBe(false);
    expect(sameOriginOrSafe(req("/", { method: "POST" }))).toBe(false);
    expect(sameOriginOrSafe(req("/", { method: "DELETE", headers: { Referer: "not a url" } }))).toBe(false);
    expect(sameOriginOrSafe(req("/", { method: "POST", headers: { Origin: "https://singlet.bio.evil.example" } }))).toBe(false);
  });
});

describe("the website's own search box versus everyone else", () => {
  it("recognises the site and its previews, by Origin or Sec-Fetch-Site", () => {
    expect(isSiteRequest(req("/", { headers: { Origin: "https://singlet.bio" } }))).toBe(true);
    expect(isSiteRequest(req("/", { headers: { Origin: "https://alpha.singlet.bio" } }))).toBe(true);
    expect(isSiteRequest(req("/", { headers: { Origin: "https://my-branch.singlet-4gc.pages.dev" } }))).toBe(true);
    expect(isSiteRequest(req("/", { headers: { "Sec-Fetch-Site": "same-origin" } }))).toBe(true);
  });
  it("does not recognise look-alikes or nothing at all", () => {
    for (const origin of ["https://singlet.bio.evil.example", "http://singlet.bio", "https://evilsinglet.bio", "https://x.pages.dev"]) {
      expect(isSiteRequest(req("/", { headers: { Origin: origin } })), origin).toBe(false);
    }
    expect(isSiteRequest(req("/"))).toBe(false);
    expect(isSiteRequest(req("/", { headers: { "Sec-Fetch-Site": "cross-site" } }))).toBe(false);
  });
});

describe("anonymous subjects", () => {
  it("depend on the secret salt, so the public default cannot be used to reverse them", async () => {
    const a = await anonSubjectFromIp("203.0.113.7");
    const b = await anonSubjectFromIp("203.0.113.7", "a-secret-salt");
    expect(a).not.toBe(b);
    expect(b).toBe(await anonSubjectFromIp("203.0.113.7", "a-secret-salt"));
    const out = await resolveIdentity(req("/", { headers: { "CF-Connecting-IP": "203.0.113.7" } }), { DB: await db(), ANON_IP_SALT: "a-secret-salt" }, noWait);
    expect(out.ok && out.identity.subject).toBe(b);
  });
});
