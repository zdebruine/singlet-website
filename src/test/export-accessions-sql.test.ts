// @vitest-environment node
import { describe, expect, it } from "vitest";
import { exportAccessionsSql, parseSearchParams, planStudyQuery } from "../../functions/_shared/search-core";

const plan = (qs: string) => planStudyQuery({ ...parseSearchParams(new URL(`https://x/api/manifest?${qs}`)), page: 1, limit: 2000 });

describe("exportAccessionsSql", () => {
  it("keeps the WITH block of a text query and swaps only the main select list", () => {
    const sql = exportFor("q=melanoma");
    expect(sql.startsWith("WITH")).toBe(true);
    expect(sql).toContain("fg AS (SELECT id AS gse_id");
    expect(sql).toContain("hits AS (");
    expect(sql.match(/SELECT m\.gse_id, COUNT\(\*\) OVER \(\) AS _total FROM gse_meta m/g)).toHaveLength(1);
    expect(sql).toContain("JOIN hits h ON h.gse_id = m.gse_id");
    expect(sql).not.toContain("m.organism_primary");
  });

  it("rewrites a filter-only query too", () => {
    const sql = exportFor("organism=Homo%20sapiens");
    expect(sql.trimStart().startsWith("SELECT m.gse_id, COUNT(*) OVER () AS _total FROM gse_meta m")).toBe(true);
    expect(sql).not.toContain("m.organism_primary,");
  });
});

function exportFor(qs: string) {
  return exportAccessionsSql(plan(qs).sql);
}
