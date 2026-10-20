import { ATTRS } from "../../../functions/_shared/cohort-schema";
import { buildBitIndex, type FactValue, type SampleRow } from "../../../functions/_shared/bitindex-build";
import { loadBitIndex, type BitIndex } from "../../../functions/_shared/bitindex";

/** Builds an index from rows, round-tripping through the binary and the JSON dictionary like production. */
export function indexOf(rows: SampleRow[]): { index: BitIndex; bytes: number; dictBytes: number } {
  const { bin, dict } = buildBitIndex(rows, ATTRS, { builtAt: "2026-10-20T00:00:00Z" });
  const dictText = JSON.stringify(dict);
  return { index: loadBitIndex(bin, JSON.parse(dictText)), bytes: bin.byteLength, dictBytes: dictText.length };
}

/** A catalog-shaped sample: downloadable, usable, tier 0 unless overridden. */
export function sample(gse: string, gsm: number, facts: SampleRow["facts"] = {}, cells = 1000): SampleRow {
  return { gsm: `GSM${gsm}`, gse, cells, facts: { downloadable: "1", usable: "1", qc_tier: "0", organism: "Homo sapiens", ...facts, n_cells: cells } };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catalog-like synthetic samples: skewed value frequencies, sparse extracted attributes, ~8 samples per study. */
export function syntheticRows(n: number, seed = 1): SampleRow[] {
  const r = rng(seed);
  const pick = (k: number, skew = 2) => Math.floor(Math.pow(r(), skew) * k);
  const rows: SampleRow[] = [];
  const nStudies = Math.ceil(n / 8);
  for (let i = 0; i < n; i++) {
    const study = Math.min(nStudies - 1, Math.floor((i / n) * nStudies));
    const cells = 200 + Math.floor(Math.pow(r(), 3) * 20000);
    const facts: Record<string, FactValue | FactValue[]> = {
      downloadable: r() < 0.88 ? "1" : "",
      usable: r() < 0.93 ? "1" : "",
      qc_tier: r() < 0.9 ? "0" : "1",
      organism: ["Homo sapiens", "Mus musculus", "Rattus norvegicus", "Danio rerio"][r() < 0.7 ? 0 : r() < 0.85 ? 1 : pick(4)],
      pipeline_version: `v${1 + pick(5, 3)}`,
      year: 2012 + pick(14, 0.7),
      n_cells: cells,
      layer: ["gene_counts", ...(r() < 0.6 ? ["splicing"] : []), ...(r() < 0.2 ? ["mtdna"] : []), ...(r() < 0.05 ? ["vdj"] : [])],
      chemistry: `chem${pick(12, 2)}`,
    };
    if (r() < 0.6) facts.tissue_group = `tissue_group_${pick(28, 1.5)}`;
    if (r() < 0.5) facts.tissue = `tissue_${pick(800, 3)}`;
    if (r() < 0.15) facts.disease_group = `disease_group_${pick(12, 1.5)}`;
    if (r() < 0.2) facts.disease = `disease_${pick(300, 3)}`;
    if (r() < 0.3) facts.disease_state = { v: ["case", "control"][pick(2, 1)], s: r() < 0.5 ? "geo" : "model", c: r() };
    if (r() < 0.3) facts.sex = ["male", "female", "mixed"][pick(3, 1.2)];
    if (r() < 0.45) facts.sex_genetic = { v: ["male", "female"][pick(2, 1)], s: "pipeline" };
    if (r() < 0.05) facts.ancestry_genetic = { v: ["EUR", "EAS", "AFR", "AMR", "SAS"][pick(5, 1.5)], s: "pipeline" };
    if (r() < 0.4) facts.life_stage = { v: ["adult", "pediatric", "fetal", "aged", "embryonic"][pick(5, 2)], s: r() < 0.5 ? "geo" : "model", c: 0.5 + r() * 0.5 };
    if (r() < 0.5) facts.sample_type = { v: ["primary tissue", "cell line", "organoid", "pdx"][pick(4, 2.5)], s: "model", c: 0.6 + r() * 0.4 };
    if (r() < 0.5) facts.nuclei = r() < 0.7 ? "cells" : "nuclei";
    if (r() < 0.35) facts.treatment_status = { v: ["untreated", "treated", "vehicle"][pick(3, 1.3)], s: "model", c: 0.5 + r() * 0.5 };
    if (r() < 0.25) facts.age = Math.floor(r() * 90);
    rows.push({ gsm: `GSM${1000000 + i}`, gse: `GSE${100000 + study}`, cells, facts });
  }
  return rows;
}
