// @vitest-environment node
// workers/data-guard: the legacy-bundle retirement switch (s1_flags.legacy_bundles, website schema/038; docs/S1-CUTOVER.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/data-guard/src/index";
import { isLegacyRetired, resetRetireMemo } from "../../workers/data-guard/src/retire";
import { createTestD1 } from "./helpers/d1-sqlite";

// the s1 catalog as schema/038 leaves it (this branch predates the file)
const SCHEMA = `
CREATE TABLE s1_study (gse_id TEXT PRIMARY KEY, manifest_key TEXT NOT NULL, rev TEXT NOT NULL, n_samples INTEGER NOT NULL);
CREATE TABLE s1_migration (gse_id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE s1_flags (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
INSERT INTO s1_flags (name, value) VALUES ('legacy_bundles', 'served');
INSERT INTO s1_study VALUES ('GSE1', 's1/m/GSE1.json', '0123456789abcdef', 2), ('GSE2', 's1/m/GSE2.json', '0123456789abcdef', 1), ('GSE4', 's1/m/GSE4.json', '0123456789abcdef', 1);
INSERT INTO s1_migration VALUES ('GSE1', 'verified'), ('GSE2', 'failed'), ('GSE4', 'retired');
`;

const origin: string[] = [];
beforeEach(() => {
  resetRetireMemo();
  origin.length = 0;
  vi.stubGlobal("fetch", async (req: Request) => {
    origin.push(req.url);
    return new Response("legacy bytes", { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

// a bucket with no objects: the guard only reaches it for ranged GETs of a .singlet, which these tests do not need
const DATA = { head: async () => null, get: async () => null } as unknown as R2Bucket;

function env() {
  const db = createTestD1(SCHEMA);
  return { env: { DATA, DB: db as unknown as D1Database }, db };
}
const call = (e: { DATA: R2Bucket; DB?: D1Database }, path: string, method = "GET") => worker.fetch(new Request(`https://data.singlet.bio${path}`, { method }), e as never);
const flip = (db: ReturnType<typeof createTestD1>, value: string) => {
  db.raw.prepare(`UPDATE s1_flags SET value = ? WHERE name = 'legacy_bundles'`).run(value);
  resetRetireMemo();
};

describe("data-guard: retired legacy bundles", () => {
  it("'served': every legacy file passes to the origin as before", async () => {
    const { env: e } = env();
    expect((await call(e, "/data/GSE1/GSE1.singlet", "HEAD")).status).toBe(200);
    expect((await call(e, "/data/GSE1/manifest.json")).status).toBe(200);
    expect(origin).toHaveLength(2);
  });

  it("'retired': a verified (or retired) study answers 410 pointing at its .s1 manifest; a failed or unmoved study is untouched", async () => {
    const { env: e, db } = env();
    flip(db, "retired");
    for (const [path, method] of [["/data/GSE1/GSE1.singlet", "GET"], ["/data/GSE1/GSE1.singlet", "HEAD"], ["/data/GSE4/GSE4.singlet", "GET"]] as const) {
      const r = await call(e, path, method);
      expect(r.status, path).toBe(410);
      expect(r.headers.get("Link")).toMatch(/^<https:\/\/data\.singlet\.bio\/s1\/m\/GSE\d\.json>; rel="alternate"/);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(await (await call(e, "/data/GSE1/GSE1.singlet")).text()).toContain("https://data.singlet.bio/s1/m/GSE1.json");
    expect((await call(e, "/data/GSE2/GSE2.singlet", "HEAD")).status).toBe(200); // migration failed: still the legacy file
    expect((await call(e, "/data/GSE3/GSE3.singlet", "HEAD")).status).toBe(200); // never moved
    expect((await call(e, "/data/GSE1/GSE1.singlet", "OPTIONS")).status).toBe(200); // CORS preflight still answered
    expect(origin.filter((u) => u.includes("GSE1"))).toEqual(["https://data.singlet.bio/data/GSE1/GSE1.singlet"]); // only the OPTIONS
  });

  it("rollback: 'served' again restores the file; the switch is remembered for a minute per isolate", async () => {
    const { env: e, db } = env();
    flip(db, "retired");
    expect(await isLegacyRetired(e, "GSE1", 1_000)).toBe(true);
    db.raw.prepare(`UPDATE s1_flags SET value = 'served'`).run();
    expect(await isLegacyRetired(e, "GSE1", 30_000)).toBe(true); // still remembered
    expect(await isLegacyRetired(e, "GSE1", 62_000)).toBe(false); // re-read after a minute
  });

  it("fails open: no D1 binding, no tables, or a withheld study (404 first) never turn into a 410", async () => {
    expect((await call({ DATA }, "/data/GSE1/GSE1.singlet", "HEAD")).status).toBe(200);
    const bare = createTestD1("");
    expect(await isLegacyRetired({ DB: bare as unknown as D1Database }, "GSE1")).toBe(false);
    const { env: e, db } = env();
    flip(db, "retired");
    db.raw.exec(`INSERT INTO s1_study VALUES ('GSE145370', 's1/m/GSE145370.json', '0123456789abcdef', 1); INSERT INTO s1_migration VALUES ('GSE145370', 'verified');`);
    expect((await call(e, "/data/GSE145370/GSE145370.singlet")).status).toBe(404); // withheld from Alpha
  });
});
