/**
 * The POST endpoints of the cell index: `/s1/cidx/query`, `/s1/cidx/gather` and the internal `/s1/cidx/_part` (fan-out); each is also answered under `/v2/` (transition).
 * Runtime-neutral like handler.ts: index.ts passes the bindings, the tests pass fakes.
 */
import type { Deps } from "./handler";
import { CidxError, OverBudget, runQuery, type QueryBody } from "./cidx";
import { runGather, runPart, type GatherBody, type Read } from "./gather";
import { addUsage, charge, identify, limitsFor, rateLimit, type D1Like, type QuotaNamespaceLike, type RateLimiterLike } from "./limits";

const CIDX_ENDPOINTS = ["query", "gather", "_part"];
export const CIDX_PATHS = new Set(CIDX_ENDPOINTS.flatMap((e) => [`/s1/cidx/${e}`, `/v2/cidx/${e}`]));
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface CidxDeps extends Deps {
  db?: D1Like | null;
  rateLimiter?: { anon?: RateLimiterLike | null; key?: RateLimiterLike | null } | null;
  quota?: QuotaNamespaceLike | null;
  /** service binding to this Worker, for splitting big gathers */
  self?: { fetch(input: string, init?: RequestInit): Promise<Response> } | null;
  internalSecret?: string | null;
  limitsOverride?: string | null;
  fanoutMin?: number;
}

function cors(h: Headers): Headers {
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Expose-Headers", "X-Gather-Bytes, X-Gather-Reads, X-Gather-Cells, Retry-After");
  h.set("X-Served-By", "singlet-data");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: cors(new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra })) });
}

export function cidxPreflight(): Response {
  const h = cors(new Headers());
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Singlet-Key");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(null, { status: 204, headers: h });
}

async function readBody<T>(request: Request): Promise<T> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new CidxError(413, "body_too_large", `Request bodies are at most ${MAX_BODY_BYTES} bytes.`);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new CidxError(413, "body_too_large", `Request bodies are at most ${MAX_BODY_BYTES} bytes.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CidxError(400, "bad_json", "The body must be JSON.");
  }
}

export async function handleCidx(request: Request, deps: CidxDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "OPTIONS") return cidxPreflight();
  if (request.method !== "POST") return json(405, { error: "method_not_allowed", message: "Use POST." }, { Allow: "POST, OPTIONS" });
  try {
    if (path.endsWith("/cidx/_part")) {
      if (!deps.internalSecret || request.headers.get("x-cidx-internal") !== deps.internalSecret) return json(404, { error: "not_found", message: "No such object." });
      const b = await readBody<{ reads: Read[] }>(request);
      return await runPart(deps, b.reads);
    }
    const subject = await identify(request, deps.db ?? null);
    const lim = limitsFor(subject.tier, deps.limitsOverride);
    await rateLimit(deps.rateLimiter, subject);
    if (path.endsWith("/cidx/query")) {
      const b = await readBody<QueryBody>(request);
      const r = await runQuery(
        deps,
        b,
        { maxRowsScanned: lim.maxRowsScanned, maxCells: lim.maxCellsPerRequest, maxStudies: lim.maxStudiesPerRequest, maxCostUsd: lim.maxCostUsd },
        {
          beforeScan: () => charge(deps.quota, subject, lim, 0, 0, 1),
          afterScan: (rows, usd) => deps.waitUntil(addUsage(deps.quota, subject, lim, { rows, usd })),
        }
      );
      return json(200, r);
    }
    const b = await readBody<GatherBody>(request);
    const secret = deps.internalSecret;
    const self = deps.self;
    return await runGather(
      {
        deps,
        limits: {
          maxCells: lim.maxCellsPerRequest,
          maxStudies: lim.maxStudiesPerRequest,
          maxSamples: lim.maxSamplesPerGather,
          maxBytes: lim.maxBytesPerGather,
          maxReads: lim.maxReadsPerRequest,
          maxCostUsd: lim.maxCostUsd,
          maxRowsScanned: lim.maxRowsScanned,
        },
        charge: (cells, bytes, usd) => charge(deps.quota, subject, lim, cells, bytes, 0, usd),
        fanout:
          self && secret
            ? (reads) => self.fetch("https://data.singlet.bio/s1/cidx/_part", { method: "POST", headers: { "x-cidx-internal": secret, "content-type": "application/json" }, body: JSON.stringify({ reads }) })
            : null,
        fanoutMin: deps.fanoutMin,
        waitUntil: deps.waitUntil,
      },
      b
    );
  } catch (e) {
    if (e instanceof OverBudget) return json(e.status, { error: e.code, message: e.message, plan: e.plan });
    if (e instanceof CidxError) return json(e.status, { error: e.code, message: e.message }, e.status === 429 ? { "Retry-After": "60" } : {});
    console.error("singlet-data cidx:", e instanceof Error ? e.stack ?? e.message : String(e));
    return json(500, { error: "internal_error", message: "The request failed." });
  }
}
