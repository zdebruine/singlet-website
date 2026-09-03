/**
 * GET|POST /api/nl-search
 *
 * Natural-language ("AI") catalog search. Translates a plain-English query like
 *   "Find all T cells from pediatric AML"
 * into structured metadata filters via Claude Haiku, then runs a parameterized
 * D1 query and returns the matching samples (level=gsm) or series (level=gse).
 *
 * Params (GET query string or POST JSON body):
 *   q      — the natural-language query (required)
 *   level  — "gsm" (default) | "gse"
 *   limit  — max rows (default 50, clamped 1..200)
 *
 * Behavior:
 *   - With env.ANTHROPIC_API_KEY set: calls the Anthropic Messages API
 *     (claude-haiku-4-5), grounding the model on the controlled vocabulary
 *     pulled live from D1, parses strict-JSON filters, and applies them.
 *     Response: { configured: true, interpreted: {...}, data, accessions, total }
 *   - Without the key: degrades gracefully to a keyword (FTS/LIKE) search.
 *     Response: { configured: false, interpreted: null, data, accessions, total,
 *                 note: "AI search not configured" }
 *
 * NEVER returns 500 for a missing key / model failure — it falls back instead.
 * All SQL is parameterized. Identifier interpolation uses fixed column names only.
 *
 * Stable contract: this endpoint is also consumed by the Python/R packages and
 * the MCP tool. The top-level `accessions` array (flat gsm_id / gse_id strings)
 * is the programmatic entry point — keep it stable.
 */
import { corsOk, corsErr, handleOptions } from "../_shared/cors";
import { safeList } from "../_shared/json";
import { cachedJson } from "../_shared/cache";

interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY?: string;
}

// Columns the model is allowed to filter on (array-valued, case-insensitive).
const ARRAY_FIELDS = ["organism", "tissue", "cell_type", "disease", "protocol", "sex"] as const;
type ArrayField = (typeof ARRAY_FIELDS)[number];

// Per-field cap for the controlled-vocabulary lists fed to the model.
const VOCAB_LIMIT = 60;

interface Interpreted {
  organism: string[];
  tissue: string[];
  cell_type: string[];
  disease: string[];
  protocol: string[];
  sex: string[];
  min_cells: number | null;
  q: string | null;
}

interface ParsedRequest {
  q: string;
  level: "gsm" | "gse";
  limit: number;
}

// ── Request parsing (GET query or POST JSON) ──────────────────────────────────

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const url = new URL(request.url);
  let q = url.searchParams.get("q") ?? "";
  let level = url.searchParams.get("level") ?? "gsm";
  let limitRaw: string | number | null = url.searchParams.get("limit");

  if (request.method === "POST") {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.q === "string") q = body.q;
      if (typeof body.level === "string") level = body.level;
      if (body.limit != null) limitRaw = body.limit as string | number;
    } catch {
      /* ignore malformed body — fall back to query params */
    }
  }

  const limitNum = limitRaw != null ? parseInt(String(limitRaw), 10) : 50;
  const limit = isNaN(limitNum) ? 50 : Math.min(Math.max(1, limitNum), 200);
  return {
    q: q.trim(),
    level: level === "gse" ? "gse" : "gsm",
    limit,
  };
}

// ── Controlled vocabulary (grounds the model) ─────────────────────────────────

/** Distinct values + counts for one gsm column, top N by frequency. */
async function vocab(db: D1Database, col: string): Promise<{ value: string; count: number }[]> {
  const res = await db
    .prepare(
      `SELECT ${col} AS value, COUNT(*) AS count
         FROM gsm
        WHERE ${col} IS NOT NULL AND ${col} != ''
        GROUP BY ${col}
        ORDER BY count DESC
        LIMIT ?`
    )
    .bind(VOCAB_LIMIT)
    .all<{ value: string; count: number }>();
  return res.results;
}

async function loadVocab(db: D1Database): Promise<Record<ArrayField, string[]>> {
  const cols: ArrayField[] = ["organism", "tissue", "cell_type", "disease", "protocol", "sex"];
  const lists = await Promise.all(cols.map((c) => vocab(db, c)));
  const out = {} as Record<ArrayField, string[]>;
  cols.forEach((c, i) => {
    out[c] = lists[i].map((r) => r.value);
  });
  return out;
}

// ── Anthropic Messages API call (Claude Haiku) ────────────────────────────────

const SYSTEM_PROMPT = `You translate a single-cell genomics dataset search query into JSON metadata filters.

You are given a controlled vocabulary of allowed values for several fields. For each field, use ONLY values that appear in the provided vocabulary (match the controlled-vocabulary spelling/case exactly). If the user references a concept that is not in a field's vocabulary, leave that field's array empty and instead put the leftover keywords in "q".

Output STRICT JSON and nothing else — no prose, no markdown fences. The JSON must have exactly these keys:
{"organism":[...],"tissue":[...],"cell_type":[...],"disease":[...],"protocol":[...],"sex":[...],"min_cells":<integer or null>,"q":<string or null>}

Rules:
- Each of organism/tissue/cell_type/disease/protocol/sex is an array of strings drawn from that field's vocabulary (empty array if nothing applies).
- "min_cells" is an integer minimum cell count if the user implies one (e.g. "at least 5000 cells"), else null.
- "q" holds any free-text keywords that don't map to a vocabulary field (e.g. an author, gene, or unmatched concept), else null.
- Map synonyms to the vocabulary where possible (e.g. "AML" -> a leukemia disease value if present; "human" -> "Homo sapiens" if present).`;

/** Extract the first balanced {...} JSON object from arbitrary text. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function coerceInterpreted(raw: unknown): Interpreted {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.trim() !== "") : [];
  const minCellsRaw = obj.min_cells;
  let minCells: number | null = null;
  if (typeof minCellsRaw === "number" && !isNaN(minCellsRaw)) minCells = Math.floor(minCellsRaw);
  else if (typeof minCellsRaw === "string" && minCellsRaw.trim() !== "") {
    const n = parseInt(minCellsRaw, 10);
    if (!isNaN(n)) minCells = n;
  }
  const qRaw = obj.q;
  const q = typeof qRaw === "string" && qRaw.trim() !== "" ? qRaw.trim() : null;
  return {
    organism: arr(obj.organism),
    tissue: arr(obj.tissue),
    cell_type: arr(obj.cell_type),
    disease: arr(obj.disease),
    protocol: arr(obj.protocol),
    sex: arr(obj.sex),
    min_cells: minCells,
    q,
  };
}

/** Call Claude Haiku to translate the query. Returns null on any failure. */
async function interpret(
  apiKey: string,
  query: string,
  vocabLists: Record<ArrayField, string[]>
): Promise<Interpreted | null> {
  const vocabText = ARRAY_FIELDS.map(
    (f) => `${f}: ${vocabLists[f].length ? vocabLists[f].join(", ") : "(none)"}`
  ).join("\n");
  const userMessage =
    `Controlled vocabulary (allowed values per field):\n${vocabText}\n\n` +
    `User query: ${query}\n\n` +
    `Return the JSON filters now.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (!text) return null;
    const parsed = extractJson(text);
    if (parsed == null) return null;
    return coerceInterpreted(parsed);
  } catch {
    return null;
  }
}

// ── SQL builders ──────────────────────────────────────────────────────────────

const GSM_COLS =
  `gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id,
   disease, sex, n_cells, mapping_rate, median_genes, median_umis, mt_pct,
   status, qc_flag, failure_category, singlet_version, pipeline_date,
   pz_size_bytes, title, source, srr_ids, last_updated`;

const GSE_COLS =
  `id, title, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells,
   pubmed_ids, r2_bundle_key, r2_bundle_bytes, submitted_date, last_updated`;

interface BuiltQuery {
  where: string;
  params: (string | number)[];
}

/** Build the WHERE clause for the gsm table from interpreted filters. */
function buildGsmWhere(f: Interpreted): BuiltQuery {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  for (const field of ARRAY_FIELDS) {
    const vals = f[field];
    if (vals.length) {
      const placeholders = vals.map(() => "?").join(",");
      conditions.push(`LOWER(${field}) IN (${placeholders})`);
      for (const v of vals) params.push(v.toLowerCase());
    }
  }
  if (f.min_cells != null) {
    conditions.push("n_cells >= ?");
    params.push(f.min_cells);
  }
  if (f.q) {
    conditions.push(
      "(gsm_id IN (SELECT gsm_id FROM fts_gsm WHERE fts_gsm MATCH ?) " +
        "OR LOWER(title) LIKE ? OR LOWER(source) LIKE ?)"
    );
    const like = `%${f.q.toLowerCase()}%`;
    params.push(f.q + "*", like, like);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

/** Build the WHERE clause for the gse table (only organism + min_cells + q apply). */
function buildGseWhere(f: Interpreted): BuiltQuery {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (f.organism.length) {
    const placeholders = f.organism.map(() => "?").join(",");
    conditions.push(`LOWER(organism) IN (${placeholders})`);
    for (const v of f.organism) params.push(v.toLowerCase());
  }
  if (f.min_cells != null) {
    conditions.push("n_cells >= ?");
    params.push(f.min_cells);
  }
  if (f.q) {
    conditions.push("(id IN (SELECT id FROM fts_gse WHERE fts_gse MATCH ?) OR LOWER(title) LIKE ?)");
    params.push(f.q + "*", `%${f.q.toLowerCase()}%`);
  }

  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// ── Query execution ───────────────────────────────────────────────────────────

async function runGsm(db: D1Database, f: Interpreted, limit: number) {
  const { where, params } = buildGsmWhere(f);
  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM gsm ${where}`).bind(...params).first<{ n: number }>(),
    db
      .prepare(
        `SELECT ${GSM_COLS}
           FROM gsm ${where}
          ORDER BY (status = 'DONE') DESC, n_cells DESC
          LIMIT ?`
      )
      .bind(...params, limit)
      .all<Record<string, unknown>>(),
  ]);
  const data = rows.results.map((r) => ({ ...r, srr_ids: safeList(r.srr_ids) }));
  const accessions = rows.results.map((r) => String(r.gsm_id));
  return { total: countRow?.n ?? 0, data, accessions };
}

async function runGse(db: D1Database, f: Interpreted, limit: number) {
  const { where, params } = buildGseWhere(f);
  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM gse ${where}`).bind(...params).first<{ n: number }>(),
    db
      .prepare(
        `SELECT ${GSE_COLS}
           FROM gse ${where}
          ORDER BY (n_gsm_done > 0) DESC, n_cells DESC
          LIMIT ?`
      )
      .bind(...params, limit)
      .all<Record<string, unknown>>(),
  ]);
  const data = rows.results.map((r) => ({ ...r, pubmed_ids: safeList(r.pubmed_ids) }));
  const accessions = rows.results.map((r) => String(r.id));
  return { total: countRow?.n ?? 0, data, accessions };
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handle(env: Env, request: Request): Promise<Response> {
  const { q, level, limit } = await parseRequest(request);

  if (!q) {
    return corsOk({
      configured: !!env.ANTHROPIC_API_KEY,
      interpreted: null,
      data: [],
      accessions: [],
      total: 0,
      note: "Empty query",
    });
  }

  // Keyword-only fallback filter (used when no key, or model fails).
  const keywordFilter: Interpreted = {
    organism: [],
    tissue: [],
    cell_type: [],
    disease: [],
    protocol: [],
    sex: [],
    min_cells: null,
    q,
  };

  // ── Not configured → graceful keyword search ──
  if (!env.ANTHROPIC_API_KEY) {
    const result =
      level === "gse" ? await runGse(env.DB, keywordFilter, limit) : await runGsm(env.DB, keywordFilter, limit);
    return corsOk({
      configured: false,
      interpreted: null,
      level,
      data: result.data,
      accessions: result.accessions,
      total: result.total,
      note: "AI search not configured",
    });
  }

  // ── Configured → ground on vocab, interpret, query ──
  const vocabLists = await loadVocab(env.DB);
  const interpreted = await interpret(env.ANTHROPIC_API_KEY, q, vocabLists);

  if (!interpreted) {
    // Model failed/unparseable → fall back to keyword search, still 200.
    const result =
      level === "gse" ? await runGse(env.DB, keywordFilter, limit) : await runGsm(env.DB, keywordFilter, limit);
    return corsOk({
      configured: true,
      interpreted: null,
      level,
      data: result.data,
      accessions: result.accessions,
      total: result.total,
      note: "Could not interpret query — showing keyword matches",
    });
  }

  const result =
    level === "gse" ? await runGse(env.DB, interpreted, limit) : await runGsm(env.DB, interpreted, limit);

  return corsOk({
    configured: true,
    interpreted,
    level,
    data: result.data,
    accessions: result.accessions,
    total: result.total,
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, waitUntil }) =>
  cachedJson(request, waitUntil, async () => {
    try {
      return await handle(env, request);
    } catch (e) {
      return corsErr(String(e));
    }
  });

export const onRequestPost: PagesFunction<Env> = async ({ env, request }) => {
  try {
    return await handle(env, request);
  } catch (e) {
    return corsErr(String(e));
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
