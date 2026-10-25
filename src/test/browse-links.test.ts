import { describe, expect, it } from "vitest";
import { bundleUrl, isManifestFile, normalizeStudyRow, studyFileUrl } from "@/integrations/api/client";
import { snippetFor } from "@/components/browse/SelectionBar";

const MANIFEST = "https://data.singlet.bio/store/m/GSE145370.json";

describe("the file a Browse link downloads", () => {
  it("is the single .singlet file while it exists, the store manifest once it is retired, and the old URL for a study never moved", () => {
    expect(studyFileUrl("GSE1", null)).toBe(bundleUrl("GSE1"));
    expect(studyFileUrl("GSE1", undefined)).toBe(bundleUrl("GSE1"));
    expect(studyFileUrl("GSE145370", { manifest_url: MANIFEST, legacy_available: true })).toBe(bundleUrl("GSE145370"));
    expect(studyFileUrl("GSE145370", { manifest_url: MANIFEST, legacy_available: false })).toBe(MANIFEST);
    expect(isManifestFile({ legacy_available: false })).toBe(true);
    expect(isManifestFile({ legacy_available: true })).toBe(false);
    expect(isManifestFile(null)).toBe(false);
  });

  it("is read from the search row's store block", () => {
    const base = { gse_id: "GSE145370", title: "t", has_bundle: true, bundle_key: null, bundle_bytes: 1234 };
    const retired = normalizeStudyRow({ ...base, store: { format: "singlet-store", rev: "87b5fa4cb0a7a0d3", manifest_url: MANIFEST, n_samples: 14, bytes: 1234, legacy_available: false } })!;
    expect(retired.store).toMatchObject({ manifest_url: MANIFEST, legacy_available: false });
    expect(studyFileUrl(retired.gse_id, retired.store)).toBe(MANIFEST);
    const plain = normalizeStudyRow({ ...base, bundle_key: "data/GSE145370/GSE145370.singlet" })!;
    expect(plain.store).toBeNull();
    expect(studyFileUrl(plain.gse_id, plain.store)).toBe(bundleUrl("GSE145370"));
  });

  it("is what the selection bar's curl lines fetch, with a note when one of them is a manifest", () => {
    const urls = { GSE1: MANIFEST, GSE2: bundleUrl("GSE2") };
    const code = snippetFor("curl", ["GSE1", "GSE2"], urls);
    expect(code).toContain(`curl -O ${MANIFEST}`);
    expect(code).toContain(`curl -O ${bundleUrl("GSE2")}`);
    expect(code).toMatch(/^# .*manifest/);
    expect(code).not.toContain(bundleUrl("GSE1"));
    // all single files: the old output, unchanged
    expect(snippetFor("curl", ["GSE2"], { GSE2: bundleUrl("GSE2") })).toBe(`curl -O ${bundleUrl("GSE2")}`);
    expect(snippetFor("curl", ["GSE2"])).toBe(`curl -O ${bundleUrl("GSE2")}`);
    // the Python and R lines go through the loader, which knows both layouts
    expect(snippetFor("python", ["GSE1"], urls)).toContain('singlet.load("GSE1")');
  });
});
