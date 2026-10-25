# Benchmark and roadmap pages

- `/benchmarking` (hub), `/benchmarking/<capability>` and `/roadmap`. Capability ids, hero copy and competitor lists: `src/lib/benchmark-capabilities.ts` (ids follow the results contract).
- Results follow contract 1.x (Singlet-Bio/singlet `bench/public/CONTRACT.md`). To publish, copy `bench/public/results/*.json` (index and capability files)
  and `bench/public/notebook/singlet_benchmarks.ipynb` into `public/data/benchmarks/`. The site trusts each metric's `pass`
  and rolls up status the same way the contract does. A capability missing from the index or without a readable file shows "Benchmark in progress".
- Contract 1.1: a `pareto` figure (one point per tool, `frontier` set by the contract) is drawn as the quality-vs-cost chart; without one the page derives it from the first accuracy/agreement metric plus `resources[]` (tool names must match, Singlet is `singlet`)
  and, when a document has the optional `reach` list (`{tool, output, supported: yes|no|partial}`), a Reach panel and a hub matrix. Runtime is context unless a `resources` metric gates it.
- Roadmap: `public/data/roadmap.json` (milestones with `status` done | active | upcoming, `progress` 0-100 on the active one).
