// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exportStudyAccessions, parseSearchParams } from "../../functions/_shared/search-core";
import { createTestD1 } from "./helpers/d1-sqlite";

// Runs the real export SQL, FTS included: a text query once failed in production with "no such column: score"
// while a string-level check of the rewritten SQL passed.
const SCHEMA = `
CREATE TABLE gse (id TEXT PRIMARY KEY, title TEXT, abstract TEXT, n_gsm_total INTEGER, n_gsm_failed INTEGER, r2_bundle_bytes INTEGER, r2_bundle_key TEXT, pubmed_ids TEXT);
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, status TEXT, n_cells INTEGER);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT,
                       assay_families TEXT, tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER,
                       n_cells INTEGER, has_bundle INTEGER, year INTEGER, updated_at TEXT, n_usable_samples INTEGER,
                       reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_samples INTEGER, n_lowqc_cells INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, n_gsms_in_bundle INTEGER, reference_build TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, usable INTEGER, n_cells_called INTEGER, median_genes REAL, mapping_rate REAL, qc_tier INTEGER);
CREATE VIRTUAL TABLE fts_gse USING fts5(id, title, abstract, organism);
CREATE VIRTUAL TABLE fts_gsm USING fts5(gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics);

INSERT INTO gse (id, title, abstract, n_gsm_total, n_gsm_failed, r2_bundle_key) VALUES
  ('GSE1', 'Glioma atlas', 'single-cell glioma tumours', 1, 0, 'k'), ('GSE2', 'Liver study', 'hepatocytes', 1, 0, 'k');
INSERT INTO gse_meta (gse_id, n_done, n_total, n_cells, has_bundle, n_usable_samples, reference_mismatch, n_usable_cells) VALUES
  ('GSE1', 1, 1, 100, 1, 1, 0, 100), ('GSE2', 1, 1, 50, 1, 1, 0, 50);
INSERT INTO bundle_manifest VALUES ('GSE1', 1, 'GRCh38'), ('GSE2', 1, 'GRCh38');
INSERT INTO sample_qc (gsm_id, gse_id, usable, n_cells_called) VALUES ('GSM1', 'GSE1', 1, 100), ('GSM2', 'GSE2', 1, 50);
INSERT INTO gsm VALUES ('GSM1', 'GSE1', 'DONE', 100), ('GSM2', 'GSE2', 'DONE', 50);
INSERT INTO fts_gse VALUES ('GSE1', 'Glioma atlas', 'single-cell glioma tumours', 'Homo sapiens'), ('GSE2', 'Liver study', 'hepatocytes', 'Homo sapiens');
INSERT INTO fts_gsm VALUES ('GSM1', 'GSE1', 'glioma sample', '', 'brain', '', 'Homo sapiens', 'glioma', ''), ('GSM2', 'GSE2', 'liver sample', '', 'liver', '', 'Homo sapiens', '', '');
`;

const run = (qs: string) => {
  const ctx = { db: createTestD1(SCHEMA), rules: undefined, waitUntil: () => undefined } as unknown as Parameters<typeof exportStudyAccessions>[0];
  return exportStudyAccessions(ctx, parseSearchParams(new URL(`https://x/api/manifest?${qs}`)));
};

describe("exportStudyAccessions", () => {
  it("answers a text query", async () => {
    const r = await run("q=glioma");
    expect(r.accessions).toEqual(["GSE1"]);
    expect(r.total).toBe(1);
  });

  it("answers a filter-only query", async () => {
    const r = await run("has_bundle=true");
    expect(r.accessions.sort()).toEqual(["GSE1", "GSE2"]);
    expect(r.total).toBe(2);
  });
});
