// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accountFor, computeStats } from "../../functions/_shared/stats-core";
import { DOWNLOADABLE_SQL, parseSearchParams, planStudyQuery } from "../../functions/_shared/search-core";
import { createTestD1 } from "./helpers/d1-sqlite";

/**
 * One small catalog, and every headline number computed from it two ways
 * (/api/stats and the default search) must agree: they count what a visitor can
 * download and use, not every file that happens to exist.
 *
 *   A  downloadable   2 usable samples (100 + 50 cells) and 1 unusable
 *   B  file, but no usable sample          → withheld
 *   C  file, usable sample, wrong species reference → withheld
 *   D  no file yet
 *   E  downloadable   1 usable sample (70 cells)
 */
const SCHEMA = `
CREATE TABLE gse (id TEXT PRIMARY KEY, title TEXT, abstract TEXT, n_gsm_total INTEGER, n_gsm_failed INTEGER, r2_bundle_bytes INTEGER, r2_bundle_key TEXT);
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, status TEXT, n_cells INTEGER, protocol TEXT, median_umis REAL,
                  organism_primary TEXT, mapping_rate REAL, median_genes REAL, failure_category TEXT);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT,
                       assay_families TEXT, tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER,
                       n_cells INTEGER, has_bundle INTEGER, year INTEGER, updated_at TEXT, n_usable_samples INTEGER,
                       reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_samples INTEGER, n_lowqc_cells INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, n_gsms_in_bundle INTEGER, reference_build TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, usable INTEGER, n_cells_called INTEGER, median_genes REAL, mapping_rate REAL, qc_tier INTEGER);

INSERT INTO gse (id, n_gsm_total, n_gsm_failed, r2_bundle_key) VALUES
  ('GSE1', 3, 0, 'k'), ('GSE2', 1, 0, 'k'), ('GSE3', 1, 0, 'k'), ('GSE4', 5, 1, NULL), ('GSE5', 1, 0, 'k'), ('GSE6', 1, 0, NULL);
INSERT INTO gse_meta (gse_id, n_done, n_total, n_cells, has_bundle, n_usable_samples, reference_mismatch, n_usable_cells) VALUES
  ('GSE1', 3, 3, 400, 1, 2, 0, 150),
  ('GSE2', 1, 1, 80,  1, 0, 0, 0),
  ('GSE3', 1, 1, 30,  1, 1, 1, 30),
  ('GSE4', 2, 2, 900, 0, NULL, NULL, NULL),
  ('GSE5', 1, 1, 70,  1, 1, 0, 70);
INSERT INTO bundle_manifest (gse_id, n_gsms_in_bundle) VALUES ('GSE1', 3), ('GSE2', 1), ('GSE3', 1), ('GSE5', 1);
INSERT INTO sample_qc (gsm_id, gse_id, usable, n_cells_called) VALUES
  ('GSM11', 'GSE1', 1, 100), ('GSM12', 'GSE1', 1, 50), ('GSM13', 'GSE1', 0, 10),
  ('GSM21', 'GSE2', 0, 0),
  ('GSM31', 'GSE3', 1, 30),
  ('GSM51', 'GSE5', 1, 70);
INSERT INTO gsm (gsm_id, gse_id, status, n_cells) VALUES
  ('GSM11', 'GSE1', 'DONE', 100), ('GSM12', 'GSE1', 'DONE', 50), ('GSM13', 'GSE1', 'DONE', 10),
  ('GSM21', 'GSE2', 'DONE', 0), ('GSM31', 'GSE3', 'DONE', 30),
  ('GSM41', 'GSE4', 'DONE', 900), ('GSM42', 'GSE4', 'FAIL', 0),
  ('GSM51', 'GSE5', 'DONE', 70);
`;

describe("the headline numbers", () => {
  it("/api/stats counts downloadable studies and what is usable inside them", async () => {
    const db = createTestD1(SCHEMA);
    const s = await computeStats(db);
    expect(s).not.toBeNull();
    expect(s!.studies_with_files).toBe(2); // GSE1 and GSE5
    expect(s!.files_published).toBe(4); // GSE1, 2, 3, 5 have a file
    expect(s!.studies_withheld).toBe(2); // GSE2 (nothing usable), GSE3 (wrong reference)
    expect(s!.studies_with_files + s!.studies_withheld).toBe(s!.files_published);
    expect(s!.samples_in_files).toBe(3); // GSM11, GSM12, GSM51: GSM31 is in a withheld study
    expect(s!.cells_in_files).toBe(220); // 100 + 50 + 70
  });

  it("accounts for every sample and study exactly once", async () => {
    const db = createTestD1(SCHEMA);
    const s = (await computeStats(db))!;
    const a = s.accounting;
    expect(a.studies_tracked).toBe(6);
    expect(a.studies_without_samples).toBe(1); // GSE6 has no ingested sample
    expect(a.studies_with_samples + a.studies_without_samples).toBe(a.studies_tracked);
    expect(a.studies_published).toBe(a.studies_downloadable + a.studies_withheld);
    expect(a.studies_awaiting_index).toBe(0);

    expect(a.samples_advertised).toBe(12);
    expect(a.samples_not_ingested).toBe(4); // 12 advertised, 8 have a catalog row
    expect(a.samples_failed).toBe(1);
    expect(a.samples_done).toBe(7);
    expect(a.done_not_in_files).toBe(1); // GSM41: processed, in no published file yet
    expect(a.in_files_unusable).toBe(2); // GSM13, GSM21
    expect(a.in_files_usable_withheld).toBe(1); // GSM31 sits in a study with the wrong reference
    expect(a.in_files_usable_downloadable).toBe(3);

    // the identities the About page promises
    expect(a.samples_not_ingested + a.samples_failed + a.samples_other + a.samples_done).toBe(a.samples_advertised);
    expect(a.done_in_files + a.done_not_in_files).toBe(a.samples_done);
    expect(a.in_files_unusable + a.in_files_usable_withheld + a.in_files_usable_downloadable).toBe(a.done_in_files);
    expect(a.in_files_usable_downloadable).toBe(s.samples_in_files);
  });

  it("the default search totals its results on the same basis", async () => {
    const db = createTestD1(SCHEMA);
    const plan = planStudyQuery(parseSearchParams(new URL("https://singlet.bio/api/search")));
    const counted = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number; samples: number; cells: number }>();
    expect(counted).toEqual({ n: 2, samples: 3, cells: 220 });

    const page = await db.prepare(plan.sql).bind(...plan.params).all<{ gse_id: string; _total: number; _samples: number; _cells: number }>();
    expect(page.results.map((r) => r.gse_id).sort()).toEqual(["GSE1", "GSE5"]);
    expect(page.results[0]).toMatchObject({ _total: 2, _samples: 3, _cells: 220 });

    const stats = await computeStats(db);
    expect([counted!.n, counted!.samples, counted!.cells]).toEqual([stats!.studies_with_files, stats!.samples_in_files, stats!.cells_in_files]);
  });

  it("falls back to the catalog count for cells until n_usable_cells has been filled in", async () => {
    const db = createTestD1(SCHEMA);
    await db.exec("UPDATE gse_meta SET n_usable_cells = NULL");
    const plan = planStudyQuery(parseSearchParams(new URL("https://singlet.bio/api/search")));
    const counted = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ cells: number }>();
    expect(counted!.cells).toBe(470); // n_cells of GSE1 + GSE5: a catalog number, never zero
  });

  it("a search that includes unbuilt studies says it is counting catalog metadata", async () => {
    const db = createTestD1(SCHEMA);
    const plan = planStudyQuery(parseSearchParams(new URL("https://singlet.bio/api/search?has_bundle=0")));
    const counted = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number; samples: number; cells: number }>();
    expect(counted).toEqual({ n: 5, samples: 8, cells: 1480 }); // n_done and n_cells over all five studies
  });

  it("DOWNLOADABLE_SQL is the one definition, so studies in search = studies counted", async () => {
    const db = createTestD1(SCHEMA);
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM gse_meta m WHERE ${DOWNLOADABLE_SQL}`).first<{ n: number }>();
    expect(r!.n).toBe(2);
  });
});

describe("accountFor", () => {
  it("clamps a part that would go negative instead of reporting nonsense", () => {
    const a = accountFor({
      studiesTracked: 5, studiesWithSamples: 6, published: 4, downloadable: 2, withheld: 2, awaitingIndex: 0,
      advertised: 10, ingested: 12, failed: 1, done: 9, qcRows: 11, usableAll: 5, unusable: 6, usableDownloadable: 5,
    });
    expect(a.studies_without_samples).toBe(0);
    expect(a.samples_not_ingested).toBe(0);
    expect(a.done_not_in_files).toBe(0);
    expect(a.in_files_usable_withheld).toBe(0);
  });
});
