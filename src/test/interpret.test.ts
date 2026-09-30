import { describe, expect, it } from "vitest";
import { emptyInterpreted, mergeReadings, parseQuery, validateModelReading, type Interpreted } from "../../functions/_shared/interpret";
import { extractJsonObject, parseAiResult } from "../../functions/_shared/ai";
import type { VocabRule } from "../../functions/_shared/vocab";

/**
 * A slice of the production `vocab_rules` table (same groups, patterns and
 * relative priorities), enough to pin the query-safe policy: organism only from
 * species words, tissue only from anatomy, a disease never implies a site, and
 * aging / perturbations stay keywords.
 */
const RAW: [VocabRule["field"], string, string, VocabRule["match_type"]?][] = [
  // tissue
  ["tissue", "Multiple / mixed", "all", "exact"],
  ["tissue", "Organoid", "organoid"],
  ["tissue", "Bone marrow", "bone marrow"],
  ["tissue", "Bone marrow", "marrow"],
  ["tissue", "Blood / PBMC", "pbmc"],
  ["tissue", "Blood / PBMC", "blood"],
  ["tissue", "Immune cells (sorted)", "t cell"],
  ["tissue", "Brain / CNS", "brain"],
  ["tissue", "Brain / CNS", "cortex"],
  ["tissue", "Brain / CNS", "prefrontal"],
  ["tissue", "Brain / CNS", "glioma"],
  ["tissue", "Brain / CNS", "neuron"],
  ["tissue", "Brain / CNS", "microglia"],
  ["tissue", "Lung / airway", "lung"],
  ["tissue", "Gut / intestine", "colon"],
  ["tissue", "Gut / intestine", "gut"],
  ["tissue", "Skin", "skin"],
  ["tissue", "Skin", "melanocyte"],
  ["tissue", "Muscle / bone / joint", "bone"],
  ["tissue", "Tumor (site unspecified)", "tumor"],
  ["tissue", "Tumor (site unspecified)", "melanoma"],
  ["tissue", "Brain / CNS", "hippocamp"],
  ["tissue", "Lymphoid organs", "lymph"],
  ["tissue", "Heart / vascular", "heart"],
  ["tissue", "Liver", "hepat"],
  ["tissue", "Kidney / urinary", "kidney"],
  // disease
  ["disease", "Healthy / control", "healthy", "exact"],
  ["disease", "Healthy / control", "control", "exact"],
  ["disease", "COVID-19", "covid"],
  ["disease", "Alzheimer's disease", "ad", "exact"],
  ["disease", "Alzheimer's disease", "alzheimer"],
  ["disease", "Cancer", "aml", "exact"],
  ["disease", "Cancer", "all", "exact"],
  ["disease", "Cancer", "cancer"],
  ["disease", "Cancer", "tumor"],
  ["disease", "Cancer", "melanoma"],
  ["disease", "Cancer", "glioma"],
  ["disease", "Autoimmune / inflammatory", "fibrosis"],
  ["disease", "Autoimmune / inflammatory", "pulmonary fibrosis"],
  ["disease", "Genetic / developmental", "knockout"],
  ["disease", "Injury / transplant / aging", "aging"],
  ["disease", "Other / unspecified", "disease"],
  ["disease", "Other / unspecified", "patient"],
  ["disease", "Cancer", "lymphoma"],
  ["disease", "Other infection", "hepatitis"],
  ["disease", "Other neurological / psychiatric", "stress"], // dev seed only
  // protocol
  ["protocol", "10x 3'", "10xv3", "exact"],
  ["protocol", "10x (version unconfirmed)", "10x", "exact"],
  ["protocol", "Smart-seq / plate-based", "smartseq2", "exact"],
  ["protocol", "10x 5'", "5p"],
  ["protocol", "10x 3'", "10xv"],
  ["protocol", "10x (version unconfirmed)", "10x"],
  ["protocol", "Smart-seq / plate-based", "plate"],
  ["protocol", "Smart-seq / plate-based", "smart"],
  // dev seed (scripts/dev-api/seed.ts) contains-patterns; production spells these as exact values
  ["protocol", "10x Multiome / ATAC", "multiome"],
  ["protocol", "Drop-seq / inDrop", "drop"],
  ["protocol", "CITE-seq", "cite"],
  ["protocol", "Parse / SPLiT-seq", "parse"],
];
const RULES: VocabRule[] = RAW.map(([field, grp, pattern, match_type], i) => ({
  field,
  priority: i + 1,
  grp,
  match_type: match_type ?? "contains",
  pattern,
}));
const VOCAB = { rules: RULES, cellTypes: ["microglia", "t cells", "cd4+ t cells", "pbmc", "brain", "whole tissue"] };
const parse = (q: string) => parseQuery(q, VOCAB, 2026);

describe("parseQuery (vocabulary only)", () => {
  it("reads the pinned microglia example exactly", () => {
    const r = parse("microglia in the aging mouse brain");
    expect(r.interpreted.organism).toEqual(["Mus musculus"]);
    expect(r.interpreted.tissue_group).toEqual(["Brain / CNS"]);
    expect(r.interpreted.cell_type).toEqual(["microglia"]);
    expect(r.interpreted.disease_group).toEqual([]);
    expect(r.interpreted.q).toEqual(["aging"]);
    expect(r.ambiguous).toBe(false);
  });

  it("never infers a tissue from a disease (melanoma is not Skin)", () => {
    const r = parse("tumor-infiltrating T cells in melanoma");
    expect(r.interpreted.tissue_group).toEqual([]);
    expect(r.interpreted.disease_group).toEqual(["Cancer"]);
    expect(r.interpreted.cell_type).toEqual(["t cell"]);
    expect(r.interpreted.organism).toEqual([]);
    expect(r.interpreted.q).toEqual(["tumor-infiltrating", "melanoma"]);
    expect(r.ambiguous).toBe(false);
  });

  it("reads organism, tissue, disease and a stated chemistry", () => {
    const r = parse("human PBMC COVID-19 10x 5'");
    expect(r.interpreted.organism).toEqual(["Homo sapiens"]);
    expect(r.interpreted.tissue_group).toEqual(["Blood / PBMC"]);
    expect(r.interpreted.disease_group).toEqual(["COVID-19"]);
    expect(r.interpreted.assay_family).toEqual(["10x 5'"]);
    expect(r.interpreted.q).toEqual([]);
  });

  it("keeps specific disease names as keywords and never guesses a bare 10x chemistry", () => {
    const r = parse("AML bone marrow 10x");
    expect(r.interpreted.disease_group).toEqual(["Cancer"]);
    expect(r.interpreted.tissue_group).toEqual(["Bone marrow"]);
    expect(r.interpreted.assay_family).toEqual([]);
    expect(r.interpreted.q).toEqual(["AML"]);
  });

  it("reads cell counts and years literally; perturbations stay keywords", () => {
    const r = parse("FOXP3 knockout regulatory T cells with at least 20k cells since 2022");
    expect(r.interpreted.min_cells).toBe(20000);
    expect(r.interpreted.year_min).toBe(2022);
    expect(r.interpreted.year_max).toBeNull();
    expect(r.interpreted.cell_type).toEqual(["regulatory t cell"]);
    expect(r.interpreted.disease_group).toEqual([]);
    expect(r.interpreted.q).toEqual(["FOXP3", "knockout"]);
  });

  it("reads year ranges and open bounds", () => {
    expect(parse("lung 2019-2022").interpreted).toMatchObject({ year_min: 2019, year_max: 2022 });
    expect(parse("lung between 2018 and 2020").interpreted).toMatchObject({ year_min: 2018, year_max: 2020 });
    expect(parse("lung before 2020").interpreted).toMatchObject({ year_min: null, year_max: 2019 });
    expect(parse("lung 100k+ cells").interpreted.min_cells).toBe(100000);
  });

  it("takes a species only from explicit species words", () => {
    const r = parse("Alzheimer's disease prefrontal cortex");
    expect(r.interpreted.organism).toEqual([]);
    expect(r.interpreted.disease_group).toEqual(["Alzheimer's disease"]);
    expect(r.interpreted.tissue_group).toEqual(["Brain / CNS"]);
    expect(r.interpreted.q).toEqual([]);
  });

  it("only counts two-letter codes and ALL when typed in capitals", () => {
    expect(parse("all T cells in blood").interpreted.disease_group).toEqual([]);
    expect(parse("ALL bone marrow").interpreted.disease_group).toEqual(["Cancer"]);
    expect(parse("AD cortex").interpreted.disease_group).toEqual(["Alzheimer's disease"]);
  });

  it("lets a multi-word disease name its site", () => {
    const r = parse("pulmonary fibrosis lung");
    expect(r.interpreted.disease_group).toEqual(["Autoimmune / inflammatory"]);
    expect(r.interpreted.tissue_group).toEqual(["Lung / airway"]);
  });

  it("does not read a catalog tissue value as a cell type", () => {
    expect(parse("mouse brain").interpreted.cell_type).toEqual([]);
  });

  it("asks for a model only when several plain words are left over", () => {
    expect(parse("how does the gut microbiome shape early life immunity").ambiguous).toBe(true);
    expect(parse("Tabula Muris").ambiguous).toBe(false);
    expect(parse("Tabula Muris").interpreted.q).toEqual(["Tabula", "Muris"]);
  });

  it("keeps the words that follow an assay name", () => {
    expect(parse("10xv3 PBMC").interpreted).toMatchObject({ assay_family: ["10x 3'"], tissue_group: ["Blood / PBMC"] });
    expect(parse("10x v3 PBMC lung").interpreted).toMatchObject({
      assay_family: ["10x 3'"],
      tissue_group: ["Blood / PBMC", "Lung / airway"],
    });
    expect(parse("10xv3 hepatocytes in mouse").interpreted).toMatchObject({
      organism: ["Mus musculus"],
      assay_family: ["10x 3'"],
      cell_type: ["hepatocyte"],
      tissue_group: [],
      q: [],
    });
    expect(parse("Smart-seq2 hepatocytes in mouse").interpreted).toMatchObject({
      assay_family: ["Smart-seq / plate-based"],
      cell_type: ["hepatocyte"],
    });
    expect(parse("CITE-seq PBMC").interpreted).toMatchObject({ assay_family: ["CITE-seq"], tissue_group: ["Blood / PBMC"] });
    expect(parse("Multiome brain organoids").interpreted).toMatchObject({
      assay_family: ["10x Multiome / ATAC"],
      tissue_group: ["Brain / CNS", "Organoid"],
    });
    expect(parse("10x multiome of human heart").interpreted).toMatchObject({
      organism: ["Homo sapiens"],
      assay_family: ["10x Multiome / ATAC"],
      tissue_group: ["Heart / vascular"],
      q: [],
    });
  });

  it("reads assay names with versions but not ordinary words that start like one", () => {
    expect(parse("Drop-seq retina").interpreted.assay_family).toEqual(["Drop-seq / inDrop"]);
    expect(parse("10xv3.1 lung").interpreted.assay_family).toEqual(["10x 3'"]);
    expect(parse("Smart-seq 2 mouse cortex").interpreted.assay_family).toEqual(["Smart-seq / plate-based"]);
    expect(parse("droplet sequencing of mouse lung").interpreted.assay_family).toEqual([]);
    expect(parse("parsed tumor samples").interpreted.assay_family).toEqual([]);
    expect(parse("cited").interpreted.assay_family).toEqual([]);
  });

  it("ignores punctuation between facets", () => {
    expect(parse("human PBMC, COVID-19, 10x 5'").interpreted).toEqual(parse("human PBMC COVID-19 10x 5'").interpreted);
  });

  it("reads a single-nucleus query with a year bound", () => {
    const r = parse("snRNA-seq mouse kidney since 2021");
    expect(r.interpreted).toMatchObject({
      organism: ["Mus musculus"],
      tissue_group: ["Kidney / urinary"],
      year_min: 2021,
      year_max: null,
      q: ["snRNA-seq"],
    });
    expect(r.ambiguous).toBe(false);
  });

  it("keeps perturbations as keywords even when a disease rule names them", () => {
    const r = parse("stress response in zebrafish");
    expect(r.interpreted.organism).toEqual(["Danio rerio"]);
    expect(r.interpreted.disease_group).toEqual([]);
    expect(r.interpreted.q).toEqual(["stress", "response"]);
    const s = parse("chronic stress in mouse hippocampus");
    expect(s.interpreted.disease_group).toEqual([]);
    expect(s.interpreted.tissue_group).toEqual(["Brain / CNS"]);
    expect(s.interpreted.q).toEqual(["chronic", "stress"]);
  });
});

describe("model readings are validated and merged", () => {
  it("drops a species the query does not name and a tissue inferred from a disease", () => {
    const q = "tumor-infiltrating T cells in melanoma";
    const reading = validateModelReading(
      { organism: ["Homo sapiens"], tissue_group: ["Skin"], disease_group: ["Cancer"], cell_type: ["T cells"], min_cells: 0, year_min: 0, year_max: 0, q: ["melanoma", "study"] },
      q,
      RULES,
      2026,
    );
    expect(reading.organism).toEqual([]);
    expect(reading.tissue_group).toEqual([]);
    expect(reading.disease_group).toEqual(["Cancer"]);
    expect(reading.cell_type).toEqual(["t cell"]);
    expect(reading.min_cells).toBeNull();
    expect(reading.q).toEqual(["melanoma"]);
  });

  it("accepts a tissue the query points at through a cell type", () => {
    const reading = validateModelReading({ tissue_group: ["Brain / CNS"] }, "neurons grown as organoids", RULES, 2026);
    expect(reading.tissue_group).toEqual(["Brain / CNS"]);
  });

  it("keeps the parsed organism and the parse's strong keywords", () => {
    const parsed = parse("FOXP3 regulatory T cells in mice under chronic psychological stress conditions");
    const merged = mergeReadings(parsed, {
      organism: ["Homo sapiens"],
      tissue_group: [],
      disease_group: [],
      assay_family: [],
      cell_type: ["regulatory t cell"],
      min_cells: null,
      year_min: null,
      year_max: null,
      q: ["chronic stress"],
    });
    expect(merged.organism).toEqual(["Mus musculus"]);
    expect(merged.cell_type).toEqual(["regulatory t cell"]);
    expect(merged.disease_group).toEqual([]);
    expect(merged.q).toContain("chronic stress");
    expect(merged.q).toContain("FOXP3");
  });

  it("passes the prompt's pinned examples through unchanged", () => {
    const cases: [string, Partial<Interpreted>][] = [
      ["microglia in the aging mouse brain", { organism: ["Mus musculus"], tissue_group: ["Brain / CNS"], cell_type: ["microglia"], q: ["aging"] }],
      ["human PBMC COVID-19 10x 5'", { organism: ["Homo sapiens"], tissue_group: ["Blood / PBMC"], disease_group: ["COVID-19"], assay_family: ["10x 5'"] }],
      ["AML bone marrow 10x", { tissue_group: ["Bone marrow"], disease_group: ["Cancer"], q: ["AML"] }],
      ["tumor-infiltrating T cells in melanoma", { disease_group: ["Cancer"], cell_type: ["t cell"], q: ["tumor-infiltrating", "melanoma"] }],
      [
        "FOXP3 knockout regulatory T cells with at least 20k cells since 2022",
        { cell_type: ["regulatory t cell"], min_cells: 20000, year_min: 2022, q: ["FOXP3", "knockout"] },
      ],
    ];
    for (const [query, reading] of cases) {
      const expected: Interpreted = { ...emptyInterpreted(), ...reading };
      // The model answers 0 for "not set", as in the prompt.
      const reply = { ...expected, min_cells: expected.min_cells ?? 0, year_min: expected.year_min ?? 0, year_max: expected.year_max ?? 0 };
      expect(validateModelReading(reply, query, RULES, 2026)).toEqual(expected);
    }
  });

  it("accepts a species only when the query names it as a whole word", () => {
    const human = { organism: ["Homo sapiens"] };
    expect(validateModelReading(human, "humanized immune system engraftment hematopoietic reconstitution", RULES, 2026).organism).toEqual([]);
    expect(validateModelReading(human, "homozygous deletion hematopoietic reconstitution engraftment", RULES, 2026).organism).toEqual([]);
    expect(validateModelReading(human, "non-human primate retina ganglion degeneration", RULES, 2026).organism).toEqual([]);
    expect(validateModelReading(human, "Human cortex", RULES, 2026).organism).toEqual(["Homo sapiens"]);
    expect(validateModelReading({ organism: ["Mus musculus"] }, "microglia in mice", RULES, 2026).organism).toEqual(["Mus musculus"]);
    expect(validateModelReading({ organism: ["Danio rerio"] }, "stress response in zebrafish", RULES, 2026).organism).toEqual(["Danio rerio"]);
    expect(validateModelReading({ organism: ["Danio rerio"] }, "fin regeneration in Danio", RULES, 2026).organism).toEqual(["Danio rerio"]);
  });

  it("keeps a model's year bounds and cell count only when the query writes them", () => {
    const vague = validateModelReading(
      { year_min: 2023, min_cells: 100000 },
      "recent large atlases of developing human kidney nephron progenitor lineage",
      RULES,
      2026,
    );
    expect(vague.year_min).toBeNull();
    expect(vague.min_cells).toBeNull();
    expect(validateModelReading({ year_min: 2021 }, "snRNA-seq mouse kidney", RULES, 2026).year_min).toBeNull();
    expect(validateModelReading({ year_min: 2021 }, "snRNA-seq mouse kidney since 2021", RULES, 2026).year_min).toBe(2021);
    expect(validateModelReading({ year_min: 2022 }, "zebrafish fin regeneration from the past five years", RULES, 2026).year_min).toBe(2022);
    expect(validateModelReading({ min_cells: 50000 }, "lung atlases with 50k cells", RULES, 2026).min_cells).toBe(50000);
    expect(validateModelReading({ min_cells: 10 }, "10 cell types in lung", RULES, 2026).min_cells).toBeNull();
    expect(validateModelReading({ min_cells: 8 }, "CD8 T cells in lung", RULES, 2026).min_cells).toBeNull();
  });

  it("never takes a tissue from a disease word, even when a tissue rule maps it", () => {
    const withSkinMelanoma: VocabRule[] = [...RULES, { field: "tissue", priority: RULES.length + 1, grp: "Skin", match_type: "contains", pattern: "melanoma" }];
    const q = "tumor-infiltrating T cells in melanoma lesions from nonresponding individuals";
    const reading = validateModelReading({ tissue_group: ["Skin"], disease_group: ["Cancer"] }, q, withSkinMelanoma, 2026);
    expect(reading.tissue_group).toEqual([]);
    expect(reading.disease_group).toEqual(["Cancer"]);
    expect(validateModelReading({ tissue_group: ["Skin"] }, "melanoma skin biopsies", withSkinMelanoma, 2026).tissue_group).toEqual(["Skin"]);
    // "lymphoma" starts like the tissue pattern "lymph", "hepatitis" like "hepat".
    expect(validateModelReading({ tissue_group: ["Lymphoid organs"] }, "clonal B cells in follicular lymphoma relapse", RULES, 2026).tissue_group).toEqual([]);
    expect(validateModelReading({ tissue_group: ["Lymphoid organs"] }, "B cells in lymph nodes of lymphoma patients", RULES, 2026).tissue_group).toEqual([
      "Lymphoid organs",
    ]);
    expect(validateModelReading({ tissue_group: ["Liver"] }, "hepatitis B virus reactivation", RULES, 2026).tissue_group).toEqual([]);
  });
});

describe("model reply parsing", () => {
  it("accepts Workers AI objects, JSON strings, fenced text and OpenAI-style replies", () => {
    expect(parseAiResult({ response: { q: ["a"] } })).toEqual({ q: ["a"] });
    expect(parseAiResult({ response: '{"q":["b"]}' })).toEqual({ q: ["b"] });
    expect(parseAiResult({ response: 'Sure!\n```json\n{"q":["c"]}\n```' })).toEqual({ q: ["c"] });
    expect(parseAiResult({ choices: [{ message: { content: '{"q":["d"]}' } }] })).toEqual({ q: ["d"] });
  });

  it("finds the first balanced object, ignoring braces inside strings", () => {
    expect(extractJsonObject('noise {"a":"}{","b":{"c":1}} trailing {"x":2}')).toEqual({ a: "}{", b: { c: 1 } });
    expect(extractJsonObject("no json here")).toBeNull();
  });
});
