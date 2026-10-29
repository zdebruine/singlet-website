/**
 * Cell export: the cells of a cell search as decoded files behind one plain link (GET /api/cells/export), and the per-cell-type gene
 * summary the MCP tool `export_cells` quotes. The page of cells is the one /api/cells/slice returns for the same filter, page_cells and
 * cursor (./slice.ts); the data Worker decodes it (`POST data.singlet.bio/s1/cidx/export`, workers/data/src/export.ts) and this route
 * pipes the zip through, with each sample's facts (tissue, disease, stage, ...) added to the cell table.
 *
 *   GET /api/cells/export?where=<JSON>&q=...&include_low_qc=1&genes=CD8A,GZMB&max_cells=2000&modality=counts&cursor=...&format=mtx|summary
 *
 * No account is needed to open a link. With the Pages secret CIDX_INTERNAL_SECRET (the data Worker's), the Worker counts the request
 * against whoever opened it (their address, or their account when an MCP client asks) rather than against the site.
 */
import { CORS_HEADERS } from "../cors";
import type { AppEnv, WaitUntil } from "../env";
import type { Identity } from "../identity";
import { s1Url } from "../s1-urls";
import { loadInputs, parseCellRequest, readQuestion, type Inputs, type ParsedRequest } from "./http";
import { parseCellQuestion } from "./nl";
import { canonicalWhere, QueryError, rowScanWhere, runCellQuery, type CellQuery, type Expr } from "./query";
import { DONOR_STATUS, TISSUE_TYPES, TUMOR_SAMPLE_TYPES, type SampleFacts } from "./sample-facts";
import { PAGE_CELLS_MAX, slicePage, type SlicePage } from "./slice";

export const EXPORT_DEFAULT_CELLS = 2000;
export const EXPORT_BASE = "https://singlet.bio/api/cells/export";
const MODALITIES = ["counts", "spliced", "unspliced"];

export interface ExportRequest {
  p: ParsedRequest;
  genes: string[] | null;
  maxCells: number;
  modality: string;
  format: "mtx" | "summary";
}

export function parseExportRequest(url: URL, body: Record<string, unknown> | null): ExportRequest {
  const p = parseCellRequest(url, body);
  const get = (k: string): unknown => (body && body[k] !== undefined ? body[k] : (url.searchParams.get(k) ?? undefined));
  const g = get("genes");
  const genes = (Array.isArray(g) ? g.map(String) : typeof g === "string" ? g.split(/[,\s|]+/) : [])
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 2000);
  const mc = Number(get("max_cells"));
  const maxCells = Number.isFinite(mc) && mc >= 1 ? Math.min(PAGE_CELLS_MAX, Math.floor(mc)) : EXPORT_DEFAULT_CELLS;
  const modality = String(get("modality") ?? "counts").toLowerCase();
  if (!MODALITIES.includes(modality)) throw new QueryError(`modality is one of ${MODALITIES.join(", ")} (gene counts only).`);
  const format = String(get("format") ?? "mtx");
  if (format !== "mtx" && format !== "summary") throw new QueryError("format is mtx (a zip of 10x-style files) or summary (JSON).");
  return { p: { ...p, pageCells: maxCells }, genes: genes.length ? genes : null, maxCells, modality, format };
}

/** The link for a filter (canonical where), the same options, and a cursor. */
export function exportLink(where: Expr | null, o: { include_low_qc?: boolean; genes?: string[] | null; maxCells?: number; modality?: string; cursor?: string | null; format?: string }): string {
  const u = new URLSearchParams();
  if (where) u.set("where", canonicalWhere(where));
  if (o.include_low_qc) u.set("include_low_qc", "1");
  if (o.genes?.length) u.set("genes", o.genes.join(","));
  if (o.maxCells && o.maxCells !== EXPORT_DEFAULT_CELLS) u.set("max_cells", String(o.maxCells));
  if (o.modality && o.modality !== "counts") u.set("modality", o.modality);
  if (o.format && o.format !== "mtx") u.set("format", o.format);
  if (o.cursor) u.set("cursor", o.cursor);
  return `${EXPORT_BASE}?${u}`;
}

async function hash8(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h).slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-sample columns for the cell table, from the sample facts (the same terms search_cells filters on). */
export function sampleColumns(facts: SampleFacts, gsms: string[]): Record<string, Record<string, string | number | null>> {
  const want = new Map<number, string>();
  for (const g of gsms) {
    const si = facts.index.get(g);
    if (si !== undefined) want.set(si, g);
  }
  const out: Record<string, Record<string, string | number | null>> = {};
  for (const [si, g] of want) {
    out[g] = {
      organism: facts.vocab.organism[facts.organism[si]] ?? null,
      assay: facts.vocab.assay[facts.assay[si]] ?? null,
      chemistry: facts.vocab.chemistry[facts.chemistry[si]] ?? null,
      age_years: facts.age[si],
      donor_status: facts.donor_status[si] ? DONOR_STATUS[facts.donor_status[si] - 1] : null,
      tissue_type: facts.tissue_type[si] ? TISSUE_TYPES[facts.tissue_type[si] - 1] : null,
      tumor_sample_type: facts.tumor_sample_type[si] ? TUMOR_SAMPLE_TYPES[facts.tumor_sample_type[si] - 1] : null,
    };
  }
  for (const attr of ["tissue", "disease", "development_stage", "cell_line"]) {
    const terms = facts.termSamples.get(attr);
    if (!terms) continue;
    const per = new Map<number, string[]>();
    for (const [term, list] of terms) for (const si of list) if (want.has(si)) (per.get(si) ?? per.set(si, []).get(si)!).push(term);
    for (const [si, g] of want) {
      const t = (per.get(si) ?? []).sort();
      out[g][attr] = t.map((x) => facts.labels[x] ?? x).join("; ") || null;
      out[g][`${attr}_ontology_term_id`] = t.join("; ") || null;
    }
  }
  return out;
}

export interface PlannedExport {
  where: Expr | null;
  page: SlicePage;
  name: string;
  body: Record<string, unknown>;
  inputs: Inputs;
}

/** The page of cells and the data Worker's export body. */
export async function planExport(env: AppEnv, identity: Identity, waitUntil: WaitUntil, er: ExportRequest, authorization: string | null, viaModel = false): Promise<PlannedExport> {
  const inputs = await loadInputs(env, waitUntil);
  let where = er.p.query.where;
  if (er.p.q) {
    // the link reads its question with the vocabulary only (no model call, so opening a link is free and repeatable)
    const nl = viaModel ? await readQuestion(env, identity, waitUntil, er.p, inputs) : parseCellQuestion(er.p.q, inputs.idx, inputs.facts);
    where = nl.where && where ? { and: [nl.where, where] } : (nl.where ?? where);
  }
  const query: CellQuery = { ...er.p.query, where, offset: 0 };
  const r = runCellQuery(query, inputs.idx, inputs.facts);
  rowScanWhere(where, inputs.idx, inputs.facts, []); // refuses ranges the index cannot apply
  const page = await slicePage(query, r, inputs.idx, inputs.facts, { pageCells: er.maxCells, cursor: er.p.cursor, modalities: null, authorization });
  const name = `singlet_cells_${await hash8(canonicalWhere(where) + "|" + query.include_low_qc + "|" + (er.genes ?? []).join(","))}${er.p.cursor ? `_${await hash8(er.p.cursor)}` : ""}`;
  const gsms = page.cells.map((c) => c[0]);
  const body = {
    version: page.index_version,
    cells: page.cells,
    ...(er.genes ? { genes: er.genes } : {}),
    modality: er.modality,
    format: er.format,
    name,
    samples: sampleColumns(inputs.facts, gsms),
    provenance: {
      where: where ? JSON.parse(canonicalWhere(where)) : null,
      question: er.p.q,
      include_low_qc: query.include_low_qc,
      cursor: er.p.cursor,
      page: page.page,
      progress: page.progress,
      link: exportLink(where, { include_low_qc: query.include_low_qc, genes: er.genes, maxCells: er.maxCells, modality: er.modality, cursor: er.p.cursor }),
      next: page.next_cursor ? exportLink(where, { include_low_qc: query.include_low_qc, genes: er.genes, maxCells: er.maxCells, modality: er.modality, cursor: page.next_cursor }) : null,
      facts_built_at: inputs.facts.built_at,
      release_policy: inputs.facts.policy,
    },
  };
  return { where, page, name, body, inputs };
}

/** Headers that tell the data Worker who is asking (see the file comment). */
export function workerHeaders(env: AppEnv, request: Request | null, identity: Identity): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const auth = request?.headers.get("authorization") ?? "";
  if (/^Bearer sk_live_/.test(auth)) h.authorization = auth;
  else if (env.CIDX_INTERNAL_SECRET) {
    h["x-cidx-internal"] = env.CIDX_INTERNAL_SECRET;
    if (identity.kind !== "anonymous") h["x-cidx-subject"] = `acct:${identity.userId}`;
    else {
      const ip = request?.headers.get("cf-connecting-ip");
      if (ip) h["x-cidx-client-ip"] = ip;
    }
  }
  return h;
}

export async function callExport(env: AppEnv, request: Request | null, identity: Identity, body: Record<string, unknown>): Promise<Response> {
  return fetch(s1Url("s1/cidx/export"), { method: "POST", headers: workerHeaders(env, request, identity), body: JSON.stringify(body) });
}

const PASS = ["content-type", "content-disposition", "x-export-cells", "x-export-genes", "x-export-nnz", "x-export-ms", "retry-after"];

/** GET /api/cells/export: the zip (or the summary JSON), streamed from the data Worker. */
export async function exportResponse(env: AppEnv, request: Request, waitUntil: WaitUntil, er: ExportRequest, identity: Identity): Promise<Response> {
  if (!er.p.query.where && !er.p.q) throw new QueryError("Give `where` or `q` (the filter of /api/cells).");
  const auth = /^Bearer sk_live_/.test(request.headers.get("authorization") ?? "") ? request.headers.get("authorization") : null;
  const plan = await planExport(env, identity, waitUntil, er, auth);
  const h = new Headers(CORS_HEADERS);
  h.set("Cache-Control", "no-store");
  h.set("Access-Control-Expose-Headers", "Content-Disposition, X-Export-Cells, X-Export-Genes, X-Export-Nnz, X-Export-Ms, X-Export-Next, X-Export-Progress, Link");
  const next = (plan.body.provenance as { next: string | null }).next;
  if (next) {
    h.set("X-Export-Next", next);
    h.set("Link", `<${next}>; rel="next"`);
  }
  h.set("X-Export-Progress", `${plan.page.progress.samples_done}/${plan.page.progress.samples_total} samples, ${plan.page.progress.cells_total} cells in all`);
  if (!plan.page.cells.length) {
    h.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify({ error: "no_cells", message: "No cells match this filter (or this page is past the last one).", progress: plan.page.progress }), { status: 404, headers: h });
  }
  const res = await callExport(env, request, identity, plan.body);
  for (const k of PASS) {
    const v = res.headers.get(k);
    if (v) h.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers: h });
}
