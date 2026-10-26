import { describe, expect, it } from "vitest";
import { isRestrictedMember, isRestrictedPath, publicEntries } from "../../functions/_shared/restricted";
import { bundleIndexResponse } from "../../functions/_shared/bundle-core";
import type { BundleIndex } from "../../functions/_shared/bundle-reader";

const e = (p: string) => ({ p, n: 0, c: 10, u: 10, o: 0 });

describe("restricted members", () => {
  it("holds back per-donor germline files", () => {
    for (const rel of [
      "donor/snp_ad.1pz",
      "donor/snp_dp.1pz",
      "donor/donor0.vcf",
      "donor/donor12_coverage.tsv",
      "ase_counts.tsv",
      "mt/donor0_mt_consensus.fa",
      "mt/donor0_mt_variants.vcf",
      "mt/mt_events.1pz",
      "snp_anything.tsv",
      "x/y.vcf.gz",
      // Research Alpha: no mitochondrial allele layer and no ancestry call is released (same rule as workers/data-guard)
      "mt_heteroplasmy.1pz",
      "mt_variants.tsv",
      "ancestry_call.json",
    ]) {
      expect(isRestrictedMember(rel), rel).toBe(true);
    }
  });

  it("keeps the public layers", () => {
    for (const rel of [
      "exon_counts.1pz",
      "intron_counts.1pz",
      "donor/donor_assignments.tsv",
      "donor_assignments.tsv",
      "doublet_scores.tsv",
      "sex_call.json",
      "mt/mt_summary.tsv",
      "mt_reference.fa",
      "summary.json",
    ]) {
      expect(isRestrictedMember(rel), rel).toBe(false);
    }
  });

  it("is deny by default inside donor/ and mt/", () => {
    expect(isRestrictedMember("donor/new_output.tsv")).toBe(true);
    expect(isRestrictedMember("mt/new_output.tsv")).toBe(true);
  });

  it("reads full archive paths and bare names", () => {
    expect(isRestrictedPath("samples/GSM1/donor/snp_ad.1pz")).toBe(true);
    expect(isRestrictedPath("samples/GSM1/donor/donor_assignments.tsv")).toBe(false);
    expect(isRestrictedPath("snp_ad.1pz")).toBe(true);
    expect(isRestrictedPath("manifest.json")).toBe(false);
    expect(isRestrictedPath("samples/GSM1/exon_counts.1pz")).toBe(false);
  });

  it("filters entries and keeps their order", () => {
    const list = [e("manifest.json"), e("samples/GSM1/donor/snp_ad.1pz"), e("samples/GSM1/exon_counts.1pz"), e("samples/GSM1/ase_counts.tsv")];
    expect(publicEntries(list).map((x) => x.p)).toEqual(["manifest.json", "samples/GSM1/exon_counts.1pz"]);
  });
});

describe("bundle listing", () => {
  it("does not list restricted files, though the stored index still has them", async () => {
    const index: BundleIndex = {
      gse_id: "GSE1",
      bytes: 100,
      indexed_at: "",
      entries: [
        e("manifest.json"),
        e("samples/GSM1/exon_counts.1pz"),
        e("samples/GSM1/donor/snp_ad.1pz"),
        e("samples/GSM1/donor/donor0.vcf"),
        e("samples/GSM1/donor/donor_assignments.tsv"),
        e("samples/GSM1/mt/mt_events.1pz"),
      ],
    };
    const db = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) } as unknown as D1Database;
    const res = await bundleIndexResponse(db, "GSE1", index);
    expect(res.samples[0].files.map((f) => f.path)).toEqual(["samples/GSM1/donor/donor_assignments.tsv", "samples/GSM1/exon_counts.1pz"]);
    expect(res.study_files.map((f) => f.path)).toEqual(["manifest.json"]);
    expect(index.entries).toHaveLength(6);
  });
});
