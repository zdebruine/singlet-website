/**
 * Query timing on a synthetic catalog (or on a built index with --index <dir>).
 *   npx vite-node scripts/search-index/bench.ts [n_samples] [--index dist/search-index]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBitIndex, type IndexDict } from "../../functions/_shared/bitindex";
import { cohortMask, parseCohortQuery, resolveCohort } from "../../functions/_shared/cohort-core";
import { indexOf, syntheticRows } from "../../src/test/helpers/bitindex-fixture";

const args = process.argv.slice(2);
const dirAt = args.indexOf("--index");
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 100_000);

let index;
if (dirAt >= 0) {
  const dir = args[dirAt + 1];
  const dict = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as IndexDict;
  index = loadBitIndex(readFileSync(join(dir, dict.bin)), dict);
  console.log(`loaded ${dict.n_samples} samples, ${dict.bytes} bytes`);
} else {
  const built = indexOf(syntheticRows(n));
  index = built.index;
  console.log(`${n} samples, ${built.index.studies.length} studies: binary ${built.bytes} bytes, dictionary ${built.dictBytes} bytes`);
}

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

function time(label: string, fn: () => unknown, runs = 200) {
  for (let i = 0; i < 30; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  console.log(`${label.padEnd(34)} median ${t[runs >> 1].toFixed(3)} ms  p95 ${t[Math.floor(runs * 0.95)].toFixed(3)} ms`);
}

time("clauses -> mask", () => cohortMask(index, query));
time("totals (no facets, no what-if)", () => resolveCohort(index, query, { whatIf: false, facets: false }));
time("totals + facets", () => resolveCohort(index, query, { whatIf: false }));
time("totals + what-if", () => resolveCohort(index, query, { facets: false }), 50);
time("everything", () => resolveCohort(index, query), 50);
