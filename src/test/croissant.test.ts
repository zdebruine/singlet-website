// @vitest-environment node
// Croissant 1.1 metadata (functions/_shared/croissant.ts): which samples a study document describes (Research Alpha exclusions,
// QC), what the record sets and their CSVs hold, the release-policy id, the atlas numbers, the gene table and the routes' 404s.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CROISSANT_CONTEXT,
  CROISSANT_SPEC,
  DATA_LICENSE,
  FEATURE_COLUMNS,
  SAMPLE_COLUMNS,
  STUDY_COLUMNS,
  atlasBiases,
  buildAtlasCroissant,
  buildStudyCroissant,
  clearCroissantMemo,
  croissantUrls,
  currentReleasePolicy,
  featuresCsv,
  loadAtlasInput,
  loadStudyInput,
  oneSample,
  samplesCsv,
  studiesCsv,
  type ManifestFetcher,
  type StudyManifest,
} from "../../functions/_shared/croissant";
import { clearPackCache, geneTable, resolveFeatureNames, type PackFetcher } from "../../functions/_shared/s1-packs";
import { configureS1 } from "../../functions/_shared/s1-urls";
import { onRequestGet as studyGet } from "../../functions/api/croissant/[id]";
import { onRequestGet as sampleGet } from "../../functions/api/croissant/[id]/[gsm]";
import { onRequestGet as samplesCsvGet } from "../../functions/api/croissant/[id]/samples.csv";
import { createTestD1 } from "./helpers/d1-sqlite";

const SCHEMA = `
CREATE TABLE gse (id TEXT PRIMARY KEY, title TEXT, abstract TEXT, submitted_date TEXT, pubmed_ids TEXT, organism TEXT);
CREATE TABLE gse_meta (gse_id TEXT PRIMARY KEY, organism_primary TEXT, has_bundle INTEGER, n_usable_samples INTEGER, n_usable_cells INTEGER,
  n_lowqc_samples INTEGER, n_lowqc_cells INTEGER, reference_mismatch INTEGER, n_total INTEGER, year INTEGER, tissue_groups TEXT, assay_families TEXT,
  updated_at TEXT);
CREATE TABLE gsm (gsm_id TEXT PRIMARY KEY, gse_id TEXT, title TEXT, organism_primary TEXT, srr_ids TEXT, assay_family TEXT);
CREATE TABLE sample_qc (gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT, singlet_version TEXT, n_input_reads INTEGER,
  mapping_rate REAL, median_umi REAL, median_genes REAL, n_cells_called INTEGER, usable INTEGER, qc_tier INTEGER);
CREATE TABLE s1_study (gse_id TEXT PRIMARY KEY, manifest_key TEXT, rev TEXT NOT NULL, bytes INTEGER, n_samples INTEGER, created_at TEXT, updated_at TEXT,
  reference_build TEXT);
CREATE TABLE s1_migration (gse_id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE sample_term (gsm_id TEXT NOT NULL, gse_id TEXT NOT NULL, attr TEXT NOT NULL, term_id TEXT NOT NULL, source TEXT NOT NULL, confidence REAL NOT NULL,
  from_attr TEXT NOT NULL, PRIMARY KEY (attr, term_id, gsm_id));
CREATE TABLE ontology_term (term_id TEXT PRIMARY KEY, ontology TEXT NOT NULL, label TEXT NOT NULL, release TEXT, depth INTEGER);
CREATE TABLE label_term (term_id TEXT PRIMARY KEY, subject TEXT NOT NULL, label TEXT NOT NULL);
CREATE TABLE sample_attr (gsm_id TEXT NOT NULL, gse_id TEXT NOT NULL, attr TEXT NOT NULL, value_norm TEXT NOT NULL DEFAULT '', ontology_id TEXT,
  source TEXT NOT NULL, PRIMARY KEY (gsm_id, attr, source, value_norm));
CREATE TABLE publications (pmid TEXT PRIMARY KEY, title TEXT, doi TEXT, abstract TEXT, year INTEGER, journal TEXT);
CREATE TABLE gse_publication (gse_id TEXT NOT NULL, pmid TEXT NOT NULL, PRIMARY KEY (gse_id, pmid));
CREATE TABLE study_label (gse_id TEXT NOT NULL, attr TEXT NOT NULL, value TEXT NOT NULL, ontology_id TEXT, n_samples INTEGER NOT NULL, PRIMARY KEY (gse_id, attr, value));
`;

const D16 = (c: string) => c.repeat(32);
const SHA = (c: string) => c.repeat(64);
const MODEL = "singlet-annotate=0.2.0;celltype=guide/cellguide-v2/2026-06-08;sex=xist-chrY-split/2;ancestry=1kgp-supervised-admixture/1/2025-10-14";
const CELL_TYPE = {
  method: "guide",
  default_levels: [1, 2],
  preview_from_level: 3,
  level_names: { "1": "compartment", "2": "lineage", "3": "cell type", "4": "subtype" },
  per_study_accuracy: { "1": 0.842, "2": 0.747, "3": 0.428, "4": 0.32 },
};

function sampleEntry(gsm: string, c: string, withLabels = true) {
  return {
    gsm,
    key: `s1/s/${gsm}/${D16(c)}.s1`,
    bytes: 1000,
    sha256: SHA(c),
    n_columns: 500,
    n_called: 40,
    stats: { median_umi: 1746, median_genes: 590 },
    members: {
      cells: {
        kind: 2,
        off: 64,
        len: 10,
        columns: ["barcode", "called", "n_umi_exon", "n_umi_intron", "n_feat_exon", "n_feat_intron", "called_ed", "called_ed_fdr", "cell_type_cl", "sex_chrom", "ancestry_hancestro"],
        labels: { model_version: MODEL },
      },
      "exon_counts.1pz": { kind: 1, m: 310797, n: 500, names: { rows: { pack: "a34ebca652f38b28f0ab5c0ec2a13249", member: "exon" }, cols: "cells" } },
      "intron_counts.1pz": { kind: 1, m: 272191, n: 500, names: { rows: { pack: "fd3fcc82842baa3a1d4c8bc6a8f99b90", member: "intron" }, cols: "cells" } },
    },
    ...(withLabels
      ? { annotations: { "a2026-10": { key: `s1/a/${gsm}/${D16(c === "a" ? "d" : "e")}.parquet`, sha256: SHA(c === "a" ? "d" : "e"), bytes: 300, n_rows: 40, model_version: MODEL, cell_type: CELL_TYPE } } }
      : {}),
  };
}

/** GSE1: GSM1 served; GSM2 low QC; GSM3 excluded; GSM4 served, listed before GSM1 in the manifest and without labels. */
const MANIFEST_1: StudyManifest = {
  format: "singlet-s1",
  gse: "GSE1",
  rev: "1".repeat(16),
  created_at: "2026-10-27T00:24:18Z",
  reference_build: "GRCh38-2024-A",
  pipeline: { git_sha: "8e1803ba5ac9cb8038e666f06df446c9a85550b0", singlet_version: "0.3.0" },
  packs: { exon: "a34ebca652f38b28f0ab5c0ec2a13249", intron: "fd3fcc82842baa3a1d4c8bc6a8f99b90", whitelist: null },
  annotations_default: "a2026-10",
  samples: [sampleEntry("GSM4", "c", false), sampleEntry("GSM1", "a"), sampleEntry("GSM2", "b"), sampleEntry("GSM3", "f")],
};

const manifests: Record<string, StudyManifest> = {
  GSE1: MANIFEST_1,
  GSE2: { ...MANIFEST_1, gse: "GSE2", samples: [sampleEntry("GSM20", "9")] },
  GSE3: { ...MANIFEST_1, gse: "GSE3", samples: [sampleEntry("GSM30", "8")] },
};
const fetchManifest: ManifestFetcher = async (gse) => manifests[gse] ?? null;

function seed() {
  const db = createTestD1(SCHEMA);
  db.raw.exec(`
    INSERT INTO alpha_exclusions (gsm_id, gse_id, reason, policy_version, added_at) VALUES ('GSM3', 'GSE1', 'strand', 'alpha-2026-10-26c', '2026-10-27T13:20:03Z');
    INSERT INTO alpha_withheld (gse_id, reason, policy_version, added_at) VALUES ('GSE2', 'no_sample_left', 'alpha-2026-10-26c', '2026-10-27T13:19:18Z'),
      ('GSE9', 'reference_mismatch', 'alpha-2026-10-27e', '2026-10-28T02:19:40Z');
    INSERT INTO gse (id, title, abstract, submitted_date, pubmed_ids) VALUES
      ('GSE1', 'Blood of smokers', 'Abstract.', '2019-10-11', '["31000001","31000002"]'), ('GSE2', 'Withheld', NULL, '2019-01-01', NULL),
      ('GSE3', 'No usable sample', NULL, '2020-01-01', NULL);
    INSERT INTO gse_meta (gse_id, organism_primary, has_bundle, n_usable_samples, n_usable_cells, n_total, year, tissue_groups, assay_families) VALUES
      ('GSE1', 'Homo sapiens', 1, 2, 70, 3, 2019, '["Blood / PBMC"]', '["10x 3''"]'),
      ('GSE2', 'Homo sapiens', 1, 1, 10, 1, 2019, '[]', '[]'),
      ('GSE3', 'Mus musculus', 1, 0, 0, 1, 2020, '[]', '[]');
    INSERT INTO s1_study (gse_id, manifest_key, rev, bytes, n_samples, created_at, updated_at, reference_build) VALUES
      ('GSE1', 's1/m/GSE1.json', '${"1".repeat(16)}', 4000, 4, '2026-10-27T00:24:18Z', '2026-10-27T15:48:15Z', 'GRCh38-2024-A'),
      ('GSE2', 's1/m/GSE2.json', '${"2".repeat(16)}', 1000, 1, '2026-10-26T23:32:59Z', '2026-10-27T15:00:00Z', 'GRCh38-2024-A'),
      ('GSE3', 's1/m/GSE3.json', '${"3".repeat(16)}', 1000, 1, '2026-10-27T01:00:00Z', '2026-10-27T15:00:00Z', 'GRCm39-2024-A');
    INSERT INTO s1_migration (gse_id, status) VALUES ('GSE1', 'verified'), ('GSE2', 'verified'), ('GSE3', 'verified');
    INSERT INTO gsm (gsm_id, gse_id, title, organism_primary, srr_ids, assay_family) VALUES
      ('GSM1', 'GSE1', 'Donor 1', 'Homo sapiens', '["SRR1","SRR2"]', '10x 3'''), ('GSM2', 'GSE1', 'Donor 2', 'Homo sapiens', '["SRR3"]', '10x 3'''),
      ('GSM3', 'GSE1', 'Donor 3', 'Homo sapiens', '["SRR4"]', '10x 3'''), ('GSM4', 'GSE1', 'Donor 4', 'Homo sapiens', '["SRR5"]', '10x 3''');
    INSERT INTO sample_qc (gsm_id, gse_id, protocol, reference_build, singlet_version, n_input_reads, mapping_rate, median_umi, median_genes, n_cells_called, usable, qc_tier) VALUES
      ('GSM1', 'GSE1', '10xv2', 'GRCh38-2024-A', '0.3.0', 30000000, 0.85, 1393, 524, 40, 1, 0),
      ('GSM2', 'GSE1', '10xv2', 'GRCh38-2024-A', '0.3.0', 30000000, 0.15, 100, 20, 9, 1, 1),
      ('GSM3', 'GSE1', '10xv2', 'GRCh38-2024-A', '0.3.0', 30000000, 0.85, 900, 500, 50, 1, 0),
      ('GSM4', 'GSE1', '10xv2', 'GRCh38-2024-A', '0.3.0', 20000000, 0.80, 1200, 480, 30, 1, 0),
      ('GSM20', 'GSE2', '10xv2', 'GRCh38-2024-A', '0.3.0', 1, 0.9, 1, 100, 10, 1, 0),
      ('GSM30', 'GSE3', '10xv2', 'GRCm39-2024-A', '0.3.0', 1, 0.9, 1, 100, 0, 0, 0);
    INSERT INTO ontology_term (term_id, ontology, label, release) VALUES
      ('UBERON:0000178', 'UBERON', 'blood', 'uberon/releases/2026-10-01/uberon-basic.owl'), ('PATO:0000461', 'PATO', 'normal', 'releases/2026-10-01/pato.obo'),
      ('MONDO:0005002', 'MONDO', 'chronic obstructive pulmonary disease', 'releases/2026-10-06'), ('HsapDv:0000087', 'HsapDv', 'human adult stage', '');
    INSERT INTO label_term (term_id, subject, label) VALUES ('CL:0000084', 'cell_type', 'T cell');
    INSERT INTO sample_term (gsm_id, gse_id, attr, term_id, source, confidence, from_attr) VALUES
      ('GSM1', 'GSE1', 'tissue', 'UBERON:0000178', 'geo', 0.95, 'tissue'),
      ('GSM1', 'GSE1', 'disease', 'PATO:0000461', 'geo', 0.9, 'disease'),
      ('GSM1', 'GSE1', 'disease', 'MONDO:0005002', 'model', 0.6, 'disease'),
      ('GSM1', 'GSE1', 'development_stage', 'HsapDv:0000087', 'geo', 0.8, 'age'),
      ('GSM1', 'GSE1', 'cell_type', 'CL:0000084', 'geo', 0.9, 'cell_type_sorted'),
      ('GSM3', 'GSE1', 'tissue', 'UBERON:0000178', 'geo', 0.95, 'tissue');
    INSERT INTO sample_attr (gsm_id, gse_id, attr, value_norm, ontology_id, source) VALUES
      ('GSM1', 'GSE1', 'sex_genetic', 'female', 'PATO:0000383', 'pipeline'),
      ('GSM1', 'GSE1', 'ancestry_genetic', 'European', 'HANCESTRO:0005', 'pipeline'),
      ('GSM1', 'GSE1', 'cell_type', 'T cell', 'CL:0000084', 'pipeline'),
      ('GSM1', 'GSE1', 'tissue', 'blood', 'UBERON:0000178', 'geo'),
      ('GSM3', 'GSE1', 'sex_genetic', 'male', 'PATO:0000384', 'pipeline');
    INSERT INTO publications (pmid, title, doi, year, journal) VALUES ('31000001', 'Smoking and immune cells', '10.1000/xyz', 2020, 'J Imm');
    INSERT INTO gse_publication (gse_id, pmid) VALUES ('GSE1', '31000001');
    INSERT INTO study_label (gse_id, attr, value, ontology_id, n_samples) VALUES ('GSE1', 'ancestry_genetic', 'European', 'HANCESTRO:0005', 1),
      ('GSE2', 'ancestry_genetic', 'African', 'HANCESTRO:0010', 1);
  `);
  // the exclusion trigger marked GSE1 stale; the crank would recompute it
  db.raw.exec(`UPDATE gse_meta SET n_usable_samples = 2 WHERE gse_id = 'GSE1'; UPDATE gse_meta SET n_usable_samples = 0 WHERE gse_id = 'GSE3';`);
  return db;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

beforeEach(() => {
  clearCroissantMemo();
  configureS1(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("the release policy id", () => {
  it("is the newest policy_version loaded", async () => {
    const db = seed();
    expect(await currentReleasePolicy(db as never)).toEqual({ version: "alpha-2026-10-27e", loaded_at: "2026-10-28T02:19:40Z" });
  });
  it("falls back to the code's default when nothing is loaded", async () => {
    const db = createTestD1(SCHEMA);
    expect((await currentReleasePolicy(db as never)).version).toMatch(/^alpha-/);
  });
  it("reads the last exclusion written when it is newer than every withheld study", async () => {
    const db = seed();
    db.raw.exec(`INSERT INTO alpha_exclusions (gsm_id, gse_id, reason, policy_version, added_at) VALUES ('GSM99', 'GSE99', 'empty', 'alpha-2026-10-29a', '2026-10-29T00:00:00Z');`);
    expect((await currentReleasePolicy(db as never)).version).toBe("alpha-2026-10-29a");
  });
});

describe("loadStudyInput", () => {
  it("keeps the served, QC-passed samples, in manifest order, with their terms and labels", async () => {
    const input = (await loadStudyInput(seed() as never, "gse1", fetchManifest))!;
    expect(input.samples.map((s) => s.gsm)).toEqual(["GSM4", "GSM1"]);
    const s1 = input.samples[1];
    expect(s1.terms.tissue).toEqual([{ id: "UBERON:0000178", label: "blood", source: "geo" }]);
    expect(s1.terms.disease?.map((t) => t.id)).toEqual(["PATO:0000461", "MONDO:0005002"]);
    expect(s1.terms.cell_type?.[0]).toEqual({ id: "CL:0000084", label: "T cell", source: "geo" });
    expect(s1.sex_genetic).toEqual([{ id: "PATO:0000383", label: "female", source: "pipeline" }]);
    expect(s1.ancestry_genetic[0].id).toBe("HANCESTRO:0005");
    expect(s1.sidecar?.key).toBe(`s1/a/GSM1/${D16("d")}.parquet`);
    expect(input.samples[0].sidecar).toBeNull();
    // the file's own statistics win over the catalog's QC row
    expect(s1.median_umi).toBe(1746);
    expect(s1.n_cells_called).toBe(40);
    expect(input.policy.version).toBe("alpha-2026-10-27e");
    expect(input.publications.map((p) => p.pmid)).toEqual(["31000001", "31000002"]);
    expect(input.ontology_releases.UBERON).toContain("2026-10-01");
  });

  it("finds no withheld, not-downloadable or unknown study", async () => {
    const db = seed();
    expect(await loadStudyInput(db as never, "GSE2", fetchManifest)).toBeNull();
    expect(await loadStudyInput(db as never, "GSE3", fetchManifest)).toBeNull();
    expect(await loadStudyInput(db as never, "GSE77", fetchManifest)).toBeNull();
    expect(await loadStudyInput(db as never, "not-a-gse", fetchManifest)).toBeNull();
  });
});

function ids(doc: Json): Set<string> {
  return new Set((doc.distribution as Json[]).map((d) => d["@id"]));
}

describe("the study document", () => {
  it("is Croissant 1.1 with the RAI fields, the release policy as version, CC0 and the citation", async () => {
    const doc = buildStudyCroissant((await loadStudyInput(seed() as never, "GSE1", fetchManifest))!) as Json;
    expect(doc["@context"]).toEqual(CROISSANT_CONTEXT);
    expect(doc).toMatchObject({
      "@type": "sc:Dataset",
      "@id": "https://singlet.bio/api/croissant/GSE1",
      conformsTo: CROISSANT_SPEC,
      version: "alpha-2026-10-27e",
      license: DATA_LICENSE,
      url: "https://singlet.bio/study/GSE1",
      datePublished: "2026-10-27T00:24:18Z",
      dateModified: "2026-10-27T15:48:15Z",
      isPartOf: { "@id": "https://singlet.bio/croissant.json" },
    });
    expect(doc.citeAs).toContain("GEO accession GSE1");
    expect(doc.citeAs).toContain("Singlet Research Alpha (October 2026)");
    expect(doc.citeAs).toContain("doi:10.1000/xyz");
    for (const k of [
      "rai:dataCollection",
      "rai:dataCollectionType",
      "rai:dataPreprocessingProtocol",
      "rai:dataAnnotationProtocol",
      "rai:dataAnnotationPlatform",
      "rai:annotationsPerItem",
      "rai:dataBiases",
      "rai:dataLimitations",
      "rai:personalSensitiveInformation",
      "rai:dataUseCases",
      "rai:dataSocialImpact",
      "rai:dataReleaseMaintenancePlan",
    ]) {
      expect(doc[k], k).toBeTruthy();
    }
    expect(typeof doc["rai:dataReleaseMaintenancePlan"]).toBe("string");
    expect(doc["rai:dataLimitations"].join(" ")).toContain("compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32");
    expect(doc["rai:dataLimitations"][0]).toContain("level 1 (compartment) 0.842");
    expect(doc["rai:dataPreprocessingProtocol"].join(" ")).toContain("alpha-2026-10-27e");
    expect(doc["rai:personalSensitiveInformation"].join(" ")).toContain("never stored");
    expect(doc["rai:machineAnnotationTools"]).toEqual(MODEL.split(";"));
    expect(doc["prov:wasDerivedFrom"].map((x: Json) => x["@id"])).toEqual([
      "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE1",
      "https://www.ncbi.nlm.nih.gov/sra/SRR5",
      "https://www.ncbi.nlm.nih.gov/sra/SRR1",
    ]);
  });

  it("never names an excluded or low-QC sample", async () => {
    const text = JSON.stringify(buildStudyCroissant((await loadStudyInput(seed() as never, "GSE1", fetchManifest))!));
    expect(text).not.toMatch(/GSM2\b|GSM3\b/);
  });

  it("lists the objects and sidecars with their checksums, and every field reads a distribution entry", async () => {
    const doc = buildStudyCroissant((await loadStudyInput(seed() as never, "GSE1", fetchManifest))!) as Json;
    const dist = ids(doc);
    expect([...dist]).toEqual(["manifest", "samples-csv", "features-csv", "s1/GSM4", "s1/GSM1", "labels/GSM1", "sample-objects", "label-sidecars"]);
    const s1 = (doc.distribution as Json[]).find((d) => d["@id"] === "s1/GSM1")!;
    expect(s1).toMatchObject({ contentUrl: `https://data.singlet.bio/s1/s/GSM1/${D16("a")}.s1`, sha256: SHA("a"), contentSize: "1000 B" });
    const side = (doc.distribution as Json[]).find((d) => d["@id"] === "labels/GSM1")!;
    expect(side).toMatchObject({ encodingFormat: "application/x-parquet", sha256: SHA("d") });
    const rs = doc.recordSet as Json[];
    expect(rs.map((r) => r["@id"])).toEqual(["samples", "cells", "cell_qc", "spliced_counts", "unspliced_counts", "features"]);
    for (const r of rs) {
      for (const f of r.field as Json[]) {
        const src = f.source.fileObject?.["@id"] ?? f.source.fileSet?.["@id"];
        expect(dist.has(src), `${f["@id"]} -> ${src}`).toBe(true);
        expect(f["@id"].startsWith(`${r["@id"]}/`)).toBe(true);
        expect(f.dataType).toBeTruthy();
      }
    }
    expect(rs[0].key).toEqual({ "@id": "samples/gsm_id" });
    expect(rs[0].field.map((f: Json) => f.name)).toEqual(SAMPLE_COLUMNS.map((c) => c.name));
    const tissue = rs[0].field.find((f: Json) => f.name === "tissue_ontology_term_id");
    expect(tissue.dataType).toEqual(["sc:Text", "obo:UBERON_0001062"]);
    expect(rs[1].field.find((f: Json) => f.name === "cell_type_ontology_term_id").source).toEqual({ fileSet: { "@id": "label-sidecars" }, extract: { column: "cell_type_cl" } });
    expect(rs[2].field.map((f: Json) => f.name)).toEqual(["barcode", "called", "n_umi_exon", "n_umi_intron", "n_feat_exon", "n_feat_intron", "called_ed", "called_ed_fdr"]);
    expect(rs[3].description).toContain("pack a34ebca652f38b28f0ab5c0ec2a13249, 310,797 rows");
  });

  it("for one sample, reads that sample's sidecar directly", async () => {
    const one = oneSample((await loadStudyInput(seed() as never, "GSE1", fetchManifest))!, "gsm1")!;
    const doc = buildStudyCroissant(one, croissantUrls(), { single: true }) as Json;
    expect(doc["@id"]).toBe("https://singlet.bio/api/croissant/GSE1/GSM1");
    expect(ids(doc).has("label-sidecars")).toBe(false);
    const cells = (doc.recordSet as Json[]).find((r) => r["@id"] === "cells")!;
    expect(cells.field[0].source).toEqual({ fileObject: { "@id": "labels/GSM1" }, extract: { column: "col" } });
    expect(oneSample(one, "GSM3")).toBeNull();
  });
});

describe("the CSVs", () => {
  it("samples.csv has one column per field and the ontology ids", async () => {
    const csv = samplesCsv((await loadStudyInput(seed() as never, "GSE1", fetchManifest))!);
    const [head, r4, r1, end] = csv.split("\n");
    expect(head.split(",")).toEqual(SAMPLE_COLUMNS.map((c) => c.name));
    expect(end).toBe("");
    expect(r4.startsWith("GSM4,GSE1,Donor 4,")).toBe(true);
    const row = Object.fromEntries(head.split(",").map((h, i) => [h, r1.split(",")[i]]));
    expect(row).toMatchObject({
      organism_ontology_term_id: "NCBITaxon:9606",
      tissue_ontology_term_id: "UBERON:0000178",
      disease_ontology_term_id: "PATO:0000461|MONDO:0005002",
      disease_mapping: "geo|model",
      development_stage_ontology_term_id: "HsapDv:0000087",
      sorted_cell_type_ontology_term_id: "CL:0000084",
      sex_genetic_ontology_term_id: "PATO:0000383",
      ancestry_genetic: "European",
      n_cells_called: "40",
      sra_runs: "SRR1|SRR2",
    });
  });

  it("quotes values that need it", async () => {
    const csv = studiesCsv([
      { gse_id: "GSE1", title: 'A "big", study', organism_primary: "Homo sapiens", n_usable_samples: 2, n_usable_cells: 70, year: 2019, reference_build: "GRCh38-2024-A", bytes: 1, rev: "r", created_at: null, updated_at: null, tissue_groups: null, assay_families: null },
    ]);
    expect(csv.split("\n")[0].split(",")).toEqual(STUDY_COLUMNS.map((c) => c.name));
    expect(csv).toContain('GSE1,"A ""big"", study",Homo sapiens,NCBITaxon:9606,2,70,');
  });
});

describe("the atlas document", () => {
  const stats = { studies_with_files: 1, samples_in_files: 2, cells_in_files: 70, geo_samples_known: 3, species_count: 1 };

  it("counts on the /api/stats basis and lists the downloadable studies only", async () => {
    const input = await loadAtlasInput(seed() as never, stats);
    expect(input.studies.map((s) => s.gse_id)).toEqual(["GSE1"]);
    expect(input.ancestry).toEqual([{ value: "European", ontology_id: "HANCESTRO:0005", n_samples: 1, n_studies: 1 }]);
    const doc = buildAtlasCroissant(input) as Json;
    expect(doc).toMatchObject({ "@id": "https://singlet.bio/croissant.json", version: "alpha-2026-10-27e", license: DATA_LICENSE, conformsTo: CROISSANT_SPEC });
    expect(doc.description).toContain("1 studies, 2 samples that passed QC and 70 called cells");
    expect(doc.recordSet[0].field.map((f: Json) => f.name)).toEqual(STUDY_COLUMNS.map((c) => c.name));
    expect(studiesCsv(input.studies).split("\n")[1]).toContain("https://singlet.bio/api/croissant/GSE1");
    const biases = atlasBiases(input);
    expect(biases[0]).toBe("Organism (share of 2 samples / 70 cells): Homo sapiens 100.0% / 100.0%.");
    expect(biases.join(" ")).toContain("2 samples passed QC, of 3 that GEO lists");
    expect(biases.join(" ")).toContain("European 1");
  });
});

describe("geneTable", () => {
  const DIR = "src/test/fixtures/s1/packs";
  const expected = JSON.parse(readFileSync(`${DIR}/expected.json`, "utf8")) as Record<string, { id: string; n: number; names: string[] }>;
  const fetchPack: PackFetcher = async (id) => new Uint8Array(readFileSync(`${DIR}/${id}.pack`));
  beforeEach(() => clearPackCache());

  for (const name of ["A", "B", "C"]) {
    it(`${name}: each gene owns a contiguous run of exon and intron rows, named after it`, async () => {
      const exon = expected[`${name}.exon`];
      const intron = expected[`${name}.intron`];
      const { genes } = await geneTable(fetchPack, exon.id);
      let e = 0;
      let i = 0;
      for (const g of genes) {
        expect(g.exon_row_first).toBe(e);
        const head = `${g.gene_id}_${g.symbol}_`;
        for (let r = g.exon_row_first; r <= g.exon_row_last; r++) expect(exon.names[r].startsWith(head), exon.names[r]).toBe(true);
        expect(exon.names[g.exon_row_first]).toContain(`${g.chromosome}:${g.start}-`);
        expect(exon.names[g.exon_row_last].endsWith(`-${g.end}`)).toBe(true);
        if (g.n_exons > 1) {
          expect(g.intron_row_first).toBe(i);
          for (let r = g.intron_row_first; r <= g.intron_row_last; r++) expect(intron.names[r].startsWith(`${head}intron_`)).toBe(true);
          i = g.intron_row_last + 1;
        } else {
          expect([g.intron_row_first, g.intron_row_last]).toEqual([-1, -1]);
        }
        e = g.exon_row_last + 1;
      }
      expect(e).toBe(exon.n);
      expect(i).toBe(intron.n);
      // the same names the MCP resolver gives
      const r = await resolveFeatureNames(fetchPack, exon.id, [genes[0].exon_row_first]);
      expect(r.names[0]!.startsWith(`${genes[0].gene_id}_`)).toBe(true);
    });
  }

  it("features.csv has one column per field", () => {
    const csv = featuresCsv("B1", [{ gene_id: "ENSG1", symbol: "A", chromosome: "chr1", start: 1, end: 9, n_exons: 1, exon_row_first: 0, exon_row_last: 0, intron_row_first: -1, intron_row_last: -1 }]);
    expect(csv).toBe(`${FEATURE_COLUMNS.map((c) => c.name).join(",")}\nENSG1,A,B1,chr1,1,9,1,0,0,-1,-1\n`);
  });
});

describe("routes", () => {
  function env() {
    return { DB: seed() };
  }
  function stubManifests() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const m = /\/s1\/m\/(GSE\d+)\.json$/.exec(String(url));
        const doc = m && manifests[m[1]];
        return doc ? new Response(JSON.stringify(doc), { status: 200 }) : new Response("no", { status: 404 });
      })
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = (fn: any, path: string, params: Record<string, string>, e = env()) =>
    fn({ request: new Request(`https://singlet.bio${path}`), env: e, params, waitUntil: () => undefined } as never) as Promise<Response>;

  it("answers a study as JSON-LD and a withheld or unknown one as 404", async () => {
    stubManifests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const e = env();
    const ok = await call(studyGet, "/api/croissant/GSE1", { id: "GSE1" }, e);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("application/ld+json");
    expect(((await ok.json()) as Json).name).toBe("GSE1, Singlet Research Alpha");
    expect((await call(studyGet, "/api/croissant/GSE2", { id: "GSE2" }, e)).status).toBe(404);
    expect((await call(studyGet, "/api/croissant/GSE77", { id: "GSE77" }, e)).status).toBe(404);
    expect((await call(studyGet, "/api/croissant/x", { id: "x" }, e)).status).toBe(400);
  });

  it("answers a served sample, and 404 for an excluded one", async () => {
    stubManifests();
    const e = env();
    expect((await call(sampleGet, "/api/croissant/GSE1/GSM1", { id: "GSE1", gsm: "GSM1" }, e)).status).toBe(200);
    expect((await call(sampleGet, "/api/croissant/GSE1/GSM3", { id: "GSE1", gsm: "GSM3" }, e)).status).toBe(404);
    expect((await call(sampleGet, "/api/croissant/GSE1/GSM2", { id: "GSE1", gsm: "GSM2" }, e)).status).toBe(404);
  });

  it("serves samples.csv as text/csv", async () => {
    stubManifests();
    const res = await call(samplesCsvGet, "/api/croissant/GSE1/samples.csv", { id: "GSE1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect((await res.text()).split("\n").length).toBe(4);
  });
});
