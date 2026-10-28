/**
 * MCP tools over cell search (./http.ts): search_cells (the /api/cells answer) and get_cells_page (one /api/cells/slice page).
 * The answers are the endpoints' JSON, with a short text that quotes the computed numbers.
 */
import type { AppEnv, WaitUntil } from "../env";
import type { Identity } from "../identity";
import { fmt, fmtBytes, toolError, toolResult, type ToolResult } from "../mcp-core";
import { cellSearchResponse, parseCellRequest, sliceResponse } from "./http";
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
      "Count and locate cells across the whole atlas by any supported metadata: per cell (Cell Ontology cell type, chromosomal sex, genetic ancestry, UMIs and genes), per sample (UBERON tissue, MONDO disease, HsapDv/MmusDv stage, age, recorded sex and ancestry, organism, assay, chemistry, donor status, perturbation, sample kind, QC) and per study (GSE, year, publication). AND / OR / NOT; ontology terms match descendants. Give `where`, or `question` in plain English (the filters read are returned). Answers: cells, studies and samples (most cells first), a breakdown by every other facet, the descendant terms each filter matched, and how to fetch the cells (get_cells_page). Answers from memory in tens of milliseconds; not metered. Cell-type labels below lineage level are previews (per-study accuracy: compartment 0.84, lineage 0.75, cell type 0.43, subtype 0.32).",
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
];

function toParsed(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};
  if (args.where !== undefined) body.where = args.where;
  if (typeof args.question === "string") body.q = args.question;
  for (const k of ["include_low_qc", "limit", "offset", "page_cells", "cursor", "modalities"]) if (args[k] !== undefined) body[k] = args[k];
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
  const read = j.question ? ` Read as: ${j.question.readings.map((r: any) => `${r.negated ? "not " : ""}${r.field} = ${r.labels.join(" or ")}`).join("; ")}.` : "";
  const top = (j.studies as any[]).slice(0, 3).map((s) => `${s.gse_id} (${fmt(s.cells)})`).join(", ");
  const text = `${fmt(j.totals.cells)} cells in ${fmt(j.totals.samples)} samples of ${fmt(j.totals.studies)} studies.${read}${top ? ` Most: ${top}.` : ""}${j.relaxations ? " Nothing matches: see `relaxations` for each filter alone and the query without it." : ""}`;
  return toolResult(text, j);
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
  const text = `${fmt(j.page.cells)} cells from ${j.page.samples} samples (${fmt(j.progress.samples_done)} of ${fmt(j.progress.samples_total)} samples done): ${fmtBytes(j.bytes)} in ${j.requests} ranged reads.${j.next_cursor ? " More: pass cursor=next_cursor." : ""}`;
  return toolResult(text, j);
}
