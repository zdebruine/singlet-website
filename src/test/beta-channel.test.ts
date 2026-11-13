import { describe, expect, it } from "vitest";
import { classifyObjectKey, isBeta } from "../../functions/_shared/channel";
import { isPrivateKey, isRestrictedPath } from "../../functions/_shared/restricted";
import { HPC_PATH_RE } from "../../functions/_shared/hpc-dashboard";

const D = "0123456789abcdef0123456789abcdef";

describe("beta channel", () => {
  it("is on only for CHANNEL=beta", () => {
    expect(isBeta({ CHANNEL: "beta" })).toBe(true);
    expect(isBeta({ CHANNEL: " Beta " })).toBe(true);
    expect(isBeta({})).toBe(false);
    expect(isBeta({ CHANNEL: "alpha" })).toBe(false);
  });

  it("accepts only content-addressed s1 objects and cells tables", () => {
    expect(classifyObjectKey(`s1/s/GSM1/${D}.s1`)).toEqual({ ok: true, kind: "sample", digest: D });
    expect(classifyObjectKey(`s1/a/GSM1/${D}.parquet`)).toMatchObject({ ok: true, kind: "label" });
    expect(classifyObjectKey(`s1/ref/${D}.pack`)).toMatchObject({ ok: true, kind: "pack" });
    expect(classifyObjectKey("s1/cells/GSE1.cells")).toMatchObject({ ok: true, kind: "cells", digest: null });
    for (const bad of ["s1/m/GSE1.json", "s1/s/GSM1/abc.s1", `data/GSE1/GSE1.singlet`, `s1/s/GSM1/${D}.s1/../x`, ""]) {
      expect(classifyObjectKey(bad).ok).toBe(false);
    }
  });

  it("refuses private/* for the public bucket and treats it as restricted", () => {
    expect(isPrivateKey("private/GSM1/genotype.vcf.gz")).toBe(true);
    expect(isPrivateKey("/private/x")).toBe(true);
    expect(isPrivateKey(`s1/s/GSM1/${D}.s1`)).toBe(false);
    expect(classifyObjectKey("private/GSM1/genotype.vcf.gz")).toMatchObject({ ok: false });
    expect(isRestrictedPath("private/GSM1/reads.bam")).toBe(true);
  });

  it("serves product-test reports from the dashboard bucket", () => {
    expect(HPC_PATH_RE.test("beta/product-test.json")).toBe(true);
    expect(HPC_PATH_RE.test("beta/../x.json")).toBe(false);
  });
});
