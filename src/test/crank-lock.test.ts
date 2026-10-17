// @vitest-environment node
import { describe, expect, it } from "vitest";
import { acquireCrankLock, releaseCrankLock } from "../../functions/_shared/crank-lock";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = `CREATE TABLE meta_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);`;

describe("crank lock", () => {
  it("lets exactly one of many simultaneous callers in", async () => {
    const db = createTestD1(SCHEMA);
    const results = await Promise.all(Array.from({ length: 25 }, () => acquireCrankLock(db, "k", 60_000, 1_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results) if (!r.ok) expect(r.retryAfterMs).toBe(60_000);
  });

  it("stays closed while held and opens once the deadline has passed", async () => {
    const db = createTestD1(SCHEMA);
    expect((await acquireCrankLock(db, "k", 5_000, 1_000)).ok).toBe(true);
    const held = await acquireCrankLock(db, "k", 5_000, 3_000);
    expect(held).toEqual({ ok: false, retryAfterMs: 3_000 });
    expect((await acquireCrankLock(db, "k", 5_000, 6_001)).ok).toBe(true);
  });

  it("keeps independent keys independent", async () => {
    const db = createTestD1(SCHEMA);
    expect((await acquireCrankLock(db, "index-next:lock", 5_000, 1_000)).ok).toBe(true);
    expect((await acquireCrankLock(db, "refresh-next:lock", 5_000, 1_000)).ok).toBe(true);
  });

  it("release leaves a short cooldown, then opens", async () => {
    const db = createTestD1(SCHEMA);
    const got = await acquireCrankLock(db, "k", 120_000, 1_000);
    if (!got.ok) throw new Error("expected the lock");
    await releaseCrankLock(db, got.lock, 1_000, 2_000);
    expect((await acquireCrankLock(db, "k", 5_000, 2_500)).ok).toBe(false);
    expect((await acquireCrankLock(db, "k", 5_000, 3_001)).ok).toBe(true);
  });

  it("a run whose lock expired cannot shorten the next run's lock", async () => {
    const db = createTestD1(SCHEMA);
    const first = await acquireCrankLock(db, "k", 1_000, 0);
    if (!first.ok) throw new Error("expected the lock");
    const second = await acquireCrankLock(db, "k", 60_000, 2_000); // first expired
    expect(second.ok).toBe(true);
    await releaseCrankLock(db, first.lock, 0, 2_100); // late release by the first run
    expect((await acquireCrankLock(db, "k", 60_000, 2_200)).ok).toBe(false);
  });
});
