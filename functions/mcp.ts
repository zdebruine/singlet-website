/**
 * https://singlet.bio/mcp — Model Context Protocol server (Streamable HTTP).
 *
 * Stateless JSON-RPC 2.0 over POST. No sessions, no server-initiated streams
 * (GET answers 405), every response is plain `application/json`.
 *
 *   initialize                → capabilities + serverInfo
 *   notifications/initialized → 202
 *   ping                      → {}
 *   tools/list                → the four tools below
 *   tools/call                → needs `Authorization: Bearer sk_live_…` (or
 *                               `X-API-Key`); without one the tool answers with
 *                               an isError result pointing at /account.
 *
 * Tools
 *   search_datasets  natural-language search (same engine as the site bar)
 *   get_study        everything about one GSE
 *   get_download_url the .singlet bundle URL for one GSE
 *   get_atlas_stats  live corpus numbers
 *
 * Protocol versions 2025-06-18 and 2025-03-26 (JSON-RPC batches accepted for
 * the latter). A missing MCP-Protocol-Version header means 2025-03-26.
 */
import { CORS_HEADERS } from "./_shared/cors";
import { apiKeyFromRequest, checkApiKey, keyMessage, type KeyCheck } from "./_shared/identity";
import { nlSearch, type NlEnv, type NlSearchBody, type Quota } from "./_shared/nl-search-core";
import { loadStudy, bundleUrl, GSE_RE, type StudyDetail } from "./_shared/study-core";
import { computeStats } from "./_shared/stats-core";
import { TISSUE_GROUPS, DISEASE_GROUPS, ASSAY_FAMILIES } from "./_shared/vocab";
import type { StudyRow, SampleRow } from "./_shared/search-core";

type Env = NlEnv;

const SERVER_INFO = { name: "singlet-bio", title: "singlet.bio atlas", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];
const SITE = "https://singlet.bio";
const ACCOUNT_URL = `${SITE}/account`;
const MAX_SAMPLES_IN_STUDY = 60;

const INSTRUCTIONS = `singlet.bio is an open atlas of public single-cell RNA-seq studies from GEO, all reprocessed the same way. One .singlet file per study (GSE accession), loadable with one line in Python (pip install git+https://github.com/Singlet-Bio/singlet; singlet.load("GSE…")) or R (remotes::install_github("Singlet-Bio/singlet", subdir = "r"); load("GSE…")).

Start with search_datasets using plain English (organism, tissue, disease, cell type, assay). Use get_study for details on one accession, get_download_url for the file, get_atlas_stats for corpus size. Filters are never relaxed silently: when a search returns nothing, follow the suggestions it returns. Downloads never need a key; tool calls need a personal API key from ${ACCOUNT_URL}.`;

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, ...(data !== undefined ? { data } : {}) },
});

const JSON_HEADERS = { ...CORS_HEADERS, "Cache-Control": "no-store" };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

// ── Tool catalogue ──────────────────────────────────────────────────────────

const LOADERS = (gse: string) => ({
  python: `import singlet\nadata = singlet.load("${gse}")   # AnnData`,
  r: `library(singlet)\nsce <- load("${gse}")   # SingleCellExperiment`,
});

const TOOLS = [
  {
    name: "search_datasets",
    title: "Search single-cell studies",
    description:
      "Find public scRNA-seq studies (or individual samples) in the singlet.bio atlas from a plain-English question, e.g. \"microglia in the aging mouse brain\" or \"human PBMC covid-19 10x\". GEO accessions (GSE…, GSM…) are looked up directly. The question is turned into structured filters (organism, tissue, disease, assay, cell type) which are ANDed and never relaxed silently; when nothing matches, `suggestions` says what dropping one filter would return. Each result carries a deterministic `why` explaining the match, the download URL and one-line Python/R loaders. Costs one unit of the key owner's daily AI-search budget (200/day) unless the interpretation is cached.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain English, keywords, or a GEO accession.", minLength: 1, maxLength: 500 },
        level: { type: "string", enum: ["study", "sample"], default: "study", description: "Return studies (GSE, default) or individual samples (GSM)." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        page: { type: "integer", minimum: 1, default: 1 },
        organism: { type: "array", items: { type: "string" }, description: "Extra organism filters (common or scientific names), ANDed with the interpretation." },
        tissue: { type: "array", items: { type: "string", enum: TISSUE_GROUPS as unknown as string[] }, description: "Extra canonical tissue groups." },
        disease: { type: "array", items: { type: "string", enum: DISEASE_GROUPS as unknown as string[] }, description: "Extra canonical disease groups." },
        assay: { type: "array", items: { type: "string", enum: ASSAY_FAMILIES as unknown as string[] }, description: "Extra canonical assay families." },
        min_cells: { type: "integer", minimum: 0, description: "Only studies/samples with at least this many cells." },
        include_unbuilt: { type: "boolean", default: false, description: "Also return studies whose .singlet file is not built yet." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { title: "Search single-cell studies", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_study",
    title: "Get one study",
    description:
      "Everything singlet.bio knows about one GEO series: title, abstract, organism, tissue/disease/assay groups, experimental conditions parsed from sample characteristics, per-sample metadata (first 60 samples), processing status, bundle URL and Python/R loaders.",
    inputSchema: {
      type: "object",
      properties: { gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession, e.g. GSE178957." } },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "Get one study", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_download_url",
    title: "Get the download URL",
    description:
      "The public URL of a study's .singlet bundle (CC0, no account needed), its size, and the one-line Python/R loaders. `available` is false when the file has not been built yet.",
    inputSchema: {
      type: "object",
      properties: { gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession." } },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "Get the download URL", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_atlas_stats",
    title: "Atlas size",
    description: "Live corpus numbers: studies, samples processed, cells, species, mapping rate and the most common failure reasons.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Atlas size", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

function toolResult(text: string, structured: unknown, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    ...(meta ? { _meta: meta } : {}),
  };
}

function toolError(text: string, extra?: Record<string, unknown>) {
  return { content: [{ type: "text", text }], isError: true, ...(extra ? { _meta: extra } : {}) };
}

function rateLimitMeta(quota?: Quota) {
  return quota
    ? { rate_limit: { used: quota.used, limit: quota.limit, remaining: Math.max(0, quota.limit - quota.used), resets_at: quota.resets_at } }
    : undefined;
}

function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function studySummary(r: StudyRow, why: string) {
  return {
    gse_id: r.gse_id,
    title: r.title,
    organism: r.organism_label,
    organisms: r.organisms,
    tissues: r.tissue_groups,
    diseases: r.disease_groups,
    assays: r.assay_families,
    cell_types: r.cell_types_raw.slice(0, 12),
    conditions: r.conditions_label || null,
    n_samples: r.n_done,
    n_samples_total: r.n_total,
    n_cells: r.suspect_cells ? null : r.n_cells,
    year: r.year,
    has_bundle: r.has_bundle,
    bundle_url: r.has_bundle ? bundleUrl(r.gse_id) : null,
    bundle_bytes: r.bundle_bytes,
    why,
    study_url: `${SITE}/study/${r.gse_id}`,
    geo_url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${r.gse_id}`,
    ...LOADERS(r.gse_id),
  };
}

function sampleSummary(s: SampleRow) {
  return {
    gsm_id: s.gsm_id,
    gse_id: s.gse_id,
    study_title: s.study_title,
    title: s.title,
    organism: s.organism_label,
    tissue: s.tissue,
    tissue_group: s.tissue_group,
    cell_type: s.cell_type,
    disease: s.disease,
    disease_group: s.disease_group,
    assay: s.assay_family,
    sex: s.sex,
    n_cells: s.suspect_cells ? null : s.n_cells,
    status: s.status,
    characteristics: s.characteristics,
    has_bundle: s.has_bundle,
    bundle_url: s.has_bundle ? bundleUrl(s.gse_id) : null,
    study_url: `${SITE}/study/${s.gse_id}`,
  };
}

function describeApplied(applied: NlSearchBody["applied"]): string {
  const parts: string[] = [];
  if (applied.organism.length) parts.push(`organism: ${applied.organism.join(" or ")}`);
  if (applied.tissue_group.length) parts.push(`tissue: ${applied.tissue_group.join(" or ")}`);
  if (applied.disease_group.length) parts.push(`disease: ${applied.disease_group.join(" or ")}`);
  if (applied.assay_family.length) parts.push(`assay: ${applied.assay_family.join(" or ")}`);
  if (applied.cell_type.length) parts.push(`cell type: ${applied.cell_type.join(" or ")}`);
  if (applied.min_cells != null) parts.push(`at least ${fmt(applied.min_cells)} cells`);
  if (applied.year_min != null || applied.year_max != null) parts.push(`year ${applied.year_min ?? "…"}–${applied.year_max ?? "…"}`);
  if (applied.q) parts.push(`text: "${applied.q}"`);
  return parts.length ? parts.join(" · ") : "no filters";
}

// ── Tool implementations ────────────────────────────────────────────────────

async function searchDatasets(env: Env, request: Request, waitUntil: (p: Promise<unknown>) => void, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return toolError("`query` is required — describe what you are looking for, or give a GEO accession.");

  const url = new URL(`${SITE}/api/nl-search`);
  url.searchParams.set("q", query.slice(0, 500));
  url.searchParams.set("level", args.level === "sample" ? "gsm" : "gse");
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
  url.searchParams.set("limit", String(limit));
  const page = Math.max(1, Number(args.page) || 1);
  url.searchParams.set("page", String(page));
  for (const v of strArray(args.organism)) url.searchParams.append("organism", v);
  for (const v of strArray(args.tissue)) url.searchParams.append("tissue_group", v);
  for (const v of strArray(args.disease)) url.searchParams.append("disease_group", v);
  for (const v of strArray(args.assay)) url.searchParams.append("assay_family", v);
  if (args.min_cells != null && Number.isFinite(Number(args.min_cells))) url.searchParams.set("min_cells", String(Math.max(0, Math.floor(Number(args.min_cells)))));
  if (args.include_unbuilt === true) url.searchParams.set("has_bundle", "0");

  const r = await nlSearch(env, request, waitUntil, url);
  if (!r.ok) return toolError(r.message, { error: r.error });
  const b = r.body;
  const meta = rateLimitMeta(r.quota);

  if (b.level === "gse") {
    const rows = (b.data as StudyRow[]).map((row) => studySummary(row, b.why[row.gse_id] ?? row.why));
    const lines: string[] = [];
    lines.push(`${fmt(b.total)} matching stud${b.total === 1 ? "y" : "ies"} for "${query}" (page ${b.page}, showing ${rows.length}).`);
    lines.push(`Read as: ${describeApplied(b.applied)}.`);
    if (b.dropped.length) lines.push(`Not recognised: ${b.dropped.map((d) => `${d.field} "${d.value}"`).join(", ")}.`);
    if (b.note) lines.push(b.note);
    if (b.quota_exceeded) lines.push("Today's AI-search budget is used up; this was a keyword search.");
    lines.push("");
    for (const s of rows) {
      lines.push(`- ${s.gse_id} — ${s.title ?? "(untitled)"}`);
      lines.push(`  ${[s.organism, s.tissues.join("/"), s.diseases.join("/"), s.assays.join("/")].filter(Boolean).join(" · ")} · ${fmt(s.n_samples)} samples · ${s.n_cells != null ? fmt(s.n_cells) + " cells" : "cell count unreliable"}${s.year ? " · " + s.year : ""}`);
      if (s.why) lines.push(`  why: ${s.why}`);
      lines.push(`  ${s.has_bundle ? `load: singlet.load("${s.gse_id}")` : "file not built yet"} · ${s.study_url}`);
    }
    if (b.total === 0 && b.suggestions.length) {
      lines.push("");
      lines.push("Nothing matched every filter. Dropping one filter would give:");
      for (const s of b.suggestions) {
        const what = s.drop ? `drop ${s.drop.field} "${s.drop.value}"` : s.keep ? `keep only ${s.keep.field} "${s.keep.value}"` : "adjust";
        lines.push(`- ${what} → ${fmt(s.total)} studies`);
      }
    }
    return toolResult(
      lines.join("\n"),
      {
        query,
        level: "study",
        interpreted: b.interpreted,
        applied: b.applied,
        not_recognised: b.dropped,
        total: b.total,
        totals: b.totals,
        page: b.page,
        limit: b.limit,
        results: rows,
        suggestions: b.suggestions,
        note: b.note ?? null,
        quota_exceeded: !!b.quota_exceeded,
        model: b.model ?? null,
      },
      meta
    );
  }

  const rows = (b.data as SampleRow[]).map(sampleSummary);
  const lines: string[] = [];
  lines.push(`${fmt(b.total)} matching sample${b.total === 1 ? "" : "s"} for "${query}" (page ${b.page}, showing ${rows.length}).`);
  lines.push(`Read as: ${describeApplied(b.applied)}.`);
  if (b.note) lines.push(b.note);
  lines.push("");
  for (const s of rows) {
    lines.push(`- ${s.gsm_id} (${s.gse_id}) — ${s.title ?? s.study_title ?? ""}`);
    lines.push(`  ${[s.organism, s.tissue ?? s.tissue_group, s.cell_type, s.disease ?? s.disease_group, s.assay].filter(Boolean).join(" · ")} · ${s.n_cells != null ? fmt(s.n_cells) + " cells" : "cell count unreliable"} · ${s.status}`);
  }
  lines.push("");
  lines.push("Note: files are per study — load the parent GSE and subset to these samples.");
  return toolResult(
    lines.join("\n"),
    { query, level: "sample", interpreted: b.interpreted, applied: b.applied, not_recognised: b.dropped, total: b.total, totals: b.totals, page: b.page, limit: b.limit, results: rows, note: b.note ?? null, quota_exceeded: !!b.quota_exceeded },
    meta
  );
}

function studyText(d: StudyDetail): string {
  const s = d.series;
  const m = d.meta;
  const lines: string[] = [];
  lines.push(`${s.id} — ${s.title ?? "(untitled)"}`);
  lines.push(
    [
      s.organism_label,
      m?.tissue_groups.join("/"),
      m?.disease_groups.join("/"),
      m?.assay_families.join("/"),
      m?.year ? String(m.year) : null,
    ]
      .filter(Boolean)
      .join(" · ")
  );
  lines.push(`${fmt(s.n_gsm_done)} of ${fmt(s.n_gsm_total)} samples processed · ${fmt(s.n_cells)} cells${s.n_gsm_failed ? ` · ${fmt(s.n_gsm_failed)} failed` : ""}`);
  if (d.conditions_label) lines.push(`Conditions: ${d.conditions_label}`);
  if (m?.cell_types_raw.length) lines.push(`Cell types recorded: ${m.cell_types_raw.slice(0, 15).join(", ")}`);
  lines.push(s.bundle_url ? `File: ${s.bundle_url}${s.bundle_bytes ? ` (${(s.bundle_bytes / 1e6).toFixed(1)} MB)` : ""}` : "File: not built yet");
  lines.push(`Load: singlet.load("${s.id}")  /  R: load("${s.id}")`);
  lines.push(`${SITE}/study/${s.id}`);
  if (s.abstract) {
    lines.push("");
    lines.push(s.abstract.length > 1500 ? s.abstract.slice(0, 1500) + "…" : s.abstract);
  }
  return lines.join("\n");
}

async function getStudy(env: Env, args: Record<string, unknown>) {
  const id = typeof args.gse_id === "string" ? args.gse_id.trim().toUpperCase() : "";
  if (!GSE_RE.test(id)) return toolError("`gse_id` must be a GEO series accession like GSE178957.");
  const d = await loadStudy(env.DB, id);
  if (!d) return toolError(`${id} is not in the atlas. It may not be single-cell RNA-seq, or it has not been processed yet. Try search_datasets.`);

  const samples = d.samples.slice(0, MAX_SAMPLES_IN_STUDY).map((s) => ({
    gsm_id: s.gsm_id,
    title: s.title ?? null,
    tissue: s.tissue ?? null,
    cell_type: s.cell_type ?? null,
    disease: s.disease ?? null,
    sex: s.sex ?? null,
    donor_id: s.donor_id ?? null,
    n_cells: s.suspect_cells ? null : s.n_cells,
    status: s.status_text,
    characteristics: s.characteristics,
  }));

  const structured = {
    gse_id: d.series.id,
    title: d.series.title,
    abstract: d.series.abstract,
    organism: d.series.organism_label,
    organisms: d.meta?.organisms ?? [],
    tissues: d.meta?.tissue_groups ?? [],
    diseases: d.meta?.disease_groups ?? [],
    assays: d.meta?.assay_families ?? [],
    tissues_raw: d.meta?.tissues_raw ?? [],
    cell_types: d.meta?.cell_types_raw ?? [],
    year: d.meta?.year ?? null,
    n_samples_processed: d.series.n_gsm_done,
    n_samples_total: d.series.n_gsm_total,
    n_samples_failed: d.series.n_gsm_failed,
    n_cells: d.series.n_cells,
    conditions: d.conditions,
    conditions_label: d.conditions_label,
    has_bundle: !!d.series.bundle_url,
    bundle_url: d.series.bundle_url,
    bundle_bytes: d.series.bundle_bytes,
    samples,
    samples_truncated: d.samples.length > samples.length,
    publications: d.publications,
    pubmed_ids: d.series.pubmed_ids,
    study_url: `${SITE}/study/${d.series.id}`,
    geo_url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${d.series.id}`,
    ...LOADERS(d.series.id),
  };
  return toolResult(studyText(d), structured);
}

async function getDownloadUrl(env: Env, args: Record<string, unknown>) {
  const id = typeof args.gse_id === "string" ? args.gse_id.trim().toUpperCase() : "";
  if (!GSE_RE.test(id)) return toolError("`gse_id` must be a GEO series accession like GSE178957.");
  const row = await env.DB.prepare(
    `SELECT g.id, g.title, g.r2_bundle_bytes AS bundle_bytes, COALESCE(m.has_bundle, 0) AS has_bundle
       FROM gse g LEFT JOIN gse_meta m ON m.gse_id = g.id
      WHERE g.id = ?`
  )
    .bind(id)
    .first<{ id: string; title: string | null; bundle_bytes: number | null; has_bundle: number }>();
  if (!row) return toolError(`${id} is not in the atlas.`);
  const available = Number(row.has_bundle) === 1;
  const url = bundleUrl(id);
  const structured = {
    gse_id: id,
    title: row.title,
    available,
    url: available ? url : null,
    bytes: available ? row.bundle_bytes : null,
    license: "CC0-1.0",
    ...LOADERS(id),
    curl: available ? `curl -L -O ${url}` : null,
  };
  const text = available
    ? `${id}: ${url}${row.bundle_bytes ? ` (${(row.bundle_bytes / 1e6).toFixed(1)} MB)` : ""}\nCC0 — no account or key needed to download.\nPython: singlet.load("${id}")   R: load("${id}")`
    : `${id} is in the catalog but its .singlet file has not been built yet.`;
  return toolResult(text, structured);
}

async function getAtlasStats(env: Env) {
  const s = await computeStats(env.DB);
  if (!s) return toolError("Stats are unavailable right now.");
  const text = [
    `${fmt(s.series_count)} studies · ${fmt(s.success_samples)} samples processed (of ${fmt(s.total_samples)}) · ${fmt(s.total_cells)} cells · ${fmt(s.species_count)} species`,
    s.avg_mapping_rate != null ? `Mean mapping rate ${(s.avg_mapping_rate * 100).toFixed(1)}% · median genes per cell ${fmt(s.avg_median_genes)}` : null,
    s.failure_categories.length ? `Most common failure reasons: ${s.failure_categories.slice(0, 5).map((f) => `${f.value} (${fmt(f.count)})`).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return toolResult(text, { ...s, as_of: new Date().toISOString() });
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

interface CallContext {
  env: Env;
  request: Request;
  waitUntil: (p: Promise<unknown>) => void;
  auth: KeyCheck | { ok: false; reason: "missing"; message: string };
}

async function callTool(ctx: CallContext, params: Record<string, unknown>) {
  const name = typeof params.name === "string" ? params.name : "";
  const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
  if (!TOOLS.some((t) => t.name === name)) return { error: rpcError(null, -32602, `Unknown tool: ${name}`) };

  if (!ctx.auth.ok) {
    const how =
      ctx.auth.reason === "missing"
        ? `This tool needs a personal singlet.bio API key. Sign in at ${ACCOUNT_URL} (free), create a key under "API keys", then send it as \`Authorization: Bearer sk_live_…\` (or \`X-API-Key\`) with requests to ${SITE}/mcp. Downloading .singlet files never needs a key.`
        : ctx.auth.message;
    return { result: toolError(how, { auth: ctx.auth.reason, account_url: ACCOUNT_URL }) };
  }

  try {
    switch (name) {
      case "search_datasets":
        return { result: await searchDatasets(ctx.env, ctx.request, ctx.waitUntil, args) };
      case "get_study":
        return { result: await getStudy(ctx.env, args) };
      case "get_download_url":
        return { result: await getDownloadUrl(ctx.env, args) };
      case "get_atlas_stats":
        return { result: await getAtlasStats(ctx.env) };
      default:
        return { error: rpcError(null, -32602, `Unknown tool: ${name}`) };
    }
  } catch (e) {
    return { result: toolError(`The atlas could not answer right now (${String(e).slice(0, 200)}). Try again in a minute.`) };
  }
}

async function handleMessage(ctx: CallContext, msg: JsonRpcRequest): Promise<unknown | undefined> {
  const id = msg.id ?? null;
  const method = msg.method ?? "";
  const params = (msg.params ?? {}) as Record<string, unknown>;
  if (msg.jsonrpc !== "2.0" || typeof method !== "string" || !method) {
    return rpcError(id, -32600, "Invalid JSON-RPC 2.0 request");
  }
  const isNotification = msg.id === undefined;

  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST_PROTOCOL;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return undefined;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const r = await callTool(ctx, params);
      if ("error" in r && r.error) return { ...r.error, id };
      return rpcResult(id, r.result);
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      if (isNotification) return undefined;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function authFor(env: Env, request: Request, waitUntil: (p: Promise<unknown>) => void): Promise<CallContext["auth"]> {
  const key = apiKeyFromRequest(request);
  if (!key) return { ok: false, reason: "missing", message: keyMessage("unknown") };
  return checkApiKey(env, key, waitUntil);
}

export const onRequestPost: PagesFunction<Env> = async ({ env, request, waitUntil }) => {
  const version = (request.headers.get("MCP-Protocol-Version") ?? "").trim();
  if (version && !(PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version: ${version}. Supported: ${PROTOCOL_VERSIONS.join(", ")}` } }, 400);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error: body must be JSON"), 400);
  }

  const ctx: CallContext = { env, request, waitUntil, auth: await authFor(env, request, waitUntil) };
  const messages = Array.isArray(payload) ? (payload as JsonRpcRequest[]) : [payload as JsonRpcRequest];
  if (!messages.length) return json(rpcError(null, -32600, "Empty batch"), 400);

  const replies: unknown[] = [];
  for (const m of messages) {
    const rep = await handleMessage(ctx, m && typeof m === "object" ? m : {});
    if (rep !== undefined) replies.push(rep);
  }

  // Notifications only → 202 with no body.
  if (!replies.length) return new Response(null, { status: 202, headers: JSON_HEADERS });
  const body = Array.isArray(payload) ? replies : replies[0];
  return json(body, 200, { "MCP-Protocol-Version": version || "2025-03-26" });
};

export const onRequestGet: PagesFunction<Env> = async () =>
  json(
    {
      name: SERVER_INFO.name,
      transport: "streamable-http",
      endpoint: `${SITE}/mcp`,
      protocol_versions: PROTOCOL_VERSIONS,
      tools: TOOLS.map((t) => t.name),
      docs: `${SITE}/docs#mcp`,
      note: "POST JSON-RPC 2.0 messages to this URL. Server-initiated streams are not offered.",
    },
    405,
    { Allow: "POST, OPTIONS" }
  );

export const onRequestDelete: PagesFunction<Env> = async () => new Response(null, { status: 405, headers: { ...JSON_HEADERS, Allow: "POST, OPTIONS" } });

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status: 204, headers: CORS_HEADERS });
