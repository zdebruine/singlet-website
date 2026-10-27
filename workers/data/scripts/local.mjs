// Run the singlet-data Worker locally in workerd (Miniflare, the runtime `wrangler dev --local` uses) with an R2 bucket seeded from a
// directory laid out like the bucket (s1/m, s1/s, s1/ref, s1/cidx ...). Used to measure the cell-index endpoints without deploying.
//
//   npx esbuild workers/data/src/index.ts --bundle --format=esm --outfile=workers/data/.local/worker.mjs
//   node workers/data/scripts/local.mjs <data dir> [port=8799] [--no-self] [--no-cache]
//
// Bindings: DATA (seeded), CIDX_QUOTA (Durable Object), SELF + CIDX_INTERNAL_SECRET (fan-out) unless --no-self. No D1 (keys are refused,
// anonymous works), no rate limiter.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

const here = dirname(fileURLToPath(import.meta.url));
const [root, portArg, ...flags] = process.argv.slice(2);
if (!root) {
  console.error("usage: node local.mjs <data dir> [port]");
  process.exit(2);
}
const port = Number(portArg || 8799);
const self = !flags.includes("--no-self");

function walk(dir, prefix = "") {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, `${prefix}${f}/`));
    else out.push(`${prefix}${f}`);
  }
  return out;
}

const mf = new Miniflare({
  name: "singlet-data",
  modules: true,
  scriptPath: join(here, "..", ".local", "worker.mjs"),
  compatibilityDate: process.env.COMPAT_DATE || "2026-06-24", // the newest the pinned workerd accepts; the code uses nothing date-dependent
  r2Buckets: ["DATA"],
  durableObjects: { CIDX_QUOTA: { className: "CidxQuota", useSQLite: true } },
  serviceBindings: self ? { SELF: "singlet-data" } : {},
  bindings: { ...(self ? { CIDX_INTERNAL_SECRET: "local-secret" } : {}), ...(process.env.CIDX_FANOUT_MIN_READS ? { CIDX_FANOUT_MIN_READS: process.env.CIDX_FANOUT_MIN_READS } : {}) },
  cache: !flags.includes("--no-cache"),
  port,
  host: "127.0.0.1",
});
const bucket = await mf.getR2Bucket("DATA");
const keys = walk(join(root, "s1"), "s1/").filter((k) => !k.endsWith(".etag"));
let bytes = 0;
for (const k of keys) {
  const b = readFileSync(join(root, k));
  bytes += b.length;
  await bucket.put(k, b);
}
const url = await mf.ready;
console.log(JSON.stringify({ ready: String(url), objects: keys.length, bytes, self }));
