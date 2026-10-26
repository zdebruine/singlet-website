/**
 * Worker entry for data.singlet.bio/s1/* (and /v2/* once it takes over from the old script). All behaviour lives in ./handler (GET/HEAD of objects) and ./routes (the cell-index POST
 * endpoints), both runtime-neutral and unit-tested in src/test/data-s1-*.test.ts; this file only hands them the bindings.
 */
import { handle, type CacheLike, type R2BucketLike } from "./handler";
import { CidxQuota, type D1Like, type QuotaNamespaceLike, type RateLimiterLike } from "./limits";
import { CIDX_PATHS, handleCidx } from "./routes";

export { CidxQuota };

export interface Env {
  /** R2 bucket `singlet-data` (wrangler.toml). Read only: the Worker never writes. */
  DATA: R2Bucket;
  /** D1 `singlet-catalog`, used read-only to check API keys (optional). */
  DB?: D1Database;
  /** Workers Rate Limiting bindings for cell-index requests, anonymous and keyed (optional). */
  CIDX_RL_ANON?: RateLimiterLike;
  CIDX_RL_KEY?: RateLimiterLike;
  /** Durable Object namespace of CidxQuota: daily cells/bytes per subject (optional). */
  CIDX_QUOTA?: DurableObjectNamespace;
  /** Service binding to this Worker: splits big gathers across invocations (optional, needs CIDX_INTERNAL_SECRET). */
  SELF?: Fetcher;
  CIDX_INTERNAL_SECRET?: string;
  /** JSON overriding DEFAULT_LIMITS in limits.ts. */
  CIDX_LIMITS?: string;
  /** Reads in a gather plan before it is split across sub-invocations (default 48). */
  CIDX_FANOUT_MIN_READS?: string;
}

function edgeCache(): CacheLike | null {
  try {
    return (caches as unknown as { default?: CacheLike }).default ?? null;
  } catch {
    return null;
  }
}

/** R2Bucket.get is overloaded (the onlyIf form can return a body-less object); the handler uses the plain form only. */
function readOnly(bucket: R2Bucket): R2BucketLike {
  return {
    get: (key, options) => bucket.get(key, options as R2GetOptions | undefined),
    head: (key) => bucket.head(key),
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const deps = { bucket: readOnly(env.DATA), cache: edgeCache(), waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
    const path = new URL(request.url).pathname;
    if (CIDX_PATHS.has(path)) {
      return handleCidx(request, {
        ...deps,
        db: (env.DB as unknown as D1Like) ?? null,
        rateLimiter: { anon: env.CIDX_RL_ANON ?? null, key: env.CIDX_RL_KEY ?? null },
        quota: (env.CIDX_QUOTA as unknown as QuotaNamespaceLike) ?? null,
        self: env.SELF ?? null,
        internalSecret: env.CIDX_INTERNAL_SECRET ?? null,
        limitsOverride: env.CIDX_LIMITS ?? null,
        fanoutMin: env.CIDX_FANOUT_MIN_READS ? Number(env.CIDX_FANOUT_MIN_READS) : undefined,
      });
    }
    return handle(request, deps);
  },
} satisfies ExportedHandler<Env>;
