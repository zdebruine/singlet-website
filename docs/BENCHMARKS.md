# Benchmarking pages

`/benchmarking` has two sections that are never mixed:

- **Alpha** (`#alpha`): measurements of the files singlet.bio serves today. Data: `public/data/benchmarks/alpha/`.
- **Beta preview** (`#beta`): Singlet 1.0.0, the engine for the Beta re-run, under a banner saying it does not measure today's files.
  Per-capability pages at `/benchmarking/<capability>`. Data: `public/data/benchmarks/<capability>.json` and `index.json`.

`/benchmarks` and `/validation` redirect to `/benchmarking` (`public/_redirects` and `src/App.tsx`).

## Alpha

- `alpha/scbasecount.json` (schema `singlet.alpha.benchmark`): the scBaseCount and Cell Ranger comparison, built from
  Singlet-Bio/singlet `docs/scbasecount-comparison/` (`atlaswide.json`, `coverage_headline.json`, `samples.tsv`; the commit is in the
  file's `source`). The per-sample table keeps only the correctly stranded samples of the write-up's equal-depth table, by category,
  with no accessions.
- `alpha/alpha-cellranger-concordance.json`, `alpha/alpha-engine.json`, `alpha/alpha-census.json`: show "Benchmark running" until the
  file exists. Drop a file in and its panel fills; no code change. Accepted shapes (`src/lib/alpha-benchmarks.ts`):
  - a results-contract 1.x document (`schema: "singlet.benchmark.capability"`), rendered as conclusion plus metric table; or
  - a summary: `{ title, conclusion | summary, measured_at?, headline?: [{label, value, detail?}], tables?: [{title, columns, rows, note?}],
    caveats?: [], source?: {repo, commit, files?, code?} }`.
- Never list, count or link samples or studies that are not in Alpha.

## Beta preview

- Results follow contract 1.x (Singlet-Bio/singlet `bench/public/CONTRACT.md`). To publish, copy `bench/public/results/*.json` and
  `bench/public/notebook/singlet_benchmarks.ipynb` into `public/data/benchmarks/`, then rebuild the index from the files:
  `node scripts/benchmarks/build-index.mjs`. The site trusts each metric's `pass` and rolls up status the same way the contract does.
  A capability without a readable file shows "Benchmark in progress".
- Hero copy and competitors: `src/lib/benchmark-capabilities.ts`. Hero copy describes the Beta engine or a Beta goal, never the Alpha files
  (a test checks that each mentions Beta).
- Contract 1.1: a `pareto` figure is drawn as the quality-vs-cost chart; without one the page derives it from the first
  accuracy/agreement metric plus `resources[]`. The optional `reach` list (`{tool, output, supported: yes|no|partial}`) adds a Reach panel
  and a hub matrix.
