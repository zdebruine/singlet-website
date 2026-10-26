// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1-sqlite";
import { computeLayerStats } from "../../functions/_shared/layers-core";

const SCHEMA = `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, organism_primary TEXT, has_bundle INTEGER, n_usable_samples INTEGER, n_lowqc_samples INTEGER, reference_mismatch INTEGER);
CREATE TABLE bundle_index (gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT);
INSERT INTO gse_meta VALUES ('GSE1', 'Homo sapiens', 1, 4, 0, 0), ('GSE2', 'Mus musculus', 1, 2, 0, 0), ('GSE3', 'Homo sapiens', 1, 0, 1, 0), ('GSE4', 'Homo sapiens', 1, 3, 0, 1), ('GSE5', 'Mus musculus', 1, 2, 0, 0);
INSERT INTO bundle_index VALUES
  ('GSE1', 1, '["samples/A/exon_counts.1pz","samples/A/intron_counts.1pz","samples/A/donor/snp_ad.1pz","samples/A/ancestry_call.json","samples/A/sex_call.json"]', ''),
  ('GSE2', 1, '["samples/B/exon_counts.1pz","samples/B/intron_counts.1pz","samples/B/sex_call.json"]', ''),
  ('GSE3', 1, '["samples/C/exon_counts.1pz","samples/C/ancestry_call.json"]', ''),
  ('GSE4', 1, '["samples/D/exon_counts.1pz","samples/D/ancestry_call.json"]', ''),
  ('GSE5', 1, '["samples/E/exon_counts.1pz","samples/E/ancestry_call.json","samples/E/sex_call.json"]', '');
`;

describe("computeLayerStats", () => {
  it("counts layers over downloadable studies only", async () => {
    const s = await computeLayerStats(createTestD1(SCHEMA));
    // GSE3 has no sample that passed QC and GSE4 is a reference mismatch: neither is downloadable.
    expect(s.studies).toBe(3);
    const by = Object.fromEntries(s.layers.map((l) => [l.key, l]));
    expect(by.gene_counts.studies).toBe(3);
    expect(by.splicing.studies).toBe(2);
    // The donor genotype member is in GSE1's listing but is not a public layer.
    expect(by.snps).toBeUndefined();
    expect(by.mtdna.studies).toBe(0);
    // Ancestry counts human studies only: GSE5 (mouse) has the file but is not counted.
    expect(by.ancestry).toMatchObject({ studies: 1, of: 1 });
    expect(by.splicing.of).toBe(3);
    // Mouse sex_call.json files hold only "unknown": GSE2 and GSE5 have the file but are not counted.
    expect(by.sex).toMatchObject({ studies: 1, of: 1 });
  });
});
