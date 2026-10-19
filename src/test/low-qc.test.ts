// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { qcReasons, qcStatus, qcTier, qcTierSql } from "../../functions/_shared/qc-rules";
import { downloadableSql, parseSearchParams, planStudyQuery } from "../../functions/_shared/search-core";
import { computeStats } from "../../functions/_shared/stats-core";
import { createTestD1 } from "./helpers/d1-sqlite";

describe("qcTier", () => {
  it("removes failed runs: almost no reads mapped and almost no genes", () => {
    expect(qcTier(0, 0)).toBe(2);
    expect(qcTier(9, 0.049)).toBe(2);
    expect(qcTier(3, 0.02)).toBe(2);
  });
  it("flags low QC on either signal, but not both extremes", () => {
    expect(qcTier(10, 0.049)).toBe(1); // genes at the removal limit
    expect(qcTier(9, 0.05)).toBe(1); // mapping at the removal limit
    expect(qcTier(29, 0.9)).toBe(1); // few genes only
    expect(qcTier(800, 0.19)).toBe(1); // poor mapping only
    expect(qcTier(5, 0.5)).toBe(1);
  });
  it("passes everything else and never judges a sample with no measurements", () => {
    expect(qcTier(30, 0.2)).toBe(0);
    expect(qcTier(725, 0.82)).toBe(0);
    expect(qcTier(null, null)).toBe(0);
    expect(qcTier(undefined, 0.9)).toBe(0);
    expect(qcTier(500, null)).toBe(0);
    expect(qcTier(null, 0.01)).toBe(1); // poor mapping is still a signal on its own
  });
  it("labels the tiers and explains a flag", () => {
    expect(qcStatus(500, 0.8)).toBe("ok");
    expect(qcStatus(12, 0.8)).toBe("low_qc");
    expect(qcStatus(2, 0.01)).toBe("removed");
    expect(qcReasons(12, 0.15)).toEqual(["median 12 genes per cell (below 30)", "15.0% of reads mapped (below 20%)"]);
    expect(qcReasons(500, 0.8)).toEqual([]);
  });
});

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

-- A: two good samples, one low QC, one removed.  B: only low QC.  C: only a removed sample.  D: all good.
INSERT INTO gse (id, n_gsm_total, n_gsm_failed, r2_bundle_key) VALUES ('GSEA', 4, 0, 'k'), ('GSEB', 2, 0, 'k'), ('GSEC', 1, 0, 'k'), ('GSED', 2, 0, 'k');
-- before the backfill every study counts all of its usable samples, as production did
INSERT INTO gse_meta (gse_id, n_done, n_total, n_cells, has_bundle, reference_mismatch, n_usable_samples, n_usable_cells) VALUES
  ('GSEA', 4, 4, 1000, 1, 0, 4, 1000), ('GSEB', 2, 2, 400, 1, 0, 2, 400), ('GSEC', 1, 1, 90, 1, 0, 1, 90), ('GSED', 2, 2, 300, 1, 0, 2, 300);
INSERT INTO bundle_manifest VALUES ('GSEA', 4, 'GRCh38'), ('GSEB', 2, 'GRCh38'), ('GSEC', 1, 'GRCh38'), ('GSED', 2, 'GRCh38');
INSERT INTO sample_qc (gsm_id, gse_id, usable, n_cells_called, median_genes, mapping_rate) VALUES
  ('A1', 'GSEA', 1, 100, 700, 0.8), ('A2', 'GSEA', 1, 200, 900, 0.85), ('A3', 'GSEA', 1, 300, 12, 0.7), ('A4', 'GSEA', 1, 400, 0, 0.01),
  ('B1', 'GSEB', 1, 150, 20, 0.5), ('B2', 'GSEB', 1, 250, 800, 0.1),
  ('C1', 'GSEC', 1, 90, 2, 0.02),
  ('D1', 'GSED', 1, 120, 500, 0.9), ('D2', 'GSED', 1, 180, 650, 0.8);
INSERT INTO gsm (gsm_id, gse_id, status, n_cells) VALUES ('A1','GSEA','DONE',100),('A2','GSEA','DONE',200),('A3','GSEA','DONE',300),('A4','GSEA','DONE',400),
  ('B1','GSEB','DONE',150),('B2','GSEB','DONE',250),('C1','GSEC','DONE',90),('D1','GSED','DONE',120),('D2','GSED','DONE',180);
`;

/** The backfill statements of schema/022, without the ALTERs (the test schema already has the columns). */
function backfill(): string {
  const sql = readFileSync("schema/022_low_qc.sql", "utf8").replace(/--.*$/gm, "");
  return sql.split(";").map((s) => s.trim()).filter((s) => s && !/^ALTER TABLE/i.test(s)).join(";\n") + ";";
}

function seeded() {
  const db = createTestD1(SCHEMA);
  db.exec(backfill());
  return db;
}

describe("schema/022_low_qc.sql", () => {
  it("tiers every sample exactly as qc-rules.ts does", async () => {
    const db = seeded();
    const rows = (await db.prepare("SELECT gsm_id, qc_tier, median_genes, mapping_rate FROM sample_qc ORDER BY gsm_id").all<{ gsm_id: string; qc_tier: number; median_genes: number; mapping_rate: number }>()).results;
    expect(rows.map((r) => [r.gsm_id, r.qc_tier])).toEqual([["A1", 0], ["A2", 0], ["A3", 1], ["A4", 2], ["B1", 1], ["B2", 1], ["C1", 2], ["D1", 0], ["D2", 0]]);
    for (const r of rows) expect(r.qc_tier).toBe(qcTier(r.median_genes, r.mapping_rate));
  });

  it("the SQL rule and the TypeScript rule agree on a grid of values", async () => {
    const db = createTestD1(`CREATE TABLE q (median_genes REAL, mapping_rate REAL);`);
    const genes = [0, 5, 9, 10, 11, 29, 30, 31, 500, null];
    const maps = [0, 0.02, 0.049, 0.05, 0.19, 0.2, 0.21, 0.8, null];
    for (const g of genes) for (const m of maps) await db.prepare("INSERT INTO q VALUES (?, ?)").bind(g, m).run();
    const rows = (await db.prepare(`SELECT median_genes AS g, mapping_rate AS m, ${qcTierSql("q")} AS t FROM q`).all<{ g: number | null; m: number | null; t: number }>()).results;
    expect(rows).toHaveLength(genes.length * maps.length);
    for (const r of rows) expect(r.t, `genes=${r.g} map=${r.m}`).toBe(qcTier(r.g, r.m));
  });

  it("counts only samples that passed QC in n_usable_*, and keeps the low-QC ones apart", async () => {
    const db = seeded();
    const m = (await db.prepare("SELECT gse_id, n_usable_samples AS good, n_usable_cells AS cells, n_lowqc_samples AS low, n_lowqc_cells AS lowcells FROM gse_meta ORDER BY gse_id").all<Record<string, number | string>>()).results;
    expect(m).toEqual([
      { gse_id: "GSEA", good: 2, cells: 300, low: 1, lowcells: 300 },
      { gse_id: "GSEB", good: 0, cells: 0, low: 2, lowcells: 400 },
      { gse_id: "GSEC", good: 0, cells: 0, low: 0, lowcells: 0 },
      { gse_id: "GSED", good: 2, cells: 300, low: 0, lowcells: 0 },
    ]);
  });

  it("is safe to run twice", async () => {
    const db = seeded();
    db.exec(backfill());
    const r = await db.prepare("SELECT SUM(n_usable_samples) AS g, SUM(n_lowqc_samples) AS l FROM gse_meta").first<{ g: number; l: number }>();
    expect(r).toEqual({ g: 4, l: 3 });
  });
});

describe("default search and opt-in", () => {
  const total = async (db: ReturnType<typeof seeded>, qs = "") => {
    const plan = planStudyQuery(parseSearchParams(new URL(`https://singlet.bio/api/search${qs}`)));
    const c = await db.prepare(plan.countSql).bind(...plan.countParams).first<{ n: number; samples: number; cells: number }>();
    const page = await db.prepare(plan.sql).bind(...plan.params).all<{ gse_id: string }>();
    return { counted: c, ids: page.results.map((r) => r.gse_id).sort() };
  };

  it("leaves studies with no sample that passed QC out of the default search", async () => {
    const r = await total(seeded());
    expect(r.ids).toEqual(["GSEA", "GSED"]);
    expect(r.counted).toEqual({ n: 2, samples: 4, cells: 600 });
  });

  it("adds low-QC samples and the studies that only have them when asked, never removed ones", async () => {
    const r = await total(seeded(), "?include_low_qc=1");
    expect(r.ids).toEqual(["GSEA", "GSEB", "GSED"]); // GSEC has only a removed sample
    expect(r.counted).toEqual({ n: 3, samples: 7, cells: 1300 });
  });

  it("DOWNLOADABLE_SQL has a default and an opt-in form", async () => {
    const db = seeded();
    const n = async (sql: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM gse_meta m WHERE ${sql}`).first<{ n: number }>())!.n;
    expect(await n(downloadableSql(false))).toBe(2);
    expect(await n(downloadableSql(true))).toBe(3);
  });

  it("the headline counts and the QC summary add up", async () => {
    const s = (await computeStats(seeded()))!;
    expect(s.samples_in_files).toBe(4); // A1, A2, D1, D2
    expect(s.cells_in_files).toBe(600);
    expect(s.qc).toMatchObject({ removed_samples: 2, low_qc_samples: 3, low_qc_cells: 700, studies_affected: 3 });
    const a = s.accounting;
    expect(a.in_files_removed).toBe(2);
    expect(a.in_files_low_qc).toBe(3);
    expect(a.in_files_unusable + a.in_files_removed + a.in_files_low_qc + a.in_files_usable_withheld + a.in_files_usable_downloadable).toBe(a.done_in_files);
  });
});
