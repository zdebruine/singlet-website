// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalTermId, normLabel, termKey, termKeys } from "../../functions/_shared/ontology";
import { buildSampleWhere, buildStudyWhere, canonicalQuery, emptyFilters, hasAnyFilter, parseSearchParams, type SearchFilters } from "../../functions/_shared/search-core";
import { onRequestGet as termsGet } from "../../functions/api/ontology/terms";
import { parseObo } from "../../scripts/ontology/obo";
import { ALIASES } from "../../scripts/ontology/aliases";
import { ageRange, buildLabelIndex, LIFE_STAGE_TERMS, matchValue, placeInStage, stageIntervals, variants } from "../../scripts/ontology/map-core";
import { createTestD1 } from "./helpers/d1-sqlite";
import { sha256Hex } from "../../functions/_shared/hash";
import { onRequestPost as ingestPost } from "../../functions/api/ingest/[table]";
import { perturbationOf, propertiesOf, sampleKindOf } from "../../scripts/ontology/properties";

const OBO = `format-version: 1.2
data-version: test

[Term]
id: UBERON:0002048
name: lung
synonym: "pulmo" EXACT []
is_a: UBERON:0000062 ! organ

[Term]
id: UBERON:0008952
name: upper lobe of left lung
relationship: part_of UBERON:0002048 ! lung

[Term]
id: UBERON:0000062
name: organ

[Term]
id: UBERON:0000178
name: blood
synonym: "portion of blood" EXACT []

[Term]
id: UBERON:0001954
name: Ammon's horn
synonym: "hippocampus" RELATED []

[Term]
id: UBERON:0002421
name: hippocampal formation
synonym: "hippocampus" RELATED []

[Term]
id: UBERON:0000014
name: zone of skin
synonym: "skin" EXACT []

[Term]
id: UBERON:0009999
name: old lung term
is_obsolete: true

[Term]
id: CL:0000000
name: cell

[Term]
id: CL:0000084
name: T cell
synonym: "T-lymphocyte" EXACT []
is_a: CL:0000000 ! cell

[Term]
id: CL:0000624
name: CD4-positive, alpha-beta T cell
synonym: "CD4+ T cell" NARROW []
is_a: CL:0000084 ! T cell

[Term]
id: CL:0000576
name: monocyte
is_a: CL:0000000 ! cell

[Term]
id: MONDO:0005015
name: Cowden-like test disease
synonym: "CD" RELATED []

[Term]
id: HsapDv:0000258
name: adult stage
property_value: start_ypb "15.0" xsd:float

[Term]
id: HsapDv:0000240
name: sixth decade stage
relationship: part_of HsapDv:0000258 ! adult stage
property_value: end_ypb "60.0" xsd:float
property_value: start_ypb "50.0" xsd:float

[Term]
id: HsapDv:0000002
name: embryonic stage
property_value: end_dpf "56.0" xsd:float
property_value: start_dpf "0.0" xsd:float

[Term]
id: MmusDv:0000031
name: fetal stage
property_value: end_dpf "19.0" xsd:float
property_value: start_dpf "13.0" xsd:float

[Typedef]
id: part_of
name: part of
`;

const terms = parseObo(OBO);

describe("ontology helpers", () => {
  it("normalises labels and ids the same way the label table stores them", () => {
    expect(normLabel("CD4+ T-cells")).toBe("cd4 t cells");
    expect(normLabel("Crohn's disease")).toBe("crohns disease");
    expect(normLabel("Sjögren syndrome")).toBe("sjogren syndrome");
    expect(canonicalTermId("UBERON_0002048")).toBe("UBERON:0002048");
    expect(canonicalTermId("http://purl.obolibrary.org/obo/CL_0000084")).toBe("CL:0000084");
    expect(canonicalTermId("hsapdv:0000258")).toBe("HsapDv:0000258");
    expect(canonicalTermId("FOO:0000001")).toBeNull();
    expect(termKey("UBERON_0002048")).toBe("uberon:0002048");
    expect(termKeys(["Lung", "lung", " UBERON:0002048 "])).toEqual(["lung", "uberon:0002048"]);
  });
});

describe("parseObo", () => {
  it("reads names, synonyms with scope, is_a, part_of, obsolete flags and stage properties", () => {
    expect(terms.get("UBERON:0002048")).toMatchObject({ name: "lung", isA: ["UBERON:0000062"], synonyms: [{ text: "pulmo", scope: "EXACT" }] });
    expect(terms.get("UBERON:0008952")!.partOf).toEqual(["UBERON:0002048"]);
    expect(terms.get("UBERON:0009999")!.obsolete).toBe(true);
    expect(terms.get("HsapDv:0000240")!.props).toEqual({ end_ypb: 60, start_ypb: 50 });
    expect(terms.has("part_of")).toBe(false);
  });
});

describe("matchValue", () => {
  const ctx = (onto: string[]) => ({ index: buildLabelIndex(terms, onto), aliases: [] });
  const tissue = ctx(["UBERON"]);
  const cell = ctx(["CL"]);

  it("matches labels, exact synonyms and ids", () => {
    expect(matchValue("tissue", "Lung", tissue)).toMatchObject({ term_id: "UBERON:0002048", method: "label", confidence: 0.95 });
    expect(matchValue("tissue", "skin", tissue)).toMatchObject({ term_id: "UBERON:0000014", method: "exact_synonym" });
    expect(matchValue("tissue", "UBERON_0000178", tissue)).toMatchObject({ term_id: "UBERON:0000178", method: "id" });
  });
  it("reads qualifiers and plurals off before matching, at lower confidence", () => {
    expect(matchValue("tissue", "human lung tissue", tissue)).toMatchObject({ term_id: "UBERON:0002048", method: "variant", confidence: 0.85 });
    expect(matchValue("tissue", "lung organoids", tissue)).toMatchObject({ term_id: "UBERON:0002048", confidence: 0.7 });
    expect(matchValue("cell_type_sorted", "T cells", cell)).toMatchObject({ term_id: "CL:0000084" });
    expect(matchValue("cell_type_sorted", "CD3+ T cells", cell)).toMatchObject({ term_id: "CL:0000084", method: "variant" });
    expect(matchValue("cell_type_sorted", "blood monocytes", cell)).toMatchObject({ term_id: "CL:0000576" });
    expect(variants("cd4 t cells", "cell_type_sorted")).toContain("cd4 positive alpha beta t cell");
    expect(matchValue("cell_type_sorted", "CD4 T cells", cell)).toMatchObject({ term_id: "CL:0000624" });
  });
  it("leaves ambiguous, too-general and abbreviation-only values unmapped", () => {
    expect(matchValue("tissue", "hippocampus", tissue)).toBeNull(); // two terms share the synonym
    expect(matchValue("cell_type_sorted", "primary cells", cell)).toBeNull(); // only reaches the root "cell"
    expect(matchValue("disease", "CD", ctx(["MONDO"]))).toBeNull(); // short related synonym
    expect(matchValue("tissue", "old lung term", tissue)).toBeNull(); // obsolete
    expect(matchValue("tissue", "esophageal adenocarcinoma", tissue)).toBeNull();
  });
  it("applies curated aliases", () => {
    const aliases = [{ attr: "tissue", values: ["pbmc"], term: "UBERON:0000178", label: "blood", note: "test" }];
    expect(matchValue("tissue", "PBMC", { index: tissue.index, aliases })).toMatchObject({ term_id: "UBERON:0000178", method: "curated" });
    expect(matchValue("tissue", "human PBMCs", { index: tissue.index, aliases })).toMatchObject({ term_id: "UBERON:0000178", method: "curated", confidence: 0.85 });
  });
  it("keeps every curated alias well-formed", () => {
    for (const a of ALIASES) {
      expect(a.term).toMatch(/^(UBERON|CL|MONDO|PATO|HANCESTRO):\d+$/);
      expect(a.label.length).toBeGreaterThan(0);
      for (const v of a.values) expect(v).toBe(normLabel(v));
    }
    expect(LIFE_STAGE_TERMS.adult.HsapDv).toBe("HsapDv:0000258");
  });
});

describe("developmental stage from age", () => {
  const human = stageIntervals(terms, "HsapDv");
  const mouse = stageIntervals(terms, "MmusDv");
  const age = (organism: string, value_norm: string, unit: string | null, value_raw = value_norm) => ageRange({ organism, value_norm, value_raw, unit, value_num: null });

  it("places an age in the narrowest stage that contains it", () => {
    const r = age("Homo sapiens", "55 years", "years")!;
    expect(placeInStage(human, r.lo, r.hi)?.id).toBe("HsapDv:0000240");
    const adult = age("Homo sapiens", "34 years", "years")!;
    expect(placeInStage(human, adult.lo, adult.hi)?.id).toBe("HsapDv:0000258"); // open-ended adult stage
    const range = age("Homo sapiens", "45-55 years", "years")!;
    expect(placeInStage(human, range.lo, range.hi)?.id).toBe("HsapDv:0000258"); // spans two decades
  });
  it("reads mouse embryonic days post conception", () => {
    const r = age("Mus musculus", "E14.5", "E-days")!;
    expect(placeInStage(mouse, r.lo, r.hi)?.id).toBe("MmusDv:0000031");
  });
  it("does not guess human ages in days or weeks without a prenatal or postnatal word", () => {
    expect(age("Homo sapiens", "10 weeks", "weeks")).toBeNull();
    expect(age("Homo sapiens", "6 weeks", "weeks", "6 pcw")).not.toBeNull();
    expect(age("Danio rerio", "3 months", "months")).toBeNull();
    expect(age("Homo sapiens", "18-30", null)).toBeNull();
    expect(age("Homo sapiens", "12 pcw", null)).toMatchObject({ why: "post conception" });
    expect(age("Homo sapiens", "17 pcw", "pcw", "17pcw")).toMatchObject({ why: "post conception" });
  });
});

// ── SQL: migration, refresh and the search filters ─────────────────────────

const BASE = `
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, organism_primary TEXT, status TEXT, n_cells INTEGER);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, usable INTEGER, qc_tier INTEGER);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, has_bundle INTEGER, n_usable_samples INTEGER, reference_mismatch INTEGER, n_lowqc_samples INTEGER, year INTEGER);
${readFileSync("schema/030_search_facts.sql", "utf8")}
${readFileSync("schema/034_ontology.sql", "utf8")}
INSERT INTO ontology_term (term_id, ontology, label) VALUES
  ('UBERON:0002048', 'UBERON', 'lung'), ('UBERON:0008952', 'UBERON', 'upper lobe of left lung'), ('UBERON:0000178', 'UBERON', 'blood'),
  ('CL:0000084', 'CL', 'T cell'), ('CL:0000624', 'CL', 'CD4-positive, alpha-beta T cell'),
  ('HsapDv:0000258', 'HsapDv', 'adult stage'), ('HsapDv:0000240', 'HsapDv', 'sixth decade stage'), ('PATO:0000383', 'PATO', 'female');
INSERT INTO ontology_closure (term_id, ancestor_id, distance) VALUES
  ('UBERON:0002048', 'UBERON:0002048', 0), ('UBERON:0008952', 'UBERON:0008952', 0), ('UBERON:0008952', 'UBERON:0002048', 1),
  ('UBERON:0000178', 'UBERON:0000178', 0), ('CL:0000084', 'CL:0000084', 0), ('CL:0000624', 'CL:0000624', 0), ('CL:0000624', 'CL:0000084', 1),
  ('HsapDv:0000258', 'HsapDv:0000258', 0), ('HsapDv:0000240', 'HsapDv:0000240', 0), ('HsapDv:0000240', 'HsapDv:0000258', 1),
  ('PATO:0000383', 'PATO:0000383', 0);
INSERT INTO ontology_label (label_norm, term_id, ontology, kind) VALUES
  ('uberon:0002048', 'UBERON:0002048', 'UBERON', 'id'), ('lung', 'UBERON:0002048', 'UBERON', 'label'), ('pulmo', 'UBERON:0002048', 'UBERON', 'exact'),
  ('upper lobe of left lung', 'UBERON:0008952', 'UBERON', 'label'), ('blood', 'UBERON:0000178', 'UBERON', 'label'),
  ('t cell', 'CL:0000084', 'CL', 'label'), ('cl:0000624', 'CL:0000624', 'CL', 'id'), ('cd4 positive alpha beta t cell', 'CL:0000624', 'CL', 'label'),
  ('adult stage', 'HsapDv:0000258', 'HsapDv', 'label'), ('female', 'PATO:0000383', 'PATO', 'label');
INSERT INTO ontology_value_map (attr, organism, value_norm, term_id, method, source, confidence, mapper_version) VALUES
  ('tissue', '', 'lung', 'UBERON:0002048', 'label', 'geo', 0.95, 't'),
  ('tissue', '', 'left upper lobe', 'UBERON:0008952', 'model', 'model', 0.7, 't'),
  ('tissue', '', 'pbmc', 'UBERON:0000178', 'curated', 'geo', 0.9, 't'),
  ('cell_type_sorted', '', 'cd4 t cell', 'CL:0000624', 'variant', 'geo', 0.85, 't'),
  ('cell_type_sorted', '', 'T cells', 'CL:0000084', 'variant', 'geo', 0.85, 't'),
  ('sex', '', 'female', 'PATO:0000383', 'label', 'geo', 0.95, 't'),
  ('age', 'Homo sapiens', '55 years', 'HsapDv:0000240', 'stage', 'geo', 0.9, 't'),
  ('life_stage', 'Homo sapiens', 'adult', 'HsapDv:0000258', 'curated', 'geo', 0.9, 't');
-- S1: downloadable, lung + CD4 T + female + 55 years (human).  S2: same study, upper lobe (model) + T cells.
-- S3: other study, blood. S4: low-QC sample in study 1 (lung).  S5: mouse sample aged "55 years" (no mouse map row).
-- GSE3 has no file.
INSERT INTO gse_meta VALUES ('GSE1', 1, 2, 0, 1, 2020), ('GSE2', 1, 1, 0, 0, 2021), ('GSE3', 0, 1, 0, 0, 2022);
INSERT INTO gsm VALUES ('S1', 'GSE1', 'Homo sapiens', 'DONE', 100), ('S2', 'GSE1', 'Homo sapiens', 'DONE', 100), ('S3', 'GSE2', 'Homo sapiens', 'DONE', 100),
  ('S4', 'GSE1', 'Homo sapiens', 'DONE', 100), ('S5', 'GSE3', 'Mus musculus', 'DONE', 100);
INSERT INTO sample_qc VALUES ('S1', 'GSE1', 1, 0), ('S2', 'GSE1', 1, 0), ('S3', 'GSE2', 1, 0), ('S4', 'GSE1', 1, 1), ('S5', 'GSE3', 1, 0);
INSERT INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, source, extractor_version) VALUES
  ('S1', 'GSE1', 'tissue', 'Lung', 'lung', 'geo', 'x'), ('S1', 'GSE1', 'cell_type_sorted', 'CD4 T cells', 'cd4 t cell', 'geo', 'x'),
  ('S1', 'GSE1', 'sex', 'F', 'female', 'geo', 'x'), ('S1', 'GSE1', 'age', '55', '55 years', 'geo', 'x'), ('S1', 'GSE1', 'life_stage', '55', 'adult', 'geo', 'x'),
  ('S2', 'GSE1', 'tissue', 'LUL', 'left upper lobe', 'geo', 'x'), ('S2', 'GSE1', 'cell_type_sorted', 'T cells', 'T cells', 'geo', 'x'),
  ('S3', 'GSE2', 'tissue', 'PBMC', 'pbmc', 'geo', 'x'), ('S3', 'GSE2', 'tissue', 'mystery', 'mystery organ', 'geo', 'x'),
  ('S4', 'GSE1', 'tissue', 'lung', 'lung', 'geo', 'x'),
  ('S5', 'GSE3', 'tissue', 'lung', 'lung', 'geo', 'x'), ('S5', 'GSE3', 'age', '55', '55 years', 'geo', 'x');
`;

async function setup() {
  const db = createTestD1(BASE);
  // Twice: the refresh must be idempotent.
  db.raw.exec(readFileSync("scripts/ontology/refresh.sql", "utf8"));
  db.raw.exec(readFileSync("scripts/ontology/refresh.sql", "utf8"));
  return db;
}

const withTerms = (terms: SearchFilters["terms"], extra: Partial<SearchFilters> = {}): SearchFilters => ({ ...emptyFilters(), terms, ...extra });

async function studies(db: Awaited<ReturnType<typeof setup>>, f: SearchFilters) {
  const w = buildStudyWhere(f);
  const rows = await db.prepare(`SELECT m.gse_id FROM gse_meta m ${w.clauses.length ? `WHERE ${w.clauses.join(" AND ")}` : ""} ORDER BY 1`).bind(...w.params).all<{ gse_id: string }>();
  return rows.results.map((r) => r.gse_id);
}

async function samples(db: Awaited<ReturnType<typeof setup>>, f: SearchFilters) {
  const w = buildSampleWhere(f);
  const rows = await db.prepare(`SELECT s.gsm_id FROM gsm s JOIN gse_meta m ON m.gse_id = s.gse_id WHERE ${w.clauses.join(" AND ")} ORDER BY 1`).bind(...w.params).all<{ gsm_id: string }>();
  return rows.results.map((r) => r.gsm_id);
}

describe("scripts/ontology/refresh.sql", () => {
  it("fills sample_term from sample_attr through the value map, by species for stages", async () => {
    const db = await setup();
    const rows = db.raw.prepare("SELECT gsm_id, attr, term_id, source, from_attr FROM sample_term ORDER BY gsm_id, attr, term_id").all();
    expect(rows).toEqual([
      { gsm_id: "S1", attr: "cell_type", term_id: "CL:0000624", source: "geo", from_attr: "cell_type_sorted" },
      { gsm_id: "S1", attr: "development_stage", term_id: "HsapDv:0000240", source: "geo", from_attr: "age" },
      { gsm_id: "S1", attr: "development_stage", term_id: "HsapDv:0000258", source: "geo", from_attr: "life_stage" },
      { gsm_id: "S1", attr: "sex", term_id: "PATO:0000383", source: "geo", from_attr: "sex" },
      { gsm_id: "S1", attr: "tissue", term_id: "UBERON:0002048", source: "geo", from_attr: "tissue" },
      { gsm_id: "S2", attr: "cell_type", term_id: "CL:0000084", source: "geo", from_attr: "cell_type_sorted" },
      { gsm_id: "S2", attr: "tissue", term_id: "UBERON:0008952", source: "model", from_attr: "tissue" },
      { gsm_id: "S3", attr: "tissue", term_id: "UBERON:0000178", source: "geo", from_attr: "tissue" },
      { gsm_id: "S4", attr: "tissue", term_id: "UBERON:0002048", source: "geo", from_attr: "tissue" },
      { gsm_id: "S5", attr: "tissue", term_id: "UBERON:0002048", source: "geo", from_attr: "tissue" },
    ]);
  });

  it("sets sample_attr.ontology_id where the value maps to one term and leaves the rest null", async () => {
    const db = await setup();
    const ids = db.raw.prepare("SELECT gsm_id, attr, value_norm, ontology_id FROM sample_attr WHERE gsm_id IN ('S1', 'S3', 'S5') ORDER BY gsm_id, attr, value_norm").all();
    expect(ids).toContainEqual({ gsm_id: "S1", attr: "age", value_norm: "55 years", ontology_id: "HsapDv:0000240" });
    expect(ids).toContainEqual({ gsm_id: "S3", attr: "tissue", value_norm: "mystery organ", ontology_id: null });
    expect(ids).toContainEqual({ gsm_id: "S5", attr: "age", value_norm: "55 years", ontology_id: null }); // no mouse stage mapped
  });

  it("counts downloadable, approved samples under each term with descendants", async () => {
    const db = await setup();
    const counts = db.raw.prepare("SELECT attr, term_id, n_samples, n_studies, n_direct FROM ontology_term_count WHERE attr IN ('tissue', 'cell_type') ORDER BY attr, term_id").all();
    expect(counts).toEqual([
      { attr: "cell_type", term_id: "CL:0000084", n_samples: 2, n_studies: 1, n_direct: 1 },
      { attr: "cell_type", term_id: "CL:0000624", n_samples: 1, n_studies: 1, n_direct: 1 },
      { attr: "tissue", term_id: "UBERON:0000178", n_samples: 1, n_studies: 1, n_direct: 1 },
      // S4 is low QC and S5's study has no file: neither counts
      { attr: "tissue", term_id: "UBERON:0002048", n_samples: 2, n_studies: 1, n_direct: 1 },
      { attr: "tissue", term_id: "UBERON:0008952", n_samples: 1, n_studies: 1, n_direct: 1 },
    ]);
  });
});

describe("ontology filters in search", () => {
  it("parses <name>_term params, keeps them in the cache key and counts them as filters", () => {
    const p = parseSearchParams(new URL("https://x/api/search?tissue_term=lung&tissue_term=UBERON_0000178&cell_type_term=T%20cell|CL:0000624&term_expand=none&sex_term_mode=all"));
    expect(p.terms).toEqual({ tissue: ["lung", "UBERON_0000178"], cell_type: ["T cell", "CL:0000624"] });
    expect(p.term_exact).toBe(true);
    expect(p.match_mode).toEqual({ sex_term: "all" });
    expect(hasAnyFilter(p)).toBe(true);
    const key = canonicalQuery(p);
    expect(key).toContain("tissue_term=UBERON_0000178&tissue_term=lung");
    expect(key).toContain("term_expand=none");
    expect(hasAnyFilter(parseSearchParams(new URL("https://x/api/search")))).toBe(false);
  });

  it("matches studies by id or label and includes descendants", async () => {
    const db = await setup();
    expect(await studies(db, withTerms({ tissue: ["lung"] }))).toEqual(["GSE1", "GSE3"]);
    expect(await studies(db, withTerms({ tissue: ["UBERON_0002048"] }))).toEqual(["GSE1", "GSE3"]);
    expect(await studies(db, withTerms({ tissue: ["pulmo"] }))).toEqual(["GSE1", "GSE3"]); // exact synonym
    expect(await studies(db, withTerms({ tissue: ["lung"] }, { has_bundle: true }))).toEqual(["GSE1"]);
    expect(await studies(db, withTerms({ tissue: ["no such organ"] }))).toEqual([]);
    expect(await studies(db, withTerms({ tissue: ["T cell"] }))).toEqual([]); // labels resolve within the filter's ontology
  });

  it("matches samples with descendant expansion, or only the term itself with term_expand=none", async () => {
    const db = await setup();
    expect(await samples(db, withTerms({ tissue: ["lung"] }))).toEqual(["S1", "S2", "S5"]); // S4 is low QC
    expect(await samples(db, withTerms({ tissue: ["lung"] }, { term_exact: true }))).toEqual(["S1", "S5"]);
    expect(await samples(db, withTerms({ cell_type: ["T cell"] }))).toEqual(["S1", "S2"]);
    expect(await samples(db, withTerms({ cell_type: ["CL:0000624"] }))).toEqual(["S1"]);
    expect(await samples(db, withTerms({ development_stage: ["adult stage"] }))).toEqual(["S1"]);
    expect(await samples(db, withTerms({ tissue: ["lung"], cell_type: ["T cell"], sex: ["female"] }))).toEqual(["S1"]); // AND across filters
    expect(await samples(db, withTerms({ tissue: ["lung", "blood"] }))).toEqual(["S1", "S2", "S3", "S5"]); // OR within
    expect(await samples(db, withTerms({ tissue: ["upper lobe of left lung", "blood"] }, { match_mode: { tissue_term: "all" } }))).toEqual([]);
  });
});

describe("GET /api/ontology/terms", () => {
  const get = async (db: D1Database, qs: string) => {
    const res = await termsGet({ request: new Request(`https://singlet.bio/api/ontology/terms?${qs}`), env: { DB: db }, params: {}, waitUntil: () => undefined } as never);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("lists directly mapped terms, searches labels and resolves values", async () => {
    const db = await setup();
    const top = await get(db, "filter=tissue");
    expect((top.body.terms as { id: string }[]).map((t) => t.id)).toEqual(["UBERON:0000178", "UBERON:0002048", "UBERON:0008952"]) // one direct sample each: by studies, then label;
    const search = await get(db, "filter=cell_type&q=t%20cel");
    // prefix matches first, then substring matches ("cd4 positive alpha beta t cell")
    expect(search.body.terms).toEqual([
      { id: "CL:0000084", label: "T cell", ontology: "CL", n_samples: 2, n_studies: 1 },
      { id: "CL:0000624", label: "CD4-positive, alpha-beta T cell", ontology: "CL", n_samples: 1, n_studies: 1 },
    ]);
    const byId = await get(db, "filter=tissue&q=UBERON_0002048");
    expect((byId.body.terms as { id: string }[])[0].id).toBe("UBERON:0002048");
    const resolved = await get(db, "filter=tissue&values=lung|nope");
    expect(resolved.body.resolved).toEqual([
      { id: "UBERON:0002048", label: "lung", ontology: "UBERON", n_samples: 2, n_studies: 1, value: "lung" },
      { id: null, value: "nope" },
    ]);
  });

  it("rejects an unknown filter and reports missing tables as unavailable", async () => {
    expect((await get(createTestD1(), "filter=organ")).status).toBe(400);
    const empty = await get(createTestD1(), "filter=tissue");
    expect(empty.body).toMatchObject({ available: false, terms: [] });
  });
});

// ── Cell tier: derived sample properties and the ingest of summaries (schema/035) ─────────

describe("derived sample properties", () => {
  it("reads perturbation from treatment status and engineered genotypes only", () => {
    expect(perturbationOf("treatment_status", "treated")).toMatchObject({ value: "treated" });
    expect(perturbationOf("treatment_status", "vehicle")).toMatchObject({ value: "control" });
    expect(perturbationOf("genotype", "C57BL/6J")).toMatchObject({ value: "control" });
    expect(perturbationOf("genotype", "Trem2-/-")).toMatchObject({ value: "genetic" });
    expect(perturbationOf("genotype", "Cx3cr1CreERT2/+")).toMatchObject({ value: "genetic" });
    expect(perturbationOf("genotype", "ARID1A KO")).toMatchObject({ value: "genetic" });
    expect(perturbationOf("genotype", "BRCA1 mutation")).toBeNull(); // a patient's genotype, not an experiment
    expect(perturbationOf("genotype", "trisomy 21")).toBeNull();
    expect(perturbationOf("genotype", "Crohn's disease")).toBeNull();
  });
  it("reads the sample kind from the cell line field and organoid/xenograft words", () => {
    expect(sampleKindOf("sample_type", "K562 Cell line")).toMatchObject({ value: "cell_line" });
    expect(sampleKindOf("sample_type", "HEK293FT")).toMatchObject({ value: "cell_line" });
    expect(sampleKindOf("sample_type", "H9")).toMatchObject({ value: "stem_cell" });
    expect(sampleKindOf("sample_type", "primary cells")).toMatchObject({ value: "primary" });
    expect(sampleKindOf("sample_type", "human")).toBeNull();
    expect(sampleKindOf("sample_type", "knee - OA")).toBeNull();
    expect(sampleKindOf("tissue", "Midbrain organoids")).toMatchObject({ value: "organoid" });
    expect(sampleKindOf("tissue", "PDX tumor")).toMatchObject({ value: "xenograft" });
    expect(sampleKindOf("cell_type_sorted", "iPSC-derived neural progenitors")).toMatchObject({ value: "stem_cell" });
    expect(propertiesOf("treatment_status", "treated")).toHaveLength(1);
  });

  it("properties.sql derives donor status, perturbation and kind, and drops conflicts", async () => {
    const db = createTestD1(`${BASE}\n${readFileSync("schema/035_cell_tier.sql", "utf8")}
      INSERT INTO ontology_value_map (attr, organism, value_norm, term_id, method, source, confidence, mapper_version) VALUES
        ('disease', '', 'healthy', 'PATO:0000461', 'curated', 'geo', 0.9, 't'), ('disease', '', 'copd', 'MONDO:0005002', 'curated', 'geo', 0.9, 't');
      INSERT INTO sample_attr (gsm_id, gse_id, attr, value_raw, value_norm, source, extractor_version) VALUES
        ('S1', 'GSE1', 'disease', 'healthy', 'healthy', 'geo', 'x'),
        ('S2', 'GSE1', 'disease', 'COPD', 'copd', 'geo', 'x'), ('S2', 'GSE1', 'treatment_status', 'DMSO', 'vehicle', 'geo', 'x'),
        ('S2', 'GSE1', 'genotype', 'Trem2-/-', 'Trem2-/-', 'geo', 'x'),
        ('S3', 'GSE2', 'disease', 'healthy', 'healthy', 'geo', 'x'), ('S3', 'GSE2', 'disease', 'COPD', 'copd', 'geo', 'x'),
        ('S3', 'GSE2', 'sample_type', 'K562', 'cell line', 'geo', 'x');
      INSERT INTO property_value_map (attr, match_on, value, property, prop_value, confidence, evidence, version) VALUES
        ('treatment_status', 'value_norm', 'vehicle', 'perturbation', 'control', 0.85, 'e', 'v'),
        ('genotype', 'value_norm', 'Trem2-/-', 'perturbation', 'genetic', 0.8, 'e', 'v'),
        ('sample_type', 'value_raw', 'K562', 'sample_kind', 'cell_line', 0.9, 'e', 'v');`);
    db.raw.exec(readFileSync("scripts/ontology/refresh.sql", "utf8"));
    db.raw.exec(readFileSync("scripts/ontology/properties.sql", "utf8"));
    db.raw.exec(readFileSync("scripts/ontology/properties.sql", "utf8"));
    const rows = db.raw.prepare("SELECT gsm_id, property, value FROM sample_property ORDER BY gsm_id, property, value").all();
    expect(rows).toEqual([
      { gsm_id: "S1", property: "donor_status", value: "healthy" },
      { gsm_id: "S2", property: "donor_status", value: "diseased" },
      { gsm_id: "S2", property: "perturbation", value: "genetic" }, // the vehicle arm of a knockout is still perturbed
      { gsm_id: "S3", property: "sample_kind", value: "cell_line" }, // healthy and COPD at once: no donor status
    ]);
    // The search filters: closed values only, AND across properties.
    const p = parseSearchParams(new URL("https://x/api/search?donor_status=Diseased&perturbation=genetic&sample_kind=bogus"));
    expect(p.props).toEqual({ donor_status: ["diseased"], perturbation: ["genetic"] });
    expect(canonicalQuery(p)).toContain("donor_status=diseased");
    const w = buildSampleWhere({ ...emptyFilters(), props: p.props });
    const hits = db.raw.prepare(`SELECT s.gsm_id FROM gsm s JOIN gse_meta m ON m.gse_id = s.gse_id WHERE ${w.clauses.join(" AND ")}`).all(...(w.params as never[]));
    expect(hits).toEqual([{ gsm_id: "S2" }]);
  });

  it("ingests the feature registry and per-sample summaries, never cells", async () => {
    const DB = createTestD1(readFileSync("schema/035_cell_tier.sql", "utf8"));
    const env = { DB, INGEST_TOKEN_SHA256: await sha256Hex("tok") };
    const post = (table: string, rows: unknown[]) =>
      ingestPost({ request: new Request(`https://singlet.bio/api/ingest/${table}`, { method: "POST", headers: { "x-ingest-token": "tok", "content-type": "application/json" }, body: JSON.stringify({ rows }) }), env, params: { table } } as never);
    const feature = { feature_id: "hallmark-2023.1/HALLMARK_HYPOXIA", feature_set: "hallmark-2023.1", kind: "score", label: "Hypoxia", method: "rank-auc", method_version: "1", licence: "CC-BY-4.0", storage: "sidecar" };
    expect((await post("cell_feature", [feature])).status).toBe(200);
    expect((await post("cell_feature", [{ ...feature, feature_id: "bad id with spaces" }])).status).toBe(400);
    expect((await post("cell_feature", [{ ...feature, storage: "d1" }])).status).toBe(400);
    const summary = { gsm_id: "GSM1", gse_id: "GSE1", subject: "cell_type", item: "CL:0000084", n_cells: 120, n_hi1: 100, n_hi2: 80, version: "annot-0.1" };
    expect((await post("sample_cell_summary", [summary, { ...summary, subject: "feature", item: feature.feature_id, n_cells: 900, q50: 0.2 }])).status).toBe(200);
    expect((await post("sample_cell_summary", [{ ...summary, n_cells: 130 }])).status).toBe(200); // upsert on (subject, item, gsm)
    expect((await post("sample_cell_summary", [{ ...summary, subject: "cell" }])).status).toBe(400);
    expect(DB.raw.prepare("SELECT subject, item, n_cells FROM sample_cell_summary ORDER BY subject").all()).toEqual([
      { subject: "cell_type", item: "CL:0000084", n_cells: 130 },
      { subject: "feature", item: "hallmark-2023.1/HALLMARK_HYPOXIA", n_cells: 900 },
    ]);
  });
});
