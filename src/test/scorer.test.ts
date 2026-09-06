/**
 * Pins the ranked-search scorer against a small hand-written candidate set.
 *
 * Stage 11c regression guard: a residual keyword (e.g. "aging") must never
 * hide a study whose samples are annotated with the asked-for cell type, and
 * each of the four reference queries must keep at least one "matches
 * everything" study.
 */
import { describe, expect, it } from "vitest";
import { scoreStudy, type SoftSignals, type StudyRow } from "../../functions/_shared/search-core";

type Seed = {
  id: string;
  organisms: string[];
  tissue: string[];
  disease: string[];
  assay: string[];
  n_total: number;
  /** cell type -> number of samples annotated with it */
  cells?: Record<string, number>;
  /** keyword -> where it appears */
  text?: Record<string, Array<"title" | "abstract" | "characteristics">>;
};

const emptySignals = (): SoftSignals => ({
  organism: [],
  tissue_group: [],
  disease_group: [],
  assay_family: [],
  cell_type: [],
  q: [],
});

function row(seed: Seed): StudyRow {
  const r: StudyRow = {
    gse_id: seed.id,
    title: seed.id,
    abstract: null,
    organism_primary: seed.organisms[0] ?? null,
    organism_label: seed.organisms[0] ?? "",
    organisms: seed.organisms,
    tissue_groups: seed.tissue,
    disease_groups: seed.disease,
    assay_families: seed.assay,
    tissues_raw: [],
    cell_types_raw: [],
    n_done: seed.n_total,
    n_total: seed.n_total,
    n_failed: 0,
    n_cells: 10_000,
    suspect_cells: false,
    has_bundle: true,
    bundle_bytes: 1000,
    bundle_key: null,
    bundle_n_samples: seed.n_total,
    file_cells: 10_000,
    reference_build: null,
    year: 2023,
    n_conditions: 0,
    conditions: [],
    conditions_label: "",
    match: { filters: [], text: [], facets: [], keywords: [], score: 0 },
    why: "",
    score: null,
  };
  for (const [ct, n] of Object.entries(seed.cells ?? {})) {
    r.match.filters.push({ field: "cell_type", value: ct, n_samples: n });
  }
  for (const [term, fields] of Object.entries(seed.text ?? {})) {
    for (const field of fields) {
      r.match.text.push({ field, term, n_samples: field === "characteristics" ? seed.n_total : 0 });
    }
  }
  return r;
}

const MOUSE = ["Mus musculus"];
const HUMAN = ["Homo sapiens"];

const FIXTURE: Seed[] = [
  { id: "GSE296768", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 12, cells: { microglia: 12 }, text: { aging: ["title", "characteristics"] } },
  { id: "GSE307686", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 15, cells: { microglia: 9 }, text: { aging: ["characteristics"] } },
  { id: "GSE100001", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Alzheimer's disease"], assay: ["10x 3'"], n_total: 8, cells: { microglia: 4 } },
  { id: "GSE100002", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 6, text: { microglia: ["abstract"], aging: ["title"] } },
  { id: "GSE100003", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["Smart-seq / plate-based"], n_total: 20 },
  { id: "GSE100004", organisms: HUMAN, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 9, cells: { microglia: 9 }, text: { aging: ["abstract"] } },
  { id: "GSE100005", organisms: MOUSE, tissue: ["Lung / airway"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 4, cells: { microglia: 1 } },
  { id: "GSE100006", organisms: HUMAN, tissue: ["Blood / PBMC"], disease: ["COVID-19"], assay: ["10x 5'"], n_total: 24, cells: { "t cell": 20 }, text: { pbmc: ["title", "characteristics"] } },
  { id: "GSE100007", organisms: HUMAN, tissue: ["Blood / PBMC"], disease: ["COVID-19"], assay: ["10x 5'"], n_total: 12, text: { pbmc: ["abstract"] } },
  { id: "GSE100008", organisms: HUMAN, tissue: ["Blood / PBMC"], disease: ["COVID-19"], assay: ["10x 3'"], n_total: 10, text: { pbmc: ["title"] } },
  { id: "GSE100009", organisms: HUMAN, tissue: ["Blood / PBMC"], disease: ["Healthy / control"], assay: ["10x 5'"], n_total: 30, text: { pbmc: ["title"] } },
  { id: "GSE100010", organisms: HUMAN, tissue: ["Tumor (site unspecified)"], disease: ["Cancer"], assay: ["10x 5'"], n_total: 18, cells: { "t cell": 14 }, text: { melanoma: ["title", "characteristics"] } },
  { id: "GSE100011", organisms: HUMAN, tissue: ["Skin"], disease: ["Cancer"], assay: ["10x 3'"], n_total: 11, cells: { "t cell": 5 }, text: { melanoma: ["abstract"] } },
  { id: "GSE100012", organisms: HUMAN, tissue: ["Skin"], disease: ["Cancer"], assay: ["10x 3'"], n_total: 7, text: { melanoma: ["title"] } },
  { id: "GSE100013", organisms: HUMAN, tissue: ["Skin"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 5 },
  { id: "GSE100014", organisms: MOUSE, tissue: ["Bone marrow"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 13 },
  { id: "GSE100015", organisms: HUMAN, tissue: ["Liver"], disease: ["Cancer"], assay: ["10x 3'"], n_total: 16, cells: { "t cell": 3 } },
  { id: "GSE100016", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Parkinson's disease"], assay: ["10x 3'"], n_total: 14, cells: { microglia: 2 }, text: { aging: ["abstract"] } },
  { id: "GSE100017", organisms: HUMAN, tissue: ["Lung / airway"], disease: ["COVID-19"], assay: ["10x 5'"], n_total: 22, text: { pbmc: ["abstract"] } },
  { id: "GSE100018", organisms: MOUSE, tissue: ["Brain / CNS"], disease: ["Healthy / control"], assay: ["10x 3'"], n_total: 10, cells: { microglia: 10 } },
];

function run(signals: Partial<SoftSignals>) {
  const s = { ...emptySignals(), ...signals };
  const scored = FIXTURE.map(row).map((r) => ({ r, ...scoreStudy(r, s) }));
  scored.sort((a, b) => Number(b.full) - Number(a.full) || b.score - a.score);
  return {
    all: scored,
    full: scored.filter((x) => x.full).map((x) => x.r.gse_id),
    first: scored[0]?.r.gse_id,
  };
}

describe("ranked-search scorer", () => {
  it("microglia alone keeps every annotated study as a full match", () => {
    const { full } = run({ cell_type: ["microglia"] });
    expect(full).toContain("GSE296768");
    expect(full).toContain("GSE307686");
    expect(full.length).toBeGreaterThanOrEqual(7);
  });

  it("microglia in the aging mouse brain ranks the annotated studies first", () => {
    const res = run({
      organism: ["Mus musculus"],
      tissue_group: ["Brain / CNS"],
      cell_type: ["microglia"],
      q: ["aging"],
    });
    expect(res.full).toContain("GSE296768");
    expect(res.full).toContain("GSE307686");
    expect(res.first).toBe("GSE296768");
    // A fraction of samples must never demote a study out of "matches everything".
    const g307686 = res.all.find((x) => x.r.gse_id === "GSE307686")!;
    const ct = g307686.r.match.facets.find((f) => f.key === "cell_type")!;
    expect(ct.status).toBe("hit");
    expect(ct.detail).toBe("9 of 15 samples");
  });

  it("human PBMC, COVID-19, 10x 5' has full matches", () => {
    const { full } = run({
      organism: ["Homo sapiens"],
      tissue_group: ["Blood / PBMC"],
      disease_group: ["COVID-19"],
      assay_family: ["10x 5'"],
      q: ["pbmc"],
    });
    expect(full.length).toBeGreaterThan(0);
    expect(full).toContain("GSE100006");
  });

  it("tumor-infiltrating T cells in melanoma has full matches", () => {
    const { full } = run({
      organism: ["Homo sapiens"],
      disease_group: ["Cancer"],
      cell_type: ["t cell"],
      q: ["melanoma"],
    });
    expect(full.length).toBeGreaterThan(0);
    expect(full).toContain("GSE100010");
  });
});
