// @vitest-environment node
// Tool results for clients that pass only text to the model (the Anthropic API's MCP connector among them): structuredContent is
// repeated as compact JSON in the text, and search_cells / get_cells_page render their whole answer as text.
import { describe, expect, it } from "vitest";
import { compactJson, toolError, toolResult, withDataText, DATA_TEXT_MAX_CHARS } from "../../functions/_shared/mcp-core";
import { cellsPageText, searchCellsText } from "../../functions/_shared/cells/mcp";

describe("withDataText", () => {
  it("adds the structured data as JSON text and strips the internal flag", () => {
    const r = withDataText(toolResult("12 cells match.", { runs: [[0, 5], [9, 7]], after: "GSE1/GSM2" }));
    expect(r.content).toHaveLength(2);
    expect(r.content[1].text).toContain('"runs":[[0,5],[9,7]]');
    expect(r.content[1].text).toContain('"after":"GSE1/GSM2"');
    expect("textHasData" in r).toBe(false);
  });
  it("leaves results whose text already carries the data, and errors, alone", () => {
    const a = withDataText(toolResult("full text", { x: 1 }, undefined, { textHasData: true }));
    expect(a.content).toHaveLength(1);
    expect("textHasData" in a).toBe(false);
    expect(withDataText(toolError("nope")).content).toHaveLength(1);
    expect(withDataText({ content: [{ type: "text", text: "plain" }] }).content).toHaveLength(1);
  });
  it("keeps the flag through a copy (withQuota spreads the result)", () => {
    const r = toolResult("t", { a: 1 }, undefined, { textHasData: true });
    expect(withDataText({ ...r, _meta: { quota: 1 } }).content).toHaveLength(1);
  });
});

describe("compactJson", () => {
  it("returns small values whole", () => {
    expect(compactJson({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
  });
  it("cuts long arrays and says how many were left out", () => {
    const big = { samples: Array.from({ length: 5000 }, (_, i) => ({ gsm_id: `GSM${i}`, cells: i })) };
    const s = compactJson(big);
    expect(s.length).toBeLessThanOrEqual(DATA_TEXT_MAX_CHARS);
    expect(s).toContain('"GSM0"');
    expect(s).toMatch(/\.\.\. \d+ more/);
    expect(() => JSON.parse(s)).not.toThrow();
  });
});

const ANSWER = {
  query: { where: {}, include_low_qc: false, limit: 2, offset: 0 },
  totals: { cells: 14435, samples: 15, studies: 3, rows: 73 },
  studies: [{ gse_id: "GSE144945", cells: 12022, samples: 10 }, { gse_id: "GSE198896", cells: 2396, samples: 4 }],
  samples: [{ gsm_id: "GSM4301254", gse_id: "GSE144945", cells: 2283 }, { gsm_id: "GSM4301255", gse_id: "GSE144945", cells: 2071 }],
  filters: [
    { field: "cell_type", level: "cell", values: [{ value: "CL:0000625", ids: ["CL:0000625"], labels: ["CD8-positive, alpha-beta T cell"] }], exact: false, terms_covered: 7, contributing: [{ id: "CL:0000913", value: "CL:0000913", label: "effector memory CD8-positive, alpha-beta T cell", cells: 7581 }] },
    { field: "disease", level: "sample", values: [{ value: "MONDO:0004992", ids: ["MONDO:0004992"], labels: ["cancer"] }], exact: false, terms_covered: 120, contributing: [] },
  ],
  unmapped: [{ field: "disease", samples: 43248, cells: 206000000, samples_share: 0.927, cells_share: 0.931 }],
  facets: { sex: [{ id: "PATO:0000384", value: "PATO:0000384", label: "male", cells: 9000 }, { id: null, value: "unknown", label: "unknown", cells: 10 }], ancestry: [] },
  cell_type_lineage: [{ id: "CL:0000084", value: "CL:0000084", label: "T cell", cells: 14435 }],
  slice: { url: "https://singlet.bio/api/cells/slice?where=x", filtered: "by the cell index" },
  caveats: ["Cell types below lineage level are previews."],
  basis: { served: "QC-passed samples", index_version: "v1", facts_built_at: "t" },
};

describe("searchCellsText", () => {
  const text = searchCellsText(ANSWER);
  it("carries the totals, the study and sample lists and the paging", () => {
    expect(text).toContain("14,435 cells in 15 samples of 3 studies match.");
    expect(text).toContain("GSE144945	12022	10");
    expect(text).toContain("GSM4301255	GSE144945	2071");
    expect(text).toContain("More: pass offset=2");
  });
  it("names the filters, their terms and the coverage gap", () => {
    expect(text).toContain("cell_type [cell] = CD8-positive, alpha-beta T cell (CL:0000625), 7 terms covered");
    expect(text).toContain("effector memory CD8-positive, alpha-beta T cell (CL:0000913) 7,581");
    expect(text).toMatch(/disease: 43,248 served samples \(93%\).*have no disease/);
  });
  it("carries the facets, the lineage and the next step", () => {
    expect(text).toContain("- sex: male (PATO:0000384) 9,000; unknown 10");
    expect(text).not.toContain("- ancestry:");
    expect(text).toContain("T cell (CL:0000084) 14,435");
    expect(text).toContain("get_cells_page");
  });
  it("explains an empty answer", () => {
    const t = searchCellsText({ ...ANSWER, totals: { cells: 0, samples: 0, studies: 0 }, studies: [], samples: [], relaxations: [{ filter: "ancestry=HANCESTRO:0010", alone: 188804, without: 0 }] });
    expect(t).toContain("Nothing matches");
    expect(t).toContain("ancestry=HANCESTRO:0010: alone 188,804 cells; without it 0 cells");
    expect(t).not.toContain("get_cells_page");
  });
});

describe("cellsPageText", () => {
  it("gives the columns and the cursor value", () => {
    const t = cellsPageText({ page: { cells: 3, samples: 1 }, progress: { samples_done: 1, samples_total: 2 }, bytes: 2_500_000, requests: 7, next_cursor: "abc123", cells: [["GSM1", [4, 8, 15]]], python: "print(1)" });
    expect(t).toContain('cursor="abc123"');
    expect(t).toContain("GSM1: 3 cells, columns [4,8,15]");
  });
});
