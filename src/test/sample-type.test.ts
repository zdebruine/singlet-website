// @vitest-environment node
// Structured sample type and disease facts from a sample's own GEO fields (functions/_shared/sample-type.ts) and their search filters
// (functions/_shared/sample-type-filters.ts).
import { describe, expect, it } from "vitest";
import { classifySampleType, diseaseCandidate, type CellLineHit } from "../../functions/_shared/sample-type";
import { normalizeTypeValues, typeFacetSelect, typeStudyClause } from "../../functions/_shared/sample-type-filters";
import { parsePairs } from "../../functions/_shared/attr-extract";

const LINES: Record<string, CellLineHit> = {
  k562: { ac: "CVCL_0004", name: "K-562", category: "Cancer cell line" },
  h9: { ac: "CVCL_9773", name: "WA09", category: "Embryonic stem cell" },
};
const lookup = (raw: string) => LINES[raw.toLowerCase().replace(/ cells?$/, "")] ?? null;
const facts = (s: { source?: string; characteristics?: string }) =>
  Object.fromEntries(classifySampleType({ organism_primary: "Homo sapiens", ...s }, lookup).facts.map((f) => [f.property, f.value]));

describe("classifySampleType", () => {
  it("reads a tissue sample from an explicit tissue field", () => {
    expect(facts({ characteristics: "tissue: Lung;; age: 55" })).toEqual({ tissue_type: "tissue", sample_kind: "primary" });
  });
  it("reads a Cellosaurus line, and a line named only in its tissue of origin stays a cell line", () => {
    const r = classifySampleType({ organism_primary: "Homo sapiens", characteristics: "cell line: K562;; tissue: bone marrow" }, lookup);
    expect(r.cellLines.map((c) => c.ac)).toEqual(["CVCL_0004"]);
    expect(r.cellLines[0].evidence).toBe("cell line: K562");
    expect(Object.fromEntries(r.facts.map((f) => [f.property, f.value]))).toEqual({ tissue_type: "cell line", sample_kind: "cell_line" });
  });
  it("marks an ES/iPS line as a stem cell kind, and an organoid from it as an organoid", () => {
    expect(facts({ characteristics: "cell line: H9;; cell type: neurons" })).toEqual({ tissue_type: "cell line", sample_kind: "stem_cell" });
    expect(facts({ characteristics: "cell line: H9;; tissue: cerebral organoid" })).toEqual({ tissue_type: "organoid", sample_kind: "organoid" });
  });
  it("reads a line grown as a tumour in an animal as tissue, keeping the line", () => {
    const r = classifySampleType({ organism_primary: "Homo sapiens", characteristics: "tissue: tumor;; cell line: K562;; cell type: CD45+" }, lookup);
    expect(r.cellLines.map((c) => c.ac)).toEqual(["CVCL_0004"]);
    expect(Object.fromEntries(r.facts.map((f) => [f.property, f.value]))).toEqual({ tissue_type: "tissue", tumor_sample_type: "tumor" });
    // "Breast carcinoma cell line" names the line's origin, not a tumour grown in vivo
    expect(facts({ characteristics: "cell line: K562;; cell type: leukemia tumor cell line" }).tissue_type).toBe("cell line");
  });
  it("reads an organoid named only by an organoid field", () => {
    expect(facts({ characteristics: "tissue: esophagus;; cell line: H9;; organoid: HEO" }).tissue_type).toBe("organoid");
  });
  it("never reads a mouse strain under a cell line key as a cell line", () => {
    const strainLookup = () => ({ ac: "CVCL_C0MU", name: "Bone marrow macrophage immortalized C57BL/6", category: "Transformed cell line" });
    for (const v of ["C57BL/6", "C57Bl/6J", "BALB/c", "wild type", "CD-1", "NSG"]) {
      const r = classifySampleType({ organism_primary: "Mus musculus", characteristics: `cell line: ${v};; tissue: spleen` }, strainLookup);
      expect(r.cellLines).toEqual([]);
      expect(r.facts.find((f) => f.property === "tissue_type")?.value).toBe("tissue");
    }
  });
  it("passes the stem cell context to the line lookup", () => {
    const seen: boolean[] = [];
    classifySampleType({ characteristics: "cell line: H9;; cell type: embryonic stem cells" }, (_raw, stem) => (seen.push(stem), null));
    classifySampleType({ characteristics: "cell line: H9;; cell type: T cells" }, (_raw, stem) => (seen.push(stem), null));
    expect(seen).toEqual([true, false]);
  });
  it("reads xenografts under any key as tissue of kind xenograft", () => {
    expect(facts({ characteristics: "tissue: tumor;; group: O-PDX" })).toEqual({ tissue_type: "tissue", sample_kind: "xenograft", tumor_sample_type: "tumor" });
  });
  it("reads primary cultures only from explicit culture wording", () => {
    expect(facts({ characteristics: "cell type: cultured fibroblasts;; tissue: skin" })).toEqual({ tissue_type: "primary cell culture", sample_kind: "primary" });
    // the word "culture" without a culture phrase blocks the tissue reading instead of guessing
    expect(facts({ characteristics: "tissue: lung;; treatment: culture medium" }).tissue_type).toBeUndefined();
  });
  it("reads tumour vs adjacent normal (GDC sample_type), never pre-metastatic", () => {
    expect(facts({ characteristics: "tissue: liver;; tissue type: adjacent normal tissue" }).tumor_sample_type).toBe("adjacent normal");
    expect(facts({ characteristics: "tissue: liver;; tissue type: metastasis" }).tumor_sample_type).toBe("metastatic");
    expect(facts({ characteristics: "tissue: liver;; tissue type: pre-metastatic liver" }).tumor_sample_type).toBeUndefined();
  });
  it("infers nothing from silence", () => {
    expect(facts({ characteristics: "treatment: none;; time: 6h" })).toEqual({});
  });
});

describe("diseaseCandidate", () => {
  const read = (seg: string, org = "Homo sapiens") => diseaseCandidate(parsePairs(seg)[0], org);
  it("reads explicit healthy phrases under any disease or generic key", () => {
    expect(read("disease state: Healthy donor")?.kind).toBe("healthy");
    expect(read("group: healthy controls")?.kind).toBe("healthy");
  });
  it("reads a bare 'control' as healthy only for human donors under a disease key", () => {
    expect(read("disease state: control")?.kind).toBe("healthy");
    expect(read("group: control")).toBeNull();
    expect(read("disease state: control", "Mus musculus")).toBeNull();
  });
  it("strips the person and severity from a disease value", () => {
    expect(read("subject status: Parkinson's disease (PD) patient")?.text).toBe("parkinson's disease");
    expect(read("disease state: severe COVID-19")?.text).toBe("covid-19");
  });
  it("ignores keys that do not name health or disease", () => {
    expect(read("treatment: cisplatin")).toBeNull();
  });
});

describe("sample type search filters", () => {
  it("normalizes enum values and Cellosaurus accessions, dropping anything else", () => {
    expect(normalizeTypeValues("tissue_type", ["Cell_Line", "organoid", "blob"])).toEqual(["cell line", "organoid"]);
    expect(normalizeTypeValues("cell_line", ["cvcl_0004", "HEK293T"])).toEqual(["CVCL_0004", "hek293t"]);
  });
  it("matches a study through any served sample, and a cell line by accession or name", () => {
    const c = typeStudyClause("cell_line", ["CVCL_0004", "k-562"], "m.gse_id");
    expect(c.sql).toMatch(/^m\.gse_id IN \(SELECT x\.gse_id FROM \(SELECT tt\.gsm_id, tt\.gse_id FROM sample_term tt WHERE tt\.attr = 'cell_line'/);
    expect(c.params).toEqual(["CVCL_0004", "k-562", "cvcl 0004", "k 562"]);
    expect(typeFacetSelect("tissue_type", "b_all", "gsm")).toMatch(/x\.property = 'tissue_type' AND x\.gsm_id IN \(SELECT gsm_id FROM b_all\)/);
  });
});
