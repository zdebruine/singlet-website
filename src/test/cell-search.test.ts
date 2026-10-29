// @vitest-environment node
// Atlas-wide cell search (functions/_shared/cells): boolean filters over the cell index summary joined to the sample facts, ontology
// descendants, the natural-language reading, relaxations, the cell index pushdown and the vocabulary endpoint.
import { describe, expect, it } from "vitest";
import type { CellIndex } from "../../functions/_shared/cells/atlas-index";
import { hydrateFacts, ageYears, type FactsWire } from "../../functions/_shared/cells/sample-facts";
import { canonicalWhere, cellPushdown, filterCellRows, parseWhere, QueryError, relaxations, rowScanWhere, runCellQuery } from "../../functions/_shared/cells/query";
import { parseCellQuestion } from "../../functions/_shared/cells/nl";
import { cacheKey, fieldsBody, parseCellRequest, unmappedFor } from "../../functions/_shared/cells/http";
import { withCellLines } from "../../functions/_shared/cells/cell-lines";

const cellTypes = [
  { code: 0, id: null, label: "unknown", anc: [] },
  { code: 1, id: "CL:0000084", label: "T cell", anc: ["CL:0000542", "CL:0000738"] },
  { code: 2, id: "CL:0000625", label: "CD8-positive, alpha-beta T cell", anc: ["CL:0000084", "CL:0000542", "CL:0000738"] },
  { code: 3, id: "CL:0000236", label: "B cell", anc: ["CL:0000542", "CL:0000738"] },
  { code: 4, id: "CL:0000182", label: "hepatocyte", anc: [] },
];
// rows: [so, ct, sex, anc, cells]
const ROWS = [
  [1, 2, 1, 1, 100], // GSM1: CD8, female, African
  [1, 3, 2, 2, 50], //        B, male, European
  [1, 1, 1, 0, 30], //        T, female
  [2, 2, 2, 0, 40], // GSM2: CD8, male
  [2, 0, 0, 0, 10], //        unknown
  [3, 4, 1, 0, 200], // GSM3: hepatocyte, female
  [4, 2, 1, 0, 999], // GSM4: not served (absent from the facts)
  [5, 2, 1, 0, 7], // GSM5: low QC
];
const GSM = [0, 1, 2, 3, 4, 5];
const GSE = [0, 1, 1, 2, 3, 2];

function makeIndex(): CellIndex {
  const col = (k: number) => ROWS.map((r) => r[k]);
  return {
    version: "20261027T2236Z-00000000",
    created_at: null,
    cellTypes,
    sexes: [
      { code: 0, id: null, label: "unknown" },
      { code: 1, id: "PATO:0000383", label: "female" },
      { code: 2, id: "PATO:0000384", label: "male" },
      { code: 3, id: null, label: "ambiguous" },
    ],
    ancestries: [
      { code: 0, id: null, label: "unknown", anc: [] },
      { code: 1, id: "HANCESTRO:0010", label: "African", anc: [] },
      { code: 2, id: "HANCESTRO:0005", label: "European", anc: [] },
    ],
    organisms: [],
    terms: { "CL:0000084": "T cell", "CL:0000542": "lymphocyte", "CL:0000738": "leukocyte", "CL:0000625": "CD8-positive, alpha-beta T cell", "CL:0000236": "B cell", "CL:0000182": "hepatocyte" },
    n: ROWS.length,
    ct: Uint16Array.from(col(1)),
    sex: Uint8Array.from(col(2)),
    anc: Uint8Array.from(col(3)),
    so: Uint32Array.from(col(0)),
    cells: Uint32Array.from(col(4)),
    maxSo: 5,
    gsmOf: Uint32Array.from(GSM),
    gseOf: Uint32Array.from(GSE),
    umiQ50: new Uint32Array(6),
    genesQ50: new Uint32Array(6),
    soOfGsm: new Map(GSM.map((g, so) => [g, so])),
    plan: { block_size: 256, blocks: {} },
    load: { bytes: 0, requests: 0, ms: 0 },
  };
}

function makeFacts() {
  const wire: FactsWire = {
    v: 1,
    built_at: "2026-10-28T00:00:00Z",
    policy: "alpha-2026-10-27e",
    gsm: ["GSM1", "GSM2", "GSM3", "GSM5"],
    gse: ["GSE1", "GSE1", "GSE2", "GSE2"],
    vocab: { organism: ["Homo sapiens", "Mus musculus"], assay: ["10x 3'"], chemistry: ["10xv3"], tissue_group: ["Lung", "Liver"], disease_group: ["Cancer"] },
    organism: [0, 0, 1, 1],
    assay: [0, 0, 0, -1],
    chemistry: [0, 0, 0, 0],
    tissue_group: [0, 0, 1, 1],
    disease_group: [0, -1, -1, -1],
    qc_tier: [0, 0, 0, 1],
    called: [180, 50, 200, 7],
    umi: [3000, 2500, 1500, 300],
    genes: [1200, 1100, 900, 200],
    mito: [0.05, 0.04, 0.1, 0.3],
    mapping: [0.9, 0.9, 0.85, 0.4],
    age: [ageYears(60, "years"), ageYears(30, "years"), ageYears(8, "weeks"), null],
    year: [2021, 2021, 2023, 2023],
    pub: [1, 1, 0, 0],
    donor_status: [2, 1, 0, 0],
    sample_kind: [1, 1, 4, 0],
    tissue_type: [1, 1, 4, 0],
    tumor_sample_type: [2, 0, 0, 0],
    perturbation: [0, 4, 1, 0],
    terms: {
      tissue: { "UBERON:0002048": [0, 1], "UBERON:0002107": [2, 3] },
      disease: { "MONDO:0008903": [0], "PATO:0000461": [1] },
      development_stage: { "HsapDv:0000267": [0], "HsapDv:0000266": [1] },
      cell_line: { CVCL_0004: [2] },
    },
    ancestors: {
      "UBERON:0002048": ["UBERON:0000062"],
      "UBERON:0002107": ["UBERON:0000062"],
      "MONDO:0008903": ["MONDO:0004992", "MONDO:0005070"],
      "PATO:0000461": [],
      "HsapDv:0000267": ["HsapDv:0000258"],
      "HsapDv:0000266": ["HsapDv:0000258"],
      // CL closure from D1: an ancestor the labeller's own levels do not list
      "CL:0000236": ["CL:0000945"],
    },
    labels: {
      "UBERON:0002048": "lung",
      "UBERON:0002107": "liver",
      "UBERON:0000062": "organ",
      "MONDO:0008903": "lung cancer",
      "MONDO:0004992": "cancer",
      "MONDO:0005070": "neoplasm",
      "PATO:0000461": "normal",
      "HsapDv:0000258": "adult stage",
      "HsapDv:0000267": "middle aged stage",
      "HsapDv:0000266": "young adult stage",
      "CL:0000945": "lymphocyte of B lineage",
      CVCL_0004: "K-562",
    },
    synonyms: { lung: ["UBERON:0002048"], liver: ["UBERON:0002107"], "lung cancer": ["MONDO:0008903"], cancer: ["MONDO:0004992"], tumor: ["MONDO:0005070"], "t cell": ["CL:0000084"], "k 562": ["CVCL_0004"], k562: ["CVCL_0004"] },
  };
  return hydrateFacts(wire, 0, "edge");
}

const idx = makeIndex();
const facts = makeFacts();
const run = (where: unknown, include_low_qc = false) => runCellQuery({ where: parseWhere(where), include_low_qc, limit: 20, offset: 0 }, idx, facts);

describe("cell search: evaluation", () => {
  it("counts every served, QC-passed cell without a filter; low-QC samples only when asked; unserved samples never", () => {
    expect(run({}).totals).toMatchObject({ cells: 430, samples: 3, studies: 2 });
    expect(run({}, true).totals.cells).toBe(437);
  });

  it("matches a cell type and its descendants, and reports the descendant terms that contributed", () => {
    const r = run({ cell_type: "T cell" });
    expect(r.totals.cells).toBe(170);
    const f = r.filters[0];
    expect(f.values[0].ids).toEqual(["CL:0000084"]);
    expect(f.contributing.map((c) => [c.id, c.cells])).toEqual([
      ["CL:0000625", 140],
      ["CL:0000084", 30],
    ]);
    expect(run({ and: [{ field: "cell_type", any: ["CL:0000084"], exact: true }] }).totals.cells).toBe(30);
    expect(run({ cell_type: "lymphocyte" }).totals.cells).toBe(220);
    // an ancestor known only from the D1 closure
    expect(run({ cell_type: "lymphocyte of B lineage" }).totals.cells).toBe(50);
  });

  it("expands sample ontology terms through the closure (cancer finds lung cancer; adult finds its stages)", () => {
    const r = run({ disease: "cancer" });
    expect(r.totals.cells).toBe(180);
    expect(r.filters[0].contributing.map((c) => c.label)).toEqual(["lung cancer"]);
    expect(run({ development_stage: "adult" }).totals.cells).toBe(230);
    expect(run({ tissue: "organ" }).totals.cells).toBe(430);
  });

  it("combines with AND, OR and NOT across cell and sample fields", () => {
    expect(run({ or: [{ tissue: "liver" }, { cell_type: "B cell" }] }).totals.cells).toBe(250);
    expect(run({ not: { sex: "male" } }).totals.cells).toBe(340);
    expect(run({ cell_type: "CD8 T cell", not_sex: "male", tissue: "lung" }).totals.cells).toBe(100);
    expect(run({ and: [{ or: [{ sex: "female" }, { ancestry: "European" }] }, { not: { tissue: "liver" } }] }).totals.cells).toBe(180);
    expect(run({ ancestry: "African" }).totals.cells).toBe(100);
  });

  it("filters on numbers, enums, booleans and accessions", () => {
    expect(run({ age_years: [18, 65] }).totals.cells).toBe(230);
    expect(run({ age_years: "..1" }).totals.cells).toBe(200);
    expect(run({ organism: "mouse" }).totals.cells).toBe(200);
    expect(run({ donor_status: "healthy" }).totals.cells).toBe(50);
    expect(run({ perturbation: "control" }).totals.cells).toBe(50);
    expect(run({ has_publication: true }).totals.cells).toBe(230);
    expect(run({ study: "GSE2" }).totals.cells).toBe(200);
    expect(run({ mito_fraction: [null, 0.06] }).totals.cells).toBe(230);
  });

  it("breaks the answer down by every facet, per study and sample", () => {
    const r = run({ cell_type: "T cell" });
    expect(r.studies).toEqual([{ gse_id: "GSE1", cells: 170, samples: 2 }]);
    expect(r.facets.sex.map((x) => [x.label, x.cells])).toEqual([
      ["female", 130],
      ["male", 40],
    ]);
    expect(r.facets.tissue[0]).toMatchObject({ label: "lung", cells: 170, samples: 2 });
    expect(r.cell_type_lineage[0]).toMatchObject({ id: "CL:0000084", cells: 170 });
  });

  it("refuses unknown fields and values with a message", () => {
    expect(() => run({ colour: "blue" })).toThrow(QueryError);
    expect(() => run({ cell_type: "unicorn cell" })).toThrow(/unicorn cell/);
  });

  it("gives relaxations when nothing matches", () => {
    const where = parseWhere({ cell_type: "hepatocyte", tissue: "lung" });
    expect(runCellQuery({ where, include_low_qc: false, limit: 5, offset: 0 }, idx, facts).totals.cells).toBe(0);
    const rx = relaxations(where, false, idx, facts);
    expect(rx).toEqual(
      expect.arrayContaining([
        { filter: "cell_type=hepatocyte", alone: 200, without: 230 },
        { filter: "tissue=lung", alone: 230, without: 200 },
      ])
    );
  });
});

describe("cell search: sample type fields", () => {
  it("filters on CELLxGENE tissue_type, GDC tumour sample type and a Cellosaurus line by accession or name", () => {
    const line = run({ tissue_type: "cell line" });
    expect(line.totals.samples).toBe(1);
    expect(run({ cell_line: "CVCL_0004" }).totals).toEqual(line.totals);
    expect(run({ cell_line: "K-562" }).totals).toEqual(line.totals);
    expect(run({ cell_line: "cvcl_0004" }).totals).toEqual(line.totals);
    expect(run({ tumor_sample_type: "primary tumor" }).totals.samples).toBe(1);
    expect(run({ tissue_type: "tissue" }).totals.samples).toBe(2);
  });
});

describe("cell search: query forms", () => {
  it("reads the flat and the tree form to the same canonical filter", () => {
    const a = parseWhere({ cell_type: ["T cell"], sex: "female" });
    const b = parseWhere({ and: [{ field: "sex", any: ["female"] }, { field: "cell_type", any: ["T cell"] }] });
    expect(canonicalWhere(a)).toBe(canonicalWhere(b));
  });

  it("reads GET parameters: flat fields, not_, | and min..max", () => {
    const p = parseCellRequest(new URL("https://singlet.bio/api/cells?cell_type=T%20cell|B%20cell&not_sex=male&age_years=18..65&limit=5"), null);
    expect(p.query.limit).toBe(5);
    expect(run(JSON.parse(canonicalWhere(p.query.where))).totals.cells).toBeGreaterThan(0);
    expect(cacheKey(p)).toContain("w=");
  });

  it("pushes plain AND-ed cell filters down to the cell index, and not OR / NOT ones", () => {
    expect(cellPushdown(parseWhere({ cell_type: "T cell", sex: "female", tissue: "lung" }), idx, facts)).toEqual({ cell_type: ["CL:0000084"], sex: ["female"] });
    expect(cellPushdown(parseWhere({ or: [{ cell_type: "T cell" }, { sex: "female" }] }), idx, facts)).toBeNull();
    expect(cellPushdown(parseWhere({ not_cell_type: "T cell" }), idx, facts)).toBeNull();
    expect(rowScanWhere(parseWhere({ cell_type: "T cell", n_umi: "500.." }), idx, facts, ["GSM1"])).toEqual({ samples: ["GSM1"], cell_type: ["CL:0000084"], ranges: { n_umi: [500, null] } });
    expect(() => rowScanWhere(parseWhere({ or: [{ cell_type: "T cell" }, { n_umi: "500.." }] }), idx, facts, [])).toThrow(QueryError);
  });

  it("filters a page of cells itself when the index cannot (OR across cell fields)", () => {
    const keep = filterCellRows(parseWhere({ or: [{ cell_type: "B cell" }, { sex: "female" }] }), idx, facts, {
      gsm: ["GSM1", "GSM1", "GSM2", "GSM4"],
      cell_type: ["CL:0000236", "CL:0000625", "CL:0000625", "CL:0000625"],
      sex: ["male", "female", "male", "female"],
      ancestry: [null, null, null, null],
    });
    expect([...keep]).toEqual([0, 1]);
  });
});

describe("cell search: natural language", () => {
  it("reads a question into filters at their ontology terms", () => {
    const p = parseCellQuestion("female CD8 T cells from adult lung tumours", idx, facts);
    expect(p.readings.map((r) => [r.field, r.values])).toEqual([
      ["sex", ["female"]],
      ["cell_type", ["CL:0000625"]],
      ["development_stage", expect.arrayContaining(["HsapDv:0000258"])],
      ["tissue", ["UBERON:0002048"]],
      ["disease", ["MONDO:0005070"]],
    ]);
    expect(runCellQuery({ where: p.where, include_low_qc: false, limit: 5, offset: 0 }, idx, facts).totals.cells).toBe(100);
  });

  it("negates, ORs one field and leaves unknown words", () => {
    const p = parseCellQuestion("B cells or T cells not from liver in zorbland", idx, facts);
    expect(p.readings.map((r) => `${r.negated ? "not " : ""}${r.field}=${r.values.join("|")}`)).toEqual(["cell_type=CL:0000236|CL:0000084", "not tissue=UBERON:0002107"]);
    expect(p.unparsed).toEqual(["zorbland"]);
  });
});

describe("cell search: vocabulary", () => {
  it("lists every field with its coverage", () => {
    const b = fieldsBody({ idx, facts, ms: { index: 0, facts: 0 }, cold: { index: false, facts: "edge" } }) as { fields: { name: string; coverage: Record<string, number> | null }[] };
    const cov = Object.fromEntries(b.fields.map((f) => [f.name, f.coverage]));
    expect(cov.tissue).toMatchObject({ samples: 3, samples_share: 1 });
    expect(cov.disease).toMatchObject({ samples: 2, cells: 230 });
    expect(cov.ancestry).toMatchObject({ cells: 150 });
    expect(b.fields.map((f) => f.name)).toEqual(expect.arrayContaining(["cell_type", "sex", "ancestry", "tissue", "disease", "development_stage", "study", "year"]));
  });
});

describe("cell search: coverage gaps of the filters", () => {
  it("counts the served samples and cells a sample-level filter cannot see", () => {
    const u = unmappedFor(parseWhere({ cell_type: "T cell", disease: "cancer", tissue: "lung" }), false, idx, facts);
    // GSM3 (200 hepatocytes) has no disease term; every served sample has a tissue; cell_type is per cell (not listed)
    expect(u.map((x) => x.field).sort()).toEqual(["disease", "tissue"]);
    expect(u.find((x) => x.field === "disease")).toMatchObject({ samples: 1, cells: 200 });
    expect(u.find((x) => x.field === "tissue")).toMatchObject({ samples: 0, cells: 0 });
  });
  it("counts low-QC samples only when asked", () => {
    const u = unmappedFor(parseWhere({ disease: "cancer" }), true, idx, facts);
    expect(u[0]).toMatchObject({ field: "disease", samples: 2 });
  });
  it("is empty without sample-level filters", () => {
    expect(unmappedFor(parseWhere({ cell_type: "T cell", sex: "female" }), false, idx, facts)).toEqual([]);
    expect(unmappedFor(null, false, idx, facts)).toEqual([]);
  });
});

describe("cell lines carry their line as cell type", () => {
  // GSM3 is the K-562 sample of the fixture; the labeller called its 200 cells hepatocytes
  const lidx = withCellLines(makeIndex(), facts);
  const lrun = (where: unknown) => runCellQuery({ where: parseWhere(where), include_low_qc: false, limit: 20, offset: 0 }, lidx, facts);

  it("drops the labeller's type on a cell line and answers by the line's name, id or synonym", () => {
    expect(lrun({ cell_type: "hepatocyte" }).totals.cells).toBe(0);
    for (const v of ["K-562", "CVCL_0004", "k562", "cultured cell"]) expect(lrun({ cell_type: v }).totals.cells, v).toBe(200);
    expect(lrun({ cell_type: "T cell" }).totals.cells).toBe(run({ cell_type: "T cell" }).totals.cells);
    expect(lrun({ cell_type: "K-562" }).facets.cell_type.map((f) => f.label)).toEqual(["K-562"]);
  });

  it("filters a cell-line page here: the data Worker only has the labeller's types", () => {
    expect(cellPushdown(parseWhere({ cell_type: "K-562" }), lidx, facts)).toBeNull();
    expect(cellPushdown(parseWhere({ cell_type: "T cell" }), lidx, facts)).not.toBeNull();
    const keep = filterCellRows(parseWhere({ cell_type: "K-562" }), lidx, facts, {
      gsm: ["GSM3", "GSM3", "GSM1"],
      cell_type: ["CL:0000182", null, "CL:0000182"],
      sex: ["female", "female", "female"],
      ancestry: [null, null, null],
    });
    expect([...keep]).toEqual([0, 1]);
  });
});
