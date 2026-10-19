// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1-sqlite";
import { computeLayerStats } from "../../functions/_shared/layers-core";

const SCHEMA = `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER, reference_mismatch INTEGER);
CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT);
INSERT INTO gse_meta VALUES ('GSE1', 1, 4, 0, 0), ('GSE2', 1, 2, 0, 0), ('GSE3', 1, 0, 1, 0), ('GSE4', 1, 3, 0, 1);
INSERT INTO bundle_index VALUES
  ('GSE1', 1, '["samples/A/exon_counts.1pz","samples/A/intron_counts.1pz","samples/A/donor/snp_ad.1pz","samples/A/ancestry_call.json"]', ''),
  ('GSE2', 1, '["samples/B/exon_counts.1pz","samples/B/intron_counts.1pz"]', ''),
  ('GSE3', 1, '["samples/C/exon_counts.1pz","samples/C/ancestry_call.json"]', ''),
  ('GSE4', 1, '["samples/D/exon_counts.1pz","samples/D/ancestry_call.json"]', '');
`;

describe("computeLayerStats", () => {
  it("counts layers over downloadable studies only", async () => {
    const s = await computeLayerStats(createTestD1(SCHEMA));
    // GSE3 has no sample that passed QC and GSE4 is a reference mismatch: neither is downloadable.
    expect(s.studies).toBe(2);
    const by = Object.fromEntries(s.layers.map((l) => [l.key, l.studies]));
    expect(by.gene_counts).toBe(2);
    expect(by.splicing).toBe(2);
    expect(by.snps).toBe(1);
    expect(by.ancestry).toBe(1);
    expect(by.mtdna).toBe(0);
  });
});
