/**
 * "Give me the cells": the cells of a cell-search query, a page at a time, as exact (sample, column) lists and the byte ranges of their
 * matrix chunks in the immutable per-sample .s1 objects.
 *
 * Pages follow the query's matching samples in accession order: a page takes whole samples until it would pass `page_cells` cells
 * (at most 10,000), 10 studies or 200 samples (the cell index's per-request caps); a sample larger than a page is split across pages
 * by the index's own cursor. Per page:
 *   1. one `POST data.singlet.bio/s1/cidx/query` (return "cells") for the page's samples: with the query's cell filters when they are
 *      plain AND-ed filters (the index applies them), else every cell of those samples with its labels, filtered here (OR / NOT);
 *   2. the samples' plan blocks (immutable JSON of the index: object keys and chunk offsets), and `planGather` of the data Worker:
 *      per sample the matrix prefixes and the chunk runs covering the cells, coalesced into ranged GETs.
 * Nothing here reads a sample object. The same page can be streamed in one request by `POST data.singlet.bio/s1/cidx/gather` with the
 * returned `gather` body, or fetched range by range; the singlet package does either (`singlet.s1.atlas.gather`).
 */
import { membersFor, planGather } from "../../../workers/data/src/gather";
import type { PlanSample } from "../../../workers/data/src/cidx";
import { s1Url } from "../s1-urls";
import type { CellIndex } from "./atlas-index";
import { canonicalWhere, cellPushdown, filterCellRows, joinOf, QueryError, type CellQuery, type CellSearchResult } from "./query";
import type { SampleFacts } from "./sample-facts";

export const PAGE_CELLS_MAX = 10_000;
const PAGE_STUDIES_MAX = 10;
const PAGE_SAMPLES_MAX = 200;

export interface SliceOpts {
  pageCells: number;
  cursor: string | null;
  modalities: string[] | null;
  /** forwarded to the data Worker so its per-key allowance applies */
  authorization: string | null;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

interface Cursor {
  v: string;
  q: string;
  k: number;
  c: string | null;
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

async function digest(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const planMemo = new Map<string, Map<number, PlanSample>>();

async function planBlock(idx: CellIndex, key: string, f: SliceOpts["fetcher"]): Promise<Map<number, PlanSample>> {
  const hit = planMemo.get(key);
  if (hit) return hit;
  const url = s1Url(key);
  const res = f ? await f(url, {}) : await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
  if (!res.ok) throw new Error(`plan block ${key} answered ${res.status}`);
  const doc = (await res.json()) as { samples: PlanSample[] };
  const m = new Map(doc.samples.map((s) => [s.so, s]));
  if (planMemo.size > 256) planMemo.delete(planMemo.keys().next().value as string);
  planMemo.set(key, m);
  void idx;
  return m;
}

export interface SlicePage {
  query: { where: string; include_low_qc: boolean };
  page: { samples: number; studies: number; cells: number; expected_cells: number; complete_samples: boolean };
  progress: { samples_done: number; samples_total: number; cells_total: number };
  cells: [string, number[]][];
  objects: { gsm_id: string; gse_id: string; url: string; n_cells: number; ranges: { range: string; bytes: number; members: string[] }[] }[];
  bytes: number;
  requests: number;
  gather: { url: string; body: Record<string, unknown> };
  filtered: "index" | "here";
  next_cursor: string | null;
  index_version: string;
  ms: { cells: number; plan: number };
}

export async function slicePage(q: CellQuery, result: CellSearchResult, idx: CellIndex, facts: SampleFacts, opts: SliceOpts): Promise<SlicePage> {
  const where = canonicalWhere(q.where);
  const qd = await digest(`${where}|${q.include_low_qc}`);
  let cur: Cursor = { v: idx.version, q: qd, k: 0, c: null };
  if (opts.cursor) {
    try {
      cur = JSON.parse(unb64(opts.cursor)) as Cursor;
    } catch {
      throw new QueryError("`cursor` is not a cursor of this endpoint.");
    }
    if (cur.v !== idx.version) throw new QueryError("The cell index changed since this cursor was made; start again without a cursor.", { index_version: idx.version });
    if (cur.q !== qd) throw new QueryError("This cursor belongs to another query.");
  }
  const pageCells = Math.max(1, Math.min(PAGE_CELLS_MAX, Math.floor(opts.pageCells)));
  const join = joinOf(idx, facts);
  const per = result.perSample;
  const order: number[] = [];
  for (let i = 0; i < facts.n; i++) if (per[i] > 0) order.push(i);
  order.sort((a, b) => (facts.gse[a] === facts.gse[b] ? (facts.gsm[a] < facts.gsm[b] ? -1 : 1) : facts.gse[a] < facts.gse[b] ? -1 : 1));
  const total = order.reduce((n, i) => n + per[i], 0);
  const push = cellPushdown(q.where, idx, facts);
  const budget = (si: number) => (push ? per[si] : join.siCells[si]);

  // the page's samples
  const page: number[] = [];
  const studies = new Set<string>();
  let acc = 0;
  for (let k = cur.k; k < order.length; k++) {
    const si = order[k];
    const b = budget(si);
    const newStudy = !studies.has(facts.gse[si]);
    // one organism per page: the gather endpoint streams one organism at a time
    const otherOrganism = page.length > 0 && facts.organism[si] !== facts.organism[page[0]];
    if (page.length && (acc + b > pageCells || (newStudy && studies.size >= PAGE_STUDIES_MAX) || page.length >= PAGE_SAMPLES_MAX || otherOrganism)) break;
    page.push(si);
    studies.add(facts.gse[si]);
    acc += b;
  }
  const fetcher = opts.fetcher ?? ((u: string, init: RequestInit) => fetch(u, init));
  const empty = (): SlicePage => ({
    query: { where, include_low_qc: q.include_low_qc },
    page: { samples: 0, studies: 0, cells: 0, expected_cells: 0, complete_samples: true },
    progress: { samples_done: order.length, samples_total: order.length, cells_total: total },
    cells: [],
    objects: [],
    bytes: 0,
    requests: 0,
    gather: { url: s1Url("s1/cidx/gather"), body: {} },
    filtered: push ? "index" : "here",
    next_cursor: null,
    index_version: idx.version,
    ms: { cells: 0, plan: 0 },
  });
  if (!page.length) return empty();

  // 1. the cells
  const t0 = Date.now();
  const gsms = page.map((si) => facts.gsm[si]);
  const body = {
    version: idx.version,
    where: { samples: gsms, ...(push ?? {}) },
    return: "cells",
    n: pageCells,
    max_studies: PAGE_STUDIES_MAX,
    study_rank: "cells",
    seed: 0,
    fields: push ? [] : ["ct", "sex", "anc"],
    ...(cur.c ? { cursor: cur.c } : {}),
  };
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.authorization) headers.authorization = opts.authorization;
  const res = await fetcher(s1Url("s1/cidx/query"), { method: "POST", headers, body: JSON.stringify(body) });
  const ans = (await res.json().catch(() => ({}))) as {
    cells?: { gsm: string[]; col: number[]; cell_type?: (string | null)[]; sex?: (string | null)[]; ancestry?: (string | null)[] };
    cursor?: string | null;
    message?: string;
    error?: string;
  };
  if (!res.ok || !ans.cells) throw new QueryError(`The cell index refused the page: ${ans.message ?? ans.error ?? `HTTP ${res.status}`}`, { status: res.status });
  const cells = ans.cells;
  let keep: ArrayLike<number> = Array.from({ length: cells.gsm.length }, (_, i) => i);
  if (!push) keep = filterCellRows(q.where, idx, facts, { gsm: cells.gsm, cell_type: cells.cell_type ?? [], sex: cells.sex ?? [], ancestry: cells.ancestry ?? [] });
  const want = new Map<number, number[]>();
  const byGsm = new Map<string, number[]>();
  for (let j = 0; j < keep.length; j++) {
    const i = keep[j];
    const g = cells.gsm[i];
    const so = idx.soOfGsm.get(Number(g.slice(3)));
    if (so === undefined) continue;
    (want.get(so) ?? want.set(so, []).get(so)!).push(cells.col[i]);
    (byGsm.get(g) ?? byGsm.set(g, []).get(g)!).push(cells.col[i]);
  }
  for (const l of want.values()) l.sort((a, b) => a - b);
  for (const l of byGsm.values()) l.sort((a, b) => a - b);
  const tCells = Date.now() - t0;

  // 2. byte ranges, from the plan blocks
  const t1 = Date.now();
  const sos = [...want.keys()].sort((a, b) => a - b);
  const blocks = new Map<string, number[]>();
  for (const so of sos) {
    const b = String(Math.floor(so / idx.plan.block_size));
    (blocks.get(b) ?? blocks.set(b, []).get(b)!).push(so);
  }
  const plans: PlanSample[] = [];
  for (const [b, list] of blocks) {
    const key = idx.plan.blocks[b];
    if (!key) throw new QueryError(`Samples ${list.slice(0, 3).join(", ")} are not in the index's plan.`);
    const m = await planBlock(idx, key, opts.fetcher);
    for (const so of list) {
      const s = m.get(so);
      if (s) plans.push(s);
    }
  }
  const members = membersFor(opts.modalities ?? undefined);
  const gp = planGather(plans, want, members, new Set());
  const objects = gp.samples.map((s) => ({
    gsm_id: s.gsm,
    gse_id: s.gse,
    url: s1Url(s.key),
    n_cells: s.n_cells,
    ranges: gp.reads
      .filter((r) => r.sample === s.i)
      .map((r) => ({ range: `bytes=${r.start}-${r.end - 1}`, bytes: r.end - r.start, members: [...new Set(r.pieces.map((p) => members[p.member] ?? String(p.member)))] })),
  }));
  const tPlan = Date.now() - t1;

  const innerCursor = ans.cursor ?? null;
  const k2 = innerCursor ? cur.k : cur.k + page.length;
  const next = k2 < order.length ? b64(JSON.stringify({ v: idx.version, q: qd, k: k2, c: innerCursor } satisfies Cursor)) : null;
  const list: [string, number[]][] = [...byGsm].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    query: { where, include_low_qc: q.include_low_qc },
    page: { samples: page.length, studies: studies.size, cells: gp.cells, expected_cells: page.reduce((n, si) => n + per[si], 0), complete_samples: !innerCursor && !cur.c },
    progress: { samples_done: k2, samples_total: order.length, cells_total: total },
    cells: list,
    objects,
    bytes: gp.bytes,
    requests: gp.reads.length,
    gather: { url: s1Url("s1/cidx/gather"), body: { version: idx.version, cells: list, ...(opts.modalities ? { modalities: opts.modalities } : {}) } },
    filtered: push ? "index" : "here",
    next_cursor: next,
    index_version: idx.version,
    ms: { cells: tCells, plan: tPlan },
  };
}

/** The Python that walks every page of a query with the singlet package. */
export function slicePython(base: string, params: string): string {
  return [
    "import requests",
    "from singlet.s1 import atlas  # pip install singlet",
    "",
    `url = "${base}/api/cells/slice"`,
    `params = ${params}`,
    "parts, cursor = [], None",
    "while True:",
    "    page = requests.get(url, params={**params, **({'cursor': cursor} if cursor else {})}).json()",
    "    if page['cells']:",
    "        parts.append(atlas.gather(page['cells']))  # one streamed request per page (<= 10,000 cells)",
    "    cursor = page['next_cursor']",
    "    if not cursor:",
    "        break",
    "import anndata as ad",
    "adata = ad.concat(parts, join='outer')",
  ].join("\n");
}
