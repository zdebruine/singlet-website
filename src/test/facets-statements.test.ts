/**
 * Regression test for the D1 "too many terms in compound SELECT" error.
 * D1 rejects compound SELECTs with more than 5 terms; every facet statement we
 * emit must stay under that regardless of which filters are active.
 */
/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect } from "vitest";
import {
  MAX_COMPOUND_TERMS,
  sampleFacetStatements,
  studyFacetStatements,
  type FacetStatement,
} from "../../functions/_shared/facets-core";
import { compoundTerms, D1_MAX_COMPOUND_TERMS } from "../../functions/_shared/d1-limits";
import type { SearchFilters } from "../../functions/_shared/search-core";

const empty: SearchFilters = {
  q: "",
  organism: [],
  tissue_group: [],
  disease_group: [],
  assay_family: [],
  cell_type: [],
  min_cells: null,
  has_bundle: null,
  year_min: null,
  year_max: null,
  min_file_samples: null,
  min_file_cells: null,
  reference_build: [],
  protocol: [],
  has_pubmed: null,
  max_file_bytes: null,
  has_conditions: null,
  match_mode: {},
};

const everything: SearchFilters = {
  q: "microglia",
  organism: ["Mus musculus"],
  tissue_group: ["Brain / CNS"],
  disease_group: ["Alzheimer's disease"],
  assay_family: ["10x 3'"],
  cell_type: ["microglia"],
  min_cells: 1000,
  has_bundle: true,
  year_min: 2019,
  year_max: 2024,
  min_file_samples: 10,
  min_file_cells: 10_000,
  reference_build: ["GRCm39-2024-A"],
  protocol: ["10xv3"],
  has_pubmed: true,
  max_file_bytes: 10_737_418_240,
  has_conditions: true,
  match_mode: {},
};

const cases: [string, SearchFilters][] = [
  ["no filters", empty],
  ["one filter", { ...empty, organism: ["Homo sapiens"] }],
  ["two filters", { ...empty, organism: ["Homo sapiens"], tissue_group: ["Blood / PBMC"] }],
  ["year only", { ...empty, year_min: 2020 }],
  ["bundle only", { ...empty, has_bundle: true }],
  ["everything", everything],
];

const FACETS = ["organism", "tissue_group", "disease_group", "assay_family", "cell_type", "year", "_total"];

function check(statements: FacetStatement[]) {
  expect(statements.length).toBeGreaterThan(0);
  for (const s of statements) {
    expect(s.terms).toBeLessThanOrEqual(MAX_COMPOUND_TERMS);
    expect(compoundTerms(s.sql)).toBeLessThanOrEqual(D1_MAX_COMPOUND_TERMS);
    // Each statement is self-contained: it declares the CTE it reads from.
    const cte = /WITH (b_\w+) AS/.exec(s.sql)?.[1];
    expect(cte).toBeTruthy();
    expect(s.sql.includes(`FROM ${cte}`)).toBe(true);
  }
  // Every facet (plus the total) is produced exactly once across the batch.
  const all = statements.map((s) => s.sql).join("\n");
  for (const f of FACETS) {
    const n = all.match(new RegExp(`'${f}' AS facet`, "g"))?.length ?? 0;
    expect(n, `facet ${f}`).toBe(1);
  }
}

describe("facet statements stay under D1's compound SELECT limit", () => {
  for (const [name, f] of cases) {
    it(`study level — ${name}`, () => check(studyFacetStatements(f, f.q ? ["GSE1", "GSE2"] : null)));
    it(`sample level — ${name}`, () => check(sampleFacetStatements(f, null, f.q ? ["GSE1", "GSE2"] : null)));
  }

  it("the shim flags the old 7-term shape", () => {
    const sql = Array.from({ length: 7 }, (_, i) => `SELECT ${i}`).join(" UNION ALL ");
    expect(compoundTerms(sql)).toBe(7);
    expect(compoundTerms(sql)).toBeGreaterThan(D1_MAX_COMPOUND_TERMS);
  });

  it("string literals containing UNION do not count", () => {
    expect(compoundTerms("SELECT 'UNION ALL' AS x")).toBe(1);
  });
});
