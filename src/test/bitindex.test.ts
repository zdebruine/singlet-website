// @vitest-environment node
import { describe, expect, it } from "vitest";
import { andInto, andNotInto, loadBitIndex, orInto, parseSources, popcount, popcount32, type IndexDict } from "../../functions/_shared/bitindex";
import { buildBitIndex } from "../../functions/_shared/bitindex-build";
import { ATTRS, TIER_BIT } from "../../functions/_shared/cohort-schema";
import { cohortMask, parseCohortQuery, resolveCohort } from "../../functions/_shared/cohort-core";
import { indexOf, sample, syntheticRows } from "./helpers/bitindex-fixture";

const ALL_SOURCES = 15;
const bits = (m: Uint32Array) => {
  const out: number[] = [];
  for (let i = 0; i < m.length * 32; i++) if (m[i >>> 5] & (1 << (i & 31))) out.push(i);
  return out;
};

// Samples are stored sorted by (GSE, GSM): GSM1..GSM6 below are indexes 0..5.
const rows = [
  sample("GSE1", 1, { tissue_group: "Brain", sex: "female", age: 30 }),
  sample("GSE1", 2, { tissue_group: "Brain", sex: "male", age: 70 }),
  sample("GSE1", 3, { tissue_group: "Blood", age: 5 }),
  sample("GSE2", 4, { tissue_group: ["Blood", "Brain"], sex: { v: "female", s: "model", c: 0.9 } }),
  sample("GSE2", 5, { sex: { v: "male", s: "model", c: 0.4 }, layer: ["snps", "vdj"] }),
  sample("GSE2", 6, { tissue_group: "Lung", sex_genetic: { v: "female", s: "pipeline" } }),
];

describe("popcount and word ops", () => {
  it("counts bits", () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0x80000001)).toBe(2);
    expect(popcount(Uint32Array.of(0xf0f0f0f0, 1, 0))).toBe(17);
  });
  it("ANDs, ORs and ANDNOTs in place", () => {
    const a = Uint32Array.of(0b1100, 0xff);
    const b = Uint32Array.of(0b1010, 0x0f);
    expect([...andInto(Uint32Array.from(a), b)]).toEqual([0b1000, 0x0f]);
    expect([...orInto(Uint32Array.from(a), b)]).toEqual([0b1110, 0xff]);
    expect([...andNotInto(Uint32Array.from(a), b)]).toEqual([0b0100, 0xf0]);
  });
});

describe("BitIndex", () => {
  const { index } = indexOf(rows);

  it("holds samples sorted by study and accession", () => {
    expect(index.n).toBe(6);
    expect(index.studies).toEqual(["GSE1", "GSE2"]);
    expect(index.gsmId(3)).toBe("GSM4");
    expect(index.gseOf(5)).toBe("GSE2");
    expect(index.cellsOf(0)).toBe(1000);
  });

  it("OR within an attribute, AND across", () => {
    const brainOrBlood = index.valueMask("tissue_group", [index.valueId("tissue_group", "brain"), index.valueId("tissue_group", "BLOOD")], ALL_SOURCES);
    expect(bits(brainOrBlood)).toEqual([0, 1, 2, 3]);
    const brain = index.valueMask("tissue_group", [index.valueId("tissue_group", "Brain")], ALL_SOURCES);
    const female = index.valueMask("sex", [index.valueId("sex", "female")], ALL_SOURCES);
    expect(bits(andInto(Uint32Array.from(brain), female))).toEqual([0, 3]);
  });

  it("NOT stays inside the sample range", () => {
    const brain = index.valueMask("tissue_group", [index.valueId("tissue_group", "Brain")], ALL_SOURCES);
    expect(bits(index.not(brain))).toEqual([2, 4, 5]);
    expect(popcount(index.not(index.all()))).toBe(0);
    expect(popcount(index.all())).toBe(6);
  });

  it("separates unknown from a known non-match", () => {
    const known = index.known("tissue_group", ALL_SOURCES);
    expect(bits(known)).toEqual([0, 1, 2, 3, 5]); // sample 4 (GSM5) has no tissue group
    const f = index.facet("tissue_group", index.all(), ALL_SOURCES);
    expect(f.unknown).toBe(1);
    expect(f.values.map((v) => [v.value, v.n])).toEqual([["Blood", 2], ["Brain", 3], ["Lung", 1]].sort((a, b) => (b[1] as number) - (a[1] as number) || (a[0] as string).localeCompare(b[0] as string)));
  });

  it("gates by source, and core attributes ignore the gate", () => {
    const declared = parseSources(["geo", "pipeline"]).mask;
    const sexModel = (mask: number) => bits(index.valueMask("sex", [index.valueId("sex", "female"), index.valueId("sex", "male")], mask));
    expect(sexModel(declared)).toEqual([0, 1]); // model rows are invisible
    expect(sexModel(parseSources(["geo", "model>=0.8"]).mask)).toEqual([0, 1, 3]); // 0.9 counts, 0.4 does not
    expect(sexModel(parseSources(["geo", "model"]).mask)).toEqual([0, 1, 3, 4]);
    // sex_genetic is a pipeline fact: gone when only geo is allowed.
    const genetic = (m: number) => bits(index.valueMask("sex_genetic", [index.valueId("sex_genetic", "female")], m));
    expect(genetic(TIER_BIT.geo)).toEqual([]);
    expect(genetic(TIER_BIT.pipeline)).toEqual([5]);
    // organism is core: still there with no source allowed.
    expect(bits(index.valueMask("organism", [index.valueId("organism", "Homo sapiens")], 0))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("parses source strings", () => {
    expect(parseSources(undefined)).toEqual({ mask: 1 | 2 | 4, bad: [] });
    expect(parseSources(["model>=0.95"]).mask).toBe(4);
    expect(parseSources(["model>=0.5"]).mask).toBe(12);
    expect(parseSources(["geo", "bogus"]).bad).toEqual(["bogus"]);
  });

  it("holds several values per sample in a multi-valued attribute", () => {
    const m = (v: string) => bits(index.valueMask("layer", [index.valueId("layer", v)], ALL_SOURCES));
    expect(m("snps")).toEqual([4]);
    expect(m("vdj")).toEqual([4]);
    expect(() => index.codeAt("layer", 0)).toThrow(/several values/);
  });

  it("answers numeric ranges from bins, snapping outward", () => {
    // age bins: ... 25-35, 35-45, 45-55, 55-65, 65-75, 75-85, 85+ ; 5 sits in 3-6
    const r = index.rangeMask("age", 30, 70, ALL_SOURCES);
    expect(bits(r.mask)).toEqual([0, 1]); // 30 in 25-35, 70 in 65-75
    expect(r.snapped).toEqual([25, 75]);
    expect(bits(index.rangeMask("age", null, 5, ALL_SOURCES).mask)).toEqual([2]);
    expect(bits(index.rangeMask("age", 76, null, ALL_SOURCES).mask)).toEqual([]);
    expect(bits(index.rangeMask("age", 0, null, ALL_SOURCES).mask)).toEqual([0, 1, 2]);
    // Samples without an age are in no bin.
    expect(bits(index.known("age", ALL_SOURCES))).toEqual([0, 1, 2]);
  });

  it("keeps a code column per single-valued attribute", () => {
    expect(index.valueAt("tissue_group", 0)).toBe("Brain");
    expect(index.valueAt("tissue_group", 4)).toBeNull();
    // The lowest-tier fact is the code: a geo value over a model one for the same attribute.
    const both = indexOf([sample("GSE9", 9, { sex: [{ v: "male", s: "model", c: 0.99 }, { v: "female", s: "geo" }] })]).index;
    expect(both.valueAt("sex", 0)).toBe("female");
  });

  it("ranks by cosine over the code columns", () => {
    const top = index.rank(index.all(), [{ attr: "tissue_group", values: ["Brain"] }, { attr: "sex", values: ["female"] }], 3);
    expect(top[0].index).toBe(0); // brain and female
    expect(top[0].score).toBeCloseTo(1);
    expect(top.map((t) => t.index)).toContain(1); // brain, male: half the weight
    expect(top.every((t, i) => i === 0 || top[i - 1].score >= t.score)).toBe(true);
    expect(() => index.rank(index.all(), [{ attr: "layer", values: ["snps"] }], 3)).toThrow();
  });

  it("stores rare values as id lists and common ones as words", () => {
    const rowsMany = Array.from({ length: 640 }, (_, i) => sample("GSE5", 100 + i, i % 2 === 0 ? { sex: "male" } : i === 1 ? { sex: "female" } : {}));
    const { bin, dict } = buildBitIndex(rowsMany, ATTRS);
    const sex = dict.attrs.find((a) => a.key === "sex")!;
    const words = dict.words;
    const male = sex.tiers[0].find((t) => dict.attrs.find((a) => a.key === "sex")!.values[t[0]] === "male")!;
    const female = sex.tiers[0].find((t) => sex.values[t[0]] === "female")!;
    expect(male[2]).toBe(words * 4); // 320 of 640: dense
    expect(female[2]).toBe(4); // one id
    const idx = loadBitIndex(bin, dict);
    expect(popcount(idx.valueMask("sex", [idx.valueId("sex", "female")], 15))).toBe(1);
    expect(popcount(idx.valueMask("sex", [idx.valueId("sex", "male")], 15))).toBe(320);
  });

  it("rejects a binary that does not match its dictionary", () => {
    const { bin, dict } = buildBitIndex(rows, ATTRS);
    expect(() => loadBitIndex(bin.slice(0, bin.byteLength - 4), dict)).toThrow(/bytes/);
    const bad: IndexDict = { ...dict, n_samples: 7 };
    expect(() => loadBitIndex(bin, bad)).toThrow(/header/);
    expect(() => loadBitIndex(bin, { ...dict, format: 2 })).toThrow(/format/);
    const wrongMagic = bin.slice();
    wrongMagic[0] = 0;
    expect(() => loadBitIndex(wrongMagic, dict)).toThrow(/Not a bit index/);
  });

  it("accepts an unaligned byte view", () => {
    const { bin, dict } = buildBitIndex(rows, ATTRS);
    const padded = new Uint8Array(bin.byteLength + 3);
    padded.set(bin, 3);
    const idx = loadBitIndex(padded.subarray(3), dict);
    expect(idx.n).toBe(6);
    expect(idx.valueAt("tissue_group", 0)).toBe("Brain");
    // A small Node Buffer is a slice of a shared 8 KiB pool.
    const pooled = Buffer.from(bin);
    expect(loadBitIndex(pooled, dict).valueAt("tissue_group", 0)).toBe("Brain");
  });

  it("is deterministic: the same rows give the same bytes and version", () => {
    const a = buildBitIndex(rows, ATTRS, { builtAt: "2026-10-20T00:00:00Z" });
    const b = buildBitIndex([...rows].reverse(), ATTRS, { builtAt: "2026-10-20T00:00:00Z" });
    expect(a.dict.index_version).toBe(b.dict.index_version);
    expect(Buffer.compare(a.bin, b.bin)).toBe(0);
  });

  it("rejects a duplicate sample and a malformed accession", () => {
    expect(() => buildBitIndex([sample("GSE1", 1), sample("GSE1", 1)], ATTRS)).toThrow(/Duplicate/);
    expect(() => buildBitIndex([{ gsm: "X1", gse: "GSE1", cells: 1, facts: {} }], ATTRS)).toThrow(/GSM/);
  });
});

describe("benchmark: 6-clause query over 100,000 samples", () => {
  const built = indexOf(syntheticRows(100_000)); // a few seconds to build
  const { index } = built;
  const query = parseCohortQuery({
    include: [
      { attr: "organism", any: ["Homo sapiens"] },
      { attr: "tissue_group", any: ["tissue_group_0", "tissue_group_1", "tissue_group_2"] },
      { attr: "life_stage", any: ["adult", "aged"] },
      { attr: "year", num: { min: 2018 } },
      { attr: "layer", any: ["splicing"] },
    ],
    exclude: [{ attr: "treatment_status", any: ["treated"] }],
    require: { min_cells: 500 },
  });

  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  // Best median of three batches, so a busy CI neighbour does not decide the result.
  const time = (fn: () => unknown, runs = 60) => {
    for (let i = 0; i < 10; i++) fn();
    const batches: number[] = [];
    for (let b = 0; b < 3; b++) {
      const t: number[] = [];
      for (let i = 0; i < runs; i++) {
        const s = performance.now();
        fn();
        t.push(performance.now() - s);
      }
      batches.push(median(t));
    }
    return Math.min(...batches);
  };

  it("resolves in under 5 ms", () => {
    const mask = time(() => cohortMask(index, query));
    const counts = time(() => resolveCohort(index, query, { whatIf: false, facets: false }));
    const full = time(() => resolveCohort(index, query), 20);
    const sizeKb = (built.bytes / 1024).toFixed(0);
    console.log(
      `bitindex: ${index.n} samples, ${index.studies.length} studies, ${built.bytes} bytes binary + ${built.dictBytes} bytes dictionary (${sizeKb} KiB); ` +
        `clauses to mask ${mask.toFixed(2)} ms, totals ${counts.toFixed(2)} ms, with facets and what-if ${full.toFixed(2)} ms`,
    );
    const r = resolveCohort(index, query);
    expect(r.totals.samples).toBeGreaterThan(0);
    expect(counts).toBeLessThan(5);
    expect(mask).toBeLessThan(5);
  }, 60_000);

  it("agrees with a row scan of the same data", () => {
    const rowsAgain = syntheticRows(100_000);
    const adult = (f: unknown) => (typeof f === "object" && f ? (f as { v: string; s?: string; c?: number }) : null);
    let n = 0;
    for (const r of rowsAgain) {
      const f = r.facts as Record<string, unknown>;
      if (f.downloadable !== "1" || f.usable !== "1" || f.qc_tier !== "0") continue;
      if (f.organism !== "Homo sapiens") continue;
      if (!["tissue_group_0", "tissue_group_1", "tissue_group_2"].includes(f.tissue_group as string)) continue;
      const ls = adult(f.life_stage);
      if (!ls || !["adult", "aged"].includes(ls.v)) continue;
      if (ls.s === "model" && (ls.c ?? 0) < 0.8) continue;
      if ((f.year as number) < 2018) continue;
      if (!(f.layer as string[]).includes("splicing")) continue;
      const ts = adult(f.treatment_status);
      if (ts && ts.v === "treated" && (ts.s !== "model" || (ts.c ?? 0) >= 0.8)) continue;
      if (r.cells < 500) continue;
      n++;
    }
    expect(resolveCohort(index, query, { whatIf: false, facets: false }).totals.samples).toBe(n);
  }, 60_000);
});
