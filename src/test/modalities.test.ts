import { describe, expect, it } from "vitest";
import { MODALITIES, MODALITY_BY_NAME, resolveModalities } from "../../functions/_shared/modalities";
import { isHiddenMember, isRestrictedMember } from "../../functions/_shared/restricted";

/**
 * The registry is duplicated three times on purpose — TypeScript for the MCP
 * server, Python for `singlet.SingletBundle`, R for `singlet_read()`. These
 * tests pin the invariants the other two copies also rely on, so a drift shows
 * up here first.
 */
describe("modality registry", () => {
  it("has unique names", () => {
    const names = MODALITIES.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares at least one archive member per modality", () => {
    for (const m of MODALITIES) {
      expect(m.members.length, m.name).toBeGreaterThan(0);
      expect(new Set(m.members).size, m.name).toBe(m.members.length);
    }
  });

  it("gives every modality a description and both readers", () => {
    for (const m of MODALITIES) {
      expect(m.description, m.name).not.toHaveLength(0);
      expect(m.python, m.name).toContain("b.");
      expect(m.r, m.name).toContain("singlet_");
    }
  });

  it("lists no member that is held back from the public product or not offered in Research Alpha", () => {
    for (const m of MODALITIES)
      for (const member of m.members) expect(isRestrictedMember(member) || isHiddenMember(member, { human: true }), `${m.name}: ${member}`).toBe(false);
  });

  it("covers the modalities the quickstart page promises", () => {
    for (const name of [
      "exon_counts",
      "intron_counts",
      "junctions",
      "donor_assignments",
      "nonhost_species",
      "vdj_gene_usage",
      "cell_cycle_scores",
      "summary",
    ]) {
      expect(MODALITY_BY_NAME.has(name), name).toBe(true);
    }
  });
});

describe("resolveModalities", () => {
  it("matches an older, flat bundle layout", () => {
    const found = resolveModalities([
      "exon_counts.1pz",
      "intron_counts.1pz",
      "sj_counts.1pz",
      "mt_variants.tsv",
      "summary.json",
    ]).map((f) => f.modality.name);
    // mt_variants is not offered in Research Alpha
    expect(found).toEqual(["exon_counts", "intron_counts", "junctions", "summary"]);
  });

  it("matches the newer, nested bundle layout", () => {
    const found = resolveModalities([
      "donor/donor_assignments.tsv",
      "nonhost/nonhost_em_abundance.tsv",
      "mt/mt_summary.tsv",
    ]);
    expect(found.map((f) => f.modality.name)).toEqual(["donor_assignments", "nonhost_species"]);
    expect(found.find((f) => f.modality.name === "donor_assignments")?.member).toBe("donor/donor_assignments.tsv");
  });

  it("prefers the first matching member when both layouts are present", () => {
    const found = resolveModalities(["donor/donor_assignments.tsv", "donor_assignments.tsv"]);
    expect(found[0].member).toBe("donor/donor_assignments.tsv");
  });

  it("returns nothing for a sample with no recognised files", () => {
    expect(resolveModalities(["notes.txt"])).toEqual([]);
  });
});
