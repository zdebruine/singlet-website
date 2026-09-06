/**
 * Integration test for the ranked candidate query (Stage 11c/11d).
 *
 * It runs the real SQL from `rankedCandidateIds` against an in-memory SQLite
 * database (node:sqlite, FTS5 enabled) holding the catalog schema: ten hand
 * written studies plus 260 filler studies whose only virtue is a big cell
 * count. The filler exists to push past the 200-row candidate cap: without
 * evidence ordering, the studies the query is actually about fall off the end.
 */
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { rankedCandidateIds } from "../../functions/_shared/search-core";
import type { SearchParams, SoftSignals } from "../../functions/_shared/search-core";

// ── Minimal D1 adapter over node:sqlite ────────────────────────────────────
function makeD1(db: DatabaseSync) {
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const bound: unknown[] = [];
      const api = {
        bind(...args: unknown[]) {
          bound.length = 0;
          bound.push(...args);
          return api;
        },
        async all<T>() {
          return { results: stmt.all(...(bound as never[])) as T[], success: true };
        },
        async first<T>() {
          return (stmt.get(...(bound as never[])) as T) ?? null;
        },
        async run() {
          stmt.run(...(bound as never[]));
          return { success: true };
        },
      };
      return api;
    },
  } as unknown as D1Database;
}

interface Fixture {
  gse: string;
  title: string;
  abstract: string;
  organism: string;
  tissues: string[];
  diseases: string[];
  assays: string[];
  cells: number;
  sampleCellType?: string;
  characteristics?: string;
}

const FIXTURES: Fixture[] = [
  { gse: "GSE000001", title: "Microglia in the aging mouse brain", abstract: "Single-cell profiling of microglia across the mouse lifespan.", organism: "Mus musculus", tissues: ["Brain / CNS"], diseases: ["Healthy / control"], assays: ["10x 3'"], cells: 40_000, sampleCellType: "microglia", characteristics: "age: 24 months ;; cell type: microglia" },
  { gse: "GSE000002", title: "Aged murine cortex atlas", abstract: "Cortical cell types in aged mice.", organism: "Mus musculus", tissues: ["Brain / CNS"], diseases: [], assays: ["10x 3'"], cells: 20_000, sampleCellType: "microglia", characteristics: "aging cortex ;; cell type: microglia" },
  { gse: "GSE000003", title: "Human PBMC in COVID-19", abstract: "SARS-CoV-2 infected donors, 5' gene expression with VDJ.", organism: "Homo sapiens", tissues: ["Blood / PBMC"], diseases: ["COVID-19"], assays: ["10x 5'"], cells: 90_000, sampleCellType: "t cell" },
  { gse: "GSE000004", title: "Tumor-infiltrating T cells in melanoma", abstract: "TILs from metastatic melanoma lesions.", organism: "Homo sapiens", tissues: ["Tumor (site unspecified)"], diseases: ["Cancer"], assays: ["10x 5'"], cells: 60_000, sampleCellType: "cd8 t cell", characteristics: "tissue: tumor ;; cell type: CD8 T cell" },
  { gse: "GSE000005", title: "Melanoma TIL expansion in blood", abstract: "Tumour infiltrating lymphocytes tracked in peripheral blood.", organism: "Homo sapiens", tissues: ["Blood / PBMC"], diseases: ["Cancer"], assays: ["10x 5'"], cells: 30_000, sampleCellType: "t cell" },
  { gse: "GSE000006", title: "Kidney organoid development", abstract: "Directed differentiation time course.", organism: "Homo sapiens", tissues: ["Organoid"], diseases: [], assays: ["10x 3'"], cells: 15_000 },
  { gse: "GSE000007", title: "Mouse liver regeneration", abstract: "Hepatocyte responses after injury.", organism: "Mus musculus", tissues: ["Liver"], diseases: ["Injury / transplant / aging"], assays: ["10x 3'"], cells: 12_000, sampleCellType: "hepatocyte" },
  { gse: "GSE000008", title: "Zebrafish retina atlas", abstract: "Retinal cell types.", organism: "Danio rerio", tissues: ["Eye"], diseases: [], assays: ["Drop-seq / inDrop"], cells: 9_000 },
  { gse: "GSE000009", title: "Human lung fibrosis", abstract: "Alveolar niches in IPF.", organism: "Homo sapiens", tissues: ["Lung / airway"], diseases: ["Other / unspecified"], assays: ["10x 3'"], cells: 50_000 },
  { gse: "GSE000010", title: "Microglia response to demyelination", abstract: "Mouse spinal cord microglia after injury.", organism: "Mus musculus", tissues: ["Brain / CNS"], diseases: ["Injury / transplant / aging"], assays: ["10x 3'"], cells: 8_000, sampleCellType: "microglia" },
];

function buildDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("scripts/dev-api/schema.sql", "utf8"));

  const meta = db.prepare(
    `INSERT INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
       tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year, updated_at)
     VALUES (?,?,?,?,?,?,'[]','[]',0,?,?,?,1,2023,'2026-01-01T00:00:00Z')`
  );
  const gse = db.prepare(`INSERT INTO gse (id, title, abstract, organism, n_gsm_total, n_gsm_done, n_cells) VALUES (?,?,?,?,?,?,?)`);
  const ftsGse = db.prepare(`INSERT INTO fts_gse (id, title, abstract, organism) VALUES (?,?,?,?)`);
  const ftsGsm = db.prepare(
    `INSERT INTO fts_gsm (gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics) VALUES (?,?,?,?,?,?,?,?,?)`
  );

  FIXTURES.forEach((f, i) => {
    meta.run(f.gse, f.organism, JSON.stringify([f.organism]), JSON.stringify(f.tissues), JSON.stringify(f.diseases), JSON.stringify(f.assays), 4, 4, f.cells);
    gse.run(f.gse, f.title, f.abstract, f.organism, 4, 4, f.cells);
    ftsGse.run(f.gse, f.title, f.abstract, f.organism);
    ftsGsm.run(`GSM${900000 + i}`, f.gse, f.title, "GEO", f.tissues[0] ?? "", f.sampleCellType ?? "", f.organism, f.diseases[0] ?? "", f.characteristics ?? "");
  });

  // 260 filler studies: huge cell counts, no relation to any test query.
  for (let i = 0; i < 260; i++) {
    const id = `GSE1${String(i).padStart(5, "0")}`;
    meta.run(id, "Homo sapiens", '["Homo sapiens"]', '["Blood / PBMC"]', '["Healthy / control"]', '["10x 3\'"]', 10, 10, 5_000_000 + i);
    gse.run(id, `Reference blood atlas ${i}`, "Healthy donor peripheral blood.", "Homo sapiens", 10, 10, 5_000_000 + i);
    ftsGse.run(id, `Reference blood atlas ${i}`, "Healthy donor peripheral blood.", "Homo sapiens");
    ftsGsm.run(`GSM7${String(i).padStart(5, "0")}`, id, `Reference blood atlas ${i}`, "GEO", "blood", "monocyte", "Homo sapiens", "healthy", "tissue: blood");
  }
  return makeD1(db);
}

function params(): SearchParams {
  return {
    q: "", level: "gse", page: 1, limit: 25, sort: "relevance",
    organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [],
    match_mode: {}, min_cells: null, year_min: null, year_max: null, has_bundle: false,
    min_file_samples: null, min_file_cells: null, max_file_bytes: null,
    has_pubmed: null, has_conditions: null,
  } as unknown as SearchParams;
}

function signals(over: Partial<SoftSignals>): SoftSignals {
  return { organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [], q: [], ...over };
}

describe("ranked candidate set", () => {
  const db = buildDb();

  it("keeps cell-type evidence ahead of the 200-row cap", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({
      organism: ["Mus musculus"], tissue_group: ["Brain / CNS"], cell_type: ["microglia"], q: ["aging"],
    }));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("GSE000001");
    expect(ids).toContain("GSE000002");
    expect(ids.indexOf("GSE000001")).toBeLessThan(200);
  });

  it("is never restricted by a residual keyword alone", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({ cell_type: ["microglia"], q: ["aging"] }));
    expect(ids).toContain("GSE000010"); // microglia study without the word "aging"
  });

  it("finds melanoma TIL studies regardless of tissue annotation", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({
      disease_group: ["Cancer"], cell_type: ["t cell"], q: ["melanoma", "tumor-infiltrating"],
    }));
    expect(ids).toContain("GSE000004");
    expect(ids).toContain("GSE000005");
  });

  it("matches COVID-19 5' PBMC studies", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({
      organism: ["Homo sapiens"], tissue_group: ["Blood / PBMC"], disease_group: ["COVID-19"], assay_family: ["10x 5'"],
    }));
    expect(ids).toContain("GSE000003");
  });

  it("returns nothing when there is no soft evidence at all", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({}));
    expect(ids).toEqual([]);
  });

  it("caps the candidate set at 200 rows", async () => {
    const ids = await rankedCandidateIds(db, params(), signals({ tissue_group: ["Blood / PBMC"] }));
    expect(ids.length).toBe(200);
  });
});
