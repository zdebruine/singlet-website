// The cell-search facts snapshot follows meta_cache.facts_epoch: a backfill bumps it and every isolate rebuilds within five
// minutes, instead of serving a copy from before the backfill for up to six hours.
import { afterEach, describe, expect, it } from "vitest";
import { clearFactsMemo, sampleFacts } from "../../functions/_shared/cells/sample-facts";

function fakeDb(state: { epoch: string | null; builds: number; epochReads: number }) {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () => {
          if (sql.includes("meta_cache")) {
            state.epochReads++;
            return state.epoch == null ? null : { value: state.epoch };
          }
          return null;
        },
        all: async () => {
          if (/FROM\s+s1_sample/i.test(sql)) state.builds++;
          return { results: [] };
        },
        raw: async () => [],
      };
      return stmt;
    },
    batch: async (stmts: unknown[]) => stmts.map(() => ({ results: [] })),
  } as unknown as D1Database;
}

afterEach(() => clearFactsMemo());

describe("cell search facts: epoch", () => {
  it("keeps the snapshot while the epoch is unchanged and rebuilds when it changes", async () => {
    const state = { epoch: "a" as string | null, builds: 0, epochReads: 0 };
    const db = fakeDb(state);
    const t0 = 1_000_000_000_000;
    await sampleFacts(db, undefined, t0);
    const afterFirst = state.builds;
    expect(afterFirst).toBeGreaterThan(0);

    await sampleFacts(db, undefined, t0 + 60_000); // same epoch, inside the check window: no D1 read, no rebuild
    expect(state.builds).toBe(afterFirst);
    expect(state.epochReads).toBe(1);

    state.epoch = "b";
    await sampleFacts(db, undefined, t0 + 120_000); // epoch changed but not re-read yet (five-minute window)
    expect(state.builds).toBe(afterFirst);

    await sampleFacts(db, undefined, t0 + 400_000); // window passed: reads "b" and rebuilds
    expect(state.epochReads).toBe(2);
    expect(state.builds).toBe(afterFirst * 2);
  });

  it("treats a missing epoch row as a fixed epoch", async () => {
    const state = { epoch: null as string | null, builds: 0, epochReads: 0 };
    const db = fakeDb(state);
    await sampleFacts(db, undefined, 2_000_000_000_000);
    const n = state.builds;
    await sampleFacts(db, undefined, 2_000_000_000_000 + 400_000);
    expect(state.builds).toBe(n);
  });
});
