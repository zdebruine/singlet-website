import { describe, expect, it } from "vitest";
import { ageLabel, dataAge, parseStatus, pct, reasonLabel } from "@/lib/campaign-status";

const base = {
  schema: "campaign-status/1", generated_epoch: 1000, samples: {}, failed: {}, review: {}, eta: {}, network: {}, disk: {}, shipping: {},
  backlog: {}, per_day: [],
};

describe("campaign status feed", () => {
  it("accepts only the known schema with its blocks", () => {
    expect(parseStatus(base)).not.toBeNull();
    expect(parseStatus({ ...base, schema: "campaign-status/2" })).toBeNull();
    expect(parseStatus({ ...base, disk: undefined })).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });
  it("grades the data age", () => {
    expect(dataAge(1000, 1000 * 1000 + 5 * 60_000).freshness).toBe("fresh");
    expect(dataAge(1000, 1000 * 1000 + 60 * 60_000).freshness).toBe("late");
    expect(dataAge(1000, 1000 * 1000 + 5 * 3600_000).freshness).toBe("stale");
    expect(dataAge(2000, 1000 * 1000).seconds).toBe(0);
  });
  it("words ages and reasons plainly", () => {
    expect(ageLabel(30)).toBe("under a minute ago");
    expect(ageLabel(600)).toBe("10 minutes ago");
    expect(ageLabel(7200)).toBe("2 hours ago");
    expect(reasonLabel("empty required")).toMatch(/empty/);
    expect(reasonLabel("odd new reason")).toBe("odd new reason");
  });
  it("keeps percentages in range", () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(12, 10)).toBe(100);
    expect(pct(1, 4)).toBe(25);
  });
});
