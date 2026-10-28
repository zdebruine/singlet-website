/**
 * Cell search measurements on live data (docs/CELL-SEARCH.md, docs/cell-search-measurements.json).
 *
 *   npm run cells:bench -- engine [--facts facts.json]   CPU time of the evaluator (V8, this machine) on the real cell index
 *                                                         (data.singlet.bio) and the real sample facts (D1, read-only SELECTs
 *                                                         through `wrangler d1 execute --remote`, or a saved snapshot)
 *   npm run cells:bench -- edge --base <url>               client-observed latency of /api/cells (edge-cache miss and hit), slice
 *                                                         page bytes and requests, and one page streamed by the data Worker
 *   npm run cells:bench -- cost                            cost per million queries from the measurements and Cloudflare list prices
 *
 * Every mode merges its numbers into docs/cell-search-measurements.json. Nothing here writes to D1 or R2.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cellIndex } from "../../functions/_shared/cells/atlas-index";
import { buildFacts, hydrateFacts, type FactsWire } from "../../functions/_shared/cells/sample-facts";
import { joinOf, parseWhere, runCellQuery } from "../../functions/_shared/cells/query";
import { parseCellQuestion } from "../../functions/_shared/cells/nl";
import { fieldsBody } from "../../functions/_shared/cells/http";

const OUT = "docs/cell-search-measurements.json";

/** The query set: single filters at several ontology depths, then combinations (AND / OR / NOT, cell x sample x study). */
export const QUERIES: { id: string; kind: string; depth?: string; where?: unknown; q?: string }[] = [
  { id: "all", kind: "none", where: {} },
  { id: "ct-leukocyte", kind: "single", depth: "CL compartment (leukocyte)", where: { cell_type: "CL:0000738" } },
  { id: "ct-lymphocyte", kind: "single", depth: "CL lineage (lymphocyte)", where: { cell_type: "CL:0000542" } },
  { id: "ct-tcell", kind: "single", depth: "CL cell type (T cell)", where: { cell_type: "CL:0000084" } },
  { id: "ct-cd8", kind: "single", depth: "CL type (CD8 alpha-beta T cell)", where: { cell_type: "CL:0000625" } },
  { id: "ct-cd8-em", kind: "single", depth: "CL subtype (effector memory CD8)", where: { cell_type: "CL:0000913" } },
  { id: "sex-female", kind: "single", depth: "PATO", where: { sex: "female" } },
  { id: "anc-african", kind: "single", depth: "HANCESTRO", where: { ancestry: "HANCESTRO:0010" } },
  { id: "tissue-respiratory", kind: "single", depth: "UBERON system (respiratory system)", where: { tissue: "UBERON:0001004" } },
  { id: "tissue-lung", kind: "single", depth: "UBERON organ (lung)", where: { tissue: "UBERON:0002048" } },
  { id: "disease-cancer", kind: "single", depth: "MONDO root-level (cancer)", where: { disease: "MONDO:0004992" } },
  { id: "disease-lung-cancer", kind: "single", depth: "MONDO organ (lung cancer)", where: { disease: "MONDO:0008903" } },
  { id: "disease-nsclc", kind: "single", depth: "MONDO leaf (NSCLC)", where: { disease: "MONDO:0005233" } },
  { id: "stage-adult", kind: "single", depth: "HsapDv/MmusDv (adult)", where: { development_stage: "adult" } },
  { id: "study-year", kind: "single", depth: "study", where: { year: [2023, 2026] } },
  { id: "and-3", kind: "combined", where: { cell_type: "CL:0000625", sex: "female", disease: "MONDO:0008903" } },
  { id: "and-6", kind: "combined", where: { cell_type: "CL:0000625", sex: "female", development_stage: "adult", tissue: "lung", disease: "MONDO:0005070", ancestry: "HANCESTRO:0010" } },
  { id: "or-not", kind: "combined", where: { or: [{ tissue: "lung" }, { cell_type: "hepatocyte" }], not: { sex: "male" } } },
  { id: "or-cell-sample", kind: "combined", where: { or: [{ and: [{ tissue: "blood" }, { cell_type: "B cell" }] }, { and: [{ tissue: "bone marrow" }, { cell_type: "plasma cell" }] }], organism: "Homo sapiens" } },
  { id: "not-tcell-cancer", kind: "combined", where: { organism: "Homo sapiens", disease: "MONDO:0004992", not_cell_type: "T cell", year: [2020, 2026] } },
  { id: "nl-example", kind: "question", q: "female CD8 T cells from adult lung tumours of African ancestry" },
  { id: "nl-lung-cancer", kind: "question", q: "female CD8 T cells from lung cancer" },
  { id: "nl-microglia", kind: "question", q: "microglia from aged mouse brain" },
  { id: "nl-bm", kind: "question", q: "B cells or plasma cells in human bone marrow, not leukemia" },
];

function merge(part: Record<string, unknown>) {
  const cur = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Record<string, unknown>) : {};
  writeFileSync(OUT, JSON.stringify({ ...cur, ...part, updated_at: new Date().toISOString() }, null, 1) + "\n");
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

/** D1 for the snapshot build: read-only SELECTs through wrangler (this machine's login). */
function remoteD1(): D1Database {
  const lit = (v: unknown) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  let rowsRead = 0;
  const run = (sql: string) => {
    if (!/^\s*SELECT/i.test(sql)) throw new Error("read-only: SELECT statements only");
    const out = execFileSync(process.execPath, [join("node_modules", "wrangler", "bin", "wrangler.js"), "d1", "execute", "singlet-catalog", "--remote", "--json", "--command", sql.replace(/\s+/g, " ")], { maxBuffer: 1 << 30, encoding: "utf8" });
    const j = JSON.parse(out.slice(out.indexOf("[")));
    rowsRead += j[0].meta?.rows_read ?? 0;
    return j[0].results as Record<string, unknown>[];
  };
  const db = {
    rowsRead: () => rowsRead,
    prepare(sql: string) {
      let params: unknown[] = [];
      const st = {
        bind(...p: unknown[]) {
          params = p;
          return st;
        },
        all: async () => ({ results: run(sql.replace(/\?(\d+)?/g, (_m, n) => lit(n ? params[Number(n) - 1] : params.shift()))) }),
        first: async () => run(sql.replace(/\?(\d+)?/g, (_m, n) => lit(n ? params[Number(n) - 1] : params.shift())))[0] ?? null,
      };
      return st;
    },
  };
  return db as unknown as D1Database;
}

async function engine(args: string[]) {
  const factsPath = args[args.indexOf("--facts") + 1];
  let wire: FactsWire;
  let build: Record<string, unknown> = {};
  if (args.includes("--facts") && existsSync(factsPath)) wire = JSON.parse(readFileSync(factsPath, "utf8"));
  else {
    const db = remoteD1();
    const t = Date.now();
    wire = await buildFacts(db);
    build = { facts_build_ms: Date.now() - t, facts_build_d1_rows_read: (db as unknown as { rowsRead: () => number }).rowsRead() };
    if (args.includes("--facts")) writeFileSync(factsPath, JSON.stringify(wire));
  }
  const text = JSON.stringify(wire);
  let t = performance.now();
  const facts = hydrateFacts(wire, text.length, "d1");
  const hydrateMs = performance.now() - t;
  t = performance.now();
  const idx = await cellIndex({ fetcher: (u) => fetch(u) });
  const indexMs = performance.now() - t;
  t = performance.now();
  joinOf(idx, facts);
  const joinMs = performance.now() - t;
  const reps = 25;
  const rows: Record<string, unknown>[] = [];
  for (const qd of QUERIES) {
    const times: number[] = [];
    let first = 0;
    let totals: Record<string, number> = {};
    let readings: string[] | undefined;
    for (let k = 0; k < reps; k++) {
      const s = performance.now();
      const where = qd.q ? parseCellQuestion(qd.q, idx, facts).where : parseWhere(qd.where);
      const r = runCellQuery({ where, include_low_qc: false, limit: 20, offset: 0 }, idx, facts);
      const ms = performance.now() - s;
      if (k === 0) {
        first = ms;
        totals = r.totals;
        if (qd.q) readings = parseCellQuestion(qd.q, idx, facts).readings.map((x) => `${x.negated ? "not " : ""}${x.field}=${x.labels.join("|")}`);
      } else times.push(ms);
    }
    rows.push({ id: qd.id, kind: qd.kind, depth: qd.depth ?? null, ...(qd.q ? { q: qd.q, readings } : { where: qd.where }), totals, cpu_ms_first: r1(first), cpu_ms_p50: r1(pct(times, 50)), cpu_ms_p95: r1(pct(times, 95)) });
    console.log(qd.id.padEnd(22), String(totals.cells).padStart(11), "cells", `p50 ${r1(pct(times, 50))} ms  p95 ${r1(pct(times, 95))} ms`);
  }
  const fb = fieldsBody({ idx, facts, ms: { index: 0, facts: 0 }, cold: { index: true, facts: "d1" } }) as { fields: { name: string; level: string; ontology?: string[]; coverage: unknown }[]; totals: unknown };
  merge({
    engine: {
      machine: `${process.platform} ${process.arch}, node ${process.version} (V8, the engine Workers run)`,
      index: { version: idx.version, summary_rows: idx.n, bytes: idx.load.bytes, requests: idx.load.requests, load_ms: r1(indexMs) },
      facts: { samples: facts.n, built_at: facts.built_at, release_policy: facts.policy, json_bytes: text.length, hydrate_ms: r1(hydrateMs), ...build },
      join_ms: r1(joinMs),
      reps,
      queries: rows,
    },
    coverage: { totals: fb.totals, fields: fb.fields.map((f) => ({ name: f.name, level: f.level, ontology: f.ontology ?? null, coverage: f.coverage })) },
  });
}

async function edge(args: string[]) {
  const base = (args[args.indexOf("--base") + 1] ?? "https://singlet.bio").replace(/\/+$/, "");
  const reps = Number(args.includes("--reps") ? args[args.indexOf("--reps") + 1] : 12);
  const timed = async (url: string, init?: RequestInit) => {
    const t = performance.now();
    const res = await fetch(url, init);
    const body = await res.text();
    return { ms: performance.now() - t, status: res.status, cache: res.headers.get("x-edge-cache"), timing: res.headers.get("server-timing"), body };
  };
  const rows: Record<string, unknown>[] = [];
  let firstTiming: unknown = null;
  for (const qd of QUERIES) {
    const p = new URLSearchParams(qd.q ? { q: qd.q, ai: "0" } : { where: JSON.stringify(qd.where) });
    const cold: number[] = [];
    const warm: number[] = [];
    let totals: unknown = null;
    for (let k = 0; k < reps; k++) {
      // a limit no earlier request used: an edge-cache miss that runs the whole query (the isolate may be warm)
      p.set("limit", String(20 + ((Date.now() / 1000) % 400 | 0) + k * 401 + rows.length * 7));
      const c = await timed(`${base}/api/cells?${p}`);
      if (c.status !== 200) throw new Error(`${qd.id}: HTTP ${c.status} ${c.body.slice(0, 200)}`);
      if (!firstTiming) firstTiming = JSON.parse(c.body).timing;
      cold.push(c.ms);
      totals = JSON.parse(c.body).totals;
      const w = await timed(`${base}/api/cells?${p}`);
      if (w.cache === "HIT") warm.push(w.ms);
    }
    rows.push({ id: qd.id, kind: qd.kind, totals, miss_ms_p50: r1(pct(cold, 50)), miss_ms_p95: r1(pct(cold, 95)), hit_ms_p50: r1(pct(warm, 50)), hit_ms_p95: r1(pct(warm, 95)), hits: warm.length, n: reps });
    console.log(qd.id.padEnd(22), `miss p50 ${r1(pct(cold, 50))} p95 ${r1(pct(cold, 95))}  hit p50 ${r1(pct(warm, 50))} p95 ${r1(pct(warm, 95))} (${warm.length} hits)`);
  }
  // slice: pages of a few queries
  const slices: Record<string, unknown>[] = [];
  for (const id of ["and-3", "ct-cd8-em", "or-not"]) {
    const qd = QUERIES.find((q) => q.id === id)!;
    const p = new URLSearchParams({ where: JSON.stringify(qd.where), page_cells: "5000" });
    const pages: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    for (let k = 0; k < 3; k++) {
      if (cursor) p.set("cursor", cursor);
      const r = await timed(`${base}/api/cells/slice?${p}`);
      if (r.status !== 200) {
        pages.push({ error: r.body.slice(0, 300) });
        break;
      }
      const j = JSON.parse(r.body);
      pages.push({ ms: r1(r.ms), cells: j.page.cells, samples: j.page.samples, studies: j.page.studies, bytes: j.bytes, requests: j.requests, bytes_per_cell: Math.round(j.bytes / Math.max(1, j.page.cells)), filtered: j.filtered, worker_ms: j.ms, gather: k === 0 ? j.gather : undefined });
      cursor = j.next_cursor;
      if (!cursor) break;
    }
    // stream the first page through the data Worker (one POST) and time it
    const g = pages[0]?.gather as { url: string; body: unknown } | undefined;
    let stream: Record<string, unknown> | null = null;
    if (g) {
      const t = performance.now();
      const res = await fetch(g.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(g.body) });
      const buf = new Uint8Array(await res.arrayBuffer());
      stream = { status: res.status, bytes: buf.length, ms: r1(performance.now() - t), mb_per_s: r1(buf.length / 1e6 / ((performance.now() - t) / 1000)) };
    }
    for (const pg of pages) delete pg.gather;
    slices.push({ id, where: qd.where, pages, first_page_stream: stream });
    console.log("slice", id, JSON.stringify(pages[0]), JSON.stringify(stream));
  }
  merge({ edge: { base, client: "this machine (residential connection; includes network round trip)", reps, first_request_timing: firstTiming, queries: rows, slices } });
}

/** Cloudflare list prices (Workers Paid), read 2026-10-28. */
export const PRICES = {
  workers_request_per_m: { usd: 0.3, source: "https://developers.cloudflare.com/workers/platform/pricing/ (Standard: +$0.30 per additional million requests)" },
  workers_cpu_ms_per_m: { usd: 0.02, source: "https://developers.cloudflare.com/workers/platform/pricing/ (+$0.02 per additional million CPU milliseconds)" },
  r2_class_b_per_m: { usd: 0.36, source: "https://developers.cloudflare.com/r2/pricing/ (Class B $0.36 / million requests; egress free)" },
  r2_egress_per_gb: { usd: 0, source: "https://developers.cloudflare.com/r2/pricing/ (Egress: Free)" },
  d1_rows_read_per_m: { usd: 0.001, source: "https://developers.cloudflare.com/d1/platform/pricing/ (first 25 billion / month included + $0.001 / million rows)" },
};

function cost() {
  const m = JSON.parse(readFileSync(OUT, "utf8")) as { engine: { queries: { kind: string; cpu_ms_p50: number; cpu_ms_p95: number }[]; facts: { facts_build_d1_rows_read?: number } }; edge?: { slices: { pages: { requests: number; bytes: number; cells: number }[] }[] } };
  const q = m.engine.queries.filter((x) => x.kind !== "none");
  const cpu50 = pct(q.map((x) => x.cpu_ms_p50), 50);
  const cpu95 = pct(q.map((x) => x.cpu_ms_p95), 95);
  const P = PRICES;
  const per = (cpu: number) => P.workers_request_per_m.usd + cpu * P.workers_cpu_ms_per_m.usd;
  // a slice page: one Pages Function request, one cell-index query and one gather (Worker requests), the page's ranged reads (R2 Class B
  // when they miss the edge cache; the worst case counts every read as a miss), egress free
  const pages = (m.edge?.slices ?? []).flatMap((s) => s.pages).filter((p) => typeof p.requests === "number");
  const reads = pages.length ? pct(pages.map((p) => p.requests), 50) : null;
  const pageCells = pages.length ? pct(pages.map((p) => p.cells), 50) : null;
  const rowsPerBuild = m.engine.facts.facts_build_d1_rows_read ?? 400_000;
  const out = {
    prices: P,
    assumptions: [
      "Paid plan, beyond the included monthly allowances (10 M requests, 30 M CPU-ms, 10 M Class B reads, 25 B D1 rows): the marginal price.",
      "CPU per query = the evaluator's V8 time on this machine (Workers bill CPU time, not wall time; Workers hardware differs).",
      "A cache hit (same canonical query within 5 minutes in a colo) is billed as a request with no CPU (Workers Cache pricing); the Pages Function still runs its cache lookup, about 1 ms.",
      "Inputs (the 7.8 MB index summary, the sample-facts snapshot) are read once per isolate from the edge cache, and the snapshot is built from D1 once per colo and hour; their cost is spread over the queries of that hour.",
    ],
    query_uncached_usd_per_m: { cpu_ms_p50: r1(cpu50), at_p50: Math.round(per(cpu50) * 100) / 100, cpu_ms_p95: r1(cpu95), at_p95: Math.round(per(cpu95) * 100) / 100 },
    query_cached_usd_per_m: Math.round(per(1) * 100) / 100,
    snapshot_build: { d1_rows_read: rowsPerBuild, usd: rowsPerBuild / 1e6 * P.d1_rows_read_per_m.usd, per_colo_hour: true, usd_per_month_330_colos: Math.round(rowsPerBuild / 1e6 * P.d1_rows_read_per_m.usd * 330 * 24 * 30 * 100) / 100 },
    slice_page: reads !== null ? { cells: pageCells, ranged_reads: reads, usd_per_m_pages_worst_case: Math.round((3 * P.workers_request_per_m.usd + reads * P.r2_class_b_per_m.usd + 50 * P.workers_cpu_ms_per_m.usd) * 100) / 100, egress_usd: 0 } : null,
  };
  merge({ cost: out });
  console.log(JSON.stringify(out, null, 1));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "engine") await engine(rest);
else if (mode === "edge") await edge(rest);
else if (mode === "cost") cost();
else console.log("usage: cells:bench -- engine [--facts f.json] | edge --base <url> [--reps n] | cost");
