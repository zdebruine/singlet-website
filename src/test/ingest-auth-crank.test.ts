// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { acceptedDigests, checkIngestToken, tokenAccepted } from "../../functions/_shared/ingest-auth";
import { sha256Hex } from "../../functions/_shared/hash";
import { PENDING_SQL, onRequestGet } from "../../functions/api/ingest/[table]";
import { createTestD1 } from "./helpers/d1-sqlite";

const TOKEN = "test-ingest-token";

async function makeEnv(over: Record<string, unknown> = {}) {
  return { DB: createTestD1(), INGEST_TOKEN_SHA256: await sha256Hex(TOKEN), ...over };
}

function get(route: string, headers: Record<string, string>, env: unknown) {
  const request = new Request(`https://singlet.bio/api/ingest/${route}`, { headers });
  return onRequestGet({ request, env, params: { table: route } } as never);
}

describe("ingest token", () => {
  it("fails closed when INGEST_TOKEN_SHA256 is unset, blank or malformed", async () => {
    for (const v of [undefined, "", "   ", "not-a-digest", "abc,def"]) {
      expect(acceptedDigests({ INGEST_TOKEN_SHA256: v })).toEqual([]);
      expect(await tokenAccepted({ INGEST_TOKEN_SHA256: v }, TOKEN)).toBe(false);
    }
  });

  it("accepts any digest in a comma-separated rotation list", async () => {
    const old = await sha256Hex("old-token");
    const list = `${old}, ${await sha256Hex(TOKEN)}`;
    expect(await tokenAccepted({ INGEST_TOKEN_SHA256: list }, TOKEN)).toBe(true);
    expect(await tokenAccepted({ INGEST_TOKEN_SHA256: list }, "old-token")).toBe(true);
    expect(await tokenAccepted({ INGEST_TOKEN_SHA256: list }, "other")).toBe(false);
  });

  it("rejects a missing or wrong header", async () => {
    const env = await makeEnv();
    const none = await checkIngestToken(new Request("https://x/"), env);
    expect(none).toEqual({ ok: false, error: "Missing X-Ingest-Token" });
    const bad = await checkIngestToken(new Request("https://x/", { headers: { "X-Ingest-Token": "nope" } }), env);
    expect(bad).toEqual({ ok: false, error: "Invalid ingest token" });
  });
});

describe("GET /api/ingest/{refresh,index}-next", () => {
  it.each(["refresh-next", "index-next"])("%s refuses callers without the token and touches no data", async (route) => {
    const env = await makeEnv();
    const prepare = vi.spyOn(env.DB, "prepare");
    for (const headers of [{}, { "X-Ingest-Token": "wrong" }]) {
      const res = await get(route, headers, env);
      expect(res.status).toBe(401);
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses everyone when no digest is configured", async () => {
    const env = await makeEnv({ INGEST_TOKEN_SHA256: undefined });
    const res = await get("refresh-next", { "X-Ingest-Token": TOKEN }, env);
    expect(res.status).toBe(401);
  });

  it("does not echo database errors to the caller", async () => {
    const env = await makeEnv(); // an empty database: every query fails with "no such table"
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await get("refresh-next", { "X-Ingest-Token": TOKEN }, env);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toMatch(/no such table|sqlite|SELECT|meta_cache/i);
    expect(JSON.parse(text)).toMatchObject({ error: "Internal error", request_id: expect.stringMatching(/^[0-9a-f]{12}$/) });
  });
});

describe("index-next pending set", () => {
  const SCHEMA = `
    CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY);
    CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY);
    CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT);
    CREATE TABLE summaries_indexed (gse_id TEXT PRIMARY KEY);
    CREATE TABLE bundle_index_failure (gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT);
    INSERT INTO bundle_manifest VALUES ('GSE1'), ('GSE2'), ('GSE3'), ('GSE4'), ('GSE5');
  `;
  const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");

  async function pending(rows: [string, string, number][]) {
    const db = createTestD1(SCHEMA);
    for (const [gse, error, hoursAgo] of rows) {
      await db.prepare(`INSERT INTO bundle_index_failure VALUES (?, ?, ?)`).bind(gse, error, iso(hoursAgo)).run();
    }
    const r = await db.prepare(`SELECT m.gse_id AS g ${PENDING_SQL} ORDER BY m.gse_id`).all<{ g: string }>();
    return r.results.map((x) => x.g);
  }

  it("retries a transient park after the cool-off but never a park that proves the file bad", async () => {
    const got = await pending([
      ["GSE1", "Error: fetch failed", 1], // transient, fresh: held
      ["GSE2", "Error: fetch failed", 7], // transient, old: retried
      ["GSE3", "End of central directory not found", 90], // broken zip: held for good
      ["GSE4", "no summary.json", 90], // no summaries: held for good
    ]);
    expect(got).toEqual(["GSE2", "GSE5"]);
  });
});
