import { describe, expect, it } from "vitest";
import { appendPoint, checkSnapshot, cleanPoint, inRange, keepPoint } from "../../functions/_shared/hpc-ops";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("cleanPoint", () => {
  it("keeps numbers and short strings under safe keys", () => {
    const p = cleanPoint({ t: "2026-11-20T12:00:00Z", u_cpu: 41.5, bn: "x".repeat(40), "bad key": 1, nested: { a: 1 }, nan: Number.NaN, gone: null });
    expect(p).toEqual({ t: "2026-11-20T12:00:00Z", u_cpu: 41.5, bn: "x".repeat(16), gone: null });
  });
  it("needs a time", () => {
    expect(cleanPoint({ u_cpu: 1 })).toBeNull();
    expect(cleanPoint({ t: "not a time" })).toBeNull();
    expect(cleanPoint([1])).toBeNull();
  });
});

describe("checkSnapshot", () => {
  const ok = { schema: "hpc-dashboard/1", generated_at: "2026-11-20T12:00:00Z", nodes: [], point: { t: "2026-11-20T12:00:00Z" } };
  it("accepts a snapshot of the right shape", () => expect(checkSnapshot(ok).ok).toBe(true));
  it("refuses other schemas, missing nodes and a missing point", () => {
    expect(checkSnapshot({ ...ok, schema: "x" }).ok).toBe(false);
    expect(checkSnapshot({ ...ok, nodes: "no" }).ok).toBe(false);
    expect(checkSnapshot({ ...ok, point: null }).ok).toBe(false);
    expect(checkSnapshot([]).ok).toBe(false);
  });
});

describe("series thinning", () => {
  it("keeps everything from the last week, hourly points to 60 days, then 6-hourly", () => {
    expect(keepPoint(NOW - 6 * 24 * H - 17 * 60_000, NOW)).toBe(true);
    const old = Date.parse("2026-11-05T10:30:00Z"); // 15 days old, half past
    expect(keepPoint(old, NOW)).toBe(false);
    expect(keepPoint(Date.parse("2026-11-05T10:00:00Z"), NOW)).toBe(true);
    expect(keepPoint(Date.parse("2026-08-20T10:00:00Z"), NOW)).toBe(false);
    expect(keepPoint(Date.parse("2026-08-20T12:00:00Z"), NOW)).toBe(true);
    expect(keepPoint(NOW - 400 * 24 * H, NOW)).toBe(false);
  });
  it("appends in order, replaces a repeated time and thins what aged out", () => {
    const series = [{ t: "2026-11-05T10:30:00Z", a: 1 }, { t: "2026-11-05T10:00:00Z", a: 2 }, { t: "2026-11-19T12:00:00Z", a: 3 }];
    const out = appendPoint(series, { t: iso(NOW), a: 4 }, NOW);
    expect(out.map((p) => p.a)).toEqual([2, 3, 4]);
    expect(appendPoint(out, { t: iso(NOW), a: 5 }, NOW).map((p) => p.a)).toEqual([2, 3, 5]);
  });
});

describe("inRange", () => {
  it("filters by age", () => {
    const pts = [{ t: iso(NOW - 30 * H) }, { t: iso(NOW - 2 * H) }];
    expect(inRange(pts, "24h", NOW)).toHaveLength(1);
    expect(inRange(pts, "all", NOW)).toHaveLength(2);
  });
});
