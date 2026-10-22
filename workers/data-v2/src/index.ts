/**
 * Worker entry for data.singlet.bio/v2/*. All behaviour lives in ./handler (runtime-neutral, unit-tested in
 * src/test/data-v2-worker.test.ts); this file only hands it the R2 binding and the edge cache.
 */
import { handle, type CacheLike, type R2BucketLike } from "./handler";

export interface Env {
  /** R2 bucket `singlet-data` (wrangler.toml). Read only: the Worker never writes. */
  DATA: R2Bucket;
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
    return handle(request, { bucket: readOnly(env.DATA), cache: edgeCache(), waitUntil: (p) => ctx.waitUntil(p) });
  },
} satisfies ExportedHandler<Env>;
