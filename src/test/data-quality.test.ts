// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeModality, sanitizeQcFlag } from "../../functions/_shared/data-quality";
import { normOrganism } from "../../functions/_shared/catalog-refresh";

describe("normOrganism", () => {
  it("resolves genus-only and multi-part organism fields to a species", () => {
    expect(normOrganism("Mus")).toBe("Mus musculus");
    expect(normOrganism("Homo")).toBe("Homo sapiens");
    expect(normOrganism("Homo; Homo sapiens")).toBe("Homo sapiens");
    expect(normOrganism("Mus; Mus musculus; synthetic construct")).toBe("Mus musculus");
    expect(normOrganism("Mus; Homo sapiens")).toBe("Mus musculus");
  });
  it("keeps real binomials and the fallbacks", () => {
    expect(normOrganism("Danio rerio")).toBe("Danio rerio");
    expect(normOrganism("human")).toBe("Homo sapiens");
    expect(normOrganism(null)).toBe("Unknown");
    expect(normOrganism("")).toBe("Unknown");
  });
});

describe("sanitizeQcFlag", () => {
  it("passes the closed vocabulary and drops the retired one", () => {
    expect(sanitizeQcFlag("HEALTHY")).toBe("HEALTHY");
    expect(sanitizeQcFlag("WARN")).toBe("WARN");
    expect(sanitizeQcFlag("LOW_QUALITY")).toBe("LOW_QUALITY");
    expect(sanitizeQcFlag("gold")).toBeNull();
    expect(sanitizeQcFlag("bronze")).toBeNull();
    expect(sanitizeQcFlag(null)).toBeNull();
    expect(sanitizeQcFlag(undefined)).toBeNull();
  });
});

describe("normalizeModality", () => {
  it("uses one spelling per modality", () => {
    expect(normalizeModality("scrna", "10x 3'")).toBe("scRNA");
    expect(normalizeModality("scRNA", "10x 3'")).toBe("scRNA");
    expect(normalizeModality("snrna", "10x 3'")).toBe("snRNA");
    expect(normalizeModality("multiome", "10x Multiome / ATAC")).toBe("multiome");
  });
  it("does not call a droplet assay a plate assay", () => {
    expect(normalizeModality("plate_scrna", "10x (version unconfirmed)")).toBe("scRNA");
    expect(normalizeModality("plate_scrna", "10x 3'")).toBe("scRNA");
    expect(normalizeModality("plate_scrna", "Smart-seq / plate-based")).toBe("plate scRNA");
    expect(normalizeModality("plate_scrna", null)).toBe("plate scRNA");
  });
  it("passes unknown labels through and drops empty ones", () => {
    expect(normalizeModality("something_new", "Unknown")).toBe("something_new");
    expect(normalizeModality(null, "10x 3'")).toBeNull();
    expect(normalizeModality("  ", "10x 3'")).toBeNull();
  });
});
