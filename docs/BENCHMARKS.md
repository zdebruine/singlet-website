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
- Panels (`ALPHA_PANELS` in `src/lib/alpha-benchmarks.ts`); each shows "Benchmark running" until one of its files exists:
  - concordance with the authors' Cell Ranger matrices: `alpha/alpha-cell-calling.json`, `alpha/alpha-gex-counts.json`;
  - the Alpha engine at campaign settings on public 10x data: `alpha/alpha-engine-campaign.json`;
  - the atlas census: `alpha/alpha-census.json`.

  The first three are results-contract 1.x documents from Singlet-Bio/singlet `bench/alpha/` (PR #52), rendered as conclusion,
  supported figures, metric table (pooled rows first) and caveats. The census is a summary document
  (`{ title, conclusion | summary, measured_at?, headline?: [{label, value, detail?}], tables?: [{title, columns, rows, note?}],
  caveats?: [], source?: {repo, commit?, files?, code?} }`).
- Before copying, reduce each file to the included atlas: drop `artifacts` that are not uploaded, and remove counts of samples or
  studies outside Alpha (before-exclusion totals, exclusions by reason, withheld studies). The census copy keeps only the public
  level, labelled "as of the Alpha release". A test (`src/test/alpha-pages.test.tsx`) fails on words such as "withheld" or "excluded".
- Annotation accuracy (`AnnotationsPanel`, from singlet-bio `docs/cell_annotation.md`) shows only when `ANNOTATIONS_LIVE` in
  `src/lib/release.ts` is true.
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
