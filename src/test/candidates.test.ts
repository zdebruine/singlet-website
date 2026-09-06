/**
 * Integration test for candidate generation (the SQL half of ranked search).
 *
 * The scorer unit test cannot catch a regression here: if `rankedCandidateIds`
 * drops a study before scoring, the scorer never sees it. This test runs the
 * real query path against an in-memory SQLite database that mirrors the D1
 * catalog schema (gse_meta + fts_gse + fts_gsm), with a fixture of ten studies.
 */
/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runStudySearch, type Ctx, type SearchParams, type SoftSignals } from "../../functions/_shared/search-core";

type Row = Record<string, unknown>;

/** Adapts node:sqlite to the tiny slice of D1Database the search path uses. */
function makeDb(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    let params: unknown[] = [];
    const stmt = {
      bind(...p: unknown[]) {
        params = p.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v ?? null));
        return stmt;
      },
      async all<T = Row>() {
        const results = sqlite.prepare(sql).all(...(params as never[])) as T[];
        return { results, success: true, meta: {} } as unknown as D1Result<T>;
      },
      async first<T = Row>(col?: string) {
        const row = sqlite.prepare(sql).get(...(params as never[])) as Row | undefined;
        if (!row) return null;
        return (col ? (row[col] as T) : (row as unknown as T)) ?? null;
      },
      async run<T = Row>() {
        sqlite.prepare(sql).run(...(params as never[]));
        return { results: [] as T[], success: true, meta: {} } as unknown as D1Result<T>;
      },
      async raw<T = unknown[]>() {
        return sqlite.prepare(sql).all(...(params as never[])).map((r) => Object.values(r as Row)) as T[];
      },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const out: D1Result<T>[] = [];
      for (const s of statements) out.push((await s.all()) as D1Result<T>);
      return out;
    },
    async exec(sql: string) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    withSession() {
      throw new Error("not implemented");
    },
    dump() {
      throw new Error("not implemented");
    },
  } as unknown as D1Database;
}

interface Fixture {
  id: string;
  title: string;
  abstract: string;
  organism: string;
  tissues: string[];
  diseases: string[];
  assays: string[];
  cell_types: string[];
  characteristics: string;
  n_cells: number;
}

const FIXTURES: Fixture[] = [
  {
    id: "GSE900001",
    title: "Single-cell profiling of the mouse brain",
    abstract: "We profiled cortical cells across the lifespan.",
    organism: "Mus musculus",
    tissues: ["Brain / CNS"],
    diseases: ["Healthy / control"],
    assays: ["10x 3'"],
    cell_types: ["microglia", "astrocyte"],
    characteristics: "age: 24 months ;; condition: aging",
    n_cells: 42000,
  },
  {
    id: "GSE900002",
    title: "Human PBMC atlas in COVID-19",
    abstract: "Peripheral blood mononuclear cells from SARS-CoV-2 patients.",
    organism: "Homo sapiens",
    tissues: ["Blood / PBMC"],
    diseases: ["COVID-19"],
    assays: ["10x 5'"],
    cell_types: ["T cell", "monocyte"],
    characteristics: "disease: COVID-19",
    n_cells: 310000,
  },
  {
    id: "GSE900003",
    title: "Tumor-infiltrating lymphocytes in melanoma",
    abstract: "CD8 T cells from metastatic melanoma biopsies.",
    organism: "Homo sapiens",
    tissues: ["Tumor (site unspecified)"],
    diseases: ["Cancer"],
    assays: ["10x 5'"],
    cell_types: ["T cell"],
    characteristics: "tissue: melanoma",
    n_cells: 88000,
  },
  {
    id: "GSE900004",
    title: "Mouse lung development",
    abstract: "Alveolar cell types across postnatal development.",
    organism: "Mus musculus",
    tissues: ["Lung / airway"],
    diseases: ["Healthy / control"],
    assays: ["10x 3'"],
    cell_types: ["epithelial cell"],
    characteristics: "age: p7",
    n_cells: 51000,
  },
  {
    id: "GSE900005",
    title: "Huge human kidney reference",
    abstract: "A very large reference of the human kidney.",
    organism: "Homo sapiens",
    tissues: ["Kidney / urinary"],
    diseases: ["Healthy / control"],
    assays: ["10x 3'"],
    cell_types: ["podocyte"],
    characteristics: "tissue: kidney",
    n_cells: 2000000,
  },
  {
    id: "GSE900006",
    title: "Mouse hippocampus after injury",
    abstract: "Glial responses in the injured hippocampus.",
    organism: "Mus musculus",
    tissues: ["Brain / CNS"],
    diseases: ["Injury / transplant / aging"],
    assays: ["10x 3'"],
    cell_types: ["astrocyte", "oligodendrocyte"],
    characteristics: "condition: injury",
    n_cells: 33000,
  },
  {
    id: "GSE900007",
    title: "Zebrafish retina atlas",
    abstract: "Cell types of the zebrafish retina.",
    organism: "Danio rerio",
    tissues: ["Eye"],
    diseases: ["Healthy / control"],
    assays: ["Drop-seq / inDrop"],
    cell_types: ["photoreceptor"],
    characteristics: "tissue: retina",
    n_cells: 12000,
  },
  {
    id: "GSE900008",
    title: "Aged mouse bone marrow",
    abstract: "Hematopoiesis in aging mice.",
    organism: "Mus musculus",
    tissues: ["Bone marrow"],
    diseases: ["Injury / transplant / aging"],
    assays: ["10x 3'"],
    cell_types: ["HSC"],
    characteristics: "age: 22 months ;; condition: aging",
    n_cells: 64000,
  },
  {
    id: "GSE900009",
    title: "Human cortical organoids",
    abstract: "Neural differentiation in organoids.",
    organism: "Homo sapiens",
    tissues: ["Organoid"],
    diseases: ["Healthy / control"],
    assays: ["10x 3'"],
    cell_types: ["neuron"],
    characteristics: "tissue: organoid",
    n_cells: 27000,
  },
  {
    id: "GSE900010",
    title: "Rat liver regeneration",
    abstract: "Hepatocyte states after partial hepatectomy.",
    organism: "Rattus norvegicus",
    tissues: ["Liver"],
    diseases: ["Injury / transplant / aging"],
    assays: ["10x 3'"],
    cell_types: ["hepatocyte"],
    characteristics: "tissue: liver",
    n_cells: 19000,
  },
];

/**
 * Bulk filler: large mouse brain studies that match the interpreted facets but
 * carry none of the query's evidence. They exist so the fixture crosses the
 * 200-row candidate cap — the regression this test guards against was the cap
 * dropping the evidence-bearing study in favour of these.
 */
const FILLER: Fixture[] = Array.from({ length: 260 }, (_, i) => ({
  id: `GSE91${String(i).padStart(4, "0")}`,
  title: `Large mouse cortex survey ${i}`,
  abstract: "A large survey of cortical neurons.",
  organism: "Mus musculus",
  tissues: ["Brain / CNS"],
  diseases: ["Healthy / control"],
  assays: ["10x 3'"],
  cell_types: ["neuron"],
  characteristics: "tissue: cortex",
  n_cells: 1_000_000 + i,
}));

function seed(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(__dirname, "../../scripts/dev-api/schema.sql"), "utf8"));
  for (const f of [...FIXTURES, ...FILLER]) {
    sqlite.prepare(
      `INSERT INTO gse (id, title, abstract, organism, n_gsm_total, n_gsm_done, n_cells, r2_bundle_key, r2_bundle_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.id, f.title, f.abstract, f.organism, f.cell_types.length, f.cell_types.length, f.n_cells, `data/${f.id}/${f.id}.singlet`, 1000);
    sqlite.prepare(
      `INSERT INTO gse_meta (gse_id, organism_primary, organisms, tissue_groups, disease_groups, assay_families,
        tissues_raw, cell_types_raw, n_conditions, n_done, n_total, n_cells, has_bundle, year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, 2024)`
    ).run(
      f.id, f.organism, JSON.stringify([f.organism]), JSON.stringify(f.tissues), JSON.stringify(f.diseases),
      JSON.stringify(f.assays), JSON.stringify(f.tissues), JSON.stringify(f.cell_types),
      f.cell_types.length, f.cell_types.length, f.n_cells,
    );
    sqlite.prepare(`INSERT INTO fts_gse (id, title, abstract, organism) VALUES (?, ?, ?, ?)`).run(f.id, f.title, f.abstract, f.organism);
    f.cell_types.forEach((ct, i) => {
      const gsm = `${f.id.replace("GSE", "GSM")}${i + 1}`;
      sqlite.prepare(
        `INSERT INTO gsm (gsm_id, gse_id, organism, organism_primary, protocol, assay_family, tissue, tissue_group,
          cell_type, disease, disease_group, n_cells, status, title, source, characteristics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DONE', ?, ?, ?)`
      ).run(gsm, f.id, f.organism, f.organism, f.assays[0], f.assays[0], f.tissues[0], f.tissues[0], ct,
        f.diseases[0], f.diseases[0], Math.round(f.n_cells / f.cell_types.length), f.title, f.tissues[0], f.characteristics);
      sqlite.prepare(
        `INSERT INTO fts_gsm (gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(gsm, f.id, f.title, f.tissues[0], f.tissues[0], ct, f.organism, f.diseases[0], f.characteristics);
    });
  }
  return makeDb(sqlite);
}

const params = (q: string): SearchParams => ({
  q,
  organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [],
  min_cells: null, has_bundle: null, year_min: null, year_max: null,
  min_file_samples: null, min_file_cells: null, reference_build: [], protocol: [],
  has_pubmed: null, max_file_bytes: null, has_conditions: null, match_mode: {},
  level: "gse", sort: "relevance", page: 1, limit: 25, format: "json",
});

const soft = (s: Partial<SoftSignals>): SoftSignals => ({
  organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [], q: [], ...s,
});

const ctx = (): Ctx => ({ db: seed(), rules: [], waitUntil: () => undefined });

describe("ranked candidate generation", () => {
  it("returns the sample-annotated microglia study in full for 'microglia in the aging mouse brain'", async () => {
    const result = await runStudySearch(ctx(), params("microglia in the aging mouse brain"), {
      soft: soft({ organism: ["Mus musculus"], tissue_group: ["Brain / CNS"], cell_type: ["microglia"], q: ["aging"] }),
    });
    const hit = result.data.find((r) => r.gse_id === "GSE900001");
    expect(hit, "the microglia / aging / mouse brain study must be a candidate").toBeTruthy();
    expect(result.groups?.full ?? 0).toBeGreaterThan(0);
    expect(result.data.filter((r) => r.match.score >= (hit?.match.score ?? 0))[0]?.gse_id).toBe("GSE900001");
  });

  it("a residual keyword that matches nothing never restricts the candidate set", async () => {
    const result = await runStudySearch(ctx(), params("microglia in the aging mouse brain xyzzyunmatchedword"), {
      soft: soft({ organism: ["Mus musculus"], tissue_group: ["Brain / CNS"], cell_type: ["microglia"], q: ["xyzzyunmatchedword"] }),
    });
    expect(result.data.some((r) => r.gse_id === "GSE900001")).toBe(true);
    expect(result.total).toBeGreaterThan(1);
  });

  it("finds a cell-type study through sample annotations alone", async () => {
    const result = await runStudySearch(ctx(), params("microglia"), { soft: soft({ cell_type: ["microglia"] }) });
    expect(result.data.some((r) => r.gse_id === "GSE900001")).toBe(true);
  });
});
