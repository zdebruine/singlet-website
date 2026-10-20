/** Shared HTTP shell of the /api/cohort/* endpoints: request parsing and error mapping. */
import { CORS_HEADERS, corsErr } from "./cors";
import { serverError } from "./errors";
import { CohortError, cohortFromParams, parseCohortQuery, type ParsedQuery } from "./cohort-core";
import { IndexUnavailable } from "./cohort-index";

export interface CohortRequest {
  query: ParsedQuery;
  /** Options (max_cells, seed, limit, ...) from the URL, and for POST from the body root as well. */
  opts: URLSearchParams;
}

/** GET: flat parameters or `query=<json>`. POST: the query as the body, or `{ "query": {...}, ...options }`. */
export async function readCohortRequest(request: Request): Promise<CohortRequest> {
  const url = new URL(request.url);
  const opts = new URLSearchParams(url.searchParams);
  if (request.method !== "POST") return { query: parseCohortQuery(cohortFromParams(url)), opts };
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CohortError("The body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CohortError("The body must be a JSON object");
  const b = body as Record<string, unknown>;
  const raw = b.query && typeof b.query === "object" ? b.query : body;
  for (const [k, v] of Object.entries(b)) {
    if (k !== "query" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") && !opts.has(k)) opts.set(k, String(v));
    if (k === "files" && Array.isArray(v)) opts.set("files", v.join(","));
  }
  return { query: parseCohortQuery(raw), opts };
}

export function cohortFailure(e: unknown, context: string): Response {
  if (e instanceof CohortError) return new Response(JSON.stringify({ error: e.message, token: e.token ?? null }), { status: 400, headers: CORS_HEADERS });
  if (e instanceof IndexUnavailable) return corsErr("The search index is not published yet", 503);
  return serverError(e, context);
}

export function numOpt(opts: URLSearchParams, key: string, fallback: number | null): number | null {
  const v = opts.get(key);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new CohortError(`${key} must be a number`, key);
  return n;
}
