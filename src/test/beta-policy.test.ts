// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../workers/data/${p}`, import.meta.url), "utf8");

describe("Beta data Worker policy", () => {
  it("has its own policy with none of Alpha's withheld studies or excluded samples", () => {
    const beta = JSON.parse(read("policy/beta-policy.json"));
    const alpha = JSON.parse(read("policy/alpha-policy.json"));
    expect(beta.version).toMatch(/^beta-/);
    expect(beta.withheld_studies).toEqual([]);
    expect(beta.excluded_samples).toEqual([]);
    expect(alpha.withheld_studies.length).toBeGreaterThan(0);
  });

  it("is swapped in by the Beta config only", () => {
    expect(read("wrangler.beta.toml")).toMatch(/\[alias\][\s\S]*"\.\.\/policy\/alpha-policy\.json"\s*=\s*"\.\/policy\/beta-policy\.json"/);
    expect(read("wrangler.toml")).not.toMatch(/beta-policy/);
  });
});
