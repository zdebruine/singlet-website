import { describe, expect, it } from "vitest";
import { scoreStudy, type SoftSignals, type StudyRow, type TextMatch, type FilterMatch } from "../../functions/_shared/search-core";

interface Fixture {
  id: string;
  title: string;
  abstract?: string;
  organisms?: string[];
  tissue_groups?: string[];
  disease_groups?: string[];
  assay_families?: string[];
  n_total?: number;
  filters?: FilterMatch[];
  text?: TextMatch[];
}

function row(f: Fixture): StudyRow {
  return {
    gse_id: f.id,
    title: f.title,
    abstract: f.abstract ?? null,
    organism_primary: f.organisms?.[0] ?? null,
    organism_label: "",
    organisms: f.organisms ?? [],
    tissue_groups: f.tissue_groups ?? [],
    disease_groups: f.disease_groups ?? [],
    assay_families: f.assay_families ?? [],
    tissues_raw: [],
    cell_types_raw: [],
    n_done: f.n_total ?? 1,
    n_total: f.n_total ?? 1,
    n_failed: 0,
    n_cells: 1000,
    suspect_cells: false,
    has_bundle: true,
    bundle_bytes: 1,
    bundle_key: null,
    bundle_n_samples: f.n_total ?? 1,
    file_cells: null,
    reference_build: null,
    year: 2023,
    n_conditions: 0,
    conditions: [],
    conditions_label: "",
    match: { filters: f.filters ?? [], text: f.text ?? [], facets: [], keywords: [], score: 0 },
    why: "",
    score: null,
  };
}

const signals = (s: Partial<SoftSignals>): SoftSignals => ({
  organism: [], tissue_group: [], disease_group: [], assay_family: [], cell_type: [], q: [], ...s,
});

const MOUSE = ["Mus musculus"];
const HUMAN = ["Homo sapiens"];

/** 20 hand-written candidate rows covering the four pinned queries. */
const FIXTURE: Fixture[] = [
  { id: "GSE296768", title: "Microglia in the aging mouse brain", abstract: "Aging cortex microglia atlas.", organisms: MOUSE, tissue_groups: ["Brain / CNS"], assay_families: ["10x 3'"], n_total: 12,
    filters: [{ field: "cell_type", value: "microglia", n_samples: 12 }], text: [{ field: "title", term: "aging", n_samples: 0 }] },
  { id: "GSE307686", title: "Cortical microglia across the lifespan", abstract: "Samples span young and aged animals.", organisms: MOUSE, tissue_groups: ["Brain / CNS"], assay_families: ["10x 3'"], n_total: 15,
    filters: [{ field: "cell_type", value: "microglia", n_samples: 9 }], text: [{ field: "characteristics", term: "aging", n_samples: 9 }] },
  { id: "GSE100001", title: "Human cortex microglia", organisms: HUMAN, tissue_groups: ["Brain / CNS"], n_total: 4, filters: [{ field: "cell_type", value: "microglia", n_samples: 4 }] },
  { id: "GSE100002", title: "Mouse liver atlas", organisms: MOUSE, tissue_groups: ["Liver"], n_total: 3 },
  { id: "GSE100003", title: "Aging mouse kidney", organisms: MOUSE, tissue_groups: ["Kidney / urinary"], n_total: 3, text: [{ field: "title", term: "aging", n_samples: 0 }] },
  { id: "GSE100004", title: "Microglia mentioned only in the abstract", abstract: "We discuss microglia briefly.", organisms: MOUSE, tissue_groups: ["Brain / CNS"], n_total: 2, text: [{ field: "abstract", term: "microglia", n_samples: 0 }] },
  { id: "GSE200001", title: "PBMC from COVID-19 patients, 5' VDJ", abstract: "SARS-CoV-2 infected donors profiled with 10x 5' and VDJ.", organisms: HUMAN, tissue_groups: ["Blood / PBMC"], n_total: 8 },
  { id: "GSE200002", title: "COVID-19 PBMC atlas", organisms: HUMAN, tissue_groups: ["Blood / PBMC"], disease_groups: ["COVID-19"], assay_families: ["10x 5'"], n_total: 10 },
  { id: "GSE200003", title: "Peripheral blood in coronavirus disease", abstract: "Five prime libraries from convalescent donors.", organisms: HUMAN, tissue_groups: ["Blood / PBMC"], n_total: 6 },
  { id: "GSE200004", title: "Healthy PBMC baseline, 3' chemistry", organisms: HUMAN, tissue_groups: ["Blood / PBMC"], disease_groups: ["Healthy / control"], assay_families: ["10x 3'"], n_total: 5 },
  { id: "GSE300001", title: "Tumor-infiltrating T cells in melanoma", abstract: "Melanoma biopsies with sorted T cells.", organisms: HUMAN, tissue_groups: ["Tumor (site unspecified)"], n_total: 9,
    filters: [{ field: "cell_type", value: "t cell", n_samples: 9 }], text: [{ field: "title", term: "melanoma", n_samples: 0 }] },
  { id: "GSE300002", title: "Melanoma microenvironment", organisms: HUMAN, tissue_groups: ["Skin"], disease_groups: ["Cancer"], n_total: 7, filters: [{ field: "cell_type", value: "t cell", n_samples: 3 }], text: [{ field: "title", term: "melanoma", n_samples: 0 }] },
  { id: "GSE300003", title: "Lung adenocarcinoma immune atlas", organisms: HUMAN, tissue_groups: ["Lung / airway"], disease_groups: ["Cancer"], n_total: 6 },
  { id: "GSE300004", title: "Healthy skin fibroblasts", organisms: HUMAN, tissue_groups: ["Skin"], disease_groups: ["Healthy / control"], n_total: 4 },
  { id: "GSE400001", title: "Zebrafish retina development", organisms: ["Danio rerio"], tissue_groups: ["Eye"], n_total: 3 },
  { id: "GSE400002", title: "Mouse microglia in demyelination", organisms: MOUSE, tissue_groups: ["Brain / CNS"], n_total: 6, filters: [{ field: "cell_type", value: "microglia", n_samples: 2 }] },
  { id: "GSE400003", title: "Human bone marrow", organisms: HUMAN, tissue_groups: ["Bone marrow"], n_total: 5 },
  { id: "GSE400004", title: "Mouse embryo development", organisms: MOUSE, tissue_groups: ["Embryo / development"], n_total: 4 },
  { id: "GSE400005", title: "Microglia culture in vitro", organisms: MOUSE, tissue_groups: ["Cell line / in vitro"], n_total: 2, filters: [{ field: "cell_type", value: "microglia", n_samples: 2 }] },
  { id: "GSE400006", title: "Rat hippocampus aging", organisms: ["Rattus norvegicus"], tissue_groups: ["Brain / CNS"], n_total: 3, text: [{ field: "title", term: "aging", n_samples: 0 }] },
];

function run(s: SoftSignals) {
  return FIXTURE.map((f) => {
    const r = row(f);
    const { score, full } = scoreStudy(r, s);
    return { id: f.id, score, full, facets: r.match.facets };
  }).sort((a, b) => b.score - a.score);
}

describe("study scorer", () => {
  it("microglia in the aging mouse brain", () => {
    const out = run(signals({ organism: MOUSE, tissue_group: ["Brain / CNS"], cell_type: ["microglia"], q: ["aging"] }));
    const full = out.filter((x) => x.full).map((x) => x.id);
    expect(full).toContain("GSE296768");
    expect(full).toContain("GSE307686");
    expect(out[0].id).toBe("GSE296768");
    const g = out.find((x) => x.id === "GSE307686")!;
    expect(g.facets.find((f) => f.key === "cell_type")?.detail).toBe("9 of 15 samples");
  });

  it("microglia alone keeps every annotated study full", () => {
    const out = run(signals({ cell_type: ["microglia"] }));
    expect(out.filter((x) => x.full).length).toBeGreaterThanOrEqual(4);
  });

  it("human PBMC, COVID-19, 10x 5' finds text-only matches", () => {
    const out = run(signals({ organism: HUMAN, tissue_group: ["Blood / PBMC"], disease_group: ["COVID-19"], assay_family: ["10x 5'"] }));
    const full = out.filter((x) => x.full).map((x) => x.id);
    expect(full).toContain("GSE200002");
    expect(full).toContain("GSE200001");
    expect(full).not.toContain("GSE200004");
  });

  it("tumor-infiltrating T cells in melanoma finds text-only matches", () => {
    const out = run(signals({ organism: HUMAN, disease_group: ["Cancer"], cell_type: ["t cell"], q: ["melanoma"] }));
    const full = out.filter((x) => x.full).map((x) => x.id);
    expect(full.length).toBeGreaterThan(0);
    expect(full).toContain("GSE300001");
  });

  it("marks a contradicting annotation as a miss", () => {
    const out = run(signals({ organism: HUMAN, disease_group: ["COVID-19"] }));
    const healthy = out.find((x) => x.id === "GSE200004")!;
    expect(healthy.full).toBe(false);
    expect(healthy.facets.find((f) => f.key === "disease_group")?.detail).toContain("annotated as");
  });
});
