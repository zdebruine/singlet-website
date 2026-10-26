import { describe, expect, it } from "vitest";
import { evidenceHolds, extractSampleAttrs, parseAge, parsePairs, type AttrRow } from "../../functions/_shared/attr-extract";
import {
  approvedSamples,
  buildStudyCard,
  cellsLabel,
  groundingProblems,
  numbersOutsideEntities,
  platformLabel,
  sampleLine,
  SUMMARY_MAX_CHARS,
  type SampleInput,
  type StudyInput,
} from "../../functions/_shared/study-card";

/** A study as /api/gse/<id> returns it, reduced to what the card reads. */
function study(
  id: string,
  samples: (Partial<SampleInput> & { c?: string })[],
  opts: { organism?: string; unusable?: string[]; files?: string[] } = {},
): StudyInput {
  const organism = opts.organism ?? "Homo sapiens";
  return {
    series: { id, title: `${id} title`, abstract: "A paper abstract that the card never reads.", unusable_gsm_ids: opts.unusable ?? [] },
    meta: { organisms: [organism] },
    file_paths: opts.files ?? [],
    samples: samples.map((s, i) => {
      const { c, ...rest } = s;
      return {
        gsm_id: `GSM${1000000 + i}`,
        gse_id: id,
        organism_primary: organism,
        protocol: "10xv3",
        assay_family: "10x 3'",
        modality: "scRNA",
        n_cells: 4000,
        status: "DONE",
        title: `sample ${i + 1}`,
        source: null,
        characteristics_raw: c ?? null,
        low_qc: false,
        ...rest,
      };
    }),
  };
}

function rowsOf(input: StudyInput): AttrRow[] {
  return approvedSamples(input).flatMap((s) =>
    extractSampleAttrs({ gsm_id: s.gsm_id, gse_id: s.gse_id, title: s.title, source: s.source, characteristics: s.characteristics_raw, organism_primary: s.organism_primary }).rows,
  );
}

const cardOf = (input: StudyInput) => buildStudyCard(input, rowsOf(input));
const repeat = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

// ── fixtures: realistic studies ─────────────────────────────────────────────

const FIXTURES: Record<string, StudyInput> = {
  // 1. blood, one unmapped key (smoker): nothing invented from it
  smokers: study("GSE138867", repeat(8, (i) => ({ c: `tissue: Blood ;; smoker: ${i % 2 ? "no" : "yes"}`, n_cells: 5000 + i }))),
  // 2. adipose, obese vs lean, donors, ages, sex
  adipose: study(
    "GSE900001",
    repeat(12, (i) => ({
      c: `tissue: subcutaneous adipose tissue ;; disease state: ${i < 6 ? "obese" : "lean"} ;; age: ${30 + i} years ;; Sex: ${i % 2 ? "Female" : "Male"} ;; donor: D${i + 1}`,
      n_cells: 6700,
    })),
    { files: ["sex_call.json", "donor_assignments.tsv", "ancestry_call.json", "doublet_scores.tsv"] },
  ),
  // 3. mouse knockout vs wild type, age range in weeks
  knockout: study(
    "GSE900002",
    repeat(6, (i) => ({ c: `tissue: Spleen ;; genotype: ${i < 3 ? "WT" : "Ifnar1-/-"} ;; age: 8-12 weeks ;; strain: C57BL/6`, protocol: "10xv2" })),
    { organism: "Mus musculus", files: ["sex_call.json", "donor_assignments.tsv"] },
  ),
  // 4. cell line experiment, treated vs DMSO
  cellLine: study(
    "GSE900003",
    repeat(4, (i) => ({ c: `cell line: A549 ;; treatment: ${i < 2 ? "DMSO" : "dexamethasone 100 nM"} ;; time: 24 h` })),
  ),
  // 5. no characteristics at all
  bare: study("GSE900004", repeat(5, () => ({}))),
  // 6. several tissues
  multiTissue: study("GSE900005", [
    ...repeat(3, () => ({ c: "tissue: lung" })),
    ...repeat(3, () => ({ c: "tissue: liver" })),
    ...repeat(2, () => ({ c: "tissue: spleen" })),
    ...repeat(2, () => ({ c: "tissue: kidney" })),
  ]),
  // 7. one low-QC sample, which must not show up anywhere
  lowQc: study("GSE900006", [
    { c: "tissue: brain ;; disease: Alzheimer's disease" },
    { c: "tissue: brain ;; disease: Alzheimer's disease" },
    { c: "tissue: cerebellum ;; disease: Parkinson's disease", low_qc: true, n_cells: 90000 },
  ]),
  // 8. failed and empty samples
  failed: study(
    "GSE900007",
    [
      { c: "tissue: heart ;; treatment: isoproterenol" },
      { c: "tissue: heart ;; treatment: untreated" },
      { c: "tissue: eye ;; treatment: sham", status: "FAIL" },
      { c: "tissue: tongue ;; treatment: sham" },
    ],
    { unusable: ["GSM1000003"], organism: "Mus musculus" },
  ),
  // 9. time course
  timecourse: study("GSE900008", repeat(6, (i) => ({ c: `tissue: bone marrow ;; time point: ${[0, 6, 12][i % 3]} hours ;; treatment: LPS` }))),
  // 10. tissue stated for only some samples
  partial: study("GSE900009", [{ c: "tissue: colon" }, { c: "tissue: colon" }, { c: "batch: 2" }, {}]),
  // 11. sex split and ancestry
  ancestry: study("GSE900010", repeat(6, (i) => ({ c: `tissue: whole blood ;; gender: ${i < 4 ? "M" : "F"} ;; race: ${i < 3 ? "Caucasian" : "Asian"} ;; age at death: ${60 + i}` }))),
  // 12. 5' chemistry, nuclei, CD marker in the name (digits inside an entity)
  nuclei: study("GSE900011", repeat(3, () => ({ c: "tissue: PBMC ;; cell type: cd8 t cells", protocol: "10xv3_5prime", assay_family: "10x 5'", modality: "snRNA" }))),
  // 13. healthy donors, bare numeric ages (human, years assumed)
  healthy: study("GSE900012", repeat(4, (i) => ({ c: `disease: healthy donor ;; tissue: pancreas ;; age: ${[21, 34, 45, 52][i]}` }))),
  // 14. single sample
  single: study("GSE900013", [{ c: "tissue: retina", n_cells: 712 }]),
  // 15. many axes: summary must stay inside 600 characters
  crowded: study(
    "GSE900014",
    repeat(24, (i) => ({
      c: `tissue: kidney ;; disease: ${["Type 2 diabetes", "healthy", "Lupus nephritis", "Hypertension", "Cystic fibrosis", "Sepsis"][i % 6]} ;; treatment: ${["drug alpha", "drug beta", "drug gamma", "drug delta", "drug epsilon"][i % 5]} ;; genotype: ${["WT", "KO-1", "KO-2", "KO-3"][i % 4]} ;; time: ${i % 7} days ;; sex: ${i % 2 ? "male" : "female"}`,
    })),
  ),
  // 16. two platforms
  twoPlatforms: study("GSE900015", [
    { c: "tissue: tonsil", protocol: "10xv2" },
    { c: "tissue: tonsil", protocol: "10xv3", assay_family: "10x 3'" },
  ]),
};

describe("study card summaries", () => {
  it("states tissue, organism, count and platform, and says nothing about an unmapped key", () => {
    const c = cardOf(FIXTURES.smokers);
    expect(c.summary_text).toMatch(/^Blood from 8 human samples\./);
    expect(c.summary_text).toContain("10x 3' v3 scRNA-seq");
    expect(c.summary_text).not.toMatch(/smok/i);
    expect(c.n_samples).toBe(8);
  });

  it("describes a case/control donor study with age, sex and the file layers", () => {
    const c = cardOf(FIXTURES.adipose);
    expect(c.summary_text).toMatch(/^Subcutaneous adipose tissue from 12 human donors, aged 30 to 41 years\./);
    expect(c.summary_text).toContain("disease (obese 6, lean 6)");
    expect(c.summary_text).toContain("sex (male 6, female 6)");
    expect(c.summary_text).toContain("The file also has genetic sex, donor demultiplexing, genetic ancestry and doublet scores.");
    expect(c.donors).toEqual({ n_labeled: 12, n_samples: 12 });
    expect(c.grounded).toBe(true);
  });

  it("derives an adult life stage from human ages and does not repeat it next to the age range", () => {
    const c = cardOf(FIXTURES.healthy);
    expect(c.life_stages).toEqual([{ value: "adult", n: 4 }]);
    expect(c.summary_text).toMatch(/^Pancreas from 4 human samples, aged 21 to 52 years\./);
    expect(c.summary_text).toContain("All samples: healthy");
  });

  it("separates wild type and knockout mice and gives the age range with its unit", () => {
    const c = cardOf(FIXTURES.knockout);
    expect(c.summary_text).toMatch(/^Spleen from 6 mouse samples, aged 10 weeks\./);
    expect(c.summary_text).toContain("genotype (wild type 3, Ifnar1-/- 3)");
    expect(c.platforms).toEqual([{ value: "10x 3' v2 scRNA-seq", n: 6 }]);
    // sex_call.json is in the file but its mouse calls are all "unknown", so it is not listed as a layer.
    expect(c.layers).toEqual(["donor demultiplexing"]);
  });

  it("reports a cell line experiment with treatment and vehicle groups", () => {
    const c = cardOf(FIXTURES.cellLine);
    expect(c.summary_text).toContain("(cell line)");
    expect(c.summary_text).toContain("treatment (DMSO 2, dexamethasone 100 nM 2)");
    expect(c.summary_text).toContain("time point: 24 hours");
    expect(c.caveats).toContain("cell line only");
  });

  it("says what is missing when the records carry no fields", () => {
    const c = cardOf(FIXTURES.bare);
    expect(c.summary_text).toContain("Data from 5 human samples.");
    expect(c.summary_text).toContain("carry no tissue, disease, treatment, genotype, sex or age fields");
    expect(c.caveats).toContain("tissue not stated");
    expect(c.grounded).toBe(true);
  });

  it("lists a few tissues, names the many, and keeps counts on the tissue axis", () => {
    const c = cardOf(FIXTURES.multiTissue);
    expect(c.n_tissues).toBe(4);
    expect(c.summary_text).toMatch(/^4 tissues \(lung, liver, spleen and others\) from 10 human samples\./);
    expect(c.summary_text).toContain("tissue (lung 3, liver 3, spleen 2, kidney 2)");
  });

  it("never counts or mentions a low-QC sample", () => {
    const c = cardOf(FIXTURES.lowQc);
    expect(c.n_samples).toBe(2);
    expect(c.n_cells).toBe(8000);
    const text = JSON.stringify(c).toLowerCase();
    expect(text).not.toContain("cerebellum");
    expect(text).not.toContain("parkinson");
    expect(text).not.toMatch(/low qc|low-qc|failed|removed/);
    expect(c.summary_text).toContain("alzheimer's disease");
  });

  it("drops failed and unusable samples before reading any fact", () => {
    const c = cardOf(FIXTURES.failed);
    expect(c.n_samples).toBe(2);
    expect(c.tissues).toEqual([{ value: "heart", n: 2 }]);
    expect(c.summary_text).not.toMatch(/eye|tongue|sham/);
    expect(c.summary_text).toContain("treatment (isoproterenol 1, untreated 1)");
  });

  it("reads a time course as groups, with the unit", () => {
    const c = cardOf(FIXTURES.timecourse);
    expect(c.summary_text).toContain("time point (0 hours 2, 6 hours 2, 12 hours 2)");
    expect(c.summary_text).toContain("treatment: LPS");
  });

  it("marks a fact that only some samples carry instead of implying it for all", () => {
    const c = cardOf(FIXTURES.partial);
    expect(c.coverage.tissue).toBe(2);
    expect(c.summary_text).toMatch(/^Data from 4 human samples\./);
    expect(c.summary_text).toContain("tissue (colon 2, not stated 2)");
  });

  it("reports sex and reported ancestry as counts and does not mix them with genetic calls", () => {
    const c = cardOf(FIXTURES.ancestry);
    expect(c.summary_text).toContain("sex (male 4, female 2)");
    expect(c.summary_text).toContain("ancestry (white 3, asian 3)");
    expect(c.summary_text).not.toMatch(/genetic/);
  });

  it("keeps digits that belong to an entity name out of the number check", () => {
    const c = cardOf(FIXTURES.nuclei);
    expect(c.summary_text).toContain("10x 5' v3 snRNA-seq");
    expect(c.summary_text).toContain("cell type: cd8 t cell");
    expect(c.grounded).toBe(true);
    expect(numbersOutsideEntities(c.summary_text, c).sort()).toEqual([3]);
  });

  it("handles a single sample with an exact cell count", () => {
    const c = cardOf(FIXTURES.single);
    expect(c.summary_text).toBe("Retina from 1 human sample. 10x 3' v3 scRNA-seq, 712 cells.");
  });

  it("stays within 600 characters when many axes compete", () => {
    const c = cardOf(FIXTURES.crowded);
    expect(c.axes.length).toBeGreaterThan(3);
    expect(c.summary_text.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(c.summary_text.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(4);
    expect(c.grounded).toBe(true);
  });

  it("lists each platform with its sample count", () => {
    const c = cardOf(FIXTURES.twoPlatforms);
    expect(c.summary_text).toContain("10x 3' v2 scRNA-seq (1), 10x 3' v3 scRNA-seq (1)");
  });
});

describe("grounding", () => {
  it("grounds every fixture and holds the invariants (<= 600 characters, no stray numbers, 2 to 4 sentences)", () => {
    for (const [name, input] of Object.entries(FIXTURES)) {
      const rows = rowsOf(input);
      const c = buildStudyCard(input, rows);
      expect(c.grounded, `${name}: ${c.ungrounded.join("; ")}`).toBe(true);
      expect(c.summary_text.length, name).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
      const sentences = c.summary_text.split(/(?<=\.)\s+(?=[A-Z0-9])/);
      expect(sentences.length, name).toBeGreaterThanOrEqual(2);
      expect(sentences.length, name).toBeLessThanOrEqual(4);
      for (const r of rows) {
        const s = input.samples.find((x) => x.gsm_id === r.gsm_id)!;
        expect(evidenceHolds(r, { title: s.title, source: s.source, characteristics: s.characteristics_raw }), `${name} ${r.gsm_id} ${r.attr}`).toBe(true);
      }
    }
  });

  it("is not grounded when a row's evidence is not in the sample's text", () => {
    const input = FIXTURES.smokers;
    const rows = rowsOf(input).map((r, i) => (i === 0 ? { ...r, evidence: "tissue: Liver" } : r));
    const c = buildStudyCard(input, rows);
    expect(c.grounded).toBe(false);
    expect(c.ungrounded[0]).toContain("evidence is not in the sample text");
  });

  it("is not grounded when the summary holds a number the card does not", () => {
    const input = FIXTURES.smokers;
    const rows = rowsOf(input);
    const c = buildStudyCard(input, rows);
    const forged = { ...c, summary_text: c.summary_text.replace("8 human", "80 human") };
    expect(groundingProblems(forged, input, rows).join(" ")).toContain("number 80 is not in the card");
  });

  it("is not grounded when a layer has no file behind it", () => {
    const input = FIXTURES.adipose;
    const rows = rowsOf(input);
    const c = buildStudyCard(input, rows);
    const noFiles = { ...input, file_paths: [] };
    expect(groundingProblems(c, noFiles, rows).join(" ")).toContain('layer "genetic sex" has no file');
  });

  it("has no summary and is not grounded when no sample is approved", () => {
    const input = study("GSE900099", [{ status: "FAIL" }, { low_qc: true }]);
    const c = cardOf(input);
    expect(c.summary_text).toBe("");
    expect(c.grounded).toBe(false);
    expect(c.ungrounded).toEqual(["no approved samples"]);
  });

  it("is deterministic", () => {
    const a = JSON.stringify(cardOf(FIXTURES.crowded));
    const b = JSON.stringify(cardOf(FIXTURES.crowded));
    expect(a).toBe(b);
  });
});

describe("per-sample lines", () => {
  it("lists only the facts a sample has", () => {
    const input = FIXTURES.adipose;
    const rows = rowsOf(input);
    const s = approvedSamples(input)[0];
    expect(sampleLine(s, rows)).toBe("subcutaneous adipose tissue; obese; age 30 years; male; donor D1; 10x 3' v3 scRNA-seq; 6,700 cells");
  });

  it("is just platform and cells for a sample with no fields", () => {
    const input = FIXTURES.bare;
    expect(sampleLine(approvedSamples(input)[0], [])).toBe("10x 3' v3 scRNA-seq; 4,000 cells");
  });
});

describe("helpers", () => {
  it("labels platforms from protocol, assay family and modality", () => {
    expect(platformLabel("10xv3", "10x 3'", "scRNA")).toBe("10x 3' v3 scRNA-seq");
    expect(platformLabel("10x-3p-v2", "10x 3'", "")).toBe("10x 3' v2");
    expect(platformLabel("10xv3_5prime", "10x 5'", "snRNA")).toBe("10x 5' v3 snRNA-seq");
    expect(platformLabel("10x_suspect", "10x (version unconfirmed)", "scRNA")).toBe("10x scRNA-seq");
    expect(platformLabel("citeseq", "CITE-seq", "multiome")).toBe("CITE-seq");
    expect(platformLabel("unknown", "Unknown", "")).toBeNull();
    expect(platformLabel("bulk_rnaseq", "Not single-cell RNA", "non_rna")).toBeNull();
  });

  it("rounds cell counts to two figures", () => {
    expect(cellsLabel(712)).toBe("712");
    expect(cellsLabel(46741)).toBe("47k");
    expect(cellsLabel(4148)).toBe("4.1k");
    expect(cellsLabel(241744840)).toBe("240M");
    expect(cellsLabel(0)).toBeNull();
  });
});

describe("GEO fact extraction", () => {
  const ex = (c: string, extra: Record<string, unknown> = {}) =>
    extractSampleAttrs({ gsm_id: "GSM1", gse_id: "GSE1", characteristics: c, organism_primary: "Homo sapiens", ...extra });
  const get = (c: string, attr: string, extra: Record<string, unknown> = {}) => ex(c, extra).rows.find((r) => r.attr === attr);

  it("keeps the original key: value segment as evidence", () => {
    const r = get("Tissue: Kidney Cortex ;; Sex: F", "tissue")!;
    expect(r.evidence).toBe("Tissue: Kidney Cortex");
    expect(r.value_raw).toBe("Kidney Cortex");
  });

  it("normalises sex, treats unknown as absent and leaves odd values for the model", () => {
    expect(get("sex: M", "sex")!.value_norm).toBe("male");
    expect(get("gender: female", "sex")!.value_norm).toBe("female");
    expect(get("sex: unknown", "sex")).toBeUndefined();
    const e = ex("sex: M/F pooled?");
    expect(e.rows.find((r) => r.attr === "sex")).toBeUndefined();
    expect(e.unplaced[0]).toMatchObject({ attr: "sex", value: "M/F pooled?" });
  });

  it("parses age ranges, week-old forms and year-month pairs", () => {
    expect(parseAge("8-12 weeks", "age", "Mus musculus")).toMatchObject({ num: 10, unit: "weeks" });
    expect(parseAge("6-week-old", "age", "Mus musculus")).toMatchObject({ num: 6, unit: "weeks" });
    expect(parseAge("2 Yrs 11 Mos", "age", "Homo sapiens")).toMatchObject({ unit: "years" });
    expect(parseAge("E14.5", "age", "Mus musculus")).toMatchObject({ num: 14.5, unit: "E-days" });
    expect(parseAge("36", "age", "Homo sapiens")).toMatchObject({ num: 36, unit: "years", confidence: 0.75 });
    expect(parseAge("36", "age", "Mus musculus")).toMatchObject({ unit: null });
    expect(parseAge("36, 67, 57, 80", "age", "Homo sapiens")).toBeNull();
  });

  it("writes one unit in the singular", () => {
    expect(get("days of differentiation: 1", "timepoint")!.value_norm).toBe("1 day");
    expect(get("time point: 6 days", "timepoint")!.value_norm).toBe("6 days");
    expect(get("age: 1 year", "age")!.value_norm).toBe("1 year");
  });

  it("maps untreated and vehicle values and pairs treatment with a status", () => {
    expect(get("treatment: untreated", "treatment")!.value_norm).toBe("none");
    expect(get("treatment: untreated", "treatment_status")!.value_norm).toBe("untreated");
    expect(get("treatment: DMSO", "treatment_status")!.value_norm).toBe("vehicle");
    const t = ex("treatment: IL-2 10 ng/ml");
    expect(t.rows.find((r) => r.attr === "treatment_status")!.value_norm).toBe("treated");
    expect(t.unplaced.map((u) => u.attr)).toContain("treatment");
  });

  it("reads a tumor flag in 'tissue type' as a disease state, not a tissue", () => {
    const e = ex("tissue type: tumor ;; tissue: colon");
    expect(e.rows.find((r) => r.attr === "disease_state")!.value_norm).toBe("case");
    expect(e.rows.find((r) => r.attr === "tissue")!.value_norm).toBe("colon");
  });

  it("takes the tissue from the source field only when it names exactly one", () => {
    expect(get("", "tissue", { source: "Human blood cells from a smoking adult" })!.value_norm).toBe("blood");
    expect(get("", "tissue", { source: "pig testis" })!.value_norm).toBe("testis");
    expect(get("", "tissue", { source: "liver and spleen" })).toBeUndefined();
    expect(get("", "tissue", { source: "Cardiomyocyte" })).toBeUndefined();
    expect(get("tissue: lung", "tissue", { source: "spleen" })!.value_norm).toBe("lung");
  });

  it("does not turn a tissue named in a cell line field into a cell line", () => {
    expect(get("cell line: HEK293T", "sample_type")!.value_norm).toBe("cell line");
    expect(get("cell line: liver", "sample_type")).toBeUndefined();
  });

  it("parses delimited and JSON characteristics alike", () => {
    expect(parsePairs("tissue: lung ;; age: 4").map((p) => p.key)).toEqual(["tissue", "age"]);
    expect(parsePairs({ Tissue: "lung" })[0]).toMatchObject({ key: "tissue", value: "lung" });
  });

  it("ignores sentences in label fields and placeholder values", () => {
    const e = ex("tissue: Photoconverted CD4+ T cells isolated from the draining lymph node after immunisation ;; disease: NA ;; cell type: all cells");
    expect(e.rows).toHaveLength(0);
    expect(e.unplaced.map((u) => u.attr)).toEqual(["tissue"]);
  });
});
