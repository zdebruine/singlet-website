import { readFileSync } from "node:fs";
import { parseQuery } from "../../functions/_shared/interpret";
const rules = JSON.parse(readFileSync(new URL("./.rules.json", import.meta.url), "utf8"));
const golden = JSON.parse(readFileSync(new URL("./golden-nl.json", import.meta.url), "utf8")) as Record<string, unknown>[];
for (const g of golden) {
  const p = parseQuery(String(g.query), { rules, cellTypes: [] });
  console.log(JSON.stringify({ query: g.query, ambiguous: p.ambiguous, unplaced: p.unplaced, got: p.interpreted, want: { o: g.organism, t: g.tissue_group, d: g.disease_group, a: g.assay_family, c: g.cell_type, q: g.q } }));
}
