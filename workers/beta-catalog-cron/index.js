/**
 * Beta catalog cron (every 10 minutes). Calls beta.singlet.bio's own ingest routes, in the order the catalog contract asks for
 * (functions/api/ingest/[table].ts, ORCHESTRATOR CONTRACT):
 *   1. POST /api/ingest/beta-catalog   gse and gsm rows for studies published since the last run
 *   2. GET  /api/ingest/refresh-next   normalized sample fields and the study rollup (gse_meta)
 *   3. GET  /api/ingest/index-next     sample_qc read from the new .s1 objects
 *   4. GET  /api/ingest/refresh-next   once more, so new sample_qc rows get usable flags
 * Every loop is bounded (MAX_CALLS per step) and paced (PAUSE_MS), so one run makes at most about 20 requests. Nothing runs when step 1
 * finds no new study and the cranks report nothing remaining. Each run logs one JSON line (wrangler tail; no secrets).
 */
const MAX_CALLS = 4;
const PAUSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(env, method, path) {
  const r = await fetch(`${env.BASE}/api/ingest/${path}`, {
    method,
    headers: { "X-Ingest-Token": env.INGEST_TOKEN, "User-Agent": "singlet-beta-catalog-cron/1" },
  });
  let body = null;
  try {
    body = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, body };
}

async function run(env) {
  const log = [];
  let changed = false;
  for (let i = 0; i < MAX_CALLS; i++) {
    const r = await call(env, "POST", "beta-catalog?n=25");
    log.push({ step: "beta-catalog", status: r.status, synced: r.body?.synced?.length, failed: r.body?.failed?.length, remaining: r.body?.remaining });
    if (r.status !== 200) break;
    if (r.body?.synced?.length) changed = true;
    if (!r.body?.remaining) break;
    await sleep(PAUSE_MS);
  }
  const crank = async (path, left) => {
    for (let i = 0; i < MAX_CALLS; i++) {
      const r = await call(env, "GET", path);
      log.push({ step: path.split("?")[0], status: r.status, remaining: left(r.body) });
      if (r.status === 429) {
        await sleep(PAUSE_MS * 2);
        continue;
      }
      if (r.status !== 200 || !left(r.body)) break;
      await sleep(PAUSE_MS);
    }
  };
  await crank("refresh-next?n=50", (b) => (b?.remaining_total ?? 0) > 0 || (b?.remaining_total ?? 0) < 0);
  await crank("index-next?n=10", (b) => (b?.remaining ?? 0) > 0);
  if (changed) await crank("refresh-next?n=50", (b) => (b?.remaining_total ?? 0) > 0);
  return { at: new Date().toISOString(), log };
}

let last = null;
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env).then((r) => { last = r; console.log(JSON.stringify(r)); }).catch((e) => (last = { at: new Date().toISOString(), error: String(e) })));
  },
  async fetch() {
    return new Response(JSON.stringify(last ?? { note: "no run in this isolate yet" }), { headers: { "Content-Type": "application/json" } });
  },
};
