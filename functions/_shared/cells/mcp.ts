/**
 * MCP tools over cell search (./http.ts): search_cells (the /api/cells answer) and get_cells_page (one /api/cells/slice page).
 * The answers are the endpoints' JSON, with a short text that quotes the computed numbers.
 */
import type { AppEnv, WaitUntil } from "../env";
import type { Identity } from "../identity";
import { fmt, fmtBytes, toolError, toolResult, type ToolResult } from "../mcp-core";
import { cellSearchResponse, fieldsBody, loadInputs, parseCellRequest, sliceResponse } from "./http";
import { FIELDS } from "./fields";

const FIELD_LIST = FIELDS.map((f) => `${f.name} (${f.level}${f.ontology ? `, ${f.ontology.join("/")}` : ""})`).join(", ");

const WHERE_PROP = {
  type: "object",
  description: `Filter. Flat form: {"cell_type": "T cell", "sex": "female", "tissue": ["lung"], "age_years": [18, 65], "not": {"disease": "cancer"}} (fields AND-ed, list values OR-ed, not_<field> negates). Tree form: {"and": [...]}, {"or": [...]}, {"not": {...}}, {"field": "cell_type", "any": ["CL:0000084"], "exact": false}. Ontology values are ids or labels and match every descendant. Fields: ${FIELD_LIST}.`,
};

export const CELL_TOOLS = [
  {
    name: "search_cells",
    title: "Search cells across the atlas",
    description:
      "Count and locate cells across the whole atlas by any supported metadata: per cell (Cell Ontology cell type, chromosomal sex, genetic ancestry, UMIs and genes), per sample (UBERON tissue, MONDO disease, HsapDv/MmusDv stage, age, recorded sex and ancestry, organism, assay, chemistry, donor status, perturbation, sample kind, QC) and per study (GSE, year, publication). AND / OR / NOT; ontology terms match descendants. Give `where` (preferred: you are the language model, so write the filters yourself; values may be ontology ids, labels or synonyms, and unknown values are reported back), or `question` in plain English, which the server reads with its built-in vocabulary only (no model); the readings and any words it could not place are returned so you can turn them into `where`. list_cell_fields gives every field, its coverage and its top values. Answers: cells, studies and samples (most cells first), a breakdown by every other facet, the descendant terms each filter matched, and how to fetch the cells (get_cells_page). Answers from memory in tens of milliseconds; not metered. Cell-type labels below lineage level are previews (per-study accuracy: compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32).",
    inputSchema: {
      type: "object",
      properties: {
        where: WHERE_PROP,
        question: { type: "string", maxLength: 500, description: "Plain English, e.g. \"female CD8 T cells from lung cancer\". AND-ed with `where`." },
        include_low_qc: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 20, description: "Rows of the study and sample lists." },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
      additionalProperties: false,
    },
    annotations: { title: "Search cells across the atlas", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_cells_page",
    title: "Fetch a page of matching cells",
    description:
      "One page (up to 10,000 cells, 10 studies) of the cells a search_cells filter matches: the cells as [GSM, [columns]], the byte ranges of their matrix chunks in each sample object (HTTP Range on data.singlet.bio, no account needed), and a body that streams them all in one POST to data.singlet.bio/s1/cidx/gather. Continue with `cursor`. Python: singlet.s1.atlas.gather(page['cells']).",
    inputSchema: {
      type: "object",
      properties: {
        where: WHERE_PROP,
        question: { type: "string", maxLength: 500 },
        include_low_qc: { type: "boolean", default: false },
        page_cells: { type: "integer", minimum: 1, maximum: 10000, default: 5000 },
        cursor: { type: "string", description: "next_cursor of the previous page." },
        modalities: { type: "array", items: { type: "string" }, description: "counts (default), spliced, unspliced, splice_junctions, mt, vdj." },
      },
      additionalProperties: false,
    },
    annotations: { title: "Fetch a page of matching cells", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_cell_fields",
    title: "List the cell-search vocabulary",
    description:
      "Every field search_cells and get_cells_page accept: its level (cell / sample / study), ontology, how much of the served atlas carries a value (coverage) and its most common values. Read it before writing `where` yourself. Not metered; no model.",
    inputSchema: { type: "object", properties: { fields: { type: "array", items: { type: "string" }, description: "Only these fields (default: all)." } }, additionalProperties: false },
    annotations: { title: "List the cell-search vocabulary", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function toParsed(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (args.where !== undefined) body.where = args.where;
  if (typeof args.question === "string") body.q = args.question;
  for (const k of ["include_low_qc", "limit", "offset", "page_cells", "cursor", "modalities"]) if (args[k] !== undefined) body[k] = args[k];
  // MCP callers bring their own model: `question` is read with the vocabulary only; words it cannot place are returned to the caller
  body.ai = false;
  return parseCellRequest(new URL("https://singlet.bio/api/cells"), body);
}

export async function searchCellsTool(env: AppEnv, identity: Identity, waitUntil: WaitUntil, args: Record<string, unknown>): Promise<ToolResult> {
  let p;
  try {
    p = toParsed(args);
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
  if (!p.query.where && !p.q) return toolError("Give `where` or `question`. GET https://singlet.bio/api/cells/fields lists every field.");
  const res = await cellSearchResponse(env, identity, waitUntil, p);
  const j = (await res.json()) as Record<string, any>;
  if (res.status !== 200) return toolError(j.message ?? "Cell search could not answer.", j);
  return toolResult(searchCellsText(j), j, undefined, { textHasData: true });
}

const ROWS_IN_TEXT = 50;
const FACET_VALUES = 6;
const term = (x: { id?: string | null; value: string; label?: string }) =>
  x.label && x.id && x.label !== x.id ? `${x.label} (${x.id})` : (x.label ?? x.value);

/**
 * The text of a search_cells answer. Many MCP clients (the Anthropic API's MCP connector among them) pass only the text content to the
 * model, so the text carries the answer itself: what was matched and how, the study and sample lists, the facet breakdowns, what the
 * filters cannot see (samples with no value for a sample-level field), the relaxations of an empty answer and the next calls.
 */
export function searchCellsText(j: Record<string, any>): string {
  const L: string[] = [];
  const t = j.totals ?? {};
  L.push(`${fmt(t.cells)} cells in ${fmt(t.samples)} samples of ${fmt(t.studies)} studies match.`);
  if (j.question) {
    const r = (j.question.readings ?? []).map((x: any) => `${x.negated ? "NOT " : ""}${x.field} = ${(x.labels ?? x.values ?? []).join(" or ")} (from "${x.text}")`);
    L.push(`Question read as: ${r.join("; ") || "nothing"}.${j.question.unparsed?.length ? ` Not understood: ${j.question.unparsed.join(", ")}.` : ""}`);
  }
  if (j.filters?.length) {
    L.push("", "Filters (ontology terms include their descendants unless exact):");
    for (const f of j.filters) {
      const vals = (f.values ?? []).map((v: any) => (v.labels?.length ? v.labels.map((l: string, k: number) => `${l} (${v.ids?.[k] ?? v.value})`).join(" / ") : v.value)).join(" or ");
      const contrib = (f.contributing ?? []).slice(0, 5).map((c: any) => `${term(c)} ${fmt(c.cells)}`).join(", ");
      L.push(`- ${f.field} [${f.level}] = ${vals}${f.exact ? " (exact)" : f.terms_covered ? `, ${fmt(f.terms_covered)} terms covered` : ""}${contrib ? `; most cells from: ${contrib}` : ""}`);
    }
  }
  const gaps = (j.unmapped ?? []).filter((u: any) => u.samples > 0);
  if (gaps.length) {
    L.push("", "Coverage gaps (these samples have no value for the field, so they can never match it, and always pass a NOT on it):");
    for (const u of gaps) L.push(`- ${u.field}: ${fmt(u.samples)} served samples (${Math.round(100 * u.samples_share)}%) and ${fmt(u.cells)} cells (${Math.round(100 * u.cells_share)}%) have no ${u.field}.`);
    L.push("  If a study you expect is missing, check it with get_study; GEO text may name a tissue or disease the catalog has not mapped.");
  }
  if (j.row_scan) {
    const rs = j.row_scan;
    L.push("", rs.error ? `Per-cell range filter could not be counted: ${rs.error}` : `Per-cell ranges (row scan): ${fmt(rs.cells)} cells pass them${rs.complete === false ? " (partial scan)" : ""}. ${rs.note ?? ""}`);
  }
  if (j.relaxations?.length) {
    L.push("", "Nothing matches. Each filter alone, and the query without it:");
    for (const r of j.relaxations) L.push(`- ${r.filter}: alone ${fmt(r.alone)} cells; without it ${fmt(r.without)} cells`);
  }
  const studies = (j.studies ?? []) as any[];
  if (studies.length) {
    const off = j.query?.offset ?? 0;
    L.push("", `Studies (${off + 1}-${off + Math.min(studies.length, ROWS_IN_TEXT)} of ${fmt(t.studies)}, most cells first): gse_id, cells, samples`);
    for (const s of studies.slice(0, ROWS_IN_TEXT)) L.push(`${s.gse_id}\t${s.cells}\t${s.samples}`);
  }
  const samples = (j.samples ?? []) as any[];
  if (samples.length) {
    const off = j.query?.offset ?? 0;
    L.push("", `Samples (${off + 1}-${off + Math.min(samples.length, ROWS_IN_TEXT)} of ${fmt(t.samples)}, most cells first): gsm_id, gse_id, cells`);
    for (const s of samples.slice(0, ROWS_IN_TEXT)) L.push(`${s.gsm_id}\t${s.gse_id}\t${s.cells}`);
    if ((j.query?.offset ?? 0) + samples.length < (t.samples ?? 0)) L.push(`More: pass offset=${off + samples.length} (limit up to 200).`);
  }
  const facets = Object.entries(j.facets ?? {}).filter(([, v]) => Array.isArray(v) && v.length) as [string, any[]][];
  if (facets.length) {
    L.push("", `Breakdown of the matching cells by facet (top ${FACET_VALUES}; "unknown" = not recorded):`);
    for (const [name, vals] of facets) {
      const top = vals.slice(0, FACET_VALUES).map((v) => `${term(v)} ${fmt(v.cells)}${v.samples != null ? ` (${fmt(v.samples)} samples)` : ""}`);
      L.push(`- ${name}: ${top.join("; ")}${vals.length > FACET_VALUES ? `; +${vals.length - FACET_VALUES} more` : ""}`);
    }
  }
  if (j.cell_type_lineage?.length) L.push("", `Cell-type lineage of the matching cells: ${j.cell_type_lineage.slice(0, 10).map((v: any) => `${term(v)} ${fmt(v.cells)}`).join("; ")}`);
  if (t.cells) {
    L.push("", `Next: get_cells_page with the same filter returns the cells as [GSM, [columns]] and the byte ranges of their matrix chunks (filtered ${j.slice?.filtered ?? "by the cell index"}). HTTP: ${j.slice?.url ?? ""}`);
  }
  if (j.caveats?.length) L.push("", `Caveat: ${j.caveats[0]}`);
  if (j.basis) L.push(`Basis: ${j.basis.served}; cell index ${j.basis.index_version}, facts built ${j.basis.facts_built_at}.`);
  return L.join("\n");
}

/** The text of a get_cells_page answer: the cells, the byte ranges and the cursor, so a text-only client can fetch and continue. */
export function cellsPageText(j: Record<string, any>): string {
  const L: string[] = [];
  L.push(`${fmt(j.page?.cells)} cells from ${j.page?.samples} samples (${fmt(j.progress?.samples_done)} of ${fmt(j.progress?.samples_total)} samples done): ${fmtBytes(j.bytes)} in ${j.requests} ranged reads.`);
  if (j.next_cursor) L.push(`More: pass cursor="${j.next_cursor}".`);
  const cells = (j.cells ?? []) as [string, number[]][];
  if (cells.length) {
    L.push("", "Cells as [GSM, matrix columns] (a column is the cell's row in the sample's cells table):");
    for (const [g, cols] of cells.slice(0, 40)) L.push(`${g}: ${cols.length} cells, columns ${JSON.stringify(cols.length > 60 ? cols.slice(0, 60) : cols)}${cols.length > 60 ? ` ... (+${cols.length - 60}; all in structuredContent.cells)` : ""}`);
    if (cells.length > 40) L.push(`... ${cells.length - 40} more samples.`);
  }
  if (j.python) L.push("", "Python (fetches every page):", j.python);
  return L.join("\n");
}


export async function cellsPageTool(env: AppEnv, request: Request, identity: Identity, waitUntil: WaitUntil, args: Record<string, unknown>): Promise<ToolResult> {
  let p;
  try {
    p = toParsed(args);
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
  if (!p.query.where && !p.q) return toolError("Give `where` or `question`.");
  const res = await sliceResponse(env, request, waitUntil, p, identity);
  const j = (await res.json()) as Record<string, any>;
  if (res.status !== 200) return toolError(j.message ?? "Could not page the cells.", j);
  return toolResult(cellsPageText(j), j);
}

export async function cellFieldsTool(env: AppEnv, waitUntil: WaitUntil, args: Record<string, unknown>): Promise<ToolResult> {
  const b = fieldsBody(await loadInputs(env, waitUntil)) as { fields: Record<string, any>[]; unavailable: unknown; syntax: Record<string, string> };
  const want = Array.isArray(args.fields) ? new Set(args.fields.map(String)) : null;
  const fields = want ? b.fields.filter((f) => want.has(f.name)) : b.fields;
  const L: string[] = ["Cell-search fields (ontology fields match a term and every descendant; values are ids, labels or synonyms):"];
  for (const f of fields) {
    const cov = f.coverage ? ` coverage ${f.coverage.samples_share != null ? `${Math.round(100 * f.coverage.samples_share)}% of samples` : ""}${f.coverage.cells_share != null ? `${f.coverage.samples_share != null ? ", " : ""}${Math.round(100 * f.coverage.cells_share)}% of cells` : ""};` : "";
    const top = Array.isArray(f.top_values) ? f.top_values.slice(0, 8).map((v: any) => (v.label && v.id ? `${v.label} (${v.id})` : (v.label ?? v.value))).join(", ") : "";
    L.push(`- ${f.name} [${f.level}${f.ontology ? `, ${f.ontology.join("/")}` : ""}]:${cov} ${f.description ?? ""}${top ? ` Top: ${top}.` : ""}`);
  }
  L.push("", `Syntax: ${b.syntax.flat}`, `Tree form: ${b.syntax.tree}`);
  return toolResult(L.join("\n"), { ...b, fields }, undefined, { textHasData: true });
}
