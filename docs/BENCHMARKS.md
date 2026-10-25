# Benchmark and roadmap pages

- `/benchmarking` (hub), `/benchmarking/<capability>` and `/roadmap`. Capability list and hero copy: `src/lib/benchmark-capabilities.ts`.
- Results: one file per capability at `public/data/benchmarks/<slug>.json`, shape `BenchResult` in `src/lib/benchmarks.ts`
  (`schema_version: 1`, `capability` = slug, `singlet_commit`, `tools[]`, `datasets[]`, `methods`, `panels[]` (max 3 shown),
  `metrics[]` (value, threshold, comparator `>=`/`<=`), `conclusion` (< 100 words), optional `code[]` of repo paths).
  Pass/fail is computed from value and threshold, never stored. A missing or malformed file renders "Benchmark in progress".
- Notebook: `public/data/benchmarks/singlet-benchmarks.ipynb` (linked from the hub).
- Roadmap: `public/data/roadmap.json` (milestones with `status` done | active | upcoming, `progress` 0-100 on the active one).
