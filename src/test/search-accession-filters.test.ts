// @vitest-environment node
// An accession query combined with rail filters: every placeholder gets its own value (it used to 500: the lookup's values were
// bound before the filters' although its clause comes after theirs).
import { describe, expect, it } from "vitest";
import { parseSearchParams, planSampleQuery, planStudyQuery } from "../../functions/_shared/search-core";

const placeholders = (sql: string) => (sql.replace(/'[^']*'/g, "").match(/\?/g) ?? []).length;
const params = (qs: string) => parseSearchParams(new URL(`https://singlet.bio/api/search?${qs}`));

describe("accession lookup with filters", () => {
  const cases = [
    "q=GSE345646&organism=Homo%20sapiens",
    "q=GSE345646&min_cells=1&sex_genetic=female",
    "q=GSM10012322&organism=Homo%20sapiens&ancestry_genetic=African",
    "q=GSE1%20GSM2&cell_type_label=T%20cell&include_low_qc=1",
    "q=GSE345646",
    "q=microglia&organism=Mus%20musculus",
  ];
  it.each(cases)("study plan binds one value per placeholder: %s", (qs) => {
    const plan = planStudyQuery(params(qs));
    expect(plan.params.length).toBe(placeholders(plan.sql));
    expect(plan.countParams.length).toBe(placeholders(plan.countSql));
  });
  it.each(cases)("sample plan binds one value per placeholder: %s", (qs) => {
    const plan = planSampleQuery(params(`level=gsm&${qs}`));
    expect(plan.params.length).toBe(placeholders(plan.sql));
    expect(plan.countParams.length).toBe(placeholders(plan.countSql));
  });
  it("the lookup values come last, after the filters'", () => {
    const plan = planStudyQuery(params("q=GSE345646&organism=Homo%20sapiens"));
    expect(plan.params.at(-3)).toBe('["GSE345646"]');
  });
});
