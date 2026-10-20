// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalCohort, cohortFromParams, CohortError, cohortMask, parseCohortQuery, resolveCohort } from "../../functions/_shared/cohort-core";
import { setBitIndex } from "../../functions/_shared/cohort-index";
import { onRequestGet, onRequestPost } from "../../functions/api/cohort/resolve";
import { createTestD1 } from "./helpers/d1-sqlite";
import { indexOf, sample } from "./helpers/bitindex-fixture";

// GSE1: GSM1 brain/adult/untreated/2020, GSM2 brain/adult/treated (model 0.9), GSM3 blood, no life stage
// GSE2: GSM4 brain, life stage from a low-confidence model, GSM5 low QC (tier 1), GSM6 not downloadable
// GSE3: GSM7 mouse
const rows = [
  sample("GSE1", 1, { tissue_group: "Brain", life_stage: "adult", treatment_status: "untreated", year: 2020, age: 40 }, 3000),
  sample("GSE1", 2, { tissue_group: "Brain", life_stage: "adult", treatment_status: { v: "treated", s: "model", c: 0.9 }, year: 2020, age: 50 }, 2000),
  sample("GSE1", 3, { tissue_group: "Blood", year: 2020 }, 1000),
  sample("GSE2", 4, { tissue_group: "Brain", life_stage: { v: "adult", s: "model", c: 0.5 }, treatment_status: { v: "treated", s: "model", c: 0.5 }, year: 2015 }, 400),
  sample("GSE2", 5, { tissue_group: "Brain", life_stage: "adult", qc_tier: "1", year: 2015 }, 600),
  sample("GSE2", 6, { tissue_group: "Brain", life_stage: "adult", downloadable: "", year: 2015 }, 700),
  sample("GSE3", 7, { organism: "Mus musculus", tissue_group: "Brain", life_stage: "adult", year: 2022 }, 5000),
];
const { index } = indexOf(rows);
const q = (o: object) => parseCohortQuery(o);
const samplesOf = (query: object) => resolveCohort(index, q(query)).totals;

describe("parseCohortQuery", () => {
  it("applies defaults", () => {
    const p = q({});
    expect(p).toMatchObject({ version: 1, include: [], exclude: [], level: "sample", require: { min_cells: 0, qc_tier: [0] }, sources: ["geo", "pipeline", "model>=0.8"] });
  });
  it("names the offending token on a 400", () => {
    const fail = (o: unknown) => {
      try {
        parseCohortQuery(o);
      } catch (e) {
        expect(e).toBeInstanceOf(CohortError);
        return e as CohortError;
      }
      throw new Error("did not throw");
    };
    expect(fail({ include: [{ attr: "tissue_grp", any: ["x"] }] }).token).toBe("tissue_grp");
    expect(fail({ include: [{ attr: "organism" }] }).message).toMatch(/any/);
    expect(fail({ include: [{ attr: "year", any: ["2020"] }] }).message).toMatch(/numeric/);
    expect(fail({ include: [{ attr: "year", num: { min: 5, max: 1 } }] }).message).toMatch(/above/);
    expect(fail({ sources: ["geo", "llm"] }).token).toBe("llm");
    expect(fail({ level: "cell" }).message).toMatch(/per-cell labels/);
    expect(fail({ require: { qc_tier: 2 } }).message).toMatch(/never/);
    expect(fail({ version: 2 }).token).toBe("version");
    expect(fail([]).message).toMatch(/object/);
  });
  it("reads flat GET parameters", () => {
    const u = new URL("https://x/api/cohort/resolve?tissue_group=Brain,Blood&not_treatment_status=treated&year_min=2020&min_cells=500&include_low_qc=1&sources=geo");
    const p = parseCohortQuery(cohortFromParams(u));
    expect(p.include).toEqual([
      { attr: "tissue_group", any: ["Brain", "Blood"] },
      { attr: "year", num: { min: 2020, max: null } },
    ]);
    expect(p.exclude).toEqual([{ attr: "treatment_status", any: ["treated"] }]);
    expect(p.require).toEqual({ min_cells: 500, min_samples_per_study: 0, qc_tier: [0, 1] });
    expect(p.sources).toEqual(["geo"]);
  });
  it("gives the same canonical text for reordered queries", () => {
    const a = q({ include: [{ attr: "tissue_group", any: ["Brain", "blood"] }, { attr: "organism", any: ["Homo sapiens"] }] });
    const b = q({ include: [{ attr: "organism", any: ["homo sapiens"] }, { attr: "tissue_group", any: ["Blood", "brain"] }] });
    expect(canonicalCohort(a)).toBe(canonicalCohort(b));
    expect(canonicalCohort(a)).not.toBe(canonicalCohort(q({ include: [{ attr: "organism", any: ["Mus musculus"] }] })));
  });
});

describe("resolveCohort", () => {
  it("counts only what a visitor can download by default", () => {
    // GSM5 is low QC, GSM6 is in a study that is not downloadable
    expect(samplesOf({})).toEqual({ studies: 3, samples: 5, cells: 3000 + 2000 + 1000 + 400 + 5000, basis: "file" });
    expect(resolveCohort(index, q({})).base.length).toBe(3);
  });

  it("adds low-QC samples back on request, never removed ones", () => {
    expect(samplesOf({ require: { qc_tier: [0, 1] } }).samples).toBe(6);
  });

  it("ANDs clauses and ORs values", () => {
    expect(samplesOf({ include: [{ attr: "organism", any: ["Homo sapiens"] }, { attr: "tissue_group", any: ["Brain", "Blood"] }] }).samples).toBe(4);
    expect(samplesOf({ include: [{ attr: "organism", any: ["Homo sapiens"] }, { attr: "tissue_group", any: ["Brain"] }] }).samples).toBe(3);
  });

  it("an include needs a fact: unknown does not match, and is counted", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "life_stage", any: ["adult"] }, { attr: "organism", any: ["Homo sapiens"] }] }));
    // GSM3 has no life stage; GSM4's is a model fact at 0.5, below the default 0.8 gate.
    expect(r.totals.samples).toBe(2);
    expect(r.unknown_by_attr.life_stage).toBe(2);
  });

  it("an exclude removes only samples known to match, not unknown ones", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "tissue_group", any: ["Brain"] }, { attr: "organism", any: ["Homo sapiens"] }], exclude: [{ attr: "treatment_status", any: ["treated"] }] }));
    // GSM2 is treated (0.9, visible); GSM4's 0.5 treated fact is gated out so it stays; GSM1 untreated stays.
    expect(r.totals.samples).toBe(2);
    expect(r.unknown_by_attr.treatment_status).toBe(1); // GSM4
    const withLow = resolveCohort(index, q({ include: [{ attr: "tissue_group", any: ["Brain"] }, { attr: "organism", any: ["Homo sapiens"] }], exclude: [{ attr: "treatment_status", any: ["treated"] }], sources: ["geo", "pipeline", "model"] }));
    expect(withLow.totals.samples).toBe(1);
  });

  it("source gating changes what includes match", () => {
    const base = { include: [{ attr: "life_stage", any: ["adult"] }, { attr: "organism", any: ["Homo sapiens"] }] };
    expect(samplesOf({ ...base, sources: ["geo"] }).samples).toBe(2);
    expect(samplesOf({ ...base, sources: ["geo", "model"] }).samples).toBe(3);
    expect(samplesOf({ ...base, sources: ["pipeline"] }).samples).toBe(0);
  });

  it("answers numeric ranges and reports the snapped bins", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "year", num: { min: 2020, max: 2020 } }] }));
    expect(r.totals.samples).toBe(3);
    expect(r.snapped).toEqual([{ clause: "include[0] year", attr: "year", min: 2020, max: 2021 }]);
    expect(samplesOf({ include: [{ attr: "age", num: { min: 45, max: 60 } }] }).samples).toBe(1);
    expect(samplesOf({ include: [{ attr: "year", num: { max: 2015 } }] }).samples).toBe(1); // GSM4 only; GSM5/6 are gated out
  });

  it("applies exact cell floors and per-study sample floors", () => {
    expect(samplesOf({ require: { min_cells: 2000 } }).samples).toBe(3); // 3000, 2000, 5000
    expect(samplesOf({ require: { min_cells: 2001 } }).samples).toBe(2);
    const r = resolveCohort(index, q({ include: [{ attr: "organism", any: ["Homo sapiens"] }], require: { min_samples_per_study: 2 } }));
    expect(r.totals).toMatchObject({ studies: 1, samples: 3 }); // GSE2 has one downloadable sample left
  });

  it("reports unmatched values instead of failing", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "tissue_group", any: ["Brain", "Spleen"] }, { attr: "organism", any: ["Homo sapiens"] }] }));
    expect(r.unmatched).toEqual([{ clause: "include[0] tissue_group", value: "Spleen" }]);
    expect(r.totals.samples).toBe(3);
    expect(samplesOf({ include: [{ attr: "tissue_group", any: ["Spleen"] }] }).samples).toBe(0);
  });

  it("gives what_if counts per clause without changing the query", () => {
    const query = q({ include: [{ attr: "organism", any: ["Homo sapiens"] }, { attr: "tissue_group", any: ["Blood"] }], exclude: [{ attr: "treatment_status", any: ["treated"] }] });
    const r = resolveCohort(index, query);
    expect(r.totals.samples).toBe(1);
    const by = Object.fromEntries(r.what_if.map((w) => [w.clause, w]));
    expect(by["include[0] organism"].samples).toBe(1); // dropping organism adds nothing: the mouse sample is not blood
    expect(by["include[1] tissue_group"]).toMatchObject({ samples: 3, studies: 2, gain_samples: 2 });
    expect(by["exclude[0] treatment_status"].samples).toBe(1);
    expect(r.query.include.length).toBe(2);
  });

  it("builds facets over the included set with unknown counts", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "organism", any: ["Homo sapiens"] }] }));
    const ts = r.facets.tissue_group;
    expect(ts.values).toEqual([{ value: "Brain", n: 3 }, { value: "Blood", n: 1 }]);
    expect(ts.unknown).toBe(0);
    expect(r.facets.organism.constrained).toBe(true);
    expect(r.facets.life_stage.unknown).toBe(2); // GSM3 and GSM4
    expect(r.unknown_by_attr.life_stage).toBe(2);
    expect(r.facets.year.values.map((v) => v.value)).toEqual(["2015-2016", "2020-2021"]);
  });

  it("flags mixed states the query did not constrain", () => {
    const r = resolveCohort(index, q({ include: [{ attr: "tissue_group", any: ["Brain"] }, { attr: "organism", any: ["Homo sapiens"] }], sources: ["geo", "pipeline", "model"] }));
    expect(r.ambiguities.map((a) => a.attr)).toContain("treatment_status");
    const constrained = resolveCohort(index, q({ include: [{ attr: "treatment_status", any: ["untreated", "treated"] }], sources: ["geo", "pipeline", "model"] }));
    expect(constrained.ambiguities.map((a) => a.attr)).not.toContain("treatment_status");
  });

  it("lists studies by cells and truncates", () => {
    const r = resolveCohort(index, q({}), { studyLimit: 2 });
    expect(r.studies).toEqual([{ gse_id: "GSE3", n_samples: 1, n_cells: 5000 }, { gse_id: "GSE1", n_samples: 3, n_cells: 6000 }].sort((a, b) => b.n_cells - a.n_cells));
    expect(r.studies_truncated).toBe(true);
  });

  it("returns the sample mask for the manifest", () => {
    const { mask, summary } = cohortMask(index, q({ include: [{ attr: "tissue_group", any: ["Blood"] }] }));
    expect(index.indices(mask).length).toBe(1);
    expect(summary.cells).toBe(1000);
  });
});

describe("/api/cohort/resolve", () => {
  beforeEach(() => {
    setBitIndex(index);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    setBitIndex(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const env = () => ({ DB: createTestD1() }) as never;
  const call = (req: Request, handler = onRequestGet) => handler({ request: req, env: env(), waitUntil: () => undefined } as never);

  it("answers a GET with the resolution", async () => {
    const res = await call(new Request("https://singlet.bio/api/cohort/resolve?organism=Homo%20sapiens&tissue_group=Brain"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { totals: { samples: number }; index: { version: string } };
    expect(j.totals.samples).toBe(3);
    expect(j.index.version).toMatch(/^20261020-/);
  });

  it("answers a POST with the query as the body", async () => {
    const res = await call(new Request("https://singlet.bio/api/cohort/resolve?what_if=0", { method: "POST", body: JSON.stringify({ include: [{ attr: "organism", any: ["Mus musculus"] }] }) }), onRequestPost);
    const j = (await res.json()) as { totals: { samples: number }; what_if: unknown[] };
    expect(j.totals.samples).toBe(1);
    expect(j.what_if).toEqual([]);
  });

  it("returns 400 with the token for a bad query", async () => {
    const res = await call(new Request("https://singlet.bio/api/cohort/resolve?query=" + encodeURIComponent(JSON.stringify({ include: [{ attr: "nope", any: ["x"] }] }))));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ token: "nope" });
    const bad = await call(new Request("https://singlet.bio/api/cohort/resolve", { method: "POST", body: "{" }), onRequestPost);
    expect(bad.status).toBe(400);
  });

  it("says so when no index is published", async () => {
    setBitIndex(null);
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const res = await call(new Request("https://singlet.bio/api/cohort/resolve", { method: "POST", body: "{}" }), onRequestPost);
    expect(res.status).toBe(503);
  });
});
