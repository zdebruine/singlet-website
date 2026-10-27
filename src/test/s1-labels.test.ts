// @vitest-environment node
// The .s1 per-cell labels as catalog facts: the cell index build's sample_cell_summary.csv -> SQL files (scripts/s1/labels-sql.ts)
// -> sample_attr (sex_genetic, ancestry_genetic, cell_type) and study_label; then search filters and facets on them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLabelSqlFiles, parseSummaryCsv, termsFromDirectory } from "../../scripts/s1/labels-sql";
import { labelFactsSql, normalizeLabelValues } from "../../functions/_shared/s1-labels";
import { buildSampleWhere, buildStudyWhere, emptyFilters, type SearchFilters } from "../../functions/_shared/search-core";
import { sampleFacetStatements, studyFacetStatements } from "../../functions/_shared/facets-core";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA =
  ["030_search_facts.sql", "039_s1_labels.sql"].map((f) => readFileSync(`schema/${f}`, "utf8")).join("\n") +
  `
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT, cell_types_raw TEXT, year INTEGER,
  n_usable_cells INTEGER, n_usable_samples INTEGER, n_lowqc_cells INTEGER, has_bundle INTEGER, n_conditions INTEGER);
CREATE TABLE bundle_manifest (gse_id TEXT PRIMARY KEY, reference_build TEXT, n_gsms_in_bundle INTEGER);
CREATE TABLE gse (id TEXT PRIMARY KEY, r2_bundle_bytes INTEGER, pubmed_ids TEXT);
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, status TEXT, organism_primary TEXT, tissue_group TEXT, disease_group TEXT, assay_family TEXT, cell_type TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, usable INTEGER, qc_tier INTEGER, n_cells_called INTEGER);
`;

const HEAD = "gsm_id,gse_id,subject,item,n_cells,n_hi1,n_hi2,q50,q90,mean,version";
const V = "celllabels-0.3;guide-2026.10";
const CSV = [
  HEAD,
  // GSM1 (GSE1): female, European, T cells (CD4 and CD8, rolled up to T cell) and some B cells
  `GSM1,GSE1,sex,PATO:0000383,980,970,950,0.99,1.0,0.98,${V}`,
  `GSM1,GSE1,sex,PATO:0000384,20,5,1,0.6,0.8,0.6,${V}`,
  `GSM1,GSE1,ancestry,HANCESTRO:0005,1000,1000,1000,0.99,0.99,0.99,${V}`,
  `GSM1,GSE1,cell_type,CL:0000624,400,380,300,0.9,0.95,0.88,${V}`,
  `GSM1,GSE1,cell_type,CL:0000625,300,280,200,0.9,0.95,0.88,${V}`,
  `GSM1,GSE1,cell_type,CL:0000236,280,250,200,0.9,0.95,0.88,${V}`,
  `GSM1,GSE1,cell_type,CL:0000576,20,10,5,0.7,0.9,0.7,${V}`, // 2%: below the share threshold
  // GSM2 (GSE1): a pool of donors of both sexes, two ancestries
  `GSM2,GSE1,sex,PATO:0000383,500,490,480,0.99,1.0,0.98,${V}`,
  `GSM2,GSE1,sex,PATO:0000384,450,440,430,0.99,1.0,0.98,${V}`,
  `GSM2,GSE1,ancestry,HANCESTRO:0010,600,600,600,0.9,0.95,0.9,${V}`,
  `GSM2,GSE1,ancestry,HANCESTRO:0306,400,400,400,0.6,0.7,0.6,${V}`,
  // GSM3 (GSE2): too few sexed cells for a call; mouse cells (no ancestry)
  `GSM3,GSE2,sex,PATO:0000384,12,12,12,0.99,1.0,0.98,${V}`,
  `GSM3,GSE2,cell_type,CL:0000576,500,450,400,0.9,0.95,0.9,${V}`,
  // GSM4 (GSE2): not part of the atlas (alpha_exclusions): facts are written, the study roll-up leaves it out
  `GSM4,GSE2,sex,PATO:0000383,800,800,800,0.99,1.0,0.98,${V}`,
  // a per-cell feature row: not a label, skipped
  `GSM1,GSE1,feature,hallmark/hypoxia,1000,10,1,0.1,0.2,0.1,f-1`,
].join("\n");

// the index directory's dictionaries: the labeller's vocabulary with ontology ancestors (CL:0000000 "cell" is not a term)
const DIRECTORY = {
  dicts: {
    cell_type: [
      { code: 0, id: null, label: "unknown", anc: [] },
      { code: 1, id: "CL:0000084", label: "T cell", anc: ["CL:0000542", "CL:0000000"] },
      { code: 2, id: "CL:0000624", label: "CD4-positive, alpha-beta T cell", anc: ["CL:0000084", "CL:0000542", "CL:0000000"] },
      { code: 3, id: "CL:0000625", label: "CD8-positive, alpha-beta T cell", anc: ["CL:0000084", "CL:0000542", "CL:0000000"] },
      { code: 4, id: "CL:0000236", label: "B cell", anc: ["CL:0000542", "CL:0000000"] },
      { code: 5, id: "CL:0000542", label: "lymphocyte", anc: ["CL:0000000"] },
      { code: 6, id: "CL:0000576", label: "monocyte", anc: ["CL:0000000"] },
    ],
    ancestry: [
      { code: 0, id: null, label: "unknown", anc: [] },
      { code: 1, id: "HANCESTRO:0005", label: "European", anc: [] },
    ],
  },
};

async function loaded() {
  const db = createTestD1(SCHEMA);
  db.raw.exec(`INSERT INTO gse_meta (gse_id, year) VALUES ('GSE1', 2021), ('GSE2', 2022);
    INSERT INTO gsm (gsm_id, gse_id, status, organism_primary) VALUES ('GSM1', 'GSE1', 'DONE', 'Homo sapiens'), ('GSM2', 'GSE1', 'DONE', 'Homo sapiens'),
      ('GSM3', 'GSE2', 'DONE', 'Mus musculus'), ('GSM4', 'GSE2', 'DONE', 'Mus musculus');
    INSERT INTO alpha_exclusions (gsm_id, gse_id, reason, policy_version) VALUES ('GSM4', 'GSE2', 'strand', 't');`);
  const parsed = parseSummaryCsv(CSV);
  expect(parsed.rejected).toEqual([]);
  const plan = buildLabelSqlFiles(parsed.rows, DIRECTORY, { studiesPerFile: 1 });
  for (const f of plan.files) db.raw.exec(f.sql);
  return { db, plan, parsed };
}

const facts = (db: ReturnType<typeof createTestD1>, attr: string) =>
  db.raw.prepare(`SELECT gsm_id, value_norm, ontology_id, value_num, evidence FROM sample_attr WHERE source = 'pipeline' AND attr = ? ORDER BY gsm_id, value_norm`).all(attr) as {
    gsm_id: string;
    value_norm: string;
    ontology_id: string;
    value_num: number;
    evidence: string;
  }[];

describe("label facts from sample_cell_summary", () => {
  it("parses the cell index CSV, skips features, rejects bad lines", () => {
    const p = parseSummaryCsv(CSV);
    expect(p.rows).toHaveLength(14);
    expect(p.skipped).toBe(1);
    expect(parseSummaryCsv(`${HEAD}\nGSM1,GSE1,sex,female,1,,,,,,v`).rejected).toHaveLength(1); // sex must be a PATO id
    expect(parseSummaryCsv("gsm_id,gse_id\nGSM1,GSE1").rejected[0]).toMatch(/header/);
    const t = termsFromDirectory(DIRECTORY);
    expect(t.terms.map((x) => x.id)).toContain("HANCESTRO:0005");
    expect(t.closure).toContainEqual(["CL:0000624", "CL:0000084", 1]);
  });

  it("writes files in order, every statement under D1's 100 KB limit", async () => {
    const { plan } = await loaded();
    expect(plan.files.map((f) => f.name)).toEqual(["0_terms.sql", "1_summary_0000.sql", "2_facts_0000.sql", "1_summary_0001.sql", "2_facts_0001.sql"]);
    for (const f of plan.files) for (const st of f.sql.split(";\n")) expect(st.length).toBeLessThan(100_000);
    expect(plan.studies).toBe(2);
    expect(plan.samples).toBe(4);
  });

  it("sex: the sex held by most sexed cells; both for a mixed pool; none below 20 sexed cells", async () => {
    const { db } = await loaded();
    const sex = facts(db, "sex_genetic");
    expect(sex.map((r) => `${r.gsm_id}:${r.value_norm}`)).toEqual(["GSM1:female", "GSM2:female", "GSM2:male", "GSM4:female"]);
    expect(sex[0]).toMatchObject({ ontology_id: "PATO:0000383", value_num: 0.98, evidence: "980 of 1000 sexed cells" });
  });

  it("ancestry: HANCESTRO groups with their labels, each at >= 20% of the cells with a call", async () => {
    const { db } = await loaded();
    expect(facts(db, "ancestry_genetic").map((r) => `${r.gsm_id}:${r.value_norm}:${r.ontology_id}`)).toEqual([
      "GSM1:European:HANCESTRO:0005",
      "GSM2:African:HANCESTRO:0010",
      "GSM2:admixed ancestry:HANCESTRO:0306",
    ]);
  });

  it("cell type: calls roll up to every ancestor in the labeller's vocabulary, never to 'cell'; small shares are left out", async () => {
    const { db } = await loaded();
    const ct = facts(db, "cell_type").filter((r) => r.gsm_id === "GSM1");
    expect(ct.map((r) => r.value_norm).sort()).toEqual(["B cell", "CD4-positive, alpha-beta T cell", "CD8-positive, alpha-beta T cell", "T cell", "lymphocyte"]);
    expect(ct.find((r) => r.value_norm === "T cell")).toMatchObject({ ontology_id: "CL:0000084", value_num: 0.7 });
    expect(ct.find((r) => r.value_norm === "lymphocyte")!.value_num).toBe(0.98);
    expect(facts(db, "cell_type").some((r) => r.ontology_id === "CL:0000000")).toBe(false);
  });

  it("study_label rolls the served samples up; an excluded sample adds nothing", async () => {
    const { db } = await loaded();
    const sl = db.raw.prepare(`SELECT gse_id, attr, value, n_samples FROM study_label ORDER BY gse_id, attr, value`).all() as { gse_id: string; attr: string; value: string; n_samples: number }[];
    expect(sl.filter((r) => r.attr === "sex_genetic")).toEqual([
      { gse_id: "GSE1", attr: "sex_genetic", value: "female", n_samples: 2 },
      { gse_id: "GSE1", attr: "sex_genetic", value: "male", n_samples: 1 },
    ]);
    expect(sl.filter((r) => r.gse_id === "GSE2").map((r) => `${r.attr}:${r.value}`)).toEqual(["cell_type:monocyte"]);
  });

  it("is idempotent: loading the same files again changes nothing, and a reload replaces a study's facts", async () => {
    const { db, plan } = await loaded();
    const before = db.raw.prepare(`SELECT COUNT(*) AS n FROM sample_attr`).get() as { n: number };
    for (const f of plan.files) db.raw.exec(f.sql);
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM sample_attr`).get()).toEqual(before);
    db.raw.exec(`DELETE FROM sample_cell_summary WHERE gsm_id = 'GSM2' AND subject = 'sex' AND item = 'PATO:0000384'`);
    for (const st of labelFactsSql(["GSE1"])) db.raw.exec(st);
    expect(facts(db, "sex_genetic").filter((r) => r.gsm_id === "GSM2").map((r) => r.value_norm)).toEqual(["female"]);
  });

  it("refuses a statement over anything but GSE accessions", () => {
    expect(() => labelFactsSql(["GSE1'; DROP TABLE gsm; --"])).toThrow(/not a GSE/);
    expect(() => labelFactsSql([])).toThrow();
  });
});

/** Each facet statement run on its own (the test D1's batch returns no rows). */
async function runAll(db: ReturnType<typeof createTestD1>, statements: { sql: string; params: (string | number)[] }[]) {
  const out: { facet: string; value: string | null; n: number }[] = [];
  for (const s of statements) out.push(...((await db.prepare(s.sql).bind(...s.params).all()).results as typeof out));
  return out;
}

describe("search and facets on the labels", () => {
  const filters = (over: Partial<SearchFilters>): SearchFilters => ({ ...emptyFilters(), ...over });
  async function studies(db: ReturnType<typeof createTestD1>, f: SearchFilters) {
    const w = buildStudyWhere(f);
    return (db.raw.prepare(`SELECT m.gse_id FROM gse_meta m WHERE ${w.clauses.join(" AND ") || "1"} ORDER BY m.gse_id`).all(...w.params) as { gse_id: string }[]).map((r) => r.gse_id);
  }
  async function samples(db: ReturnType<typeof createTestD1>, f: SearchFilters) {
    const w = buildSampleWhere(f);
    return (db.raw.prepare(`SELECT s.gsm_id FROM gsm s LEFT JOIN gse_meta m ON m.gse_id = s.gse_id WHERE ${w.clauses.join(" AND ")} ORDER BY s.gsm_id`).all(...w.params) as { gsm_id: string }[]).map((r) => r.gsm_id);
  }

  it("filters studies and samples by labelled cell type (label or CL id, subtypes included), sex and ancestry", async () => {
    const { db } = await loaded();
    expect(await studies(db, filters({ cell_type_label: normalizeLabelValues(["T Cell"]) }))).toEqual(["GSE1"]);
    expect(await studies(db, filters({ cell_type_label: normalizeLabelValues(["cl:0000576"]) }))).toEqual(["GSE2"]);
    expect(await studies(db, filters({ sex_genetic: ["male"] }))).toEqual(["GSE1"]);
    expect(await studies(db, filters({ ancestry_genetic: normalizeLabelValues(["european"]) }))).toEqual(["GSE1"]);
    expect(await studies(db, filters({ sex_genetic: ["female"], cell_type_label: ["monocyte"] }))).toEqual([]);
    expect(await samples(db, filters({ sex_genetic: ["male"] }))).toEqual(["GSM2"]);
    expect(await samples(db, filters({ ancestry_genetic: normalizeLabelValues(["HANCESTRO:0010"]) }))).toEqual(["GSM2"]);
    // GSM4 is not part of the atlas: never listed, whatever its facts say
    expect(await samples(db, filters({ sex_genetic: ["female"] }))).toEqual(["GSM1", "GSM2"]);
  });

  it("counts label facets for studies and samples, each respecting the other filters", async () => {
    const { db } = await loaded();
    const rows = await runAll(db, studyFacetStatements(filters({ cell_type_label: ["t cell"] }), null));
    const of = (facet: string) => rows.filter((r) => r.facet === facet).map((r) => `${r.value}=${r.n}`).sort();
    expect(of("sex_genetic")).toEqual(["female=1", "male=1"]);
    expect(of("cell_type_label")).toContain("monocyte=1"); // its own filter is left out of its own counts
    const srows = await runAll(db, sampleFacetStatements(filters({}), null, null));
    expect(srows.filter((r) => r.facet === "sex_genetic").map((r) => `${r.value}=${r.n}`).sort()).toEqual(["female=2", "male=1"]);
    expect(studyFacetStatements(filters({}), null).every((s) => s.terms <= 4)).toBe(true);
    expect(studyFacetStatements(filters({}), null, { labels: false }).some((s) => s.sql.includes("study_label"))).toBe(false);
  });
});
