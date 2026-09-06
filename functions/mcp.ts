/**
 * https://singlet.bio/mcp — Model Context Protocol server (Streamable HTTP).
 *
 * Stateless JSON-RPC 2.0 over POST. No sessions, no server-initiated streams
 * (GET answers 405), every response is plain `application/json`.
 *
 *   initialize                → capabilities + serverInfo + instructions
 *   notifications/initialized → 202
 *   ping                      → {}
 *   tools/list                → the eleven tools below
 *   tools/call                → works WITHOUT a key: AI-interpreted search is
 *                               metered at the anonymous allowance (10/day per
 *                               visitor), everything deterministic is free. A
 *                               personal key (Authorization: Bearer sk_live_…
 *                               or X-API-Key) raises search to 200/day and
 *                               unlocks the two heavy tools.
 *   prompts/list, prompts/get → three guided workflows
 *   resources/list, /read     → singlet://stats, singlet://vocab
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
import { MANIFEST_FORMATS } from "./_shared/manifest-core";
import type { StudyRow, SampleRow } from "./_shared/search-core";
import { productCall } from "./_shared/private-project";
import {
  ACCOUNT_URL,
  LOADERS,
  SITE,
  assessStudy,
  compareStudies,
  exportManifest,
  findMatchedControls,
  fmt,
  fmtBytes,
  getPartialDownload,
  getSampleQc,
  listBundleFiles,
  toolError,
  toolResult,
  type ToolResult,
} from "./_shared/mcp-tools";

type Env = NlEnv;

const SERVER_INFO = { name: "singlet-bio", title: "singlet.bio atlas", version: "2.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];
const MAX_SAMPLES_IN_STUDY = 60;
const ANON_SEARCH_LIMIT = 10;
const KEY_SEARCH_LIMIT = 200;

const INSTRUCTIONS = `singlet.bio is an open atlas of public single-cell RNA-seq studies from GEO, all reprocessed the same way. One CC0 .singlet file per study (zip64) holding per-sample count matrices and per-sample QC.

Recommended order: search_datasets → assess_study or get_study → get_sample_qc → get_download_url (whole study) or get_partial_download (one sample's matrix, by HTTP range) → export_manifest for a cohort. compare_studies and find_matched_controls help pick controls.

Every number and every "why" string is computed, not generated — quote them, don't paraphrase. Catalog cell counts can differ from the file's own QC; the file is the truth. Downloads never need a key. AI-interpreted search is 10/day anonymously; a free key from ${ACCOUNT_URL} raises it to ${KEY_SEARCH_LIMIT}/day and unlocks assess_study and find_matched_controls.`;


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


const TOOLS = [
  {
    name: "search_datasets",
    title: "Search single-cell studies",
    description:
      "Find public scRNA-seq studies (or individual samples) in the singlet.bio atlas from a plain-English question, e.g. \"microglia in the aging mouse brain\" or \"human PBMC covid-19 10x\". GEO accessions (GSE…, GSM…) are looked up directly. The question is turned into structured filters (organism, tissue, disease, assay, cell type) which are ANDed and never relaxed silently; when nothing matches, `suggestions` says what dropping one filter would return. Each result carries a deterministic `why` explaining the match, the download URL and one-line Python/R loaders. Works without an API key at the anonymous allowance (10 AI-interpreted searches per day per visitor); a free key from https://singlet.bio/account raises it to 200/day. Remaining budget is in `_meta.quota`.",
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
  {
    name: "get_sample_qc",
    title: "Per-sample QC",
    description:
      "Per-sample quality control read from the study's own .singlet file: cells called, median UMI and genes per cell, uniquely mapped %, mitochondrial %, reads-in-cells %, input reads, protocol, reference build and pipeline version — plus study-level totals. Samples with fewer than 500 cells or under 60% uniquely mapped are listed in `warnings`. Not metered.",
    inputSchema: {
      type: "object",
      properties: {
        gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession." },
        gsm_ids: { type: "array", items: { type: "string", pattern: "^GSM\\d+$" }, description: "Restrict to these samples." },
      },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "Per-sample QC", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_bundle_files",
    title: "What is inside the file",
    description:
      "List everything inside a study's .singlet file: per-sample matrices and QC files with their sizes, plus the study-level files (manifest, metadata). Use it before get_partial_download. Not metered.",
    inputSchema: {
      type: "object",
      properties: {
        gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession." },
        gsm_id: { type: "string", pattern: "^GSM\\d+$", description: "Only this sample's files." },
      },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "What is inside the file", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_partial_download",
    title: "Fetch one sample's file",
    description:
      "Get the HTTP byte range for one file of one sample inside a study's .singlet archive, so a multi-GB study can be used by downloading only the sample you need. Returns the URL, the Range header, the compression method, compressed and uncompressed sizes, and ready-to-run curl and Python snippets (raw-deflate inflate included). Not metered.",
    inputSchema: {
      type: "object",
      properties: {
        gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession." },
        gsm_id: { type: "string", pattern: "^GSM\\d+$", description: "GEO sample accession." },
        file: { type: "string", description: "File name inside the sample folder, e.g. exon_counts.1pz (see list_bundle_files)." },
      },
      required: ["gse_id", "gsm_id", "file"],
      additionalProperties: false,
    },
    annotations: { title: "Fetch one sample's file", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "export_manifest",
    title: "Export a download manifest",
    description:
      "Turn a search, a filter set or an explicit list of accessions (max 2,000 studies) into a download manifest: TSV, JSON, a curl or wget script, or a Python/R snippet that loads every study. Returns the manifest text, the study count and the total bytes. Not metered.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 500, description: "Keyword query (no AI interpretation)." },
        filters: {
          type: "object",
          description: "Canonical filters.",
          properties: {
            organism: { type: "array", items: { type: "string" } },
            tissue: { type: "array", items: { type: "string", enum: TISSUE_GROUPS as unknown as string[] } },
            disease: { type: "array", items: { type: "string", enum: DISEASE_GROUPS as unknown as string[] } },
            assay: { type: "array", items: { type: "string", enum: ASSAY_FAMILIES as unknown as string[] } },
            cell_type: { type: "array", items: { type: "string" } },
            min_cells: { type: "integer", minimum: 0 },
            year_min: { type: "integer" },
            year_max: { type: "integer" },
          },
          additionalProperties: false,
        },
        gse_ids: { type: "array", items: { type: "string", pattern: "^GSE\\d+$" }, description: "Explicit accessions; overrides query and filters." },
        format: { type: "string", enum: MANIFEST_FORMATS as unknown as string[], default: "tsv" },
      },
      required: ["format"],
      additionalProperties: false,
    },
    annotations: { title: "Export a download manifest", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "find_matched_controls",
    title: "Find matched control studies",
    description:
      "Candidate control studies for a given study: same organism and tissue group, no disease label (or a healthy/control one), preferring the same assay family and reference build, ordered by samples in the file then year. Each candidate carries a deterministic `why` and its loader line, plus honest `caveats` about study-level labels and batch effects. Needs an API key.",
    inputSchema: {
      type: "object",
      properties: {
        gse_id: { type: "string", pattern: "^GSE\\d+$", description: "The study you want controls for." },
        min_samples: { type: "integer", minimum: 1, default: 1, description: "Minimum samples present in the candidate's file." },
        same_assay: { type: "boolean", default: false, description: "Require an overlapping assay family." },
      },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "Find matched control studies", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "compare_studies",
    title: "Compare studies side by side",
    description:
      "Side-by-side comparison of 2–8 studies: organism, tissue/disease/assay groups, conditions, samples (in the file vs in the catalog), cells (file QC vs catalog), reference build, pipeline version, year, PubMed, file size and per-sample QC medians — plus a `differences` list naming every field the studies disagree on, so confounds are explicit. Not metered.",
    inputSchema: {
      type: "object",
      properties: {
        gse_ids: { type: "array", items: { type: "string", pattern: "^GSE\\d+$" }, minItems: 2, maxItems: 8 },
      },
      required: ["gse_ids"],
      additionalProperties: false,
    },
    annotations: { title: "Compare studies side by side", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "assess_study",
    title: "Is this study usable?",
    description:
      "A deterministic usability report for one study (no model call): what the file contains, samples in the file vs on GEO, the per-condition breakdown, QC summary with low-cell and low-mapping samples, reference build, a read-cap note, and what metadata is missing (age, sex, donor, annotations, PubMed). Given `purpose`, it adds concrete fit checks — e.g. \"velocity\" checks for intron-aware layers, \"aging\" checks that an age characteristic exists. Needs an API key.",
    inputSchema: {
      type: "object",
      properties: {
        gse_id: { type: "string", pattern: "^GSE\\d+$", description: "GEO series accession." },
        purpose: { type: "string", maxLength: 300, description: "What you want to do with it, in plain English." },
      },
      required: ["gse_id"],
      additionalProperties: false,
    },
    annotations: { title: "Is this study usable?", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_cohort",
    title: "Get a saved cohort",
    description: "Return a version-pinned cohort and its public/private study identifiers. A session or personal API key is required for private cohorts; a shared-link token can open link cohorts.",
    inputSchema: { type: "object", properties: { id: { type: "string", format: "uuid" }, token: { type: "string", description: "Optional sco_… shared-link token." } }, required: ["id"], additionalProperties: false },
    annotations: { title: "Get a saved cohort", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_cohort",
    title: "Save a cohort",
    description: "Save up to 2,000 public GSE accessions as a private, link-shared or workspace cohort pinned to the current catalogue. Requires a session or personal API key.",
    inputSchema: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 120 }, notes: { type: "string", maxLength: 20000 }, gse_ids: { type: "array", items: { type: "string", pattern: "^GSE\\d+$" }, minItems: 1, maxItems: 2000 }, visibility: { type: "string", enum: ["private", "link", "workspace"], default: "private" }, workspace_id: { type: "string", format: "uuid" } }, required: ["name", "gse_ids"], additionalProperties: false },
    annotations: { title: "Save a cohort", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

/** Tools that need a personal API key; everything else answers anonymously. */
const KEY_ONLY_TOOLS = new Set(["find_matched_controls", "assess_study"]);
/** Only AI-interpreted search spends the daily budget. */
const METERED_TOOLS = new Set(["search_datasets"]);

// ── Prompts ─────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: "assemble_cohort",
    title: "Assemble a cohort",
    description: "Walk from a biological question to a downloadable cohort: search, assess each study, find controls, export a manifest.",
    arguments: [{ name: "question", description: "The biological question, e.g. \"microglia in aged mouse brain vs young\".", required: true }],
  },
  {
    name: "qc_review",
    title: "QC review of one study",
    description: "Read a study and its per-sample QC and write a short, honest QC narrative with warnings.",
    arguments: [{ name: "gse_id", description: "GEO series accession, e.g. GSE200901.", required: true }],
  },
  {
    name: "load_and_summarise",
    title: "Load a study",
    description: "Summarise one study and give the exact commands to load all of it, or just one sample by byte range.",
    arguments: [{ name: "gse_id", description: "GEO series accession, e.g. GSE200901.", required: true }],
  },
];

function promptMessages(name: string, args: Record<string, unknown>): { description: string; messages: unknown[] } | null {
  const question = typeof args.question === "string" ? args.question.trim() : "";
  const gse = typeof args.gse_id === "string" ? args.gse_id.trim().toUpperCase() : "";
  const user = (text: string) => [{ role: "user", content: { type: "text", text } }];
  switch (name) {
    case "assemble_cohort":
      if (!question) return null;
      return {
        description: `Assemble a singlet.bio cohort for: ${question}`,
        messages: user(
          `Use the singlet.bio tools to assemble a cohort for this question: "${question}".

1. search_datasets with the question as written. Report how it was interpreted and how many studies matched.
2. For the 3–5 most promising studies, call assess_study with purpose="${question}" and say plainly which are usable and why not.
3. For each study you keep, call find_matched_controls if the question needs a comparison group, and repeat the assessment on the candidates.
4. Call compare_studies on the final set and list the differences that could confound the comparison.
5. Call export_manifest with the final accessions (format "curl" plus "tsv") and give me both.

Quote the tool numbers and \`why\` strings verbatim — they are computed, not generated. Where the catalog and the file's QC disagree, trust the file and say so.`
        ),
      };
    case "qc_review":
      if (!GSE_RE.test(gse)) return null;
      return {
        description: `QC review of ${gse}`,
        messages: user(
          `Review the quality of ${gse} for me.

1. get_study ${gse} — what the experiment is, its conditions and how many samples were processed.
2. get_sample_qc ${gse} — per-sample cells, UMI, genes, mapping and mitochondrial fraction.

Then write a short QC narrative: overall verdict in one sentence, the numbers that support it, every sample in \`warnings\` named with its problem, and what I should check myself before using it. Use only the returned numbers.`
        ),
      };
    case "load_and_summarise":
      if (!GSE_RE.test(gse)) return null;
      return {
        description: `Load ${gse}`,
        messages: user(
          `Get me set up with ${gse}.

1. get_study ${gse} for the summary and get_download_url for the whole file.
2. list_bundle_files ${gse} so I know what is inside.
3. get_partial_download for the first sample's counts matrix, so I can try one sample without downloading the whole study.

Give me: two sentences on what the study is, the Python and R one-liners, the curl for the whole file with its size, and the range-request commands for the single sample.`
        ),
      };
    default:
      return null;
  }
}

// ── Resources ───────────────────────────────────────────────────────────────

const RESOURCES = [
  {
    uri: "singlet://stats",
    name: "atlas_stats",
    title: "Atlas statistics",
    description: "Live corpus numbers: studies, samples, cells, species, mapping rate.",
    mimeType: "application/json",
  },
  {
    uri: "singlet://vocab",
    name: "vocabulary",
    title: "Canonical filter vocabulary",
    description: "The organism, tissue, disease and assay groups searches can filter on, with study counts — use these exact strings in filters.",
    mimeType: "application/json",
  },
];

async function readResource(env: Env, uri: string) {
  if (uri === "singlet://stats") {
    const s = await computeStats(env.DB);
    return { uri, mimeType: "application/json", text: JSON.stringify({ ...(s ?? {}), as_of: new Date().toISOString() }, null, 2) };
  }
  if (uri === "singlet://vocab") {
    const counts = async (column: string) => {
      const rows = await env.DB.prepare(`SELECT ${column} AS v, COUNT(*) AS n FROM gse_meta WHERE ${column} IS NOT NULL GROUP BY ${column}`)
        .all<{ v: string; n: number }>()
        .catch(() => null);
      const out: Record<string, number> = {};
      for (const r of rows?.results ?? []) {
        for (const value of (() => {
          try {
            const parsed = JSON.parse(r.v);
            return Array.isArray(parsed) ? parsed.map(String) : [String(r.v)];
          } catch {
            return [String(r.v)];
          }
        })())
          out[value] = (out[value] ?? 0) + Number(r.n);
      }
      return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
    };
    const body = {
      note: "Use these exact strings in the tissue/disease/assay filters. Counts are studies in the atlas.",
      organism: await counts("organism_primary"),
      tissue_group: await counts("tissue_groups"),
      disease_group: await counts("disease_groups"),
      assay_family: await counts("assay_families"),
      canonical: { tissue_group: TISSUE_GROUPS, disease_group: DISEASE_GROUPS, assay_family: ASSAY_FAMILIES },
    };
    return { uri, mimeType: "application/json", text: JSON.stringify(body, null, 2) };
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** `_meta.quota` goes on every tool result, metered or not. */
function quotaMeta(hasKey: boolean, quota?: Quota) {
  if (quota) {
    return {
      quota: {
        metered: true,
        kind: quota.kind,
        used: quota.used,
        limit: quota.limit,
        remaining: Math.max(0, quota.limit - quota.used),
        resets_at: quota.resets_at,
        exceeded: !!quota.exceeded,
      },
      rate_limit: { used: quota.used, limit: quota.limit, remaining: Math.max(0, quota.limit - quota.used), resets_at: quota.resets_at },
    };
  }
  return {
    quota: {
      metered: false,
      kind: hasKey ? "user" : "anon",
      ai_search_limit_per_day: hasKey ? KEY_SEARCH_LIMIT : ANON_SEARCH_LIMIT,
      note: `This tool is not metered. Only AI-interpreted search counts: ${ANON_SEARCH_LIMIT}/day without a key, ${KEY_SEARCH_LIMIT}/day with a free key from ${ACCOUNT_URL}.`,
    },
  };
}

function withQuota(result: ToolResult, meta: Record<string, unknown>): ToolResult {
  return { ...result, _meta: { ...meta, ...(result._meta ?? {}) } };
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
    bundle_n_samples: r.bundle_n_samples,
    file_cells: r.file_cells,
    reference_build: r.reference_build,
    match: r.match,
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

async function searchDatasets(
  env: Env,
  request: Request,
  waitUntil: (p: Promise<unknown>) => void,
  args: Record<string, unknown>,
  hasKey: boolean
): Promise<ToolResult> {
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
  const quota = r.quota ?? b.quota;
  const meta = quotaMeta(hasKey, quota);
  // The budget is spent: nlSearch already fell back to a plain keyword search,
  // so the caller still gets results — flagged as an error so the assistant
  // relays the sign-in advice rather than pretending the AI reading happened.
  const exhausted = !!b.quota_exceeded;

  if (b.level === "gse") {
    const rows = (b.data as StudyRow[]).map((row) => studySummary(row, b.why[row.gse_id] ?? row.why));
    const lines: string[] = [];
    lines.push(`${fmt(b.total)} matching stud${b.total === 1 ? "y" : "ies"} for "${query}" (page ${b.page}, showing ${rows.length}).`);
    lines.push(`Read as: ${describeApplied(b.applied)}.`);
    if (b.dropped.length) lines.push(`Not recognised: ${b.dropped.map((d) => `${d.field} "${d.value}"`).join(", ")}.`);
    if (b.note) lines.push(b.note);
    if (b.quota_exceeded) lines.push("Today's AI-search budget is used up; this was a keyword search.");
    lines.push("");
    const fullCount = Math.min(rows.length, b.groups?.full ?? rows.length);
    for (const [index, s] of rows.entries()) {
      if (index === 0 && b.groups) lines.push(`Matches everything (${fmt(b.groups.full)}):`);
      if (index === fullCount && (b.groups?.partial ?? 0) > 0) lines.push(`Partial matches, best first (${fmt(b.groups?.partial)}):`);
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
    const result = toolResult(
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
         groups: b.groups ?? { full: b.total, partial: 0 },
         hard_applied: b.hard_applied ?? b.applied,
        suggestions: b.suggestions,
        note: b.note ?? null,
        quota_exceeded: exhausted,
        model: b.model ?? null,
      },
      meta
    );
    return exhausted ? { ...result, isError: true } : result;
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
  const result = toolResult(
    lines.join("\n"),
    { query, level: "sample", interpreted: b.interpreted, applied: b.applied, not_recognised: b.dropped, total: b.total, totals: b.totals, page: b.page, limit: b.limit, results: rows, note: b.note ?? null, quota_exceeded: exhausted },
    meta
  );
  return exhausted ? { ...result, isError: true } : result;
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
  lines.push(s.bundle_url ? `File: ${s.bundle_url}${s.bundle_bytes ? ` (${fmtBytes(s.bundle_bytes)})` : ""}` : "File: not built yet");
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
    ? `${id}: ${url}${row.bundle_bytes ? ` (${fmtBytes(row.bundle_bytes)})` : ""}\nCC0 — no account or key needed to download.\nPython: singlet.load("${id}")   R: load("${id}")`
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

  const hasKey = ctx.auth.ok;
  // A key that was sent but is wrong or revoked is always an error, whatever
  // the tool: silently downgrading it to anonymous would hide the mistake.
  if (!ctx.auth.ok && ctx.auth.reason !== "missing") {
    return { result: toolError(ctx.auth.message, { auth: ctx.auth.reason, account_url: ACCOUNT_URL }) };
  }
  if (!hasKey && KEY_ONLY_TOOLS.has(name)) {
    return {
      result: toolError(
        `${name} needs a personal singlet.bio API key. Sign in at ${ACCOUNT_URL} (free), create a key under "API keys", then send it as \`Authorization: Bearer sk_live_…\` (or \`X-API-Key\`) with requests to ${SITE}/mcp. Everything else here — search, study details, QC, downloads — works without one.`,
        { auth: "key_required", tool: name, account_url: ACCOUNT_URL, ...quotaMeta(false) }
      ),
    };
  }

  const meta = quotaMeta(hasKey);
  const db = { db: ctx.env.DB, waitUntil: ctx.waitUntil };
  try {
    switch (name) {
      case "search_datasets":
        return { result: await searchDatasets(ctx.env, ctx.request, ctx.waitUntil, args, hasKey) };
      case "get_study":
        return { result: withQuota(await getStudy(ctx.env, args), meta) };
      case "get_download_url":
        return { result: withQuota(await getDownloadUrl(ctx.env, args), meta) };
      case "get_atlas_stats":
        return { result: withQuota(await getAtlasStats(ctx.env), meta) };
      case "get_sample_qc":
        return { result: withQuota(await getSampleQc(db, args), meta) };
      case "list_bundle_files":
        return { result: withQuota(await listBundleFiles(db, args), meta) };
      case "get_partial_download":
        return { result: withQuota(await getPartialDownload(db, args), meta) };
      case "export_manifest":
        return { result: withQuota(await exportManifest(ctx.env, ctx.waitUntil, args), meta) };
      case "find_matched_controls":
        return { result: withQuota(await findMatchedControls(db, args), meta) };
      case "compare_studies":
        return { result: withQuota(await compareStudies(db, args), meta) };
      case "assess_study":
        return { result: withQuota(await assessStudy(db, args), meta) };
      case "get_cohort": {
        const cohort = await productCall<Record<string, unknown>>(ctx.request, ctx.env, "get_cohort", { id: args.id, token: args.token });
        return { result: withQuota(toolResult(JSON.stringify(cohort), cohort), meta) };
      }
      case "save_cohort": {
        if (!hasKey && !ctx.request.headers.get("Authorization")) return { result: toolError(`save_cohort needs a signed-in session or personal API key from ${ACCOUNT_URL}.`, { ...meta, auth: "required" }) };
        const saved = await productCall<Record<string, unknown>>(ctx.request, ctx.env, "save_cohort", { name: args.name, notes: args.notes ?? "", visibility: args.visibility ?? "private", workspace_id: args.workspace_id ?? null, public_gse_ids: args.gse_ids });
        return { result: withQuota(toolResult(JSON.stringify(saved), saved), meta) };
      }
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
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
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
      return rpcResult(id, { resources: RESOURCES });
    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: [] });
    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      const contents = await readResource(ctx.env, uri).catch(() => null);
      if (!contents) return rpcError(id, -32602, `Unknown resource: ${uri}`);
      return rpcResult(id, { contents: [contents] });
    }
    case "prompts/list":
      return rpcResult(id, { prompts: PROMPTS });
    case "prompts/get": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>;
      if (!PROMPTS.some((p) => p.name === name)) return rpcError(id, -32602, `Unknown prompt: ${name}`);
      const built = promptMessages(name, args);
      if (!built) return rpcError(id, -32602, `Missing or invalid arguments for prompt: ${name}`);
      return rpcResult(id, built);
    }
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
