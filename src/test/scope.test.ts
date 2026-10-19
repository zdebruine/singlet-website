import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs tool without types
import { scopeOf } from "../../scripts/data-audit/scope.mjs";

describe("scopeOf", () => {
  it("accepts single-cell wording, including underscores in titles", () => {
    expect(scopeOf("Day4_Day6_single_cell_RNAseq", "")).toBe("single_cell");
    expect(scopeOf("Atlas", "We profiled nuclei by snRNA-seq on the 10x Chromium")).toBe("single_cell");
  });
  it("flags bulk-only text", () => {
    expect(scopeOf("Zfr regulates RNA editing", "bulk RNA-seq of primary neurons")).toBe("not_single_cell");
  });
  it("marks multi-assay series as mixed", () => {
    expect(scopeOf("Chromatin and expression", "scRNA-seq and bulk ATAC-seq were combined")).toBe("mixed");
  });
  it("treats a SuperSeries with no single-cell words as superseries", () => {
    expect(scopeOf("X", "This SuperSeries is composed of the SubSeries listed below.")).toBe("superseries");
  });
});
